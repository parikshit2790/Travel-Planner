import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialState } from "../src/seed.js";
import { SAVED_DRAFT_KEY, SAVED_TRIPS_KEY, STORAGE_KEY, createTripDraft, tripBasicsIssues, validateBasics } from "../src/domain.js";
import { createSampleLosAngelesTrip } from "../src/seed.js";

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
assert.equal(initialState.trip.from, "");
assert.equal(initialState.trip.destination, "");
assert.equal(initialState.trip.days, "");
assert.equal(initialState.trip.startDate, "");
assert.equal(initialState.trip.endDate, "");
assert.equal(initialState.trip.interpretedSuggestions.length, 0);

const sample = createSampleLosAngelesTrip(new Date(2026, 6, 25));
assert.equal(sample.from, "Charlotte, North Carolina");
assert.equal(sample.destination, "Los Angeles, California");
assert.equal(sample.days, 5);
assert.equal(sample.startDate, "2026-09-23");
assert.equal(sample.endDate, "2026-09-27");
assert.equal(sample.sampleTrip, true);

assert.equal(validateBasics(draft).length, 2);
assert.ok(!tripBasicsIssues(draft).some((issue) => issue.field === "trip.days"));

assert.ok(app.includes("clearTransientWizardStorage"));
assert.ok(app.includes("structuredClone(initialState)"));
assert.ok(!app.includes("localStorage.getItem(STORAGE_KEY)"));
assert.ok(app.includes("SAVED_TRIPS_KEY"));
assert.ok(app.includes("function readSavedTrips"));
assert.ok(app.includes("function writeSavedTrip"));
assert.ok(app.includes("localStorage.setItem(SAVED_DRAFT_KEY"));
assert.ok(app.includes("if (name === \"saveExit\")"));
assert.ok(app.includes("Draft saved."));
assert.ok(app.includes("Saved locally in this browser"));
assert.ok(app.includes("Try Los Angeles sample"));
assert.ok(app.includes("createSampleLosAngelesTrip"));
assert.ok(app.includes("localStorage.removeItem(key)"));
assert.equal(STORAGE_KEY, "routemosaic-personalization-state-v3");
assert.equal(SAVED_DRAFT_KEY, "routemosaic-explicit-draft-v1");
assert.equal(SAVED_TRIPS_KEY, "routemosaic-local-saved-trips-v1");

console.log("Refresh reset tests passed");
