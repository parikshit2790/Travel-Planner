import { providerConfig, validatePlanningProviders } from "./env.js";
import { withTimeout } from "./http.js";
import { googleLocationSearch } from "./google-provider.js";
import { mockLocationSearch } from "./mock-provider.js";
import { openRouteServiceLocationSearch } from "./openrouteservice-provider.js";

export async function handleLocationAction(action, payload = {}) {
  switch (action) {
    case "search":
    case "locations/search":
      return handleLocationSearch(payload);
    case "resolve":
    case "clarify":
    case "place-details":
      return handleLocationResolve(payload);
    default:
      return actionError(400, "UNKNOWN_ACTION", "Unknown location action.");
  }
}

async function handleLocationSearch({ query } = {}) {
  const config = providerConfig();
  if (config.production && validatePlanningProviders(config).some((error) => error.startsWith("Place provider:"))) {
    return actionError(503, "PROVIDER_CONFIGURATION_REQUIRED", "Location search is temporarily unavailable.", true);
  }
  const text = String(query || "").trim();
  if (text.length < 2) return actionError(400, "QUERY_TOO_SHORT", "Enter at least 2 characters.");
  try {
    const results = (await withTimeout(searchLocations(text, config), config.timeoutMs, "Location search")).map(publicLocationResult);
    const ambiguous = results.length > 1 && new Set(results.map((item) => item.canonicalName)).size > 1;
    return { status: 200, body: { results, ambiguous } };
  } catch (error) {
    const timedOut = String(error?.message || "").toLowerCase().includes("timed out");
    return actionError(timedOut ? 504 : 502, timedOut ? "LOCATION_SEARCH_TIMEOUT" : "LOCATION_SEARCH_FAILED", timedOut ? "Location search timed out." : "Location provider unavailable.", true);
  }
}

async function searchLocations(query, config) {
  if (config.placeProvider === "mock") return mockLocationSearch(query);
  if (config.placeProvider === "google") return googleLocationSearch(query, config);
  if (config.placeProvider === "openrouteservice") return openRouteServiceLocationSearch(query, config);
  throw new Error("Place provider is not implemented in this build.");
}

async function handleLocationResolve(payload = {}) {
  const query = payload.query || payload.text || payload.location || payload.input;
  const result = await handleLocationSearch({ query });
  if (result.status !== 200) return result;
  return {
    status: 200,
    body: {
      location: result.body.results[0] || null,
      results: result.body.results,
      ambiguous: result.body.ambiguous
    }
  };
}

function publicLocationResult(result) {
  const { provider, confidence, ...safeResult } = result;
  return safeResult;
}

function actionError(status, code, message, retryable = false) {
  return { status, body: { success: false, error: { code, message, retryable } } };
}
