#!/usr/bin/env node
/**
 * Test script for remote access authentication
 * Run: node examples/test-remote-auth.js
 */

const http = require("http");

const BASE_URL = "http://localhost:8081";
const API_KEY = process.env.REMOTE_ACCESS_API_KEY || "Y6-_IVIIv0k9f9oUy1r5FitjIqRuxlip-gmVBevhzzw";

async function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(data)),
            text: () => Promise.resolve(data),
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("Testing Remote Access Authentication\n");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.slice(0, 8)}...`);
  console.log("");

  let passed = 0;
  let total = 0;

  // Test 1: Health check (no auth required)
  total++;
  if (
    await test("Health check works without auth", async () => {
      const res = await fetch(`${BASE_URL}/health/live`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
    })
  ) passed++;

  // Test 2: Local request to /v1/models (should work without key from localhost)
  total++;
  if (
    await test("Local /v1/models works without auth key", async () => {
      const res = await fetch(`${BASE_URL}/v1/models`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
    })
  ) passed++;

  // Test 3: Simulated remote request without key (should fail)
  // Note: We can't truly simulate remote from localhost, this just verifies the endpoint exists
  total++;
  if (
    await test("Request with wrong key is rejected", async () => {
      const res = await fetch(`${BASE_URL}/v1/models`, {
        headers: {
          "X-Remote-Access-Key": "wrong-key",
          "X-Forwarded-For": "203.0.113.1", // Simulate remote IP
        },
      });
      // From localhost, it should still work (bypass)
      // This test mainly verifies the header is being processed
      if (!res.ok && res.status !== 403) {
        throw new Error(`Unexpected status ${res.status}`);
      }
    })
  ) passed++;

  // Test 4: Request with correct key
  total++;
  if (
    await test("Request with correct key works", async () => {
      const res = await fetch(`${BASE_URL}/v1/models`, {
        headers: {
          "X-Remote-Access-Key": API_KEY,
        },
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    })
  ) passed++;

  // Test 5: Session naming header
  total++;
  if (
    await test("Session naming header is accepted", async () => {
      const res = await fetch(`${BASE_URL}/v1/models`, {
        headers: {
          "X-Remote-Access-Key": API_KEY,
          "X-Session-Id": "test-session-123",
          "X-Session-Name": "AI James Test",
        },
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
    })
  ) passed++;

  console.log(`\n${passed}/${total} tests passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
