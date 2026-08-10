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

const japan = trip({
  destination: "Japan",
  destinationDisplay: "Japan",
  destinationLocation: { locationType: "Country" },
  days: 5,
  startDate: "2026-10-05",
  endDate: "2026-10-10",
  destinationRegions: "Tokyo, Osaka, Kyoto, Mount Fuji",
  description: "Let RouteMosaic recommend the best structure."
});
japan.routePreferences.tripStructure = "recommend";
japan.routePreferences.maxHotelChanges = "1";
options = generateRouteArchitectureOptions(japan);
assert.ok(options.length, "Japan trip must produce route options");
options.forEach((option) => {
  assert.notEqual(option.primaryDestination, "Japan", "A country must never be used directly as a hotel base");
  option.hotelBases.forEach((base) => assert.notEqual(base.canonicalName, "Japan", "A country must never appear as a hotel base"));
  option.nightsPerBase.forEach((entry) => assert.notEqual(entry.base, "Japan", "Nights must never be assigned directly to a country"));
});
const requestedNames = ["Tokyo", "Osaka", "Kyoto", "Mount Fuji"];
options.forEach((option) => {
  const accountedFor = new Set([
    ...option.includedRefinements,
    ...option.dayTripRefinements,
    ...option.excludedRefinements.map((item) => item.name)
  ].map((name) => name.toLowerCase()));
  requestedNames.forEach((name) => {
    assert.ok(accountedFor.has(name.toLowerCase()), `${name} must be included, a day trip, or explicitly excluded with a reason on option "${option.title}" -- it must never silently disappear`);
  });
  option.excludedRefinements.forEach((item) => assert.ok(item.reason && item.reason.length > 10, `Excluded refinement ${item.name} must carry a real reason`));
});

const smallCity = trip({
  destination: "Smallville",
  destinationDisplay: "Smallville",
  days: 5,
  description: "Small city trip with lakes and local culture."
});
smallCity.routePreferences.placesInMind = "Nearby Lake Town";
const score = destinationExpansionScore(smallCity, "Smallville", { name: "Nearby Lake Town", driveMinutes: 80, type: "lake" }, estimateDestinationDepth(smallCity));
assert.ok(score.total >= 58, "Small city with explicit nearby interest should allow nearby proposal");

// A verified place with a real geocoded location that turns out to be
// effectively the same metro area (confirmed live: "Lake Norman" is a ~25
// minute drive from Charlotte) must not be proposed as its own multi-city
// hotel base -- it belongs as a day trip, not a separate overnight stay.
const sameMetroSuburb = trip({
  destination: "Charlotte, North Carolina, United States",
  destinationDisplay: "Charlotte, North Carolina, United States",
  destinationLat: 35.2271,
  destinationLng: -80.8431
});
sameMetroSuburb.routePreferences.tripStructure = "multi-city";
sameMetroSuburb.routePreferences.maxHotelChanges = "3";
sameMetroSuburb.routePreferences.maxTransferDriveTime = "5 hours";
sameMetroSuburb.routePreferences.placesInMind = "Lake Norman";
sameMetroSuburb.routePreferences.placesInMindVerified = ["Lake Norman"];
sameMetroSuburb.routePreferences.placesInMindLocations = { "Lake Norman": { lat: 35.4874, lng: -80.8873 } };
const suburbOptions = generateRouteArchitectureOptions(sameMetroSuburb);
assert.ok(
  !suburbOptions.some((option) => option.tripShapeType === "multi-city" && option.sequence.some((stop) => /lake norman/i.test(stop))),
  "A same-metro-area suburb with a real nearby location must not be proposed as a multi-city hotel base"
);

console.log("Route architecture tests passed");
