// Request logging middleware

import { Elysia } from "elysia";
import logger, { addLogToBuffer } from "../utils/logger.js";

export function loggingPlugin() {
  return new Elysia({ name: "logging" })
    .onRequest(({ request }) => {
      const url = new URL(request.url);
      const log = {
        timestamp: new Date().toISOString(),
        level: "DEBUG" as const,
        message: "Request started",
        method: request.method,
        path: url.pathname,
        url: request.url,
      };
      addLogToBuffer(log);
      logger.debug("Request started", {
        method: request.method,
        path: url.pathname,
        url: request.url,
      });
    })
    .onAfterHandle(({ request, set }) => {
      const url = new URL(request.url);
      const log = {
        timestamp: new Date().toISOString(),
        level: "INFO" as const,
        message: "Request completed",
        path: url.pathname,
        method: request.method,
        statusCode: set.status || 200,
      };
      addLogToBuffer(log);
      logger.info("Request completed", {
        path: url.pathname,
        method: request.method,
        statusCode: set.status || 200,
      });
    })
    .onError(({ request, error, set }) => {
      const url = new URL(request.url);
      const log = {
        timestamp: new Date().toISOString(),
        level: "ERROR" as const,
        message: "Request failed",
        path: url.pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        statusCode: set.status || 500,
      };
      addLogToBuffer(log);
      logger.error("Request failed", {
        path: url.pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        statusCode: set.status || 500,
      });
    });
}

export default loggingPlugin;
