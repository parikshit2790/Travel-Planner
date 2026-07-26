import assert from "node:assert/strict";
import { routeMosaicApi } from "../src/api-client.js";

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => response({ success: true, requestId: "req-ok", data: { status: "ready", plan: { id: "plan-1" } } }, 200, "application/json");
  const success = await routeMosaicApi.generateTrip({ destination: "Charlotte" }, { id: "profile" });
  assert.equal(success.status, "ready");
  assert.equal(success.plan.id, "plan-1");
  assert.equal(success.requestId, "req-ok");

  globalThis.fetch = async () => response({
    success: false,
    requestId: "req-structured",
    error: {
      code: "INSUFFICIENT_DESTINATION_DATA",
      message: "We could not find enough reliable destination information for this trip.",
      retryable: true,
      requestId: "req-structured"
    }
  }, 422, "application/json");
  await assert.rejects(
    () => routeMosaicApi.generateTrip({ destination: "Charlotte" }, null),
    (error) => error.code === "INSUFFICIENT_DESTINATION_DATA" && error.requestId === "req-structured" && error.retryable === true
  );

  globalThis.fetch = async () => response("<html>Function crashed</html>", 500, "text/html");
  await assert.rejects(
    () => routeMosaicApi.generateTrip({}, null),
    (error) => error.code === "INVALID_RESPONSE" && error.responseCategory === "html" && error.status === 500
  );

  globalThis.fetch = async () => response("", 500, "text/plain");
  await assert.rejects(
    () => routeMosaicApi.generateTrip({}, null),
    (error) => error.code === "INVALID_RESPONSE" && error.responseCategory === "empty"
  );

  globalThis.fetch = async () => response("{bad json", 200, "application/json");
  await assert.rejects(
    () => routeMosaicApi.generateTrip({}, null),
    (error) => error.code === "INVALID_RESPONSE" && error.responseCategory === "invalid-json"
  );

  globalThis.fetch = async () => response({ ok: true }, 200, "application/json");
  await assert.rejects(
    () => routeMosaicApi.generateTrip({}, null),
    (error) => error.code === "INVALID_RESPONSE" && error.responseCategory === "unexpected-json-schema"
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("API client contract tests passed");

function response(body, status, contentType) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(key) {
        return key.toLowerCase() === "content-type" ? contentType : "";
      }
    },
    text: async () => text
  };
}
