import { providerConfig, validatePlanningProviders } from "./lib/env.js";
import { parseJsonBody, requirePost, sendJson, withTimeout } from "./lib/http.js";
import { mockDestinationResearch } from "./lib/mock-provider.js";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const config = providerConfig();
  const errors = validatePlanningProviders(config);
  if (config.production && errors.length) {
    sendJson(res, 503, {
      error: "Destination-agnostic planning is not configured yet.",
      code: "PROVIDER_CONFIGURATION_REQUIRED"
    });
    return;
  }
  const body = parseJsonBody(req);
  const trip = body.trip || {};
  const destination = String(trip.destinationDisplay || trip.destination || "").trim();
  if (!destination) {
    sendJson(res, 400, { error: "Destination is required.", code: "DESTINATION_REQUIRED" });
    return;
  }
  try {
    const profile = await withTimeout(researchDestination(destination, trip, config), config.timeoutMs, "Destination research");
    sendJson(res, 200, {
      profile,
      diagnostics: {
        provider: config.placeProvider,
        routeProvider: config.routeProvider,
        generatedAt: new Date().toISOString(),
        candidateCount: profile.places.length,
        cache: "miss"
      }
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error?.message || "Destination research failed.",
      code: "DESTINATION_RESEARCH_FAILED"
    });
  }
}

async function researchDestination(destination, trip, config) {
  if (config.placeProvider === "mock") return mockDestinationResearch(destination, trip);
  throw new Error(`PLACE_PROVIDER=${config.placeProvider || "unset"} is not implemented in this build. Configure mock for development or add a provider adapter.`);
}
