import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialState } from "../src/seed.js";
import { SAVED_DRAFT_KEY, STORAGE_KEY, createTripDraft, tripBasicsIssues, validateBasics } from "../src/domain.js";

const app = readFileSync("src/app.js", "utf8");

const draft = createTripDraft();
assert.equal(draft.from, "");
assert.equal(draft.fromLocation, null);
assert.equal(draft.destination, "");
assert.equal(draft.destinationLocation, null);
assert.equal(draft.destinationRegions, "");
assert.equal(draft.days, "");
assert.equal(draft.startDate, "");
assert.equal(draft.endDate, "");
assert.equal(draft.transportation, "");
assert.equal(draft.description, "");
assert.equal(draft.groupType, "Solo trip");
assert.equal(draft.adults, 1);
assert.equal(draft.children, 0);
assert.equal(draft.seniors, 0);
assert.equal(draft.travelers.length, 1);
assert.equal(draft.preferences.length, 0);
assert.equal(draft.food.diet.length, 0);
assert.equal(draft.food.restrictions.length, 0);
assert.equal(draft.alcohol.primary, "Not Specified");
assert.equal(draft.activity.walking, "Not Specified");
assert.equal(draft.activity.hiking, "No hiking");
assert.equal(draft.transport.maxDrivingDay, "");
assert.equal(draft.budget.style, "Not Specified");
assert.equal(draft.lodging.styles.length, 0);

assert.equal(initialState.activeStep, 1);
assert.equal(initialState.preview, null);
assert.equal(initialState.lastSaved, null);
assert.equal(initialState.trip.from, "Charlotte");
assert.equal(initialState.trip.destination, "Los Angeles");
assert.equal(initialState.trip.days, 5);
assert.equal(initialState.trip.startDate, "2026-08-20");
assert.equal(initialState.trip.endDate, "2026-08-25");
assert.equal(initialState.trip.interpretedSuggestions.length, 0);

assert.equal(validateBasics(draft).length, 2);
assert.ok(!tripBasicsIssues(draft).some((issue) => issue.field === "trip.days"));

assert.ok(app.includes("clearTransientWizardStorage"));
assert.ok(app.includes("structuredClone(initialState)"));
assert.ok(!app.includes("localStorage.getItem(STORAGE_KEY)"));
assert.equal(app.split("localStorage.setItem(").length - 1, 1);
assert.ok(app.includes("localStorage.setItem(SAVED_DRAFT_KEY"));
assert.ok(app.includes("if (name === \"saveExit\")"));
assert.ok(app.includes("Draft saved."));
assert.ok(app.includes("localStorage.removeItem(key)"));
assert.equal(STORAGE_KEY, "routemosaic-personalization-state-v3");
assert.equal(SAVED_DRAFT_KEY, "routemosaic-explicit-draft-v1");

console.log("Refresh reset tests passed");
