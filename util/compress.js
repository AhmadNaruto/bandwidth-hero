// compress.js - Production-optimized image compression for Manga/Webtoon/Comics
// REFACTORED: Using @napi-rs/image for high-performance N-API based image processing

import { Transformer } from "@napi-rs/image";
import logger from "./logger.js";

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
  COMPRESSION_TIMEOUT: 120000, // 120 seconds (2 minutes) for large manga images

  // AVIF options - good for color webtoons
  // speed: 1=slowest/best quality, 10=fastest/worst quality
  AVIF_OPTIONS: {
    quality: 75,
    alphaQuality: 90,
    speed: 4, // Balanced speed/quality
    chromaSubsampling: 2, // Yuv420 - good for photos/comics
  },

  // JPEG quality settings
  JPEG_QUALITY: {
    DEFAULT: 75,
    GRAYSCALE_MIN: 15,
    GRAYSCALE_MAX: 35,
  },
};

// Helper functions
const getImageMetadata = async (imageBuffer) => {
  try {
    const transformer = new Transformer(imageBuffer);
    const metadata = await transformer.metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    };
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

// Process image with @napi-rs/image
const processImage = async (imageBuffer, format, quality, grayscale) => {
  try {
    // Create transformer from image buffer
    let transformer = new Transformer(imageBuffer);

    // Get metadata for dimension calculation
    const metadata = await transformer.metadata();
    const { width, height } = calculateDimensions(metadata, CONFIG.MAX_WIDTH);

    // Apply transformations in chain
    // Note: @napi-rs/image resize uses Lanczos3 by default for best quality
    transformer = transformer.resize(width, height, null);

    // Apply grayscale if needed
    if (grayscale) {
      transformer = transformer.grayscale();
    }

    // Convert to target format
    let outputBuffer;
    if (format === "jpeg") {
      outputBuffer = await transformer.jpeg(quality);
    } else {
      // AVIF
      outputBuffer = await transformer.avif({
        quality: quality,
        alphaQuality: CONFIG.AVIF_OPTIONS.alphaQuality,
        speed: CONFIG.AVIF_OPTIONS.speed,
        chromaSubsampling: CONFIG.AVIF_OPTIONS.chromaSubsampling,
      });
    }

    return {
      data: outputBuffer,
      info: {
        size: outputBuffer.length,
        format: format,
      },
    };
  } catch (error) {
    logger.error("Image processing failed", { error: error.message });
    throw error;
  }
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
        mode: finalFormat === "avif" ? "AVIF" : "JPEG",
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
