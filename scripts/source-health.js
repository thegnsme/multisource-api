#!/usr/bin/env node
/**
 * Source Health Check — tests ALL sources against a list of TMDB movie IDs
 * and generates a status report (SOURCE_HEALTH.md).
 *
 * Usage:  node scripts/source-health.js
 *
 * Each source is tested against every TMDB ID.
 * A source is marked 🟢 Working if it returns streams for at least one movie.
 * A source is marked 🔴 Not Working if it fails for all movies.
 *
 * Results are saved to SOURCE_HEALTH.md in the repo root.
 * The GitHub Actions workflow commits and pushes any changes.
 */

const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────

const TMDB_IDS = [
  { id: 157336,  title: 'Interstellar' },
  { id: 299534,  title: 'Avengers: Endgame' },
  { id: 49026,   title: 'The Dark Knight Rises' },
  { id: 687163,  title: 'The Super Mario Bros. Movie' },
  { id: 83533,   title: 'Avatar: Fire and Ash' },
  { id: 550,     title: 'Fight Club' },
  { id: 293660,  title: 'The Nice Guys' },
];

const SOURCE_TIMEOUT = 30000; // 30s max per source per movie
const OUTPUT_FILE = path.join(__dirname, '..', 'SOURCE_HEALTH.md');

// ── Load Sources ───────────────────────────────────────────────────────────

function loadSources() {
  const sourceDir = path.join(__dirname, '..', 'sources');
  const files = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .sort();

  const sources = [];
  for (const file of files) {
    const name = file.replace(/\.js$/, '').replace(/_/g, '.');
    try {
      const mod = require(path.join(sourceDir, file));
      if (typeof mod.scrapeSource === 'function') {
        sources.push({ name, file, scrape: mod.scrapeSource });
      }
    } catch (e) {
      sources.push({ name, file, scrape: null, loadError: e.message });
    }
  }
  return sources;
}

// ── Test a single source against a single movie ────────────────────────────

async function testSourceMovie(source, tmdb) {
  if (!source.scrape) {
    return { movie: tmdb, status: 'load_error', error: source.loadError, streams: 0, elapsed: 0 };
  }

  const start = Date.now();
  try {
    // Race the source against a timeout
    const result = await Promise.race([
      source.scrape({ tmdbId: tmdb.id, type: 'movie' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), SOURCE_TIMEOUT)),
    ]);

    const elapsed = Date.now() - start;
    const streamCount = (result.streams || []).length;

    if (streamCount > 0) {
      return { movie: tmdb, status: 'pass', streams: streamCount, elapsed };
    }

    if (result.status === 'working' && streamCount === 0) {
      return { movie: tmdb, status: 'fail', error: 'status=working but 0 streams', elapsed };
    }

    return { movie: tmdb, status: 'fail', error: result.status || 'no_streams', elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { movie: tmdb, status: 'fail', error: err.message === 'TIMEOUT' ? 'timeout' : err.message.substring(0, 80), elapsed };
  }
}

// ── Generate markdown report ───────────────────────────────────────────────

function generateReport(results, elapsed) {
  const sources = Object.keys(results).sort();
  const totalSources = sources.length;
  const workingSources = sources.filter(s => results[s].overall === 'working').length;
  const failedSources = sources.filter(s => results[s].overall === 'failed').length;
  const erroredSources = sources.filter(s => results[s].overall === 'load_error').length;

    const now = new Date();
    const p = {};
    Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true,
    }).formatToParts(now).forEach(x => p[x.type] = x.value);
    const dateStr = `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second} ${p.dayPeriod.toUpperCase()} IST`;

  let md = '';
  md += `# 📊 Source Health Report\n\n`;
  md += `**Generated:** ${dateStr}  \n`;
  md += `**Total Sources:** ${totalSources}  \n`;
  md += `**🟢 Working:** ${workingSources}  \n`;
  md += `**🔴 Not Working:** ${failedSources}  \n`;
  md += `**⚠️ Load Error:** ${erroredSources}  \n`;
  md += `**Runtime:** ${elapsed}s  \n`;
  md += `**Movies Tested:** ${TMDB_IDS.map(t => `\`${t.title}\``).join(', ')}\n\n`;

  // ── Summary Table ────────────────────────────────────────────────────────
  md += `## Summary\n\n`;
  md += `| Source | Status | Movies Passed | Movies Failed | Total Streams |\n`;
  md += `|--------|--------|--------------|--------------|--------------|\n`;

  for (const name of sources) {
    const r = results[name];
    const icon = r.overall === 'working' ? '🟢' : r.overall === 'failed' ? '🔴' : '⚠️';
    const label = r.overall === 'working' ? 'Working' : r.overall === 'failed' ? 'Not Working' : 'Load Error';
    md += `| ${icon} ${name.padEnd(22)} | ${label.padEnd(12)} | ${r.passed} | ${r.failed} | ${r.totalStreams} |\n`;
  }

  md += `\n`;

  // ── Per-Movie Breakdown ─────────────────────────────────────────────────
  md += `## Per-Source Details\n\n`;

  for (const name of sources) {
    const r = results[name];
    const icon = r.overall === 'working' ? '🟢' : '🔴';
    md += `### ${icon} ${name}\n\n`;
    md += `| Movie | Status | Streams | Time |\n`;
    md += `|-------|--------|---------|------|\n`;

    for (const test of r.tests) {
      const statusIcon = test.status === 'pass' ? '✅' : '❌';
      const reason = test.status === 'pass'
        ? `${test.streams} streams`
        : (test.error || 'no streams');
      md += `| ${test.movie.title.padEnd(35)} | ${statusIcon} | ${reason.padEnd(20)} | ${test.elapsed}ms |\n`;
    }
    md += `\n`;
  }

  // ── Legend ───────────────────────────────────────────────────────────────
  md += `## Legend\n\n`;
  md += `- **🟢 Working** — Source returned streams for at least one movie  \n`;
  md += `- **🔴 Not Working** — Source returned zero streams for ALL movies  \n`;
  md += `- **✅ Pass** — Source returned ≥1 valid HLS stream for this movie  \n`;
  md += `- **❌ Fail** — Source returned no streams or errored for this movie  \n`;
  md += `- **timeout** — Source did not respond within ${SOURCE_TIMEOUT / 1000}s  \n`;
  md += `- **load_error** — Source module could not be loaded (syntax error, missing dependency)  \n\n`;

  md += `---\n`;
  md += `_Auto-generated by \`scripts/source-health.js\` — run every 8 hours via GitHub Actions._\n`;

  return md;
}

// ── Update README.md with live status box ─────────────────────────────────

function updateReadmeStatus(working, failed, total) {
  const readmePath = path.join(__dirname, '..', 'README.md');
  try {
    let readme = fs.readFileSync(readmePath, 'utf-8');

    const now = new Date();
    const p = {};
    Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true,
    }).formatToParts(now).forEach(x => p[x.type] = x.value);
    const dateStr = `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second} ${p.dayPeriod.toUpperCase()} IST`;
    const workingLabel = working > 0 ? `🟢 **${working}** / ${total}` : '🔴 **0**';
    const statusIcon = working > 0 ? '✅' : '❌';

    const statusBlock = [
      `> **📊 Source Health Status**`,
      `>`,
      `> ${statusIcon} ${workingLabel} sources working`,
      `>`,
      `> 🕐 **Last checked:** ${dateStr}`,
      `>`,
      `> [📋 Full Report →](./SOURCE_HEALTH.md)`,
    ].join('\n');

    // Replace content between HEALTH_CHECK_START and HEALTH_CHECK_END markers
    const startMarker = '<!-- HEALTH_CHECK_START -->';
    const endMarker = '<!-- HEALTH_CHECK_END -->';
    const startIdx = readme.indexOf(startMarker);
    const endIdx = readme.indexOf(endMarker);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = readme.substring(0, startIdx + startMarker.length);
      const after = readme.substring(endIdx);
      readme = before + '\n' + statusBlock + '\n' + after;
      fs.writeFileSync(readmePath, readme, 'utf-8');
      console.log(`✅ README.md status box updated: ${working}/${total} working`);
    } else {
      console.log('⚠️  HEALTH_CHECK markers not found in README.md — skipping update');
    }
  } catch (err) {
    console.error('❌ Failed to update README.md:', err.message);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Source Health Check — Testing All Sources            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const startAll = Date.now();
  const sources = loadSources();
  console.log(`Loaded ${sources.length} source modules\n`);
  console.log(`Testing against ${TMDB_IDS.length} movies:\n`);
  for (const t of TMDB_IDS) {
    console.log(`  📺 ${t.title.padEnd(35)} (TMDB: ${t.id})`);
  }
  console.log('');

  // Results accumulator: { sourceName: { overall, passed, failed, totalStreams, tests[] } }
  const results = {};

  // Initialize results for all sources
  for (const source of sources) {
    results[source.name] = {
      overall: source.scrape ? 'pending' : 'load_error',
      passed: 0,
      failed: 0,
      totalStreams: 0,
      tests: [],
      loadError: source.loadError || null,
    };
  }

  // For each movie, test all sources in parallel
  for (const tmdb of TMDB_IDS) {
    console.log(`── Testing ${tmdb.title} ──\n`);

    const activeSources = sources.filter(s => s.scrape);

    // Run all sources for this movie in parallel
    const movieResults = await Promise.allSettled(
      activeSources.map(source => testSourceMovie(source, tmdb))
    );

    for (let i = 0; i < activeSources.length; i++) {
      const source = activeSources[i];
      const r = movieResults[i];
      const testResult = r.status === 'fulfilled' ? r.value : {
        movie: tmdb,
        status: 'fail',
        error: r.reason?.message?.substring(0, 80) || 'unknown error',
        streams: 0,
        elapsed: Date.now() - startAll,
      };

      results[source.name].tests.push(testResult);

      if (testResult.status === 'pass') {
        results[source.name].passed++;
        results[source.name].totalStreams += testResult.streams;
      } else {
        results[source.name].failed++;
      }

      const icon = testResult.status === 'pass' ? '✅' : '❌';
      const detail = testResult.status === 'pass'
        ? `${testResult.streams} streams`
        : (testResult.error || 'no streams');
      console.log(`  ${icon} ${source.name.padEnd(25)} ${detail.padEnd(25)} ${testResult.elapsed}ms`);
    }
    console.log('');
  }

  // Determine overall status per source
  let workingCount = 0;
  let failedCount = 0;

  for (const source of sources) {
    const r = results[source.name];
    if (r.overall === 'load_error') continue;

    // Working = at least one movie passed
    r.overall = r.passed > 0 ? 'working' : 'failed';
    if (r.overall === 'working') workingCount++;
    else failedCount++;
  }

  // Generate report
  const totalElapsed = ((Date.now() - startAll) / 1000).toFixed(1);
  const report = generateReport(results, totalElapsed);

  // Write the full report
  fs.writeFileSync(OUTPUT_FILE, report, 'utf-8');
  console.log(`Report written to ${OUTPUT_FILE}`);

  // ── Update README.md status line ────────────────────────────────────────
  updateReadmeStatus(workingCount, failedCount, sources.length);

  console.log(`\n📊 Summary: ${workingCount} 🟢 working, ${failedCount} 🔴 not working, ${sources.length - workingCount - failedCount} ⚠️ load error`);
  console.log(`⏱  Total runtime: ${totalElapsed}s\n`);

  // Exit with error if no sources are working
  if (workingCount === 0) {
    console.error('❌ FATAL: No sources are working!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
