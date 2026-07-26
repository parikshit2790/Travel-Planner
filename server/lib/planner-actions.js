import { registerGeneratedDestinationProfile, resolveDestinationProfile } from "../../src/destination-data.js";
import { createTripDraft, migrateTripState, syncTravelersToCounts } from "../../src/domain.js";
import { compatibleAlternatives, generateTripPlan, regenerateDay, regenerateMeals, regeneratePlanPreservingLocks } from "../../src/planner.js";
import { providerConfig, validatePlanningProviders } from "./env.js";
import { googleDestinationResearch, googleRouteEstimate } from "./google-provider.js";
import { hasMockDestinationData, mockDestinationResearch, mockRouteEstimate } from "./mock-provider.js";
import { openAiDestinationResearch } from "./openai-destination-provider.js";
import { openRouteServiceDestinationResearch, openRouteServiceRouteEstimate } from "./openrouteservice-provider.js";
import { withTimeout } from "./http.js";
import { destinationResearchCacheKey, getCachedDestinationResearch } from "./destination-cache.js";

export async function handlePlannerAction(action, payload = {}, context = {}) {
  const requestId = context.requestId || requestIdFor("planner");
  switch (action) {
    case "research-destination":
    case "destination-profile":
    case "destinations/research":
      return handleDestinationResearch(payload, { requestId });
    case "generate-trip":
      return handleTripGeneration(payload, { requestId });
    case "regenerate-plan":
      return handleRegeneratePlan(payload, { requestId });
    case "regenerate-day":
      return handleRegenerateDay(payload, { requestId });
    case "regenerate-meals":
      return handleRegenerateMeals(payload, { requestId });
    case "get-alternatives":
    case "replace-activity":
      return handleActivityAlternatives(payload, { requestId });
    case "estimate-route":
      return handleRouteEstimate(payload, { requestId });
    case "weather-summary":
      return handleWeatherSummary(payload, { requestId });
    default:
      return actionError(400, "UNKNOWN_ACTION", "Unknown planner action.", false, requestId);
  }
}

async function handleDestinationResearch({ trip } = {}, { requestId } = {}) {
  const startedAt = Date.now();
  const config = providerConfig();
  const errors = validatePlanningProviders(config);
  if (config.production && errors.length) {
    return actionError(503, "PROVIDER_CONFIGURATION_REQUIRED", "Trip generation is temporarily unavailable. Please try again later.", true, requestId);
  }
  const destination = String(trip?.destinationDisplay || trip?.destination || "").trim();
  if (!destination) return actionError(400, "DESTINATION_REQUIRED", "Destination is required.", false, requestId);
  if (config.placeProvider === "mock" && !hasMockDestinationData(destination)) {
    logPlannerEvent({ requestId, action: "research-destination", mode: "mock", stage: "blocked", destination, errorCode: "MOCK_DESTINATION_UNAVAILABLE", durationMs: Date.now() - startedAt });
    return actionError(422, "MOCK_DESTINATION_UNAVAILABLE", "This destination is not available in the current demo data. Try the Los Angeles sample or configure live providers.", false, requestId);
  }
  try {
    logPlannerEvent({ requestId, action: "research-destination", mode: config.placeProvider === "mock" || config.routeProvider === "mock" ? "mock" : "live", stage: "start", destination });
    const key = destinationResearchCacheKey(destination, trip, config);
    const { profile, cacheStatus } = await withTimeout(
      getCachedDestinationResearch(key, () => researchDestination(destination, trip, config), { ttlSeconds: config.cacheTtlSeconds }),
      config.plannerRequestTimeoutMs,
      "Destination research",
      "PLANNER_TIMEOUT",
      504
    );
    logPlannerEvent({ requestId, action: "research-destination", mode: config.placeProvider === "mock" || config.routeProvider === "mock" ? "mock" : "live", stage: "complete", destination, cacheStatus, candidateCount: profile.places?.length || 0, durationMs: Date.now() - startedAt });
    return {
      status: 200,
      body: {
        profile,
        ...(config.development ? { diagnostics: {
          provider: config.placeProvider,
          routeProvider: config.routeProvider,
          generatedAt: new Date().toISOString(),
          candidateCount: profile.places.length,
          cache: cacheStatus
        } } : {})
      }
    };
  } catch (error) {
    const code = destinationResearchCode(error);
    logPlannerEvent({ requestId, action: "research-destination", mode: config.placeProvider === "mock" || config.routeProvider === "mock" ? "mock" : "live", stage: "error", destination, errorCode: code, durationMs: Date.now() - startedAt });
    return actionError(statusForDestinationResearch(code), code, messageForDestinationResearch(code), code !== "MOCK_DESTINATION_UNAVAILABLE", requestId);
  }
}

function handleTripGeneration({ trip, destinationProfile, variationSeed = 0 } = {}, { requestId } = {}) {
  if (!trip) return actionError(400, "TRIP_REQUIRED", "Trip is required.", false, requestId);
  const config = providerConfig();
  const destination = String(trip.destinationDisplay || trip.destination || "").trim();
  if (config.placeProvider === "mock" && !destinationProfile && !hasMockDestinationData(destination)) {
    return actionError(422, "MOCK_DESTINATION_UNAVAILABLE", "This destination is not available in the current demo data. Try the Los Angeles sample or configure live providers.", false, requestId);
  }
  try {
    const normalizedTrip = normalizeTripForPlanning(trip);
    if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
    const result = generateTripPlan(normalizedTrip, { variationSeed });
    return { status: result.status === "ready" ? 200 : 422, body: result };
  } catch (error) {
    logPlannerEvent({ requestId, action: "generate-trip", mode: config.placeProvider === "mock" || config.routeProvider === "mock" ? "mock" : "live", stage: "error", destination, errorCode: "GENERATION_FAILED" });
    return actionError(500, "GENERATION_FAILED", "We could not build this trip.", true, requestId);
  }
}

function handleRegeneratePlan({ plan } = {}, { requestId } = {}) {
  if (!plan) return actionError(400, "PLAN_REQUIRED", "Plan is required.", false, requestId);
  return { status: 200, body: { status: "ready", plan: regeneratePlanPreservingLocks(plan) } };
}

function handleRegenerateDay({ plan, dayId, destinationProfile } = {}, { requestId } = {}) {
  if (!plan || !dayId) return actionError(400, "PLAN_DAY_REQUIRED", "Plan and dayId are required.", false, requestId);
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  return { status: 200, body: { plan: regenerateDay(plan, dayId) } };
}

function handleRegenerateMeals({ plan, destinationProfile } = {}, { requestId } = {}) {
  if (!plan) return actionError(400, "PLAN_REQUIRED", "Plan is required.", false, requestId);
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  return { status: 200, body: { plan: regenerateMeals(plan) } };
}

function handleActivityAlternatives({ plan, itemId, destinationProfile } = {}, { requestId } = {}) {
  if (!plan || !itemId) return actionError(400, "PLAN_ITEM_REQUIRED", "Plan and itemId are required.", false, requestId);
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  return { status: 200, body: { alternatives: compatibleAlternatives(plan, itemId) } };
}

async function handleRouteEstimate({ origin, destination, mode = "driving" } = {}, { requestId } = {}) {
  const config = providerConfig();
  if (config.production && validatePlanningProviders(config).some((error) => error.startsWith("Route provider:"))) {
    return actionError(503, "PROVIDER_CONFIGURATION_REQUIRED", "Trip generation is temporarily unavailable. Please try again later.", true, requestId);
  }
  if (!origin || !destination) return actionError(400, "ROUTE_POINTS_REQUIRED", "Origin and destination are required.", false, requestId);
  try {
    const estimate = await withTimeout(estimateRoute(origin, destination, mode, config), config.googleRequestTimeoutMs, "Route estimate", "ROUTE_TIMEOUT", 504);
    return { status: 200, body: { estimate } };
  } catch (error) {
    const code = routeErrorCode(error);
    if (code === "OPENROUTESERVICE_RATE_LIMITED") {
      return actionError(429, "PROVIDER_RATE_LIMITED", "Trip planning services are temporarily busy. Please retry.", true, requestId);
    }
    if (["GOOGLE_TIMEOUT", "ROUTE_TIMEOUT", "REQUEST_TIMEOUT"].includes(code)) {
      return actionError(504, "ROUTE_TIMEOUT", "Route estimation took too long. Please retry.", true, requestId);
    }
    return actionError(502, "ROUTE_ESTIMATE_FAILED", "We found destination ideas, but could not calculate reliable travel times.", true, requestId);
  }
}

function handleWeatherSummary({ destination = "", startDate = "", endDate = "" } = {}, { requestId } = {}) {
  const config = providerConfig();
  if (!destination) return actionError(400, "DESTINATION_REQUIRED", "Destination is required.", false, requestId);
  if (!config.weatherProvider) {
    return {
      status: 200,
      body: {
        guidance: {
          type: "seasonal",
          label: "Seasonal guidance only",
          summary: `Live weather is not configured. Recheck the forecast for ${destination} closer to ${startDate || "travel"}.`,
          startDate,
          endDate,
          provider: "none",
          retrievedAt: new Date().toISOString()
        }
      }
    };
  }
  return actionError(501, "PROVIDER_NOT_IMPLEMENTED", "Live weather guidance is not available yet.", true, requestId);
}

async function researchDestination(destination, trip, config) {
  if (config.aiProvider === "openai" && config.aiApiKey) {
    try {
      return await openAiDestinationResearch(destination, trip, config);
    } catch (error) {
      if (!config.placeProvider || config.placeProvider === "mock") throw error;
      console.warn("[RouteMosaic planner] AI destination research fallback", JSON.stringify({ code: error?.code || "AI_DESTINATION_RESEARCH_FAILED", destination: canonicalLogName(destination) }));
    }
  }
  if (config.placeProvider === "mock") return mockDestinationResearch(destination, trip);
  if (config.placeProvider === "google") return googleDestinationResearch(destination, trip, config);
  if (config.placeProvider === "openrouteservice") return openRouteServiceDestinationResearch(destination, trip, config);
  const curatedProfile = resolveDestinationProfile(destination);
  if (curatedProfile && !String(curatedProfile.id || "").startsWith("generic-")) {
    return {
      ...curatedProfile,
      sourceMetadata: {
        ...(curatedProfile.sourceMetadata || {}),
        provider: "curated",
        retrievedAt: new Date().toISOString(),
        freshness: "curated-local-profile"
      }
    };
  }
  throw new Error("Place provider is not implemented in this build.");
}

async function estimateRoute(origin, destination, mode, config) {
  if (config.routeProvider === "mock") return mockRouteEstimate(origin, destination, mode);
  if (config.routeProvider === "google") return googleRouteEstimate(origin, destination, mode, config);
  if (config.routeProvider === "openrouteservice") return openRouteServiceRouteEstimate(origin, destination, mode, config);
  if (config.routeProvider === "approximate") {
    const estimate = mockRouteEstimate(origin, destination, mode);
    return { ...estimate, provider: "coordinate-approximation", disclaimer: "Coordinate-based approximation, not live route data." };
  }
  throw new Error("Route provider is not implemented in this build.");
}

function actionError(status, code, message, retryable = false, requestId = requestIdFor("planner")) {
  return { status, body: { success: false, requestId, error: { code, message, retryable, requestId } } };
}

function requestIdFor(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function logPlannerEvent(event) {
  const safe = {
    requestId: event.requestId,
    action: event.action,
    mode: event.mode,
    stage: event.stage,
    origin: canonicalLogName(event.origin),
    destination: canonicalLogName(event.destination),
    candidateCount: event.candidateCount,
    routeCount: event.routeCount,
    cacheStatus: event.cacheStatus,
    errorCode: event.errorCode,
    durationMs: event.durationMs
  };
  console.info("[RouteMosaic planner]", JSON.stringify(Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== undefined && value !== ""))));
}

function canonicalLogName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function destinationResearchCode(error) {
  if (error?.code === "MOCK_DESTINATION_UNAVAILABLE") return "MOCK_DESTINATION_UNAVAILABLE";
  if (error?.code === "DESTINATION_RESEARCH_INSUFFICIENT") return "INSUFFICIENT_DESTINATION_DATA";
  if (["AI_TIMEOUT", "GOOGLE_TIMEOUT", "PLANNER_TIMEOUT"].includes(error?.code)) return error.code;
  if (error?.code === "OPENROUTESERVICE_RATE_LIMITED") return "PROVIDER_RATE_LIMITED";
  if (String(error?.message || "").toLowerCase().includes("timed out")) return "REQUEST_TIMEOUT";
  return "DESTINATION_RESEARCH_FAILED";
}

function statusForDestinationResearch(code) {
  if (code === "MOCK_DESTINATION_UNAVAILABLE" || code === "INSUFFICIENT_DESTINATION_DATA") return 422;
  if (code === "PROVIDER_RATE_LIMITED") return 429;
  if (["REQUEST_TIMEOUT", "AI_TIMEOUT", "GOOGLE_TIMEOUT", "PLANNER_TIMEOUT"].includes(code)) return 504;
  return 502;
}

function messageForDestinationResearch(code) {
  if (code === "MOCK_DESTINATION_UNAVAILABLE") return "This destination is not available in the current demo data. Try the Los Angeles sample or configure live providers.";
  if (code === "INSUFFICIENT_DESTINATION_DATA") return "We could not find enough reliable destination information for this trip.";
  if (code === "PROVIDER_RATE_LIMITED") return "Trip planning services are temporarily busy. Please retry.";
  if (code === "AI_TIMEOUT") return "Destination intelligence took too long. Please retry.";
  if (code === "GOOGLE_TIMEOUT") return "Map provider research took too long. Please retry.";
  if (code === "PLANNER_TIMEOUT" || code === "REQUEST_TIMEOUT") return "Trip generation took too long. Please retry.";
  return "Destination research failed. Please try again later.";
}

function routeErrorCode(error) {
  if (error?.code) return error.code;
  if (String(error?.message || "").toLowerCase().includes("timed out")) return "REQUEST_TIMEOUT";
  return "ROUTE_ESTIMATE_FAILED";
}

function normalizeTripForPlanning(trip) {
  const copy = mergePlainObjects(createTripDraft(), structuredClone(trip));
  migrateTripState(copy);
  syncTravelersToCounts(copy);
  return copy;
}

function mergePlainObjects(base, override) {
  if (!override || typeof override !== "object") return base;
  Object.entries(override).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      base[key] = value;
      return;
    }
    if (value && typeof value === "object" && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      base[key] = mergePlainObjects(base[key], value);
      return;
    }
    if (value !== undefined) base[key] = value;
  });
  return base;
}
