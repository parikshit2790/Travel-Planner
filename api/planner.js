import { createRequestId, parseActionRequest, requireActionPost, sendActionError, sendSuccess } from "../server/lib/action-response.js";
import { handlePlannerAction } from "../server/lib/planner-actions.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const requestId = createRequestId("planner");
  const startedAt = Date.now();
  if (!requireActionPost(req, res)) return;
  try {
    const { action, payload } = parseActionRequest(req);
    if (!action) {
      logPlannerRoute({ requestId, action: "", stage: "rejected", status: 400, durationMs: Date.now() - startedAt });
      sendActionError(res, 400, "ACTION_REQUIRED", "Planner action is required.", { requestId });
      return;
    }
    logPlannerRoute({ requestId, action, stage: "start", origin: payload?.trip?.fromDisplay || payload?.trip?.from, destination: payload?.trip?.destinationDisplay || payload?.trip?.destination });
    const result = await handlePlannerAction(action, payload, { requestId });
    if (result.body?.success === false) {
      logPlannerRoute({ requestId, action, stage: "structured-error", status: result.status, errorCode: result.body.error?.code, durationMs: Date.now() - startedAt });
      sendActionError(res, result.status, result.body.error?.code || "PLANNER_REQUEST_FAILED", result.body.error?.message || "Planner request failed. Please retry.", { retryable: Boolean(result.body.error?.retryable), requestId });
      return;
    }
    logPlannerRoute({ requestId, action, stage: "complete", status: result.status, durationMs: Date.now() - startedAt });
    sendSuccess(res, result.body, result.status, requestId);
  } catch (error) {
    const code = codeForError(error);
    logPlannerRoute({ requestId, action: "unknown", stage: "exception", status: statusForError(error), errorCode: code, durationMs: Date.now() - startedAt });
    sendActionError(res, statusForError(error), code, messageForError(code), { retryable: retryableForError(error), requestId });
  }
}

function codeForError(error) {
  if (error instanceof SyntaxError) return "INVALID_JSON_BODY";
  return error?.code || "PLANNER_REQUEST_FAILED";
}

function statusForError(error) {
  if (error instanceof SyntaxError) return 400;
  return Number(error?.status || 500);
}

function retryableForError(error) {
  if (error instanceof SyntaxError) return false;
  return error?.retryable !== false;
}

function messageForError(code) {
  if (code === "INVALID_JSON_BODY") return "The planner request body was invalid.";
  if (["REQUEST_TIMEOUT", "AI_TIMEOUT", "GOOGLE_TIMEOUT", "PLANNER_TIMEOUT", "ROUTE_TIMEOUT"].includes(code)) return "Trip generation took too long. Please retry.";
  if (code === "INSUFFICIENT_DESTINATION_DATA") return "We could not find enough reliable destination information for this trip.";
  if (code === "ROUTE_ESTIMATE_FAILED") return "We found destination ideas, but could not calculate reliable travel times.";
  if (code === "PROVIDER_UNAVAILABLE") return "Trip planning services are temporarily unavailable.";
  return "Planner request failed. Please retry.";
}

function logPlannerRoute(event) {
  const safe = {
    requestId: event.requestId,
    action: event.action,
    stage: event.stage,
    status: event.status,
    origin: safeText(event.origin),
    destination: safeText(event.destination),
    errorCode: event.errorCode,
    durationMs: event.durationMs
  };
  console.info("[RouteMosaic API planner]", JSON.stringify(Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== undefined && value !== ""))));
}

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}
