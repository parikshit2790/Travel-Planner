import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { generateTripPlan, validateTripPlan } from "../src/planner.js";

const augustaToCharlotte = tripFixture("Charlotte, North Carolina, United States", "2026-08-08", "2026-08-10");
const charlotte = generateTripPlan(augustaToCharlotte);
assert.equal(charlotte.status, "ready");

const charlotteText = JSON.stringify(charlotte.plan).toLowerCase();
const firstDayItems = charlotte.plan.days[0].scheduleItems;
const finalDayItems = charlotte.plan.days.at(-1).scheduleItems;

assert.ok(firstDayItems.some((item) => item.title.includes("Travel to Charlotte")), "Day 1 should include Augusta-to-destination travel.");
assert.ok(firstDayItems.find((item) => item.type === "activity").startTimeMinutes >= 16 * 60, "Arrival-day sightseeing should not begin in the morning.");
assert.ok(firstDayItems.some((item) => item.title.includes("Hotel check-in")), "Arrival day should include hotel check-in.");
assert.ok(finalDayItems.some((item) => item.title.includes("Hotel checkout")), "Final day should include checkout.");
assert.ok(finalDayItems.some((item) => item.title.includes("Depart Charlotte")), "Final day should include departure logistics.");
assert.ok(finalDayItems.filter((item) => item.type === "activity").length <= 1, "Final travel day should stay light.");
assert.equal(charlotteText.includes("breakfast near the day base"), false);
assert.equal(charlotteText.includes("lunch near the main activity area"), false);
assert.equal(charlotteText.includes("dinner aligned with your food preferences"), false);
assert.equal(charlotteText.includes("coastal evenings can feel cooler"), false);
assert.equal(validateTripPlan(charlotte.plan).blocking.filter((item) => item.severity === "blocking").length, 0);

registerGeneratedDestinationProfile(ashevilleLikeProfile());
const asheville = generateTripPlan(tripFixture("Asheville, North Carolina, United States", "2026-08-08", "2026-08-11"));
assert.equal(asheville.status, "ready");

const ashevilleText = JSON.stringify(asheville.plan).toLowerCase();
assert.ok(asheville.plan.days[0].scheduleItems.some((item) => item.title.includes("Travel to Asheville")), "Asheville arrival day should include the Augusta drive.");
assert.ok(asheville.plan.days.some((day) => day.scheduleItems.some((item) => item.title.includes("Biltmore"))), "Biltmore should anchor an Asheville plan.");
assert.equal(ashevilleText.includes("google places landmark candidate"), false);
assert.equal(ashevilleText.includes("openrouteservice point-of-interest candidate"), false);
assert.equal(ashevilleText.includes("culture-area"), false);
assert.equal(ashevilleText.includes("nature-area"), false);
assert.equal(ashevilleText.includes("central-area"), false);
assert.equal(ashevilleText.includes("food and evening area"), false);
assert.equal(ashevilleText.includes("provider-found"), false);
assert.equal(ashevilleText.includes("provider-retrieved"), false);

const mountainTravel = asheville.plan.days
  .flatMap((day) => day.scheduleItems)
  .filter((item) => item.type === "travel" && /craggy|catawba|arboretum|nature center/i.test(item.locationLabel || item.title || ""));
assert.ok(mountainTravel.every((item) => item.durationMinutes > 20), "Mountain and regional transfers must not collapse to eight-minute placeholders.");

const museumAtNight = asheville.plan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity" && /museum|folk art center|visitor center/i.test(item.title) && item.startTimeMinutes >= 17 * 60);
assert.equal(museumAtNight.length, 0, "Museums and visitor centers should not be scheduled late without verified hours.");

console.log("Itinerary quality regression tests passed");

function tripFixture(destination, startDate, endDate) {
  return {
    from: "Augusta, Georgia, United States",
    fromDisplay: "Augusta, Georgia, United States",
    fromLocation: {
      canonicalName: "Augusta, Georgia, United States",
      latitude: 33.4735,
      longitude: -82.0105
    },
    destination,
    destinationDisplay: destination,
    startDate,
    endDate,
    days: 3,
    adults: 1,
    children: 0,
    seniors: 0,
    groupType: "Solo trip",
    transportation: "Drive",
    schedule: { pace: "Balanced", majorActivities: 2, earliestActivity: "9:00 AM", latestReturn: "9:30 PM" },
    activity: { walking: "Easy walking", hiking: "Easy hikes" },
    food: { diet: ["Vegetarian"], restrictions: [], cuisine: ["Local cuisine"], foodBudgetPerPerson: "$15-$30 per day", breakfastTime: "8:00 AM", lunchTime: "12:30 PM", dinnerTime: "6:30 PM" },
    alcohol: { preferences: ["Quiet evening venues"] },
    budget: { total: "$1,500-$3,500" },
    lodging: { changeHotels: "Stay in one place" },
    transport: { maxDrivingDay: "4 hours" },
    preferences: [{ id: "nature", category: "experiences", label: "Nature", importance: "Strong preference", weight: 80 }],
    travelers: [{ id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }]
  };
}

function ashevilleLikeProfile() {
  return {
    id: "ors-asheville-north-carolina-united-states",
    canonicalName: "Asheville, North Carolina, United States",
    aliases: ["asheville", "asheville north carolina united states"],
    country: "United States",
    state: "North Carolina",
    timezone: "America/New_York",
    currency: "USD",
    summary: "Asheville mixes downtown culture, Biltmore, River Arts, and mountain routes that need realistic drive buffers.",
    seasonalNotes: ["Mountain weather can change quickly; verify forecasts and road conditions."],
    generalAdvisories: ["Verify attraction hours, tickets, trail conditions, and restaurant details directly."],
    planningRules: { defaultHotelRegion: "downtown-asheville", maxRegionChangesRelaxed: 1, maxRegionChangesBalanced: 2, maxRegionChangesPacked: 2 },
    regions: [
      region("downtown-asheville", "Downtown Asheville", 35.5951, -82.5515, ["biltmore-estate", "river-arts-district"]),
      region("biltmore-estate", "Biltmore Estate", 35.5406, -82.5528, ["downtown-asheville"]),
      region("river-arts-district", "River Arts District", 35.5858, -82.5662, ["downtown-asheville"]),
      region("blue-ridge-parkway-north", "Blue Ridge Parkway north", 35.704, -82.373, ["downtown-asheville"]),
      region("black-mountain-catawba", "Black Mountain and Catawba Falls", 35.611, -82.229, ["blue-ridge-parkway-north"]),
      region("arboretum-southwest", "Arboretum and southwest Asheville", 35.497, -82.609, ["downtown-asheville"])
    ],
    places: [
      place("biltmore", "Biltmore Estate", "biltmore-estate", ["estate", "museum", "garden", "full-day"], 360, "morning", 99, 35.5406, -82.5528),
      place("asheville-art-museum", "Asheville Art Museum", "downtown-asheville", ["museum", "art", "indoor"], 120, "morning", 90, 35.594, -82.551),
      place("river-arts", "River Arts District", "river-arts-district", ["art", "neighborhood", "food"], 120, "afternoon", 88, 35.5858, -82.5662),
      place("folk-art-center", "Folk Art Center", "blue-ridge-parkway-north", ["museum", "visitor center", "craft"], 75, "morning", 84, 35.592, -82.449),
      place("craggy-gardens", "Craggy Gardens", "blue-ridge-parkway-north", ["nature", "mountain", "scenic"], 120, "morning", 86, 35.704, -82.373),
      place("catawba-falls", "Catawba Falls", "black-mountain-catawba", ["waterfall", "hike", "nature"], 180, "morning", 82, 35.611, -82.229),
      place("north-carolina-arboretum", "North Carolina Arboretum", "arboretum-southwest", ["garden", "nature"], 150, "morning", 80, 35.497, -82.609),
      place("wnc-nature-center", "Western North Carolina Nature Center", "downtown-asheville", ["nature center", "family"], 120, "afternoon", 72, 35.579, -82.493),
      restaurant("all-day-darling", "All Day Darling", "downtown-asheville", ["breakfast", "lunch"], 35.593, -82.552),
      restaurant("biscuit-head", "Biscuit Head", "downtown-asheville", ["breakfast"], 35.596, -82.556),
      restaurant("chai-pani", "Chai Pani", "downtown-asheville", ["lunch", "dinner"], 35.594, -82.554),
      restaurant("cucina24", "Cucina 24", "downtown-asheville", ["dinner"], 35.595, -82.553),
      restaurant("vivian", "Vivian", "downtown-asheville", ["dinner"], 35.592, -82.55),
      restaurant("clingman-cafe", "Clingman Cafe", "river-arts-district", ["breakfast", "lunch"], 35.585, -82.566),
      restaurant("river-arts-taproom", "River Arts District Taproom", "river-arts-district", ["lunch", "dinner"], 35.586, -82.567),
      restaurant("bone-broth-biltmore", "Village Bistro at Biltmore Park", "biltmore-estate", ["lunch", "dinner"], 35.541, -82.554)
    ],
    foodAreas: [
      foodArea("downtown-food", "Downtown Asheville restaurants", "downtown-asheville"),
      foodArea("biltmore-village-food", "Biltmore Village dining", "biltmore-estate"),
      foodArea("rad-food", "River Arts District cafes", "river-arts-district")
    ],
    scenicRoutes: [
      route("downtown-biltmore", "Downtown Asheville to Biltmore Estate", "downtown-asheville", "biltmore-estate", 22, 8),
      route("downtown-rad", "Downtown Asheville to River Arts District", "downtown-asheville", "river-arts-district", 12, 3),
      route("downtown-craggy", "Downtown Asheville to Craggy Gardens", "downtown-asheville", "blue-ridge-parkway-north", 50, 24),
      route("craggy-catawba", "Craggy Gardens to Catawba Falls", "blue-ridge-parkway-north", "black-mountain-catawba", 75, 38),
      route("downtown-arboretum", "Downtown Asheville to North Carolina Arboretum", "downtown-asheville", "arboretum-southwest", 25, 12)
    ],
    sourceMetadata: { provider: "test", retrievedAt: "test", freshness: "regression-fixture" }
  };
}

function region(id, name, lat, lng, neighboringRegionIds) {
  return { id, name, summary: `${name} planning cluster.`, centerCoordinates: { lat, lng }, tags: [], neighboringRegionIds, typicalTravelMinutesToRegions: {} };
}

function place(id, name, regionId, categories, duration, bestTimeOfDay, priorityScore, lat, lng) {
  return {
    id,
    name,
    regionId,
    shortDescription: `${name} is a real Asheville planning anchor; verify hours and tickets directly.`,
    categories,
    tags: categories,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.round(duration * 0.7),
    maximumDurationMinutes: Math.round(duration * 1.3),
    estimatedCostLow: categories.includes("nature") ? 0 : 15,
    estimatedCostHigh: categories.includes("estate") ? 120 : 45,
    indoorOutdoor: categories.includes("museum") ? "indoor" : "mixed",
    weatherDependency: categories.includes("nature") ? "high" : "medium",
    accessibility: "moderate",
    dietaryRelevance: [],
    openingTimeGuidance: "Confirm current hours before travel.",
    bestTimeOfDay,
    reservationRecommended: categories.includes("estate") || categories.includes("museum"),
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: { lat, lng },
    backupForTags: categories.includes("museum") ? ["rain", "heat"] : []
  };
}

function foodArea(id, name, regionId) {
  return { id, name, regionId, cuisines: ["Local cuisine", "Vegetarian-friendly", "Cafes"], mealTypes: ["breakfast", "lunch", "dinner"], budgetLevels: ["budget", "moderate"], dietarySupport: ["Vegetarian"], eveningSuitability: ["quiet"] };
}

function restaurant(id, name, regionId, mealTypes, lat, lng, low = 10, high = 32) {
  return {
    ...place(id, name, regionId, ["restaurant", "food"], 60, mealTypes.includes("breakfast") ? "morning" : "dinner", 78, lat, lng),
    estimatedCostLow: low,
    estimatedCostHigh: high,
    indoorOutdoor: "indoor",
    weatherDependency: "low",
    tags: ["restaurant", ...mealTypes, "local dining"],
    dietaryRelevance: ["confirm dietary needs directly"]
  };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags: ["route"], bestTimeOfDay: "morning", notes: "Regression route estimate." };
}
