import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { generateBeatmap, generateBeatmapFromBpm, getTrackById, TRACKS } from '../src/game/beatmap.ts';
import { isSupportedOEmbedUrl, parseTikTokId, parseYouTubeId } from '../src/game/mediaLinks.ts';
import {
  applyAudioOffset,
  clampAudioOffsetMs,
  computeAccuracy,
  computeGrade,
  computeHitPoints,
  computeMultiplier,
  judgeTiming,
} from '../src/game/scoring.ts';
import {
  buildDefaultUserProfile,
  buildDeterministicTrackVector,
  computeLaneAccuracyMap,
  computeLocalMemoryAnalysis,
  cosineSimilarity,
  toTrackKey,
} from '../src/memory/memoryMath.ts';
import type { Lane } from '../src/types/game.ts';

const VALID_LANES = new Set<Lane>(['LEFT', 'MOUTH', 'SMILE', 'RIGHT']);

test('YouTube, YouTube Music, Shorts, and TikTok URL parsers handle valid and malicious edge cases', () => {
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=xyz'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://evil.example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeId('javascript:alert(1)'), null);

  assert.equal(
    parseTikTokId('https://www.tiktok.com/@creator/video/7312345678901234567?is_from_webapp=1'),
    '7312345678901234567'
  );
  assert.equal(parseTikTokId('https://evil.example.com/@creator/video/7312345678901234567'), null);

  assert.equal(isSupportedOEmbedUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isSupportedOEmbedUrl('https://www.tiktok.com/@user/video/7312345678901234567'), true);
  assert.equal(isSupportedOEmbedUrl('http://169.254.169.254/latest/meta-data'), false);
});

test('generateBeatmapFromBpm handles extreme and invalid BPM/duration edge cases safely', () => {
  const zeroBpm = generateBeatmapFromBpm('edge-zero', 0, 'chill', 30);
  assert.ok(zeroBpm.length > 0, 'Zero BPM should fall back safely and spawn notes');

  const negativeBpm = generateBeatmapFromBpm('edge-neg', -120, 'groove', 30);
  assert.ok(negativeBpm.length > 0, 'Negative BPM should fall back safely');

  const nanBpm = generateBeatmapFromBpm('edge-nan', Number.NaN, 'turbo', 30);
  assert.ok(nanBpm.length > 0, 'NaN BPM should fall back safely');

  const tinyDuration = generateBeatmapFromBpm('edge-short', 120, 'chill', 2);
  assert.ok(Array.isArray(tinyDuration), 'Short duration should return an array without throwing');
  for (const n of tinyDuration) {
    assert.ok(n.time >= 1.5 && n.time <= 6, 'Clamped duration keeps notes bounded');
  }
});

test('beatmaps use all 4 lanes deterministically and prevent instant opposite head-tilt whiplash', () => {
  const track = getTrackById('neon-funk');
  const firstRun = generateBeatmap(track, 'turbo', 45);
  const secondRun = generateBeatmap(track, 'turbo', 45);

  assert.deepEqual(firstRun, secondRun, 'Beatmap generation must be deterministic');
  assert.ok(firstRun.length > 20, 'Turbo 45s beatmap should have sufficient notes');

  const seenLanes = new Set<Lane>();
  let lastTiltLane: Lane | null = null;
  let lastTiltTime = -10;

  for (const note of firstRun) {
    assert.ok(VALID_LANES.has(note.lane), `Unexpected lane: ${note.lane}`);
    seenLanes.add(note.lane);
    assert.ok(note.time >= 1.5 && note.time < 44, `Note time out of bounds: ${note.time}`);

    if (note.lane === 'LEFT' || note.lane === 'RIGHT') {
      if (lastTiltLane && lastTiltLane !== note.lane) {
        assert.ok(
          note.time - lastTiltTime >= 0.37,
          `Opposite tilt whiplash detected (${lastTiltLane} -> ${note.lane} in ${note.time - lastTiltTime}s)`
        );
      }
      lastTiltLane = note.lane;
      lastTiltTime = note.time;
    }
  }

  assert.equal(seenLanes.size, 4, 'All 4 expression lanes should appear in a 45s round');
});

test('custom audio onset beatTimes handles unsorted, duplicate, and out-of-range timestamps', () => {
  const messyBeats = [12.5, -2, 0.5, 2.2, 2.25, 2.2, 5.4, 3.1, 4.0, 6.8, 8.2, 10.1, 99];
  const notes = generateBeatmapFromBpm('upload-test', 120, 'groove', 15, messyBeats);

  assert.ok(notes.length > 0, 'Should generate notes from valid custom beat peaks');
  for (let i = 1; i < notes.length; i++) {
    assert.ok(
      notes[i].time > notes[i - 1].time,
      'Resulting notes must be strictly increasing in time'
    );
    assert.ok(
      notes[i].time - notes[i - 1].time >= 0.37,
      'Minimum groove spacing must filter duplicate onset peaks'
    );
  }
});

test('audio-visual latency offset clamps to [-200, +200] ms and shifts timing cleanly', () => {
  assert.equal(clampAudioOffsetMs(500), 200);
  assert.equal(clampAudioOffsetMs(-500), -200);
  assert.equal(clampAudioOffsetMs(Number.NaN), 0);
  assert.equal(clampAudioOffsetMs(122.6), 123);

  // +120ms Bluetooth delay shifts effective judgment clock 0.12s earlier
  assert.ok(Math.abs(applyAudioOffset(10.0, 120) - 9.88) < 1e-9);
  // -100ms webcam delay shifts effective judgment clock 0.10s later
  assert.ok(Math.abs(applyAudioOffset(10.0, -100) - 10.1) < 1e-9);
  assert.equal(applyAudioOffset(Number.NaN, 50), 0);
});

test('scoring, hit judgments, multipliers, accuracy, and grades cover boundary cases', () => {
  assert.equal(judgeTiming(5.0, 5.05), 'PERFECT');
  assert.equal(judgeTiming(5.0, 5.09), 'GREAT');
  assert.equal(judgeTiming(5.0, 5.16), 'GOOD');
  assert.equal(judgeTiming(5.0, 5.35), null);

  assert.equal(computeMultiplier(0), 1);
  assert.equal(computeMultiplier(7), 1);
  assert.equal(computeMultiplier(8), 2);
  assert.equal(computeMultiplier(16), 3);
  assert.equal(computeMultiplier(100), 4);

  assert.equal(computeHitPoints('PERFECT', 1, false), 300);
  assert.equal(computeHitPoints('PERFECT', 8, true), 1200); // 300 * 2x mult * 2x bonus
  assert.equal(computeHitPoints('GREAT', 1, false), 200);
  assert.equal(computeHitPoints('GOOD', 1, false), 100);

  assert.equal(computeAccuracy({ perfect: 0, great: 0, good: 0, miss: 0 }), 100);
  assert.equal(computeAccuracy({ perfect: 10, great: 0, good: 0, miss: 0 }), 100);
  assert.equal(computeAccuracy({ perfect: 0, great: 0, good: 0, miss: 10 }), 0);

  assert.equal(computeGrade(94), 'S');
  assert.equal(computeGrade(84), 'A');
  assert.equal(computeGrade(70), 'B');
  assert.equal(computeGrade(69), 'C');
});

test('public repo safety: client source never references secret keys or @google/genai', () => {
  const srcDir = path.resolve(process.cwd(), 'src');
  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  };

  const clientFiles = walk(srcDir).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(clientFiles.length > 0);
  assert.ok(TRACKS.length >= 3);

  for (const file of clientFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!content.includes('GEMINI_API_KEY'), `Client file must not reference GEMINI_API_KEY: ${file}`);
    assert.ok(!content.includes('SPOTIFY_CLIENT_SECRET'), `Client file must not reference SPOTIFY_CLIENT_SECRET: ${file}`);
    assert.ok(!content.includes('@google/genai'), `Client file must not import @google/genai: ${file}`);
  }
});

test('memoryMath produces valid Firestore keys, cosine similarity, and facial fitness coach insights', () => {
  const key = toTrackKey('youtube', 'dQw4w9WgXcQ?si=weird/chars!');
  assert.match(key, /^[a-zA-Z0-9_\-]+$/);
  assert.ok(key.length <= 128);

  const v1 = buildDeterministicTrackVector({
    source: 'youtube',
    bpm: 122,
    title: 'Neon Cardio Pop',
    author: 'DJ Test',
  });
  const v2 = buildDeterministicTrackVector({
    source: 'youtube',
    bpm: 124,
    title: 'Neon Cardio Dance',
    author: 'DJ Test',
  });
  assert.ok(cosineSimilarity(v1, v1) > 0.99);
  assert.ok(cosineSimilarity(v1, v2) > 0.85);

  const profile = buildDefaultUserProfile(
    'user_1',
    'Jaime',
    { mouthThreshold: 0.3, smileThreshold: 0.42, tiltThreshold: 0.22, audioOffsetMs: 0 },
    'groove',
    45
  );
  profile.laneSmileHits = 9;
  profile.laneSmileTotal = 10;
  profile.laneLeftHits = 4;
  profile.laneLeftTotal = 10;

  const lanes = computeLaneAccuracyMap(profile);
  assert.equal(lanes.SMILE.accuracy, 90);
  assert.equal(lanes.LEFT.accuracy, 40);

  const analysis = computeLocalMemoryAnalysis(
    profile,
    [
      {
        trackKey: 'youtube_dQw4w9WgXcQ',
        source: 'youtube',
        sourceId: 'dQw4w9WgXcQ',
        title: 'Neon Cardio Pop',
        author: 'DJ Test',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        thumbnail: '',
        bpm: 122,
        liked: true,
        playCount: 3,
        bestScore: 14500,
        tasteVector: v1,
        updatedAtMs: Date.now(),
      },
    ],
    []
  );
  assert.ok(analysis.tasteCentroid.length === 16);
  assert.match(analysis.fitnessCoachTip, /Big Smile/);
  assert.match(analysis.fitnessCoachTip, /Tilt Left/);
});
