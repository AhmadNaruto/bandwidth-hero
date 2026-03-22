// Monitor route - Real-time log viewer
import { Elysia } from "elysia";

const MAX_LOG_LINES = 100;

export function monitorRoute() {
  return new Elysia({ prefix: "/monitor" })
    // HTML Monitor Page
    .get("/", () => {
      return new Response(getMonitorHtml(), {
        headers: { "content-type": "text/html" },
      });
    })

    // SSE Endpoint for real-time logs
    .get("/stream", () => {
      const headers = {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      };

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Send initial buffer
          const logs: any[] = getLogBuffer();
          logs.forEach((log: any) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(log)}\n\n`)
            );
          });

          // Keep connection alive
          const keepAlive = setInterval(() => {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }, 30000);

          return () => clearInterval(keepAlive);
        },
      });

      return new Response(stream, { headers });
    })

    // Get recent logs (REST API)
    .get("/logs", ({ query }) => {
      const limit = Math.min(parseInt(query.limit || "50", 10), MAX_LOG_LINES);
      const level = query.level || "ALL";

      const logs: any[] = getLogBuffer();
      let filtered = logs;
      if (level !== "ALL") {
        filtered = logs.filter((log: any) => log.level === level);
      }

      return {
        logs: filtered.slice(-limit),
        total: filtered.length,
        limit,
      };
    })

    // Health check for monitor
    .get("/health", () => ({
      status: "ok",
      buffer_size: getLogBuffer().length,
      timestamp: new Date().toISOString(),
    }));
}

// Get log buffer from logger module
function getLogBuffer() {
  const logger = require("../utils/logger.js");
  return logger.getLogBuffer?.() || [];
}

// Get monitor HTML
function getMonitorHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bandwidth Hero - Log Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: #00d9ff; margin-bottom: 20px; font-size: 24px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #16213e;
      padding: 15px;
      border-radius: 8px;
      border-left: 4px solid #00d9ff;
    }
    .stat-value { font-size: 28px; font-weight: bold; color: #00d9ff; }
    .stat-label { font-size: 12px; color: #888; margin-top: 5px; }
    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .filter-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .filter-btn.active { background: #00d9ff; color: #1a1a2e; }
    .filter-btn[data-level="ERROR"] { background: #e74c3c; color: white; }
    .filter-btn[data-level="WARN"] { background: #f39c12; color: white; }
    .filter-btn[data-level="INFO"] { background: #27ae60; color: white; }
    .filter-btn[data-level="DEBUG"] { background: #3498db; color: white; }
    .filter-btn[data-level="TRACE"] { background: #9b59b6; color: white; }
    .log-container {
      background: #0f0f23;
      border-radius: 8px;
      padding: 15px;
      max-height: 70vh;
      overflow-y: auto;
    }
    .log-entry {
      padding: 8px 12px;
      border-bottom: 1px solid #1a1a2e;
      font-size: 13px;
      display: grid;
      grid-template-columns: 180px 80px 1fr;
      gap: 15px;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateX(-10px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .log-entry:hover { background: #16213e; }
    .log-time { color: #888; }
    .log-level { font-weight: bold; text-transform: uppercase; }
    .log-level.ERROR { color: #e74c3c; }
    .log-level.WARN { color: #f39c12; }
    .log-level.INFO { color: #27ae60; }
    .log-level.DEBUG { color: #3498db; }
    .log-level.TRACE { color: #9b59b6; }
    .log-message { color: #eee; word-break: break-word; }
    .log-metadata {
      grid-column: 2 / -1;
      font-size: 11px;
      color: #666;
      margin-top: 5px;
    }
    .status-indicator {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #27ae60;
      margin-right: 10px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .auto-scroll {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
    }
    .auto-scroll input { width: 18px; height: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <h1><span class="status-indicator"></span>Bandwidth Hero - Log Monitor</h1>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value" id="totalLogs">0</div>
        <div class="stat-label">Total Logs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="errorCount">0</div>
        <div class="stat-label">Errors</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="warnCount">0</div>
        <div class="stat-label">Warnings</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="connStatus">Connected</div>
        <div class="stat-label">SSE Status</div>
      </div>
    </div>
    <div class="filters">
      <button class="filter-btn active" data-level="ALL">ALL</button>
      <button class="filter-btn" data-level="ERROR">ERROR</button>
      <button class="filter-btn" data-level="WARN">WARN</button>
      <button class="filter-btn" data-level="INFO">INFO</button>
      <button class="filter-btn" data-level="DEBUG">DEBUG</button>
      <button class="filter-btn" data-level="TRACE">TRACE</button>
    </div>
    <div class="auto-scroll">
      <input type="checkbox" id="autoScroll" checked>
      <label for="autoScroll">Auto-scroll to latest logs</label>
      <button onclick="clearLogs()" style="margin-left: auto; padding: 8px 16px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Clear Logs</button>
    </div>
    <div class="log-container" id="logContainer"></div>
  </div>
  <script>
    let currentFilter = 'ALL';
    const logContainer = document.getElementById('logContainer');
    const autoScrollCheckbox = document.getElementById('autoScroll');
    const eventSource = new EventSource('/monitor/stream');
    eventSource.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        addLogEntry(log);
        updateStats();
      } catch (e) { console.error('Failed to parse log:', e); }
    };
    eventSource.onerror = () => {
      document.getElementById('connStatus').textContent = 'Disconnected';
      document.getElementById('connStatus').style.color = '#e74c3c';
    };
    eventSource.onopen = () => {
      document.getElementById('connStatus').textContent = 'Connected';
      document.getElementById('connStatus').style.color = '#27ae60';
    };
    function addLogEntry(log) {
      if (currentFilter !== 'ALL' && log.level !== currentFilter) return;
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = \`<div class="log-time">\${new Date(log.timestamp).toLocaleTimeString()}</div>
        <div class="log-level \${log.level}">\${log.level}</div>
        <div class="log-message">\${log.message}</div>
        \${getMetadataHtml(log)}\`;
      logContainer.appendChild(entry);
      if (autoScrollCheckbox.checked) logContainer.scrollTop = logContainer.scrollHeight;
      const logs = logContainer.getElementsByClassName('log-entry');
      if (logs.length > 500) logs[0].remove();
    }
    function getMetadataHtml(log) {
      const exclude = ['timestamp', 'level', 'message'];
      const metadata = Object.entries(log)
        .filter(([key]) => !exclude.includes(key))
        .map(([key, value]) => {\${key}: \${typeof value === 'object' ? JSON.stringify(value) : String(value)});
      if (metadata.length === 0) return '';
      return \`<div class="log-metadata">\${metadata.join(' | ')}</div>\`;
    }
    function updateStats() {
      const logs = logContainer.getElementsByClassName('log-entry');
      document.getElementById('totalLogs').textContent = logs.length;
      document.getElementById('errorCount').textContent = Array.from(logs).filter(l => l.querySelector('.log-level.ERROR')).length;
      document.getElementById('warnCount').textContent = Array.from(logs).filter(l => l.querySelector('.log-level.WARN')).length;
    }
    function clearLogs() { logContainer.innerHTML = ''; updateStats(); }
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.level;
        logContainer.innerHTML = '';
        fetch(\`/monitor/logs?level=\${currentFilter}&limit=100\`)
          .then(r => r.json())
          .then(data => { data.logs.forEach(log => addLogEntry(log)); updateStats(); });
      });
    });
    fetch('/monitor/logs?limit=100')
      .then(r => r.json())
      .then(data => { data.logs.forEach(log => addLogEntry(log)); updateStats(); });
  </script>
</body>
</html>`;
}

export default monitorRoute;
