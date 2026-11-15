// Lightweight client helper for Spotify Web Playback SDK (Spotify Premium accounts)

interface SpotifyPlayerInstance {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  addListener: (event: string, cb: (payload: unknown) => void) => void;
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayerInstance;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

class SpotifySdkController {
  private player: SpotifyPlayerInstance | null = null;
  private deviceId: string | null = null;
  private sdkLoaded = false;

  public async ensureDevice(): Promise<string | null> {
    if (this.deviceId) return this.deviceId;

    await this.loadSdkScript();
    if (!window.Spotify) return null;

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(null), 5000);

      const player = new window.Spotify!.Player({
        name: 'FaceBeat Arcade Player',
        volume: 0.75,
        getOAuthToken: async (cb) => {
          try {
            const res = await fetch('/api/spotify/token');
            if (!res.ok) return;
            const data = (await res.json()) as { accessToken: string };
            cb(data.accessToken);
          } catch {
            // Token fetch failed
          }
        },
      });

      player.addListener('ready', (payload) => {
        const info = payload as { device_id?: string };
        clearTimeout(timeout);
        this.deviceId = info.device_id ?? null;
        this.player = player;
        resolve(this.deviceId);
      });

      player.addListener('initialization_error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      player.addListener('authentication_error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      player.addListener('account_error', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      void player.connect();
    });
  }

  public async playUri(uri: string): Promise<boolean> {
    const deviceId = await this.ensureDevice();
    if (!deviceId) return false;

    try {
      const tokenRes = await fetch('/api/spotify/token');
      if (!tokenRes.ok) return false;
      const { accessToken } = (await tokenRes.json()) as { accessToken: string };

      const playRes = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: [uri] }),
        }
      );
      return playRes.ok;
    } catch {
      return false;
    }
  }

  public async pause(): Promise<void> {
    if (this.player) {
      await this.player.pause().catch(() => {});
    }
  }

  public async resume(): Promise<void> {
    if (this.player) {
      await this.player.resume().catch(() => {});
    }
  }

  public dispose() {
    if (this.player) {
      this.player.disconnect();
      this.player = null;
      this.deviceId = null;
    }
  }

  private loadSdkScript(): Promise<void> {
    if (this.sdkLoaded || window.Spotify) {
      this.sdkLoaded = true;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(), 4000);
      window.onSpotifyWebPlaybackSDKReady = () => {
        clearTimeout(timeout);
        this.sdkLoaded = true;
        resolve();
      };

      const existing = document.getElementById('spotify-web-playback-sdk');
      if (!existing) {
        const script = document.createElement('script');
        script.id = 'spotify-web-playback-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
      }
    });
  }
}

export const spotifySdk = new SpotifySdkController();
