export type Lane = 'LEFT' | 'MOUTH' | 'SMILE' | 'RIGHT';

export type Difficulty = 'chill' | 'groove' | 'turbo';

export type TrackId = 'neon-funk' | 'arcade-pulse' | 'sunset-lofi';

export type MusicSource = 'synth' | 'youtube' | 'tiktok' | 'spotify' | 'upload';

export type GameState = 'TITLE_MENU' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export type Judgment = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export interface ExternalMediaTrack {
  provider: 'youtube' | 'tiktok';
  id: string;
  url: string;
  title: string;
  author: string;
  thumbnail: string;
  bpm: number;
}

export interface TrackConfig {
  id: TrackId;
  title: string;
  subtitle: string;
  bpm: number;
  accentColor: string;
  rootMidi: number;
  scaleIntervals: number[];
  progression: number[][];
  bassPattern: (number | null)[];
  leadPattern: (number | null)[];
  swing: number;
}

export interface SpotifyTrackOption {
  id: string;
  name: string;
  artist: string;
  albumArt: string;
  uri: string;
  durationSec: number;
  previewUrl: string | null;
  bpm: number;
}

export interface UploadedAudioTrack {
  id: string;
  name: string;
  durationSec: number;
  bpm: number;
  buffer: AudioBuffer;
  beatTimes: number[];
}

export interface ActiveMusicMeta {
  source: MusicSource;
  title: string;
  subtitle: string;
  bpm: number;
  accentColor: string;
}

export interface BeatNote {
  id: string;
  lane: Lane;
  time: number; // seconds from song start
  isBonus: boolean;
  hit: boolean;
  missed: boolean;
}

export interface HitFeedback {
  id: number;
  lane: Lane;
  judgment: Judgment;
  points: number;
  createdAt: number;
  isBonus: boolean;
}

export interface GameStats {
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  totalNotes: number;
}

export interface FacePoint {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
}

export interface FaceTelemetry {
  detected: boolean;
  mouthOpen: number; // 0..1 smoothed
  headTilt: number; // -1 (left) to +1 (right) smoothed
  smile: number; // 0..1 smoothed
  mouthPoints: FacePoint[];
  leftEye: FacePoint | null;
  rightEye: FacePoint | null;
  noseTip: FacePoint | null;
}

export interface CalibrationSettings {
  mouthThreshold: number; // 0.14 .. 0.62
  smileThreshold: number; // 0.25 .. 0.80
  tiltThreshold: number; // 0.12 .. 0.44
  audioOffsetMs: number; // -200 .. +200
}

export interface LeaderboardEntry {
  id: string;
  trackTitle: string;
  difficulty: Difficulty;
  durationSec: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: string;
  createdAt: number;
}

export interface LaneMetric {
  hits: number;
  total: number;
}

export type LaneBreakdown = Record<Lane, LaneMetric>;

export interface PeakExpressionTelemetry {
  mouth: number;
  smile: number;
  tilt: number;
}

export interface FavoriteTrackMemory {
  trackKey: string;
  source: MusicSource;
  sourceId: string;
  title: string;
  author: string;
  url: string;
  thumbnail: string;
  bpm: number;
  liked: boolean;
  playCount: number;
  bestScore: number;
  tasteVector: number[];
  updatedAtMs: number;
}

export interface FitnessSessionMemory {
  id: string;
  trackKey: string;
  trackTitle: string;
  source: MusicSource;
  bpm: number;
  difficulty: Difficulty;
  durationSec: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: 'S+' | 'S' | 'A' | 'B' | 'C';
  leftHits: number;
  leftTotal: number;
  mouthHits: number;
  mouthTotal: number;
  smileHits: number;
  smileTotal: number;
  rightHits: number;
  rightTotal: number;
  peakMouth: number;
  peakSmile: number;
  peakTilt: number;
  createdAtMs: number;
}

export interface UserMemoryProfile {
  uid: string;
  displayName: string;
  mouthThreshold: number;
  smileThreshold: number;
  tiltThreshold: number;
  audioOffsetMs: number;
  preferredDifficulty: Difficulty;
  preferredDurationSec: number;
  totalSessions: number;
  bestScore: number;
  bestCombo: number;
  laneLeftHits: number;
  laneLeftTotal: number;
  laneMouthHits: number;
  laneMouthTotal: number;
  laneSmileHits: number;
  laneSmileTotal: number;
  laneRightHits: number;
  laneRightTotal: number;
  tasteSummary: string;
  fitnessCoachTip: string;
  tasteTags: string[];
  tasteCentroid: number[];
}

export interface MemoryAnalysisResult {
  source: 'gemini' | 'local';
  tasteSummary: string;
  fitnessCoachTip: string;
  tasteTags: string[];
  tasteCentroid: number[];
  trackVectors: Record<string, number[]>;
  recommendedQueries: Array<{
    platform: 'youtube' | 'tiktok' | 'synth';
    label: string;
    bpmHint: number;
    reason: string;
  }>;
}

