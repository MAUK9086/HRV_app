"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BpMetrics,
  HrvMetrics,
  RgbSample,
  RppgTelemetry,
  WavePoint,
} from "@/utils/types";
import { blendBpWaveform } from "@/utils/bp";

type WorkerStatus = {
  calibrationProgress: number;
  calibrated: boolean;
  bpModelReady: boolean;
  bpModelError: string | null;
};

type UseRppgWorkerReturn = {
  metrics: HrvMetrics;
  bpMetrics: BpMetrics;
  waveform: WavePoint[];
  bpWaveform: WavePoint[];
  ibisMs: number[];
  status: WorkerStatus;
  telemetry: RppgTelemetry | null;
  pushSample: (sample: RgbSample) => void;
  reset: () => void;
};

const ZERO_METRICS: HrvMetrics = {
  pulse: 0,
  sdnn: 0,
  rmssd: 0,
  lfHfRatio: 0,
  bsi: 0,
  coherence: 0,
};

const ZERO_BP_METRICS: BpMetrics = {
  sbp: null,
  dbp: null,
  map: null,
};

const BP_DISPLAY_MAX_SAMPLES = 2000;

export const useRppgWorker = (): UseRppgWorkerReturn => {
  const workerRef = useRef<Worker | null>(null);
  const [metrics, setMetrics] = useState<HrvMetrics>(ZERO_METRICS);
  const [bpMetrics, setBpMetrics] = useState<BpMetrics>(ZERO_BP_METRICS);
  const [waveform, setWaveform] = useState<WavePoint[]>([]);
  const [bpDisplayBuffer, setBpDisplayBuffer] = useState<WavePoint[]>([]);
  const [ibisMs, setIbisMs] = useState<number[]>([]);
  const [telemetry, setTelemetry] = useState<RppgTelemetry | null>(null);
  const [status, setStatus] = useState<WorkerStatus>({
    calibrationProgress: 0,
    calibrated: false,
    bpModelReady: false,
    bpModelError: null,
  });

  useEffect(() => {
    const worker = new Worker(new URL("../workers/rppg.worker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent) => {
      const { type, payload } = event.data;

      if (type === "status") {
        setStatus(payload as WorkerStatus);
      }

      if (type === "metrics") {
        setMetrics(payload.hrv as HrvMetrics);
        setBpMetrics(payload.bp as BpMetrics);
        setWaveform(payload.waveform as WavePoint[]);
        setIbisMs(payload.ibisMs as number[]);
        setTelemetry(payload.telemetry as RppgTelemetry);

        const bpSeries = (payload.telemetry as RppgTelemetry)?.bpWaveform;
        if (bpSeries && bpSeries.t.length > 0) {
          const incoming = bpSeries.t.map((t, index) => ({
            t,
            v: bpSeries.y[index] ?? 0,
          }));

          setBpDisplayBuffer((previous) => {
            if (previous.length === 0) {
              return incoming.slice(-BP_DISPLAY_MAX_SAMPLES);
            }

            // Use 125-sample overlap (0.5s overlap window)
            const overlapSamples = Math.min(125, previous.length, incoming.length);

            // Calculate baseline means for alignment
            const prevValues = previous.map((p) => p.v);
            const incomingValues = incoming.map((p) => p.v);
            const prevMean = prevValues.reduce((a, v) => a + v, 0) / prevValues.length;
            const incomingMean = incomingValues.reduce((a, v) => a + v, 0) / incomingValues.length;
            const baselineDrift = incomingMean - prevMean;

            // Baseline align: remove incoming drift before blending
            const alignedIncoming = incomingValues.map((v) => v - baselineDrift);

            // Linear cross-fade blend for overlap region
            const blendedValues = blendBpWaveform(
              prevValues,
              alignedIncoming,
              overlapSamples,
            );

            // Build new display buffer with proper stitching
            const prefix = previous.slice(0, previous.length - overlapSamples);
            const blendedPoints = blendedValues.slice(0, overlapSamples).map((v, idx) => ({
              t: incoming[idx]?.t ?? previous[previous.length - overlapSamples + idx]?.t ?? 0,
              v,
            }));
            const tail = incoming.slice(overlapSamples).map((point) => ({
              t: point.t,
              v: point.v - baselineDrift,
            }));

            return [...prefix, ...blendedPoints, ...tail].slice(-BP_DISPLAY_MAX_SAMPLES);
          });
        }
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const pushSample = useCallback((sample: RgbSample) => {
    workerRef.current?.postMessage({
      type: "sample",
      payload: sample,
    });
  }, []);

  const reset = useCallback(() => {
    setMetrics(ZERO_METRICS);
    setBpMetrics(ZERO_BP_METRICS);
    setWaveform([]);
    setBpDisplayBuffer([]);
    setIbisMs([]);
    setTelemetry(null);
    setStatus({
      calibrationProgress: 0,
      calibrated: false,
      bpModelReady: false,
      bpModelError: null,
    });

    workerRef.current?.postMessage({ type: "reset" });
  }, []);

  return useMemo(
    () => ({
      metrics,
      bpMetrics,
      waveform,
      bpWaveform: bpDisplayBuffer,
      ibisMs,
      status,
      telemetry,
      pushSample,
      reset,
    }),
    [metrics, bpMetrics, waveform, bpDisplayBuffer, ibisMs, status, telemetry, pushSample, reset],
  );
};
