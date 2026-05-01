"use client";

import { useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { deriveRois } from "@/utils/roi";
import type { RoiBox } from "@/utils/types";

type DetectionResult = {
  landmarks: NormalizedLandmark[];
  rois: RoiBox[];
};

type UseMediaPipeReturn = {
  ready: boolean;
  error: string | null;
  detect: (video: HTMLVideoElement, timestampMs: number) => DetectionResult | null;
};

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export const useMediaPipe = (): UseMediaPipeReturn => {
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        setError(null);
        const resolver = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const landmarker = await FaceLandmarker.createFromOptions(resolver, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        if (!mounted) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setReady(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to initialize MediaPipe";
        setError(message);
        setReady(false);
      }
    };

    void init();

    return () => {
      mounted = false;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const detect = (
    video: HTMLVideoElement,
    timestampMs: number,
  ): DetectionResult | null => {
    const landmarker = landmarkerRef.current;
    if (!landmarker || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const result = landmarker.detectForVideo(video, timestampMs);
    const landmarks = result.faceLandmarks?.[0];

    if (!landmarks || landmarks.length === 0) {
      return null;
    }

    const rois = deriveRois(landmarks, video.videoWidth, video.videoHeight);

    return {
      landmarks,
      rois,
    };
  };

  return {
    ready,
    error,
    detect,
  };
};
