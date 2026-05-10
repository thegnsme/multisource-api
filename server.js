#!/usr/bin/env node
const express = require('express');
const { aggregateAll } = require('./sources');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/movie/:tmdbId', async (req, res) => {
  try {
    const result = await aggregateAll(req.params.tmdbId, 'movie');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tv/:tmdbId', async (req, res) => {
  try {
    const { season = 1, episode = 1 } = req.query;
    const result = await aggregateAll(req.params.tmdbId, 'tv', season, episode);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MultiSource API running on http://localhost:${PORT}`);
  console.log(`Movie:  curl http://localhost:${PORT}/api/movie/24428`);
  console.log(`TV:     curl http://localhost:${PORT}/api/tv/1396?season=1&episode=1`);
});
