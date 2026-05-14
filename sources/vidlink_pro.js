/**
 * vidlink.pro — Uses enc-dec.app encryption + vidlink.pro API for HLS streams with captions.
 *
 * Chain:
 *   1. enc-dec.app/api/enc-vidlink?text={tmdbId}  →  encrypted ID
 *   2. vidlink.pro/api/b/{type}/{encId}?multiLang=0  →  { stream: { playlist, captions, ... } }
 *   3. Fetch master playlist for quality variants (1080p, 720p, 360p)
 *
 * Movie captions observed: Arabic, Chinese, English, Spanish
 * TV captions observed: up to 30 languages
 */

const axios = require('axios');

const ENC_API = 'https://enc-dec.app/api/enc-vidlink';
const VIDLINK_API = 'https://vidlink.pro/api/b';

const QUALITY_MAP = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://vidlink.pro/${type}/${tmdbId}` +
    (type === 'tv' ? `/${season || 1}/${episode || 1}` : '');

  try {
    // Step 1: Encrypt the TMDB ID via enc-dec.app
    const encResp = await axios.get(ENC_API, {
      params: { text: String(tmdbId) },
      timeout: 8000,
    });

    if (encResp.data?.status !== 200 || !encResp.data?.result) {
      return {
        source: 'vidlink.pro',
        embedUrl,
        status: 'error',
        error: 'Encryption failed',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    const encId = encResp.data.result;

    // Step 2: Call vidlink.pro API
    const apiUrl = type === 'movie'
      ? `${VIDLINK_API}/movie/${encId}?multiLang=0`
      : `${VIDLINK_API}/tv/${encId}/${season || 1}/${episode || 1}?multiLang=0`;

    const streamResp = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://vidlink.pro/',
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    const streamData = streamResp.data;

    if (!streamData?.stream?.playlist) {
      return {
        source: 'vidlink.pro',
        embedUrl,
        status: 'no_streams',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    const playlistUrl = streamData.stream.playlist;

    // Extract captions / subtitles
    const captions = (streamData.stream.captions || []).map(c => ({
      url: c.url || c.id || '',
      lang: c.language || c.label || 'unknown',
      type: (c.url || c.id || '').endsWith('.vtt') ? 'vtt' : (c.type || 'srt'),
    })).filter(c => c.url);

    // Step 3: Fetch master playlist to extract quality variants
    const m3u8Resp = await axios.get(playlistUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://vidlink.pro/',
      },
      timeout: 8000,
      validateStatus: () => true,
    });

    const streams = [];

    if (m3u8Resp.data && typeof m3u8Resp.data === 'string' && m3u8Resp.data.startsWith('#EXTM3U')) {
      const m3u8 = m3u8Resp.data;

      if (m3u8.includes('#EXT-X-STREAM-INF:')) {
        // Master playlist — parse each variant
        const lines = m3u8.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;

          const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
          const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
          const nextLine = lines[i + 1]?.trim();

          if (nextLine && !nextLine.startsWith('#')) {
            let streamUrl = nextLine;
            if (!streamUrl.startsWith('http')) {
              // Resolve relative URL
              const base = new URL(playlistUrl);
              streamUrl = new URL(streamUrl, base.origin).href;
            }

            const height = res ? res.split('x')[1] : '';
            const quality = QUALITY_MAP[height] || (height ? height + 'p' : '');

            streams.push({
              url: streamUrl,
              type: 'hls',
              quality,
              resolution: res || '',
              bandwidth: bw ? parseInt(bw) : undefined,
            });
            i++; // skip the URL line
          }
        }
      } else {
        // Single quality media playlist — extract the URL
        const urls = m3u8.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#') && l.startsWith('http'));
        for (const url of urls) {
          streams.push({ url, type: 'hls', quality: '', resolution: '' });
        }
      }
    } else {
      // Not a valid m3u8 response — return the playlist URL as a fallback
      streams.push({ url: playlistUrl, type: 'hls', quality: '', resolution: '' });
    }

    return {
      source: 'vidlink.pro',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      subtitles: captions.length > 0 ? captions : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidlink.pro',
      embedUrl,
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };

// ── Standalone CLI ───────────────────────────────────────────────────────────
if (require.main === module || module.id === '[stdin]') {
  (async () => {
    const args = {};
    process.argv.slice(2).forEach(a => {
      const [k, v] = a.replace(/^--/, '').split('=');
      args[k] = v || true;
    });
    const result = await scrapeSource({
      tmdbId: parseInt(args.tmdb || args.id || '24428'),
      type: args.type || 'movie',
      season: parseInt(args.season || '1'),
      episode: parseInt(args.episode || '1'),
    });
    console.log(JSON.stringify(result, null, 2));
  })();
}
