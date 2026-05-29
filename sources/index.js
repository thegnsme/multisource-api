/**
 * Source Index — Auto-discovers and aggregates all sources.
 * ========================================================
 *
 * HOW IT WORKS:
 *   1. Reads every .js file in this directory (except index.js and _template.js)
 *   2. Requires each file — if it exports scrapeSource(), it's a source
 *   3. Runs all sources in parallel with a per-source timeout
 *   4. Returns aggregated results sorted by status
 *
 * ADD A SOURCE:
 *   Drop any .js file in this folder that exports { scrapeSource }.
 *   That's it. Nothing else to edit.
 *
 * REMOVE A SOURCE:
 *   Delete the .js file. Done.
 *
 * EDIT A SOURCE:
 *   Edit the .js file. Done.
 *
 * ZERO-DEPENDENCY:
 *   This file uses only Node.js built-in modules.
 *   Sources can use require('axios') etc. when available locally,
 *   or our built-in HTTP client when run serverlessly.
 *
 * @module sources
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const SOURCE_TIMEOUT = 30000; // 30s per source

// ── Auto-discover all source files ──────────────────────────────────────────

/**
 * Load all source modules from the sources directory.
 * Scans for .js files (excluding index and template) and requires them.
 *
 * @returns {Array<{name: string, scrape: Function, file: string}>}
 */
function loadSources() {
	const files = fs
		.readdirSync(DIR)
		.filter(
			(f) => f.endsWith(".js") && f !== "index.js" && f !== "_template.js",
		)
		.sort();

	const sources = [];
	for (const file of files) {
		const name = file.replace(/\.js$/, "").replace(/_/g, ".");
		try {
			const mod = require(path.join(DIR, file));
			if (typeof mod.scrapeSource === "function") {
				sources.push({ name, scrape: mod.scrapeSource, file });
			}
		} catch (err) {
			// Source failed to load — log but don't crash
			console.error(`[sources] Failed to load "${file}": ${err.message}`);
		}
	}

	return sources;
}

const sources = loadSources();

// ── Status sort order ──────────────────────────────────────────────────────

const STATUS_ORDER = {
	working: 0,
	no_streams: 1,
	embed: 2,
	unavailable: 2,
	error: 3,
};

// ── Run all sources in parallel ─────────────────────────────────────────────

/**
 * Run all discovered sources in parallel and aggregate results.
 *
 * @param {number|string} tmdbId - TMDB movie/TV show ID
 * @param {string} [type='movie'] - 'movie' or 'tv'
 * @param {number} [season=1] - Season number (for TV)
 * @param {number} [episode=1] - Episode number (for TV)
 * @returns {Promise<object>} Aggregated results
 */
async function aggregateAll(tmdbId, type = "movie", season = 1, episode = 1) {
	const start = Date.now();
	const params = {
		tmdbId: parseInt(tmdbId, 10),
		type,
		season: parseInt(season, 10) || 1,
		episode: parseInt(episode, 10) || 1,
	};

	const results = await Promise.allSettled(
		sources.map((src) => {
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), SOURCE_TIMEOUT),
			);
			return Promise.race([
				Promise.resolve()
					.then(() => src.scrape(params))
					.catch((err) => ({
						source: src.name,
						status: "error",
						error: err.message,
						streams: [],
						latency_ms: Date.now() - start,
					})),
				timeoutPromise,
			]).catch((err) => ({
				source: src.name,
				status: "error",
				error: err.message || "timeout",
				streams: [],
				latency_ms: Date.now() - start,
			}));
		}),
	);

	const sourcesOut = results.map((r, i) => {
		if (r.status === "fulfilled") {
			const val = r.value;
			if (!val.source) val.source = sources[i].name;
			return val;
		}
		return {
			source: sources[i].name,
			status: "error",
			error: r.reason?.message || "failed",
			streams: [],
			latency_ms: Date.now() - start,
		};
	});

	// Count working sources
	const working = sourcesOut.filter(
		(s) => s.status === "working" && s.streams && s.streams.length > 0,
	);

	// Count unique stream URLs
	const allUrls = sourcesOut.flatMap((s) => s.streams || []).map((s) => s.url);
	const uniqueUrls = new Set(allUrls);

	// Sort: working first, then no_streams, then embed, then error
	sourcesOut.sort(
		(a, b) => (STATUS_ORDER[a.status] || 4) - (STATUS_ORDER[b.status] || 4),
	);

	return {
		success: true,
		tmdbId: parseInt(tmdbId, 10),
		type,
		...(type === "tv"
			? {
					season: parseInt(season, 10),
					episode: parseInt(episode, 10),
				}
			: {}),
		workingSources: working.length,
		totalSources: sources.length,
		totalStreams: uniqueUrls.size,
		elapsed_ms: Date.now() - start,
		sources: sourcesOut,
	};
}

// ── List sources (for /api/sources endpoint) ────────────────────────────────

/**
 * List all loaded source names.
 * @returns {string[]}
 */
function listSources() {
	return sources.map((s) => s.name);
}

/**
 * The total number of loaded sources.
 */
const sourceCount = sources.length;

module.exports = { aggregateAll, listSources, sourceCount };
