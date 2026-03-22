// Rate limiting middleware - concurrency control

import { Elysia } from "elysia";
import logger from "../utils/logger.js";

interface RateLimitOptions {
  maxConcurrent: number;
}

export function rateLimitPlugin(options: RateLimitOptions = { maxConcurrent: 100 }) {
  let activeRequests = 0;

  return new Elysia({ name: "rate-limit" })
    .onRequest(({ set }) => {
      if (activeRequests >= options.maxConcurrent) {
        logger.warn("Request rejected - max concurrent requests reached", {
          activeRequests,
          limit: options.maxConcurrent,
        });
        set.status = 503;
        return {
          error: "Service temporarily unavailable - too many requests",
        };
      }
      activeRequests++;
    })
    .onAfterHandle(() => {
      activeRequests--;
      if (activeRequests < 0) activeRequests = 0;
    })
    .onError(() => {
      activeRequests--;
      if (activeRequests < 0) activeRequests = 0;
    })
    .decorate("getActiveRequests", () => activeRequests);
}

export default rateLimitPlugin;
