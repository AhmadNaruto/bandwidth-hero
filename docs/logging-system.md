# Bandwidth Hero - Logging System Documentation

This document explains the new modern logging system implemented in the Bandwidth Hero image compression service.

## Overview

The logging system provides structured, clean logging of the compression process with the following features:

- Structured JSON logs for easy parsing
- Multiple log levels (error, warn, info, debug, trace)
- Detailed compression process tracking
- Request information logging
- Performance timing measurements

## Log Levels

| Level | Description |
|-------|-------------|
| error | Critical errors that affect operation |
| warn  | Issues that don't prevent operation but need attention |
| info  | Important operational events (successful compression, bypasses) |
| debug | Detailed debugging information |
| trace | Very detailed tracing for development |

## Environment Variables

- `LOG_LEVEL`: Sets the minimum log level ('debug', 'info', 'warn', 'error'). Default: 'info'
- `LOG_ENABLED`: Enables/disables logging ('true', 'false'). Default: 'true'

## Log Entry Format

All log entries follow this structure:

```json
{
  "timestamp": "2023-10-01T12:00:00.000Z",
  "level": "info",
  "message": "Event description",
  "...otherFields": "Additional context"
}
```

## Log Events

### Compression Process Logging

When an image is successfully compressed:

```json
{
  "timestamp": "2023-10-01T12:00:00.000Z",
  "level": "info",
  "message": "Image compressed successfully",
  "url": "https://example.com/image.jpg",
  "originalSize": 100000,
  "compressedSize": 50000,
  "format": "webp",
  "quality": 80,
  "grayscale": false,
  "compressionRatio": 0.5,
  "bytesSaved": 50000,
  "processingTime": 123
}
```

### Bypass Logging

When an image is bypassed (not compressed):

```json
{
  "timestamp": "2023-10-01T12:00:00.000Z",
  "level": "info",
  "message": "Image bypassed (not compressed)",
  "url": "https://example.com/small-image.png",
  "size": 500,
  "contentType": "image/png",
  "reason": "size or format criteria not met"
}
```

### Request Logging

Information about incoming requests:

```json
{
  "timestamp": "2023-10-01T12:00:00.000Z",
  "level": "debug",
  "message": "Incoming compression request",
  "url": "https://example.com/image.jpg",
  "userAgent": "Mozilla/5.0...",
  "referer": "https://referrer.com",
  "ip": "192.168.1.1",
  "options": {
    "jpeg": false,
    "grayscale": true,
    "quality": 75
  }
}
```

### Upstream Fetch Logging

Logging for upstream image fetches:

```json
{
  "timestamp": "2023-10-01T12:00:00.000Z",
  "level": "debug",
  "message": "Successfully fetched upstream image",
  "url": "https://example.com/image.jpg",
  "statusCode": 200,
  "contentType": "image/jpeg",
  "contentLength": "45612",
  "fetchTime": 245
}
```

### Error Logging

For compression errors:

```json
{
  "timestamp": "2023-10-01T12:00:00.000Z",
  "level": "warn",
  "message": "Compression failed",
  "url": "https://example.com/image.jpg",
  "originalSize": 100000,
  "error": "Invalid image format",
  "processingTime": 67
}
```

## Usage in Code

The logger is available as a singleton:

```javascript
const logger = require('./util/logger');

// Basic logging
logger.info('Operation completed');
logger.error('Something went wrong', { error: 'details' });

// Specialized logging methods
logger.logCompressionProcess({
  url: 'https://example.com/image.jpg',
  originalSize: 100000,
  compressedSize: 50000,
  // ... more details
});

logger.logRequest({
  url: 'https://example.com/image.jpg',
  userAgent: req.headers['user-agent'],
  // ... more details
});
```

## Integration Points

The new logging system has been integrated into:

1. `functions/index.js` - Main compression handler
2. `util/compress.js` - Image compression utility
3. `util/logger.js` - The logging utility itself

## Benefits

- **Structured Logs**: JSON format makes logs easy to parse and analyze
- **Better Debugging**: Detailed information about each step of the process
- **Performance Insights**: Timing information helps identify bottlenecks
- **Operational Visibility**: Clear understanding of service behavior and usage patterns