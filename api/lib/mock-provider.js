const destinationSeeds = {
  "new york": ["Central Park", "The Metropolitan Museum of Art", "High Line", "Brooklyn Bridge", "Tenement Museum", "Chelsea Market", "DUMBO waterfront", "Times Square theatre district", "Statue of Liberty ferry area", "Greenwich Village"],
  "seattle": ["Pike Place Market", "Seattle Center and Space Needle", "Chihuly Garden and Glass", "Museum of Pop Culture", "Kerry Park", "Ballard Locks", "Discovery Park", "Capitol Hill", "Seattle waterfront", "Fremont"],
  "glacier": ["Going-to-the-Sun Road", "Lake McDonald", "Logan Pass", "Many Glacier", "Avalanche Lake trailhead", "St. Mary Lake", "Two Medicine", "Apgar Village", "Hidden Lake Overlook", "West Glacier"],
  "maui": ["Road to Hana", "Haleakala National Park", "Lahaina area", "Wailea Beach", "Iao Valley State Monument", "Paia", "Kihei", "Makena State Park", "Maui Ocean Center", "Upcountry Maui"],
  "paris": ["Louvre Museum", "Eiffel Tower area", "Montmartre", "Notre-Dame and Ile de la Cite", "Musee d'Orsay", "Le Marais", "Luxembourg Gardens", "Seine river walk", "Saint-Germain-des-Pres", "Canal Saint-Martin"],
  "tokyo": ["Asakusa and Senso-ji", "Meiji Shrine", "Shibuya Crossing", "Ueno Park", "Tokyo National Museum", "Tsukiji Outer Market", "Shinjuku Gyoen", "Akihabara", "Ginza", "Odaiba waterfront"],
  "iceland": ["Reykjavik", "Golden Circle", "Thingvellir National Park", "Geysir geothermal area", "Gullfoss", "South Coast waterfalls", "Reynisfjara", "Blue Lagoon area", "Snaefellsnes Peninsula", "Harpa Concert Hall"],
  "amalfi": ["Amalfi town", "Positano", "Ravello", "Path of the Gods", "Atrani", "Minori", "Maiori", "Vietri sul Mare", "Furore fjord", "Sorrento base"],
  "detroit": ["Detroit RiverWalk", "Detroit Institute of Arts", "Motown Museum", "Eastern Market", "The Henry Ford", "Belle Isle", "Corktown", "Guardian Building", "Dequindre Cut", "Dearborn food corridor"],
  "los angeles": ["Santa Monica Pier", "Getty Center", "Griffith Observatory", "Venice Canals", "The Broad", "Grand Central Market", "LACMA area", "Malibu coast", "Little Tokyo", "Hollywood Bowl overlook"]
};

const regionNames = ["Central district", "Museum and culture area", "Waterfront or scenic area", "Local food district", "Historic neighborhood", "Outer day-trip area"];

export function mockLocationSearch(query) {
  const text = String(query || "").trim();
  if (!text) return [];
  if (/^(georgia|washington|portland|springfield|congo|california|europe)$/i.test(text)) {
    return [
      mockLocation(`${text}, United States`, "Region", "US", text),
      mockLocation(`${text}, international result`, "Region", "", text)
    ];
  }
  return [mockLocation(text, inferLocationType(text), "", text)];
}

export function mockDestinationResearch(destination, trip = {}) {
  const canonicalName = canonicalDestination(destination);
  const key = Object.keys(destinationSeeds).find((item) => canonicalName.toLowerCase().includes(item));
  const seedPlaces = destinationSeeds[key] || genericPlacesFor(canonicalName);
  const regions = regionNames.map((name, index) => ({
    id: slug(name),
    name,
    summary: `${name} for ${canonicalName}, used to group nearby experiences and reduce backtracking.`,
    centerCoordinates: { lat: 40 + index * 0.01, lng: -73 - index * 0.01 },
    tags: ["planning-area", index % 2 ? "culture" : "scenic"],
    neighboringRegionIds: regionNames.filter((_, neighborIndex) => Math.abs(neighborIndex - index) <= 1 && neighborIndex !== index).map(slug),
    typicalTravelMinutesToRegions: {}
  }));
  const places = seedPlaces.map((name, index) => placeFromSeed(name, regions[index % regions.length], canonicalName, index));
  const foodAreas = regions.slice(0, 5).map((region, index) => ({
    id: `${region.id}-food`,
    name: `${region.name} dining area`,
    regionId: region.id,
    cuisines: index % 2 ? ["Local cuisine", "Cafes", "Vegetarian-friendly", "Casual dining"] : ["Local cuisine", "Street food", "Desserts", "American"],
    mealTypes: index < 2 ? ["breakfast", "lunch", "dinner"] : ["lunch", "dinner"],
    budgetLevels: ["budget", "moderate"],
    dietarySupport: ["Vegetarian", "Gluten-free", "Dairy-free"],
    eveningSuitability: index % 2 ? ["quiet"] : ["lively", "sunset"],
    shortDescription: `Retrieved-style food district for ${region.name}; confirm specific restaurants and dietary needs directly.`
  }));
  return {
    id: `mock-${slug(canonicalName)}`,
    canonicalName,
    aliases: [canonicalName.toLowerCase(), String(destination || "").toLowerCase()],
    country: "",
    state: "",
    timezone: "",
    currency: "USD",
    summary: `${canonicalName} profile built from configured mock provider data for development and deterministic tests.`,
    seasonalNotes: ["Use live weather or seasonal guidance before finalizing outdoor plans."],
    generalAdvisories: ["Mock provider data is for development; configure production place and route providers before public worldwide claims."],
    planningRules: { defaultHotelRegion: regions[0].id, maxRegionChangesRelaxed: 1, maxRegionChangesBalanced: 2, maxRegionChangesPacked: 3 },
    regions,
    places,
    foodAreas,
    scenicRoutes: regions.slice(0, -1).map((region, index) => ({
      id: `${region.id}-${regions[index + 1].id}`,
      name: `${region.name} to ${regions[index + 1].name}`,
      originRegionId: region.id,
      destinationRegionId: regions[index + 1].id,
      estimatedDriveMinutes: 15 + index * 6,
      estimatedDistanceMiles: 4 + index * 3,
      tags: ["route-estimate", "mock"],
      bestTimeOfDay: "afternoon",
      notes: "Mock route estimate; configure a route provider for production."
    })),
    sourceMetadata: {
      provider: "mock",
      retrievedAt: new Date().toISOString(),
      freshness: "development-mock",
      candidateCount: places.length
    }
  };
}

export function mockRouteEstimate(origin, destination, mode = "driving") {
  const minutes = 18 + Math.abs(String(origin?.name || origin || "").length - String(destination?.name || destination || "").length) * 2;
  return {
    durationMinutes: minutes,
    distanceMiles: Math.max(2, Math.round(minutes * 0.45)),
    mode,
    provider: "mock",
    retrievedAt: new Date().toISOString(),
    trafficAware: false,
    disclaimer: "Mock route estimate for development."
  };
}

function placeFromSeed(name, region, canonicalName, index) {
  const category = categoryFor(name, index);
  return {
    id: slug(name),
    name,
    regionId: region.id,
    shortDescription: `${name} is a retrieved candidate for ${canonicalName}, scheduled with nearby ${region.name} stops and verification reminders.`,
    categories: [category, index % 3 === 0 ? "landmark" : "culture"],
    tags: [category, "Photography", "Local culture"],
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: category === "full-day" ? 300 : 70 + (index % 4) * 25,
    minimumDurationMinutes: 45,
    maximumDurationMinutes: category === "full-day" ? 420 : 180,
    estimatedCostLow: index % 4 === 0 ? 0 : 10,
    estimatedCostHigh: index % 4 === 0 ? 20 : 45,
    indoorOutdoor: category === "museum" ? "indoor" : category === "nature" ? "outdoor" : "mixed",
    weatherDependency: category === "nature" ? "high" : category === "museum" ? "low" : "medium",
    accessibility: index % 5 === 0 ? "moderate" : "good",
    dietaryRelevance: [],
    openingTimeGuidance: "Confirm current opening hours before travel.",
    bestTimeOfDay: index % 5 === 0 ? "morning" : index % 5 === 1 ? "afternoon" : index % 5 === 2 ? "evening" : "morning",
    reservationRecommended: category === "full-day" || category === "museum",
    seasonalNotes: [],
    conflictTags: [],
    priorityScore: 92 - index * 3,
    coordinates: { lat: region.centerCoordinates.lat + index * 0.002, lng: region.centerCoordinates.lng - index * 0.002 },
    backupForTags: category === "museum" ? ["weather", "rain"] : [],
    sourceMetadata: {
      provider: "mock",
      providerPlaceId: slug(name),
      retrievedName: name,
      retrievedAt: new Date().toISOString(),
      sourceUrl: "",
      dataConfidence: "mock",
      dataFreshness: "development-mock"
    }
  };
}

function genericPlacesFor(destination) {
  return [
    `${destination} central orientation walk`,
    `${destination} main museum or cultural center`,
    `${destination} scenic viewpoint`,
    `${destination} local market district`,
    `${destination} historic neighborhood`,
    `${destination} waterfront or park area`,
    `${destination} food street`,
    `${destination} evening district`,
    `${destination} indoor backup museum`,
    `${destination} day-trip area`
  ];
}

function categoryFor(name, index) {
  const text = name.toLowerCase();
  if (/museum|gallery|dia|louvre|national museum|henry ford/.test(text)) return "museum";
  if (/park|beach|lake|waterfall|road|coast|glacier|haleakala|belle isle/.test(text)) return "nature";
  if (/market|food|bakery|cafe|dining/.test(text)) return "food";
  if (/village|day-trip|national park/.test(text) || index === 8) return "full-day";
  return "culture";
}

function mockLocation(name, type, countryCode, input) {
  return {
    originalInput: input,
    canonicalName: name,
    displayName: name,
    providerPlaceId: `mock-${slug(name)}`,
    locationType: type,
    country: countryCode === "US" ? "United States" : "",
    stateOrProvince: "",
    countryCode,
    coordinates: { lat: 0, lng: 0 },
    boundingRegion: null,
    timezone: "",
    provider: "mock",
    confidence: "mock"
  };
}

function inferLocationType(value) {
  if (/national park/i.test(value)) return "National Park";
  if (/coast|rockies|keys|peninsula|region/i.test(value)) return "Region";
  if (/iceland|france|japan|italy/i.test(value)) return "Country or International Region";
  return "City";
}

function canonicalDestination(destination) {
  return String(destination || "Destination").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "item";
}
