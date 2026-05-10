/**
 * cloudnestra.com — Primary CDN for vidsrc.icu, vidsrc.to, vidsrc.fyi, vidsrcme.su, and many others.
 *
 * Chain: vidsrc.icu → vidsrcme.vidsrc.icu → cloudnestra.com/rcp/BASE64 → prorcp → m3u8
 * The rcp page sometimes returns Turnstile (rate-limited). Retry logic handles this.
 * When blocked, falls back to the embed URL.
 *
 * {v1}..{v5} → 'cloudnestra.com' (CDN hostname, resolves to Cloudflare)
 *
 * Returns HLS master playlists with quality variants (360p, 720p, 1080p).
 */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const QUALITY_MAP = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetch(url, opts = {}) {
  const { referer, timeout = 8000, retries = 1 } = opts;
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    ...(referer ? { 'Referer': referer } : {}),
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await axios.get(url, { headers, timeout, maxRedirects: 3, validateStatus: () => true });
      if (resp.status >= 200 && resp.status < 500) return resp;
    } catch (e) {
      if (i === retries) throw e;
      await sleep(500);
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

/** Resolve {v1}..{v5} → cloudnestra.com */
function resolveVars(url) {
  return url.replace(/\{v[1-5]\}/g, 'cloudnestra.com');
}

/** Build the embed URL for this source family */
function embedUrl(tmdbId, type, season, episode) {
  const base = 'https://vidsrc.icu/embed';
  if (type === 'movie') return `${base}/movie/${tmdbId}`;
  return `${base}/tv/${tmdbId}?season=${season}&episode=${episode}`;
}

// ---------------------------------------------------------------------------
//  Chain: vidsrc.icu → vidsrcme.vidsrc.icu → cloudnestra rcp → prorcp
// ---------------------------------------------------------------------------

async function getProrcpPage(tmdbId, type, season, episode) {
  const path = type === 'movie'
    ? `/embed/movie/${tmdbId}`
    : `/embed/tv/${tmdbId}?season=${season}&episode=${episode}`;

  // Try once, fail fast — Turnstile will block from most IPs anyway
  try {
    // 1 -- vidsrc.icu
    const r1 = await fetch(`https://vidsrc.icu${path}`, { timeout: 8000, retries: 0 });
    const iframe1 = r1.data.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
    if (!iframe1) throw new Error('No iframe on vidsrc.icu');

    let vidsrcmeUrl = iframe1[1];
    if (vidsrcmeUrl.startsWith('//')) vidsrcmeUrl = 'https:' + vidsrcmeUrl;
    if (!vidsrcmeUrl.startsWith('http')) vidsrcmeUrl = new URL(vidsrcmeUrl, `https://vidsrc.icu${path}`).href;

    // 2 -- vidsrcme.vidsrc.icu  →  cloudnestra iframe
    const r2 = await fetch(vidsrcmeUrl, { referer: `https://vidsrc.icu${path}`, timeout: 8000, retries: 0 });
    const iframe2 = r2.data.match(/<iframe[^>]+src\s*=\s*["']([^"']*cloudnestra[^"']*)["']/i);
    if (!iframe2) throw new Error('No cloudnestra iframe on vidsrcme');

    let cnRcpUrl = iframe2[1];
    if (cnRcpUrl.startsWith('//')) cnRcpUrl = 'https:' + cnRcpUrl;

    // 3 -- cloudnestra /rcp/  →  extract prorcp path
    const r3 = await fetch(cnRcpUrl, { referer: vidsrcmeUrl, timeout: 10000, retries: 0 });
    const prorcpMatch = r3.data.match(/["'](\/prorcp\/[^"']+)["']/);
    if (!prorcpMatch) throw new Error('Turnstile blocked or no prorcp path');

    const prorcpFull = `https://cloudnestra.com${prorcpMatch[1]}`;

    // 4 -- prorcp page (contains m3u8 with {v1} placeholders)
    const r4 = await fetch(prorcpFull, { referer: cnRcpUrl, timeout: 10000, retries: 0 });

    return { html: r4.data, prorcpUrl: prorcpFull, rcpUrl: cnRcpUrl };
  } catch (e) {
    throw new Error('cloudnestra: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
//  m3u8 parsing
// ---------------------------------------------------------------------------

function parseMasterPlaylist(m3u8, baseUrl) {
  if (!m3u8 || !m3u8.startsWith('#EXTM3U')) return [];
  if (!m3u8.includes('#EXT-X-STREAM-INF:')) {
    // Single-quality media playlist
    const urls = m3u8.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    return urls.map(url => ({
      url: url.startsWith('http') ? url : new URL(url, baseUrl).href,
      type: 'hls', quality: '', resolution: '',
    }));
  }

  const streams = [];
  const lines = m3u8.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const next = lines[i + 1]?.trim();
    if (!next || next.startsWith('#')) continue;

    const bandwidth = line.match(/BANDWIDTH=(\d+)/)?.[1];
    const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1];
    const codecs = line.match(/CODECS="([^"]+)"/)?.[1];

    let url = next;
    if (!url.startsWith('http')) url = new URL(url, baseUrl).href;

    const height = resolution ? resolution.split('x')[1] : '';
    const quality = QUALITY_MAP[height] || (height ? height + 'p' : '');

    streams.push({
      url,
      type: 'hls',
      quality,
      resolution: resolution || '',
      bandwidth: bandwidth ? parseInt(bandwidth) : undefined,
      codecs: codecs || undefined,
    });
    i++; // skip consumed line
  }

  return streams;
}

// ---------------------------------------------------------------------------
//  Subtitle extraction from prorcp page
// ---------------------------------------------------------------------------

function extractSubtitles(html, baseUrl) {
  const subs = [];
  const seen = new Set();

  // Pattern: {file:"…vtt", label:"…"} or {s:"…", l:"…"}
  const re = /["'](?:file|src|s)["']\s*:\s*["']([^"']+\.(?:vtt|srt))["'][^}]*?["'](?:label|l|lang|k)["']\s*:\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [_, file, label] = m;
    if (!seen.has(file)) {
      seen.add(file);
      let url = file;
      if (url.startsWith('//')) url = 'https:' + url;
      else if (!url.startsWith('http')) url = new URL(url, baseUrl).href;
      subs.push({ url, lang: label, type: url.endsWith('.vtt') ? 'vtt' : 'srt' });
    }
  }

  // Also scrape bare .vtt/.srt URLs
  const urlRe = /https?:\/\/[^\s"'<>]+\.(?:vtt|srt)[^\s"'<>]*/gi;
  while ((m = urlRe.exec(html)) !== null) {
    const url = m[0].replace(/[)>]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      subs.push({ url, lang: 'unknown', type: url.endsWith('.vtt') ? 'vtt' : 'srt' });
    }
  }

  return subs;
}

// ---------------------------------------------------------------------------
//  Title extraction
// ---------------------------------------------------------------------------

function extractTitle(html) {
  const atobMatch = html.match(/atob\(['"]([^'"]+)['"]\)/);
  if (atobMatch) {
    try {
      const decoded = Buffer.from(atobMatch[1], 'base64').toString('utf-8');
      const parts = decoded.split('/');
      if (parts[0]) return parts[0].replace(/\[.*?\]/g, '').trim();
    } catch (_) { /* ignore */ }
  }
  // fallback: TMDB poster name
  const poster = html.match(/poster["']\s*:\s*["'][^"']+\/p\/[^"']+\/([^"']+)\.jpg/i);
  if (poster) return decodeURIComponent(poster[1].replace(/[_-]/g, ' '));
  return undefined;
}

// ---------------------------------------------------------------------------
//  Main scraper
// ---------------------------------------------------------------------------

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embed = embedUrl(tmdbId, type, season, episode);

  try {
    const { html, prorcpUrl } = await getProrcpPage(tmdbId, type, season, episode);

    // Extract raw m3u8 URLs
    const rawUrls = html.match(/https?:\/\/[^\s"'<>`]+\.m3u8[^\s"'<>`]*/g);
    if (!rawUrls || rawUrls.length === 0) {
      return { source: 'cloudnestra.com', embedUrl: embed, status: 'embed', streams: [], latency_ms: Date.now() - start };
    }

    // Resolve placeholders & deduplicate
    const resolved = [...new Set(rawUrls.map(u => resolveVars(u)))];

    // Fetch each unique m3u8 and parse
    const allStreams = [];
    const seen = new Set();

    for (const rawUrl of resolved) {
      try {
        const resp = await fetch(rawUrl, { referer: prorcpUrl, timeout: 12000, retries: 1 });
        if (resp.data?.startsWith?.('#EXTM3U')) {
          for (const v of parseMasterPlaylist(resp.data, rawUrl)) {
            if (!seen.has(v.url)) { seen.add(v.url); allStreams.push(v); }
          }
        }
      } catch (_) { /* CDN subdomain may be down; skip */ }
    }

    // Subtitle & title
    const subtitles = extractSubtitles(html, prorcpUrl);
    const title = extractTitle(html);

    // Fallback: include raw URLs if parsing produced nothing
    if (allStreams.length === 0) {
      for (const url of resolved) {
        if (!seen.has(url)) { seen.add(url); allStreams.push({ url, type: 'hls', quality: '', resolution: '' }); }
      }
    }

    return {
      source: 'cloudnestra.com',
      embedUrl: embed,
      status: allStreams.length > 0 ? 'working' : 'embed',
      title,
      streams: allStreams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    // Rate-limited or blocked — return embed URL as fallback
    return {
      source: 'cloudnestra.com',
      embedUrl: embed,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource, fetch, resolveVars, parseMasterPlaylist, extractSubtitles, extractTitle, sleep, UA, QUALITY_MAP };
