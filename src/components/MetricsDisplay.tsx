"use client";

import { Activity, BrainCircuit, Gauge, HeartPulse, Waves } from "lucide-react";
import type { HrvMetrics } from "@/utils/types";

type MetricsDisplayProps = {
  metrics: HrvMetrics;
  calibrated: boolean;
};

const metricItems = (metrics: HrvMetrics) => [
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
];

export const MetricsDisplay = ({ metrics, calibrated }: MetricsDisplayProps) => {
  const items = metricItems(metrics);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-800">Live Metrics</h2>
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
