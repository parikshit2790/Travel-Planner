import assert from "node:assert/strict";
import { createTripDraft, migrateTripState } from "../src/domain.js";
import {
  approvedRouteStillValid,
  approveRouteOption,
  destinationExpansionScore,
  estimateDestinationDepth,
  generateRouteArchitectureOptions,
  routeRecommendationRequired
} from "../src/route-architecture.js";

function trip(overrides = {}) {
  const draft = createTripDraft();
  Object.assign(draft, {
    from: "Charlotte, North Carolina",
    fromDisplay: "Charlotte, North Carolina",
    destination: "Los Angeles, California",
    destinationDisplay: "Los Angeles, California",
    days: 5,
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    transportation: "Fly and rent a car",
    description: "We want famous highlights, scenic views, vegetarian-friendly food, relaxed evenings, and maybe nearby cities if they are worth it."
  }, overrides);
  migrateTripState(draft);
  return draft;
}

const laOneCity = trip();
laOneCity.routePreferences.tripStructure = "one-city";
let options = generateRouteArchitectureOptions(laOneCity);
assert.equal(routeRecommendationRequired(laOneCity), false);
assert.equal(options[0].tripShapeType, "single-city");
assert.equal(options[0].hotelChanges, 0);

const laRecommend = trip();
laRecommend.routePreferences.tripStructure = "recommend";
laRecommend.routePreferences.openToNearbyCities = "Yes";
laRecommend.routePreferences.maxHotelChanges = "1";
options = generateRouteArchitectureOptions(laRecommend);
assert.ok(options.some((option) => option.tripShapeType === "single-city"), "LA recommendation must keep LA-only available");
assert.ok(options.some((option) => option.tripShapeType === "one-base-day-trips"), "LA recommendation should compare day-trip shape");
assert.ok(options.length <= 3);
assert.equal(approvedRouteStillValid(laRecommend), false);
approveRouteOption(laRecommend, options[0].id);
assert.equal(approvedRouteStillValid(laRecommend), true);

const explicitSanDiego = trip({
  destinationRegions: "San Diego",
  description: "We explicitly want Los Angeles and San Diego."
});
explicitSanDiego.routePreferences.tripStructure = "multi-city";
explicitSanDiego.routePreferences.maxHotelChanges = "1";
options = generateRouteArchitectureOptions(explicitSanDiego);
assert.ok(options.some((option) => option.sequence.includes("San Diego")), "Explicit San Diego request should be route-eligible");
assert.ok(options.every((option) => option.hotelChanges <= 1));

const michigan = trip({
  destination: "Michigan",
  destinationDisplay: "Michigan",
  days: 6,
  destinationRegions: "Pictured Rocks, Mackinac Island, Traverse City, Sleeping Bear",
  description: "Michigan regional trip with Pictured Rocks, Mackinac, Traverse City, and Sleeping Bear."
});
michigan.routePreferences.tripStructure = "recommend";
michigan.routePreferences.maxHotelChanges = "2";
options = generateRouteArchitectureOptions(michigan);
assert.ok(options.some((option) => option.tripShapeType === "multi-city" || option.majorDriveDays.length), "Michigan should surface bases or major drive days");
assert.equal(estimateDestinationDepth(michigan).destinationScope, "regional-or-broad");

const zeroChanges = trip();
zeroChanges.routePreferences.tripStructure = "recommend";
zeroChanges.routePreferences.maxHotelChanges = "0";
options = generateRouteArchitectureOptions(zeroChanges);
assert.ok(options.every((option) => option.hotelChanges === 0), "Zero hotel changes must exclude multi-base options");

const smallCity = trip({
  destination: "Smallville",
  destinationDisplay: "Smallville",
  days: 5,
  description: "Small city trip with lakes and local culture."
});
smallCity.routePreferences.placesInMind = "Nearby Lake Town";
const score = destinationExpansionScore(smallCity, "Smallville", { name: "Nearby Lake Town", driveMinutes: 80, type: "lake" }, estimateDestinationDepth(smallCity));
assert.ok(score.total >= 58, "Small city with explicit nearby interest should allow nearby proposal");

console.log("Route architecture tests passed");
