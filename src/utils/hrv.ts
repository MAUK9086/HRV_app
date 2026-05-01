import { mean } from "@/utils/dsp";
import type { HrvMetrics } from "@/utils/types";

const EPS = 1e-8;

const buildBeatTimesSeconds = (ibisMs: number[]): number[] => {
  const times: number[] = [0];
  let t = 0;

  for (const ibi of ibisMs) {
    t += ibi / 1000;
    times.push(t);
  }

  return times;
};

const resampleIbiSeries = (ibisMs: number[], fs = 4): { t: number[]; y: number[] } => {
  if (ibisMs.length < 2) {
    return { t: [], y: [] };
  }

  const beatTimes = buildBeatTimesSeconds(ibisMs);
  const values = [ibisMs[0], ...ibisMs];

  const duration = beatTimes[beatTimes.length - 1];
  if (duration <= 0) {
    return { t: [], y: [] };
  }

  const dt = 1 / fs;
  const outT: number[] = [];
  const outY: number[] = [];

  let j = 0;
  for (let t = 0; t <= duration; t += dt) {
    while (j < beatTimes.length - 2 && t > beatTimes[j + 1]) {
      j += 1;
    }

    const t0 = beatTimes[j];
    const t1 = beatTimes[j + 1];
    const y0 = values[j];
    const y1 = values[j + 1];

    const ratio = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    outT.push(t);
    outY.push(y0 + ratio * (y1 - y0));
  }

  return { t: outT, y: outY };
};

const dftPower = (signal: number[], fs: number): { f: number[]; p: number[] } => {
  const n = signal.length;
  if (n === 0) {
    return { f: [], p: [] };
  }

  const centered = signal.map((v) => v - mean(signal));
  const half = Math.floor(n / 2);

  const freqs: number[] = [];
  const power: number[] = [];

  for (let k = 0; k <= half; k += 1) {
    let re = 0;
    let im = 0;

    for (let t = 0; t < n; t += 1) {
      const angle = (2 * Math.PI * k * t) / n;
      re += centered[t] * Math.cos(angle);
      im -= centered[t] * Math.sin(angle);
    }

    const p = (re * re + im * im) / n;
    freqs.push((k * fs) / n);
    power.push(p);
  }

  return { f: freqs, p: power };
};

const integrateBand = (
  f: number[],
  p: number[],
  fMin: number,
  fMax: number,
): number => {
  let sum = 0;
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] >= fMin && f[i] < fMax) {
      sum += p[i];
    }
  }
  return sum;
};

const lfHfAndCoherence = (ibisMs: number[]): { ratio: number; coherence: number } => {
  const fs = 4;
  const resampled = resampleIbiSeries(ibisMs, fs);
  if (resampled.y.length < 8) {
    return { ratio: 0, coherence: 0 };
  }

  const { f, p } = dftPower(resampled.y, fs);

  const lfPower = integrateBand(f, p, 0.04, 0.15);
  const hfPower = integrateBand(f, p, 0.15, 0.4);
  const totalPower = integrateBand(f, p, 0.04, 0.4);

  let f0 = 0.1;
  let peakPower = 0;
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] >= 0.04 && f[i] <= 0.15 && p[i] > peakPower) {
      peakPower = p[i];
      f0 = f[i];
    }
  }

  const coherenceBandPower = integrateBand(f, p, f0 - 0.015, f0 + 0.015);

  return {
    ratio: hfPower > EPS ? lfPower / hfPower : 0,
    coherence: totalPower > EPS ? coherenceBandPower / totalPower : 0,
  };
};

const baevskyStressIndex = (ibisMs: number[]): number => {
  if (ibisMs.length < 3) {
    return 0;
  }

  const binWidth = 50;
  const minIbi = Math.min(...ibisMs);
  const maxIbi = Math.max(...ibisMs);
  const range = maxIbi - minIbi;

  if (range <= EPS) {
    return 0;
  }

  const bins = new Map<number, number>();
  for (const ibi of ibisMs) {
    const index = Math.floor(ibi / binWidth);
    bins.set(index, (bins.get(index) ?? 0) + 1);
  }

  let modeBin = 0;
  let modeCount = 0;
  bins.forEach((count, idx) => {
    if (count > modeCount) {
      modeCount = count;
      modeBin = idx;
    }
  });

  const mo = modeBin * binWidth + binWidth / 2;
  const amo = (modeCount / ibisMs.length) * 100;
  const mxdmn = range;

  return mxdmn > EPS && mo > EPS ? amo / (2 * mo * mxdmn) : 0;
};

export const calculateHrvMetrics = (ibisMs: number[]): HrvMetrics => {
  if (ibisMs.length < 2) {
    return {
      pulse: 0,
      sdnn: 0,
      rmssd: 0,
      lfHfRatio: 0,
      bsi: 0,
      coherence: 0,
    };
  }

  const meanIbi = mean(ibisMs);
  const pulse = meanIbi > EPS ? 60000 / meanIbi : 0;

  const sdnn =
    ibisMs.length > 1
      ? Math.sqrt(
          ibisMs.reduce((acc, ibi) => acc + (ibi - meanIbi) ** 2, 0) /
            (ibisMs.length - 1),
        )
      : 0;

  const diffs: number[] = [];
  for (let i = 1; i < ibisMs.length; i += 1) {
    diffs.push(ibisMs[i] - ibisMs[i - 1]);
  }

  const rmssd =
    diffs.length > 1
      ? Math.sqrt(diffs.reduce((acc, d) => acc + d * d, 0) / diffs.length)
      : 0;

  const { ratio, coherence } = lfHfAndCoherence(ibisMs);
  const bsi = baevskyStressIndex(ibisMs);

  return {
    pulse,
    sdnn,
    rmssd,
    lfHfRatio: ratio,
    bsi,
    coherence,
  };
};
