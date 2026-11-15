import React, { useEffect, useRef } from 'react';
import { Camera, CameraOff, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { CalibrationSettings, FaceTelemetry, Lane } from '../types/game';

interface CameraStageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraStatus: 'idle' | 'starting' | 'active' | 'denied' | 'unavailable';
  modelStatus: 'loading' | 'ready' | 'error';
  telemetry: FaceTelemetry;
  activeLanes: Record<Lane, boolean>;
  calibration: CalibrationSettings;
  showCalibration: boolean;
  onToggleCalibration: () => void;
  onChangeCalibration: (next: CalibrationSettings) => void;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onRecenter: () => void;
}

export const CameraStage: React.FC<CameraStageProps> = ({
  videoRef,
  cameraStatus,
  modelStatus,
  telemetry,
  activeLanes,
  calibration,
  showCalibration,
  onToggleCalibration,
  onChangeCalibration,
  onStartCamera,
  onStopCamera,
  onRecenter,
}) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Draw geometric face tracking cues cleanly over mirrored video
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (cameraStatus !== 'active' || !telemetry.detected) return;

    // 1. Mouth contour outline
    if (telemetry.mouthPoints.length > 2) {
      ctx.save();
      ctx.beginPath();
      telemetry.mouthPoints.forEach((pt, idx) => {
        const px = pt.x * w;
        const py = pt.y * h;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();

      const mouthTriggered = activeLanes.MOUTH;
      ctx.lineWidth = mouthTriggered ? 3.5 : 2;
      ctx.strokeStyle = mouthTriggered ? '#10B981' : 'rgba(226, 232, 240, 0.78)';
      ctx.fillStyle = mouthTriggered ? 'rgba(16, 185, 129, 0.28)' : 'rgba(148, 163, 184, 0.12)';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 2. Subtle eye-line tilt balance indicator
    if (telemetry.leftEye && telemetry.rightEye) {
      const lx = telemetry.leftEye.x * w;
      const ly = telemetry.leftEye.y * h;
      const rx = telemetry.rightEye.x * w;
      const ry = telemetry.rightEye.y * h;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(rx, ry);
      ctx.lineWidth = 2;
      ctx.strokeStyle = activeLanes.LEFT
        ? '#38BDF8'
        : activeLanes.RIGHT
          ? '#F59E0B'
          : 'rgba(226, 232, 240, 0.4)';
      ctx.stroke();

      // Eye anchor dots
      for (const [ex, ey] of [
        [lx, ly],
        [rx, ry],
      ]) {
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = activeLanes.LEFT
          ? '#38BDF8'
          : activeLanes.RIGHT
            ? '#F59E0B'
            : '#E2E8F0';
        ctx.fill();
      }
      ctx.restore();
    }
  }, [cameraStatus, telemetry, activeLanes]);

  const mouthPct = Math.round(Math.min(100, telemetry.mouthOpen * 100));
  const leftTiltPct = Math.round(Math.max(0, Math.min(100, -telemetry.headTilt * 140)));
  const rightTiltPct = Math.round(Math.max(0, Math.min(100, telemetry.headTilt * 140)));
  const mouthThresholdPct = Math.round(calibration.mouthThreshold * 100);
  const tiltThresholdPct = Math.round(calibration.tiltThreshold * 140);

  const activeMoveLabel = activeLanes.MOUTH
    ? 'MOUTH OPEN'
    : activeLanes.LEFT
      ? 'TILT LEFT'
      : activeLanes.RIGHT
        ? 'TILT RIGHT'
        : telemetry.detected
          ? 'FACE READY'
          : cameraStatus === 'active'
            ? 'CENTER FACE IN FRAME'
            : 'KEYBOARD / TOUCH MODE';

  return (
    <section
      aria-label="Camera and Face Controls"
      className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-full"
    >
      {/* Top strip inside camera card */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-100 whitespace-nowrap">
            Camera Stage
          </h2>
          <span className="text-xs text-slate-400 truncate">
            {cameraStatus === 'active'
              ? modelStatus === 'loading'
                ? 'Loading tracker...'
                : 'Tracking locally'
              : 'Keyboard fallback active'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {cameraStatus === 'active' && (
            <button
              type="button"
              onClick={onRecenter}
              title="Recenter neutral head angle"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Recenter</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleCalibration}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              showCalibration
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Tune</span>
          </button>
          <button
            type="button"
            onClick={cameraStatus === 'active' ? onStopCamera : onStartCamera}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {cameraStatus === 'active' ? (
              <>
                <CameraOff className="w-3.5 h-3.5 text-slate-400" />
                <span>Cam Off</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5 text-emerald-400" />
                <span>Enable Cam</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Video viewport */}
      <div className="relative bg-slate-950 aspect-[4/3] w-full overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover -scale-x-100 transition-opacity duration-200 ${
            cameraStatus === 'active' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />
        <canvas
          ref={overlayCanvasRef}
          width={640}
          height={480}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Fallback state when camera is off/denied/unavailable */}
        {cameraStatus !== 'active' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
              <Camera className="w-6 h-6 text-slate-400" />
            </div>
            <p className="font-display text-base font-semibold text-slate-100 mb-1">
              {cameraStatus === 'starting'
                ? 'Starting Camera...'
                : cameraStatus === 'denied'
                  ? 'Camera Permission Blocked'
                  : cameraStatus === 'unavailable'
                    ? 'No Camera Detected'
                    : 'Camera Paused'}
            </p>
            <p className="text-xs text-slate-400 max-w-xs mb-4 leading-relaxed">
              {cameraStatus === 'denied'
                ? 'Allow camera access in your browser bar to play with mouth and head movements, or play right now using keys A / Space / D.'
                : 'Enable your camera for mouth & head tracking, or play instantly with keyboard arrows or lane pads.'}
            </p>
            {cameraStatus !== 'starting' && (
              <button
                type="button"
                onClick={onStartCamera}
                className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                Try Camera Access
              </button>
            )}
          </div>
        )}

        {/* Measured contrast scrim + live gesture readout */}
        <div className="absolute inset-x-0 bottom-0 px-4 py-3 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent flex items-center justify-between pointer-events-none">
          <span
            className={`font-mono-tabular text-xs font-bold tracking-wide ${
              activeLanes.MOUTH
                ? 'text-emerald-400'
                : activeLanes.LEFT
                  ? 'text-sky-400'
                  : activeLanes.RIGHT
                    ? 'text-amber-400'
                    : 'text-slate-200'
            }`}
          >
            {activeMoveLabel}
          </span>
          <span className="font-mono-tabular text-xs text-slate-300">
            {telemetry.detected ? 'Face Locked' : cameraStatus === 'active' ? 'Searching...' : 'Keys Ready'}
          </span>
        </div>
      </div>

      {/* Live Input Gauges */}
      <div className="p-4 space-y-3 border-t border-slate-800 bg-slate-900">
        <div className="grid grid-cols-3 gap-3">
          {/* Tilt Left Gauge */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.LEFT ? 'text-sky-400 font-semibold' : 'text-slate-400'}>
                ← Left
              </span>
              <span className="font-mono-tabular text-slate-300">{leftTiltPct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-[width] duration-75"
                style={{ width: `${leftTiltPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, tiltThresholdPct)}%` }}
              />
            </div>
          </div>

          {/* Mouth Open Gauge */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.MOUTH ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                Mouth
              </span>
              <span className="font-mono-tabular text-slate-300">{mouthPct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${mouthPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, mouthThresholdPct)}%` }}
              />
            </div>
          </div>

          {/* Tilt Right Gauge */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.RIGHT ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                Right →
              </span>
              <span className="font-mono-tabular text-slate-300">{rightTiltPct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-[width] duration-75"
                style={{ width: `${rightTiltPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, tiltThresholdPct)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Collapsible sensitivity tuning */}
        {showCalibration && (
          <div className="pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Mouth Trigger Threshold</span>
                <span className="font-mono-tabular text-emerald-400">
                  {Math.round(calibration.mouthThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.14}
                max={0.62}
                step={0.02}
                value={calibration.mouthThreshold}
                onChange={(e) =>
                  onChangeCalibration({
                    ...calibration,
                    mouthThreshold: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </label>

            <label className="block">
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Head Tilt Sensitivity</span>
                <span className="font-mono-tabular text-sky-400">
                  {Math.round(calibration.tiltThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.12}
                max={0.44}
                step={0.02}
                value={calibration.tiltThreshold}
                onChange={(e) =>
                  onChangeCalibration({
                    ...calibration,
                    tiltThreshold: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-sky-400 cursor-pointer"
              />
            </label>
          </div>
        )}

        <p className="text-xs text-slate-400">
          Camera controls: open mouth for center notes · tilt head left/right for side notes · keys{' '}
          <span className="font-mono-tabular text-slate-300">A / Space / D</span> also work anytime.
        </p>
      </div>
    </section>
  );
};
