const EPS = 1e-8;

export const movingAverage = (values: number[], windowSize: number): number[] => {
  if (values.length === 0 || windowSize <= 1) {
    return [...values];
  }

  const out = new Array<number>(values.length).fill(0);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= windowSize) {
      sum -= values[i - windowSize];
    }

    const denom = Math.min(windowSize, i + 1);
    out[i] = sum / denom;
  }

  return out;
};

const quantile = (sortedValues: number[], q: number): number => {
  if (sortedValues.length === 0) {
    return 0;
  }

  const clampedQ = Math.max(0, Math.min(1, q));
  const index = (sortedValues.length - 1) * clampedQ;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const frac = index - lo;

  if (lo === hi) {
    return sortedValues[lo];
  }

  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
};

export const sanitizeForSpline = (
  values: number[],
  iqrMultiplier = 4,
  smoothingWindow = 3,
): number[] => {
  if (values.length === 0) {
    return [];
  }

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;

  const low = q1 - iqrMultiplier * iqr;
  const high = q3 + iqrMultiplier * iqr;

  const clipped = values.map((v) => Math.max(low, Math.min(high, v)));
  return movingAverage(clipped, smoothingWindow);
};

export const mean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, v) => acc + v, 0) / values.length;
};

export const std = (values: number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
};

export const posBvp = (r: number[], g: number[], b: number[]): number[] => {
  const mr = mean(r);
  const mg = mean(g);
  const mb = mean(b);

  const rn = r.map((v) => v / (mr + EPS) - 1);
  const gn = g.map((v) => v / (mg + EPS) - 1);
  const bn = b.map((v) => v / (mb + EPS) - 1);

  const x = gn.map((v, i) => v - bn[i]);
  const y = rn.map((v, i) => 2 * v - gn[i] - bn[i]);

  const alpha = std(y) > EPS ? std(x) / (std(y) + EPS) : 0;
  return x.map((v, i) => v + alpha * y[i]);
};

export const cubicSplineInterpolate = (
  x: number[],
  y: number[],
  fs: number,
): { t: number[]; y: number[] } => {
  if (x.length !== y.length || x.length < 2) {
    return { t: [], y: [] };
  }

  const n = x.length;
  const h: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(Math.max(EPS, x[i + 1] - x[i]));
  }

  const alpha = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    alpha[i] =
      (3 / h[i]) * (y[i + 1] - y[i]) - (3 / h[i - 1]) * (y[i] - y[i - 1]);
  }

  const l = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const z = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);
  const bCoef = new Array<number>(n - 1).fill(0);
  const dCoef = new Array<number>(n - 1).fill(0);

  l[0] = 1;
  mu[0] = 0;
  z[0] = 0;

  for (let i = 1; i < n - 1; i += 1) {
    l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / (l[i] + EPS);
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / (l[i] + EPS);
  }

  l[n - 1] = 1;
  z[n - 1] = 0;
  c[n - 1] = 0;

  for (let j = n - 2; j >= 0; j -= 1) {
    c[j] = z[j] - mu[j] * c[j + 1];
    bCoef[j] =
      (y[j + 1] - y[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    dCoef[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }

  const tStart = x[0];
  const tEnd = x[n - 1];
  const dt = 1 / fs;

  const outT: number[] = [];
  const outY: number[] = [];

  let seg = 0;
  for (let t = tStart; t <= tEnd; t += dt) {
    while (seg < n - 2 && t > x[seg + 1]) {
      seg += 1;
    }
    const dx = t - x[seg];
    const value = y[seg] + bCoef[seg] * dx + c[seg] * dx * dx + dCoef[seg] * dx * dx * dx;
    outT.push(t);
    outY.push(value);
  }

  return { t: outT, y: outY };
};

type Biquad = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

const designLowpass = (fc: number, fs: number, q = 1 / Math.sqrt(2)): Biquad => {
  const w0 = (2 * Math.PI * fc) / fs;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const b0 = (1 - cosW0) / 2;
  const b1 = 1 - cosW0;
  const b2 = (1 - cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
};

const designHighpass = (fc: number, fs: number, q = 1 / Math.sqrt(2)): Biquad => {
  const w0 = (2 * Math.PI * fc) / fs;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
};

const applyBiquad = (signal: number[], c: Biquad): number[] => {
  const out = new Array<number>(signal.length).fill(0);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < signal.length; i += 1) {
    const x0 = signal[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return out;
};

const applyBiquadCascade = (signal: number[], stages: Biquad[]): number[] => {
  return stages.reduce((acc, stage) => applyBiquad(acc, stage), signal);
};

const reflectPad = (signal: number[], pad: number): number[] => {
  if (signal.length < 2 || pad <= 0) {
    return [...signal];
  }

  const head = signal.slice(1, Math.min(signal.length, pad + 1)).reverse();
  const tail = signal
    .slice(Math.max(0, signal.length - pad - 1), signal.length - 1)
    .reverse();

  return [...head, ...signal, ...tail];
};

export const butterworthBandpass = (
  signal: number[],
  fs: number,
  lowCutHz: number,
  highCutHz: number,
): number[] => {
  if (signal.length === 0 || lowCutHz <= 0 || highCutHz <= lowCutHz) {
    return [];
  }

  const hp = designHighpass(lowCutHz, fs);
  const lp = designLowpass(highCutHz, fs);
  const stages = [hp, hp, lp, lp];

  const pad = Math.max(0, Math.min(120, signal.length - 2));
  const padded = reflectPad(signal, pad);

  const forward = applyBiquadCascade(padded, stages);
  const backward = applyBiquadCascade([...forward].reverse(), stages).reverse();

  if (pad === 0 || backward.length <= 2 * pad) {
    return backward;
  }

  return backward.slice(pad, backward.length - pad);
};

export const detectPeaks = (
  signal: number[],
  fs: number,
  minDistanceSeconds = 0.25,
): number[] => {
  if (signal.length < 3) {
    return [];
  }

  const signalMean = mean(signal);
  const signalStd = std(signal);
  const threshold = signalMean + 0.35 * signalStd;
  const minDistance = Math.max(1, Math.floor(minDistanceSeconds * fs));

  const peaks: number[] = [];
  let lastPeak = -minDistance;

  for (let i = 1; i < signal.length - 1; i += 1) {
    if (
      signal[i] > threshold &&
      signal[i] > signal[i - 1] &&
      signal[i] >= signal[i + 1] &&
      i - lastPeak >= minDistance
    ) {
      peaks.push(i);
      lastPeak = i;
    }
  }

  return peaks;
};

export const deriveIbisMs = (
  peakIndexes: number[],
  fs: number,
): number[] => {
  if (peakIndexes.length < 2) {
    return [];
  }

  const ibis: number[] = [];
  for (let i = 1; i < peakIndexes.length; i += 1) {
    const deltaSamples = peakIndexes[i] - peakIndexes[i - 1];
    ibis.push((deltaSamples / fs) * 1000);
  }

  return ibis;
};

export const refineIbis = (ibisMs: number[]): number[] => {
  if (ibisMs.length === 0) {
    return [];
  }

  const physiological = ibisMs.filter((ibi) => ibi >= 400 && ibi <= 1300);
  if (physiological.length < 3) {
    return physiological;
  }

  const cleaned: number[] = [];
  for (let i = 0; i < physiological.length; i += 1) {
    const start = Math.max(0, i - 2);
    const end = Math.min(physiological.length, i + 3);
    const local = physiological.slice(start, end);
    const localMean = mean(local);

    if (localMean <= 0) {
      continue;
    }

    if (Math.abs(physiological[i] - localMean) / localMean <= 0.2) {
      cleaned.push(physiological[i]);
    }
  }

  return cleaned;
};
