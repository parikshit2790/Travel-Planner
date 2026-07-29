import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { buildDestinationIntelligence, classifyPlaceForPlanning } from "../src/destination-intelligence.js";
import { buildDestinationOpportunityGraph, critiquePlanDeterministically } from "../src/planning-quality.js";
import { buildTravelerConstraintProfile, generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = registerGeneratedDestinationProfile(atlantaProviderFixture());
assert.ok(profile, "Atlanta generated provider fixture should register.");

const trip = atlantaRegressionTrip();
const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready");
const plan = generated.plan;
const normalized = plan.preferencesSnapshot;
const constraints = buildTravelerConstraintProfile(normalized);
const intelligence = buildDestinationIntelligence(profile, normalized, constraints);
const byName = (name) => {
  const found = intelligence.allCandidates.find((item) => item.place.name === name);
  assert.ok(found, `Expected Atlanta candidate ${name}`);
  return found;
};

const georgiaAquarium = byName("Georgia Aquarium");
const worldOfCocaCola = byName("World of Coca-Cola");
const civilRights = byName("National Center for Civil and Human Rights");
const mlk = byName("Martin Luther King Jr. National Historical Park");
const beltline = byName("Atlanta BeltLine Eastside Trail");
const ponce = byName("Ponce City Market");
const botanical = byName("Atlanta Botanical Garden");
const piedmont = byName("Piedmont Park");
const stoneMountain = byName("Stone Mountain Park");
const southernBelle = byName("Southern Belle Farm");
const fowlerPark = byName("Fowler Park");
const hinduTemple = byName("Hindu Temple of Atlanta");
const staleCnn = byName("CNN Studio Tour");
const currentCtr = byName("Centennial Yards / former CNN Center area");

[
  georgiaAquarium,
  worldOfCocaCola,
  civilRights,
  mlk,
  beltline,
  ponce,
  botanical,
  piedmont
].forEach((candidate) => {
  assert.ok(candidate.classification.firstTimeVisitorValue.score >= 58, `${candidate.place.name} should carry major first-time visitor value.`);
});

assert.ok(georgiaAquarium.score > southernBelle.score, "Georgia Aquarium must outrank a local farm for a first-time balanced Atlanta trip.");
assert.ok(georgiaAquarium.score > fowlerPark.score, "Georgia Aquarium must outrank an ordinary suburban recreation park.");
assert.ok(worldOfCocaCola.score > hinduTemple.score, "World of Coca-Cola must outrank a special-interest suburban temple without explicit traveler interest.");
assert.equal(staleCnn.accepted, false, "Discontinued CNN Studio Tour must be rejected.");
assert.equal(classifyPlaceForPlanning(staleCnn.place, profile, normalized).isStaleOrClosedAttraction, true, "CNN Studio Tour should be flagged stale.");
assert.equal(currentCtr.accepted, true, "Current former-CNN-center area may be evaluated by current visitor value, not old tour identity.");
assert.ok(fowlerPark.classification.ordinaryLocalFacilityPenalty.score >= 60, "Fowler Park should receive ordinary local facility penalty.");
assert.ok(southernBelle.classification.ordinaryLocalFacilityPenalty.score >= 50, "Southern Belle Farm should receive local farm penalty unless explicitly requested.");

const validation = validateTripPlan(plan);
assert.deepEqual(validation.blocking.map((issue) => issue.id), [], JSON.stringify(validation.blocking));
assert.equal(plan.generationMetadata.qualityCritique.pass, true, JSON.stringify(plan.generationMetadata.qualityCritique));
assert.ok(plan.generationMetadata.qualityCritique.score >= 85, JSON.stringify(plan.generationMetadata.qualityCritique));

const publicPlan = JSON.stringify({
  overview: plan.overview,
  days: plan.days,
  routeSummary: plan.routeSummary,
  tripGuide: plan.tripGuide,
  foodPlan: plan.foodPlan
});

[
  "Georgia Aquarium",
  "World of Coca-Cola",
  "National Center for Civil and Human Rights",
  "Martin Luther King Jr. National Historical Park",
  "Atlanta BeltLine Eastside Trail",
  "Ponce City Market"
].forEach((expected) => assert.ok(publicPlan.includes(expected), `Atlanta plan should include or evaluate ${expected}`));

assert.ok(/Atlanta Botanical Garden|Piedmont Park|Stone Mountain|Sweetwater Creek|Arabia Mountain/.test(publicPlan), "Atlanta plan should include a major park/garden/outdoor anchor.");
assert.ok(/Krog Street Market|Inman Park|Decatur|Buckhead|Battery Atlanta|Atlanta food hall|rooftop/i.test(publicPlan), "Atlanta plan should include neighborhood, food, or evening depth.");

[
  "CNN Studio Tour",
  "Southern Belle Farm",
  "Fowler Park",
  "Hindu Temple of Atlanta"
].forEach((bad) => assert.equal(publicPlan.includes(bad), false, `Atlanta plan should not promote weak or stale candidate: ${bad}`));

const downtownClusterDay = plan.days.find((day) => /Georgia Aquarium/.test(JSON.stringify(day.scheduleItems)));
assert.ok(downtownClusterDay, "Georgia Aquarium should be scheduled or directly evaluated in a day.");
const downtownText = JSON.stringify(downtownClusterDay);
assert.ok(/World of Coca-Cola|Centennial Olympic Park|National Center for Civil and Human Rights/.test(downtownText), "Downtown signature experiences should cluster logically around Centennial Park.");

const routeShapeOptions = plan.generationMetadata.tripShapeOptions;
assert.ok(routeShapeOptions.length >= 3, "Planner should compare Atlanta trip-shape options before scheduling.");
assert.ok(routeShapeOptions.some((option) => /city|base|depth|essentials/i.test(`${option.title} ${option.structureType}`)), "Route shapes should include Atlanta essentials.");
assert.ok(routeShapeOptions.some((option) => /nature|day trip|nearby/i.test(`${option.title} ${option.structureType} ${option.experienceMix}`) && /Stone Mountain|Sweetwater|Arabia|Chattahoochee|Botanical|Piedmont/i.test(JSON.stringify(option.sequence))), "Route shapes should include Atlanta plus local outdoor.");
assert.ok(routeShapeOptions.some((option) => /regional|extension|second base/i.test(`${option.title} ${option.structureType}`) && /North Georgia|Amicalola|Blue Ridge|Helen|Tallulah/i.test(JSON.stringify(option.sequence))), "Route shapes should include North Georgia regional extension.");

const diagnostic = plan.generationMetadata.destinationIntelligence.consideredCandidates.slice(0, 30);
assert.ok(diagnostic.some((item) => item.name === "Georgia Aquarium" && item.firstTimeVisitorValue?.score >= 58), "Top-30 diagnostics should include Georgia Aquarium with first-time value.");
assert.ok(diagnostic.some((item) => item.name === "World of Coca-Cola" && item.destinationSignificanceScore > 0), "Top-30 diagnostics should explain World of Coca-Cola ranking.");
assert.ok(diagnostic.some((item) => item.name === "Fowler Park" && item.ordinaryLocalFacilityPenalty?.score >= 60), "Top-30 diagnostics should show Fowler Park penalty.");

const graph = buildDestinationOpportunityGraph(profile, normalized, intelligence, plan.generationMetadata.destinationProfile);
const badPlan = atlantaPdfStyleBadPlan(profile, trip);
badPlan.generationMetadata.qualityCritique = critiquePlanDeterministically(badPlan, graph);
const badAtlantaValidation = validateTripPlan(badPlan);
const badCodes = badAtlantaValidation.blocking.map((issue) => issue.id).join(" ");
assert.match(badCodes, /signature-attraction-coverage|ordinary-local-facility-overpromotion|stale-attraction-recommended|first-time-coverage-insufficient/, "Atlanta PDF-style ranking failure should be blocked by quality validation.");

console.log("Atlanta planner quality tests passed");

function atlantaRegressionTrip() {
  return {
    from: "Lynchburg, Virginia, United States",
    fromDisplay: "Lynchburg, Virginia, United States",
    fromLocation: { canonicalName: "Lynchburg, Virginia, United States", latitude: 37.4138, longitude: -79.1422 },
    destination: "Atlanta, Georgia, United States",
    destinationDisplay: "Atlanta, Georgia, United States",
    destinationLocation: { canonicalName: "Atlanta, Georgia, United States", latitude: 33.749, longitude: -84.388 },
    startDate: "2026-08-08",
    endDate: "2026-08-12",
    days: 5,
    adults: 2,
    children: 0,
    seniors: 0,
    groupType: "Couple trip",
    transportation: "Drive",
    schedule: { pace: "Balanced", majorActivities: 2 },
    activity: { walking: "Easy walking", hiking: "Easy hikes" },
    food: { diet: [], restrictions: [], cuisineInterests: [], eveningPreferences: ["Quiet evening venues", "Evening walks"] },
    alcohol: { preferences: ["Quiet evening venues", "Evening walks"] },
    budget: { total: "$1,500-$3,500" },
    lodging: { changeHotels: "Stay in one place" },
    transport: { maxDrivingDay: "4 hours" },
    preferences: [],
    travelers: [1, 2].map((number) => ({ id: `traveler-${number}`, name: `Traveler ${number}`, ageGroup: "Adult (18-64)", restrictions: [], notes: "" }))
  };
}

function atlantaProviderFixture() {
  const retrievedAt = "2026-07-28T12:00:00.000Z";
  const regions = [
    region("downtown-centennial", "Downtown and Centennial Olympic Park", 33.7627, -84.3931, ["sweet-auburn", "midtown"]),
    region("sweet-auburn", "Sweet Auburn and MLK historic district", 33.755, -84.372, ["downtown-centennial", "beltline-eastside"]),
    region("midtown", "Midtown, Piedmont Park, and Arts District", 33.789, -84.385, ["downtown-centennial", "beltline-eastside"]),
    region("beltline-eastside", "BeltLine, Old Fourth Ward, Inman Park, and Ponce", 33.772, -84.365, ["midtown", "sweet-auburn"]),
    region("buckhead", "Buckhead and Atlanta History Center", 33.839, -84.379, ["midtown"]),
    region("decatur", "Decatur and east Atlanta", 33.7748, -84.2963, ["beltline-eastside"]),
    region("battery", "The Battery Atlanta and Truist Park", 33.8907, -84.4677, ["buckhead"]),
    region("stone-mountain", "Stone Mountain and east-side outdoor day trips", 33.8053, -84.1458, ["decatur"]),
    region("south-suburbs", "South metro local facilities", 33.447, -84.146, ["downtown-centennial"]),
    region("north-georgia", "North Georgia mountain extension", 34.53, -83.98, ["buckhead"])
  ];
  const places = [
    place("southern-belle-farm", "Southern Belle Farm", "south-suburbs", "Local seasonal farm, U-pick fields, corn maze, and school-group style activities south of Atlanta.", ["farm", "seasonal", "local facility"], ["farm", "pumpkin patch", "suburban"], 99, 150, 20, 45, 33.412, -84.108, "outdoor", "high", "afternoon", false, retrievedAt),
    place("fowler-park", "Fowler Park", "south-suburbs", "Ordinary county park with playgrounds, sports fields, skate park, and local recreation facilities.", ["park", "playground", "sports field"], ["ordinary", "local park", "recreation center", "suburban"], 98, 90, 0, 0, 34.176, -84.174, "outdoor", "medium", "afternoon", false, retrievedAt),
    place("hindu-temple-atlanta", "Hindu Temple of Atlanta", "south-suburbs", "Special-interest suburban worship site; meaningful when specifically requested, but not a default first-time Atlanta anchor.", ["temple", "religious site"], ["suburban", "special interest"], 96, 75, 0, 0, 33.588, -84.333, "indoor", "low", "afternoon", false, retrievedAt),
    place("marietta-square", "Marietta Square", "battery", "Historic local square northwest of Atlanta with shops and restaurants; useful as a secondary neighborhood option.", ["historic square", "shopping"], ["local", "nearby"], 86, 100, 0, 25, 33.9526, -84.5499, "mixed", "low", "afternoon", false, retrievedAt),
    place("georgia-aquarium", "Georgia Aquarium", "downtown-centennial", "Official tourism top attraction and world-class aquarium near Centennial Olympic Park; substantial ticketed visit with exhibits and presentations.", ["aquarium", "museum", "landmark"], ["iconic", "must see", "official tourism", "one of the largest", "first time"], 82, 210, 45, 70, 33.7634, -84.3951, "indoor", "low", "morning", true, retrievedAt),
    place("world-of-coca-cola", "World of Coca-Cola", "downtown-centennial", "Iconic Atlanta brand museum and first-time visitor attraction beside Georgia Aquarium and Centennial Olympic Park.", ["museum", "landmark", "brand experience"], ["iconic", "must see", "official tourism", "first time"], 80, 130, 22, 30, 33.7627, -84.3928, "indoor", "low", "afternoon", true, retrievedAt),
    place("centennial-olympic-park", "Centennial Olympic Park", "downtown-centennial", "Olympic legacy park linking downtown signature attractions and skyline orientation.", ["park", "landmark", "olympic park"], ["iconic", "landmark", "downtown", "public space"], 78, 55, 0, 0, 33.7604, -84.3932, "outdoor", "medium", "afternoon", false, retrievedAt),
    place("civil-human-rights", "National Center for Civil and Human Rights", "downtown-centennial", "Major civil and human rights museum in the downtown signature cluster.", ["museum", "civil rights", "culture"], ["national significance", "civil rights", "human rights", "official tourism"], 81, 120, 20, 30, 33.7640, -84.3936, "indoor", "low", "afternoon", true, retrievedAt),
    place("mlk-historical-park", "Martin Luther King Jr. National Historical Park", "sweet-auburn", "National historical park around Dr. King's birth home, Ebenezer Baptist Church, The King Center, and Sweet Auburn context.", ["national historical park", "history", "civil rights"], ["national", "historic district", "civil rights", "must see"], 84, 180, 0, 15, 33.7563, -84.3724, "mixed", "medium", "morning", false, retrievedAt),
    place("atlanta-beltline-eastside", "Atlanta BeltLine Eastside Trail", "beltline-eastside", "Signature Atlanta urban trail linking Old Fourth Ward, public art, food halls, Inman Park, and evening walks.", ["trail", "neighborhood", "public art"], ["signature", "beltline", "local culture", "evening walk"], 79, 110, 0, 10, 33.7685, -84.3618, "outdoor", "medium", "afternoon", false, retrievedAt),
    place("ponce-city-market", "Ponce City Market", "beltline-eastside", "Landmark food hall and market in a historic Sears building along the BeltLine, with shops and rooftop add-ons.", ["food hall", "market", "historic building"], ["public market", "food hall", "landmark", "evening"], 79, 110, 15, 45, 33.7726, -84.3654, "mixed", "low", "evening", false, retrievedAt),
    place("krog-street-market", "Krog Street Market", "beltline-eastside", "Compact food hall near the BeltLine and Inman Park for lunch, casual dinner, or dessert.", ["food hall", "market"], ["food", "beltline", "local"], 72, 75, 15, 35, 33.7587, -84.3644, "indoor", "low", "lunch", false, retrievedAt),
    place("inman-park-little-five", "Inman Park and Little Five Points", "beltline-eastside", "Historic neighborhood and alternative shopping/dining district for local Atlanta character.", ["neighborhood", "shopping", "dining"], ["local culture", "food", "evening", "district"], 75, 110, 0, 35, 33.761, -84.348, "mixed", "low", "afternoon", false, retrievedAt),
    place("atlanta-botanical-garden", "Atlanta Botanical Garden", "midtown", "Major botanical garden beside Piedmont Park with seasonal displays and strong couple-trip appeal.", ["botanical garden", "garden", "nature"], ["signature", "garden", "official tourism", "seasonal"], 80, 150, 25, 35, 33.7904, -84.3739, "mixed", "medium", "morning", true, retrievedAt),
    place("piedmont-park", "Piedmont Park", "midtown", "Atlanta's central park for skyline views, easy walks, and pairing with Midtown or the Botanical Garden.", ["park", "easy walk", "viewpoint"], ["local landmark", "outdoor", "midtown"], 76, 75, 0, 0, 33.7851, -84.3738, "outdoor", "medium", "afternoon", false, retrievedAt),
    place("high-museum", "High Museum of Art", "midtown", "Major art museum in Midtown's arts district with broad collections and architecture.", ["art museum", "museum"], ["major", "art", "official tourism"], 77, 130, 18, 32, 33.7901, -84.3857, "indoor", "low", "morning", true, retrievedAt),
    place("fox-theatre", "Fox Theatre", "midtown", "Historic theater and architecture landmark; strongest with a current performance or tour.", ["theater", "architecture", "landmark"], ["historic", "evening", "performance"], 69, 90, 25, 100, 33.7725, -84.3857, "indoor", "low", "evening", true, retrievedAt),
    place("atlanta-history-center", "Atlanta History Center", "buckhead", "Major Buckhead history campus with exhibits, gardens, and Swan House context.", ["history center", "museum", "garden"], ["major", "history", "buckhead"], 74, 170, 18, 30, 33.8428, -84.386, "mixed", "medium", "morning", true, retrievedAt),
    place("decatur-square", "Decatur Square", "decatur", "Walkable dining and local neighborhood square east of Atlanta, useful for a relaxed evening or secondary food block.", ["neighborhood", "food", "square"], ["local", "dining", "evening"], 68, 85, 0, 35, 33.7748, -84.2963, "mixed", "low", "evening", false, retrievedAt),
    place("battery-truist", "The Battery Atlanta and Truist Park", "battery", "Sports, dining, and entertainment district around Truist Park; strongest with a Braves game or event.", ["sports", "entertainment", "dining"], ["evening", "baseball", "food"], 70, 120, 0, 80, 33.8907, -84.4677, "mixed", "low", "evening", false, retrievedAt),
    place("stone-mountain", "Stone Mountain Park", "stone-mountain", "Major local outdoor day trip with mountain views, walk-up option, historic context, and route tradeoffs.", ["mountain", "park", "day-trip"], ["outdoor", "regional", "viewpoint", "signature nearby"], 76, 210, 20, 40, 33.8053, -84.1458, "outdoor", "high", "morning", true, retrievedAt),
    place("sweetwater-creek", "Sweetwater Creek State Park", "stone-mountain", "Nearby state park with creek scenery, ruins, and moderate hiking options west of Atlanta.", ["state park", "hiking", "nature"], ["outdoor", "day trip", "water"], 71, 180, 5, 15, 33.7536, -84.6283, "outdoor", "high", "morning", false, retrievedAt),
    place("amicalola-falls", "Amicalola Falls and North Georgia mountains", "north-georgia", "North Georgia waterfall and mountain extension; memorable but better as an intentional long day or overnight.", ["waterfall", "mountain", "regional", "overnight"], ["North Georgia", "waterfall", "regional extension"], 73, 360, 5, 25, 34.5634, -84.2445, "outdoor", "high", "full-day", false, retrievedAt),
    place("blue-ridge-helen", "Blue Ridge or Helen North Georgia extension", "north-georgia", "Regional mountain-town extension for scenic drives, waterfalls, and a distinct second-base option.", ["mountain", "scenic drive", "overnight"], ["North Georgia", "regional extension", "mountain"], 70, 420, 20, 80, 34.8639, -84.3241, "mixed", "high", "full-day", false, retrievedAt),
    place("cnn-studio-tour", "CNN Studio Tour", "downtown-centennial", "Discontinued old CNN Studio Tour; former public studio tour no longer operates as a current visitor attraction.", ["closed tour", "former attraction"], ["old CNN Studio Tour", "discontinued", "former"], 83, 90, 0, 0, 33.7577, -84.3948, "indoor", "low", "afternoon", false, retrievedAt),
    place("centennial-yards-current", "Centennial Yards / former CNN Center area", "downtown-centennial", "Current downtown redevelopment/former CNN Center area with event and dining context; evaluate only for current public access, not the old studio tour.", ["district", "dining", "events"], ["current", "former cnn center", "downtown", "dining"], 62, 45, 0, 30, 33.7577, -84.3948, "mixed", "low", "evening", false, retrievedAt),
    place("atlanta-breakfast-club", "Atlanta Breakfast Club", "downtown-centennial", "Popular downtown breakfast and brunch restaurant near Centennial Park; verify waits and hours.", ["restaurant", "breakfast", "brunch"], ["local food", "breakfast"], 66, 60, 15, 30, 33.7645, -84.3958, "indoor", "low", "morning", false, retrievedAt),
    place("home-grown", "Home Grown", "sweet-auburn", "Atlanta breakfast and lunch restaurant known for Southern comfort food; verify vegetarian fit.", ["restaurant", "breakfast", "lunch"], ["local food", "breakfast"], 65, 60, 14, 28, 33.7467, -84.3567, "indoor", "low", "morning", false, retrievedAt),
    place("poor-calvins", "Poor Calvin's", "midtown", "Reservation-worthy Midtown dinner candidate with Asian-Southern style dishes.", ["restaurant", "dinner"], ["local cuisine", "date night"], 67, 90, 30, 70, 33.7684, -84.3828, "indoor", "low", "dinner", true, retrievedAt),
    place("mary-macs", "Mary Mac's Tea Room", "midtown", "Classic Atlanta Southern restaurant candidate for a local-feeling lunch or dinner.", ["restaurant", "lunch", "dinner"], ["local cuisine", "Atlanta food"], 67, 85, 20, 45, 33.7724, -84.3809, "indoor", "low", "dinner", false, retrievedAt)
  ];
  return {
    id: "generated-atlanta-ranking-regression",
    canonicalName: "Atlanta, Georgia, United States",
    aliases: ["atlanta", "atlanta ga", "atlanta georgia", "atlanta georgia united states"],
    country: "United States",
    state: "Georgia",
    timezone: "America/New_York",
    currency: "USD",
    summary: "A major Southern city best planned by downtown signature attractions, civil-rights history, Midtown, BeltLine neighborhoods, food halls, and optional nearby nature or North Georgia extensions.",
    seasonalNotes: ["August is hot and humid; balance indoor signature attractions with shaded outdoor blocks."],
    generalAdvisories: ["Confirm hours, tickets, parking, event schedules, and current public access before booking."],
    planningRules: { defaultHotelRegion: "downtown-centennial" },
    regions,
    places,
    foodAreas: [
      foodArea("downtown-food", "Downtown and Centennial Park dining", "downtown-centennial", ["Southern", "American", "Cafes"], ["breakfast", "lunch", "dinner"]),
      foodArea("beltline-food", "BeltLine, Ponce, and Krog food halls", "beltline-eastside", ["Food hall", "Local cuisine", "Desserts"], ["lunch", "dinner"]),
      foodArea("midtown-food", "Midtown date-night dining", "midtown", ["Southern", "Asian", "American"], ["dinner"]),
      foodArea("decatur-food", "Decatur local dining", "decatur", ["Local cuisine", "Cafes", "Vegetarian-friendly"], ["lunch", "dinner"]),
      foodArea("buckhead-food", "Buckhead polished dining", "buckhead", ["Fine dining", "American", "Italian"], ["dinner"]),
      foodArea("battery-food", "The Battery dining", "battery", ["American", "Bars", "Casual dining"], ["lunch", "dinner"])
    ],
    scenicRoutes: [
      route("downtown-centennial-loop", "Centennial Park downtown signature cluster", "downtown-centennial", "downtown-centennial", 8, 1, ["walkable", "signature"], "morning"),
      route("downtown-sweet-auburn", "Downtown to Sweet Auburn and MLK", "downtown-centennial", "sweet-auburn", 12, 3, ["history", "civil rights"], "morning"),
      route("downtown-midtown", "Downtown to Midtown", "downtown-centennial", "midtown", 15, 4, ["museum", "garden"], "afternoon"),
      route("midtown-beltline", "Midtown to BeltLine and Ponce", "midtown", "beltline-eastside", 15, 4, ["neighborhood", "food"], "evening"),
      route("downtown-buckhead", "Downtown to Buckhead", "downtown-centennial", "buckhead", 25, 9, ["history", "dining"], "morning"),
      route("downtown-stone-mountain", "Atlanta to Stone Mountain", "downtown-centennial", "stone-mountain", 35, 20, ["outdoor", "day-trip"], "morning"),
      route("downtown-north-georgia", "Atlanta to North Georgia mountains", "downtown-centennial", "north-georgia", 105, 80, ["regional", "mountain", "waterfall"], "morning")
    ],
    sourceMetadata: { provider: "openai", retrievedAt, freshness: "ai-assisted-destination-research", candidateCount: places.length }
  };
}

function atlantaPdfStyleBadPlan(destinationProfile, sourceTrip) {
  const activity = (title, dayNumber) => ({
    id: `bad-atlanta-${dayNumber}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    type: "activity",
    title,
    description: `${title} was promoted from weak raw search order.`,
    placeId: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    regionId: "south-suburbs",
    startTimeMinutes: 540,
    endTimeMinutes: 660,
    durationMinutes: 120,
    estimatedCostPerPerson: { low: 0, high: 40 },
    category: "activity",
    tags: ["local"],
    weatherDependency: "medium",
    indoorOutdoor: "mixed"
  });
  const meal = (type, dayNumber) => ({
    id: `bad-atlanta-${dayNumber}-${type}`,
    type,
    title: `${type} near Atlanta`,
    description: "Choose a generic restaurant near the route.",
    placeId: "",
    regionId: "south-suburbs",
    startTimeMinutes: type === "breakfast" ? 480 : type === "lunch" ? 750 : 1110,
    endTimeMinutes: type === "breakfast" ? 525 : type === "lunch" ? 810 : 1185,
    durationMinutes: type === "dinner" ? 75 : 60,
    estimatedCostPerPerson: { low: 15, high: 45 },
    mealDetails: {},
    category: "meal",
    tags: ["meal"]
  });
  const badActivities = ["Southern Belle Farm", "Fowler Park", "Hindu Temple of Atlanta", "Marietta Square", "CNN Studio Tour"];
  const days = Array.from({ length: 5 }, (_, index) => ({
    id: `bad-atlanta-day-${index + 1}`,
    dayNumber: index + 1,
    date: `2026-08-${8 + index}`,
    title: index === 3 ? "World of Coca-Cola worth doing day" : "Atlanta local highlights",
    summary: "A weak Atlanta plan based on raw candidate order.",
    scheduleItems: [meal("breakfast", index + 1), activity(badActivities[index], index + 1), meal("lunch", index + 1), meal("dinner", index + 1)],
    dailyFoodPlan: [],
    backupOptions: [],
    prioritySections: {
      dontMiss: [{ activity: badActivities[index], whyItMatters: "Raw candidate ranked high." }],
      worthDoing: index === 3 ? [{ activity: "World of Coca-Cola", whyItMatters: "Secondary worth doing item only." }] : [],
      bonusStops: []
    }
  }));
  return {
    id: "bad-atlanta-pdf-style",
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
    overview: { title: "Bad Atlanta plan", destinationSummary: "Atlanta local highlights." },
    hotelBase: { primary: "Downtown Atlanta" },
    days,
    foodPlan: { dailyMealSummary: "Generic meals.", foodAreas: [] },
    routeSummary: { orderedRegions: ["South metro local facilities"], orderedStops: badActivities, totalEstimatedDriveMinutes: 0 },
    budgetSummary: { currency: "USD", totalLow: 0, totalHigh: 0 },
    tripGuide: { quickReference: [], planningStages: [] },
    advisories: [],
    unresolvedConflicts: [],
    generationMetadata: {
      destinationProfileId: destinationProfile.id,
      destinationProfileSnapshot: destinationProfile,
      destinationArchetype: { primaryArchetype: "major city" },
      opportunityGraph: { nodes: [] },
      opportunityCoverageValidation: { hardFailures: [] },
      qualityCritique: { hardFailures: [] }
    }
  };
}

function region(id, name, lat, lng, neighboringRegionIds = []) {
  return { id, name, summary: `${name} planning cluster.`, centerCoordinates: { lat, lng }, tags: [], neighboringRegionIds };
}

function place(id, name, regionId, shortDescription, categories, tags, priorityScore, duration, costLow, costHigh, lat, lng, indoorOutdoor, weatherDependency, bestTimeOfDay, reservationRecommended = false, retrievedAt = "2026-07-28T12:00:00.000Z") {
  return {
    id,
    name,
    regionId,
    shortDescription,
    categories,
    tags,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.max(30, Math.round(duration * 0.7)),
    maximumDurationMinutes: Math.round(duration * 1.35),
    estimatedCostLow: costLow,
    estimatedCostHigh: costHigh,
    indoorOutdoor,
    weatherDependency,
    accessibility: "moderate",
    dietaryRelevance: categories.some((category) => /restaurant|food|market/.test(category)) ? ["local options vary"] : [],
    openingTimeGuidance: "Current status should be verified directly before travel.",
    bestTimeOfDay,
    reservationRecommended,
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: { lat, lng },
    backupForTags: indoorOutdoor === "indoor" ? ["heat", "rain"] : [],
    sourceMetadata: {
      provider: "openai",
      providerPlaceId: id,
      retrievedName: name,
      retrievedAt,
      sourceUrl: "https://api.openai.com/v1/responses",
      dataConfidence: "ai-assisted",
      dataFreshness: "ai-assisted-destination-research"
    }
  };
}

function foodArea(id, name, regionId, cuisines, mealTypes) {
  return { id, name, regionId, cuisines, mealTypes, budgetLevels: ["budget", "moderate"], dietarySupport: ["Vegetarian", "Gluten-free"], eveningSuitability: ["quiet", "lively"], shortDescription: `${name} with ${cuisines.slice(0, 3).join(", ")} options.` };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags, bestTimeOfDay) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags, bestTimeOfDay, notes: "Verify live traffic before departure." };
}
