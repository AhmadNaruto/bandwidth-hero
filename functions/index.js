// index.js - Production-ready with all fixes integrated

const crypto = require("node:crypto");
const pick = require("../util/pick");
const shouldCompress = require("../util/shouldCompress");
const compress = require("../util/compress");
const logger = require("../util/logger");

// Helper: Generate cache-safe headers
const getCacheHeaders = (custom = {}) => ({
	"content-encoding": "identity",
	"cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
	pragma: "no-cache",
	expires: "0",
	vary: "url, jpeg, grayscale, quality",
	...custom,
});

// Main handler - HANYA SATU DEKLARASI
exports.handler = async (event, _context) => {
	// const startTime = Date.now();
	// FIX: Guard clause untuk queryStringParameters undefined
	if (!event.queryStringParameters) {
		return {
			statusCode: 400,
			body: JSON.stringify({ error: "Missing query parameters" }),
			headers: { "content-type": "application/json" },
		};
	}

	const { url: r, jpeg: s, bw: o, l: a } = event.queryStringParameters;

	// Health check endpoint
	if (!r) {
		return {
			statusCode: 200,
			body: "bandwidth-hero-proxy",
			headers: getCacheHeaders(),
		};
	}

	let imageUrl = r;

	try {
		// Handle JSON-encoded URL (legacy support)
		// imageUrl = JSON.parse(imageUrl);

		// Clean malformed URLs
		imageUrl = imageUrl.replace(
			/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i,
			"http://",
		);

		// get value from query url
		const isWebp = !+s;
		const isGrayscale = !!+o;
		const quality = parseInt(a, 10) || 40;

		// Generate unique cache key
		const urlHash = crypto.createHash("md5").update(imageUrl).digest("hex");

		// Fetch upstream image dengan no-cache
		const fetchStartTime = Date.now();
		const fetchResult = await fetch(imageUrl, {
			cache: "no-store", // Penting: jangan cache upstream
			headers: {
				...pick(event.headers, [
					"cookie",
					"dnt",
					"referer",
					"user-agent",
					"accept",
					"accept-language",
				]),
				"x-forwarded-for": event.headers["x-forwarded-for"] || event.ip,
				"accept-encoding": "identity",
			},
		});

		const fetchTime = Date.now() - fetchStartTime;

		if (!fetchResult.ok) {
			logger.logUpstreamFetch({
				url: imageUrl,
				statusCode: fetchResult.status,
				fetchTime,
				success: false,
			});
			return {
				statusCode: fetchResult.status || 502,
				headers: getCacheHeaders(),
			};
		}

		// Get headers dan clean encoding
		const upstreamHeaders = Object.fromEntries(fetchResult.headers.entries());
		delete upstreamHeaders["content-encoding"];
		delete upstreamHeaders["transfer-encoding"];
		delete upstreamHeaders["x-encoded-content-encoding"];

		const contentType = fetchResult.headers.get("content-type") || "";
		const buffer = Buffer.from(await fetchResult.arrayBuffer());
		const contentLength = buffer.length;

		logger.logUpstreamFetch({
			url: imageUrl,
			statusCode: fetchResult.status,
			// contentType,
			// contentLength: String(contentLength),
			fetchTime,
			success: true,
		});

		// Validasi content-type
		if (!contentType.startsWith("image/")) {
			logger.warn("Non-image content received", {
				url: imageUrl,
				contentType,
				size: contentLength,
			});
			const base64Body = buffer.toString("base64");
			return {
				statusCode: 200,
				body: base64Body,
				isBase64Encoded: true,
				headers: getCacheHeaders({
					"content-type": contentType,
					"content-length": Buffer.byteLength(base64Body, "base64"),
					"x-bypass-reason": "non-image",
					"x-url-hash": urlHash,
				}),
			};
		}

		// Bypass untuk gambar sangat kecil
		const BYPASS_THRESHOLD = 10240; // 10KB
		if (contentLength < BYPASS_THRESHOLD && !isGrayscale && !isWebp && !s) {
			logger.logBypass({
				url: imageUrl,
				size: contentLength,
				// contentType,
				reason: "already_small",
			});
			const base64Body = buffer.toString("base64");
			return {
				statusCode: 200,
				body: base64Body,
				isBase64Encoded: true,
				headers: getCacheHeaders({
					"content-type": contentType,
					"content-length": Buffer.byteLength(base64Body, "base64"),
					"x-bypass-reason": "already_small",
					"x-url-hash": urlHash,
				}),
			};
		}

		// Check apakah perlu kompresi
		if (!shouldCompress(contentType, contentLength, isWebp)) {
			logger.logBypass({
				url: imageUrl,
				size: contentLength,
				// contentType,
				reason: "criteria_not_met",
			});
			const base64Body = buffer.toString("base64");
			return {
				statusCode: 200,
				body: base64Body,
				isBase64Encoded: true,
				headers: getCacheHeaders({
					...upstreamHeaders,
					"content-length": Buffer.byteLength(base64Body, "base64"),
					"x-bypass-reason": "criteria_not_met",
					"x-url-hash": urlHash,
				}),
			};
		}

		// Kompres gambar
		const {
			err,
			output,
			headers: compressHeaders,
		} = await compress(buffer, isWebp, isGrayscale, quality, contentLength);

		// const processingTime = Date.now() - startTime;

		if (err) {
			logger.logCompressionProcess({
				url: imageUrl,
				// originalSize: contentLength,
				error: err,
				// processingTime,
			});
			throw err;
		}

		const finalBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
		// const compressionRatio =
		//	(contentLength - finalBuffer.length) / contentLength;
		const responseBase64 = finalBuffer.toString("base64");

		logger.logCompressionProcess({
			// url: imageUrl,
			// originalSize: contentLength,
			// compressedSize: finalBuffer.length,
			// transmittedSize: responseBase64.length,
			// format: isWebp ? "webp" : "jpeg",
			quality,
			// grayscale: isGrayscale,
			// compressionRatio,
			bytesSaved: contentLength - finalBuffer.length,
			// processingTime,
			// overhead: responseBase64.length - finalBuffer.length,
		});

		return {
			statusCode: 200,
			body: responseBase64,
			isBase64Encoded: true,
			headers: getCacheHeaders({
				...upstreamHeaders,
				...(compressHeaders || {}),
				"content-type": compressHeaders?.["content-type"] || contentType,
				"content-length": Buffer.byteLength(responseBase64, "base64"),
				"x-compressed-by": "bandwidth-hero",
				"x-url-hash": urlHash,
			}),
		};
	} catch (error) {
		// const processingTime = Date.now() - startTime;

		logger.error("UNKNOWN: ", {
			url: imageUrl,
			error: error.message,
			stack: error.stack,
			// processingTime,
		});

		return {
			statusCode: 500,
			body: JSON.stringify({
				error: error.message || "Internal server error",
				url: imageUrl,
			}),
			headers: getCacheHeaders({ "content-type": "application/json" }),
		};
	}
};
