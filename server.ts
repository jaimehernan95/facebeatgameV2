import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { generateBeatmapFromBpm } from './src/game/beatmap.ts';
import { isSupportedOEmbedUrl } from './src/game/mediaLinks.ts';
import { computeLocalMemoryAnalysis, normalizeVector } from './src/memory/memoryMath.ts';
import type {
  BeatNote,
  Difficulty,
  FavoriteTrackMemory,
  FitnessSessionMemory,
  Lane,
  UserMemoryProfile,
} from './src/types/game.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = 'facebeat_spotify_sid';

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

interface SpotifySession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: {
    id: string;
    displayName: string;
    product: string;
  } | null;
}

const sessions = new Map<string, SpotifySession>();
const pendingStates = new Set<string>();

function getAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (raw && raw !== 'MY_APP_URL') {
    return raw.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

function getRedirectUri(): string {
  return `${getAppUrl()}/auth/spotify/callback`;
}

function isSpotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim());
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

function getSessionFromReq(req: Request): { sid: string; session: SpotifySession } | null {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  return { sid, session };
}

async function ensureFreshToken(session: SpotifySession): Promise<string | null> {
  if (Date.now() < session.expiresAt - 60_000) {
    return session.accessToken;
  }
  if (!session.refreshToken || !isSpotifyConfigured()) {
    return null;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!.trim();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  session.accessToken = data.access_token;
  session.expiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) {
    session.refreshToken = data.refresh_token;
  }
  return session.accessToken;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // 1. Spotify configuration & connection status
  app.get('/api/spotify/status', async (req: Request, res: Response) => {
    const configured = isSpotifyConfigured();
    const found = getSessionFromReq(req);
    if (!found) {
      res.json({
        configured,
        connected: false,
        user: null,
        redirectUri: getRedirectUri(),
      });
      return;
    }

    const token = await ensureFreshToken(found.session);
    if (!token) {
      sessions.delete(found.sid);
      res.json({
        configured,
        connected: false,
        user: null,
        redirectUri: getRedirectUri(),
      });
      return;
    }

    res.json({
      configured,
      connected: true,
      user: found.session.user,
      redirectUri: getRedirectUri(),
    });
  });

  // 2. Construct Spotify Authorization URL for popup
  app.get('/api/spotify/auth-url', (_req: Request, res: Response) => {
    if (!isSpotifyConfigured()) {
      res.status(400).json({
        error: 'Spotify Client ID and Secret are not configured.',
        redirectUri: getRedirectUri(),
      });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);
    // Prune stale states if set grows
    if (pendingStates.size > 200) {
      const oldest = pendingStates.values().next().value;
      if (oldest) pendingStates.delete(oldest);
    }

    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID!.trim(),
      response_type: 'code',
      redirect_uri: getRedirectUri(),
      state,
      scope: [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-library-read',
        'playlist-read-private',
        'user-read-playback-state',
        'user-modify-playback-state',
      ].join(' '),
      show_dialog: 'true',
    });

    res.json({
      url: `https://accounts.spotify.com/authorize?${params.toString()}`,
    });
  });

  // 3. Spotify OAuth Callback (handles both with and without trailing slash)
  const callbackHandler = async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';

    const sendPopupResult = (type: 'SPOTIFY_AUTH_SUCCESS' | 'SPOTIFY_AUTH_ERROR', message?: string) => {
      const payload = JSON.stringify({ type, error: message || null });
      res.send(`<!doctype html>
<html>
  <body style="background:#0b1120;color:#f1f5f9;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
    <div style="text-align:center;padding:24px;">
      <p style="font-size:15px;">${type === 'SPOTIFY_AUTH_SUCCESS' ? 'Spotify connected. Closing window...' : `Spotify connection failed: ${message || 'Unknown error'}`}</p>
    </div>
    <script>
      try {
        if (window.opener) {
          window.opener.postMessage(${payload}, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      } catch (e) {
        window.location.href = '/';
      }
    </script>
  </body>
</html>`);
    };

    if (error || !code) {
      sendPopupResult('SPOTIFY_AUTH_ERROR', error || 'Authorization cancelled');
      return;
    }

    if (!state || !pendingStates.has(state)) {
      sendPopupResult('SPOTIFY_AUTH_ERROR', 'Invalid OAuth state');
      return;
    }
    pendingStates.delete(state);

    if (!isSpotifyConfigured()) {
      sendPopupResult('SPOTIFY_AUTH_ERROR', 'Spotify credentials not configured');
      return;
    }

    try {
      const clientId = process.env.SPOTIFY_CLIENT_ID!.trim();
      const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!.trim();
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: getRedirectUri(),
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        sendPopupResult('SPOTIFY_AUTH_ERROR', `Token exchange failed (${tokenRes.status}): ${errBody.slice(0, 80)}`);
        return;
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      let userInfo: SpotifySession['user'] = null;
      const meRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          id: string;
          display_name?: string;
          product?: string;
        };
        userInfo = {
          id: me.id,
          displayName: me.display_name || me.id,
          product: me.product || 'free',
        };
      }

      const sid = crypto.randomUUID();
      sessions.set(sid, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        user: userInfo,
      });

      res.cookie(COOKIE_NAME, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      sendPopupResult('SPOTIFY_AUTH_SUCCESS');
    } catch (err) {
      sendPopupResult('SPOTIFY_AUTH_ERROR', err instanceof Error ? err.message : 'OAuth error');
    }
  };

  app.get(['/auth/spotify/callback', '/auth/spotify/callback/'], callbackHandler);

  // 4. Disconnect Spotify session
  app.post('/api/spotify/logout', (req: Request, res: Response) => {
    const found = getSessionFromReq(req);
    if (found) {
      sessions.delete(found.sid);
    }
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
    res.json({ ok: true });
  });

  // 5. Short-lived Access Token for Spotify Web Playback SDK
  app.get('/api/spotify/token', async (req: Request, res: Response) => {
    const found = getSessionFromReq(req);
    if (!found) {
      res.status(401).json({ error: 'Not connected to Spotify' });
      return;
    }
    const token = await ensureFreshToken(found.session);
    if (!token) {
      res.status(401).json({ error: 'Spotify session expired' });
      return;
    }
    res.json({ accessToken: token });
  });

  // 6. Search Spotify tracks
  app.get('/api/spotify/search', async (req: Request, res: Response) => {
    const found = getSessionFromReq(req);
    if (!found) {
      res.status(401).json({ error: 'Not connected to Spotify' });
      return;
    }
    const token = await ensureFreshToken(found.session);
    if (!token) {
      res.status(401).json({ error: 'Spotify session expired' });
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.json({ tracks: [] });
      return;
    }

    try {
      const searchRes = await fetch(
        `https://api.spotify.com/v1/search?${new URLSearchParams({
          q,
          type: 'track',
          limit: '8',
        }).toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!searchRes.ok) {
        res.status(searchRes.status).json({ error: 'Spotify search failed' });
        return;
      }

      const payload = (await searchRes.json()) as {
        tracks?: {
          items: Array<{
            id: string;
            name: string;
            uri: string;
            duration_ms: number;
            preview_url: string | null;
            artists: Array<{ name: string }>;
            album: { name: string; images: Array<{ url: string }> };
          }>;
        };
      };

      const items = payload.tracks?.items ?? [];
      const tracks = items.map((item) => ({
        id: item.id,
        name: item.name,
        artist: item.artists.map((a) => a.name).join(', '),
        albumArt: item.album.images[1]?.url || item.album.images[0]?.url || '',
        uri: item.uri,
        durationSec: Math.round(item.duration_ms / 1000),
        previewUrl: item.preview_url,
        bpm: 116,
      }));

      res.json({ tracks });
    } catch {
      res.status(500).json({ error: 'Failed to search Spotify' });
    }
  });

  // 7. Fetch user's Liked / Saved Tracks from Spotify
  app.get('/api/spotify/library', async (req: Request, res: Response) => {
    const found = getSessionFromReq(req);
    if (!found) {
      res.status(401).json({ error: 'Not connected to Spotify' });
      return;
    }
    const token = await ensureFreshToken(found.session);
    if (!token) {
      res.status(401).json({ error: 'Spotify session expired' });
      return;
    }

    try {
      const libRes = await fetch('https://api.spotify.com/v1/me/tracks?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!libRes.ok) {
        res.json({ tracks: [] });
        return;
      }
      const payload = (await libRes.json()) as {
        items?: Array<{
          track: {
            id: string;
            name: string;
            uri: string;
            duration_ms: number;
            preview_url: string | null;
            artists: Array<{ name: string }>;
            album: { images: Array<{ url: string }> };
          };
        }>;
      };

      const tracks = (payload.items ?? []).map(({ track }) => ({
        id: track.id,
        name: track.name,
        artist: track.artists.map((a) => a.name).join(', '),
        albumArt: track.album.images[1]?.url || track.album.images[0]?.url || '',
        uri: track.uri,
        durationSec: Math.round(track.duration_ms / 1000),
        previewUrl: track.preview_url,
        bpm: 116,
      }));
      res.json({ tracks });
    } catch {
      res.json({ tracks: [] });
    }
  });

  // 8. Public health / capability check (never exposes secrets)
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiEnabled: Boolean(getGeminiClient()),
      spotifyEnabled: isSpotifyConfigured(),
    });
  });

  // 8b. Zero-key oEmbed metadata lookup for YouTube / YouTube Music / TikTok links
  app.get('/api/media/oembed', async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl || !isSupportedOEmbedUrl(rawUrl)) {
      res.status(400).json({ error: 'Unsupported media URL' });
      return;
    }

    try {
      const parsed = new URL(rawUrl);
      const isTikTok = parsed.hostname.toLowerCase().includes('tiktok.com');
      const endpoint = isTikTok
        ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(rawUrl)}`
        : `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`;

      const upstream = await fetch(endpoint);
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: 'Metadata unavailable for this link' });
        return;
      }
      const data = (await upstream.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
        html?: string;
      };
      res.json({
        title: data.title || (isTikTok ? 'TikTok Track' : 'YouTube Track'),
        author: data.author_name || (isTikTok ? 'TikTok Creator' : 'YouTube'),
        thumbnail: data.thumbnail_url || '',
        html: data.html || '',
      });
    } catch {
      res.status(502).json({ error: 'Could not resolve link metadata' });
    }
  });

  // 9. Optional server-side Gemini beatmap choreographer with automatic procedural fallback
  app.post('/api/beatmap/generate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      trackId?: string;
      title?: string;
      bpm?: number;
      difficulty?: Difficulty;
      durationSec?: number;
    };

    const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : 'custom';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Groove Track';
    const bpm = typeof body.bpm === 'number' && Number.isFinite(body.bpm) ? Math.max(65, Math.min(175, body.bpm)) : 112;
    const difficulty: Difficulty =
      body.difficulty === 'groove' || body.difficulty === 'turbo' ? body.difficulty : 'chill';
    const durationSec =
      typeof body.durationSec === 'number' && Number.isFinite(body.durationSec)
        ? Math.max(15, Math.min(180, body.durationSec))
        : 45;

    const fallbackNotes = generateBeatmapFromBpm(trackId, bpm, difficulty, durationSec);
    const ai = getGeminiClient();
    if (!ai) {
      res.json({ source: 'procedural', notes: fallbackNotes });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Choreograph a 4-lane facial rhythm pattern for "${title}" at ${bpm} BPM (${difficulty} difficulty, ${durationSec}s). Choose lane sequences from LEFT, MOUTH, SMILE, RIGHT that feel danceable and avoid rapid consecutive LEFT/RIGHT reversals.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pattern: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Ordered sequence of lanes using only LEFT, MOUTH, SMILE, RIGHT.',
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as { pattern?: unknown };
      const validLanes = new Set<Lane>(['LEFT', 'MOUTH', 'SMILE', 'RIGHT']);
      const pattern = Array.isArray(parsed.pattern)
        ? parsed.pattern.filter((item): item is Lane => typeof item === 'string' && validLanes.has(item as Lane))
        : [];

      if (pattern.length < 4) {
        res.json({ source: 'procedural', notes: fallbackNotes });
        return;
      }

      const choreographed: BeatNote[] = fallbackNotes.map((note, idx) => ({
        ...note,
        lane: pattern[idx % pattern.length],
      }));
      res.json({ source: 'gemini', notes: choreographed });
    } catch {
      res.json({ source: 'procedural', notes: fallbackNotes });
    }
  });

  // 10. Persistent Memory AI Taste Vector & Facial Fitness Coach
  app.post('/api/memory/analyze', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      profile?: UserMemoryProfile;
      favorites?: FavoriteTrackMemory[];
      sessions?: FitnessSessionMemory[];
    };

    if (!body.profile) {
      res.status(400).json({ error: 'Missing user profile payload' });
      return;
    }

    const favorites = Array.isArray(body.favorites) ? body.favorites.slice(0, 20) : [];
    const sessions = Array.isArray(body.sessions) ? body.sessions.slice(0, 20) : [];
    const localResult = computeLocalMemoryAnalysis(body.profile, favorites, sessions);

    const ai = getGeminiClient();
    if (!ai || (favorites.length === 0 && sessions.length === 0)) {
      res.json(localResult);
      return;
    }

    try {
      // 1. Generate compact semantic taste vectors via gemini-embedding-2
      const trackVectors: Record<string, number[]> = { ...localResult.trackVectors };
      let tasteCentroid = localResult.tasteCentroid;

      try {
        const tasteTexts = favorites.slice(0, 8).map(
          (f) => `${f.source} music: "${f.title}" by ${f.author}, ${f.bpm} BPM, ${f.liked ? 'liked favorite' : 'played'}, best score ${f.bestScore}`
        );
        if (tasteTexts.length > 0) {
          const embedRes = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: tasteTexts,
          });
          const embeddings = embedRes.embeddings ?? [];
          const centroidAcc = new Array<number>(32).fill(0);
          let weightSum = 0;

          favorites.slice(0, embeddings.length).forEach((fav, idx) => {
            const values = embeddings[idx]?.values;
            if (Array.isArray(values) && values.length > 0) {
              const compact = normalizeVector(values, 32);
              trackVectors[fav.trackKey] = compact;
              const weight = (fav.liked ? 2.5 : 1) + Math.min(3, fav.playCount * 0.4);
              for (let d = 0; d < compact.length; d++) {
                centroidAcc[d] += compact[d] * weight;
              }
              weightSum += weight;
            }
          });

          if (weightSum > 0) {
            tasteCentroid = normalizeVector(centroidAcc, 32);
          }
        }
      } catch {
        // Keep deterministic vector fallback if embedding quota/call fails
      }

      // 2. Generate personalized music taste understanding & facial fitness coaching
      const laneSummary = {
        tiltLeft: { hits: body.profile.laneLeftHits, total: body.profile.laneLeftTotal },
        openMouth: { hits: body.profile.laneMouthHits, total: body.profile.laneMouthTotal },
        bigSmile: { hits: body.profile.laneSmileHits, total: body.profile.laneSmileTotal },
        tiltRight: { hits: body.profile.laneRightHits, total: body.profile.laneRightTotal },
      };

      const prompt = `Analyze this FaceBeat Arcade player's saved music memory and facial fitness performance.
Saved Tracks (${favorites.length}): ${JSON.stringify(
        favorites.slice(0, 10).map((f) => ({
          source: f.source,
          title: f.title,
          author: f.author,
          bpm: f.bpm,
          liked: f.liked,
          plays: f.playCount,
          bestScore: f.bestScore,
        }))
      )}
Recent Sessions (${sessions.length}): ${JSON.stringify(
        sessions.slice(0, 8).map((s) => ({
          title: s.trackTitle,
          source: s.source,
          bpm: s.bpm,
          score: s.score,
          accuracy: s.accuracy,
          grade: s.grade,
        }))
      )}
Cumulative Facial Fitness Lane Stats: ${JSON.stringify(laneSummary)}
Current Calibration: mouth=${body.profile.mouthThreshold}, smile=${body.profile.smileThreshold}, tilt=${body.profile.tiltThreshold}, offsetMs=${body.profile.audioOffsetMs}.

Return concise JSON:
1. tasteSummary (1-2 sentences describing music genres, artists/creators, BPM sweet spot, and platforms like YouTube/TikTok they enjoy).
2. fitnessCoachTip (1-2 actionable sentences pointing out their strongest facial expression vs weakest expression and how to improve facial mobility/timing or calibration).
3. tasteTags (3-6 short tags).
4. recommendedQueries (3 concrete YouTube / TikTok / Synth track ideas tailored to their taste and BPM).`;

      const coachRes = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tasteSummary: { type: Type.STRING },
              fitnessCoachTip: { type: Type.STRING },
              tasteTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendedQueries: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    platform: { type: Type.STRING },
                    label: { type: Type.STRING },
                    bpmHint: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((coachRes.text ?? '{}').trim()) as {
        tasteSummary?: string;
        fitnessCoachTip?: string;
        tasteTags?: string[];
        recommendedQueries?: Array<{
          platform?: string;
          label?: string;
          bpmHint?: number;
          reason?: string;
        }>;
      };

      const validRecommendations = Array.isArray(parsed.recommendedQueries)
        ? parsed.recommendedQueries
            .slice(0, 3)
            .filter((q) => q && typeof q.label === 'string' && q.label.trim().length > 0)
            .map((q) => ({
              platform: (q.platform === 'tiktok' || q.platform === 'synth' ? q.platform : 'youtube') as
                | 'youtube'
                | 'tiktok'
                | 'synth',
              label: q.label!.trim().slice(0, 120),
              bpmHint:
                typeof q.bpmHint === 'number' && Number.isFinite(q.bpmHint)
                  ? Math.max(70, Math.min(175, Math.round(q.bpmHint)))
                  : 116,
              reason: (q.reason || 'Matches your saved music taste.').slice(0, 160),
            }))
        : localResult.recommendedQueries;

      res.json({
        source: 'gemini',
        tasteSummary: (parsed.tasteSummary || localResult.tasteSummary).slice(0, 600),
        fitnessCoachTip: (parsed.fitnessCoachTip || localResult.fitnessCoachTip).slice(0, 600),
        tasteTags:
          Array.isArray(parsed.tasteTags) && parsed.tasteTags.length > 0
            ? parsed.tasteTags.slice(0, 8).map((t) => String(t).slice(0, 40))
            : localResult.tasteTags,
        tasteCentroid,
        trackVectors,
        recommendedQueries:
          validRecommendations.length > 0 ? validRecommendations : localResult.recommendedQueries,
      });
    } catch {
      res.json(localResult);
    }
  });

  // Vite dev middleware or static dist serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FaceBeat Arcade server listening on port ${PORT}`);
  });
}

void startServer();
