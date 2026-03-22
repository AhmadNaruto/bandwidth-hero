# VPS Deployment Guide

## Prerequisites
- VPS with Ubuntu/Debian or CentOS/RHEL
- Bun runtime (latest version)
- systemd

## Quick Start

### 1. Install Dependencies

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone repository
git clone https://github.com/your-username/bandwidth-hero-proxy.git
cd bandwidth-hero-proxy

# Install dependencies
bun install --production
```

### 2. Environment Variables (Optional)

Create `.env` file:
```bash
PORT=8080
LOG_LEVEL=info
LOG_ENABLED=true
```

### 3. Run with Bun (Recommended)

```bash
# Start application
bun run --env-file=.env server.js
```

### 4. Run with systemd

Use the provided `bandwidth-hero.service` file:

```bash
# Copy service file
sudo cp bandwidth-hero.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable bandwidth-hero
sudo systemctl start bandwidth-hero
sudo systemctl status bandwidth-hero
```

The service file is already configured to use Bun.

### 5. Setup Nginx Reverse Proxy

Install Nginx:
```bash
sudo apt-get install nginx
```

Create config `/etc/nginx/sites-available/bandwidth-hero`:

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
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}

# Rate limiting zone
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/bandwidth-hero /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Setup SSL with Let's Encrypt

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Usage

### Bandwidth Hero Extension Configuration

1. Open Bandwidth Hero extension settings
2. Set **Data Compression Service** to:
   ```
   https://your-domain.com/api/index
   ```
3. Save and you're done!

### API Endpoint

```
GET /api/index?url=<image_url>&jpeg=<0|1>&bw=<0|1>&l=<quality>
```

| Parameter | Description | Default |
|-----------|-------------|---------|
| `url` | Source image URL (required) | - |
| `jpeg` | Force JPEG format (1) or AVIF (0) | 0 |
| `bw` | Grayscale (1) or color (0) | 0 |
| `l` | Quality (1-100) | 40 |

### Health Check

```bash
curl https://your-domain.com/health
# Response: bandwidth-hero-proxy
```

## Monitoring

### View Logs with systemd
```bash
sudo journalctl -u bandwidth-hero -f
```

### Application Logs
Set `LOG_LEVEL=debug` for detailed logs:
```bash
# In .env or systemd service file
LOG_LEVEL=debug
```

Log levels: `error`, `warn`, `info`, `debug`, `trace`

## Performance Tuning

### Increase Bun Memory Limit
```bash
# In systemd service, add to ExecStart
ExecStart=/home/ubuntu/.bun/bin/bun run --max-heap-size=512M server.js
```

### Adjust Sharp Concurrency
```bash
# Limit sharp threads (default: number of CPU cores)
export SHARP_CONCURRENCY=4
export SHARP_CACHE=104857600
```

## Security Considerations

1. **Firewall**: Only allow ports 80, 443, and SSH
2. **Rate Limiting**: Configure Nginx rate limiting (see config above)
3. **Updates**: Keep system and dependencies updated
4. **Monitoring**: Set up monitoring (e.g., Uptime Kuma, Prometheus)

## Troubleshooting

### Sharp Build Issues
```bash
# Install build dependencies
sudo apt-get install -y build-essential libvips-dev

# Reinstall dependencies
bun install
```

### Port Already in Use
```bash
# Find process using port 8080
sudo lsof -i :8080

# Kill process
sudo kill -9 <PID>
```

### Check Service Status
```bash
# systemd
sudo systemctl status bandwidth-hero

# View logs
sudo journalctl -u bandwidth-hero -f
```

## Backup & Restore

### Backup
```bash
# Backup application
tar -czf bandwidth-hero-backup.tar.gz /var/www/bandwidth-hero

# Backup systemd service
sudo cp /etc/systemd/system/bandwidth-hero.service ./backup/
```

### Restore
```bash
# Extract backup
tar -xzf bandwidth-hero-backup.tar.gz -C /var/www/

# Restore service
sudo cp backup/bandwidth-hero.service /etc/systemd/system/
sudo systemctl daemon-reload
```
