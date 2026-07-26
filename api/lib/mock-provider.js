const mockLocationFixtures = [
  locationFixture("mock-san-jose-ca-us", "San Jose", "California", "United States", "US", 37.3382, -121.8863, ["sjc", "san jose ca", "san jose california", "silicon valley"]),
  locationFixture("mock-san-francisco-ca-us", "San Francisco", "California", "United States", "US", 37.7749, -122.4194, ["sf", "sfo", "san francisco ca", "bay area"]),
  locationFixture("mock-san-diego-ca-us", "San Diego", "California", "United States", "US", 32.7157, -117.1611, ["san diego ca"]),
  locationFixture("mock-san-antonio-tx-us", "San Antonio", "Texas", "United States", "US", 29.4252, -98.4946, ["san antonio tx"]),
  locationFixture("mock-san-juan-pr-us", "San Juan", "Puerto Rico", "United States", "US", 18.4655, -66.1057, ["san juan puerto rico", "san juan pr"]),
  locationFixture("mock-charlotte-nc-us", "Charlotte", "North Carolina", "United States", "US", 35.2271, -80.8431, ["charlotte nc", "clt", "queen city"]),
  locationFixture("mock-los-angeles-ca-us", "Los Angeles", "California", "United States", "US", 34.0522, -118.2437, ["la", "l.a.", "los angeles ca", "los angeles california"]),
  locationFixture("mock-new-york-ny-us", "New York", "New York", "United States", "US", 40.7128, -74.006, ["nyc", "new york city", "new york ny", "manhattan"]),
  locationFixture("mock-detroit-mi-us", "Detroit", "Michigan", "United States", "US", 42.3314, -83.0458, ["detroit mi", "motor city"]),
  locationFixture("mock-seattle-wa-us", "Seattle", "Washington", "United States", "US", 47.6062, -122.3321, ["seattle wa"]),
  locationFixture("mock-miami-fl-us", "Miami", "Florida", "United States", "US", 25.7617, -80.1918, ["miami fl"]),
  locationFixture("mock-chicago-il-us", "Chicago", "Illinois", "United States", "US", 41.8781, -87.6298, ["chicago il"]),
  locationFixture("mock-boston-ma-us", "Boston", "Massachusetts", "United States", "US", 42.3601, -71.0589, ["boston ma"]),
  locationFixture("mock-washington-dc-us", "Washington", "District of Columbia", "United States", "US", 38.9072, -77.0369, ["washington dc", "dc", "washington d.c."]),
  locationFixture("mock-paris-fr", "Paris", "Ile-de-France", "France", "FR", 48.8566, 2.3522, ["paris france"]),
  locationFixture("mock-tokyo-jp", "Tokyo", "Tokyo", "Japan", "JP", 35.6762, 139.6503, ["tokyo japan"])
];

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
  "charlotte": ["Uptown Charlotte orientation walk", "Romare Bearden Park", "NASCAR Hall of Fame", "Mint Museum Uptown", "Levine Museum area", "NoDa arts district", "South End Rail Trail", "Freedom Park", "Billy Graham Library", "Lake Norman day-trip area"],
  "los angeles": ["Santa Monica Pier", "Getty Center", "Griffith Observatory", "Venice Canals", "The Broad", "Grand Central Market", "LACMA area", "Malibu coast", "Little Tokyo", "Hollywood Bowl overlook"]
};

const regionNames = ["Central district", "Museum and culture area", "Waterfront or scenic area", "Local food district", "Historic neighborhood", "Outer day-trip area"];

export function mockLocationSearch(query) {
  const text = String(query || "").trim();
  if (!text) return [];
  const normalized = normalizeSearchText(text);
  return mockLocationFixtures
    .map((fixture, index) => ({ fixture, index, score: locationFixtureScore(fixture, normalized) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .map(({ fixture }) => ({ ...fixture, originalInput: text }));
}

export function mockDestinationResearch(destination, trip = {}) {
  const canonicalName = canonicalDestination(destination);
  const key = mockDestinationKey(canonicalName);
  if (!key) {
    const error = new Error("This destination is not available in the current demo data.");
    error.code = "MOCK_DESTINATION_UNAVAILABLE";
    error.retryable = false;
    throw error;
  }
  const seedPlaces = destinationSeeds[key];
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

export function hasMockDestinationData(destination) {
  return Boolean(mockDestinationKey(destination));
}

export function supportedMockDestinationNames() {
  return Object.keys(destinationSeeds);
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

function categoryFor(name, index) {
  const text = name.toLowerCase();
  if (/museum|gallery|dia|louvre|national museum|henry ford/.test(text)) return "museum";
  if (/park|beach|lake|waterfall|road|coast|glacier|haleakala|belle isle/.test(text)) return "nature";
  if (/market|food|bakery|cafe|dining/.test(text)) return "food";
  if (/village|day-trip|national park/.test(text) || index === 8) return "full-day";
  return "culture";
}

function locationFixture(id, city, stateOrRegion, country, countryCode, latitude, longitude, aliases = []) {
  const canonicalName = [city, stateOrRegion, country].filter(Boolean).join(", ");
  return {
    id,
    canonicalName,
    displayName: canonicalName,
    normalizedName: canonicalName,
    city,
    stateOrRegion,
    stateOrProvince: stateOrRegion,
    country,
    countryCode,
    latitude,
    longitude,
    coordinates: { lat: latitude, lng: longitude },
    locationType: "City",
    aliases,
    providerPlaceId: id,
    boundingRegion: null,
    timezone: "",
    provider: "mock",
    confidence: "mock",
    verificationStatus: "Verified",
    verifiedAt: new Date().toISOString()
  };
}

function locationFixtureScore(location, normalizedQuery) {
  const values = [
    location.canonicalName,
    location.displayName,
    location.city,
    location.stateOrRegion,
    location.country,
    location.countryCode,
    ...(location.aliases || [])
  ].map(normalizeSearchText).filter(Boolean);
  if (values.some((value) => value === normalizedQuery)) return 1000 + (normalizeSearchText(location.city) === normalizedQuery ? 200 : 0);
  if (normalizeSearchText(location.city).startsWith(normalizedQuery)) return 900;
  if ((location.aliases || []).map(normalizeSearchText).some((alias) => alias.startsWith(normalizedQuery))) return 820;
  if (normalizeSearchText(location.canonicalName).startsWith(normalizedQuery)) return 760;
  if (values.some((value) => value.includes(normalizedQuery))) return 400;
  return 0;
}

function canonicalDestination(destination) {
  return String(destination || "Destination").replace(/\s+/g, " ").trim();
}

function mockDestinationKey(destination) {
  const text = normalizeSearchText(destination);
  return Object.keys(destinationSeeds).find((item) => text.includes(item));
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "item";
}
