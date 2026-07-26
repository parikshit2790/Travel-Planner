import assert from "node:assert/strict";
import { providerConfig } from "../server/lib/env.js";
import { handlePlannerAction } from "../server/lib/planner-actions.js";
import { clearDestinationResearchCache } from "../server/lib/destination-cache.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

try {
  process.env.PROVIDER_TIMEOUT_MS = "11000";
  process.env.GOOGLE_REQUEST_TIMEOUT_MS = "9000";
  process.env.OPENAI_REQUEST_TIMEOUT_MS = "41000";
  process.env.PLANNER_REQUEST_TIMEOUT_MS = "56000";
  process.env.FRONTEND_GENERATION_TIMEOUT_MS = "66000";
  const config = providerConfig();
  assert.equal(config.timeoutMs, 11000);
  assert.equal(config.googleRequestTimeoutMs, 9000);
  assert.equal(config.openAiRequestTimeoutMs, 41000);
  assert.equal(config.plannerRequestTimeoutMs, 56000);
  assert.equal(config.frontendGenerationTimeoutMs, 66000);
  assert.ok(config.frontendGenerationTimeoutMs > config.plannerRequestTimeoutMs);
  assert.ok(config.plannerRequestTimeoutMs > config.openAiRequestTimeoutMs);
  assert.ok(config.openAiRequestTimeoutMs > config.googleRequestTimeoutMs);

  resetEnv();
  process.env.VERCEL_ENV = "development";
  process.env.PLACE_PROVIDER = "mock";
  process.env.ROUTE_PROVIDER = "mock";
  process.env.CACHE_TTL_SECONDS = "120";
  clearDestinationResearchCache();
  const first = await handlePlannerAction("research-destination", { trip: tripFixture({ destination: "Paris, France", destinationDisplay: "Paris, France", schedule: { pace: "Balanced" } }) }, { requestId: "cache-first" });
  assert.equal(first.status, 200);
  assert.equal(first.body.diagnostics.cache, "miss");
  const second = await handlePlannerAction("research-destination", { trip: tripFixture({ destination: "Paris, France", destinationDisplay: "Paris, France", schedule: { pace: "Packed" }, adults: 4 }) }, { requestId: "cache-second" });
  assert.equal(second.status, 200);
  assert.equal(second.body.diagnostics.cache, "hit");

  resetEnv();
  process.env.VERCEL_ENV = "development";
  process.env.PLACE_PROVIDER = "mock";
  process.env.ROUTE_PROVIDER = "mock";
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "secret-openai-key";
  process.env.OPENAI_REQUEST_TIMEOUT_MS = "5";
  process.env.PLANNER_REQUEST_TIMEOUT_MS = "500";
  clearDestinationResearchCache();
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
  const timeout = await handlePlannerAction("research-destination", { trip: tripFixture({ destination: "Paris, France", destinationDisplay: "Paris, France" }) }, { requestId: "ai-timeout" });
  assert.equal(timeout.status, 504);
  assert.equal(timeout.body.error.code, "AI_TIMEOUT");
  assert.equal(timeout.body.error.retryable, true);
  assert.ok(!JSON.stringify(timeout.body).includes("secret-openai-key"));

  resetEnv();
  process.env.VERCEL_ENV = "development";
  process.env.PLACE_PROVIDER = "google";
  process.env.ROUTE_PROVIDER = "google";
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "secret-openai-key";
  process.env.GOOGLE_MAPS_API_KEY = "secret-google-key";
  process.env.OPENAI_REQUEST_TIMEOUT_MS = "500";
  process.env.PLANNER_REQUEST_TIMEOUT_MS = "5";
  clearDestinationResearchCache();
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
  const plannerTimeout = await handlePlannerAction("research-destination", { trip: tripFixture() }, { requestId: "planner-timeout" });
  assert.equal(plannerTimeout.status, 504);
  assert.equal(plannerTimeout.body.error.code, "PLANNER_TIMEOUT");
  assert.equal(plannerTimeout.body.error.retryable, true);
  assert.ok(!JSON.stringify(plannerTimeout.body).includes("secret-google-key"));
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  clearDestinationResearchCache();
}

console.log("Planner timeout and cache tests passed");

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.NODE_ENV;
}

function tripFixture(overrides = {}) {
  return {
    from: "Austin, Texas, United States",
    fromDisplay: "Austin, Texas, United States",
    destination: "Raleigh, North Carolina, United States",
    destinationDisplay: "Raleigh, North Carolina, United States",
    startDate: "2026-08-08",
    endDate: "2026-08-10",
    days: 3,
    adults: 1,
    children: 0,
    seniors: 0,
    transportation: "Fly and rent a car",
    schedule: { pace: "Balanced", majorActivities: 2, ...(overrides.schedule || {}) },
    ...overrides
  };
}
