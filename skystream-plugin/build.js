#!/usr/bin/env node
/**
 * Builds the .sky file (ZIP containing plugin.json + plugin.js).
 * Usage: node skystream-plugin/build.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_DIR = path.join(__dirname);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUT_FILE = path.join(DIST_DIR, 'com.multisource.api.sky');

// Ensure dist dir exists
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// Remove old .sky file if exists
if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

// Create the ZIP using the zip command
try {
  execSync(`cd "${SRC_DIR}" && zip -r "${OUT_FILE}" plugin.json plugin.js`, { stdio: 'pipe' });
  const stat = fs.statSync(OUT_FILE);
  console.log(`✅ Built ${OUT_FILE} (${(stat.size / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error('Error: zip command not found. Run: apt install zip');
  process.exit(1);
}
