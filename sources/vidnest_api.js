/**
 * VidNest API — Multi-server encrypted HTTP API for direct HLS/MP4 streams.
 * 
 * API: https://new.vidnest.fun/{server}/{type}/{tmdbId}[/{season}/{episode}]
 * Has 10 servers (5+ currently working): moviebox, allmovies, purstream, hollymoviehd, vidlink, onehd
 * Responses are custom-base64 encoded JSON.
 * 
 * Status: working (HTTP API, no browser needed)
 */
const https = require('https');
const axios = require('axios');

const API_BASE = 'https://new.vidnest.fun';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';

const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

// ── Custom base64 alphabet from VidNest frontend ─────────────────────────────

const VIDNEST_ALPHABET = 'RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=';
const REVERSE_MAP = {};
for (let i = 0; i < VIDNEST_ALPHABET.length; i++) {
  REVERSE_MAP[VIDNEST_ALPHABET[i]] = i;
}

function decodeVidnestBase64(input) {
  if (!input || typeof input !== 'string') throw new Error('Invalid payload');

  let padded = input;
  const mod = padded.length % 4;
  if (mod !== 0) padded += '='.repeat(4 - mod);

  const bytes = [];
  for (let i = 0; i < padded.length; i += 4) {
    const chunk = padded.slice(i, i + 4);
    const c0 = REVERSE_MAP[chunk[0]] ?? 64;
    const c1 = REVERSE_MAP[chunk[1]] ?? 64;
    const c2 = chunk[2] === '=' ? 64 : (REVERSE_MAP[chunk[2]] ?? 64);
    const c3 = chunk[3] === '=' ? 64 : (REVERSE_MAP[chunk[3]] ?? 64);

    bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff);
    if (c2 !== 64) bytes.push((((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff);
    if (c3 !== 64) bytes.push((((c2 & 0x03) << 6) | c3) & 0xff);
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ── HTTP fetch ───────────────────────────────────────────────────────────────

async function fetchJson(url, referer = 'https://vidnest.fun/') {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer,
        'Origin': 'https://vidnest.fun',
      },
      timeout: 10000,
      validateStatus: () => true,
      httpsAgent,
    });
    return { status: resp.status, data: resp.data };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

// ── Server handlers ──────────────────────────────────────────────────────────

const SERVER_HANDLERS = {
  /**
   * moviebox: { url: [{ lang, link, resolution, type }] }
   */
  moviebox(data) {
    const streams = [];
    const seen = new Set();
    for (const item of (data.url || [])) {
      if (item.link && item.link.startsWith('http') && !seen.has(item.link)) {
        seen.add(item.link);
        const quality = item.resolution ? `${item.resolution}p` : '';
        streams.push({
          url: item.link,
          type: item.type === 'mp4' ? 'mp4' : 'hls',
          quality,
          resolution: quality ? `${item.resolution}x${item.resolution}` : '',
          server: 'moviebox',
        });
      }
    }
    return { streams, subtitles: [] };
  },

  /**
   * allmovies: { streams: [{ url, headers, language, type }] }
   */
  allmovies(data) {
    const streams = [];
    const seen = new Set();
    for (const item of (data.streams || [])) {
      if (item.url && item.url.startsWith('http') && !seen.has(item.url)) {
        seen.add(item.url);
        streams.push({
          url: item.url,
          type: item.type === 'mp4' ? 'mp4' : 'hls',
          quality: '',
          resolution: '',
          language: item.language || '',
          server: 'allmovies',
        });
      }
    }
    return { streams, subtitles: [] };
  },

  /**
   * purstream: { sources: [{ url, format, name }] }
   */
  purstream(data) {
    const streams = [];
    const seen = new Set();
    for (const item of (data.sources || [])) {
      if (item.url && item.url.startsWith('http') && !seen.has(item.url)) {
        seen.add(item.url);
        const qMatch = item.name?.match(/(\d+p)/);
        streams.push({
          url: item.url,
          type: item.format === 'm3u8' ? 'hls' : (item.format || 'hls'),
          quality: qMatch?.[1] || '',
          resolution: '',
          server: 'purstream',
        });
      }
    }
    return { streams, subtitles: [] };
  },

  /**
   * hollymoviehd: { sources: [{ file, label, type }] }
   */
  hollymoviehd(data) {
    const streams = [];
    const seen = new Set();
    for (const item of (data.sources || [])) {
      if (item.file && item.file.startsWith('http') && !seen.has(item.file)) {
        seen.add(item.file);
        streams.push({
          url: item.file,
          type: item.type === 'mp4' ? 'mp4' : 'hls',
          quality: item.label || '',
          resolution: '',
          server: 'hollymoviehd',
        });
      }
    }
    return { streams, subtitles: [] };
  },

  /**
   * vidlink: { data: { stream: { playlist, captions: [{ url, language }] } } }
   */
  vidlink(data) {
    const streams = [];
    const subtitles = [];
    const stream = data?.data?.stream;
    if (stream?.playlist && stream.playlist.startsWith('http')) {
      streams.push({
        url: stream.playlist,
        type: stream.type === 'mp4' ? 'mp4' : 'hls',
        quality: '',
        resolution: '',
        server: 'vidlink',
      });
    }
    for (const cap of (stream?.captions || [])) {
      if (cap.url && cap.url.startsWith('http')) {
        subtitles.push({
          url: cap.url,
          lang: cap.language || 'unknown',
          type: cap.url.endsWith('.vtt') ? 'vtt' : 'srt',
        });
      }
    }
    return { streams, subtitles };
  },

  /**
   * onehd: { url, headers, subtitles: [{ lang, url }] }
   */
  onehd(data) {
    const streams = [];
    if (data.url && data.url.startsWith('http')) {
      streams.push({
        url: data.url,
        type: 'hls',
        quality: '',
        resolution: '',
        server: 'onehd',
      });
    }
    const subtitles = [];
    for (const sub of (data.subtitles || [])) {
      if (sub.url && sub.url.startsWith('http')) {
        subtitles.push({
          url: sub.url,
          lang: sub.lang || 'unknown',
          type: sub.url.endsWith('.vtt') ? 'vtt' : 'srt',
        });
      }
    }
    return { streams, subtitles };
  },

  /**
   * klikxxi: { sources: [{ url, quality, type }] }
   */
  klikxxi(data) {
    const streams = [];
    const seen = new Set();
    for (const item of (data.sources || [])) {
      if (item.url && item.url.startsWith('http') && !seen.has(item.url)) {
        seen.add(item.url);
        streams.push({
          url: item.url,
          type: item.type === 'mp4' ? 'mp4' : 'hls',
          quality: item.quality || '',
          resolution: '',
          server: 'klikxxi',
        });
      }
    }
    return { streams, subtitles: [] };
  },
};

// All 10 servers from VidNest
const SERVERS = [
  'moviebox', 'allmovies', 'catflix', 'purstream',
  'hollymoviehd', 'lamda', 'flixhq', 'vidlink', 'onehd', 'klikxxi',
];

// ── Main scraper ────────────────────────────────────────────────────────────

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://vidnest.fun/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}` +
    (type === 'tv' ? `/${season}/${episode}` : '');

  try {
    const streams = [];
    const subtitles = [];
    const seenUrls = new Set();

    // Try all servers in parallel
    const promises = SERVERS.map(server => {
      const url = type === 'movie'
        ? `${API_BASE}/${server}/${type}/${tmdbId}`
        : `${API_BASE}/${server}/${type}/${tmdbId}/${season || 1}/${episode || 1}`;
      return fetchJson(url).then(r => ({ server, result: r }));
    });

    const results = await Promise.allSettled(promises);

    for (const settled of results) {
      if (settled.status !== 'fulfilled') continue;
      const { server, result } = settled.value;
      if (result.status !== 200 || !result.data) continue;

      // Check if response is encrypted
      const resp = result.data;
      let parsedData;

      if (resp.encrypted && resp.data) {
        try {
          const decoded = decodeVidnestBase64(resp.data);
          parsedData = JSON.parse(decoded);
        } catch (e) {
          continue; // skip if decryption fails
        }
      } else if (!resp.encrypted && resp.data) {
        parsedData = resp.data;
      } else {
        continue;
      }

      // Route to handler
      const handler = SERVER_HANDLERS[server];
      if (!handler) continue; // no handler for this server

      try {
        const result = handler(parsedData);
        for (const s of result.streams) {
          if (!seenUrls.has(s.url)) {
            seenUrls.add(s.url);
            streams.push(s);
          }
        }
        for (const sub of result.subtitles) {
          if (!subtitles.find(x => x.url === sub.url)) {
            subtitles.push(sub);
          }
        }
      } catch (e) {
        // skip handler errors
      }
    }

    return {
      source: 'vidnest_api',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      ...(subtitles.length > 0 ? { subtitles } : {}),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidnest_api',
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
