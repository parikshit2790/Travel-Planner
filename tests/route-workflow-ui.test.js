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
assert.ok(!app.includes("state.activeStep === 2 && routeRecommendationRequired(state.trip)"), "Route approval must not replace Step 2 Trip Style");
assert.ok(app.includes("state.activeStep === 4 && routeRecommendationRequired(state.trip)"), "Route approval should live at the Review/build boundary");
assert.ok(!app.includes("Choose and approve a route shape before traveler details."), "Trip Basics Continue must not force route approval before Travelers");
assert.ok(app.includes("Fewer Hotel Changes"));
assert.ok(app.includes("Reduce Driving"));
assert.ok(app.includes("More Variety"));
assert.ok(app.includes("Keep One Base"));
assert.ok(app.includes("Regenerate Route Options"));

assert.ok(domain.includes("routePreferences"));
assert.ok(domain.includes("approvedTripShape"));
assert.ok(domain.includes("routeOptions"));

assert.ok(css.includes(".trip-structure-options"));
assert.ok(css.includes(".structure-one-city"));
assert.ok(css.includes(".structure-one-base-day-trips"));
assert.ok(css.includes(".structure-multi-city"));
assert.ok(css.includes(".structure-recommend"));
assert.ok(css.includes(".route-shaping-fields"));
assert.ok(css.includes(".comfort-prep-fields"));
assert.ok(css.includes(".route-option-grid"));
assert.ok(css.includes(".approved-route-preview"));
assert.ok(css.includes(".route-action-strip"));
assert.ok(css.includes(".trip-structure-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }"), "Tablet layout should use two-column route controls");
assert.ok(css.includes(".trip-structure-options, .route-detail-grid, .route-option-grid { grid-template-columns: 1fr; }"), "Mobile layout should stack route controls");

console.log("Route workflow UI tests passed");
