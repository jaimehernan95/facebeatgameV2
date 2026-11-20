export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'www.youtube-nocookie.com';

  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (isYouTubeHost) {
    if (parsed.pathname === '/watch') {
      candidate = parsed.searchParams.get('v');
    } else {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
        candidate = parts[1];
      }
    }
  }

  if (!candidate || !/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
    return null;
  }
  return candidate;
}

export function parseTikTokId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isTikTokHost =
    host === 'tiktok.com' ||
    host === 'www.tiktok.com' ||
    host === 'm.tiktok.com';
  if (!isTikTokHost) return null;

  const videoMatch = parsed.pathname.match(/\/video\/(\d{8,25})/);
  if (videoMatch) return videoMatch[1];

  const legacyMatch = parsed.pathname.match(/\/v\/(\d{8,25})\.html/);
  if (legacyMatch) return legacyMatch[1];

  return null;
}

export function isSupportedOEmbedUrl(input: string): boolean {
  try {
    const parsed = new URL(input.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'tiktok.com',
      'www.tiktok.com',
      'm.tiktok.com',
    ].includes(host);
  } catch {
    return false;
  }
}
