// Upstream fetch service - fetch images from remote URLs

import logger from "../utils/logger.js";
import type { UpstreamResponse } from "../types/index.js";

interface FetchResult {
  response: {
    ok: boolean;
    status: number;
    headers: Headers;
  };
  fetchTime: number;
  success: boolean;
  buffer: Buffer | null;
}

const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const sanitized = { ...headers };
  delete sanitized["content-encoding"];
  delete sanitized["transfer-encoding"];
  delete sanitized["x-encoded-content-encoding"];
  delete sanitized["cache-control"];
  delete sanitized["expires"];
  delete sanitized["etag"];
  delete sanitized["last-modified"];
  delete sanitized["age"];
  delete sanitized["x-cache"];
  delete sanitized["x-served-by"];
  delete sanitized["x-timer"];
  delete sanitized["via"];
  delete sanitized["server"];
  return sanitized;
};

export async function fetchUpstreamImage(
  url: string,
  headers: Record<string, string>,
  ip: string,
  abortSignal: AbortSignal
): Promise<UpstreamResponse> {
  const fetchStartTime = Date.now();

  const fetchHeaders: Record<string, string> = {
    ...headers,
    "x-forwarded-for": headers["x-forwarded-for"] || ip,
  };

  // Remove hop-by-hop headers
  delete fetchHeaders["host"];
  delete fetchHeaders["connection"];
  delete fetchHeaders["keep-alive"];
  delete fetchHeaders["transfer-encoding"];
  delete fetchHeaders["upgrade"];
  delete fetchHeaders["te"];
  delete fetchHeaders["trailer"];

  logger.debug("Incoming client headers", {
    url,
    clientUserAgent: headers["user-agent"],
    clientReferer: headers["referer"],
    clientAccept: headers["accept"],
    ip,
  });

  // Auto-add Referer if not present
  if (!fetchHeaders["referer"]) {
    try {
      const urlObj = new URL(url);
      fetchHeaders["referer"] = `${urlObj.protocol}//${urlObj.host}/`;
      logger.debug("Auto-added referer header", { url, referer: fetchHeaders["referer"] });
    } catch {
      logger.warn("Failed to add referer header", { url });
    }
  }

  logger.debug("Headers sent to upstream", {
    url,
    userAgent: fetchHeaders["user-agent"],
    referer: fetchHeaders["referer"],
    acceptEncoding: fetchHeaders["accept-encoding"],
  });

  const MAX_RETRIES = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: fetchHeaders,
        signal: abortSignal,
        redirect: "follow",
        cache: "no-store",
      });

      const fetchTime = Date.now() - fetchStartTime;
      const statusCode = response.status;
      const contentType = response.headers.get("content-type") || "";

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Retry on 403/429
      if ((statusCode === 403 || statusCode === 429) && attempt <= MAX_RETRIES) {
        const baseDelay = 2000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const delay = Math.min(6000, baseDelay + jitter);

        logger.debug("Upstream returned 403/429, retrying", {
          url,
          statusCode,
          attempt,
          delay: Math.round(delay),
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      logger.debug("Upstream response", {
        url,
        statusCode,
        contentLength: buffer?.length || 0,
        contentType,
      });

      if (statusCode === 403) {
        logger.warn("Upstream returned 403 Forbidden after retries", {
          url,
          userAgent: fetchHeaders["user-agent"],
          referer: fetchHeaders["referer"],
        });
      }

      const upstreamHeaders = sanitizeHeaders(
        Object.fromEntries(response.headers.entries())
      );

      return {
        buffer,
        contentType,
        contentLength: buffer.length,
        upstreamHeaders,
      };
    } catch (error) {
      lastError = error;

      const err = error as Error & { code?: string };
      if (
        attempt <= MAX_RETRIES &&
        (err.code === "ETIMEDOUT" ||
          err.code === "ECONNRESET" ||
          err.name === "AbortError")
      ) {
        const baseDelay = 2000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const delay = Math.min(6000, baseDelay + jitter);

        logger.debug("Upstream network error, retrying", {
          url,
          error: err.code || err.name,
          attempt,
          delay: Math.round(delay),
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      break;
    }
  }

  const fetchTime = Date.now() - fetchStartTime;
  const errorMessage =
    lastError instanceof Error ? lastError.message : String(lastError);

  logger.error("Upstream fetch error after retries", {
    url,
    error: errorMessage,
    attempts: MAX_RETRIES + 1,
  });

  throw new Error(`Upstream fetch failed: ${errorMessage}`);
}

export default fetchUpstreamImage;
