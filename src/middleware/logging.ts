// Request logging middleware

import { Elysia } from "elysia";
import logger from "../utils/logger.js";

export function loggingPlugin() {
  return new Elysia({ name: "logging" })
    .onRequest(({ request }) => {
      const url = new URL(request.url);
      logger.debug("Request started", {
        method: request.method,
        path: url.pathname,
        url: request.url,
      });
    })
    .onAfterHandle(({ request, response, set }) => {
      const url = new URL(request.url);
      logger.info("Request completed", {
        path: url.pathname,
        method: request.method,
        statusCode: set.status || 200,
      });
    })
    .onError(({ request, error, set }) => {
      const url = new URL(request.url);
      logger.error("Request failed", {
        path: url.pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        statusCode: set.status || 500,
      });
    });
}

export default loggingPlugin;
