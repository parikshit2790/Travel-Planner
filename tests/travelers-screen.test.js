import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");

// The standalone Travelers step (per-traveler table + restriction popover)
// was replaced by a compact group-level Special Needs field living on Trip
// Basics, inside a new "Who's Traveling" section.
assert.ok(app.includes("function whosTravelingSection"));
assert.ok(app.includes("Who's Traveling"));
assert.ok(app.includes("function specialNeedsField"));
assert.ok(app.includes("special-needs-field"));
assert.ok(app.includes("special-needs-cell"));
assert.ok(app.includes("Special Needs"));
assert.ok(app.includes("compact-chip-grid"));
assert.ok(app.includes("travelerRestrictionOptions"));
assert.ok(app.includes("Describe the Other special need"));
assert.ok(app.includes("trip.specialNeedsOtherText"));

assert.ok(!app.includes("function travelersStep"));
assert.ok(!app.includes("function travelerTable"));
assert.ok(!app.includes("function restrictionOverlay"));
assert.ok(!app.includes("function restrictionPopover"));
assert.ok(!app.includes("function positionRestrictionOverlay"));
assert.ok(!app.includes("data-restriction-trigger"));
assert.ok(!app.includes("Individual Restrictions or Accessibility Needs"));
assert.ok(!app.includes("Shared Preferences"));
assert.ok(!app.includes("Add details only when a traveler has an individual restriction"));

assert.ok(css.includes(".special-needs-cell"));
assert.ok(css.includes(".compact-chip-grid"));
assert.ok(css.includes(".compact-chip "));
assert.ok(!css.includes(".restriction-popover"));

console.log("Travelers screen tests passed");
