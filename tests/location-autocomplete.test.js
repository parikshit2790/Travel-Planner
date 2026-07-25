import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createTripDraft,
  destinationNeedsClarification,
  isBroadLocation,
  locationVerificationLabel,
  tripBasicsIssues
} from "../src/domain.js";
import {
  LOCATION_MIN_QUERY_LENGTH,
  LOCATION_SEARCH_DEBOUNCE_MS,
  dedupeLocations,
  normalizeNominatimResult,
  rankLocations
} from "../src/location-provider.js";
import { initialState } from "../src/seed.js";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const provider = readFileSync("src/location-provider.js", "utf8");

assert.equal(initialState.trip.from, "Charlotte");
assert.equal(initialState.trip.destination, "Los Angeles");
assert.equal(initialState.trip.days, 5);
assert.equal(initialState.trip.startDate, "2026-08-20");
assert.equal(initialState.trip.endDate, "2026-08-25");
assert.equal(initialState.trip.description, "");

assert.equal(LOCATION_MIN_QUERY_LENGTH, 2);
assert.ok(LOCATION_SEARCH_DEBOUNCE_MS >= 250);
assert.ok(LOCATION_SEARCH_DEBOUNCE_MS <= 350);
assert.ok(provider.includes('url.searchParams.set("q", query)'));
assert.ok(provider.includes('url.searchParams.set("limit", "8")'));
assert.ok(!provider.includes('url.searchParams.set("limit", "1")'));
assert.ok(!provider.includes("query.slice"));
assert.ok(!provider.includes("query.substring"));

const charlotte = normalizeNominatimResult({
  place_id: 1,
  lat: "35.2271",
  lon: "-80.8431",
  display_name: "Charlotte, Mecklenburg County, North Carolina, United States",
  addresstype: "city",
  address: { city: "Charlotte", state: "North Carolina", country: "United States", country_code: "us" }
}, "OpenStreetMap Nominatim");
assert.equal(charlotte.normalizedName, "Charlotte, North Carolina, United States");
assert.equal(charlotte.locationType, "City");
assert.equal(charlotte.verificationStatus, "Verified");
assert.equal(charlotte.providerPlaceId, "1");

const airport = normalizeNominatimResult({
  place_id: 2,
  lat: "35.2144",
  lon: "-80.9473",
  display_name: "Charlotte Douglas International Airport, CLT, North Carolina, United States",
  addresstype: "aerodrome",
  class: "aeroway",
  type: "aerodrome",
  address: { city: "Charlotte", state: "North Carolina", country: "United States", country_code: "us" }
}, "OpenStreetMap Nominatim");
assert.equal(airport.locationType, "Airport");
assert.equal(airport.airportCode, "CLT");

assert.equal(dedupeLocations([charlotte, { ...charlotte }]).length, 1);
const chaco = normalizeNominatimResult({
  place_id: 3,
  lat: "-26.3864",
  lon: "-60.7658",
  display_name: "Chaco, Argentina",
  addresstype: "state",
  address: { state: "Chaco", country: "Argentina", country_code: "ar" }
}, "OpenStreetMap Nominatim");
assert.equal(rankLocations([chaco, charlotte], "Charlotte")[0].normalizedName, "Charlotte, North Carolina, United States");

const trip = createTripDraft();
trip.from = "Charlotte";
trip.fromLocation = charlotte;
trip.fromVerificationStatus = "Verified";
trip.destination = "Michigan";
trip.destinationLocation = { normalizedName: "Michigan, United States", locationType: "State", verificationStatus: "Verified" };
trip.destinationVerificationStatus = "Verified";
trip.days = 3;
assert.equal(isBroadLocation(trip.destinationLocation), true);
assert.equal(destinationNeedsClarification(trip), true);
assert.equal(tripBasicsIssues(trip).find((issue) => issue.field === "trip.destinationRegions").severity, "Advisory");
assert.equal(tripBasicsIssues(trip).find((issue) => issue.field === "trip.destinationRegions").blocking, false);
trip.destinationRegions = "Traverse City";
assert.equal(destinationNeedsClarification(trip), false);

assert.equal(locationVerificationLabel(charlotte), "Verified");
assert.equal(locationVerificationLabel(null, "NeedsReview"), "Select a suggestion to verify this location.");
assert.equal(locationVerificationLabel(null, "ProviderUnavailable"), "Suggestions are unavailable. You can keep typing.");

assert.ok(app.includes("createLocationSearchProvider"));
assert.ok(app.includes("role=\"combobox\""));
assert.ok(app.includes("aria-activedescendant"));
assert.ok(app.includes("queueLocationSearch"));
assert.ok(app.includes("refreshLocationPanel"));
assert.ok(app.includes("bindLocationPanelActions"));
assert.ok(app.includes("locationRequestId"));
assert.ok(app.includes("clearLocationField"));
assert.ok(app.includes("closeLocationOnOutsidePointer"));
assert.ok(app.includes("clearLocation:"));
assert.ok(app.includes("Clear Traveling From"));
assert.ok(app.includes("Clear Destination"));
assert.ok(app.includes("ui.locationRequestId[field] !== requestId"));
assert.ok(app.includes("LOCATION_SEARCH_DEBOUNCE_MS"));
assert.ok(app.includes("selectLocationSuggestion"));
assert.ok(app.includes("ProviderUnavailable"));
assert.ok(app.includes("TravelHeaderIllustration"));
assert.ok(app.includes("SidebarScenicIllustration"));
assert.ok(app.includes("visibleTripBasicsIssues"));
assert.ok(app.includes("visibleReviewIssues"));
assert.ok(app.includes("Route time will be calculated during itinerary planning."));
assert.ok(app.includes("Destination Refinement"));
assert.ok(app.includes("Ready with advisory"));
assert.ok(!app.includes(">Needs review<"));
assert.ok(!app.includes("Issue requires review"));
assert.ok(!app.includes("maxLength"));
assert.ok(!app.includes("maxlength"));
assert.ok(!app.includes("substring(0, 3)"));
assert.ok(!app.includes("substr(0, 3)"));
assert.ok(!/finally\s*{\s*ui\.locationLoading\[field\]\s*=\s*false;\s*render\(\);/s.test(app));
assert.ok(/finally\s*{\s*if \(ui\.locationRequestId\[field\] !== requestId\) return;\s*ui\.locationLoading\[field\]\s*=\s*false;\s*refreshLocationPanel\(\);/s.test(app));
assert.ok(/locationProvider\.search\(String\(value \|\| ""\)\.trim\(\)\)/.test(app));
assert.ok(!/selectLocationSuggestion\(field,\s*0\)/.test(app));
assert.ok(!/blur[\s\S]{0,160}selectLocation/.test(app));

assert.ok(css.includes(".field-shell"));
assert.ok(css.includes("--turquoise"));
assert.ok(css.includes(".metric-travelers"));
assert.ok(css.includes(".metric-dates"));
assert.ok(css.includes(".metric-issues"));
assert.ok(css.includes(".metric-preferences"));
assert.ok(css.includes("grid-template-rows: auto auto minmax(18px, auto)"));
assert.ok(css.includes("--control-height: 44px"));
assert.ok(css.includes(".location-results-panel"));
assert.ok(css.includes(".travel-header-illustration"));
assert.ok(css.includes(".sidebar-scenic-illustration"));
assert.ok(css.includes(".location-clear"));
assert.ok(css.includes(".location-result mark"));
assert.ok(css.includes(".location-layer { position: fixed; inset: 0; z-index: 1100; background: transparent; pointer-events: none; }"));
assert.ok(css.includes(".location-results-panel { pointer-events: auto; }"));
assert.ok(css.includes(".route-summary"));
assert.ok(css.includes(".advisory-panel"));
assert.ok(css.includes(".toast { position: fixed; right: 24px; top: 18px;"));

console.log("Location autocomplete tests passed");
