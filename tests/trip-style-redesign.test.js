import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addOrUpdatePreference,
  countSelectedExperiences,
  createTripDraft,
  experienceCategories,
  getUniqueSelectedExperiences,
  importanceWeights,
  preference,
  reconcileTripStylePreferences
} from "../src/domain.js";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");

const trip = createTripDraft();
trip.preferences = [
  preference("experiences", "Lakes", "Must have"),
  preference("experiences", "Waterfalls", "Strong preference"),
  preference("experiences", "Urban", "Neutral"),
  preference("environment", "Nature", "Must have"),
  preference("atmosphere", "Relaxed", "Strong preference")
];
trip.preferences[2].weight = importanceWeights.Neutral;
reconcileTripStylePreferences(trip);

assert.equal(countSelectedExperiences(trip), 2);
assert.deepEqual(getUniqueSelectedExperiences(trip).map((pref) => pref.label), ["Lakes", "Waterfalls"]);
assert.ok(!getUniqueSelectedExperiences(trip).some((pref) => pref.importance === "Neutral"));
assert.ok(!trip.preferences.some((pref) => pref.category === "environment" && pref.label === "Nature"));
assert.equal(trip.style.balance, "Balanced");

addOrUpdatePreference(trip, "experiences", "Scenic Train Ride", "Nice to have", "Custom Experience");
addOrUpdatePreference(trip, "experiences", "Scenic Train Ride", "Must have", "Custom Experience");
assert.equal(countSelectedExperiences(trip), 3);
assert.equal(getUniqueSelectedExperiences(trip).find((pref) => pref.label === "Scenic Train Ride").importance, "Must have");

assert.deepEqual(Object.keys(experienceCategories), [
  "Nature and Scenery",
  "Outdoor Activities",
  "Water Experiences",
  "City and Culture",
  "Relaxation",
  "Entertainment",
  "Special Experiences",
  "Seasonal Experiences"
]);

assert.ok(app.includes("Selected Priorities"));
assert.ok(app.includes("styleSelectControl(\"trip.style.balance\""));
assert.ok(app.includes("Core Style"));
assert.ok(app.includes("Nature-Focused"));
assert.ok(app.includes("Experience Categories"));
assert.ok(app.includes("category-grid"));
assert.ok(app.includes("category-row"));
assert.ok(app.includes("experienceCategoryIcon"));
assert.ok(app.includes("experienceCategoryDescription"));
assert.ok(app.includes("priority-card"));
assert.ok(app.includes("priority-add-card"));
assert.ok(app.includes("aria-label=\"${esc(`${selected.length ? \"Edit\" : \"Add\"} ${category} experiences`)}\""));
assert.ok(app.includes("Add a Specific Experience"));
assert.ok(app.includes("activeImportanceOptions()"));
assert.ok(app.includes("clearExperience:"));
assert.ok(app.includes("View All ${selected.length} Selected Experiences"));
assert.ok(app.includes("That experience is already selected."));
assert.ok(!app.includes("category-table-wrap"));
assert.ok(!app.includes("category-table"));
assert.ok(!app.includes("Strongly Nature"));
assert.ok(!app.includes("Strongly Urban"));
assert.ok(!app.includes("Very Lively"));
assert.ok(!app.includes("Neutral experiences"));
assert.ok(!app.includes("full-width Remove"));

const styleStep = app.match(/function styleStep\(\) \{([\s\S]*?)\nfunction preferencePicker/)?.[1] || "";
assert.ok(!styleStep.includes("optionSets.environment"));
assert.ok(!styleStep.includes("class=\"panel\""));
assert.ok(!styleStep.includes("badge(`${selected.length} selected`)"));

assert.ok(css.includes(".premium-section"));
assert.ok(css.includes(".style-select-control"));
assert.ok(css.includes(".category-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));"));
assert.ok(css.includes(".category-grid { grid-template-columns: 1fr; }"));
assert.ok(css.includes(".category-row"));
assert.ok(css.includes(".category-summary"));
assert.ok(css.includes(".priority-card-grid"));
assert.ok(css.includes(".priority-add-card"));
assert.ok(css.includes("text-overflow: ellipsis"));
assert.ok(!css.includes(".trip-style-screen .category-table-wrap { max-height"));
assert.ok(!css.includes(".trip-style-screen .category-table-wrap"));
assert.ok(!css.includes("category-table-wrap"));
assert.ok(css.includes(".experience-dialog"));
assert.ok(css.includes(".custom-experience-row"));
assert.ok(css.includes(".icon-button"));

console.log("Trip style redesign tests passed");
