export function createRequestId(prefix = "req") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sendSuccess(res, body, status = 200, requestId = createRequestId()) {
  const safeBody = sanitizeForJson(body);
  sendJson(res, status, { success: true, requestId, data: cloneJsonSafe(safeBody), ...safeBody });
}

export function sendActionError(res, status, code, message, { retryable = false, requestId = createRequestId() } = {}) {
  sendJson(res, status, {
    success: false,
    requestId,
    error: { code, message, retryable, requestId }
  });
}

export function parseActionRequest(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  return {
    action: String(body.action || "").trim(),
    payload: body.payload || {}
  };
}

export function requireActionPost(req, res) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  sendActionError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  return false;
}

export function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).json(sanitizeForJson(body));
}

export function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code || "ERROR" };
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForJson(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForJson(item, seen)]));
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
