/**
 * videasy.net — Uses api.videasy.net for encrypted source data + enc-dec.app for decryption.
 *
 * Chain:
 *   1. api.videasy.net/cdn/sources-with-title?tmdbId={id}&mediaType={type}[&season=N&episode=N]
 *      → returns AES-like encrypted string (~63KB-138KB)
 *   2. enc-dec.app/api/dec-videasy POST {text, id}
 *      → returns {status:200, result: { sources: [{quality, url}], subtitles: [{lang, language, url}] }}
 *
 * Quality variants: 4K, 1080p, 720p, 480p
 * Subtitle count: 67-152+ depending on content
 */

const axios = require('axios');

const VIDEO_API = 'https://api.videasy.net/cdn/sources-with-title';
const DECRYPT_API = 'https://enc-dec.app/api/dec-videasy';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://videasy.net/${type === 'movie' ? 'movie' : 'show'}/${tmdbId}` +
    (type === 'tv' ? `/season/${season || 1}/episode/${episode || 1}` : '');

  try {
    // Step 1: Call videasy API to get encrypted data
    const params = {
      title: '',
      mediaType: type,
      year: '',
      tmdbId: String(tmdbId),
      imdbId: '',
    };
    if (type === 'tv') {
      params.season = String(season || 1);
      params.episode = String(episode || 1);
    }

    const apiResp = await axios.get(VIDEO_API, {
      params,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://videasy.net/',
      },
      timeout: 20000,
    });

    const encryptedText = typeof apiResp.data === 'string' ? apiResp.data.trim() : String(apiResp.data);
    if (!encryptedText || encryptedText.length < 10) {
      return {
        source: 'videasy.net',
        embedUrl,
        status: 'no_streams',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    // Step 2: Decrypt via enc-dec.app
    const decryptResp = await axios.post(DECRYPT_API, {
      text: encryptedText,
      id: String(tmdbId),
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 30000,
    });

    if (decryptResp.data?.status !== 200 || !decryptResp.data?.result) {
      return {
        source: 'videasy.net',
        embedUrl,
        status: 'error',
        error: 'Decryption failed',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    const result = decryptResp.data.result;
    const rawSources = result.sources || [];
    const rawSubtitles = result.subtitles || [];

    // Build streams from sources
    const streams = rawSources.map(s => ({
      url: s.url,
      type: 'hls',
      quality: s.quality || '',
      resolution: s.quality ? qualityToResolution(s.quality) : '',
    }));

    // Build subtitles
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
    return {
      source: 'videasy.net',
      embedUrl,
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

function qualityToResolution(quality) {
  const map = {
    '4K': '3840x2160',
    '2160p': '3840x2160',
    '1080p': '1920x1080',
    '720p': '1280x720',
    '480p': '854x480',
    '360p': '640x360',
  };
  return map[quality] || '';
}

module.exports = { scrapeSource };
