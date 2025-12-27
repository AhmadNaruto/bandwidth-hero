// index.js - OPTIMIZED: Enhanced structure, error handling, and performance

import crypto from "node:crypto";
import got from "got";
import pick from "../util/pick.js";
import shouldCompress from "../util/shouldCompress.js";
import compress from "../util/compress.js";
import logger from "../util/logger.js";

// Configuration constants
const CONFIG = {
	CACHE_HEADERS: {
		"content-encoding": "identity",
		"cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
		pragma: "no-cache",
		expires: "0",
		vary: "url, jpeg, grayscale, quality",
	},
	BYPASS_THRESHOLD: 10240, // 10KB
	DEFAULT_QUALITY: 40,
	FETCH_HEADERS_TO_PICK: [
		"cookie",
		"dnt",
		"referer",
		"user-agent",
		"accept",
		"accept-language",
	],
};

// Helper: Generate cache-safe headers
const getCacheHeaders = (custom = {}) => ({
	...CONFIG.CACHE_HEADERS,
	...custom,
});

// Helper: Create error response
const createErrorResponse = (statusCode, message, url = null) => {
	const body = { error: message };
	if (url) body.url = url;

	return {
		statusCode,
		body: JSON.stringify(body),
		headers: getCacheHeaders({ "content-type": "application/json" }),
	};
};

// Helper: Create successful image response
const createImageResponse = (
	buffer,
	contentType,
	additionalHeaders = {},
	isBase64Encoded = true,
) => {
	const body = isBase64Encoded ? buffer.toString("base64") : buffer;

	return {
		statusCode: 200,
		body,
		isBase64Encoded,
		headers: getCacheHeaders({
			"content-type": contentType,
			"content-length": Buffer.byteLength(
				body,
				isBase64Encoded ? "base64" : undefined,
			),
			...additionalHeaders,
		}),
	};
};

// Helper: Parse and validate query parameters
function parseQueryParams(queryParams) {
	if (!queryParams) {
		throw new Error("Missing query parameters");
	}

	const {
		url: imageUrl,
		jpeg: jpegParam,
		bw: grayscaleParam,
		l: qualityParam,
	} = queryParams;

	if (!imageUrl) {
		return { healthCheck: true };
	}

	return {
		imageUrl,
		isWebp: !parseInt(jpegParam, 10),
		isGrayscale: !!parseInt(grayscaleParam, 10),
		quality: parseInt(qualityParam, 10) || CONFIG.DEFAULT_QUALITY,
	};
}

// Helper: Clean and normalize image URL
function cleanImageUrl(url) {
	return url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, "http://");
}

// Helper: Generate unique cache key for URL
function generateUrlHash(url) {
	return crypto.createHash("md5").update(url).digest("hex");
}

// Helper: Fetch image from upstream using got with retry
const fetchWithRetry = got.extend({
	retry: {
		limit: 2, // ← Kurangi retry di free tier (hemat waktu)
		methods: ["GET"],
		statusCodes: [408, 429, 500, 502, 503, 504],
		errorCodes: ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND"],
		calculateDelay: ({ attemptCount }) => Math.min(attemptCount * 500, 1000), // ← Jeda pendek
	},
	timeout: {
		request: 8500, // 8.5 seconds timeout to allow processing time before Netlify's 10s limit
	},
	decompress: true,
	throwHttpErrors: false,
	http2: false,
});

async function fetchUpstreamImage(url, headers, ip) {
	const fetchStartTime = Date.now();

	const fetchHeaders = {
		...pick(headers, CONFIG.FETCH_HEADERS_TO_PICK),
		"x-forwarded-for": headers["x-forwarded-for"] || ip,
	};
	console.log(fetchHeaders);
	// Only set accept-encoding to identity if specifically requested by client
	if (headers["accept-encoding"] === "identity") {
		fetchHeaders["accept-encoding"] = "identity";
	}

	try {
		const response = await fetchWithRetry(url, {
			headers: fetchHeaders,
			responseType: "buffer", // Explicitly request binary buffer response for images
		});

		const fetchTime = Date.now() - fetchStartTime;

		// Create a compatible response object that mimics fetch API
		return {
			response: {
				ok: response.statusCode >= 200 && response.statusCode < 300,
				status: response.statusCode,
				headers: {
					get: (headerName) =>
						response.headers[headerName.toLowerCase()] || null,
					entries: () => Object.entries(response.headers),
				},
				arrayBuffer: async () => Buffer.from(response.body),
			},
			fetchTime,
			success: response.statusCode >= 200 && response.statusCode < 300,
		};
	} catch (error) {
		const fetchTime = Date.now() - fetchStartTime;

		// Log the error
		logger.error("Upstream fetch error", {
			url,
			error: error.message,
			stack: error.stack,
		});

		return {
			response: {
				status: error.response?.statusCode || 500,
				headers: {
					get: () => null,
					entries: () => [],
				},
				arrayBuffer: async () => Buffer.alloc(0),
			},
			fetchTime,
			success: false,
		};
	}
}

// Helper: Process and validate upstream response
async function processUpstreamResponse(fetchResult, url, fetchTime) {
	const { response, success } = fetchResult;

	if (!success) {
		const statusCode = response.status || "Unknown";
		logger.logUpstreamFetch({
			url,
			statusCode: statusCode,
			fetchTime,
			success: false,
		});
		throw new Error(`Upstream fetch failed with status: ${statusCode}`);
	}

	// Get and clean headers
	const upstreamHeaders = Object.fromEntries(response.headers.entries());
	delete upstreamHeaders["content-encoding"];
	delete upstreamHeaders["transfer-encoding"];
	delete upstreamHeaders["x-encoded-content-encoding"];

	const contentType = response.headers.get("content-type") || "";
	const buffer = await response.arrayBuffer();
	const contentLength = buffer.length;

	logger.logUpstreamFetch({
		url,
		statusCode: response.status || "Unknown",
		fetchTime,
		success: true,
	});

	return {
		buffer,
		contentType,
		contentLength,
		upstreamHeaders,
	};
}

// Helper: Determine if we should bypass compression
function shouldBypassCompression(
	contentLength,
	contentType,
	// isGrayscale,
	isWebp,
	// jpegParam,
) {
	// Bypass very small images (unless modifications requested)
	if (
		contentLength < CONFIG.BYPASS_THRESHOLD // &&
		// !isGrayscale &&
		// !isWebp &&
		// !jpegParam
	) {
		return { bypass: true, reason: "already_small" };
	}

	// Check compression criteria
	if (!shouldCompress(contentType, contentLength, isWebp)) {
		return { bypass: true, reason: "criteria_not_met" };
	}

	// Validate content type
	if (!contentType.startsWith("image/")) {
		return { bypass: true, reason: "non-image" };
	}

	return { bypass: false };
}

// Main handler
export const handler = async (event, _context) => {
	try {
		// 1. Parse query parameters
		const params = parseQueryParams(event.queryStringParameters);

		if (params.healthCheck) {
			return {
				statusCode: 200,
				body: "bandwidth-hero-proxy",
				headers: getCacheHeaders(),
			};
		}

		const { imageUrl: rawUrl, isWebp, isGrayscale, quality } = params;

		// 2. Clean URL
		const imageUrl = cleanImageUrl(rawUrl);
		const urlHash = generateUrlHash(imageUrl);

		// 3. Fetch upstream image
		const fetchResult = await fetchUpstreamImage(
			imageUrl,
			event.headers,
			event.ip,
		);

		// 4. Process response
		const { buffer, contentType, contentLength, upstreamHeaders } =
			await processUpstreamResponse(
				fetchResult,
				imageUrl,
				fetchResult.fetchTime,
			);

		logger.logRequest({
			url: imageUrl,
			userAgent: event.headers["user-agent"],
			referer: event.headers["referer"],
			ip: event.ip || event.headers["x-forwarded-for"],
			jpeg: event.queryStringParameters.jpeg,
			bw: event.queryStringParameters.bw,
			quality: quality,
			contentType: contentType,
		});

		// 5. Check if compression should be bypassed
		const bypassCheck = shouldBypassCompression(
			contentLength,
			contentType,
			// isGrayscale,
			isWebp,
			// event.queryStringParameters.jpeg,
		);

		if (bypassCheck.bypass) {
			logger.logBypass({
				url: imageUrl,
				size: contentLength,
				reason: bypassCheck.reason,
			});

			return createImageResponse(buffer, contentType, {
				...upstreamHeaders,
				"x-bypass-reason": bypassCheck.reason,
				"x-url-hash": urlHash,
			});
		}

		// 6. Compress image
		const {
			err,
			output,
			headers: compressHeaders,
		} = await compress(buffer, isWebp, isGrayscale, quality, contentLength);

		if (err) {
			logger.logCompressionProcess({
				url: imageUrl,
				originalSize: contentLength,
				error: err,
			});
			throw err;
		}

		// 7. Create final response
		const finalBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
		const bytesSaved = contentLength - finalBuffer.length;

		logger.logCompressionProcess({
			url: imageUrl,
			originalSize: contentLength,
			compressedSize: finalBuffer.length,
			bytesSaved: bytesSaved,
			quality: quality,
			format: compressHeaders?.["content-type"] || (isWebp ? "webp" : "jpeg"),
			// processingTime: processingTime
		});

		return createImageResponse(
			finalBuffer,
			compressHeaders?.["content-type"] || contentType,
			{
				...upstreamHeaders,
				...(compressHeaders || {}),
				"x-compressed-by": "bandwidth-hero",
				"x-url-hash": urlHash,
			},
		);
	} catch (error) {
		logger.error("Handler error", {
			error: error.message,
			stack: error.stack,
		});

		if (error.message === "Missing query parameters") {
			return createErrorResponse(400, error.message);
		}

		if (error.message.startsWith("Upstream fetch failed")) {
			const statusPart = error.message.split(":")[1]?.trim();
			const statusCode =
				statusPart && statusPart !== "Unknown" ? parseInt(statusPart, 10) : 502;
			return {
				statusCode: statusCode || 502,
				headers: getCacheHeaders(),
			};
		}

		return createErrorResponse(
			500,
			"Internal server error",
			event?.queryStringParameters?.url,
		);
	}
};
