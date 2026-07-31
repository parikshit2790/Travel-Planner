import assert from "node:assert/strict";
import { registerGeneratedDestinationProfile } from "../src/destination-data.js";
import { buildDestinationIntelligence } from "../src/destination-intelligence.js";
import { buildDestinationOpportunityGraph, critiquePlanDeterministically } from "../src/planning-quality.js";
import { buildTravelerConstraintProfile, generateTripPlan, validateTripPlan } from "../src/planner.js";

const profile = registerGeneratedDestinationProfile(smokiesProviderFixture());
assert.ok(profile, "Smokies generated regional fixture should register.");

runSmokiesRegression({
  label: "Gatlinburg",
  trip: smokiesTrip({
    from: "Greensboro, North Carolina, United States",
    destination: "Gatlinburg, Tennessee, United States",
    adults: 2,
    groupType: "Couple trip"
  }),
  required: ["Pigeon Forge", "The Island in Pigeon Forge", "Newfound Gap Road", "Kuwohi", "Grotto Falls", "Cades Cove"]
});

runSmokiesRegression({
  label: "Pigeon Forge",
  trip: smokiesTrip({
    from: "Charlotte, North Carolina, United States",
    destination: "Pigeon Forge, Tennessee, United States",
    adults: 1,
    groupType: "Solo trip"
  }),
  required: ["Gatlinburg", "The Island in Pigeon Forge", "Newfound Gap Road", "Kuwohi", "Dollywood", "Roaring Fork"]
});

const badPlan = pdfStyleBadSmokiesPlan(smokiesTrip({
  from: "Greensboro, North Carolina, United States",
  destination: "Gatlinburg, Tennessee, United States",
  adults: 2,
  groupType: "Couple trip"
}));
const badConstraints = { minimalWalking: false, noAlcohol: false };
const badGraph = buildDestinationOpportunityGraph(profile, badPlan.preferencesSnapshot, buildDestinationIntelligence(profile, badPlan.preferencesSnapshot, badConstraints));
const badCritique = critiquePlanDeterministically(badPlan, badGraph);
assert.equal(badCritique.pass, false, "PDF-style weak Smokies plans must fail the independent critic.");
assert.match(badCritique.hardFailures.join(" "), /generic-park-container-scheduled|novelty-attraction-overpromotion|regional-scenic-corridor-missing|regional-meal-diversity-insufficient/, JSON.stringify(badCritique));

console.log("Smokies regional planner quality tests passed");

function runSmokiesRegression({ label, trip, required }) {
  const generated = generateTripPlan(trip);
  assert.equal(generated.status, "ready", `${label} trip should generate.`);
  const plan = generated.plan;
  const normalized = plan.preferencesSnapshot;
  const constraints = buildTravelerConstraintProfile(normalized);
  const intelligence = buildDestinationIntelligence(profile, normalized, constraints);
  assert.equal(intelligence.regionalDestinationProfile.regionalConfidence, "high");
  assert.ok(intelligence.regionalDestinationProfile.gatewayTowns.includes("Gatlinburg"), `${label} profile should know Gatlinburg as a gateway town.`);
  assert.ok(intelligence.regionalDestinationProfile.gatewayTowns.includes("Pigeon Forge"), `${label} profile should know Pigeon Forge as a connected gateway town.`);

  const candidateText = JSON.stringify(intelligence.allCandidates.map((item) => item.place.name));
  required.forEach((name) => assert.ok(candidateText.includes(name), `${label} should evaluate ${name}.`));

  const byName = (name) => {
    const candidate = intelligence.allCandidates.find((item) => item.place.name === name);
    assert.ok(candidate, `${label} missing candidate ${name}`);
    return candidate;
  };
  assert.ok(byName("Newfound Gap Road and Kuwohi scenic corridor").score > byName("Smoky Mountain Knife Works").score, `${label} should rank real scenic corridors above novelty retail.`);
  assert.ok(byName("The Island in Pigeon Forge").score > byName("Wheels Through Time Motorcycle Museum").score, `${label} should rank regional entertainment above narrow motorcycle museums.`);

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
  assert.ok(/Newfound Gap Road|Kuwohi|Cades Cove|Roaring Fork|Little River Road|Foothills Parkway/.test(publicPlan), `${label} should schedule or guide around a specific scenic corridor.`);
  assert.ok(/Grotto Falls|Laurel Falls|Rainbow Falls|Abrams Falls|Gatlinburg Trail|Cataract Falls/.test(publicPlan), `${label} should schedule or guide around a named trail or waterfall.`);
  assert.ok(/The Island in Pigeon Forge|Dollywood|Anakeesta|SkyPark|Ober Gatlinburg|Pigeon Forge/.test(publicPlan), `${label} should include connected gateway town or entertainment depth.`);
  assert.equal(/Great Smoky Mountains National Park area parks and scenery|Great Smoky Mountains National Park area museums and history/.test(publicPlan), false, `${label} should not use generic park day titles.`);
  assert.equal(/Smoky Mountain Knife Works|Wheels Through Time Motorcycle Museum|Great Smoky Mountains Railroad/.test(publicPlan), false, `${label} should not promote novelty retail or distant excursion filler.`);
  assert.ok(/Packed lunch|picnic supplies|Crockett|Donut Friar|Old Mill Pottery House|Local Goat|Wild Plum|Coffee Armory|Five Oaks|The Greenbrier|Sunliner/.test(publicPlan), `${label} should include varied food or packed-lunch logic.`);
  assert.ok(plan.generationMetadata.tripShapeOptions.some((option) => /base|regional|gateway|Smokies/i.test(`${option.title} ${option.structureType}`)), `${label} should compare regional trip shapes.`);
}

function smokiesTrip({ from, destination, adults, groupType }) {
  return {
    from,
    fromDisplay: from,
    destination,
    destinationDisplay: destination,
    startDate: "2026-08-28",
    endDate: "2026-09-01",
    days: 5,
    adults,
    children: 0,
    seniors: 0,
    groupType,
    transportation: "Drive",
    schedule: { pace: "Balanced", majorActivities: 2 },
    activity: { walking: "Easy walking", hiking: "Easy hikes" },
    food: { diet: [], restrictions: [], cuisineInterests: ["Local cuisine", "Cafes"], eveningPreferences: ["Quiet evening venues", "Evening walks"] },
    alcohol: { preferences: ["Quiet evening venues", "Evening walks"] },
    budget: { total: "$1,500-$3,500" },
    lodging: { changeHotels: "Stay in one place" },
    transport: { maxDrivingDay: "4 hours" },
    preferences: [],
    travelers: Array.from({ length: adults }, (_, index) => ({ id: `traveler-${index + 1}`, name: `Traveler ${index + 1}`, ageGroup: "Adult (18-64)", restrictions: [], notes: "" }))
  };
}

function smokiesProviderFixture() {
  const retrievedAt = "2026-07-30T12:00:00.000Z";
  const regions = [
    region("gatlinburg", "Gatlinburg", 35.7143, -83.5102, ["gateway", "downtown", "food", "evening"], ["sugarlands", "pigeon-forge"]),
    region("pigeon-forge", "Pigeon Forge", 35.7884, -83.5543, ["gateway", "entertainment", "shows", "food"], ["gatlinburg", "sevierville"]),
    region("sevierville", "Sevierville", 35.8681, -83.5618, ["gateway", "food", "regional"], ["pigeon-forge"]),
    region("sugarlands", "Sugarlands and Gatlinburg Trail", 35.6893, -83.536, ["national park", "visitor area", "easy trail"], ["gatlinburg", "newfound-gap"]),
    region("newfound-gap", "Newfound Gap Road and Kuwohi", 35.6118, -83.4253, ["national park", "scenic corridor", "overlook", "high elevation"], ["sugarlands", "oconaluftee"]),
    region("roaring-fork", "Roaring Fork Motor Nature Trail", 35.696, -83.464, ["national park", "scenic corridor", "waterfall", "trail"], ["gatlinburg"]),
    region("cades-cove", "Cades Cove and Little River Road", 35.594, -83.844, ["national park", "scenic corridor", "wildlife", "waterfall"], ["sugarlands"]),
    region("foothills", "Foothills Parkway", 35.756, -83.783, ["scenic corridor", "overlook", "drive"], ["pigeon-forge", "cades-cove"])
  ];
  const places = [
    place("generic-gsmnp", "Great Smoky Mountains National Park", "sugarlands", "Generic park container; use named roads, trailheads, overlooks, visitor areas, and waterfalls instead of scheduling the park as one activity.", ["national park"], ["generic", "container"], 100, 120, 0, 0, 35.6532, -83.507, "outdoor", "high", "morning", false, retrievedAt),
    place("downtown-gatlinburg", "Downtown Gatlinburg gateway walk", "gatlinburg", "Walkable gateway town block with local shops, mountain views, cafes, and low-friction evening options near the park entrance.", ["downtown", "gateway town", "easy walk"], ["gatlinburg", "couple", "evening"], 88, 90, 0, 25, 35.7143, -83.5102, "mixed", "low", "evening", false, retrievedAt),
    place("anakeesta", "Anakeesta", "gatlinburg", "Mountain attraction above Gatlinburg with views, gardens, dining, and relaxed evening potential when tickets and weather fit.", ["mountain attraction", "viewpoint", "evening"], ["gatlinburg", "couple", "signature"], 87, 180, 35, 70, 35.711, -83.512, "mixed", "high", "afternoon", true, retrievedAt),
    place("gatlinburg-skypark", "Gatlinburg SkyPark", "gatlinburg", "SkyBridge and mountain-view attraction suited to a shorter Gatlinburg view block when weather is clear.", ["mountain attraction", "viewpoint"], ["gatlinburg", "skypark", "signature"], 83, 120, 32, 55, 35.7117, -83.518, "outdoor", "high", "afternoon", true, retrievedAt),
    place("sugarlands-visitor-center", "Sugarlands Visitor Center and Cataract Falls", "sugarlands", "Practical park orientation stop with visitor information and a short easy walk to Cataract Falls.", ["visitor center", "waterfall", "easy trail"], ["national park", "cataract falls", "orientation"], 82, 85, 0, 0, 35.6857, -83.536, "mixed", "medium", "morning", false, retrievedAt),
    place("gatlinburg-trail", "Gatlinburg Trail", "sugarlands", "Easy riverside trail between Gatlinburg and Sugarlands, useful for a low-pressure nature walk.", ["trail", "easy hike", "national park"], ["gatlinburg trail", "river", "easy walk"], 80, 95, 0, 0, 35.703, -83.518, "outdoor", "high", "morning", false, retrievedAt),
    place("newfound-gap-kuwohi", "Newfound Gap Road and Kuwohi scenic corridor", "newfound-gap", "High-elevation scenic road linking Sugarlands, Newfound Gap overlook, and Kuwohi, formerly Clingmans Dome; plan as a daylight half-day or full scenic block with closures and parking checked.", ["scenic corridor", "overlook", "national park"], ["Newfound Gap Road", "Kuwohi", "formerly Clingmans Dome", "offline maps", "signature"], 96, 300, 0, 0, 35.5629, -83.4985, "outdoor", "high", "morning", false, retrievedAt),
    place("newfound-gap-overlook", "Newfound Gap overlook", "newfound-gap", "Major mountain pass overlook on US 441 with Appalachian Trail access and weather-sensitive views.", ["overlook", "scenic stop"], ["Newfound Gap", "high elevation", "photography"], 90, 60, 0, 0, 35.6118, -83.4253, "outdoor", "high", "morning", false, retrievedAt),
    place("roaring-fork-corridor", "Roaring Fork Motor Nature Trail and Grotto Falls area", "roaring-fork", "One-way forested scenic motor nature trail near Gatlinburg with trailheads, historic cabins, waterfall access, parking constraints, and daylight needs.", ["scenic corridor", "waterfall", "trail"], ["Roaring Fork", "Grotto Falls", "motor nature trail"], 94, 240, 0, 0, 35.698, -83.464, "outdoor", "high", "morning", false, retrievedAt),
    place("grotto-falls", "Grotto Falls via Trillium Gap Trail", "roaring-fork", "Moderate waterfall hike from Roaring Fork with parking pressure and early-start value; select only when hiking comfort supports it.", ["hike", "waterfall", "trail"], ["Grotto Falls", "moderate hike", "waterfall"], 90, 180, 0, 0, 35.6808, -83.4625, "outdoor", "high", "morning", false, retrievedAt),
    place("laurel-falls", "Laurel Falls Trail", "cades-cove", "Popular paved waterfall trail corridor; use only when current access and construction status make it appropriate.", ["hike", "waterfall", "trail"], ["Laurel Falls", "verify closure", "popular"], 82, 130, 0, 0, 35.6728, -83.5804, "outdoor", "high", "morning", false, retrievedAt),
    place("cades-cove-loop", "Cades Cove Loop Road", "cades-cove", "Classic one-way scenic loop with historic structures, wildlife viewing, Abrams Falls access, traffic constraints, and picnic planning needs.", ["scenic corridor", "loop road", "wildlife"], ["Cades Cove", "Little River Road", "offline maps"], 94, 300, 0, 0, 35.594, -83.844, "outdoor", "high", "morning", false, retrievedAt),
    place("little-river-road", "Little River Road waterfall and picnic corridor", "cades-cove", "Scenic road between Sugarlands and Townsend with river pullouts, waterfall access, and picnic-friendly planning.", ["scenic corridor", "waterfall", "picnic"], ["Little River Road", "waterfall", "packed lunch"], 86, 180, 0, 0, 35.66, -83.63, "outdoor", "high", "morning", false, retrievedAt),
    place("foothills-parkway", "Foothills Parkway overlooks", "foothills", "Lower-friction scenic drive with mountain overlooks, useful for arrival/departure-adjacent scenery when weather is clear.", ["scenic corridor", "overlook"], ["Foothills Parkway", "scenic drive"], 82, 120, 0, 0, 35.756, -83.783, "outdoor", "high", "afternoon", false, retrievedAt),
    place("the-island", "The Island in Pigeon Forge", "pigeon-forge", "Mixed entertainment district with SkyFly, shops, restaurants, fountains, wheel views, and flexible evening energy; not just a restaurant.", ["entertainment district", "evening", "food"], ["Pigeon Forge", "The Island", "couple", "solo"], 90, 150, 0, 75, 35.8032, -83.571, "mixed", "low", "evening", false, retrievedAt),
    place("dollywood", "Dollywood", "pigeon-forge", "Major theme-park anchor with rides, shows, crafts, food, and seasonal events; best as a dedicated ticketed day when budget and interest support it.", ["theme park", "entertainment", "full-day"], ["Dollywood", "signature", "shows"], 89, 420, 85, 160, 35.7951, -83.5303, "mixed", "medium", "full-day", true, retrievedAt),
    place("pigeon-forge-coaster", "Pigeon Forge mountain coaster", "pigeon-forge", "One mountain coaster experience can add variety, but do not schedule multiple coasters unless requested.", ["mountain coaster", "entertainment"], ["Pigeon Forge", "coaster", "ticketed"], 73, 75, 18, 35, 35.796, -83.56, "outdoor", "medium", "afternoon", false, retrievedAt),
    place("old-mill-area", "Old Mill area in Pigeon Forge", "pigeon-forge", "Historic mill district with shops, pottery, restaurants, and a calmer Pigeon Forge food block.", ["historic district", "food", "gateway town"], ["Old Mill", "Pigeon Forge", "local food"], 80, 100, 0, 35, 35.788, -83.554, "mixed", "low", "lunch", false, retrievedAt),
    place("titanic-museum", "Titanic Museum Attraction", "pigeon-forge", "Indoor ticketed museum for weather or explicit indoor interest; not a default park substitute.", ["museum", "indoor"], ["Pigeon Forge", "weather backup"], 68, 120, 40, 55, 35.8206, -83.5782, "indoor", "low", "afternoon", true, retrievedAt),
    place("smoky-mountain-knife-works", "Smoky Mountain Knife Works", "sevierville", "Large retail knife store and souvenir stop; not a default vacation anchor without explicit shopping interest.", ["retail", "knife store"], ["knife works", "souvenir", "novelty retail"], 85, 80, 0, 40, 35.9001, -83.584, "indoor", "low", "afternoon", false, retrievedAt),
    place("wheels-through-time", "Wheels Through Time Motorcycle Museum", "sevierville", "Narrow special-interest motorcycle museum outside the core route; include only for explicit motorcycle interest.", ["motorcycle museum", "special interest"], ["novelty museum", "motorcycle"], 84, 100, 18, 25, 35.901, -83.58, "indoor", "low", "afternoon", false, retrievedAt),
    place("great-smoky-railroad", "Great Smoky Mountains Railroad", "sevierville", "Separate Bryson City railroad excursion requiring its own route and ticket planning; not a quick local backup from Gatlinburg or Pigeon Forge.", ["railroad excursion", "regional extension"], ["distant", "separate excursion", "Bryson City"], 82, 360, 70, 130, 35.430, -83.447, "mixed", "medium", "full-day", true, retrievedAt),
    place("crocketts", "Crockett's Breakfast Camp", "gatlinburg", "Popular Gatlinburg breakfast/brunch restaurant; verify waits and vegetarian fit.", ["restaurant", "breakfast", "brunch"], ["breakfast", "Gatlinburg", "local food"], 74, 60, 14, 28, 35.714, -83.516, "indoor", "low", "morning", false, retrievedAt),
    place("donut-friar", "The Donut Friar", "gatlinburg", "Cafe and bakery-style breakfast or snack stop in The Village area.", ["cafe", "bakery", "breakfast"], ["cafe", "bakery", "Gatlinburg"], 72, 40, 6, 16, 35.711, -83.512, "indoor", "low", "morning", false, retrievedAt),
    place("wild-plum", "Wild Plum Tea Room", "gatlinburg", "Lunch cafe near the Gatlinburg arts area with lighter local choices; confirm seasonal hours.", ["restaurant", "cafe", "lunch"], ["cafe", "lunch", "vegetarian-friendly"], 71, 75, 18, 36, 35.757, -83.449, "indoor", "low", "lunch", false, retrievedAt),
    place("greenbrier", "The Greenbrier Restaurant", "gatlinburg", "Gatlinburg dinner place for a more polished mountain evening; reservations useful.", ["restaurant", "dinner"], ["dinner", "date night", "local"], 76, 100, 35, 80, 35.720, -83.487, "indoor", "low", "dinner", true, retrievedAt),
    place("local-goat", "Local Goat", "pigeon-forge", "Pigeon Forge lunch or dinner restaurant with broad menu choices and convenient route fit.", ["restaurant", "lunch", "dinner"], ["Pigeon Forge", "local food"], 74, 85, 18, 42, 35.819, -83.579, "indoor", "low", "dinner", false, retrievedAt),
    place("old-mill-pottery", "Old Mill Pottery House Cafe", "pigeon-forge", "Pigeon Forge lunch or dinner restaurant near the Old Mill area with a calmer local feel.", ["restaurant", "cafe", "lunch", "dinner"], ["Old Mill", "cafe", "Pigeon Forge"], 73, 80, 18, 40, 35.786, -83.553, "indoor", "low", "lunch", false, retrievedAt),
    place("five-oaks", "Five Oaks Farm Kitchen", "sevierville", "Sevierville breakfast or lunch restaurant; use once when it fits the route, not as the repeated default.", ["restaurant", "breakfast", "lunch"], ["Sevierville", "breakfast"], 68, 70, 16, 34, 35.844, -83.571, "indoor", "low", "morning", false, retrievedAt),
    place("coffee-armory", "Coffee Armory", "sevierville", "Cafe stop for coffee, breakfast, or a lighter route-compatible break.", ["cafe", "coffee", "breakfast"], ["cafe", "Sevierville"], 66, 35, 5, 14, 35.866, -83.559, "indoor", "low", "morning", false, retrievedAt),
    place("sunliner-diner", "Sunliner Diner", "pigeon-forge", "Casual Pigeon Forge breakfast or lunch restaurant with easy parking and flexible timing.", ["restaurant", "breakfast", "lunch"], ["breakfast", "Pigeon Forge"], 65, 65, 14, 30, 35.805, -83.578, "indoor", "low", "morning", false, retrievedAt)
  ];
  return {
    id: "generated-smokies-regional-regression",
    canonicalName: "Gatlinburg, Pigeon Forge, and Great Smoky Mountains Gateway Region, Tennessee, United States",
    aliases: ["gatlinburg", "gatlinburg tn", "gatlinburg tennessee", "gatlinburg tennessee united states", "pigeon forge", "pigeon forge tn", "pigeon forge tennessee", "pigeon forge tennessee united states", "sevierville", "great smoky mountains national park", "smokies"],
    country: "United States",
    state: "Tennessee",
    timezone: "America/New_York",
    currency: "USD",
    summary: "A connected Smokies gateway region where Gatlinburg, Pigeon Forge, Sevierville, and Great Smoky Mountains National Park should be evaluated together while preserving one practical lodging base.",
    seasonalNotes: ["Late summer can bring crowds, afternoon storms, humid valley weather, and high-elevation visibility changes."],
    generalAdvisories: ["Verify trail closures, road closures, parking, weather, tickets, and restaurant hours before travel."],
    planningRules: { defaultHotelRegion: "gatlinburg" },
    regionalDestinationProfile: {
      primaryDestination: "Gatlinburg",
      gatewayTowns: ["Gatlinburg", "Pigeon Forge", "Sevierville"],
      metroOrTourismRegion: "Great Smoky Mountains gateway region",
      parkRelationship: "Gateway towns around Great Smoky Mountains National Park.",
      majorGeographicZones: ["Gatlinburg", "Pigeon Forge", "Sevierville", "Sugarlands", "Newfound Gap and Kuwohi", "Roaring Fork", "Cades Cove and Little River Road", "Foothills Parkway"],
      scenicCorridors: ["Newfound Gap Road / US 441", "Kuwohi Road", "Little River Road", "Cades Cove Loop Road", "Roaring Fork Motor Nature Trail", "Foothills Parkway"],
      entertainmentZones: ["The Island in Pigeon Forge", "Dollywood", "Downtown Gatlinburg", "Anakeesta", "Gatlinburg SkyPark"],
      foodZones: ["Downtown Gatlinburg", "Pigeon Forge Parkway", "Old Mill area", "Sevierville cafes"],
      realisticBaseOptions: ["Gatlinburg", "Pigeon Forge", "Sevierville"],
      nearbyDayTrips: ["Newfound Gap and Kuwohi", "Roaring Fork", "Cades Cove", "Foothills Parkway"],
      overnightExtensions: ["Bryson City", "Asheville"],
      regionalConfidence: "high"
    },
    regions,
    places,
    foodAreas: [
      foodArea("gatlinburg-breakfast", "Gatlinburg breakfast and cafes", "gatlinburg", ["American", "Cafes", "Bakeries"], ["breakfast", "lunch"]),
      foodArea("gatlinburg-dinner", "Gatlinburg dinner and date-night restaurants", "gatlinburg", ["American", "Local cuisine", "Vegetarian-friendly"], ["dinner"]),
      foodArea("pigeon-forge-food", "Pigeon Forge restaurants and entertainment dining", "pigeon-forge", ["American", "Casual dining", "Vegetarian-friendly"], ["lunch", "dinner"]),
      foodArea("old-mill-food", "Old Mill area cafes and restaurants", "pigeon-forge", ["American", "Cafes", "Local cuisine"], ["lunch", "dinner"]),
      foodArea("sevierville-cafes", "Sevierville breakfast and coffee", "sevierville", ["Cafes", "Breakfast", "American"], ["breakfast", "lunch"]),
      foodArea("park-picnic", "Park-day picnic and packed lunch supplies", "sugarlands", ["Packed lunch", "Picnic", "Snacks"], ["lunch"])
    ],
    scenicRoutes: [
      route("gatlinburg-pigeon-forge", "Gatlinburg to Pigeon Forge gateway link", "gatlinburg", "pigeon-forge", 20, 8, ["gateway", "food", "entertainment"], "afternoon"),
      route("gatlinburg-sugarlands", "Gatlinburg to Sugarlands", "gatlinburg", "sugarlands", 12, 4, ["national park", "visitor area"], "morning"),
      route("sugarlands-newfound-gap", "Newfound Gap Road / US 441", "sugarlands", "newfound-gap", 55, 32, ["scenic corridor", "overlook", "Kuwohi"], "morning"),
      route("gatlinburg-roaring-fork", "Roaring Fork Motor Nature Trail", "gatlinburg", "roaring-fork", 30, 12, ["scenic corridor", "waterfall"], "morning"),
      route("sugarlands-cades-cove", "Little River Road to Cades Cove", "sugarlands", "cades-cove", 75, 36, ["scenic corridor", "wildlife", "waterfall"], "morning"),
      route("pigeon-forge-foothills", "Pigeon Forge to Foothills Parkway", "pigeon-forge", "foothills", 35, 20, ["scenic corridor", "overlook"], "afternoon"),
      route("pigeon-forge-sevierville", "Pigeon Forge to Sevierville", "pigeon-forge", "sevierville", 18, 8, ["food", "gateway"], "morning")
    ],
    scenicCorridors: [
      corridor("newfound-gap-corridor", "Newfound Gap Road / US 441 and Kuwohi Road", "Sugarlands", "Kuwohi", "sugarlands", "newfound-gap", 32, 55, ["Sugarlands", "Newfound Gap overlook", "Kuwohi"], ["Newfound Gap overlook"], ["short overlook walks"], [], "Parking pressure at Kuwohi and Newfound Gap; start early.", ["High-elevation weather and seasonal road closures possible."], 300),
      corridor("roaring-fork-corridor", "Roaring Fork Motor Nature Trail", "Gatlinburg", "Grotto Falls area", "gatlinburg", "roaring-fork", 12, 30, ["Historic cabins", "Grotto Falls trailhead"], [], ["Grotto Falls"], ["Grotto Falls"], "One-way road with limited parking.", ["Seasonal road closure possible."], 240),
      corridor("cades-cove-corridor", "Little River Road and Cades Cove Loop Road", "Sugarlands", "Cades Cove", "sugarlands", "cades-cove", 36, 75, ["Little River Road pullouts", "Cades Cove Loop"], ["Cades Cove overlooks"], ["Abrams Falls"], ["Abrams Falls"], "Traffic can be slow; start early and bring food.", ["Weather and traffic can lengthen the day."], 330)
    ],
    hikesAndWaterfalls: [
      hike("gatlinburg-trail-detail", "Gatlinburg Trail", "Gatlinburg or Sugarlands trailhead", "sugarlands", 3.8, 164, 100, "Easy", "Riverside gravel/dirt", "River views", "Medium", "Good low-intensity park walk", "Cataract Falls"),
      hike("grotto-falls-detail", "Grotto Falls via Trillium Gap Trail", "Roaring Fork Motor Nature Trail", "roaring-fork", 2.6, 585, 150, "Moderate", "Forest trail", "Grotto Falls", "High", "Good for easy-hike travelers who accept moderate effort", "Cataract Falls"),
      hike("laurel-falls-detail", "Laurel Falls Trail", "Little River Road", "cades-cove", 2.6, 396, 130, "Easy to moderate", "Paved but uneven", "Laurel Falls", "High", "Only if currently open and route fit supports it", "Sugarlands and Cataract Falls")
    ],
    sourceMetadata: { provider: "test-live", retrievedAt, freshness: "paired-regression-fixture" }
  };
}

function pdfStyleBadSmokiesPlan(trip) {
  return {
    id: "bad-smokies-plan",
    status: "ready",
    destination: "Gatlinburg, Tennessee, United States",
    numberOfDays: 5,
    preferencesSnapshot: trip,
    generationMetadata: {
      destinationProfileSnapshot: profile,
      destinationProfile: { primaryArchetype: "mountain" },
      destinationArchetype: { primaryArchetype: "mountain" },
      destinationIntelligence: { regionalDestinationProfile: profile.regionalDestinationProfile },
      sourceDiagnostics: { destinationResearchSource: "test-live" }
    },
    overview: {},
    foodPlan: {},
    routeSummary: {},
    hotelBase: {},
    tripGuide: {},
    days: Array.from({ length: 5 }, (_, index) => ({
      title: index === 1 ? "Great Smoky Mountains National Park area museums and history" : "Great Smoky Mountains National Park area parks and scenery",
      scheduleItems: [
        { type: "activity", title: index === 1 ? "Smoky Mountain Knife Works" : "Great Smoky Mountains National Park", category: "activity", tags: [], durationMinutes: 90, estimatedCostPerPerson: { low: 10, high: 45 } },
        { type: "lunch", title: "Lunch", mealDetails: { primaryPlaceId: "crocketts", restaurantName: "Crockett's Breakfast Camp", primaryOption: "Crockett's Breakfast Camp" } },
        { type: "dinner", title: "Dinner", mealDetails: { primaryPlaceId: "crocketts", restaurantName: "Crockett's Breakfast Camp", primaryOption: "Crockett's Breakfast Camp" } }
      ],
      backupOptions: [{ title: "Great Smoky Mountains Railroad", estimatedDurationMinutes: 360 }]
    }))
  };
}

function region(id, name, lat, lng, tags = [], neighbors = []) {
  return { id, name, summary: `${name} planning region.`, centerCoordinates: { lat, lng }, tags, neighboringRegionIds: neighbors };
}

function place(id, name, regionId, shortDescription, categories, tags, priorityScore, duration, costLow, costHigh, lat, lng, indoorOutdoor, weatherDependency, bestTimeOfDay, reservationRecommended, retrievedAt) {
  return {
    id,
    name,
    regionId,
    shortDescription,
    categories,
    tags,
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.max(30, duration - 45),
    maximumDurationMinutes: duration + 90,
    estimatedCostLow: costLow,
    estimatedCostHigh: costHigh,
    indoorOutdoor,
    weatherDependency,
    accessibility: /trail|waterfall|Kuwohi|Cades|Roaring/i.test(name) ? "moderate" : "good",
    dietaryRelevance: [],
    openingTimeGuidance: "Verify current hours, closures, access, and parking before relying on this stop.",
    bestTimeOfDay,
    reservationRecommended,
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: { lat, lng },
    backupForTags: [],
    sourceMetadata: { provider: "test-live", providerPlaceId: id, retrievedName: name, retrievedAt, sourceUrl: "test://smokies-regression", dataConfidence: "provider", dataFreshness: "test-fixture" }
  };
}

function foodArea(id, name, regionId, cuisines, mealTypes) {
  return { id, name, regionId, cuisines, mealTypes, budgetLevels: ["budget", "moderate"], dietarySupport: ["Vegetarian", "Gluten-free"], eveningSuitability: ["quiet", "lively"] };
}

function route(id, name, originRegionId, destinationRegionId, minutes, miles, tags, bestTimeOfDay) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes: minutes, estimatedDistanceMiles: miles, tags, bestTimeOfDay, notes: "Verify live conditions before driving." };
}

function corridor(id, name, start, end, originRegionId, destinationRegionId, miles, minutes, stops, overlooks, hikes, waterfalls, parking, seasonalClosures, fullExperienceDurationMinutes) {
  return { id, name, start, end, originRegionId, destinationRegionId, routeDistanceMiles: miles, routeDurationMinutes: minutes, recommendedStops: stops, overlooks, hikes, waterfalls, parking, seasonalClosures, daylightRequired: true, offlineMapRecommended: true, fullExperienceDurationMinutes };
}

function hike(id, trailName, trailhead, regionId, roundTripDistanceMiles, elevationGainFeet, estimatedDurationMinutes, difficulty, terrain, waterfallOrViewpoint, crowdLevel, travelerFit, backupOption) {
  return { id, trailName, trailhead, regionId, coordinates: null, parking: "Limited; verify trailhead parking.", roundTripDistanceMiles, elevationGainFeet, estimatedDurationMinutes, difficulty, terrain, waterfallOrViewpoint, crowdLevel, earlyStartRecommended: true, seasonalCondition: "Verify current trail status.", weatherSensitivity: "High", travelerFit, backupOption, sourceConfidence: "provider" };
}
