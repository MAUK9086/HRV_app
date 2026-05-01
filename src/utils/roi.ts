import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { RoiBox } from "@/utils/types";

const FOREHEAD_POINTS = [10, 67, 103, 109, 338, 297, 332, 284];
const LEFT_CHEEK_POINTS = [50, 101, 118, 119, 120, 100, 126, 142];
const RIGHT_CHEEK_POINTS = [280, 330, 347, 348, 349, 329, 355, 371];
const ROI_EMA_ALPHA = 0.32;

let previousRois: Record<RoiBox["id"], RoiBox> | null = null;

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const boxFromIndices = (
  landmarks: NormalizedLandmark[],
  indices: number[],
  width: number,
  height: number,
  padding: number,
): RoiBox => {
  const points = indices
    .map((idx) => landmarks[idx])
    .filter(Boolean)
    .map((p) => ({ x: p.x * width, y: p.y * height }));

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = clamp(Math.min(...xs) - padding, 0, width - 1);
  const maxX = clamp(Math.max(...xs) + padding, 1, width);
  const minY = clamp(Math.min(...ys) - padding, 0, height - 1);
  const maxY = clamp(Math.max(...ys) + padding, 1, height);

  return {
    id: "forehead",
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.max(1, Math.floor(maxX - minX)),
    height: Math.max(1, Math.floor(maxY - minY)),
  };
};

export const deriveRois = (
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): RoiBox[] => {
  if (!landmarks.length || width <= 0 || height <= 0) {
    previousRois = null;
    return [];
  }

  const forehead = {
    ...boxFromIndices(landmarks, FOREHEAD_POINTS, width, height, 6),
    id: "forehead" as const,
  };

  const leftCheek = {
    ...boxFromIndices(landmarks, LEFT_CHEEK_POINTS, width, height, 5),
    id: "leftCheek" as const,
  };

  const rightCheek = {
    ...boxFromIndices(landmarks, RIGHT_CHEEK_POINTS, width, height, 5),
    id: "rightCheek" as const,
  };

  const rawRois = [forehead, leftCheek, rightCheek];

  if (!previousRois) {
    previousRois = {
      forehead,
      leftCheek,
      rightCheek,
    };
    return rawRois;
  }

  const smoothCoord = (prev: number, next: number): number => {
    return prev + ROI_EMA_ALPHA * (next - prev);
  };

  const smoothed = rawRois.map((roi) => {
    const prev = previousRois?.[roi.id] ?? roi;

    return {
      ...roi,
      x: Math.floor(smoothCoord(prev.x, roi.x)),
      y: Math.floor(smoothCoord(prev.y, roi.y)),
      width: Math.max(1, Math.floor(smoothCoord(prev.width, roi.width))),
      height: Math.max(1, Math.floor(smoothCoord(prev.height, roi.height))),
    };
  });

  previousRois = {
    forehead: smoothed.find((r) => r.id === "forehead") as RoiBox,
    leftCheek: smoothed.find((r) => r.id === "leftCheek") as RoiBox,
    rightCheek: smoothed.find((r) => r.id === "rightCheek") as RoiBox,
  };

  return smoothed;
};

export const drawOverlayGuide = (
  canvas: HTMLCanvasElement,
  rois: RoiBox[],
): void => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const guideWidth = Math.floor(w * 0.55);
  const guideHeight = Math.floor(h * 0.74);
  const guideX = Math.floor((w - guideWidth) / 2);
  const guideY = Math.floor((h - guideHeight) / 2);

  ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(guideX, guideY, guideWidth, guideHeight);
  ctx.setLineDash([]);

  const colors: Record<RoiBox["id"], string> = {
    forehead: "rgba(22, 163, 74, 0.95)",
    leftCheek: "rgba(245, 158, 11, 0.95)",
    rightCheek: "rgba(245, 158, 11, 0.95)",
  };

  rois.forEach((roi) => {
    ctx.strokeStyle = colors[roi.id];
    ctx.lineWidth = 2;
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
  });
};

export const sampleMeanRgbFromRois = (
  video: HTMLVideoElement,
  analysisCanvas: HTMLCanvasElement,
  rois: RoiBox[],
): { r: number; g: number; b: number } | null => {
  if (rois.length === 0 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }

  if (
    analysisCanvas.width !== video.videoWidth ||
    analysisCanvas.height !== video.videoHeight
  ) {
    analysisCanvas.width = video.videoWidth;
    analysisCanvas.height = video.videoHeight;
  }

  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  ctx.drawImage(video, 0, 0, analysisCanvas.width, analysisCanvas.height);

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let pxCount = 0;

  for (const roi of rois) {
    const x = clamp(Math.floor(roi.x), 0, analysisCanvas.width - 1);
    const y = clamp(Math.floor(roi.y), 0, analysisCanvas.height - 1);
    const w = clamp(Math.floor(roi.width), 1, analysisCanvas.width - x);
    const h = clamp(Math.floor(roi.height), 1, analysisCanvas.height - y);

    const pixels = ctx.getImageData(x, y, w, h).data;

    for (let i = 0; i < pixels.length; i += 4) {
      rSum += pixels[i];
      gSum += pixels[i + 1];
      bSum += pixels[i + 2];
      pxCount += 1;
    }
  }

  if (pxCount === 0) {
    return null;
  }

  return {
    r: rSum / pxCount,
    g: gSum / pxCount,
    b: bSum / pxCount,
  };
};
