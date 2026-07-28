import assert from "node:assert/strict";
import fs from "node:fs";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import { providerStatus } from "../server/lib/env.js";
import { handlePlannerAction } from "../server/lib/planner-actions.js";
import { mockDestinationResearch } from "../server/lib/mock-provider.js";
import { buildPlanningSourceDiagnostics, isPresetDestinationProfile } from "../server/lib/production-safeguards.js";

const appSource = fs.readFileSync("src/app.js", "utf8");
assert.equal(appSource.includes("recoverUnsupportedPlan"), false);
assert.equal(appSource.includes("resolveDestinationProfile"), false);
assert.equal(appSource.includes("RouteMosaic did not substitute Los Angeles"), false);

const plannerActionsSource = fs.readFileSync("server/lib/planner-actions.js", "utf8");
assert.equal(plannerActionsSource.includes("provider: \"curated\""), false);
assert.equal(plannerActionsSource.includes("resolveDestinationProfile"), false);
assert.equal(plannerActionsSource.includes("Try the Los Angeles sample or configure live providers"), false);

const envSource = fs.readFileSync("server/lib/env.js", "utf8");
assert.ok(envSource.includes("LIVE_PLACE_PROVIDER_REQUIRED"));
assert.ok(envSource.includes("LIVE_ROUTE_PROVIDER_REQUIRED"));

const originalEnv = snapshotEnv();
process.env.NODE_ENV = "production";
process.env.VERCEL_ENV = "production";
process.env.PLACE_PROVIDER = "mock";
process.env.ROUTE_PROVIDER = "mock";
process.env.PLACE_API_KEY = "secret-place";
process.env.ROUTE_API_KEY = "secret-route";
process.env.AI_PROVIDER = "";
process.env.AI_API_KEY = "";

const productionMockStatus = providerStatus();
assert.equal(productionMockStatus.canGenerate, false);
assert.equal(productionMockStatus.mode, "unavailable");
assert.ok(!JSON.stringify(productionMockStatus).includes("secret-place"));
assert.ok(!JSON.stringify(productionMockStatus).includes("secret-route"));

const trip = createTripDraft();
trip.from = "Austin, Texas, United States";
trip.fromDisplay = trip.from;
trip.destination = "Charlotte, North Carolina, United States";
trip.destinationDisplay = trip.destination;
trip.startDate = "2026-08-08";
trip.endDate = "2026-08-10";
trip.days = 3;
syncTravelersToCounts(trip);

const blockedMissingProfile = await handlePlannerAction("generate-trip", { trip });
assert.equal(blockedMissingProfile.status, 503);
assert.equal(blockedMissingProfile.body.error.code, "PROVIDER_CONFIGURATION_REQUIRED");
assert.equal(JSON.stringify(blockedMissingProfile.body).includes("Vercel"), false);
assert.equal(JSON.stringify(blockedMissingProfile.body).includes("PLACE_PROVIDER"), false);

const mockProfile = mockDestinationResearch("Charlotte, North Carolina, United States", trip);
const blockedMockProfile = await handlePlannerAction("generate-trip", { trip, destinationProfile: mockProfile });
assert.equal(blockedMockProfile.status, 503);
assert.equal(blockedMockProfile.body.error.code, "PROVIDER_CONFIGURATION_REQUIRED");

process.env.PLACE_PROVIDER = "openrouteservice";
process.env.ROUTE_PROVIDER = "openrouteservice";
process.env.OPENROUTESERVICE_API_KEY = "secret-ors";
process.env.AI_PROVIDER = "openai";
process.env.AI_API_KEY = "secret-openai";

const liveStatus = providerStatus();
assert.equal(liveStatus.canGenerate, true);
assert.equal(liveStatus.mode, "live");
assert.equal(JSON.stringify(liveStatus).includes("secret-ors"), false);
assert.equal(JSON.stringify(liveStatus).includes("secret-openai"), false);

assert.equal(isPresetDestinationProfile(mockProfile), true);
const liveProfile = {
  ...mockProfile,
  id: "openai-charlotte-north-carolina",
  sourceMetadata: { provider: "openai", freshness: "live-generated" }
};
const diagnostics = buildPlanningSourceDiagnostics(providerStatusConfig(), liveProfile);
assert.equal(diagnostics.planningMode, "live");
assert.equal(diagnostics.itinerarySource, "generated");
assert.equal(diagnostics.usedPresetPlan, false);
assert.equal(diagnostics.usedMockProvider, false);

restoreEnv(originalEnv);

console.log("No-hardcoded-plan production guard tests passed");

function providerStatusConfig() {
  return {
    production: true,
    development: false,
    placeProvider: "openrouteservice",
    routeProvider: "openrouteservice",
    aiProvider: "openai"
  };
}

function snapshotEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PLACE_PROVIDER: process.env.PLACE_PROVIDER,
    ROUTE_PROVIDER: process.env.ROUTE_PROVIDER,
    PLACE_API_KEY: process.env.PLACE_API_KEY,
    ROUTE_API_KEY: process.env.ROUTE_API_KEY,
    OPENROUTESERVICE_API_KEY: process.env.OPENROUTESERVICE_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY
  };
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
