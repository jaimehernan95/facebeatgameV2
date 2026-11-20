import React, { useEffect, useRef } from 'react';
import { Pause, Play, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import { grooveEngine } from '../audio/grooveEngine';
import { applyAudioOffset, computeAccuracy, computeMultiplier } from '../game/scoring';
import {
  ActiveMusicMeta,
  BeatNote,
  Difficulty,
  ExternalMediaTrack,
  FavoriteTrackMemory,
  GameState,
  GameStats,
  HitFeedback,
  Lane,
  MusicSource,
  SpotifyTrackOption,
  TrackConfig,
  TrackId,
  UploadedAudioTrack,
} from '../types/game';
import { MusicSourcePanel } from './MusicSourcePanel';

export interface HitParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  createdAt: number;
}

interface RhythmHighwayProps {
  gameState: GameState;
  countdownValue: number;
  activeMusic: ActiveMusicMeta;
  musicSource: MusicSource;
  tracks: TrackConfig[];
  selectedSynthId: TrackId;
  selectedYoutubeTrack: ExternalMediaTrack | null;
  selectedTiktokTrack: ExternalMediaTrack | null;
  selectedSpotifyTrack: SpotifyTrackOption | null;
  uploadedTrack: UploadedAudioTrack | null;
  customBpm: number;
  favorites: FavoriteTrackMemory[];
  currentTrackLiked: boolean;
  audioOffsetMs: number;
  showSpotifyEmbed: boolean;
  youtubeMountRef: React.RefObject<HTMLDivElement | null>;
  youtubeFallbackEmbedId: string | null;
  difficulty: Difficulty;
  durationSec: number;
  notesRef: React.MutableRefObject<BeatNote[]>;
  feedbacksRef: React.MutableRefObject<HitFeedback[]>;
  particlesRef: React.MutableRefObject<HitParticle[]>;
  shakeUntilRef: React.MutableRefObject<number>;
  activeLanes: Record<Lane, boolean>;
  stats: GameStats;
  songTime: number;
  isMuted: boolean;
  onSelectSource: (source: MusicSource) => void;
  onSelectSynth: (id: TrackId) => void;
  onSelectYoutubeTrack: (track: ExternalMediaTrack) => void;
  onSelectTiktokTrack: (track: ExternalMediaTrack) => void;
  onSelectSpotifyTrack: (track: SpotifyTrackOption) => void;
  onSelectUploadedTrack: (track: UploadedAudioTrack) => void;
  onChangeCustomBpm: (bpm: number) => void;
  onToggleSaveCurrentTrack: () => void;
  onLoadFavorite: (track: FavoriteTrackMemory) => void;
  onSelectDifficulty: (d: Difficulty) => void;
  onSelectDuration: (sec: number) => void;
  onStartGame: () => void;
  onPauseToggle: () => void;
  onToggleMute: () => void;
  onManualLaneTrigger: (lane: Lane) => void;
}

export const LANE_ORDER: Lane[] = ['LEFT', 'MOUTH', 'SMILE', 'RIGHT'];

export const LANE_META: Record<
  Lane,
  { label: string; keyHint: string; color: string; darkFill: string; symbol: string; noteLabel: string }
> = {
  LEFT: {
    label: 'Tilt Left',
    keyHint: 'A',
    color: '#38BDF8',
    darkFill: 'rgba(56, 189, 248, 0.14)',
    symbol: '←',
    noteLabel: '← TILT',
  },
  MOUTH: {
    label: 'Open Mouth',
    keyHint: 'S',
    color: '#10B981',
    darkFill: 'rgba(16, 185, 129, 0.14)',
    symbol: 'O',
    noteLabel: 'OPEN!',
  },
  SMILE: {
    label: 'Big Smile',
    keyHint: 'D',
    color: '#FB7185',
    darkFill: 'rgba(251, 113, 133, 0.14)',
    symbol: '◡',
    noteLabel: 'SMILE',
  },
  RIGHT: {
    label: 'Tilt Right',
    keyHint: 'F',
    color: '#F59E0B',
    darkFill: 'rgba(245, 158, 11, 0.14)',
    symbol: '→',
    noteLabel: 'TILT →',
  },
};

export const RhythmHighway: React.FC<RhythmHighwayProps> = ({
  gameState,
  countdownValue,
  activeMusic,
  musicSource,
  tracks,
  selectedSynthId,
  selectedYoutubeTrack,
  selectedTiktokTrack,
  selectedSpotifyTrack,
  uploadedTrack,
  customBpm,
  favorites,
  currentTrackLiked,
  audioOffsetMs,
  showSpotifyEmbed,
  youtubeMountRef,
  youtubeFallbackEmbedId,
  difficulty,
  durationSec,
  notesRef,
  feedbacksRef,
  particlesRef,
  shakeUntilRef,
  activeLanes,
  stats,
  songTime,
  isMuted,
  onSelectSource,
  onSelectSynth,
  onSelectYoutubeTrack,
  onSelectTiktokTrack,
  onSelectSpotifyTrack,
  onSelectUploadedTrack,
  onChangeCustomBpm,
  onToggleSaveCurrentTrack,
  onLoadFavorite,
  onSelectDifficulty,
  onSelectDuration,
  onStartGame,
  onPauseToggle,
  onToggleMute,
  onManualLaneTrigger,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeLanesRef = useRef(activeLanes);
  activeLanesRef.current = activeLanes;

  const activeMusicRef = useRef(activeMusic);
  activeMusicRef.current = activeMusic;

  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  const offsetMsRef = useRef(audioOffsetMs);
  offsetMsRef.current = audioOffsetMs;

  useEffect(() => {
    let rafId = 0;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const targetW = Math.max(300, Math.floor(rect.width * dpr));
        const targetH = Math.max(300, Math.floor(rect.height * dpr));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);

          // Subtle damped screen shake on high-combo PERFECT/GREAT hits
          const nowPerf = performance.now();
          if (!reducedMotion && shakeUntilRef.current > nowPerf) {
            const intensity = ((shakeUntilRef.current - nowPerf) / 140) * 3.5;
            const dx = (Math.random() - 0.5) * 2 * intensity;
            const dy = (Math.random() - 0.5) * 2 * intensity;
            ctx.translate(dx, dy);
          }

          drawHighway(
            ctx,
            rect.width,
            rect.height,
            activeMusicRef.current.bpm,
            offsetMsRef.current,
            gameStateRef.current,
            notesRef.current,
            feedbacksRef.current,
            particlesRef.current,
            activeLanesRef.current
          );
          ctx.restore();
        }
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [notesRef, feedbacksRef, particlesRef, shakeUntilRef]);

  const accuracy = computeAccuracy(stats);
  const multiplier = computeMultiplier(stats.combo);
  const progressPct = Math.min(100, Math.max(0, (songTime / durationSec) * 100));

  const startBlockedByMissingMusic =
    (musicSource === 'youtube' && !selectedYoutubeTrack) ||
    (musicSource === 'tiktok' && !selectedTiktokTrack) ||
    (musicSource === 'spotify' && !selectedSpotifyTrack) ||
    (musicSource === 'upload' && !uploadedTrack);

  return (
    <section
      aria-label="Rhythm Highway"
      className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-full"
    >
      {/* Top Score, Combo Multiplier & Controls HUD */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-5 sm:gap-6">
          <div>
            <div className="text-xs text-slate-400">Score</div>
            <div className="font-mono-tabular text-xl font-bold text-white leading-tight">
              {stats.score.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Combo</div>
            <div className="font-mono-tabular text-xl font-bold text-emerald-400 leading-tight">
              {stats.combo}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Mult</div>
            <div
              className={`font-mono-tabular text-xl font-bold leading-tight ${
                multiplier >= 4
                  ? 'text-amber-400'
                  : multiplier >= 2
                    ? 'text-sky-400'
                    : 'text-slate-300'
              }`}
            >
              {multiplier}x
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Accuracy</div>
            <div className="font-mono-tabular text-xl font-bold text-slate-200 leading-tight">
              {accuracy}%
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {(gameState === 'PLAYING' || gameState === 'PAUSED') && (
            <button
              type="button"
              onClick={onPauseToggle}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              {gameState === 'PAUSED' ? (
                <>
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Song Progress Bar */}
      <div className="h-1.5 w-full bg-slate-950">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-100"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Compact YouTube / YouTube Music Player Bar */}
      {musicSource === 'youtube' && selectedYoutubeTrack && gameState !== 'TITLE_MENU' && (
        <div className="px-3 py-2 bg-slate-950 border-b border-slate-800">
          {youtubeFallbackEmbedId ? (
            <iframe
              title={`YouTube Player: ${selectedYoutubeTrack.title}`}
              src={`https://www.youtube-nocookie.com/embed/${youtubeFallbackEmbedId}?autoplay=1&playsinline=1`}
              width="100%"
              height="88"
              allow="autoplay; encrypted-media; picture-in-picture"
              className="rounded-lg border-0"
            />
          ) : (
            <div ref={youtubeMountRef} className="w-full h-[88px] rounded-lg overflow-hidden bg-slate-900" />
          )}
        </div>
      )}

      {/* Compact TikTok Embed Bar */}
      {musicSource === 'tiktok' && selectedTiktokTrack && gameState !== 'TITLE_MENU' && (
        <div className="px-3 py-2 bg-slate-950 border-b border-slate-800">
          <iframe
            title={`TikTok Player: ${selectedTiktokTrack.title}`}
            src={`https://www.tiktok.com/embed/v2/${selectedTiktokTrack.id}`}
            width="100%"
            height="140"
            allow="autoplay; encrypted-media; picture-in-picture"
            className="rounded-lg border-0"
          />
        </div>
      )}

      {/* Optional Compact Spotify Embed Bar when playing via Spotify Embed */}
      {showSpotifyEmbed && selectedSpotifyTrack && gameState !== 'TITLE_MENU' && (
        <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center gap-3">
          <iframe
            title={`Spotify Player: ${selectedSpotifyTrack.name}`}
            src={`https://open.spotify.com/embed/track/${selectedSpotifyTrack.id}?utm_source=generator&theme=0`}
            width="100%"
            height="80"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="rounded-lg border-0"
          />
        </div>
      )}

      {/* Highway Viewport */}
      <div className="relative flex-1 min-h-[420px] bg-slate-950 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Title Menu Setup Overlay */}
        {gameState === 'TITLE_MENU' && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-5 overflow-y-auto">
            <div className="w-full max-w-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                  Pick Music & Start Moving
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>100% Local Webcam — Zero Video Uploaded</span>
                </span>
              </div>

              <MusicSourcePanel
                musicSource={musicSource}
                tracks={tracks}
                selectedSynthId={selectedSynthId}
                selectedYoutubeTrack={selectedYoutubeTrack}
                selectedTiktokTrack={selectedTiktokTrack}
                selectedSpotifyTrack={selectedSpotifyTrack}
                uploadedTrack={uploadedTrack}
                customBpm={customBpm}
                favorites={favorites}
                currentTrackLiked={currentTrackLiked}
                onSelectSource={onSelectSource}
                onSelectSynth={onSelectSynth}
                onSelectYoutubeTrack={onSelectYoutubeTrack}
                onSelectTiktokTrack={onSelectTiktokTrack}
                onSelectSpotifyTrack={onSelectSpotifyTrack}
                onSelectUploadedTrack={onSelectUploadedTrack}
                onChangeCustomBpm={onChangeCustomBpm}
                onToggleSaveCurrentTrack={onToggleSaveCurrentTrack}
                onLoadFavorite={onLoadFavorite}
              />

              {/* Difficulty & Round Length */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-1.5">Difficulty</div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    {(['chill', 'groove', 'turbo'] as Difficulty[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onSelectDifficulty(d)}
                        className={`py-1.5 text-xs font-semibold rounded-md capitalize transition-colors cursor-pointer ${
                          difficulty === d
                            ? 'bg-emerald-500 text-slate-950'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-slate-400 mb-1.5">Round Length</div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    {[30, 45, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => onSelectDuration(sec)}
                        className={`py-1.5 text-xs font-semibold font-mono-tabular rounded-md transition-colors cursor-pointer ${
                          durationSec === sec
                            ? 'bg-emerald-500 text-slate-950'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onStartGame}
                disabled={startBlockedByMissingMusic}
                className="w-full py-3 px-6 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-display text-base font-bold transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {startBlockedByMissingMusic
                    ? musicSource === 'spotify'
                      ? 'Select or Paste a Spotify Track First'
                      : 'Upload an Audio File First'
                    : 'Start Round'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Countdown Overlay */}
        {gameState === 'COUNTDOWN' && (
          <div className="absolute inset-0 bg-slate-950/55 flex flex-col items-center justify-center pointer-events-none">
            <div className="font-display text-7xl font-extrabold text-white tracking-tight">
              {countdownValue > 0 ? countdownValue : 'GO!'}
            </div>
            <div className="text-sm text-slate-300 mt-2">
              {activeMusic.title} · {activeMusic.bpm} BPM
            </div>
          </div>
        )}

        {/* Paused Overlay */}
        {gameState === 'PAUSED' && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 gap-4">
            <h3 className="font-display text-3xl font-bold text-white">Round Paused</h3>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onPauseToggle}
                className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={onStartGame}
                className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm transition-colors cursor-pointer"
              >
                Restart
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4 Interactive Touch / Keyboard Receptor Pads (A / S / D / F) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-900 border-t border-slate-800">
        {LANE_ORDER.map((lane) => {
          const meta = LANE_META[lane];
          const active = activeLanes[lane];
          return (
            <button
              key={lane}
              type="button"
              onMouseDown={() => onManualLaneTrigger(lane)}
              onTouchStart={(e) => {
                e.preventDefault();
                onManualLaneTrigger(lane);
              }}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-transform duration-75 cursor-pointer select-none ${
                active ? 'scale-[0.98]' : 'hover:bg-slate-800/80'
              }`}
              style={{
                backgroundColor: active ? meta.darkFill : 'rgba(15, 23, 42, 0.7)',
                borderColor: active ? meta.color : 'rgb(30, 41, 59)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono-tabular text-sm font-bold" style={{ color: meta.color }}>
                  {meta.symbol}
                </span>
                <span className="text-xs font-semibold text-slate-100 truncate">{meta.label}</span>
              </div>
              <span className="font-mono-tabular text-[11px] font-bold text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded shrink-0">
                {meta.keyHint}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

function drawHighway(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bpm: number,
  audioOffsetMs: number,
  gameState: GameState,
  notes: BeatNote[],
  feedbacks: HitFeedback[],
  particles: HitParticle[],
  activeLanes: Record<Lane, boolean>
) {
  ctx.clearRect(0, 0, width, height);

  const rawSongTime =
    gameState === 'PLAYING' || gameState === 'PAUSED' ? grooveEngine.getSongTime() : 0;
  const songTime =
    gameState === 'PLAYING' || gameState === 'PAUSED'
      ? applyAudioOffset(rawSongTime, audioOffsetMs)
      : 0;
  const beatPulse = gameState === 'PLAYING' ? grooveEngine.getBeatPulse(bpm) : 0;

  const laneWidth = width / LANE_ORDER.length;
  const hitY = height - 66;
  const lookAheadSec = 1.65;
  const pixelsPerSec = hitY / lookAheadSec;

  LANE_ORDER.forEach((lane, idx) => {
    const x = idx * laneWidth;
    const meta = LANE_META[lane];
    if (activeLanes[lane]) {
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, 'rgba(15, 23, 42, 0)');
      grad.addColorStop(1, meta.darkFill);
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, laneWidth, height);
    }

    if (idx > 0) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  const beatDur = 60 / Math.max(65, bpm);
  const firstBeat = Math.floor(songTime / beatDur);
  const lastBeat = Math.ceil((songTime + lookAheadSec) / beatDur);
  for (let b = firstBeat; b <= lastBeat; b++) {
    const bt = b * beatDur;
    const y = hitY - (bt - songTime) * pixelsPerSec;
    if (y >= 0 && y <= hitY) {
      const isBar = b % 4 === 0;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = isBar ? 'rgba(148, 163, 184, 0.2)' : 'rgba(51, 65, 85, 0.35)';
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.stroke();
    }
  }

  ctx.beginPath();
  ctx.moveTo(0, hitY);
  ctx.lineTo(width, hitY);
  ctx.strokeStyle = `rgba(226, 232, 240, ${0.28 + beatPulse * 0.25})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  LANE_ORDER.forEach((lane, idx) => {
    const cx = idx * laneWidth + laneWidth / 2;
    const meta = LANE_META[lane];
    const isActive = activeLanes[lane];
    const radius = isActive ? 24 + beatPulse * 2 : 21 + beatPulse * 1.5;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, hitY, radius, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? meta.darkFill : 'rgba(15, 23, 42, 0.9)';
    ctx.fill();
    ctx.lineWidth = isActive ? 3 : 2;
    ctx.strokeStyle = isActive ? meta.color : 'rgba(100, 116, 139, 0.7)';
    ctx.stroke();

    ctx.fillStyle = isActive ? meta.color : '#94A3B8';
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.keyHint, cx, hitY);
    ctx.restore();
  });

  for (const note of notes) {
    if (note.hit) continue;
    const dt = note.time - songTime;
    if (dt > lookAheadSec + 0.1 || dt < -0.32) continue;

    const y = hitY - dt * pixelsPerSec;
    const laneIdx = LANE_ORDER.indexOf(note.lane);
    if (laneIdx === -1) continue;
    const cx = laneIdx * laneWidth + laneWidth / 2;
    const meta = LANE_META[note.lane];

    ctx.save();
    const noteW = Math.min(laneWidth * 0.72, 88);
    const noteH = 34;
    const x = cx - noteW / 2;
    const top = y - noteH / 2;

    ctx.globalAlpha = note.missed ? 0.3 : 1;

    ctx.beginPath();
    ctx.roundRect(x, top, noteW, noteH, 8);
    ctx.fillStyle = note.isBonus ? '#FBBF24' : meta.color;
    ctx.fill();

    if (note.isBonus) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#FEF3C7';
      ctx.stroke();
    }

    ctx.fillStyle = '#0B1120';
    ctx.font = '700 11px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = note.isBonus ? `★ ${meta.noteLabel}` : meta.noteLabel;
    ctx.fillText(text, cx, y + 0.5);
    ctx.restore();
  }

  // Particle bursts
  const nowPerf = performance.now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const age = (nowPerf - p.createdAt) / 480;
    if (age >= 1) {
      particles.splice(i, 1);
      continue;
    }
    const px = p.x * width + p.vx * age * 65;
    const py = hitY + p.vy * age * 65;
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.beginPath();
    ctx.arc(px, py, p.size * (1 - age * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();
  }

  // Hit rings & floating judgments
  for (let i = feedbacks.length - 1; i >= 0; i--) {
    const fb = feedbacks[i];
    const age = (nowPerf - fb.createdAt) / 560;
    if (age > 1) {
      feedbacks.splice(i, 1);
      continue;
    }
    if (age < 0) continue;

    const laneIdx = LANE_ORDER.indexOf(fb.lane);
    if (laneIdx === -1) continue;
    const cx = laneIdx * laneWidth + laneWidth / 2;
    const meta = LANE_META[fb.lane];

    ctx.save();
    ctx.globalAlpha = 1 - age;

    if (fb.judgment !== 'MISS') {
      ctx.beginPath();
      ctx.arc(cx, hitY, 24 + age * 30, 0, Math.PI * 2);
      ctx.lineWidth = 3 * (1 - age);
      ctx.strokeStyle = fb.isBonus ? '#FBBF24' : meta.color;
      ctx.stroke();
    }

    const labelY = hitY - 34 - age * 26;
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle =
      fb.judgment === 'PERFECT'
        ? '#34D399'
        : fb.judgment === 'GREAT'
          ? '#FBBF24'
          : fb.judgment === 'GOOD'
            ? '#38BDF8'
            : '#FB7185';
    const labelText = fb.judgment === 'MISS' ? 'MISS' : `${fb.judgment} +${fb.points}`;
    ctx.fillText(labelText, cx, labelY);
    ctx.restore();
  }
}
