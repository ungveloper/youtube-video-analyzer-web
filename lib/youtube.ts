const ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
/** Reject arbitrary external URLs; API calls never fetch user-supplied hosts. */
export function extractVideoId(input: string): string | null {
  const value = input.trim();
  if (ID_PATTERN.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/')[1] || '';
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
    else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2] || '';
  }
  return ID_PATTERN.test(id) ? id : null;
}
export function youtubeUrl(id: string) { return `https://www.youtube.com/watch?v=${id}`; }
export function timestamp(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
