// server.js - Production-ready Express server for VPS deployment
// REFACTORED: Memory-safe, stable for 24/7 operation
import express from "express";
import { createServer, Agent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
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
  
  // Connection pooling limits - prevent socket exhaustion
  HTTP_MAX_SOCKETS: 50,
  HTTP_MAX_FREE_SOCKETS: 10,
  HTTP_TIMEOUT: 30000,
  
  // Concurrency limits - prevent memory overload
  MAX_CONCURRENT_REQUESTS: 100,
  
  // Memory monitoring
  MEMORY_CHECK_INTERVAL: 30000, // Check every 30s
  MEMORY_THRESHOLD_PERCENT: 0.85, // Reject new requests at 85% memory
  MEMORY_CIRCUIT_BREAKER_COOLDOWN: 60000, // 1min cooldown when triggered
};

// HTTP/HTTPS Agents with connection pooling limits
const httpAgent = new Agent({
  keepAlive: true,
  maxSockets: CONFIG.HTTP_MAX_SOCKETS,
  maxFreeSockets: CONFIG.HTTP_MAX_FREE_SOCKETS,
  timeout: CONFIG.HTTP_TIMEOUT,
  scheduleTimeout: true,
});

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  maxSockets: CONFIG.HTTP_MAX_SOCKETS,
  maxFreeSockets: CONFIG.HTTP_MAX_FREE_SOCKETS,
  timeout: CONFIG.HTTP_TIMEOUT,
  scheduleTimeout: true,
  rejectUnauthorized: true,
});

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
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  });
  next();
});

// Memory monitoring and circuit breaker
let memoryCircuitBreaker = false;
let memoryCircuitBreakerUntil = 0;
let memoryCheckCount = 0;

const checkMemoryHealth = () => {
  const memUsage = process.memoryUsage();
  const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;
  
  // Skip first few checks to allow Node.js V8 to stabilize
  memoryCheckCount++;
  if (memoryCheckCount < 5) {
    return true;
  }

  if (memoryCircuitBreaker && Date.now() > memoryCircuitBreakerUntil) {
    memoryCircuitBreaker = false;
    logger.warn("Memory circuit breaker reset", { heapUsedPercent: (heapUsedPercent * 100).toFixed(2) });
  }

  if (!memoryCircuitBreaker && heapUsedPercent > CONFIG.MEMORY_THRESHOLD_PERCENT) {
    memoryCircuitBreaker = true;
    memoryCircuitBreakerUntil = Date.now() + CONFIG.MEMORY_CIRCUIT_BREAKER_COOLDOWN;
    logger.error("Memory circuit breaker triggered", {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsedPercent: (heapUsedPercent * 100).toFixed(2),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    });
  }

  return !memoryCircuitBreaker;
};

// Periodic memory health check
setInterval(() => {
  const memUsage = process.memoryUsage();
  logger.debug("Memory status", {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsedPercent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2),
    rss: Math.round(memUsage.rss / 1024 / 1024),
    circuitBreaker: memoryCircuitBreaker,
  });
}, CONFIG.MEMORY_CHECK_INTERVAL);

// Concurrency tracking
let activeRequests = 0;

// Rate limiting middleware
app.use((req, res, next) => {
  // Check memory circuit breaker
  if (!checkMemoryHealth()) {
    logger.warn("Request rejected - memory circuit breaker active", { path: req.path });
    return res.status(503).json({ error: "Service temporarily unavailable - memory pressure" });
  }
  
  // Check concurrent request limit
  if (activeRequests >= CONFIG.MAX_CONCURRENT_REQUESTS) {
    logger.warn("Request rejected - max concurrent requests reached", { 
      activeRequests, 
      limit: CONFIG.MAX_CONCURRENT_REQUESTS 
    });
    return res.status(503).json({ error: "Service temporarily unavailable - too many requests" });
  }
  
  activeRequests++;
  res.on("finish", () => {
    activeRequests--;
  });
  res.on("close", () => {
    activeRequests--;
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

const cleanImageUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url.trim()).href;
  } catch {
    return null;
  }
};

const generateUrlHash = (url) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);

// Configure got with proper agents and limits
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
  http2: false, // Disable HTTP/2 to avoid :status header issues and connection leaks
  https: {
    rejectUnauthorized: true,
  },
  agent: {
    http: httpAgent,
    https: httpsAgent,
  },
});

const fetchUpstreamImage = async (url, headers, ip, abortSignal) => {
  const fetchStartTime = Date.now();
  const fetchHeaders = {
    ...pick(headers, CONFIG.FETCH_HEADERS_TO_PICK),
    "x-forwarded-for": headers["x-forwarded-for"] || ip,
    ...(headers["accept-encoding"] === "identity" && { "accept-encoding": "identity" }),
  };

  try {
    const response = await fetchWithRetry(url, { 
      headers: fetchHeaders, 
      responseType: "buffer",
      signal: abortSignal,
    });
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
    if (error.name === "AbortError") {
      logger.debug("Upstream fetch aborted", { url });
    } else {
      logger.error("Upstream fetch error", { url, error: error.message });
    }
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

const handleImageRequest = async (event, abortSignal) => {
  const params = parseQueryParams(event.queryStringParameters);
  if (params.healthCheck) return { statusCode: 200, body: "bandwidth-hero-proxy", headers: getCacheHeaders() };

  const { imageUrl: rawUrl, isWebp, isGrayscale, quality } = params;
  const imageUrl = cleanImageUrl(rawUrl);

  if (!imageUrl) {
    throw new Error("Invalid image URL provided");
  }

  const urlHash = generateUrlHash(imageUrl);

  const fetchResult = await fetchUpstreamImage(imageUrl, event.headers, event.ip, abortSignal);
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

// Readiness check endpoint (includes memory health)
app.get("/ready", (req, res) => {
  const isHealthy = checkMemoryHealth();
  res.set("Content-Type", "text/plain");
  if (isHealthy) {
    res.send("ok");
  } else {
    res.status(503).send("unavailable");
  }
});

// Main proxy endpoint
app.get("/api/index", async (req, res) => {
  const startTime = Date.now();
  const abortController = new AbortController();
  let timeoutId = null;

  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      abortController.abort();
      res.status(408).json({ error: "Request timeout" });
    }
  }, CONFIG.REQUEST_TIMEOUT);

  try {
    const event = {
      queryStringParameters: req.query,
      headers: req.headers,
      ip: req.ip || req.connection.remoteAddress || "unknown",
    };

    const response = await handleImageRequest(event, abortController.signal);
    
    // Clear timeout immediately after successful processing
    if (timeout) {
      clearTimeout(timeout);
      timeoutId = null;
    }

    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        // Skip HTTP/2 pseudo-headers (:status, :method, etc.) and undefined values
        if (value !== undefined && !key.startsWith(":")) {
          res.setHeader(key, value);
        }
      });
    }

    res.status(response.statusCode || 200);
    res.send(response.body);

    if (NODE_ENV === "production") {
      const duration = Date.now() - startTime;
      logger.info("Request completed", {
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: event.ip
      });
    }
  } catch (error) {
    // Ensure timeout is cleared on error
    if (timeout) {
      clearTimeout(timeout);
      timeoutId = null;
    }
    
    // Abort any pending operations
    if (!abortController.signal.aborted) {
      abortController.abort();
    }

    logger.error("Request failed", {
      path: req.path,
      error: error.message,
      stack: NODE_ENV === "development" ? error.stack : undefined,
      ip: req.ip || req.connection.remoteAddress
    });

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
  logger.error("Unhandled error", {
    error: err.message,
    stack: NODE_ENV === "development" ? err.stack : undefined
  });

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
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      logger.error("Error during server close", { error: err.message });
      process.exit(1);
    }

    logger.info("HTTP server closed. Exiting process.");

    // Force close after timeout
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  });
  
  // Close HTTP agents to release sockets
  httpAgent.destroy();
  httpsAgent.destroy();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", {
    error: err.message,
    stack: err.stack
  });
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
});

// Start server
server.listen(PORT, () => {
  logger.info("Bandwidth Hero Proxy started", {
    port: PORT,
    environment: NODE_ENV,
    health: `http://localhost:${PORT}/health`,
    ready: `http://localhost:${PORT}/ready`,
    api: `http://localhost:${PORT}/api/index`,
    maxConcurrentRequests: CONFIG.MAX_CONCURRENT_REQUESTS,
    memoryThreshold: `${CONFIG.MEMORY_THRESHOLD_PERCENT * 100}%`,
  });
});

server.on("error", (err) => {
  logger.error("Server error", {
    error: err.message,
    code: err.code
  });
});

// Log memory stats periodically in production
if (NODE_ENV === "production") {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    logger.info("Memory stats", {
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsedPercent: `${((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2)}%`,
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      activeRequests,
    });
  }, 60000); // Every minute
}

export default app;
