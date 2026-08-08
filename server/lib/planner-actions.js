import { registerGeneratedDestinationProfile } from "../../src/destination-data.js";
import { createTripDraft, migrateTripState, syncTravelersToCounts } from "../../src/domain.js";
import { compatibleAlternatives, generateTripPlan, regenerateDay, regenerateMeals, regeneratePlanPreservingLocks } from "../../src/planner.js";
import { providerConfig, validatePlanningProviders } from "./env.js";
import { discoverRegionalExtensions, googleDestinationResearch, googleRouteEstimate, resolveDestination } from "./google-provider.js";
import { hasMockDestinationData, mockDestinationResearch, mockRouteEstimate } from "./mock-provider.js";
import { openAiDestinationResearch } from "./openai-destination-provider.js";
import { openRouteServiceDestinationResearch, openRouteServiceRouteEstimate } from "./openrouteservice-provider.js";
import { withTimeout } from "./http.js";
import { destinationResearchCacheKey, getCachedDestinationResearch } from "./destination-cache.js";
import { assertProductionPlanningSafety, buildPlanningSourceDiagnostics } from "./production-safeguards.js";

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
  const destination = String(trip?.approvedTripShape?.primaryDestination || trip?.destinationDisplay || trip?.destination || "").trim();
  if (!destination) return actionError(400, "DESTINATION_REQUIRED", "Destination is required.", false, requestId);
  if (config.placeProvider === "mock" && !hasMockDestinationData(destination)) {
    logPlannerEvent({ requestId, action: "research-destination", mode: "mock", stage: "blocked", destination, errorCode: "MOCK_DESTINATION_UNAVAILABLE", durationMs: Date.now() - startedAt });
    return actionError(422, "MOCK_DESTINATION_UNAVAILABLE", "This destination is not available in the current demo data.", false, requestId);
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

async function handleTripGeneration({ trip, destinationProfile, variationSeed = 0 } = {}, { requestId } = {}) {
  if (!trip) return actionError(400, "TRIP_REQUIRED", "Trip is required.", false, requestId);
  const config = providerConfig();
  const destination = String(trip.destinationDisplay || trip.destination || "").trim();
  const providerErrors = validatePlanningProviders(config);
  if (config.production && providerErrors.length) {
    return actionError(503, "PROVIDER_CONFIGURATION_REQUIRED", "Trip generation is temporarily unavailable. Please try again later.", true, requestId);
  }
  if (config.production && !destinationProfile) {
    return actionError(422, "LIVE_DESTINATION_RESEARCH_REQUIRED", "We could not build a reliable live destination profile for this trip yet. Please retry.", true, requestId);
  }
  if (config.placeProvider === "mock" && !destinationProfile && !hasMockDestinationData(destination)) {
    return actionError(422, "MOCK_DESTINATION_UNAVAILABLE", "This destination is not available in the current demo data.", false, requestId);
  }
  try {
    const normalizedTrip = normalizeTripForPlanning(trip);
    if (normalizedTrip.approvedTripShape?.primaryDestination) {
      normalizedTrip.destination = normalizedTrip.approvedTripShape.primaryDestination;
      normalizedTrip.destinationDisplay = normalizedTrip.approvedTripShape.primaryDestination;
    }
    const registeredProfile = destinationProfile ? registerGeneratedDestinationProfile(destinationProfile) : null;
    const sourceDiagnostics = buildPlanningSourceDiagnostics(config, registeredProfile);
    assertProductionPlanningSafety(config, registeredProfile, sourceDiagnostics);
    if (shouldRequireArrivalRoute(normalizedTrip, registeredProfile, config) && !normalizedTrip.arrivalRouteEstimate) {
      normalizedTrip.arrivalRouteEstimate = await estimateArrivalRouteForGeneration(normalizedTrip, registeredProfile, config);
      normalizedTrip.routeQualityRequired = true;
    }
    const result = generateTripPlan(normalizedTrip, { variationSeed, sourceDiagnostics, destinationProfileId: registeredProfile?.id });
    if (result?.plan?.generationMetadata) {
      result.plan.generationMetadata.sourceDiagnostics = sourceDiagnostics;
    }
    if (result.status === "quality-rejected") {
      const critique = result.plan?.generationMetadata?.qualityCritique;
      logPlannerEvent({
        requestId,
        action: "generate-trip",
        mode: config.placeProvider === "mock" || config.routeProvider === "mock" ? "mock" : "live",
        stage: "quality-rejected",
        destination,
        errorCode: "PLAN_QUALITY_REJECTED",
        candidateCount: result.plan?.generationMetadata?.opportunityGraph?.nodeCount
      });
      return actionError(422, "PLAN_QUALITY_REJECTED", planRejectionMessage(critique, result.errors || []), true, requestId);
    }
    return { status: result.status === "ready" ? 200 : 422, body: result };
  } catch (error) {
    const code = error?.code || "GENERATION_FAILED";
    logPlannerEvent({ requestId, action: "generate-trip", mode: config.placeProvider === "mock" || config.routeProvider === "mock" ? "mock" : "live", stage: "error", destination, errorCode: code });
    return actionError(error?.status || 500, code, error?.message || "We could not build this trip.", error?.retryable ?? true, requestId);
  }
}

export function planRejectionMessage(critique, errors) {
  const hardFailures = critique?.hardFailures || [];
  const criticPassed = Boolean(critique?.pass);
  const nonCriticBlockers = errors.filter((item) => !String(item?.id || "").startsWith("quality-critic-"));
  if (hardFailures.length) {
    return `We found a strong itinerary structure, but it failed a required quality check (${hardFailures.join(", ")}). Please retry; if this keeps happening, try a shorter trip or fewer must-have places.`;
  }
  if (!criticPassed) {
    return `We could not build a reliable itinerary for this trip yet (it scored ${critique?.score ?? 0} out of a required ${critique?.threshold ?? 85}). Please retry; if this keeps happening, try a shorter trip or fewer must-have places.`;
  }
  if (nonCriticBlockers.length) {
    return `We found a strong itinerary, but one or more required trip constraints could not be satisfied (${nonCriticBlockers.map((item) => item.title || item.id).join(", ")}). Please retry, or adjust the trip and try again.`;
  }
  return "We could not build a reliable itinerary for this trip yet. Please retry.";
}

function shouldRequireArrivalRoute(trip, profile, config) {
  if (!profile) return false;
  const transportText = `${trip.transportation || ""} ${trip.transport?.mode || ""}`.toLowerCase();
  const driving = /drive|car|rent/.test(transportText) && !/fly/.test(transportText);
  const origin = String(trip.fromDisplay || trip.from || "").trim().toLowerCase();
  const destination = String(trip.destinationDisplay || trip.destination || profile.canonicalName || "").trim().toLowerCase();
  return Boolean(driving && origin && destination && origin !== destination && config.production);
}

async function estimateArrivalRouteForGeneration(trip, profile, config) {
  const origin = routePointFor(trip.fromLocation, trip.fromDisplay || trip.from);
  const destination = routePointFor(trip.destinationLocation, trip.destinationDisplay || trip.destination || profile.canonicalName);
  try {
    const estimate = await withTimeout(estimateRoute(origin, destination, "driving", config), config.googleRequestTimeoutMs, "Route estimate", "ROUTE_TIMEOUT", 504);
    return {
      durationMinutes: Number(estimate.durationMinutes || estimate.estimatedDurationMinutes || 0),
      distanceMiles: Number(estimate.distanceMiles || estimate.estimatedDistanceMiles || 0),
      provider: estimate.provider || config.routeProvider || "route-provider",
      checkedAt: estimate.checkedAt || estimate.retrievedAt || new Date().toISOString(),
      confidence: estimate.confidence || "provider"
    };
  } catch (error) {
    const wrapped = new Error("We found destination ideas, but could not calculate reliable travel times.");
    wrapped.code = routeErrorCode(error);
    wrapped.status = ["ROUTE_TIMEOUT", "REQUEST_TIMEOUT", "GOOGLE_TIMEOUT"].includes(wrapped.code) ? 504 : 502;
    wrapped.retryable = true;
    throw wrapped;
  }
}

function routePointFor(location, fallback) {
  if (location?.latitude && location?.longitude) {
    return { label: location.canonicalName || fallback || "", latitude: Number(location.latitude), longitude: Number(location.longitude) };
  }
  return fallback || "";
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
  let profile;
  if (config.aiProvider === "openai" && config.aiApiKey) {
    try {
      profile = await openAiDestinationResearch(destination, trip, config);
    } catch (error) {
      if (!config.placeProvider || config.placeProvider === "mock") throw error;
      console.warn("[RouteMosaic planner] AI destination research fallback", JSON.stringify({ code: error?.code || "AI_DESTINATION_RESEARCH_FAILED", destination: canonicalLogName(destination) }));
    }
  }
  if (!profile) {
    if (config.placeProvider === "mock") return mockDestinationResearch(destination, trip);
    if (config.placeProvider === "google") profile = await googleDestinationResearch(destination, trip, config);
    else if (config.placeProvider === "openrouteservice") return openRouteServiceDestinationResearch(destination, trip, config);
    else throw new Error("Place provider is not implemented in this build.");
  }
  return addRegionalExtensions(profile, trip, config);
}

async function addRegionalExtensions(profile, trip, config) {
  // Bases the traveler explicitly approved in Trip Shape (e.g. "Osaka" in an
  // approved "Tokyo -> Osaka" route) must be researched regardless of what the
  // AI itself suggested as regional candidates -- an approved base is a
  // requirement, not a same-day-drive-comfort suggestion.
  const approvedCities = (trip?.approvedTripShape?.hotelBases || []).slice(1).map((base) => base.canonicalName).filter(Boolean);
  const suggestedCities = profile.regionalDestinationProfile?.regionalCandidateCities || [];
  const candidateCities = [...new Set([...approvedCities, ...suggestedCities])];
  const tripDays = Number(trip?.days || trip?.numberOfDays || 0);
  const hasGoogleAccess = Boolean(config.googleMapsApiKey || config.placeApiKey);
  if (!candidateCities.length || tripDays < 4 || !hasGoogleAccess) return profile;
  try {
    const primaryLocation = await resolveDestination(profile.canonicalName, config);
    if (!primaryLocation) return profile;
    // An approved overnight base is reached once (by whatever transport mode fits
    // the trip -- often rail or air for international multi-city routes), not
    // driven to and from on the same day, so it must not be filtered out by the
    // traveler's day-trip driving-comfort preference.
    const maxDriveMinutes = approvedCities.length
      ? Math.max(600, Number(trip?.transport?.maxDrivingDay) > 0 ? Number(trip.transport.maxDrivingDay) * 60 : 0)
      : Number(trip?.transport?.maxDrivingDay) > 0 ? Number(trip.transport.maxDrivingDay) * 60 : 240;
    const interestLabels = [
      ...(trip?.preferences || []).map((item) => item?.label || item),
      ...(trip?.activity?.hiking ? [trip.activity.hiking] : [])
    ].filter(Boolean);
    const extensions = await discoverRegionalExtensions(
      { latitude: primaryLocation.latitude, longitude: primaryLocation.longitude },
      candidateCities,
      interestLabels,
      config,
      { maxDriveMinutes, maxCandidates: Math.max(2, approvedCities.length) }
    );
    return mergeRegionalExtensionsIntoProfile(profile, extensions);
  } catch (error) {
    console.warn("[RouteMosaic planner] Regional extension discovery skipped", JSON.stringify({ code: error?.code || "REGIONAL_EXTENSION_FAILED" }));
    return profile;
  }
}

export function mergeRegionalExtensionsIntoProfile(profile, extensions) {
  if (!extensions.length) return profile;
  const baseRegionId = profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id;
  const merged = { ...profile, regions: [...profile.regions], places: [...profile.places], foodAreas: [...profile.foodAreas], scenicRoutes: [...profile.scenicRoutes] };
  extensions.forEach((extension) => {
    const regionId = `regional-ext-${slug(extension.canonicalName)}`;
    const isOvernightScale = extension.route.durationMinutes >= 90;
    merged.regions.push({
      id: regionId,
      name: extension.canonicalName,
      summary: `Regional extension about ${Math.round(extension.route.durationMinutes / 60 * 10) / 10} hours (${Math.round(extension.route.distanceMiles)} miles) from ${profile.canonicalName}.`,
      centerCoordinates: extension.centerCoordinates,
      tags: ["regional", isOvernightScale ? "overnight-extension" : "day-trip"],
      neighboringRegionIds: baseRegionId ? [baseRegionId] : [],
      typicalTravelMinutesToRegions: {}
    });
    extension.places.forEach((place) => {
      merged.places.push({
        ...place,
        id: `regional-${regionId}-${place.id}`,
        regionId,
        categories: [...place.categories, isOvernightScale ? "overnight-extension" : "day-trip", "regional"],
        tags: [...place.tags, "Regional extension"]
      });
    });
    extension.foodAreas.forEach((area) => {
      merged.foodAreas.push({ ...area, id: `regional-${regionId}-${area.id}`, regionId });
    });
    if (baseRegionId) {
      merged.scenicRoutes.push({
        id: `regional-route-${regionId}`,
        name: `${profile.canonicalName} to ${extension.canonicalName}`,
        originRegionId: baseRegionId,
        destinationRegionId: regionId,
        estimatedDriveMinutes: Math.round(extension.route.durationMinutes),
        estimatedDistanceMiles: Math.round(extension.route.distanceMiles),
        tags: ["regional", "measured-route"],
        bestTimeOfDay: "morning",
        notes: "Drive time measured from live route data; verify traffic before departure."
      });
    }
  });
  return merged;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "region";
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
  if (code === "MOCK_DESTINATION_UNAVAILABLE") return "This destination is not available in the current demo data.";
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
