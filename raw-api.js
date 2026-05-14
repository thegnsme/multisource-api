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
 *   node raw-api.js --tmdb=1399 --type=tv --season=1 --episode=1
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
 */

'use strict';

// ──────────────────────────────────────────────────────────────────────────────
// Section 1: Built-in HTTP client (no axios needed)
// ──────────────────────────────────────────────────────────────────────────────

const https = require('https');
const http = require('http');
const { URL } = require('url');

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

// ──────────────────────────────────────────────────────────────────────────────
// Section 4: Aggregator
// ──────────────────────────────────────────────────────────────────────────────

const ALL_SOURCES = [
  { name: 'vaplayer.ru',    scrape: scrapeVaplayer },
  { name: 'ezvidapi.com',   scrape: scrapeEzvidapi },
  { name: 'vidlink.pro',    scrape: scrapeVidlink },
  { name: 'videasy.net',    scrape: scrapeVideasy },
  { name: 'vixsrc.to',      scrape: scrapeVixsrc },
];

const SOURCE_TIMEOUT = 30000;
const SOURCE_COUNT = ALL_SOURCES.length;

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
  const tmdbId = args.tmdb || args.id;
  const type = args.type || 'movie';
  const season = args.season || 1;
  const episode = args.episode || 1;

  if (!tmdbId) {
    const usage = {
      success: false,
      error: 'Usage: node raw-api.js --tmdb=24428 [--type=movie|tv] [--season=N] [--episode=N]',
      pipe_from_github: 'curl -s https://raw.githubusercontent.com/sunriseve/multisource-api/main/raw-api.js | node - --tmdb=24428',
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
