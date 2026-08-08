import assert from "node:assert/strict";
import { providerConfig, providerStatus } from "../server/lib/env.js";
import { googleDestinationResearch, googleLocationSearch, googleProviderHealthCheck, googleRouteEstimate, googleRouteMatrixSmokeCheck } from "../server/lib/google-provider.js";
import { handleLocationAction } from "../server/lib/location-actions.js";
import { handlePlannerAction } from "../server/lib/planner-actions.js";
import { handleProviderHealthAction } from "../server/lib/provider-health-actions.js";

const originalFetch = globalThis.fetch;
const originalEnv = captureEnv();
const googleSecret = "google-secret-value";
const openAiSecret = "openai-secret-value";

process.env.NODE_ENV = "production";
process.env.VERCEL_ENV = "production";
process.env.PLACE_PROVIDER = " google ";
process.env.ROUTE_PROVIDER = "GOOGLE";
process.env.GOOGLE_MAPS_API_KEY = googleSecret;
process.env.AI_PROVIDER = " openai ";
process.env.OPENAI_API_KEY = openAiSecret;
process.env.AI_MODEL = "gpt-5-mini";
process.env.PROVIDER_TIMEOUT_MS = "20000";

try {
  globalThis.fetch = async (url, options = {}) => googleAndOpenAiFetch(url, options);
  const config = providerConfig();
  assert.equal(config.placeProvider, "google");
  assert.equal(config.routeProvider, "google");
  assert.equal(config.aiProvider, "openai");
  assert.equal(config.googleMapsApiKey, googleSecret);

  const status = providerStatus(config);
  assert.equal(status.canGenerate, true);
  assert.equal(status.mode, "live");
  assert.equal(status.placeProviderAvailable, true);
  assert.equal(status.routeProviderAvailable, true);
  assert.equal(status.destinationResearchAvailable, true);
  assert.equal(JSON.stringify(status).includes(googleSecret), false);
  assert.equal(JSON.stringify(status).includes(openAiSecret), false);

  const missingKey = providerStatus({ ...config, googleMapsApiKey: "", placeApiKey: "", routeApiKey: "" });
  assert.equal(missingKey.canGenerate, false);
  assert.equal(missingKey.placeProviderAvailable, false);
  assert.equal(missingKey.routeProviderAvailable, false);

  const unsupported = providerStatus({ ...config, placeProvider: "googlemaps", routeProvider: "googlemaps" });
  assert.equal(unsupported.canGenerate, false);
  assert.ok(unsupported.errors.some((item) => item.includes("Adapter not implemented")));

  for (const query of ["Raleigh", "Austin", "Houston"]) {
    const results = await googleLocationSearch(query, config);
    assert.ok(results.length >= 1, `${query} autocomplete should return results`);
    assert.equal(results[0].provider, "google");
    assert.equal(typeof results[0].latitude, "number");
  }

  const publicSearch = await handleLocationAction("search", { query: "Raleigh" });
  assert.equal(publicSearch.status, 200);
  assert.equal("provider" in publicSearch.body.results[0], false);

  const details = await googleLocationSearch("Charlotte", config);
  assert.equal(details[0].canonicalName, "Charlotte, North Carolina, United States");

  for (const destination of ["Charlotte, North Carolina, United States", "Dallas, Texas, United States", "Detroit, Michigan, United States"]) {
    const profile = await googleDestinationResearch(destination, {}, config);
    const text = JSON.stringify(profile);
    assert.equal(profile.sourceMetadata.provider, "google");
    assert.ok(profile.places.length >= 3, `${destination} should return tourism candidates`);
    assert.equal(/Gatewood Insurance|Hampton Inn|School|Bank|Medical|Apartment/i.test(text), false);
  }

  const route = await googleRouteEstimate({ lat: 35.2271, lng: -80.8431 }, { lat: 35.7796, lng: -78.6382 }, "driving", config);
  assert.equal(route.provider, "google");
  assert.ok(route.durationMinutes > 0);
  assert.ok(route.distanceMiles > 0);

  const matrix = await googleRouteMatrixSmokeCheck(config);
  assert.ok(matrix.durationMinutes > 0);
  assert.ok(matrix.distanceMiles > 0);

  const googleHealth = await googleProviderHealthCheck(config, { requestId: "test-google-health" });
  assert.equal(googleHealth.placeProviderAvailable, true);
  assert.equal(googleHealth.destinationResearchAvailable, true);
  assert.equal(googleHealth.routeProviderAvailable, true);
  assert.equal(googleHealth.routeMatrixAvailable, true);

  const fullHealth = await handleProviderHealthAction("status");
  assert.equal(fullHealth.status, 200);
  assert.equal(fullHealth.body.canGenerate, true);
  assert.equal(fullHealth.body.mode, "live");
  assert.equal(fullHealth.body.aiProviderAvailable, true);
  assert.equal(fullHealth.body.placeProviderAvailable, true);
  assert.equal(fullHealth.body.destinationResearchAvailable, true);
  assert.equal(fullHealth.body.routeProviderAvailable, true);
  assert.equal(JSON.stringify(fullHealth.body).includes(googleSecret), false);
  assert.equal(JSON.stringify(fullHealth.body).includes(openAiSecret), false);

  const research = await handlePlannerAction("research-destination", { trip: { destination: "Dallas, Texas, United States" } }, { requestId: "test-google-dallas" });
  assert.equal(research.status, 200);
  assert.equal(research.body.profile.sourceMetadata.provider, "google");

  await assertGoogleFailure("places-disabled", "PROVIDER_CONFIGURATION_REQUIRED");
  await assertGoogleFailure("routes-disabled", "PROVIDER_CONFIGURATION_REQUIRED");
  await assertGoogleFailure("billing-disabled", "PROVIDER_CONFIGURATION_REQUIRED");
  await assertGoogleFailure("invalid-key", "PROVIDER_AUTH_FAILED");
  await assertGoogleFailure("key-restricted", "PROVIDER_AUTH_FAILED");
  await assertGoogleFailure("quota", "PROVIDER_QUOTA_EXCEEDED");
  await assertGoogleFailure("malformed", "INVALID_PROVIDER_RESPONSE");
  await assertGoogleFailure("timeout", "GOOGLE_TIMEOUT");
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv(originalEnv);
}

console.log("Google provider tests passed");

async function assertGoogleFailure(fixture, expectedCode) {
  globalThis.fetch = async (url, options = {}) => googleAndOpenAiFetch(url, options, fixture);
  const config = providerConfig();
  const googleDiagnostics = await googleProviderHealthCheck(config, { requestId: `test-${fixture}` });
  assert.ok(JSON.stringify(googleDiagnostics).includes(expectedCode), `${fixture} should map to ${expectedCode}`);
  const health = await handleProviderHealthAction("status");
  assert.equal(health.status, 200);
  assert.equal(health.body.canGenerate, false);
  assert.equal(JSON.stringify(health.body).includes(googleSecret), false);
  if (fixture === "timeout") {
    assert.equal(health.body.placeProviderAvailable || health.body.routeProviderAvailable, false);
  }
  assert.equal("diagnostics" in health.body, false);
}

function googleAndOpenAiFetch(url, options = {}, fixture = "ok") {
  const parsed = new URL(String(url));
  assert.equal(String(url).includes(googleSecret), false);
  assert.equal(String(url).includes(openAiSecret), false);
  if (parsed.hostname === "api.openai.com") {
    assert.equal(options.headers.Authorization, `Bearer ${openAiSecret}`);
    return mockJson({ output_text: JSON.stringify({ ok: true, provider: "openai" }) });
  }
  if (parsed.hostname === "places.googleapis.com") {
    assert.equal(options.headers["X-Goog-Api-Key"], googleSecret);
    if (fixture === "places-disabled") return googleError(403, "PERMISSION_DENIED", "Places API has not been used or is disabled.");
    if (fixture === "billing-disabled") return googleError(403, "PERMISSION_DENIED", "Billing has not been enabled.");
    if (fixture === "invalid-key") return googleError(401, "UNAUTHENTICATED", "API key not valid.");
    if (fixture === "key-restricted") return googleError(403, "PERMISSION_DENIED", "API key restrictions block this API.");
    if (fixture === "quota") return googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded.");
    if (fixture === "timeout") return Promise.reject(Object.assign(new Error("request timed out"), { code: "REQUEST_TIMEOUT", status: 408 }));
    if (parsed.pathname.endsWith("/places:autocomplete")) return mockJson({ suggestions: [predictionFor(requestBody(options).input)] });
    if (parsed.pathname.includes("/places/")) return mockJson(placeForId(decodeURIComponent(parsed.pathname.split("/").pop())));
    if (parsed.pathname.endsWith("/places:searchText")) {
      if (fixture === "malformed") return mockJson({ places: [{ displayName: { text: "Hampton Inn Charlotte-Uptown" }, types: ["lodging"] }] });
      return mockJson({ places: tourismPlaces(requestBody(options).textQuery) });
    }
    if (parsed.pathname.endsWith("/places:searchNearby")) {
      if (fixture === "malformed") return mockJson({ places: [{ displayName: { text: "Gatewood Insurance" }, types: ["insurance_agency"] }] });
      return mockJson({ places: tourismPlaces("nearby Charlotte") });
    }
  }
  if (parsed.hostname === "routes.googleapis.com") {
    assert.equal(options.headers["X-Goog-Api-Key"], googleSecret);
    if (fixture === "routes-disabled") return googleError(403, "PERMISSION_DENIED", "Routes API has not been used or is disabled.");
    if (fixture === "billing-disabled") return googleError(403, "PERMISSION_DENIED", "Billing has not been enabled.");
    if (fixture === "invalid-key") return googleError(401, "UNAUTHENTICATED", "API key not valid.");
    if (fixture === "key-restricted") return googleError(403, "PERMISSION_DENIED", "API key restrictions block this API.");
    if (fixture === "quota") return googleError(429, "RESOURCE_EXHAUSTED", "Quota exceeded.");
    if (fixture === "timeout") return Promise.reject(Object.assign(new Error("request timed out"), { code: "REQUEST_TIMEOUT", status: 408 }));
    if (parsed.pathname.endsWith("/directions/v2:computeRoutes")) return mockJson({ routes: [{ duration: "7200s", distanceMeters: 260000 }] });
    if (parsed.pathname.endsWith("/distanceMatrix/v2:computeRouteMatrix")) return mockJson([{ originIndex: 0, destinationIndex: 0, duration: "7200s", distanceMeters: 260000, status: {} }]);
  }
  return mockJson({}, 404);
}

function predictionFor(input) {
  const name = canonicalFor(input);
  return { placePrediction: { placeId: `place-${slug(name)}`, text: { text: name }, structuredFormat: { mainText: { text: name.split(",")[0] } }, types: ["locality"] } };
}

function cityCoordinatesFor(id) {
  const text = String(id || "").toLowerCase();
  if (text.includes("austin")) return ["Austin", "Texas", "United States", 30.2672, -97.7431];
  if (text.includes("houston")) return ["Houston", "Texas", "United States", 29.7604, -95.3698];
  if (text.includes("charlotte")) return ["Charlotte", "North Carolina", "United States", 35.2271, -80.8431];
  if (text.includes("dallas")) return ["Dallas", "Texas", "United States", 32.7767, -96.797];
  if (text.includes("detroit")) return ["Detroit", "Michigan", "United States", 42.3314, -83.0458];
  return ["Raleigh", "North Carolina", "United States", 35.7796, -78.6382];
}

function placeForId(id) {
  const city = cityCoordinatesFor(id);
  return googlePlace(city[0], city[1], city[2], city[3], city[4], ["locality"], 4.6, 1200);
}

function tourismPlaces(query) {
  const [city, state, country, lat, lng] = cityCoordinatesFor(canonicalFor(query));
  return [
    googlePlace(`${city} Museum of Art`, state, country, lat + 0.01, lng + 0.01, ["museum", "tourist_attraction"], 4.8, 5300),
    googlePlace(`${city} Historic District`, state, country, lat + 0.02, lng + 0.02, ["historical_landmark", "tourist_attraction"], 4.7, 2400),
    googlePlace(`${city} Botanical Garden`, state, country, lat + 0.03, lng + 0.03, ["botanical_garden", "park", "tourist_attraction"], 4.6, 1900),
    googlePlace(`${city} Food Hall`, state, country, lat + 0.04, lng + 0.04, ["restaurant", "cafe"], 4.5, 1300),
    googlePlace(`${city} Performing Arts Center`, state, country, lat + 0.05, lng + 0.05, ["performing_arts_theater", "tourist_attraction"], 4.6, 1500),
    googlePlace(`${city} Nearby State Park`, state, country, lat + 0.25, lng + 0.25, ["park", "tourist_attraction"], 4.8, 3000)
  ];
}

function googlePlace(name, state, country, lat, lng, types, rating = 4.5, userRatingCount = 500) {
  return {
    id: `place-${slug(name)}`,
    displayName: { text: name },
    formattedAddress: `${name}, ${state}, ${country}`,
    location: { latitude: lat, longitude: lng },
    addressComponents: [
      { longText: name.split(" ")[0], shortText: name.split(" ")[0], types: ["locality"] },
      { longText: state, shortText: state.slice(0, 2).toUpperCase(), types: ["administrative_area_level_1"] },
      { longText: country, shortText: country === "United States" ? "US" : country.slice(0, 2).toUpperCase(), types: ["country"] }
    ],
    types,
    rating,
    userRatingCount,
    editorialSummary: { text: `${name} is a legitimate visitor-friendly place.` }
  };
}

function canonicalFor(input) {
  const text = String(input || "").toLowerCase();
  if (text.includes("austin")) return "Austin, Texas, United States";
  if (text.includes("houston")) return "Houston, Texas, United States";
  if (text.includes("charlotte")) return "Charlotte, North Carolina, United States";
  if (text.includes("dallas")) return "Dallas, Texas, United States";
  if (text.includes("detroit")) return "Detroit, Michigan, United States";
  return "Raleigh, North Carolina, United States";
}

function requestBody(options) {
  return JSON.parse(options.body || "{}");
}

function googleError(status, googleStatus, message) {
  return mockJson({ error: { status: googleStatus, message } }, status);
}

function mockJson(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function captureEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PLACE_PROVIDER: process.env.PLACE_PROVIDER,
    ROUTE_PROVIDER: process.env.ROUTE_PROVIDER,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    PROVIDER_TIMEOUT_MS: process.env.PROVIDER_TIMEOUT_MS
  };
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
