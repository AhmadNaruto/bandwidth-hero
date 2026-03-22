// shouldCompress - Compression decision logic

const CONFIG = {
  MIN_COMPRESS_LENGTH: 2048,
  MIN_PNG_GIF_COMPRESS_LENGTH: 102400,
  MAX_ORIGINAL_SIZE: 5 * 1024 * 1024,
  SUPPORTED_IMAGE_TYPES: /^image\/(jpeg|png|gif|webp|bmp|tiff)$/,
} as const;

/**
 * Determines if an image should be compressed based on type and size.
 * PNG/GIF images require larger sizes to benefit from compression.
 */
export function shouldCompress(
  imageType: string | null | undefined,
  size: number,
  _isWebp: boolean // kept for API compatibility
): boolean {
  if (!imageType || typeof size !== "number") return false;
  if (size > CONFIG.MAX_ORIGINAL_SIZE || size < CONFIG.MIN_COMPRESS_LENGTH) return false;
  if (!CONFIG.SUPPORTED_IMAGE_TYPES.test(imageType)) return false;

  // PNG/GIF images need to be larger to benefit from compression
  if (imageType.endsWith("png") || imageType.endsWith("gif")) {
    return size >= CONFIG.MIN_PNG_GIF_COMPRESS_LENGTH;
  }

  return true;
}

export default shouldCompress;
