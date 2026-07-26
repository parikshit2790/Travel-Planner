import { providerConfig, validatePlanningProviders } from "../lib/env.js";
import { parseJsonBody, requirePost, sendJson, withTimeout } from "../lib/http.js";
import { mockRouteEstimate } from "../lib/mock-provider.js";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const config = providerConfig();
  if (config.production && validatePlanningProviders(config).some((error) => error.startsWith("Route provider:"))) {
    sendJson(res, 503, { error: "Route provider is not configured.", code: "PROVIDER_CONFIGURATION_REQUIRED" });
    return;
  }
  const { origin, destination, mode = "driving" } = parseJsonBody(req);
  if (!origin || !destination) {
    sendJson(res, 400, { error: "Origin and destination are required.", code: "ROUTE_POINTS_REQUIRED" });
    return;
  }
  const estimate = await withTimeout(estimateRoute(origin, destination, mode, config), config.timeoutMs, "Route estimate");
  sendJson(res, 200, { estimate });
}

async function estimateRoute(origin, destination, mode, config) {
  if (config.routeProvider === "mock") return mockRouteEstimate(origin, destination, mode);
  if (config.routeProvider === "approximate") {
    const estimate = mockRouteEstimate(origin, destination, mode);
    return { ...estimate, provider: "coordinate-approximation", disclaimer: "Coordinate-based approximation, not live route data." };
  }
  throw new Error(`ROUTE_PROVIDER=${config.routeProvider || "unset"} is not implemented in this build.`);
}
