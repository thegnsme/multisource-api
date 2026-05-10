#!/usr/bin/env node
/**
 * MultiSource API — HTTP Server
 *
 * Endpoints:
 *   GET /api/health           — Health check
 *   GET /api/sources          — List all available sources
 *   GET /api/movie/:tmdbId    — Get streams for a movie
 *   GET /api/tv/:tmdbId       — Get streams for a TV episode (?season=N&episode=N)
 *
 * Usage:
 *   npm start
 *   curl http://localhost:3000/api/movie/24428
 */

const express = require('express');
const { aggregateAll, sourceCount } = require('./sources');

const app = express();
const PORT = process.env.PORT || 3000;
const NAME = 'MultiSource API';
const VERSION = '2.0.0';

// ── Middleware ──────────────────────────────────────────────────────────────

// CORS — allow any origin in dev, can be locked down via env
app.use((req, res, next) => {
  const origin = process.env.CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// JSON body parser (for future POST endpoints)
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Cache control — short TTL for stream data (30s), longer for static
app.use('/api/health', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache');
  next();
});
app.use('/api', (req, res, next) => {
  // Stream data changes infrequently per request — allow 30s CDN cache
  res.setHeader('Cache-Control', 'public, max-age=30');
  next();
});

// ── Validation helper ──────────────────────────────────────────────────────

function validateTmdbId(tmdbId) {
  const num = parseInt(tmdbId, 10);
  if (!tmdbId || isNaN(num) || num <= 0) {
    return { valid: false, error: 'Invalid tmdbId — must be a positive integer' };
  }
  return { valid: true, id: num };
}

function validateTvParams(season, episode) {
  const s = parseInt(season, 10);
  const e = parseInt(episode, 10);
  if (season !== undefined && (isNaN(s) || s < 1)) {
    return { valid: false, error: 'Invalid season — must be a positive integer' };
  }
  if (episode !== undefined && (isNaN(e) || e < 1)) {
    return { valid: false, error: 'Invalid episode — must be a positive integer' };
  }
  return { valid: true, season: s || 1, episode: e || 1 };
}

// ── Error response helper ──────────────────────────────────────────────────

function errorResponse(res, status, message, details = null) {
  const body = { success: false, error: message };
  if (details) body.details = details;
  return res.status(status).json(body);
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    name: NAME,
    version: VERSION,
    uptime: process.uptime(),
    sourcesLoaded: sourceCount,
    memoryUsage: process.memoryUsage().rss,
    timestamp: new Date().toISOString(),
  });
});

// List available sources
app.get('/api/sources', async (req, res) => {
  // Dynamic require all source files to get metadata
  const fs = require('fs');
  const path = require('path');
  const sourceDir = __dirname + '/sources';
  const files = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .sort();

  const sourceList = [];
  for (const file of files) {
    const name = file.replace(/\.js$/, '').replace(/_/g, '.');
    try {
      const mod = require(path.join(sourceDir, file));
      const hasScraper = typeof mod.scrapeSource === 'function';
      sourceList.push({
        name,
        file,
        hasScraper,
        loaded: true,
      });
    } catch (e) {
      sourceList.push({
        name,
        file,
        hasScraper: false,
        loaded: false,
        loadError: e.message,
      });
    }
  }

  const workingCount = sourceList.filter(s => s.hasScraper).length;

  res.json({
    success: true,
    total: sourceList.length,
    working: workingCount,
    sources: sourceList,
    timestamp: new Date().toISOString(),
  });
});

// Movie streams
app.get('/api/movie/:tmdbId', async (req, res) => {
  const validation = validateTmdbId(req.params.tmdbId);
  if (!validation.valid) {
    return errorResponse(res, 400, validation.error);
  }

  try {
    const result = await aggregateAll(validation.id, 'movie');
    res.json(result);
  } catch (err) {
    console.error(`Error fetching movie ${validation.id}:`, err.message);
    errorResponse(res, 500, 'Failed to aggregate streams', err.message);
  }
});

// TV streams
app.get('/api/tv/:tmdbId', async (req, res) => {
  const idValidation = validateTmdbId(req.params.tmdbId);
  if (!idValidation.valid) {
    return errorResponse(res, 400, idValidation.error);
  }

  const paramValidation = validateTvParams(req.query.season, req.query.episode);
  if (!paramValidation.valid) {
    return errorResponse(res, 400, paramValidation.error);
  }

  try {
    const result = await aggregateAll(
      idValidation.id,
      'tv',
      paramValidation.season,
      paramValidation.episode
    );
    res.json(result);
  } catch (err) {
    console.error(`Error fetching TV ${idValidation.id} S${paramValidation.season}E${paramValidation.episode}:`, err.message);
    errorResponse(res, 500, 'Failed to aggregate streams', err.message);
  }
});

// 404 handler
app.use((req, res) => {
  errorResponse(res, 404, `Not found: ${req.method} ${req.path}`, {
    availableEndpoints: [
      'GET /api/health',
      'GET /api/sources',
      'GET /api/movie/:tmdbId',
      'GET /api/tv/:tmdbId?season=1&episode=1',
    ],
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  errorResponse(res, 500, 'Internal server error');
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`${NAME} v${VERSION} running on http://localhost:${PORT}`);
  console.log(`  Health:  curl http://localhost:${PORT}/api/health`);
  console.log(`  Sources: curl http://localhost:${PORT}/api/sources`);
  console.log(`  Movie:   curl http://localhost:${PORT}/api/movie/24428`);
  console.log(`  TV:      curl "http://localhost:${PORT}/api/tv/1396?season=1&episode=1"`);
});
