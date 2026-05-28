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

// Sources that need browser context (skip in HTTP-only tests)
const BROWSER_SOURCES = [
	"autoembed.co",
	"cinesrc.st",
	"cloudnestra",
	"embed.api.stream",
	"embedmaster.link",
	"godriveplayer.com",
	"megaembed.com",
	"moviesapi.to",
	"multiembed.mov",
	"nontongo.win",
	"primesrc.me",
	"rivestream.app",
	"smashystream.com",
	"streammafia.to",
	"twoembed.cc",
	"twoembed.online",
	"vembed.click",
	"vidapi.xyz",
	"vidbinge.to",
	"vidfast.pro",
	"vidlux.online",
	"vidplus.to",
	"vidrock.net",
	"vidsrc.embed.su",
	"vidsrc.fyi",
	"vidsrc.icu",
	"vidsrc.mov",
	"vidsrc.to",
	"vidsrc.wtf",
	"vidsrcme.su",
	"vidstorm.ru",
	"vidzee.wtf",
	"vsrc.su",
	"vsrc.su.embed",
];

// Sources that need more time
const SLOW_SOURCES = ["vaplayer", "videasy.net", "vidnest.api", "flicky.api"];

async function main() {
	const sources = listSources();
	const httpSources = sources.filter((s) => !BROWSER_SOURCES.includes(s));
	const browserCount = sources.length - httpSources.length;

	console.log(
		`\nTesting ${sources.length} sources (${httpSources.length} HTTP, ${browserCount} browser-required)\n`,
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

			// Show per-source results (only HTTP sources for this test)
			for (const s of result.sources) {
				if (BROWSER_SOURCES.includes(s.source)) continue; // skip browser sources
				const icon =
					s.status === "working" ? "✅" : s.status === "embed" ? "🔶" : "❌";
				const detail =
					s.status === "working"
						? `${s.streams.length} streams`
						: s.error || s.status;
				console.log(`  ${icon} ${s.source.padEnd(25)} ${detail}`);
			}

			const httpWorking = result.sources.filter(
				(s) => !BROWSER_SOURCES.includes(s.source) && s.status === "working",
			).length;

			console.log(
				`  → ${httpWorking}/${httpSources.length} HTTP sources working, ${result.totalStreams} streams (${elapsed}ms)\n`,
			);
			total++;
			if (httpWorking > 0) passed++;
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
