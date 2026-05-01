export type RgbSample = {
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

export type WavePoint = {
  t: number;
  v: number;
};
