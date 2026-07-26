import assert from "node:assert/strict";
import fs from "node:fs";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import { handleLocationAction } from "../api/lib/location-actions.js";
import { handlePlannerAction } from "../api/lib/planner-actions.js";
import { handleProviderHealthAction } from "../api/lib/provider-health-actions.js";

const apiRouteFiles = fs.readdirSync("api").filter((entry) => /\.(js|ts)$/.test(entry)).sort();
assert.deepEqual(apiRouteFiles, ["locations.js", "planner.js", "provider-health.js"]);

const actionResponse = fs.readFileSync("api/lib/action-response.js", "utf8");
assert.ok(actionResponse.includes("METHOD_NOT_ALLOWED"));
assert.ok(actionResponse.includes("ACTION_REQUIRED") || fs.readFileSync("api/planner.js", "utf8").includes("ACTION_REQUIRED"));

const unknownPlanner = await handlePlannerAction("not-real", {});
assert.equal(unknownPlanner.status, 400);
assert.equal(unknownPlanner.body.error.code, "UNKNOWN_ACTION");

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
const health = handleProviderHealthAction("status");
assert.equal(health.status, 200);
assert.ok(["mock", "live", "unavailable"].includes(health.body.mode));
assert.equal(typeof health.body.placeProviderAvailable, "boolean");
assert.equal(typeof health.body.routeProviderAvailable, "boolean");
assert.equal(typeof health.body.weatherProviderAvailable, "boolean");
assert.equal("placeProvider" in health.body, false);
assert.equal("routeProvider" in health.body, false);
assert.ok(!JSON.stringify(health.body).includes("secret-place-value"));
assert.ok(!JSON.stringify(health.body).includes("secret-route-value"));

console.log("API gateway tests passed");
