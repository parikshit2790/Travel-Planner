export function providerConfig() {
  const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const development = !production && process.env.VERCEL_ENV !== "preview";
  const placeProvider = normalizeProvider(process.env.PLACE_PROVIDER || (production ? "" : "mock"));
  const routeProvider = normalizeProvider(process.env.ROUTE_PROVIDER || (production ? "" : "mock"));
  const weatherProvider = normalizeProvider(process.env.WEATHER_PROVIDER || "");
  const aiProvider = normalizeProvider(process.env.AI_PROVIDER || "");
  const providerTimeoutMs = positiveNumber(process.env.PROVIDER_TIMEOUT_MS, 10000);
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
    timeoutMs: providerTimeoutMs,
    googleRequestTimeoutMs: positiveNumber(process.env.GOOGLE_REQUEST_TIMEOUT_MS, providerTimeoutMs),
    // Directly measured live: a plain Phoenix-only research call (no
    // approved multi-city route at all) still took ~52s end to end and
    // resolved to the Google fallback provider, not OpenAI -- meaning
    // OpenAI was consistently running out its full 50s timeout before
    // falling back, regardless of destination. That left almost none of
    // the shared ~58-60s request budget for anything after it, including
    // regional extension research running concurrently. Give OpenAI a
    // real but bounded window, so a slow/failing attempt fails fast enough
    // to leave meaningful time for the Google-based fallback and any
    // parallel regional extension research to actually complete.
    // Root cause of the slowness itself (not just this timeout): the
    // destination-research request never set a reasoning-effort parameter,
    // so gpt-5-mini defaulted to spending 768-1280 invisible reasoning
    // tokens per call and consistently ran 60-70+ seconds even for a
    // knowledge-retrieval-and-formatting task with no real reasoning need.
    // Fixed at the call site (openai-destination-provider.js) by setting
    // reasoning effort to "minimal", which completed in 38-45 seconds with
    // zero reasoning tokens across repeated live runs. Raised this timeout
    // to match that faster, now-realistic completion time with headroom,
    // while still leaving room in the ~58s shared budget for the
    // Google-based fallback if a call is still unusually slow.
    openAiRequestTimeoutMs: positiveNumber(process.env.OPENAI_REQUEST_TIMEOUT_MS, 45000),
    plannerRequestTimeoutMs: positiveNumber(process.env.PLANNER_REQUEST_TIMEOUT_MS, 58000),
    frontendGenerationTimeoutMs: positiveNumber(process.env.FRONTEND_GENERATION_TIMEOUT_MS, 70000),
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
  if (config.production && config.placeProvider === "mock") placeMissing.push("LIVE_PLACE_PROVIDER_REQUIRED");
  if (config.production && config.routeProvider === "mock") routeMissing.push("LIVE_ROUTE_PROVIDER_REQUIRED");
  if (config.production && config.routeProvider === "approximate") routeMissing.push("LIVE_ROUTE_PROVIDER_REQUIRED");
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

function positiveNumber(value, fallback) {
  const parsed = Number(cleanEnv(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeProviderStatus(provider, missing, canGenerate) {
  return {
    configured: missing.length === 0,
    provider: provider || "not configured",
    missingVariables: [],
    status: missing.length === 0 ? "available" : canGenerate ? "degraded" : "temporarily unavailable"
  };
}
