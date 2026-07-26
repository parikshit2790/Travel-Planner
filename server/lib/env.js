export function providerConfig() {
  const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const development = !production && process.env.VERCEL_ENV !== "preview";
  const placeProvider = normalizeProvider(process.env.PLACE_PROVIDER || (production ? "" : "mock"));
  const routeProvider = normalizeProvider(process.env.ROUTE_PROVIDER || (production ? "" : "mock"));
  const weatherProvider = normalizeProvider(process.env.WEATHER_PROVIDER || "");
  const aiProvider = normalizeProvider(process.env.AI_PROVIDER || "");
  return {
    production,
    development,
    placeProvider,
    placeApiKey: cleanEnv(process.env.PLACE_API_KEY),
    googleMapsApiKey: cleanEnv(process.env.GOOGLE_MAPS_API_KEY),
    openRouteServiceApiKey: cleanEnv(process.env.OPENROUTESERVICE_API_KEY),
    routeProvider,
    routeApiKey: cleanEnv(process.env.ROUTE_API_KEY),
    weatherProvider,
    weatherApiKey: cleanEnv(process.env.WEATHER_API_KEY),
    aiProvider,
    aiApiKey: cleanEnv(process.env.AI_API_KEY || process.env.OPENAI_API_KEY),
    aiModel: cleanEnv(process.env.AI_MODEL || process.env.OPENAI_MODEL) || "gpt-5-mini",
    timeoutMs: Number(cleanEnv(process.env.PROVIDER_TIMEOUT_MS) || 10000),
    cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS || 86400)
  };
}

export function validatePlanningProviders(config = providerConfig()) {
  return providerStatus(config).blockingErrors;
}

export function providerStatus(config = providerConfig(), { includeDiagnostics = false } = {}) {
  const placeMissing = [];
  const routeMissing = [];
  const weatherMissing = [];
  const aiMissing = [];
  const openRouteServiceKey = config.openRouteServiceApiKey || config.placeApiKey || config.routeApiKey;
  const googleMapsKey = config.googleMapsApiKey || config.placeApiKey || config.routeApiKey;
  if (!config.placeProvider) placeMissing.push("PLACE_PROVIDER");
  if (!config.routeProvider) routeMissing.push("ROUTE_PROVIDER");
  if (config.placeProvider === "openrouteservice" && !openRouteServiceKey) placeMissing.push("OPENROUTESERVICE_API_KEY");
  if (config.routeProvider === "openrouteservice" && !openRouteServiceKey) routeMissing.push("OPENROUTESERVICE_API_KEY");
  if (config.placeProvider === "google" && !googleMapsKey) placeMissing.push("GOOGLE_MAPS_API_KEY");
  if (config.routeProvider === "google" && !googleMapsKey) routeMissing.push("GOOGLE_MAPS_API_KEY");
  if (config.placeProvider === "opentripmap" && !config.placeApiKey) placeMissing.push("PLACE_API_KEY");
  if (config.weatherProvider && !config.weatherApiKey && !["open-meteo", "mock"].includes(config.weatherProvider)) weatherMissing.push("WEATHER_API_KEY");
  if (config.aiProvider && !config.aiApiKey) aiMissing.push("OPENAI_API_KEY");
  const placeImplemented = ["mock", "openrouteservice", "google"].includes(config.placeProvider);
  const routeImplemented = ["mock", "approximate", "openrouteservice", "google"].includes(config.routeProvider);
  const weatherImplemented = !config.weatherProvider;
  const aiImplemented = !config.aiProvider || ["openai"].includes(config.aiProvider);
  if (config.placeProvider && !placeImplemented) placeMissing.push(`Adapter not implemented: ${config.placeProvider}`);
  if (config.routeProvider && !routeImplemented) routeMissing.push(`Adapter not implemented: ${config.routeProvider}`);
  if (config.weatherProvider && !weatherImplemented) weatherMissing.push(`Adapter not implemented: ${config.weatherProvider}`);
  if (config.aiProvider && !aiImplemented) aiMissing.push(`Adapter not implemented: ${config.aiProvider}`);
  const hasPlaceAndRoute = placeMissing.length === 0 && routeMissing.length === 0;
  const needsLiveDestinationResearch = config.production && config.placeProvider !== "mock";
  const destinationResearchMissing = needsLiveDestinationResearch && !(config.aiProvider === "openai" && aiMissing.length === 0)
    ? ["AI destination intelligence is required for production trip generation."]
    : [];
  const canGenerate = hasPlaceAndRoute && destinationResearchMissing.length === 0;
  const mockMode = canGenerate && (config.placeProvider === "mock" || config.routeProvider === "mock");
  const mode = !canGenerate ? "unavailable" : mockMode ? "mock" : "live";
  const status = {
    available: canGenerate,
    status: canGenerate ? "available" : "temporarily unavailable",
    canGenerate,
    mode,
    placeProviderAvailable: placeMissing.length === 0,
    destinationResearchAvailable: placeMissing.length === 0 && destinationResearchMissing.length === 0,
    routeProviderAvailable: routeMissing.length === 0,
    weatherProviderAvailable: Boolean(config.weatherProvider) && weatherMissing.length === 0,
    placeProvider: safeProviderStatus(config.placeProvider, placeMissing, canGenerate),
    routeProvider: safeProviderStatus(config.routeProvider, routeMissing, canGenerate),
    weatherProvider: {
      configured: Boolean(config.weatherProvider) && weatherMissing.length === 0,
      provider: config.weatherProvider || "none",
      optional: true,
      status: config.weatherProvider && weatherMissing.length === 0 ? "available" : "degraded"
    },
    aiProvider: {
      configured: Boolean(config.aiProvider) && aiMissing.length === 0,
      provider: config.aiProvider || "none",
      optional: true,
      status: config.aiProvider && aiMissing.length === 0 ? "available" : "degraded"
    },
    publicMessage: canGenerate ? "Trip generation is available." : "Trip generation is temporarily unavailable. Please try again later.",
    checkedAt: new Date().toISOString()
  };
  const errors = [
    ...placeMissing.map((item) => `Place provider: ${item}`),
    ...routeMissing.map((item) => `Route provider: ${item}`),
    ...destinationResearchMissing.map((item) => `Destination research: ${item}`),
    ...weatherMissing.map((item) => `Weather provider: ${item}`),
    ...aiMissing.map((item) => `AI provider: ${item}`)
  ];
  const blockingErrors = [
    ...placeMissing.map((item) => `Place provider: ${item}`),
    ...routeMissing.map((item) => `Route provider: ${item}`),
    ...destinationResearchMissing.map((item) => `Destination research: ${item}`)
  ];
  if (includeDiagnostics) {
    status.diagnostics = {
      environment: config.production ? "production" : config.development ? "development" : "preview",
      mode,
      placeProvider: config.placeProvider || "not configured",
      routeProvider: config.routeProvider || "not configured",
      weatherProvider: config.weatherProvider || "none",
      aiProvider: config.aiProvider || "none",
      placeProviderMissing: placeMissing,
      routeProviderMissing: routeMissing,
      destinationResearchMissing,
      weatherProviderMissing: weatherMissing,
      aiProviderMissing: aiMissing,
      errors
    };
  }
  return { ...status, errors, blockingErrors };
}

function normalizeProvider(value) {
  return cleanEnv(value).toLowerCase();
}

function cleanEnv(value) {
  return String(value || "").trim();
}

function safeProviderStatus(provider, missing, canGenerate) {
  return {
    configured: missing.length === 0,
    provider: provider || "not configured",
    missingVariables: [],
    status: missing.length === 0 ? "available" : canGenerate ? "degraded" : "temporarily unavailable"
  };
}
