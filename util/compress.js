// compress.js - Production-optimized image compression for Manga/Webtoon/Comics
// REFACTORED: Using node-mozjpeg optimized for line art and text

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

// Configuration constants - OPTIMIZED FOR MANGA/WEBTOON/COMICS
const CONFIG = {
  // Manga/webtoon typical dimensions
  // Webtoon canvas: 690-800px width (mobile-optimized)
  // Mihon/Komikku: fits mobile screens, preserve aspect ratio
  MAX_WIDTH: 800, // Slightly wider for tablets
  MAX_JPEG_HEIGHT: 32767, // Support long webtoon strips
  MAX_AVIF_HEIGHT: 16383,
  MAX_INPUT_PIXELS: 268402689,
  
  // Lower quality range for grayscale manga (B/W scans)
  // Manga doesn't need high quality, sharp edges matter more
  GRAYSCALE_QUALITY_RANGE: { min: 15, max: 35 },
  
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  COMPRESSION_TIMEOUT: 20000, // Slightly longer for large webtoon strips

  // mozjpeg options - OPTIMIZED FOR MANGA/LINE ART/TEXT
  // Key considerations:
  // - Preserve sharp edges (line art, text, panel borders)
  // - Minimize blocking artifacts in solid areas
  // - Good compression for B/W and limited color
  MOZJPEG_OPTIONS: {
    quality: 75, // Lower is fine for manga, reduces file size significantly
    baseline: false,
    arithmetic: false, // Better browser compatibility
    progressive: true, // Better perceived loading on slow connections
    optimize_coding: true, // Huffman optimization
    smoothing: 1, // Light smoothing reduces noise in B/W scans without blurring text
    color_space: mozjpeg.ColorSpace.YCbCr,
    quant_table: 2, // Table 2: better for graphics/text than table 3 (photos)
    trellis_multipass: true, // Trellis quantization for better quality/size
    trellis_opt_zero: true,
    trellis_opt_table: true,
    trellis_loops: 2, // 2 loops: good balance speed/quality for manga
    auto_subsample: true,
    chroma_subsample: 2, // 4:2:0: fine for manga (chroma less important)
    separate_chroma_quality: true, // Allow different chroma quality
    chroma_quality: 60, // Lower chroma quality (saves space, imperceptible for manga)
  },

  // AVIF options - good for color webtoons
  AVIF_OPTIONS: {
    effort: 6, // Higher effort for better compression (webtoons benefit more)
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

  // Apply grayscale if requested
  if (grayscale) {
    pipeline.grayscale();
  }

  // Get raw buffer and metadata
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  // For grayscale images, mozjpeg needs 3 channels
  // If grayscale was applied, info.channels will be 1, we need to expand to 3
  let rgbData = data;
  if (info.channels === 1) {
    // Expand grayscale to RGB (3 channels) for mozjpeg compatibility
    // Use Buffer.concat for better performance
    const r = data;
    const g = data;
    const b = data;
    
    // Interleave RGB channels efficiently
    rgbData = Buffer.allocUnsafe(info.width * info.height * 3);
    let pos = 0;
    for (let i = 0; i < data.length; i++) {
      rgbData[pos++] = data[i]; // R
      rgbData[pos++] = data[i]; // G  
      rgbData[pos++] = data[i]; // B
    }
  }

  // Use mozjpeg to encode
  const options = {
    ...CONFIG.MOZJPEG_OPTIONS,
    quality,
    // Use YCbCr - works well for both color and grayscale
    // Chroma subsampling will further reduce size for grayscale
    color_space: mozjpeg.ColorSpace.YCbCr,
  };

  const output = mozjpeg.encodeSync(rgbData, info.width, info.height, options);

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
