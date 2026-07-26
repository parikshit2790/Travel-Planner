import { parseActionRequest, sendActionError, sendSuccess } from "./lib/action-response.js";
import { handleProviderHealthAction } from "./lib/provider-health-actions.js";

export default async function handler(req, res) {
  setProviderHealthHeaders(res);
  if (req.method === "GET") {
    try {
      const result = await handleProviderHealthAction("status");
      if (result.body?.success === false) {
        res.status(result.status).json(result.body);
        return;
      }
      res.status(result.status).json({ success: true, data: result.body });
    } catch {
      sendActionError(res, 500, "PROVIDER_HEALTH_FAILED", "Provider status is temporarily unavailable.", { retryable: true });
    }
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    sendActionError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    return;
  }
  try {
    const { action } = parseActionRequest(req);
    const result = await handleProviderHealthAction(action || "status");
    if (result.body?.success === false) {
      res.status(result.status).json(result.body);
      return;
    }
    sendSuccess(res, result.body, result.status);
  } catch {
    sendActionError(res, 500, "PROVIDER_HEALTH_FAILED", "Provider status is temporarily unavailable.", { retryable: true });
  }
}

function setProviderHealthHeaders(res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
}
