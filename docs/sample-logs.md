# Sample Log Output

This file contains examples of the structured logs produced by the Bandwidth Hero logging system.

## Successful Compression

```json
{
  "timestamp": "2025-12-11T10:30:45.123Z",
  "level": "info",
  "message": "Image compressed successfully",
  "url": "https://example.com/photo.jpg",
  "originalSize": 1500000,
  "compressedSize": 300000,
  "format": "webp",
  "quality": 80,
  "grayscale": false,
  "compressionRatio": 0.8,
  "bytesSaved": 1200000,
  "processingTime": 845
}
```

## Request Information

```json
{
  "timestamp": "2025-12-11T10:30:45.100Z",
  "level": "debug",
  "message": "Incoming compression request",
  "url": "https://example.com/photo.jpg",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36...",
  "referer": "https://website.com/gallery",
  "ip": "203.0.113.195",
  "options": {
    "jpeg": false,
    "grayscale": false,
    "quality": 80
  },
  "contentType": "image/jpeg"
}
```

## Upstream Fetch Success

```json
{
  "timestamp": "2025-12-11T10:30:45.105Z",
  "level": "debug",
  "message": "Successfully fetched upstream image",
  "url": "https://example.com/photo.jpg",
  "statusCode": 200,
  "contentType": "image/jpeg",
  "contentLength": "1500000",
  "fetchTime": 120
}
```

## Image Bypass

```json
{
  "timestamp": "2025-12-11T10:32:15.456Z",
  "level": "info",
  "message": "Image bypassed (not compressed)",
  "url": "https://example.com/small-icon.png",
  "size": 800,
  "contentType": "image/png",
  "reason": "size or format criteria not met"
}
```

## Compression Error

```json
{
  "timestamp": "2025-12-11T10:35:22.789Z",
  "level": "warn",
  "message": "Compression failed",
  "url": "https://example.com/corrupted-image.jpg",
  "originalSize": 50000,
  "error": "Input buffer contains unsupported image format",
  "processingTime": 45
}
```

## Unhandled Error

```json
{
  "timestamp": "2025-12-11T10:40:10.012Z",
  "level": "error",
  "message": "Unhandled error during compression process",
  "url": "https://example.com/problematic-image.gif",
  "error": "Unexpected error occurred",
  "stack": "Error: Unexpected error occurred\n    at /path/to/file.js:123:45",
  "processingTime": 210
}
```

## Sharp Processing Details

```json
{
  "timestamp": "2025-12-11T10:30:45.200Z",
  "level": "debug",
  "message": "Starting image compression",
  "originalSize": 1500000,
  "finalFormat": "webp",
  "quality": 80,
  "grayscale": false,
  "calculatedDimensions": {
    "width": 700,
    "height": 467
  }
}
```

```json
{
  "timestamp": "2025-12-11T10:30:45.789Z",
  "level": "debug",
  "message": "Image compression completed",
  "compressedSize": 300000,
  "dimensions": {
    "width": 700,
    "height": 467
  },
  "format": "webp",
  "quality": 80
}
```