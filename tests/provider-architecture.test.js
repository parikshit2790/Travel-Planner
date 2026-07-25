import assert from "node:assert/strict";
import fs from "node:fs";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js?v=49";
import { generateTripPlan } from "../src/planner.js?v=49";
import { mockDestinationResearch } from "../api/lib/mock-provider.js";
import { validatePlanningProviders } from "../api/lib/env.js";

const apiFiles = [
  "api/locations/search.js",
  "api/destinations/research.js",
  "api/routes/estimate.js",
  "api/weather/summary.js",
  "api/trips/generate.js",
  "api/trips/regenerate-day.js",
  "api/trips/regenerate-meals.js",
  "api/activities/alternatives.js"
];

apiFiles.forEach((file) => assert.ok(fs.existsSync(file), `${file} should exist`));

const destinationApi = fs.readFileSync("api/destination-profile.js", "utf8");
assert.ok(!destinationApi.includes("https://api.openai.com/v1/responses"));
assert.ok(destinationApi.includes("validatePlanningProviders"));
assert.ok(destinationApi.includes("researchDestination"));

const vercel = fs.readFileSync("vercel.json", "utf8");
assert.ok(vercel.includes("api/.*"));

const envExample = fs.readFileSync(".env.example", "utf8");
["PLACE_PROVIDER", "PLACE_API_KEY", "ROUTE_PROVIDER", "ROUTE_API_KEY", "WEATHER_PROVIDER", "AI_PROVIDER", "PROVIDER_TIMEOUT_MS", "CACHE_TTL_SECONDS"].forEach((key) => assert.ok(envExample.includes(key)));

const providerErrors = validatePlanningProviders({ production: true, placeProvider: "", routeProvider: "", placeApiKey: "", routeApiKey: "" });
assert.ok(providerErrors.some((error) => error.includes("PLACE_PROVIDER")));
assert.ok(providerErrors.some((error) => error.includes("ROUTE_PROVIDER")));

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
