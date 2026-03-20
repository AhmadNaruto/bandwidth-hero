import { test, describe, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import pick from "../util/pick.js";
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

describe("util/pick.js", () => {
    test("should filter headers correctly", () => {
        const headers = {
            "user-agent": "Mozilla/5.0",
            "cookie": "session=123",
            "x-ignored": "should-not-exist"
        };
        const whitelist = ["user-agent", "cookie"];
        const result = pick(headers, whitelist);

        expect(result["user-agent"]).toBe("Mozilla/5.0");
        expect(result["cookie"]).toBe("session=123");
        expect(result["x-ignored"]).toBeUndefined();
    });

    test("should handle empty source object", () => {
        const result = pick({}, ["user-agent"]);
        expect(result).toEqual({});
    });

    test("should handle null source", () => {
        const result = pick(null, ["user-agent"]);
        expect(result).toEqual({});
    });

    test("should handle case-insensitive matching", () => {
        const headers = {
            "User-Agent": "Mozilla/5.0",
            "COOKIE": "session=123"
        };
        const whitelist = ["user-agent", "cookie"];
        const result = pick(headers, whitelist);

        expect(result["user-agent"]).toBe("Mozilla/5.0");
        expect(result["cookie"]).toBe("session=123");
    });
});

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
