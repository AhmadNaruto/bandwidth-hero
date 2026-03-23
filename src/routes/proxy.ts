// Main proxy route - /api/index

import { Elysia, t } from "elysia";
import crypto from "crypto";
import logger from "../utils/logger.js";
import shouldCompress from "../utils/should-compress.js";
import { compressImage } from "../services/image-compress.js";
import { fetchUpstreamImage } from "../services/upstream-fetch.js";
import type { RequestQueue } from "../middleware/queue.js";

const CONFIG = {
  BYPASS_THRESHOLD: 10240,
  DEFAULT_QUALITY: 40,
  REQUEST_TIMEOUT: 60000,
} as const;

interface ProxyOptions {
  queue: RequestQueue;
}

const generateUrlHash = (url: string): string =>
  crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);

const parseQueryParams = (query: Record<string, string>) => {
  const jpegParam = query.jpeg ?? query.jpg;
  const { url: imageUrl, bw: grayscaleParam, l: qualityParam } = query;

  if (!imageUrl) {
    return { healthCheck: true };
  }

  return {
    imageUrl,
    isWebp: !parseInt(jpegParam, 10),
    isGrayscale: Boolean(parseInt(grayscaleParam, 10)),
    quality: parseInt(qualityParam, 10) || CONFIG.DEFAULT_QUALITY,
  };
};

const isPrivateIP = (hostname: string): boolean => {
  // Basic SSRF protection: block localhost and private IP ranges
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/
  ];
  return privatePatterns.some(pattern => pattern.test(hostname));
};

const cleanImageUrl = (url: string): string | null => {
  if (!url || typeof url !== "string") return null;
  try {
    const parsedUrl = new URL(url.trim());
    
    // SSRF protection: check for private IPs/hostnames
    if (isPrivateIP(parsedUrl.hostname)) {
      logger.warn("Blocked potential SSRF request", { hostname: parsedUrl.hostname });
      return null;
    }
    
    return parsedUrl.href;
  } catch {
    return null;
  }
};

const createImageResponse = (
  buffer: Buffer,
  contentType: string,
  additionalHeaders: Record<string, string> = {}
) => {
  const headers = {
    "content-type": contentType,
    "content-length": buffer.length.toString(),
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
    ...additionalHeaders,
  };

  return new Response(buffer, { 
    headers,
    status: 200,
  });
};

const sanitizeResponseHeaders = (headers: Record<string, string>): Record<string, string> => {
  const sanitized = { ...headers };
  delete sanitized.etag;
  delete sanitized["x-cache"];
  delete sanitized.via;
  delete sanitized["x-varnish"];
  delete sanitized.age;
  return sanitized;
};

export function proxyRoutes(options: ProxyOptions) {
  return new Elysia({ prefix: "/api" })
    .get("/index", async ({ query, set, request }): Promise<any> => {
      const startTime = Date.now();
      const abortController = new AbortController();
      let release: (() => void) | null = null;

      const timeout = setTimeout(() => {
        abortController.abort();
      }, CONFIG.REQUEST_TIMEOUT);

      try {
        const params = parseQueryParams(query);

        if (params.healthCheck) {
          clearTimeout(timeout);
          return "bandwidth-hero-proxy";
        }

        const { imageUrl: rawUrl, isWebp, isGrayscale, quality } = params;
        const imageUrl = cleanImageUrl(rawUrl || "");

        if (!imageUrl) {
          clearTimeout(timeout);
          set.status = 400;
          return { error: "Invalid or restricted image URL provided" };
        }

        const urlHash = generateUrlHash(imageUrl);

        const clientHeaders = Object.fromEntries(
          new Headers(request.headers).entries()
        );
        const clientIP =
          clientHeaders["x-forwarded-for"]?.split(",")[0] ||
          clientHeaders["x-real-ip"] ||
          "unknown";

        // Wait in queue and get release function
        if (options.queue) {
          release = await options.queue.enqueue(abortController.signal);
        }

        // Fetch upstream image
        const { buffer, contentType, contentLength, upstreamHeaders } =
          await fetchUpstreamImage(imageUrl, clientHeaders, clientIP, abortController.signal);

        logger.logRequest({
          url: imageUrl,
          userAgent: clientHeaders["user-agent"],
          referer: clientHeaders["referer"],
          ip: clientIP,
          jpeg: query.jpeg || "",
          bw: query.bw || "",
          quality,
          contentType,
        });

        // Check if we should bypass compression
        if (
          contentLength < CONFIG.BYPASS_THRESHOLD ||
          !shouldCompress(contentType, contentLength, !!isWebp) ||
          !contentType.startsWith("image/")
        ) {
          const reason =
            contentLength < CONFIG.BYPASS_THRESHOLD
              ? "already_small"
              : !contentType.startsWith("image/")
              ? "non-image"
              : "criteria_not_met";

          logger.logBypass({ url: imageUrl, size: contentLength, reason });

          if (!contentType.startsWith("image/")) {
            set.status = 502;
            set.headers["content-type"] = "application/json";
            return {
              error: "Upstream returned non-image response",
              reason: "upstream_error",
              contentType,
            };
          }

          return new Response(buffer, {
            status: 200,
            headers: {
              "content-type": contentType,
              "content-length": buffer.length.toString(),
              "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
              pragma: "no-cache",
              expires: "0",
              ...sanitizeResponseHeaders(upstreamHeaders),
              "x-compression-status": `bypassed-${reason}`,
              "x-bypass-reason": reason,
              "x-url-hash": urlHash,
              "x-original-size": contentLength.toString(),
            },
          });
        }

        // Compress image
        const { err, output, headers: compressHeaders } = await compressImage(
          buffer,
          !!isWebp,
          !!isGrayscale,
          quality || CONFIG.DEFAULT_QUALITY,
          contentLength
        );

        if (err || !output || !compressHeaders) {
          logger.logCompressionProcess({
            url: imageUrl,
            originalSize: contentLength,
            error: err || new Error("Compression failed"),
          });
          throw err || new Error("Compression failed");
        }

        logger.logCompressionProcess({
          url: imageUrl,
          originalSize: contentLength,
          compressedSize: output.length,
          bytesSaved: contentLength - output.length,
          quality,
          format: compressHeaders["content-type"] || (isWebp ? "image/avif" : "image/jpeg"),
        });

        return createImageResponse(output, compressHeaders["content-type"], {
          ...sanitizeResponseHeaders(upstreamHeaders),
          ...compressHeaders,
          "x-compressed-by": "bandwidth-hero",
          "x-url-hash": urlHash,
        });
      } catch (error) {
        const err = error as Error;

        if (err.name === "AbortError" || err.message.includes("timed out")) {
          set.status = 408;
          set.headers["content-type"] = "application/json";
          return { error: "Request timeout" };
        }

        logger.error("Request failed", {
          path: "/api/index",
          error: err.message,
        });

        set.status = 500;
        set.headers["content-type"] = "application/json";
        return { error: err.message };
      } finally {
        clearTimeout(timeout);
        // CRITICAL: Always release the worker back to the queue
        if (release) release();
      }
    }, {
      query: t.Object({
        url: t.String(),
        jpeg: t.Optional(t.String()),
        jpg: t.Optional(t.String()),
        bw: t.Optional(t.String()),
        l: t.Optional(t.String()),
      }),
    });
}

export function healthRoutes(options: { queue: RequestQueue, getActiveRequests: () => number }) {
  return new Elysia()
    .get("/health", () => ({ status: "ok" }))
    .get("/ready", () => ({ status: "ready" }));
}

export default proxyRoutes;
