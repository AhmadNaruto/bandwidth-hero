import { test, describe, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import shouldCompress from "../util/shouldCompress.js";
import logger from "../util/logger.js";

/**
 * MOCKING SECTION
 * Mock console.log to keep terminal clean during testing.
 */
const originalLog = console.log;
let mockedLogs = [];

beforeEach(() => {
    mockedLogs = [];
    console.log = (...args) => {
        mockedLogs.push(args.join(" "));
    };
});

afterEach(() => {
    console.log = originalLog;
    mockedLogs = [];
});

// --- UNIT TESTS ---

describe("util/shouldCompress.js", () => {
    test("should return false for non-image content type", () => {
        expect(shouldCompress("text/html", 10000, false)).toBe(false);
    });

    test("should return false for small images", () => {
        expect(shouldCompress("image/jpeg", 1000, false)).toBe(false);
    });

    test("should return false for very large images", () => {
        expect(shouldCompress("image/jpeg", 6 * 1024 * 1024, false)).toBe(false);
    });

    test("should return true for normal JPEG images", () => {
        expect(shouldCompress("image/jpeg", 50000, false)).toBe(true);
    });

    test("should return false for small PNG images", () => {
        expect(shouldCompress("image/png", 50000, false)).toBe(false);
    });

    test("should return true for large PNG images", () => {
        expect(shouldCompress("image/png", 150000, false)).toBe(true);
    });

    test("should return false for invalid input", () => {
        expect(shouldCompress(null, 10000, false)).toBe(false);
        expect(shouldCompress("image/jpeg", "not-a-number", false)).toBe(false);
    });
});

describe("util/logger.js", () => {
    test("should format bytes correctly", () => {
        expect(logger.formatBytes(1024)).toContain("KB");
        expect(logger.formatBytes(1048576)).toContain("MB");
    });

    test("should handle zero bytes", () => {
        expect(logger.formatBytes(0)).toBe("0 Bytes");
    });
});

describe("Health Check", () => {
    // TODO: Add integration test with actual HTTP request to /health endpoint
    test.skip("health endpoint should return plain text", () => {
        // Placeholder - needs proper integration test with supertest or similar
        expect("bandwidth-hero-proxy").toBe("bandwidth-hero-proxy");
    });
});
