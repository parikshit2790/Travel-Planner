import { providerConfig, providerStatus } from "./env.js";

export function handleProviderHealthAction(action) {
  if (!["status", "provider-status", "providers/status", ""].includes(action)) {
    return { status: 400, body: { success: false, error: { code: "UNKNOWN_ACTION", message: "Unknown provider-health action.", retryable: false } } };
  }
  const config = providerConfig();
  const includeDiagnostics = config.development;
  const status = providerStatus(config, { includeDiagnostics });
  const publicStatus = {
    available: status.available,
    status: status.status,
    canGenerate: status.canGenerate,
    placeProvider: status.placeProvider,
    routeProvider: status.routeProvider,
    weatherProvider: status.weatherProvider,
    aiProvider: status.aiProvider,
    publicMessage: status.publicMessage,
    checkedAt: status.checkedAt
  };
  if (includeDiagnostics) publicStatus.diagnostics = status.diagnostics;
  return { status: 200, body: publicStatus };
}
