#!/usr/bin/env node
/**
 * Source Health Check — Tests all sources and generates a health report.
 * =====================================================================
 *
 * This script runs all sources against a set of test TMDB IDs and
 * produces a detailed health report showing which sources are working.
 *
 * Usage:
 *   node scripts/source-health.js                    # Run health check
 *   node scripts/source-health.js --update-readme    # Update SOURCE_HEALTH.md
 *   node scripts/source-health.js --quick            # Quick test (1 movie)
 *   node scripts/source-health.js --output=json      # Output as JSON
 *
 * @module scripts/source-health
 */

"use strict";

const { scrapeAll, getSourceCount, listFormats } = require("../raw-api");

// ── Configuration ────────────────────────────────────────────────────────────

const TEST_CASES = [
	{ label: "Movie: Avengers (2012)", tmdbId: 24428, type: "movie" },
	{ label: "Movie: Interstellar", tmdbId: 157336, type: "movie" },
	{ label: "Movie: Fight Club", tmdbId: 550, type: "movie" },
	{
		label: "TV: Breaking Bad S1E1",
		tmdbId: 1396,
		type: "tv",
		season: 1,
		episode: 1,
	},
	{ label: "TV: GoT S1E1", tmdbId: 1399, type: "tv", season: 1, episode: 1 },
];

// ── Health Check Runner ──────────────────────────────────────────────────────

async function runHealthCheck(quick = false) {
	const testsToRun = quick ? TEST_CASES.slice(0, 1) : TEST_CASES;
	const allSources = new Map(); // name -> { working: number, total: number, streams: number, errors: string[], testResults: object[] }

	for (const test of testsToRun) {
		console.error(`\n[health] Testing: ${test.label}`);
		console.error(`[health] TMDB ${test.tmdbId} (${test.type})`);

		try {
			const result = await scrapeAll(
				test.tmdbId,
				test.type,
				test.season,
				test.episode,
			);

			for (const s of result.sources) {
				if (!allSources.has(s.source)) {
					allSources.set(s.source, {
						source: s.source,
						embedUrl: s.embedUrl || "",
						working: 0,
						total: 0,
						totalStreams: 0,
						errors: [],
						testResults: [],
					});
				}

				const entry = allSources.get(s.source);
				entry.total++;

				if (s.status === "working" && s.streams && s.streams.length > 0) {
					entry.working++;
					entry.totalStreams += s.streams.length;
					entry.testResults.push({
						test: test.label,
						status: "working",
						streams: s.streams.length,
					});
				} else if (s.status === "embed") {
					entry.testResults.push({
						test: test.label,
						status: "embed",
						streams: 0,
					});
				} else if (s.status === "no_streams") {
					entry.testResults.push({
						test: test.label,
						status: "no_streams",
						streams: 0,
					});
				} else {
					const errMsg = s.error || s.status || "unknown";
					entry.errors.push(`[${test.label}] ${errMsg}`);
					entry.testResults.push({
						test: test.label,
						status: "error",
						error: errMsg,
					});
				}
			}

			console.error(
				`[health] Done: ${result.workingSources}/${result.totalSources} working, ${result.totalStreams} streams`,
			);
		} catch (err) {
			console.error(`[health] Failed: ${err.message}`);
		}
	}

	// Compute overall health
	const sourcesArray = Array.from(allSources.values()).map((entry) => {
		const reliability =
			entry.total > 0 ? Math.round((entry.working / entry.total) * 100) : 0;
		const status =
			reliability >= 50
				? "✅ working"
				: reliability >= 20
					? "🟡 partial"
					: entry.totalStreams > 0
						? "🟡 embed"
						: "❌ broken";

		return {
			...entry,
			reliability,
			status,
		};
	});

	// Sort: working first, then by reliability desc
	sourcesArray.sort((a, b) => {
		if (a.reliability !== b.reliability) return b.reliability - a.reliability;
		return a.source.localeCompare(b.source);
	});

	return sourcesArray;
}

// ── Report Generators ────────────────────────────────────────────────────────

function generateMarkdownReport(healthData, elapsed) {
	const total = healthData.length;
	const working = healthData.filter((s) => s.status.startsWith("✅")).length;
	const partial = healthData.filter((s) => s.status.startsWith("🟡")).length;
	const broken = healthData.filter((s) => s.status.startsWith("❌")).length;
	const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

	let md = `# 📊 Source Health Report

> **Last checked:** ${now}
> **Duration:** ${elapsed}ms
> **Sources:** ${total} total | ✅ ${working} working | 🟡 ${partial} partial | ❌ ${broken} broken

## Summary

| Status | Count |
|--------|-------|
| ✅ Working | ${working} |
| 🟡 Partial/Embed | ${partial} |
| ❌ Broken | ${broken} |
| **Total** | **${total}** |

## Per-Source Details

| Source | Status | Reliability | Streams Found | Tests Passed | Errors |
|--------|--------|-------------|---------------|--------------|--------|
`;

	for (const s of healthData) {
		const errors =
			s.errors.length > 0 ? s.errors.slice(0, 2).join("<br>") : "—";
		md += `| ${s.source} | ${s.status} | ${s.reliability}% | ${s.totalStreams} | ${s.working}/${s.total} | ${errors} |\n`;
	}

	md += `\n## Legend\n`;
	md += `- **✅ working**: Source reliably returns streams (≥50% of tests)\n`;
	md += `- **🟡 partial**: Source works sometimes or returns embed URLs only\n`;
	md += `- **❌ broken**: Source fails all tests\n`;
	md += `- **Reliability**: Percentage of tests where the source returned working streams\n\n`;
	md += `_Generated by MultiSource API v4.0.0 Health Check_\n`;

	return md;
}

function generateJSONReport(healthData, elapsed) {
	const total = healthData.length;
	const working = healthData.filter((s) => s.status.startsWith("✅")).length;
	const partial = healthData.filter((s) => s.status.startsWith("🟡")).length;
	const broken = healthData.filter((s) => s.status.startsWith("❌")).length;

	return {
		timestamp: new Date().toISOString(),
		elapsed_ms: elapsed,
		summary: {
			total,
			working,
			partial,
			broken,
			health_percent: total > 0 ? Math.round((working / total) * 100) : 0,
		},
		sources: healthData,
	};
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	const args = {};
	process.argv.slice(2).forEach((a) => {
		const [k, v] = a.replace(/^--/, "").split("=");
		args[k] = v || true;
	});

	const quick = !!args.quick;
	const updateReadme = !!args["update-readme"];
	const outputFormat = args.output || "text";

	console.error("🔍 MultiSource API — Source Health Check\n");

	const start = Date.now();
	const healthData = await runHealthCheck(quick);
	const elapsed = Date.now() - start;

	console.error(`\n✅ Health check complete in ${elapsed}ms`);
	console.error(`   ${healthData.length} sources analyzed\n`);

	if (outputFormat === "json") {
		const jsonReport = generateJSONReport(healthData, elapsed);
		console.log(JSON.stringify(jsonReport, null, 2));
	} else if (updateReadme) {
		const mdReport = generateMarkdownReport(healthData, elapsed);
		const fs = require("fs");
		const reportPath = require("path").join(
			__dirname,
			"..",
			"SOURCE_HEALTH.md",
		);
		fs.writeFileSync(reportPath, mdReport, "utf-8");
		console.error(`📝 Report written to SOURCE_HEALTH.md`);
		console.log(mdReport);
	} else {
		// Text format
		console.log("\n" + "=".repeat(70));
		console.log("  SOURCE HEALTH REPORT");
		console.log("=".repeat(70));

		for (const s of healthData) {
			const icon = s.status.startsWith("✅")
				? "✅"
				: s.status.startsWith("🟡")
					? "🟡"
					: "❌";
			const padName = s.source.padEnd(25);
			console.log(
				`  ${icon} ${padName} ${s.reliability}% (${s.working}/${s.total})`,
			);

			if (s.errors.length > 0) {
				for (const err of s.errors.slice(0, 1)) {
					console.log(`       └─ ${err.slice(0, 120)}`);
				}
			}
		}

		console.log("=".repeat(70));
		const working = healthData.filter((s) => s.status.startsWith("✅")).length;
		const broken = healthData.filter((s) => s.status.startsWith("❌")).length;
		console.log(
			`  ✅ ${working} working  |  ❌ ${broken} broken  |  ${healthData.length} total`,
		);
		console.log("=".repeat(70));
	}
}

main().catch((err) => {
	console.error("Fatal:", err.message);
	process.exit(1);
});
