export function parseJsonBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body || {};
}

export function sendJson(res, status, body) {
  res.status(status).json(body);
}

export function withTimeout(promise, ms, label = "Request", code = "REQUEST_TIMEOUT", status = 504) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      error.code = code;
      error.status = status;
      error.retryable = true;
      error.stage = label;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export function requirePost(req, res) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  sendJson(res, 405, { error: "Method not allowed" });
  return false;
}
