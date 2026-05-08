"use client";

import { Activity, AlertTriangle, BrainCircuit, Gauge, HeartPulse, Waves } from "lucide-react";
import type { BpMetrics, HrvMetrics } from "@/utils/types";

type MetricsDisplayProps = {
  metrics: HrvMetrics;
  bpMetrics: BpMetrics;
  calibrated: boolean;
  bpModelReady: boolean;
  bpModelError: string | null;
};

const metricItems = (metrics: HrvMetrics, bpMetrics: BpMetrics) => [
  {
    label: "Pulse",
    value: `${metrics.pulse.toFixed(1)} BPM`,
    icon: HeartPulse,
  },
  {
    label: "SDNN",
    value: `${metrics.sdnn.toFixed(1)} ms`,
    icon: Activity,
  },
  {
    label: "RMSSD",
    value: `${metrics.rmssd.toFixed(1)} ms`,
    icon: Waves,
  },
  {
    label: "LF/HF",
    value: metrics.lfHfRatio.toFixed(3),
    icon: Gauge,
  },
  {
    label: "Baevsky SI",
    value: metrics.bsi.toExponential(2),
    icon: BrainCircuit,
  },
  {
    label: "Coherence",
    value: metrics.coherence.toFixed(3),
    icon: HeartPulse,
  },
  {
    label: "BP Waveform",
    value:
      bpMetrics.sbp !== null && bpMetrics.dbp !== null
        ? `${bpMetrics.sbp.toFixed(1)} / ${bpMetrics.dbp.toFixed(1)} mmHg`
        : "Awaiting BP model",
    icon: Gauge,
  },
  {
    label: "MAP",
    value: bpMetrics.map !== null ? `${bpMetrics.map.toFixed(1)} mmHg` : "--",
    icon: Gauge,
  },
];

export const MetricsDisplay = ({
  metrics,
  bpMetrics,
  calibrated,
  bpModelReady,
  bpModelError,
}: MetricsDisplayProps) => {
  const items = metricItems(metrics, bpMetrics);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-800">Live Metrics</h2>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${bpModelReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          <BrainCircuit size={14} />
          {bpModelReady ? "BP model ready" : "BP model not loaded"}
        </span>
      </div>
      {bpModelError ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5" />
            <span>{bpModelError}</span>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-xl border border-slate-100 bg-slate-50 p-3"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-600">
                <Icon size={14} />
                {item.label}
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {calibrated ? item.value : "--"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
