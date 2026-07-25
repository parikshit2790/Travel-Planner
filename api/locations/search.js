import { providerConfig, validatePlanningProviders } from "../lib/env.js";
import { parseJsonBody, requirePost, sendJson, withTimeout } from "../lib/http.js";
import { mockLocationSearch } from "../lib/mock-provider.js";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const config = providerConfig();
  if (config.production && validatePlanningProviders(config).some((error) => error.includes("PLACE_PROVIDER"))) {
    sendJson(res, 503, { error: "Location provider is not configured.", code: "PROVIDER_CONFIGURATION_REQUIRED" });
    return;
  }
  const { query } = parseJsonBody(req);
  const text = String(query || "").trim();
  if (text.length < 2) {
    sendJson(res, 400, { error: "Enter at least 2 characters.", code: "QUERY_TOO_SHORT" });
    return;
  }
  const results = await withTimeout(searchLocations(text, config), config.timeoutMs, "Location search");
  const ambiguous = results.length > 1 && new Set(results.map((item) => item.canonicalName)).size > 1;
  sendJson(res, 200, { results, ambiguous, provider: config.placeProvider });
}

async function searchLocations(query, config) {
  if (config.placeProvider === "mock") return mockLocationSearch(query);
  throw new Error(`PLACE_PROVIDER=${config.placeProvider || "unset"} is not implemented in this build.`);
}
