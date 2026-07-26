const destinationResearchCache = new Map();
const inFlightDestinationResearch = new Map();

export async function getCachedDestinationResearch(key, producer, { ttlSeconds = 86400 } = {}) {
  const now = Date.now();
  const cached = destinationResearchCache.get(key);
  if (cached && cached.expiresAt > now) return { profile: clone(cached.profile), cacheStatus: "hit" };
  if (inFlightDestinationResearch.has(key)) {
    const profile = await inFlightDestinationResearch.get(key);
    return { profile: clone(profile), cacheStatus: "in-flight" };
  }
  const promise = Promise.resolve()
    .then(producer)
    .then((profile) => {
      destinationResearchCache.set(key, {
        profile: clone(profile),
        expiresAt: now + Math.max(1, Number(ttlSeconds || 86400)) * 1000
      });
      return profile;
    })
    .finally(() => inFlightDestinationResearch.delete(key));
  inFlightDestinationResearch.set(key, promise);
  const profile = await promise;
  return { profile: clone(profile), cacheStatus: "miss" };
}

export function destinationResearchCacheKey(destination, trip = {}, config = {}) {
  const providerMode = [config.aiProvider || "none", config.placeProvider || "none", config.routeProvider || "none"].join(":");
  const model = config.aiProvider === "openai" ? config.aiModel || "gpt-5-mini" : "none";
  const season = seasonBucket(trip?.startDate || trip?.endDate || "");
  return [
    "destination-profile-v2",
    canonical(destination),
    providerMode,
    model,
    season
  ].join("|");
}

export function clearDestinationResearchCache() {
  destinationResearchCache.clear();
  inFlightDestinationResearch.clear();
}

function seasonBucket(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "season:any";
  const month = date.getUTCMonth() + 1;
  if ([12, 1, 2].includes(month)) return "season:winter";
  if ([3, 4, 5].includes(month)) return "season:spring";
  if ([6, 7, 8].includes(month)) return "season:summer";
  return "season:fall";
}

function canonical(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
