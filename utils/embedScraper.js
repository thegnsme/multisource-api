/**
 * embedScraper.js — Advanced embed page scraper for extracting direct video URLs
 *
 * Tries multiple extraction strategies in order:
 *   1. Regex for .m3u8 / .mp4 in raw HTML
 *   2. Match file:/src:/url: patterns in JS configs
 *   3. Match data-src/data-url/data-file attributes
 *   4. Extract iframe src → recurse into iframe
 *   5. Decode base64/hidden URLs in scripts
 *   6. Fetch known JSON API endpoints
 */

const axios = require('axios');
const https = require('https');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Axios v1.x needs IPv4 forced in some environments
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

/**
 * Fetch with retries and proper headers
 */
async function smartFetch(url, opts = {}) {
  const { referer, timeout = 10000, retries = 2, responseType } = opts;
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(referer ? { 'Referer': referer } : {}),
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await axios.get(url, {
        headers,
        timeout,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: responseType || 'text',
        httpsAgent,
      });
      return {
        html: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
        status: resp.status,
        headers: resp.headers,
      };
    } catch (e) {
      if (i === retries) return { html: null, status: 0, error: e.message };
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { html: null, status: 0, error: 'max retries' };
}

/**
 * Try to follow an iframe src URL recursively (max depth 2)
 */
async function followIframe(src, depth = 0, referer = '') {
  if (depth > 2 || !src) return [];
  // Make relative URLs absolute
  if (src.startsWith('//')) src = 'https:' + src;
  if (src.startsWith('/')) src = referer ? new URL(src, referer).href : src;
  if (!src.startsWith('http')) return [];

  const { html } = await smartFetch(src, { referer, timeout: 8000 });
  if (!html) return [];

  const streams = extractStreams(html);
  if (streams.length > 0) return streams;

  // Recursive: look for iframes inside the iframe
  const iframeRegex = /<iframe[^>]*src=["']([^"']+)["']/gi;
  let match;
  while ((match = iframeRegex.exec(html)) !== null) {
    const childStreams = await followIframe(match[1], depth + 1, src);
    if (childStreams.length > 0) return childStreams;
  }

  return [];
}

/**
 * Check if a URL looks like a direct video file (not an embed/page URL)
 */
function isVideoUrl(url) {
  // Must be HTTP(S)
  if (!url.startsWith('http')) return false;

  // Extract the path portion (after domain) to check extensions
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch (e) { /* fall back to full URL */ }

  // Direct video file extensions — check ONLY in the path, not domain!
  if (/\.(m3u8|mp4|webm|mkv|avi|mov|ts|m4s)(\?|$|#)/i.test(path)) return true;

  // Common video delivery patterns in path
  if (/\/manifest/i.test(path)) return true;
  if (/(playlist|chunklist|master)\.m3u8/i.test(path)) return true;

  // Skip known non-video patterns
  if (/\/embed\//i.test(path)) return false;
  if (/\.(js|css|png|jpg|svg|ico|woff|ttf|php|html?)\b/i.test(path)) return false;
  if (/(jsdelivr|cloudflare|googleapis)\.(net|com)/i.test(url)) return false;

  // API endpoints COULD return video URLs — allow them
  if (/\/api\//i.test(path)) return false;  // actually no, we check API responses separately

  return false;
}

/**
 * Extract streams from HTML/JS using multiple strategies
 */
function extractStreams(html) {
  if (!html) return [];
  const streams = [];
  const seen = new Set();

  function addStream(url, quality = '', type = 'hls') {
    if (!url || seen.has(url)) return;
    seen.add(url);
    // Clean URL of trailing garbage
    url = url.replace(/['")>\s]+$/g, '').replace(/\\\//g, '/').replace(/\\"/g, '').trim();
    if (!isVideoUrl(url)) return;
    streams.push({ url, type, quality });
  }

  // Strategy 1: Direct .m3u8 URLs
  const m3u8Regex = /https?:\/\/[^\s"'<>\[\]()]+\.m3u8[^\s"'<>\[\]()]*/gi;
  let match;
  while ((match = m3u8Regex.exec(html)) !== null) addStream(match[0]);

  // Strategy 2: Direct .mp4 URLs
  const mp4Regex = /https?:\/\/[^\s"'<>\[\]()]+\.mp4[^\s"'<>\[\]()]*/gi;
  while ((match = mp4Regex.exec(html)) !== null) addStream(match[0], '', 'mp4');

  // Strategy 3: JW Player / Plyr / VideoJS config patterns
  const configPatterns = [
    /file["']?\s*:\s*["']([^"']+)["']/gi,
    /src["']?\s*:\s*["']([^"']+)["']/gi,
    /url["']?\s*:\s*["']([^"']+)["']/gi,
    /source["']?\s*:\s*["']([^"']+)["']/gi,
    /link["']?\s*:\s*["']([^"']+)["']/gi,
    /video["']?\s*:\s*["']([^"']+)["']/gi,
    /data-file["']?\s*=\s*["']([^"']+)["']/gi,
    /data-src["']?\s*=\s*["']([^"']+)["']/gi,
    /data-url["']?\s*=\s*["']([^"']+)["']/gi,
    /data-source["']?\s*=\s*["']([^"']+)["']/gi,
    /data-hls["']?\s*=\s*["']([^"']+)["']/gi,
    /data-video["']?\s*=\s*["']([^"']+)["']/gi,
    /data-m3u8["']?\s*=\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of configPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1].replace(/\\\//g, '/').replace(/\\"/g, '').trim();
      const type = url.includes('.m3u8') ? 'hls' : 'mp4';
      addStream(url, '', type);
    }
  }

  // Strategy 4: JavaScript variable assignments with URLs
  const varPatterns = [
    /var\s+\w+\s*=\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
    /const\s+\w+\s*=\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
    /let\s+\w+\s*=\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
    /\w+\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
  ];

  for (const pattern of varPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      addStream(match[1]);
    }
  }

  // Strategy 5: Decode potential base64-encoded URLs in scripts
  const base64Regex = /["']([A-Za-z0-9+/=]{40,})["']/g;
  while ((match = base64Regex.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      if (isVideoUrl(decoded)) {
        addStream(decoded);
      }
    } catch (e) { /* not valid base64 */ }
  }

  // Strategy 6: Hex-encoded URLs
  const hexRegex = /["'](\\x[0-9a-f]{2}){20,}["']/gi;
  while ((match = hexRegex.exec(html)) !== null) {
    try {
      const decoded = match[0].replace(/\\x/g, '').replace(/["']/g, '');
      const hexStr = Buffer.from(decoded, 'hex').toString('utf-8');
      if (isVideoUrl(hexStr)) {
        addStream(hexStr);
      }
    } catch (e) { /* not valid hex */ }
  }

  return streams;
}

/**
 * Check if a URL looks like a video manifest (for API responses)
 */
function extractStreamsFromJson(jsonData) {
  if (!jsonData) return [];
  const str = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData);
  return extractStreams(str);
}

/**
 * Extract iframe URLs from HTML
 */
function extractIframes(html) {
  if (!html) return [];
  const iframes = [];
  const regex = /<iframe[^>]*src=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    iframes.push(match[1]);
  }
  return iframes;
}

/**
 * Main scrape function for embed sources
 * Returns { source, embedUrl, status, streams, ... }
 */
async function scrapeEmbedSource({
  name,
  embedUrl,
  apiUrl = null,       // optional direct API URL to try first
  referer = '',
  timeout = 10000,
}) {
  const start = Date.now();
  let streams = [];
  let status = 'embed';
  let debug = {};

  // Strategy A: Try direct API URL if provided
  if (apiUrl) {
    const apiResult = await smartFetch(apiUrl, { referer, timeout, responseType: 'json' });
    if (apiResult.html) {
      try {
        const data = JSON.parse(apiResult.html);
        // Check for m3u8 in JSON response
        const jsonStreams = extractStreams(JSON.stringify(data));
        if (jsonStreams.length > 0) {
          streams = jsonStreams;
          status = 'working';
          debug.api = 'found';
        }
      } catch (e) { /* not JSON */ }
    }
  }

  // Strategy B: Fetch the embed page
  if (streams.length === 0) {
    const { html, status: httpStatus } = await smartFetch(embedUrl, { referer, timeout });
    debug.httpStatus = httpStatus;

    if (html) {
      // Try direct extraction from HTML
      streams = extractStreams(html);
      debug.directMatch = streams.length;

      // Try iframe recursion
      if (streams.length === 0) {
        const iframes = extractIframes(html);
        debug.iframes = iframes.length;
        for (const iframe of iframes) {
          const iframeStreams = await followIframe(iframe, 0, embedUrl);
          if (iframeStreams.length > 0) {
            streams = iframeStreams;
            debug.iframeSource = iframe;
            break;
          }
        }
      }
    }

    if (streams.length > 0) {
      status = 'working';
    }
  }

  return {
    source: name,
    embedUrl,
    status,
    streams,
    latency_ms: Date.now() - start,
    _debug: debug,
  };
}

module.exports = { scrapeEmbedSource, extractStreams, smartFetch };
