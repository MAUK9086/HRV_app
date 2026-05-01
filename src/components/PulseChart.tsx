"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WavePoint } from "@/utils/types";

type PulseChartProps = {
  data: WavePoint[];
};

export const PulseChart = ({ data }: PulseChartProps) => {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-800">Filtered BVP Waveform</h2>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="t"
              tickFormatter={(value: number) => `${value.toFixed(1)}s`}
              stroke="#64748b"
            />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              formatter={(value) => {
                const num = typeof value === "number" ? value : Number(value ?? 0);
                return num.toFixed(4);
              }}
              labelFormatter={(value) => {
                const num = typeof value === "number" ? value : Number(value ?? 0);
                return `t = ${num.toFixed(2)} s`;
              }}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};
