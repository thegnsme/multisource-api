/**
 * ezvidapi.com — Uses api.ezvidapi.com proxy to deliver HLS streams with subtitles.
 *
 * The embed page loads a Next.js player, but the underlying API at api.ezvidapi.com
 * returns proxied m3u8 master playlists with quality variants and subtitle tracks.
 *
 * Providers: vidrock (7-12 subtitles), vidzee (7-12 subtitles)
 */

const { fetchUrl } = require('../utils/fetcher');

const API_BASE = 'https://api.ezvidapi.com';

// Try providers in order until one works
const PROVIDERS = ['vidrock', 'vidzee'];

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = 'https://ezvidapi.com/embed/' + type + '/' + tmdbId +
    (type === 'tv' ? '?season=' + (season || 1) + '&episode=' + (episode || 1) : '');
  const start = Date.now();

  for (const provider of PROVIDERS) {
    try {
      const apiUrl = type === 'movie'
        ? API_BASE + '/movie/' + provider + '/' + tmdbId
        : API_BASE + '/tv/' + provider + '/' + tmdbId + '?season=' + (season || 1) + '&episode=' + (episode || 1);

      const resp = await fetchUrl(apiUrl, { referer: API_BASE, timeout: 8000 });
      if (resp.status !== 200 || !resp.html) continue;

      let data;
      try { data = JSON.parse(resp.html); } catch (_) { continue; }
      if (!data.stream_url) continue;

      // Fetch the proxy m3u8
      const m3u8Resp = await fetchUrl(data.stream_url, { referer: API_BASE, timeout: 15000, retries: 1 });
      const streams = [];

      if (m3u8Resp.html && m3u8Resp.html.startsWith('#EXTM3U')) {
        const m3u8 = m3u8Resp.html;
        if (m3u8.includes('#EXT-X-STREAM-INF:')) {
          const lines = m3u8.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
            const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
            const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
            const nl = lines[i + 1]?.trim();
            if (nl && !nl.startsWith('#')) {
              const vu = nl.startsWith('http') ? nl : new URL(nl, data.stream_url).href;
              const h = res ? res.split('x')[1] : '';
              const qMap = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };
              streams.push({ url: vu, type: 'hls', quality: qMap[h] || (h ? h + 'p' : ''), resolution: res || '', bandwidth: bw ? parseInt(bw) : undefined });
              i++;
            }
          }
        } else {
          const urls = m3u8.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          for (const url of urls) {
            streams.push({ url: url.startsWith('http') ? url : new URL(url, data.stream_url).href, type: 'hls', quality: '', resolution: '' });
          }
        }
      }

      // Fallback: decode base64 payload
      if (streams.length === 0) {
        const b64 = data.stream_url.match(/proxy\/master\/([^.]+)/);
        if (b64) {
          try {
            const decoded = JSON.parse(Buffer.from(b64[1], 'base64').toString('utf-8'));
            if (decoded.u) streams.push({ url: decoded.u, type: 'hls', quality: '', resolution: '' });
          } catch (_) {}
        }
      }

      // Subtitles
      const subtitles = Array.isArray(data.subtitles)
        ? data.subtitles.map(s => ({ url: s.url || s.u, lang: s.label || s.l || s.language || s.n || 'unknown', type: (s.url || s.u || '').endsWith('.vtt') ? 'vtt' : 'srt' }))
        : undefined;

      // Extract subs from m3u8
      if (m3u8Resp.html) {
        const subRe = /#EXT-X-MEDIA:TYPE=SUBTITLES[^#]*?NAME="([^"]+)"[^#]*?URI="([^"]+)"/g;
        let m;
        const subFromM3u8 = [];
        while ((m = subRe.exec(m3u8Resp.html)) !== null) {
          subFromM3u8.push({ url: m[2], lang: m[1], type: 'vtt' });
        }
        if (subFromM3u8.length > 0) {
          // Merge with API subs
          for (const s of subFromM3u8) {
            if (!subtitles?.find(x => x.lang === s.lang)) {
              if (!subtitles) subtitles = [];
              subtitles.push(s);
            }
          }
        }
      }

      return {
        source: 'ezvidapi.com (' + provider + ')',
        embedUrl,
        status: streams.length > 0 ? 'working' : 'no_streams',
        streams,
        subtitles: subtitles?.length > 0 ? subtitles : undefined,
        latency_ms: Date.now() - start,
      };
    } catch (_) {
      continue;
    }
  }

  return {
    source: 'ezvidapi.com',
    embedUrl,
    status: 'embed',
    streams: [],
    latency_ms: Date.now() - start,
  };
}

module.exports = { scrapeSource };
