import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");

assert.ok(css.includes("main { min-width: 0;"));
assert.ok(css.includes("repeat(2, minmax(0, 1fr))"));
assert.ok(css.includes(".compact-grid > *, .review-grid > *"));
assert.ok(css.includes(".compact-section table, .review-card table, .issue-table table { min-width: 0; table-layout: fixed; }"));
assert.ok(css.includes("overflow-wrap: anywhere"));
assert.ok(css.includes("padding: 28px 30px 96px"));
assert.ok(css.includes("@media (max-width: 1280px)"));
assert.ok(css.includes(".comfort-card-grid, .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }"));
assert.ok(css.includes(".status-grid, .form-grid, .chip-grid, .split, .compact-grid, .comfort-card-grid, .review-grid, .food-summary-layout, .food-detail-row { grid-template-columns: 1fr; }"));

// comfortStep() was removed -- Daily Schedule and Physical Comfort moved
// into styleStep(); Transportation Limits (Electric Vehicle Charging Needs,
// Prefer Fastest Route, Use Tolls When Helpful, Interested in Ferries,
// comfort-tip) was dropped entirely with no replacement.
const styleStep = app.match(/function styleStep\(\) \{([\s\S]*?)(?=\nfunction \w)/)?.[1] || "";
const reviewStep = app.match(/function reviewStep\(\) \{([\s\S]*?)\nfunction quickInterpretTable/)?.[1] || "";

assert.ok(styleStep.includes("Hiking is not currently selected as an interest."));
assert.ok(styleStep.includes("Add Hiking Interest"));
assert.ok(styleStep.includes("comfortCard(1"));
assert.ok(styleStep.includes("stepIssueTable"));
assert.ok(!styleStep.includes("Latest end"));
assert.ok(!styleStep.includes("Dinner time"));
assert.ok(!app.includes("Electric Vehicle Charging Needs"), "Transportation Limits card was dropped");
assert.ok(!app.includes("Prefer Fastest Route"), "Transportation Limits card was dropped");
assert.ok(!app.includes("Use Tolls When Helpful"), "Transportation Limits card was dropped");
assert.ok(!app.includes("Interested in Ferries"), "Transportation Limits card was dropped");
assert.ok(!app.includes("comfort-tip"), "Transportation Limits card was dropped");

assert.ok(reviewStep.includes("Ready with Warnings"));
assert.ok(reviewStep.includes("Ready to Build"));
assert.ok(reviewStep.includes("issues.length"));
assert.ok(reviewStep.includes("Build My Trip"));
assert.ok(reviewStep.includes("reviewIssuesCard"));
assert.ok(app.includes("topExperienceSummary"));
assert.ok(!reviewStep.includes("Complete"));
assert.ok(!reviewStep.includes("Preference importance"));
assert.ok(app.includes("displayValue(value"));
assert.ok(app.includes("Not Provided"));
assert.ok(app.includes("Not Selected"));
assert.ok(app.includes("getTripIssues(state.trip)"));

console.log("Comfort and review layout tests passed");
