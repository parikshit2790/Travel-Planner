import { sendActionError } from "../server/lib/action-response.js";
import { providerConfig } from "../server/lib/env.js";
import { checkRateLimit, clientIpFrom } from "../server/lib/rate-limit.js";

const MAX_STOPS = 15;
const MARKER_COLORS = ["0x2563eb", "0xdc2626", "0x16a34a", "0xd97706", "0x7c3aed", "0x0891b2"];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendActionError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    return;
  }

  const limit = checkRateLimit(`route-map:${clientIpFrom(req)}`, { maxRequests: 60, windowMs: 5 * 60 * 1000 });
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    sendActionError(res, 429, "RATE_LIMITED", "Too many map requests. Please slow down.", { retryable: true });
    return;
  }

  const stops = parseStops(queryParam(req, "stops"));
  if (!stops) {
    sendActionError(res, 400, "INVALID_STOPS", "Route map requires 1-15 stops with valid coordinates.");
    return;
  }

  const config = providerConfig();
  const apiKey = config.googleMapsApiKey || config.placeApiKey || config.routeApiKey || "";
  if (!apiKey) {
    sendActionError(res, 503, "MAP_UNAVAILABLE", "Map imagery is not configured.");
    return;
  }

  const mapUrl = buildStaticMapUrl(stops, apiKey);
  let upstream;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    upstream = await fetch(mapUrl, { signal: controller.signal });
    clearTimeout(timeout);
  } catch {
    sendActionError(res, 502, "MAP_FETCH_FAILED", "Could not load the route map. Please retry.", { retryable: true });
    return;
  }

  if (!upstream.ok) {
    sendActionError(res, 502, "MAP_FETCH_FAILED", "Could not load the route map. Please retry.", { retryable: true });
    return;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = 200;
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  res.end(buffer);
}

export function queryParam(req, name) {
  const query = new URL(req.url || "/", "http://localhost").searchParams;
  return query.get(name);
}

export function parseStops(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_STOPS) return null;
  const stops = [];
  for (const item of parsed) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    stops.push({ label: String(item?.label || "").slice(0, 40), lat, lng });
  }
  return stops;
}

export function buildStaticMapUrl(stops, apiKey) {
  const params = new URLSearchParams();
  params.set("size", "640x400");
  params.set("scale", "2");
  params.set("maptype", "roadmap");
  params.set("key", apiKey);
  stops.forEach((stop, index) => {
    const color = MARKER_COLORS[index % MARKER_COLORS.length];
    const markerLabel = index < 9 ? String(index + 1) : "";
    params.append("markers", `color:${color}|label:${markerLabel}|${stop.lat},${stop.lng}`);
  });
  if (stops.length > 1) {
    const pathPoints = stops.map((stop) => `${stop.lat},${stop.lng}`).join("|");
    params.append("path", `color:0x2563ebcc|weight:3|${pathPoints}`);
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
