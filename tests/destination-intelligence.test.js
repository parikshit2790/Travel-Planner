import assert from "node:assert/strict";
import { resolveDestinationProfile } from "../src/destination-data.js";
import { buildDestinationIntelligence, categoryCoverage, localSignificanceScore } from "../src/destination-intelligence.js";
import { buildTravelerConstraintProfile, generateTripPlan, validateTripPlan } from "../src/planner.js";

const balancedTrip = tripFixture([]);
const profile = resolveDestinationProfile("Charlotte, North Carolina, United States");
const balancedInput = normalizeViaPlanInput(balancedTrip);
const balancedConstraints = buildTravelerConstraintProfile(balancedInput);
const intelligence = buildDestinationIntelligence(profile, balancedInput, balancedConstraints);
const intelligenceText = JSON.stringify(intelligence);

[
  "NASCAR Hall of Fame",
  "Mint Museum Uptown",
  "Bechtler Museum",
  "Discovery Place Science",
  "U.S. National Whitewater Center",
  "Crowders Mountain State Park",
  "Lake Wylie and Ebenezer Park",
  "Chimney Rock and Lake Lure",
  "South Mountains State Park",
  "Asheville and Blue Ridge Parkway",
  "Boone, Blowing Rock, and Grandfather Mountain",
  "Optimist Hall",
  "Fahrenheit Charlotte",
  "The Bowl at Ballantyne"
].forEach((expected) => assert.ok(intelligenceText.includes(expected), `Destination intelligence should consider ${expected}`));

const coverage = categoryCoverage(intelligence);
assert.ok(coverage.signature >= 5, "Charlotte intelligence should have signature city anchors.");
assert.ok(coverage.nature >= 6, "Charlotte intelligence should have serious outdoor and nature anchors.");
assert.ok(coverage.food >= 6, "Charlotte intelligence should treat food as first-class candidates.");
assert.ok(coverage.regional >= 4, "Charlotte intelligence should evaluate regional options beyond city boundaries.");
assert.ok(coverage.evenings >= 3, "Charlotte intelligence should include evening and rooftop options.");

const whitewater = candidate("U.S. National Whitewater Center");
const genericWalk = candidate("Little Sugar Creek Greenway");
assert.ok(whitewater.score > genericWalk.score, "Major outdoor anchors should outrank generic walk fillers.");
assert.ok(candidate("Fahrenheit Charlotte").categories.includes("rooftopDining"), "Fahrenheit should be classified as rooftop dining.");
assert.ok(candidate("Optimist Hall").categories.includes("foodHalls"), "Optimist Hall should be classified as a food hall candidate.");
assert.ok(candidate("Chimney Rock and Lake Lure day trip").routeFeasibility.estimatedRoundTripMinutes >= 200, "Chimney Rock must include route burden.");
assert.ok(candidate("Asheville and Blue Ridge Parkway extension").categories.includes("regionalOvernightExtensions"), "Asheville should be considered as a regional extension.");
assert.ok(localSignificanceScore(whitewater.place, profile) > localSignificanceScore(genericWalk.place, profile), "Local significance should favor major anchors over filler walks.");

const balanced = generateTripPlan(balancedTrip);
assert.equal(balanced.status, "ready");
assert.equal(validateTripPlan(balanced.plan).blocking.filter((issue) => issue.severity === "blocking").length, 0);
const balancedText = JSON.stringify(balanced.plan);
assert.ok(balanced.plan.generationMetadata.destinationIntelligence.routeOptions.length >= 3, "Plan should include route options from intelligence.");
assert.ok(/NASCAR|Mint Museum|Bechtler|Discovery Place/.test(balancedText), "Balanced Charlotte plan should include a signature city anchor.");
assert.ok(/Whitewater|Crowders|Lake Norman|Lake Wylie/.test(balancedText), "Balanced Charlotte plan should include a meaningful nature or outdoor anchor.");
assert.ok(/Optimist Hall|Fahrenheit|South End|NoDa|Plaza Midwood|Ballantyne/.test(balancedText), "Balanced Charlotte plan should include a food or evening anchor.");
assert.equal(/Uptown restaurants and food halls|local\/local options|near the main activity area/i.test(balancedText), false, "Final plan should not use generic meal labels.");

const nature = generateTripPlan(tripFixture([{ id: "nature", category: "experiences", label: "Nature", importance: "Strong preference", weight: 90 }]));
assert.equal(nature.status, "ready");
const natureText = JSON.stringify(nature.plan);
assert.ok(/Crowders|Whitewater|Lake Wylie|Lake Norman|Chimney|South Mountains|Blue Ridge/.test(natureText), "Nature-focused Charlotte plan should raise serious outdoor or regional options.");

const food = generateTripPlan(tripFixture([{ id: "food", category: "experiences", label: "Food experiences", importance: "Strong preference", weight: 90 }], {
  food: { diet: ["Vegetarian"], cuisine: ["Local cuisine"], breakfastTime: "8:00 AM", lunchTime: "12:30 PM", dinnerTime: "6:30 PM" },
  alcohol: { preferences: ["Quiet evening venues", "Bars"] }
}));
assert.equal(food.status, "ready");
const foodText = JSON.stringify(food.plan);
assert.ok(/Optimist Hall|Fahrenheit|South End|NoDa|Plaza Midwood|Ballantyne/.test(foodText), "Food-focused Charlotte plan should include real food and evening candidates.");

console.log("Destination intelligence tests passed");

function candidate(name) {
  const found = intelligence.allCandidates.find((item) => item.place.name === name);
  assert.ok(found, `Expected candidate ${name}`);
  return found;
}

function normalizeViaPlanInput(trip) {
  const result = generateTripPlan(trip);
  assert.equal(result.status, "ready");
  return result.plan.preferencesSnapshot;
}

function tripFixture(preferences, overrides = {}) {
  return {
    from: "Augusta, Georgia, United States",
    fromDisplay: "Augusta, Georgia, United States",
    fromLocation: { canonicalName: "Augusta, Georgia, United States", latitude: 33.4735, longitude: -82.0105 },
    destination: "Charlotte, North Carolina, United States",
    destinationDisplay: "Charlotte, North Carolina, United States",
    startDate: "2026-08-08",
    endDate: "2026-08-12",
    days: 5,
    adults: 1,
    children: 0,
    seniors: 0,
    groupType: "Solo trip",
    transportation: "Drive",
    schedule: { pace: "Balanced", majorActivities: 2, earliestActivity: "9:00 AM", latestReturn: "9:30 PM" },
    activity: { walking: "Easy walking", hiking: "Easy hikes" },
    food: { diet: ["Vegetarian"], restrictions: [], cuisine: ["Local cuisine"], foodBudgetPerPerson: "$15-$30 per day", breakfastTime: "8:00 AM", lunchTime: "12:30 PM", dinnerTime: "6:30 PM" },
    alcohol: { preferences: ["Quiet evening venues"] },
    budget: { total: "$1,500-$3,500" },
    lodging: { changeHotels: "Stay in one place" },
    transport: { maxDrivingDay: "4 hours" },
    preferences,
    travelers: [{ id: "traveler-1", name: "Traveler 1", ageGroup: "Adult (18-64)", restrictions: [], notes: "" }],
    ...overrides
  };
}
