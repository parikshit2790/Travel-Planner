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
import { mockLocationSearch } from "../server/lib/mock-provider.js";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const provider = readFileSync("src/location-provider.js", "utf8");
const domain = readFileSync("src/domain.js", "utf8");

assert.equal(initialState.trip.from, "");
assert.equal(initialState.trip.destination, "");
assert.equal(initialState.trip.days, "");
assert.equal(initialState.trip.startDate, "");
assert.equal(initialState.trip.endDate, "");
assert.equal(initialState.trip.description, "");

assert.equal(LOCATION_MIN_QUERY_LENGTH, 2);
assert.ok(LOCATION_SEARCH_DEBOUNCE_MS >= 250);
assert.ok(LOCATION_SEARCH_DEBOUNCE_MS <= 350);
assert.ok(provider.includes("ApiLocationSearchProvider"));
assert.ok(provider.includes("routeMosaicApi.searchLocations(query)"));
assert.ok(!provider.includes("https://nominatim.openstreetmap.org"));
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

const sanSuggestions = mockLocationSearch("san");
assert.ok(sanSuggestions.length >= 5);
assert.equal(sanSuggestions[0].displayName, "San Jose, California, United States");
assert.ok(sanSuggestions.some((item) => item.displayName === "San Francisco, California, United States"));
assert.ok(sanSuggestions.some((item) => item.displayName === "San Diego, California, United States"));
assert.ok(sanSuggestions.some((item) => item.displayName === "San Antonio, Texas, United States"));
assert.ok(sanSuggestions.some((item) => item.displayName === "San Juan, Puerto Rico, United States"));
assert.equal(sanSuggestions.some((item) => item.displayName.toLowerCase() === "san"), false);

const charlotteSuggestions = mockLocationSearch("charlotte");
assert.equal(charlotteSuggestions[0].displayName, "Charlotte, North Carolina, United States");
assert.equal(charlotteSuggestions[0].locationType, "City");

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
assert.equal(locationVerificationLabel(null, "ProviderUnavailable"), "Location search is temporarily unavailable. Typed text remains unverified until you select a suggestion.");

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
assert.ok(app.includes("Location search is temporarily unavailable. You may retry, or continue with the typed location."));
assert.ok(app.includes("Location search timed out. You may retry, or continue with the typed location."));
assert.ok(app.includes("No matching locations found. You may continue with the typed location, but it will remain unverified until a suggestion is selected."));
assert.ok(app.includes("TravelHeaderIllustration"));
assert.ok(app.includes("SidebarScenicIllustration"));
assert.ok(app.includes("visibleTripBasicsIssues"));
assert.ok(app.includes("visibleReviewIssues"));
assert.ok(app.includes("mockDestinationDataAvailable"));
// locationVerificationIssues is UI-only (unlike domain.js's tripBasicsIssues,
// which also gates generateTripPlan's server-side pre-flight check, where
// dozens of test fixtures construct trips without ever setting
// fromLocation/destinationLocation). It's wired into visibleTripBasicsIssues
// and the continueBasics handler so an unverified location blocks advancing
// past Trip Basics itself, not just the final Review step.
assert.ok(app.includes("function locationVerificationIssues"));
assert.ok(app.includes("...locationVerificationIssues(state.trip)"));
assert.ok(app.includes("Traveling From must be selected from location suggestions before building."));
assert.ok(app.includes("Destination must be selected from location suggestions before building."));
assert.ok(app.includes("This destination is not available in the current demo data."));
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
assert.ok(!/Math\.max\(0,\s*ui\.locationHighlight\[field\]\)/.test(app));
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

// Places Already in Mind / Must-do Places are verified-autocomplete "tag"
// fields (chips), not plain free text -- see addVerifiedPlaceTag() for why
// (ambiguous/misspelled free text was resolving to wrong, unrelated cities).
assert.ok(app.includes("function placeTagsField"));
assert.ok(app.includes("function addVerifiedPlaceTag"));
assert.ok(app.includes("function removePlaceTag"));
assert.ok(app.includes('placeTagsField("placesInMind"'));
assert.ok(app.includes('placeTagsField("mustDoPlaces"'));
assert.ok(app.includes('removePlaceTag:${esc(field)}:${index}'));
assert.ok(app.includes('name.startsWith("removePlaceTag:")'));
assert.ok(app.includes("`${field}Verified`"));
assert.ok(domain.includes("placesInMindVerified"));
assert.ok(domain.includes("mustDoPlacesVerified"));
assert.ok(!app.includes('input("trip.routePreferences.placesInMind"'));
assert.ok(!app.includes('input("trip.routePreferences.mustDoPlaces"'));

assert.ok(css.includes(".place-tag-list"));
assert.ok(css.includes(".place-tag.verified"));
assert.ok(css.includes(".place-tag.unverified"));
assert.ok(css.includes(".place-tag-remove"));

const tagTrip = createTripDraft();
assert.deepEqual(tagTrip.routePreferences.placesInMindVerified, []);
assert.deepEqual(tagTrip.routePreferences.mustDoPlacesVerified, []);

console.log("Location autocomplete tests passed");
