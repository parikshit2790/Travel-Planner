import { providerConfig, providerStatus } from "../lib/env.js";
import { requirePost, sendJson } from "../lib/http.js";

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
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
  sendJson(res, 200, publicStatus);
}
