import assert from "node:assert/strict";
import { resolveDestinationProfile } from "../src/destination-data.js";
import { classifyPlaceForPlanning } from "../src/destination-intelligence.js";
import { generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = resolveDestinationProfile("Charlotte, North Carolina, United States");

assert.equal(profile.id, "charlotte");
assert.equal(profile.planningRules.defaultHotelRegion, "uptown");

const profileText = JSON.stringify(profile);
[
  "NASCAR Hall of Fame",
  "Romare Bearden Park",
  "South End Rail Trail",
  "NoDa arts district",
  "Camp North End",
  "U.S. National Whitewater Center",
  "Lake Norman",
  "Carowinds"
].forEach((expected) => assert.ok(profileText.includes(expected), `Charlotte profile should include ${expected}`));

const trip = {
  from: "Austin, Texas, United States",
  fromDisplay: "Austin, Texas, United States",
  destination: "Charlotte, North Carolina, United States",
  destinationDisplay: "Charlotte, North Carolina, United States",
  startDate: "2026-08-08",
  endDate: "2026-08-12",
  days: 5,
  adults: 1,
  children: 0,
  seniors: 0,
  groupType: "Solo trip",
  transportation: "Fly and rent a car",
  schedule: { pace: "Balanced", majorActivities: 2 },
  activity: { walking: "Easy walking", hiking: "No hiking" },
  food: { diet: [], restrictions: [], cuisineInterests: [], eveningPreferences: [] },
  alcohol: { preferences: [] },
  budget: { total: "$1,500-$3,500" },
  lodging: {},
  transport: { maxDrivingDay: "4 hours" },
  preferences: [],
  travelers: [
    {
      id: "traveler-1",
      name: "Traveler 1",
      ageGroup: "Adult (18-64)",
      gender: "",
      restrictions: [],
      notes: ""
    }
  ]
};

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready");
assert.equal(generated.plan.generationMetadata.usesGenericDestinationProfile, false);

const badCharlotteValidation = validateTripPlan(charlottePdfStyleBadPlan(profile, trip));
const badCharlotteCodes = badCharlotteValidation.blocking.map((issue) => issue.id).join(" ");
assert.match(badCharlotteCodes, /meal-repetition/, "Charlotte PDF-style repeated food hall meals should fail validation.");
assert.match(badCharlotteCodes, /template-language/, "Charlotte PDF-style provider template language should fail validation.");

const planText = JSON.stringify(generated.plan);
[
  "NASCAR Hall of Fame",
  "Freedom Park",
  "NoDa",
  "Camp North End",
  "Whitewater Center",
  "Lake Norman"
].forEach((expected) => assert.ok(planText.includes(expected), `Charlotte plan should include ${expected}`));

[
  "Gatewood Insurance",
  "Hampton Inn",
  "India Hook School",
  "Town of Indian Trail",
  "openrouteservice point-of-interest candidate",
  "Santa Monica Pier"
].forEach((bad) => assert.equal(planText.includes(bad), false, `Charlotte plan should not include ${bad}`));

[
  "stop to consider",
  "breakfast option",
  "lunch option",
  "dinner option",
  "No items in this tier",
  "Skipped a late evening activity",
  "Charlotte museums and historic sights",
  "Charlotte parks and outdoor stops",
  "Charlotte dining and evening area"
].forEach((bad) => assert.equal(new RegExp(bad, "i").test(planText), false, `Charlotte plan should not expose template language: ${bad}`));

assert.ok(generated.plan.days.some((day) => /Whitewater|Lake Norman|Carowinds|Concord/i.test(`${day.title} ${day.summary} ${JSON.stringify(day.scheduleItems)}`)), "Charlotte plan should consider nearby half-day or day-trip options.");

const lynchburgCharlottePlan = generateTripPlan(lynchburgCharlotteRegressionTrip()).plan;
assert.equal(lynchburgCharlottePlan.status, "ready", "Lynchburg to Charlotte regression should be buildable.");
assert.deepEqual(validateTripPlan(lynchburgCharlottePlan).blocking.map((issue) => issue.id), [], "Lynchburg to Charlotte regression should pass generated-plan validation.");
const lynchburgCharlotteText = JSON.stringify(lynchburgCharlottePlan);
const routeShapeOptions = lynchburgCharlottePlan.generationMetadata.tripShapeOptions;
assert.ok(routeShapeOptions.length >= 3, "Planner should compare at least three route-shape options before scheduling.");
assert.ok(routeShapeOptions.every((option) => option.title && option.sequence?.length && Array.isArray(option.benefits) && Number.isFinite(option.totalMajorDriving)), "Route-shape options should expose title, sequence, benefits, and driving diagnostics.");
assert.ok(routeShapeOptions.some((option) => /city|base|depth/i.test(`${option.title} ${option.structureType}`)), "Route-shape comparison should include a city-focused option.");
assert.ok(routeShapeOptions.some((option) => /nature|day trip|nearby/i.test(`${option.title} ${option.structureType} ${option.experienceMix}`) && /Whitewater|Lake|Garden|Mountain/i.test(JSON.stringify(option.sequence))), "Route-shape comparison should include nearby nature options.");
assert.ok(routeShapeOptions.some((option) => /regional|extension|second base/i.test(`${option.title} ${option.structureType}`) && /Asheville|Blue Ridge|Boone|Chimney|Grandfather/i.test(JSON.stringify(option.sequence))), "Route-shape comparison should include a regional extension option.");
assert.ok(/Whitewater|Lake Norman|South Mountains|Crowders|Daniel Stowe/i.test(lynchburgCharlotteText), "Generated Charlotte plan should schedule or evaluate credible nearby nature, not only central museums.");
assert.equal(/Museum of Illusions|Titanic: The Exhibition|Santa Monica Pier/i.test(lynchburgCharlotteText), false, "Charlotte regression should not contain irrelevant or novelty filler.");
assert.equal(/verified dining candidates|breakfast candidates|dinner candidates|food vendors and event-night dining/i.test(lynchburgCharlotteText), false, "Public plan should not rely on generic dining bucket labels.");
const lynchburgActivityText = lynchburgCharlottePlan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").map((item) => `${item.title} ${item.category} ${(item.tags || []).join(" ")}`).join(" ");
const museumCount = (lynchburgActivityText.match(/\bmuseum\b/gi) || []).length;
const activityCount = lynchburgCharlottePlan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").length;
assert.ok(museumCount / activityCount <= 0.45, "Balanced Charlotte regression should not be museum-dominated.");
assert.equal(lynchburgCharlottePlan.days.some((day) => (day.scheduleItems || []).some((item) => item.type === "evening" && /Whitewater|South Mountains|Crowders|Blue Ridge|Carowinds/i.test(item.title))), false, "Full-day or route-heavy anchors should not be downgraded into evening filler.");

[
  "South End Rail Trail",
  "NoDa arts district",
  "Camp North End",
  "Plaza Midwood evening area"
].forEach((name) => {
  const place = profile.places.find((candidate) => candidate.name === name);
  const flags = classifyPlaceForPlanning(place, profile, trip);
  assert.equal(flags.isRestaurant || flags.isFoodHall, false, `${name} should not classify as a concrete meal venue.`);
});

console.log("Charlotte planner quality tests passed");

function lynchburgCharlotteRegressionTrip() {
  return {
    from: "Lynchburg, Virginia, United States",
    fromDisplay: "Lynchburg, Virginia, United States",
    destination: "Charlotte, North Carolina, United States",
    destinationDisplay: "Charlotte, North Carolina, United States",
    startDate: "2026-08-08",
    endDate: "2026-08-12",
    days: 5,
    adults: 2,
    children: 0,
    seniors: 0,
    groupType: "Couple trip",
    transportation: "Drive my own car",
    schedule: { pace: "Balanced", majorActivities: 2 },
    activity: { walking: "Easy walking", hiking: "Easy hikes" },
    food: { diet: ["Vegetarian"], restrictions: [], cuisineInterests: [], eveningPreferences: ["Quiet evening venues", "Evening walks"] },
    alcohol: { preferences: ["No alcohol"] },
    budget: { total: "$1,500-$3,500" },
    lodging: {},
    transport: { maxDrivingDay: "4 hours" },
    preferences: [],
    travelers: [1, 2].map((number) => ({
      id: `traveler-${number}`,
      name: `Traveler ${number}`,
      ageGroup: "Adult (18-64)",
      gender: "",
      restrictions: [],
      notes: ""
    }))
  };
}

function charlottePdfStyleBadPlan(destinationProfile, sourceTrip) {
  const meal = (type, dayNumber, primary = "Optimist Hall", backup = "Monarch Market by Crescent Communities") => ({
    id: `bad-charlotte-${dayNumber}-${type}`,
    type,
    title: `Charlotte museums and historic sights ${type} option`,
    description: `${primary}. Backup: ${backup}. Cuisine fit: Local / local options.`,
    placeId: primary.toLowerCase().replaceAll(" ", "-"),
    regionId: "culture-area",
    startTimeMinutes: type === "breakfast" ? 480 : type === "lunch" ? 750 : 1110,
    endTimeMinutes: type === "breakfast" ? 525 : type === "lunch" ? 810 : 1185,
    durationMinutes: type === "breakfast" ? 45 : type === "lunch" ? 60 : 75,
    estimatedCostPerPerson: type === "breakfast" ? { low: 20, high: 60 } : type === "lunch" ? { low: 30, high: 70 } : { low: 30, high: 90 },
    mealDetails: { primaryOption: primary, secondaryOption: backup, restaurantName: primary, primaryPlaceId: primary.toLowerCase().replaceAll(" ", "-") },
    category: "meal",
    tags: ["meal"]
  });
  const activity = (dayNumber, title) => ({
    id: `bad-charlotte-${dayNumber}-${title.toLowerCase().replaceAll(" ", "-")}`,
    type: "activity",
    title,
    description: `${title} is a Museum stop to consider for Charlotte, North Carolina, United States. Verify current hours, tickets, access, and availability before travel.`,
    placeId: title.toLowerCase().replaceAll(" ", "-"),
    regionId: "culture-area",
    startTimeMinutes: 540,
    endTimeMinutes: 685,
    durationMinutes: 145,
    estimatedCostPerPerson: { low: 10, high: 40 },
    category: "activity",
    tags: ["museum"],
    weatherDependency: "low",
    indoorOutdoor: "indoor"
  });
  const days = Array.from({ length: 5 }, (_, index) => {
    const dayNumber = index + 1;
    return {
      id: `bad-charlotte-day-${dayNumber}`,
      dayNumber,
      date: `2026-08-${7 + dayNumber}`,
      title: dayNumber === 5 ? "Final morning and departure" : "Charlotte museums and historic sights museums and history",
      summary: "A balanced day grouped around Charlotte museums and historic sights and Charlotte core area to reduce unnecessary cross-city travel.",
      scheduleItems: [meal("breakfast", dayNumber), activity(dayNumber, dayNumber === 1 ? "Museum of Illusions - Charlotte" : "Titanic: The Exhibition - Charlotte"), meal("lunch", dayNumber), meal("dinner", dayNumber), {
        id: `bad-charlotte-note-${dayNumber}`,
        type: "note",
        title: "Early return",
        description: "Skipped a late evening activity to respect the preferred return time.",
        startTimeMinutes: 1300,
        endTimeMinutes: 1320,
        durationMinutes: 20,
        estimatedCostPerPerson: { low: 0, high: 0 }
      }],
      dailyFoodPlan: [],
      backupOptions: [],
      prioritySections: { dontMiss: [], worthDoing: [], bonusStops: [] }
    };
  });
  return {
    id: "bad-charlotte-pdf-style",
    sourceTripId: "bad",
    generatedAt: new Date().toISOString(),
    generationVersion: "test",
    status: "ready",
    origin: sourceTrip.from,
    destination: destinationProfile.canonicalName,
    startDate: sourceTrip.startDate,
    endDate: sourceTrip.endDate,
    numberOfDays: sourceTrip.days,
    travelers: sourceTrip.adults,
    preferencesSnapshot: { ...sourceTrip, numberOfDays: sourceTrip.days, pace: "Balanced", travelers: sourceTrip.adults, food: sourceTrip.food, alcohol: sourceTrip.alcohol },
    overview: { title: "Bad Charlotte plan", destinationSummary: "Charlotte core area plan." },
    hotelBase: { primary: "Charlotte core area" },
    days,
    foodPlan: { dailyMealSummary: "Optimist Hall repeats.", foodAreas: [] },
    routeSummary: { orderedRegions: ["Charlotte museums and historic sights"], orderedStops: [], totalEstimatedDriveMinutes: 0 },
    budgetSummary: { currency: "USD", totalLow: 0, totalHigh: 0 },
    tripGuide: { quickReference: [], planningStages: [] },
    advisories: [],
    unresolvedConflicts: [],
    generationMetadata: {
      destinationProfileId: destinationProfile.id,
      destinationProfileSnapshot: { ...destinationProfile, sourceMetadata: { provider: "google" } },
      opportunityCoverageValidation: { hardFailures: [] },
      qualityCritique: { hardFailures: [] }
    }
  };
}
