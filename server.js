// server.js - Express server for VPS deployment
import express from "express";
import { handler } from "./functions/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get("/health", (req, res) => {
  res.send("bandwidth-hero-proxy");
});

// Main proxy endpoint
app.get("/api/index", async (req, res) => {
  const event = {
    queryStringParameters: req.query,
    headers: req.headers,
    ip: req.ip || req.connection.remoteAddress,
  };

  try {
    const response = await handler(event);
    
    // Set response headers
    Object.entries(response.headers || {}).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Send response
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Bandwidth Hero Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API endpoint: http://localhost:${PORT}/api/index`);
});
