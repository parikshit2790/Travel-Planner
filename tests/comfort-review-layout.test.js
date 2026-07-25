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

const comfortStep = app.match(/function comfortStep\(\) \{([\s\S]*?)\nfunction reviewStep/)?.[1] || "";
const reviewStep = app.match(/function reviewStep\(\) \{([\s\S]*?)\nfunction quickInterpretTable/)?.[1] || "";

assert.ok(comfortStep.includes("Hiking is not currently selected as an interest."));
assert.ok(comfortStep.includes("Add Hiking Interest"));
assert.ok(comfortStep.includes("Electric Vehicle Charging Needs"));
assert.ok(comfortStep.includes("evRelevant ?"));
assert.ok(comfortStep.includes("comfortCard(1"));
assert.ok(comfortStep.includes("comfort-tip"));
assert.ok(comfortStep.includes("Prefer Fastest Route"));
assert.ok(comfortStep.includes("Use Tolls When Helpful"));
assert.ok(comfortStep.includes("Interested in Ferries"));
assert.ok(comfortStep.includes("stepIssueTable"));
assert.ok(!comfortStep.includes("Latest end"));
assert.ok(!comfortStep.includes("Dinner time"));

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
