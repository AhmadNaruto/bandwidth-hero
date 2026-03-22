// Monitor route - Simple dashboard with polling
import { Elysia } from "elysia";

const MAX_LOG_LINES = 100;

export function monitorRoute() {
  return new Elysia({ prefix: "/monitor" })
    .get("/", () => {
      return new Response(getMonitorHtml(), {
        headers: { "content-type": "text/html" },
      });
    })

    .get("/logs", ({ query }) => {
      const limit = Math.min(parseInt(query.limit || "50", 10), MAX_LOG_LINES);
      const level = query.level || "ALL";
      const logs: any[] = getLogBuffer();
      let filtered = logs;
      if (level !== "ALL") {
        filtered = logs.filter((log: any) => log.level === level);
      }
      return { logs: filtered.slice(-limit), total: filtered.length, limit };
    })

    .get("/health", () => ({
      status: "ok",
      buffer_size: getLogBuffer().length,
      timestamp: new Date().toISOString(),
    }));
}

function getLogBuffer() {
  const logger = require("../utils/logger.js");
  return logger.getLogBuffer?.() || [];
}

function getMonitorHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bandwidth Hero - Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: monospace; background: #0a0a0f; color: #fff; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #00d9ff; margin-bottom: 20px; }
    .filters { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .filter-btn { padding: 10px 20px; border: 2px solid #2a2a3e; border-radius: 8px; background: #1a1a2e; color: #a0a0b0; cursor: pointer; font-weight: bold; }
    .filter-btn.active { background: #00d9ff; color: #0a0a0f; border-color: #00d9ff; }
    .log-container { background: #1a1a2e; border-radius: 12px; padding: 20px; max-height: 70vh; overflow-y: auto; }
    .log-entry { padding: 15px; margin-bottom: 10px; background: #12121a; border-radius: 8px; border-left: 4px solid #2a2a3e; }
    .log-header { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .log-time { color: #666; font-size: 11px; font-family: monospace; }
    .log-level { font-weight: bold; text-transform: uppercase; font-size: 10px; padding: 2px 8px; border-radius: 4px; }
    .log-level.ERROR { background: #ff4466; color: #fff; border-left-color: #ff4466; }
    .log-level.WARN { background: #ffaa00; color: #000; border-left-color: #ffaa00; }
    .log-level.INFO { background: #00ff88; color: #000; border-left-color: #00ff88; }
    .log-level.DEBUG { background: #4488ff; color: #fff; border-left-color: #4488ff; }
    .log-level.TRACE { background: #aa66ff; color: #fff; border-left-color: #aa66ff; }
    .log-message { color: #fff; font-size: 13px; line-height: 1.5; word-break: break-word; }
    .log-metadata { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2a2a3e; font-size: 11px; color: #888; }
    .metadata-item { display: inline-block; margin-right: 12px; }
    .metadata-label { color: #00d9ff; }
    .empty-state { text-align: center; padding: 60px 20px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Bandwidth Hero - Live Monitor</h1>
    <div class="filters">
      <button class="filter-btn active" data-level="ALL">ALL</button>
      <button class="filter-btn" data-level="ERROR">ERROR</button>
      <button class="filter-btn" data-level="WARN">WARN</button>
      <button class="filter-btn" data-level="INFO">INFO</button>
      <button class="filter-btn" data-level="DEBUG">DEBUG</button>
      <button class="filter-btn" data-level="TRACE">TRACE</button>
    </div>
    <div class="log-container" id="logContainer"><div class="empty-state">Loading logs...</div></div>
  </div>
  <script>
    var currentFilter = 'ALL';
    var lastLogTimestamp = null;
    var logContainer = document.getElementById('logContainer');
    
    function pollLogs() {
      fetch('/monitor/logs?limit=100')
        .then(function(r) {
          console.log('Status:', r.status);
          console.log('Content-Type:', r.headers.get('content-type'));
          return r.text();
        })
        .then(function(text) {
          console.log('Response text:', text.substring(0, 200));
          return JSON.parse(text);
        })
        .then(function(data) {
          var logs = data.logs;
          if (currentFilter !== 'ALL') {
            logs = logs.filter(function(log) { return log.level === currentFilter; });
          }
          logs = logs.reverse();
          var newestTimestamp = logs.length > 0 ? logs[0].timestamp : null;
          if (newestTimestamp !== lastLogTimestamp) {
            lastLogTimestamp = newestTimestamp;
            renderLogs(logs);
          }
        })
        .catch(function(err) { console.error('Fetch error:', err); });
    }
    
    function renderLogs(logs) {
      if (logs.length === 0) {
        logContainer.innerHTML = '<div class="empty-state">No logs yet</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < logs.length; i++) {
        var log = logs[i];
        var time = new Date(log.timestamp).toLocaleTimeString();
        html += '<div class="log-entry">';
        html += '<div class="log-header">';
        html += '<span class="log-time">' + time + '</span>';
        html += '<span class="log-level ' + log.level + '">' + log.level + '</span>';
        html += '</div>';
        // Show URL for INFO logs
        var displayMessage = log.message;
        if (log.level === 'INFO') {
          if (log.url) {
            displayMessage = log.url;
          } else if (log.savings) {
            // For Image Zip logs, show message + metadata
            displayMessage = log.message;
          }
        }
        html += '<div class="log-message" style="word-break: break-all; font-family: monospace; font-size: 12px;">' + escapeHtml(displayMessage) + '</div>';
        // Add metadata for INFO logs
        if (log.level === 'INFO' && log.savings) {
          html += '<div class="log-metadata">';
          if (log.savings) html += '<span class="metadata-item"><span class="metadata-label">Savings:</span> ' + escapeHtml(log.savings) + '</span> ';
          if (log.percent) html += '<span class="metadata-item"><span class="metadata-label">Percent:</span> ' + escapeHtml(log.percent) + '</span> ';
          if (log.quality) html += '<span class="metadata-item"><span class="metadata-label">Quality:</span> ' + escapeHtml(String(log.quality)) + '</span> ';
          if (log.format) html += '<span class="metadata-item"><span class="metadata-label">Format:</span> ' + escapeHtml(log.format) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      logContainer.innerHTML = html;
    }
    
    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    document.querySelectorAll('.filter-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentFilter = btn.dataset.level;
        pollLogs();
      });
    });
    
    pollLogs();
    setInterval(pollLogs, 2000);
  </script>
</body>
</html>`;
}

export default monitorRoute;
