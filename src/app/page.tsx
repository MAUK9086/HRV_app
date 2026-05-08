"use client";

import { useEffect, useRef } from "react";
import { CameraFeed } from "@/components/CameraFeed";
import { MetricsDisplay } from "@/components/MetricsDisplay";
import { PulseChart } from "@/components/PulseChart";
import { useCamera } from "@/hooks/useCamera";
import { useMediaPipe } from "@/hooks/useMediaPipe";
import { useRppgWorker } from "@/hooks/useRppgWorker";
import { drawOverlayGuide, sampleMeanRgbFromRois } from "@/utils/roi";

export default function Home() {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const { videoRef, isRunning, error: cameraError, startCamera, stopCamera } =
    useCamera();
  const { ready: mediaPipeReady, error: mediaPipeError, detect } = useMediaPipe();
  const {
    metrics,
    bpMetrics,
    waveform,
    bpWaveform,
    status,
    pushSample,
    reset,
  } = useRppgWorker();

  useEffect(() => {
    analysisCanvasRef.current = document.createElement("canvas");
  }, []);

  useEffect(() => {
    if (!isRunning || !mediaPipeReady) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    const tick = () => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      const analysisCanvas = analysisCanvasRef.current;

      if (video && overlay && analysisCanvas && video.videoWidth > 0 && video.videoHeight > 0) {
        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
        }

        const detection = detect(video, performance.now());
        if (detection) {
          drawOverlayGuide(overlay, detection.rois);
          const rgb = sampleMeanRgbFromRois(video, analysisCanvas, detection.rois);

          if (rgb) {
            pushSample({
              timestamp: Date.now(),
              r: rgb.r,
              g: rgb.g,
              b: rgb.b,
            });
          }
        } else {
          drawOverlayGuide(overlay, []);
        }
      }

      rafIdRef.current = window.requestAnimationFrame(tick);
    };

    rafIdRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [detect, isRunning, mediaPipeReady, pushSample, videoRef]);

  const handleStart = async () => {
    reset();
    await startCamera();
  };

  const handleStop = () => {
    stopCamera();
    reset();

    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext("2d");
      ctx?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
  };

  const statusText = cameraError
    ? `Camera error: ${cameraError}`
    : mediaPipeError
      ? `MediaPipe error: ${mediaPipeError}`
      : !mediaPipeReady
        ? "Loading MediaPipe model"
        : !isRunning
          ? "Idle"
          : !status.bpModelReady && !status.bpModelError
            ? "Calibrating rPPG and waiting for BP model"
            : status.bpModelError
              ? "BP model unavailable"
              : status.calibrated
                ? "Calibrated"
                : "Calibrating";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">
          Real-Time rPPG HRV Monitor
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 md:text-base">
          Face-tracked RGB extraction with MediaPipe, POS-based BVP estimation,
          and live HRV metrics from a 30-second calibration window updated every
          second.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <CameraFeed
          videoRef={videoRef}
          overlayRef={overlayRef}
          isRunning={isRunning}
          calibrationProgress={status.calibrationProgress}
          onStart={() => void handleStart()}
          onStop={handleStop}
          statusText={statusText}
        />

        <MetricsDisplay
          metrics={metrics}
          bpMetrics={bpMetrics}
          calibrated={status.calibrated}
          bpModelReady={status.bpModelReady}
          bpModelError={status.bpModelError}
        />
      </div>

      <PulseChart
        data={waveform}
        title="Filtered rPPG / BVP Waveform"
        emptyLabel="Waiting for filtered BVP signal..."
      />
      <PulseChart
        data={bpWaveform}
        title="Estimated Blood Pressure Waveform"
        emptyLabel={
          status.bpModelReady
            ? "Waiting for BP inference output..."
            : "BP model not configured or still loading"
        }
      />
    </main>
  );
}
