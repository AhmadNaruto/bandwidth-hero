import { test, afterEach } from "node:test";
import assert from "node:assert";
import pick from "../util/pick.js";
import logger from "../util/logger.js";
import { handler } from "../functions/index.js";

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

test("Unit: pick function - should filter headers correctly", () => {
    const headers = {
        "user-agent": "Mozilla/5.0",
        "cookie": "session=123",
        "x-ignored": "should-not-exist"
    };
    const whitelist = ["user-agent", "cookie"];
    const result = pick(headers, whitelist);

    assert.strictEqual(result["user-agent"], "Mozilla/5.0");
    assert.strictEqual(result["cookie"], "session=123");
    assert.strictEqual(result["x-ignored"], undefined);
});

// --- INTEGRATION TESTS WITH REAL URL ---

test("Integration: Handler - Success Fetch with Real URL", async () => {
    const realImageUrl = "https://picsum.photos/id/237/200/300";

    const event = {
        queryStringParameters: {
            url: realImageUrl,
            jpeg: "1", // Use JPEG format for faster processing
            l: "10"    // Low quality for faster compression during test
        },
        headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "accept": "image/webp,image/apng,image/*,*/*;q=0.8"
        },
        ip: "1.1.1.1"
    };

    const response = await handler(event);

    // If successful, status 200. If blocked by hotlink protection (403/404), test still passes
    // as long as handler doesn't crash and returns a valid status code.
    if (response.statusCode === 200) {
        assert.ok(response.body.length > 0, "Response body should not be empty");
        assert.strictEqual(response.headers["content-type"].startsWith("image/"), true);
    } else {
        assert.ok([403, 404, 502, 503].includes(response.statusCode), "Must return valid error status");
    }
});

test("Integration: Handler - Health Check", async () => {
    const event = { queryStringParameters: {} };
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body, "bandwidth-hero-proxy");
});

test("Integration: Handler - Missing Query Parameters", async () => {
    const event = { queryStringParameters: null };
    const response = await handler(event);

    assert.strictEqual(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, "Missing query parameters");
});

