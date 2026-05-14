#!/usr/bin/env node
/**
 * raw-api.js — Self-Contained Multi-Source Video Stream Aggregator
 * ==============================================================
 *
 * ZERO dependencies — uses only Node.js built-in modules.
 * Can be piped directly from a raw GitHub URL and executed:
 *
 *   curl -s https://raw.githubusercontent.com/sunriseve/multisource-api/main/raw-api.js \
 *     | node - --tmdb=24428
 *
 * Or run locally:
 *   node raw-api.js --tmdb=24428
 *   node raw-api.js --imdb=tt0848228
 *   node raw-api.js --tmdb=1399 --type=tv --season=1 --episode=1
 *   node raw-api.js --imdb=tt0903747 --season=1 --episode=1
 *
 * Or imported as a module:
 *   const { scrapeAll } = require('./raw-api');
 *   const result = await scrapeAll(24428, 'movie');
 *
 * Sources included (all HTTP-based, no browser needed):
 *   • vaplayer.ru      — streamdata.vaplayer.ru API → m3u8
 *   • ezvidapi.com     — api.ezvidapi.com proxy → m3u8 with subtitles
 *   • vidlink.pro      — enc-dec.app + vidlink.pro API → m3u8 with subtitles
 *   • videasy.net      — api.videasy.net + enc-dec.app decrypt → m3u8 with subtitles
 *   • vixsrc.to        — vixsrc.to API → embed page → m3u8
 *   • flicky_api       — gate.flicky.host proxy → direct HLS (v13/v14/v15, up to 4K)
 *   • 02movie_api      — 02moviedownloader.site encrypted API → MP4 + subtitles
 *
 * IMDB ID support: use --imdb=tt0848228 instead of --tmdb=24428.
 * Auto-detects movie vs TV show from TMDB response.
 * Uses TMDB API (built-in key) to convert IMDB → TMDB ID.
 */

'use strict';

// ──────────────────────────────────────────────────────────────────────────────
// Section 1: Built-in HTTP client (no axios needed)
// ──────────────────────────────────────────────────────────────────────────────

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ── TMDB API key for IMDB → TMDB ID lookup ──
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const TMDB_BASE = 'https://api.themoviedb.org/3';

/**
 * Convert IMDB ID (tt0848228) to TMDB ID via TMDB API.
 * Returns { tmdbId, type, title } or throws.
 */
async function imdbToTmdb(imdbId) {
  const cleanId = imdbId.replace(/^https?:\/\/[^/]+\/(title\/)?/i, '').replace(/\/.*$/, '').trim();
  if (!cleanId.startsWith('tt')) {
    throw new Error('Invalid IMDB ID — must start with "tt" (e.g., tt0848228)');
  }
  const res = await fetchJson(`${TMDB_BASE}/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  if (!res) throw new Error('TMDB API request failed');
  if (res.movie_results && res.movie_results.length > 0) {
    const m = res.movie_results[0];
    return { tmdbId: m.id, type: 'movie', title: m.title || m.original_title };
  }
  if (res.tv_results && res.tv_results.length > 0) {
    const t = res.tv_results[0];
    return { tmdbId: t.id, type: 'tv', title: t.name || t.original_name };
  }
  throw new Error(`No TMDB ID found for: ${cleanId}`);
}

/**
 * Fetch JSON from a URL (used by imdbToTmdb).
 */
function fetchJson(urlStr) {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 10000,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Fetch a URL using only built-in Node.js modules.
 * Returns { html, status, headers, error }
 */
function fetchUrl(urlStr, opts = {}) {
  return new Promise((resolve) => {
    const {
      method = 'GET',
      headers = {},
      body = null,
      referer = '',
      timeout = 15000,
      maxRedirects = 5,
      responseType = 'text', // 'text' or 'json'
    } = opts;

    let targetUrl = urlStr;
    let redirectsLeft = maxRedirects;

    // Default headers
    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers,
    };
    if (referer) reqHeaders['Referer'] = referer;
    if (body) {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    function doRequest(url) {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeout);

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: method,
        headers: reqHeaders,
        signal: abortController.signal,
        rejectUnauthorized: false, // Allow self-signed certs
      };

      const req = mod.request(options, (res) => {
        const status = res.statusCode || 0;

        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(status) && redirectsLeft > 0) {
          redirectsLeft--;
          const location = res.headers.location;
          if (location) {
            clearTimeout(timer);
            try {
              const newUrl = location.startsWith('http') ? location : new URL(location, url).href;
              res.resume(); // Drain response
              return doRequest(newUrl);
            } catch (e) {
              clearTimeout(timer);
              return resolve({ html: null, status: 0, error: `Invalid redirect: ${location}`, headers: {} });
            }
          }
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks);
          const contentType = (res.headers['content-type'] || '').toLowerCase();
          let html = raw.toString('utf-8');

          // Auto-parse JSON if response type is JSON
          if (responseType === 'json' || contentType.includes('json')) {
            try {
              html = JSON.parse(html);
            } catch (e) {
              // Keep as string
            }
          }

          resolve({
            html,
            status,
            headers: res.headers,
            error: null,
          });
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          resolve({ html: null, status: 0, error: 'Request timed out', headers: {} });
        } else {
          resolve({ html: null, status: 0, error: err.message, headers: {} });
        }
      });

      if (body) req.write(body);
      req.end();
    }

    doRequest(targetUrl);
  });
}

/**
 * POST JSON body to a URL
 */
function postJson(url, data, opts = {}) {
  return fetchUrl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: JSON.stringify(data),
    referer: opts.referer || '',
    timeout: opts.timeout || 15000,
    responseType: 'json',
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Section 2: Quality mapping helper
// ──────────────────────────────────────────────────────────────────────────────

const QUALITY_MAP = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };
const RESOLUTION_MAP = {
  '4K': '3840x2160', '2160p': '3840x2160', '1080p': '1920x1080',
  '720p': '1280x720', '480p': '854x480', '360p': '640x360',
};

function qualityToResolution(q) { return RESOLUTION_MAP[q] || ''; }

/**
 * Parse m3u8 master playlist into stream entries
 */
function parseMasterPlaylist(m3u8, baseUrl) {
  const streams = [];
  if (!m3u8 || typeof m3u8 !== 'string' || !m3u8.startsWith('#EXTM3U')) return streams;

  if (!m3u8.includes('#EXT-X-STREAM-INF:')) {
    // Simple media playlist — extract direct URLs
    const urls = m3u8.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    for (const url of urls) {
      streams.push({
        url: url.startsWith('http') ? url : new URL(url, baseUrl).href,
        type: 'hls',
        quality: '',
        resolution: '',
      });
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
  return streams;
}

/**
 * Deduplicate streams by URL
 */
function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Section 3: Source Scrapers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * cine.su — Direct HLS API (no auth, no JS, no Cloudflare).
 * Movie:  https://cine.su/v1/stream/master/movie/{tmdbId}.m3u8
 * TV:     https://cine.su/v1/stream/master/tv/{tmdbId}/{season}/{episode}.m3u8
 */
async function scrapeCineSu({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const apiUrl = type === 'movie'
    ? `https://cine.su/v1/stream/master/movie/${tmdbId}.m3u8`
    : `https://cine.su/v1/stream/master/tv/${tmdbId}/${season}/${episode}.m3u8`;
  const embedUrl = `https://cine.su/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}` +
    (type === 'tv' ? `/${season}/${episode}` : '');

  try {
    const resp = await fetchUrl(apiUrl, {
      referer: 'https://cine.su/',
      timeout: 10000,
    });
    if (resp.error || !resp.html || !resp.html.startsWith('#EXTM3U')) {
      return { source: 'cine.su', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }
    const streams = parseMasterPlaylist(resp.html, apiUrl);
    return {
      source: 'cine.su', embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return { source: 'cine.su', embedUrl, status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * vaplayer.ru
 * API: streamdata.vaplayer.ru/api.php?tmdb={id}&type={type}[&season=N&episode=N]
 */
async function scrapeVaplayer({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://vaplayer.ru/embed/${type}/${tmdbId}` +
    (type === 'tv' ? `/${season}/${episode}` : '');

  try {
    let apiUrl = `https://streamdata.vaplayer.ru/api.php?tmdb=${tmdbId}&type=${type}`;
    if (type === 'tv') apiUrl += `&season=${season}&episode=${episode}`;

    const resp = await fetchUrl(apiUrl, {
      referer: `https://brightpathsignals.com/embed/${type}/${tmdbId}`,
      timeout: 10000,
      responseType: 'json',
    });

    if (resp.error) throw new Error(resp.error);
    const data = resp.html;

    if (!data || data.status_code !== '200' || !data.data?.stream_urls?.length) {
      return { source: 'vaplayer.ru', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }

    const meta = data.data;
    const streamResults = await Promise.allSettled(
      (meta.stream_urls || []).map(async (streamUrl) => {
        const m3u8Resp = await fetchUrl(streamUrl, {
          referer: 'https://brightpathsignals.com/',
          timeout: 8000,
        });
        if (m3u8Resp.error) return [];
        return parseMasterPlaylist(m3u8Resp.html, streamUrl);
      })
    );

    const streams = [];
    for (const r of streamResults) {
      if (r.status === 'fulfilled') streams.push(...r.value);
    }

    return {
      source: 'vaplayer.ru',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      title: meta.title || undefined,
      streams: dedupeStreams(streams),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return { source: 'vaplayer.ru', embedUrl, status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * ezvidapi.com
 * Uses api.ezvidapi.com proxy to deliver HLS streams
 */
async function scrapeEzvidapi({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://ezvidapi.com/embed/${type}/${tmdbId}` +
    (type === 'tv' ? `?season=${season}&episode=${episode}` : '');
  const API_BASE = 'https://api.ezvidapi.com';
  const PROVIDERS = ['vidrock', 'vidzee'];

  for (const provider of PROVIDERS) {
    try {
      const apiUrl = type === 'movie'
        ? `${API_BASE}/movie/${provider}/${tmdbId}`
        : `${API_BASE}/tv/${provider}/${tmdbId}?season=${season}&episode=${episode}`;

      const resp = await fetchUrl(apiUrl, { referer: API_BASE, timeout: 8000 });
      if (resp.status !== 200 || !resp.html) continue;

      let data;
      try { data = JSON.parse(resp.html); } catch (_) { continue; }
      if (!data.stream_url) continue;

      const m3u8Resp = await fetchUrl(data.stream_url, {
        referer: API_BASE,
        timeout: 15000,
      });
      const streams = [];
      if (m3u8Resp.html && !m3u8Resp.error) {
        const parsed = parseMasterPlaylist(m3u8Resp.html, data.stream_url);
        streams.push(...parsed);
      }

      // Fallback: decode base64 from proxy URL
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
        ? data.subtitles.map(s => ({
            url: s.url || s.u,
            lang: s.label || s.l || s.language || s.n || 'unknown',
            type: (s.url || s.u || '').endsWith('.vtt') ? 'vtt' : 'srt',
          }))
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
          for (const s of subFromM3u8) {
            if (!subtitles?.find(x => x.lang === s.lang)) {
              if (!subtitles) subtitles = [];
              subtitles.push(s);
            }
          }
        }
      }

      return {
        source: `ezvidapi.com (${provider})`,
        embedUrl,
        status: streams.length > 0 ? 'working' : 'no_streams',
        streams,
        subtitles: subtitles?.length > 0 ? subtitles : undefined,
        latency_ms: Date.now() - start,
      };
    } catch (_) { continue; }
  }

  return { source: 'ezvidapi.com', embedUrl, status: 'embed', streams: [], latency_ms: Date.now() - start };
}

/**
 * vidlink.pro
 * Chain: enc-dec.app/encrypt → vidlink.pro API → m3u8 master playlist
 */
async function scrapeVidlink({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://vidlink.pro/${type}/${tmdbId}` +
    (type === 'tv' ? `/${season}/${episode}` : '');

  try {
    // Step 1: Encrypt via enc-dec.app
    const encResp = await fetchUrl(`https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`, {
      timeout: 8000,
      responseType: 'json',
    });
    if (encResp.error || !encResp.html?.result) {
      return { source: 'vidlink.pro', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }
    const encId = encResp.html.result;

    // Step 2: Call vidlink.pro API
    const apiUrl = type === 'movie'
      ? `https://vidlink.pro/api/b/movie/${encId}?multiLang=0`
      : `https://vidlink.pro/api/b/tv/${encId}/${season}/${episode}?multiLang=0`;

    const streamResp = await fetchUrl(apiUrl, {
      referer: 'https://vidlink.pro/',
      timeout: 10000,
      responseType: 'json',
    });

    if (streamResp.error || !streamResp.html?.stream?.playlist) {
      return { source: 'vidlink.pro', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }

    const streamData = streamResp.html;
    const playlistUrl = streamData.stream.playlist;

    // Extract captions
    const captions = (streamData.stream.captions || []).map(c => ({
      url: c.url || c.id || '',
      lang: c.language || c.label || 'unknown',
      type: (c.url || c.id || '').endsWith('.vtt') ? 'vtt' : 'srt',
    })).filter(c => c.url);

    // Step 3: Fetch master playlist
    const m3u8Resp = await fetchUrl(playlistUrl, {
      referer: 'https://vidlink.pro/',
      timeout: 8000,
    });

    const streams = m3u8Resp.html && !m3u8Resp.error
      ? parseMasterPlaylist(m3u8Resp.html, playlistUrl)
      : [{ url: playlistUrl, type: 'hls', quality: '', resolution: '' }];

    return {
      source: 'vidlink.pro',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      subtitles: captions.length > 0 ? captions : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return { source: 'vidlink.pro', embedUrl, status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * videasy.net
 * Chain: api.videasy.net encrypted data → enc-dec.app decrypt → m3u8 sources
 */
async function scrapeVideasy({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://videasy.net/${type === 'movie' ? 'movie' : 'show'}/${tmdbId}` +
    (type === 'tv' ? `/season/${season}/episode/${episode}` : '');

  try {
    // Step 1: Get encrypted data from videasy API
    const params = new URLSearchParams({
      title: '', mediaType: type, year: '',
      tmdbId: String(tmdbId), imdbId: '',
    });
    if (type === 'tv') {
      params.set('season', String(season));
      params.set('episode', String(episode));
    }

    const apiResp = await fetchUrl(`https://api.videasy.net/cdn/sources-with-title?${params.toString()}`, {
      referer: 'https://videasy.net/',
      timeout: 10000,
    });

    if (apiResp.error || !apiResp.html || apiResp.html.length < 10) {
      return { source: 'videasy.net', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }

    const encryptedText = typeof apiResp.html === 'string' ? apiResp.html.trim() : String(apiResp.html);

    // Step 2: Decrypt via enc-dec.app
    const decryptResp = await postJson('https://enc-dec.app/api/dec-videasy', {
      text: encryptedText,
      id: String(tmdbId),
    }, { timeout: 15000 });

    if (decryptResp.error || decryptResp.html?.status !== 200 || !decryptResp.html?.result) {
      return { source: 'videasy.net', embedUrl, status: 'error', error: decryptResp.error || 'Decryption failed', streams: [], latency_ms: Date.now() - start };
    }

    const result = decryptResp.html.result;
    const rawSources = result.sources || [];
    const rawSubtitles = result.subtitles || [];

    const streams = rawSources.map(s => ({
      url: s.url,
      type: 'hls',
      quality: s.quality || '',
      resolution: qualityToResolution(s.quality),
    }));

    const subtitles = rawSubtitles.map(s => ({
      url: s.url,
      lang: s.language || s.lang || 'unknown',
      type: 'vtt',
    }));

    return {
      source: 'videasy.net',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return { source: 'videasy.net', embedUrl, status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * vixsrc.to
 * Chain: vixsrc.to API → embed page → window.streams / window.masterPlaylist → m3u8
 */
async function scrapeVixsrc({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://vixsrc.to/embed/${type}/${tmdbId}`;

  try {
    const apiUrl = type === 'movie'
      ? `https://vixsrc.to/api/movie/${tmdbId}`
      : `https://vixsrc.to/api/tv/${tmdbId}/${season}/${episode}`;

    const apiResp = await fetchUrl(apiUrl, {
      referer: 'https://vixsrc.to/',
      timeout: 10000,
      responseType: 'json',
    });

    if (apiResp.error || !apiResp.html?.src) {
      return { source: 'vixsrc.to', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }

    const embedPath = apiResp.html.src;
    const fullEmbedUrl = `https://vixsrc.to${embedPath}`;

    // Fetch the embed page
    const embedResp = await fetchUrl(fullEmbedUrl, {
      referer: 'https://vixsrc.to/',
      timeout: 15000,
    });

    if (embedResp.error || !embedResp.html) {
      return { source: 'vixsrc.to', embedUrl: fullEmbedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }

    const html = embedResp.html;
    const streams = [];
    const seen = new Set();

    // Extract stream URLs from window.streams
    const streamUrls = html.match(/url:\s*'([^']+)'/g);
    if (streamUrls) {
      for (const match of streamUrls) {
        const url = match.match(/'([^']+)'/)?.[1];
        if (url && url.includes('/playlist/') && !seen.has(url)) {
          seen.add(url);
          streams.push({ url, type: 'hls', quality: '', resolution: '' });
        }
      }
    }

    // Try building authenticated playlist URL
    const token = html.match(/'token':\s*'([^']+)'/)?.[1];
    const expires = html.match(/'expires':\s*'([^']+)'/)?.[1];
    const playlistUrlMatch = html.match(/url:\s*'([^']+)'/);
    let playlistUrl = playlistUrlMatch?.[1];

    if (playlistUrl && token && expires && !seen.has(playlistUrl)) {
      const authedUrl = `${playlistUrl}?token=${token}&expires=${expires}`;
      seen.add(playlistUrl);

      try {
        const plResp = await fetchUrl(authedUrl, {
          referer: fullEmbedUrl,
          timeout: 10000,
        });

        if (!plResp.error && plResp.html?.startsWith?.('#EXTM3U')) {
          const parsed = parseMasterPlaylist(plResp.html, authedUrl);
          for (const s of parsed) {
            if (!seen.has(s.url)) {
              seen.add(s.url);
              streams.push(s);
            }
          }
        }
      } catch (_) {}
    }

    return {
      source: 'vixsrc.to',
      embedUrl: fullEmbedUrl,
      status: streams.length > 0 ? 'working' : 'embed',
      streams,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return { source: 'vixsrc.to', embedUrl, status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * vidzee_api — Encrypted HTTP API (AES-CBC decrypt).
 * Chain: core.vidzee.wtf/api-key → derive key → player.vidzee.wtf/api/server → decrypt links
 */
const webcrypto = require('crypto').webcrypto;

function vidzeeBase64ToBytes(str) {
  return new Uint8Array(Buffer.from(str.replace(/\s+/g, ''), 'base64'));
}

async function vidzeeDeriveKey(apiKey) {
  if (!apiKey) return '';
  const t = vidzeeBase64ToBytes(apiKey);
  if (t.length <= 28) return '';
  const iv = t.slice(0, 12);
  const salt = t.slice(12, 28);
  const cipherData = t.slice(28);
  const combined = new Uint8Array(cipherData.length + salt.length);
  combined.set(cipherData, 0);
  combined.set(salt, cipherData.length);
  const gcmKey = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c'));
  const importKey = await webcrypto.subtle.importKey('raw', gcmKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const decrypted = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, importKey, combined);
  return new TextDecoder().decode(decrypted);
}

function vidzeeGetKeyBytes(key) {
  const encoded = new TextEncoder().encode(key);
  const result = new Uint8Array(32);
  result.set(encoded.slice(0, 32));
  return result;
}

async function vidzeeAesDecrypt(encryptedData, decryptionKey) {
  if (!encryptedData || !decryptionKey) return '';
  const decoded = Buffer.from(encryptedData, 'base64').toString('utf-8');
  const [ivB64, cipherB64] = decoded.split(':');
  if (!ivB64 || !cipherB64) return '';
  const iv = new Uint8Array(Buffer.from(ivB64, 'base64'));
  const cipherBytes = new Uint8Array(Buffer.from(cipherB64, 'base64'));
  const keyBytes = vidzeeGetKeyBytes(decryptionKey);
  const cryptoKey = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await webcrypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, cipherBytes);
  return new TextDecoder().decode(decrypted);
}

async function scrapeVidzee({ tmdbId, type, season, episode }) {
  const start = Date.now();
  try {
    const keyResp = await fetchUrl('https://core.vidzee.wtf/api-key', { timeout: 10000 });
    if (keyResp.error || !keyResp.html) return { source: 'vidzee_api', embedUrl: '', status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    const apiKey = typeof keyResp.html === 'string' ? keyResp.html : String(keyResp.html);
    const decKey = await vidzeeDeriveKey(apiKey);
    if (!decKey) return { source: 'vidzee_api', embedUrl: '', status: 'error', error: 'Key derivation failed', streams: [], latency_ms: Date.now() - start };

    const serverPromises = [];
    for (let sr = 0; sr < 14; sr++) {
      let url = `https://player.vidzee.wtf/api/server?id=${tmdbId}&sr=${sr}`;
      if (type === 'tv') url += `&ss=${season || 1}&ep=${episode || 1}`;
      serverPromises.push(fetchUrl(url, { referer: 'https://player.vidzee.wtf/', timeout: 8000, responseType: 'json' }));
    }
    const results = await Promise.allSettled(serverPromises);
    const streams = [];
    const subs = [];
    const seen = new Set();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const d = r.value.html;
      if (!d?.url?.length) continue;
      for (const item of d.url) {
        try {
          const url = await vidzeeAesDecrypt(item.link, decKey);
          if (url && url.startsWith('http') && !seen.has(url)) { seen.add(url); streams.push({ url, type: 'hls', quality: '', resolution: '' }); }
        } catch (_) {}
      }
      if (d.tracks) {
        for (const t of d.tracks) {
          if (t.url && t.url.startsWith('http')) subs.push({ url: t.url, lang: t.lang || 'unknown', type: 'vtt' });
        }
      }
    }
    return { source: 'vidzee_api', embedUrl: `https://player.vidzee.wtf/embed/${type}/${tmdbId}`, status: streams.length > 0 ? 'working' : 'no_streams', streams, subtitles: subs.length > 0 ? subs : undefined, latency_ms: Date.now() - start };
  } catch (err) {
    return { source: 'vidzee_api', embedUrl: '', status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * vidrock_api — Encrypted HTTP API (AES-CBC encrypt itemId).
 */
const VIDROCK_PASSPHRASE = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';

async function vidrockEncrypt(itemId) {
  const enc = new TextEncoder();
  const keyData = enc.encode(VIDROCK_PASSPHRASE);
  const iv = enc.encode(VIDROCK_PASSPHRASE.substring(0, 16));
  const key = await webcrypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, enc.encode(itemId));
  const arr = new Uint8Array(encrypted);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return Buffer.from(bin, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function scrapeVidrock({ tmdbId, type, season, episode }) {
  const start = Date.now();
  try {
    const itemId = type === 'tv' ? `${tmdbId}_${season || 1}_${episode || 1}` : String(tmdbId);
    const encryptedId = await vidrockEncrypt(itemId);
    const apiUrl = `https://vidrock.net/api/${type}/${encryptedId}`;
    const resp = await fetchUrl(apiUrl, { referer: 'https://vidrock.net/', timeout: 10000, responseType: 'json' });
    if (resp.error || !resp.html) return { source: 'vidrock_api', embedUrl: '', status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    const streams = [];
    const seen = new Set();
    for (const [srv, sd] of Object.entries(resp.html)) {
      if (!sd?.url) continue;
      if (!seen.has(sd.url)) { seen.add(sd.url); streams.push({ url: sd.url, type: sd.type === 'mp4' ? 'mp4' : 'hls', quality: '', resolution: '', server: srv }); }
    }
    // Fetch subtitles
    const subs = [];
    const subUrl = type === 'tv' ? `https://sub.vdrk.site/v2/tv/${tmdbId}/${season || 1}/${episode || 1}` : `https://sub.vdrk.site/v2/movie/${tmdbId}`;
    const subResp = await fetchUrl(subUrl, { referer: 'https://vidrock.net/', timeout: 5000, responseType: 'json' });
    if (!subResp.error && Array.isArray(subResp.html)) {
      for (const s of subResp.html) { if (s?.file) subs.push({ url: s.file, lang: s.label || 'unknown', type: s.file.endsWith('.vtt') ? 'vtt' : 'srt' }); }
    }
    return { source: 'vidrock_api', embedUrl: `https://vidrock.net/${type}/${tmdbId}`, status: streams.length > 0 ? 'working' : 'no_streams', streams, subtitles: subs.length > 0 ? subs : undefined, latency_ms: Date.now() - start };
  } catch (err) {
    return { source: 'vidrock_api', embedUrl: '', status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

/**
 * vidnest_api — Multi-server custom-base64 encrypted API.
 */
const VIDNEST_ALPHABET = 'RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=';
const VIDNEST_REVERSE = {};
for (let i = 0; i < VIDNEST_ALPHABET.length; i++) VIDNEST_REVERSE[VIDNEST_ALPHABET[i]] = i;

function decodeVidnest(input) {
  if (!input) throw new Error('Invalid');
  let p = input;
  const m = p.length % 4;
  if (m) p += '='.repeat(4 - m);
  const bytes = [];
  for (let i = 0; i < p.length; i += 4) {
    const c = p.slice(i, i + 4);
    const c0 = VIDNEST_REVERSE[c[0]] ?? 64, c1 = VIDNEST_REVERSE[c[1]] ?? 64;
    const c2 = c[2] === '=' ? 64 : (VIDNEST_REVERSE[c[2]] ?? 64);
    const c3 = c[3] === '=' ? 64 : (VIDNEST_REVERSE[c[3]] ?? 64);
    bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff);
    if (c2 !== 64) bytes.push((((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff);
    if (c3 !== 64) bytes.push((((c2 & 0x03) << 6) | c3) & 0xff);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const VIDNEST_SERVERS = ['moviebox', 'allmovies', 'purstream', 'hollymoviehd', 'vidlink', 'onehd'];

async function scrapeVidnest({ tmdbId, type, season, episode }) {
  const start = Date.now();
  try {
    const promises = VIDNEST_SERVERS.map(s => {
      const url = type === 'movie'
        ? `https://new.vidnest.fun/${s}/movie/${tmdbId}`
        : `https://new.vidnest.fun/${s}/tv/${tmdbId}/${season || 1}/${episode || 1}`;
      return fetchUrl(url, { referer: 'https://vidnest.fun/', timeout: 8000, responseType: 'json' }).then(r => ({ s, r }));
    });
    const results = await Promise.allSettled(promises);
    const streams = [];
    const subs = [];
    const seen = new Set();
    for (const settled of results) {
      if (settled.status !== 'fulfilled') continue;
      const { s: server, r: resp } = settled.value;
      if (resp.error || !resp.html) continue;
      const d = resp.html;
      let data;
      if (d.encrypted && d.data) { try { data = JSON.parse(decodeVidnest(d.data)); } catch (_) { continue; } }
      else if (!d.encrypted && d.data) data = d.data;
      else continue;
      try {
        if (server === 'moviebox' && data.url) {
          for (const u of data.url) { if (u.link && u.link.startsWith('http') && !seen.has(u.link)) { seen.add(u.link); streams.push({ url: u.link, type: u.type === 'mp4' ? 'mp4' : 'hls', quality: u.resolution ? u.resolution + 'p' : '', resolution: '' }); } }
        } else if (server === 'allmovies' && data.streams) {
          for (const st of data.streams) { if (st.url && st.url.startsWith('http') && !seen.has(st.url)) { seen.add(st.url); streams.push({ url: st.url, type: st.type === 'mp4' ? 'mp4' : 'hls', quality: '', resolution: '' }); } }
        } else if (server === 'purstream' && data.sources) {
          for (const src of data.sources) { if (src.url && src.url.startsWith('http') && !seen.has(src.url)) { seen.add(src.url); const q = src.name?.match(/(\d+p)/); streams.push({ url: src.url, type: 'hls', quality: q?.[1] || '', resolution: '' }); } }
        } else if (server === 'hollymoviehd' && data.sources) {
          for (const src of data.sources) { if (src.file && src.file.startsWith('http') && !seen.has(src.file)) { seen.add(src.file); streams.push({ url: src.file, type: src.type === 'mp4' ? 'mp4' : 'hls', quality: src.label || '', resolution: '' }); } }
        } else if (server === 'vidlink' && data?.data?.stream?.playlist) {
          const pl = data.data.stream.playlist;
          if (pl.startsWith('http') && !seen.has(pl)) { seen.add(pl); streams.push({ url: pl, type: 'hls', quality: '', resolution: '' }); }
          if (data.data.stream.captions) { for (const cap of data.data.stream.captions) { if (cap.url && cap.url.startsWith('http')) subs.push({ url: cap.url, lang: cap.language || 'unknown', type: 'vtt' }); } }
        } else if (server === 'onehd' && data.url) {
          if (data.url.startsWith('http') && !seen.has(data.url)) { seen.add(data.url); streams.push({ url: data.url, type: 'hls', quality: '', resolution: '' }); }
          if (data.subtitles) { for (const sub of data.subtitles) { if (sub.url && sub.url.startsWith('http')) subs.push({ url: sub.url, lang: sub.lang || 'unknown', type: 'vtt' }); } }
        }
      } catch (_) {}
    }
    return { source: 'vidnest_api', embedUrl: `https://vidnest.fun/${type}/${tmdbId}`, status: streams.length > 0 ? 'working' : 'no_streams', streams, subtitles: subs.length > 0 ? subs : undefined, latency_ms: Date.now() - start };
  } catch (err) {
    return { source: 'vidnest_api', embedUrl: '', status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

// ── Flicky source (v13/v14/v15) ──────────────────────────────────────────────

async function scrapeFlicky({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const isTv = type === 'tv';
  const pathSuffix = isTv ? `/${season || 1}/${episode || 1}` : '';
  const versions = [
    { ver: 'v13', label: 'Flicky v13 (VidZee)' },
    { ver: 'v14', label: 'Flicky v14 (VidZee)' },
    { ver: 'v15', label: 'Flicky v15 (Senpai)' },
  ];
  try {
    const results = await Promise.allSettled(versions.map(v =>
      fetchUrl(`https://gate.flicky.host/${v.ver}/${isTv ? 'tv' : 'movie'}/${tmdbId}${isTv ? pathSuffix : ''}`, { timeout: 10000, responseType: 'json' }).then(r => ({ ...r, ver: v }))
    ));
    const streams = []; const subs = []; const seen = new Set();
    for (const settled of results) {
      if (settled.status !== 'fulfilled') continue;
      const { html, error, ver } = settled.value;
      if (error || !html) continue;
      // v13/v14 format: { code: 0, data: { downloads: [...], captions: [...] } }
      if (html.code === 0 && html.data?.downloads) {
        for (const d of html.data.downloads) {
          if (d.url && d.url.startsWith('http') && !seen.has(d.url)) { seen.add(d.url); streams.push({ url: d.url, type: 'hls', quality: d.resolution ? d.resolution + 'p' : '', resolution: '', server: ver.label }); }
        }
        if (html.data.captions) { for (const cap of html.data.captions) { if (cap.url && cap.url.startsWith('http')) subs.push({ url: cap.url, lang: cap.lan || 'unknown', label: cap.lanName || '', type: cap.url.endsWith('.vtt') ? 'vtt' : 'srt' }); } }
      }
      // v15 format: { stream: "https://..." } or { stream: { url: "..." } }
      if (html.stream) {
        const url = typeof html.stream === 'string' ? html.stream : html.stream?.url || '';
        if (url && url.startsWith('http') && !seen.has(url)) { seen.add(url); streams.push({ url, type: 'hls', quality: '', resolution: '', server: ver.label }); }
      }
    }
    const seenSubs = new Set(); const uniqueSubs = subs.filter(s => { if (seenSubs.has(s.url)) return false; seenSubs.add(s.url); return true; });
    return { source: 'flicky_api', embedUrl: `https://gate.flicky.host/${isTv ? `tv/${tmdbId}${pathSuffix}` : `movie/${tmdbId}`}`, status: streams.length > 0 ? 'working' : 'no_streams', streams, ...(uniqueSubs.length > 0 ? { subtitles: uniqueSubs } : {}), latency_ms: Date.now() - start };
  } catch (err) {
    return { source: 'flicky_api', embedUrl: '', status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

// ── 02MovieDownloader source ─────────────────────────────────────────────────

async function scrape02Movie({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const isTv = type === 'tv';
  const path = isTv ? `/tv/${tmdbId}/${season || 1}/${episode || 1}` : `/movie/${tmdbId}`;
  const url = `https://02moviedownloader.site/api/download${path}`;
  const ref = url;
  try {
    // Step 1: Get session token
    const tokenResp = await fetchUrl('https://02moviedownloader.site/api/verify-robot', { method: 'POST', body: '{}', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Origin': 'https://02moviedownloader.site', 'Referer': ref }, responseType: 'json', timeout: 10000 });
    if (tokenResp.error || !tokenResp.html?.token) return { source: '02movie_api', embedUrl: url, status: 'error', error: 'Token fetch failed', streams: [], latency_ms: Date.now() - start };
    const token = tokenResp.html.token;

    // Step 2: Fetch movie data
    const movieResp = await fetchUrl(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'x-session-token': token, 'Referer': ref }, responseType: 'json', timeout: 15000 });
    if (movieResp.error || !movieResp.html) return { source: '02movie_api', embedUrl: url, status: 'error', error: 'Movie fetch failed', streams: [], latency_ms: Date.now() - start };
    const raw = movieResp.html;

    // Step 3: Decrypt if encrypted
    let data = raw;
    if (raw.encrypted === true && raw.data) {
      const parts = raw.data.split(':');
      if (parts.length === 2) {
        const iv = new Uint8Array(Buffer.from(parts[0], 'base64'));
        const ct = new Uint8Array(Buffer.from(parts[1], 'base64'));
        const key = new Uint8Array(require('crypto').createHash('sha256').update(token).digest());
        const decipher = require('crypto').createDecipheriv('aes-256-cbc', key, iv);
        const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
        data = JSON.parse(dec.toString('utf8'));
      }
    }

    // Step 4: Parse streams
    const streams = []; const subs = []; const seen = new Set();
    if (data.data?.downloadData?.data?.downloads) {
      for (const d of data.data.downloadData.data.downloads) {
        if (d.url && d.url.startsWith('http') && !seen.has(d.url)) { seen.add(d.url); streams.push({ url: d.url, type: 'mp4', quality: d.resolution ? d.resolution + 'p' : '', resolution: '' }); }
      }
    }
    if (data.externalStreams) {
      for (const s of data.externalStreams) {
        if (s.url.includes('111477.xyz')) continue;
        if (s.url && s.url.startsWith('http') && !seen.has(s.url)) { seen.add(s.url); const q = s.quality?.match(/(\d+)/); streams.push({ url: s.url, type: s.url.includes('.mkv') ? 'mkv' : 'mp4', quality: q ? q[1] + 'p' : '' }); }
      }
    }
    if (data.data?.downloadData?.data?.captions) {
      for (const cap of data.data.downloadData.data.captions) {
        if (cap.url && cap.url.startsWith('http')) subs.push({ url: cap.url, lang: cap.lan || 'unknown', label: cap.lanName || '', type: cap.url.endsWith('.srt') ? 'srt' : 'vtt' });
      }
    }
    return { source: '02movie_api', embedUrl: url, status: streams.length > 0 ? 'working' : 'no_streams', streams, ...(subs.length > 0 ? { subtitles: subs } : {}), latency_ms: Date.now() - start };
  } catch (err) {
    return { source: '02movie_api', embedUrl: '', status: 'error', error: err.message, streams: [], latency_ms: Date.now() - start };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Section 4: Aggregator
// ──────────────────────────────────────────────────────────────────────────────

const ALL_SOURCES = [
  { name: 'cine.su',        scrape: scrapeCineSu },
  { name: 'vaplayer.ru',    scrape: scrapeVaplayer },
  { name: 'ezvidapi.com',   scrape: scrapeEzvidapi },
  { name: 'vidlink.pro',    scrape: scrapeVidlink },
  { name: 'videasy.net',    scrape: scrapeVideasy },
  { name: 'vixsrc.to',      scrape: scrapeVixsrc },
  { name: 'vidzee_api',     scrape: scrapeVidzee },
  { name: 'vidrock_api',    scrape: scrapeVidrock },
  { name: 'vidnest_api',    scrape: scrapeVidnest },
  { name: 'flicky_api',     scrape: scrapeFlicky },
  { name: '02movie_api',    scrape: scrape02Movie },
];

const SOURCE_TIMEOUT = 30000;
const SOURCE_COUNT = ALL_SOURCES.length; // 11 sources

/**
 * Run all sources in parallel and aggregate results.
 * This is the main API function, also exported for module use.
 */
async function scrapeAll(tmdbId, type = 'movie', season = 1, episode = 1) {
  const globalStart = Date.now();
  const params = { tmdbId: parseInt(tmdbId), type, season: parseInt(season), episode: parseInt(episode) };

  const results = await Promise.allSettled(
    ALL_SOURCES.map(src => {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Source timeout')), SOURCE_TIMEOUT)
      );
      return Promise.race([
        src.scrape(params).catch(err => ({
          source: src.name,
          status: 'error',
          error: err.message,
          streams: [],
          latency_ms: Date.now() - globalStart,
        })),
        timeoutPromise,
      ]).catch(err => ({
        source: src.name,
        status: 'error',
        error: err.message || 'Source timeout',
        streams: [],
        latency_ms: Date.now() - globalStart,
      }));
    })
  );

  const sourcesOut = [];
  let workingCount = 0;
  const allStreams = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const srcName = ALL_SOURCES[i].name;
    if (r.status === 'fulfilled') {
      const val = r.value;
      if (!val.source || val.source === 'unknown') val.source = srcName;
      sourcesOut.push(val);
      if (val.status === 'working' && val.streams?.length > 0) {
        workingCount++;
        allStreams.push(...val.streams);
      }
    } else {
      sourcesOut.push({
        source: srcName,
        status: 'error',
        error: r.reason?.message || 'Promise failed',
        streams: [],
        latency_ms: Date.now() - globalStart,
      });
    }
  }

  // Sort: working first, then embed, then error
  sourcesOut.sort((a, b) => {
    const order = { working: 0, no_streams: 1, embed: 2, unavailable: 2, error: 3 };
    return (order[a.status] || 4) - (order[b.status] || 4);
  });

  const uniqueUrls = new Set(allStreams.map(s => s.url));

  return {
    success: true,
    tmdbId: parseInt(tmdbId),
    type,
    ...(type === 'tv' ? { season: parseInt(season), episode: parseInt(episode) } : {}),
    sources: sourcesOut,
    workingSources: workingCount,
    totalSourcesChecked: SOURCE_COUNT,
    totalUniqueStreams: uniqueUrls.size,
    elapsed_ms: Date.now() - globalStart,
    timestamp: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Section 5: CLI / Pipe support
// ──────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const match = a.replace(/^--/, '').split('=');
    args[match[0]] = match[1] || true;
  }
  return args;
}

async function main() {
  const args = parseArgs();
  let tmdbId = args.tmdb || args.id;
  let type = args.type || 'movie';
  const season = args.season || 1;
  const episode = args.episode || 1;

  // IMDB ID support ─ convert tt... to TMDB ID (auto-detects movie vs TV)
  if (args.imdb) {
    try {
      const lookup = await imdbToTmdb(args.imdb);
      tmdbId = lookup.tmdbId;
      type = lookup.type;
      console.warn(`[IMDB] ${args.imdb} → TMDB ${tmdbId} (${type}: ${lookup.title})`);
    } catch (e) {
      console.log(JSON.stringify({ success: false, error: `IMDB lookup failed: ${e.message}` }, null, 2));
      process.exit(1);
    }
  }

  if (!tmdbId) {
    const usage = {
      success: false,
      error: 'Usage: node raw-api.js --tmdb=24428 OR node raw-api.js --imdb=tt0848228',
      examples: {
        movie_tmdb: 'node raw-api.js --tmdb=24428',
        movie_imdb: 'node raw-api.js --imdb=tt0848228',
        tv_tmdb: 'node raw-api.js --tmdb=1399 --type=tv --season=1 --episode=1',
        tv_imdb: 'node raw-api.js --imdb=tt0903747 --season=1 --episode=1',
        pipe: 'curl -s https://raw.githubusercontent.com/sunriseve/multisource-api/main/raw-api.js | node - --imdb=tt0848228',
      },
    };
    console.log(JSON.stringify(usage, null, 2));
    process.exit(1);
  }

  try {
    const result = await scrapeAll(tmdbId, type, season, episode);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Section 6: Module exports (for require/import)
// ──────────────────────────────────────────────────────────────────────────────

module.exports = { scrapeAll, sourceCount: SOURCE_COUNT };

// Auto-run if executed directly OR piped via stdin (curl | node -)
if (require.main === module || module.id === '[stdin]') {
  main();
}
