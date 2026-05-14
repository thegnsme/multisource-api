/**
 * TMDB Lookup Utility — Converts IMDB IDs (tt...) to TMDB IDs.
 *
 * Uses TMDB API to find the TMDB ID for a given IMDB ID.
 * Supports movies and TV shows.
 *
 * Usage:
 *   const { imdbToTmdb } = require('./utils/tmdb-lookup');
 *   const result = await imdbToTmdb('tt0848228');
 *   // → { tmdbId: 24428, type: 'movie', title: 'The Avengers' }
 */

const https = require('https');
const { URL } = require('url');

// First working API key from tested keys
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const TMDB_BASE = 'https://api.themoviedb.org/3';

/**
 * Simple HTTPS fetch for JSON
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 8000,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Convert IMDB ID (tt0848228) to TMDB ID.
 * Returns { tmdbId, type, title } or throws error.
 */
async function imdbToTmdb(imdbId) {
  // Strip any URL prefixes
  const cleanId = imdbId.replace(/^https?:\/\/[^/]+\/(title\/)?/i, '').replace(/\/.*$/, '').trim();
  
  if (!cleanId.startsWith('tt')) {
    throw new Error('Invalid IMDB ID format — must start with "tt" (e.g., tt0848228)');
  }

  // Try movie first, then TV
  const data = await fetchJson(`${TMDB_BASE}/find/${cleanId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  
  if (!data) {
    throw new Error('TMDB API request failed');
  }

  // Check for movie results
  if (data.movie_results && data.movie_results.length > 0) {
    const m = data.movie_results[0];
    return { tmdbId: m.id, type: 'movie', title: m.title || m.original_title };
  }

  // Check for TV results
  if (data.tv_results && data.tv_results.length > 0) {
    const t = data.tv_results[0];
    return { tmdbId: t.id, type: 'tv', title: t.name || t.original_name };
  }

  throw new Error(`No TMDB ID found for IMDB ID: ${cleanId}`);
}

module.exports = { imdbToTmdb };
