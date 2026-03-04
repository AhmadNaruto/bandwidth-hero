# Bandwidth Hero Proxy - Project Context

## Project Overview

**Bandwidth Hero Proxy** is a VPS-based image compression service designed to work with the [Bandwidth Hero](https://github.com/ayastreb/bandwidth-hero) browser extension. It compresses images on-the-fly by converting them to low-resolution WebP, JPEG, or AVIF formats, saving bandwidth and improving browsing experience.

### Key Features
- **On-the-fly Image Compression**: Converts images to WebP/JPEG/AVIF with adjustable quality
- **VPS Architecture**: Deployed on any VPS or Node.js host using Express.js
- **Cloudflare Compatibility**: Forwards browser headers to avoid bot detection
- **Modern Logging System**: Structured JSON logging with multiple log levels
- **Intelligent Compression Logic**: Smart bypass decisions based on size, format, and transparency
- **Grayscale Conversion**: Optional grayscale mode for further file size reduction

### Tech Stack
- **Runtime**: Node.js >= 20.0.0 (ES Modules)
- **Framework**: Express.js
- **Image Processing**: Sharp
- **HTTP Client**: Got
- **Testing**: Jest (with node:test compatibility)
- **Bundler**: esbuild

## Project Structure

```
bandwidth-hero/
├── util/
│   ├── compress.js       # Image compression logic using Sharp
│   ├── logger.js         # Structured logging system
│   ├── pick.js           # Case-insensitive object property picker
│   └── shouldCompress.js # Compression decision logic
├── tests/
│   ├── index.test.mjs    # Unit and integration tests
│   └── setupTests.mjs    # Jest setup configuration
├── docs/
│   ├── logging-system.md # Logging system documentation
│   └── sample-logs.md    # Example log outputs
├── server.js             # Express server (main entry point)
├── jest.config.cjs       # Jest test configuration
├── DEPLOYMENT.md         # VPS deployment guide
└── package.json          # Dependencies and scripts
```

## Building and Running

### Prerequisites
- Node.js >= 20.0.0

### Installation
```bash
npm install
```

### Development
```bash
# Start local development server with auto-reload
npm run dev
```

The server will be available at: `http://localhost:8080`

### Testing
```bash
npm test
```

### Deployment
See [DEPLOYMENT.md](DEPLOYMENT.md) for VPS deployment instructions using PM2 or systemd.

## API Usage

### Endpoint
```
GET /api/index?url=<image_url>&jpeg=<0|1>&bw=<0|1>&l=<quality>
```

### Query Parameters
| Parameter | Description | Default |
|-----------|-------------|---------|
| `url` | Source image URL (required) | - |
| `jpeg` | Force JPEG format (1) or WebP/AVIF (0) | 0 (WebP/AVIF) |
| `bw` | Grayscale conversion (1) or color (0) | 0 |
| `l` | Quality level (1-100) | 40 |

### Example Request
```
/api/index?url=https://example.com/image.png&jpeg=1&bw=0&l=60
```

### Response Headers
- `content-type`: Image MIME type
- `content-length`: Compressed size
- `x-compression-status`: `compressed` or `bypassed-*`
- `x-bytes-saved`: Bytes reduced
- `x-url-hash`: SHA-256 hash of source URL (truncated)
- `x-bypass-reason`: Reason if compression was bypassed

## Development Conventions

### Code Style
- **ES Modules**: All files use `import`/`export` syntax
- **Refactored Structure**: Files include "REFACTORED" comments indicating LSP-friendly improvements
- **Configuration Objects**: Constants extracted to `CONFIG` objects at module top
- **Helper Functions**: Small, focused helper functions with JSDoc comments

### Logging Practices
- Use the singleton `logger` from `util/logger.js`
- Log levels: `error`, `warn`, `info`, `debug`, `trace`
- Environment variables:
  - `LOG_LEVEL`: Minimum log level (default: `INFO`)
  - `LOG_ENABLED`: Enable/disable logging (default: `true`)

### Testing Practices
- Tests use `node:test` and `node:assert` (Node.js built-in)
- Test files use `.mjs` extension
- Mock `console.log` to keep terminal clean during tests
- Integration tests use real URLs (e.g., picsum.photos)

### Compression Logic
Images are **bypassed** (not compressed) when:
- Size < 10KB (`BYPASS_THRESHOLD`)
- Non-image content type
- Compressed output would be larger than original
- PNG/GIF without transparency and < 100KB

### Header Forwarding
The following headers are forwarded to upstream servers for Cloudflare compatibility:
- `user-agent`, `accept`, `accept-language`, `accept-encoding`
- `cookie`, `dnt`, `referer`
- `x-forwarded-for` (client IP)

## Key Configuration

### package.json Scripts
```json
{
  "start": "node server.js",
  "dev": "node --watch server.js",
  "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js"
}
```

## Common Tasks

### Adding New Compression Formats
Modify `util/compress.js` - update `selectFormat()` and `CONFIG` object.

### Adjusting Compression Thresholds
Modify `CONFIG.BYPASS_THRESHOLD` in `server.js` or `util/shouldCompress.js`.

### Changing Log Verbosity
Set environment variables in `.env`:
```
LOG_LEVEL=debug
LOG_ENABLED=true
```

### Debugging Compression Issues
1. Set `LOG_LEVEL=debug`
2. Check logs for `logCompressionProcess` and `logUpstreamFetch` entries
3. Review `x-compression-status` and `x-bypass-reason` headers in responses

## External Dependencies
- [Sharp](https://github.com/lovell/sharp) - High-performance image processing
- [Got](https://github.com/sindresorhus/got) - HTTP client
- [Express](https://expressjs.com/) - Web framework

## Related Projects
- Original: [adi-g15/bandwidth-hero-proxy](https://github.com/adi-g15/bandwidth-hero-proxy)
- Browser Extension: [ayastreb/bandwidth-hero](https://github.com/ayastreb/bandwidth-hero)
