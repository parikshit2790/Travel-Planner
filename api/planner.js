import { parseActionRequest, requireActionPost, sendActionError, sendSuccess } from "./lib/action-response.js";
import { handlePlannerAction } from "./lib/planner-actions.js";

export default async function handler(req, res) {
  if (!requireActionPost(req, res)) return;
  try {
    const { action, payload } = parseActionRequest(req);
    if (!action) {
      sendActionError(res, 400, "ACTION_REQUIRED", "Planner action is required.");
      return;
    }
    const result = await handlePlannerAction(action, payload);
    if (result.body?.success === false) {
      res.status(result.status).json(result.body);
      return;
    }
    sendSuccess(res, result.body, result.status);
  } catch {
    sendActionError(res, 500, "PLANNER_REQUEST_FAILED", "Planner request failed. Please retry.", { retryable: true });
  }
}
