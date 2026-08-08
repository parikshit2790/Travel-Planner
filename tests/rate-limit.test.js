import assert from "node:assert/strict";
import fs from "node:fs";
import { checkRateLimit, clientIpFrom } from "../server/lib/rate-limit.js";

const first = checkRateLimit("test-key-a", { maxRequests: 3, windowMs: 60000 });
assert.equal(first.allowed, true);
const second = checkRateLimit("test-key-a", { maxRequests: 3, windowMs: 60000 });
assert.equal(second.allowed, true);
const third = checkRateLimit("test-key-a", { maxRequests: 3, windowMs: 60000 });
assert.equal(third.allowed, true);
const fourth = checkRateLimit("test-key-a", { maxRequests: 3, windowMs: 60000 });
assert.equal(fourth.allowed, false, "A 4th request within the window over a limit of 3 must be rejected");
assert.ok(Number.isFinite(fourth.retryAfterSeconds) && fourth.retryAfterSeconds > 0);

const unrelated = checkRateLimit("test-key-b", { maxRequests: 1, windowMs: 60000 });
assert.equal(unrelated.allowed, true, "A different key must have its own independent bucket");

const afterWindow = checkRateLimit("test-key-c", { maxRequests: 1, windowMs: 1 });
assert.equal(afterWindow.allowed, true);
await new Promise((resolve) => setTimeout(resolve, 5));
const afterWindowExpired = checkRateLimit("test-key-c", { maxRequests: 1, windowMs: 1 });
assert.equal(afterWindowExpired.allowed, true, "A new window must reset the count once the previous window has elapsed");

assert.equal(clientIpFrom({ headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }), "203.0.113.5", "Must use the first (client) address in a forwarded chain");
assert.equal(clientIpFrom({ headers: { "x-real-ip": "203.0.113.9" } }), "203.0.113.9");
assert.equal(clientIpFrom({ headers: {}, socket: { remoteAddress: "203.0.113.10" } }), "203.0.113.10");
assert.equal(clientIpFrom({ headers: {} }), "unknown");

const plannerApi = fs.readFileSync("api/planner.js", "utf8");
assert.ok(plannerApi.includes("checkRateLimit"), "The planner API route must apply rate limiting");
assert.ok(plannerApi.includes("RATE_LIMITED"));
assert.ok(/research-destination.*generate-trip|generate-trip.*research-destination/s.test(plannerApi), "The AI-calling actions must be identified for the stricter limit");

const locationsApi = fs.readFileSync("api/locations.js", "utf8");
assert.ok(locationsApi.includes("checkRateLimit"), "The locations API route must apply rate limiting");

console.log("Rate limit tests passed");
