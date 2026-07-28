import fs from "node:fs";
import path from "node:path";

const failures = [];

checkFileDoesNotContain("server/lib/planner-actions.js", [
  "resolveDestinationProfile",
  "provider: \"curated\"",
  "curated-local-profile",
  "Try the Los Angeles sample or configure live providers"
]);

checkFileDoesNotContain("src/app.js", [
  "recoverUnsupportedPlan",
  "resolveDestinationProfile",
  "RouteMosaic did not substitute Los Angeles"
]);

checkFileContains("src/destination-data.js", [
  "staticDestinationProfilesEnabled",
  "process.env.NODE_ENV === \"production\"",
  "process.env.VERCEL_ENV === \"production\""
]);

checkFileContains("server/lib/production-safeguards.js", [
  "MOCK_PROVIDER_BLOCKED",
  "PRESET_PLAN_BLOCKED",
  "usedPresetPlan",
  "usedMockProvider",
  "itinerarySource: \"generated\""
]);

const apiFunctions = fs.readdirSync("api").filter((entry) => /\.(js|ts)$/.test(entry));
if (apiFunctions.length > 12) {
  failures.push(`api has ${apiFunctions.length} serverless functions; keep it at 12 or fewer.`);
}

const apiSurface = JSON.stringify(readFiles(["api", "server/lib"]));
["OPENROUTESERVICE_API_KEY=", "GOOGLE_MAPS_API_KEY=", "OPENAI_API_KEY=", "sk-"].forEach((secretMarker) => {
  if (apiSurface.includes(secretMarker)) failures.push(`Production server code appears to include a secret marker: ${secretMarker}`);
});

if (failures.length) {
  console.error("Hardcoded plan verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Hardcoded plan verification passed");

function checkFileContains(file, needles) {
  const text = fs.readFileSync(file, "utf8");
  needles.forEach((needle) => {
    if (!text.includes(needle)) failures.push(`${file} must contain ${needle}`);
  });
}

function checkFileDoesNotContain(file, needles) {
  const text = fs.readFileSync(file, "utf8");
  needles.forEach((needle) => {
    if (text.includes(needle)) failures.push(`${file} must not contain ${needle}`);
  });
}

function readFiles(entries) {
  return entries.flatMap((entry) => {
    const stat = fs.statSync(entry);
    if (stat.isFile()) return [{ file: entry, text: fs.readFileSync(entry, "utf8") }];
    return fs.readdirSync(entry).flatMap((child) => readFiles([path.join(entry, child)]));
  });
}
