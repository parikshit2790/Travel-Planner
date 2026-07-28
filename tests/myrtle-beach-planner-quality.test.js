import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { buildDestinationIntelligence, classifyPlaceForPlanning } from "../src/destination-intelligence.js";
import { buildTravelerConstraintProfile, generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = registerGeneratedDestinationProfile(myrtleProviderFixture());
assert.ok(profile, "Myrtle Beach generated provider fixture should register.");

const trip = {
  from: "Charlotte, North Carolina, United States",
  fromDisplay: "Charlotte, North Carolina, United States",
  fromLocation: { canonicalName: "Charlotte, North Carolina, United States", latitude: 35.2271, longitude: -80.8431 },
  destination: "Myrtle Beach, South Carolina, United States",
  destinationDisplay: "Myrtle Beach, South Carolina, United States",
  destinationLocation: { canonicalName: "Myrtle Beach, South Carolina, United States", latitude: 33.6891, longitude: -78.8867 },
  startDate: "2026-08-08",
  endDate: "2026-08-10",
  days: 3,
  adults: 1,
  children: 0,
  seniors: 0,
  groupType: "Solo trip",
  transportation: "Drive",
  schedule: { pace: "Balanced", majorActivities: 2, earliestActivity: "9:00 AM", latestReturn: "9:30 PM" },
  activity: { walking: "Easy walking", hiking: "No hiking" },
  food: { diet: [], restrictions: [], cuisine: ["Local cuisine"], foodBudgetPerPerson: "$15-$30 per day", breakfastTime: "8:00 AM", lunchTime: "12:30 PM", dinnerTime: "6:30 PM" },
  alcohol: { preferences: ["Quiet evening venues", "Evening walks"] },
  budget: { total: "$1,500-$3,500" },
  lodging: { changeHotels: "Stay in one place" },
  transport: { maxDrivingDay: "4 hours" },
  preferences: [],
  travelers: [{ id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }]
};

const normalized = generateTripPlan(trip).plan.preferencesSnapshot;
const constraints = buildTravelerConstraintProfile(normalized);
const intelligence = buildDestinationIntelligence(profile, normalized, constraints);

assert.equal(intelligence.destinationArchetype.primaryArchetype, "beach/coastal");
assert.ok(intelligence.destinationArchetype.secondaryArchetypes.some((item) => /food|nightlife|theme|city|major/.test(item)), "Myrtle should carry secondary food/evening/entertainment context.");
assert.ok(intelligence.destinationArchetype.definingExperiences.includes("beach or oceanfront time"));

const byName = (name) => {
  const found = intelligence.allCandidates.find((item) => item.place.name === name);
  assert.ok(found, `Expected candidate ${name}`);
  return found;
};

assert.equal(classifyPlaceForPlanning(byName("Cherry Grove Fishing Pier").place, profile, normalized).isRestaurant, false, "Piers must not classify as restaurants.");
assert.equal(classifyPlaceForPlanning(byName("Medieval Times Dinner & Tournament").place, profile, normalized).servesLunch, false, "Dinner shows must not become lunch backups.");
assert.equal(byName("EdVenture Myrtle Beach").accepted, false, "Child-focused attractions should be rejected for a solo adult without children.");
assert.ok(byName("Myrtle Beach Boardwalk and Promenade").score > byName("Hollywood Wax Museum").score, "Boardwalk must outrank novelty indoor attractions.");
assert.ok(byName("Huntington Beach State Park").score > byName("Franklin G. Burroughs-Simeon B. Chapin Art Museum").score, "Coastal nature should outrank generic art museum content on a short beach trip.");

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready");
const plan = generated.plan;
const validation = validateTripPlan(plan);
assert.equal(validation.blocking.filter((issue) => issue.severity === "blocking").length, 0, JSON.stringify(validation.blocking));

const publicPlan = JSON.stringify({
  overview: plan.overview,
  days: plan.days,
  foodPlan: plan.foodPlan,
  routeSummary: plan.routeSummary,
  hotelBase: plan.hotelBase,
  tripGuide: plan.tripGuide
});
if (!publicPlan.includes("Huntington Beach State Park")) console.error(plan.days.map((day) => ({ title: day.title, items: day.scheduleItems.map((item) => `${item.type}:${item.title}`) })));

[
  "Central area day",
  "Culture and landmarks day",
  "Parks and viewpoints day",
  "generic restaurant near destination",
  "Verify hours for SkyWheel Myrtle Beach",
  "Verify hours for Murrells Inlet MarshWalk"
].forEach((bad) => assert.equal(publicPlan.includes(bad), false, `Plan should not include ${bad}`));

[
  "Myrtle Beach Boardwalk",
  "SkyWheel Myrtle Beach",
  "Huntington Beach State Park",
  "Murrells Inlet MarshWalk"
].forEach((expected) => assert.ok(publicPlan.includes(expected), `Plan should include or evaluate ${expected}`));

assert.ok(plan.days.some((day) => day.scheduleItems.some((item) => item.beachExperience)), "At least one real beach/waterfront block must include BeachExperience details.");
assert.ok(plan.days.some((day) => /Boardwalk|beach|oceanfront|MarshWalk|Coastal/i.test(day.title)), "Day titles must name actual coastal themes.");

const mealRows = plan.days.flatMap((day) => day.dailyFoodPlan);
const mealText = JSON.stringify(mealRows);
assert.equal(/Cherry Grove Fishing Pier/.test(mealText), false, "Pier must not appear as a meal venue.");
assert.equal(/Medieval Times Dinner/.test(mealText), false, "Dinner show must not appear as a normal meal or lunch backup.");
assert.equal(/EdVenture Myrtle Beach/.test(publicPlan), false, "Child-focused backup should not appear for solo adult.");
["Sea Captain's House", "Blueberry's Grill", "Hook & Barrel", "Wicked Tuna"].forEach((restaurant) => {
  assert.ok(mealText.includes(restaurant), `Meal plan should use actual Myrtle/coastal restaurants: ${restaurant}`);
});
mealRows.forEach((meal) => {
  assert.ok(meal.placeIdOrSource, "Meal guide should retain a restaurant/source id.");
});
plan.days.flatMap((day) => day.scheduleItems).filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type) && item.placeId).forEach((meal) => {
  assert.ok(meal.mealDetails.restaurantPlaceId, "Meal details should include restaurantPlaceId.");
  assert.ok(meal.mealDetails.restaurantName, "Meal details should include restaurantName.");
  assert.ok(meal.mealDetails.mealTypesServed.includes(meal.type), `${meal.mealDetails.restaurantName} should serve ${meal.type}.`);
});

const hangoutUses = mealRows.filter((meal) => /The Hangout/.test(`${meal.primaryOption} ${meal.backupOption}`)).length;
assert.ok(hangoutUses <= 2, "The Hangout must not be breakfast, lunch, and dinner across the trip.");
assert.equal(/\$10-\$45|\$10-\$50/.test(publicPlan), false, "Myrtle plan should not rely on repeated generic price bands.");

const finalDay = plan.days.at(-1);
const departIndex = finalDay.scheduleItems.findIndex((item) => item.title.startsWith("Depart "));
assert.ok(departIndex >= 0, "Final day should include departure travel.");
finalDay.scheduleItems.slice(departIndex + 1).forEach((item) => {
  assert.equal(/Myrtle|Boardwalk|SkyWheel|MarshWalk|Beach/.test(`${item.title} ${item.description} ${item.locationLabel}`), false, "No Myrtle-specific stop should happen after departure.");
});

console.log("Myrtle Beach planning quality tests passed");

function myrtleProviderFixture() {
  const regions = [
    region("central-boardwalk", "Myrtle Beach Boardwalk and oceanfront", 33.6922, -78.8777, ["broadway", "surfside-garden-city"]),
    region("broadway", "Broadway at the Beach", 33.7156, -78.8847, ["central-boardwalk", "barefoot-landing"]),
    region("murrells-inlet-huntington", "Murrells Inlet, MarshWalk, and Huntington Beach", 33.5521, -79.0414, ["surfside-garden-city"]),
    region("north-myrtle-cherry-grove", "North Myrtle Beach and Cherry Grove", 33.8296, -78.6478, ["barefoot-landing"]),
    region("barefoot-landing", "Barefoot Landing waterfront entertainment", 33.8015, -78.7419, ["north-myrtle-cherry-grove", "broadway"]),
    region("surfside-garden-city", "Surfside Beach and Garden City", 33.6060, -78.9731, ["central-boardwalk", "murrells-inlet-huntington"])
  ];
  const places = [
    place("central-beach", "Central Myrtle Beach beach access", "central-boardwalk", "Public oceanfront beach time with sand, surf, and flexible sunrise or afternoon walking.", ["beach", "oceanfront", "waterfront"], ["beach", "sunrise", "swimming", "sand"], 93, 100, 0, 20, 33.6891, -78.8867, "outdoor", "high", "morning"),
    place("boardwalk", "Myrtle Beach Boardwalk and Promenade", "central-boardwalk", "Signature oceanfront walk with beach access, arcades nearby, views, and classic Myrtle Beach energy.", ["boardwalk", "beach", "waterfront"], ["boardwalk", "oceanfront", "evening", "walk"], 98, 90, 0, 20, 33.6947, -78.8776, "outdoor", "high", "evening"),
    place("skywheel", "SkyWheel Myrtle Beach", "central-boardwalk", "Oceanfront observation wheel beside the Boardwalk; strongest as a sunset or evening anchor when operating.", ["landmark", "entertainment"], ["SkyWheel", "boardwalk", "evening", "sunset"], 92, 60, 18, 32, 33.6952, -78.8784, "mixed", "medium", "evening", true),
    place("broadway", "Broadway at the Beach", "broadway", "Large Myrtle Beach entertainment, shopping, dining, and evening district with flexible casual options.", ["entertainment", "shopping", "dining"], ["evening", "waterfront", "restaurants", "nightlife"], 90, 130, 0, 45, 33.7156, -78.8847, "mixed", "low", "evening"),
    place("huntington", "Huntington Beach State Park", "murrells-inlet-huntington", "Coastal state park with beach, marsh, birding, trails, and Atalaya-area history.", ["state park", "beach", "nature"], ["coastal", "beach", "wildlife", "Atalaya"], 96, 150, 8, 25, 33.5099, -79.0634, "outdoor", "high", "morning"),
    place("brookgreen", "Brookgreen Gardens", "murrells-inlet-huntington", "Major sculpture garden and Lowcountry landscape near Huntington Beach State Park.", ["garden", "art", "nature"], ["Brookgreen", "garden", "sculpture", "coastal"], 94, 160, 22, 35, 33.5210, -79.0970, "mixed", "medium", "morning"),
    place("marshwalk", "Murrells Inlet MarshWalk", "murrells-inlet-huntington", "Waterfront boardwalk with seafood restaurants, marsh views, live music, and sunset energy.", ["waterfront", "boardwalk", "dining"], ["MarshWalk", "seafood", "sunset", "evening", "live music"], 94, 100, 0, 45, 33.5532, -79.0421, "outdoor", "medium", "evening"),
    place("barefoot", "Barefoot Landing", "barefoot-landing", "Waterfront shopping, dining, entertainment, and relaxed evening area in North Myrtle Beach.", ["waterfront", "shopping", "entertainment"], ["Barefoot Landing", "evening", "dining"], 86, 120, 0, 45, 33.8015, -78.7419, "mixed", "low", "evening"),
    place("cherry-grove-beach", "Cherry Grove Beach", "north-myrtle-cherry-grove", "North Myrtle Beach sand and quieter coastal block suited to walking or sunrise.", ["beach", "coastal"], ["Cherry Grove", "beach", "sunrise"], 82, 90, 0, 15, 33.8279, -78.6328, "outdoor", "high", "morning"),
    place("cherry-grove-pier", "Cherry Grove Fishing Pier", "north-myrtle-cherry-grove", "Fishing pier and coastal viewing stop; not a restaurant by itself.", ["pier", "fishing", "beach"], ["pier", "fishing", "waterfront"], 76, 60, 3, 15, 33.8337, -78.6322, "outdoor", "high", "afternoon"),
    place("water-sports", "Myrtle Beach dolphin cruise and watersports", "central-boardwalk", "Weather-dependent dolphin cruise, boat, or watersports option for travelers who want more water activity.", ["water activity", "cruise"], ["dolphin cruise", "watersports", "boat"], 78, 120, 35, 95, 33.6891, -78.8867, "outdoor", "high", "afternoon", true),
    place("wax", "Hollywood Wax Museum", "broadway", "Indoor novelty wax museum near Broadway at the Beach; useful only as a bad-weather novelty backup.", ["museum", "entertainment"], ["wax museum", "indoor", "novelty"], 72, 90, 25, 40, 33.7138, -78.8849, "indoor", "low", "afternoon"),
    place("ripleys", "Ripley's Believe It or Not Myrtle Beach", "central-boardwalk", "Indoor oddities attraction near the Boardwalk; optional novelty stop rather than a defining anchor.", ["museum", "entertainment"], ["Ripley", "indoor", "novelty"], 70, 75, 20, 35, 33.6941, -78.8777, "indoor", "low", "afternoon"),
    place("art-museum", "Franklin G. Burroughs-Simeon B. Chapin Art Museum", "central-boardwalk", "Small local art museum south of central Myrtle Beach.", ["museum", "art"], ["local art", "indoor"], 68, 80, 0, 10, 33.6574, -78.9186, "indoor", "low", "afternoon"),
    place("edventure", "EdVenture Myrtle Beach", "central-boardwalk", "Children's museum and play-focused indoor attraction for families with younger kids.", ["children's museum", "kids", "family"], ["children", "playground", "toddler"], 88, 90, 10, 20, 33.6890, -78.8860, "indoor", "low", "afternoon"),
    place("medieval", "Medieval Times Dinner & Tournament", "broadway", "Ticketed dinner show attraction; not a normal lunch restaurant.", ["dinner show", "entertainment"], ["dinner show", "ticketed", "family entertainment"], 72, 150, 55, 90, 33.7117, -78.8814, "indoor", "low", "evening", true),
    place("sea-captains", "Sea Captain's House", "central-boardwalk", "Oceanfront Myrtle Beach seafood restaurant with breakfast, lunch, and dinner service.", ["restaurant", "seafood"], ["oceanfront", "breakfast", "lunch", "dinner", "seafood"], 89, 75, 18, 55, 33.7086, -78.8617, "indoor", "low", "dinner"),
    place("blueberry", "Blueberry's Grill", "central-boardwalk", "Popular Myrtle Beach breakfast and brunch restaurant.", ["restaurant", "breakfast", "brunch"], ["breakfast", "brunch", "cafe"], 86, 60, 12, 28, 33.7099, -78.8637, "indoor", "low", "morning"),
    place("hook-barrel", "Hook & Barrel", "central-boardwalk", "Seafood-focused dinner restaurant in Myrtle Beach with reservation-worthy coastal identity.", ["restaurant", "seafood"], ["dinner", "seafood", "vegetarian-friendly"], 88, 90, 25, 70, 33.7180, -78.8530, "indoor", "low", "dinner", true),
    place("wicked-tuna", "Wicked Tuna at Murrells Inlet", "murrells-inlet-huntington", "Murrells Inlet seafood restaurant that fits a MarshWalk or Huntington Beach day.", ["restaurant", "seafood"], ["lunch", "dinner", "waterfront", "seafood"], 86, 80, 18, 60, 33.5531, -79.0425, "indoor", "low", "dinner"),
    place("croissants", "Croissants Bistro and Bakery", "central-boardwalk", "Breakfast, bakery, brunch, and lunch candidate in Myrtle Beach.", ["restaurant", "bakery", "cafe"], ["breakfast", "brunch", "bakery", "lunch"], 80, 60, 10, 26, 33.7234, -78.8782, "indoor", "low", "morning"),
    place("hangout", "The Hangout Myrtle Beach", "broadway", "Casual restaurant and entertainment venue at Broadway at the Beach; useful once, not every meal.", ["restaurant", "entertainment"], ["lunch", "dinner", "Broadway at the Beach"], 78, 75, 16, 45, 33.7158, -78.8817, "mixed", "low", "lunch")
  ];
  return {
    id: "generated-myrtle-beach-regression",
    canonicalName: "Myrtle Beach, South Carolina, United States",
    aliases: ["myrtle beach", "myrtle beach sc", "myrtle beach south carolina", "myrtle beach south carolina united states"],
    country: "United States",
    state: "South Carolina",
    currency: "USD",
    summary: "Myrtle Beach is a beach, oceanfront entertainment, seafood, nightlife, water-activity, and coastal-nature destination.",
    seasonalNotes: ["August is hot and humid; plan beach and outdoor blocks around heat, storms, and sun exposure."],
    generalAdvisories: ["Verify current beach rules, weather, water conditions, hours, menus, tickets, and parking before travel."],
    planningRules: { defaultHotelRegion: "central-boardwalk" },
    regions,
    places,
    foodAreas: [
      foodArea("central-food", "Central Myrtle Beach oceanfront restaurants", "central-boardwalk"),
      foodArea("marshwalk-food", "Murrells Inlet seafood restaurants", "murrells-inlet-huntington"),
      foodArea("broadway-food", "Broadway at the Beach restaurants", "broadway"),
      foodArea("barefoot-food", "Barefoot Landing waterfront restaurants", "barefoot-landing")
    ],
    scenicRoutes: [
      route("central-broadway", "Central Myrtle Beach to Broadway at the Beach", "central-boardwalk", "broadway", 12, 4),
      route("central-murrells", "Central Myrtle Beach to Murrells Inlet", "central-boardwalk", "murrells-inlet-huntington", 32, 22),
      route("central-north", "Central Myrtle Beach to North Myrtle Beach", "central-boardwalk", "north-myrtle-cherry-grove", 35, 20),
      route("north-barefoot", "North Myrtle Beach to Barefoot Landing", "north-myrtle-cherry-grove", "barefoot-landing", 12, 6),
      route("central-surfside", "Central Myrtle Beach to Surfside Beach", "central-boardwalk", "surfside-garden-city", 22, 12)
    ]
  };
}

function region(id, name, lat, lng, neighboringRegionIds = []) {
  return { id, name, summary: `${name} planning region.`, centerCoordinates: { lat, lng }, tags: [], neighboringRegionIds, typicalTravelMinutesToRegions: {} };
}

function place(id, name, regionId, shortDescription, categories, tags, priorityScore, typicalDurationMinutes, costLow, costHigh, lat, lng, indoorOutdoor = "mixed", weatherDependency = "low", bestTimeOfDay = "morning", reservationRecommended = false) {
  return {
    id,
    name,
    regionId,
    shortDescription,
    categories,
    tags,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes,
    minimumDurationMinutes: Math.min(45, typicalDurationMinutes),
    maximumDurationMinutes: Math.max(typicalDurationMinutes, 150),
    estimatedCostLow: costLow,
    estimatedCostHigh: costHigh,
    indoorOutdoor,
    weatherDependency,
    accessibility: "moderate",
    dietaryRelevance: /restaurant|food|cafe|bakery|seafood/i.test(categories.join(" ")) ? ["confirm dietary needs directly"] : [],
    openingTimeGuidance: "Confirm current opening hours before travel.",
    bestTimeOfDay,
    reservationRecommended,
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: { lat, lng },
    backupForTags: []
  };
}

function foodArea(id, name, regionId) {
  return {
    id,
    name,
    regionId,
    cuisines: ["Seafood", "American", "Casual dining", "Vegetarian-friendly"],
    mealTypes: ["breakfast", "lunch", "dinner"],
    budgetLevels: ["budget", "moderate"],
    dietarySupport: ["Vegetarian"],
    eveningSuitability: ["quiet", "sunset"],
    shortDescription: `${name}; confirm menus and hours directly.`
  };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags: ["route"], bestTimeOfDay: "morning", notes: "Verify current route conditions." };
}
