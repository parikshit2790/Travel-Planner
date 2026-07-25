import assert from "node:assert/strict";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import {
  addCustomStop,
  compatibleAlternatives,
  generateTripPlan,
  moveActivity,
  normalizePlanningInput,
  regenerateDay,
  regenerateMeals,
  regeneratePlanPreservingLocks,
  removeScheduleItem,
  replaceActivity,
  toggleDayLock,
  toggleItemLock,
  toggleItemMustDo,
  validateTripPlan
} from "../src/planner.js";

function fixture(overrides = {}) {
  const trip = createTripDraft();
  trip.from = "Charlotte, North Carolina";
  trip.fromDisplay = "Charlotte, North Carolina";
  trip.destination = overrides.destination || "Los Angeles, California";
  trip.destinationDisplay = overrides.destination || "Los Angeles, California";
  trip.startDate = "2026-08-20";
  trip.endDate = overrides.endDate || "2026-08-24";
  trip.days = overrides.days || 5;
  trip.groupType = "Couple trip";
  trip.adults = 2;
  trip.children = 0;
  trip.seniors = 0;
  trip.transportation = "Fly and rent a car";
  trip.schedule.pace = overrides.pace || "Balanced";
  trip.schedule.majorActivities = overrides.majorActivities || 3;
  trip.schedule.earliestActivity = "9:00 AM";
  trip.schedule.latestReturn = "9:30 PM";
  trip.transport.maxDrivingDay = overrides.maxDrivingDay || "4 hours";
  trip.activity.walking = "Easy walking";
  trip.food.diet = ["Vegetarian"];
  trip.food.restrictions = ["Avoid beef"];
  trip.food.cuisine = ["Indian", "Italian", "Mexican", "Local cuisine"];
  trip.food.foodBudgetPerPerson = "$15 - $30 per day";
  trip.food.breakfastTime = "7:30 AM";
  trip.food.lunchTime = "12:30 PM";
  trip.food.dinnerTime = "6:30 PM";
  trip.alcohol.preferences = ["Quiet evening venues", "Evening walks", "Live music"];
  trip.preferences = [
    { id: "p1", category: "experiences", label: "Beaches", importance: "Strong preference", weight: 80 },
    { id: "p2", category: "experiences", label: "Museums", importance: "Nice to have", weight: 45 },
    { id: "p3", category: "experiences", label: "Scenic drives", importance: "Nice to have", weight: 45 }
  ];
  syncTravelersToCounts(trip);
  trip.travelers[1].restrictions = ["Mobility limitation"];
  return trip;
}

const fiveDay = generateTripPlan(fixture());
assert.equal(fiveDay.status, "ready");
assert.equal(fiveDay.plan.numberOfDays, 5);
assert.equal(fiveDay.plan.endDate, "2026-08-24");
assert.equal(fiveDay.plan.days.length, 5);
assert.deepEqual(fiveDay.plan.days.map((day) => day.date), ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24"]);

const sixDayTrip = fixture({ endDate: "2026-08-25", days: 5 });
const sixInput = normalizePlanningInput(sixDayTrip);
assert.equal(sixInput.numberOfDays, 6);
const sixDay = generateTripPlan(sixDayTrip);
assert.equal(sixDay.status, "ready");
assert.equal(sixDay.plan.days.length, 6);
assert.equal(sixDay.plan.endDate, "2026-08-25");

assert.ok(fiveDay.plan.days.every((day) => day.scheduleItems.some((item) => item.type === "breakfast")));
assert.ok(fiveDay.plan.days.every((day) => day.scheduleItems.some((item) => item.type === "lunch")));
assert.ok(fiveDay.plan.days.every((day) => day.scheduleItems.some((item) => item.type === "dinner")));
assert.ok(fiveDay.plan.days.some((day) => day.scheduleItems.some((item) => item.type === "travel" || day.dailyDriveMinutes >= 0)));
assert.ok(fiveDay.plan.days.every((day) => day.backupOptions.length > 0));
assert.ok(fiveDay.plan.foodPlan.dietaryHandlingSummary.includes("Vegetarian"));
assert.ok(fiveDay.plan.foodPlan.dietaryHandlingSummary.includes("Avoid beef"));
assert.ok(fiveDay.plan.advisories.some((item) => item.category === "accessibility"));
assert.ok(fiveDay.plan.budgetSummary.totalHigh > fiveDay.plan.budgetSummary.totalLow);
assert.ok(fiveDay.plan.budgetSummary.perPersonHigh > 0);
assert.ok(fiveDay.plan.routeSummary.orderedRegions.length >= 4);
assert.equal(validateTripPlan(fiveDay.plan).blocking.filter((item) => item.severity === "blocking").length, 0);

const relaxed = generateTripPlan(fixture({ pace: "Relaxed", majorActivities: 2 })).plan;
const packed = generateTripPlan(fixture({ pace: "Packed", majorActivities: 4 })).plan;
assert.ok(packed.overview.totalScheduledActivities >= relaxed.overview.totalScheduledActivities);

const genericDestination = generateTripPlan(fixture({ destination: "Tokyo, Japan" }));
assert.equal(genericDestination.status, "ready");
assert.equal(genericDestination.plan.destination, "Tokyo, Japan");
assert.equal(genericDestination.plan.generationMetadata.usesGenericDestinationProfile, true);
assert.ok(genericDestination.plan.overview.title.includes("Tokyo, Japan"));
assert.ok(genericDestination.plan.advisories.some((item) => item.message.includes("generic planning mode")));
assert.ok(!JSON.stringify(genericDestination).includes("Santa Monica Pier"));
assert.ok(!JSON.stringify(genericDestination).includes("Your Los Angeles trip is ready"));

const genericAlternative = compatibleAlternatives(genericDestination.plan, genericDestination.plan.days[0].scheduleItems.find((item) => item.type === "activity").id);
assert.ok(genericAlternative.length > 0);

const detroit = generateTripPlan(fixture({ destination: "Detroit, Michigan, United States" }));
assert.equal(detroit.status, "ready");
assert.equal(detroit.plan.generationMetadata.destinationProfileId, "detroit");
assert.equal(detroit.plan.generationMetadata.usesGenericDestinationProfile, false);
const detroitText = JSON.stringify(detroit.plan);
[
  "Detroit Institute of Arts",
  "Motown Museum",
  "Detroit RiverWalk",
  "Belle Isle",
  "Eastern Market",
  "The Henry Ford"
].forEach((expected) => assert.ok(detroitText.includes(expected), `Detroit plan should include ${expected}`));
assert.ok(detroit.plan.foodPlan.foodAreas.some((area) => area.name.includes("Dearborn")));
assert.ok(detroit.plan.routeSummary.routeLogicExplanation.includes("Detroit, Michigan, USA"));
assert.ok(detroit.plan.days.every((day) => day.scheduleItems.filter((item) => item.type === "activity").length >= 2));
assert.ok(!detroitText.includes("Detailed local planning data is currently available for Los Angeles"));

let editable = structuredClone(fiveDay.plan);
const firstActivity = editable.days[0].scheduleItems.find((item) => item.type === "activity");
const alternatives = compatibleAlternatives(editable, firstActivity.id);
assert.ok(alternatives.length > 0);
editable = replaceActivity(editable, firstActivity.id, alternatives[0].placeId);
assert.notEqual(editable.days[0].scheduleItems.find((item) => item.id === firstActivity.id).placeId, firstActivity.placeId);

const movable = editable.days[0].scheduleItems.find((item) => item.replaceable);
editable = moveActivity(editable, movable.id, "later");
assert.ok(editable.days[0].dailyBudget.high >= editable.days[0].dailyBudget.low);

editable = addCustomStop(editable, { title: "Friend dinner", dayNumber: 2, startTime: "5:00 PM", durationMinutes: 75, type: "dinner", locationLabel: "Custom restaurant", notes: "Meet friends", cost: 35, indoorOutdoor: "indoor", mustDo: true, locked: true });
assert.ok(editable.days[1].scheduleItems.some((item) => item.customItem && item.locked && item.mustDo));

const lockItem = editable.days[1].scheduleItems.find((item) => item.type === "activity");
editable = toggleItemLock(editable, lockItem.id);
assert.equal(editable.days[1].scheduleItems.find((item) => item.id === lockItem.id).locked, true);
editable = toggleItemMustDo(editable, lockItem.id);
assert.equal(editable.days[1].scheduleItems.find((item) => item.id === lockItem.id).mustDo, true);
editable = regenerateDay(editable, editable.days[1].id);
assert.ok(editable.days[1].scheduleItems.some((item) => item.id === lockItem.id));

const beforeMealActivities = editable.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").map((item) => item.id).join(",");
editable = regenerateMeals(editable);
const afterMealActivities = editable.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").map((item) => item.id).join(",");
assert.equal(afterMealActivities, beforeMealActivities);

const removeCandidate = editable.days[0].scheduleItems.find((item) => item.replaceable && !item.locked && !item.mustDo);
editable = removeScheduleItem(editable, removeCandidate.id);
assert.ok(!editable.days.flatMap((day) => day.scheduleItems).some((item) => item.id === removeCandidate.id));

editable = toggleDayLock(editable, editable.days[0].id);
const lockedDaySnapshot = JSON.stringify(editable.days[0]);
editable = regeneratePlanPreservingLocks(editable);
assert.equal(JSON.stringify(editable.days[0]), lockedDaySnapshot);

console.log("Planner tests passed");
