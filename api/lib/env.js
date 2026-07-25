export function providerConfig() {
  const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  return {
    production,
    placeProvider: process.env.PLACE_PROVIDER || (production ? "" : "mock"),
    placeApiKey: process.env.PLACE_API_KEY || "",
    routeProvider: process.env.ROUTE_PROVIDER || (production ? "" : "mock"),
    routeApiKey: process.env.ROUTE_API_KEY || "",
    weatherProvider: process.env.WEATHER_PROVIDER || "",
    weatherApiKey: process.env.WEATHER_API_KEY || "",
    aiProvider: process.env.AI_PROVIDER || "",
    aiApiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    aiModel: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    timeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 10000),
    cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS || 86400)
  };
}

export function validatePlanningProviders(config = providerConfig()) {
  const errors = [];
  if (!config.placeProvider) errors.push("PLACE_PROVIDER is required for production destination research.");
  if (!config.routeProvider) errors.push("ROUTE_PROVIDER is required for production route estimates.");
  if (config.placeProvider === "opentripmap" && !config.placeApiKey) errors.push("PLACE_API_KEY is required when PLACE_PROVIDER=opentripmap.");
  if (config.routeProvider === "google" && !config.routeApiKey) errors.push("ROUTE_API_KEY is required when ROUTE_PROVIDER=google.");
  return errors;
}
