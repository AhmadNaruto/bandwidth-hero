// Image compression service using @napi-rs/image

import { Transformer } from "@napi-rs/image";
import logger from "../utils/logger.js";

const CONFIG = {
  MAX_WIDTH: 800,
  MAX_JPEG_HEIGHT: 32767,
  MAX_AVIF_HEIGHT: 16383,
  GRAYSCALE_QUALITY_RANGE: { min: 15, max: 35 },
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  COMPRESSION_TIMEOUT: 120000,

  AVIF_OPTIONS: {
    quality: 75,
    alphaQuality: 90,
    speed: 4,
    chromaSubsampling: 2,
  },

  JPEG_QUALITY: {
    DEFAULT: 75,
    GRAYSCALE_MIN: 15,
    GRAYSCALE_MAX: 35,
  },
} as const;

interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}

interface CompressionResponse {
  err: Error | null;
  headers: Record<string, string> | null;
  output: Buffer | null;
}

const getImageMetadata = async (imageBuffer: Buffer): Promise<ImageMetadata> => {
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

const calculateDimensions = (
  metadata: ImageMetadata,
  maxWidth: number
): { width: number; height: number } => {
  if (!metadata.width || !metadata.height) return CONFIG.DEFAULT_DIMENSIONS;
  if (metadata.width <= maxWidth)
    return { width: metadata.width, height: metadata.height };

  const ratio = maxWidth / metadata.width;
  return {
    width: Math.round(metadata.width * ratio),
    height: Math.round(metadata.height * ratio),
  };
};

const selectFormat = (useAvif: boolean, calculatedHeight: number): "jpeg" | "avif" => {
  if (calculatedHeight > CONFIG.MAX_JPEG_HEIGHT) return "jpeg";
  if (useAvif && calculatedHeight > CONFIG.MAX_AVIF_HEIGHT) return "jpeg";
  return useAvif ? "avif" : "jpeg";
};

const processImage = async (
  imageBuffer: Buffer,
  format: "jpeg" | "avif",
  quality: number,
  grayscale: boolean
): Promise<{ data: Buffer; info: { size: number; format: string } }> => {
  try {
    let transformer = new Transformer(imageBuffer);

    const metadata = await transformer.metadata();
    const { width, height } = calculateDimensions(metadata, CONFIG.MAX_WIDTH);

    transformer = transformer.resize(width, height, null);

    if (grayscale) {
      transformer = transformer.grayscale();
    }

    let outputBuffer: Buffer;
    if (format === "jpeg") {
      outputBuffer = await transformer.jpeg(quality);
    } else {
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
    logger.error("Image processing failed", { error: (error as Error).message });
    throw error;
  }
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
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
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
      const metadata = await getImageMetadata(imageBuffer);
      const { height: calculatedHeight } = calculateDimensions(
        metadata,
        CONFIG.MAX_WIDTH
      );
      const finalFormat = selectFormat(useAvif, calculatedHeight);

      const effectiveQuality = grayscale
        ? Math.max(
            CONFIG.GRAYSCALE_QUALITY_RANGE.min,
            Math.min(quality, CONFIG.GRAYSCALE_QUALITY_RANGE.max)
          )
        : quality;

      logger.debug("Compression started", {
        originalSize,
        effectiveQuality,
        format: finalFormat,
        mode: finalFormat === "avif" ? "AVIF" : "JPEG",
      });

      const { data, info } = await processImage(
        imageBuffer,
        finalFormat,
        effectiveQuality,
        grayscale
      );

      if (info.size > originalSize) {
        return createResponse(
          imageBuffer,
          metadata.format || CONFIG.DEFAULT_FORMAT,
          originalSize,
          0,
          "bypassed-larger"
        );
      }

      return createResponse(data, finalFormat, info.size, originalSize - info.size, "compressed", originalSize);
    })();

    return await withTimeout(compressionPromise, CONFIG.COMPRESSION_TIMEOUT);
  } catch (err) {
    logger.error("Compression failed", { error: (err as Error).message });
    return { err: err as Error, headers: null, output: null };
  }
}

export default compressImage;
