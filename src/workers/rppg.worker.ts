/// <reference lib="webworker" />

import {
  butterworthBandpass,
  cubicSplineInterpolate,
  detectPeaks,
  deriveIbisMs,
  movingAverage,
  posBvp,
  refineIbis,
  sanitizeForSpline,
} from "@/utils/dsp";
import { calculateHrvMetrics } from "@/utils/hrv";
import type { RgbSample, WavePoint } from "@/utils/types";

type WorkerInMessage =
  | { type: "sample"; payload: RgbSample }
  | { type: "reset" };

const RAW_BUFFER_SECONDS = 60;
const WINDOW_SECONDS = 30;
const OUTPUT_PERIOD_MS = 1000;
const TARGET_FS = 250;
const RGB_MA_WINDOW = 5;

let rgbBuffer: RgbSample[] = [];
let lastEmitMs = 0;

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

const processWindow = (): void => {
  if (rgbBuffer.length < 30) {
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
    },
  });

  if (windowed.length < 20 || calibrationProgress < 100) {
    return;
  }

  if (latestTs - lastEmitMs < OUTPUT_PERIOD_MS) {
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

  const metrics = calculateHrvMetrics(ibisMs);
  const waveform = buildWave(interpolated.t, filtered);

  const posSeries = downsampleSeries(rawBvp, tSec);
  const interpolatedSeries = downsampleSeries(interpolated.y, interpolated.t);
  const filteredSeries = downsampleSeries(filtered, interpolated.t);

  postMessage({
    type: "metrics",
    payload: {
      metrics,
      waveform,
      ibisMs,
      telemetry: {
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
          t: posSeries.times,
          y: posSeries.values,
        },
        interpolated: {
          t: interpolatedSeries.times,
          y: interpolatedSeries.values,
        },
        filtered: {
          t: filteredSeries.times,
          y: filteredSeries.values,
        },
      },
    },
  });
};

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const data = event.data;

  if (data.type === "reset") {
    rgbBuffer = [];
    lastEmitMs = 0;
    postMessage({
      type: "status",
      payload: {
        calibrationProgress: 0,
        calibrated: false,
      },
    });
    return;
  }

  if (data.type === "sample") {
    rgbBuffer.push(data.payload);
    trimBuffer(data.payload.timestamp);
    processWindow();
  }
};

export {};
