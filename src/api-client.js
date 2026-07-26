async function postAction(endpoint, action, payload = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload })
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => ({})) : null;
  if (!data) {
    const error = new Error("Trip service returned an unexpected response. Please try again later.");
    error.code = "NON_JSON_RESPONSE";
    error.retryable = response.status >= 500;
    error.status = response.status;
    throw error;
  }
  if (!response.ok || data.success === false) {
    const error = new Error(data.error?.message || data.error || publicFallbackMessage(response.status));
    error.code = data.error?.code || data.code || "REQUEST_FAILED";
    error.retryable = Boolean(data.error?.retryable);
    error.status = response.status;
    throw error;
  }
  return data;
}

function publicFallbackMessage(status) {
  if (status === 400) return "The request was incomplete. Please review your trip details.";
  if (status === 404) return "Trip service is unavailable right now. Please try again later.";
  if (status === 422) return "Trip generation needs more complete trip details.";
  if (status >= 500) return "Trip service is temporarily unavailable. Please try again later.";
  return "Trip request could not be completed.";
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
    return postAction("/api/planner", "research-destination", { trip });
  },
  generateTrip(trip, destinationProfile, variationSeed = 0) {
    return postAction("/api/planner", "generate-trip", { trip, destinationProfile, variationSeed });
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
