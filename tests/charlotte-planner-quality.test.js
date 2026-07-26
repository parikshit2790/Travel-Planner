import assert from "node:assert/strict";
import { resolveDestinationProfile } from "../src/destination-data.js";
import { generateTripPlan } from "../src/planner.js";

const profile = resolveDestinationProfile("Charlotte, North Carolina, United States");

assert.equal(profile.id, "charlotte");
assert.equal(profile.planningRules.defaultHotelRegion, "uptown");

const profileText = JSON.stringify(profile);
[
  "NASCAR Hall of Fame",
  "Romare Bearden Park",
  "South End Rail Trail",
  "NoDa arts district",
  "Camp North End",
  "U.S. National Whitewater Center",
  "Lake Norman",
  "Carowinds"
].forEach((expected) => assert.ok(profileText.includes(expected), `Charlotte profile should include ${expected}`));

const trip = {
  from: "Austin, Texas, United States",
  fromDisplay: "Austin, Texas, United States",
  destination: "Charlotte, North Carolina, United States",
  destinationDisplay: "Charlotte, North Carolina, United States",
  startDate: "2026-08-08",
  endDate: "2026-08-12",
  days: 5,
  adults: 1,
  children: 0,
  seniors: 0,
  groupType: "Solo trip",
  transportation: "Fly and rent a car",
  schedule: { pace: "Balanced", majorActivities: 2 },
  activity: { walking: "Easy walking", hiking: "No hiking" },
  food: { diet: [], restrictions: [], cuisineInterests: [], eveningPreferences: [] },
  alcohol: { preferences: [] },
  budget: { total: "$1,500-$3,500" },
  lodging: {},
  transport: { maxDrivingDay: "4 hours" },
  preferences: [],
  travelers: [
    {
      id: "traveler-1",
      name: "Traveler 1",
      ageGroup: "Adult (18-64)",
      gender: "",
      restrictions: [],
      notes: ""
    }
  ]
};

const generated = generateTripPlan(trip);
assert.equal(generated.status, "ready");
assert.equal(generated.plan.generationMetadata.usesGenericDestinationProfile, false);

const planText = JSON.stringify(generated.plan);
[
  "NASCAR Hall of Fame",
  "Freedom Park",
  "NoDa",
  "Camp North End",
  "Whitewater Center",
  "Lake Norman"
].forEach((expected) => assert.ok(planText.includes(expected), `Charlotte plan should include ${expected}`));

[
  "Gatewood Insurance",
  "Hampton Inn",
  "India Hook School",
  "Town of Indian Trail",
  "openrouteservice point-of-interest candidate",
  "Santa Monica Pier"
].forEach((bad) => assert.equal(planText.includes(bad), false, `Charlotte plan should not include ${bad}`));

assert.ok(generated.plan.days.some((day) => /Whitewater|Lake Norman|Carowinds|Concord/i.test(`${day.title} ${day.summary} ${JSON.stringify(day.scheduleItems)}`)), "Charlotte plan should consider nearby half-day or day-trip options.");

console.log("Charlotte planner quality tests passed");
