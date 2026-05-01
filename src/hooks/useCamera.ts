"use client";

import { useCallback, useRef, useState } from "react";

type UseCameraReturn = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isRunning: boolean;
  error: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
};

export const useCamera = (): UseCameraReturn => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setError(null);

      if (streamRef.current) {
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          frameRate: { ideal: 30, max: 30 },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsRunning(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Camera init failed";
      setError(message);
      setIsRunning(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setIsRunning(false);
  }, []);

  return {
    videoRef,
    isRunning,
    error,
    startCamera,
    stopCamera,
  };
};
