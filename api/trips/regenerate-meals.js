import { parseJsonBody, requirePost, sendJson } from "../lib/http.js";
import { registerGeneratedDestinationProfile } from "../../src/destination-data.js?v=49";
import { regenerateMeals } from "../../src/planner.js?v=49";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const { plan, destinationProfile } = parseJsonBody(req);
  if (!plan) {
    sendJson(res, 400, { error: "Plan is required.", code: "PLAN_REQUIRED" });
    return;
  }
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  sendJson(res, 200, { plan: regenerateMeals(plan) });
}
