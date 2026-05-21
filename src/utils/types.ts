export type RgbSample = {
  /** performance.now() milliseconds (monotonic, NOT Date.now()) */
  timestamp: number;
  r: number;
  g: number;
  b: number;
};

export type RoiBox = {
  id: "forehead" | "leftCheek" | "rightCheek";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HrvMetrics = {
  pulse: number;
  sdnn: number;
  rmssd: number;
  lfHfRatio: number;
  bsi: number;
  coherence: number;
};

export type BpMetrics = {
  sbp: number | null;
  dbp: number | null;
  map: number | null;
};

export type SignalSeries = {
  t: number[];
  y: number[];
};

export type RppgTelemetry = {
  rgbRaw: {
    t: number[];
    r: number[];
    g: number[];
    b: number[];
  };
  rgbSmoothed: {
    t: number[];
    r: number[];
    g: number[];
    b: number[];
  };
  pos: SignalSeries;
  interpolated: SignalSeries;
  filtered: SignalSeries;
  cwt?: {
    scalogram: number[][];
    scales: number[];
    frequencies: number[];
  };
  bpWaveform?: SignalSeries;
};

export type RppgResult = {
  hrv: HrvMetrics;
  bp: BpMetrics;
  telemetry: RppgTelemetry;
};

export type WavePoint = {
  t: number;
  v: number;
};
