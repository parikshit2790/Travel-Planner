import assert from "node:assert/strict";
import { providerStatus } from "../server/lib/env.js";
import { handleLocationAction } from "../server/lib/location-actions.js";
import { handlePlannerAction } from "../server/lib/planner-actions.js";
import {
  openRouteServiceDestinationResearch,
  openRouteServiceLocationSearch,
  openRouteServiceRouteEstimate
} from "../server/lib/openrouteservice-provider.js";

const secret = "ors-secret-value";
const requiredLocations = new Map([
  ["raleigh", ["Raleigh", "North Carolina", "United States", -78.6382, 35.7796]],
  ["austin", ["Austin", "Texas", "United States", -97.7431, 30.2672]],
  ["dallas", ["Dallas", "Texas", "United States", -96.797, 32.7767]],
  ["houston", ["Houston", "Texas", "United States", -95.3698, 29.7604]],
  ["charlotte", ["Charlotte", "North Carolina", "United States", -80.8431, 35.2271]],
  ["san jose", ["San Jose", "California", "United States", -121.8863, 37.3382]],
  ["new york", ["New York", "New York", "United States", -74.006, 40.7128]],
  ["paris", ["Paris", "Ile-de-France", "France", 2.3522, 48.8566]],
  ["tokyo", ["Tokyo", "Tokyo", "Japan", 139.6917, 35.6895]],
  ["glacier national park", ["Glacier National Park", "Montana", "United States", -113.787, 48.7596]]
]);

const originalEnv = captureEnv();
const originalFetch = globalThis.fetch;

process.env.NODE_ENV = "test";
process.env.VERCEL_ENV = "";
process.env.PLACE_PROVIDER = "openrouteservice";
process.env.ROUTE_PROVIDER = "openrouteservice";
process.env.OPENROUTESERVICE_API_KEY = secret;
process.env.PLACE_API_KEY = "";
process.env.ROUTE_API_KEY = "";
process.env.WEATHER_PROVIDER = "";

globalThis.fetch = async (url, options = {}) => mockOpenRouteServiceFetch(url, options);

try {
  const status = providerStatus({
    production: true,
    development: false,
    placeProvider: "openrouteservice",
    routeProvider: "openrouteservice",
    openRouteServiceApiKey: secret,
    placeApiKey: "",
    routeApiKey: "",
    weatherProvider: "",
    weatherApiKey: "",
    aiProvider: "",
    aiApiKey: ""
  });
  assert.equal(status.canGenerate, false);
  assert.equal(status.mode, "unavailable");
  assert.equal(status.placeProviderAvailable, true);
  assert.equal(status.destinationResearchAvailable, false);
  assert.equal(status.routeProviderAvailable, true);
  assert.ok(!JSON.stringify(status).includes(secret));

  const missing = providerStatus({
    production: true,
    development: false,
    placeProvider: "openrouteservice",
    routeProvider: "openrouteservice",
    openRouteServiceApiKey: "",
    placeApiKey: "",
    routeApiKey: "",
    weatherProvider: "",
    weatherApiKey: "",
    aiProvider: "",
    aiApiKey: ""
  });
  assert.equal(missing.canGenerate, false);
  assert.equal(missing.mode, "unavailable");
  assert.equal(missing.placeProviderAvailable, false);
  assert.equal(missing.routeProviderAvailable, false);

  for (const query of requiredLocations.keys()) {
    const results = await openRouteServiceLocationSearch(query, providerConfigFixture());
    assert.ok(results.length >= 1, `${query} should return a location`);
    assert.match(results[0].canonicalName.toLowerCase(), new RegExp(query.split(" ")[0]));
    assert.equal(results[0].provider, "openrouteservice");
    assert.equal(typeof results[0].latitude, "number");
    assert.equal(typeof results[0].longitude, "number");
  }

  for (const query of ["raleigh", "austin", "houston", "san jose", "new york", "paris", "tokyo", "glacier national park"]) {
    const [city, region, country, longitude, latitude] = requiredLocations.get(query);
    const destinationProfile = await openRouteServiceDestinationResearch(`${city}, ${region}, ${country}`, {
      destinationLocation: {
        canonicalName: `${city}, ${region}, ${country}`,
        latitude,
        longitude,
        country,
        stateOrProvince: region
      }
    }, providerConfigFixture());
    const destinationText = JSON.stringify(destinationProfile);
    assert.equal(destinationProfile.sourceMetadata.provider, "openrouteservice");
    assert.ok(destinationProfile.places.length >= 8, `${query} should produce enough travel candidates`);
    assert.ok(destinationProfile.regions.some((item) => item.id === "nearby-excursions"), `${query} should include nearby excursions region`);
    assert.ok(destinationText.includes("Nearby"), `${query} should include nearby-aware planning data`);
    assert.equal(destinationText.includes("openrouteservice point-of-interest candidate"), false);
    assert.equal(destinationText.includes("Gatewood Insurance"), false);
    assert.equal(destinationText.includes("Hampton Inn"), false);
  }

  const publicSearch = await handleLocationAction("search", { query: "Raleigh" });
  assert.equal(publicSearch.status, 200);
  assert.equal(publicSearch.body.results[0].canonicalName, "Raleigh, North Carolina, United States");
  assert.equal("provider" in publicSearch.body.results[0], false);

  const resolved = await handleLocationAction("resolve", { query: "Tokyo" });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.location.canonicalName, "Tokyo, Japan");

  globalThis.fetch = async (url, options = {}) => mockOpenRouteServiceFetch(url, options, { thinPois: true });
  const thinProviderTrip = {
    from: "Austin, Texas, United States",
    fromDisplay: "Austin, Texas, United States",
    destination: "Low Data City, Texas, United States",
    destinationDisplay: "Low Data City, Texas, United States",
    destinationLocation: {
      canonicalName: "Low Data City, Texas, United States",
      latitude: 32.7767,
      longitude: -96.797,
      country: "United States",
      stateOrProvince: "Texas"
    },
    startDate: "2026-08-08",
    endDate: "2026-08-10",
    days: 3,
    adults: 1,
    children: 0,
    seniors: 0,
    groupType: "Solo trip",
    transportation: "Fly and rent a car",
    schedule: { pace: "Balanced", majorActivities: 2 },
    food: { diet: [], restrictions: [], cuisineInterests: [], eveningPreferences: [] },
    preferences: [],
    travelers: [{ id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }]
  };
  const thinProviderResearch = await handlePlannerAction("research-destination", { trip: thinProviderTrip }, { requestId: "test-thin-provider-research" });
  assert.equal(thinProviderResearch.status, 200);
  assert.equal(thinProviderResearch.body.profile.sourceMetadata.freshness, "live-provider-with-starter-fallback");
  assert.ok(thinProviderResearch.body.profile.places.length >= 8);
  assert.ok(JSON.stringify(thinProviderResearch.body.profile).includes("starter planning anchor"));
  const thinProviderPlan = await handlePlannerAction("generate-trip", { trip: thinProviderTrip, destinationProfile: thinProviderResearch.body.profile }, { requestId: "test-thin-provider-generate" });
  assert.equal(thinProviderPlan.status, 200);
  assert.equal(thinProviderPlan.body.status, "ready");
  assert.ok(JSON.stringify(thinProviderPlan.body.plan).includes("Low Data City"));
  globalThis.fetch = async (url, options = {}) => mockOpenRouteServiceFetch(url, options);

  const profile = await openRouteServiceDestinationResearch("Glacier National Park", {
    destinationLocation: {
      canonicalName: "Glacier National Park, Montana, United States",
      latitude: 48.7596,
      longitude: -113.787,
      country: "United States",
      stateOrProvince: "Montana"
    }
  }, providerConfigFixture());
  assert.equal(profile.sourceMetadata.provider, "openrouteservice");
  assert.equal(profile.canonicalName, "Glacier National Park, Montana, United States");
  assert.ok(profile.places.length >= 8);
  assert.ok(profile.foodAreas.length >= 3);

  const research = await handlePlannerAction("research-destination", {
    trip: {
      destination: "Austin, Texas, United States",
      destinationDisplay: "Austin, Texas, United States",
      destinationLocation: {
        canonicalName: "Austin, Texas, United States",
        latitude: 30.2672,
        longitude: -97.7431,
        country: "United States",
        stateOrProvince: "Texas"
      }
    }
  });
  assert.equal(research.status, 200);
  assert.equal(research.body.profile.sourceMetadata.provider, "openrouteservice");

  const austinToCharlotteTrip = {
    from: "Austin, Texas, United States",
    fromDisplay: "Austin, Texas, United States",
    fromLocation: {
      canonicalName: "Austin, Texas, United States",
      latitude: 30.2672,
      longitude: -97.7431
    },
    destination: "Charlotte, North Carolina, United States",
    destinationDisplay: "Charlotte, North Carolina, United States",
    destinationLocation: {
      canonicalName: "Charlotte, North Carolina, United States",
      latitude: 35.2271,
      longitude: -80.8431,
      country: "United States",
      stateOrProvince: "North Carolina"
    },
    startDate: "2026-08-08",
    endDate: "2026-08-10",
    days: 3,
    adults: 1,
    children: 0,
    seniors: 0,
    groupType: "Solo trip",
    transportation: "Fly and rent a car",
    schedule: { pace: "Balanced", majorActivities: 2 },
    food: { diet: [], restrictions: [], cuisineInterests: [], eveningPreferences: [] },
    preferences: [],
    travelers: []
  };
  const charlotteResearch = await handlePlannerAction("research-destination", { trip: austinToCharlotteTrip }, { requestId: "test-austin-charlotte-research" });
  assert.equal(charlotteResearch.status, 200);
  assert.ok(charlotteResearch.body.profile.places.length >= 8);
  const generated = await handlePlannerAction("generate-trip", { trip: austinToCharlotteTrip, destinationProfile: charlotteResearch.body.profile }, { requestId: "test-austin-charlotte-generate" });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.status, "ready");
  assert.ok(JSON.stringify(generated.body.plan).includes("Charlotte"));
  assert.equal(JSON.stringify(generated.body.plan).includes("Santa Monica Pier"), false);
  assert.equal(JSON.stringify(generated.body.plan).includes("Gatewood Insurance"), false);
  assert.equal(JSON.stringify(generated.body.plan).includes("Hampton Inn"), false);

  globalThis.fetch = async (url, options = {}) => mockOpenRouteServiceFetch(url, options, { noisyPois: true });
  const filteredProfile = await openRouteServiceDestinationResearch("Test City", {
    destinationLocation: {
      canonicalName: "Test City, North Carolina, United States",
      latitude: 35.2271,
      longitude: -80.8431,
      country: "United States",
      stateOrProvince: "North Carolina"
    }
  }, providerConfigFixture());
  const filteredPlanText = JSON.stringify(filteredProfile);
  assert.equal(filteredPlanText.includes("Gatewood Insurance"), false);
  assert.equal(filteredPlanText.includes("Hampton Inn"), false);
  assert.equal(filteredPlanText.includes("Town of Indian Trail"), false);
  assert.equal(filteredPlanText.includes("India Hook School"), false);
  assert.ok(filteredPlanText.includes("Discovery Museum"));
  globalThis.fetch = async (url, options = {}) => mockOpenRouteServiceFetch(url, options);

  const driving = await openRouteServiceRouteEstimate(
    { latitude: 35.2271, longitude: -80.8431 },
    { latitude: 40.7128, longitude: -74.006 },
    "driving",
    providerConfigFixture()
  );
  assert.equal(driving.provider, "openrouteservice");
  assert.equal(driving.profile, "driving-car");
  assert.ok(driving.durationMinutes > 0);
  assert.ok(driving.distanceMiles > 0);

  const walking = await openRouteServiceRouteEstimate(
    { latitude: 48.8566, longitude: 2.3522 },
    { latitude: 48.8584, longitude: 2.2945 },
    "walking",
    providerConfigFixture()
  );
  assert.equal(walking.profile, "foot-walking");

  const route = await handlePlannerAction("estimate-route", {
    origin: "San Jose",
    destination: "Charlotte",
    mode: "driving"
  });
  assert.equal(route.status, 200);
  assert.equal(route.body.estimate.provider, "openrouteservice");

  globalThis.fetch = async () => mockJson({ error: { message: `rate limit for ${secret}` } }, 429);
  await assert.rejects(
    () => openRouteServiceLocationSearch("Austin", providerConfigFixture()),
    (error) => error.code === "OPENROUTESERVICE_RATE_LIMITED" && !String(error.message).includes(secret)
  );
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv(originalEnv);
}

console.log("openrouteservice provider tests passed");

function providerConfigFixture() {
  return {
    production: true,
    development: false,
    placeProvider: "openrouteservice",
    routeProvider: "openrouteservice",
    openRouteServiceApiKey: secret,
    placeApiKey: "",
    routeApiKey: "",
    weatherProvider: "",
    weatherApiKey: "",
    aiProvider: "",
    aiApiKey: "",
    timeoutMs: 10000
  };
}

function mockOpenRouteServiceFetch(url, options = {}, fixtures = {}) {
  assert.ok(!String(url).includes("undefined"));
  const parsed = new URL(String(url));
  if (options.method === "GET" || !options.method) assert.equal(parsed.searchParams.get("api_key"), secret);
  if (options.method === "POST") assert.equal(options.headers.Authorization, secret);
  if (parsed.pathname.includes("/geocode/autocomplete") || parsed.pathname.includes("/geocode/search")) {
    return mockJson({ features: [geocodeFeature(parsed.searchParams.get("text") || "")] });
  }
  if (parsed.pathname === "/pois") {
    const request = JSON.parse(options.body || "{}");
    const isFood = request.filters?.category_group_ids?.length === 1 && request.filters.category_group_ids[0] === 560;
    if (fixtures.noisyPois) return mockJson({ features: isFood ? foodPoiFeatures() : noisyPoiFeatures() });
    if (fixtures.thinPois) return mockJson({ features: isFood ? [] : [poiFeature("Dallas Arts District", "gallery", 1), poiFeature("Klyde Warren Park", "park", 2)] });
    const isNearby = Number(request.geometry?.buffer || 0) > 30000;
    return mockJson({ features: isFood ? foodPoiFeatures(isNearby) : poiFeatures(isNearby) });
  }
  if (parsed.pathname.includes("/v2/directions/")) {
    return mockJson({ routes: [{ summary: { duration: parsed.pathname.includes("foot-walking") ? 4200 : 39600, distance: parsed.pathname.includes("foot-walking") ? 5400 : 1030000 } }] });
  }
  return mockJson({ error: { message: "not found" } }, 404);
}

function geocodeFeature(text) {
  const normalized = String(text || "").trim().toLowerCase();
  const entry = requiredLocations.get(normalized) || [...requiredLocations.entries()].find(([key]) => key.startsWith(normalized))?.[1] || requiredLocations.get("charlotte");
  const [city, region, country, longitude, latitude] = entry;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    properties: {
      id: `${city.toLowerCase().replace(/\s+/g, "-")}-fixture`,
      name: city,
      label: `${city}, ${region}, ${country}`,
      locality: city,
      region,
      country,
      country_a: country === "United States" ? "USA" : country.slice(0, 3).toUpperCase(),
      layer: city.includes("Park") ? "venue" : "locality"
    }
  };
}

function poiFeatures(isNearby = false) {
  return Array.from({ length: 12 }, (_, index) => {
    const categories = ["museum", "park", "restaurant", "historic", "viewpoint", "gallery", "theater", "garden"];
    const category = categories[index % categories.length];
    return poiFeature(`${isNearby ? "Nearby" : "Provider"} ${titleCase(category)} ${index + 1}`, category, index, "venue", isNearby ? 0.35 : 0.01);
  });
}

function foodPoiFeatures(isNearby = false) {
  return Array.from({ length: 5 }, (_, index) => poiFeature(`${isNearby ? "Nearby" : "Local"} Dining ${index + 1}`, "restaurant", index, "venue", isNearby ? 0.18 : 0.01));
}

function noisyPoiFeatures() {
  return [
    poiFeature("Gatewood Insurance", "office", 100),
    poiFeature("Hampton Inn Charlotte-Uptown", "hotel", 101),
    poiFeature("Town of Indian Trail", "administrative", 102, "localadmin"),
    poiFeature("India Hook School", "school", 103),
    ...Array.from({ length: 10 }, (_, index) => poiFeature(`Discovery Museum ${index + 1}`, index % 2 ? "museum" : "park", index))
  ];
}

function poiFeature(name, category, index, layer = "venue", coordinateOffset = 0.01) {
  return {
    type: "Feature",
    id: `poi-${index}-${category}`,
    geometry: { type: "Point", coordinates: [-80.84 + index * coordinateOffset, 35.22 + index * coordinateOffset] },
    properties: {
      osm_id: `poi-${index}-${category}`,
      name,
      category_group: category,
      category,
      layer,
      osm_tags: { name }
    }
  };
}

function mockJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function titleCase(value) {
  return String(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function captureEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PLACE_PROVIDER: process.env.PLACE_PROVIDER,
    ROUTE_PROVIDER: process.env.ROUTE_PROVIDER,
    OPENROUTESERVICE_API_KEY: process.env.OPENROUTESERVICE_API_KEY,
    PLACE_API_KEY: process.env.PLACE_API_KEY,
    ROUTE_API_KEY: process.env.ROUTE_API_KEY,
    WEATHER_PROVIDER: process.env.WEATHER_PROVIDER
  };
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
