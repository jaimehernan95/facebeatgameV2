import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { grooveEngine } from './audio/grooveEngine';
import { spotifySdk } from './audio/spotifySdk';
import { CameraStage } from './components/CameraStage';
import { InfoModal } from './components/InfoModal';
import { RhythmHighway } from './components/RhythmHighway';
import { computeGrade, SummaryModal } from './components/SummaryModal';
import { generateBeatmap, generateBeatmapFromBpm, getTrackById, TRACKS } from './game/beatmap';
import {
  ActiveMusicMeta,
  BeatNote,
  CalibrationSettings,
  Difficulty,
  FaceTelemetry,
  GameState,
  GameStats,
  HitFeedback,
  Judgment,
  Lane,
  LeaderboardEntry,
  MusicSource,
  SpotifyTrackOption,
  TrackConfig,
  TrackId,
  UploadedAudioTrack,
} from './types/game';
import { FaceTracker } from './vision/faceTracker';

const LEADERBOARD_KEY = 'facebeat_arcade_leaderboard_v1';

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

export default function App() {
  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [musicSource, setMusicSource] = useState<MusicSource>('synth');
  const [trackId, setTrackId] = useState<TrackId>('neon-funk');
  const [selectedSpotifyTrack, setSelectedSpotifyTrack] = useState<SpotifyTrackOption | null>(null);
  const [uploadedTrack, setUploadedTrack] = useState<UploadedAudioTrack | null>(null);
  const [customBpm, setCustomBpm] = useState<number>(116);
  const [showSpotifyEmbed, setShowSpotifyEmbed] = useState<boolean>(false);

  const [difficulty, setDifficulty] = useState<Difficulty>('chill');
  const [durationSec, setDurationSec] = useState<number>(45);
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [songTime, setSongTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const [showCalibration, setShowCalibration] = useState<boolean>(false);
  const [infoModal, setInfoModal] = useState<'how-to-play' | 'leaderboard' | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => loadLeaderboard());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<FaceTracker | null>(null);

  const [cameraStatus, setCameraStatus] = useState<
    'idle' | 'starting' | 'active' | 'denied' | 'unavailable'
  >('idle');
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [telemetry, setTelemetry] = useState<FaceTelemetry>(INITIAL_TELEMETRY);
  const [calibration, setCalibration] = useState<CalibrationSettings>({
    mouthThreshold: 0.3,
    tiltThreshold: 0.22,
  });

  const [activeLanes, setActiveLanes] = useState<Record<Lane, boolean>>({
    LEFT: false,
    MOUTH: false,
    RIGHT: false,
  });

  const synthTrack = getTrackById(trackId);

  const activeMusic: ActiveMusicMeta = useMemo(() => {
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
  }, [musicSource, selectedSpotifyTrack, uploadedTrack, customBpm, synthTrack]);

  // SummaryModal expects a TrackConfig-shaped object for title/bpm display
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
    RIGHT: false,
  });
  const keyboardLanesRef = useRef<Record<Lane, boolean>>({
    LEFT: false,
    MOUTH: false,
    RIGHT: false,
  });
  const manualPulseUntilRef = useRef<Record<Lane, number>>({
    LEFT: 0,
    MOUTH: 0,
    RIGHT: 0,
  });

  const countdownTimerRef = useRef<number | null>(null);

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
      RIGHT:
        cameraActiveLanesRef.current.RIGHT ||
        keyboardLanesRef.current.RIGHT ||
        manualPulseUntilRef.current.RIGHT > now,
    };
    setActiveLanes((prev) =>
      prev.LEFT === next.LEFT && prev.MOUTH === next.MOUTH && prev.RIGHT === next.RIGHT
        ? prev
        : next
    );
  }, []);

  const triggerLaneHit = useCallback((lane: Lane) => {
    if (gameStateRef.current !== 'PLAYING') return;

    const currentSongTime = grooveEngine.getSongTime();
    const notes = notesRef.current;

    let targetNote: BeatNote | null = null;
    let bestAbsDiff = Infinity;

    for (const note of notes) {
      if (note.hit || note.missed || note.lane !== lane) continue;
      const diff = Math.abs(note.time - currentSongTime);
      if (diff <= 0.22 && diff < bestAbsDiff) {
        bestAbsDiff = diff;
        targetNote = note;
      }
    }

    if (!targetNote) return;

    targetNote.hit = true;
    const judgment: Judgment = bestAbsDiff <= 0.095 ? 'PERFECT' : 'GOOD';
    const nextCombo = statsRef.current.combo + 1;
    const multiplier = Math.min(4, 1 + Math.floor(nextCombo / 8));
    const basePoints = judgment === 'PERFECT' ? 300 : 150;
    const points = basePoints * multiplier * (targetNote.isBonus ? 2 : 1);

    const nextStats: GameStats = {
      ...statsRef.current,
      score: statsRef.current.score + points,
      combo: nextCombo,
      maxCombo: Math.max(statsRef.current.maxCombo, nextCombo),
      perfect: statsRef.current.perfect + (judgment === 'PERFECT' ? 1 : 0),
      good: statsRef.current.good + (judgment === 'GOOD' ? 1 : 0),
    };
    statsRef.current = nextStats;
    setStats(nextStats);

    feedbacksRef.current.push({
      id: feedbackIdRef.current++,
      lane,
      judgment,
      points,
      createdAt: performance.now(),
      isBonus: targetNote.isBonus,
    });
    if (feedbacksRef.current.length > 24) {
      feedbacksRef.current.shift();
    }

    grooveEngine.playHitSound(lane, judgment, targetNote.isBonus);
  }, []);

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
    grooveEngine.playVictoryFanfare();
    setGameState('GAME_OVER');

    const finalStats = statsRef.current;
    const totalJudged = finalStats.perfect + finalStats.good + finalStats.miss;
    const accuracy =
      totalJudged > 0
        ? Math.round(((finalStats.perfect + finalStats.good * 0.65) / totalJudged) * 100)
        : 0;

    const entry: LeaderboardEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trackTitle: activeMusicRef.current.title,
      difficulty: difficultyRef.current,
      durationSec: durationRef.current,
      score: finalStats.score,
      accuracy,
      maxCombo: finalStats.maxCombo,
      grade: computeGrade(accuracy),
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
  }, []);

  const startPlaybackForSelectedMusic = useCallback(async () => {
    if (musicSource === 'upload' && uploadedTrack) {
      setShowSpotifyEmbed(false);
      grooveEngine.startUploadedBuffer(uploadedTrack.buffer);
      return;
    }

    if (musicSource === 'spotify' && selectedSpotifyTrack) {
      // Try Spotify Web Playback SDK first (Premium accounts)
      const sdkStarted = await spotifySdk.playUri(selectedSpotifyTrack.uri);
      if (sdkStarted) {
        setShowSpotifyEmbed(false);
        grooveEngine.startExternalClock();
        return;
      }
      // Fallback 1: 30s Spotify preview URL
      if (selectedSpotifyTrack.previewUrl) {
        setShowSpotifyEmbed(false);
        grooveEngine.startPreviewUrl(selectedSpotifyTrack.previewUrl);
        return;
      }
      // Fallback 2: Official Spotify Embed widget + synced beatmap clock
      setShowSpotifyEmbed(true);
      grooveEngine.startExternalClock();
      return;
    }

    // Default: Built-in Free Synth Track
    setShowSpotifyEmbed(false);
    grooveEngine.startTrack(synthTrack);
  }, [musicSource, uploadedTrack, selectedSpotifyTrack, synthTrack]);

  const startGame = useCallback(() => {
    if (musicSource === 'spotify' && !selectedSpotifyTrack) return;
    if (musicSource === 'upload' && !uploadedTrack) return;

    grooveEngine.unlock();
    grooveEngine.stop();
    void spotifySdk.pause();

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
    } else if (musicSource === 'spotify' && selectedSpotifyTrack) {
      beatmap = generateBeatmapFromBpm(
        selectedSpotifyTrack.id,
        customBpm,
        difficulty,
        durationSec
      );
    } else {
      beatmap = generateBeatmap(synthTrack, difficulty, durationSec);
    }

    notesRef.current = beatmap;
    feedbacksRef.current = [];

    const freshStats: GameStats = {
      ...INITIAL_STATS,
      totalNotes: beatmap.length,
    };
    statsRef.current = freshStats;
    setStats(freshStats);
    setSongTime(0);
    setInfoModal(null);

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
    setShowSpotifyEmbed(false);
    notesRef.current = [];
    feedbacksRef.current = [];
    setSongTime(0);
    setStats(INITIAL_STATS);
    setGameState('TITLE_MENU');
  }, []);

  const handlePauseToggle = useCallback(() => {
    if (gameState === 'PLAYING') {
      grooveEngine.pause();
      if (musicSource === 'spotify') void spotifySdk.pause();
      setGameState('PAUSED');
    } else if (gameState === 'PAUSED') {
      grooveEngine.resume();
      if (musicSource === 'spotify') void spotifySdk.resume();
      setGameState('PLAYING');
    }
  }, [gameState, musicSource]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      grooveEngine.setMuted(next);
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
    cameraActiveLanesRef.current = { LEFT: false, MOUTH: false, RIGHT: false };
    setTelemetry(INITIAL_TELEMETRY);
    setCameraStatus('idle');
    syncActiveLanes();
  }, [syncActiveLanes]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
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
        await videoRef.current.play();
      }
      setCameraStatus('active');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      tracker.dispose();
    };
  }, [startCamera]);

  useEffect(() => {
    let rafId = 0;
    let lastTelemetryPush = 0;
    let lastSongTimePush = 0;

    const tick = (nowMs: number) => {
      if (videoRef.current && trackerRef.current?.isReady() && streamRef.current) {
        const result = trackerRef.current.processVideoFrame(videoRef.current, nowMs);
        if (result) {
          const { mouthThreshold, tiltThreshold } = calibrationRef.current;

          const wasMouth = cameraActiveLanesRef.current.MOUTH;
          const isMouth = wasMouth
            ? result.mouthOpen >= mouthThreshold * 0.76
            : result.mouthOpen >= mouthThreshold;

          const wasLeft = cameraActiveLanesRef.current.LEFT;
          const isLeft = wasLeft
            ? result.headTilt <= -tiltThreshold * 0.72
            : result.headTilt <= -tiltThreshold;

          const wasRight = cameraActiveLanesRef.current.RIGHT;
          const isRight = wasRight
            ? result.headTilt >= tiltThreshold * 0.72
            : result.headTilt >= tiltThreshold;

          if (!wasMouth && isMouth) triggerLaneHit('MOUTH');
          if (!wasLeft && isLeft) triggerLaneHit('LEFT');
          if (!wasRight && isRight) triggerLaneHit('RIGHT');

          cameraActiveLanesRef.current = {
            LEFT: isLeft,
            MOUTH: isMouth,
            RIGHT: isRight,
          };

          if (nowMs - lastTelemetryPush > 32) {
            lastTelemetryPush = nowMs;
            setTelemetry(result);
          }
        }
      }

      syncActiveLanes();

      if (gameStateRef.current === 'PLAYING') {
        const currentSongTime = grooveEngine.getSongTime();
        if (nowMs - lastSongTimePush > 80) {
          lastSongTimePush = nowMs;
          setSongTime(currentSongTime);
        }

        let missedCount = 0;
        for (const note of notesRef.current) {
          if (!note.hit && !note.missed && currentSongTime - note.time > 0.22) {
            note.missed = true;
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

        if (currentSongTime >= durationRef.current) {
          finishRound();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [finishRound, syncActiveLanes, triggerLaneHit]);

  useEffect(() => {
    const mapKeyToLane = (code: string): Lane | null => {
      if (code === 'ArrowLeft' || code === 'KeyA') return 'LEFT';
      if (code === 'Space' || code === 'ArrowUp' || code === 'KeyW') return 'MOUTH';
      if (code === 'ArrowRight' || code === 'KeyD') return 'RIGHT';
      return null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Allow typing normally inside search/link inputs
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Escape' || e.code === 'KeyP') {
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
  }, [handlePauseToggle, infoModal, syncActiveLanes, triggerLaneHit]);

  const handleClearLeaderboard = useCallback(() => {
    setLeaderboard([]);
    try {
      localStorage.removeItem(LEADERBOARD_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const handleSelectSpotifyTrack = useCallback((st: SpotifyTrackOption) => {
    setSelectedSpotifyTrack(st);
    setCustomBpm(st.bpm || 116);
  }, []);

  const handleSelectUploadedTrack = useCallback((ut: UploadedAudioTrack) => {
    setUploadedTrack(ut);
    setCustomBpm(ut.bpm);
  }, []);

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
              onClick={() => setShowCalibration((prev) => !prev)}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Calibration
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

          <div className="flex items-center shrink-0">
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
              showCalibration={showCalibration}
              onToggleCalibration={() => setShowCalibration((prev) => !prev)}
              onChangeCalibration={setCalibration}
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
              selectedSpotifyTrack={selectedSpotifyTrack}
              uploadedTrack={uploadedTrack}
              customBpm={customBpm}
              showSpotifyEmbed={showSpotifyEmbed}
              difficulty={difficulty}
              durationSec={durationSec}
              notesRef={notesRef}
              feedbacksRef={feedbacksRef}
              activeLanes={activeLanes}
              stats={stats}
              songTime={songTime}
              isMuted={isMuted}
              onSelectSource={setMusicSource}
              onSelectSynth={setTrackId}
              onSelectSpotifyTrack={handleSelectSpotifyTrack}
              onSelectUploadedTrack={handleSelectUploadedTrack}
              onChangeCustomBpm={setCustomBpm}
              onSelectDifficulty={setDifficulty}
              onSelectDuration={setDurationSec}
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
          leaderboard={leaderboard}
          onPlayAgain={startGame}
          onBackToMenu={stopRoundToMenu}
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
