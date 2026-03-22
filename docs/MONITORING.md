# Monitoring Guide - Bandwidth Hero Proxy

Dokumentasi monitoring untuk memastikan server berjalan stabil 24/7.

## Monitoring Endpoints

### 1. Basic Health Check
```bash
curl http://localhost:8080/health
# Response: bandwidth-hero-proxy
```

### 2. Readiness Check
```bash
curl http://localhost:8080/ready
# Response: ok (atau unavailable jika ada masalah)
```

### 3. Detailed Health Check (Recommended)
```bash
curl http://localhost:8080/health/detailed | jq .
```

**Response Example:**
```json
{
  "status": "ok",
  "uptime": 3600.5,
  "memory": {
    "heapUsed": 45,
    "heapTotal": 128,
    "heapUsedPercent": 35,
    "rss": 95
  },
  "queue": {
    "size": 5,
    "workers": {
      "total": 3,
      "busy": 1,
      "available": 2
    },
    "metrics": {
      "totalProcessed": 150,
      "totalTimeouts": 2,
      "totalAborted": 0,
      "totalRejected": 0,
      "averageWaitTime": 750,
      "lastWaitTime": 820,
      "maxWaitTime": 2500
    }
  },
  "activeRequests": 12,
  "memoryCircuitBreaker": false,
  "upstreamCircuitBreaker": false,
  "timestamp": "2026-03-20T10:30:00.000Z"
}
```

**Status Values:**
- `ok` - Server healthy
- `busy` - Queue full (HTTP 429)
- `degraded` - Memory pressure (HTTP 503)

### 4. Queue Status
```bash
curl http://localhost:8080/queue/status | jq .
```

**Response Example:**
```json
{
  "queue": {
    "size": 3
  },
  "workers": [
    {
      "id": 0,
      "busy": false,
      "requestsProcessed": 50
    },
    {
      "id": 1,
      "busy": true,
      "requestsProcessed": 48
    },
    {
      "id": 2,
      "busy": false,
      "requestsProcessed": 49
    }
  ],
  "limits": {
    "workerCount": 3,
    "minDelay": 500,
    "maxDelay": 1000,
    "maxSize": 100,
    "timeout": 120000
  },
  "metrics": {
    "totalProcessed": 50,
    "totalTimeouts": 0,
    "totalAborted": 1,
    "totalRejected": 0,
    "averageWaitTime": 680,
    "lastWaitTime": 750,
    "maxWaitTime": 1200
  },
  "enabled": true
}
```

## Alert Thresholds

### Critical Alerts (Immediate Action Required)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Memory RSS | > 1.5 GB | Check for memory leaks, restart if needed |
| Memory Heap | > 1 GB | Review image processing load |
| Memory Circuit Breaker | `true` | Server under memory pressure |
| Upstream Circuit Breaker | `true` | Upstream servers failing |
| Queue Rejected | > 10/hour | Increase queue size or reduce traffic |

### Warning Alerts (Monitor Closely)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Queue Size | > 50 | Monitor traffic spike |
| Average Wait Time | > 2000ms | Consider adjusting queue delays |
| Queue Timeouts | > 5/hour | Increase queue timeout or reduce load |
| Active Requests | > 80 | Approaching concurrency limit |

## Systemd Monitoring

### Check Service Status
```bash
sudo systemctl status bandwidth-hero
```

### View Live Logs
```bash
sudo journalctl -u bandwidth-hero -f
```

### View Error Logs Only
```bash
sudo journalctl -u bandwidth-hero -p err -f
```

### View Logs for Last Hour
```bash
sudo journalctl -u bandwidth-hero --since "1 hour ago"
```

### Memory Usage History
```bash
sudo journalctl -u bandwidth-hero | grep "Memory stats"
```

## Automated Monitoring Script

Simpan sebagai `/usr/local/bin/bandwidth-hero-monitor.sh`:

```bash
#!/bin/bash

HEALTH_URL="http://localhost:8080/health/detailed"
ALERT_WEBHOOK="https://your-alert-webhook.com"  # Optional

# Get health status
HEALTH=$(curl -s $HEALTH_URL)

# Extract metrics
STATUS=$(echo $HEALTH | jq -r '.status')
RSS=$(echo $HEALTH | jq -r '.memory.rss')
QUEUE_SIZE=$(echo $HEALTH | jq -r '.queue.size')
MEMORY_CB=$(echo $HEALTH | jq -r '.memoryCircuitBreaker')
UPSTREAM_CB=$(echo $HEALTH | jq -r '.upstreamCircuitBreaker')

# Alert conditions
ALERT=false
ALERT_MSG=""

if [ "$STATUS" = "degraded" ]; then
    ALERT=true
    ALERT_MSG="Server degraded - RSS: ${RSS}MB"
fi

if [ "$MEMORY_CB" = "true" ]; then
    ALERT=true
    ALERT_MSG="Memory circuit breaker active!"
fi

if [ "$UPSTREAM_CB" = "true" ]; then
    ALERT=true
    ALERT_MSG="Upstream circuit breaker active!"
fi

if [ "$QUEUE_SIZE" -gt 80 ]; then
    ALERT=true
    ALERT_MSG="Queue nearly full: $QUEUE_SIZE/100"
fi

# Send alert
if [ "$ALERT" = true ]; then
    echo "[$(date)] ALERT: $ALERT_MSG"
    # Optional: Send to webhook
    # curl -X POST -H "Content-Type: application/json" \
    #   -d "{\"text\":\"$ALERT_MSG\"}" \
    #   $ALERT_WEBHOOK
fi

echo "[$(date)] Status: $STATUS, RSS: ${RSS}MB, Queue: $QUEUE_SIZE"
```

Buat executable:
```bash
sudo chmod +x /usr/local/bin/bandwidth-hero-monitor.sh
```

## Cron Monitoring

Tambahkan ke crontab untuk monitoring setiap 5 menit:
```bash
crontab -e

# Add this line:
*/5 * * * * /usr/local/bin/bandwidth-hero-monitor.sh >> /var/log/bandwidth-hero-monitor.log 2>&1
```

## Prometheus Metrics (Optional)

Untuk integrasi dengan Prometheus, tambahkan endpoint metrics:

```bash
# Install bun-prometheus or similar
# Then add to server.js:

app.get("/metrics", (req, res) => {
  const memUsage = process.memoryUsage();
  const metrics = `
# HELP process_memory_usage_bytes Memory usage in bytes
# TYPE process_memory_usage_bytes gauge
process_memory_heap_used_bytes ${memUsage.heapUsed}
process_memory_heap_total_bytes ${memUsage.heapTotal}
process_memory_rss_bytes ${memUsage.rss}

# HELP queue_size Current queue size
# TYPE queue_size gauge
queue_size ${requestQueue.length}

# HELP queue_processed_total Total requests processed
# TYPE queue_processed_total counter
queue_processed_total ${queueMetrics.totalProcessed}

# HELP active_requests Current active requests
# TYPE active_requests gauge
active_requests ${activeRequests}
`;
  res.set("Content-Type", "text/plain");
  res.send(metrics);
});
```

## Log Analysis

### Common Log Patterns

**Normal Operation:**
```json
{"level":"INFO","message":"Request completed","duration":"250ms"}
{"level":"INFO","message":"Image Zip","savings":"45.2KB","percent":"67.3%"}
```

**Queue Waiting:**
```json
{"level":"DEBUG","message":"Request waited in queue","waitTime":750}
```

**Memory Pressure:**
```json
{"level":"ERROR","message":"Memory circuit breaker triggered","reason":"rss_critical"}
```

**Upstream Issues:**
```json
{"level":"WARN","message":"Upstream circuit breaker opened","failureCount":5}
```

### Analyze Log Patterns

```bash
# Count requests per hour
sudo journalctl -u bandwidth-hero --since "1 hour ago" | \
  grep "Request completed" | wc -l

# Find slow requests (> 5s)
sudo journalctl -u bandwidth-hero | \
  jq -r 'select(.message == "Request completed") | select(.duration > "5000ms")'

# Find compression failures
sudo journalctl -u bandwidth-hero | \
  grep "Compression failed"
```

## Performance Tuning

### Adjust Queue Settings

Edit `.env`:
```bash
# Reduce delay for faster processing (less rate limiting)
QUEUE_MIN_DELAY=300
QUEUE_MAX_DELAY=600

# Increase queue size for traffic spikes
QUEUE_MAX_SIZE=200

# Reduce timeout for faster failure
QUEUE_TIMEOUT=60000
```

### Memory Management

```bash
# Set memory limit for Bun
# In bandwidth-hero.service, add to ExecStart:
ExecStart=/home/ubuntu/.bun/bin/bun run --max-heap-size=512M server.js
```

### Sharp Concurrency

```bash
# In .env
SHARP_CONCURRENCY=2  # Reduce if CPU bound
SHARP_CACHE=52428800  # 50MB cache
```

## Troubleshooting

### Server Not Responding
```bash
# Check if service is running
sudo systemctl is-active bandwidth-hero

# Check port
sudo lsof -i :8080

# Restart service
sudo systemctl restart bandwidth-hero
```

### High Memory Usage
```bash
# Check memory stats
curl http://localhost:8080/health/detailed | jq .memory

# View memory logs
sudo journalctl -u bandwidth-hero | grep "Memory"

# Restart if needed
sudo systemctl restart bandwidth-hero
```

### Queue Backlog
```bash
# Check queue status
curl http://localhost:8080/queue/status

# If queue is stuck, restart service
sudo systemctl restart bandwidth-hero
```

### Upstream Failures
```bash
# Check upstream circuit breaker
curl http://localhost:8080/health/detailed | jq .upstreamCircuitBreaker

# View upstream errors
sudo journalctl -u bandwidth-hero | grep "Upstream"
```

## Best Practices for 24/7 Stability

1. **Monitor Memory**: Set up alerts for RSS > 1GB
2. **Watch Queue**: Ensure queue doesn't stay full for extended periods
3. **Regular Restarts**: Consider scheduled restarts during low-traffic hours
4. **Log Rotation**: Ensure journalctl logs are rotated
5. **Resource Limits**: Set appropriate CPU/memory limits in systemd
6. **Health Checks**: Use `/health/detailed` for load balancer health checks
7. **Graceful Degradation**: Server automatically rejects requests when overloaded
