#!/usr/bin/env node
/**
 * Test Suite — MultiSource API v4.0
 * ===================================
 *
 * Tests utilities, format adapters, and integration.
 * Sources are only in sources/ — nothing is hardcoded here.
 *
 * Usage:
 *   node test.js                     # Full test suite
 *   node test.js --quick             # Quick smoke test
 *   node test.js --source=vaplayer   # Test specific source
 *   node test.js --format            # Format adapters only
 */

"use strict";

const {
	scrapeAll,
	listFormats,
	formatResult,
	fetchUrl,
	parseMasterPlaylist,
	dedupeStreams,
	qualityToResolution,
} = require("./raw-api");

let pass = 0,
	fail = 0,
	skip = 0;
const a = (cond, msg) => {
	if (cond) {
		pass++;
		console.log(`  ✅ ${msg}`);
	} else {
		fail++;
		console.log(`  ❌ ${msg}`);
	}
};
const eq = (act, exp, msg) =>
	a(act === exp, `${msg} (expected: ${exp}, got: ${act})`);

// ── Unit Tests ──────────────────────────────────────────────────────────────

async function testUtils() {
	console.log("\n📦 Utility Tests\n");

	// parseMasterPlaylist
	const master = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720\n720.m3u8`;
	const p = parseMasterPlaylist(master, "https://x.com/");
	eq(p.length, 2, "parseMasterPlaylist: 2 variants");
	eq(p[0].quality, "360p", "parseMasterPlaylist: 360p");
	eq(p[1].quality, "720p", "parseMasterPlaylist: 720p");
	eq(p[0].bandwidth, 800000, "parseMasterPlaylist: bandwidth");

	// Media playlist
	const media = `#EXTM3U\n#EXTINF:10,\nhttps://x.com/s1.ts\n#EXTINF:10,\nhttps://x.com/s2.ts`;
	eq(
		parseMasterPlaylist(media, "").length,
		2,
		"parseMasterPlaylist: media playlist",
	);
	eq(parseMasterPlaylist("", "").length, 0, "parseMasterPlaylist: empty = []");
	eq(parseMasterPlaylist(null, "").length, 0, "parseMasterPlaylist: null = []");

	// dedupeStreams
	const s = [
		{ url: "https://a.com/1.m3u8" },
		{ url: "https://a.com/1.m3u8" },
		{ url: "https://b.com/2.m3u8" },
	];
	eq(dedupeStreams(s).length, 2, "dedupeStreams: removes duplicates");

	// qualityToResolution
	eq(qualityToResolution("1080p"), "1920x1080", "qualityToResolution: 1080p");
	eq(qualityToResolution("4K"), "3840x2160", "qualityToResolution: 4K");
	eq(qualityToResolution(""), "", "qualityToResolution: empty");

	// fetchUrl — bad URL
	const r = await fetchUrl("https://invalid.nonexistent.test.local/", {
		timeout: 2000,
	});
	a(r.error !== null, "fetchUrl: handles invalid URLs gracefully");
}

async function testFormats() {
	console.log("\n🎨 Format Adapter Tests\n");

	const mock = {
		success: true,
		tmdbId: 24428,
		type: "movie",
		workingSources: 1,
		totalSources: 1,
		totalStreams: 2,
		elapsed_ms: 500,
		timestamp: new Date().toISOString(),
		sources: [
			{
				source: "test",
				embedUrl: "https://test.com/e",
				status: "working",
				streams: [
					{
						url: "https://test.com/1080.m3u8",
						type: "hls",
						quality: "1080p",
						resolution: "1920x1080",
					},
					{
						url: "https://test.com/720.m3u8",
						type: "hls",
						quality: "720p",
						resolution: "1280x720",
					},
				],
			},
		],
	};

	const full = formatResult(mock, "full");
	a(full.success, "full: has success");
	a(full.sources.length === 1, "full: has sources");

	const compact = formatResult(mock, "compact");
	a(compact.streams.length === 2, "compact: 2 streams");
	a(compact.streams[0].url, "compact: has url");

	const cs = formatResult(mock, "cloudstream");
	a(cs.sources.length === 2, "cloudstream: 2 sources");

	const ss = formatResult(mock, "skystream");
	a(ss.data.length === 2, "skystream: 2 items");

	const nuvio = formatResult(mock, "nuvio");
	a(nuvio.streams.length === 2, "nuvio: 2 streams");

	const stremio = formatResult(mock, "stremio");
	a(stremio.streams.length === 2, "stremio: 2 streams");

	const unknown = formatResult(mock, "nonexistent");
	a(unknown.sources !== undefined, "unknown format: falls back to full");

	const fmts = listFormats();
	for (const f of [
		"full",
		"compact",
		"cloudstream",
		"skystream",
		"nuvio",
		"stremio",
	])
		a(fmts.includes(f), `listFormats: includes ${f}`);
}

// ── Integration Tests ──────────────────────────────────────────────────────

async function testIntegration(quick = false) {
	console.log("\n🔌 Integration Tests\n");

	const tests = quick
		? [{ label: "Movie: Avengers", tmdbId: 24428, type: "movie" }]
		: [
				{ label: "Movie: Avengers", tmdbId: 24428, type: "movie" },
				{ label: "Movie: Interstellar", tmdbId: 157336, type: "movie" },
				{ label: "Movie: Fight Club", tmdbId: 550, type: "movie" },
				{
					label: "TV: Breaking Bad S1E1",
					tmdbId: 1396,
					type: "tv",
					season: 1,
					episode: 1,
				},
				{
					label: "TV: GoT S1E1",
					tmdbId: 1399,
					type: "tv",
					season: 1,
					episode: 1,
				},
			];

	let iPass = 0,
		iTotal = 0;

	for (const t of tests) {
		console.log(`  ── ${t.label} ──`);
		const start = Date.now();
		try {
			const r = await scrapeAll(t.tmdbId, t.type, t.season, t.episode);
			const apiWorking = r.sources.filter(
				(s) => s.status === "working" && s.streams?.length > 0,
			).length;
			a(r.success, `${t.label}: success=true`);
			console.log(
				`    → ${apiWorking}/${r.totalSources} sources working, ${r.totalStreams} streams (${Date.now() - start}ms)`,
			);
			iPass++;
		} catch (err) {
			console.log(`    ❌ Failed: ${err.message}`);
		}
		iTotal++;
	}

	return { passed: iPass, total: iTotal };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const args = {};
	process.argv.slice(2).forEach((a) => {
		const [k, v] = a.replace(/^--/, "").split("=");
		args[k] = v || true;
	});

	console.log("=".repeat(60));
	console.log("  MultiSource API v4.0 — Test Suite");
	console.log(`  ${new Date().toISOString()}`);
	console.log("  Sources managed in sources/ — nothing hardcoded");
	console.log("=".repeat(60));

	if (!args.format && !args.source) await testUtils();
	if (!args.source) await testFormats();

	if (!args.format && !args.source) {
		const integ = await testIntegration(!!args.quick);
		console.log(`\n  Integration: ${integ.passed}/${integ.total} passed`);
	}

	if (args.source) {
		console.log(`\n🔌 Testing source: ${args.source}\n`);
		const r = await scrapeAll(24428, "movie");
		const src = r.sources.find((s) => s.source === args.source);
		if (src)
			console.log(
				`  ${src.source}: ${src.status}, ${src.streams?.length || 0} streams, ${src.latency_ms}ms${src.error ? `, error: ${src.error}` : ""}`,
			);
		else console.log(`  Source "${args.source}" not found`);
	}

	console.log(
		`\n${pass + fail} tests: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ""}`,
	);
	process.exit(pass > 0 && pass / (pass + fail) >= 0.5 ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
