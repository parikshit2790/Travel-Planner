import assert from "node:assert/strict";
import { providerStatus } from "../api/lib/env.js";
import { hasMockDestinationData, mockDestinationResearch, mockLocationSearch, mockRouteEstimate } from "../api/lib/mock-provider.js";

const configured = providerStatus({
  production: false,
  development: true,
  placeProvider: "mock",
  routeProvider: "mock",
  weatherProvider: "mock",
  aiProvider: "",
  placeApiKey: "",
  routeApiKey: "",
  weatherApiKey: "",
  aiApiKey: ""
}, { includeDiagnostics: true });

assert.equal(configured.canGenerate, true);
assert.equal(configured.placeProvider.status, "available");
assert.equal(configured.routeProvider.status, "available");

const locations = mockLocationSearch("New York");
assert.ok(locations.length >= 1);
assert.ok(locations.every((item) => item.provider === "mock"));

const sanLocations = mockLocationSearch("san");
assert.ok(sanLocations.length >= 5);
assert.equal(sanLocations[0].canonicalName, "San Jose, California, United States");
assert.ok(sanLocations.some((item) => item.canonicalName === "San Francisco, California, United States"));
assert.ok(sanLocations.every((item) => item.canonicalName.toLowerCase() !== "san"));

const charlotteLocations = mockLocationSearch("charlotte");
assert.equal(charlotteLocations[0].canonicalName, "Charlotte, North Carolina, United States");
assert.equal(charlotteLocations[0].latitude, 35.2271);

const profile = mockDestinationResearch("New York, United States");
assert.ok(profile.places.length >= 8);
assert.ok(profile.places.every((place) => place.sourceMetadata?.provider === "mock"));

assert.equal(hasMockDestinationData("Charlotte, North Carolina, United States"), true);
assert.equal(hasMockDestinationData("Atlantis"), false);
assert.throws(() => mockDestinationResearch("Atlantis"), /current demo data/);

const route = mockRouteEstimate("Los Angeles, California", "New York, United States", "driving");
assert.equal(route.provider, "mock");
assert.ok(route.distanceMiles > 0);

console.log("Provider smoke tests passed");
