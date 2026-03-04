# VPS Deployment Guide

## Prerequisites
- VPS with Ubuntu/Debian or CentOS/RHEL
- Node.js >= 21.0.0
- PM2 (process manager) or systemd

## Quick Start

### 1. Install Dependencies

```bash
# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_21.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repository
git clone https://github.com/your-username/bandwidth-hero-proxy.git
cd bandwidth-hero-proxy

# Install dependencies
npm install --production
```

### 2. Environment Variables (Optional)

Create `.env` file:
```bash
PORT=3000
LOG_LEVEL=info
LOG_ENABLED=true
```

### 3. Run with PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start server.js --name bandwidth-hero

# Save PM2 process list
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 4. Run with systemd

Create service file `/etc/systemd/system/bandwidth-hero.service`:

```ini
[Unit]
Description=Bandwidth Hero Proxy
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/bandwidth-hero
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=LOG_LEVEL=info

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable bandwidth-hero
sudo systemctl start bandwidth-hero
sudo systemctl status bandwidth-hero
```

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
        proxy_pass http://localhost:3000;
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
        proxy_pass http://localhost:3000;
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

### View Logs with PM2
```bash
pm2 logs bandwidth-hero
```

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

### Increase Node.js Memory (for large images)
```bash
# In systemd service
ExecStart=/usr/bin/node --max-old-space-size=512 server.js
```

### Adjust Sharp Concurrency
```bash
# Limit sharp threads (default: number of CPU cores)
export UV_THREADPOOL_SIZE=4
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

# Rebuild sharp
npm rebuild sharp
```

### Port Already in Use
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>
```

### Check Service Status
```bash
# PM2
pm2 status

# systemd
sudo systemctl status bandwidth-hero
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
