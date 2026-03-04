# Bandwidth Hero Data Compression Service

Welcome to **Bandwidth Hero Proxy** 🚀 - a high-performance image compression service that compresses images on-the-fly, saving bandwidth and improving browsing experience.

Forked from [adi-g15/bandwidth-hero-proxy](https://github.com/adi-g15/bandwidth-hero-proxy). This fork is actively maintained with modern dependencies and improved code quality.

This is a data compression service used by the [Bandwidth Hero](https://github.com/ayastreb/bandwidth-hero) browser extension. It compresses images (optionally grayscale) to low-res WebP, AVIF, or JPEG format using [Sharp](https://github.com/lovell/sharp) without saving images to disk.

> **Note:** Downloads images on user's behalf by forwarding browser headers, cookies, and IP address to the origin host.

## Features

- **On-the-fly Image Compression**: Converts images to WebP/AVIF/JPEG with adjustable quality
- **Modern Logging System**: Structured JSON logging with multiple log levels
- **Cloudflare Compatibility**: Forwards browser headers to avoid bot detection
- **Flexible Deployment**: Deploy on VPS, Netlify, Docker, or any Node.js host
- **Format Options**: WebP, AVIF, and JPEG output with quality control
- **Grayscale Mode**: Optional grayscale conversion for smaller file sizes
- **Smart Compression**: Bypasses compression for images that won't benefit
- **Security**: SHA-256 URL hashing, input validation, DoS protection
- **Performance**: Automatic resizing, metadata extraction, progressive JPEG

## Quick Start

### VPS Deployment (Recommended)

```bash
# Clone and install
git clone https://github.com/your-username/bandwidth-hero-proxy.git
cd bandwidth-hero-proxy
npm install --production

# Start server
npm start
```

### Netlify Deployment

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/ukind/bandwidth-hero-proxy2)

### Docker Deployment

```bash
docker run -d -p 3000:3000 your-username/bandwidth-hero-proxy
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `PORT` | Server port | `3000` |
| `LOG_LEVEL` | Logging level (error/warn/info/debug/trace) | `info` |
| `LOG_ENABLED` | Enable logging | `true` |

## API Usage

### Endpoint

```
GET /api/index?url=<image_url>&jpeg=<0|1>&bw=<0|1>&l=<quality>
```

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `url` | Source image URL (required) | - |
| `jpeg` | Force JPEG (1) or AVIF/WebP (0) | `0` |
| `bw` | Grayscale (1) or color (0) | `0` |
| `l` | Quality (1-100) | `40` |

### Example

```
/api/index?url=https://example.com/image.png&jpeg=1&bw=0&l=60
```

### Health Check

```
GET /health
Response: bandwidth-hero-proxy
```

## Bandwidth Hero Extension Setup

1. Install [Bandwidth Hero](https://github.com/ayastreb/bandwidth-hero) extension
2. Open extension settings
3. Set **Data Compression Service** to: `https://your-domain.com/api/index`
4. Save settings

## Logging

Structured JSON logs with timestamps:

```json
{
  "timestamp": "2026-03-04T10:30:00.000Z",
  "level": "INFO",
  "message": "Image Zip",
  "savings": "50 KB",
  "percent": "45.2%",
  "quality": 40,
  "format": "avif"
}
```

See [docs/logging-system.md](docs/logging-system.md) for full documentation.

## Performance

- **Compression Ratio**: Typically 40-70% file size reduction
- **Response Time**: ~200-500ms (depends on image size and network)
- **Concurrent Requests**: Handles 100+ requests/second on modern VPS

## Security

- SHA-256 URL hashing (not MD5)
- Input buffer validation
- DoS protection via pixel limits
- Header sanitization
- No file system writes

## Development

```bash
# Install dependencies
npm install

# Start dev server (auto-reload)
npm run dev

# Run tests
npm test
```

## Project Structure

```
bandwidth-hero/
├── functions/
│   └── index.js          # Main handler (Netlify & Express compatible)
├── util/
│   ├── compress.js       # Image compression with Sharp
│   ├── logger.js         # Structured JSON logging
│   ├── pick.js           # Case-insensitive object picker
│   └── shouldCompress.js # Compression decision logic
├── server.js             # Express server for VPS
├── DEPLOYMENT.md         # Detailed deployment guide
└── package.json
```

## License

MIT License - see [LICENSE](LICENSE) file.

## Acknowledgments

- Original: [adi-g15/bandwidth-hero-proxy](https://github.com/adi-g15/bandwidth-hero-proxy)
- Browser Extension: [ayastreb/bandwidth-hero](https://github.com/ayastreb/bandwidth-hero)
- Image Processing: [Sharp](https://sharp.pixelplumbing.com/)
