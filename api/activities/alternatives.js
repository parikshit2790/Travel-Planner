import { parseJsonBody, requirePost, sendJson } from "../lib/http.js";
import { registerGeneratedDestinationProfile } from "../../src/destination-data.js?v=49";
import { compatibleAlternatives } from "../../src/planner.js?v=49";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  const { plan, itemId, destinationProfile } = parseJsonBody(req);
  if (!plan || !itemId) {
    sendJson(res, 400, { error: "Plan and itemId are required.", code: "PLAN_ITEM_REQUIRED" });
    return;
  }
  if (destinationProfile) registerGeneratedDestinationProfile(destinationProfile);
  sendJson(res, 200, { alternatives: compatibleAlternatives(plan, itemId) });
}
