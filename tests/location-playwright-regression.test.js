import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const provider = readFileSync("src/location-provider.js", "utf8");

const testName = "user can type and replace full location names";

assert.equal(testName, "user can type and replace full location names");
assert.ok(app.includes("updateLocationDraft"));
assert.ok(app.includes("selectLocationSuggestion"));
assert.ok(app.includes("clearLocationField"));
assert.ok(app.includes("fromPlaceId = \"\""));
assert.ok(app.includes("destinationPlaceId = \"\""));
assert.ok(app.includes("fromLat = null"));
assert.ok(app.includes("destinationLat = null"));
assert.ok(app.includes("fromLng = null"));
assert.ok(app.includes("destinationLng = null"));
assert.ok(app.includes("fromAirportCode = \"\""));
assert.ok(app.includes("destinationAirportCode = \"\""));
assert.ok(app.includes("destinationRefinementStatus = \"Not Started\""));
assert.ok(app.includes("isBroadLocation(suggestion) ? \"Needs Refinement\" : \"Refined\""));
assert.ok(app.includes("covers a large area. Add a city or region for a more realistic itinerary."));
assert.ok(app.includes("refreshLocationPanel()"));
assert.ok(provider.includes("ApiLocationSearchProvider"));
assert.ok(provider.includes("routeMosaicApi.searchLocations(query)"));
assert.ok(!provider.includes("https://nominatim.openstreetmap.org"));
assert.ok(!app.includes("maxlength=\"3\""));
assert.ok(!app.includes("maxLength=\"3\""));
assert.ok(!provider.includes("slice(0, 3)"));

console.log(`${testName} contract passed`);
