const pick = require("../util/pick");
const logger = require("../util/logger");
const { test, expect } = require("@jest/globals");

// Mock the sharp module since it may not be available in all environments
jest.mock('../util/compress', () => {
  return jest.fn((imagePath, useWebp, grayscale, quality, originalSize) => {
    return Promise.resolve({
      err: null,
      output: Buffer.from('mock-compressed-data'),
      headers: {
        'content-type': useWebp ? 'image/webp' : 'image/jpeg',
        'content-length': 5000,
        'x-original-size': originalSize,
        'x-bytes-saved': originalSize - 5000
      }
    });
  });
});

// Also mock fetch since it's not available in Node environments without it
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: {
      entries: () => [['content-type', 'image/jpeg'], ['content-length', '10000']]
    },
    arrayBuffer: () => Promise.resolve(Buffer.from('mock-image-data'))
  })
);

const { handler } = require("../functions/index");

// Mock console.log to capture logs during tests
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

test("handler returns correct response when no url query parameter is provided", async () => {
  const event = {
    queryStringParameters: {},
  };

  const response = await handler(event);

  expect(response.statusCode).toBe(200);
  expect(response.body).toBe("bandwidth-hero-proxy");
});

test("pick function forwards browser headers correctly", () => {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    "cookie": "session=abc123",
    "dnt": "1",
    "referer": "https://example.com",
    "host": "should-not-be-picked",
    "authorization": "should-not-be-picked"
  };

  const picked = pick(headers, ["cookie", "dnt", "referer", "user-agent", "accept", "accept-language", "accept-encoding"]);

  expect(picked["user-agent"]).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  expect(picked["accept"]).toBe("image/webp,image/apng,image/*,*/*;q=0.8");
  expect(picked["accept-language"]).toBe("en-US,en;q=0.9");
  expect(picked["accept-encoding"]).toBe("gzip, deflate, br");
  expect(picked["cookie"]).toBe("session=abc123");
  expect(picked["dnt"]).toBe("1");
  expect(picked["referer"]).toBe("https://example.com");
  expect(picked["host"]).toBeUndefined();
  expect(picked["authorization"]).toBeUndefined();
});

test("logger creates properly formatted log entries", () => {
  // Test the logger utility directly
  const testMessage = "Test log message";
  const testMeta = { testValue: 42, anotherField: "hello" };

  // Capture the logged entry
  logger.info(testMessage, testMeta);

  // Check that console.log was called with a JSON string
  expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringMatching(/^\{.*\}$/));
});

test("logCompressionProcess creates correct log entry", () => {
  const details = {
    url: "https://example.com/image.jpg",
    originalSize: 100000,
    compressedSize: 50000,
    format: "webp",
    quality: 80,
    grayscale: false,
    compressionRatio: 0.5,
    processingTime: 100
  };

  logger.logCompressionProcess(details);

  expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringMatching(/"message":"Image compressed successfully"/));
  expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringMatching(/"compressionRatio":0.5/));
});

afterEach(() => {
  // Clear mock calls between tests
  mockConsoleLog.mockClear();
});
