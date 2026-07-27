import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialState } from "../src/seed.js";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");

const placeholder = "We are visiting Southern California for five days. We want famous LA highlights, scenic coastal views, vegetarian-friendly food, and relaxed evenings. We are open to adding San Diego, Santa Barbara, or another nearby destination if it improves the trip without excessive driving or hotel changes. We will fly in, rent a car, and prefer no more than three hours of driving per day.";
const sample = placeholder;
const helper = "Describe what would make this trip feel successful—must-do places, nearby cities you are considering, pace, special occasions, food priorities, and anything you want us to avoid.";

assert.equal(initialState.trip.description, "");
assert.ok(app.includes(`const TRIP_DESCRIPTION_PLACEHOLDER = "${placeholder}"`));
assert.ok(app.includes(`const TRIP_DESCRIPTION_SAMPLE = "${sample}"`));
assert.ok(app.includes(`const TRIP_DESCRIPTION_HELPER = "${helper}"`));
assert.ok(app.includes('placeholder="${esc(TRIP_DESCRIPTION_PLACEHOLDER)}"'));
assert.ok(app.includes('aria-describedby="trip-description-helper"'));
assert.ok(app.includes('id="trip-description-helper"'));
assert.ok(app.includes('data-action="useSampleDescription"'));
assert.ok(app.includes('type="button" class="sample-description-button"'));
assert.ok(app.includes("View Example"));
assert.ok(app.includes('data-action="viewTripDescriptionExample"'));
assert.ok(app.includes("Use Sample Description"));
assert.ok(app.includes("Sample added"));
assert.ok(app.includes('if (existing && existing !== TRIP_DESCRIPTION_SAMPLE && !confirm("Replace the existing trip description with the sample?")) return;'));
assert.ok(app.includes("state.trip.description = TRIP_DESCRIPTION_SAMPLE;"));
assert.ok(app.includes("state.trip.originalText = TRIP_DESCRIPTION_SAMPLE;"));
assert.ok(!app.includes("state.trip.description = TRIP_DESCRIPTION_PLACEHOLDER"));
assert.ok(!app.includes("state.trip.originalText = TRIP_DESCRIPTION_PLACEHOLDER"));
assert.ok(!app.includes("interpretFreeText(TRIP_DESCRIPTION_PLACEHOLDER"));
assert.ok(!app.includes("routeMosaicApi.researchDestination({"));
assert.ok(app.includes("routeMosaicApi.researchDestination(state.trip)"));
assert.ok(!app.includes('["Description", trip.description]'));
assert.ok(!app.includes('["Trip Description", trip.description]'));
assert.ok(css.includes("textarea::placeholder"));
assert.ok(css.includes("opacity: 1"));
assert.ok(css.includes("font-style: normal"));
assert.ok(css.includes(".trip-description-help-row"));
assert.ok(css.includes("flex-direction: column"));
assert.ok(css.includes(".sample-description-button"));

console.log("Trip description placeholder tests passed");
