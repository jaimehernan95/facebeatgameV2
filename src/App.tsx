import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { Activity, Cloud, LogIn } from 'lucide-react';
import { grooveEngine } from './audio/grooveEngine';
import { spotifySdk } from './audio/spotifySdk';
import { youtubeSdk } from './audio/youtubeSdk';
import { CameraStage } from './components/CameraStage';
import { InfoModal } from './components/InfoModal';
import { MemoryCoachModal } from './components/MemoryCoachModal';
import { HitParticle, LANE_META, LANE_ORDER, RhythmHighway } from './components/RhythmHighway';
import { SettingsModal } from './components/SettingsModal';
import { SummaryModal } from './components/SummaryModal';
import { auth, googleProvider } from './firebase';
import { generateBeatmap, generateBeatmapFromBpm, getTrackById, TRACKS } from './game/beatmap';
import {
  applyAudioOffset,
  computeAccuracy,
  computeGrade,
  computeHitPoints,
  HIT_WINDOWS_SEC,
  judgeTiming,
} from './game/scoring';
import {
  buildDeterministicTrackVector,
  computeLocalMemoryAnalysis,
  normalizeGrade,
  toTrackKey,
} from './memory/memoryMath';
import {
  deleteFavoriteTrackFromCloud,
  ensureCloudUserProfile,
  loadLocalFavorites,
  loadLocalProfile,
  loadLocalSessions,
  recordSessionToCloud,
  saveCalibrationToCloud,
  saveLocalFavorites,
  saveLocalProfile,
  saveLocalSessions,
  subscribeUserMemory,
  updateAiAnalysisInCloud,
  upsertFavoriteTrackInCloud,
} from './memory/memoryStore';
import {
  ActiveMusicMeta,
  BeatNote,
  CalibrationSettings,
  Difficulty,
  ExternalMediaTrack,
  FaceTelemetry,
  FavoriteTrackMemory,
  FitnessSessionMemory,
  GameState,
  GameStats,
  HitFeedback,
  Lane,
  LaneBreakdown,
  LeaderboardEntry,
  MemoryAnalysisResult,
  MusicSource,
  PeakExpressionTelemetry,
  SpotifyTrackOption,
  TrackConfig,
  TrackId,
  UploadedAudioTrack,
  UserMemoryProfile,
} from './types/game';
import { FaceTracker } from './vision/faceTracker';

const LEADERBOARD_KEY = 'facebeat_arcade_leaderboard_v1';
const SETTINGS_KEY = 'facebeat_arcade_settings_v1';

const EMPTY_LANE_BREAKDOWN = (): LaneBreakdown => ({
  LEFT: { hits: 0, total: 0 },
  MOUTH: { hits: 0, total: 0 },
  SMILE: { hits: 0, total: 0 },
  RIGHT: { hits: 0, total: 0 },
});

const DEFAULT_CALIBRATION: CalibrationSettings = {
  mouthThreshold: 0.3,
  smileThreshold: 0.42,
  tiltThreshold: 0.22,
  audioOffsetMs: 0,
};

const INITIAL_TELEMETRY: FaceTelemetry = {
  detected: false,
  mouthOpen: 0,
  headTilt: 0,
  smile: 0,
  mouthPoints: [],
  leftEye: null,
  rightEye: null,
  noseTip: null,
};

const INITIAL_STATS: GameStats = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfect: 0,
  great: 0,
  good: 0,
  miss: 0,
  totalNotes: 0,
};

function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSettings(): CalibrationSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_CALIBRATION;
    const parsed = JSON.parse(raw) as Partial<CalibrationSettings>;
    return {
      mouthThreshold:
        typeof parsed.mouthThreshold === 'number' ? parsed.mouthThreshold : DEFAULT_CALIBRATION.mouthThreshold,
      smileThreshold:
        typeof parsed.smileThreshold === 'number' ? parsed.smileThreshold : DEFAULT_CALIBRATION.smileThreshold,
      tiltThreshold:
        typeof parsed.tiltThreshold === 'number' ? parsed.tiltThreshold : DEFAULT_CALIBRATION.tiltThreshold,
      audioOffsetMs:
        typeof parsed.audioOffsetMs === 'number' ? parsed.audioOffsetMs : DEFAULT_CALIBRATION.audioOffsetMs,
    };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [musicSource, setMusicSource] = useState<MusicSource>('synth');
  const [trackId, setTrackId] = useState<TrackId>('neon-funk');
  const [selectedYoutubeTrack, setSelectedYoutubeTrack] = useState<ExternalMediaTrack | null>(null);
  const [selectedTiktokTrack, setSelectedTiktokTrack] = useState<ExternalMediaTrack | null>(null);
  const [selectedSpotifyTrack, setSelectedSpotifyTrack] = useState<SpotifyTrackOption | null>(null);
  const [uploadedTrack, setUploadedTrack] = useState<UploadedAudioTrack | null>(null);
  const [customBpm, setCustomBpm] = useState<number>(116);
  const [showSpotifyEmbed, setShowSpotifyEmbed] = useState<boolean>(false);
  const [youtubeFallbackEmbedId, setYoutubeFallbackEmbedId] = useState<string | null>(null);
  const youtubeMountRef = useRef<HTMLDivElement | null>(null);

  const [difficulty, setDifficulty] = useState<Difficulty>('chill');
  const [durationSec, setDurationSec] = useState<number>(45);
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [songTime, setSongTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showMemoryModal, setShowMemoryModal] = useState<boolean>(false);
  const [infoModal, setInfoModal] = useState<'how-to-play' | 'leaderboard' | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => loadLeaderboard());

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<FavoriteTrackMemory[]>(() => loadLocalFavorites());
  const [sessions, setSessions] = useState<FitnessSessionMemory[]>(() => loadLocalSessions());
  const [laneBreakdown, setLaneBreakdown] = useState<LaneBreakdown>(EMPTY_LANE_BREAKDOWN);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);

  const [cameraStatus, setCameraStatus] = useState<
    'idle' | 'starting' | 'active' | 'denied' | 'unavailable'
  >('idle');
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [telemetry, setTelemetry] = useState<FaceTelemetry>(INITIAL_TELEMETRY);
  const [calibration, setCalibration] = useState<CalibrationSettings>(() => loadSettings());
  const [memoryProfile, setMemoryProfile] = useState<UserMemoryProfile>(() =>
    loadLocalProfile(loadSettings(), 'chill', 45)
  );
  const [memoryAnalysis, setMemoryAnalysis] = useState<MemoryAnalysisResult>(() =>
    computeLocalMemoryAnalysis(
      loadLocalProfile(loadSettings(), 'chill', 45),
      loadLocalFavorites(),
      loadLocalSessions()
    )
  );

  const [activeLanes, setActiveLanes] = useState<Record<Lane, boolean>>({
    LEFT: false,
    MOUTH: false,
    SMILE: false,
    RIGHT: false,
  });

  const synthTrack = getTrackById(trackId);

  const activeMusic: ActiveMusicMeta = useMemo(() => {
    if (musicSource === 'youtube' && selectedYoutubeTrack) {
      return {
        source: 'youtube',
        title: selectedYoutubeTrack.title,
        subtitle: `${selectedYoutubeTrack.author} · YouTube`,
        bpm: customBpm,
        accentColor: '#EF4444',
      };
    }
    if (musicSource === 'tiktok' && selectedTiktokTrack) {
      return {
        source: 'tiktok',
        title: selectedTiktokTrack.title,
        subtitle: `${selectedTiktokTrack.author} · TikTok`,
        bpm: customBpm,
        accentColor: '#FB7185',
      };
    }
    if (musicSource === 'spotify' && selectedSpotifyTrack) {
      return {
        source: 'spotify',
        title: selectedSpotifyTrack.name,
        subtitle: `${selectedSpotifyTrack.artist} · Spotify`,
        bpm: customBpm,
        accentColor: '#1DB954',
      };
    }
    if (musicSource === 'upload' && uploadedTrack) {
      return {
        source: 'upload',
        title: uploadedTrack.name,
        subtitle: 'Uploaded Audio Track',
        bpm: customBpm,
        accentColor: '#10B981',
      };
    }
    return {
      source: 'synth',
      title: synthTrack.title,
      subtitle: synthTrack.subtitle,
      bpm: synthTrack.bpm,
      accentColor: synthTrack.accentColor,
    };
  }, [
    musicSource,
    selectedYoutubeTrack,
    selectedTiktokTrack,
    selectedSpotifyTrack,
    uploadedTrack,
    customBpm,
    synthTrack,
  ]);

  const summaryTrackConfig: TrackConfig = useMemo(
    () => ({
      ...synthTrack,
      title: activeMusic.title,
      subtitle: activeMusic.subtitle,
      bpm: activeMusic.bpm,
      accentColor: activeMusic.accentColor,
    }),
    [synthTrack, activeMusic]
  );

  const notesRef = useRef<BeatNote[]>([]);
  const feedbacksRef = useRef<HitFeedback[]>([]);
  const particlesRef = useRef<HitParticle[]>([]);
  const shakeUntilRef = useRef<number>(0);
  const feedbackIdRef = useRef<number>(1);
  const statsRef = useRef<GameStats>(INITIAL_STATS);
  const gameStateRef = useRef<GameState>(gameState);
  gameStateRef.current = gameState;

  const calibrationRef = useRef<CalibrationSettings>(calibration);
  calibrationRef.current = calibration;

  const activeMusicRef = useRef(activeMusic);
  activeMusicRef.current = activeMusic;

  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  const durationRef = useRef(durationSec);
  durationRef.current = durationSec;

  const cameraActiveLanesRef = useRef<Record<Lane, boolean>>({
    LEFT: false,
    MOUTH: false,
    SMILE: false,
    RIGHT: false,
  });
  const keyboardLanesRef = useRef<Record<Lane, boolean>>({
    LEFT: false,
    MOUTH: false,
    SMILE: false,
    RIGHT: false,
  });
  const manualPulseUntilRef = useRef<Record<Lane, number>>({
    LEFT: 0,
    MOUTH: 0,
    SMILE: 0,
    RIGHT: 0,
  });

  const laneBreakdownRef = useRef<LaneBreakdown>(EMPTY_LANE_BREAKDOWN());
  const peakTelemetryRef = useRef<PeakExpressionTelemetry>({ mouth: 0, smile: 0, tilt: 0 });
  const countdownTimerRef = useRef<number | null>(null);

  const authUserRef = useRef<User | null>(authUser);
  authUserRef.current = authUser;
  const memoryProfileRef = useRef<UserMemoryProfile>(memoryProfile);
  memoryProfileRef.current = memoryProfile;
  const favoritesRef = useRef<FavoriteTrackMemory[]>(favorites);
  favoritesRef.current = favorites;
  const sessionsRef = useRef<FitnessSessionMemory[]>(sessions);
  sessionsRef.current = sessions;

  const currentTrackDescriptor = useMemo(() => {
    if (musicSource === 'youtube' && selectedYoutubeTrack) {
      return {
        source: 'youtube' as const,
        sourceId: selectedYoutubeTrack.id,
        title: selectedYoutubeTrack.title,
        author: selectedYoutubeTrack.author,
        url: selectedYoutubeTrack.url,
        thumbnail: selectedYoutubeTrack.thumbnail,
        bpm: customBpm,
      };
    }
    if (musicSource === 'tiktok' && selectedTiktokTrack) {
      return {
        source: 'tiktok' as const,
        sourceId: selectedTiktokTrack.id,
        title: selectedTiktokTrack.title,
        author: selectedTiktokTrack.author,
        url: selectedTiktokTrack.url,
        thumbnail: selectedTiktokTrack.thumbnail,
        bpm: customBpm,
      };
    }
    if (musicSource === 'spotify' && selectedSpotifyTrack) {
      return {
        source: 'spotify' as const,
        sourceId: selectedSpotifyTrack.id,
        title: selectedSpotifyTrack.name,
        author: selectedSpotifyTrack.artist,
        url: `https://open.spotify.com/track/${selectedSpotifyTrack.id}`,
        thumbnail: selectedSpotifyTrack.albumArt,
        bpm: customBpm,
      };
    }
    if (musicSource === 'upload' && uploadedTrack) {
      return {
        source: 'upload' as const,
        sourceId: uploadedTrack.id,
        title: uploadedTrack.name,
        author: 'Local Audio',
        url: '',
        thumbnail: '',
        bpm: customBpm,
      };
    }
    return {
      source: 'synth' as const,
      sourceId: synthTrack.id,
      title: synthTrack.title,
      author: synthTrack.subtitle,
      url: '',
      thumbnail: '',
      bpm: synthTrack.bpm,
    };
  }, [
    musicSource,
    selectedYoutubeTrack,
    selectedTiktokTrack,
    selectedSpotifyTrack,
    uploadedTrack,
    customBpm,
    synthTrack,
  ]);
  const currentTrackDescRef = useRef(currentTrackDescriptor);
  currentTrackDescRef.current = currentTrackDescriptor;

  const currentTrackLiked = useMemo(() => {
    const key = toTrackKey(currentTrackDescriptor.source, currentTrackDescriptor.sourceId);
    return favorites.some((f) => f.trackKey === key && f.liked);
  }, [favorites, currentTrackDescriptor]);

  const refreshMemoryAnalysis = useCallback(
    async (
      targetProfile: UserMemoryProfile,
      targetFavorites: FavoriteTrackMemory[],
      targetSessions: FitnessSessionMemory[],
      cloudUid?: string
    ) => {
      setIsAnalyzing(true);
      try {
        const res = await fetch('/api/memory/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: targetProfile,
            favorites: targetFavorites.slice(0, 20),
            sessions: targetSessions.slice(0, 20),
          }),
        });
        const analysis = res.ok
          ? ((await res.json()) as MemoryAnalysisResult)
          : computeLocalMemoryAnalysis(targetProfile, targetFavorites, targetSessions);

        setMemoryAnalysis(analysis);
        const updatedProfile: UserMemoryProfile = {
          ...targetProfile,
          tasteSummary: analysis.tasteSummary,
          fitnessCoachTip: analysis.fitnessCoachTip,
          tasteTags: analysis.tasteTags,
          tasteCentroid: analysis.tasteCentroid,
        };
        setMemoryProfile(updatedProfile);
        saveLocalProfile(updatedProfile);

        if (cloudUid) {
          void updateAiAnalysisInCloud(
            cloudUid,
            analysis.tasteSummary,
            analysis.fitnessCoachTip,
            analysis.tasteTags,
            analysis.tasteCentroid
          );
        }
      } catch {
        const fallback = computeLocalMemoryAnalysis(targetProfile, targetFavorites, targetSessions);
        setMemoryAnalysis(fallback);
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  const updateCalibration = useCallback((next: CalibrationSettings) => {
    setCalibration(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
    const nextProfile: UserMemoryProfile = {
      ...memoryProfileRef.current,
      mouthThreshold: next.mouthThreshold,
      smileThreshold: next.smileThreshold,
      tiltThreshold: next.tiltThreshold,
      audioOffsetMs: next.audioOffsetMs,
    };
    setMemoryProfile(nextProfile);
    saveLocalProfile(nextProfile);
    if (authUserRef.current) {
      void saveCalibrationToCloud(
        authUserRef.current.uid,
        authUserRef.current.displayName || 'Player',
        next,
        difficultyRef.current,
        durationRef.current
      );
    }
  }, []);

  const syncActiveLanes = useCallback(() => {
    const now = performance.now();
    const next: Record<Lane, boolean> = {
      LEFT:
        cameraActiveLanesRef.current.LEFT ||
        keyboardLanesRef.current.LEFT ||
        manualPulseUntilRef.current.LEFT > now,
      MOUTH:
        cameraActiveLanesRef.current.MOUTH ||
        keyboardLanesRef.current.MOUTH ||
        manualPulseUntilRef.current.MOUTH > now,
      SMILE:
        cameraActiveLanesRef.current.SMILE ||
        keyboardLanesRef.current.SMILE ||
        manualPulseUntilRef.current.SMILE > now,
      RIGHT:
        cameraActiveLanesRef.current.RIGHT ||
        keyboardLanesRef.current.RIGHT ||
        manualPulseUntilRef.current.RIGHT > now,
    };
    setActiveLanes((prev) =>
      prev.LEFT === next.LEFT &&
      prev.MOUTH === next.MOUTH &&
      prev.SMILE === next.SMILE &&
      prev.RIGHT === next.RIGHT
        ? prev
        : next
    );
  }, []);

  const spawnHitParticles = useCallback((lane: Lane, count: number, isBonus: boolean) => {
    const laneIdx = LANE_ORDER.indexOf(lane);
    if (laneIdx === -1) return;
    const normX = (laneIdx + 0.5) / LANE_ORDER.length;
    const color = isBonus ? '#FBBF24' : LANE_META[lane].color;
    const now = performance.now();

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 0.7 + Math.random() * 1.1;
      particlesRef.current.push({
        x: normX,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.3,
        color,
        size: 3 + Math.random() * 2.5,
        createdAt: now,
      });
    }
    if (particlesRef.current.length > 96) {
      particlesRef.current.splice(0, particlesRef.current.length - 96);
    }
  }, []);

  const triggerLaneHit = useCallback(
    (lane: Lane) => {
      if (gameStateRef.current !== 'PLAYING') return;

      const judgeTime = applyAudioOffset(
        grooveEngine.getSongTime(),
        calibrationRef.current.audioOffsetMs
      );
      const notes = notesRef.current;

      let targetNote: BeatNote | null = null;
      let bestAbsDiff = Infinity;

      for (const note of notes) {
        if (note.hit || note.missed || note.lane !== lane) continue;
        const diff = Math.abs(note.time - judgeTime);
        if (diff <= HIT_WINDOWS_SEC.GOOD && diff < bestAbsDiff) {
          bestAbsDiff = diff;
          targetNote = note;
        }
      }

      if (!targetNote) {
        grooveEngine.playAttemptTone(lane);
        return;
      }

      const judgment = judgeTiming(targetNote.time, judgeTime);
      if (!judgment) {
        grooveEngine.playAttemptTone(lane);
        return;
      }

      targetNote.hit = true;
      laneBreakdownRef.current[lane].hits += 1;
      laneBreakdownRef.current[lane].total += 1;

      const nextCombo = statsRef.current.combo + 1;
      const points = computeHitPoints(judgment, nextCombo, targetNote.isBonus);

      const nextStats: GameStats = {
        ...statsRef.current,
        score: statsRef.current.score + points,
        combo: nextCombo,
        maxCombo: Math.max(statsRef.current.maxCombo, nextCombo),
        perfect: statsRef.current.perfect + (judgment === 'PERFECT' ? 1 : 0),
        great: statsRef.current.great + (judgment === 'GREAT' ? 1 : 0),
        good: statsRef.current.good + (judgment === 'GOOD' ? 1 : 0),
      };
      statsRef.current = nextStats;
      setStats(nextStats);

      const nowPerf = performance.now();
      feedbacksRef.current.push({
        id: feedbackIdRef.current++,
        lane,
        judgment,
        points,
        createdAt: nowPerf,
        isBonus: targetNote.isBonus,
      });
      if (feedbacksRef.current.length > 24) {
        feedbacksRef.current.shift();
      }

      // Extra particle bursts + subtle shake on high combos or bonus notes
      const burstCount = nextCombo >= 8 || targetNote.isBonus ? 12 : 6;
      spawnHitParticles(lane, burstCount, targetNote.isBonus);
      if ((nextCombo >= 8 && (judgment === 'PERFECT' || judgment === 'GREAT')) || targetNote.isBonus) {
        shakeUntilRef.current = nowPerf + 130;
      }

      grooveEngine.playHitSound(lane, judgment, targetNote.isBonus, nextCombo);
    },
    [spawnHitParticles]
  );

  const handleManualLaneTrigger = useCallback(
    (lane: Lane) => {
      grooveEngine.unlock();
      manualPulseUntilRef.current[lane] = performance.now() + 140;
      syncActiveLanes();
      triggerLaneHit(lane);
    },
    [syncActiveLanes, triggerLaneHit]
  );

  const finishRound = useCallback(() => {
    grooveEngine.stop();
    void spotifySdk.pause();
    youtubeSdk.pause();
    grooveEngine.playVictoryFanfare();
    setGameState('GAME_OVER');

    const finalStats = statsRef.current;
    const accuracy = computeAccuracy(finalStats);
    const grade = computeGrade(accuracy);
    const desc = currentTrackDescRef.current;
    const trackKey = toTrackKey(desc.source, desc.sourceId);
    const finalBreakdown: LaneBreakdown = {
      LEFT: { ...laneBreakdownRef.current.LEFT },
      MOUTH: { ...laneBreakdownRef.current.MOUTH },
      SMILE: { ...laneBreakdownRef.current.SMILE },
      RIGHT: { ...laneBreakdownRef.current.RIGHT },
    };
    const peaks = { ...peakTelemetryRef.current };
    setLaneBreakdown(finalBreakdown);

    const entry: LeaderboardEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trackTitle: activeMusicRef.current.title,
      difficulty: difficultyRef.current,
      durationSec: durationRef.current,
      score: finalStats.score,
      accuracy,
      maxCombo: finalStats.maxCombo,
      grade,
      createdAt: Date.now(),
    };

    setLeaderboard((prev) => {
      const updated = [...prev, entry].sort((a, b) => b.score - a.score).slice(0, 12);
      try {
        localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });

    // Save to persistent player memory (local + Firestore when signed in)
    const newSession: FitnessSessionMemory = {
      id: entry.id,
      trackKey,
      trackTitle: desc.title,
      source: desc.source,
      bpm: desc.bpm,
      difficulty: difficultyRef.current,
      durationSec: durationRef.current,
      score: finalStats.score,
      accuracy,
      maxCombo: finalStats.maxCombo,
      grade: normalizeGrade(grade),
      leftHits: finalBreakdown.LEFT.hits,
      leftTotal: Math.max(finalBreakdown.LEFT.hits, finalBreakdown.LEFT.total),
      mouthHits: finalBreakdown.MOUTH.hits,
      mouthTotal: Math.max(finalBreakdown.MOUTH.hits, finalBreakdown.MOUTH.total),
      smileHits: finalBreakdown.SMILE.hits,
      smileTotal: Math.max(finalBreakdown.SMILE.hits, finalBreakdown.SMILE.total),
      rightHits: finalBreakdown.RIGHT.hits,
      rightTotal: Math.max(finalBreakdown.RIGHT.hits, finalBreakdown.RIGHT.total),
      peakMouth: peaks.mouth,
      peakSmile: peaks.smile,
      peakTilt: peaks.tilt,
      createdAtMs: Date.now(),
    };

    const nextSessions = [newSession, ...sessionsRef.current].slice(0, 50);
    setSessions(nextSessions);
    saveLocalSessions(nextSessions);

    const prevFav = favoritesRef.current.find((f) => f.trackKey === trackKey);
    const updatedFav: FavoriteTrackMemory = {
      trackKey,
      source: desc.source,
      sourceId: desc.sourceId,
      title: desc.title,
      author: desc.author,
      url: desc.url,
      thumbnail: desc.thumbnail,
      bpm: desc.bpm,
      liked: prevFav?.liked ?? false,
      playCount: (prevFav?.playCount ?? 0) + 1,
      bestScore: Math.max(prevFav?.bestScore ?? 0, finalStats.score),
      tasteVector:
        prevFav?.tasteVector && prevFav.tasteVector.length > 0
          ? prevFav.tasteVector
          : buildDeterministicTrackVector(desc),
      updatedAtMs: Date.now(),
    };
    const nextFavorites = [
      updatedFav,
      ...favoritesRef.current.filter((f) => f.trackKey !== trackKey),
    ].slice(0, 40);
    setFavorites(nextFavorites);
    saveLocalFavorites(nextFavorites);

    const prevProf = memoryProfileRef.current;
    const nextProfile: UserMemoryProfile = {
      ...prevProf,
      totalSessions: prevProf.totalSessions + 1,
      bestScore: Math.max(prevProf.bestScore, finalStats.score),
      bestCombo: Math.max(prevProf.bestCombo, finalStats.maxCombo),
      laneLeftHits: prevProf.laneLeftHits + newSession.leftHits,
      laneLeftTotal: prevProf.laneLeftTotal + newSession.leftTotal,
      laneMouthHits: prevProf.laneMouthHits + newSession.mouthHits,
      laneMouthTotal: prevProf.laneMouthTotal + newSession.mouthTotal,
      laneSmileHits: prevProf.laneSmileHits + newSession.smileHits,
      laneSmileTotal: prevProf.laneSmileTotal + newSession.smileTotal,
      laneRightHits: prevProf.laneRightHits + newSession.rightHits,
      laneRightTotal: prevProf.laneRightTotal + newSession.rightTotal,
    };
    setMemoryProfile(nextProfile);
    saveLocalProfile(nextProfile);

    const uid = authUserRef.current?.uid;
    if (uid) {
      void recordSessionToCloud(uid, prevProf, {
        source: desc.source,
        sourceId: desc.sourceId,
        trackTitle: desc.title,
        bpm: desc.bpm,
        difficulty: difficultyRef.current,
        durationSec: durationRef.current,
        score: finalStats.score,
        accuracy,
        maxCombo: finalStats.maxCombo,
        grade,
        laneBreakdown: finalBreakdown,
        peaks,
      });
      void upsertFavoriteTrackInCloud(uid, {
        ...desc,
        incrementPlay: true,
        roundScore: finalStats.score,
        tasteVector: updatedFav.tasteVector,
      });
    }

    void refreshMemoryAnalysis(nextProfile, nextFavorites, nextSessions, uid);
  }, [refreshMemoryAnalysis]);

  const startPlaybackForSelectedMusic = useCallback(async () => {
    if (musicSource === 'youtube' && selectedYoutubeTrack) {
      setShowSpotifyEmbed(false);
      if (youtubeMountRef.current) {
        const mounted = await youtubeSdk.mountAndPlay(
          youtubeMountRef.current,
          selectedYoutubeTrack.id,
          isMuted
        );
        if (mounted) {
          setYoutubeFallbackEmbedId(null);
          grooveEngine.startExternalClock(() => youtubeSdk.getCurrentTime());
          return;
        }
      }
      setYoutubeFallbackEmbedId(selectedYoutubeTrack.id);
      grooveEngine.startExternalClock();
      return;
    }

    if (musicSource === 'tiktok' && selectedTiktokTrack) {
      setShowSpotifyEmbed(false);
      setYoutubeFallbackEmbedId(null);
      grooveEngine.startExternalClock();
      return;
    }

    if (musicSource === 'upload' && uploadedTrack) {
      setShowSpotifyEmbed(false);
      setYoutubeFallbackEmbedId(null);
      grooveEngine.startUploadedBuffer(uploadedTrack.buffer);
      return;
    }

    if (musicSource === 'spotify' && selectedSpotifyTrack) {
      setYoutubeFallbackEmbedId(null);
      const sdkStarted = await spotifySdk.playUri(selectedSpotifyTrack.uri);
      if (sdkStarted) {
        setShowSpotifyEmbed(false);
        grooveEngine.startExternalClock();
        return;
      }
      if (selectedSpotifyTrack.previewUrl) {
        setShowSpotifyEmbed(false);
        grooveEngine.startPreviewUrl(selectedSpotifyTrack.previewUrl);
        return;
      }
      setShowSpotifyEmbed(true);
      grooveEngine.startExternalClock();
      return;
    }

    setShowSpotifyEmbed(false);
    setYoutubeFallbackEmbedId(null);
    grooveEngine.startTrack(synthTrack);
  }, [
    musicSource,
    selectedYoutubeTrack,
    selectedTiktokTrack,
    uploadedTrack,
    selectedSpotifyTrack,
    synthTrack,
    isMuted,
  ]);

  const startGame = useCallback(() => {
    if (musicSource === 'youtube' && !selectedYoutubeTrack) return;
    if (musicSource === 'tiktok' && !selectedTiktokTrack) return;
    if (musicSource === 'spotify' && !selectedSpotifyTrack) return;
    if (musicSource === 'upload' && !uploadedTrack) return;

    grooveEngine.unlock();
    grooveEngine.stop();
    void spotifySdk.pause();
    youtubeSdk.destroy();
    setYoutubeFallbackEmbedId(null);

    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    let beatmap: BeatNote[];
    if (musicSource === 'upload' && uploadedTrack) {
      beatmap = generateBeatmapFromBpm(
        uploadedTrack.id,
        customBpm,
        difficulty,
        durationSec,
        uploadedTrack.beatTimes
      );
    } else if (musicSource === 'youtube' && selectedYoutubeTrack) {
      beatmap = generateBeatmapFromBpm(selectedYoutubeTrack.id, customBpm, difficulty, durationSec);
    } else if (musicSource === 'tiktok' && selectedTiktokTrack) {
      beatmap = generateBeatmapFromBpm(selectedTiktokTrack.id, customBpm, difficulty, durationSec);
    } else if (musicSource === 'spotify' && selectedSpotifyTrack) {
      beatmap = generateBeatmapFromBpm(selectedSpotifyTrack.id, customBpm, difficulty, durationSec);
    } else {
      beatmap = generateBeatmap(synthTrack, difficulty, durationSec);
    }

    notesRef.current = beatmap;
    feedbacksRef.current = [];
    particlesRef.current = [];
    shakeUntilRef.current = 0;
    laneBreakdownRef.current = EMPTY_LANE_BREAKDOWN();
    peakTelemetryRef.current = { mouth: 0, smile: 0, tilt: 0 };
    setLaneBreakdown(EMPTY_LANE_BREAKDOWN());

    const freshStats: GameStats = {
      ...INITIAL_STATS,
      totalNotes: beatmap.length,
    };
    statsRef.current = freshStats;
    setStats(freshStats);
    setSongTime(0);
    setInfoModal(null);
    setShowSettings(false);
    setShowMemoryModal(false);

    if (musicSource === 'spotify' && selectedSpotifyTrack && !selectedSpotifyTrack.previewUrl) {
      setShowSpotifyEmbed(true);
    } else {
      setShowSpotifyEmbed(false);
    }

    setCountdownValue(3);
    setGameState('COUNTDOWN');
    grooveEngine.playCountdownTick(false);

    let step = 3;
    countdownTimerRef.current = window.setInterval(() => {
      step -= 1;
      if (step > 0) {
        setCountdownValue(step);
        grooveEngine.playCountdownTick(false);
      } else {
        if (countdownTimerRef.current !== null) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setCountdownValue(0);
        grooveEngine.playCountdownTick(true);
        void startPlaybackForSelectedMusic();
        setGameState('PLAYING');
      }
    }, 650);
  }, [
    musicSource,
    selectedYoutubeTrack,
    selectedTiktokTrack,
    selectedSpotifyTrack,
    uploadedTrack,
    customBpm,
    difficulty,
    durationSec,
    synthTrack,
    startPlaybackForSelectedMusic,
  ]);

  const stopRoundToMenu = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    grooveEngine.stop();
    void spotifySdk.pause();
    youtubeSdk.destroy();
    setShowSpotifyEmbed(false);
    setYoutubeFallbackEmbedId(null);
    notesRef.current = [];
    feedbacksRef.current = [];
    particlesRef.current = [];
    shakeUntilRef.current = 0;
    setSongTime(0);
    statsRef.current = INITIAL_STATS;
    setStats(INITIAL_STATS);
    setGameState('TITLE_MENU');
  }, []);

  const handlePauseToggle = useCallback(() => {
    if (gameState === 'PLAYING') {
      grooveEngine.pause();
      if (musicSource === 'spotify') void spotifySdk.pause();
      if (musicSource === 'youtube') youtubeSdk.pause();
      setGameState('PAUSED');
    } else if (gameState === 'PAUSED') {
      grooveEngine.resume();
      if (musicSource === 'spotify') void spotifySdk.resume();
      if (musicSource === 'youtube') youtubeSdk.resume();
      setGameState('PLAYING');
    }
  }, [gameState, musicSource]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      grooveEngine.setMuted(next);
      youtubeSdk.setMuted(next);
      return next;
    });
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    trackerRef.current?.resetFilters();
    cameraActiveLanesRef.current = { LEFT: false, MOUTH: false, SMILE: false, RIGHT: false };
    setTelemetry(INITIAL_TELEMETRY);
    setCameraStatus('idle');
    syncActiveLanes();
  }, [syncActiveLanes]);

  const startCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('unavailable');
      return;
    }
    setCameraStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraStatus('active');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setCameraStatus('denied');
      } else {
        setCameraStatus('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    const tracker = new FaceTracker();
    trackerRef.current = tracker;

    tracker
      .init()
      .then(() => setModelStatus('ready'))
      .catch(() => setModelStatus('error'));

    void startCamera();

    return () => {
      if (countdownTimerRef.current !== null) {
        clearInterval(countdownTimerRef.current);
      }
      grooveEngine.stop();
      spotifySdk.dispose();
      youtubeSdk.destroy();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      tracker.dispose();
    };
  }, [startCamera]);

  // Firebase Auth & Live Cloud Memory Synchronization
  useEffect(() => {
    let unsubMemory: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubMemory) {
        unsubMemory();
        unsubMemory = null;
      }
      setAuthUser(user);
      if (!user) return;

      try {
        const cloudProfile = await ensureCloudUserProfile(
          user,
          calibrationRef.current,
          difficultyRef.current,
          durationRef.current
        );
        setMemoryProfile(cloudProfile);
        saveLocalProfile(cloudProfile);

        // Apply saved cloud calibration parameters & preferences automatically
        const nextCal: CalibrationSettings = {
          mouthThreshold: cloudProfile.mouthThreshold,
          smileThreshold: cloudProfile.smileThreshold,
          tiltThreshold: cloudProfile.tiltThreshold,
          audioOffsetMs: cloudProfile.audioOffsetMs,
        };
        setCalibration(nextCal);
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextCal));
        } catch {
          // Ignore
        }
        setDifficulty(cloudProfile.preferredDifficulty);
        setDurationSec(cloudProfile.preferredDurationSec);

        // Sync any local favorites up to cloud if newly signed in
        const localFavs = loadLocalFavorites();
        for (const fav of localFavs.slice(0, 10)) {
          await upsertFavoriteTrackInCloud(user.uid, {
            source: fav.source,
            sourceId: fav.sourceId,
            title: fav.title,
            author: fav.author,
            url: fav.url,
            thumbnail: fav.thumbnail,
            bpm: fav.bpm,
            liked: fav.liked,
            tasteVector: fav.tasteVector,
          }).catch(() => {});
        }

        unsubMemory = subscribeUserMemory(
          user.uid,
          (liveProfile) => {
            setMemoryProfile(liveProfile);
            saveLocalProfile(liveProfile);
          },
          (liveFavorites) => {
            setFavorites(liveFavorites);
            saveLocalFavorites(liveFavorites);
            setMemoryAnalysis((prev) => ({
              ...prev,
              ...computeLocalMemoryAnalysis(memoryProfileRef.current, liveFavorites, sessionsRef.current),
            }));
          },
          (liveSessions) => {
            setSessions(liveSessions);
            saveLocalSessions(liveSessions);
          }
        );
      } catch {
        // ErrorBoundary / handleFirestoreError logs details
      }
    });

    return () => {
      unsubAuth();
      if (unsubMemory) unsubMemory();
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTelemetryPush = 0;
    let lastSongTimePush = 0;

    const tick = (nowMs: number) => {
      if (videoRef.current && trackerRef.current?.isReady() && streamRef.current) {
        const result = trackerRef.current.processVideoFrame(videoRef.current, nowMs);
        if (result) {
          const { mouthThreshold, smileThreshold, tiltThreshold } = calibrationRef.current;

          const wasMouth = cameraActiveLanesRef.current.MOUTH;
          const isMouth = wasMouth
            ? result.mouthOpen >= mouthThreshold * 0.76
            : result.mouthOpen >= mouthThreshold;

          const wasSmile = cameraActiveLanesRef.current.SMILE;
          const isSmile = wasSmile
            ? result.smile >= smileThreshold * 0.76 && result.mouthOpen < mouthThreshold * 1.15
            : result.smile >= smileThreshold && result.mouthOpen < mouthThreshold * 1.05;

          const wasLeft = cameraActiveLanesRef.current.LEFT;
          const isLeft = wasLeft
            ? result.headTilt <= -tiltThreshold * 0.72
            : result.headTilt <= -tiltThreshold;

          const wasRight = cameraActiveLanesRef.current.RIGHT;
          const isRight = wasRight
            ? result.headTilt >= tiltThreshold * 0.72
            : result.headTilt >= tiltThreshold;

          if (!wasMouth && isMouth) triggerLaneHit('MOUTH');
          if (!wasSmile && isSmile) triggerLaneHit('SMILE');
          if (!wasLeft && isLeft) triggerLaneHit('LEFT');
          if (!wasRight && isRight) triggerLaneHit('RIGHT');

          cameraActiveLanesRef.current = {
            LEFT: isLeft,
            MOUTH: isMouth,
            SMILE: isSmile,
            RIGHT: isRight,
          };

          if (gameStateRef.current === 'PLAYING') {
            peakTelemetryRef.current = {
              mouth: Math.max(peakTelemetryRef.current.mouth, result.mouthOpen),
              smile: Math.max(peakTelemetryRef.current.smile, result.smile),
              tilt: Math.max(peakTelemetryRef.current.tilt, Math.abs(result.headTilt)),
            };
          }

          if (nowMs - lastTelemetryPush > 32) {
            lastTelemetryPush = nowMs;
            setTelemetry(result);
          }
        }
      }

      syncActiveLanes();

      if (gameStateRef.current === 'PLAYING') {
        const rawSongTime = grooveEngine.getSongTime();
        const judgeTime = applyAudioOffset(rawSongTime, calibrationRef.current.audioOffsetMs);

        if (nowMs - lastSongTimePush > 80) {
          lastSongTimePush = nowMs;
          setSongTime(rawSongTime);
        }

        let missedCount = 0;
        for (const note of notesRef.current) {
          if (!note.hit && !note.missed && judgeTime - note.time > HIT_WINDOWS_SEC.MISS) {
            note.missed = true;
            laneBreakdownRef.current[note.lane].total += 1;
            missedCount++;
            feedbacksRef.current.push({
              id: feedbackIdRef.current++,
              lane: note.lane,
              judgment: 'MISS',
              points: 0,
              createdAt: nowMs,
              isBonus: note.isBonus,
            });
          }
        }

        if (missedCount > 0) {
          const nextStats: GameStats = {
            ...statsRef.current,
            combo: 0,
            miss: statsRef.current.miss + missedCount,
          };
          statsRef.current = nextStats;
          setStats(nextStats);
          grooveEngine.playMissSound();
        }

        if (rawSongTime >= durationRef.current) {
          finishRound();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [finishRound, syncActiveLanes, triggerLaneHit]);

  // Keyboard Arcade Mode (A, S, D, F mapped to the 4 lanes + arrow/space convenience)
  useEffect(() => {
    const mapKeyToLane = (code: string): Lane | null => {
      if (code === 'KeyA' || code === 'ArrowLeft') return 'LEFT';
      if (code === 'KeyS' || code === 'Space') return 'MOUTH';
      if (code === 'KeyD' || code === 'ArrowUp') return 'SMILE';
      if (code === 'KeyF' || code === 'ArrowRight') return 'RIGHT';
      return null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (infoModal) {
          setInfoModal(null);
          return;
        }
        if (gameStateRef.current === 'PLAYING' || gameStateRef.current === 'PAUSED') {
          handlePauseToggle();
          return;
        }
      }

      const lane = mapKeyToLane(e.code);
      if (!lane) return;

      if (gameStateRef.current === 'PLAYING' || gameStateRef.current === 'COUNTDOWN') {
        e.preventDefault();
      }
      if (e.repeat) return;

      grooveEngine.unlock();
      keyboardLanesRef.current[lane] = true;
      syncActiveLanes();
      triggerLaneHit(lane);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const lane = mapKeyToLane(e.code);
      if (!lane) return;
      keyboardLanesRef.current[lane] = false;
      syncActiveLanes();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handlePauseToggle, infoModal, showSettings, syncActiveLanes, triggerLaneHit]);

  const handleClearLeaderboard = useCallback(() => {
    setLeaderboard([]);
    try {
      localStorage.removeItem(LEADERBOARD_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const handleSelectYoutubeTrack = useCallback((yt: ExternalMediaTrack) => {
    setSelectedYoutubeTrack(yt);
    setCustomBpm(yt.bpm || 116);
  }, []);

  const handleSelectTiktokTrack = useCallback((tt: ExternalMediaTrack) => {
    setSelectedTiktokTrack(tt);
    setCustomBpm(tt.bpm || 120);
  }, []);

  const handleSelectSpotifyTrack = useCallback((st: SpotifyTrackOption) => {
    setSelectedSpotifyTrack(st);
    setCustomBpm(st.bpm || 116);
  }, []);

  const handleSelectUploadedTrack = useCallback((ut: UploadedAudioTrack) => {
    setUploadedTrack(ut);
    setCustomBpm(ut.bpm);
  }, []);

  const handleSelectDifficulty = useCallback((nextDiff: Difficulty) => {
    setDifficulty(nextDiff);
    if (authUserRef.current) {
      void saveCalibrationToCloud(
        authUserRef.current.uid,
        authUserRef.current.displayName || 'Player',
        calibrationRef.current,
        nextDiff,
        durationRef.current
      );
    }
  }, []);

  const handleSelectDuration = useCallback((nextDur: number) => {
    setDurationSec(nextDur);
    if (authUserRef.current) {
      void saveCalibrationToCloud(
        authUserRef.current.uid,
        authUserRef.current.displayName || 'Player',
        calibrationRef.current,
        difficultyRef.current,
        nextDur
      );
    }
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In was cancelled or blocked.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    await signOut(auth).catch(() => {});
  }, []);

  const handleToggleSaveCurrentTrack = useCallback(() => {
    const desc = currentTrackDescRef.current;
    const trackKey = toTrackKey(desc.source, desc.sourceId);
    const existing = favoritesRef.current.find((f) => f.trackKey === trackKey);
    const nextLiked = !(existing?.liked ?? false);

    const updated: FavoriteTrackMemory = {
      trackKey,
      source: desc.source,
      sourceId: desc.sourceId,
      title: desc.title,
      author: desc.author,
      url: desc.url,
      thumbnail: desc.thumbnail,
      bpm: desc.bpm,
      liked: nextLiked,
      playCount: existing?.playCount ?? 0,
      bestScore: existing?.bestScore ?? 0,
      tasteVector:
        existing?.tasteVector && existing.tasteVector.length > 0
          ? existing.tasteVector
          : buildDeterministicTrackVector(desc),
      updatedAtMs: Date.now(),
    };
    const nextList = [updated, ...favoritesRef.current.filter((f) => f.trackKey !== trackKey)].slice(
      0,
      40
    );
    setFavorites(nextList);
    saveLocalFavorites(nextList);

    if (authUserRef.current) {
      void upsertFavoriteTrackInCloud(authUserRef.current.uid, {
        ...desc,
        liked: nextLiked,
        tasteVector: updated.tasteVector,
      });
    }
  }, []);

  const handleToggleFavoriteLike = useCallback((track: FavoriteTrackMemory) => {
    const nextLiked = !track.liked;
    const nextList = favoritesRef.current.map((f) =>
      f.trackKey === track.trackKey ? { ...f, liked: nextLiked, updatedAtMs: Date.now() } : f
    );
    setFavorites(nextList);
    saveLocalFavorites(nextList);
    if (authUserRef.current) {
      void upsertFavoriteTrackInCloud(authUserRef.current.uid, {
        source: track.source,
        sourceId: track.sourceId,
        title: track.title,
        author: track.author,
        url: track.url,
        thumbnail: track.thumbnail,
        bpm: track.bpm,
        liked: nextLiked,
        tasteVector: track.tasteVector,
      });
    }
  }, []);

  const handleDeleteFavorite = useCallback((trackKey: string) => {
    const nextList = favoritesRef.current.filter((f) => f.trackKey !== trackKey);
    setFavorites(nextList);
    saveLocalFavorites(nextList);
    if (authUserRef.current) {
      void deleteFavoriteTrackFromCloud(authUserRef.current.uid, trackKey);
    }
  }, []);

  const handleLoadFavorite = useCallback(
    (track: FavoriteTrackMemory) => {
      if (gameStateRef.current !== 'TITLE_MENU') {
        stopRoundToMenu();
      }
      if (track.source === 'youtube') {
        setMusicSource('youtube');
        setSelectedYoutubeTrack({
          provider: 'youtube',
          id: track.sourceId,
          url: track.url || `https://www.youtube.com/watch?v=${track.sourceId}`,
          title: track.title,
          author: track.author,
          thumbnail: track.thumbnail,
          bpm: track.bpm,
        });
        setCustomBpm(track.bpm);
      } else if (track.source === 'tiktok') {
        setMusicSource('tiktok');
        setSelectedTiktokTrack({
          provider: 'tiktok',
          id: track.sourceId,
          url: track.url,
          title: track.title,
          author: track.author,
          thumbnail: track.thumbnail,
          bpm: track.bpm,
        });
        setCustomBpm(track.bpm);
      } else if (track.source === 'spotify') {
        setMusicSource('spotify');
        setSelectedSpotifyTrack({
          id: track.sourceId,
          name: track.title,
          artist: track.author,
          albumArt: track.thumbnail,
          uri: `spotify:track:${track.sourceId}`,
          durationSec: 45,
          previewUrl: null,
          bpm: track.bpm,
        });
        setCustomBpm(track.bpm);
      } else if (track.source === 'synth') {
        setMusicSource('synth');
        const matched = TRACKS.find((t) => t.id === track.sourceId);
        if (matched) setTrackId(matched.id);
      }
    },
    [stopRoundToMenu]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              stopRoundToMenu();
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            FaceBeat Arcade
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={stopRoundToMenu}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Music
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setShowMemoryModal(true)}
              className="inline-flex items-center gap-1.5 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Memory & Fitness</span>
            </button>
            <button
              type="button"
              onClick={() => setInfoModal('how-to-play')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              How to Play
            </button>
            <button
              type="button"
              onClick={() => setInfoModal('leaderboard')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Leaderboard
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => (authUser ? setShowMemoryModal(true) : void handleGoogleSignIn())}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title={
                authUser
                  ? `Synced as ${authUser.displayName || authUser.email}`
                  : 'Sign in with Google to sync your music taste & facial fitness across devices'
              }
            >
              {authUser ? (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline max-w-[110px] truncate">
                    {authUser.displayName?.split(' ')[0] || 'Synced'}
                  </span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">
                    {authLoading ? 'Signing in...' : 'Sign In'}
                  </span>
                </>
              )}
            </button>

            {gameState === 'PLAYING' || gameState === 'PAUSED' || gameState === 'COUNTDOWN' ? (
              <button
                type="button"
                onClick={stopRoundToMenu}
                className="px-4 py-2 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                End Round
              </button>
            ) : (
              <button
                type="button"
                onClick={startGame}
                disabled={
                  (musicSource === 'youtube' && !selectedYoutubeTrack) ||
                  (musicSource === 'tiktok' && !selectedTiktokTrack) ||
                  (musicSource === 'spotify' && !selectedSpotifyTrack) ||
                  (musicSource === 'upload' && !uploadedTrack)
                }
                className="px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                Start Round
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main 1440px Dual-Stage Arena */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 flex flex-col">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 items-stretch">
          <div className="lg:col-span-5 flex flex-col">
            <CameraStage
              videoRef={videoRef}
              cameraStatus={cameraStatus}
              modelStatus={modelStatus}
              telemetry={telemetry}
              activeLanes={activeLanes}
              calibration={calibration}
              onOpenSettings={() => setShowSettings(true)}
              onStartCamera={startCamera}
              onStopCamera={stopCamera}
              onRecenter={() => trackerRef.current?.recenterTilt()}
            />
          </div>

          <div className="lg:col-span-7 flex flex-col">
            <RhythmHighway
              gameState={gameState}
              countdownValue={countdownValue}
              activeMusic={activeMusic}
              musicSource={musicSource}
              tracks={TRACKS}
              selectedSynthId={trackId}
              selectedYoutubeTrack={selectedYoutubeTrack}
              selectedTiktokTrack={selectedTiktokTrack}
              selectedSpotifyTrack={selectedSpotifyTrack}
              uploadedTrack={uploadedTrack}
              customBpm={customBpm}
              favorites={favorites}
              currentTrackLiked={currentTrackLiked}
              audioOffsetMs={calibration.audioOffsetMs}
              showSpotifyEmbed={showSpotifyEmbed}
              youtubeMountRef={youtubeMountRef}
              youtubeFallbackEmbedId={youtubeFallbackEmbedId}
              difficulty={difficulty}
              durationSec={durationSec}
              notesRef={notesRef}
              feedbacksRef={feedbacksRef}
              particlesRef={particlesRef}
              shakeUntilRef={shakeUntilRef}
              activeLanes={activeLanes}
              stats={stats}
              songTime={songTime}
              isMuted={isMuted}
              onSelectSource={setMusicSource}
              onSelectSynth={setTrackId}
              onSelectYoutubeTrack={handleSelectYoutubeTrack}
              onSelectTiktokTrack={handleSelectTiktokTrack}
              onSelectSpotifyTrack={handleSelectSpotifyTrack}
              onSelectUploadedTrack={handleSelectUploadedTrack}
              onChangeCustomBpm={setCustomBpm}
              onToggleSaveCurrentTrack={handleToggleSaveCurrentTrack}
              onLoadFavorite={handleLoadFavorite}
              onSelectDifficulty={handleSelectDifficulty}
              onSelectDuration={handleSelectDuration}
              onStartGame={startGame}
              onPauseToggle={handlePauseToggle}
              onToggleMute={handleToggleMute}
              onManualLaneTrigger={handleManualLaneTrigger}
            />
          </div>
        </div>
      </main>

      {gameState === 'GAME_OVER' && (
        <SummaryModal
          stats={stats}
          track={summaryTrackConfig}
          difficulty={difficulty}
          durationSec={durationSec}
          laneBreakdown={laneBreakdown}
          leaderboard={leaderboard}
          onOpenMemory={() => {
            stopRoundToMenu();
            setShowMemoryModal(true);
          }}
          onPlayAgain={startGame}
          onBackToMenu={stopRoundToMenu}
        />
      )}

      {showMemoryModal && (
        <MemoryCoachModal
          user={
            authUser
              ? { uid: authUser.uid, displayName: authUser.displayName, email: authUser.email }
              : null
          }
          authLoading={authLoading}
          authError={authError}
          profile={memoryProfile}
          favorites={favorites}
          sessions={sessions}
          analysis={memoryAnalysis}
          isAnalyzing={isAnalyzing}
          onSignIn={() => void handleGoogleSignIn()}
          onSignOut={() => void handleGoogleSignOut()}
          onRefreshAnalysis={() =>
            void refreshMemoryAnalysis(memoryProfile, favorites, sessions, authUser?.uid)
          }
          onLoadFavorite={handleLoadFavorite}
          onToggleFavoriteLike={handleToggleFavoriteLike}
          onDeleteFavorite={handleDeleteFavorite}
          onClose={() => setShowMemoryModal(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          calibration={calibration}
          cameraActive={cameraStatus === 'active'}
          onChangeCalibration={updateCalibration}
          onRecenterHead={() => trackerRef.current?.recenterTilt()}
          onClose={() => setShowSettings(false)}
        />
      )}

      {infoModal && (
        <InfoModal
          mode={infoModal}
          leaderboard={leaderboard}
          onClearLeaderboard={handleClearLeaderboard}
          onClose={() => setInfoModal(null)}
        />
      )}
    </div>
  );
}
