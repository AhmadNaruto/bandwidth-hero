// index.js - REFACTORED: More concise and LSP-friendly version

import crypto from "node:crypto";
import got from "got";
import pick from "../util/pick.js";
import shouldCompress from "../util/shouldCompress.js";
import compress from "../util/compress.js";
import logger from "../util/logger.js";

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
};

// Helper functions
const getCacheHeaders = (custom = {}) => ({ ...CONFIG.CACHE_HEADERS, ...custom });

const createErrorResponse = (statusCode, message, url = null) => ({
  statusCode,
  body: JSON.stringify({ error: message, ...(url && { url }) }),
  headers: getCacheHeaders({ "content-type": "application/json" }),
});

const createImageResponse = (buffer, contentType, additionalHeaders = {}, isBase64Encoded = true) => {
  const body = isBase64Encoded ? buffer.toString("base64") : buffer;
  return {
    statusCode: 200,
    body,
    isBase64Encoded,
    headers: getCacheHeaders({
      "content-type": contentType,
      "content-length": Buffer.byteLength(body, isBase64Encoded ? "base64" : undefined),
      ...additionalHeaders,
    }),
  };
};

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

const cleanImageUrl = (url) => new URL(url.trim()).href;

const generateUrlHash = (url) => crypto.createHash("md5").update(url).digest("hex");

// Configure fetch with retry
const fetchWithRetry = got.extend({
  retry: { limit: 2, methods: ["GET"], statusCodes: [408, 429, 500, 502, 503, 504] },
  timeout: { request: 8500 },
  decompress: true,
  throwHttpErrors: false,
  http2: false,
});

const fetchUpstreamImage = async (url, headers, ip) => {
  const fetchStartTime = Date.now();
  const fetchHeaders = {
    ...pick(headers, CONFIG.FETCH_HEADERS_TO_PICK),
    "x-forwarded-for": headers["x-forwarded-for"] || ip,
    ...(headers["accept-encoding"] === "identity" && { "accept-encoding": "identity" }),
  };

  try {
    const response = await fetchWithRetry(url, { headers: fetchHeaders, responseType: "buffer" });
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
    logger.error("Upstream fetch error", { url, error: error.message, stack: error.stack });
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

// Main handler
export const handler = async (event) => {
  try {
    const params = parseQueryParams(event.queryStringParameters);
    if (params.healthCheck) return { statusCode: 200, body: "bandwidth-hero-proxy", headers: getCacheHeaders() };
    
    const { imageUrl: rawUrl, isWebp, isGrayscale, quality } = params;
    const imageUrl = cleanImageUrl(rawUrl);
    const urlHash = generateUrlHash(imageUrl);
    
    const fetchResult = await fetchUpstreamImage(imageUrl, event.headers, event.ip);
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
    
    const { err, output, headers: compressHeaders } = await compress(
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
  } catch (error) {
    logger.error("Handler error", { error: error.message, stack: error.stack });
    
    if (error.message === "Missing query parameters") return createErrorResponse(400, error.message);
    if (error.message.startsWith("Upstream fetch failed")) {
      const statusPart = error.message.split(":")[1]?.trim();
      const statusCode = statusPart && statusPart !== "Unknown" ? parseInt(statusPart, 10) : 502;
      return { statusCode: statusCode || 502, headers: getCacheHeaders() };
    }
    
    return createErrorResponse(500, "Internal server error", event?.queryStringParameters?.url);
  }
};