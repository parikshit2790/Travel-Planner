export function sendSuccess(res, body, status = 200) {
  res.status(status).json({ success: true, ...body });
}

export function sendActionError(res, status, code, message, { retryable = false } = {}) {
  res.status(status).json({
    success: false,
    error: { code, message, retryable }
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
