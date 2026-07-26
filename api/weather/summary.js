import { providerConfig } from "../lib/env.js";
import { parseJsonBody, requirePost, sendJson } from "../lib/http.js";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const config = providerConfig();
  const { destination = "", startDate = "", endDate = "" } = parseJsonBody(req);
  if (!destination) {
    sendJson(res, 400, { error: "Destination is required.", code: "DESTINATION_REQUIRED" });
    return;
  }
  if (!config.weatherProvider) {
    sendJson(res, 200, {
      guidance: {
        type: "seasonal",
        label: "Seasonal guidance only",
        summary: `Live weather is not configured. Recheck the forecast for ${destination} closer to ${startDate || "travel"}.`,
        startDate,
        endDate,
        provider: "none",
        retrievedAt: new Date().toISOString()
      }
    });
    return;
  }
  sendJson(res, 501, { error: "Live weather guidance is not available yet.", code: "PROVIDER_NOT_IMPLEMENTED" });
}
