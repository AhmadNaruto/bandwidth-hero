// compress.js - Production-optimized image compression for Manga/Webtoon/Comics
// REFACTORED: Using Sharp's built-in mozjpeg for stability (no native addons)

import sharp from "sharp";
import { cpus } from "node:os";
import logger from "./logger.js";

// Set Sharp concurrency for better performance
const numCPUs = cpus().length;
const concurrency = parseInt(process.env.SHARP_CONCURRENCY, 10) || Math.min(numCPUs, 4);
sharp.concurrency(concurrency);

// Cache frequently used sharp operations
const cacheSize = process.env.SHARP_CACHE === "0" ? 0 : (parseInt(process.env.SHARP_CACHE, 10) || 100 * 1024 * 1024);
sharp.cache(cacheSize);

// Configuration constants - OPTIMIZED FOR MANGA/WEBTOON/COMICS
const CONFIG = {
  // Manga/webtoon typical dimensions
  MAX_WIDTH: 800,
  MAX_JPEG_HEIGHT: 32767,
  MAX_AVIF_HEIGHT: 16383,
  MAX_INPUT_PIXELS: 268402689,
  GRAYSCALE_QUALITY_RANGE: { min: 15, max: 35 },
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  COMPRESSION_TIMEOUT: 20000,

  // mozjpeg options via Sharp - OPTIMIZED FOR MANGA/LINE ART/TEXT
  // Sharp uses mozjpeg internally when mozjpeg option is set
  JPEG_OPTIONS: {
    quality: 75,
    progressive: true, // Better perceived loading
    mozjpeg: true, // Enable mozjpeg optimizations
    chromaSubsampling: '4:2:0', // Reduce color resolution (saves space)
    trellisQuantisation: true, // Better quality/size tradeoff
    overshootDeringing: true, // Reduce ringing artifacts
    quantisationTable: 2, // Table 2: better for graphics/text
  },

  // AVIF options - good for color webtoons
  AVIF_OPTIONS: {
    quality: 75,
    effort: 6, // Higher effort for better compression
    chromaSubsampling: '4:2:0',
    bitdepth: 8,
    lossless: false,
  },
};

// Helper functions
const getImageMetadata = async (imagePath) => {
  try {
    return await sharp(imagePath, {
      sequentialRead: true,
      limitInputPixels: CONFIG.MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    return { ...CONFIG.DEFAULT_DIMENSIONS, format: CONFIG.DEFAULT_FORMAT };
  }
};

const calculateDimensions = (metadata, maxWidth) => {
  if (!metadata.width || !metadata.height) return CONFIG.DEFAULT_DIMENSIONS;
  if (metadata.width <= maxWidth) return { width: metadata.width, height: metadata.height };

  const ratio = maxWidth / metadata.width;
  return {
    width: Math.round(metadata.width * ratio),
    height: Math.round(metadata.height * ratio),
  };
};

const selectFormat = (useAvif, calculatedHeight) => {
  if (calculatedHeight > CONFIG.MAX_JPEG_HEIGHT) return "jpeg";
  if (useAvif && calculatedHeight > CONFIG.MAX_AVIF_HEIGHT) return "jpeg";
  return useAvif ? "avif" : "jpeg";
};

// Process image with Sharp (uses mozjpeg internally for JPEG)
const processImage = async (imagePath, format, quality, grayscale) => {
  const isJpeg = format === "jpeg";
  const formatOptions = isJpeg
    ? { ...CONFIG.JPEG_OPTIONS, quality }
    : { ...CONFIG.AVIF_OPTIONS, quality };

  const pipeline = sharp(imagePath, {
    sequentialRead: true,
    limitInputPixels: CONFIG.MAX_INPUT_PIXELS,
    failOnError: false,
  })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      kernel: sharp.kernel.lanczos3,
      width: CONFIG.MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    });

  if (grayscale) {
    pipeline.grayscale();
  }

  return pipeline
    .toFormat(format, formatOptions)
    .toBuffer({ resolveWithObject: true });
};

const createResponse = (output, format, size, bytesSaved, status, originalSize = null) => ({
  err: null,
  headers: {
    "content-type": `image/${format}`,
    "content-length": size,
    "x-compression-status": status,
    "x-bytes-saved": bytesSaved,
    ...(originalSize !== null && { "x-original-size": originalSize }),
  },
  output,
});

// Helper function to add timeout to promises
const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
};

// Main compress function with timeout protection
async function compress(imagePath, useAvif, grayscale, quality, originalSize) {
  try {
    // Validate input buffer
    if (!Buffer.isBuffer(imagePath) || imagePath.length === 0) {
      throw new Error("Invalid or empty image buffer");
    }

    // Create compression promise with timeout
    const compressionPromise = (async () => {
      const metadata = await getImageMetadata(imagePath);
      const { height: calculatedHeight } = calculateDimensions(metadata, CONFIG.MAX_WIDTH);
      const finalFormat = selectFormat(useAvif, calculatedHeight);

      const effectiveQuality = grayscale
        ? Math.max(CONFIG.GRAYSCALE_QUALITY_RANGE.min, Math.min(quality, CONFIG.GRAYSCALE_QUALITY_RANGE.max))
        : quality;

      logger.debug("Compression started", {
        originalSize,
        effectiveQuality,
        format: finalFormat,
        mode: finalFormat === "avif" ? "AVIF" : "mozjpeg",
      });

      const { data, info } = await processImage(imagePath, finalFormat, effectiveQuality, grayscale);

      if (info.size > originalSize) {
        return createResponse(
          imagePath,
          metadata.format || CONFIG.DEFAULT_FORMAT,
          originalSize,
          0,
          "bypassed-larger"
        );
      }

      return createResponse(data, finalFormat, info.size, originalSize - info.size, "compressed", originalSize);
    })();

    // Apply timeout to entire compression operation
    return await withTimeout(compressionPromise, CONFIG.COMPRESSION_TIMEOUT);
  } catch (err) {
    logger.error("Compression failed", { error: err.message });
    return { err, headers: null, output: null };
  }
}

export default compress;
