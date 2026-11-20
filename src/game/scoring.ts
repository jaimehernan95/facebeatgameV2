import { GameStats, Judgment } from '../types/game';

export const HIT_WINDOWS_SEC = {
  PERFECT: 0.06,
  GREAT: 0.115,
  GOOD: 0.2,
  MISS: 0.22,
} as const;

export const MIN_AUDIO_OFFSET_MS = -200;
export const MAX_AUDIO_OFFSET_MS = 200;

export function clampAudioOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.max(MIN_AUDIO_OFFSET_MS, Math.min(MAX_AUDIO_OFFSET_MS, Math.round(offsetMs)));
}

/**
 * Applies user audio-visual latency calibration (ms) to the raw AudioContext song clock.
 * Positive offsets (+ms) delay visual notes/judgments to align with Bluetooth audio lag.
 * Negative offsets (-ms) advance visual notes/judgments to compensate for webcam latency.
 */
export function applyAudioOffset(rawSongTimeSec: number, offsetMs: number): number {
  if (!Number.isFinite(rawSongTimeSec)) return 0;
  const clampedMs = clampAudioOffsetMs(offsetMs);
  return rawSongTimeSec - clampedMs / 1000;
}

export function judgeTiming(noteTimeSec: number, judgeTimeSec: number): Exclude<Judgment, 'MISS'> | null {
  const absDiff = Math.abs(noteTimeSec - judgeTimeSec);
  if (absDiff <= HIT_WINDOWS_SEC.PERFECT) return 'PERFECT';
  if (absDiff <= HIT_WINDOWS_SEC.GREAT) return 'GREAT';
  if (absDiff <= HIT_WINDOWS_SEC.GOOD) return 'GOOD';
  return null;
}

export function computeMultiplier(combo: number): number {
  if (!Number.isFinite(combo) || combo <= 0) return 1;
  return Math.min(4, 1 + Math.floor(combo / 8));
}

export function computeHitPoints(
  judgment: Exclude<Judgment, 'MISS'>,
  nextCombo: number,
  isBonus: boolean
): number {
  const base = judgment === 'PERFECT' ? 300 : judgment === 'GREAT' ? 200 : 100;
  const multiplier = computeMultiplier(nextCombo);
  return base * multiplier * (isBonus ? 2 : 1);
}

export function computeAccuracy(stats: Pick<GameStats, 'perfect' | 'great' | 'good' | 'miss'>): number {
  const total = stats.perfect + stats.great + stats.good + stats.miss;
  if (total <= 0) return 100;
  const weighted = stats.perfect + stats.great * 0.8 + stats.good * 0.55;
  return Math.round((weighted / total) * 100);
}

export function computeGrade(accuracy: number): string {
  if (accuracy >= 94) return 'S';
  if (accuracy >= 84) return 'A';
  if (accuracy >= 70) return 'B';
  return 'C';
}
