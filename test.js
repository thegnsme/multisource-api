/**
 * Test script — verifies the API works with the user's TMDB IDs.
 * Usage: node test.js
 */
const { aggregateAll } = require('./sources');

async function test(tmdbId, type, season, episode) {
  const label = type === 'movie' ? `Movie ${tmdbId}` : `TV ${tmdbId} S${season}E${episode}`;
  process.stdout.write(`Testing ${label}... `);
  
  try {
    const result = await aggregateAll(tmdbId, type, season, episode);
    const hasStreams = result.sources.some(s => s.streams?.length > 0);
    const totalStreams = result.sources.reduce((sum, s) => sum + (s.streams?.length || 0), 0);
    
    if (hasStreams) {
      console.log(`✅ ${result.workingSources}/${result.totalSourcesChecked} sources, ${totalStreams} streams`);
      return true;
    } else {
      console.log(`⚠️  No streams found`);
      return false;
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Video Sources Aggregator — Test Suite ===\n');
  
  // Use faster retries for cloudnestra when in CI/test mode
  if (!process.env.CN_RETRIES) process.env.CN_RETRIES = '2';
  
  const results = [];
  
  // Movies
  results.push(await test(24428, 'movie'));     // The Avengers
  results.push(await test(1226863, 'movie'));   // Super Mario Galaxy Movie
  results.push(await test(1007757, 'movie'));   // Swapped
  results.push(await test(83533, 'movie'));     // Avatar: Fire and Ash
  
  // TV Shows
  results.push(await test(1396, 'tv', 1, 1));   // Breaking Bad S1E1
  results.push(await test(1399, 'tv', 1, 1));   // Game of Thrones S1E1
  results.push(await test(95557, 'tv', 1, 1));  // Invincible S1E1
  results.push(await test(76479, 'tv', 1, 1));  // The Boys S1E1
  
  console.log(`\n${'='.repeat(50)}`);
  const passed = results.filter(Boolean).length;
  console.log(`Results: ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
