import { registerGeneratedDestinationProfile } from "../../src/destination-data.js?v=52";
import { compatibleAlternatives, generateTripPlan, regenerateDay, regenerateMeals, regeneratePlanPreservingLocks } from "../../src/planner.js?v=52";
import { providerConfig, validatePlanningProviders } from "./env.js";
import { mockDestinationResearch, mockRouteEstimate } from "./mock-provider.js";
import { withTimeout } from "./http.js";

export async function handlePlannerAction(action, payload = {}) {
  switch (action) {
    case "research-destination":
    case "destination-profile":
    case "destinations/research":
      return handleDestinationResearch(payload);
    case "generate-trip":
      return handleTripGeneration(payload);
    case "regenerate-plan":
      return handleRegeneratePlan(payload);
    case "regenerate-day":
      return handleRegenerateDay(payload);
    case "regenerate-meals":
      return handleRegenerateMeals(payload);
    case "get-alternatives":
    case "replace-activity":
      return handleActivityAlternatives(payload);
    case "estimate-route":
      return handleRouteEstimate(payload);
    case "weather-summary":
      return handleWeatherSummary(payload);
    default:
      return actionError(400, "UNKNOWN_ACTION", "Unknown planner action.");
  }
}

async function handleDestinationResearch({ trip } = {}) {
  const config = providerConfig();
  const errors = validatePlanningProviders(config);
  if (config.production && errors.length) {
    return actionError(503, "PROVIDER_CONFIGURATION_REQUIRED", "Trip generation is temporarily unavailable. Please try again later.", true);
  }
  const destination = String(trip?.destinationDisplay || trip?.destination || "").trim();
  if (!destination) return actionError(400, "DESTINATION_REQUIRED", "Destination is required.");
  try {
    const profile = await withTimeout(researchDestination(destination, trip, config), config.timeoutMs, "Destination research");
    return {
      status: 200,
      body: {
        profile,
        diagnostics: {
          provider: config.placeProvider,
          routeProvider: config.routeProvider,
          generatedAt: new Date().toISOString(),
          candidateCount: profile.places.length,
          cache: "miss"
        }
      }
    };
  } catch {
    return actionError(502, "DESTINATION_RESEARCH_FAILED", "Destination research failed. Please retry.", true);
  }
}

function handleTripGeneration({ trip, destinationProfile, variationSeed = 0 } = {}) {
  if (!trip) return actionError(400, "TRIP_REQUIRED", "Trip is required.");
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  const result = generateTripPlan(trip, { variationSeed });
  return { status: result.status === "ready" ? 200 : 422, body: result };
}

function handleRegeneratePlan({ plan } = {}) {
  if (!plan) return actionError(400, "PLAN_REQUIRED", "Plan is required.");
  return { status: 200, body: { status: "ready", plan: regeneratePlanPreservingLocks(plan) } };
}

function handleRegenerateDay({ plan, dayId, destinationProfile } = {}) {
  if (!plan || !dayId) return actionError(400, "PLAN_DAY_REQUIRED", "Plan and dayId are required.");
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  return { status: 200, body: { plan: regenerateDay(plan, dayId) } };
}

function handleRegenerateMeals({ plan, destinationProfile } = {}) {
  if (!plan) return actionError(400, "PLAN_REQUIRED", "Plan is required.");
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  return { status: 200, body: { plan: regenerateMeals(plan) } };
}

function handleActivityAlternatives({ plan, itemId, destinationProfile } = {}) {
  if (!plan || !itemId) return actionError(400, "PLAN_ITEM_REQUIRED", "Plan and itemId are required.");
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  return { status: 200, body: { alternatives: compatibleAlternatives(plan, itemId) } };
}

async function handleRouteEstimate({ origin, destination, mode = "driving" } = {}) {
  const config = providerConfig();
  if (config.production && validatePlanningProviders(config).some((error) => error.startsWith("Route provider:"))) {
    return actionError(503, "PROVIDER_CONFIGURATION_REQUIRED", "Trip generation is temporarily unavailable. Please try again later.", true);
  }
  if (!origin || !destination) return actionError(400, "ROUTE_POINTS_REQUIRED", "Origin and destination are required.");
  try {
    const estimate = await withTimeout(estimateRoute(origin, destination, mode, config), config.timeoutMs, "Route estimate");
    return { status: 200, body: { estimate } };
  } catch {
    return actionError(502, "ROUTE_ESTIMATE_FAILED", "Route estimate failed. Please retry.", true);
  }
}

function handleWeatherSummary({ destination = "", startDate = "", endDate = "" } = {}) {
  const config = providerConfig();
  if (!destination) return actionError(400, "DESTINATION_REQUIRED", "Destination is required.");
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
  return actionError(501, "PROVIDER_NOT_IMPLEMENTED", "Live weather guidance is not available yet.", true);
}

async function researchDestination(destination, trip, config) {
  if (config.placeProvider === "mock") return mockDestinationResearch(destination, trip);
  throw new Error("Place provider is not implemented in this build.");
}

async function estimateRoute(origin, destination, mode, config) {
  if (config.routeProvider === "mock") return mockRouteEstimate(origin, destination, mode);
  if (config.routeProvider === "approximate") {
    const estimate = mockRouteEstimate(origin, destination, mode);
    return { ...estimate, provider: "coordinate-approximation", disclaimer: "Coordinate-based approximation, not live route data." };
  }
  throw new Error("Route provider is not implemented in this build.");
}

function actionError(status, code, message, retryable = false) {
  return { status, body: { success: false, error: { code, message, retryable } } };
}
