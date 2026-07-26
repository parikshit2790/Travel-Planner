import { parseActionRequest, requireActionPost, sendActionError, sendSuccess } from "./lib/action-response.js";
import { handleProviderHealthAction } from "./lib/provider-health-actions.js";

export default async function handler(req, res) {
  if (!requireActionPost(req, res)) return;
  try {
    const { action } = parseActionRequest(req);
    const result = handleProviderHealthAction(action || "status");
    if (result.body?.success === false) {
      res.status(result.status).json(result.body);
      return;
    }
    sendSuccess(res, result.body, result.status);
  } catch {
    sendActionError(res, 500, "PROVIDER_HEALTH_FAILED", "Provider status is temporarily unavailable.", { retryable: true });
  }
}
