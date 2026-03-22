// server.js - Production-ready Express server for VPS deployment
// REFACTORED: Memory-safe, stable for 24/7 operation
import express from "express";
import { createServer, Agent } from "http";
import { Agent as HttpsAgent } from "https";
import compression from "compression";
import crypto from "crypto";
import wretch from "wretch";
import QueryStringAddon from "wretch/addons/queryString";
import AbortAddon from "wretch/addons/abort";
import rateLimit from "express-rate-limit";
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
  FETCH_HEADERS_TO_PICK: ["cookie", "dnt", "referer", "user-agent", "accept", "accept-language", "origin"],
  REQUEST_TIMEOUT: 60000,
  MAX_REQUEST_SIZE: "10mb",

  // Default User-Agent for all upstream requests (Android browser to avoid 403)
  DEFAULT_USER_AGENT: "Mozilla/5.0 (Linux; U; Android 13; zh-CN; PFDM00 Build/TP1A.220905.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0.6312.80 UCBrowser/18.2.6.1452 Mobile Safari/537.36",

  // Site-specific referer rules for hotlink protection
  // Some manga sites require specific referer headers
  REFERER_RULES: {
    "westmanga.blog": "https://westmanga.blog/",
    "wp.com": "https://mangadex.org/",
    "imgur.com": "https://imgur.com/",
    "blogspot.com": "https://www.blogspot.com/",
  },

  // Increased timeout for large manga images (up to 1MB)
  COMPRESSION_TIMEOUT: 60000, // 60 seconds for large images
  
  // Connection pooling limits - prevent socket exhaustion
  HTTP_MAX_SOCKETS: 50,
  HTTP_MAX_FREE_SOCKETS: 10,
  HTTP_TIMEOUT: 30000,

  // Concurrency limits - prevent memory overload
  MAX_CONCURRENT_REQUESTS: 100,

  // Rate limiting - prevent abuse
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 30, // 30 requests per minute per IP

  // Memory monitoring - relaxed for manga/webtoon image processing
  MEMORY_CHECK_INTERVAL: 30000, // Check every 30s
  MEMORY_CIRCUIT_BREAKER_COOLDOWN: 60000, // 1min cooldown when triggered
  MEMORY_THRESHOLD_PERCENT: 0.9, // 90% memory threshold for circuit breaker

  // Upstream circuit breaker - prevent cascading failures
  UPSTREAM_FAILURE_THRESHOLD: 5, // failures before opening circuit
  UPSTREAM_CIRCUIT_BREAKER_TIMEOUT: 30000, // 30s before half-open

  // Request queue - worker pool for upstream requests
  QUEUE_ENABLED: true,
  WORKER_COUNT: 3, // Number of concurrent workers
  WORKER_MIN_DELAY: 500, // Minimum delay between requests per worker (ms)
  WORKER_MAX_DELAY: 1000, // Maximum delay between requests per worker (ms)
  QUEUE_MAX_SIZE: 100, // Maximum queue size
  QUEUE_TIMEOUT: 120000, // Maximum time a request can wait in queue (ms)
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

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
  max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
  message: JSON.stringify({ error: "Too many requests, please try again later" }),
  standardHeaders: true,
  legacyHeaders: false,
  // Use the built-in ipKeyGenerator helper for proper IPv6 support
  keyGenerator: rateLimit.ipKeyGenerator,
});
app.use("/api/", limiter);

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
// DISABLED: Circuit breaker disabled per user request
let memoryCircuitBreaker = false;
let memoryCircuitBreakerUntil = 0;
let memoryCheckCount = 0;
let baselineHeapUsed = 0;

const checkMemoryHealth = () => {
  // Circuit breaker disabled - always return true
  return true;
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

// Periodic queue metrics reset (prevent overflow, reset hourly)
setInterval(() => {
  const busyWorkers = workers.filter(w => w.busy).length;
  const totalWorkerProcessed = workers.reduce((sum, w) => sum + w.requestsProcessed, 0);
  
  // Log hourly metrics summary
  logger.info("Queue metrics summary", {
    processed: queueMetrics.totalProcessed,
    timeouts: queueMetrics.totalTimeouts,
    aborted: queueMetrics.totalAborted,
    rejected: queueMetrics.totalRejected,
    avgWaitTime: queueMetrics.averageWaitTime,
    maxWaitTime: queueMetrics.maxWaitTime,
    workers: {
      busy: busyWorkers,
      totalProcessed: totalWorkerProcessed,
    },
  });

  // Reset counters (keep max for historical reference)
  queueMetrics.totalProcessed = 0;
  queueMetrics.totalTimeouts = 0;
  queueMetrics.totalAborted = 0;
  queueMetrics.totalRejected = 0;
  queueMetrics.averageWaitTime = 0;
  queueMetrics.lastWaitTime = 0;
  // Keep maxWaitTime for reference, reset after 24 hours
}, 3600000); // Every hour

// Periodic socket pool monitoring
setInterval(() => {
  logger.trace("Socket pool status", {
    http: {
      sockets: httpAgent.sockets?.length || 0,
      freeSockets: httpAgent.freeSockets?.length || 0,
    },
    https: {
      sockets: httpsAgent.sockets?.length || 0,
      freeSockets: httpsAgent.freeSockets?.length || 0,
    },
  });
}, 60000); // Every minute

// Request ID counter for tracing
let requestIdCounter = 0;

// Concurrency tracking
let activeRequests = 0;

// Upstream circuit breaker state
let upstreamFailureCount = 0;
let upstreamCircuitBreakerOpen = false;
let upstreamCircuitBreakerResetTime = 0;

// Request queue for worker pool
const requestQueue = [];

// Worker pool - 3 concurrent workers
const workers = [];
for (let i = 0; i < CONFIG.WORKER_COUNT; i++) {
  workers.push({
    id: i,
    busy: false,
    lastRequestTime: 0,
    requestsProcessed: 0,
  });
}

// Queue metrics for monitoring
const queueMetrics = {
  totalProcessed: 0,
  totalTimeouts: 0,
  totalAborted: 0,
  totalRejected: 0,
  averageWaitTime: 0,
  lastWaitTime: 0,
  maxWaitTime: 0,
};

// Add request to queue and assign to available worker
const enqueueUpstreamRequest = (abortSignal) => {
  return new Promise((resolve, reject) => {
    if (!CONFIG.QUEUE_ENABLED) {
      resolve();
      return;
    }

    // Check queue size limit
    if (requestQueue.length >= CONFIG.QUEUE_MAX_SIZE) {
      queueMetrics.totalRejected++;
      logger.warn("Request rejected - queue full", { queueSize: requestQueue.length });
      return reject(new Error("Queue full - too many requests"));
    }

    const queueEntry = {
      resolve,
      reject,
      addedAt: Date.now(),
      abortSignal,
    };

    // Check for queue timeout
    const timeoutCheck = setTimeout(() => {
      const index = requestQueue.indexOf(queueEntry);
      if (index > -1) {
        requestQueue.splice(index, 1);
        queueMetrics.totalTimeouts++;
        const waitTime = Date.now() - queueEntry.addedAt;
        logger.warn("Request timeout in queue", { waitTime });
        reject(new Error("Queue timeout - request took too long"));
      }
    }, CONFIG.QUEUE_TIMEOUT);

    // Store timeout ID to clear later
    queueEntry.timeoutId = timeoutCheck;

    requestQueue.push(queueEntry);
    const position = requestQueue.length;
    logger.trace("Request added to queue", { position, queueSize: requestQueue.length });

    // Try to assign to available worker
    assignToWorker();
  });
};

// Find available worker
const findAvailableWorker = () => {
  return workers.find(worker => !worker.busy);
};

// Assign queue entry to worker
const assignToWorker = async () => {
  if (requestQueue.length === 0) return;

  const worker = findAvailableWorker();
  if (!worker) return; // No available workers

  const entry = requestQueue[0];

  // Check if request was aborted
  if (entry.abortSignal?.aborted) {
    requestQueue.shift();
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    queueMetrics.totalAborted++;
    entry.reject(new Error("Request aborted"));
    return;
  }

  // Check if queue timeout exceeded
  const waitTime = Date.now() - entry.addedAt;
  if (waitTime >= CONFIG.QUEUE_TIMEOUT) {
    requestQueue.shift();
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    queueMetrics.totalTimeouts++;
    entry.reject(new Error("Queue timeout"));
    return;
  }

  // Calculate delay since last request for this worker
  const timeSinceLastRequest = Date.now() - worker.lastRequestTime;
  const minDelay = CONFIG.WORKER_MIN_DELAY;
  const maxDelay = CONFIG.WORKER_MAX_DELAY;
  const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

  if (timeSinceLastRequest < randomDelay) {
    const sleepTime = randomDelay - timeSinceLastRequest;
    logger.trace("Worker waiting", { workerId: worker.id, sleepTime });
    await new Promise(resolve => setTimeout(resolve, sleepTime));
  }

  // Remove from queue and mark worker busy
  requestQueue.shift();
  if (entry.timeoutId) clearTimeout(entry.timeoutId);

  worker.busy = true;
  worker.lastRequestTime = Date.now();

  // Update metrics
  const actualWaitTime = Date.now() - entry.addedAt;
  queueMetrics.totalProcessed++;
  queueMetrics.lastWaitTime = actualWaitTime;
  queueMetrics.maxWaitTime = Math.max(queueMetrics.maxWaitTime, actualWaitTime);
  // Calculate rolling average (simple moving average)
  queueMetrics.averageWaitTime = Math.round(
    (queueMetrics.averageWaitTime * (queueMetrics.totalProcessed - 1) + actualWaitTime) / queueMetrics.totalProcessed
  );

  logger.trace("Worker assigned", { workerId: worker.id, queueRemaining: requestQueue.length });

  // Resolve and mark worker as available after delay
  entry.resolve();

  // Mark worker as available after a brief period (allow upstream request to complete)
  setTimeout(() => {
    worker.busy = false;
    worker.requestsProcessed++;
    logger.trace("Worker released", { workerId: worker.id, processed: worker.requestsProcessed });
    // Try to assign next request in queue
    assignToWorker();
  }, 100); // Brief delay to allow upstream request to start

  // Try to assign more requests to other workers
  assignToWorker();
};

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
  let decremented = false;
  const decrement = () => {
    if (!decremented) {
      decremented = true;
      activeRequests--;
      // Ensure activeRequests never goes negative
      if (activeRequests < 0) activeRequests = 0;
    }
  };
  
  res.once("finish", decrement);
  res.once("close", decrement);

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

  // Support both 'jpeg' and 'jpg' as parameter name (for compatibility)
  const jpegParam = queryParams.jpeg ?? queryParams.jpg;
  const { url: imageUrl, bw: grayscaleParam, l: qualityParam } = queryParams;

  if (!imageUrl) return { healthCheck: true };

  return {
    imageUrl,
    isWebp: !parseInt(jpegParam, 10), // jpeg=1 → isWebp=false → JPEG; jpeg=0 → isWebp=true → AVIF
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

// Configure wretch with addons
const api = wretch()
  .addon(QueryStringAddon)
  .addon(AbortAddon())
  .options({
    cache: 'no-store',
    redirect: 'follow',
  });

const fetchUpstreamImage = async (url, headers, ip, abortSignal) => {
  const fetchStartTime = Date.now();

  // Wait in queue for upstream request turn
  if (CONFIG.QUEUE_ENABLED) {
    const queueStartTime = Date.now();
    try {
      await enqueueUpstreamRequest(abortSignal);
      const queueWaitTime = Date.now() - queueStartTime;
      if (queueWaitTime > 100) {
        logger.debug("Request waited in queue", { url, waitTime: queueWaitTime });
      }
    } catch (queueError) {
      logger.warn("Queue request failed", { url, error: queueError.message });
      return {
        response: { status: 503, headers: { get: () => null, entries: () => [] } },
        fetchTime: Date.now() - fetchStartTime,
        success: false,
        queueError: true,
      };
    }
  }

  // Check upstream circuit breaker
  if (upstreamCircuitBreakerOpen) {
    if (Date.now() < upstreamCircuitBreakerResetTime) {
      logger.warn("Upstream circuit breaker open, rejecting request", { url });
      return {
        response: { status: 503, headers: { get: () => null, entries: () => [] } },
        fetchTime: Date.now() - fetchStartTime,
        success: false,
        circuitBreaker: true,
      };
    } else {
      // Half-open state - allow one request to test
      upstreamCircuitBreakerOpen = false;
      logger.info("Upstream circuit breaker half-open, testing", { url });
    }
  }

  // Pick headers from client request
  const fetchHeaders = {
    ...pick(headers, CONFIG.FETCH_HEADERS_TO_PICK),
    "x-forwarded-for": headers["x-forwarded-for"] || ip,
    // Always forward accept-encoding from client (important for Cloudflare/CDN)
    "accept-encoding": headers["accept-encoding"] || "gzip, deflate, br",
  };

  // Always use default User-Agent to avoid 403 from upstream servers
  fetchHeaders["user-agent"] = CONFIG.DEFAULT_USER_AGENT;

  // DEBUG: Log incoming headers from client
  logger.debug("Incoming client headers", {
    url,
    clientUserAgent: headers["user-agent"],
    clientReferer: headers["referer"],
    clientAccept: headers["accept"],
    ip,
  });

  // Auto-add Referer header if not present (for hotlink protection)
  // Many manga sites require referer from their own domain
  if (!fetchHeaders["referer"]) {
    try {
      const urlObj = new URL(url);
      const host = urlObj.host;

      // Check for site-specific referer rules first
      let referer = null;
      for (const [domain, ref] of Object.entries(CONFIG.REFERER_RULES)) {
        if (host.includes(domain)) {
          referer = ref;
          break;
        }
      }

      // Fall back to auto-generated referer if no rule found
      if (!referer) {
        referer = `${urlObj.protocol}//${urlObj.host}/`;
      }

      fetchHeaders["referer"] = referer;
      logger.debug("Auto-added referer header", { url, referer, host });
    } catch (e) {
      // Ignore invalid URLs
      logger.warn("Failed to add referer header", { url, error: e.message });
    }
  }

  // DEBUG: Log headers being sent to upstream
  logger.debug("Headers sent to upstream", {
    url,
    userAgent: fetchHeaders["user-agent"],
    referer: fetchHeaders["referer"],
    acceptEncoding: fetchHeaders["accept-encoding"],
  });

  // Add sec-fetch headers if referer exists (mimics browser behavior)
  if (fetchHeaders["referer"]) {
    const refererUrl = new URL(fetchHeaders["referer"]);
    fetchHeaders["sec-fetch-site"] = refererUrl.origin === new URL(url).origin ? "same-origin" : "cross-site";
    fetchHeaders["sec-fetch-mode"] = "no-cors";
    fetchHeaders["sec-fetch-dest"] = "image";
  }

  // Retry logic with exponential backoff for 403/429 errors
  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      // Use wretch to fetch image
      const response = await api
        .url(url)
        .headers(fetchHeaders)
        .signal(abortSignal)
        .get()
        .res();

      const fetchTime = Date.now() - fetchStartTime;
      const statusCode = response.status;
      const contentType = response.headers.get('content-type') || '';
      
      // Get array buffer from response
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // If 403/429 and we have retries left, wait and retry
      if ((statusCode === 403 || statusCode === 429) && attempt <= MAX_RETRIES) {
        const baseDelay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s
        const jitter = Math.random() * 1000;
        const delay = Math.min(6000, baseDelay + jitter);

        logger.debug("Upstream returned 403/429, retrying", {
          url,
          statusCode,
          attempt,
          delay: Math.round(delay),
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Log response status for debugging
      logger.debug("Upstream response", {
        url,
        statusCode,
        contentLength: buffer?.length || 0,
        contentType,
      });

      // Log 403 errors specifically
      if (statusCode === 403) {
        logger.warn("Upstream returned 403 Forbidden after retries", {
          url,
          userAgent: fetchHeaders["user-agent"],
          referer: fetchHeaders["referer"],
          acceptEncoding: fetchHeaders["accept-encoding"],
        });
      }

      // Reset failure count on success
      if (upstreamFailureCount > 0 && statusCode >= 200 && statusCode < 300) {
        upstreamFailureCount = 0;
        logger.debug("Upstream circuit breaker failure count reset", { url });
      }

      return {
        response: {
          ok: statusCode >= 200 && statusCode < 300,
          status: statusCode,
          headers: {
            get: (name) => response.headers.get(name) || null,
            entries: () => Array.from(response.headers.entries()),
          },
          arrayBuffer: async () => buffer,
        },
        fetchTime,
        success: statusCode >= 200 && statusCode < 300,
        buffer,
      };
    } catch (error) {
      lastError = error;

      // Retry on network errors with exponential backoff
      if (attempt <= MAX_RETRIES && (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.name === 'AbortError')) {
        const baseDelay = 2000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const delay = Math.min(6000, baseDelay + jitter);

        logger.debug("Upstream network error, retrying", {
          url,
          error: error.code || error.name,
          attempt,
          delay: Math.round(delay),
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // No more retries or non-retryable error
      break;
    }
  }

  // All retries failed or non-retryable error
  const fetchTime = Date.now() - fetchStartTime;

  // Increment failure count
  upstreamFailureCount++;
  const errorMessage = lastError?.message || lastError?.code || 'Unknown error';
  const errorStatusCode = lastError?.status || 500;

  logger.error("Upstream fetch error after retries", {
    url,
    error: errorMessage,
    statusCode: errorStatusCode,
    failureCount: upstreamFailureCount,
    attempts: MAX_RETRIES + 1,
  });

  // Log 403 errors specifically for debugging
  if (lastError?.status === 403 || errorStatusCode === 403) {
    logger.warn("Upstream returned 403 Forbidden after all retries", {
      url,
      referer: fetchHeaders["referer"],
      acceptEncoding: fetchHeaders["accept-encoding"],
      failureCount: upstreamFailureCount,
    });
  }

  // Open circuit breaker if threshold reached
  if (upstreamFailureCount >= CONFIG.UPSTREAM_FAILURE_THRESHOLD) {
    upstreamCircuitBreakerOpen = true;
    upstreamCircuitBreakerResetTime = Date.now() + CONFIG.UPSTREAM_CIRCUIT_BREAKER_TIMEOUT;
    logger.warn("Upstream circuit breaker opened", {
      url,
      failureCount: upstreamFailureCount,
      resetIn: CONFIG.UPSTREAM_CIRCUIT_BREAKER_TIMEOUT,
    });
  }

  if (lastError?.name === "AbortError") {
    logger.debug("Upstream fetch aborted", { url });
  }

  return {
    response: {
      status: errorStatusCode,
      headers: { get: () => null, entries: () => [] },
    },
    fetchTime,
    success: false,
    buffer: null,
  };
};

const processUpstreamResponse = async (fetchResult, url) => {
  const { response, success, fetchTime, buffer: fetchedBuffer } = fetchResult;

  if (!success) {
    logger.logUpstreamFetch({ url, statusCode: response.status || "Unknown", fetchTime, success: false });
    throw new Error(`Upstream fetch failed with status: ${response.status}`);
  }

  const upstreamHeaders = Object.fromEntries(response.headers.entries());
  delete upstreamHeaders["content-encoding"];
  delete upstreamHeaders["transfer-encoding"];
  delete upstreamHeaders["x-encoded-content-encoding"];

  const contentType = response.headers.get("content-type") || "";
  const buffer = fetchedBuffer || await response.arrayBuffer();

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
    format: compressHeaders?.["content-type"] || (isWebp ? "image/avif" : "image/jpeg"),
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

// Queue status endpoint
app.get("/queue/status", (req, res) => {
  res.set("Content-Type", "application/json");
  res.json({
    queue: {
      size: requestQueue.length,
    },
    workers: workers.map(w => ({
      id: w.id,
      busy: w.busy,
      requestsProcessed: w.requestsProcessed,
    })),
    limits: {
      workerCount: CONFIG.WORKER_COUNT,
      minDelay: CONFIG.WORKER_MIN_DELAY,
      maxDelay: CONFIG.WORKER_MAX_DELAY,
      maxSize: CONFIG.QUEUE_MAX_SIZE,
      timeout: CONFIG.QUEUE_TIMEOUT,
    },
    metrics: { ...queueMetrics },
    enabled: CONFIG.QUEUE_ENABLED,
  });
});

// Comprehensive health check endpoint
app.get("/health/detailed", (req, res) => {
  const memUsage = process.memoryUsage();
  const busyWorkers = workers.filter(w => w.busy).length;
  const health = {
    status: "ok",
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    queue: {
      size: requestQueue.length,
      workers: {
        total: CONFIG.WORKER_COUNT,
        busy: busyWorkers,
        available: CONFIG.WORKER_COUNT - busyWorkers,
      },
      metrics: { ...queueMetrics },
    },
    activeRequests,
    memoryCircuitBreaker,
    upstreamCircuitBreaker: upstreamCircuitBreakerOpen,
    timestamp: new Date().toISOString(),
  };

  // Determine health status
  const isRssCritical = health.memory.rss > 1536;
  const isHeapCritical = health.memory.heapUsed > 1024;
  const isQueueFull = requestQueue.length >= CONFIG.QUEUE_MAX_SIZE;

  if (isRssCritical || isHeapCritical || memoryCircuitBreaker) {
    health.status = "degraded";
    res.status(503);
  } else if (isQueueFull) {
    health.status = "busy";
    res.status(429);
  }

  res.set("Content-Type", "application/json");
  res.json(health);
});

// Main proxy endpoint
app.get("/api/index", async (req, res) => {
  const startTime = Date.now();
  const abortController = new AbortController();

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
    clearTimeout(timeout);

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
    clearTimeout(timeout);

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

// Prevent memory leak warnings - set high enough for concurrent requests
server.setMaxListeners(200);
process.setMaxListeners(200);

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

    // Clear queue - reject all pending requests
    while (requestQueue.length > 0) {
      const entry = requestQueue.shift();
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      entry.reject(new Error("Server shutting down"));
    }

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
  // Don't exit immediately - try to recover
  // Only exit if error is fatal (e.g., memory exhaustion)
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
    logger.warn("Recoverable error - continuing operation");
    return;
  }
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
  // Don't exit on unhandled rejections - log and continue
  // This prevents crashes from non-critical async errors
});

// Start server
server.listen(PORT, () => {
  logger.info("Bandwidth Hero Proxy started", {
    port: PORT,
    environment: NODE_ENV,
    health: `http://localhost:${PORT}/health`,
    ready: `http://localhost:${PORT}/ready`,
    api: `http://localhost:${PORT}/api/index`,
    queueStatus: `http://localhost:${PORT}/queue/status`,
    workerPool: {
      workers: CONFIG.WORKER_COUNT,
      minDelay: `${CONFIG.WORKER_MIN_DELAY}ms`,
      maxDelay: `${CONFIG.WORKER_MAX_DELAY}ms`,
    },
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
