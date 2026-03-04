// server.js - Production-ready Express server for VPS deployment
import express from "express";
import { createServer } from "node:http";
import compression from "compression";
import crypto from "node:crypto";
import got from "got";
import pick from "./util/pick.js";
import shouldCompress from "./util/shouldCompress.js";
import compressImage from "./util/compress.js";
import logger from "./util/logger.js";

const app = express();
const PORT = process.env.PORT || 8080;
const NODE_ENV = process.env.NODE_ENV || "development";

// Configuration
const CONFIG = {
  CACHE_HEADERS: {
    "content-encoding": "identity",
    "cache-control": "private, no-store, no-cache, must-revalidate, max-age=0",
    pragma: "no-cache",
    expires: "0",
    vary: "url, jpeg, grayscale, quality",
  },
  BYPASS_THRESHOLD: 10240,
  DEFAULT_QUALITY: 40,
  FETCH_HEADERS_TO_PICK: ["cookie", "dnt", "referer", "user-agent", "accept", "accept-language"],
  REQUEST_TIMEOUT: 60000,
  MAX_REQUEST_SIZE: "10mb",
};

// Security & Performance middleware
app.disable("x-powered-by");

// Request size limit
app.use(express.json({ limit: CONFIG.MAX_REQUEST_SIZE }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.MAX_REQUEST_SIZE }));

// Response compression for JSON responses
app.use(compression({
  level: 6,
  threshold: 1024,
}));

// Request timeout middleware
app.use((req, res, next) => {
  req.setTimeout(CONFIG.REQUEST_TIMEOUT, () => {
    res.status(408).json({ error: "Request timeout" });
  });
  next();
});

// Helper functions
const getCacheHeaders = (custom = {}) => ({ ...CONFIG.CACHE_HEADERS, ...custom });

const createErrorResponse = (statusCode, message, url = null) => ({
  statusCode,
  body: JSON.stringify({ error: message, ...(url && { url }) }),
  headers: getCacheHeaders({ "content-type": "application/json" }),
});

const createImageResponse = (buffer, contentType, additionalHeaders = {}) => ({
  statusCode: 200,
  body: buffer,
  headers: getCacheHeaders({
    "content-type": contentType,
    "content-length": buffer.length,
    ...additionalHeaders,
  }),
});

const parseQueryParams = (queryParams) => {
  if (!queryParams) throw new Error("Missing query parameters");

  const { url: imageUrl, jpeg: jpegParam, bw: grayscaleParam, l: qualityParam } = queryParams;

  if (!imageUrl) return { healthCheck: true };

  return {
    imageUrl,
    isWebp: !parseInt(jpegParam, 10),
    isGrayscale: Boolean(parseInt(grayscaleParam, 10)),
    quality: parseInt(qualityParam, 10) || CONFIG.DEFAULT_QUALITY,
  };
};

/**
 * Cleans and validates image URL
 * @param {string} url - URL to clean
 * @returns {string|null} - Cleaned URL or null if invalid
 */
const cleanImageUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url.trim()).href;
  } catch {
    return null;
  }
};

const generateUrlHash = (url) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);

// Configure fetch with retry and connection pooling
const fetchWithRetry = got.extend({
  retry: {
    limit: 2,
    methods: ["GET"],
    statusCodes: [408, 429, 500, 502, 503, 504],
    calculateDelay: ({ attemptCount, errorCode, error, retryOptions }) => {
      if (error?.response?.statusCode >= 400 && error.response.statusCode < 500 && error.response.statusCode !== 429) {
        return 0;
      }
      const delay = Math.min(retryOptions.maxRetryAfter || 2000, 100 * Math.pow(2, attemptCount - 1));
      return delay;
    },
  },
  timeout: {
    request: 8500,
    connect: 3000,
    lookup: 1000,
  },
  decompress: true,
  throwHttpErrors: false,
  http2: true,
  https: {
    rejectUnauthorized: true,
  },
});

const fetchUpstreamImage = async (url, headers, ip) => {
  const fetchStartTime = Date.now();
  const fetchHeaders = {
    ...pick(headers, CONFIG.FETCH_HEADERS_TO_PICK),
    "x-forwarded-for": headers["x-forwarded-for"] || ip,
    ...(headers["accept-encoding"] === "identity" && { "accept-encoding": "identity" }),
  };

  try {
    const response = await fetchWithRetry(url, { headers: fetchHeaders, responseType: "buffer" });
    const fetchTime = Date.now() - fetchStartTime;

    return {
      response: {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        headers: {
          get: (name) => response.headers[name.toLowerCase()] || null,
          entries: () => Object.entries(response.headers),
        },
        arrayBuffer: async () => Buffer.from(response.body),
      },
      fetchTime,
      success: response.statusCode >= 200 && response.statusCode < 300,
    };
  } catch (error) {
    logger.error("Upstream fetch error", { url, error: error.message, stack: error.stack });
    return {
      response: { status: error.response?.statusCode || 500, headers: { get: () => null, entries: () => [] } },
      fetchTime: Date.now() - fetchStartTime,
      success: false,
    };
  }
};

const processUpstreamResponse = async (fetchResult, url) => {
  const { response, success, fetchTime } = fetchResult;

  if (!success) {
    logger.logUpstreamFetch({ url, statusCode: response.status || "Unknown", fetchTime, success: false });
    throw new Error(`Upstream fetch failed with status: ${response.status}`);
  }

  const upstreamHeaders = Object.fromEntries(response.headers.entries());
  delete upstreamHeaders["content-encoding"];
  delete upstreamHeaders["transfer-encoding"];
  delete upstreamHeaders["x-encoded-content-encoding"];

  const contentType = response.headers.get("content-type") || "";
  const buffer = await response.arrayBuffer();

  logger.logUpstreamFetch({ url, statusCode: response.status || "Unknown", fetchTime, success: true });

  return { buffer, contentType, contentLength: buffer.length, upstreamHeaders };
};

const shouldBypassCompression = (contentLength, contentType, isWebp) => {
  if (contentLength < CONFIG.BYPASS_THRESHOLD) return { bypass: true, reason: "already_small" };
  if (!shouldCompress(contentType, contentLength, isWebp)) return { bypass: true, reason: "criteria_not_met" };
  if (!contentType.startsWith("image/")) return { bypass: true, reason: "non-image" };
  return { bypass: false };
};

const handleImageRequest = async (event) => {
  const params = parseQueryParams(event.queryStringParameters);
  if (params.healthCheck) return { statusCode: 200, body: "bandwidth-hero-proxy", headers: getCacheHeaders() };

  const { imageUrl: rawUrl, isWebp, isGrayscale, quality } = params;
  const imageUrl = cleanImageUrl(rawUrl);
  
  if (!imageUrl) {
    throw new Error("Invalid image URL provided");
  }
  
  const urlHash = generateUrlHash(imageUrl);

  const fetchResult = await fetchUpstreamImage(imageUrl, event.headers, event.ip);
  const { buffer, contentType, contentLength, upstreamHeaders } = await processUpstreamResponse(fetchResult, imageUrl);

  logger.logRequest({
    url: imageUrl,
    userAgent: event.headers["user-agent"],
    referer: event.headers["referer"],
    ip: event.ip || event.headers["x-forwarded-for"],
    jpeg: event.queryStringParameters.jpeg,
    bw: event.queryStringParameters.bw,
    quality,
    contentType,
  });

  const bypassCheck = shouldBypassCompression(contentLength, contentType, isWebp);
  if (bypassCheck.bypass) {
    logger.logBypass({ url: imageUrl, size: contentLength, reason: bypassCheck.reason });
    return createImageResponse(buffer, contentType, {
      ...upstreamHeaders,
      "x-bypass-reason": bypassCheck.reason,
      "x-url-hash": urlHash,
    });
  }

  const { err, output, headers: compressHeaders } = await compressImage(
    buffer,
    isWebp,
    isGrayscale,
    quality,
    contentLength
  );

  if (err) {
    logger.logCompressionProcess({ url: imageUrl, originalSize: contentLength, error: err });
    throw err;
  }

  const finalBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  logger.logCompressionProcess({
    url: imageUrl,
    originalSize: contentLength,
    compressedSize: finalBuffer.length,
    bytesSaved: contentLength - finalBuffer.length,
    quality,
    format: compressHeaders?.["content-type"] || (isWebp ? "webp" : "jpeg"),
  });

  return createImageResponse(
    finalBuffer,
    compressHeaders?.["content-type"] || contentType,
    { ...upstreamHeaders, ...compressHeaders, "x-compressed-by": "bandwidth-hero", "x-url-hash": urlHash }
  );
};

// Health check endpoint
app.get("/health", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send("bandwidth-hero-proxy");
});

// Readiness check endpoint
app.get("/ready", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send("ok");
});

// Main proxy endpoint
app.get("/api/index", async (req, res) => {
  const startTime = Date.now();

  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  }, CONFIG.REQUEST_TIMEOUT);

  try {
    const event = {
      queryStringParameters: req.query,
      headers: req.headers,
      ip: req.ip || req.connection.remoteAddress || "unknown",
    };

    const response = await handleImageRequest(event);
    clearTimeout(timeout);

    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      });
    }

    res.status(response.statusCode || 200);
    
    // Send buffer directly for binary data
    if (Buffer.isBuffer(response.body)) {
      res.send(response.body);
    } else {
      res.send(response.body);
    }

    if (NODE_ENV === "production") {
      const duration = Date.now() - startTime;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: "Request completed",
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: event.ip
      }));
    }
  } catch (error) {
    clearTimeout(timeout);

    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message: "Request failed",
      path: req.path,
      error: error.message,
      stack: NODE_ENV === "development" ? error.stack : undefined,
      ip: req.ip || req.connection.remoteAddress
    }));

    if (!res.headersSent) {
      res.status(500).json({
        error: NODE_ENV === "production" ? "Internal server error" : error.message
      });
    }
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Unhandled error",
    error: err.message,
    stack: NODE_ENV === "development" ? err.stack : undefined
  }));

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: NODE_ENV === "production" ? "Internal server error" : err.message
  });
});

// Create HTTP server
const server = createServer(app);

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    message: `Received ${signal}. Starting graceful shutdown...`
  }));

  server.close((err) => {
    if (err) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        message: "Error during server close",
        error: err.message
      }));
      process.exit(1);
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message: "HTTP server closed. Exiting process."
    }));

    setTimeout(() => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "WARN",
        message: "Forced shutdown after timeout"
      }));
      process.exit(1);
    }, 10000);
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Uncaught exception",
    error: err.message,
    stack: err.stack
  }));
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Unhandled rejection",
    reason: reason?.message || reason,
    stack: reason?.stack
  }));
});

// Start server
server.listen(PORT, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    message: "Bandwidth Hero Proxy started",
    port: PORT,
    environment: NODE_ENV,
    health: `http://localhost:${PORT}/health`,
    ready: `http://localhost:${PORT}/ready`,
    api: `http://localhost:${PORT}/api/index`
  }));
});

server.on("error", (err) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Server error",
    error: err.message,
    code: err.code
  }));
});

export default app;
