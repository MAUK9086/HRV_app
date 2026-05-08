/// <reference lib="webworker" />

import {
  butterworthBandpass,
  cubicSplineInterpolate,
  detectPeaks,
  deriveIbisMs,
  movingAverage,
  posBvp,
  performCWT,
  refineIbis,
  sanitizeForSpline,
  normalizeSignal,
} from "@/utils/dsp";
import { calculateHrvMetrics } from "@/utils/hrv";
import { estimateBpWaveformMetrics, reconstructBpWaveform, stitchBpWaveform } from "@/utils/bp";
import type { BpMetrics, RgbSample, RppgResult, RppgTelemetry, WavePoint } from "@/utils/types";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-wasm";

type WorkerInMessage =
  | { type: "sample"; payload: RgbSample }
  | { type: "reset" };

type WorkerMetricsPayload = {
  hrv: RppgResult["hrv"];
  bp: BpMetrics;
  telemetry: RppgTelemetry;
  waveform: WavePoint[];
  ibisMs: number[];
};

const RAW_BUFFER_SECONDS = 60;
const WINDOW_SECONDS = 30;
const BP_WINDOW_SECONDS = 8;
const OUTPUT_PERIOD_MS = 1000;
const TARGET_FS = 250;
const BP_CWT_RESOLUTION = 256;
const RGB_MA_WINDOW = 5;
const BP_DISPLAY_SAMPLES = 600;
const BP_STITCH_OVERLAP_SAMPLES = 50;
const BP_MODEL_URL = process.env.NEXT_PUBLIC_BP_MODEL_URL?.trim() ?? "";
const DEFAULT_MEAN_BP_MMHG = (120 + 2 * 80) / 3;

let rgbBuffer: RgbSample[] = [];
let lastEmitMs = 0;
let bpModel: tf.GraphModel | null = null;
let bpModelError: string | null = null;
let modelLoadPromise: Promise<void> | null = null;
let processing = false;
let queued = false;
let meanBpEstimateMmHg = DEFAULT_MEAN_BP_MMHG;
let bpMetricBuffer: number[] = [];

const trimBuffer = (latestTs: number): void => {
  const threshold = latestTs - RAW_BUFFER_SECONDS * 1000;
  rgbBuffer = rgbBuffer.filter((s) => s.timestamp >= threshold);
};

const buildWave = (times: number[], filtered: number[]): WavePoint[] => {
  const maxPoints = 1250;
  const start = Math.max(0, filtered.length - maxPoints);
  const tSlice = times.slice(start);
  const ySlice = filtered.slice(start);

  return ySlice.map((v, i) => ({
    t: tSlice[i],
    v,
  }));
};

const downsampleSeries = (
  values: number[],
  times?: number[],
  maxPoints = 1500,
): { values: number[]; times?: number[] } => {
  if (values.length <= maxPoints) {
    return {
      values,
      times,
    };
  }

  const step = Math.ceil(values.length / maxPoints);
  const outValues: number[] = [];
  const outTimes: number[] | undefined = times ? [] : undefined;

  for (let i = 0; i < values.length; i += step) {
    outValues.push(values[i]);
    if (outTimes) {
      outTimes.push(times![i]);
    }
  }

  return {
    values: outValues,
    times: outTimes,
  };
};

const buildModelInput = (scalogram: number[][]): tf.Tensor4D | null => {
  if (scalogram.length === 0 || scalogram[0].length === 0) {
    return null;
  }

  const rows = scalogram.length;
  const cols = scalogram[0].length;
  const flat = new Array<number>(rows * cols * 3);

  let offset = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = scalogram[row][col];
      flat[offset] = value;
      flat[offset + 1] = value;
      flat[offset + 2] = value;
      offset += 3;
    }
  }

  return tf.tensor4d(flat, [1, rows, cols, 3], "float32");
};

const ensureBpModel = async (): Promise<boolean> => {
  if (bpModel) {
    return true;
  }

  if (!BP_MODEL_URL) {
    bpModelError = "BP model URL not configured";
    return false;
  }

  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      try {
        await tf.setBackend("wasm");
        await tf.ready();
        bpModel = await tf.loadGraphModel(BP_MODEL_URL);
        bpModelError = null;
      } catch (error) {
        bpModelError = error instanceof Error ? error.message : "Failed to load BP model";
        bpModel = null;
      }
    })();
  }

  await modelLoadPromise;
  modelLoadPromise = null;

  return bpModel !== null;
};

const inferBpWaveform = async (
  signal: number[],
  meanOffsetMmHg: number,
): Promise<{ waveform: number[]; cwt: ReturnType<typeof performCWT> }> => {
  const cwt = performCWT(signal, TARGET_FS, BP_CWT_RESOLUTION, BP_CWT_RESOLUTION);

  if (!bpModel || cwt.scalogram.length === 0 || cwt.scalogram[0].length === 0) {
    return {
      waveform: [],
      cwt,
    };
  }

  const input = buildModelInput(cwt.scalogram);

  if (!input) {
    return {
      waveform: [],
      cwt,
    };
  }

  try {
    const output = bpModel.predict(input);
    const tensor = Array.isArray(output) ? output[0] : output;
    const outputArray = (await (tensor as tf.Tensor).array()) as number[][][][];
    const channelGrid = outputArray[0] ?? [];
    const realPlane = channelGrid.map((row) => row.map((cell) => cell[0] ?? 0));
    const imagPlane = channelGrid.map((row) => row.map((cell) => cell[1] ?? 0));

    if (Array.isArray(output)) {
      output.forEach((item) => item.dispose());
    } else {
      (tensor as tf.Tensor).dispose();
    }

    const waveform = reconstructBpWaveform(realPlane, imagPlane, TARGET_FS, {
      minFrequencyHz: 0.6,
      maxFrequencyHz: 4.5,
      meanOffsetMmHg,
    });

    return {
      waveform,
      cwt,
    };
  } finally {
    input.dispose();
  }
};

const extractBpWindow = (filtered: number[], t: number[]): { signal: number[]; time: number[] } => {
  const targetLength = Math.max(1, Math.min(filtered.length, Math.floor(TARGET_FS * BP_WINDOW_SECONDS)));
  return {
    signal: filtered.slice(-targetLength),
    time: t.slice(-targetLength),
  };
};

const processWindow = async (): Promise<void> => {
  if (processing) {
    queued = true;
    return;
  }

  processing = true;

  if (rgbBuffer.length < 30) {
    processing = false;
    return;
  }

  const latestTs = rgbBuffer[rgbBuffer.length - 1].timestamp;
  const windowStart = latestTs - WINDOW_SECONDS * 1000;
  const windowed = rgbBuffer.filter((s) => s.timestamp >= windowStart);

  const coverageSec = (latestTs - rgbBuffer[0].timestamp) / 1000;
  const calibrationProgress = Math.max(
    0,
    Math.min(100, (coverageSec / WINDOW_SECONDS) * 100),
  );

  postMessage({
    type: "status",
    payload: {
      calibrationProgress,
      calibrated: calibrationProgress >= 100,
      bpModelReady: !!bpModel,
      bpModelError,
    },
  });

  if (windowed.length < 20 || calibrationProgress < 100) {
    processing = false;
    return;
  }

  if (latestTs - lastEmitMs < OUTPUT_PERIOD_MS) {
    processing = false;
    return;
  }
  lastEmitMs = latestTs;

  const tSec = windowed.map((s) => s.timestamp / 1000);
  const r = windowed.map((s) => s.r);
  const g = windowed.map((s) => s.g);
  const b = windowed.map((s) => s.b);

  const rSmoothed = movingAverage(r, RGB_MA_WINDOW);
  const gSmoothed = movingAverage(g, RGB_MA_WINDOW);
  const bSmoothed = movingAverage(b, RGB_MA_WINDOW);

  const rawBvp = posBvp(rSmoothed, gSmoothed, bSmoothed);
  const boundedBvp = sanitizeForSpline(rawBvp, 4, 3);
  const interpolated = cubicSplineInterpolate(tSec, boundedBvp, TARGET_FS);
  if (interpolated.y.length < TARGET_FS * 5) {
    return;
  }

  const filtered = butterworthBandpass(interpolated.y, TARGET_FS, 0.7, 4.0);
  const peaks = detectPeaks(filtered, TARGET_FS);
  const ibisMs = refineIbis(deriveIbisMs(peaks, TARGET_FS));

  const hrv = calculateHrvMetrics(ibisMs);
  const waveform = buildWave(interpolated.t, filtered);

  const posSeries = downsampleSeries(rawBvp, tSec);
  const interpolatedSeries = downsampleSeries(interpolated.y, interpolated.t);
  const filteredSeries = downsampleSeries(filtered, interpolated.t);

  const bpWindow = extractBpWindow(filtered, interpolated.t);
  let bp: BpMetrics = {
    sbp: null,
    dbp: null,
    map: null,
  };
  let bpWaveform: number[] = [];
  let cwt: ReturnType<typeof performCWT> | undefined;

  if (await ensureBpModel()) {
    const bpInput = normalizeSignal(bpWindow.signal, Math.min(32, Math.max(8, Math.floor(bpWindow.signal.length / 4))));
    const inference = await inferBpWaveform(bpInput, meanBpEstimateMmHg);
    const bpDisplaySegment = inference.waveform;
    cwt = inference.cwt;

    if (bpDisplaySegment.length > 0) {
      bpMetricBuffer = stitchBpWaveform(bpMetricBuffer, bpDisplaySegment, BP_STITCH_OVERLAP_SAMPLES, BP_DISPLAY_SAMPLES);
      const bpMetrics = estimateBpWaveformMetrics(bpMetricBuffer, 100);
      bpWaveform = bpDisplaySegment;
      bp = {
        sbp: bpMetrics.sbp,
        dbp: bpMetrics.dbp,
        map: bpMetrics.map,
      };

      if (bpMetrics.map !== null && Number.isFinite(bpMetrics.map)) {
        meanBpEstimateMmHg = bpMetrics.map;
      }
    }
  }

  const telemetry: RppgTelemetry = {
    rgbRaw: {
      t: tSec,
      r,
      g,
      b,
    },
    rgbSmoothed: {
      t: tSec,
      r: rSmoothed,
      g: gSmoothed,
      b: bSmoothed,
    },
    pos: {
      t: posSeries.times ?? tSec,
      y: posSeries.values,
    },
    interpolated: {
      t: interpolatedSeries.times ?? interpolated.t,
      y: interpolatedSeries.values,
    },
    filtered: {
      t: filteredSeries.times ?? interpolated.t,
      y: filteredSeries.values,
    },
    cwt,
    bpWaveform: bpWaveform.length > 0 ? {
      t: bpWindow.time.slice(-bpWaveform.length),
      y: bpWaveform,
    } : undefined,
  };

  const payload: WorkerMetricsPayload = {
    hrv,
    bp,
    telemetry,
    waveform,
    ibisMs,
  };

  postMessage({
    type: "metrics",
    payload,
  });

  processing = false;

  if (queued) {
    queued = false;
    void processWindow();
  }
};

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const data = event.data;

  if (data.type === "reset") {
    rgbBuffer = [];
    lastEmitMs = 0;
    bpModelError = null;
    meanBpEstimateMmHg = DEFAULT_MEAN_BP_MMHG;
    bpMetricBuffer = [];
    postMessage({
      type: "status",
      payload: {
        calibrationProgress: 0,
        calibrated: false,
        bpModelReady: !!bpModel,
        bpModelError: null,
      },
    });
    return;
  }

  if (data.type === "sample") {
    rgbBuffer.push(data.payload);
    trimBuffer(data.payload.timestamp);
    void processWindow();
  }
};

export {};
