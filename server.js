#!/usr/bin/env node
/**
 * HTTP API Server — wraps the source aggregator.
 *
 * Endpoints:
 *   GET /api/health          → server health
 *   GET /api/sources         → list all sources
 *   GET /api/movie/:tmdbId   → streams for a movie
 *   GET /api/tv/:tmdbId      → streams for a TV episode (?season=1&episode=1)
 *   GET /api/by-imdb/:id     → auto-detect movie/TV from IMDB ID
 */

const express = require("express");
const { aggregateAll, listSources, sourceCount } = require("./sources");
const { imdbToTmdb } = require("./utils/tmdb-lookup");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use((req, res, next) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	if (req.method === "OPTIONS") return res.sendStatus(204);
	next();
});

// ── Health ──────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
	res.json({
		ok: true,
		sources: sourceCount,
		uptime: Math.floor(process.uptime()),
		memory: Math.floor(process.memoryUsage().rss / 1024 / 1024) + "MB",
	});
});

// ── Sources ─────────────────────────────────────────────────────────────────

app.get("/api/sources", (req, res) => {
	res.json({ sources: listSources() });
});

// ── Movie ───────────────────────────────────────────────────────────────────

app.get("/api/movie/:tmdbId", async (req, res) => {
	const id = parseInt(req.params.tmdbId);
	if (!id || id <= 0) return res.status(400).json({ error: "Invalid TMDB ID" });

	try {
		res.json(await aggregateAll(id, "movie"));
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// ── TV ──────────────────────────────────────────────────────────────────────

app.get("/api/tv/:tmdbId", async (req, res) => {
	const id = parseInt(req.params.tmdbId);
	if (!id || id <= 0) return res.status(400).json({ error: "Invalid TMDB ID" });

	const season = parseInt(req.query.season) || 1;
	const episode = parseInt(req.query.episode) || 1;

	try {
		res.json(await aggregateAll(id, "tv", season, episode));
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// ── IMDB lookup ─────────────────────────────────────────────────────────────

app.get("/api/by-imdb/:imdbId", async (req, res) => {
	const imdbId = req.params.imdbId;
	if (!imdbId || !imdbId.startsWith("tt")) {
		return res
			.status(400)
			.json({ error: "Invalid IMDB ID (must start with tt)" });
	}

	try {
		const lookup = await imdbToTmdb(imdbId);
		const season = parseInt(req.query.season) || 1;
		const episode = parseInt(req.query.episode) || 1;
		const result = await aggregateAll(
			lookup.tmdbId,
			lookup.type,
			season,
			episode,
		);
		result.imdb = {
			id: imdbId,
			tmdbId: lookup.tmdbId,
			type: lookup.type,
			title: lookup.title,
		};
		res.json(result);
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// ── 404 ─────────────────────────────────────────────────────────────────────

app.use((req, res) => {
	res.status(404).json({
		error: "Not found",
		endpoints: [
			"GET /api/health",
			"GET /api/sources",
			"GET /api/movie/:tmdbId",
			"GET /api/tv/:tmdbId?season=1&episode=1",
			"GET /api/by-imdb/:imdbId",
		],
	});
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
	console.log(`MultiSource API on http://localhost:${PORT}`);
	console.log(`  ${sourceCount} sources loaded`);
	console.log(`  curl http://localhost:${PORT}/api/movie/24428`);
});
