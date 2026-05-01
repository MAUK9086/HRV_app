"use client";

import { Camera, PauseCircle, PlayCircle } from "lucide-react";

type CameraFeedProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  isRunning: boolean;
  calibrationProgress: number;
  onStart: () => void;
  onStop: () => void;
  statusText: string;
};

export const CameraFeed = ({
  videoRef,
  overlayRef,
  isRunning,
  calibrationProgress,
  onStart,
  onStop,
  statusText,
}: CameraFeedProps) => {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Live Camera Feed</h2>
        <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
          <Camera size={14} /> {statusText}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-slate-900">
        <video
          ref={videoRef}
          className="h-auto w-full scale-x-[-1] object-cover"
          muted
          playsInline
          autoPlay
        />
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1]"
        />
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
            <span>Calibration Buffer</span>
            <span>{Math.round(calibrationProgress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-sky-500 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, calibrationProgress))}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            <PlayCircle size={16} /> Start
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!isRunning}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            <PauseCircle size={16} /> Stop
          </button>
        </div>
      </div>
    </section>
  );
};
