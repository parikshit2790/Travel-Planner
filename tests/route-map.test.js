import assert from "node:assert/strict";
import routeMapHandler, { buildStaticMapUrl, parseStops } from "../api/route-map.js";

assert.equal(parseStops(null), null);
assert.equal(parseStops("not-json"), null);
assert.equal(parseStops("[]"), null);
assert.equal(parseStops(JSON.stringify(Array.from({ length: 16 }, () => ({ lat: 1, lng: 1 })))), null);
assert.equal(parseStops(JSON.stringify([{ lat: "bad", lng: 1 }])), null);
assert.equal(parseStops(JSON.stringify([{ lat: 200, lng: 1 }])), null);

const validStops = parseStops(JSON.stringify([
  { label: "Day 1", lat: 34.05, lng: -118.24 },
  { label: "Day 2-3", lat: 34.02, lng: -118.49 }
]));
assert.equal(validStops.length, 2);
assert.equal(validStops[0].label, "Day 1");

const mapUrl = buildStaticMapUrl(validStops, "test-key");
assert.ok(mapUrl.startsWith("https://maps.googleapis.com/maps/api/staticmap?"));
assert.ok(mapUrl.includes("key=test-key"));
assert.ok((mapUrl.match(/markers=/g) || []).length === 2);
assert.ok(mapUrl.includes("path="));

const singleStopUrl = buildStaticMapUrl([validStops[0]], "test-key");
assert.ok(!singleStopUrl.includes("path="), "a single stop has nothing to connect, so no path parameter should be sent");

assert.equal((await invoke("POST")).statusCode, 405);
assert.equal((await invoke("GET", "/api/route-map")).statusCode, 400);
assert.equal((await invoke("GET", "/api/route-map?stops=not-json")).statusCode, 400);

const noKeyResult = await invoke("GET", `/api/route-map?stops=${encodeURIComponent(JSON.stringify([{ label: "Day 1", lat: 34.05, lng: -118.24 }]))}`);
assert.equal(noKeyResult.statusCode, 503);
assert.equal(noKeyResult.body.error.code, "MAP_UNAVAILABLE");

console.log("Route map endpoint tests passed");

async function invoke(method, url = "/api/route-map") {
  const req = { method, url };
  const res = createMockResponse();
  await routeMapHandler(req, res);
  return res.snapshot();
}

function createMockResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      if (!this.headers["Content-Type"]) this.headers["Content-Type"] = "application/json";
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
    snapshot() {
      return { statusCode: this.statusCode, headers: this.headers, body: this.body };
    }
  };
  return response;
}
