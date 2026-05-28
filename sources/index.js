/**
 * Source Aggregator — auto-discovers and runs all sources in parallel.
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
 */

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const SOURCE_TIMEOUT = 30000; // 30s per source

// ── Auto-discover all source files ──────────────────────────────────────────

function loadSources() {
	return fs
		.readdirSync(DIR)
		.filter(
			(f) => f.endsWith(".js") && f !== "index.js" && f !== "_template.js",
		)
		.sort()
		.map((file) => {
			const name = file.replace(/\.js$/, "").replace(/_/g, ".");
			try {
				const mod = require(path.join(DIR, file));
				if (typeof mod.scrapeSource === "function") {
					return { name, scrape: mod.scrapeSource };
				}
				return null;
			} catch (e) {
				return null;
			}
		})
		.filter(Boolean);
}

const sources = loadSources();

// ── Run all sources in parallel ─────────────────────────────────────────────

async function aggregateAll(tmdbId, type = "movie", season = 1, episode = 1) {
	const start = Date.now();
	const params = {
		tmdbId: parseInt(tmdbId),
		type,
		season: parseInt(season),
		episode: parseInt(episode),
	};

	const results = await Promise.allSettled(
		sources.map((src) =>
			Promise.race([
				src.scrape(params).catch((err) => ({
					source: src.name,
					status: "error",
					error: err.message,
					streams: [],
					latency_ms: Date.now() - start,
				})),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("timeout")), SOURCE_TIMEOUT),
				),
			]).catch((err) => ({
				source: src.name,
				status: "error",
				error: err.message || "timeout",
				streams: [],
				latency_ms: Date.now() - start,
			})),
		),
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

	// Count working
	const working = sourcesOut.filter(
		(s) => s.status === "working" && s.streams?.length > 0,
	);

	// Count unique stream URLs
	const allUrls = sourcesOut.flatMap((s) => s.streams || []).map((s) => s.url);
	const uniqueUrls = new Set(allUrls);

	// Sort: working first, then no_streams, then embed, then error
	const order = {
		working: 0,
		no_streams: 1,
		embed: 2,
		unavailable: 2,
		error: 3,
	};
	sourcesOut.sort((a, b) => (order[a.status] || 4) - (order[b.status] || 4));

	return {
		success: true,
		tmdbId: parseInt(tmdbId),
		type,
		...(type === "tv"
			? { season: parseInt(season), episode: parseInt(episode) }
			: {}),
		workingSources: working.length,
		totalSources: sources.length,
		totalStreams: uniqueUrls.size,
		elapsed_ms: Date.now() - start,
		sources: sourcesOut,
	};
}

// ── List sources (for /api/sources endpoint) ────────────────────────────────

function listSources() {
	return sources.map((s) => s.name);
}

module.exports = { aggregateAll, listSources, sourceCount: sources.length };
