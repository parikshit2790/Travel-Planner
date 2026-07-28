const LIVE_DESTINATION_PROVIDERS = new Set(["openai", "google", "openrouteservice"]);
const LIVE_ROUTE_PROVIDERS = new Set(["google", "openrouteservice"]);
const BLOCKED_PROFILE_PROVIDERS = new Set(["mock", "curated", "generated-provider", "unknown"]);

export function buildPlanningSourceDiagnostics(config, destinationProfile = null) {
  const destinationSource = destinationResearchSource(config, destinationProfile);
  const routeSource = LIVE_ROUTE_PROVIDERS.has(config.routeProvider) ? config.routeProvider : "unavailable";
  const usedMockProvider = config.placeProvider === "mock"
    || config.routeProvider === "mock"
    || profileProvider(destinationProfile) === "mock";
  const usedPresetPlan = isPresetDestinationProfile(destinationProfile);
  return {
    planningMode: config.production ? "live" : usedMockProvider ? "mock" : "live",
    destinationResearchSource: destinationSource,
    routeSource,
    itinerarySource: "generated",
    usedPresetPlan,
    usedMockProvider,
    usedTestFixture: usedMockProvider,
    productionSafe: config.production ? !usedPresetPlan && !usedMockProvider && LIVE_ROUTE_PROVIDERS.has(config.routeProvider) && isLiveDestinationProfile(destinationProfile) : true
  };
}

export function assertProductionPlanningSafety(config, destinationProfile, diagnostics = buildPlanningSourceDiagnostics(config, destinationProfile)) {
  if (!config.production) return;
  if (config.placeProvider === "mock" || config.routeProvider === "mock") {
    throw productionSafetyError("MOCK_PROVIDER_BLOCKED", "Live trip generation is temporarily unavailable. Please try again later.");
  }
  if (!LIVE_ROUTE_PROVIDERS.has(config.routeProvider)) {
    throw productionSafetyError("LIVE_ROUTE_PROVIDER_REQUIRED", "Live trip generation is temporarily unavailable. Please try again later.");
  }
  if (!destinationProfile || !isLiveDestinationProfile(destinationProfile)) {
    throw productionSafetyError("LIVE_DESTINATION_RESEARCH_REQUIRED", "We could not build a reliable live destination profile for this trip yet. Please retry.");
  }
  if (diagnostics.usedPresetPlan || diagnostics.usedMockProvider || diagnostics.usedTestFixture || diagnostics.itinerarySource !== "generated") {
    throw productionSafetyError("PRESET_PLAN_BLOCKED", "We could not build a reliable live destination profile for this trip yet. Please retry.");
  }
}

export function isLiveDestinationProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  const provider = profileProvider(profile);
  if (!LIVE_DESTINATION_PROVIDERS.has(provider)) return false;
  if (String(profile.id || "").startsWith("generic-")) return false;
  if (!Array.isArray(profile.places) || profile.places.length < 1) return false;
  return true;
}

export function isPresetDestinationProfile(profile) {
  if (!profile || typeof profile !== "object") return true;
  const id = String(profile.id || "");
  const provider = profileProvider(profile);
  const freshness = String(profile.sourceMetadata?.freshness || "");
  if (id.startsWith("generic-")) return true;
  if (BLOCKED_PROFILE_PROVIDERS.has(provider)) return true;
  return /curated|fixture|sample|preset|static|local-profile/i.test(freshness);
}

function destinationResearchSource(config, profile) {
  const provider = profileProvider(profile);
  if (provider === "openai" && config.placeProvider && LIVE_ROUTE_PROVIDERS.has(config.placeProvider)) return `${config.placeProvider}-and-openai`;
  if (provider === "openai") return "openai";
  if (provider === "google") return config.aiProvider === "openai" ? "google-and-openai" : "google";
  if (provider === "openrouteservice") return config.aiProvider === "openai" ? "openrouteservice-and-openai" : "openrouteservice";
  return "unavailable";
}

function profileProvider(profile) {
  return String(profile?.sourceMetadata?.provider || "").toLowerCase();
}

function productionSafetyError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = code === "MOCK_PROVIDER_BLOCKED" || code === "LIVE_ROUTE_PROVIDER_REQUIRED" ? 503 : 422;
  error.retryable = true;
  return error;
}
