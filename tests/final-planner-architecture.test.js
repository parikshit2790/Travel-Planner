import assert from "node:assert/strict";
import { createTripDraft, syncTravelersToCounts } from "../src/domain.js";
import { resolveDestinationProfile } from "../src/destination-data.js";
import { buildDestinationIntelligence } from "../src/destination-intelligence.js";
import {
  buildDestinationOpportunityGraph,
  buildDynamicResearchPlan,
  calculateTemplateSimilarityScore,
  normalizePlanningCandidate
} from "../src/planning-quality.js";
import { buildTravelerConstraintProfile, generateTripPlan, normalizePlanningInput, validateTripPlan } from "../src/planner.js";

function fixture(overrides = {}) {
  const trip = createTripDraft();
  trip.from = overrides.from || "Charlotte, North Carolina, United States";
  trip.fromDisplay = trip.from;
  trip.destination = overrides.destination || "Los Angeles, California, United States";
  trip.destinationDisplay = trip.destination;
  trip.startDate = "2026-08-20";
  trip.endDate = "2026-08-24";
  trip.days = 5;
  trip.groupType = "Couple trip";
  trip.adults = 2;
  trip.children = 0;
  trip.seniors = 0;
  trip.transportation = "Fly and rent a car";
  trip.schedule.pace = "Balanced";
  trip.schedule.majorActivities = 3;
  trip.schedule.earliestActivity = "9:00 AM";
  trip.schedule.latestReturn = "9:30 PM";
  trip.transport.maxDrivingDay = "4 hours";
  trip.activity.walking = "Easy walking";
  trip.food.diet = ["Vegetarian"];
  trip.food.cuisine = ["Local cuisine"];
  trip.food.foodBudgetPerPerson = "$15 - $30 per day";
  trip.food.breakfastTime = "7:30 AM";
  trip.food.lunchTime = "12:30 PM";
  trip.food.dinnerTime = "6:30 PM";
  trip.alcohol.preferences = ["Quiet evening venues", "Evening walks"];
  trip.preferences = [
    { id: "nature", category: "experiences", label: "Nature", importance: "Strong preference", weight: 80 },
    { id: "food", category: "experiences", label: "Local cuisine", importance: "Nice to have", weight: 50 }
  ];
  syncTravelersToCounts(trip);
  return trip;
}

const generated = generateTripPlan(fixture());
assert.equal(generated.status, "ready");
const plan = generated.plan;
const metadata = plan.generationMetadata;

assert.ok(metadata.planningStages.length >= 12, "Planner should expose the architecture stages it executed.");
[
  "destination-understanding",
  "dynamic-research-plan",
  "candidate-ontology-classification",
  "destination-opportunity-graph",
  "hard-validation",
  "independent-quality-critique",
  "bounded-repair-loop"
].forEach((stage) => {
  assert.ok(metadata.planningStages.some((item) => item.name === stage), `Missing planning stage ${stage}`);
});

assert.ok(metadata.destinationProfile.primaryArchetype, "Generated metadata should include a destination profile archetype.");
assert.ok(metadata.dynamicResearchPlan.researchDomains.length >= 5, "Research plan should declare destination-aware research domains.");
assert.equal(metadata.dynamicResearchPlan.cachePolicy.excludesPersonalData, true);
assert.equal(metadata.dynamicResearchPlan.cachePolicy.excludesTravelerNames, true);
assert.ok(!JSON.stringify(metadata.dynamicResearchPlan.cachePolicy).includes("Traveler 1"), "Cache policy must not include personal traveler data.");

assert.ok(metadata.opportunityGraph.nodeCount > 0, "Opportunity graph should include normalized candidate nodes.");
assert.ok(metadata.opportunityGraph.edgeCount > 0, "Opportunity graph should include route/compatibility edges.");
assert.ok(metadata.opportunityGraph.coverage.attraction > 0, "Graph should contain destination attraction coverage.");
assert.ok(metadata.opportunityGraph.coverage.restaurant > 0, "Graph should contain meal candidate coverage.");
assert.equal(metadata.opportunityCoverageValidation.pass, true, JSON.stringify(metadata.opportunityCoverageValidation.hardFailures));

assert.ok(metadata.qualityCritique.score >= 85, JSON.stringify(metadata.qualityCritique));
assert.equal(metadata.qualityCritique.hardFailures.length, 0, JSON.stringify(metadata.qualityCritique.hardFailures));
assert.equal(metadata.qualityCritique.pass, true);
assert.ok(metadata.qualityCritique.checkedRules.includes("destination specificity"));
assert.equal(metadata.repairLoop.reason.includes("passed deterministic quality gate"), true);
assert.equal(metadata.observability.secretValuesIncluded, false);
assert.ok(!JSON.stringify(metadata.observability).includes("OPENAI_API_KEY"));
assert.ok(!JSON.stringify(metadata.observability).includes("OPENROUTESERVICE_API_KEY"));
assert.equal(validateTripPlan(plan).blocking.filter((item) => item.severity === "blocking").length, 0);

const profile = resolveDestinationProfile("Los Angeles, California, United States");
const input = normalizePlanningInput(fixture());
const constraints = buildTravelerConstraintProfile(input);
const intelligence = buildDestinationIntelligence(profile, input, constraints);
const researchPlan = buildDynamicResearchPlan(profile, input, intelligence);
const graph = buildDestinationOpportunityGraph(profile, input, intelligence, researchPlan.destinationProfile);
const restaurantCandidate = intelligence.allCandidates.find((item) => item.classification.isRestaurant);
const attractionCandidate = intelligence.allCandidates.find((item) => !item.classification.isRestaurant && !item.classification.isFoodHall && !item.classification.isBar);
assert.ok(restaurantCandidate, "Fixture should expose at least one restaurant candidate.");
assert.ok(attractionCandidate, "Fixture should expose at least one attraction candidate.");
assert.equal(normalizePlanningCandidate(restaurantCandidate, profile, input).primaryType, "restaurant");
assert.notEqual(normalizePlanningCandidate(attractionCandidate, profile, input).primaryType, "restaurant");
assert.ok(graph.edges.some((edge) => edge.relationship === "valid-meal-near-activity"), "Graph should relate meal candidates to nearby activity candidates.");

const templateRisk = calculateTemplateSimilarityScore({
  days: [
    { title: "Regional highlights", scheduleItems: [activity("a", 90, 10, 50)] },
    { title: "Regional highlights", scheduleItems: [activity("b", 90, 10, 50)] },
    { title: "Regional highlights", scheduleItems: [activity("c", 90, 10, 50)] },
    { title: "Regional highlights", scheduleItems: [activity("d", 90, 10, 50)] }
  ]
});
assert.ok(templateRisk.flags.includes("duration-template-risk"));
assert.ok(templateRisk.flags.includes("cost-template-risk"));
assert.ok(templateRisk.flags.includes("title-template-risk"));

console.log("Final planner architecture tests passed");

function activity(id, durationMinutes, low, high) {
  return {
    id,
    type: "activity",
    durationMinutes,
    estimatedCostPerPerson: { low, high }
  };
}
