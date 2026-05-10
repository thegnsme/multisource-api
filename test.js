#!/usr/bin/env node
/**
 * Comprehensive Test Suite — tests ALL sources individually across multiple TMDB IDs.
 *
 * Usage:   node test.js
 * Env:     CN_RETRIES=2  (faster cloudnestra retries in CI)
 *
 * Tests each source file individually, then runs the aggregate.
 * Reports pass/fail per source per TMDB ID.
 */

const fs = require('fs');
const path = require('path');
const { aggregateAll } = require('./sources');

// Test subjects: 4 movies + 4 TV shows
const TEST_CASES = [
  { label: 'Movie 24428',      tmdbId: 24428,   type: 'movie' },
  { label: 'Movie 1226863',    tmdbId: 1226863, type: 'movie' },
  { label: 'Movie 1007757',    tmdbId: 1007757, type: 'movie' },
  { label: 'Movie 83533',      tmdbId: 83533,   type: 'movie' },
  { label: 'TV 1396 S1E1',     tmdbId: 1396,    type: 'tv', season: 1, episode: 1 },
  { label: 'TV 1399 S1E1',     tmdbId: 1399,    type: 'tv', season: 1, episode: 1 },
  { label: 'TV 95557 S1E1',    tmdbId: 95557,   type: 'tv', season: 1, episode: 1 },
  { label: 'TV 76479 S1E1',    tmdbId: 76479,   type: 'tv', season: 1, episode: 1 },
];

// Discover all source modules
function loadSources() {
  const sourceDir = __dirname + '/sources';
  return fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .sort()
    .map(f => {
      const name = f.replace(/\.js$/, '').replace(/_/g, '.');
      try {
        const mod = require(path.join(sourceDir, f));
        return { name, file: f, mod, loaded: true };
      } catch (e) {
        return { name, file: f, mod: null, loaded: false, error: e.message };
      }
    })
    .filter(s => s.loaded && typeof s.mod.scrapeSource === 'function');
}

// ── Individual Source Tests ────────────────────────────────────────────────

async function testSource(source, testCase) {
  const params = {
    tmdbId: testCase.tmdbId,
    type: testCase.type,
    season: testCase.season || 1,
    episode: testCase.episode || 1,
  };

  const start = Date.now();
  try {
    const result = await source.mod.scrapeSource(params);
    const elapsed = Date.now() - start;
    const streamCount = (result.streams || []).length;
    const subCount = (result.subtitles || []).length;

    return {
      source: source.name,
      testCase: testCase.label,
      status: result.status || 'unknown',
      streamCount,
      subCount,
      elapsed,
      error: result.error || null,
    };
  } catch (err) {
    return {
      source: source.name,
      testCase: testCase.label,
      status: 'crash',
      streamCount: 0,
      subCount: 0,
      elapsed: Date.now() - start,
      error: err.message,
    };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     Video Sources Aggregator — Individual Source Test   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Use faster retries for cloudnestra when in CI/test mode
  if (!process.env.CN_RETRIES) process.env.CN_RETRIES = '2';

  const sources = loadSources();
  console.log(`Loaded ${sources.length} source modules\n`);

  let totalTests = 0;
  let totalPassed = 0;

  // ── Test 1: Each source individually ──────────────────────────────────
  console.log('─── Individual Source Tests ───\n');

  for (const testCase of TEST_CASES) {
    console.log(`  📺 ${testCase.label}`);
    
    for (const source of sources) {
      totalTests++;
      const result = await testSource(source, testCase);
      const isWorking = result.status === 'working' && result.streamCount > 0;
      if (isWorking) totalPassed++;

      const icon = isWorking ? '✅' : result.status === 'embed' ? '🔶' : result.status === 'unavailable' ? '⛔' : '❌';
      const details = isWorking
        ? `${result.streamCount} streams, ${result.subCount} subs`
        : result.error
          ? result.error.substring(0, 60)
          : result.status;

      console.log(`    ${icon} ${result.source.padEnd(25)} ${details.padEnd(50)} ${result.elapsed}ms`);
    }
    console.log('');
  }

  // ── Test 2: Aggregate (all sources in parallel) ───────────────────────
  console.log('─── Aggregated Source Tests ───\n');

  for (const testCase of TEST_CASES) {
    const start = Date.now();
    try {
      const result = await aggregateAll(testCase.tmdbId, testCase.type, testCase.season, testCase.episode);
      const elapsed = Date.now() - start;
      const hasWorking = result.workingSources > 0;
      if (hasWorking) totalPassed++;
      totalTests++;

      console.log(`  ${hasWorking ? '✅' : '⚠️'} ${testCase.label.padEnd(25)} ${result.workingSources}/${result.totalSourcesChecked} sources, ${result.totalUniqueStreams} streams, ${elapsed}ms`);
    } catch (err) {
      totalTests++;
      console.log(`  ❌ ${testCase.label.padEnd(25)} Aggregate failed: ${err.message}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  console.log(`Results: ${totalPassed}/${totalTests} passed`);

  // ── Working sources summary ───────────────────────────────────────────
  console.log('\n─── Currently Working Sources ───\n');
  
  // Run one aggregate to get current status
  const status = await aggregateAll(24428, 'movie');
  const working = status.sources.filter(s => s.status === 'working' && s.streams?.length > 0);
  const embed = status.sources.filter(s => s.status === 'embed');
  const unavailable = status.sources.filter(s => s.status === 'unavailable' || s.status === 'error' || s.status === 'no_streams');

  if (working.length > 0) {
    console.log(`  ✅ Working (${working.length}):`);
    working.forEach(s => console.log(`     ${s.source.padEnd(25)} ${s.streams.length} streams`));
  }
  if (embed.length > 0) {
    console.log(`  🔶 Embed/JS-rendered (${embed.length}):`);
    embed.forEach(s => console.log(`     ${s.source.padEnd(25)} (needs browser JS)`));
  }
  if (unavailable.length > 0) {
    console.log(`  ❌ Unavailable (${unavailable.length}):`);
    unavailable.forEach(s => {
      const reason = s.error ? s.error.substring(0, 60) : s.status;
      console.log(`     ${s.source.padEnd(25)} ${reason}`);
    });
  }

  const passed = totalTests > 0 && (totalPassed / totalTests) >= 0.5; // 50% threshold
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
