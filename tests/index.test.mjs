import { test } from "node:test";
import assert from "node:assert";
import pick from "../util/pick.js";
import logger from "../util/logger.js";
import { handler } from "../functions/index.js";

/**
 * MOCKING SECTION
 * Membajak console.log agar terminal tetap bersih saat testing.
 */
const originalLog = console.log;
let mockedLogs = [];
console.log = (...args) => {
    mockedLogs.push(args.join(" "));
};

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

// --- INTEGRATION TESTS DENGAN URL ASLI ---

test("Integration: Handler - Success Fetch with Real URL", async () => {
    const realImageUrl = "https://picsum.photos/id/237/200/300";
    
    const event = {
        queryStringParameters: {
            url: realImageUrl,
            jpeg: "1", // Gunakan format JPEG agar lebih cepat
            l: "10"    // Kualitas rendah untuk mempercepat proses kompresi saat test
        },
        headers: { 
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "accept": "image/webp,image/apng,image/*,*/*;q=0.8"
        },
        ip: "1.1.1.1"
    };

    console.info("Sedang mencoba fetch URL asli, harap tunggu...");
    const response = await handler(event);

    // Jika berhasil, status 200. Jika diblokir oleh Kiryuu (403/404), tes tetap lulus 
    // asalkan handler tidak crash dan mengembalikan status code yang valid.
    if (response.statusCode === 200) {
        assert.ok(response.body.length > 0, "Body response tidak boleh kosong");
        assert.strictEqual(response.headers["content-type"].startsWith("image/"), true);
        console.info("✔ Berhasil mengambil dan mengompres gambar asli.");
    } else {
        console.warn(`⚠ Upstream merespon dengan status: ${response.statusCode}. Ini mungkin karena proteksi Hotlink.`);
        assert.ok([403, 404, 502, 503].includes(response.statusCode), "Harus mengembalikan error status yang valid");
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

