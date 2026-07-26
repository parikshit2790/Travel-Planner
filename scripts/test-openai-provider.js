import { providerConfig } from "../server/lib/env.js";
import { openAiSmokeCheck } from "../server/lib/openai-destination-provider.js";

const config = providerConfig();

try {
  const result = await openAiSmokeCheck(config);
  console.log("OpenAI provider: PASS");
  console.log(`Provider: ${config.aiProvider || "none"}`);
  console.log(`Model: ${result.model}`);
  console.log(`HTTP status: ${result.httpStatus}`);
  console.log("Structured response: valid");
  console.log(`Duration: ${result.durationMs} ms`);
} catch (error) {
  console.log("OpenAI provider: FAIL");
  console.log(`Provider: ${config.aiProvider || "none"}`);
  console.log(`Model: ${config.aiModel || "not configured"}`);
  console.log(`Code: ${sanitize(error?.code)}`);
  console.log(`HTTP status: ${Number(error?.status || 0)}`);
  process.exit(1);
}

function sanitize(value) {
  return String(value || "AI_PROVIDER_UNAVAILABLE").replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
}
