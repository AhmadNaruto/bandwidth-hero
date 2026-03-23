// Image compression service using @napi-rs/image optimized for Manhwa/Webtoon/Manga

import { Transformer } from "@napi-rs/image";
import logger from "../utils/logger.js";

const CONFIG = {
  MAX_WIDTH: 800,
  MAX_JPEG_HEIGHT: 32767,
  MAX_AVIF_HEIGHT: 16380, // Slightly below 16383 for safety
  GRAYSCALE_QUALITY_RANGE: { min: 25, max: 45 },
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  COMPRESSION_TIMEOUT: 60000,

  AVIF_OPTIONS: {
    quality: 75,
    alphaQuality: 90,
    speed: 5,            // User requested speed 5
    chromaSubsampling: 1, // 1 = 4:4:4 (Highest quality for text/Manhwa lines)
  },

  JPEG_QUALITY: {
    DEFAULT: 75,
    GRAYSCALE_MIN: 25,
    GRAYSCALE_MAX: 45,
  },
} as const;

interface CompressionResponse {
  err: Error | null;
  headers: Record<string, string> | null;
  output: Buffer | null;
}

const calculateDimensions = (
  width: number,
  height: number,
  maxWidth: number
): { width: number; height: number } => {
  if (!width || !height) return CONFIG.DEFAULT_DIMENSIONS;
  if (width <= maxWidth) return { width, height };

  const ratio = maxWidth / width;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};

const selectFormat = (useAvif: boolean, calculatedHeight: number): "jpeg" | "avif" => {
  // Webtoons are often long strips. AVIF has a height limit (~16k).
  if (calculatedHeight > CONFIG.MAX_AVIF_HEIGHT) return "jpeg";
  return useAvif ? "avif" : "jpeg";
};

const createResponse = (
  output: Buffer,
  format: string,
  size: number,
  bytesSaved: number,
  status: string,
  originalSize: number | null = null
): CompressionResponse => ({
  err: null,
  headers: {
    "content-type": `image/${format}`,
    "content-length": size.toString(),
    "x-compression-status": status,
    "x-bytes-saved": bytesSaved.toString(),
    ...(originalSize !== null && { "x-original-size": originalSize.toString() }),
  },
  output,
});

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

export async function compressImage(
  imageBuffer: Buffer,
  useAvif: boolean,
  grayscale: boolean,
  quality: number,
  originalSize: number
): Promise<CompressionResponse> {
  try {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error("Invalid or empty image buffer");
    }

    const compressionPromise = (async () => {
      const metadata = await new Transformer(imageBuffer).metadata();
      const { width: calcWidth, height: calcHeight } = calculateDimensions(
        metadata.width,
        metadata.height,
        CONFIG.MAX_WIDTH
      );

      const finalFormat = selectFormat(useAvif, calcHeight);
      const effectiveQuality = grayscale
        ? Math.max(
            CONFIG.GRAYSCALE_QUALITY_RANGE.min,
            Math.min(quality, CONFIG.GRAYSCALE_QUALITY_RANGE.max)
          )
        : quality;

      logger.debug("Compression task", {
        format: finalFormat,
        dimensions: `${calcWidth}x${calcHeight}`,
        requestedGray: grayscale,
      });

      let finalTransformer = new Transformer(imageBuffer).resize(calcWidth, calcHeight, null);
      if (grayscale) {
        finalTransformer = finalTransformer.grayscale();
      }

      let data: Buffer;
      if (finalFormat === "jpeg") {
        data = await finalTransformer.jpeg(effectiveQuality);
      } else {
        data = await finalTransformer.avif({
          quality: effectiveQuality,
          alphaQuality: CONFIG.AVIF_OPTIONS.alphaQuality,
          speed: CONFIG.AVIF_OPTIONS.speed,
          chromaSubsampling: CONFIG.AVIF_OPTIONS.chromaSubsampling,
        });
      }

      if (data.length > originalSize) {
        return createResponse(
          imageBuffer,
          metadata.format || CONFIG.DEFAULT_FORMAT,
          originalSize,
          0,
          "bypassed-larger"
        );
      }

      return createResponse(
        data, 
        finalFormat, 
        data.length, 
        originalSize - data.length, 
        "compressed", 
        originalSize
      );
    })();

    return await withTimeout(compressionPromise, CONFIG.COMPRESSION_TIMEOUT);
  } catch (err) {
    logger.error("Compression failed", { error: (err as Error).message });
    return { err: err as Error, headers: null, output: null };
  }
}

export default compressImage;
