const DEFAULT_FRONTEND_GENERATION_TIMEOUT_MS = 65000;

async function postAction(endpoint, action, payload = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), Math.max(1, timeoutMs)) : null;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: controller?.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Trip generation took too long. Please retry.");
      timeoutError.code = "FRONTEND_TIMEOUT";
      timeoutError.retryable = true;
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text().catch(() => "");
  const data = contentType.includes("application/json") ? parseJsonOrNull(rawBody) : null;
  if (!data || typeof data !== "object") {
    const error = new Error(response.ok ? "The trip service returned an invalid response." : publicFallbackMessage(response.status));
    error.code = "INVALID_RESPONSE";
    error.retryable = response.status >= 500;
    error.status = response.status;
    error.responseCategory = responseCategory(contentType, rawBody);
    throw error;
  }
  if (!response.ok || data.success === false) {
    const error = new Error(data.error?.message || messageForCode(data.error?.code) || data.error || publicFallbackMessage(response.status));
    error.code = data.error?.code || data.code || "REQUEST_FAILED";
    error.retryable = Boolean(data.error?.retryable);
    error.status = response.status;
    error.requestId = data.error?.requestId || data.requestId || "";
    throw error;
  }
  if (data.success !== true) {
    const error = new Error("The trip service returned an invalid response.");
    error.code = "INVALID_RESPONSE";
    error.retryable = false;
    error.status = response.status;
    error.requestId = data.requestId || "";
    error.responseCategory = "unexpected-json-schema";
    throw error;
  }
  return { ...data, ...(data.data && typeof data.data === "object" ? data.data : {}) };
}

function publicFallbackMessage(status) {
  if (status === 400) return "The request was incomplete. Please review your trip details.";
  if (status === 404) return "Trip service is unavailable right now. Please try again later.";
  if (status === 422) return "Trip generation needs more complete trip details.";
  if (status >= 500) return "Trip service is temporarily unavailable. Please try again later.";
  return "Trip request could not be completed.";
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return null;
  }
}

function responseCategory(contentType, rawBody) {
  if (contentType.includes("text/html") || /^\s*</.test(rawBody)) return "html";
  if (!rawBody) return "empty";
  if (contentType.includes("application/json")) return "invalid-json";
  return "non-json";
}

function messageForCode(code) {
  if (code === "INSUFFICIENT_DESTINATION_DATA") return "We could not find enough reliable destination information for this trip.";
  if (code === "ROUTE_ESTIMATE_FAILED") return "We found destination ideas, but could not calculate reliable travel times.";
  if (code === "PROVIDER_UNAVAILABLE" || code === "PROVIDER_RATE_LIMITED") return "Trip planning services are temporarily unavailable.";
  if (["REQUEST_TIMEOUT", "AI_TIMEOUT", "GOOGLE_TIMEOUT", "PLANNER_TIMEOUT", "ROUTE_TIMEOUT", "FRONTEND_TIMEOUT"].includes(code)) return "Trip generation took too long. Please retry.";
  if (code === "INVALID_RESPONSE") return "The trip service returned an invalid response.";
  return "";
}

export const routeMosaicApi = {
  searchLocations(query) {
    return postAction("/api/locations", "search", { query });
  },
  resolveLocation(payload) {
    return postAction("/api/locations", "resolve", payload);
  },
  clarifyLocation(payload) {
    return postAction("/api/locations", "clarify", payload);
  },
  placeDetails(payload) {
    return postAction("/api/locations", "place-details", payload);
  },
  researchDestination(trip) {
    return postAction("/api/planner", "research-destination", { trip }, { timeoutMs: frontendGenerationTimeoutMs() });
  },
  generateTrip(trip, destinationProfile, variationSeed = 0) {
    return postAction("/api/planner", "generate-trip", { trip, destinationProfile, variationSeed }, { timeoutMs: frontendGenerationTimeoutMs() });
  },
  regeneratePlan(plan) {
    return postAction("/api/planner", "regenerate-plan", { plan });
  },
  regenerateDay(plan, dayId, destinationProfile) {
    return postAction("/api/planner", "regenerate-day", { plan, dayId, destinationProfile });
  },
  regenerateMeals(plan, destinationProfile) {
    return postAction("/api/planner", "regenerate-meals", { plan, destinationProfile });
  },
  replaceActivity(plan, itemId, destinationProfile) {
    return postAction("/api/planner", "replace-activity", { plan, itemId, destinationProfile });
  },
  getActivityAlternatives(plan, itemId, destinationProfile) {
    return postAction("/api/planner", "get-alternatives", { plan, itemId, destinationProfile });
  },
  estimateRoute(origin, destination, mode = "driving") {
    return postAction("/api/planner", "estimate-route", { origin, destination, mode });
  },
  weatherSummary(destination, startDate, endDate) {
    return postAction("/api/planner", "weather-summary", { destination, startDate, endDate });
  },
  checkProviderHealth() {
    return postAction("/api/provider-health", "status");
  }
};

function frontendGenerationTimeoutMs() {
  return Number(globalThis.ROUTEMOSAIC_FRONTEND_GENERATION_TIMEOUT_MS || DEFAULT_FRONTEND_GENERATION_TIMEOUT_MS);
}
