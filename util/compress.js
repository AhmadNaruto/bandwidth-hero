// compress.js - REFACTORED: More concise and LSP-friendly version

import sharp from "sharp";
import logger from "./logger.js";

// Configuration constants
const CONFIG = {
  MAX_WIDTH: 400,
  MAX_JPEG_HEIGHT: 32767,
  MAX_AVIF_HEIGHT: 16383,
  MAX_INPUT_PIXELS: 268402689,
  GRAYSCALE_QUALITY_RANGE: { min: 10, max: 40 },
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  
  JPEG_OPTIONS: {
    quality: 80,
    progressive: true,
    mozjpeg: true,
    chromaSubsampling: "4:2:0",
    trellisQuantisation: true,
    overshootDeringing: true,
    quantisationTable: 3,
  },
  
  AVIF_OPTIONS: {
    effort: 4,
    chromaSubsampling: "4:4:4",
    bitdepth: 8,
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

const processImage = async (imagePath, format, quality, grayscale) => {
  const isJpeg = format === "jpeg";
  const formatOptions = isJpeg
    ? { ...CONFIG.JPEG_OPTIONS, quality }
    : { ...CONFIG.AVIF_OPTIONS, quality };

  return sharp(imagePath, {
    sequentialRead: true,
    limitInputPixels: CONFIG.MAX_INPUT_PIXELS,
    failOnError: false,
  })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      kernel: sharp.kernel.lanczos2,
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

// Main compress function
async function compress(imagePath, useAvif, grayscale, quality, originalSize) {
  try {
    const metadata = await getImageMetadata(imagePath);
    const { height: calculatedHeight } = calculateDimensions(metadata, CONFIG.MAX_WIDTH);
    const finalFormat = selectFormat(useAvif, calculatedHeight);
    
    const effectiveQuality = grayscale
      ? Math.max(CONFIG.GRAYSCALE_QUALITY_RANGE.min, Math.min(quality, CONFIG.GRAYSCALE_QUALITY_RANGE.max))
      : quality;

    logger.debug("Compression started (AVIF Mode)", { originalSize, effectiveQuality, format: finalFormat });

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
  } catch (err) {
    logger.error("Compression failed", { error: err.message });
    return { err, headers: null, output: null };
  }
}

export default compress;
