# Bandwidth Hero Proxy - Complete Maintenance Guide

> **Comprehensive documentation for maintaining the Bandwidth Hero Proxy service**

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
4. [Compression Logic](#compression-logic)
5. [Queue System](#queue-system)
6. [Configuration](#configuration)
7. [Deployment](#deployment)
8. [Monitoring & Logging](#monitoring--logging)
9. [Troubleshooting](#troubleshooting)
10. [Maintenance Tasks](#maintenance-tasks)

---

## Project Overview

**Bandwidth Hero Proxy** is a VPS-based image compression service that works with the [Bandwidth Hero](https://github.com/ayastreb/bandwidth-hero) browser extension. It compresses images on-the-fly by converting them to WebP, AVIF, or JPEG formats.

### Key Features

| Feature | Description |
|---------|-------------|
| **On-the-fly Compression** | Real-time image compression without disk storage |
| **Multiple Formats** | WebP, AVIF, JPEG output with quality control |
| **Grayscale Mode** | Optional grayscale for further size reduction |
| **Smart Bypass** | Skips compression when not beneficial |
| **Rate Limiting** | Queue-based rate limiting to avoid upstream blocks |
| **Cloudflare Compatible** | Forwards browser headers to avoid bot detection |
| **SSRF Protection** | Blocks requests to private IPs |

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Runtime** | Bun >= 1.0.0 |
| **Framework** | ElysiaJS (built on Bun) |
| **Image Processing** | @napi-rs/image |
| **Language** | TypeScript |

---

## Architecture

### System Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Nginx     │────▶│   Elysia    │
│  (Extension)│     │  (SSL/SSL)  │     │   Server    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Image     │◀────│  Upstream   │◀────│   Queue     │
│   Source    │     │   Fetch     │     │  (Rate Lim) │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                      ┌─────────────┐
                                      │  Compress   │
                                      │  (@napi-rs) │
                                      └─────────────┘
```

### Project Structure

```
bandwidth-hero-bun/
├── src/
│   ├── index.ts              # Main entry point
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   ├── routes/
│   │   ├── proxy.ts          # Main /api/index endpoint
│   │   ├── health.ts         # Health check endpoints
│   │   ├── queue.ts          # Queue status endpoint
│   │   └── monitor.ts        # Real-time monitoring
│   ├── services/
│   │   ├── image-compress.ts # Image compression logic
│   │   └── upstream-fetch.ts # Upstream image fetching
│   └── middleware/
│       ├── logging.ts        # Request logging
│       └── queue.ts          # Rate limiting queue
├── docs/
│   └── logging-system.md     # Logging documentation
├── .env.example              # Environment template
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
└── bandwidth-hero.service    # systemd service file
```

---

## API Reference

### Main Endpoint

```
GET /api/index
```

Compresses an image from a remote URL and returns the compressed version.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ Yes | - | Source image URL |
| `jpeg` | string | ❌ No | `0` | Force JPEG format (`1`) or AVIF/WebP (`0`) |
| `jpg` | string | ❌ No | - | Alias for `jpeg` |
| `bw` | string | ❌ No | `0` | Grayscale conversion (`1`) or color (`0`) |
| `l` | string | ❌ No | `40` | Quality level (1-100) |

#### Example Requests

```bash
# Basic usage (AVIF, quality 40)
curl "http://localhost:8080/api/index?url=https://example.com/image.png"

# JPEG format, 60% quality
curl "http://localhost:8080/api/index?url=https://example.com/image.png&jpeg=1&l=60"

# Grayscale AVIF
curl "http://localhost:8080/api/index?url=https://example.com/image.png&bw=1"

# High quality JPEG
curl "http://localhost:8080/api/index?url=https://example.com/image.png&jpeg=1&l=80"
```

#### Response Headers

| Header | Description |
|--------|-------------|
| `content-type` | Image MIME type (e.g., `image/avif`, `image/jpeg`) |
| `content-length` | Compressed image size in bytes |
| `cache-control` | No-cache headers (always fresh) |
| `x-compression-status` | `compressed` or `bypassed-*` |
| `x-bytes-saved` | Bytes reduced by compression |
| `x-url-hash` | SHA-256 hash of source URL (first 16 chars) |
| `x-bypass-reason` | Reason if compression was bypassed |
| `x-compressed-by` | `bandwidth-hero` (when compressed) |

#### Compression Status Values

| Status | Description |
|--------|-------------|
| `compressed` | Image was successfully compressed |
| `bypassed-small` | Image too small (< 10KB) |
| `bypassed-larger` | Compressed output would be larger |
| `bypassed-criteria_not_met` | Format/size criteria not met |
| `bypassed-non-image` | Response was not an image |

#### Error Responses

```json
// Invalid URL
{
  "error": "Invalid or restricted image URL provided"
}

// Upstream error (403/429)
{
  "error": "Upstream returned non-image response",
  "reason": "upstream_error",
  "contentType": "text/html"
}

// Timeout
{
  "error": "Request timeout"
}

// General error
{
  "error": "<error message>"
}
```

### Health Endpoints

#### GET /health

Basic health check.

```bash
curl http://localhost:8080/health
# Response: { "status": "ok" }
```

#### GET /ready

Readiness probe for load balancers.

```bash
curl http://localhost:8080/ready
# Response: { "status": "ready" }
```

### Queue Endpoints

#### GET /queue/status

Returns current queue status and metrics.

```bash
curl http://localhost:8080/queue/status
```

**Response:**

```json
{
  "queue": {
    "size": 5
  },
  "workers": [
    { "id": 0, "busy": true, "requestsProcessed": 150 },
    { "id": 1, "busy": false, "requestsProcessed": 145 },
    { "id": 2, "busy": true, "requestsProcessed": 148 },
    { "id": 3, "busy": false, "requestsProcessed": 142 },
    { "id": 4, "busy": false, "requestsProcessed": 140 }
  ],
  "limits": {
    "workerCount": 5,
    "minDelay": 500,
    "maxDelay": 1000,
    "maxSize": 200,
    "timeout": 120000
  },
  "metrics": {
    "totalProcessed": 1250,
    "totalTimeouts": 3,
    "totalAborted": 12,
    "totalRejected": 0,
    "averageWaitTime": 245,
    "lastWaitTime": 312,
    "maxWaitTime": 2500
  },
  "enabled": true
}
```

### Monitor Endpoint

#### GET /monitor/realtime

Returns recent log entries for real-time monitoring.

```bash
curl http://localhost:8080/monitor/realtime
```

---

## Compression Logic

### Decision Flow

```
                    ┌─────────────────┐
                    │  Incoming Image │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Size < 10KB?    │────Yes───▶ BYPASS (small)
                    └────────┬────────┘
                             │ No
                    ┌────────▼────────┐
                    │ Non-image?      │────Yes───▶ BYPASS (non-image)
                    └────────┬────────┘
                             │ No
                    ┌────────▼────────┐
                    │ PNG/GIF < 100KB │
                    │ No transparency?│────Yes───▶ BYPASS (criteria)
                    └────────┬────────┘
                             │ No
                    ┌────────▼────────┐
                    │   Compress      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ Output > Input? │────Yes───▶ BYPASS (larger)
                    └────────┬────────┘
                             │ No
                             │
                    ┌────────▼────────┐
                    │  Return Result  │
                    └─────────────────┘
```

### Compression Thresholds

| Threshold | Value | File |
|-----------|-------|------|
| `BYPASS_THRESHOLD` | 10240 bytes (10KB) | `src/routes/proxy.ts` |
| `MAX_WIDTH` | 800px | `src/services/image-compress.ts` |
| `MAX_JPEG_HEIGHT` | 32767px | `src/services/image-compress.ts` |
| `MAX_AVIF_HEIGHT` | 16380px | `src/services/image-compress.ts` |

### Format Selection

| Condition | Output Format |
|-----------|---------------|
| `jpeg=1` or height > 16380px | JPEG |
| `jpeg=0` and height ≤ 16380px | AVIF |

### Quality Settings

| Mode | Quality Range | Notes |
|------|---------------|-------|
| Color | 1-100 (default: 40) | User-specified |
| Grayscale | 25-45 (capped) | Lower quality acceptable for B&W |

### AVIF Configuration

```typescript
{
  quality: 75,           // Base quality
  alphaQuality: 90,      // Alpha channel quality
  speed: 5,              // Encoding speed (1=slowest, 10=fastest)
  chromaSubsampling: 1   // 1=4:4:4 (best for text/lines)
}
```

### Image Processing Pipeline

1. **Resize**: Lanczos3 filter to max 800px width
2. **Grayscale**: Optional (if `bw=1`)
3. **Encode**: AVIF or JPEG with configured quality

---

## Queue System

### Purpose

The queue system prevents upstream servers from blocking the proxy due to rate limiting (403/429 errors).

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `WORKER_COUNT` | 5 | Concurrent upstream fetches |
| `WORKER_MIN_DELAY` | 500ms | Minimum delay between requests |
| `WORKER_MAX_DELAY` | 1000ms | Maximum delay between requests |
| `QUEUE_MAX_SIZE` | 200 | Maximum queued requests |
| `QUEUE_TIMEOUT` | 120000ms | Request timeout in queue |

### Worker Lifecycle

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Enqueue    │────▶│    Wait      │────▶│   Process    │
│  (Request)   │     │   (Queue)    │     │   (Worker)   │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                         ┌────────▼────────┐
                                         │   Complete      │
                                         │   (Release)     │
                                         └─────────────────┘
```

### Key Implementation Details

1. **Release Function**: Each `enqueue()` returns a `release()` function that MUST be called after processing
2. **Abort Handling**: Aborted requests are removed from queue without processing
3. **Random Delay**: Workers wait random time between min/max to simulate human behavior
4. **Recursive Processing**: After each completion, queue checks for next item

### Queue Metrics

| Metric | Description |
|--------|-------------|
| `totalProcessed` | Total requests processed |
| `totalTimeouts` | Requests that timed out in queue |
| `totalAborted` | Requests aborted by client |
| `totalRejected` | Requests rejected (queue full) |
| `averageWaitTime` | Average wait time in queue (ms) |
| `lastWaitTime` | Last request's wait time (ms) |
| `maxWaitTime` | Maximum wait time observed (ms) |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8080 | Server port |
| `NODE_ENV` | development | `production` or `development` |
| `LOG_LEVEL` | info | `error`, `warn`, `info`, `debug`, `trace` |
| `LOG_ENABLED` | true | Enable/disable logging |

### Server Configuration (src/index.ts)

```typescript
const CONFIG = {
  PORT: 8080,
  NODE_ENV: "development",
  
  // Queue settings
  QUEUE_ENABLED: true,
  WORKER_COUNT: 5,
  WORKER_MIN_DELAY: 500,
  WORKER_MAX_DELAY: 1000,
  QUEUE_MAX_SIZE: 200,
  QUEUE_TIMEOUT: 120000,
  
  // Rate limiting
  MAX_CONCURRENT_REQUESTS: 100,
} as const;
```

### Proxy Configuration (src/routes/proxy.ts)

```typescript
const CONFIG = {
  BYPASS_THRESHOLD: 10240,  // 10KB
  DEFAULT_QUALITY: 40,
  REQUEST_TIMEOUT: 60000,   // 60 seconds
} as const;
```

### Compression Configuration (src/services/image-compress.ts)

```typescript
const CONFIG = {
  MAX_WIDTH: 800,
  MAX_JPEG_HEIGHT: 32767,
  MAX_AVIF_HEIGHT: 16380,
  GRAYSCALE_QUALITY_RANGE: { min: 25, max: 45 },
  DEFAULT_DIMENSIONS: { width: 400, height: 400 },
  DEFAULT_FORMAT: "avif",
  COMPRESSION_TIMEOUT: 60000,
  
  AVIF_OPTIONS: {
    quality: 75,
    alphaQuality: 90,
    speed: 5,
    chromaSubsampling: 1,
  },
  
  JPEG_QUALITY: {
    DEFAULT: 75,
    GRAYSCALE_MIN: 25,
    GRAYSCALE_MAX: 45,
  },
} as const;
```

---

## Deployment

### Prerequisites

- VPS with Ubuntu/Debian or CentOS/RHEL
- Bun runtime (latest version)
- systemd
- Nginx (for reverse proxy)

### Installation Steps

#### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

#### 2. Clone Repository

```bash
cd /var/www
git clone https://github.com/your-username/bandwidth-hero-proxy.git
cd bandwidth-hero-bun
```

#### 3. Install Dependencies

```bash
bun install --production
```

#### 4. Configure Environment

```bash
cp .env.example .env
nano .env
```

#### 5. Setup systemd Service

```bash
sudo cp bandwidth-hero.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bandwidth-hero
sudo systemctl start bandwidth-hero
sudo systemctl status bandwidth-hero
```

#### 6. Configure Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Increase timeout for large images
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Rate limiting
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://localhost:8080;
    }
}

limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
```

#### 7. Setup SSL (Let's Encrypt)

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### systemd Service File

```ini
[Unit]
Description=Bandwidth Hero Proxy
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bandwidth-hero-bun
ExecStart=/home/ubuntu/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8080
Nice=-5
LimitNOFILE=65535
ReadWritePaths=/home/ubuntu/bandwidth-hero-bun

[Install]
WantedBy=multi-user.target
```

---

## Monitoring & Logging

### Log Levels

| Level | When to Use |
|-------|-------------|
| `error` | Critical errors affecting operation |
| `warn` | Issues that don't prevent operation |
| `info` | Important events (compression, bypass) |
| `debug` | Detailed debugging information |
| `trace` | Very detailed tracing |

### View Logs

```bash
# systemd journal (real-time)
sudo journalctl -u bandwidth-hero -f

# Last 100 lines
sudo journalctl -u bandwidth-hero -n 100

# Filter by level
sudo journalctl -u bandwidth-hero | grep '"level":"ERROR"'
```

### Log Entry Format

```json
{
  "timestamp": "2026-03-23T10:30:00.000Z",
  "level": "INFO",
  "message": "Request completed",
  "path": "/api/index",
  "method": "GET",
  "statusCode": 200
}
```

### Key Log Events

| Event | Log Level | Key Fields |
|-------|-----------|------------|
| Request started | DEBUG | method, path, url |
| Request completed | INFO | path, statusCode |
| Request failed | ERROR | path, error, statusCode |
| Compression process | DEBUG | url, originalSize, compressedSize, bytesSaved |
| Bypass | INFO | url, size, reason |
| Upstream response | DEBUG | url, statusCode, contentLength |

### Monitoring Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Basic health check |
| `/ready` | Readiness probe |
| `/queue/status` | Queue metrics |
| `/monitor/realtime` | Recent logs |

### Recommended Monitoring

1. **Uptime Monitoring**: Use Uptime Kuma or UptimeRobot
2. **Resource Monitoring**: Use Prometheus + Grafana
3. **Log Aggregation**: Use Loki or ELK stack
4. **Alerting**: Set up alerts for:
   - Service down
   - High error rate (> 5%)
   - Queue size > 150
   - Response time > 5s

---

## Troubleshooting

### Common Issues

#### 1. Upstream 403 Forbidden

**Symptoms:** Images return 403 errors

**Causes:**
- Upstream server blocking bot traffic
- Missing or incorrect headers
- Rate limiting

**Solutions:**
```bash
# Check logs for user-agent
sudo journalctl -u bandwidth-hero | grep "403"

# Verify headers in upstream-fetch.ts
# Ensure Referer header is being sent
```

#### 2. Queue Backlog

**Symptoms:** Slow response times, queue size growing

**Causes:**
- Workers too slow
- Upstream rate limiting
- Network issues

**Solutions:**
```bash
# Check queue status
curl http://localhost:8080/queue/status

# Increase worker count (src/index.ts)
WORKER_COUNT: 10

# Reduce delays
WORKER_MIN_DELAY: 200
WORKER_MAX_DELAY: 500
```

#### 3. Memory Issues

**Symptoms:** OOM kills, slow performance

**Causes:**
- Large images
- Too many concurrent requests
- Memory leak

**Solutions:**
```bash
# Check memory usage
systemctl status bandwidth-hero

# Reduce concurrent requests
MAX_CONCURRENT_REQUESTS: 50

# Add swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

#### 4. Timeout Errors

**Symptoms:** Request timeout errors

**Causes:**
- Slow upstream
- Large images
- Network issues

**Solutions:**
```bash
# Increase timeout (src/routes/proxy.ts)
REQUEST_TIMEOUT: 90000

# Increase Nginx timeout
proxy_read_timeout 90s;
```

#### 5. SSRF Blocked

**Symptoms:** Valid images blocked

**Causes:**
- Image hosted on private IP
- SSRF protection too aggressive

**Solutions:**
```bash
# Check logs for SSRF blocks
sudo journalctl -u bandwidth-hero | grep "SSRF"

# Review isPrivateIP() in src/routes/proxy.ts
# Adjust if needed (be careful with security)
```

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
# In .env or systemd service
LOG_LEVEL=debug

# Restart service
sudo systemctl restart bandwidth-hero
```

### Performance Profiling

```bash
# Check response times
curl -w "@curl-format.txt" -o /dev/null -s "http://localhost:8080/api/index?url=..."

# curl-format.txt:
# time_namelookup:  %{time_namelookup}\n
# time_connect:     %{time_connect}\n
# time_starttransfer: %{time_starttransfer}\n
# time_total:       %{time_total}\n
```

---

## Maintenance Tasks

### Daily Tasks

- [ ] Check service status: `systemctl status bandwidth-hero`
- [ ] Review error logs: `journalctl -u bandwidth-hero --since today | grep ERROR`
- [ ] Check queue metrics: `curl /queue/status`

### Weekly Tasks

- [ ] Review compression statistics
- [ ] Check disk space: `df -h`
- [ ] Review Nginx logs for patterns
- [ ] Update dependencies: `bun update`

### Monthly Tasks

- [ ] Security updates: `sudo apt update && sudo apt upgrade`
- [ ] Review and rotate logs
- [ ] Performance review (response times, error rates)
- [ ] Backup configuration files

### Updating the Service

```bash
# Pull latest changes
cd /var/www/bandwidth-hero-bun
git pull

# Install new dependencies
bun install --production

# Restart service
sudo systemctl restart bandwidth-hero

# Verify
sudo systemctl status bandwidth-hero
curl http://localhost:8080/health
```

### Backup Configuration

```bash
# Create backup
tar -czf bandwidth-hero-backup-$(date +%Y%m%d).tar.gz \
  /var/www/bandwidth-hero-bun \
  /etc/systemd/system/bandwidth-hero.service \
  /etc/nginx/sites-available/bandwidth-hero

# Store backup offsite
scp bandwidth-hero-backup-*.tar.gz backup-server:/backups/
```

### Rollback Procedure

```bash
# Stop service
sudo systemctl stop bandwidth-hero

# Restore previous version
cd /var/www/bandwidth-hero-bun
git checkout <previous-commit>

# Reinstall dependencies
bun install --production

# Restart service
sudo systemctl start bandwidth-hero

# Verify
sudo systemctl status bandwidth-hero
```

---

## Appendix

### Response Header Reference

| Header | Example | Description |
|--------|---------|-------------|
| `x-compression-status` | `compressed` | Compression result |
| `x-bytes-saved` | `52430` | Bytes reduced |
| `x-url-hash` | `a1b2c3d4e5f67890` | URL fingerprint |
| `x-bypass-reason` | `small` | Bypass reason |
| `x-compressed-by` | `bandwidth-hero` | Service identifier |

### Bypass Reasons

| Reason | Description |
|--------|-------------|
| `small` | Image < 10KB |
| `larger` | Compressed output larger than input |
| `criteria_not_met` | Format/size criteria not met |
| `non-image` | Response not an image |

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid request (missing URL) |
| 408 | Request timeout |
| 500 | Server error |
| 502 | Upstream returned non-image |

### Useful Commands

```bash
# Service management
sudo systemctl start|stop|restart|status bandwidth-hero

# View logs
sudo journalctl -u bandwidth-hero -f
sudo journalctl -u bandwidth-hero --since "1 hour ago"

# Check port
sudo lsof -i :8080

# Test endpoint
curl -I "http://localhost:8080/api/index?url=..."

# Check queue
curl http://localhost:8080/queue/status | jq

# Memory usage
systemctl status bandwidth-hero

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx
```

### Performance Benchmarks

| Metric | Expected | Good | Excellent |
|--------|----------|------|-----------|
| Response Time | < 2s | < 1s | < 500ms |
| Compression Ratio | 30% | 50% | 70% |
| Error Rate | < 5% | < 2% | < 1% |
| Queue Wait Time | < 5s | < 2s | < 500ms |

---

**Last Updated:** March 23, 2026  
**Version:** 2.0  
**Maintained by:** See GitHub repository
