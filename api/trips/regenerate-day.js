import { parseJsonBody, requirePost, sendJson } from "../lib/http.js";
import { registerGeneratedDestinationProfile } from "../../src/destination-data.js?v=49";
import { regenerateDay } from "../../src/planner.js?v=49";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const { plan, dayId, destinationProfile } = parseJsonBody(req);
  if (!plan || !dayId) {
    sendJson(res, 400, { error: "Plan and dayId are required.", code: "PLAN_DAY_REQUIRED" });
    return;
  }
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  sendJson(res, 200, { plan: regenerateDay(plan, dayId) });
}
