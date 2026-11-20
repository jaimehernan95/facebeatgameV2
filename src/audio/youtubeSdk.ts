// Lightweight controller for the YouTube IFrame Player API (works for YouTube & YouTube Music videos)

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: () => void;
          };
        }
      ) => YTPlayer;
      PlayerState?: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

class YouTubeController {
  private player: YTPlayer | null = null;
  private isReady = false;
  private apiPromise: Promise<boolean> | null = null;

  private loadApi(): Promise<boolean> {
    if (window.YT?.Player) return Promise.resolve(true);
    if (this.apiPromise) return this.apiPromise;

    this.apiPromise = new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(false), 4500);
      const prevReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        if (prevReady) prevReady();
        resolve(true);
      };

      if (!document.getElementById('youtube-iframe-api')) {
        const script = document.createElement('script');
        script.id = 'youtube-iframe-api';
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
        document.body.appendChild(script);
      }
    });

    return this.apiPromise;
  }

  public async mountAndPlay(
    container: HTMLElement,
    videoId: string,
    muted: boolean
  ): Promise<boolean> {
    this.destroy();
    const loaded = await this.loadApi();
    const YT = window.YT;
    if (!loaded || !YT?.Player) return false;

    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 4500);

      const mountTarget = document.createElement('div');
      container.innerHTML = '';
      container.appendChild(mountTarget);

      this.player = new YT.Player(mountTarget, {
        videoId,
        width: '100%',
        height: '88',
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            this.isReady = true;
            if (muted) this.player?.mute();
            else this.player?.unMute();
            this.player?.seekTo(0, true);
            this.player?.playVideo();
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(true);
            }
          },
          onError: () => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              resolve(false);
            }
          },
        },
      });
    });
  }

  public getCurrentTime(): number | null {
    if (!this.player || !this.isReady) return null;
    try {
      const state = this.player.getPlayerState();
      // Only lock clock when actively playing (state === 1)
      if (state === 1) {
        return this.player.getCurrentTime();
      }
      return null;
    } catch {
      return null;
    }
  }

  public pause() {
    try {
      if (this.player && this.isReady) this.player.pauseVideo();
    } catch {
      // Ignore
    }
  }

  public resume() {
    try {
      if (this.player && this.isReady) this.player.playVideo();
    } catch {
      // Ignore
    }
  }

  public setMuted(muted: boolean) {
    try {
      if (!this.player || !this.isReady) return;
      if (muted) this.player.mute();
      else this.player.unMute();
    } catch {
      // Ignore
    }
  }

  public destroy() {
    this.isReady = false;
    if (this.player) {
      try {
        this.player.stopVideo();
        this.player.destroy();
      } catch {
        // Ignore
      }
      this.player = null;
    }
  }
}

export const youtubeSdk = new YouTubeController();
