import {
  CalibrationSettings,
  Difficulty,
  FavoriteTrackMemory,
  FitnessSessionMemory,
  Lane,
  MemoryAnalysisResult,
  MusicSource,
  UserMemoryProfile,
} from '../types/game';

export function toTrackKey(source: MusicSource, sourceId: string): string {
  const cleaned = `${source}_${sourceId}`
    .replace(/[^a-zA-Z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (cleaned.length > 0 && cleaned.length <= 120) {
    return cleaned;
  }
  let hash = 0;
  for (let i = 0; i < sourceId.length; i++) {
    hash = (hash * 31 + sourceId.charCodeAt(i)) | 0;
  }
  const suffix = Math.abs(hash).toString(36);
  const base = cleaned.slice(0, 100) || source;
  return `${base}_${suffix}`.slice(0, 128);
}

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function sanitizeString(value: string | undefined | null, maxLen: number, fallback = ''): string {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return fallback;
  return str.slice(0, maxLen);
}

export function normalizeVector(vec: number[], maxDims = 32): number[] {
  const sliced = vec
    .slice(0, maxDims)
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  const norm = Math.sqrt(sliced.reduce((sum, v) => sum + v * v, 0));
  if (norm <= 1e-8) return sliced;
  return sliced.map((v) => Number((v / norm).toFixed(5)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA <= 1e-8 || normB <= 1e-8) return 0;
  return Math.max(-1, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

/**
 * Deterministic 16-dim feature vector fallback when offline or before server Gemini embeddings run.
 */
export function buildDeterministicTrackVector(track: {
  source: MusicSource;
  bpm: number;
  title: string;
  author: string;
}): number[] {
  const vec = new Array<number>(16).fill(0);
  const sources: MusicSource[] = ['synth', 'youtube', 'tiktok', 'spotify', 'upload'];
  const srcIdx = Math.max(0, sources.indexOf(track.source));
  vec[srcIdx] = 1.0;

  const bpmNorm = clampNumber((track.bpm - 70) / 100, 0, 1, 0.45);
  vec[5] = bpmNorm;
  vec[6] = 1 - bpmNorm;

  const text = `${track.title} ${track.author}`.toLowerCase();
  for (let i = 0; i < text.length; i++) {
    const bucket = 7 + (text.charCodeAt(i) % 9);
    vec[bucket] += 0.25;
  }
  return normalizeVector(vec, 16);
}

export function normalizeGrade(grade: string): 'S+' | 'S' | 'A' | 'B' | 'C' {
  if (grade === 'S+' || grade === 'S' || grade === 'A' || grade === 'B' || grade === 'C') {
    return grade;
  }
  return 'C';
}

export function computeLaneAccuracyMap(profile: Pick<
  UserMemoryProfile,
  | 'laneLeftHits'
  | 'laneLeftTotal'
  | 'laneMouthHits'
  | 'laneMouthTotal'
  | 'laneSmileHits'
  | 'laneSmileTotal'
  | 'laneRightHits'
  | 'laneRightTotal'
>): Record<Lane, { hits: number; total: number; accuracy: number }> {
  const pct = (hits: number, total: number) => (total > 0 ? Math.round((hits / total) * 100) : 0);
  return {
    LEFT: {
      hits: profile.laneLeftHits,
      total: profile.laneLeftTotal,
      accuracy: pct(profile.laneLeftHits, profile.laneLeftTotal),
    },
    MOUTH: {
      hits: profile.laneMouthHits,
      total: profile.laneMouthTotal,
      accuracy: pct(profile.laneMouthHits, profile.laneMouthTotal),
    },
    SMILE: {
      hits: profile.laneSmileHits,
      total: profile.laneSmileTotal,
      accuracy: pct(profile.laneSmileHits, profile.laneSmileTotal),
    },
    RIGHT: {
      hits: profile.laneRightHits,
      total: profile.laneRightTotal,
      accuracy: pct(profile.laneRightHits, profile.laneRightTotal),
    },
  };
}

export function computeLocalMemoryAnalysis(
  profile: UserMemoryProfile,
  favorites: FavoriteTrackMemory[],
  sessions: FitnessSessionMemory[]
): MemoryAnalysisResult {
  const likedOrPlayed = favorites
    .slice()
    .sort((a, b) => (b.liked ? 1 : 0) - (a.liked ? 1 : 0) || b.playCount - a.playCount);

  const trackVectors: Record<string, number[]> = {};
  const centroid = new Array<number>(16).fill(0);
  let totalWeight = 0;

  for (const fav of likedOrPlayed) {
    const vec =
      fav.tasteVector.length > 0
        ? normalizeVector(fav.tasteVector, 16)
        : buildDeterministicTrackVector(fav);
    trackVectors[fav.trackKey] = vec;
    const weight = (fav.liked ? 2.5 : 1) + Math.min(3, fav.playCount * 0.4);
    for (let i = 0; i < vec.length && i < centroid.length; i++) {
      centroid[i] += vec[i] * weight;
    }
    totalWeight += weight;
  }

  const normalizedCentroid =
    totalWeight > 0 ? normalizeVector(centroid, 16) : buildDeterministicTrackVector({
      source: 'synth',
      bpm: 116,
      title: 'Neon Funk',
      author: 'FaceBeat',
    });

  const avgBpm =
    likedOrPlayed.length > 0
      ? Math.round(likedOrPlayed.reduce((acc, t) => acc + t.bpm, 0) / likedOrPlayed.length)
      : 116;

  const sourceCounts = new Map<MusicSource, number>();
  for (const f of likedOrPlayed) {
    sourceCounts.set(f.source, (sourceCounts.get(f.source) ?? 0) + (f.liked ? 2 : 1));
  }
  const topSource =
    Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'synth';

  const laneStats = computeLaneAccuracyMap(profile);
  const populatedLanes = (['LEFT', 'MOUTH', 'SMILE', 'RIGHT'] as Lane[])
    .map((lane) => ({ lane, ...laneStats[lane] }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.accuracy - a.accuracy);

  const laneFriendly: Record<Lane, string> = {
    LEFT: 'Tilt Left',
    MOUTH: 'Open Mouth',
    SMILE: 'Big Smile',
    RIGHT: 'Tilt Right',
  };

  let fitnessCoachTip =
    'Play a few rounds to unlock per-expression facial fitness coaching and score trend tracking.';
  if (populatedLanes.length >= 2) {
    const strongest = populatedLanes[0];
    const weakest = populatedLanes[populatedLanes.length - 1];
    const recent = sessions.slice(0, 3);
    const older = sessions.slice(3, 6);
    const recentAvg =
      recent.length > 0 ? Math.round(recent.reduce((s, r) => s + r.accuracy, 0) / recent.length) : 0;
    const olderAvg =
      older.length > 0 ? Math.round(older.reduce((s, r) => s + r.accuracy, 0) / older.length) : 0;
    const deltaText =
      older.length > 0
        ? recentAvg >= olderAvg
          ? ` Your accuracy improved +${recentAvg - olderAvg}% vs earlier rounds.`
          : ''
        : '';
    fitnessCoachTip = `${laneFriendly[strongest.lane]} is your sharpest move (${strongest.accuracy}%). Focus on ${laneFriendly[weakest.lane]} (${weakest.accuracy}%) — start the motion slightly ahead of the beat or lower its sensitivity by 2–4% in Settings.${deltaText}`;
  }

  const topTitles = likedOrPlayed
    .slice(0, 3)
    .map((t) => `"${t.title}"`)
    .join(', ');

  const tasteSummary =
    likedOrPlayed.length > 0
      ? `You gravitate toward ${avgBpm} BPM ${topSource.toUpperCase()} grooves${topTitles ? ` like ${topTitles}` : ''}.`
      : 'Save or play Synth, YouTube, TikTok, or Spotify tracks to build your personal music taste profile.';

  const tags = [
    `${avgBpm} BPM Sweet Spot`,
    topSource === 'youtube'
      ? 'YouTube Music'
      : topSource === 'tiktok'
        ? 'TikTok Viral'
        : topSource === 'spotify'
          ? 'Spotify Picks'
          : 'Arcade Synth',
    avgBpm >= 122 ? 'High-Energy Cardio' : avgBpm >= 105 ? 'Groove Flow' : 'Warmup Chill',
  ];

  const recommendedQueries = [
    {
      platform: 'youtube' as const,
      label: `${avgBpm} BPM Dance Pop Workout`,
      bpmHint: avgBpm,
      reason: 'Matches your preferred tempo and rhythm flow.',
    },
    {
      platform: 'tiktok' as const,
      label: avgBpm >= 120 ? 'Upbeat TikTok Viral Dance Mix' : 'Chill TikTok Groove Loop',
      bpmHint: Math.min(145, avgBpm + 4),
      reason: 'Short high-energy loops great for 45s facial fitness rounds.',
    },
    {
      platform: 'synth' as const,
      label: avgBpm >= 120 ? 'Arcade Pulse (128 BPM)' : 'Neon Funk (116 BPM)',
      bpmHint: avgBpm >= 120 ? 128 : 116,
      reason: 'Zero-latency built-in synth aligned to your speed.',
    },
  ];

  return {
    source: 'local',
    tasteSummary,
    fitnessCoachTip,
    tasteTags: tags,
    tasteCentroid: normalizedCentroid,
    trackVectors,
    recommendedQueries,
  };
}

export function buildDefaultUserProfile(
  uid: string,
  displayName: string,
  calibration: CalibrationSettings,
  difficulty: Difficulty,
  durationSec: number
): UserMemoryProfile {
  return {
    uid,
    displayName: sanitizeString(displayName, 120, 'Player'),
    mouthThreshold: clampNumber(calibration.mouthThreshold, 0.05, 0.95, 0.3),
    smileThreshold: clampNumber(calibration.smileThreshold, 0.05, 0.95, 0.42),
    tiltThreshold: clampNumber(calibration.tiltThreshold, 0.05, 0.95, 0.22),
    audioOffsetMs: Math.round(clampNumber(calibration.audioOffsetMs, -200, 200, 0)),
    preferredDifficulty: difficulty,
    preferredDurationSec: Math.round(clampNumber(durationSec, 15, 180, 45)),
    totalSessions: 0,
    bestScore: 0,
    bestCombo: 0,
    laneLeftHits: 0,
    laneLeftTotal: 0,
    laneMouthHits: 0,
    laneMouthTotal: 0,
    laneSmileHits: 0,
    laneSmileTotal: 0,
    laneRightHits: 0,
    laneRightTotal: 0,
    tasteSummary: 'Play and save tracks from Synth, YouTube, TikTok, or Spotify to train your music memory.',
    fitnessCoachTip: 'Complete a round to track per-expression accuracy and facial fitness progress.',
    tasteTags: [],
    tasteCentroid: [],
  };
}
