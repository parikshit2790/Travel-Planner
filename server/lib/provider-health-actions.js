import { providerConfig, providerStatus } from "./env.js";
import { googleProviderHealthCheck } from "./google-provider.js";
import { openAiSmokeCheck } from "./openai-destination-provider.js";

export async function handleProviderHealthAction(action) {
  if (!["status", "provider-status", "providers/status", ""].includes(action)) {
    return { status: 400, body: { success: false, error: { code: "UNKNOWN_ACTION", message: "Unknown provider-health action.", retryable: false } } };
  }
  const config = providerConfig();
  const includeDiagnostics = config.development;
  const status = providerStatus(config, { includeDiagnostics });
  const requestId = requestIdFor("provider-health");
  const liveChecks = await runLiveChecks(config, requestId);
  const publicStatus = {
    canGenerate: liveChecks ? liveChecks.canGenerate : status.canGenerate,
    mode: liveChecks ? liveChecks.mode : status.mode,
    aiProviderAvailable: liveChecks ? liveChecks.aiProviderAvailable : status.aiProvider.status === "available",
    placeProviderAvailable: liveChecks ? liveChecks.placeProviderAvailable : status.placeProviderAvailable,
    destinationResearchAvailable: liveChecks ? liveChecks.destinationResearchAvailable : status.destinationResearchAvailable,
    routeProviderAvailable: liveChecks ? liveChecks.routeProviderAvailable : status.routeProviderAvailable,
    weatherProviderAvailable: status.weatherProviderAvailable,
    publicMessage: liveChecks && !liveChecks.canGenerate ? "Trip generation is temporarily unavailable. Please try again later." : status.publicMessage,
    checkedAt: status.checkedAt
  };
  if (includeDiagnostics) publicStatus.diagnostics = { ...(status.diagnostics || {}), liveChecks: liveChecks?.diagnostics || null };
  return { status: 200, body: publicStatus };
}

async function runLiveChecks(config, requestId) {
  if (config.placeProvider !== "google" && config.routeProvider !== "google" && config.aiProvider !== "openai") return null;
  const [ai, google] = await Promise.all([
    config.aiProvider === "openai" ? smokeOperation(requestId, "openai", "responses-smoke", () => openAiSmokeCheck(config)) : Promise.resolve({ success: false, errorCode: "PROVIDER_CONFIGURATION_REQUIRED" }),
    config.placeProvider === "google" || config.routeProvider === "google" ? googleProviderHealthCheck(config, { requestId }) : Promise.resolve(null)
  ]);
  const aiProviderAvailable = ai.success;
  const placeProviderAvailable = config.placeProvider === "google" ? Boolean(google?.placeProviderAvailable) : false;
  const destinationResearchAvailable = config.placeProvider === "google" ? Boolean(google?.destinationResearchAvailable) : false;
  const routeProviderAvailable = config.routeProvider === "google" ? Boolean(google?.routeProviderAvailable) : false;
  const canGenerate = aiProviderAvailable && placeProviderAvailable && destinationResearchAvailable && routeProviderAvailable;
  return {
    canGenerate,
    mode: canGenerate ? "live" : "unavailable",
    aiProviderAvailable,
    placeProviderAvailable,
    destinationResearchAvailable,
    routeProviderAvailable,
    diagnostics: { ai, google }
  };
}

async function smokeOperation(requestId, provider, operation, callback) {
  const startedAt = Date.now();
  const config = providerConfig();
  const base = provider === "openai"
    ? { requestId, provider, operation, adapterInitialized: true, requestStarted: true, model: config.aiModel, keyPresent: Boolean(config.aiApiKey) }
    : { requestId, provider, operation, adapterInitialized: true, requestStarted: true };
  console.info("[RouteMosaic provider-health]", JSON.stringify(base));
  try {
    const result = await callback();
    const safe = {
      success: true,
      httpStatus: result?.httpStatus || 200,
      errorCode: "",
      durationMs: result?.durationMs ?? Date.now() - startedAt,
      ...(provider === "openai" ? { model: result?.model || config.aiModel, keyPresent: Boolean(config.aiApiKey) } : {})
    };
    console.info("[RouteMosaic provider-health]", JSON.stringify({ requestId, provider, operation, ...safe }));
    return safe;
  } catch (error) {
    const safe = {
      success: false,
      httpStatus: error?.status || 0,
      errorCode: sanitizeErrorCode(error?.code),
      durationMs: Date.now() - startedAt,
      ...(provider === "openai" ? { model: config.aiModel, keyPresent: Boolean(config.aiApiKey) } : {})
    };
    console.info("[RouteMosaic provider-health]", JSON.stringify({ requestId, provider, operation, ...safe }));
    return safe;
  }
}

function requestIdFor(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeErrorCode(code) {
  return String(code || "PROVIDER_UNAVAILABLE").replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
}
