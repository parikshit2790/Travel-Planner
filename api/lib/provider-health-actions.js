import { providerConfig, providerStatus } from "./env.js";

export function handleProviderHealthAction(action) {
  if (!["status", "provider-status", "providers/status", ""].includes(action)) {
    return { status: 400, body: { success: false, error: { code: "UNKNOWN_ACTION", message: "Unknown provider-health action.", retryable: false } } };
  }
  const config = providerConfig();
  const includeDiagnostics = config.development;
  const status = providerStatus(config, { includeDiagnostics });
  const publicStatus = {
    canGenerate: status.canGenerate,
    mode: status.mode,
    placeProviderAvailable: status.placeProviderAvailable,
    destinationResearchAvailable: status.destinationResearchAvailable,
    routeProviderAvailable: status.routeProviderAvailable,
    weatherProviderAvailable: status.weatherProviderAvailable,
    publicMessage: status.publicMessage,
    checkedAt: status.checkedAt
  };
  if (includeDiagnostics) publicStatus.diagnostics = status.diagnostics;
  return { status: 200, body: publicStatus };
}
