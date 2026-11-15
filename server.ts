import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = 'facebeat_spotify_sid';

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
