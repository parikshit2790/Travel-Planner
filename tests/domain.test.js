import assert from "node:assert/strict";
import {
  addOrUpdatePreference,
  analyzeTrip,
  calculateInclusiveTripDays,
  calculateTripEndDate,
  calculateTripNights,
  createTripDraft,
  foodAndRestrictionWarnings,
  generatePlanPreview,
  getTripIssues,
  interpretFreeText,
  migrateTripState,
  parseTimeOfDay,
  reconcileTripDates,
  saveProfile,
  syncTravelersToCounts,
  tripBasicsIssues,
  travelerTotal,
  travelerWarnings,
  validateBasics
} from "../src/domain.js";

const trip = createTripDraft();
assert.equal(validateBasics(trip).length, 2);

trip.from = "Charlotte";
trip.destination = "Michigan";
trip.destinationRegions = "Upper Peninsula, Northern Michigan";
trip.days = 6;
trip.description = "We want secluded cabins, lakes, northern lights, vegetarian food, no alcohol, and easy walking.";
assert.equal(validateBasics(trip).length, 0);

const interpreted = interpretFreeText(trip.description);
assert.ok(interpreted.some((pref) => pref.label === "Lakes"));
assert.ok(interpreted.some((pref) => pref.label === "Aurora or northern lights"));
assert.ok(interpreted.some((pref) => pref.label === "Vegetarian"));

assert.equal(calculateInclusiveTripDays("2026-09-02", "2026-09-07"), 6);
assert.equal(calculateTripEndDate("2026-09-02", 5), "2026-09-06");
assert.equal(calculateTripNights(5), 4);
assert.equal(parseTimeOfDay("7:00 PM"), 1140);
assert.equal(parseTimeOfDay("10:00 PM"), 1320);

const dateTrip = createTripDraft();
dateTrip.startDate = "2026-09-02";
dateTrip.days = 5;
reconcileTripDates(dateTrip, "trip.days");
assert.equal(dateTrip.endDate, "2026-09-06");
dateTrip.endDate = "2026-09-07";
reconcileTripDates(dateTrip, "trip.endDate");
assert.equal(dateTrip.days, 6);

const broadTrip = createTripDraft();
broadTrip.from = "Charlotte";
broadTrip.destination = "california";
broadTrip.description = "advanture and urban city life";
assert.ok(tripBasicsIssues(broadTrip).some((issue) => issue.action === "Add Cities or Regions"));
broadTrip.destinationRegions = "San Francisco, Yosemite";
assert.ok(!tripBasicsIssues(broadTrip).some((issue) => issue.action === "Add Cities or Regions"));
const adventureInterpretation = interpretFreeText(broadTrip.description);
assert.ok(adventureInterpretation.some((pref) => pref.label === "Urban"));
assert.ok(adventureInterpretation.some((pref) => pref.label === "Adventure activities"));
assert.ok(adventureInterpretation.every((pref) => pref.source === "Trip Description"));

const timeTrip = createTripDraft();
timeTrip.from = "Charlotte";
timeTrip.destination = "Chicago";
timeTrip.food.dinnerTime = "7:00 PM";
timeTrip.schedule.latestReturn = "10:00 PM";
assert.ok(!getTripIssues(timeTrip).some((issue) => issue.issue.includes("Preferred Dinner Time")));
timeTrip.food.dinnerTime = "10:30 PM";
assert.ok(getTripIssues(timeTrip).some((issue) => issue.issue.includes("Preferred Dinner Time")));

const budgetTrip = createTripDraft();
budgetTrip.from = "Charlotte";
budgetTrip.destination = "Chicago";
budgetTrip.budget.strictness = "Strict";
budgetTrip.budget.total = "";
assert.ok(getTripIssues(budgetTrip).some((issue) => issue.blocking && issue.field === "trip.budget.total"));

interpreted.forEach((pref) => addOrUpdatePreference(trip, pref.category, pref.label, pref.importance, pref.source));
trip.alcohol.preferences.push("No alcohol");
const analysis = analyzeTrip(trip);
assert.ok(analysis.warnings.some((warning) => warning.includes("Aurora")));

const preview = generatePlanPreview(trip);
assert.equal(preview.days.length, 6);
assert.ok(preview.summary.includes("Michigan"));

const state = { profiles: [] };
const profile = saveProfile(state, "My preferences", trip);
assert.equal(profile.name, "My preferences");
assert.equal(state.profiles.length, 1);

trip.groupType = "Family trip";
trip.adults = 2;
trip.children = 2;
trip.seniors = 1;
syncTravelersToCounts(trip);
assert.equal(travelerTotal(trip), 5);
assert.equal(trip.travelers.length, 5);
assert.ok(trip.travelers.every((traveler) => Array.isArray(traveler.restrictions)));

trip.groupType = "Solo trip";
syncTravelersToCounts(trip);
assert.equal(travelerTotal(trip), 1);
assert.equal(trip.adults, 1);
assert.equal(trip.children, 0);
assert.equal(trip.seniors, 0);
assert.equal(trip.travelers.length, 1);
assert.equal(travelerWarnings(trip).length, 0);

trip.groupType = "Family trip";
trip.adults = 2;
trip.children = 1;
syncTravelersToCounts(trip);
trip.food.diet = ["Vegetarian", "Chicken preferred"];
trip.food.restrictions = ["Avoid beef", "Avoid pork"];
trip.travelers[2].restrictions = ["Food allergy"];
const foodWarnings = foodAndRestrictionWarnings(trip);
assert.ok(foodWarnings.some((warning) => warning.includes("Food allergy")));

trip.preferences.push({ id: "old-food-pref", category: "diet", label: "Vegan", value: true, importance: "Must have", weight: 100, source: "legacy" });
migrateTripState(trip);
assert.ok(trip.food.diet.includes("Vegan"));
assert.ok(!trip.preferences.some((pref) => pref.category === "diet"));

console.log("Domain tests passed");
