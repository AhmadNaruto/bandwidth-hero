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

const cleanImageUrl = (url: string): string | null => {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url.trim()).href;
  } catch {
    return null;
  }
};

const createImageResponse = (
  buffer: Buffer,
  contentType: string,
  additionalHeaders: Record<string, string> = {}
) => ({
  headers: {
    "content-type": contentType,
    "content-length": buffer.length,
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
    ...additionalHeaders,
  },
  body: buffer,
});

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
          return { error: "Invalid image URL provided" };
        }

        const urlHash = generateUrlHash(imageUrl);

        const clientHeaders = Object.fromEntries(
          new Headers(request.headers).entries()
        );
        const clientIP =
          clientHeaders["x-forwarded-for"]?.split(",")[0] ||
          clientHeaders["x-real-ip"] ||
          "unknown";

        // Wait in queue
        if (options.queue) {
          await options.queue.enqueue(abortController.signal);
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

          clearTimeout(timeout);
          return createImageResponse(buffer, contentType, {
            ...sanitizeResponseHeaders(upstreamHeaders),
            "x-bypass-reason": reason,
            "x-url-hash": urlHash,
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

        clearTimeout(timeout);
        return createImageResponse(output, compressHeaders["content-type"], {
          ...sanitizeResponseHeaders(upstreamHeaders),
          ...compressHeaders,
          "x-compressed-by": "bandwidth-hero",
          "x-url-hash": urlHash,
        });
      } catch (error) {
        clearTimeout(timeout);
        const err = error as Error;

        if (err.name === "AbortError" || err.message.includes("timed out")) {
          set.status = 408;
          return { error: "Request timeout" };
        }

        logger.error("Request failed", {
          path: "/api/index",
          error: err.message,
        });

        set.status = 500;
        return { error: err.message };
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

export default proxyRoutes;
