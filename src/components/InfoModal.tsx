import React from 'react';
import { ShieldCheck, Trash2, Trophy, X } from 'lucide-react';
import { LeaderboardEntry } from '../types/game';

interface InfoModalProps {
  mode: 'how-to-play' | 'leaderboard';
  leaderboard: LeaderboardEntry[];
  onClearLeaderboard: () => void;
  onClose: () => void;
}

export const InfoModal: React.FC<InfoModalProps> = ({
  mode,
  leaderboard,
  onClearLeaderboard,
  onClose,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 id="info-modal-title" className="font-display text-xl font-bold text-white">
            {mode === 'how-to-play' ? 'How to Play FaceBeat Arcade' : 'Session Leaderboard'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'how-to-play' ? (
          <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
            <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>100% Local Webcam — Zero Video Uploaded. All face tracking runs on-device.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
                <div className="font-semibold text-sky-400">1. Tilt Head Left · Key A</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Tilt toward your left shoulder on sky-blue notes.
                </div>
              </div>
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
                <div className="font-semibold text-emerald-400">2. Open Mouth · Key S</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Open wide on emerald notes, then close briefly before the next beat.
                </div>
              </div>
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
                <div className="font-semibold text-rose-400">3. Big Smile · Key D</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Flash a smile on rose notes to keep your combo multiplier climbing.
                </div>
              </div>
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
                <div className="font-semibold text-amber-400">4. Tilt Head Right · Key F</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Tilt toward your right shoulder on amber notes.
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Playing on Bluetooth headphones? Open <strong className="text-slate-200">Settings</strong>{' '}
              to adjust <strong className="text-slate-200">Calibrate Offset (ms)</strong> from -200ms
              to +200ms. No webcam? <strong className="text-slate-200">A / S / D / F</strong> works
              automatically in Keyboard Arcade Mode.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {leaderboard.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <Trophy className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">No completed rounds yet.</p>
              </div>
            ) : (
              <>
                <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 max-h-72 overflow-y-auto">
                  {leaderboard.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between px-3.5 py-2.5 text-xs bg-slate-950/40"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">
                          #{idx + 1} · {entry.trackTitle}
                        </div>
                        <div className="text-slate-400 capitalize">
                          {entry.difficulty} · {entry.durationSec}s · Max {entry.maxCombo}x
                        </div>
                      </div>
                      <div className="text-right font-mono-tabular shrink-0 ml-4">
                        <div className="font-bold text-white">{entry.score.toLocaleString()}</div>
                        <div className="text-emerald-400">
                          {entry.grade} · {entry.accuracy}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onClearLeaderboard}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Scores</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
