// server.js - Production-ready Express server for VPS deployment
import express from "express";
import { createServer } from "node:http";
import { compress } from "node:zlib";
import { handler } from "./functions/index.js";

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Security & Performance middleware
app.disable("x-powered-by"); // Hide Express version

// Request size limit (10MB max for images)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Response compression for JSON responses
app.use(compress({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
}));

// Request timeout middleware (60 seconds max)
const requestTimeout = 60000;
app.use((req, res, next) => {
  req.setTimeout(requestTimeout, () => {
    res.status(408).json({ error: "Request timeout" });
  });
  next();
});

// Health check endpoint (lightweight, no compression)
app.get("/health", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send("bandwidth-hero-proxy");
});

// Readiness check endpoint
app.get("/ready", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send("ok");
});

// Main proxy endpoint with proper error handling
app.get("/api/index", async (req, res) => {
  const startTime = Date.now();
  
  // Set timeout for entire request
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  }, requestTimeout);

  try {
    const event = {
      queryStringParameters: req.query,
      headers: req.headers,
      ip: req.ip || req.connection.remoteAddress || "unknown",
    };

    const response = await handler(event);
    clearTimeout(timeout);

    // Set response headers
    if (response.headers) {
      Object.entries(response.headers).forEach(([key, value]) => {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      });
    }

    // Send response
    res.status(response.statusCode || 200).send(response.body);
    
    // Log request duration in production
    if (NODE_ENV === "production") {
      const duration = Date.now() - startTime;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: "Request completed",
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: event.ip
      }));
    }
  } catch (error) {
    clearTimeout(timeout);
    
    // Log error
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message: "Request failed",
      path: req.path,
      error: error.message,
      stack: NODE_ENV === "development" ? error.stack : undefined,
      ip: req.ip || req.connection.remoteAddress
    }));

    if (!res.headersSent) {
      res.status(500).json({ 
        error: NODE_ENV === "production" ? "Internal server error" : error.message 
      });
    }
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Unhandled error",
    error: err.message,
    stack: NODE_ENV === "development" ? err.stack : undefined
  }));

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({ 
    error: NODE_ENV === "production" ? "Internal server error" : err.message 
  });
});

// Create HTTP server
const server = createServer(app);

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    message: `Received ${signal}. Starting graceful shutdown...`
  }));

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        message: "Error during server close",
        error: err.message
      }));
      process.exit(1);
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message: "HTTP server closed. Exiting process."
    }));
    
    // Close all connections forcefully after timeout
    setTimeout(() => {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "WARN",
        message: "Forced shutdown after timeout"
      }));
      process.exit(1);
    }, 10000);
  });

  // Close database connections, cleanup, etc. here if needed
  // For this app, we just need to close the HTTP server
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Uncaught exception",
    error: err.message,
    stack: err.stack
  }));
  
  // Attempt graceful shutdown
  gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Unhandled rejection",
    reason: reason?.message || reason,
    stack: reason?.stack
  }));
});

// Start server
server.listen(PORT, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "INFO",
    message: "Bandwidth Hero Proxy started",
    port: PORT,
    environment: NODE_ENV,
    health: `http://localhost:${PORT}/health`,
    ready: `http://localhost:${PORT}/ready`,
    api: `http://localhost:${PORT}/api/index`
  }));
});

// Handle server errors
server.on("error", (err) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    message: "Server error",
    error: err.message,
    code: err.code
  }));
});

export default app;
