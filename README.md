# HRV from webcam (rPPG)

A browser app that estimates pulse and heart-rate variability from an ordinary webcam using remote photoplethysmography (rPPG). Everything runs client-side; video never leaves the browser.

This is an experimental research tool, not a medical device. Readings depend heavily on lighting, motion and camera quality.

## How it works

1. **Face tracking.** MediaPipe Face Landmarker finds the face each frame. Three regions of interest are taken from the landmarks: forehead, left cheek and right cheek.
2. **Colour signal.** The mean RGB of the regions is sampled per frame and smoothed with a short moving average.
3. **Pulse signal.** The POS (plane-orthogonal-to-skin) method turns the RGB traces into a blood volume pulse signal, which is band-pass filtered (Butterworth) and resampled with a cubic spline.
4. **Beats and intervals.** Peaks are detected on the cleaned signal, converted to inter-beat intervals and filtered for outliers.
5. **Metrics.** Over a rolling 30 s window the app reports pulse, SDNN, RMSSD, LF/HF ratio, Baevsky stress index and a coherence score.

Signal processing runs in a Web Worker so the UI stays responsive.

### Blood pressure (optional, experimental)

If a TensorFlow.js graph model is provided, the app also reconstructs a blood-pressure waveform from 8 s windows of the pulse signal (via a continuous wavelet transform) and reports SBP, DBP and MAP. The model is not included in this repo. Without it, the BP panel stays empty. Treat any BP numbers from camera signals with a lot of caution.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and allow camera access. Sit still, face the camera in even light, and give it about 30 s to fill the window.

To enable the BP panel, point the app at a TF.js graph model:

```bash
# .env.local
NEXT_PUBLIC_BP_MODEL_URL=https://<host>/model.json
```

## Layout

```
src/
  app/          page and layout (Next.js App Router)
  components/   camera feed, metrics panel, pulse chart
  hooks/        camera, MediaPipe and worker hooks
  utils/        dsp.ts (filters, POS, peaks, CWT), hrv.ts, bp.ts, roi.ts
  workers/      rppg.worker.ts (signal pipeline)
```

## Stack

Next.js, React, TypeScript, MediaPipe Tasks Vision, TensorFlow.js, Recharts, Tailwind CSS.

See also [serenepulse](https://github.com/MAUK9086/serenepulse), a Python version of the rPPG pipeline with a FastAPI live server.
