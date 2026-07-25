import { parseJsonBody, requirePost, sendJson } from "../lib/http.js";
import { registerGeneratedDestinationProfile } from "../../src/destination-data.js?v=49";
import { generateTripPlan } from "../../src/planner.js?v=49";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const { trip, destinationProfile, variationSeed = 0 } = parseJsonBody(req);
  if (!trip) {
    sendJson(res, 400, { error: "Trip is required.", code: "TRIP_REQUIRED" });
    return;
  }
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  const result = generateTripPlan(trip, { variationSeed });
  sendJson(res, result.status === "ready" ? 200 : 422, result);
}
