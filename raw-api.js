#!/usr/bin/env node
/**
 * raw-api.js — Serverless Multi-Source Video Stream Aggregator
 * ============================================================
 *
 * A ZERO-dependency serverless API that aggregates HLS video streams
 * from multiple sources. Sources are managed EXCLUSIVELY in the
 * sources/ directory — add, edit, or delete files there, and the
 * API picks them up automatically.
 *
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  NO sources are hardcoded in this file.                      ║
 * ║  Sources are auto-discovered from ./sources/ (local) or      ║
 * ║  dynamically fetched from GitHub (pipe mode).                ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   # Pipe directly (zero install, zero hosting):
 *   curl -sL https://raw.githubusercontent.com/[user]/[repo]/master/raw-api.js \
 *     | node - --tmdb=24428
 *
 *   # Local:
 *   node raw-api.js --tmdb=24428
 *   node raw-api.js --imdb=tt0848228
 *   node raw-api.js --server
 *
 *   # Import as module:
 *   const { scrapeAll } = require('./raw-api');
 *   const result = await scrapeAll(24428, 'movie');
 *
 * OUTPUT FORMATS (via --format= or ?format=):
 *   full        — Standard detailed JSON (default)
 *   compact     — Simplified array of stream objects
 *   cloudstream — CloudStream extension format
 *   skystream   — SkyStream plugin format
 *   nuvio       — Nuvio provider format
 *   stremio     — Stremio add-on format
 *
 * ENVIRONMENT VARIABLES:
 *   GITHUB_USER    — GitHub username for remote source loading (default: none)
 *   GITHUB_REPO    — GitHub repo name for remote source loading (default: none)
 *   GITHUB_BRANCH  — Branch for remote source loading (default: master)
 *   TMDB_API_KEY   — TMDB API key (default: embedded public key)
 *   PORT           — HTTP server port (default: 3000)
 *
 * @module raw-api
 */

"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// Section 0: Configuration (from environment, NO hardcoded sources)
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = Object.freeze({
	/** GitHub repository for remote source loading (set via env or --github-*) */
	GITHUB_USER: process.env.GITHUB_USER || "",
	GITHUB_REPO: process.env.GITHUB_REPO || "",
	GITHUB_BRANCH: process.env.GITHUB_BRANCH || "master",
	GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",

	/** TMDB API — key is a publicly documented demo key */
	TMDB_API_KEY: process.env.TMDB_API_KEY || "1865f43a0549ca50d341dd9ab8b29f49",
	TMDB_BASE: "https://api.themoviedb.org/3",

	/** Per-source timeout in ms */
	SOURCE_TIMEOUT: 30000,

	/** Max redirects for HTTP client */
	MAX_REDIRECTS: 5,

	/** Default HTTP timeout in ms */
	HTTP_TIMEOUT: 15000,

	/** Concurrent source fetches for remote loading */
	REMOTE_FETCH_CONCURRENCY: 5,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: Built-in HTTP Client (zero dependencies)
// ═══════════════════════════════════════════════════════════════════════════════

const https = require("https");
const http = require("http");
const { URL } = require("url");

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.2 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36",
];

let _uaIdx = 0;

/** @returns {string} A random User-Agent string */
function getRandomUA() {
	_uaIdx = (_uaIdx + 1) % USER_AGENTS.length;
	return USER_AGENTS[_uaIdx];
}

/** Simple cookie jar */
class CookieJar {
	constructor() {
		this._map = new Map();
	}
	set(url, headers) {
		if (!headers) return;
		const domain = typeof url === "string" ? new URL(url).hostname : url;
		const arr = Array.isArray(headers) ? headers : [headers];
		this._map.set(domain, arr.map((h) => h.split(";")[0].trim()).join("; "));
	}
	get(url) {
		const domain = typeof url === "string" ? new URL(url).hostname : url;
		return this._map.get(domain) || "";
	}
}
const _jar = new CookieJar();

/**
 * Fetch any URL using only Node.js built-in modules.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string}  [opts.method='GET']
 * @param {object}  [opts.headers={}]
 * @param {*}       [opts.body=null]
 * @param {string}  [opts.referer='']
 * @param {number}  [opts.timeout=15000]
 * @param {number}  [opts.maxRedirects=5]
 * @param {string}  [opts.responseType='text']  'text' | 'json'
 * @returns {Promise<{html: *, status: number, headers: object, error: string|null}>}
 */
function fetchUrl(url, opts = {}) {
	return new Promise((resolve) => {
		const {
			method = "GET",
			headers = {},
			body = null,
			referer = "",
			timeout = CONFIG.HTTP_TIMEOUT,
			maxRedirects = CONFIG.MAX_REDIRECTS,
			responseType = "text",
		} = opts;

		let target = url;
		let redirects = maxRedirects;
		const ua = getRandomUA();

		const doReq = (u) => {
			let parsed;
			try {
				parsed = new URL(u);
			} catch (e) {
				return resolve({
					html: null,
					status: 0,
					error: `Bad URL: ${e.message}`,
					headers: {},
				});
			}

			const mod = parsed.protocol === "https:" ? https : http;
			const reqHeaders = {
				"User-Agent": ua,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
				...headers,
			};
			if (referer) reqHeaders["Referer"] = referer;
			if (body) {
				reqHeaders["Content-Type"] =
					reqHeaders["Content-Type"] || "application/json";
				reqHeaders["Content-Length"] = Buffer.byteLength(
					typeof body === "string" ? body : JSON.stringify(body),
				);
			}
			const c = _jar.get(u);
			if (c) reqHeaders["Cookie"] = c;

			const timer = setTimeout(() => {
				aborted = true;
				req.destroy(new Error("timeout"));
			}, timeout);
			let aborted = false;

			const req = mod.request(
				{
					hostname: parsed.hostname,
					port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
					path: parsed.pathname + parsed.search,
					method,
					headers: reqHeaders,
					rejectUnauthorized: false,
				},
				(res) => {
					if (aborted) return;
					const status = res.statusCode || 0;

					if ([301, 302, 303, 307, 308].includes(status) && redirects > 0) {
						redirects--;
						const loc = res.headers.location;
						if (loc) {
							clearTimeout(timer);
							res.resume();
							try {
								return doReq(
									loc.startsWith("http") ? loc : new URL(loc, u).href,
								);
							} catch {
								clearTimeout(timer);
								return resolve({
									html: null,
									status: 0,
									error: `Bad redirect: ${loc}`,
									headers: {},
								});
							}
						}
					}

					if (res.headers["set-cookie"]) _jar.set(u, res.headers["set-cookie"]);

					const chunks = [];
					res.on("data", (c) => chunks.push(c));
					res.on("end", () => {
						clearTimeout(timer);
						const raw = Buffer.concat(chunks);
						const ct = (res.headers["content-type"] || "").toLowerCase();
						let html = raw.toString("utf-8");
						if (responseType === "json" || ct.includes("json")) {
							try {
								html = JSON.parse(html);
							} catch {}
						}
						resolve({ html, status, headers: res.headers, error: null });
					});
				},
			);

			req.on("error", (err) => {
				clearTimeout(timer);
				resolve({
					html: null,
					status: 0,
					error: err.message === "timeout" ? "Request timed out" : err.message,
					headers: {},
				});
			});
			req.on("timeout", () => {
				clearTimeout(timer);
				req.destroy();
				resolve({
					html: null,
					status: 0,
					error: "Request timed out",
					headers: {},
				});
			});

			if (body)
				req.write(typeof body === "string" ? body : JSON.stringify(body));
			req.end();
		};
		doReq(target);
	});
}

/** Fetch JSON helper */
async function fetchJson(url, opts = {}) {
	const r = await fetchUrl(url, {
		...opts,
		responseType: "json",
		headers: { Accept: "application/json", ...(opts.headers || {}) },
	});
	return r.error ? null : r.html;
}

/** POST JSON helper */
async function postJson(url, data, opts = {}) {
	return fetchUrl(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
		body: JSON.stringify(data),
		referer: opts.referer || "",
		timeout: opts.timeout || CONFIG.HTTP_TIMEOUT,
		responseType: "json",
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Generic m3u8 Parser & Stream Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const QMAP = {
	360: "360p",
	480: "480p",
	720: "720p",
	1080: "1080p",
	2160: "4K",
};
const RMAP = {
	"4K": "3840x2160",
	"2160p": "3840x2160",
	"1080p": "1920x1080",
	"720p": "1280x720",
	"480p": "854x480",
	"360p": "640x360",
};

function qualityToResolution(q) {
	return RMAP[q] || "";
}

/**
 * Parse an m3u8 playlist (master or media) into stream entries.
 * @param {string} m3u8
 * @param {string} baseUrl
 * @returns {Array<{url:string,type:string,quality:string,resolution:string,bandwidth?:number}>}
 */
function parseMasterPlaylist(m3u8, baseUrl) {
	const out = [];
	if (!m3u8 || typeof m3u8 !== "string" || !m3u8.startsWith("#EXTM3U"))
		return out;

	if (!m3u8.includes("#EXT-X-STREAM-INF:")) {
		for (const l of m3u8
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"))) {
			out.push({
				url: l.startsWith("http") ? l : new URL(l, baseUrl).href,
				type: "hls",
				quality: "",
				resolution: "",
			});
		}
		return out;
	}

	const lines = m3u8.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
		const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
		const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
		const nl = lines[i + 1]?.trim();
		if (nl && !nl.startsWith("#")) {
			const vu = nl.startsWith("http") ? nl : new URL(nl, baseUrl).href;
			const h = res ? res.split("x")[1] : "";
			out.push({
				url: vu,
				type: "hls",
				quality: QMAP[h] || (h ? h + "p" : ""),
				resolution: res || "",
				bandwidth: bw ? parseInt(bw, 10) : undefined,
			});
			i++;
		}
	}
	return out;
}

/** Deduplicate streams by URL */
function dedupeStreams(streams) {
	const seen = new Set();
	return streams.filter((s) => {
		if (seen.has(s.url)) return false;
		seen.add(s.url);
		return true;
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: IMDB → TMDB Lookup
// ═══════════════════════════════════════════════════════════════════════════════

async function imdbToTmdb(imdbId) {
	const id = imdbId
		.replace(/^https?:\/\/[^/]+\/(title\/)?/i, "")
		.replace(/\/.*$/, "")
		.trim();
	if (!id.startsWith("tt")) throw new Error('IMDB ID must start with "tt"');
	const data = await fetchJson(
		`${CONFIG.TMDB_BASE}/find/${id}?api_key=${CONFIG.TMDB_API_KEY}&external_source=imdb_id`,
	);
	if (!data) throw new Error("TMDB API request failed");
	if (data.movie_results?.length) {
		const m = data.movie_results[0];
		return { tmdbId: m.id, type: "movie", title: m.title || m.original_title };
	}
	if (data.tv_results?.length) {
		const t = data.tv_results[0];
		return { tmdbId: t.id, type: "tv", title: t.name || t.original_name };
	}
	throw new Error(`No TMDB ID found for: ${id}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Generic Embed Page Scraper (utility for any source to use)
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeEmbedSource({
	name,
	embedUrl,
	referer = "",
	apiUrl = "",
	timeout = 15000,
	maxDepth = 3,
}) {
	const start = Date.now();
	try {
		if (apiUrl) {
			const r = await fetchUrl(apiUrl, {
				referer: referer || embedUrl,
				timeout,
				responseType: "json",
			});
			if (!r.error && r.html) {
				const streams = extractStreamsFromApiResponse(r.html);
				if (streams.length > 0)
					return {
						source: name,
						embedUrl,
						status: "working",
						streams: dedupeStreams(streams),
						latency_ms: Date.now() - start,
					};
			}
		}
		if (!embedUrl)
			return {
				source: name,
				embedUrl,
				status: "no_streams",
				streams: [],
				latency_ms: Date.now() - start,
			};

		const extracted = await scrapeEmbedPageRecursive(
			embedUrl,
			referer || embedUrl,
			timeout,
			maxDepth,
			new Set(),
		);
		const hasM3u8 = extracted.some((s) => s.url.includes(".m3u8"));
		return {
			source: name,
			embedUrl,
			status: extracted.length > 0 ? (hasM3u8 ? "working" : "embed") : "embed",
			streams: dedupeStreams(extracted),
			latency_ms: Date.now() - start,
		};
	} catch (err) {
		return {
			source: name,
			embedUrl,
			status: "error",
			error: err.message,
			streams: [],
			latency_ms: Date.now() - start,
		};
	}
}

function extractStreamsFromApiResponse(data) {
	const out = [];
	const add = (url, qual) => {
		if (url && typeof url === "string" && url.startsWith("http"))
			out.push({
				url,
				type: url.includes(".m3u8") ? "hls" : "mp4",
				quality: qual || "",
				resolution: "",
			});
	};
	if (data.stream_url) add(data.stream_url, data.quality || data.label);
	if (Array.isArray(data.streams))
		for (const s of data.streams)
			add(s.url || s.file || s.src, s.quality || s.label || s.name);
	if (Array.isArray(data.url))
		for (const s of data.url)
			add(s.link || s.url, s.quality || s.label || s.resolution);
	if (Array.isArray(data.sources))
		for (const s of data.sources)
			add(s.url || s.file || s.src, s.quality || s.label || s.name);
	return out;
}

async function scrapeEmbedPageRecursive(url, referer, timeout, depth, visited) {
	if (depth <= 0 || visited.has(url)) return [];
	visited.add(url);
	const streams = [];
	const r = await fetchUrl(url, { referer, timeout });
	if (r.error || !r.html) return streams;
	const html = typeof r.html === "string" ? r.html : String(r.html);

	// Strategy 1: Direct media URLs in HTML
	for (const pat of [
		/https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi,
		/https?:\/\/[^"'\s<>]+\/(?:playlist|master|index)[^"'\s<>]*\.m3u8[^"'\s<>]*/gi,
	]) {
		const m = html.match(pat);
		if (m)
			for (const u of m)
				streams.push({
					url: u.startsWith("http") ? u : new URL(u, url).href,
					type: u.includes(".m3u8") ? "hls" : "mp4",
					quality: "",
					resolution: "",
				});
	}

	// Strategy 2: JS config values (file:/src:/url:)
	for (const pat of [
		/file["']?\s*[:=]\s*["']([^"']+)["']/gi,
		/src["']?\s*[:=]\s*["']([^"']+)["']/gi,
		/url["']?\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
	]) {
		let m;
		while ((m = pat.exec(html)) !== null) {
			const u = m[1].replace(/\\\//g, "/");
			if (u.startsWith("http") && (u.includes(".m3u8") || u.includes(".mp4")))
				streams.push({
					url: u,
					type: u.includes(".m3u8") ? "hls" : "mp4",
					quality: "",
					resolution: "",
				});
		}
	}

	// Strategy 3: data-* attributes
	let m;
	while (
		(m = /data-(?:src|url|file)["']?\s*[:=]\s*["']([^"']+)["']/gi.exec(
			html,
		)) !== null
	) {
		const u = m[1];
		if (u.startsWith("http") && (u.includes(".m3u8") || u.includes(".mp4")))
			streams.push({
				url: u,
				type: u.includes(".m3u8") ? "hls" : "mp4",
				quality: "",
				resolution: "",
			});
	}

	// Strategy 4: Follow iframes recursively
	if (depth > 1) {
		let ifm;
		while ((ifm = /<iframe[^>]+src=["']([^"']+)["']/gi.exec(html)) !== null) {
			let iu = ifm[1];
			if (!iu.startsWith("http")) {
				try {
					iu = new URL(iu, url).href;
				} catch {
					continue;
				}
			}
			streams.push(
				...(await scrapeEmbedPageRecursive(
					iu,
					url,
					timeout,
					depth - 1,
					visited,
				)),
			);
		}
	}

	// Strategy 5: Base64-encoded URLs in scripts
	let bm;
	while (
		(bm =
			/(?:atob|base64decode|Base64\.decode)\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/gi.exec(
				html,
			)) !== null
	) {
		try {
			const dec = Buffer.from(bm[1], "base64").toString("utf-8");
			const um = dec.match(/https?:\/\/[^"'\s<>]+\.[^"'\s<>]+/);
			if (um)
				streams.push({
					url: um[0],
					type: um[0].includes(".m3u8") ? "hls" : "mp4",
					quality: "",
					resolution: "",
				});
		} catch {}
	}

	// Strategy 6: JSON player configs in script tags
	let sm;
	while ((sm = /<script[^>]*>([\s\S]*?)<\/script>/gi.exec(html)) !== null) {
		for (const pp of [
			/playerConfig\s*=\s*({[\s\S]+?});/,
			/jwplayer\([^)]+\)\.setup\s*\(\s*({[\s\S]+?})\s*\)\s*;/,
		]) {
			const cm = sm[1].match(pp);
			if (cm)
				try {
					const cfg = JSON.parse(
						cm[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'),
					);
					const src =
						cfg.file ||
						cfg.src ||
						cfg.source ||
						cfg.url ||
						cfg.sources?.[0]?.file ||
						cfg.sources?.[0]?.src ||
						cfg.playlist?.[0]?.file;
					if (src && typeof src === "string" && src.startsWith("http"))
						streams.push({
							url: src,
							type: src.includes(".m3u8") ? "hls" : "mp4",
							quality: "",
							resolution: "",
						});
				} catch {}
		}
	}

	return dedupeStreams(streams);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Generic Crypto Helpers (for sources that need them)
// ═══════════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

/** AES-256-CBC encrypt → URL-safe base64 */
function aes256CbcEncrypt(plaintext, passphrase) {
	const key = Buffer.from(passphrase.padEnd(32, "\0").slice(0, 32));
	const iv = Buffer.from(passphrase.padEnd(16, "\0").slice(0, 16));
	const ciph = crypto.createCipheriv("aes-256-cbc", key, iv);
	return Buffer.concat([ciph.update(plaintext, "utf-8"), ciph.final()])
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
}

/** AES-256-CBC decrypt (supports iv:ciphertext base64 format) */
function aes256CbcDecrypt(encryptedBase64, key) {
	try {
		const dec = Buffer.from(encryptedBase64, "base64").toString("utf-8");
		const parts = dec.split(":");
		if (parts.length === 2) {
			const iv = Buffer.from(parts[0], "base64");
			const ct = Buffer.from(parts[1], "base64");
			const d = crypto.createDecipheriv(
				"aes-256-cbc",
				typeof key === "string"
					? Buffer.from(key).slice(0, 32)
					: key.slice(0, 32),
				iv,
			);
			return Buffer.concat([d.update(ct), d.final()]).toString("utf-8");
		}
	} catch {}
	try {
		const buf = Buffer.from(encryptedBase64, "base64");
		const d = crypto.createDecipheriv(
			"aes-256-cbc",
			typeof key === "string"
				? Buffer.from(key).slice(0, 32)
				: key.slice(0, 32),
			buf.slice(0, 16),
		);
		return Buffer.concat([d.update(buf.slice(16)), d.final()]).toString(
			"utf-8",
		);
	} catch {
		throw new Error("AES-256-CBC decryption failed");
	}
}

/** AES-256-GCM decrypt (base64url.iv.ct.tag) */
function aes256GcmDecrypt(encryptedData, keyHex) {
	const parts = encryptedData.split(".");
	if (parts.length < 3) throw new Error("Invalid GCM payload");
	const d = crypto.createDecipheriv(
		"aes-256-gcm",
		Buffer.from(keyHex, "hex"),
		Buffer.from(parts[0], "base64url"),
	);
	d.setAuthTag(Buffer.from(parts[2], "base64url"));
	return Buffer.concat([
		d.update(Buffer.from(parts[1], "base64url")),
		d.final(),
	]).toString("utf-8");
}

/** Custom base64 decode with any alphabet */
function customBase64Decode(input, alphabet) {
	if (!input) throw new Error("Invalid input");
	const rev = {};
	for (let i = 0; i < alphabet.length; i++) rev[alphabet[i]] = i;
	let p = input;
	const m = p.length % 4;
	if (m) p += "=".repeat(4 - m);
	const bytes = [];
	for (let i = 0; i < p.length; i += 4) {
		const c0 = rev[p[i]] ?? 64,
			c1 = rev[p[i + 1]] ?? 64;
		const c2 = p[i + 2] === "=" ? 64 : (rev[p[i + 2]] ?? 64);
		const c3 = p[i + 3] === "=" ? 64 : (rev[p[i + 3]] ?? 64);
		bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff);
		if (c2 !== 64) bytes.push((((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff);
		if (c3 !== 64) bytes.push((((c2 & 0x03) << 6) | c3) & 0xff);
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

function sha256(data) {
	return crypto.createHash("sha256").update(data).digest();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: Sandbox Require for Dynamic Source Loading (pipe mode)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a sandboxed require() for evaluating source files fetched from GitHub.
 *
 * Provides:
 *   - All Node.js built-in modules
 *   - A generic axios shim (so sources using require('axios') work)
 *   - Utility shims for ../utils/* paths (backward compat with existing sources)
 *
 * ⚠️  These are GENERIC utilities, NOT hardcoded sources.
 *     No source names, URLs, or scraping logic is included.
 */
function createSandboxRequire() {
	const builtins = {
		crypto: require("crypto"),
		https: require("https"),
		http: require("http"),
		url: require("url"),
		path: require("path"),
		fs: require("fs"),
		stream: require("stream"),
		buffer: require("buffer"),
		util: require("util"),
	};

	let _axios = null;
	let _embedScraper = null;
	let _antidetect = null;

	const axiosShim = () => {
		if (!_axios) {
			_axios = {
				get: async (u, cfg = {}) => {
					const r = await fetchUrl(u, {
						method: "GET",
						headers: cfg.headers || {},
						referer: cfg.headers?.Referer || "",
						timeout: cfg.timeout || CONFIG.HTTP_TIMEOUT,
						responseType: "json",
					});
					return {
						data: r.html,
						status: r.status,
						statusText: r.status === 200 ? "OK" : "Error",
						headers: r.headers,
						config: cfg,
					};
				},
				post: async (u, d, cfg = {}) => {
					const r = await fetchUrl(u, {
						method: "POST",
						headers: cfg.headers || {},
						body: d,
						referer: cfg.headers?.Referer || "",
						timeout: cfg.timeout || CONFIG.HTTP_TIMEOUT,
						responseType: "json",
					});
					return {
						data: r.html,
						status: r.status,
						statusText: r.status === 200 ? "OK" : "Error",
						headers: r.headers,
						config: cfg,
					};
				},
			};
		}
		return _axios;
	};

	return function sbRequire(name) {
		if (builtins[name]) return builtins[name];
		if (name === "axios") return axiosShim();

		// Generic utility shims (NOT sources — they don't contain source names/URLs)
		if (name.endsWith("embedScraper")) {
			if (!_embedScraper) _embedScraper = { scrapeEmbedSource };
			return _embedScraper;
		}
		if (name.endsWith("antidetect")) {
			if (!_antidetect)
				_antidetect = {
					fetchUrl,
					fetchJson,
					getRandomUA,
					parseMasterPlaylist,
					QMAP,
					RMAP,
					qualityToResolution,
					_jar,
				};
			return _antidetect;
		}
		if (name.endsWith("fetcher")) return { fetchUrl, fetchJson, getRandomUA };
		if (name.endsWith("tmdb-lookup")) return { imdbToTmdb };

		console.error(
			`[raw-api] Warning: Module "${name}" unavailable in serverless mode`,
		);
		return {};
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Source Loader — Local Filesystem or Remote (GitHub)
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

function hasLocalSources() {
	try {
		return (
			fs.existsSync(path.join(__dirname, "sources")) &&
			fs.statSync(path.join(__dirname, "sources")).isDirectory()
		);
	} catch {
		return false;
	}
}

function loadSourcesLocal() {
	const dir = path.join(__dirname, "sources");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter(
			(f) => f.endsWith(".js") && f !== "index.js" && f !== "_template.js",
		)
		.sort()
		.map((file) => {
			try {
				const mod = require(path.join(dir, file));
				if (typeof mod.scrapeSource === "function")
					return {
						name: file.replace(/\.js$/, "").replace(/_/g, "."),
						scrape: mod.scrapeSource,
						file,
					};
			} catch (err) {
				console.error(`[raw-api] Failed to load ${file}: ${err.message}`);
			}
			return null;
		})
		.filter(Boolean);
}

async function loadSourcesRemote() {
	const user = CONFIG.GITHUB_USER;
	const repo = CONFIG.GITHUB_REPO;
	const branch = CONFIG.GITHUB_BRANCH;

	if (!user || !repo) {
		throw new Error(
			"Cannot load sources remotely. Set GITHUB_USER and GITHUB_REPO environment variables,\n" +
				"or use --github-user=USER --github-repo=REPO flags, or run locally from the cloned repo.",
		);
	}

	const ghHeaders = CONFIG.GITHUB_TOKEN
		? { Authorization: `Bearer ${CONFIG.GITHUB_TOKEN}` }
		: {};

	const listing = await fetchJson(
		`https://api.github.com/repos/${user}/${repo}/contents/sources?ref=${branch}`,
		{ headers: ghHeaders },
	);
	if (!listing || !Array.isArray(listing))
		throw new Error(`Failed to list sources from ${user}/${repo}`);

	const jFiles = listing.filter(
		(f) =>
			f.name.endsWith(".js") &&
			f.name !== "index.js" &&
			f.name !== "_template.js" &&
			f.download_url,
	);
	const sources = [];
	const sbRequire = createSandboxRequire();

	for (let i = 0; i < jFiles.length; i += CONFIG.REMOTE_FETCH_CONCURRENCY) {
		const chunk = jFiles.slice(i, i + CONFIG.REMOTE_FETCH_CONCURRENCY);
		const results = await Promise.allSettled(
			chunk.map(async (file) => {
				try {
					const r = await fetchUrl(
						`https://raw.githubusercontent.com/${user}/${repo}/${branch}/sources/${file.name}`,
						{ timeout: 10000 },
					);
					if (r.error || !r.html) return null;
					const code = typeof r.html === "string" ? r.html : String(r.html);
					const mod = { exports: {} };
					new Function("module", "exports", "require", code)(
						mod,
						mod.exports,
						sbRequire,
					);
					if (typeof mod.exports.scrapeSource === "function")
						return {
							name: file.name.replace(/\.js$/, "").replace(/_/g, "."),
							scrape: mod.exports.scrapeSource,
							file: file.name,
						};
				} catch (err) {
					console.error(`[raw-api] Error loading ${file.name}: ${err.message}`);
				}
				return null;
			}),
		);
		for (const r of results) {
			if (r.status === "fulfilled" && r.value) sources.push(r.value);
		}
	}
	return sources.sort((a, b) => a.name.localeCompare(b.name));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: Output Format Adapters (for different platforms)
// ═══════════════════════════════════════════════════════════════════════════════

const FORMATTERS = {
	full(r) {
		return r;
	},

	compact(r) {
		const streams = [];
		for (const src of r.sources) {
			if (src.status === "working" && src.streams) {
				for (const s of src.streams)
					streams.push({
						url: s.url,
						quality: s.quality || "",
						type: s.type || "hls",
						source: src.source,
					});
			}
		}
		return {
			success: true,
			tmdbId: r.tmdbId,
			type: r.type,
			totalStreams: r.totalStreams,
			elapsed_ms: r.elapsed_ms,
			streams,
		};
	},

	cloudstream(r) {
		const sources = [];
		for (const src of r.sources) {
			if (src.status === "working" && src.streams) {
				for (const s of src.streams)
					sources.push({
						name: src.source,
						url: s.url,
						type: s.type === "mp4" ? "MP4" : "M3U8",
						quality: s.quality || "Unknown",
					});
			}
		}
		return { success: true, sources };
	},

	skystream(r) {
		const data = [];
		for (const src of r.sources) {
			if (src.status === "working" && src.streams) {
				for (const s of src.streams)
					data.push({ url: s.url, quality: s.quality || "Unknown" });
			}
		}
		return { success: true, data };
	},

	nuvio(r) {
		const streams = [];
		for (const src of r.sources) {
			if (src.status === "working" && src.streams) {
				for (const s of src.streams)
					streams.push({
						name: src.source,
						title: `${src.source} - ${s.quality || "Stream"}`,
						url: s.url,
						quality: s.quality || "Unknown",
					});
			}
		}
		return { success: true, streams, provider: "multisource-api" };
	},

	stremio(r) {
		const streams = [];
		for (const src of r.sources) {
			if (src.status === "working" && src.streams) {
				for (const s of src.streams)
					streams.push({
						url: s.url,
						title: `${src.source} - ${s.quality || "Stream"}`,
					});
			}
		}
		return { streams };
	},
};

function formatResult(result, format = "full") {
	return (FORMATTERS[format] || FORMATTERS.full)(result);
}

function listFormats() {
	return Object.keys(FORMATTERS);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: Aggregator — Run All Sources in Parallel
// ═══════════════════════════════════════════════════════════════════════════════

let _sources = [];
let _sourcesLoaded = false;

async function initSources() {
	if (_sourcesLoaded) return;
	_sources = hasLocalSources() ? loadSourcesLocal() : await loadSourcesRemote();
	_sourcesLoaded = true;
}

/**
 * Run all discovered sources in parallel and return aggregated results.
 *
 * @param {number|string} tmdbId
 * @param {string}  [type='movie']     'movie' or 'tv'
 * @param {number}  [season=1]
 * @param {number}  [episode=1]
 * @param {object}  [opts]
 * @param {string}  [opts.format='full']
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<object>}
 */
async function scrapeAll(
	tmdbId,
	type = "movie",
	season = 1,
	episode = 1,
	opts = {},
) {
	const gStart = Date.now();
	const fmt = opts.format || "full";
	const to = opts.timeout || CONFIG.SOURCE_TIMEOUT;
	await initSources();

	const params = {
		tmdbId: parseInt(tmdbId, 10),
		type,
		season: parseInt(season, 10) || 1,
		episode: parseInt(episode, 10) || 1,
	};

	const results = await Promise.allSettled(
		_sources.map((src) => {
			const tout = new Promise((_, rej) =>
				setTimeout(() => rej(new Error("timeout")), to),
			);
			return Promise.race([
				Promise.resolve()
					.then(() => src.scrape(params))
					.catch((err) => ({
						source: src.name,
						status: "error",
						error: err.message,
						streams: [],
						latency_ms: Date.now() - gStart,
					})),
				tout,
			]).catch((err) => ({
				source: src.name,
				status: "error",
				error: err.message || "timeout",
				streams: [],
				latency_ms: Date.now() - gStart,
			}));
		}),
	);

	const out = [];
	let working = 0;
	const allStreams = [];
	const order = {
		working: 0,
		no_streams: 1,
		embed: 2,
		unavailable: 2,
		error: 3,
	};

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const n = _sources[i].name;
		if (r.status === "fulfilled") {
			const v = r.value;
			if (!v.source) v.source = n;
			out.push(v);
			if (v.status === "working" && v.streams?.length) {
				working++;
				allStreams.push(...v.streams);
			}
		} else {
			out.push({
				source: n,
				status: "error",
				error: r.reason?.message || "failed",
				streams: [],
				latency_ms: Date.now() - gStart,
			});
		}
	}
	out.sort((a, b) => (order[a.status] || 4) - (order[b.status] || 4));

	const raw = {
		success: true,
		tmdbId: parseInt(tmdbId, 10),
		type,
		...(type === "tv"
			? { season: parseInt(season, 10), episode: parseInt(episode, 10) }
			: {}),
		sources: out,
		workingSources: working,
		totalSources: _sources.length,
		totalStreams: new Set(allStreams.map((s) => s.url)).size,
		elapsed_ms: Date.now() - gStart,
		timestamp: new Date().toISOString(),
	};
	return formatResult(raw, fmt);
}

function getSources() {
	return _sources;
}
function getSourceCount() {
	return _sources.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 10: Built-in HTTP Server (zero-dependency)
// ═══════════════════════════════════════════════════════════════════════════════

async function startServer(port = parseInt(process.env.PORT, 10) || 3000) {
	await initSources();
	const httpServer = require("http");
	const server = httpServer.createServer(async (req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			return res.end();
		}

		const pUrl = new URL(req.url, `http://${req.headers.host}`);
		const pn = pUrl.pathname.replace(/\/+$/, "") || "/";
		const q = Object.fromEntries(pUrl.searchParams);
		const fmt = q.format || "full";

		const json = (data, code = 200) => {
			res.writeHead(code, { "Content-Type": "application/json" });
			res.end(JSON.stringify(data));
		};
		const err = (msg, code = 500) => json({ success: false, error: msg }, code);

		try {
			if (pn === "/api/health" || pn === "/health")
				return json({
					ok: true,
					version: "4.0.0",
					sources: _sources.length,
					formats: listFormats(),
					uptime: Math.floor(process.uptime()),
				});
			if (pn === "/api/sources" || pn === "/sources")
				return json({
					success: true,
					total: _sources.length,
					sources: _sources.map((s) => s.name),
				});
			if (pn === "/api/formats" || pn === "/formats")
				return json({ success: true, formats: listFormats() });

			const mM = pn.match(/^\/api\/movie\/(\d+)$/);
			if (mM) {
				const id = parseInt(mM[1], 10);
				if (id <= 0) return err("Invalid TMDB ID", 400);
				return json(await scrapeAll(id, "movie", 1, 1, { format: fmt }));
			}

			const tM = pn.match(/^\/api\/tv\/(\d+)$/);
			if (tM) {
				const id = parseInt(tM[1], 10);
				if (id <= 0) return err("Invalid TMDB ID", 400);
				return json(
					await scrapeAll(
						id,
						"tv",
						parseInt(q.season, 10) || 1,
						parseInt(q.episode, 10) || 1,
						{ format: fmt },
					),
				);
			}

			const iM = pn.match(/^\/api\/by-imdb\/(tt\d+)$/i);
			if (iM) {
				const lu = await imdbToTmdb(iM[1]);
				const r = await scrapeAll(
					lu.tmdbId,
					lu.type,
					parseInt(q.season, 10) || 1,
					parseInt(q.episode, 10) || 1,
					{ format: fmt },
				);
				r.imdb = {
					id: iM[1],
					tmdbId: lu.tmdbId,
					type: lu.type,
					title: lu.title,
				};
				return json(r);
			}

			if (pn === "/" || pn === "/api")
				return json({
					name: "MultiSource API",
					version: "4.0.0",
					description: "Aggregate HLS video streams from multiple sources",
					endpoints: {
						"/api/health": "Server health",
						"/api/sources": "List sources",
						"/api/formats": "List output formats",
						"/api/movie/:id": "Movie streams (?format=)",
						"/api/tv/:id": "TV streams (?season=&episode=&format=)",
						"/api/by-imdb/:id": "IMDB lookup (?format=)",
					},
					formats: listFormats(),
				});

			err("Not found", 404);
		} catch (e) {
			err(e.message, 500);
		}
	});

	server.listen(port, () => {
		console.log(`\n  🎬 MultiSource API v4.0.0`);
		console.log(`  ─────────────────────────────`);
		console.log(`  Server:    http://localhost:${port}`);
		console.log(`  Sources:   ${_sources.length} loaded`);
		console.log(`  Formats:   ${listFormats().join(", ")}`);
		console.log(`  Zero-Deps: Only Node.js built-ins\n`);
	});
	return server;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: CLI Interface
// ═══════════════════════════════════════════════════════════════════════════════

function parseArgs() {
	const args = {};
	for (const a of process.argv.slice(2)) {
		const m = a.replace(/^--/, "").split("=");
		args[m[0]] = m[1] || true;
	}
	return args;
}

async function main() {
	const args = parseArgs();

	// Allow --github-* to override env
	if (args["github-user"]) CONFIG.GITHUB_USER = args["github-user"];
	if (args["github-repo"]) CONFIG.GITHUB_REPO = args["github-repo"];
	if (args["github-branch"]) CONFIG.GITHUB_BRANCH = args["github-branch"];

	if (args.help || args.h) {
		console.log(
			JSON.stringify(
				{
					name: "MultiSource API",
					version: "4.0.0",
					description:
						"Serverless multi-source HLS stream aggregator. Sources managed in sources/ directory.",
					usage: [
						"node raw-api.js --tmdb=24428",
						"node raw-api.js --imdb=tt0848228",
						"node raw-api.js --tmdb=1399 --type=tv --season=1 --episode=1",
						"node raw-api.js --server",
						"curl -sL https://raw.githubusercontent.com/USER/REPO/master/raw-api.js | node - --tmdb=24428",
					],
					options: {
						"--tmdb=N": "TMDB movie/TV ID",
						"--imdb=tt...": "IMDB ID",
						"--type=movie|tv": "Media type",
						"--season=N": "Season",
						"--episode=N": "Episode",
						"--format=F": `Formats: ${listFormats().join(", ")}`,
						"--server": "Start HTTP server",
						"--port=N": "Server port",
						"--github-user=U": "GitHub user (for remote source loading)",
						"--github-repo=R": "GitHub repo (for remote source loading)",
						"--github-branch=B": "Branch (default: master)",
					},
					env_vars: {
						GITHUB_USER: "GitHub username",
						GITHUB_REPO: "GitHub repo name",
						GITHUB_BRANCH: "Branch",
						TMDB_API_KEY: "TMDB API key",
						PORT: "Server port",
					},
					formats: listFormats(),
				},
				null,
				2,
			),
		);
		process.exit(0);
	}

	if (args.server) {
		const port =
			parseInt(args.port, 10) || parseInt(process.env.PORT, 10) || 3000;
		await startServer(port);
		return;
	}

	let tmdbId = args.tmdb || args.id;
	let type = args.type || "movie";
	const season = args.season || 1;
	const episode = args.episode || 1;
	const format = args.format || "full";

	if (args.imdb) {
		try {
			const lu = await imdbToTmdb(args.imdb);
			tmdbId = lu.tmdbId;
			type = lu.type;
			console.warn(
				`[IMDB] ${args.imdb} → TMDB ${lu.tmdbId} (${lu.type}: ${lu.title})`,
			);
		} catch (e) {
			console.log(
				JSON.stringify(
					{ success: false, error: `IMDB lookup failed: ${e.message}` },
					null,
					2,
				),
			);
			process.exit(1);
		}
	}

	if (!tmdbId) {
		console.log(
			JSON.stringify(
				{
					success: false,
					error: "Missing --tmdb or --imdb",
					usage: "node raw-api.js --help",
				},
				null,
				2,
			),
		);
		process.exit(1);
	}

	try {
		console.log(
			JSON.stringify(
				await scrapeAll(tmdbId, type, season, episode, { format }),
				null,
				2,
			),
		);
	} catch (err) {
		console.log(
			JSON.stringify({ success: false, error: err.message }, null, 2),
		);
		process.exit(1);
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 12: Module Exports
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
	scrapeAll,
	initSources,
	getSources,
	getSourceCount,
	listFormats,
	formatResult,
	imdbToTmdb,
	fetchUrl,
	fetchJson,
	parseMasterPlaylist,
	dedupeStreams,
	scrapeEmbedSource,
	startServer,
	CONFIG,
	// Crypto helpers for source development
	aes256CbcEncrypt,
	aes256CbcDecrypt,
	aes256GcmDecrypt,
	customBase64Decode,
	sha256,
	qualityToResolution,
};

if (require.main === module || module.id === "[stdin]" || module.id === ".") {
	main();
}
