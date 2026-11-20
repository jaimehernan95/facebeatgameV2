import React, { useCallback, useEffect, useState } from 'react';
import { Disc3, Film, Heart, Link2, LogOut, Music, Search, Upload, Youtube } from 'lucide-react';
import { grooveEngine } from '../audio/grooveEngine';
import { parseTikTokId, parseYouTubeId } from '../game/mediaLinks';
import {
  ExternalMediaTrack,
  FavoriteTrackMemory,
  MusicSource,
  SpotifyTrackOption,
  TrackConfig,
  TrackId,
  UploadedAudioTrack,
} from '../types/game';

interface SpotifyStatusResponse {
  configured: boolean;
  connected: boolean;
  user: {
    id: string;
    displayName: string;
    product: string;
  } | null;
  redirectUri: string;
}

interface MusicSourcePanelProps {
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
  onSelectSource: (source: MusicSource) => void;
  onSelectSynth: (id: TrackId) => void;
  onSelectYoutubeTrack: (track: ExternalMediaTrack) => void;
  onSelectTiktokTrack: (track: ExternalMediaTrack) => void;
  onSelectSpotifyTrack: (track: SpotifyTrackOption) => void;
  onSelectUploadedTrack: (track: UploadedAudioTrack) => void;
  onChangeCustomBpm: (bpm: number) => void;
  onToggleSaveCurrentTrack: () => void;
  onLoadFavorite: (track: FavoriteTrackMemory) => void;
}

function extractSpotifyTrackId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];
  return null;
}

export const MusicSourcePanel: React.FC<MusicSourcePanelProps> = ({
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
  onSelectSource,
  onSelectSynth,
  onSelectYoutubeTrack,
  onSelectTiktokTrack,
  onSelectSpotifyTrack,
  onSelectUploadedTrack,
  onChangeCustomBpm,
  onToggleSaveCurrentTrack,
  onLoadFavorite,
}) => {
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatusResponse | null>(null);
  const [authPopupUrl, setAuthPopupUrl] = useState<string | null>(null);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SpotifyTrackOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [spotifyLinkInput, setSpotifyLinkInput] = useState('');

  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  const [tiktokInput, setTiktokInput] = useState('');
  const [tiktokLoading, setTiktokLoading] = useState(false);
  const [tiktokError, setTiktokError] = useState<string | null>(null);

  const [isDecodingUpload, setIsDecodingUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchSpotifyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/status');
      if (!res.ok) return;
      const data = (await res.json()) as SpotifyStatusResponse;
      setSpotifyStatus(data);

      if (data.connected) {
        const libRes = await fetch('/api/spotify/library');
        if (libRes.ok) {
          const lib = (await libRes.json()) as { tracks: SpotifyTrackOption[] };
          if (lib.tracks.length > 0) {
            setSearchResults((prev) => (prev.length === 0 ? lib.tracks : prev));
          }
        }
      }
    } catch {
      // Optional server endpoint
    }
  }, []);

  useEffect(() => {
    void fetchSpotifyStatus();
  }, [fetchSpotifyStatus]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'SPOTIFY_AUTH_SUCCESS') {
        setSpotifyError(null);
        setAuthPopupUrl(null);
        void fetchSpotifyStatus();
      } else if (event.data?.type === 'SPOTIFY_AUTH_ERROR') {
        setSpotifyError(event.data.error || 'Spotify authorization did not complete.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [fetchSpotifyStatus]);

  const handleLoadYouTube = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(youtubeInput);
    if (!id) {
      setYoutubeError(
        'Paste a valid YouTube or YouTube Music link (youtube.com/watch?v=..., music.youtube.com/..., or youtu.be/...).'
      );
      return;
    }

    setYoutubeError(null);
    setYoutubeLoading(true);
    let title = 'YouTube Music Track';
    let author = 'YouTube';
    let thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

    try {
      const res = await fetch(`/api/media/oembed?url=${encodeURIComponent(youtubeInput.trim())}`);
      if (res.ok) {
        const meta = (await res.json()) as { title?: string; author?: string; thumbnail?: string };
        if (meta.title) title = meta.title;
        if (meta.author) author = meta.author;
        if (meta.thumbnail) thumbnail = meta.thumbnail;
      }
    } catch {
      // Metadata lookup is optional; videoId still plays directly
    } finally {
      setYoutubeLoading(false);
    }

    onSelectYoutubeTrack({
      provider: 'youtube',
      id,
      url: youtubeInput.trim(),
      title,
      author,
      thumbnail,
      bpm: customBpm,
    });
  };

  const handleLoadTikTok = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseTikTokId(tiktokInput);
    if (!id) {
      setTiktokError('Paste a full TikTok video URL (e.g. https://www.tiktok.com/@user/video/1234567890).');
      return;
    }

    setTiktokError(null);
    setTiktokLoading(true);
    let title = 'TikTok Sound';
    let author = 'TikTok Creator';
    let thumbnail = '';

    try {
      const res = await fetch(`/api/media/oembed?url=${encodeURIComponent(tiktokInput.trim())}`);
      if (res.ok) {
        const meta = (await res.json()) as { title?: string; author?: string; thumbnail?: string };
        if (meta.title) title = meta.title;
        if (meta.author) author = meta.author;
        if (meta.thumbnail) thumbnail = meta.thumbnail;
      }
    } catch {
      // Optional metadata
    } finally {
      setTiktokLoading(false);
    }

    onSelectTiktokTrack({
      provider: 'tiktok',
      id,
      url: tiktokInput.trim(),
      title,
      author,
      thumbnail,
      bpm: customBpm,
    });
  };

  const handleConnectSpotify = async () => {
    setSpotifyError(null);
    setAuthPopupUrl(null);
    try {
      const res = await fetch('/api/spotify/auth-url');
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setSpotifyError(data.error || 'Unable to start Spotify login.');
        return;
      }

      const popup = window.open(data.url, 'spotify_oauth_popup', 'width=540,height=720');
      if (!popup) {
        setAuthPopupUrl(data.url);
        setSpotifyError('Popup was blocked by your browser. Use the direct link below to sign in.');
      }
    } catch {
      setSpotifyError('Could not reach the server to start Spotify OAuth.');
    }
  };

  const handleDisconnectSpotify = async () => {
    await fetch('/api/spotify/logout', { method: 'POST' }).catch(() => {});
    setSearchResults([]);
    void fetchSpotifyStatus();
  };

  const handleSearchSpotify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSpotifyError(null);
    try {
      const res = await fetch(
        `/api/spotify/search?${new URLSearchParams({ q: searchQuery.trim() }).toString()}`
      );
      if (!res.ok) {
        setSpotifyError('Spotify search failed. Try reconnecting your account.');
        return;
      }
      const data = (await res.json()) as { tracks: SpotifyTrackOption[] };
      setSearchResults(data.tracks);
      if (data.tracks.length === 0) {
        setSpotifyError('No matching tracks found.');
      }
    } catch {
      setSpotifyError('Failed to search Spotify tracks.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadSpotifyLink = () => {
    const id = extractSpotifyTrackId(spotifyLinkInput);
    if (!id) {
      setSpotifyError('Paste a valid Spotify track URL (e.g. open.spotify.com/track/...).');
      return;
    }
    setSpotifyError(null);
    onSelectSpotifyTrack({
      id,
      name: 'Spotify Track',
      artist: 'Linked via Spotify Embed',
      albumArt: '',
      uri: `spotify:track:${id}`,
      durationSec: 45,
      previewUrl: null,
      bpm: customBpm,
    });
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setIsDecodingUpload(true);
    try {
      const { buffer, bpm, beatTimes } = await grooveEngine.decodeAudioFile(file);
      const cleanName = file.name.replace(/\.[^.]+$/, '');
      onSelectUploadedTrack({
        id: `upload-${file.name}-${file.size}`,
        name: cleanName,
        durationSec: Math.max(15, Math.floor(buffer.duration)),
        bpm,
        buffer,
        beatTimes,
      });
    } catch {
      setUploadError('Could not decode that audio file. Try an MP3, WAV, or M4A file.');
    } finally {
      setIsDecodingUpload(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 5-Tab Source Selector */}
      <div className="grid grid-cols-5 gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
        <button
          type="button"
          onClick={() => onSelectSource('synth')}
          className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            musicSource === 'synth'
              ? 'bg-emerald-500 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Music className="w-3.5 h-3.5 shrink-0" />
          <span>Synth</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSource('youtube')}
          className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            musicSource === 'youtube'
              ? 'bg-emerald-500 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Youtube className="w-3.5 h-3.5 shrink-0" />
          <span>YouTube</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSource('tiktok')}
          className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            musicSource === 'tiktok'
              ? 'bg-emerald-500 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Film className="w-3.5 h-3.5 shrink-0" />
          <span>TikTok</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSource('spotify')}
          className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            musicSource === 'spotify'
              ? 'bg-emerald-500 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Disc3 className="w-3.5 h-3.5 shrink-0" />
          <span>Spotify</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSource('upload')}
          className={`inline-flex items-center justify-center gap-1 py-1.5 px-1.5 text-[11px] sm:text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
            musicSource === 'upload'
              ? 'bg-emerald-500 text-slate-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span>Upload</span>
        </button>
      </div>

      {/* Mode 1: Free Built-in Synth Tracks */}
      {musicSource === 'synth' && (
        <div className="grid grid-cols-1 gap-2">
          {tracks.map((t) => {
            const selected = t.id === selectedSynthId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectSynth(t.id)}
                className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                  selected
                    ? 'bg-slate-800 border-emerald-500 text-white'
                    : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-display text-sm font-semibold truncate">{t.title}</div>
                  <div className="text-xs text-slate-400 truncate">{t.subtitle}</div>
                </div>
                <span className="font-mono-tabular text-xs font-semibold text-emerald-400 shrink-0 ml-3">
                  {t.bpm} BPM
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mode 2: YouTube & YouTube Music (Zero API Key) */}
      {musicSource === 'youtube' && (
        <div className="space-y-3 bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
          <div className="text-xs text-slate-300">
            Paste any <strong className="text-white">YouTube</strong> or{' '}
            <strong className="text-white">YouTube Music</strong> URL — auto-syncs playback and
            beat timer with zero API keys.
          </div>

          <form onSubmit={handleLoadYouTube} className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Link2 className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={youtubeInput}
                onChange={(e) => setYoutubeInput(e.target.value)}
                placeholder="https://music.youtube.com/watch?v=... or youtu.be/..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={youtubeLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer shrink-0"
            >
              {youtubeLoading ? 'Loading...' : 'Load'}
            </button>
          </form>

          {selectedYoutubeTrack && (
            <div className="flex items-center justify-between gap-3 bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                {selectedYoutubeTrack.thumbnail && (
                  <img
                    src={selectedYoutubeTrack.thumbnail}
                    alt={selectedYoutubeTrack.title}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded object-cover shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">
                    {selectedYoutubeTrack.title}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {selectedYoutubeTrack.author}
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-1.5 shrink-0 text-xs text-slate-400">
                <span>BPM</span>
                <input
                  type="number"
                  min={70}
                  max={175}
                  value={customBpm}
                  onChange={(e) => onChangeCustomBpm(Number(e.target.value) || 116)}
                  className="w-14 px-2 py-1 text-xs font-mono-tabular bg-slate-900 border border-slate-800 rounded text-white"
                />
              </label>
            </div>
          )}

          {youtubeError && <p className="text-xs text-amber-400">{youtubeError}</p>}
        </div>
      )}

      {/* Mode 3: TikTok Link Embed */}
      {musicSource === 'tiktok' && (
        <div className="space-y-3 bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
          <div className="text-xs text-slate-300">
            Paste a full <strong className="text-white">TikTok</strong> video URL to embed its audio
            during your round. For automatic play/pause sync, use{' '}
            <button
              type="button"
              onClick={() => onSelectSource('youtube')}
              className="text-emerald-400 underline cursor-pointer"
            >
              YouTube / YT Music
            </button>
            .
          </div>

          <form onSubmit={handleLoadTikTok} className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Link2 className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={tiktokInput}
                onChange={(e) => setTiktokInput(e.target.value)}
                placeholder="https://www.tiktok.com/@creator/video/731234567890"
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={tiktokLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer shrink-0"
            >
              {tiktokLoading ? 'Loading...' : 'Load'}
            </button>
          </form>

          {selectedTiktokTrack && (
            <div className="flex items-center justify-between gap-3 bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">
                  {selectedTiktokTrack.title}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {selectedTiktokTrack.author} · Click play in TikTok widget when round starts
                </div>
              </div>
              <label className="flex items-center gap-1.5 shrink-0 text-xs text-slate-400">
                <span>BPM</span>
                <input
                  type="number"
                  min={70}
                  max={175}
                  value={customBpm}
                  onChange={(e) => onChangeCustomBpm(Number(e.target.value) || 120)}
                  className="w-14 px-2 py-1 text-xs font-mono-tabular bg-slate-900 border border-slate-800 rounded text-white"
                />
              </label>
            </div>
          )}

          {tiktokError && <p className="text-xs text-amber-400">{tiktokError}</p>}
        </div>
      )}

      {/* Mode 4: Spotify OAuth Search + Track Link */}
      {musicSource === 'spotify' && (
        <div className="space-y-3 bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
          {spotifyStatus?.connected ? (
            <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="text-slate-300 truncate">
                  Connected as{' '}
                  <strong className="text-white">
                    {spotifyStatus.user?.displayName || 'Spotify User'}
                  </strong>
                  <span className="text-slate-500"> · {spotifyStatus.user?.product || 'free'}</span>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnectSpotify}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-300 cursor-pointer shrink-0"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              </div>

              <form onSubmit={handleSearchSpotify} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Spotify songs or artists..."
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg cursor-pointer shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isSearching ? '...' : 'Search'}</span>
                </button>
              </form>

              {searchResults.length > 0 && (
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/60">
                  {searchResults.map((st) => {
                    const isSelected = selectedSpotifyTrack?.id === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => onSelectSpotifyTrack(st)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                          isSelected ? 'bg-emerald-500/15 text-white' : 'hover:bg-slate-800/70 text-slate-300'
                        }`}
                      >
                        {st.albumArt ? (
                          <img
                            src={st.albumArt}
                            alt={st.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center shrink-0">
                            <Disc3 className="w-4 h-4 text-slate-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-100 truncate">{st.name}</div>
                          <div className="text-[11px] text-slate-400 truncate">{st.artist}</div>
                        </div>
                        <span className="font-mono-tabular text-[11px] text-emerald-400 shrink-0">
                          {isSelected ? 'Selected' : 'Select'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-300">
                  {spotifyStatus?.configured
                    ? 'Sign in with Spotify to search tracks & play from your library.'
                    : 'Paste any Spotify track link below, or configure Spotify OAuth credentials on the server.'}
                </div>
                {spotifyStatus?.configured && (
                  <button
                    type="button"
                    onClick={handleConnectSpotify}
                    className="px-3.5 py-1.5 text-xs font-bold bg-[#1DB954] hover:bg-[#1ed760] text-slate-950 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Connect Spotify
                  </button>
                )}
              </div>

              {authPopupUrl && (
                <a
                  href={authPopupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-emerald-400 underline"
                >
                  Open Spotify Login Window
                </a>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Link2 className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={spotifyLinkInput}
                  onChange={(e) => setSpotifyLinkInput(e.target.value)}
                  placeholder="Or paste Spotify track link (open.spotify.com/track/...)"
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={handleLoadSpotifyLink}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg cursor-pointer shrink-0"
              >
                Load Link
              </button>
            </div>

            {selectedSpotifyTrack && (
              <div className="flex items-center justify-between gap-3 text-xs pt-1">
                <span className="text-slate-300 truncate">
                  Active: <strong className="text-emerald-400">{selectedSpotifyTrack.name}</strong>
                </span>
                <label className="flex items-center gap-2 shrink-0 text-slate-400">
                  <span>Beat BPM</span>
                  <input
                    type="number"
                    min={70}
                    max={175}
                    value={customBpm}
                    onChange={(e) => onChangeCustomBpm(Number(e.target.value) || 116)}
                    className="w-16 px-2 py-1 text-xs font-mono-tabular bg-slate-950 border border-slate-800 rounded text-white"
                  />
                </label>
              </div>
            )}
          </div>

          {spotifyError && <p className="text-xs text-amber-400">{spotifyError}</p>}
        </div>
      )}

      {/* Mode 5: Upload Your Own MP3 / WAV / M4A */}
      {musicSource === 'upload' && (
        <div className="space-y-2.5 bg-slate-900/90 border border-slate-800 rounded-lg p-3.5">
          <label className="flex flex-col items-center justify-center border border-dashed border-slate-700 hover:border-emerald-500/70 rounded-lg p-4 text-center cursor-pointer transition-colors bg-slate-950/50">
            <Upload className="w-5 h-5 text-emerald-400 mb-1.5" />
            <span className="text-xs font-semibold text-slate-100">
              {isDecodingUpload
                ? 'Analyzing beats & tempo...'
                : uploadedTrack
                  ? `Loaded: ${uploadedTrack.name}`
                  : 'Choose MP3, WAV, OGG, or M4A from your device'}
            </span>
            <span className="text-[11px] text-slate-400 mt-0.5">
              Auto-detects BPM and musical beat peaks locally in your browser
            </span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => void handleFileUpload(e.target.files?.[0])}
            />
          </label>

          {uploadedTrack && (
            <div className="flex items-center justify-between text-xs text-slate-300 px-1">
              <span>
                Detected{' '}
                <strong className="font-mono-tabular text-emerald-400">
                  {uploadedTrack.beatTimes.length}
                </strong>{' '}
                beat peaks
              </span>
              <label className="flex items-center gap-2 text-slate-400">
                <span>BPM</span>
                <input
                  type="number"
                  min={70}
                  max={175}
                  value={customBpm}
                  onChange={(e) => onChangeCustomBpm(Number(e.target.value) || uploadedTrack.bpm)}
                  className="w-16 px-2 py-1 text-xs font-mono-tabular bg-slate-950 border border-slate-800 rounded text-white"
                />
              </label>
            </div>
          )}

          {uploadError && <p className="text-xs text-rose-400">{uploadError}</p>}
        </div>
      )}

      {/* Save Active Track + Remembered Favorites Quick-Load Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {(musicSource === 'synth' ||
          (musicSource === 'youtube' && selectedYoutubeTrack) ||
          (musicSource === 'tiktok' && selectedTiktokTrack) ||
          (musicSource === 'spotify' && selectedSpotifyTrack)) && (
          <button
            type="button"
            onClick={onToggleSaveCurrentTrack}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors cursor-pointer ${
              currentTrackLiked
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
            }`}
          >
            <Heart className={`w-3 h-3 ${currentTrackLiked ? 'fill-rose-400 text-rose-400' : ''}`} />
            <span>{currentTrackLiked ? 'Saved to Taste Memory' : 'Save Track I Like'}</span>
          </button>
        )}

        {favorites.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full">
            <span className="text-[11px] text-slate-400 shrink-0">Remembered:</span>
            {favorites
              .filter((f) => f.source !== 'upload')
              .slice(0, 4)
              .map((fav) => (
                <button
                  key={fav.trackKey}
                  type="button"
                  onClick={() => onLoadFavorite(fav)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200 truncate max-w-[140px] cursor-pointer shrink-0"
                  title={`${fav.title} (${fav.source} · ${fav.bpm} BPM)`}
                >
                  {fav.liked && <Heart className="w-2.5 h-2.5 fill-rose-400 text-rose-400 shrink-0" />}
                  <span className="truncate">{fav.title}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
