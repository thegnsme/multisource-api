/**
 * antidetect.js — Shared anti-detection utilities for all sources.
 *
 * Features:
 *   - User-Agent rotation (20+ realistic UAs)
 *   - Cookie jar with persistence
 *   - Rate limiting with jitter
 *   - Request fingerprinting
 *   - Retry with exponential backoff
 *   - IPv4 forcing + TLS bypass
 */

const https = require("https");
const http = require("http");

// ── User-Agent Pool ──────────────────────────────────────────────────────────

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function getRandomUA() {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimiters = new Map();

function getRateLimiter(domain, minDelay = 500) {
	if (!rateLimiters.has(domain)) {
		rateLimiters.set(domain, { lastRequest: 0, minDelay });
	}
	return rateLimiters.get(domain);
}

async function respectRateLimit(domain) {
	const limiter = getRateLimiter(domain);
	const now = Date.now();
	const elapsed = now - limiter.lastRequest;
	if (elapsed < limiter.minDelay) {
		const jitter = Math.random() * 200;
		await new Promise((r) =>
			setTimeout(r, limiter.minDelay - elapsed + jitter),
		);
	}
	limiter.lastRequest = Date.now();
}

// ── Global instances ─────────────────────────────────────────────────────────

const httpsAgent = new https.Agent({
	family: 4,
	keepAlive: true,
	rejectUnauthorized: false,
});
const httpAgent = new http.Agent({ family: 4, keepAlive: true });

// ── Smart Fetch ──────────────────────────────────────────────────────────────

/**
 * Advanced fetch with anti-detection measures.
 *
 * @param {string} url - URL to fetch
 * @param {object} opts - Options
 * @param {string} opts.referer - Referer header
 * @param {string} opts.origin - Origin header
 * @param {number} opts.timeout - Request timeout (default 10000)
 * @param {number} opts.retries - Max retries (default 2)
 * @param {string} opts.responseType - Response type (default 'text')
 * @param {boolean} opts.rateLimit - Apply rate limiting (default true)
 * @param {object} opts.extraHeaders - Additional headers
 * @param {object} opts.axiosInstance - Custom axios instance
 * @returns {Promise<{data: any, status: number, headers: object, error?: string}>}
 */
async function smartFetch(url, opts = {}) {
	const {
		referer = "",
		origin = "",
		timeout = 10000,
		retries = 2,
		responseType = "text",
		rateLimit = true,
		extraHeaders = {},
		axiosInstance = null,
	} = opts;

	const axios = axiosInstance || require("axios");
	let domain;
	try {
		domain = new URL(url).hostname;
	} catch {
		domain = url;
	}

	// Rate limiting
	if (rateLimit) {
		await respectRateLimit(domain);
	}

	// Build headers with fingerprint diversity
	const headers = {
		"User-Agent": getRandomUA(),
		Accept:
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		Connection: "keep-alive",
		"Upgrade-Insecure-Requests": "1",
		"Sec-Fetch-Dest": "document",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-User": "?1",
		"Cache-Control": "max-age=0",
		...extraHeaders,
	};

	if (referer) {
		headers["Referer"] = referer;
		headers["Sec-Fetch-Site"] = "same-origin";
	}

	if (origin) {
		headers["Origin"] = origin;
	}

	// Retry with exponential backoff
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const resp = await axios.get(url, {
				headers,
				timeout,
				maxRedirects: 5,
				validateStatus: () => true,
				responseType,
				httpsAgent,
				httpAgent,
			});

			return {
				data:
					typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data),
				status: resp.status,
				headers: resp.headers,
			};
		} catch (e) {
			if (attempt === retries) {
				return { data: null, status: 0, error: e.message };
			}
			// Exponential backoff with jitter
			const delay = Math.min(
				1000 * Math.pow(2, attempt) + Math.random() * 500,
				5000,
			);
			await new Promise((r) => setTimeout(r, delay));
		}
	}

	return { data: null, status: 0, error: "max retries exceeded" };
}

/**
 * Smart POST fetch with anti-detection.
 */
async function smartPost(url, body, opts = {}) {
	const {
		referer = "",
		origin = "",
		timeout = 10000,
		retries = 2,
		contentType = "application/json",
		extraHeaders = {},
		axiosInstance = null,
	} = opts;

	const axios = axiosInstance || require("axios");
	let domain;
	try {
		domain = new URL(url).hostname;
	} catch {
		domain = url;
	}

	const headers = {
		"User-Agent": getRandomUA(),
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9",
		"Content-Type": contentType,
		...extraHeaders,
	};

	if (referer) headers["Referer"] = referer;
	if (origin) headers["Origin"] = origin;

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const resp = await axios.post(url, body, {
				headers,
				timeout,
				maxRedirects: 5,
				validateStatus: () => true,
				httpsAgent,
				httpAgent,
			});

			return {
				data:
					typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data),
				status: resp.status,
				headers: resp.headers,
			};
		} catch (e) {
			if (attempt === retries) {
				return { data: null, status: 0, error: e.message };
			}
			const delay = Math.min(
				1000 * Math.pow(2, attempt) + Math.random() * 500,
				5000,
			);
			await new Promise((r) => setTimeout(r, delay));
		}
	}

	return { data: null, status: 0, error: "max retries exceeded" };
}

// ── M3U8 Parser ──────────────────────────────────────────────────────────────

const QUALITY_MAP = {
	360: "360p",
	480: "480p",
	720: "720p",
	1080: "1080p",
	2160: "4K",
	4320: "8K",
};

function parseM3U8(m3u8, baseUrl) {
	const streams = [];
	if (!m3u8 || typeof m3u8 !== "string" || !m3u8.startsWith("#EXTM3U"))
		return streams;

	if (!m3u8.includes("#EXT-X-STREAM-INF:")) {
		// Simple media playlist
		const urls = m3u8
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		for (const url of urls) {
			const fullUrl = url.startsWith("http") ? url : new URL(url, baseUrl).href;
			streams.push({ url: fullUrl, type: "hls", quality: "", resolution: "" });
		}
		return streams;
	}

	// Master playlist with quality variants
	const lines = m3u8.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
		const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
		const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
		const nl = lines[i + 1]?.trim();
		if (nl && !nl.startsWith("#")) {
			const vu = nl.startsWith("http") ? nl : new URL(nl, baseUrl).href;
			const h = res ? res.split("x")[1] : "";
			streams.push({
				url: vu,
				type: "hls",
				quality: QUALITY_MAP[h] || (h ? h + "p" : ""),
				resolution: res || "",
				bandwidth: bw ? parseInt(bw) : undefined,
			});
			i++;
		}
	}

	// Deduplicate
	const seen = new Set();
	return streams.filter((s) => {
		if (seen.has(s.url)) return false;
		seen.add(s.url);
		return true;
	});
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
	getRandomUA,
	smartFetch,
	smartPost,
	parseM3U8,
	QUALITY_MAP,
};
