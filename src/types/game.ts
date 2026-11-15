export type Lane = 'LEFT' | 'MOUTH' | 'RIGHT';

export type Difficulty = 'chill' | 'groove' | 'turbo';

export type TrackId = 'neon-funk' | 'arcade-pulse' | 'sunset-lofi';

export type MusicSource = 'synth' | 'spotify' | 'upload';

export type GameState = 'TITLE_MENU' | 'COUNTDOWN' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export type Judgment = 'PERFECT' | 'GOOD' | 'MISS';

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
  smile: number; // 0..1
  mouthPoints: FacePoint[];
  leftEye: FacePoint | null;
  rightEye: FacePoint | null;
  noseTip: FacePoint | null;
}

export interface CalibrationSettings {
  mouthThreshold: number; // 0.15 .. 0.65
  tiltThreshold: number; // 0.12 .. 0.45
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
