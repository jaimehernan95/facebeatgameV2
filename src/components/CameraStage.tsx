import React, { useEffect, useRef } from 'react';
import { Camera, CameraOff, Keyboard, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { CalibrationSettings, FaceTelemetry, Lane } from '../types/game';

interface CameraStageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraStatus: 'idle' | 'starting' | 'active' | 'denied' | 'unavailable';
  modelStatus: 'loading' | 'ready' | 'error';
  telemetry: FaceTelemetry;
  activeLanes: Record<Lane, boolean>;
  calibration: CalibrationSettings;
  onOpenSettings: () => void;
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
  onOpenSettings,
  onStartCamera,
  onStopCamera,
  onRecenter,
}) => {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (cameraStatus !== 'active' || !telemetry.detected) return;

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
      const smileTriggered = activeLanes.SMILE;
      ctx.lineWidth = mouthTriggered || smileTriggered ? 3.5 : 2;
      ctx.strokeStyle = mouthTriggered
        ? '#10B981'
        : smileTriggered
          ? '#FB7185'
          : 'rgba(226, 232, 240, 0.78)';
      ctx.fillStyle = mouthTriggered
        ? 'rgba(16, 185, 129, 0.28)'
        : smileTriggered
          ? 'rgba(251, 113, 133, 0.26)'
          : 'rgba(148, 163, 184, 0.12)';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

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

  const leftTiltPct = Math.round(Math.max(0, Math.min(100, -telemetry.headTilt * 140)));
  const mouthPct = Math.round(Math.min(100, telemetry.mouthOpen * 100));
  const smilePct = Math.round(Math.min(100, telemetry.smile * 100));
  const rightTiltPct = Math.round(Math.max(0, Math.min(100, telemetry.headTilt * 140)));

  const tiltThresholdPct = Math.round(calibration.tiltThreshold * 140);
  const mouthThresholdPct = Math.round(calibration.mouthThreshold * 100);
  const smileThresholdPct = Math.round(calibration.smileThreshold * 100);

  const activeMoveLabel = activeLanes.MOUTH
    ? 'OPEN MOUTH (S)'
    : activeLanes.SMILE
      ? 'BIG SMILE (D)'
      : activeLanes.LEFT
        ? 'TILT LEFT (A)'
        : activeLanes.RIGHT
          ? 'TILT RIGHT (F)'
          : telemetry.detected
            ? 'FACE READY'
            : cameraStatus === 'active'
              ? 'CENTER FACE IN FRAME'
              : 'KEYBOARD ARCADE MODE';

  const keyboardFallbackActive = cameraStatus !== 'active';

  return (
    <section
      aria-label="Camera and Face Controls"
      className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-full"
    >
      {/* Top strip inside camera card */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-100 whitespace-nowrap">
            Camera Stage
          </h2>
          {keyboardFallbackActive ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30 whitespace-nowrap">
              <Keyboard className="w-3 h-3" />
              <span>Keyboard Mode · A S D F</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400 truncate">
              {modelStatus === 'loading' ? 'Loading tracker...' : 'Local tracking'}
            </span>
          )}
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
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Settings</span>
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

        {cameraStatus !== 'active' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
              <Keyboard className="w-6 h-6 text-sky-400" />
            </div>
            <p className="font-display text-base font-semibold text-slate-100 mb-1">
              {cameraStatus === 'starting'
                ? 'Starting Camera...'
                : cameraStatus === 'denied'
                  ? 'Camera Permission Denied'
                  : cameraStatus === 'unavailable'
                    ? 'No Webcam Detected'
                    : 'Camera Paused'}
            </p>
            <p className="text-xs text-slate-400 max-w-xs mb-4 leading-relaxed">
              Keyboard Arcade Mode is active right now — press{' '}
              <span className="font-mono-tabular text-slate-200">A · S · D · F</span> (or tap the
              pads below) to play the full game without a webcam.
            </p>
            {cameraStatus !== 'starting' && (
              <button
                type="button"
                onClick={onStartCamera}
                className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                Enable Camera
              </button>
            )}
          </div>
        )}

        {/* Contrast scrim + active trigger readout */}
        <div className="absolute inset-x-0 bottom-0 px-4 py-3 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent flex items-center justify-between pointer-events-none">
          <span
            className={`font-mono-tabular text-xs font-bold tracking-wide ${
              activeLanes.MOUTH
                ? 'text-emerald-400'
                : activeLanes.SMILE
                  ? 'text-rose-400'
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
            {telemetry.detected
              ? 'Face Locked'
              : cameraStatus === 'active'
                ? 'Searching...'
                : 'A · S · D · F Ready'}
          </span>
        </div>
      </div>

      {/* Live 4-Expression Confidence Bars */}
      <div className="p-4 space-y-3 border-t border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-medium text-slate-300">Live Expression Confidence</span>
          <span className="font-mono-tabular">
            Offset: {calibration.audioOffsetMs > 0 ? `+${calibration.audioOffsetMs}` : calibration.audioOffsetMs}ms
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Tilt Left */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.LEFT ? 'text-sky-400 font-semibold' : 'text-slate-400'}>
                Tilt L (A)
              </span>
              <span className="font-mono-tabular text-slate-300">{leftTiltPct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-[width] duration-75"
                style={{ width: `${activeLanes.LEFT ? Math.max(leftTiltPct, 85) : leftTiltPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, tiltThresholdPct)}%` }}
              />
            </div>
          </div>

          {/* Open Mouth */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.MOUTH ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                Mouth (S)
              </span>
              <span className="font-mono-tabular text-slate-300">{mouthPct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${activeLanes.MOUTH ? Math.max(mouthPct, 85) : mouthPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, mouthThresholdPct)}%` }}
              />
            </div>
          </div>

          {/* Big Smile */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.SMILE ? 'text-rose-400 font-semibold' : 'text-slate-400'}>
                Smile (D)
              </span>
              <span className="font-mono-tabular text-slate-300">{smilePct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-400 transition-[width] duration-75"
                style={{ width: `${activeLanes.SMILE ? Math.max(smilePct, 85) : smilePct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, smileThresholdPct)}%` }}
              />
            </div>
          </div>

          {/* Tilt Right */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={activeLanes.RIGHT ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                Tilt R (F)
              </span>
              <span className="font-mono-tabular text-slate-300">{rightTiltPct}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-[width] duration-75"
                style={{ width: `${activeLanes.RIGHT ? Math.max(rightTiltPct, 85) : rightTiltPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                style={{ left: `${Math.min(96, tiltThresholdPct)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
