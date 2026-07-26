import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const domain = fs.readFileSync(new URL("../src/domain.js", import.meta.url), "utf8");

assert.ok(app.includes("tripStructureSection(trip)"), "Trip Basics must render Trip Structure section");
assert.ok(app.includes("routeRecommendationStep()"), "Wizard must include route recommendation step");
assert.ok(app.includes("Approve your trip shape before daily planning."), "Route approval screen copy should be present");
assert.ok(app.includes("approveRouteOption(state.trip"), "Route approval action must store approved shape");
assert.ok(app.includes("routeRecommendationRequired(state.trip) && !approvedRouteStillValid(state.trip)"), "Build flow must gate on route approval");
assert.ok(app.includes("Fewer Hotel Changes"));
assert.ok(app.includes("Reduce Driving"));
assert.ok(app.includes("More Variety"));
assert.ok(app.includes("Keep One Base"));
assert.ok(app.includes("Regenerate Route Options"));

assert.ok(domain.includes("routePreferences"));
assert.ok(domain.includes("approvedTripShape"));
assert.ok(domain.includes("routeOptions"));

assert.ok(css.includes(".trip-structure-options"));
assert.ok(css.includes(".route-option-grid"));
assert.ok(css.includes(".approved-route-preview"));
assert.ok(css.includes(".route-action-strip"));
assert.ok(css.includes(".trip-structure-options, .route-detail-grid, .route-option-grid { grid-template-columns: 1fr; }"), "Mobile layout should stack route controls");

console.log("Route workflow UI tests passed");
