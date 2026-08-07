import assert from "node:assert/strict";
import fs from "node:fs";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import { handleLocationAction } from "../server/lib/location-actions.js";
import { handlePlannerAction, planRejectionMessage } from "../server/lib/planner-actions.js";
import { handleProviderHealthAction } from "../server/lib/provider-health-actions.js";
import plannerHandler from "../api/planner.js";
import providerHealthHandler from "../api/provider-health.js";

const apiRouteFiles = fs.readdirSync("api").filter((entry) => /\.(js|ts)$/.test(entry)).sort();
assert.deepEqual(apiRouteFiles, ["locations.js", "planner.js", "provider-health.js"]);

const actionResponse = fs.readFileSync("server/lib/action-response.js", "utf8");
assert.ok(actionResponse.includes("METHOD_NOT_ALLOWED"));
assert.ok(actionResponse.includes("ACTION_REQUIRED") || fs.readFileSync("api/planner.js", "utf8").includes("ACTION_REQUIRED"));
assert.equal(/\.\.\/\.\.\/src\/[^"']+\?v=/.test(fs.readFileSync("server/lib/planner-actions.js", "utf8")), false);

const unknownPlanner = await handlePlannerAction("not-real", {});
assert.equal(unknownPlanner.status, 400);
assert.equal(unknownPlanner.body.error.code, "UNKNOWN_ACTION");
assert.ok(unknownPlanner.body.requestId);

const invalidTrip = await handlePlannerAction("generate-trip", {});
assert.equal(invalidTrip.status, 400);
assert.equal(invalidTrip.body.error.code, "TRIP_REQUIRED");

const invalidDestination = await handlePlannerAction("research-destination", { trip: { destination: "" } });
assert.equal(invalidDestination.status, 400);
assert.equal(invalidDestination.body.error.code, "DESTINATION_REQUIRED");

const research = await handlePlannerAction("research-destination", { trip: { destination: "New York, United States" } });
assert.equal(research.status, 200);
assert.equal(research.body.profile.canonicalName, "New York, United States");
assert.ok(JSON.stringify(research.body.profile).includes("Central Park"));
assert.ok(!JSON.stringify(research.body.profile).includes("Santa Monica Pier"));

const trip = createTripDraft();
trip.from = "Charlotte, North Carolina, United States";
trip.fromDisplay = trip.from;
trip.destination = "New York, United States";
trip.destinationDisplay = trip.destination;
trip.startDate = "2026-08-20";
trip.endDate = "2026-08-24";
trip.days = 5;
trip.adults = 2;
trip.groupType = "Couple trip";
syncTravelersToCounts(trip);
const generated = await handlePlannerAction("generate-trip", { trip, destinationProfile: research.body.profile });
assert.equal(generated.status, 200);
assert.equal(generated.body.status, "ready");
assert.ok(JSON.stringify(generated.body.plan).includes("Central Park"));
assert.ok(!JSON.stringify(generated.body.plan).includes("Detroit RiverWalk"));

const charlotteResearch = await handlePlannerAction("research-destination", { trip: { destination: "Charlotte, North Carolina, United States" } });
assert.equal(charlotteResearch.status, 200);
assert.ok(JSON.stringify(charlotteResearch.body.profile).includes("NASCAR Hall of Fame"));
const unsupportedResearch = await handlePlannerAction("research-destination", { trip: { destination: "Atlantis" } });
assert.equal(unsupportedResearch.status, 422);
assert.equal(unsupportedResearch.body.error.code, "MOCK_DESTINATION_UNAVAILABLE");
assert.equal(unsupportedResearch.body.error.retryable, false);

const regeneratedDay = await handlePlannerAction("regenerate-day", { plan: generated.body.plan, dayId: generated.body.plan.days[0].id });
assert.equal(regeneratedDay.status, 200);
assert.equal(regeneratedDay.body.plan.days.length, generated.body.plan.days.length);

const regeneratedMeals = await handlePlannerAction("regenerate-meals", { plan: generated.body.plan });
assert.equal(regeneratedMeals.status, 200);
assert.equal(regeneratedMeals.body.plan.days.length, generated.body.plan.days.length);

const alternatives = await handlePlannerAction("get-alternatives", { plan: generated.body.plan, itemId: generated.body.plan.days[0].scheduleItems.find((item) => item.type === "activity").id });
assert.equal(alternatives.status, 200);
assert.ok(Array.isArray(alternatives.body.alternatives));

const route = await handlePlannerAction("estimate-route", { origin: "Charlotte", destination: "New York", mode: "driving" });
assert.equal(route.status, 200);
assert.ok(route.body.estimate.distanceMiles > 0);

const weather = await handlePlannerAction("weather-summary", { destination: "New York", startDate: "2026-08-20", endDate: "2026-08-24" });
assert.equal(weather.status, 200);
assert.equal(weather.body.guidance.type, "seasonal");

const location = await handleLocationAction("search", { query: "New York" });
assert.equal(location.status, 200);
assert.ok(location.body.results.length >= 1);
assert.equal("provider" in location.body, false);
assert.equal("provider" in location.body.results[0], false);

const sanLocation = await handleLocationAction("search", { query: "san" });
assert.equal(sanLocation.status, 200);
assert.ok(sanLocation.body.results.length >= 5);
assert.equal(sanLocation.body.results[0].canonicalName, "San Jose, California, United States");
assert.equal(sanLocation.body.results.some((item) => item.canonicalName.toLowerCase() === "san"), false);

const charlotteLocation = await handleLocationAction("search", { query: "charlotte" });
assert.equal(charlotteLocation.status, 200);
assert.equal(charlotteLocation.body.results[0].canonicalName, "Charlotte, North Carolina, United States");

const unknownLocation = await handleLocationAction("nope", {});
assert.equal(unknownLocation.status, 400);
assert.equal(unknownLocation.body.error.code, "UNKNOWN_ACTION");

process.env.PLACE_API_KEY = "secret-place-value";
process.env.ROUTE_API_KEY = "secret-route-value";
const health = await handleProviderHealthAction("status");
assert.equal(health.status, 200);
assert.ok(["mock", "live", "unavailable"].includes(health.body.mode));
assert.equal(typeof health.body.placeProviderAvailable, "boolean");
assert.equal(typeof health.body.destinationResearchAvailable, "boolean");
assert.equal(typeof health.body.routeProviderAvailable, "boolean");
assert.equal(typeof health.body.weatherProviderAvailable, "boolean");
assert.equal("placeProvider" in health.body, false);
assert.equal("routeProvider" in health.body, false);
assert.ok(!JSON.stringify(health.body).includes("secret-place-value"));
assert.ok(!JSON.stringify(health.body).includes("secret-route-value"));

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  PLACE_PROVIDER: process.env.PLACE_PROVIDER,
  ROUTE_PROVIDER: process.env.ROUTE_PROVIDER,
  WEATHER_PROVIDER: process.env.WEATHER_PROVIDER,
  PLACE_API_KEY: process.env.PLACE_API_KEY,
  ROUTE_API_KEY: process.env.ROUTE_API_KEY
};

process.env.NODE_ENV = "production";
process.env.VERCEL_ENV = "production";
process.env.PLACE_PROVIDER = "mock";
process.env.ROUTE_PROVIDER = "mock";
process.env.WEATHER_PROVIDER = "";
process.env.PLACE_API_KEY = "secret-place-value";
process.env.ROUTE_API_KEY = "secret-route-value";

const getHealth = await invokeProviderHealth("GET");
assert.equal(getHealth.statusCode, 200);
assert.match(getHealth.headers["Content-Type"], /application\/json/);
assert.match(getHealth.headers["Cache-Control"], /no-store/);
assert.equal(getHealth.body.success, true);
assert.equal(getHealth.body.data.canGenerate, false);
assert.equal(getHealth.body.data.mode, "unavailable");
assert.equal(getHealth.body.data.placeProviderAvailable, false);
assert.equal(getHealth.body.data.destinationResearchAvailable, false);
assert.equal(getHealth.body.data.routeProviderAvailable, false);
assert.equal(getHealth.body.data.weatherProviderAvailable, false);
assert.equal("diagnostics" in getHealth.body.data, false);
assert.ok(!JSON.stringify(getHealth.body).includes("secret-place-value"));
assert.ok(!JSON.stringify(getHealth.body).includes("secret-route-value"));

const postHealth = await invokeProviderHealth("POST", { action: "status", payload: {} });
assert.equal(postHealth.statusCode, 200);
assert.equal(postHealth.body.success, true);
assert.equal(postHealth.body.canGenerate, false);
assert.equal(postHealth.body.mode, "unavailable");

process.env.PLACE_PROVIDER = "";
process.env.ROUTE_PROVIDER = "";
const missingHealth = await invokeProviderHealth("GET");
assert.equal(missingHealth.statusCode, 200);
assert.equal(missingHealth.body.data.canGenerate, false);
assert.equal(missingHealth.body.data.mode, "unavailable");
assert.equal("diagnostics" in missingHealth.body.data, false);
assert.ok(!JSON.stringify(missingHealth.body).includes("PLACE_PROVIDER"));
assert.ok(!JSON.stringify(missingHealth.body).includes("ROUTE_PROVIDER"));

const badMethod = await invokeProviderHealth("PUT");
assert.equal(badMethod.statusCode, 405);
assert.equal(badMethod.headers.Allow, "GET, POST");
assert.equal(badMethod.body.success, false);
assert.equal(badMethod.body.error.code, "METHOD_NOT_ALLOWED");

restoreEnv(originalEnv);

const plannerUnknown = await invokePlanner("POST", { action: "not-real", payload: {} });
assert.equal(plannerUnknown.statusCode, 400);
assert.match(plannerUnknown.headers["Content-Type"], /application\/json/);
assert.equal(plannerUnknown.body.success, false);
assert.equal(plannerUnknown.body.error.code, "UNKNOWN_ACTION");
assert.ok(plannerUnknown.body.requestId);
assert.equal(plannerUnknown.body.error.requestId, plannerUnknown.body.requestId);

const plannerSuccess = await invokePlanner("POST", {
  action: "generate-trip",
  payload: { trip, destinationProfile: research.body.profile }
});
assert.equal(plannerSuccess.statusCode, 200);
assert.match(plannerSuccess.headers["Content-Type"], /application\/json/);
assert.equal(plannerSuccess.body.success, true);
assert.ok(plannerSuccess.body.requestId);
assert.equal(plannerSuccess.body.data.status, "ready");
assert.equal(plannerSuccess.body.status, "ready");
assert.ok(JSON.stringify(plannerSuccess.body.plan).includes("Central Park"));

const invalidPlannerJson = await invokePlanner("POST", "{not json");
assert.equal(invalidPlannerJson.statusCode, 400);
assert.equal(invalidPlannerJson.body.success, false);
assert.equal(invalidPlannerJson.body.error.code, "INVALID_JSON_BODY");

const plannerBadMethod = await invokePlanner("GET");
assert.equal(plannerBadMethod.statusCode, 405);
assert.match(plannerBadMethod.headers["Content-Type"], /application\/json/);
assert.equal(plannerBadMethod.body.error.code, "METHOD_NOT_ALLOWED");

const hardFailureMessage = planRejectionMessage({ pass: false, score: 95, threshold: 85, hardFailures: ["category-concentration"] }, []);
assert.ok(!/95\/85/.test(hardFailureMessage), "A hard-failure rejection must never be phrased as a score-vs-threshold failure");
assert.ok(hardFailureMessage.includes("category-concentration"), "The hard failure code should be visible in the message");

const scoreFailureMessage = planRejectionMessage({ pass: false, score: 60, threshold: 85, hardFailures: [] }, []);
assert.ok(scoreFailureMessage.includes("60") && scoreFailureMessage.includes("85"), "A genuine below-threshold score should state the actual score and threshold");

const nonCriticBlockerMessage = planRejectionMessage(
  { pass: true, score: 97, threshold: 85, hardFailures: [] },
  [{ id: "arrival-route-implausible", title: "Arrival route is implausible" }]
);
assert.ok(!/97\/85/.test(nonCriticBlockerMessage), "A passing critic score must never be presented as the failure reason");
assert.ok(nonCriticBlockerMessage.includes("Arrival route is implausible"), "The actual blocking constraint should be named");

console.log("API gateway tests passed");

async function invokeProviderHealth(method, body = {}) {
  const req = { method, body };
  const res = createMockResponse();
  await providerHealthHandler(req, res);
  return res.snapshot();
}

async function invokePlanner(method, body = {}) {
  const req = { method, body };
  const res = createMockResponse();
  await plannerHandler(req, res);
  return res.snapshot();
}

function createMockResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      if (!this.headers["Content-Type"]) this.headers["Content-Type"] = "application/json";
      return this;
    },
    snapshot() {
      return {
        statusCode: this.statusCode,
        headers: this.headers,
        body: this.body
      };
    }
  };
  return response;
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
