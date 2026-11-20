import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CalibrationSettings,
  Difficulty,
  FavoriteTrackMemory,
  FitnessSessionMemory,
  LaneBreakdown,
  MusicSource,
  PeakExpressionTelemetry,
  UserMemoryProfile,
} from '../types/game';
import {
  buildDefaultUserProfile,
  buildDeterministicTrackVector,
  clampNumber,
  normalizeGrade,
  normalizeVector,
  sanitizeString,
  toTrackKey,
} from './memoryMath';

const LOCAL_FAVORITES_KEY = 'facebeat_memory_favorites_v1';
const LOCAL_SESSIONS_KEY = 'facebeat_memory_sessions_v1';
const LOCAL_PROFILE_KEY = 'facebeat_memory_profile_v1';

export function loadLocalFavorites(): FavoriteTrackMemory[] {
  try {
    const raw = localStorage.getItem(LOCAL_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalFavorites(items: FavoriteTrackMemory[]) {
  try {
    localStorage.setItem(LOCAL_FAVORITES_KEY, JSON.stringify(items.slice(0, 40)));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalSessions(): FitnessSessionMemory[] {
  try {
    const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalSessions(items: FitnessSessionMemory[]) {
  try {
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalProfile(
  calibration: CalibrationSettings,
  difficulty: Difficulty,
  durationSec: number
): UserMemoryProfile {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserMemoryProfile>;
      return {
        ...buildDefaultUserProfile('local', 'Local Player', calibration, difficulty, durationSec),
        ...parsed,
      };
    }
  } catch {
    // Fallback
  }
  return buildDefaultUserProfile('local', 'Local Player', calibration, difficulty, durationSec);
}

export function saveLocalProfile(profile: UserMemoryProfile) {
  try {
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore
  }
}

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return Date.now();
}

export async function ensureCloudUserProfile(
  user: User,
  seedCalibration: CalibrationSettings,
  seedDifficulty: Difficulty,
  seedDurationSec: number
): Promise<UserMemoryProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      return {
        ...buildDefaultUserProfile(
          user.uid,
          user.displayName || 'Player',
          seedCalibration,
          seedDifficulty,
          seedDurationSec
        ),
        ...(data as Partial<UserMemoryProfile>),
        uid: user.uid,
      };
    }

    const initial = buildDefaultUserProfile(
      user.uid,
      user.displayName || user.email?.split('@')[0] || 'Player',
      seedCalibration,
      seedDifficulty,
      seedDurationSec
    );

    await setDoc(ref, {
      ...initial,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return initial;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserMemory(
  uid: string,
  onProfile: (profile: UserMemoryProfile) => void,
  onFavorites: (tracks: FavoriteTrackMemory[]) => void,
  onSessions: (sessions: FitnessSessionMemory[]) => void
): () => void {
  const profilePath = `users/${uid}`;
  const unsubProfile = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as Record<string, unknown>;
      onProfile({
        uid,
        displayName: String(d.displayName || 'Player'),
        mouthThreshold: Number(d.mouthThreshold ?? 0.3),
        smileThreshold: Number(d.smileThreshold ?? 0.42),
        tiltThreshold: Number(d.tiltThreshold ?? 0.22),
        audioOffsetMs: Number(d.audioOffsetMs ?? 0),
        preferredDifficulty:
          d.preferredDifficulty === 'groove' || d.preferredDifficulty === 'turbo'
            ? d.preferredDifficulty
            : 'chill',
        preferredDurationSec: Number(d.preferredDurationSec ?? 45),
        totalSessions: Number(d.totalSessions ?? 0),
        bestScore: Number(d.bestScore ?? 0),
        bestCombo: Number(d.bestCombo ?? 0),
        laneLeftHits: Number(d.laneLeftHits ?? 0),
        laneLeftTotal: Number(d.laneLeftTotal ?? 0),
        laneMouthHits: Number(d.laneMouthHits ?? 0),
        laneMouthTotal: Number(d.laneMouthTotal ?? 0),
        laneSmileHits: Number(d.laneSmileHits ?? 0),
        laneSmileTotal: Number(d.laneSmileTotal ?? 0),
        laneRightHits: Number(d.laneRightHits ?? 0),
        laneRightTotal: Number(d.laneRightTotal ?? 0),
        tasteSummary: String(d.tasteSummary || ''),
        fitnessCoachTip: String(d.fitnessCoachTip || ''),
        tasteTags: Array.isArray(d.tasteTags) ? d.tasteTags.map(String) : [],
        tasteCentroid: Array.isArray(d.tasteCentroid) ? d.tasteCentroid.map(Number) : [],
      });
    },
    (error) => handleFirestoreError(error, OperationType.GET, profilePath)
  );

  const favPath = `users/${uid}/favoriteTracks`;
  const favQuery = query(
    collection(db, 'users', uid, 'favoriteTracks'),
    where('uid', '==', uid),
    orderBy('updatedAt', 'desc'),
    limit(30)
  );
  const unsubFavs = onSnapshot(
    favQuery,
    (snapshot) => {
      const tracks: FavoriteTrackMemory[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          trackKey: String(d.trackKey || docSnap.id),
          source: (d.source as MusicSource) || 'synth',
          sourceId: String(d.sourceId || ''),
          title: String(d.title || 'Track'),
          author: String(d.author || 'Unknown'),
          url: String(d.url || ''),
          thumbnail: String(d.thumbnail || ''),
          bpm: Number(d.bpm ?? 116),
          liked: Boolean(d.liked),
          playCount: Number(d.playCount ?? 0),
          bestScore: Number(d.bestScore ?? 0),
          tasteVector: Array.isArray(d.tasteVector) ? d.tasteVector.map(Number) : [],
          updatedAtMs: timestampToMs(d.updatedAt),
        };
      });
      onFavorites(tracks);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, favPath)
  );

  const sessPath = `users/${uid}/sessions`;
  const sessQuery = query(
    collection(db, 'users', uid, 'sessions'),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(30)
  );
  const unsubSess = onSnapshot(
    sessQuery,
    (snapshot) => {
      const items: FitnessSessionMemory[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          id: docSnap.id,
          trackKey: String(d.trackKey || ''),
          trackTitle: String(d.trackTitle || 'Track'),
          source: (d.source as MusicSource) || 'synth',
          bpm: Number(d.bpm ?? 116),
          difficulty:
            d.difficulty === 'groove' || d.difficulty === 'turbo' ? d.difficulty : 'chill',
          durationSec: Number(d.durationSec ?? 45),
          score: Number(d.score ?? 0),
          accuracy: Number(d.accuracy ?? 0),
          maxCombo: Number(d.maxCombo ?? 0),
          grade: normalizeGrade(String(d.grade || 'C')),
          leftHits: Number(d.leftHits ?? 0),
          leftTotal: Number(d.leftTotal ?? 0),
          mouthHits: Number(d.mouthHits ?? 0),
          mouthTotal: Number(d.mouthTotal ?? 0),
          smileHits: Number(d.smileHits ?? 0),
          smileTotal: Number(d.smileTotal ?? 0),
          rightHits: Number(d.rightHits ?? 0),
          rightTotal: Number(d.rightTotal ?? 0),
          peakMouth: Number(d.peakMouth ?? 0),
          peakSmile: Number(d.peakSmile ?? 0),
          peakTilt: Number(d.peakTilt ?? 0),
          createdAtMs: timestampToMs(d.createdAt),
        };
      });
      onSessions(items);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, sessPath)
  );

  return () => {
    unsubProfile();
    unsubFavs();
    unsubSess();
  };
}

export async function saveCalibrationToCloud(
  uid: string,
  displayName: string,
  calibration: CalibrationSettings,
  difficulty: Difficulty,
  durationSec: number
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: sanitizeString(displayName, 120, 'Player'),
      mouthThreshold: clampNumber(calibration.mouthThreshold, 0.05, 0.95, 0.3),
      smileThreshold: clampNumber(calibration.smileThreshold, 0.05, 0.95, 0.42),
      tiltThreshold: clampNumber(calibration.tiltThreshold, 0.05, 0.95, 0.22),
      audioOffsetMs: Math.round(clampNumber(calibration.audioOffsetMs, -200, 200, 0)),
      preferredDifficulty: difficulty,
      preferredDurationSec: Math.round(clampNumber(durationSec, 15, 180, 45)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertFavoriteTrackInCloud(
  uid: string,
  track: {
    source: MusicSource;
    sourceId: string;
    title: string;
    author: string;
    url: string;
    thumbnail: string;
    bpm: number;
    liked?: boolean;
    incrementPlay?: boolean;
    roundScore?: number;
    tasteVector?: number[];
  }
): Promise<void> {
  const trackKey = toTrackKey(track.source, track.sourceId);
  const path = `users/${uid}/favoriteTracks/${trackKey}`;
  const ref = doc(db, 'users', uid, 'favoriteTracks', trackKey);
  const safeBpm = Math.round(clampNumber(track.bpm, 40, 220, 116));
  const safeTitle = sanitizeString(track.title, 200, 'Groove Track');
  const safeAuthor = sanitizeString(track.author, 150, 'Creator');
  const safeThumb = sanitizeString(track.thumbnail, 500, '');
  const safeVec =
    track.tasteVector && track.tasteVector.length > 0
      ? normalizeVector(track.tasteVector, 32)
      : buildDeterministicTrackVector({
          source: track.source,
          bpm: safeBpm,
          title: safeTitle,
          author: safeAuthor,
        });

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        trackKey,
        source: track.source,
        sourceId: sanitizeString(track.sourceId, 200, trackKey),
        title: safeTitle,
        author: safeAuthor,
        url: sanitizeString(track.url, 500, ''),
        thumbnail: safeThumb,
        bpm: safeBpm,
        liked: Boolean(track.liked),
        playCount: track.incrementPlay ? 1 : 0,
        bestScore: Math.max(0, Math.round(track.roundScore ?? 0)),
        tasteVector: safeVec,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const prev = snap.data() as Record<string, unknown>;
    if (track.incrementPlay || typeof track.roundScore === 'number') {
      // Action 2: Record play count & track high score
      await updateDoc(ref, {
        playCount: Number(prev.playCount ?? 0) + (track.incrementPlay ? 1 : 0),
        bestScore: Math.max(Number(prev.bestScore ?? 0), Math.round(track.roundScore ?? 0)),
        bpm: safeBpm,
        tasteVector: safeVec,
        updatedAt: serverTimestamp(),
      });
    } else {
      // Action 1: Toggle liked / update BPM or metadata
      await updateDoc(ref, {
        liked: typeof track.liked === 'boolean' ? track.liked : Boolean(prev.liked),
        bpm: safeBpm,
        title: safeTitle,
        author: safeAuthor,
        thumbnail: safeThumb,
        tasteVector: safeVec,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFavoriteTrackFromCloud(uid: string, trackKey: string): Promise<void> {
  const path = `users/${uid}/favoriteTracks/${trackKey}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'favoriteTracks', trackKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordSessionToCloud(
  uid: string,
  prevProfile: UserMemoryProfile,
  sessionInput: {
    source: MusicSource;
    sourceId: string;
    trackTitle: string;
    bpm: number;
    difficulty: Difficulty;
    durationSec: number;
    score: number;
    accuracy: number;
    maxCombo: number;
    grade: string;
    laneBreakdown: LaneBreakdown;
    peaks: PeakExpressionTelemetry;
  }
): Promise<void> {
  const trackKey = toTrackKey(sessionInput.source, sessionInput.sourceId);
  const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const sessionPath = `users/${uid}/sessions/${sessionId}`;

  const leftHits = Math.max(0, sessionInput.laneBreakdown.LEFT.hits);
  const leftTotal = Math.max(leftHits, sessionInput.laneBreakdown.LEFT.total);
  const mouthHits = Math.max(0, sessionInput.laneBreakdown.MOUTH.hits);
  const mouthTotal = Math.max(mouthHits, sessionInput.laneBreakdown.MOUTH.total);
  const smileHits = Math.max(0, sessionInput.laneBreakdown.SMILE.hits);
  const smileTotal = Math.max(smileHits, sessionInput.laneBreakdown.SMILE.total);
  const rightHits = Math.max(0, sessionInput.laneBreakdown.RIGHT.hits);
  const rightTotal = Math.max(rightHits, sessionInput.laneBreakdown.RIGHT.total);

  try {
    await setDoc(doc(db, 'users', uid, 'sessions', sessionId), {
      uid,
      trackKey,
      trackTitle: sanitizeString(sessionInput.trackTitle, 200, 'Groove Track'),
      source: sessionInput.source,
      bpm: Math.round(clampNumber(sessionInput.bpm, 40, 220, 116)),
      difficulty: sessionInput.difficulty,
      durationSec: Math.round(clampNumber(sessionInput.durationSec, 15, 180, 45)),
      score: Math.max(0, Math.round(sessionInput.score)),
      accuracy: Math.round(clampNumber(sessionInput.accuracy, 0, 100, 0)),
      maxCombo: Math.max(0, Math.round(sessionInput.maxCombo)),
      grade: normalizeGrade(sessionInput.grade),
      leftHits,
      leftTotal,
      mouthHits,
      mouthTotal,
      smileHits,
      smileTotal,
      rightHits,
      rightTotal,
      peakMouth: Number(clampNumber(sessionInput.peaks.mouth, 0, 1, 0).toFixed(3)),
      peakSmile: Number(clampNumber(sessionInput.peaks.smile, 0, 1, 0).toFixed(3)),
      peakTilt: Number(clampNumber(sessionInput.peaks.tilt, 0, 1, 0).toFixed(3)),
      createdAt: serverTimestamp(),
    });

    // Action 2 on users/{uid}: Update running fitness aggregates
    await updateDoc(doc(db, 'users', uid), {
      totalSessions: prevProfile.totalSessions + 1,
      bestScore: Math.max(prevProfile.bestScore, Math.round(sessionInput.score)),
      bestCombo: Math.max(prevProfile.bestCombo, Math.round(sessionInput.maxCombo)),
      laneLeftHits: prevProfile.laneLeftHits + leftHits,
      laneLeftTotal: prevProfile.laneLeftTotal + leftTotal,
      laneMouthHits: prevProfile.laneMouthHits + mouthHits,
      laneMouthTotal: prevProfile.laneMouthTotal + mouthTotal,
      laneSmileHits: prevProfile.laneSmileHits + smileHits,
      laneSmileTotal: prevProfile.laneSmileTotal + smileTotal,
      laneRightHits: prevProfile.laneRightHits + rightHits,
      laneRightTotal: prevProfile.laneRightTotal + rightTotal,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, sessionPath);
  }
}

export async function updateAiAnalysisInCloud(
  uid: string,
  tasteSummary: string,
  fitnessCoachTip: string,
  tasteTags: string[],
  tasteCentroid: number[]
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      tasteSummary: sanitizeString(tasteSummary, 600, 'Personalized taste profile ready.'),
      fitnessCoachTip: sanitizeString(fitnessCoachTip, 600, 'Keep training all 4 facial expressions!'),
      tasteTags: tasteTags
        .slice(0, 12)
        .map((t) => sanitizeString(t, 40, ''))
        .filter(Boolean),
      tasteCentroid: normalizeVector(tasteCentroid, 32),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
