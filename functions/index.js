// index.js - OPTIMIZED: Enhanced structure, error handling, and performance

const crypto = require("node:crypto");
const pick = require("../util/pick");
const shouldCompress = require("../util/shouldCompress");
const compress = require("../util/compress");
const logger = require("../util/logger");

// Configuration constants
const CONFIG = {
    CACHE_HEADERS: {
        "content-encoding": "identity",
        "cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
        pragma: "no-cache",
        expires: "0",
        vary: "url, jpeg, grayscale, quality"
    },
    BYPASS_THRESHOLD: 10240, // 10KB
    DEFAULT_QUALITY: 40,
    FETCH_HEADERS_TO_PICK: ["cookie", "dnt", "referer", "user-agent", "accept", "accept-language"]
};

// Helper: Generate cache-safe headers
const getCacheHeaders = (custom = {}) => ({
    ...CONFIG.CACHE_HEADERS,
    ...custom
});

// Helper: Create error response
const createErrorResponse = (statusCode, message, url = null) => {
    const body = { error: message };
    if (url) body.url = url;

    return {
        statusCode,
        body: JSON.stringify(body),
        headers: getCacheHeaders({ "content-type": "application/json" })
    };
};

// Helper: Create successful image response
const createImageResponse = (buffer, contentType, additionalHeaders = {}, isBase64Encoded = true) => {
    const body = isBase64Encoded ? buffer.toString("base64") : buffer;
    
    return {
        statusCode: 200,
        body,
        isBase64Encoded,
        headers: getCacheHeaders({
            "content-type": contentType,
            "content-length": Buffer.byteLength(body, isBase64Encoded ? "base64" : undefined),
            ...additionalHeaders
        })
    };
};

// Helper: Parse and validate query parameters
function parseQueryParams(queryParams) {
    if (!queryParams) {
        throw new Error("Missing query parameters");
    }

    const { url: imageUrl, jpeg: jpegParam, bw: grayscaleParam, l: qualityParam } = queryParams;
    
    if (!imageUrl) {
        return { healthCheck: true };
    }

    return {
        imageUrl,
        isWebp: !parseInt(jpegParam, 10),
        isGrayscale: !!parseInt(grayscaleParam, 10),
        quality: parseInt(qualityParam, 10) || CONFIG.DEFAULT_QUALITY
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

// Helper: Fetch image from upstream
async function fetchUpstreamImage(url, headers, ip) {
    const fetchStartTime = Date.now();
    
    const fetchHeaders = {
        ...pick(headers, CONFIG.FETCH_HEADERS_TO_PICK),
        "x-forwarded-for": headers["x-forwarded-for"] || ip,
        "accept-encoding": "identity"
    };

    const response = await fetch(url, {
        cache: "no-store",
        headers: fetchHeaders
    });

    const fetchTime = Date.now() - fetchStartTime;

    return {
        response,
        fetchTime,
        success: response.ok
    };
}

// Helper: Process and validate upstream response
async function processUpstreamResponse(fetchResult, url, fetchTime) {
    const { response, success } = fetchResult;

    if (!success) {
        logger.logUpstreamFetch({
            url,
            statusCode: response.status,
            fetchTime,
            success: false
        });
        throw new Error(`Upstream fetch failed with status: ${response.status}`);
    }

    // Get and clean headers
    const upstreamHeaders = Object.fromEntries(response.headers.entries());
    delete upstreamHeaders["content-encoding"];
    delete upstreamHeaders["transfer-encoding"];
    delete upstreamHeaders["x-encoded-content-encoding"];

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentLength = buffer.length;

    logger.logUpstreamFetch({
        url,
        statusCode: response.status,
        fetchTime,
        success: true
    });

    return {
        buffer,
        contentType,
        contentLength,
        upstreamHeaders
    };
}

// Helper: Determine if we should bypass compression
function shouldBypassCompression(contentLength, contentType, isGrayscale, isWebp, jpegParam) {
    // Bypass very small images (unless modifications requested)
    if (contentLength < CONFIG.BYPASS_THRESHOLD && !isGrayscale && !isWebp && !jpegParam) {
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
exports.handler = async (event, context) => {
    try {
        // 1. Parse query parameters
        const params = parseQueryParams(event.queryStringParameters);
        
        if (params.healthCheck) {
            return {
                statusCode: 200,
                body: "bandwidth-hero-proxy",
                headers: getCacheHeaders()
            };
        }

        const { imageUrl: rawUrl, isWebp, isGrayscale, quality } = params;
        
        // 2. Clean URL
        const imageUrl = cleanImageUrl(rawUrl);
        const urlHash = generateUrlHash(imageUrl);

        // 3. Fetch upstream image
        const fetchResult = await fetchUpstreamImage(imageUrl, event.headers, event.ip);
        
        // 4. Process response
        const { buffer, contentType, contentLength, upstreamHeaders } = 
            await processUpstreamResponse(fetchResult, imageUrl, fetchResult.fetchTime);

        // 5. Check if compression should be bypassed
        const bypassCheck = shouldBypassCompression(
            contentLength, 
            contentType, 
            isGrayscale, 
            isWebp, 
            event.queryStringParameters.jpeg
        );

        if (bypassCheck.bypass) {
            logger.logBypass({
                url: imageUrl,
                size: contentLength,
                reason: bypassCheck.reason
            });

            return createImageResponse(buffer, contentType, {
                ...upstreamHeaders,
                "x-bypass-reason": bypassCheck.reason,
                "x-url-hash": urlHash
            });
        }

        // 6. Compress image
        const { err, output, headers: compressHeaders } = await compress(
            buffer, 
            isWebp, 
            isGrayscale, 
            quality, 
            contentLength
        );

        if (err) {
            logger.logCompressionProcess({
                url: imageUrl,
                error: err
            });
            throw err;
        }

        // 7. Create final response
        const finalBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
        const bytesSaved = contentLength - finalBuffer.length;

        logger.logCompressionProcess({
            quality,
            bytesSaved
        });

        return createImageResponse(finalBuffer, 
            compressHeaders?.["content-type"] || contentType, {
            ...upstreamHeaders,
            ...(compressHeaders || {}),
            "x-compressed-by": "bandwidth-hero",
            "x-url-hash": urlHash
        });

    } catch (error) {
        logger.error("Handler error", {
            error: error.message,
            stack: error.stack
        });

        if (error.message === "Missing query parameters") {
            return createErrorResponse(400, error.message);
        }

        if (error.message.startsWith("Upstream fetch failed")) {
            const statusCode = parseInt(error.message.split(":")[1]) || 502;
            return {
                statusCode,
                headers: getCacheHeaders()
            };
        }

        return createErrorResponse(500, "Internal server error", event?.queryStringParameters?.url);
    }
};