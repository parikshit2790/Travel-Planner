import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/app.js", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const manifest = fs.readFileSync("manifest.webmanifest", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const build = fs.readFileSync("scripts/build.js", "utf8");
const api = fs.readFileSync("api/destination-profile.js", "utf8");
const robots = fs.readFileSync("robots.txt", "utf8");
const sitemap = fs.readFileSync("sitemap.xml", "utf8");
const vercel = fs.readFileSync("vercel.json", "utf8");

assert.ok(index.includes("RouteMosaic — Personalized Trip Planner"));
assert.ok(index.includes('rel="canonical" href="https://www.routemosaic.com/"'));
assert.ok(index.includes('property="og:image"'));
assert.ok(index.includes('name="twitter:card"'));
assert.ok(index.includes('rel="icon"'));
assert.ok(manifest.includes("description"));
assert.ok(manifest.includes("/public/favicon.svg"));
assert.ok(robots.includes("Sitemap: https://www.routemosaic.com/sitemap.xml"));
assert.ok(sitemap.includes("https://www.routemosaic.com/privacy"));
assert.ok(vercel.includes("\"destination\": \"/index.html\""));
assert.ok(vercel.includes("api/.*"));
assert.ok(sw.includes("routemosaic-public-v49"));
assert.ok(sw.includes("/src/planner.js"));
assert.ok(sw.includes("event.request.mode === \"navigate\""));
assert.ok(sw.includes("url.pathname.startsWith(\"/src/\")"));
assert.ok(build.includes('copyFileSync("robots.txt"'));
assert.ok(build.includes('cpSync("public"'));
assert.ok(api.includes("validatePlanningProviders"));
assert.ok(api.includes("PROVIDER_CONFIGURATION_REQUIRED"));
assert.ok(api.includes("mockDestinationResearch"));

assert.ok(app.includes("function renderStaticInfoPage"));
assert.ok(app.includes("/privacy"));
assert.ok(app.includes("/terms"));
assert.ok(app.includes("/travel-disclaimer"));
assert.ok(app.includes("/contact"));
assert.ok(app.includes("support@routemosaic.com"));
assert.ok(app.includes("Print / Save as PDF"));
assert.ok(app.includes("window.print()"));
assert.ok(app.includes("Planning estimates—not live availability"));
assert.ok(app.includes("Suggested Hotel Base"));
assert.ok(app.includes("Saved Trips"));
assert.ok(app.includes("Delete"));
assert.ok(app.includes("Duplicate"));
assert.ok(app.includes("Rename"));

assert.ok(css.includes("@media print"));
assert.ok(css.includes(".static-card"));
assert.ok(css.includes(".sample-trip-panel"));
assert.ok(css.includes(".saved-trips-drawer"));
assert.ok(css.includes(".global-footer"));

console.log("Launch hardening tests passed");
