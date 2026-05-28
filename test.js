#!/usr/bin/env node
/**
 * Test Suite — auto-discovers and tests all sources.
 *
 * Usage: node test.js
 *
 * Tests each source against a few TMDB IDs, then runs the aggregate.
 * Exits 0 if ≥50% of tests pass.
 */

const { aggregateAll, listSources } = require("./sources");

const TESTS = [
	{ label: "Movie: Interstellar", tmdbId: 157336, type: "movie" },
	{ label: "Movie: Fight Club", tmdbId: 550, type: "movie" },
	{ label: "Movie: Avengers", tmdbId: 299534, type: "movie" },
	{
		label: "TV: Breaking Bad S1E1",
		tmdbId: 1396,
		type: "tv",
		season: 1,
		episode: 1,
	},
	{ label: "TV: GoT S1E1", tmdbId: 1399, type: "tv", season: 1, episode: 1 },
];

async function main() {
	const sources = listSources();
	console.log(
		`\nTesting ${sources.length} sources against ${TESTS.length} TMDB IDs\n`,
	);

	let passed = 0;
	let total = 0;

	for (const test of TESTS) {
		console.log(`── ${test.label} ──`);
		const start = Date.now();

		try {
			const result = await aggregateAll(
				test.tmdbId,
				test.type,
				test.season,
				test.episode,
			);
			const elapsed = Date.now() - start;

			// Show per-source results
			for (const s of result.sources) {
				const icon =
					s.status === "working" ? "✅" : s.status === "embed" ? "🔶" : "❌";
				const detail =
					s.status === "working"
						? `${s.streams.length} streams`
						: s.error || s.status;
				console.log(`  ${icon} ${s.source.padEnd(25)} ${detail}`);
			}

			console.log(
				`  → ${result.workingSources}/${result.totalSources} working, ${result.totalStreams} streams (${elapsed}ms)\n`,
			);
			total++;
			if (result.workingSources > 0) passed++;
		} catch (err) {
			console.log(`  ❌ Failed: ${err.message}\n`);
			total++;
		}
	}

	console.log("═".repeat(50));
	console.log(`Results: ${passed}/${total} passed\n`);

	process.exit(passed >= Math.ceil(total * 0.5) ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal:", err.message);
	process.exit(1);
});
