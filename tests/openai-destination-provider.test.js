import assert from "node:assert/strict";
import { handlePlannerAction } from "../server/lib/planner-actions.js";
import { openAiSmokeCheck } from "../server/lib/openai-destination-provider.js";
import { providerConfig, providerStatus } from "../server/lib/env.js";

const originalFetch = globalThis.fetch;
const originalEnv = captureEnv();
const secret = "openai-secret-value";

process.env.NODE_ENV = "production";
process.env.VERCEL_ENV = "production";
process.env.PLACE_PROVIDER = "openrouteservice";
process.env.ROUTE_PROVIDER = "openrouteservice";
process.env.OPENROUTESERVICE_API_KEY = "ors-secret";
process.env.AI_PROVIDER = "openai";
process.env.OPENAI_API_KEY = secret;
process.env.AI_MODEL = "gpt-5-mini";

setHappyOpenAiFetch();

function setHappyOpenAiFetch() {
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.openai.com") {
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      const request = JSON.parse(options.body);
      assert.equal(request.model, "gpt-5-mini");
      if (request.text?.format?.name === "route_mosaic_destination_profile") {
        return mockJson({ output_text: JSON.stringify(parisProfile()) });
      }
      return mockJson({ output_text: JSON.stringify({ ok: true, provider: "openai" }) });
    }
    return mockJson({ features: [locationFeature("Paris", "Ile-de-France", "France", 2.3522, 48.8566)] });
  };
}

try {
  const status = providerStatus({
    production: true,
    development: false,
    placeProvider: "openrouteservice",
    routeProvider: "openrouteservice",
    openRouteServiceApiKey: "ors-secret",
    placeApiKey: "",
    routeApiKey: "",
    weatherProvider: "",
    weatherApiKey: "",
    aiProvider: "openai",
    aiApiKey: secret,
    aiModel: "gpt-5-mini"
  });
  assert.equal(status.canGenerate, true);
  assert.equal(status.aiProvider.status, "available");
  assert.equal(JSON.stringify(status).includes(secret), false);
  process.env.AI_PROVIDER = " OPENAI ";
  assert.equal(providerConfig().aiProvider, "openai");
  process.env.AI_PROVIDER = "openai";
  assert.equal(providerStatus({ ...baseConfig(), aiApiKey: "" }).aiProvider.configured, false);
  assert.equal(providerStatus({ ...baseConfig(), aiProvider: "not-openai" }).canGenerate, false);

  const smoke = await openAiSmokeCheck(baseConfig());
  assert.equal(smoke.ok, true);
  assert.equal(smoke.model, "gpt-5-mini");
  assert.equal(smoke.httpStatus, 200);

  await assertOpenAiSmokeFailure(401, "invalid_api_key", "Incorrect API key provided.", "AI_AUTH_FAILED");
  await assertOpenAiSmokeFailure(401, "invalid_api_key", "This API key has been revoked.", "AI_AUTH_FAILED");
  await assertOpenAiSmokeFailure(403, "permission_denied", "You do not have access to this project.", "AI_PERMISSION_DENIED");
  await assertOpenAiSmokeFailure(404, "model_not_found", "The model does not exist.", "AI_MODEL_UNAVAILABLE");
  await assertOpenAiSmokeFailure(400, "invalid_request_error", "The model is unsupported.", "AI_MODEL_UNAVAILABLE");
  await assertOpenAiSmokeFailure(400, "invalid_request_error", "Invalid schema for response_format.", "AI_INVALID_REQUEST");
  await assertOpenAiSmokeFailure(429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details.", "AI_QUOTA_EXCEEDED");
  await assertOpenAiSmokeFailure(429, "rate_limit_exceeded", "Rate limit reached.", "AI_RATE_LIMITED");
  await assertOpenAiSmokeFailure(500, "server_error", "Server error.", "AI_PROVIDER_UNAVAILABLE");
  await assertOpenAiMalformedResponse();
  await assertOpenAiTimeout();
  setHappyOpenAiFetch();

  const trip = {
    from: "Charlotte, North Carolina, United States",
    fromDisplay: "Charlotte, North Carolina, United States",
    destination: "Paris, France",
    destinationDisplay: "Paris, France",
    destinationLocation: {
      canonicalName: "Paris, France",
      latitude: 48.8566,
      longitude: 2.3522,
      country: "France",
      stateOrProvince: "Ile-de-France"
    },
    startDate: "2026-09-10",
    endDate: "2026-09-14",
    days: 5,
    adults: 2,
    children: 0,
    seniors: 0,
    groupType: "Couple trip",
    transportation: "Fly and rent a car",
    schedule: { pace: "Balanced", majorActivities: 2 },
    food: { diet: [], restrictions: [], cuisineInterests: ["French", "Local cuisine"], eveningPreferences: [] },
    travelers: [
      { id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" },
      { id: "traveler-2", name: "Traveler 2", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }
    ]
  };
  const research = await handlePlannerAction("research-destination", { trip }, { requestId: "test-paris-ai-research" });
  assert.equal(research.status, 200);
  assert.equal(research.body.profile.sourceMetadata.provider, "openai");
  const profileText = JSON.stringify(research.body.profile);
  ["Eiffel Tower", "Louvre Museum", "Montmartre", "Le Marais", "Versailles"].forEach((item) => assert.ok(profileText.includes(item), `AI Paris profile should include ${item}`));
  assert.equal(profileText.includes(secret), false);

  const generated = await handlePlannerAction("generate-trip", { trip, destinationProfile: research.body.profile }, { requestId: "test-paris-ai-generate" });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.status, "ready");
  const planText = JSON.stringify(generated.body.plan);
  ["Paris", "Eiffel Tower", "Louvre Museum", "Versailles"].forEach((item) => assert.ok(planText.includes(item), `AI Paris plan should include ${item}`));
  assert.equal(planText.includes("Dallas"), false);
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv(originalEnv);
}

console.log("OpenAI destination provider tests passed");

function baseConfig() {
  return {
    production: true,
    development: false,
    placeProvider: "google",
    routeProvider: "google",
    googleMapsApiKey: "google-secret",
    openRouteServiceApiKey: "",
    placeApiKey: "",
    routeApiKey: "",
    weatherProvider: "",
    weatherApiKey: "",
    aiProvider: "openai",
    aiApiKey: secret,
    aiModel: "gpt-5-mini",
    timeoutMs: 10000
  };
}

async function assertOpenAiSmokeFailure(status, code, message, expectedCode) {
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(new URL(String(url)).hostname, "api.openai.com");
    assert.equal(String(url).includes(secret), false);
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    return mockJson({ error: { code, type: code, message } }, status);
  };
  await assert.rejects(() => openAiSmokeCheck(baseConfig()), (error) => {
    assert.equal(error.code, expectedCode);
    assert.equal(error.status, status);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
  setHappyOpenAiFetch();
}

async function assertOpenAiMalformedResponse() {
  globalThis.fetch = async () => mockJson({ output_text: "{not-json" });
  await assert.rejects(() => openAiSmokeCheck(baseConfig()), (error) => {
    assert.equal(error.code, "AI_INVALID_RESPONSE");
    assert.equal(error.status, 502);
    return true;
  });
}

async function assertOpenAiTimeout() {
  globalThis.fetch = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };
  await assert.rejects(() => openAiSmokeCheck(baseConfig()), (error) => {
    assert.equal(error.code, "AI_TIMEOUT");
    assert.equal(error.status, 408);
    return true;
  });
}

function parisProfile() {
  const regions = [
    region("central-paris", "Central Paris and the Seine"),
    region("louvre-tuileries", "Louvre and Tuileries"),
    region("eiffel-invalides", "Eiffel Tower and Invalides"),
    region("montmartre", "Montmartre"),
    region("le-marais", "Le Marais"),
    region("latin-quarter", "Latin Quarter and Saint-Germain"),
    region("versailles", "Versailles day trip"),
    region("canal-saint-martin", "Canal Saint-Martin")
  ];
  const places = [
    place("eiffel-tower", "Eiffel Tower", "eiffel-invalides", 98),
    place("louvre", "Louvre Museum", "louvre-tuileries", 97),
    place("musee-orsay", "Musee d'Orsay", "louvre-tuileries", 92),
    place("notre-dame", "Notre-Dame and Ile de la Cite", "central-paris", 88),
    place("seine-walk", "Seine river walk", "central-paris", 84),
    place("montmartre-walk", "Montmartre and Sacre-Coeur", "montmartre", 93),
    place("le-marais", "Le Marais neighborhood", "le-marais", 90),
    place("latin-quarter", "Latin Quarter and Luxembourg Gardens", "latin-quarter", 86),
    place("versailles", "Palace of Versailles", "versailles", 95, "full-day", 300),
    place("canal", "Canal Saint-Martin evening", "canal-saint-martin", 78),
    place("arc", "Arc de Triomphe and Champs-Elysees", "eiffel-invalides", 82),
    place("sainte-chapelle", "Sainte-Chapelle", "central-paris", 80),
    restaurant("cafe-de-flore", "Cafe de Flore", "latin-quarter", ["breakfast", "lunch"]),
    restaurant("du-pain-et-des-idees", "Du Pain et des Idees", "central-paris", ["breakfast"]),
    restaurant("chez-janou", "Chez Janou", "le-marais", ["lunch", "dinner"]),
    restaurant("breizh-cafe", "Breizh Cafe", "le-marais", ["lunch"]),
    restaurant("le-bouillon-pigalle", "Le Bouillon Pigalle", "montmartre", ["dinner"]),
    restaurant("septime", "Septime", "canal-saint-martin", ["dinner"]),
    restaurant("bistrot-paul-bert", "Bistrot Paul Bert", "latin-quarter", ["dinner"]),
    restaurant("angelina", "Angelina Rivoli", "central-paris", ["breakfast", "lunch"])
  ];
  return {
    canonicalName: "Paris, France",
    aliases: ["paris", "paris france"],
    country: "France",
    state: "Ile-de-France",
    timezone: "Europe/Paris",
    currency: "EUR",
    summary: "Paris plan with landmark museums, Seine walks, neighborhoods, food districts, and nearby Versailles.",
    seasonalNotes: ["Reserve major museums ahead.", "Keep weather backups for rainy days."],
    generalAdvisories: ["Verify hours, strikes, closures, and ticketing directly."],
    planningRules: { defaultHotelRegion: "central-paris" },
    regions,
    places,
    foodAreas: [
      food("central-food", "Central Paris cafes", "central-paris"),
      food("marais-food", "Le Marais dining", "le-marais"),
      food("latin-food", "Latin Quarter bistros", "latin-quarter"),
      food("montmartre-food", "Montmartre cafes", "montmartre"),
      food("canal-food", "Canal Saint-Martin casual dining", "canal-saint-martin"),
      food("versailles-food", "Versailles lunch area", "versailles")
    ],
    scenicRoutes: [
      route("seine-louvre", "Seine to Louvre walk", "central-paris", "louvre-tuileries"),
      route("eiffel-invalides", "Eiffel Tower to Invalides", "eiffel-invalides", "central-paris"),
      route("marais-latin", "Le Marais to Latin Quarter", "le-marais", "latin-quarter"),
      route("paris-versailles", "Paris to Versailles", "central-paris", "versailles", 55, 16),
      route("montmartre-canal", "Montmartre to Canal Saint-Martin", "montmartre", "canal-saint-martin")
    ]
  };
}

function region(id, name) {
  return { id, name, summary: `${name} planning area.`, centerCoordinates: null, tags: ["culture"], neighboringRegionIds: [] };
}

function place(id, name, regionId, priorityScore, bestTimeOfDay = "afternoon", duration = 120) {
  return {
    id,
    name,
    regionId,
    shortDescription: `${name} is a Paris planning anchor.`,
    categories: ["culture", "landmark"],
    tags: ["Museums", "Local culture"],
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: 60,
    maximumDurationMinutes: duration + 90,
    estimatedCostLow: 0,
    estimatedCostHigh: 50,
    indoorOutdoor: "mixed",
    weatherDependency: "medium",
    accessibility: "moderate",
    dietaryRelevance: [],
    openingTimeGuidance: "Confirm current hours before travel.",
    bestTimeOfDay,
    reservationRecommended: true,
    seasonalNotes: [],
    conflictTags: [],
    priorityScore,
    coordinates: null,
    backupForTags: []
  };
}

function restaurant(id, name, regionId, mealTypes) {
  return {
    ...place(id, name, regionId, 75, mealTypes.includes("breakfast") ? "morning" : "dinner", 60),
    categories: ["restaurant", "food"],
    tags: ["restaurant", ...mealTypes, "local dining"],
    indoorOutdoor: "indoor",
    weatherDependency: "low",
    estimatedCostLow: 12,
    estimatedCostHigh: 45,
    dietaryRelevance: ["confirm dietary needs directly"]
  };
}

function food(id, name, regionId) {
  return { id, name, regionId, cuisines: ["French", "Local cuisine", "Cafes"], mealTypes: ["breakfast", "lunch", "dinner"], budgetLevels: ["budget", "moderate"], dietarySupport: ["Vegetarian"], eveningSuitability: ["quiet"], shortDescription: `${name}.` };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes = 20, estimatedDistanceMiles = 5) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags: ["culture"], bestTimeOfDay: "afternoon", notes: "Verify route conditions." };
}

function locationFeature(city, regionName, country, longitude, latitude) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [longitude, latitude] }, properties: { name: city, locality: city, region: regionName, country, layer: "locality" } };
}

function mockJson(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function captureEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    PLACE_PROVIDER: process.env.PLACE_PROVIDER,
    ROUTE_PROVIDER: process.env.ROUTE_PROVIDER,
    OPENROUTESERVICE_API_KEY: process.env.OPENROUTESERVICE_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_MODEL: process.env.AI_MODEL
  };
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
