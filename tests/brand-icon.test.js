import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/app.js", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
const favicon = fs.readFileSync("public/favicon.svg", "utf8");
const publicFiles = fs.readdirSync("public");
const requiredIcons = [
  "favicon.svg",
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png"
];

assert.ok(app.includes("function BrandIcon()"));
assert.ok(app.includes("/public/favicon.svg?v=51"));
assert.ok(!app.includes("<i></i><i></i><i></i><i></i>"));
assert.ok(css.includes(".brand-icon"));
assert.ok(!css.includes(".brand-mark i:nth-child"));

for (const icon of requiredIcons) {
  assert.ok(publicFiles.includes(icon), `${icon} should exist`);
  assert.ok(fs.statSync(`public/${icon}`).size > 100, `${icon} should not be empty`);
  assert.ok(index.includes(`/public/${icon}`) || manifest.icons.some((entry) => entry.src === `/public/${icon}`), `${icon} should be referenced`);
}

assert.ok(favicon.includes("RouteMosaic travel route planner icon"));
assert.ok(favicon.includes("stroke-dasharray"));
assert.ok(favicon.includes("#FF6B00"));
assert.ok(favicon.includes("#16A9CE"));

assert.equal(publicFiles.includes("file.svg"), false);
assert.equal(publicFiles.includes("globe.svg"), false);
assert.equal(publicFiles.includes("window.svg"), false);

console.log("Brand icon tests passed");
