import { movingAverage } from "@/utils/dsp";

export type BpWaveformMetrics = {
  waveform: number[];
  sbp: number | null;
  dbp: number | null;
  map: number | null;
};

export type StitchedWaveform = {
  waveform: number[];
  inserted: number;
};

const EPS = 1e-8;
const MORLET_W0 = 6;
const MORLET_C_DELTA = 0.776;
const DEFAULT_MEAN_BP_MMHG = (120 + 2 * 80) / 3;

const mean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const std = (values: number[]): number => {
  if (values.length < 2) {
    return 0;
  }

  const m = mean(values);
  const variance =
    values.reduce((acc, value) => acc + (value - m) * (value - m), 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
};

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const percentile = (values: number[], q: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, q));
  const index = clamped * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) {
    return sorted[lo];
  }
  const frac = index - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
};

export const blendBpWaveform = (
  previous: number[],
  incoming: number[],
  overlapSamples: number,
): number[] => {
  // Blend the overlap region with linear cross-fade
  const overlap = Math.max(0, Math.min(overlapSamples, previous.length, incoming.length));
  const blended: number[] = [];

  // Ensure we're blending from the end of previous with start of incoming
  for (let i = 0; i < overlap; i += 1) {
    // Alpha ramps from 0 to 1 over overlap (0 favors previous, 1 favors incoming)
    const alpha = overlap <= 1 ? 1 : i / (overlap - 1);
    const prevIdx = previous.length - overlap + i;
    const prevValue = prevIdx >= 0 && prevIdx < previous.length ? previous[prevIdx] : 0;
    const nextValue = i < incoming.length ? incoming[i] : 0;
    blended.push(prevValue * (1 - alpha) + nextValue * alpha);
  }

  return blended;
};

export const stitchBpWaveform = (
  previous: number[],
  incoming: number[],
  overlapSamples = 125,
  maxSamples = 2000,
): number[] => {
  if (incoming.length === 0) {
    return previous.slice(-maxSamples);
  }

  if (previous.length === 0) {
    return incoming.slice(-maxSamples);
  }

  // Calculate baseline alignment: DC offset between overlapping samples
  const overlap = Math.max(0, Math.min(overlapSamples, previous.length, incoming.length));
  let overlapPrevMean = 0;
  let overlapIncomingMean = 0;

  if (overlap > 0) {
    for (let i = 0; i < overlap; i += 1) {
      const prevIdx = previous.length - overlap + i;
      if (prevIdx >= 0 && prevIdx < previous.length) {
        overlapPrevMean += previous[prevIdx];
      }
      if (i < incoming.length) {
        overlapIncomingMean += incoming[i];
      }
    }
    overlapPrevMean /= overlap;
    overlapIncomingMean /= overlap;
  }

  // Baseline align: subtract DC offset from incoming
  const dcOffset = overlapIncomingMean - overlapPrevMean;
  const alignedIncoming = incoming.map((v) => v - dcOffset);

  // Blend overlap region
  const prefix = previous.slice(0, Math.max(0, previous.length - overlap));
  const blended = blendBpWaveform(previous, alignedIncoming, overlap);
  const stitched: number[] = [...prefix, ...blended, ...alignedIncoming.slice(overlap)];

  return stitched.slice(-maxSamples);
};

const detectLocalExtrema = (values: number[], minDistance = 3): number[] => {
  if (values.length < 3) {
    return [];
  }

  const threshold = mean(values) + 0.25 * std(values);
  const peaks: number[] = [];
  let lastPeak = -minDistance;

  for (let i = 1; i < values.length - 1; i += 1) {
    const isPeak = values[i] > values[i - 1] && values[i] >= values[i + 1];
    if (isPeak && values[i] >= threshold && i - lastPeak >= minDistance) {
      peaks.push(i);
      lastPeak = i;
    }
  }

  return peaks;
};

const detectLocalMinima = (values: number[], minDistance = 3): number[] => {
  if (values.length < 3) {
    return [];
  }

  const threshold = mean(values) - 0.25 * std(values);
  const valleys: number[] = [];
  let lastValley = -minDistance;

  for (let i = 1; i < values.length - 1; i += 1) {
    const isValley = values[i] < values[i - 1] && values[i] <= values[i + 1];
    if (isValley && values[i] <= threshold && i - lastValley >= minDistance) {
      valleys.push(i);
      lastValley = i;
    }
  }

  return valleys;
};

const buildScales = (scaleCount: number, sampleRate: number): number[] => {
  const minFrequencyHz = 0.6;
  const maxFrequencyHz = 4.5;

  return Array.from({ length: scaleCount }, (_, index) => {
    const fraction = scaleCount === 1 ? 0 : index / (scaleCount - 1);
    const frequency = minFrequencyHz + (maxFrequencyHz - minFrequencyHz) * fraction;
    return (6 * sampleRate) / (2 * Math.PI * frequency);
  });
};

const scaleToFrequencyHz = (scale: number, sampleRate: number): number => {
  return (MORLET_W0 * sampleRate) / (2 * Math.PI * (scale + EPS));
};

type ReconstructionOptions = {
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  meanOffsetMmHg?: number;
};

const robustExtrema = (
  waveform: number[],
  sampleRate: number,
): { systolic: number[]; diastolic: number[] } => {
  const minDistance = Math.max(2, Math.floor(sampleRate * 0.22));
  const systolicIndexes = detectLocalExtrema(waveform, minDistance);
  const diastolicIndexes = detectLocalMinima(waveform, minDistance);
  const systolicValues = systolicIndexes.map((index) => waveform[index]);
  const diastolicValues = diastolicIndexes.map((index) => waveform[index]);

  if (systolicValues.length === 0 || diastolicValues.length === 0) {
    return {
      systolic: systolicValues,
      diastolic: diastolicValues,
    };
  }

  const sysLow = percentile(systolicValues, 0.1);
  const sysHigh = percentile(systolicValues, 0.9);
  const diaLow = percentile(diastolicValues, 0.1);
  const diaHigh = percentile(diastolicValues, 0.9);

  return {
    systolic: systolicValues.filter((value) => value >= sysLow && value <= sysHigh),
    diastolic: diastolicValues.filter((value) => value >= diaLow && value <= diaHigh),
  };
};

/**
 * Rescales a waveform to a user-supplied cuff BP target (SBP/DBP).
 * Call this ONLY when the user has explicitly provided their known cuff reading.
 * Do NOT call automatically — silent use produces fake 120/80 readings.
 */
export const calibrateBpWaveformMmHg = (
  waveform: number[],
  targetSbp = 120,
  targetDbp = 80,
): number[] => {
  if (waveform.length === 0) {
    return [];
  }

  const sourceHigh = percentile(waveform, 0.95);
  const sourceLow = percentile(waveform, 0.05);
  const sourceSpan = Math.max(EPS, sourceHigh - sourceLow);
  const targetSpan = Math.max(EPS, targetSbp - targetDbp);
  const scale = targetSpan / sourceSpan;
  const mapped = waveform.map((value) => (value - sourceLow) * scale + targetDbp);

  const targetMap = (targetSbp + 2 * targetDbp) / 3;
  const mappedMean = mean(mapped);
  return mapped.map((value) => value + (targetMap - mappedMean));
};


export const reconstructBpWaveform = (
  realPlane: number[][],
  imagPlane: number[][],
  sampleRate = 250,
  options: ReconstructionOptions = {},
): number[] => {
  if (realPlane.length === 0 || imagPlane.length === 0) {
    return [];
  }

  if (realPlane.length !== imagPlane.length || realPlane[0]?.length !== imagPlane[0]?.length) {
    return [];
  }

  const scaleCount = realPlane.length;
  const timeLength = realPlane[0].length;
  const scales = buildScales(scaleCount, sampleRate);
  const minFrequencyHz = options.minFrequencyHz ?? 0.6;
  const maxFrequencyHz = options.maxFrequencyHz ?? 4.5;

  // Zero out-of-band coefficients to enforce cardiac band constraint
  const bandPassedReal = realPlane.map((row, scaleIndex) => {
    const scale = scales[scaleIndex];
    const frequencyHz = scaleToFrequencyHz(scale, sampleRate);
    if (frequencyHz < minFrequencyHz || frequencyHz > maxFrequencyHz) {
      return new Array<number>(row.length).fill(0);
    }
    return row;
  });

  const reconstructed = new Array<number>(timeLength).fill(0);
  const deltaScale = scaleCount > 1 ? Math.abs(scales[1] - scales[0]) : scales[0] || 1;
  const deltaTau = 1 / sampleRate;
  const coefficient = (deltaScale * Math.sqrt(deltaTau)) / (MORLET_C_DELTA * Math.pow(Math.PI, -0.25));
  let selectedScaleCount = 0;

  for (let scaleIndex = 0; scaleIndex < scaleCount; scaleIndex += 1) {
    const scale = scales[scaleIndex];
    const frequencyHz = scaleToFrequencyHz(scale, sampleRate);

    if (frequencyHz < minFrequencyHz || frequencyHz > maxFrequencyHz) {
      continue;
    }

    selectedScaleCount += 1;
    const scaleWeight = coefficient / Math.sqrt(scale + EPS);

    for (let t = 0; t < timeLength; t += 1) {
      const coeffRe = bandPassedReal[scaleIndex][t] ?? 0;
      reconstructed[t] += scaleWeight * coeffRe;
    }
  }

  if (selectedScaleCount === 0) {
    return [];
  }

  // Minimal amplitude scaling: preserve pulse shape and relative amplitude
  // Only scale if reconstruction is suspiciously small (< 1 mmHg range)
  const reconstructedStd = std(reconstructed);
  const minPulseAmplitude = 1;
  const amplitudeScale = reconstructedStd > EPS && reconstructedStd < minPulseAmplitude ? minPulseAmplitude / reconstructedStd : 1;
  const scaled = reconstructed.map((value) => value * amplitudeScale);

  // Restore mean arterial pressure
  const restoredMean = options.meanOffsetMmHg ?? DEFAULT_MEAN_BP_MMHG;
  const scaledMean = mean(scaled);
  return scaled.map((value) => value - scaledMean + restoredMean);
};

export const estimateBpWaveformMetrics = (waveform: number[], sampleRate = 100): BpWaveformMetrics => {
  if (waveform.length < 3) {
    return { waveform, sbp: null, dbp: null, map: null };
  }

  const smoothed = waveform.length > 5 ? movingAverage(waveform, 5) : waveform;

  // Degenerate waveform: span too small to contain BP information
  const p95 = percentile(smoothed, 0.95);
  const p05 = percentile(smoothed, 0.05);
  if (p95 - p05 < 20) {
    return { waveform, sbp: null, dbp: null, map: null };
  }

  const { systolic, diastolic } = robustExtrema(smoothed, sampleRate);

  // Too few systolic peaks for a reliable median estimate
  if (systolic.length < 3) {
    return { waveform, sbp: null, dbp: null, map: null };
  }

  const sbp = median(systolic);
  const dbp = diastolic.length > 0 ? median(diastolic) : percentile(smoothed, 0.05);

  // Physiologically impossible SBP — model likely failed
  if (sbp < 70 || sbp > 220) {
    return { waveform, sbp: null, dbp: null, map: null };
  }

  return {
    waveform,
    sbp,
    dbp,
    map: (sbp + 2 * dbp) / 3,
  };
};

export const scaleBpWaveform = (
  waveform: number[],
  scale = 1,
  offset = 0,
): number[] => {
  return waveform.map((value) => value * scale + offset);
};
