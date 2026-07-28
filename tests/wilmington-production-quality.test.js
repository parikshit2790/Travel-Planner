import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = registerGeneratedDestinationProfile(wilmingtonFixture());

const trip = {
  from: "Lynchburg, Virginia, United States",
  fromDisplay: "Lynchburg, Virginia, United States",
  fromLocation: { canonicalName: "Lynchburg, Virginia, United States", latitude: 37.4138, longitude: -79.1422 },
  destination: "Wilmington, North Carolina, United States",
  destinationDisplay: "Wilmington, North Carolina, United States",
  destinationLocation: { canonicalName: "Wilmington, North Carolina, United States", latitude: 34.2104, longitude: -77.8868 },
  startDate: "2026-08-20",
  endDate: "2026-08-24",
  days: 5,
  adults: 2,
  children: 0,
  seniors: 0,
  groupType: "Couple trip",
  transportation: "Drive",
  schedule: { pace: "Balanced", majorActivities: 3, earliestActivity: "9:00 AM", latestReturn: "9:30 PM" },
  activity: { walking: "Easy walking", hiking: "No hiking" },
  food: { diet: [], restrictions: [], cuisine: ["Local cuisine"], foodBudgetPerPerson: "$15-$30 per day", breakfastTime: "8:00 AM", lunchTime: "12:30 PM", dinnerTime: "6:30 PM" },
  alcohol: { preferences: ["Quiet evening venues", "Evening walks", "Sunset activities"] },
  budget: { total: "$1,500-$3,500" },
  lodging: { changeHotels: "Stay in one place" },
  transport: { maxDrivingDay: "4 hours" },
  preferences: [],
  travelers: [
    { id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" },
    { id: "traveler-2", name: "Traveler 2", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }
  ]
};

assert.ok(profile, "Wilmington generated fixture should register.");

const badValidation = validateTripPlan(wilmingtonTwoStyleBadPlan(profile, trip));
const badCodes = badValidation.blocking.map((issue) => issue.id).join(" ");
assert.match(badCodes, /internal-language/, "Provider/internal language should fail validation.");
assert.match(badCodes, /raw-place-label/, "Raw access labels should fail validation.");
assert.match(badCodes, /meal-repetition/, "Repeated restaurant pairs should fail validation.");
assert.match(badCodes, /generic-duration/, "Repeated generic durations should fail validation.");
assert.match(badCodes, /generic-pricing/, "Repeated generic prices should fail validation.");
assert.match(badCodes, /duplicated-evening/, "Reused daytime/evening activity should fail validation.");

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready", JSON.stringify(generated.errors || generated));
assert.equal(generated.plan.status, "ready", JSON.stringify(generated.plan.advisories));

const publicPlan = JSON.stringify({
  overview: generated.plan.overview,
  days: generated.plan.days,
  foodPlan: generated.plan.foodPlan,
  routeSummary: generated.plan.routeSummary,
  hotelBase: generated.plan.hotelBase,
  tripGuide: generated.plan.tripGuide
});

[
  "Access 4",
  "Google Places landmark candidate",
  "Google Places museum candidate",
  "Central area",
  "Culture and landmarks",
  "Parks and viewpoints",
  "Verify hours for"
].forEach((bad) => assert.equal(publicPlan.includes(bad), false, `Generated plan must not include ${bad}`));

generated.plan.days.forEach((day) => {
  const activityIds = new Set(day.scheduleItems.filter((item) => item.type === "activity" && item.placeId).map((item) => item.placeId));
  day.scheduleItems.filter((item) => item.type === "evening" && item.placeId).forEach((evening) => {
    assert.equal(activityIds.has(evening.placeId), false, `${evening.title} should not be reused as same-day evening filler.`);
  });
});

const mealRows = generated.plan.days.flatMap((day) => day.dailyFoodPlan);
const mealNames = mealRows.map((meal) => meal.primaryOption).filter(Boolean);
assert.ok(maxCount(mealNames) <= 2, "No restaurant should dominate the trip.");
assert.ok(mealNames.filter((name) => /On Thyme Restaurant|The Kitchen Sink/i.test(name)).length <= 2, "Known repeated Wilmington meal pair must not dominate.");

const durations = generated.plan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").map((item) => item.durationMinutes);
assert.ok(maxShare(durations) <= 0.4, `Durations should vary by place, got ${durations.join(",")}`);
const costs = generated.plan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").map((item) => `${item.estimatedCostPerPerson.low}-${item.estimatedCostPerPerson.high}`);
assert.ok(maxShare(costs) <= 0.45, `Cost bands should vary by place, got ${costs.join(",")}`);

const validation = validateTripPlan(generated.plan);
assert.equal(validation.blocking.filter((issue) => issue.severity === "blocking").length, 0, JSON.stringify(validation.blocking));
assert.ok(generated.plan.generationMetadata.qualityCritique.score >= 85, JSON.stringify(generated.plan.generationMetadata.qualityCritique));

console.log("Wilmington production quality regression tests passed");

function wilmingtonTwoStyleBadPlan(destinationProfile, sourceTrip) {
  const activity = (title, placeId, start, duration = 150, low = 10, high = 45) => ({
    id: `bad-${placeId}-${start}`,
    type: "activity",
    title,
    description: `${title} is a Google Places landmark candidate in Central area.`,
    placeId,
    regionId: "downtown",
    startTimeMinutes: start,
    endTimeMinutes: start + duration,
    durationMinutes: duration,
    estimatedCostPerPerson: { low, high },
    tags: ["Google Places candidate"],
    category: "activity",
    weatherDependency: "low",
    indoorOutdoor: "mixed",
    reservationRecommended: false
  });
  const meal = (type, start) => ({
    id: `bad-${type}-${start}`,
    type,
    title: `${type} near destination`,
    description: "On Thyme Restaurant. Backup: The Kitchen Sink.",
    placeId: "on-thyme",
    regionId: "downtown",
    startTimeMinutes: start,
    endTimeMinutes: start + 60,
    durationMinutes: 60,
    estimatedCostPerPerson: { low: 10, high: 45 },
    mealDetails: { primaryOption: "On Thyme Restaurant", secondaryOption: "The Kitchen Sink", primaryPlaceId: "on-thyme", restaurantName: "On Thyme Restaurant" },
    category: "meal",
    tags: ["meal"]
  });
  const days = Array.from({ length: 5 }, (_, index) => ({
    id: `bad-day-${index + 1}`,
    dayNumber: index + 1,
    date: `2026-08-${20 + index}`,
    title: index === 2 ? "Beach, boardwalk, and oceanfront evening" : "Coastal nature and scenic water",
    theme: "Culture and landmarks day",
    region: "Central area",
    summary: "Generic Wilmington day.",
    scheduleItems: [
      meal("breakfast", 8 * 60),
      activity(index === 4 ? "Access 4" : "Kure Beach Pier", index === 4 ? "access-4" : "kure-pier", 9 * 60),
      meal("lunch", 12 * 60 + 30),
      activity("Bellamy Mansion Museum", "bellamy", 14 * 60, 150, 10, 45),
      {
        ...activity("Kure Beach Pier", "kure-pier", 20 * 60, 90, 10, 45),
        type: "evening"
      },
      meal("dinner", 18 * 60 + 30)
    ],
    backupOptions: [{ id: "backup-1", title: "The Kitchen Sink", placeId: "kitchen-sink", estimatedDurationMinutes: 150, estimatedCostPerPerson: { low: 10, high: 45 }, indoorOutdoor: "indoor", reason: "Universal backup.", description: "Universal backup.", accessibilityNotes: "" }],
    dailyBudget: { currency: "USD", low: 120, high: 300, label: "$120-$300" },
    dailyDriveMinutes: 0,
    warnings: []
  }));
  return {
    id: "bad-wilmington-2",
    sourceTripId: "bad",
    generatedAt: new Date().toISOString(),
    generationVersion: "test",
    status: "ready",
    origin: sourceTrip.from,
    destination: destinationProfile.canonicalName,
    startDate: sourceTrip.startDate,
    endDate: sourceTrip.endDate,
    numberOfDays: sourceTrip.days,
    travelers: 2,
    preferencesSnapshot: { ...sourceTrip, numberOfDays: sourceTrip.days, pace: "Balanced", travelers: 2, food: sourceTrip.food, alcohol: sourceTrip.alcohol },
    overview: { title: "Bad plan", destinationSummary: "Google Places candidate plan." },
    hotelBase: { primary: "Central area" },
    days,
    foodPlan: { dailyMealSummary: "On Thyme Restaurant repeats.", foodAreas: [] },
    routeSummary: { orderedRegions: ["Central area"], orderedStops: [], totalEstimatedDriveMinutes: 0 },
    budgetSummary: { currency: "USD", totalLow: 0, totalHigh: 0 },
    tripGuide: { quickReference: [], planningStages: [] },
    advisories: [],
    unresolvedConflicts: [],
    generationMetadata: {
      destinationProfileId: destinationProfile.id,
      destinationProfileSnapshot: destinationProfile,
      destinationArchetype: { primaryArchetype: "beach/coastal" },
      opportunityCoverageValidation: { hardFailures: [] },
      qualityCritique: { hardFailures: [] }
    }
  };
}

function wilmingtonFixture() {
  const regions = [
    region("downtown", "Downtown Wilmington and Riverwalk", 34.235, -77.948, ["historic-district"]),
    region("historic-district", "Historic Wilmington homes and museums", 34.236, -77.944, ["downtown"]),
    region("wrightsville", "Wrightsville Beach and Airlie Gardens", 34.216, -77.789, ["downtown"]),
    region("carolina-kure", "Carolina Beach, Kure Beach, and Fort Fisher", 33.971, -77.918, ["downtown"]),
    region("northern-coast", "Northern New Hanover coastal stops", 34.305, -77.745, ["wrightsville"])
  ];
  const places = [
    place("riverwalk", "Wilmington Riverwalk", "downtown", ["waterfront", "walk"], 95, 75, 0, 10, 34.236, -77.949, "outdoor", "medium", "evening"),
    place("battleship", "Battleship North Carolina", "downtown", ["museum", "history"], 96, 135, 15, 30, 34.236, -77.954, "mixed", "low", "morning", true),
    place("bellamy", "Bellamy Mansion Museum", "historic-district", ["museum", "historic house"], 88, 90, 12, 20, 34.239, -77.944, "indoor", "low", "morning", true),
    place("burgwin", "Burgwin-Wright House and Gardens", "historic-district", ["museum", "historic house", "garden"], 82, 75, 10, 18, 34.235, -77.947, "mixed", "low", "afternoon", true),
    place("airlie", "Airlie Gardens", "wrightsville", ["garden", "nature"], 93, 120, 10, 18, 34.216, -77.828, "outdoor", "medium", "morning", true),
    place("wrightsville-beach", "Wrightsville Beach", "wrightsville", ["beach", "waterfront"], 94, 105, 0, 20, 34.208, -77.796, "outdoor", "high", "afternoon"),
    place("johnny-mercers", "Johnnie Mercers Fishing Pier", "wrightsville", ["pier", "waterfront"], 79, 60, 2, 12, 34.214, -77.789, "outdoor", "high", "evening"),
    place("carolina-boardwalk", "Carolina Beach Boardwalk", "carolina-kure", ["boardwalk", "beach"], 91, 90, 0, 20, 34.034, -77.893, "outdoor", "medium", "evening"),
    place("fort-fisher", "Fort Fisher State Historic Site", "carolina-kure", ["history", "museum", "beach"], 90, 105, 0, 15, 33.971, -77.918, "mixed", "medium", "morning", true),
    place("aquarium", "North Carolina Aquarium at Fort Fisher", "carolina-kure", ["aquarium", "museum"], 84, 100, 14, 28, 33.963, -77.927, "indoor", "low", "afternoon", true),
    place("poplar-grove", "Poplar Grove Plantation", "northern-coast", ["history", "museum"], 76, 80, 8, 18, 34.297, -77.768, "mixed", "low", "afternoon", true),
    place("pages-creek", "Pages Creek Preserve", "northern-coast", ["nature", "trail"], 74, 70, 0, 10, 34.302, -77.754, "outdoor", "medium", "morning"),
    restaurant("blue-surf", "Blue Surf Cafe", "downtown", ["breakfast", "lunch"], 34.242, -77.899),
    restaurant("drift", "Drift Coffee & Kitchen", "wrightsville", ["breakfast", "lunch"], 34.218, -77.827),
    restaurant("eternal-sunshine", "Eternal Sunshine Cafe", "carolina-kure", ["breakfast", "lunch"], 34.04, -77.898),
    restaurant("bespoke", "Bespoke Coffee & Dry Goods", "downtown", ["breakfast"], 34.236, -77.949),
    restaurant("seabird", "Seabird", "downtown", ["lunch", "dinner"], 34.235, -77.949, 25, 60),
    restaurant("pinpoint", "PinPoint Restaurant", "downtown", ["dinner"], 34.237, -77.948, 28, 70),
    restaurant("savorez", "Savorez", "downtown", ["lunch", "dinner"], 34.234, -77.946, 18, 45),
    restaurant("tower7", "Tower 7 Baja Mexican Grill", "wrightsville", ["lunch", "dinner"], 34.209, -77.795, 15, 40),
    restaurant("smoke-on-water", "Smoke on the Water", "downtown", ["lunch", "dinner"], 34.262, -77.951, 18, 45),
    restaurant("shuckin-shack", "Shuckin' Shack Oyster Bar", "carolina-kure", ["lunch", "dinner"], 34.035, -77.893, 16, 50)
    ,restaurant("bits-cafe", "Bits Cafe", "downtown", ["breakfast", "lunch"], 34.232, -77.944, 10, 28)
    ,restaurant("sweet-n-savory", "Sweet n Savory Cafe", "wrightsville", ["breakfast", "lunch"], 34.221, -77.821, 12, 32)
    ,restaurant("kate-pancake", "Kate's Pancake House", "carolina-kure", ["breakfast"], 34.037, -77.896, 9, 24)
    ,restaurant("fork-n-cork", "The Fork n Cork", "downtown", ["lunch", "dinner"], 34.236, -77.947, 15, 42)
    ,restaurant("manna", "Manna", "downtown", ["dinner"], 34.235, -77.948, 30, 80)
    ,restaurant("oceanic", "Oceanic at Wrightsville Beach", "wrightsville", ["lunch", "dinner"], 34.208, -77.796, 20, 65)
    ,restaurant("freddie", "Freddie's Restaurant", "carolina-kure", ["dinner"], 34.001, -77.907, 18, 55)
  ];
  return {
    id: "generated-wilmington-quality-regression",
    canonicalName: "Wilmington, North Carolina, United States",
    aliases: ["wilmington", "wilmington nc", "wilmington north carolina", "wilmington north carolina united states"],
    country: "United States",
    state: "North Carolina",
    currency: "USD",
    summary: "Wilmington combines historic riverfront blocks, nearby beaches, coastal gardens, and Fort Fisher area excursions.",
    seasonalNotes: ["Late summer can be hot and stormy; keep outdoor beach and garden time flexible."],
    generalAdvisories: ["Verify official hours, reservations, parking, weather, and ticketing before travel."],
    planningRules: { defaultHotelRegion: "downtown" },
    regions,
    places,
    foodAreas: [
      foodArea("downtown-food", "Downtown Wilmington restaurants", "downtown"),
      foodArea("wrightsville-food", "Wrightsville Beach dining", "wrightsville"),
      foodArea("carolina-food", "Carolina Beach and Kure Beach dining", "carolina-kure")
    ],
    scenicRoutes: [
      route("downtown-historic", "Downtown to Historic Wilmington", "downtown", "historic-district", 8, 2),
      route("downtown-wrightsville", "Downtown to Wrightsville Beach", "downtown", "wrightsville", 22, 11),
      route("downtown-carolina", "Downtown to Carolina and Kure Beach", "downtown", "carolina-kure", 34, 19),
      route("wrightsville-north", "Wrightsville Beach to northern coastal stops", "wrightsville", "northern-coast", 18, 9)
    ],
    sourceMetadata: { provider: "test-live", freshness: "regression" }
  };
}

function region(id, name, lat, lng, neighboringRegionIds = []) {
  return { id, name, summary: `${name} planning cluster.`, centerCoordinates: { lat, lng }, tags: [], neighboringRegionIds, typicalTravelMinutesToRegions: {} };
}

function place(id, name, regionId, categories, priorityScore, duration, low, high, lat, lng, indoorOutdoor = "mixed", weatherDependency = "low", bestTimeOfDay = "morning", reservationRecommended = false) {
  return {
    id,
    name,
    regionId,
    shortDescription: `${name} is a visitor-ready Wilmington stop that fits its nearby route cluster.`,
    categories,
    tags: categories,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.max(30, duration - 30),
    maximumDurationMinutes: duration + 60,
    estimatedCostLow: low,
    estimatedCostHigh: high,
    indoorOutdoor,
    weatherDependency,
    accessibility: "moderate",
    dietaryRelevance: [],
    openingTimeGuidance: reservationRecommended ? "Use daytime scheduling unless official hours are confirmed." : "Flexible public access; verify details before travel.",
    bestTimeOfDay,
    reservationRecommended,
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: { lat, lng },
    backupForTags: indoorOutdoor === "indoor" ? ["rain", "heat"] : []
  };
}

function restaurant(id, name, regionId, mealTypes, lat, lng, low = 12, high = 35) {
  return {
    ...place(id, name, regionId, ["restaurant", "food"], 78, 60, low, high, lat, lng, "indoor", "low", mealTypes.includes("breakfast") ? "morning" : "dinner"),
    tags: ["restaurant", ...mealTypes, "local dining"],
    dietaryRelevance: ["confirm dietary needs directly"]
  };
}

function foodArea(id, name, regionId) {
  return { id, name, regionId, cuisines: ["Local cuisine", "Seafood", "American", "Vegetarian-friendly"], mealTypes: ["breakfast", "lunch", "dinner"], budgetLevels: ["budget", "moderate"], dietarySupport: ["Vegetarian"], eveningSuitability: ["quiet"] };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags: ["route"], bestTimeOfDay: "morning", notes: "Planning estimate." };
}

function maxCount(values) {
  return Math.max(0, ...Object.values(values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {})));
}

function maxShare(values) {
  return values.length ? maxCount(values) / values.length : 0;
}
