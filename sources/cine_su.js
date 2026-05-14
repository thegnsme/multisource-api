/**
 * cine.su — Direct HLS API for movies and TV shows.
 * 
 * THE BEST WORKING SOURCE: no auth, no JS, no Cloudflare.
 * Returns direct m3u8 master playlists with 720p and 1080p variants.
 * 
 * Movie:  https://cine.su/v1/stream/master/movie/{tmdbId}.m3u8
 * TV:     https://cine.su/v1/stream/master/tv/{tmdbId}/{season}/{episode}.m3u8
 * 
 * Status: working (HTTP API, no browser needed)
 */
const axios = require('axios');
const https = require('https');

const BASE = 'https://cine.su/v1/stream/master';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const QUALITY_MAP = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };

// Axios v1.x needs IPv4 forced in some environments
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

/**
 * Parse an m3u8 master playlist into stream entries
 */
function parseMasterPlaylist(m3u8, baseUrl) {
  const streams = [];
  if (!m3u8 || typeof m3u8 !== 'string' || !m3u8.startsWith('#EXTM3U')) return streams;

  if (!m3u8.includes('#EXT-X-STREAM-INF:')) {
    // Simple media playlist — return direct URLs
    const urls = m3u8.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    for (const url of urls) {
      const fullUrl = url.startsWith('http') ? url : new URL(url, baseUrl).href;
      streams.push({ url: fullUrl, type: 'hls', quality: '', resolution: '' });
    }
    return streams;
  }

  // Master playlist with quality variants
  const lines = m3u8.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
    const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
    const nl = lines[i + 1]?.trim();
    if (nl && !nl.startsWith('#')) {
      const vu = nl.startsWith('http') ? nl : new URL(nl, baseUrl).href;
      const h = res ? res.split('x')[1] : '';
      streams.push({
        url: vu,
        type: 'hls',
        quality: QUALITY_MAP[h] || (h ? h + 'p' : ''),
        resolution: res || '',
        bandwidth: bw ? parseInt(bw) : undefined,
      });
      i++;
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  return streams.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();

  const apiUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}.m3u8`
    : `${BASE}/tv/${tmdbId}/${season || 1}/${episode || 1}.m3u8`;

  const embedUrl = `https://cine.su/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}` +
    (type === 'tv' ? `/${season || 1}/${episode || 1}` : '');

  try {
    const resp = await axios.get(apiUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://cine.su/',
        'Accept': 'application/vnd.apple.mpegurl,*/*',
      },
      timeout: 10000,
      validateStatus: () => true,
      httpsAgent,
    });

    const m3u8 = resp.data;
    const httpStatus = resp.status;

    if (httpStatus !== 200 || !m3u8 || typeof m3u8 !== 'string' || !m3u8.startsWith('#EXTM3U')) {
      return {
        source: 'cine.su',
        embedUrl,
        status: 'no_streams',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    const streams = parseMasterPlaylist(m3u8, apiUrl);

    return {
      source: 'cine.su',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'cine.su',
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
