/**
 * vidsrc.icu — Cloudnestra CDN backend.
 *
 * Chain: vidsrc.icu/embed/movie/{id} → iframe to vidsrcme.vidsrc.icu
 * → iframe to cloudnestra.com/rcp/BASE64 → prorcp → m3u8
 *
 * Delegates to the canonical cloudnestra.js implementation.
 */

const cloudnestra = require('./cloudnestra');

const BASE = 'https://vidsrc.icu';

async function scrapeSource(params) {
  const { tmdbId, type, season, episode } = params;
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}?season=${season || 1}&episode=${episode || 1}`;

  try {
    const result = await cloudnestra.scrapeSource(params);
    // Override the source name
    result.source = 'vidsrc.icu';
    result.embedUrl = embedUrl;
    return result;
  } catch (err) {
    return {
      source: 'vidsrc.icu',
      embedUrl,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: 0,
    };
  }
}

module.exports = { scrapeSource };
