import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const assets = [
  "header-trip-basics.png",
  "header-travelers.png",
  "header-trip-style.png",
  "header-food-evenings.png",
  "header-comfort-budget.png",
  "header-review.png"
];

for (const asset of assets) {
  assert.ok(existsSync(`src/assets/${asset}`), `${asset} should exist`);
  assert.ok(statSync(`src/assets/${asset}`).size > 2000, `${asset} should not be empty`);
  assert.ok(app.includes(asset), `${asset} should be wired in app.js`);
}

assert.ok(app.includes("?v=43"));

console.log("Header asset tests passed");
