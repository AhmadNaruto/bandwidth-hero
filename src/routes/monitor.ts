// Monitor route - Real-time log viewer
import { Elysia } from "elysia";

const MAX_LOG_LINES = 100;

export function monitorRoute() {
  return new Elysia({ prefix: "/monitor" })
    // Main Dashboard - Beautiful UI (akses via /monitor/stream)
    .get("/stream", () => {
      return new Response(getMonitorHtml(), {
        headers: { "content-type": "text/html" },
      });
    })

    // Also serve at root /monitor for convenience
    .get("/", () => {
      return new Response(getMonitorHtml(), {
        headers: { "content-type": "text/html" },
      });
    })

    // Raw SSE Endpoint (for programmatic access) - REAL-TIME!
    .get("/sse", ({ set }) => {
      set.headers = {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*",
      };

      // Send initial buffer
      const logs = getLogBuffer();
      const initialData = logs.map((log: any) => `data: ${JSON.stringify(log)}\n\n`).join('');
      
      // Create readable stream with proper cleanup
      let intervalId: ReturnType<typeof setInterval> | null = null;
      
      const stream = new ReadableStream({
        start(controller) {
          // Send initial logs
          if (initialData) {
            controller.enqueue(initialData);
          }

          // Send keep-alive every 30 seconds
          intervalId = setInterval(() => {
            try {
              controller.enqueue(": keep-alive\n\n");
            } catch (e) {
              // Controller closed, cleanup
              if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
              }
            }
          }, 30000);
        },
        cancel() {
          // Cleanup on client disconnect
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        },
      });

      return new Response(stream, { 
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
          "access-control-allow-origin": "*",
        }
      });
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Bandwidth Hero - Log Monitor</title>
  <style>
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: #1a1a2e;
      --text-primary: #ffffff;
      --text-secondary: #a0a0b0;
      --accent-cyan: #00d9ff;
      --accent-green: #00ff88;
      --accent-orange: #ffaa00;
      --accent-red: #ff4466;
      --accent-purple: #aa66ff;
      --accent-blue: #4488ff;
      --border-color: #2a2a3e;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Courier New', monospace;
      background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 20px;
    }

    .container { max-width: 1600px; margin: 0 auto; }
    
    h1 {
      color: var(--accent-cyan);
      margin-bottom: 20px;
      font-size: 28px;
      text-shadow: 0 0 20px rgba(0, 217, 255, 0.3);
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .stat-card {
      background: var(--bg-card);
      padding: 24px;
      border-radius: 16px;
      border: 1px solid var(--border-color);
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-cyan), var(--accent-green));
      animation: shimmer 2s infinite;
    }
    
    .stat-card:hover {
      transform: translateY(-4px) scale(1.02);
      box-shadow: 0 12px 32px rgba(0, 217, 255, 0.3);
    }
    
    .stat-card.error::before {
      background: linear-gradient(90deg, var(--accent-red), var(--accent-orange));
    }
    
    .stat-card.warn::before {
      background: linear-gradient(90deg, var(--accent-orange), var(--accent-red));
    }
    
    .stat-card.info::before {
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
    }
    
    .stat-icon {
      font-size: 32px;
      margin-bottom: 8px;
      animation: bounce 2s infinite;
    }
    
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }
    
    .stat-value {
      font-size: 36px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-green));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      transition: all 0.3s ease;
    }
    
    .stat-card:hover .stat-value {
      transform: scale(1.1);
    }
    
    .stat-card.error .stat-value {
      background: linear-gradient(135deg, var(--accent-red), var(--accent-orange));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .stat-card.warn .stat-value {
      background: linear-gradient(135deg, var(--accent-orange), var(--accent-red));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .stat-card.info .stat-value {
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .stat-label {
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .stat-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, transparent, var(--accent-cyan), transparent);
      transform: scaleX(0);
      transition: transform 0.5s ease;
    }
    
    .stat-card:hover .stat-bar {
      transform: scaleX(1);
    }
    
    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      padding: 20px;
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }
    
    .filter-btn {
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      transition: all 0.2s ease;
      background: var(--bg-secondary);
      color: var(--text-secondary);
      border: 1px solid var(--border-color);
    }
    
    .filter-btn:hover {
      transform: translateY(-2px);
      border-color: var(--accent-cyan);
    }
    
    .filter-btn.active {
      background: var(--accent-cyan);
      color: var(--bg-primary);
      border-color: var(--accent-cyan);
    }
    
    .filter-btn[data-level="ERROR"].active { background: var(--accent-red); color: white; }
    .filter-btn[data-level="WARN"].active { background: var(--accent-orange); color: var(--bg-primary); }
    .filter-btn[data-level="INFO"].active { background: var(--accent-green); color: var(--bg-primary); }
    .filter-btn[data-level="DEBUG"].active { background: var(--accent-blue); color: white; }
    .filter-btn[data-level="TRACE"].active { background: var(--accent-purple); color: white; }
    
    .auto-scroll {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 15px;
      padding: 15px 20px;
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px solid var(--border-color);
    }
    
    .auto-scroll input {
      width: 18px;
      height: 18px;
      accent-color: var(--accent-cyan);
    }
    
    .clear-btn {
      margin-left: auto;
      padding: 10px 20px;
      background: var(--accent-red);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-family: inherit;
      transition: all 0.2s ease;
    }
    
    .clear-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(255, 68, 102, 0.4);
    }
    
    .log-container {
      background: var(--bg-card);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      padding: 20px;
      max-height: 65vh;
      overflow-y: auto;
      scroll-behavior: smooth;
    }
    
    .log-container::-webkit-scrollbar {
      width: 8px;
    }
    
    .log-container::-webkit-scrollbar-track {
      background: var(--bg-secondary);
      border-radius: 4px;
    }
    
    .log-container::-webkit-scrollbar-thumb {
      background: var(--accent-cyan);
      border-radius: 4px;
    }
    
    .log-entry {
      padding: 14px 18px;
      margin-bottom: 8px;
      border-radius: 10px;
      font-size: 13px;
      display: grid;
      grid-template-columns: 90px 85px 1fr;
      gap: 16px;
      align-items: start;
      animation: slideIn 0.3s ease;
      background: var(--bg-secondary);
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }
    
    .log-entry:hover {
      background: var(--bg-primary);
      border-color: var(--border-color);
      transform: translateX(4px);
    }
    
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    
    .log-time {
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
    }
    
    .log-level {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-block;
      text-align: center;
    }
    
    .log-level.ERROR {
      background: rgba(255, 68, 102, 0.15);
      color: var(--accent-red);
      border: 1px solid var(--accent-red);
    }
    
    .log-level.WARN {
      background: rgba(255, 170, 0, 0.15);
      color: var(--accent-orange);
      border: 1px solid var(--accent-orange);
    }
    
    .log-level.INFO {
      background: rgba(0, 255, 136, 0.15);
      color: var(--accent-green);
      border: 1px solid var(--accent-green);
    }
    
    .log-level.DEBUG {
      background: rgba(68, 136, 255, 0.15);
      color: var(--accent-blue);
      border: 1px solid var(--accent-blue);
    }
    
    .log-level.TRACE {
      background: rgba(170, 102, 255, 0.15);
      color: var(--accent-purple);
      border: 1px solid var(--accent-purple);
    }
    
    .log-message {
      color: var(--text-primary);
      word-break: break-word;
      line-height: 1.5;
    }
    
    .log-metadata {
      grid-column: 2 / -1;
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border-color);
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .metadata-item {
      background: var(--bg-primary);
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
    }
    
    .metadata-label {
      color: var(--accent-cyan);
      font-weight: 600;
    }
    
    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--accent-green);
      margin-right: 10px;
      animation: pulse 2s infinite;
      box-shadow: 0 0 10px var(--accent-green);
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    
    @keyframes shimmer {
      0% { opacity: 0.5; }
      50% { opacity: 1; }
      100% { opacity: 0.5; }
    }
    
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 5px var(--accent-cyan); }
      50% { box-shadow: 0 0 20px var(--accent-cyan), 0 0 30px var(--accent-cyan); }
    }
    
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    /* Mobile Responsive Design */
    @media (max-width: 768px) {
      body { padding: 12px; }
      .container { max-width: 100%; }
      h1 {
        font-size: 20px;
        flex-direction: column;
        align-items: flex-start;
      }
      .stats {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .stat-card { padding: 16px; }
      .stat-value { font-size: 28px; }
      .filters {
        padding: 12px;
        gap: 6px;
      }
      .filter-btn {
        padding: 8px 12px;
        font-size: 12px;
        flex: 1 1 calc(33.333% - 4px);
        min-width: 80px;
      }
      .auto-scroll {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
      }
      .checkbox-wrapper {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .clear-btn {
        width: 100%;
        margin-left: 0;
      }
      .log-entry {
        grid-template-columns: 1fr;
        gap: 8px;
        padding: 12px;
      }
      .log-time {
        font-size: 11px;
        opacity: 0.7;
      }
      .log-level {
        align-self: flex-start;
        padding: 3px 8px;
        font-size: 11px;
      }
      .log-message {
        font-size: 12px;
      }
      .log-metadata {
        grid-column: 1 / -1;
        font-size: 10px;
        gap: 6px;
      }
      .metadata-item {
        padding: 2px 6px;
        font-size: 10px;
      }
    }

    @media (max-width: 480px) {
      body { padding: 8px; }
      h1 { font-size: 18px; }
      .stat-value { font-size: 24px; }
      .stat-label { font-size: 11px; }
      .filter-btn {
        flex: 1 1 calc(50% - 4px);
        font-size: 11px;
        padding: 6px 10px;
      }
      .log-container {
        padding: 12px;
        max-height: 60vh;
      }
      .empty-state { padding: 40px 16px; }
      .empty-state-icon { font-size: 40px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      <span class="status-indicator"></span>
      🚀 Bandwidth Hero - Live Monitor
    </h1>
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
      <label for="autoScroll">📜 Auto-scroll to latest logs</label>
      <button class="clear-btn" onclick="clearLogs()">🗑 Clear Logs</button>
    </div>
    <div class="log-container" id="logContainer"></div>
  </div>
  <script>
    let currentFilter = 'ALL';
    let lastLogTimestamp = null;
    const logContainer = document.getElementById('logContainer');
    const autoScrollCheckbox = document.getElementById('autoScroll');
    const statusDot = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-indicator + span');
    
    // Poll logs every 2 seconds - client-side processing
    function pollLogs() {
      fetch('/monitor/logs?limit=100')
        .then(r => r.json())
        .then(data => {
          statusDot.classList.remove('error');
          statusDot.style.background = '#00ff88';
          statusText.textContent = 'Connected';
          let logs = data.logs;
          if (currentFilter !== 'ALL') logs = logs.filter(log => log.level === currentFilter);
          logs = logs.reverse();
          const newestTimestamp = logs.length > 0 ? logs[0].timestamp : null;
          if (newestTimestamp !== lastLogTimestamp) {
            lastLogTimestamp = newestTimestamp;
            renderLogs(logs);
          }
        })
        .catch(() => {
          statusDot.classList.add('error');
          statusDot.style.background = '#ff4466';
          statusText.textContent = 'Disconnected';
        });
    }
    function renderLogs(logs) {
      const emptyState = logContainer.querySelector('.empty-state');
      if (logs.length === 0) {
        if (!emptyState) logContainer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📡</div><div>No logs yet</div></div>';
        return;
      }
      if (emptyState) emptyState.remove();
      logContainer.innerHTML = '';
      logs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = '<div class="log-time">' + new Date(log.timestamp).toLocaleTimeString() + '</div>' +
          '<div class="log-level ' + log.level + '">' + log.level + '</div>' +
          '<div class="log-message">' + escapeHtml(log.message) + '</div>' +
          getMetadataHtml(log);
        logContainer.appendChild(entry);
      });
      if (autoScrollCheckbox.checked) logContainer.scrollTop = 0;
    }
    function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
    function getMetadataHtml(log) {
      const exclude = ['timestamp', 'level', 'message'];
      const metadata = Object.entries(log).filter(([key]) => !exclude.includes(key)).map(([key, value]) => key + ': ' + (typeof value === 'object' ? JSON.stringify(value) : String(value)));
      if (metadata.length === 0) return '';
      return '<div class="log-metadata">' + metadata.join(' | ') + '</div>';
    }
    function clearLogs() { logContainer.innerHTML = ''; }
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
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
