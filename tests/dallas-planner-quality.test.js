import assert from "node:assert/strict";
import { resolveDestinationProfile } from "../src/destination-data.js";
import { generateTripPlan } from "../src/planner.js";

const profile = resolveDestinationProfile("Dallas, Texas, United States");

assert.equal(profile.id, "dallas");
assert.equal(profile.planningRules.defaultHotelRegion, "downtown-dealey");

const profileText = JSON.stringify(profile);
[
  "The Sixth Floor Museum at Dealey Plaza",
  "Dealey Plaza",
  "Dallas Arts District",
  "Deep Ellum",
  "Bishop Arts District",
  "Dallas Arboretum",
  "Fort Worth Stockyards",
  "Fort Worth Herd cattle drive"
].forEach((expected) => assert.ok(profileText.includes(expected), `Dallas profile should include ${expected}`));

const trip = {
  from: "San Jose, California, United States",
  fromDisplay: "San Jose, California, United States",
  destination: "Dallas, Texas, United States",
  destinationDisplay: "Dallas, Texas, United States",
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
  budget: { total: "$1500-$3500" },
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
  "The Sixth Floor Museum at Dealey Plaza",
  "Dallas Museum of Art",
  "Bishop Arts District",
  "Deep Ellum",
  "Dallas Arboretum",
  "Fort Worth Stockyards"
].forEach((expected) => assert.ok(planText.includes(expected), `Dallas plan should include ${expected}`));

[
  "starter planning anchor",
  "Dallas signature sights and downtown orientation",
  "openrouteservice point-of-interest candidate",
  "Santa Monica Pier"
].forEach((bad) => assert.equal(planText.includes(bad), false, `Dallas plan should not include ${bad}`));

assert.ok(generated.plan.days.some((day) => /Stockyards|Fort Worth/i.test(`${day.title} ${day.summary} ${JSON.stringify(day.scheduleItems)}`)), "Dallas plan should include Fort Worth Stockyards as a nearby excursion.");

console.log("Dallas planner quality tests passed");
