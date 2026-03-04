// compress.js - Production-optimized image compression with Sharp + mozjpeg
// REFACTORED: Using node-mozjpeg for better JPEG compression

import sharp from "sharp";
import mozjpeg from "node-mozjpeg";
import { cpus } from "node:os";
import logger from "./logger.js";

// Set Sharp concurrency for better performance
const numCPUs = cpus().length;
const concurrency = parseInt(process.env.SHARP_CONCURRENCY, 10) || Math.min(numCPUs, 4);
sharp.concurrency(concurrency);

// Cache frequently used sharp operations
const cacheSize = process.env.SHARP_CACHE === "0" ? 0 : (parseInt(process.env.SHARP_CACHE, 10) || 100 * 1024 * 1024);
sharp.cache(cacheSize);

// Configuration constants
const CONFIG = {
  MAX_WIDTH: 700,
  MAX_JPEG_HEIGHT: 32767,
  MAX_AVIF_HEIGHT: 16383,
  MAX_INPUT_PIXELS: 268402689,
  GRAYSCALE_QUALITY_RANGE: { min: 10, max: 40 },
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  COMPRESSION_TIMEOUT: 15000,

  // mozjpeg options - optimized for web performance
  MOZJPEG_OPTIONS: {
    quality: 80,
    baseline: false, // Use progressive for better perceived performance
    arithmetic: false, // Better compatibility with baseline
    progressive: true,
    optimize_coding: true,
    smoothing: 0,
    color_space: mozjpeg.ColorSpace.YCbCr,
    quant_table: 3, // Optimized for photos (PSNR-HVS-M)
    trellis_multipass: true, // Better quality at same size
    trellis_opt_zero: true,
    trellis_opt_table: true,
    trellis_loops: 3, // More loops = better compression but slower
    auto_subsample: true,
    chroma_subsample: 2, // 4:2:0 subsampling
    separate_chroma_quality: false,
    chroma_quality: 75,
  },

  AVIF_OPTIONS: {
    effort: 4,
    chromaSubsampling: "4:2:0",
    bitdepth: 8,
    lossless: false,
    force: true,
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

// Process image with mozjpeg for JPEG output
const processImageWithMozjpeg = async (imagePath, quality, grayscale, maxWidth) => {
  // First, use Sharp to resize and prepare raw RGB data
  const pipeline = sharp(imagePath, {
    sequentialRead: true,
    limitInputPixels: CONFIG.MAX_INPUT_PIXELS,
    failOnError: false,
  })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      kernel: sharp.kernel.lanczos3,
      width: maxWidth,
      fit: "inside",
      withoutEnlargement: true,
    });

  if (grayscale) {
    pipeline.grayscale();
  }

  // Get raw RGB buffer and metadata
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  // Use mozjpeg to encode
  const options = {
    ...CONFIG.MOZJPEG_OPTIONS,
    quality,
    color_space: grayscale ? mozjpeg.ColorSpace.GRAYSCALE : mozjpeg.ColorSpace.YCbCr,
  };

  const output = mozjpeg.encodeSync(data, info.width, info.height, options);

  return {
    data: output,
    info: {
      size: output.length,
      width: info.width,
      height: info.height,
    },
  };
};

// Process image with Sharp for AVIF output
const processImageWithSharp = async (imagePath, format, quality, grayscale) => {
  const formatOptions = { ...CONFIG.AVIF_OPTIONS, quality };

  return sharp(imagePath, {
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
    })
    .grayscale(grayscale)
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

      let result;
      if (finalFormat === "jpeg") {
        // Use mozjpeg for JPEG output
        result = await processImageWithMozjpeg(imagePath, effectiveQuality, grayscale, CONFIG.MAX_WIDTH);
      } else {
        // Use Sharp for AVIF output
        result = await processImageWithSharp(imagePath, finalFormat, effectiveQuality, grayscale);
      }

      if (result.info.size > originalSize) {
        return createResponse(
          imagePath,
          metadata.format || CONFIG.DEFAULT_FORMAT,
          originalSize,
          0,
          "bypassed-larger"
        );
      }

      return createResponse(result.data, finalFormat, result.info.size, originalSize - result.info.size, "compressed", originalSize);
    })();

    // Apply timeout to entire compression operation
    return await withTimeout(compressionPromise, CONFIG.COMPRESSION_TIMEOUT);
  } catch (err) {
    logger.error("Compression failed", { error: err.message });
    return { err, headers: null, output: null };
  }
}

export default compress;
