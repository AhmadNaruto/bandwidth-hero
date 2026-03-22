// Bandwidth Hero Proxy - Main Entry Point (ElysiaJS)
// NOTE: This server should only be run via systemd. Do not run manually.

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import logger from "./utils/logger.js";
import { rateLimitPlugin } from "./middleware/rate-limit.js";
import { loggingPlugin } from "./middleware/logging.js";
import { RequestQueue } from "./middleware/queue.js";
import { healthRoutes } from "./routes/health.js";
import { proxyRoutes } from "./routes/proxy.js";
import { queueStatusRoute } from "./routes/queue.js";

// Guard: Only allow running via systemd in production
const isSystemdManaged =
  process.env.INVOCATION_ID ||
  process.env.JOURNAL_STREAM ||
  process.env.SYSTEMD_EXEC_PID;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !isSystemdManaged) {
  logger.error(
    "Server must be run via systemd in production. Use: sudo systemctl start bandwidth-hero"
  );
  process.exit(1);
}

// Configuration
const CONFIG = {
  PORT: parseInt(process.env.PORT || "8080", 10),
  NODE_ENV: process.env.NODE_ENV || "development",

  // Queue configuration
  QUEUE_ENABLED: true,
  WORKER_COUNT: 3,
  WORKER_MIN_DELAY: 500,
  WORKER_MAX_DELAY: 1000,
  QUEUE_MAX_SIZE: 100,
  QUEUE_TIMEOUT: 120000,

  // Rate limiting
  MAX_CONCURRENT_REQUESTS: 100,
} as const;

// Initialize queue
const requestQueue = new RequestQueue({
  enabled: CONFIG.QUEUE_ENABLED,
  workerCount: CONFIG.WORKER_COUNT,
  workerMinDelay: CONFIG.WORKER_MIN_DELAY,
  workerMaxDelay: CONFIG.WORKER_MAX_DELAY,
  queueMaxSize: CONFIG.QUEUE_MAX_SIZE,
  queueTimeout: CONFIG.QUEUE_TIMEOUT,
});

// Create Elysia app
const app = new Elysia({ name: "bandwidth-hero" })
  // CORS
  .use(
    cors({
      origin: "*",
      credentials: true,
    })
  )

  // Rate limiting / concurrency control
  .use(rateLimitPlugin({ maxConcurrent: CONFIG.MAX_CONCURRENT_REQUESTS }))

  // Request logging
  .use(loggingPlugin())

  // Health check routes
  .use(healthRoutes({
    queue: requestQueue,
    getActiveRequests: (): number => 0, // Will be set by rate-limit plugin
  }))

  // Queue status route
  .use(queueStatusRoute(requestQueue))

  // Main proxy routes
  .use(proxyRoutes({ queue: requestQueue }));

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    await app.stop();
    logger.info("HTTP server closed. Exiting process.");
    process.exit(0);
  } catch (error) {
    logger.error("Error during server close", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Force close after timeout
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });

  const err = error as Error & { code?: string };
  if (err.code === "ECONNRESET" || err.code === "EPIPE") {
    logger.warn("Recoverable error - continuing operation");
    return;
  }

  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

// Start server
const server = app.listen(CONFIG.PORT, () => {
  logger.info("Bandwidth Hero Proxy started", {
    port: CONFIG.PORT,
    environment: CONFIG.NODE_ENV,
    health: `http://localhost:${CONFIG.PORT}/health`,
    ready: `http://localhost:${CONFIG.PORT}/ready`,
    api: `http://localhost:${CONFIG.PORT}/api/index`,
    queueStatus: `http://localhost:${CONFIG.PORT}/queue/status`,
    workerPool: {
      workers: CONFIG.WORKER_COUNT,
      minDelay: `${CONFIG.WORKER_MIN_DELAY}ms`,
      maxDelay: `${CONFIG.WORKER_MAX_DELAY}ms`,
    },
    maxConcurrentRequests: CONFIG.MAX_CONCURRENT_REQUESTS,
  });
});

export default app;
