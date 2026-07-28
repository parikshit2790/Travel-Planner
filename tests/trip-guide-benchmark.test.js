import assert from "node:assert/strict";
import { generateTripPlan, validateTripPlan } from "../src/planner.js";

const trip = {
  from: "Augusta, Georgia, United States",
  fromDisplay: "Augusta, Georgia, United States",
  fromLocation: { canonicalName: "Augusta, Georgia, United States", latitude: 33.4735, longitude: -82.0105 },
  destination: "Charlotte, North Carolina, United States",
  destinationDisplay: "Charlotte, North Carolina, United States",
  startDate: "2026-08-08",
  endDate: "2026-08-12",
  days: 5,
  adults: 2,
  children: 0,
  seniors: 0,
  groupType: "Couple trip",
  transportation: "Drive",
  schedule: { pace: "Balanced", majorActivities: 2, earliestActivity: "9:00 AM", latestReturn: "9:30 PM" },
  activity: { walking: "Easy walking", hiking: "Easy hikes" },
  food: {
    diet: ["Vegetarian", "Chicken preferred"],
    restrictions: ["Avoid beef"],
    cuisine: ["Local cuisine", "Italian", "Indian"],
    foodBudgetPerPerson: "$15-$30 per day",
    reservations: "Willing for must-do restaurants",
    breakfastTime: "7:30 AM",
    lunchTime: "12:30 PM",
    dinnerTime: "6:30 PM"
  },
  alcohol: { preferences: ["Quiet evening venues", "Evening walks"] },
  budget: { total: "$1,500-$3,500" },
  lodging: { changeHotels: "Stay in one place" },
  transport: { maxDrivingDay: "4 hours" },
  preferences: [
    { id: "nature", category: "experiences", label: "Nature", importance: "Strong preference", weight: 80 },
    { id: "food", category: "experiences", label: "Food", importance: "Strong preference", weight: 70 }
  ],
  travelers: [
    { id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" },
    { id: "traveler-2", name: "Traveler 2", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }
  ]
};

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready");

const plan = generated.plan;
assert.ok(plan.tripGuide, "Plan should include a detailed trip guide.");
assert.ok(plan.tripGuide.tripShapeOptions.length >= 2, "Planner should evaluate multiple trip-shape options before day scheduling.");
assert.equal(plan.tripGuide.quickReference.length, 5, "Quick reference should include one row per trip day.");
assert.ok(plan.tripGuide.lodgingPlan.nightlyPlan.length >= 4, "Lodging plan should explain where the traveler sleeps each night.");
assert.ok(plan.tripGuide.reservationsToComplete.length >= 1, "Guide should include reservation or verification actions.");
assert.ok(plan.tripGuide.offlineMaps.length >= 1, "Guide should include offline map downloads.");
assert.ok(plan.tripGuide.packingList.some((group) => group.category === "Navigation"), "Packing list should include navigation prep.");
assert.ok(plan.tripGuide.budgetWorkbook.categories.length >= 4, "Budget workbook should include categories similar to the benchmark workbook.");

plan.days.forEach((day) => {
  assert.ok(day.dayArchetype, `Day ${day.dayNumber} should have an archetype.`);
  assert.ok(day.routeOrLocation, `Day ${day.dayNumber} should have route/location context.`);
  assert.ok(day.startingBase, `Day ${day.dayNumber} should have a starting base.`);
  assert.ok(day.endingBase, `Day ${day.dayNumber} should have an ending base.`);
  assert.ok(day.hotel, `Day ${day.dayNumber} should explain lodging/base.`);
  assert.ok(day.todaysTopFive.split(" - ").length >= 5, `Day ${day.dayNumber} should include Today's Top 5.`);
  assert.ok(day.prioritySections.dontMiss.length >= 1, `Day ${day.dayNumber} should include Don't Miss items.`);
  assert.ok(Array.isArray(day.prioritySections.worthDoing), `Day ${day.dayNumber} should include Worth Doing items.`);
  assert.ok(Array.isArray(day.prioritySections.bonusStops), `Day ${day.dayNumber} should include Bonus Stops.`);
  assert.ok(day.dailyFoodPlan.length >= 3, `Day ${day.dayNumber} should include food planning.`);
  assert.ok(day.dailyFoodPlan.every((meal) => meal.primaryOption && !/near the|aligned with/i.test(meal.primaryOption)), `Day ${day.dayNumber} meals should not be generic placeholders.`);
  assert.ok(day.expectedSpending.totalRange, `Day ${day.dayNumber} should include expected spending.`);
  assert.ok(day.quickTips.length >= 1, `Day ${day.dayNumber} should include quick tips.`);
  assert.ok(day.tomorrowPrep.length >= 1, `Day ${day.dayNumber} should include tomorrow prep.`);
  assert.ok(day.delayStrategy.cutFirst, `Day ${day.dayNumber} should say what to cut first.`);
});

assert.equal(plan.days[0].dayArchetype, "Arrival day");
assert.equal(plan.days.at(-1).dayArchetype, "Departure day");
assert.ok(plan.tripGuide.practicalStandardChecks.answersFood);
assert.ok(plan.tripGuide.practicalStandardChecks.answersDailyCost);
assert.ok(plan.tripGuide.practicalStandardChecks.answersTruePriorities);
assert.equal(validateTripPlan(plan).blocking.filter((issue) => issue.severity === "blocking").length, 0);

console.log("Trip guide benchmark tests passed");
