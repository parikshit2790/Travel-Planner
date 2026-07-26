async function postAction(endpoint, action, payload = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.error?.message || data.error || "Request failed. Please retry.");
    error.code = data.error?.code || data.code || "REQUEST_FAILED";
    error.retryable = Boolean(data.error?.retryable);
    error.status = response.status;
    throw error;
  }
  return data;
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
