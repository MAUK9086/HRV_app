"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HrvMetrics, RgbSample, WavePoint } from "@/utils/types";

type WorkerStatus = {
  calibrationProgress: number;
  calibrated: boolean;
};

type UseRppgWorkerReturn = {
  metrics: HrvMetrics;
  waveform: WavePoint[];
  ibisMs: number[];
  status: WorkerStatus;
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

export const useRppgWorker = (): UseRppgWorkerReturn => {
  const workerRef = useRef<Worker | null>(null);
  const [metrics, setMetrics] = useState<HrvMetrics>(ZERO_METRICS);
  const [waveform, setWaveform] = useState<WavePoint[]>([]);
  const [ibisMs, setIbisMs] = useState<number[]>([]);
  const [status, setStatus] = useState<WorkerStatus>({
    calibrationProgress: 0,
    calibrated: false,
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
        setMetrics(payload.metrics as HrvMetrics);
        setWaveform(payload.waveform as WavePoint[]);
        setIbisMs(payload.ibisMs as number[]);
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
    setWaveform([]);
    setIbisMs([]);
    setStatus({ calibrationProgress: 0, calibrated: false });

    workerRef.current?.postMessage({ type: "reset" });
  }, []);

  return useMemo(
    () => ({
      metrics,
      waveform,
      ibisMs,
      status,
      pushSample,
      reset,
    }),
    [metrics, waveform, ibisMs, status, pushSample, reset],
  );
};
