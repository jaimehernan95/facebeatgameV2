import { BeatNote, Difficulty, Lane, TrackConfig, TrackId } from '../types/game';

export const TRACKS: TrackConfig[] = [
  {
    id: 'neon-funk',
    title: 'Neon Funk',
    subtitle: 'Upbeat synth bass & crisp 4-on-the-floor groove',
    bpm: 112,
    accentColor: '#10B981',
    rootMidi: 48,
    scaleIntervals: [0, 3, 5, 7, 10, 12, 15, 17],
    progression: [
      [60, 63, 67, 70],
      [56, 60, 63, 67],
      [58, 62, 65, 68],
      [55, 59, 62, 67],
    ],
    bassPattern: [0, null, 0, null, 3, null, 4, null, 0, null, 2, 3, 4, null, 5, null],
    leadPattern: [null, null, 5, null, null, 4, null, 3, null, null, 6, null, 5, null, 4, null],
    swing: 0.04,
  },
  {
    id: 'arcade-pulse',
    title: 'Arcade Pulse',
    subtitle: 'High-energy chiptune arpeggios & punchy snare',
    bpm: 124,
    accentColor: '#38BDF8',
    rootMidi: 45,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10, 12],
    progression: [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [60, 64, 67, 72],
      [55, 59, 62, 67],
    ],
    bassPattern: [0, 0, 7, null, 0, 0, 5, null, 0, 0, 7, 5, 4, null, 3, null],
    leadPattern: [7, null, 5, 4, 7, null, 6, null, 7, 5, 4, 2, 3, null, 5, null],
    swing: 0,
  },
  {
    id: 'sunset-lofi',
    title: 'Sunset Bounce',
    subtitle: 'Warm electric piano chords & relaxed swing',
    bpm: 96,
    accentColor: '#F59E0B',
    rootMidi: 50,
    scaleIntervals: [0, 2, 4, 7, 9, 12, 14, 16],
    progression: [
      [62, 66, 69, 73],
      [59, 62, 66, 69],
      [55, 59, 62, 66],
      [57, 61, 64, 67],
    ],
    bassPattern: [0, null, null, 0, null, 4, null, null, 2, null, null, 4, 5, null, 3, null],
    leadPattern: [null, 5, null, null, 6, null, 5, null, null, 4, null, 2, null, 3, null, null],
    swing: 0.08,
  },
];

export function getTrackById(id: TrackId): TrackConfig {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateBeatmap(
  track: TrackConfig,
  difficulty: Difficulty,
  durationSec: number
): BeatNote[] {
  return generateBeatmapFromBpm(track.id, track.bpm, difficulty, durationSec);
}

export function generateBeatmapFromBpm(
  sourceId: string,
  bpm: number,
  difficulty: Difficulty,
  durationSec: number,
  customBeatTimes?: number[]
): BeatNote[] {
  const validBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 112;
  const safeBpm = Math.max(65, Math.min(175, validBpm));
  const safeDuration = Number.isFinite(durationSec) ? Math.max(6, Math.min(300, durationSec)) : 45;
  const beatDur = 60 / safeBpm;

  const diffOffset: Record<Difficulty, number> = {
    chill: 1,
    groove: 2,
    turbo: 3,
  };
  const rng = createRng(hashString(sourceId || 'track') + diffOffset[difficulty] * 17 + safeDuration);

  const notes: BeatNote[] = [];
  const endTime = safeDuration - 1.4;

  // 4-lane musical phrase motifs
  const motifs: Lane[][] = [
    ['MOUTH', 'LEFT', 'SMILE', 'RIGHT'],
    ['LEFT', 'MOUTH', 'RIGHT', 'SMILE'],
    ['MOUTH', 'SMILE', 'LEFT', 'RIGHT'],
    ['RIGHT', 'SMILE', 'MOUTH', 'LEFT'],
  ];

  let lastLane: Lane = 'MOUTH';
  let lastTiltTime = -10;
  let noteIndex = 0;

  if (customBeatTimes && customBeatTimes.length > 6) {
    const sortedTimes = [...customBeatTimes].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
    const minSpacing = difficulty === 'chill' ? 0.65 : difficulty === 'groove' ? 0.38 : 0.26;
    let lastSpawnedTime = 1.6;

    for (const rawTime of sortedTimes) {
      if (rawTime < 1.8 || rawTime > endTime) continue;
      if (rawTime - lastSpawnedTime < minSpacing) continue;

      const motif = motifs[Math.floor(noteIndex / 4) % motifs.length];
      let lane: Lane = motif[noteIndex % motif.length];
      if (rng() > 0.68) {
        const r = rng();
        if (r < 0.32) lane = 'MOUTH';
        else if (r < 0.58) lane = 'SMILE';
        else if (r < 0.79) lane = 'LEFT';
        else lane = 'RIGHT';
      }

      const minTiltCooldown = difficulty === 'turbo' ? 0.38 : 0.55;
      if ((lane === 'LEFT' || lane === 'RIGHT') && lane !== lastLane && rawTime - lastTiltTime < minTiltCooldown) {
        lane = lastLane === 'MOUTH' ? 'SMILE' : 'MOUTH';
      }
      if (lane === 'LEFT' || lane === 'RIGHT') lastTiltTime = rawTime;
      lastLane = lane;

      const isBonus = noteIndex > 2 && noteIndex % 8 === 0;
      notes.push({
        id: `${sourceId}-${noteIndex}`,
        lane,
        time: rawTime,
        isBonus,
        hit: false,
        missed: false,
      });
      lastSpawnedTime = rawTime;
      noteIndex++;
    }
    return notes;
  }

  const startBeat = Math.ceil(2.0 / beatDur);
  const stepInBeats = difficulty === 'chill' ? 1 : 0.5;
  let beat = startBeat;

  while (beat * beatDur < endTime) {
    const time = beat * beatDur;
    const barIndex = Math.floor(beat / 4);
    const beatInBar = beat % 4;
    const isWholeBeat = Math.abs(beatInBar - Math.round(beatInBar)) < 0.01;

    let shouldSpawn = false;
    if (difficulty === 'chill') {
      shouldSpawn = isWholeBeat && (beatInBar === 0 || beatInBar === 2 || rng() > 0.35);
    } else if (difficulty === 'groove') {
      shouldSpawn = isWholeBeat ? rng() > 0.12 : rng() > 0.68;
    } else {
      shouldSpawn = isWholeBeat ? rng() > 0.06 : rng() > 0.42;
    }

    if (shouldSpawn) {
      const motif = motifs[barIndex % motifs.length];
      let lane: Lane = motif[Math.floor(beatInBar) % motif.length];

      if (!isWholeBeat || rng() > 0.72) {
        const roll = rng();
        if (roll < 0.32) lane = 'MOUTH';
        else if (roll < 0.58) lane = 'SMILE';
        else if (roll < 0.79) lane = 'LEFT';
        else lane = 'RIGHT';
      }

      const minTiltCooldown = difficulty === 'turbo' ? 0.38 : 0.55;
      if ((lane === 'LEFT' || lane === 'RIGHT') && lane !== lastLane && time - lastTiltTime < minTiltCooldown) {
        lane = lastLane === 'MOUTH' ? 'SMILE' : 'MOUTH';
      }

      if (lane === 'LEFT' || lane === 'RIGHT') {
        lastTiltTime = time;
      }
      lastLane = lane;

      const isBonus = isWholeBeat && beatInBar === 0 && noteIndex > 2 && noteIndex % 4 === 0;

      notes.push({
        id: `${sourceId}-${noteIndex}`,
        lane,
        time,
        isBonus,
        hit: false,
        missed: false,
      });
      noteIndex++;
    }

    beat += stepInBeats;
  }

  return notes;
}
