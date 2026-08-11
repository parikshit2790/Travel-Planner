import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = registerGeneratedDestinationProfile(washingtonFixture());

const trip = {
  from: "Charlotte, North Carolina, United States",
  fromDisplay: "Charlotte, North Carolina, United States",
  fromLocation: { canonicalName: "Charlotte, North Carolina, United States", latitude: 35.2271, longitude: -80.8431 },
  destination: "Washington, District of Columbia, United States",
  destinationDisplay: "Washington, District of Columbia, United States",
  destinationLocation: { canonicalName: "Washington, District of Columbia, United States", latitude: 38.9072, longitude: -77.0369 },
  arrivalRouteEstimate: { durationMinutes: 425, distanceMiles: 398, provider: "test-live-route-provider", checkedAt: "2026-08-04T12:00:00.000Z", confidence: "provider" },
  routeQualityRequired: true,
  startDate: "2026-08-08",
  endDate: "2026-08-12",
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

assert.ok(profile, "Washington generated provider fixture should register.");

const badValidation = validateTripPlan(washingtonBadPlan(profile, trip));
const badCodes = badValidation.blocking.map((issue) => issue.id).join(" ");
assert.match(badCodes, /arrival-route-implausible/, "Three-hour Charlotte-to-Washington travel (implausible 132mph) must fail.");
assert.match(badCodes, /meal-repetition/, "Repeated Union Market/The Roost meal pattern must fail.");
assert.match(badCodes, /generic-pricing/, "Fake generic attraction pricing must fail.");
assert.match(badCodes, /template-language|internal-language/, "Stale/generated area labels must fail.");

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready", JSON.stringify(generated.errors || generated));

const plan = generated.plan;
assert.equal(generated.plan.status, "ready", JSON.stringify(generated.plan.advisories));
const validation = validateTripPlan(plan);
assert.equal(validation.blocking.filter((issue) => issue.severity === "blocking").length, 0, JSON.stringify(validation.blocking));
assert.ok(plan.generationMetadata.qualityCritique.score >= 85, JSON.stringify(plan.generationMetadata.qualityCritique));

const publicPlan = JSON.stringify({
  overview: plan.overview,
  days: plan.days,
  foodPlan: plan.foodPlan,
  routeSummary: plan.routeSummary,
  hotelBase: plan.hotelBase,
  tripGuide: plan.tripGuide
});

[
  "Steven F. Udvar-Hazy Center area",
  "Washington orientation district",
  "Trail and waterfall day",
  "Google Places",
  "Central area",
  "Parks and viewpoints"
].forEach((bad) => assert.equal(publicPlan.includes(bad), false, `Generated plan must not include ${bad}`));

[
  "National Mall",
  "Lincoln Memorial",
  "United States Capitol",
  "Library of Congress",
  "National Gallery of Art",
  "Georgetown",
  "The Wharf"
].forEach((expected) => assert.ok(publicPlan.includes(expected), `Generated plan should cover Washington first-time anchor: ${expected}`));

const arrivalTravel = plan.days[0].scheduleItems.find((item) => item.type === "travel" && item.title.startsWith("Travel to "));
assert.ok(arrivalTravel, "Arrival day should include travel from Charlotte.");
assert.ok(arrivalTravel.durationMinutes >= 380 && arrivalTravel.durationMinutes <= 520, `Arrival travel should use the provider route duration, got ${arrivalTravel.durationMinutes}.`);
assert.equal(arrivalTravel.travelFromPrevious.estimateType, "provider-route-estimate");
const arrivalActivities = plan.days[0].scheduleItems.filter((item) => item.type === "activity");
assert.ok(arrivalActivities.length <= 1, "Long-drive arrival day should be light.");
assert.ok(arrivalActivities.every((item) => item.startTimeMinutes >= 17 * 60), "Long-drive arrival activity should not start before early evening.");

const finalTravel = plan.days.at(-1).scheduleItems.find((item) => item.type === "travel" && item.title.startsWith("Depart "));
assert.ok(finalTravel?.durationMinutes >= 380, "Departure travel should use the same realistic route duration.");

plan.days.forEach((day) => {
  const text = JSON.stringify(day);
  assert.equal(/Great Falls Park/.test(text) && /Library of Congress|Kennedy Center/.test(text), false, "Regional excursions must not be mixed with central-city institutions on the same day.");
  day.backupOptions.forEach((backup) => {
    assert.equal(/Steven F\. Udvar-Hazy Center|Great Falls Park/.test(backup.title), false, `${backup.title} should not be used as a local weather backup for central DC.`);
    assert.doesNotMatch(backup.reason, /same route cluster/i, "Backup language should not claim distant places are the same route cluster.");
  });
});

const mealRows = plan.days.flatMap((day) => day.dailyFoodPlan);
const primaryMeals = mealRows.map((meal) => meal.primaryOption).filter(Boolean);
assert.ok(new Set(primaryMeals).size >= Math.ceil(primaryMeals.length * 0.7), "Meals should be diverse and route-specific.");
assert.ok(countMatching(primaryMeals, /Union Market/) <= 1, "Union Market should not dominate the trip.");
assert.ok(countMatching(primaryMeals, /The Roost/) <= 1, "The Roost should not dominate the trip.");
assert.ok(countMatching(primaryMeals, /A Baked Joint|Yellow The Cafe|Call Your Mother|Baked & Wired/) >= 2, "Breakfast/cafe planning should include varied real cafe options.");

const freeFederalItems = plan.days
  .flatMap((day) => day.scheduleItems)
  .filter((item) => item.type === "activity" && /Smithsonian|National Gallery of Art|Library of Congress|United States Capitol|Lincoln Memorial|United States Botanic Garden|National Museum/.test(item.title));
assert.ok(freeFederalItems.length >= 3, "The plan should include multiple free federal or Smithsonian anchors.");
freeFederalItems.forEach((item) => {
  assert.equal(item.estimatedCostPerPerson.low, 0, `${item.title} should not have a fake admission low estimate.`);
  assert.equal(item.estimatedCostPerPerson.high, 0, `${item.title} should not have a fake admission high estimate.`);
});

const travelModes = plan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "travel").map((item) => item.travelFromPrevious?.mode || "");
assert.ok(travelModes.some((mode) => /Walk\/Metro/.test(mode)), "Urban transfers should consider walking/Metro instead of driving everywhere.");

const shapeOptions = plan.generationMetadata.tripShapeOptions || [];
assert.ok(shapeOptions.length >= 3, "Trip shape should provide at least three route options before final scheduling.");

console.log("Washington planning regression tests passed");

function washingtonBadPlan(destinationProfile, sourceTrip) {
  const meal = (type, start) => ({
    id: `bad-${type}-${start}`,
    type,
    title: `Steven F. Udvar-Hazy Center area ${type}`,
    description: "Union Market. Backup: The Roost.",
    placeId: "union-market",
    regionId: "udvar-hazy",
    startTimeMinutes: start,
    endTimeMinutes: start + 60,
    durationMinutes: 60,
    estimatedCostPerPerson: { low: 10, high: 45 },
    mealDetails: { primaryOption: "Union Market", secondaryOption: "The Roost", primaryPlaceId: "union-market", restaurantName: "Union Market" },
    category: "meal",
    tags: ["meal"]
  });
  const activity = (title, regionId, start, low = 10, high = 45) => ({
    id: `bad-${title.replace(/\W+/g, "-")}`,
    type: "activity",
    title,
    description: `${title} in Washington orientation district.`,
    placeId: title.toLowerCase().replace(/\W+/g, "-"),
    regionId,
    startTimeMinutes: start,
    endTimeMinutes: start + 120,
    durationMinutes: 120,
    estimatedCostPerPerson: { low, high },
    category: "museum",
    tags: ["museum", "culture"],
    weatherDependency: "low",
    indoorOutdoor: "indoor",
    reservationRecommended: true
  });
  const days = Array.from({ length: 5 }, (_, index) => ({
    id: `bad-day-${index + 1}`,
    dayNumber: index + 1,
    date: `2026-08-${8 + index}`,
    title: index === 2 ? "Trail and waterfall day" : "Steven F. Udvar-Hazy Center area museums and history",
    theme: "Culture and landmarks day",
    region: "Washington orientation district",
    summary: "Grouped around Washington orientation district and Steven F. Udvar-Hazy Center area.",
    scheduleItems: [
      index === 0 ? {
        id: "bad-arrival",
        type: "travel",
        title: "Travel to Washington, District of Columbia, United States",
        description: "Drive from Charlotte to Washington.",
        startTimeMinutes: 8 * 60 + 55,
        endTimeMinutes: 11 * 60 + 55,
        durationMinutes: 180,
        estimatedCostPerPerson: { low: 0, high: 0 },
        travelFromPrevious: { mode: "Drive", durationMinutes: 180, distanceMiles: 398, estimateType: "conservative-arrival-estimate" }
      } : meal("breakfast", 8 * 60),
      meal("lunch", 12 * 60 + 30),
      activity(index === 2 ? "Great Falls Park" : "National Museum of Natural History", index === 2 ? "great-falls" : "mall", 14 * 60),
      activity(index === 2 ? "Library of Congress" : "United States Capitol", "capitol", 16 * 60 + 30),
      meal("dinner", 18 * 60 + 30)
    ],
    backupOptions: [{ id: "bad-backup", title: "Steven F. Udvar-Hazy Center", placeId: "udvar-hazy", estimatedDurationMinutes: 180, estimatedCostPerPerson: { low: 10, high: 45 }, indoorOutdoor: "indoor", reason: "Indoor alternative in the same route cluster, about 45 minutes away.", description: "Stale regional backup.", accessibilityNotes: "" }],
    dailyBudget: { currency: "USD", low: 120, high: 300, label: "$120-$300" },
    dailyDriveMinutes: 180,
    warnings: []
  }));
  return {
    id: "bad-washington",
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
    preferencesSnapshot: { ...sourceTrip, numberOfDays: sourceTrip.days, travelers: 2, pace: "Balanced", routeQualityRequired: true },
    overview: { title: "Bad Washington plan", destinationSummary: "Provider candidate plan." },
    hotelBase: { primary: "Washington orientation district" },
    days,
    foodPlan: { dailyMealSummary: "Union Market and The Roost repeat.", foodAreas: [] },
    routeSummary: { orderedRegions: ["Washington orientation district"], orderedStops: [], totalEstimatedDriveMinutes: 360 },
    budgetSummary: { currency: "USD", totalLow: 0, totalHigh: 0 },
    tripGuide: { quickReference: [], planningStages: [] },
    advisories: [],
    unresolvedConflicts: [],
    generationMetadata: {
      destinationProfileId: destinationProfile.id,
      destinationProfileSnapshot: destinationProfile,
      sourceDiagnostics: { destinationResearchSource: "test-live", routeSource: "planner-estimate" },
      destinationArchetype: { primaryArchetype: "major city" },
      opportunityCoverageValidation: { hardFailures: [] },
      qualityCritique: { hardFailures: [] }
    }
  };
}

function washingtonFixture() {
  const regions = [
    region("mall", "National Mall and memorials", 38.8895, -77.0353, ["capitol", "penn-quarter", "wharf"]),
    region("capitol", "Capitol Hill and Eastern Market", 38.8899, -77.0091, ["mall", "penn-quarter"]),
    region("penn-quarter", "Penn Quarter and downtown museums", 38.8977, -77.0230, ["mall", "capitol"]),
    region("georgetown", "Georgetown and Dupont Circle", 38.9097, -77.0654, ["mall", "wharf"]),
    region("wharf", "The Wharf and Southwest Waterfront", 38.8791, -77.0260, ["mall", "georgetown"]),
    region("arlington-alexandria", "Arlington and Old Town Alexandria", 38.8816, -77.0910, ["mall"]),
    region("regional-virginia", "Regional Virginia excursions", 38.9969, -77.2544, [])
  ];
  const places = [
    attraction("national-mall", "National Mall monument walk", "mall", ["landmark", "monument", "signature"], ["national mall", "memorial", "first time", "free admission"], 99, 150, 0, 0, 38.8895, -77.0353, "outdoor", "medium", "evening", false, "Free public access."),
    attraction("lincoln-memorial", "Lincoln Memorial and Reflecting Pool", "mall", ["monument", "memorial", "signature"], ["national mall", "iconic", "evening walk", "free admission"], 98, 75, 0, 0, 38.8893, -77.0502, "outdoor", "medium", "evening", false, "Free public access."),
    attraction("nmaahc", "National Museum of African American History and Culture", "mall", ["museum", "history", "signature"], ["smithsonian", "timed entry", "free admission"], 97, 150, 0, 0, 38.8911, -77.0320, "indoor", "low", "morning", true, "Free timed-entry passes may be required."),
    attraction("natural-history", "Smithsonian National Museum of Natural History", "mall", ["museum", "science", "signature"], ["smithsonian", "free admission"], 93, 120, 0, 0, 38.8913, -77.0261, "indoor", "low", "afternoon", false, "Free admission."),
    attraction("capitol", "United States Capitol", "capitol", ["landmark", "civic", "signature"], ["capitol", "tour", "free admission"], 98, 120, 0, 0, 38.8899, -77.0091, "indoor", "low", "morning", true, "Free tour reservations recommended."),
    attraction("library-congress", "Library of Congress", "capitol", ["library", "architecture", "signature"], ["capitol hill", "free admission"], 96, 90, 0, 0, 38.8887, -77.0047, "indoor", "low", "afternoon", true, "Free timed-entry passes may be required."),
    attraction("botanic-garden", "United States Botanic Garden", "capitol", ["garden", "museum"], ["capitol hill", "free admission"], 89, 75, 0, 0, 38.8880, -77.0127, "mixed", "low", "afternoon", false, "Free admission."),
    attraction("eastern-market", "Eastern Market", "capitol", ["market", "neighborhood", "food"], ["market", "weekend", "local neighborhood"], 87, 75, 0, 20, 38.8852, -76.9965, "mixed", "medium", "afternoon", false, "Free to browse."),
    attraction("national-gallery", "National Gallery of Art", "penn-quarter", ["museum", "art", "signature"], ["free admission", "gallery"], 95, 140, 0, 0, 38.8913, -77.0200, "indoor", "low", "morning", false, "Free admission."),
    attraction("portrait-gallery", "National Portrait Gallery", "penn-quarter", ["museum", "art"], ["free admission", "evening-friendly"], 90, 100, 0, 0, 38.8979, -77.0229, "indoor", "low", "afternoon", false, "Free admission."),
    attraction("georgetown-waterfront", "Georgetown Waterfront and C&O Canal walk", "georgetown", ["neighborhood", "waterfront"], ["georgetown", "walk", "couple", "evening"], 92, 105, 0, 10, 38.9046, -77.0663, "outdoor", "medium", "evening", false, "Free public access."),
    attraction("dupont", "Dupont Circle neighborhood walk", "georgetown", ["neighborhood", "architecture"], ["dupont", "cafes", "bookstores"], 84, 75, 0, 10, 38.9097, -77.0434, "outdoor", "medium", "afternoon", false, "Free public access."),
    attraction("wharf", "The Wharf waterfront promenade", "wharf", ["waterfront", "neighborhood", "evening"], ["sunset", "restaurants", "couple", "promenade"], 92, 90, 0, 20, 38.8791, -77.0260, "outdoor", "medium", "evening", false, "Free public access."),
    attraction("kennedy-center", "Kennedy Center terrace and river views", "wharf", ["performing arts", "waterfront", "evening"], ["viewpoint", "terrace", "sunset"], 86, 75, 0, 30, 38.8959, -77.0550, "mixed", "medium", "evening", false, "Free terrace access; ticketed performances extra."),
    attraction("arlington", "Arlington National Cemetery", "arlington-alexandria", ["history", "landmark"], ["arlington", "regional", "memorial"], 88, 120, 0, 20, 38.8797, -77.0710, "outdoor", "medium", "morning", false, "Free admission; shuttle tours cost extra."),
    attraction("old-town", "Old Town Alexandria waterfront", "arlington-alexandria", ["neighborhood", "waterfront", "history"], ["regional", "nearby", "couple", "evening"], 86, 120, 0, 20, 38.8048, -77.0469, "outdoor", "medium", "afternoon", false, "Free public access."),
    attraction("great-falls", "Great Falls Park", "regional-virginia", ["park", "regional", "day trip"], ["regional excursion", "nature", "outside the city"], 82, 150, 10, 20, 38.9982, -77.2544, "outdoor", "high", "morning", false, "Entrance fee may apply."),
    attraction("udvar-hazy", "Steven F. Udvar-Hazy Center", "regional-virginia", ["museum", "aviation", "regional"], ["airport", "suburban", "outside the city"], 75, 150, 0, 20, 38.9109, -77.4442, "indoor", "low", "morning", false, "Free admission; parking may cost extra."),
    restaurant("baked-joint", "A Baked Joint", "penn-quarter", ["breakfast", "lunch"], 38.9036, -77.0219, 10, 26),
    restaurant("yellow", "Yellow The Cafe", "georgetown", ["breakfast", "lunch"], 38.9058, -77.0595, 10, 28),
    restaurant("call-your-mother", "Call Your Mother Deli", "georgetown", ["breakfast", "lunch"], 38.9122, -77.0450, 9, 24),
    restaurant("baked-wired", "Baked & Wired", "georgetown", ["breakfast"], 38.9036, -77.0602, 8, 20),
    restaurant("old-ebbitt", "Old Ebbitt Grill", "penn-quarter", ["lunch", "dinner"], 38.8979, -77.0338, 20, 55),
    restaurant("oyamel", "Oyamel Cocina Mexicana", "penn-quarter", ["lunch", "dinner"], 38.8949, -77.0215, 18, 48),
    restaurant("zaytinya", "Zaytinya", "penn-quarter", ["lunch", "dinner"], 38.8986, -77.0230, 22, 60),
    restaurant("founding-farmers", "Founding Farmers DC", "penn-quarter", ["breakfast", "lunch", "dinner"], 38.9003, -77.0446, 18, 50),
    restaurant("farmers-fishers", "Farmers Fishers Bakers", "georgetown", ["breakfast", "lunch", "dinner"], 38.9019, -77.0614, 18, 55),
    restaurant("mi-vida", "Mi Vida at The Wharf", "wharf", ["lunch", "dinner"], 38.8802, -77.0269, 18, 52),
    restaurant("martins", "Martin's Tavern", "georgetown", ["lunch", "dinner"], 38.9044, -77.0628, 18, 50),
    restaurant("union-market", "Union Market", "capitol", ["lunch", "dinner"], 38.9080, -76.9976, 12, 35, ["food hall", "market", "lunch", "dinner"]),
    restaurant("the-roost", "The Roost", "capitol", ["lunch", "dinner"], 38.8813, -76.9968, 12, 35, ["food hall", "market hall", "lunch", "dinner"])
  ];
  return {
    id: "generated-washington-quality-regression",
    canonicalName: "Washington, District of Columbia, United States",
    aliases: ["washington", "washington dc", "washington d c", "district of columbia"],
    country: "United States",
    state: "District of Columbia",
    currency: "USD",
    summary: "Washington, DC is a major city and capital destination with first-time monuments, free federal museums, civic landmarks, historic neighborhoods, waterfront evenings, and optional nearby Virginia excursions.",
    seasonalNotes: ["August is hot and humid; mix shaded/indoor museum time with early or evening monument walks."],
    generalAdvisories: ["Verify current hours, timed-entry rules, security screening, transit status, restaurant menus, prices, and road conditions before travel."],
    destinationArchetype: { primaryArchetype: "major city" },
    planningRules: { defaultHotelRegion: "penn-quarter" },
    regions,
    places,
    foodAreas: [
      foodArea("penn-quarter-food", "Penn Quarter restaurants and cafes", "penn-quarter"),
      foodArea("georgetown-food", "Georgetown cafes and restaurants", "georgetown"),
      foodArea("wharf-food", "The Wharf waterfront restaurants", "wharf"),
      foodArea("capitol-food", "Capitol Hill and market dining", "capitol")
    ],
    scenicRoutes: [
      route("mall-capitol", "National Mall to Capitol Hill", "mall", "capitol", 12, 2, ["walkable", "metro"]),
      route("mall-penn", "National Mall to Penn Quarter", "mall", "penn-quarter", 10, 1, ["walkable", "metro"]),
      route("mall-georgetown", "National Mall to Georgetown", "mall", "georgetown", 22, 4, ["metro", "rideshare"]),
      route("mall-wharf", "National Mall to The Wharf", "mall", "wharf", 14, 2, ["walkable", "metro"]),
      route("capitol-penn", "Capitol Hill to Penn Quarter", "capitol", "penn-quarter", 14, 2, ["metro"]),
      route("georgetown-wharf", "Georgetown to The Wharf", "georgetown", "wharf", 24, 5, ["rideshare"]),
      route("mall-arlington", "National Mall to Arlington and Alexandria", "mall", "arlington-alexandria", 28, 6, ["metro", "drive"]),
      route("mall-regional", "National Mall to regional Virginia excursions", "mall", "regional-virginia", 45, 21, ["drive-only"]),
      route("capitol-regional", "Capitol Hill to regional Virginia excursions", "capitol", "regional-virginia", 55, 27, ["drive-only"])
    ],
    sourceMetadata: { provider: "test-live", freshness: "regression", sourceUrl: "test://washington-regression" }
  };
}

function region(id, name, lat, lng, neighboringRegionIds = []) {
  return { id, name, summary: `${name} visitor planning cluster.`, centerCoordinates: { lat, lng }, tags: ["urban", "major city"], neighboringRegionIds, typicalTravelMinutesToRegions: {} };
}

function attraction(id, name, regionId, categories, tags, priorityScore, duration, low, high, lat, lng, indoorOutdoor, weatherDependency, bestTimeOfDay, reservationRecommended = false, admissionStatus = "") {
  return {
    id,
    name,
    regionId,
    shortDescription: `${name} is a Washington visitor anchor that should be scheduled with nearby neighborhoods, transit, security, and timing in mind.`,
    categories,
    tags,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.max(45, duration - 30),
    maximumDurationMinutes: duration + 60,
    estimatedCostLow: low,
    estimatedCostHigh: high,
    admissionStatus,
    indoorOutdoor,
    weatherDependency,
    accessibility: "moderate",
    dietaryRelevance: [],
    openingTimeGuidance: reservationRecommended ? "Confirm official timed-entry, security, and tour requirements before travel." : "Confirm official hours and access conditions before travel.",
    bestTimeOfDay,
    reservationRecommended,
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: { lat, lng },
    backupForTags: indoorOutdoor === "indoor" ? ["rain", "heat"] : [],
    sourceMetadata: { provider: "test-live", providerPlaceId: id, retrievedName: name, dataConfidence: "high", sourceUrl: "test://washington-regression" }
  };
}

function restaurant(id, name, regionId, mealTypes, lat, lng, low = 12, high = 35, extraTags = []) {
  return {
    ...attraction(id, name, regionId, ["restaurant", "food"], ["restaurant", ...mealTypes, "local dining", ...extraTags], 78, 60, low, high, lat, lng, "indoor", "low", mealTypes.includes("breakfast") ? "morning" : "dinner", mealTypes.includes("dinner"), ""),
    dietaryRelevance: ["confirm dietary needs directly"]
  };
}

function foodArea(id, name, regionId) {
  return { id, name, regionId, cuisines: ["Local cuisine", "Vegetarian-friendly", "American", "Casual dining"], mealTypes: ["breakfast", "lunch", "dinner"], budgetLevels: ["budget", "moderate"], dietarySupport: ["Vegetarian"], eveningSuitability: ["quiet"] };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags = ["route"]) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags, bestTimeOfDay: "morning", notes: "Regression route estimate; verify live traffic and transit." };
}

function countMatching(values, pattern) {
  return values.filter((value) => pattern.test(value)).length;
}
