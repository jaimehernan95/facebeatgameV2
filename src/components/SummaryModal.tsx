import React from 'react';
import { RotateCcw, Trophy } from 'lucide-react';
import { Difficulty, GameStats, LeaderboardEntry, TrackConfig } from '../types/game';

interface SummaryModalProps {
  stats: GameStats;
  track: TrackConfig;
  difficulty: Difficulty;
  durationSec: number;
  leaderboard: LeaderboardEntry[];
  onPlayAgain: () => void;
  onBackToMenu: () => void;
}

export function computeGrade(accuracy: number): string {
  if (accuracy >= 94) return 'S';
  if (accuracy >= 84) return 'A';
  if (accuracy >= 70) return 'B';
  return 'C';
}

export const SummaryModal: React.FC<SummaryModalProps> = ({
  stats,
  track,
  difficulty,
  durationSec,
  leaderboard,
  onPlayAgain,
  onBackToMenu,
}) => {
  const totalJudged = stats.perfect + stats.good + stats.miss;
  const accuracy =
    totalJudged > 0
      ? Math.round(((stats.perfect + stats.good * 0.65) / totalJudged) * 100)
      : 0;
  const grade = computeGrade(accuracy);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-summary-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="text-xs text-slate-400">
              {track.title} · {difficulty} · {durationSec}s
            </div>
            <h2 id="round-summary-title" className="font-display text-2xl font-bold text-white mt-0.5">
              Round Complete
            </h2>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Rank</div>
            <div
              className={`font-display text-4xl font-extrabold leading-none ${
                grade === 'S'
                  ? 'text-amber-400'
                  : grade === 'A'
                    ? 'text-emerald-400'
                    : grade === 'B'
                      ? 'text-sky-400'
                      : 'text-slate-300'
              }`}
            >
              {grade}
            </div>
          </div>
        </div>

        {/* Core Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <div className="text-xs text-slate-400">Final Score</div>
            <div className="font-mono-tabular text-2xl font-bold text-white mt-0.5">
              {stats.score.toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <div className="text-xs text-slate-400">Accuracy</div>
            <div className="font-mono-tabular text-2xl font-bold text-emerald-400 mt-0.5">
              {accuracy}%
            </div>
          </div>
          <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
            <div className="text-xs text-slate-400">Max Combo</div>
            <div className="font-mono-tabular text-2xl font-bold text-amber-400 mt-0.5">
              {stats.maxCombo}x
            </div>
          </div>
        </div>

        {/* Hit Breakdown */}
        <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-2.5">
          <span>
            Perfect: <strong className="font-mono-tabular text-emerald-400">{stats.perfect}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span>
            Good: <strong className="font-mono-tabular text-sky-400">{stats.good}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span>
            Miss: <strong className="font-mono-tabular text-rose-400">{stats.miss}</strong>
          </span>
        </div>

        {/* Top Local Scores */}
        {leaderboard.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Session Top Scores</span>
            </div>
            <div className="border border-slate-800 rounded-lg divide-y divide-slate-800/80 max-h-40 overflow-y-auto">
              {leaderboard.slice(0, 5).map((entry, idx) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between px-3 py-2 text-xs bg-slate-950/40"
                >
                  <div className="flex items-center gap-2 text-slate-300 min-w-0">
                    <span className="font-mono-tabular text-slate-500 w-4">#{idx + 1}</span>
                    <span className="font-medium text-slate-100 truncate">{entry.trackTitle}</span>
                    <span className="text-slate-500 capitalize">· {entry.difficulty}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono-tabular shrink-0">
                    <span className="text-slate-400">{entry.accuracy}%</span>
                    <span className="font-bold text-white">{entry.score.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onBackToMenu}
            className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            Change Track
          </button>
          <button
            type="button"
            onClick={onPlayAgain}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Play Again</span>
          </button>
        </div>
      </div>
    </div>
  );
};
