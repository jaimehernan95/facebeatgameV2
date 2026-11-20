import React from 'react';
import {
  Activity,
  Cloud,
  CloudOff,
  Heart,
  LogIn,
  LogOut,
  Play,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { computeLaneAccuracyMap, cosineSimilarity } from '../memory/memoryMath';
import {
  FavoriteTrackMemory,
  FitnessSessionMemory,
  Lane,
  MemoryAnalysisResult,
  UserMemoryProfile,
} from '../types/game';

interface MemoryCoachModalProps {
  user: { uid: string; displayName: string | null; email: string | null } | null;
  authLoading: boolean;
  authError: string | null;
  profile: UserMemoryProfile;
  favorites: FavoriteTrackMemory[];
  sessions: FitnessSessionMemory[];
  analysis: MemoryAnalysisResult;
  isAnalyzing: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefreshAnalysis: () => void;
  onLoadFavorite: (track: FavoriteTrackMemory) => void;
  onToggleFavoriteLike: (track: FavoriteTrackMemory) => void;
  onDeleteFavorite: (trackKey: string) => void;
  onClose: () => void;
}

const LANE_LABELS: Record<Lane, { title: string; role: string; colorClass: string; barClass: string }> = {
  LEFT: {
    title: 'Tilt Left',
    role: 'Left Neck Mobility',
    colorClass: 'text-sky-400',
    barClass: 'bg-sky-400',
  },
  MOUTH: {
    title: 'Open Mouth',
    role: 'Jaw & Articulation',
    colorClass: 'text-emerald-400',
    barClass: 'bg-emerald-400',
  },
  SMILE: {
    title: 'Big Smile',
    role: 'Cheek Lift Tone',
    colorClass: 'text-rose-400',
    barClass: 'bg-rose-400',
  },
  RIGHT: {
    title: 'Tilt Right',
    role: 'Right Neck Mobility',
    colorClass: 'text-amber-400',
    barClass: 'bg-amber-400',
  },
};

export const MemoryCoachModal: React.FC<MemoryCoachModalProps> = ({
  user,
  authLoading,
  authError,
  profile,
  favorites,
  sessions,
  analysis,
  isAnalyzing,
  onSignIn,
  onSignOut,
  onRefreshAnalysis,
  onLoadFavorite,
  onToggleFavoriteLike,
  onDeleteFavorite,
  onClose,
}) => {
  const laneStats = computeLaneAccuracyMap(profile);
  const recentChronological = sessions.slice(0, 10).reverse();
  const maxTrendScore = Math.max(1000, ...recentChronological.map((s) => s.score));

  const sortedFavorites = favorites
    .slice()
    .sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0) || b.updatedAtMs - a.updatedAtMs);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-coach-title"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <h2 id="memory-coach-title" className="font-display text-xl font-bold text-white">
              Player Memory & Facial Fitness
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Saved calibration, YouTube/TikTok/Spotify taste memory, and expression improvement trends
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close memory dashboard"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Cloud Sync Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/75 border border-slate-800 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {user ? (
                <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <CloudOff className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">
                  {user
                    ? `Cloud Synced · ${user.displayName || user.email || 'Google Account'}`
                    : 'Local Browser Memory Active'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {user
                    ? 'Calibration, favorite YouTube/TikTok tracks, and facial fitness history sync across devices.'
                    : 'Sign in with Google to save your progress & music taste permanently across devices.'}
                </div>
                {authError && <div className="text-[11px] text-rose-400 mt-0.5">{authError}</div>}
              </div>
            </div>

            {user ? (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={authLoading}
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-bold cursor-pointer shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{authLoading ? 'Connecting...' : 'Sign In with Google'}</span>
              </button>
            )}
          </div>

          {/* Summary KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Total Rounds</div>
              <div className="font-mono-tabular text-xl font-bold text-white mt-0.5">
                {profile.totalSessions}
              </div>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Best Score</div>
              <div className="font-mono-tabular text-xl font-bold text-emerald-400 mt-0.5">
                {profile.bestScore.toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Best Combo</div>
              <div className="font-mono-tabular text-xl font-bold text-amber-400 mt-0.5">
                {profile.bestCombo}x
              </div>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] text-slate-400">Saved Tracks</div>
              <div className="font-mono-tabular text-xl font-bold text-sky-400 mt-0.5">
                {favorites.length}
              </div>
            </div>
          </div>

          {/* Facial Fitness & Improvement */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>4-Expression Facial Fitness Accuracy</span>
              </div>

              <div className="space-y-2.5">
                {(['LEFT', 'MOUTH', 'SMILE', 'RIGHT'] as Lane[]).map((lane) => {
                  const meta = LANE_LABELS[lane];
                  const stat = laneStats[lane];
                  return (
                    <div key={lane} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-200 font-medium">
                          {meta.title}{' '}
                          <span className="text-[11px] text-slate-500">· {meta.role}</span>
                        </span>
                        <span className={`font-mono-tabular font-bold ${meta.colorClass}`}>
                          {stat.total > 0 ? `${stat.accuracy}% (${stat.hits}/${stat.total})` : '—'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${meta.barClass} transition-all duration-300`}
                          style={{ width: `${stat.total > 0 ? stat.accuracy : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <TrendingUp className="w-4 h-4 text-sky-400" />
                  <span>Recent Score Progression</span>
                </div>
                <span className="text-[11px] text-slate-400">Last {recentChronological.length} rounds</span>
              </div>

              {recentChronological.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-xs text-slate-500 text-center">
                  Complete your first round to see your score progression chart.
                </div>
              ) : (
                <div className="h-32 flex items-end gap-2 pt-2">
                  {recentChronological.map((s) => {
                    const heightPct = Math.max(12, Math.round((s.score / maxTrendScore) * 100));
                    return (
                      <div key={s.id} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <span className="font-mono-tabular text-[10px] text-slate-400">
                          {s.accuracy}%
                        </span>
                        <div className="w-full h-20 bg-slate-900 rounded flex items-end overflow-hidden">
                          <div
                            className="w-full bg-emerald-500/80 rounded-t transition-all"
                            style={{ height: `${heightPct}%` }}
                            title={`${s.trackTitle}: ${s.score.toLocaleString()} (${s.accuracy}%)`}
                          />
                        </div>
                        <span className="font-mono-tabular text-[10px] font-bold text-slate-300">
                          {s.grade}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* AI Music Understanding & Facial Fitness Coach */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>AI Music Memory & Face Fitness Coach</span>
                <span className="text-[10px] font-mono-tabular px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {analysis.source === 'gemini' ? 'Gemini Embeddings + Coach' : 'Local Taste Vector'}
                </span>
              </div>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={onRefreshAnalysis}
                className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-xs font-semibold text-emerald-300 cursor-pointer"
              >
                {isAnalyzing ? 'Analyzing...' : 'Refresh Insights'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-1.5">
                <div className="font-semibold text-slate-200">Music Taste Profile</div>
                <p className="text-slate-300 leading-relaxed">
                  {profile.tasteSummary || analysis.tasteSummary}
                </p>
                {(profile.tasteTags.length > 0 ? profile.tasteTags : analysis.tasteTags).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(profile.tasteTags.length > 0 ? profile.tasteTags : analysis.tasteTags).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 space-y-1.5">
                <div className="font-semibold text-slate-200">Facial Fitness Recommendation</div>
                <p className="text-slate-300 leading-relaxed">
                  {profile.fitnessCoachTip || analysis.fitnessCoachTip}
                </p>
              </div>
            </div>

            {analysis.recommendedQueries.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-semibold text-slate-400">
                  Recommended Next Vibes for You
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {analysis.recommendedQueries.map((rec, idx) => (
                    <div
                      key={`${rec.platform}-${idx}`}
                      className="bg-slate-900/70 border border-slate-800 rounded-lg p-2.5 text-xs space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="uppercase text-[10px] font-bold text-amber-300">
                          {rec.platform}
                        </span>
                        <span className="font-mono-tabular text-[10px] text-slate-400">
                          {rec.bpmHint} BPM
                        </span>
                      </div>
                      <div className="font-semibold text-slate-100 truncate">{rec.label}</div>
                      <div className="text-[11px] text-slate-400 leading-snug">{rec.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Remembered Music Library */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>Remembered YouTube, TikTok, Spotify & Synth Tracks</span>
              <span className="text-[11px] text-slate-400">{sortedFavorites.length} saved</span>
            </div>

            {sortedFavorites.length === 0 ? (
              <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-4 text-xs text-slate-400 text-center">
                Any Synth, YouTube, YouTube Music, TikTok, or Spotify track you favorite or play is
                automatically remembered here.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-lg divide-y divide-slate-800 bg-slate-950/50 max-h-60 overflow-y-auto">
                {sortedFavorites.map((track) => {
                  const centroid =
                    profile.tasteCentroid.length > 0 ? profile.tasteCentroid : analysis.tasteCentroid;
                  const matchPct =
                    centroid.length > 0 && track.tasteVector.length > 0
                      ? Math.max(50, Math.round((cosineSimilarity(centroid, track.tasteVector) + 1) * 50))
                      : null;
                  return (
                    <div
                      key={track.trackKey}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {track.thumbnail ? (
                          <img
                            src={track.thumbnail}
                            alt={track.title}
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded bg-slate-800 flex items-center justify-center text-[10px] font-bold uppercase text-slate-300 shrink-0">
                            {track.source.slice(0, 2)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-100 truncate">{track.title}</div>
                          <div className="text-[11px] text-slate-400 truncate">
                            <span className="uppercase text-emerald-400 font-semibold">
                              {track.source}
                            </span>{' '}
                            · {track.author} · {track.bpm} BPM
                            {track.playCount > 0 ? ` · ${track.playCount} plays` : ''}
                            {track.bestScore > 0 ? ` · Best ${track.bestScore.toLocaleString()}` : ''}
                            {matchPct !== null ? ` · ${matchPct}% taste match` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteLike(track)}
                          aria-label={track.liked ? 'Unlike track' : 'Like track'}
                          className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                            track.liked
                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-rose-300'
                          }`}
                        >
                          <Heart className={`w-3.5 h-3.5 ${track.liked ? 'fill-rose-400' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onLoadFavorite(track);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          <span>Load</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFavorite(track.trackKey)}
                          aria-label="Remove saved track"
                          className="p-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
