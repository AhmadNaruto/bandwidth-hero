// Health check routes

import { Elysia } from "elysia";
import type { RequestQueue } from "../middleware/queue.js";

interface HealthOptions {
  queue: RequestQueue;
  getActiveRequests: () => number;
}

export interface HealthStatus {
  status: "ok" | "busy";
  uptime: number;
  queue: {
    size: number;
    workers: {
      total: number;
      busy: number;
      available: number;
    };
    metrics: Record<string, number>;
  };
  activeRequests: number;
  timestamp: string;
}

export function healthRoutes(options: HealthOptions) {
  return new Elysia()
    .get("/health", "bandwidth-hero-proxy")
    .get("/ready", "ok")
    .get("/health/detailed", ({ set }): HealthStatus => {
      const queueStatus = options.queue.getStatus();
      const busyWorkers = queueStatus.workers.filter((w) => w.busy).length;

      const health: HealthStatus = {
        status: "ok",
        uptime: process.uptime(),
        queue: {
          size: queueStatus.queue.size,
          workers: {
            total: options.queue["options"].workerCount,
            busy: busyWorkers,
            available: options.queue["options"].workerCount - busyWorkers,
          },
          metrics: queueStatus.metrics,
        },
        activeRequests: options.getActiveRequests(),
        timestamp: new Date().toISOString(),
      };

      const isQueueFull = queueStatus.queue.size >= options.queue["options"].queueMaxSize;

      if (isQueueFull) {
        health.status = "busy";
        set.status = 429;
      }

      return health;
    });
}

export default healthRoutes;
