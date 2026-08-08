const buckets = new Map();
const MAX_TRACKED_KEYS = 5000;

export function clientIpFrom(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  const real = req.headers?.["x-real-ip"];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || "unknown";
}

export function checkRateLimit(key, { maxRequests, windowMs }) {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { allowed: true };
  }
  bucket.count += 1;
  if (bucket.count > maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)) };
  }
  return { allowed: true };
}
