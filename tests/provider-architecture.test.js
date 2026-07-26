import assert from "node:assert/strict";
import fs from "node:fs";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { generateTripPlan } from "../src/planner.js";
import { mockDestinationResearch } from "../server/lib/mock-provider.js";
import { providerStatus, validatePlanningProviders } from "../server/lib/env.js";

const apiFiles = [
  "api/planner.js",
  "api/locations.js",
  "api/provider-health.js"
];

apiFiles.forEach((file) => assert.ok(fs.existsSync(file), `${file} should exist`));

const removedApiFiles = [
  "api/providers/status.js",
  "api/locations/search.js",
  "api/destinations/research.js",
  "api/destination-profile.js",
  "api/routes/estimate.js",
  "api/weather/summary.js",
  "api/trips/generate.js",
  "api/trips/regenerate-day.js",
  "api/trips/regenerate-meals.js",
  "api/activities/alternatives.js"
];
removedApiFiles.forEach((file) => assert.equal(fs.existsSync(file), false, `${file} should be removed`));

const plannerActions = fs.readFileSync("server/lib/planner-actions.js", "utf8");
assert.ok(!plannerActions.includes("https://api.openai.com/v1/responses"));
assert.ok(plannerActions.includes("validatePlanningProviders"));
assert.ok(plannerActions.includes("researchDestination"));
assert.ok(plannerActions.includes("hasMockDestinationData"));
assert.ok(plannerActions.includes("MOCK_DESTINATION_UNAVAILABLE"));
assert.ok(plannerActions.includes("generate-trip"));
assert.ok(plannerActions.includes("regenerate-day"));
assert.ok(plannerActions.includes("regenerate-meals"));
assert.ok(plannerActions.includes("get-alternatives"));
assert.ok(plannerActions.includes("estimate-route"));
assert.ok(plannerActions.includes("weather-summary"));

const vercel = fs.readFileSync("vercel.json", "utf8");
assert.ok(vercel.includes("api/.*"));

const envExample = fs.readFileSync(".env.example", "utf8");
["PLACE_PROVIDER", "PLACE_API_KEY", "OPENROUTESERVICE_API_KEY", "ROUTE_PROVIDER", "ROUTE_API_KEY", "WEATHER_PROVIDER", "AI_PROVIDER", "PROVIDER_TIMEOUT_MS", "CACHE_TTL_SECONDS"].forEach((key) => assert.ok(envExample.includes(key)));

const providerErrors = validatePlanningProviders({ production: true, placeProvider: "", routeProvider: "", placeApiKey: "", routeApiKey: "" });
assert.ok(providerErrors.some((error) => error.includes("PLACE_PROVIDER")));
assert.ok(providerErrors.some((error) => error.includes("ROUTE_PROVIDER")));

const healthyStatus = providerStatus({ production: true, development: false, placeProvider: "mock", routeProvider: "mock", placeApiKey: "secret-place", routeApiKey: "secret-route", weatherProvider: "", aiProvider: "", weatherApiKey: "", aiApiKey: "" });
assert.equal(healthyStatus.canGenerate, true);
assert.equal(healthyStatus.mode, "mock");
assert.equal(healthyStatus.placeProvider.configured, true);
assert.equal(healthyStatus.routeProvider.configured, true);
assert.equal(healthyStatus.placeProviderAvailable, true);
assert.equal(healthyStatus.destinationResearchAvailable, true);
assert.equal(healthyStatus.routeProviderAvailable, true);
assert.ok(!JSON.stringify(healthyStatus).includes("secret-place"));
assert.ok(!JSON.stringify(healthyStatus).includes("secret-route"));

const placeMissingStatus = providerStatus({ production: true, development: false, placeProvider: "", routeProvider: "mock", placeApiKey: "", routeApiKey: "" });
assert.equal(placeMissingStatus.canGenerate, false);
assert.equal(placeMissingStatus.mode, "unavailable");
assert.equal(placeMissingStatus.routeProvider.configured, true);

const routeMissingStatus = providerStatus({ production: true, development: false, placeProvider: "mock", routeProvider: "", placeApiKey: "", routeApiKey: "" });
assert.equal(routeMissingStatus.canGenerate, false);
assert.equal(routeMissingStatus.mode, "unavailable");
assert.equal(routeMissingStatus.placeProvider.configured, true);

const liveStatus = providerStatus({ production: true, development: false, placeProvider: "openrouteservice", routeProvider: "openrouteservice", openRouteServiceApiKey: "secret-ors", placeApiKey: "", routeApiKey: "", aiProvider: "openai", aiApiKey: "secret-ai" });
assert.equal(liveStatus.mode, "live");
assert.equal(liveStatus.canGenerate, true);
assert.equal(liveStatus.destinationResearchAvailable, true);
assert.notEqual(liveStatus.mode, healthyStatus.mode);
assert.ok(!JSON.stringify(liveStatus).includes("secret-ors"));
assert.ok(!JSON.stringify(liveStatus).includes("secret-ai"));

const routesOnlyStatus = providerStatus({ production: true, development: false, placeProvider: "openrouteservice", routeProvider: "openrouteservice", openRouteServiceApiKey: "secret-ors", placeApiKey: "", routeApiKey: "", aiProvider: "", aiApiKey: "" });
assert.equal(routesOnlyStatus.canGenerate, false);
assert.equal(routesOnlyStatus.placeProviderAvailable, true);
assert.equal(routesOnlyStatus.routeProviderAvailable, true);
assert.equal(routesOnlyStatus.destinationResearchAvailable, false);

const optionalMissingStatus = providerStatus({ production: true, development: false, placeProvider: "mock", routeProvider: "mock", weatherProvider: "tomorrow", weatherApiKey: "", aiProvider: "openai", aiApiKey: "", placeApiKey: "", routeApiKey: "" });
assert.equal(optionalMissingStatus.canGenerate, true);
assert.equal(optionalMissingStatus.weatherProvider.status, "degraded");
assert.equal(optionalMissingStatus.aiProvider.status, "degraded");

const publicStatus = providerStatus({ production: true, development: false, placeProvider: "", routeProvider: "", placeApiKey: "", routeApiKey: "" });
assert.equal(publicStatus.canGenerate, false);
assert.equal(publicStatus.available, false);
assert.equal(publicStatus.mode, "unavailable");
assert.equal(publicStatus.placeProvider.missingVariables.length, 0);
assert.equal(publicStatus.routeProvider.missingVariables.length, 0);
assert.equal(publicStatus.diagnostics, undefined);
assert.ok(!publicStatus.publicMessage.includes("Vercel"));
assert.ok(!publicStatus.publicMessage.includes("PLACE_PROVIDER"));

const devStatus = providerStatus({ production: false, development: true, placeProvider: "", routeProvider: "", placeApiKey: "", routeApiKey: "" }, { includeDiagnostics: true });
assert.ok(devStatus.diagnostics.placeProviderMissing.includes("PLACE_PROVIDER"));
assert.ok(devStatus.diagnostics.routeProviderMissing.includes("ROUTE_PROVIDER"));

const statusApi = fs.readFileSync("server/lib/provider-health-actions.js", "utf8");
assert.ok(statusApi.includes("includeDiagnostics"));
assert.ok(statusApi.includes("config.development"));

const profile = registerGeneratedDestinationProfile(mockDestinationResearch("Paris, France"));
assert.ok(profile);
assert.equal(profile.id, "mock-paris-france");
assert.ok(profile.places.length >= 8);
assert.ok(profile.places.every((place) => place.sourceMetadata?.provider === "mock"));

const trip = createTripDraft();
trip.from = "New York, New York";
trip.fromDisplay = trip.from;
trip.destination = "Paris, France";
trip.destinationDisplay = trip.destination;
trip.startDate = "2026-08-20";
trip.endDate = "2026-08-24";
trip.days = 5;
trip.adults = 2;
trip.groupType = "Couple trip";
trip.schedule.pace = "Balanced";
trip.schedule.majorActivities = 3;
trip.transport.maxDrivingDay = "4 hours";
syncTravelersToCounts(trip);
const plan = generateTripPlan(trip).plan;
const planText = JSON.stringify(plan);
assert.ok(planText.includes("Louvre Museum"));
assert.ok(!planText.includes("Santa Monica Pier"));
assert.ok(plan.days.every((day) => day.scheduleItems.filter((item) => item.type === "activity").every((item) => item.sourceMetadata?.provider === "mock")));

console.log("Provider architecture tests passed");
