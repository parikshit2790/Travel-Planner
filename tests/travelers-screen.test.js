import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");

assert.ok(app.includes("Restrictions or Needs"));
assert.ok(app.includes("Individual Restrictions or Accessibility Needs"));
assert.ok(app.includes("restrictionOverlay()"));
assert.ok(app.includes("restriction-popover"));
assert.ok(app.includes("restriction-layer"));
assert.ok(app.includes("restriction-trigger"));
assert.ok(app.includes("data-restriction-trigger"));
assert.ok(app.includes("positionRestrictionOverlay"));
assert.ok(app.includes("Clear all"));
assert.ok(app.includes("Done"));
assert.ok(app.includes("Describe the restriction or need"));
assert.ok(app.includes("Avoid seafood"));
assert.ok(app.includes("Food and Dietary"));
assert.ok(app.includes("Mobility and Accessibility"));
assert.ok(app.includes("Shared Preferences"));
assert.ok(app.includes("Yes"));
assert.ok(app.includes("No"));
assert.ok(app.includes("Add details only when a traveler has an individual restriction, accessibility need, or preference that differs from the rest of the group."));
assert.ok(!app.includes("Group counts are the source of truth"));
assert.ok(!app.includes("Traveler setup is consistent"));
assert.ok(!app.includes("Gender"));
assert.ok(!app.includes("Shared preferences\", \"Traveler-specific preferences"));
assert.ok(!app.includes("small-chip-grid\">${travelerRestrictionOptions"));
assert.ok(!app.includes("${isOpen ? restrictionPopover(traveler) : \"\"}"));
assert.ok(css.includes(".restriction-popover"));
assert.ok(css.includes("position: fixed"));
assert.ok(css.includes(".restriction-layer"));
assert.ok(css.includes(".restriction-options { overflow: auto"));
assert.ok(css.includes("max-height: min(72vh, 620px)"));

console.log("Travelers screen tests passed");
