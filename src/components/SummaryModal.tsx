import React from 'react';
import { Activity, RotateCcw, Trophy } from 'lucide-react';
import { computeAccuracy, computeGrade } from '../game/scoring';
import { Difficulty, GameStats, Lane, LaneBreakdown, LeaderboardEntry, TrackConfig } from '../types/game';

interface SummaryModalProps {
  stats: GameStats;
  track: TrackConfig;
  difficulty: Difficulty;
  durationSec: number;
  laneBreakdown: LaneBreakdown;
  leaderboard: LeaderboardEntry[];
  onOpenMemory: () => void;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
}

const LANE_SHORT: Record<Lane, { label: string; colorClass: string }> = {
  LEFT: { label: 'Tilt Left', colorClass: 'text-sky-400' },
  MOUTH: { label: 'Open Mouth', colorClass: 'text-emerald-400' },
  SMILE: { label: 'Big Smile', colorClass: 'text-rose-400' },
  RIGHT: { label: 'Tilt Right', colorClass: 'text-amber-400' },
};

export const SummaryModal: React.FC<SummaryModalProps> = ({
  stats,
  track,
  difficulty,
  durationSec,
  laneBreakdown,
  leaderboard,
  onOpenMemory,
  onPlayAgain,
  onBackToMenu,
}) => {
  const accuracy = computeAccuracy(stats);
  const grade = computeGrade(accuracy);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="round-summary-title"
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
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

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-slate-950/60 border border-slate-800 rounded-lg px-4 py-2.5">
          <span>
            Perfect: <strong className="font-mono-tabular text-emerald-400">{stats.perfect}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span>
            Great: <strong className="font-mono-tabular text-amber-300">{stats.great}</strong>
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

        {/* 4-Expression Facial Fitness Breakdown for this Round */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['LEFT', 'MOUTH', 'SMILE', 'RIGHT'] as Lane[]).map((lane) => {
            const metric = laneBreakdown[lane];
            const pct = metric.total > 0 ? Math.round((metric.hits / metric.total) * 100) : 100;
            return (
              <div
                key={lane}
                className="bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2 text-xs"
              >
                <div className="text-[11px] text-slate-400">{LANE_SHORT[lane].label}</div>
                <div className={`font-mono-tabular font-bold mt-0.5 ${LANE_SHORT[lane].colorClass}`}>
                  {metric.total > 0 ? `${pct}% (${metric.hits}/${metric.total})` : '—'}
                </div>
              </div>
            );
          })}
        </div>

        {leaderboard.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Session Top Scores</span>
            </div>
            <div className="border border-slate-800 rounded-lg divide-y divide-slate-800/80 max-h-36 overflow-y-auto">
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

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={onOpenMemory}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>View Face Fitness & Memory</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToMenu}
              className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              Change Music
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
    </div>
  );
};
