import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { buildDestinationIntelligence, classifyPlaceForPlanning } from "../src/destination-intelligence.js";
import { buildTravelerConstraintProfile, generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = registerGeneratedDestinationProfile(raleighProviderFixture());
assert.ok(profile, "Raleigh generated provider fixture should register.");

const trip = {
  from: "Augusta, Georgia, United States",
  fromDisplay: "Augusta, Georgia, United States",
  fromLocation: { canonicalName: "Augusta, Georgia, United States", latitude: 33.4735, longitude: -82.0105 },
  destination: "Raleigh, North Carolina, United States",
  destinationDisplay: "Raleigh, North Carolina, United States",
  destinationLocation: { canonicalName: "Raleigh, North Carolina, United States", latitude: 35.7796, longitude: -78.6382 },
  startDate: "2026-08-08",
  endDate: "2026-08-12",
  days: 5,
  adults: 1,
  children: 0,
  seniors: 0,
  groupType: "Solo trip",
  transportation: "Drive",
  schedule: { pace: "Balanced", majorActivities: 2, earliestActivity: "9:00 AM", latestReturn: "9:30 PM" },
  activity: { walking: "Easy walking", hiking: "No hiking" },
  food: { diet: [], restrictions: [], cuisine: ["Local cuisine"], foodBudgetPerPerson: "$15-$30 per day", breakfastTime: "8:00 AM", lunchTime: "12:30 PM", dinnerTime: "6:30 PM" },
  alcohol: { preferences: ["Quiet evening venues"] },
  budget: { total: "$1,500-$3,500" },
  lodging: { changeHotels: "Stay in one place" },
  transport: { maxDrivingDay: "4 hours" },
  preferences: [],
  travelers: [{ id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }]
};

const input = generateTripPlan(trip).plan.preferencesSnapshot;
const intelligence = buildDestinationIntelligence(profile, input, buildTravelerConstraintProfile(input));
const byName = (name) => intelligence.allCandidates.find((item) => item.place.name === name);

assert.equal(classifyPlaceForPlanning(byName("Marbles Kids Museum").place, profile, input, byName("Marbles Kids Museum").routeFeasibility).isChildrenFocused, true);
assert.equal(byName("Marbles Kids Museum").accepted, false, "Child-focused museums must be rejected for solo adult child-free trips.");
assert.equal(byName("Frankie's of Raleigh").accepted, false, "Family entertainment centers must be rejected for solo adult child-free trips.");
assert.equal(classifyPlaceForPlanning(byName("Frankie's of Raleigh").place, profile, input).isRestaurant, false, "Family entertainment centers must not become meal candidates.");
assert.ok(["long-day-trip", "overnight-recommended"].includes(byName("Battleship North Carolina").routeFeasibility.classification), "Very distant regional anchors must not look like local backups.");

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready");
const plan = generated.plan;
const validation = validateTripPlan(plan);
assert.equal(validation.blocking.filter((issue) => issue.severity === "blocking").length, 0, JSON.stringify(validation.blocking));

const planText = JSON.stringify({
  overview: plan.overview,
  days: plan.days,
  foodPlan: plan.foodPlan,
  routeSummary: plan.routeSummary,
  hotelBase: plan.hotelBase,
  tripGuide: plan.tripGuide
});
[
  "Marbles Kids Museum",
  "Frankie's of Raleigh",
  "Google Places museum candidate",
  "Central area",
  "Culture and landmarks",
  "Food and evening area"
].forEach((bad) => assert.equal(planText.includes(bad), false, `Plan should not include ${bad}`));

[
  "North Carolina Museum of Natural Sciences",
  "North Carolina Museum of Art",
  "Downtown Durham and Duke Gardens",
  "Chapel Hill and Carrboro"
].forEach((expected) => assert.ok(planText.includes(expected), `Plan should evaluate ${expected}`));

const mealText = JSON.stringify(plan.days.flatMap((day) => day.dailyFoodPlan));
["Brewery Bhavana", "Morgan Street Food Hall", "Irregardless"].forEach((expected) => assert.ok(mealText.includes(expected), `Meal plan should include real Raleigh/Triangle dining: ${expected}`));
const transferMealUses = plan.days.flatMap((day) => day.dailyFoodPlan).filter((meal) => /Transfer Co\. Food Hall/.test(`${meal.primaryOption} ${meal.backupOption}`)).length;
assert.ok(transferMealUses <= 2, "No single food hall should be overused as the universal backup.");

plan.days.forEach((day) => {
  day.backupOptions.forEach((backup) => {
    assert.equal(/Battleship|Biltmore|Discovery Place|Greensboro Science Center/.test(backup.title), false, `${backup.title} should not be a same-cluster backup.`);
  });
});

const finalDay = plan.days.at(-1);
const departIndex = finalDay.scheduleItems.findIndex((item) => item.title.startsWith("Depart "));
assert.ok(departIndex >= 0, "Final day should include departure travel.");
finalDay.scheduleItems.slice(departIndex + 1).forEach((item) => {
  assert.equal(/Raleigh|Frankie/.test(`${item.title} ${item.description} ${item.locationLabel}`), false, "No Raleigh meal or activity should be scheduled after returning to Augusta.");
  assert.equal(item.hasDepartedPrimaryDestination, true, "Post-departure timeline items should carry departed-primary state.");
});

console.log("Raleigh production quality tests passed");

function raleighProviderFixture() {
  const regions = [
    region("raleigh-core", "Raleigh core", 35.7796, -78.6382, ["durham-triangle", "raleigh-parks"]),
    region("raleigh-parks", "Raleigh parks and west side", 35.8008, -78.7195, ["raleigh-core", "cary-triangle"]),
    region("durham-triangle", "Durham and Duke", 36.0014, -78.9382, ["raleigh-core", "chapel-hill"]),
    region("chapel-hill", "Chapel Hill and Carrboro", 35.9132, -79.0558, ["durham-triangle", "cary-triangle"]),
    region("cary-triangle", "Cary and west Triangle", 35.7915, -78.7811, ["raleigh-core", "chapel-hill"]),
    region("wilmington-coast", "Wilmington and coast", 34.2104, -77.8868, [])
  ];
  const places = [
    place("natural-sciences", "North Carolina Museum of Natural Sciences", "raleigh-core", "Major science and natural history museum in downtown Raleigh.", ["museum", "signature", "history"], ["museum", "downtown", "indoor"], 95, 140, 0, 15, 35.7822, -78.6391),
    place("nc-art", "North Carolina Museum of Art", "raleigh-parks", "Major art museum with galleries, sculpture park, and strong first-time Raleigh value.", ["museum", "art", "signature"], ["museum", "outdoor art", "solo"], 94, 150, 0, 20, 35.8105, -78.7028),
    place("state-capitol", "North Carolina State Capitol", "raleigh-core", "Historic civic landmark that pairs well with downtown museums.", ["history", "landmark"], ["capitol", "downtown"], 86, 75, 0, 10, 35.7804, -78.6391),
    place("city-market", "Raleigh City Market", "raleigh-core", "Historic market streets, local shops, and easy food-adjacent strolling.", ["neighborhood", "history"], ["city market", "local"], 82, 75, 0, 20, 35.7762, -78.6367),
    place("dix-park", "Dorothea Dix Park", "raleigh-core", "Large urban park with skyline views and flexible outdoor time.", ["park", "viewpoint"], ["outdoor", "skyline"], 80, 75, 0, 0, 35.7670, -78.6620),
    place("jc-raulston", "JC Raulston Arboretum", "raleigh-parks", "University arboretum with gardens; best as a seasonal or relaxed outdoor stop.", ["garden", "park"], ["arboretum", "seasonal"], 70, 75, 0, 0, 35.7947, -78.6997),
    place("umstead", "William B. Umstead State Park", "raleigh-parks", "Wooded trails and lake scenery near Raleigh, good for easy outdoor time.", ["park", "nature"], ["easy hike", "lake"], 78, 110, 0, 0, 35.8905, -78.7503),
    place("duke-gardens", "Downtown Durham and Duke Gardens", "durham-triangle", "Triangle day block combining Durham, Sarah P. Duke Gardens, and American Tobacco District.", ["neighborhood", "garden", "day-trip"], ["Duke", "Durham", "Triangle"], 92, 180, 0, 20, 36.0016, -78.9300),
    place("chapel-hill", "Chapel Hill and Carrboro", "chapel-hill", "University town and walkable food/music district that expands the Triangle plan.", ["neighborhood", "university", "day-trip"], ["UNC", "Carrboro", "Triangle"], 88, 170, 0, 25, 35.9132, -79.0558),
    place("downtown-cary", "Downtown Cary Park and Fenton", "cary-triangle", "West Triangle option with park, food, and low-friction evening possibilities.", ["park", "neighborhood", "food"], ["Cary", "Fenton"], 84, 150, 0, 25, 35.7878, -78.7812),
    place("marbles", "Marbles Kids Museum", "raleigh-core", "Children's museum built around hands-on play for younger kids.", ["children's museum", "family", "kids"], ["children", "toddler", "playground"], 98, 120, 10, 20, 35.7785, -78.6360),
    place("frankies", "Frankie's of Raleigh", "raleigh-parks", "Family entertainment center with go-karts, arcade games, mini golf, and casual concessions.", ["family entertainment", "arcade", "food"], ["go karts", "kids", "concessions"], 97, 150, 20, 45, 35.9060, -78.7810),
    place("transfer", "Transfer Co. Food Hall", "raleigh-core", "Food hall with casual local vendors; good as one meal stop but not every meal.", ["food hall", "restaurant"], ["food hall", "lunch", "dinner"], 76, 70, 12, 30, 35.7752, -78.6329),
    place("morgan-street", "Morgan Street Food Hall", "raleigh-core", "Downtown food hall with multiple vendors for lunch or casual dinner.", ["food hall", "restaurant"], ["food hall", "lunch", "dinner"], 82, 70, 12, 32, 35.7797, -78.6472),
    place("brewery-bhavana", "Brewery Bhavana", "raleigh-core", "Downtown restaurant and brewery known for dim sum and dinner reservations.", ["restaurant", "brewery"], ["restaurant", "dinner", "lunch"], 86, 90, 20, 55, 35.7774, -78.6382),
    place("irregardless", "Irregardless", "raleigh-core", "Long-running Raleigh restaurant with vegetarian-friendly options.", ["restaurant", "cafe"], ["brunch", "vegetarian", "dinner"], 84, 80, 15, 45, 35.7790, -78.6491),
    place("lucettegrace", "lucettegrace", "raleigh-core", "Downtown cafe and bakery option for breakfast or dessert.", ["cafe", "bakery"], ["breakfast", "coffee", "dessert"], 80, 45, 8, 20, 35.7801, -78.6405),
    place("wilmington-battleship", "Battleship North Carolina", "wilmington-coast", "Historic battleship in Wilmington; worthwhile only as a separate coastal route decision.", ["history", "regional", "museum"], ["Wilmington", "coast", "long day trip"], 90, 180, 15, 25, 34.2368, -77.9540),
    place("biltmore", "Biltmore Estate", "wilmington-coast", "Asheville regional estate far outside a Raleigh day plan.", ["regional", "estate"], ["overnight extension"], 89, 240, 80, 120, 35.5406, -82.5520),
    place("discovery-place", "Discovery Place Science", "wilmington-coast", "Charlotte science museum that should not back up a Raleigh day.", ["museum", "science"], ["Charlotte"], 82, 130, 20, 35, 35.2293, -80.8408)
  ];
  return {
    id: "generated-raleigh-regression",
    canonicalName: "Raleigh, North Carolina, United States",
    aliases: ["raleigh north carolina united states", "raleigh"],
    country: "United States",
    state: "North Carolina",
    currency: "USD",
    summary: "Raleigh and the broader Triangle combine museums, parks, university towns, food neighborhoods, and realistic regional options.",
    seasonalNotes: ["August can be hot and humid; balance outdoor stops with indoor anchors."],
    generalAdvisories: ["Verify current hours, closures, tickets, accessibility, menus, prices, and transportation conditions before travel."],
    planningRules: { defaultHotelRegion: "raleigh-core" },
    regions,
    places,
    foodAreas: [
      foodArea("raleigh-dining", "Downtown Raleigh restaurants", "raleigh-core"),
      foodArea("durham-dining", "Durham restaurants", "durham-triangle"),
      foodArea("chapel-hill-dining", "Chapel Hill and Carrboro restaurants", "chapel-hill")
    ],
    scenicRoutes: [
      route("raleigh-durham", "Raleigh to Durham", "raleigh-core", "durham-triangle", 35, 25),
      route("raleigh-chapel-hill", "Raleigh to Chapel Hill", "raleigh-core", "chapel-hill", 45, 32),
      route("raleigh-cary", "Raleigh to Cary", "raleigh-core", "cary-triangle", 20, 12),
      route("raleigh-wilmington", "Raleigh to Wilmington", "raleigh-core", "wilmington-coast", 150, 132)
    ]
  };
}

function region(id, name, lat, lng, neighboringRegionIds = []) {
  return { id, name, summary: `${name} planning region.`, centerCoordinates: { lat, lng }, tags: [], neighboringRegionIds, typicalTravelMinutesToRegions: {} };
}

function place(id, name, regionId, shortDescription, categories, tags, priorityScore, typicalDurationMinutes, costLow, costHigh, lat, lng) {
  return {
    id,
    name,
    regionId,
    shortDescription,
    categories,
    tags,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes,
    minimumDurationMinutes: 45,
    maximumDurationMinutes: Math.max(typicalDurationMinutes, 150),
    estimatedCostLow: costLow,
    estimatedCostHigh: costHigh,
    indoorOutdoor: /park|garden|outdoor/i.test(categories.join(" ")) ? "outdoor" : "indoor",
    weatherDependency: /park|garden|outdoor/i.test(categories.join(" ")) ? "high" : "low",
    accessibility: "moderate",
    dietaryRelevance: /restaurant|food|cafe|bakery|brewery/i.test(categories.join(" ")) ? ["confirm dietary needs directly"] : [],
    openingTimeGuidance: "Confirm current opening hours before travel.",
    bestTimeOfDay: /restaurant|food|cafe|bakery/i.test(categories.join(" ")) ? "lunch" : "morning",
    reservationRecommended: /restaurant|museum|brewery/i.test(categories.join(" ")),
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
    cuisines: ["Local cuisine", "Vegetarian-friendly", "Casual dining"],
    mealTypes: ["breakfast", "lunch", "dinner"],
    budgetLevels: ["budget", "moderate"],
    dietarySupport: ["Vegetarian"],
    eveningSuitability: ["quiet"],
    shortDescription: `${name}; confirm menus and hours directly.`
  };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags: ["route"], bestTimeOfDay: "morning", notes: "Verify current route conditions." };
}
