import { handlePlannerAction } from "./server/lib/planner-actions.js";
import { createTripDraft, syncTravelersToCounts } from "./src/domain.js";
import { generateTripPlan } from "./src/planner.js";
import { registerGeneratedDestinationProfile } from "./src/destination-data.js";
import { googleRouteEstimate } from "./server/lib/google-provider.js";
import { providerConfig } from "./server/lib/env.js";

const trip = createTripDraft();
trip.from = "Augusta, Georgia, United States";
trip.fromDisplay = "Augusta, Georgia, United States";
trip.fromLocation = { normalizedName: "Augusta, Georgia, United States", verificationStatus: "Verified", latitude: 33.4735, longitude: -81.9748 };
trip.fromVerificationStatus = "Verified";

trip.destination = "New York, United States";
trip.destinationDisplay = "New York, United States";
trip.destinationLocation = { normalizedName: "New York, United States", verificationStatus: "Verified", latitude: 40.7128, longitude: -74.0060 };
trip.destinationVerificationStatus = "Verified";

trip.days = 5;
trip.startDate = "2026-09-05";
trip.endDate = "2026-09-09";
trip.transportation = "Drive from origin";
trip.groupType = "Couple trip";
trip.adults = 2;
trip.children = 0;
trip.seniors = 0;
syncTravelersToCounts(trip);

console.log("=== research-destination ===");
const researchResult = await handlePlannerAction("research-destination", { trip });
console.log("status", researchResult.status);
if (researchResult.body?.success === false) {
  console.log("ERROR", JSON.stringify(researchResult.body.error, null, 2));
  process.exit(1);
}
const profile = researchResult.body.profile;

console.log("=== generate-trip (direct, with real arrival route estimate) ===");
const config = providerConfig();
const normalizedTrip = { ...trip };
const routeEstimate = await googleRouteEstimate(
  { label: trip.fromDisplay, latitude: trip.fromLocation.latitude, longitude: trip.fromLocation.longitude },
  { label: trip.destinationDisplay, latitude: trip.destinationLocation.latitude, longitude: trip.destinationLocation.longitude },
  "driving",
  config
);
normalizedTrip.arrivalRouteEstimate = {
  durationMinutes: routeEstimate.durationMinutes,
  distanceMiles: routeEstimate.distanceMiles,
  provider: routeEstimate.provider || config.routeProvider,
  checkedAt: new Date().toISOString(),
  confidence: "provider"
};
normalizedTrip.routeQualityRequired = true;

const registeredProfile = registerGeneratedDestinationProfile(profile);
const result = generateTripPlan(normalizedTrip, { destinationProfileId: registeredProfile.id });
console.log("result.status:", result.status);
if (result.errors) console.log("errors:", JSON.stringify(result.errors.map(e => e.id), null, 2));
const plan = result.plan;

console.log("\n=== Route/Location vs Don't Miss check ===");
(plan?.tripGuide?.quickReference || []).forEach((row) => {
  console.log(`Day ${row.dayNumber}: routeOrLocation="${row.routeOrLocation}" dontMiss="${row.dontMiss}"`);
});
