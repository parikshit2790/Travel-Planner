import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  countUniqueActivePreferences,
  countSelectedExperiences,
  createTripDraft,
  getUniqueSelectedExperiences,
  preferenceOwners,
  removeDuplicatePreferences,
  upsertCanonicalPreference
} from "../src/domain.js";

const app = readFileSync("src/app.js", "utf8");
const stepBodies = Object.fromEntries([...app.matchAll(/function (\w+Step)\(\) \{([\s\S]*?)(?=\nfunction \w)/g)].map(([, name, body]) => [name, body]));

assert.equal(preferenceOwners["schedule.pace"], 5);
assert.equal(preferenceOwners["food.diet"], 4);
assert.equal(preferenceOwners["travelers.restrictions"], 2);
assert.equal(preferenceOwners["trip.transportation"], 1);
assert.equal(preferenceOwners["budget.total"], 5);

assert.ok(stepBodies.basicsStep.includes("Transportation"));
assert.ok(!stepBodies.basicsStep.includes("Pace"));
assert.ok(!stepBodies.basicsStep.includes("Major Activities per Day"));
assert.ok(stepBodies.comfortStep.includes("Pace"));
assert.ok(stepBodies.comfortStep.includes("Major Activities per Day"));
assert.ok(!stepBodies.comfortStep.includes("Dinner time"));
assert.ok(!stepBodies.foodStep.includes("Latest Return"));
assert.ok(stepBodies.foodStep.includes("Preferred Dinner Time"));
assert.ok(stepBodies.foodStep.includes("Food Budget per Person"));
assert.ok(!stepBodies.comfortStep.includes("Food Budget per Person"));
assert.ok(stepBodies.comfortStep.includes("Total Budget"));
assert.ok(!stepBodies.foodStep.includes("Total Budget"));

assert.ok(stepBodies.styleStep.includes("Experience Categories"));
assert.ok(stepBodies.styleStep.includes("Selected Priorities"));
assert.ok(!stepBodies.styleStep.includes("optionSets.environment"));
assert.ok(stepBodies.styleStep.includes("styleSelectControl"));
assert.ok(stepBodies.styleStep.includes("Core Style"));
assert.ok(app.includes("styleDisplayLabel"));
assert.ok(!stepBodies.reviewStep.includes("Preference importance"));
assert.equal((app.match(/Build My Trip/g) || []).length, 2);
assert.ok(!app.includes("Quick interpret"));
assert.ok(!app.includes("Generate preview"));
assert.ok(!app.includes("Website-first milestone"));

const trip = createTripDraft();
upsertCanonicalPreference(trip, { category: "diet", label: "Vegetarian", importance: "Strong preference", source: "Trip Description" });
upsertCanonicalPreference(trip, { category: "diet", label: "Vegetarian", importance: "Must have", source: "Explicit Selection" });
assert.equal(countUniqueActivePreferences(trip), 1);
assert.equal(trip.preferences[0].importance, "Must have");
assert.deepEqual(trip.preferences[0].sources.sort(), ["Explicit Selection", "Trip Description"].sort());

const merged = removeDuplicatePreferences([
  { id: "a", category: "experiences", label: "Waterfalls", importance: "Nice to have", weight: 45, source: "Trip Description" },
  { id: "b", category: "experiences", label: "waterfalls", importance: "Must have", weight: 100, source: "Explicit Selection" }
]);
assert.equal(merged.length, 1);
assert.equal(merged[0].importance, "Must have");

const styleTrip = createTripDraft();
upsertCanonicalPreference(styleTrip, { category: "experiences", label: "Lakes", importance: "Neutral", source: "Explicit Selection" });
upsertCanonicalPreference(styleTrip, { category: "experiences", label: "Waterfalls", importance: "Strong preference", source: "Explicit Selection" });
assert.equal(countSelectedExperiences(styleTrip), 1);
assert.deepEqual(getUniqueSelectedExperiences(styleTrip).map((pref) => pref.label), ["Waterfalls"]);

console.log("Wizard architecture tests passed");
