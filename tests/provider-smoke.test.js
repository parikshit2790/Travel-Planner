import assert from "node:assert/strict";
import { providerStatus } from "../api/lib/env.js";
import { mockDestinationResearch, mockLocationSearch, mockRouteEstimate } from "../api/lib/mock-provider.js";

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

const profile = mockDestinationResearch("New York, United States");
assert.ok(profile.places.length >= 8);
assert.ok(profile.places.every((place) => place.sourceMetadata?.provider === "mock"));

const route = mockRouteEstimate("Los Angeles, California", "New York, United States", "driving");
assert.equal(route.provider, "mock");
assert.ok(route.distanceMiles > 0);

console.log("Provider smoke tests passed");
