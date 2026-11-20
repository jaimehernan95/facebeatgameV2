import React, { useState } from 'react';
import { RotateCcw, Volume2, X } from 'lucide-react';
import { grooveEngine } from '../audio/grooveEngine';
import { CalibrationSettings } from '../types/game';

interface SettingsModalProps {
  calibration: CalibrationSettings;
  cameraActive: boolean;
  onChangeCalibration: (next: CalibrationSettings) => void;
  onRecenterHead: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  calibration,
  cameraActive,
  onChangeCalibration,
  onRecenterHead,
  onClose,
}) => {
  const [lastClickFlash, setLastClickFlash] = useState(false);

  const handleTestSyncClick = () => {
    grooveEngine.playCalibrationClick();
    setLastClickFlash(true);
    window.setTimeout(() => setLastClickFlash(false), 120);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="settings-modal-title" className="font-display text-xl font-bold text-white">
            Latency & Expression Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Audio-Visual Latency Calibration */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="audio-offset-slider" className="text-sm font-semibold text-white">
              Calibrate Offset (ms)
            </label>
            <span className="font-mono-tabular text-sm font-bold text-emerald-400">
              {calibration.audioOffsetMs > 0
                ? `+${calibration.audioOffsetMs} ms`
                : `${calibration.audioOffsetMs} ms`}
            </span>
          </div>

          <input
            id="audio-offset-slider"
            type="range"
            min={-200}
            max={200}
            step={5}
            value={calibration.audioOffsetMs}
            onChange={(e) =>
              onChangeCalibration({
                ...calibration,
                audioOffsetMs: Number(e.target.value),
              })
            }
            className="w-full accent-emerald-500 cursor-pointer"
          />

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>-200ms (Cam lag)</span>
            <span>0ms</span>
            <span>+200ms (Bluetooth)</span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestSyncClick}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  lastClickFlash
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Play Sync Click</span>
              </button>
              <button
                type="button"
                onClick={() => grooveEngine.playHitSound('SMILE', 'PERFECT', true, 10)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-700 transition-colors cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Preview Score Tone</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                onChangeCalibration({
                  ...calibration,
                  audioOffsetMs: 0,
                })
              }
              className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Reset 0ms
            </button>
          </div>
        </div>

        {/* Expression Thresholds */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300">Expression Trigger Thresholds</h3>
            {cameraActive && (
              <button
                type="button"
                onClick={onRecenterHead}
                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Recenter Head</span>
              </button>
            )}
          </div>

          <label className="block">
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Open Mouth (S)</span>
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
              <span>Big Smile (D)</span>
              <span className="font-mono-tabular text-rose-400">
                {Math.round(calibration.smileThreshold * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.22}
              max={0.78}
              step={0.02}
              value={calibration.smileThreshold}
              onChange={(e) =>
                onChangeCalibration({
                  ...calibration,
                  smileThreshold: parseFloat(e.target.value),
                })
              }
              className="w-full accent-rose-400 cursor-pointer"
            />
          </label>

          <label className="block">
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Head Tilt Sensitivity (A / F)</span>
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

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
