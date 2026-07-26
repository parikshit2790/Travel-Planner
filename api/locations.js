import { parseActionRequest, requireActionPost, sendActionError, sendSuccess } from "../server/lib/action-response.js";
import { handleLocationAction } from "../server/lib/location-actions.js";

export default async function handler(req, res) {
  if (!requireActionPost(req, res)) return;
  try {
    const { action, payload } = parseActionRequest(req);
    if (!action) {
      sendActionError(res, 400, "ACTION_REQUIRED", "Location action is required.");
      return;
    }
    const result = await handleLocationAction(action, payload);
    if (result.body?.success === false) {
      res.status(result.status).json(result.body);
      return;
    }
    sendSuccess(res, result.body, result.status);
  } catch {
    sendActionError(res, 500, "LOCATION_REQUEST_FAILED", "Location request failed. Please retry.", { retryable: true });
  }
}
