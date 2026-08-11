import { calculateTripNights, normalizePlaceName, travelerTotal, uid } from "./domain.js";

export const tripStructureOptions = [
  {
    value: "one-city",
    label: "Stay in one city",
    helper: "Keep one hotel base and explore the destination in depth."
  },
  {
    value: "one-base-day-trips",
    label: "Use one base with nearby day trips",
    helper: "Stay in one hotel and include nearby places that can be visited comfortably in a day."
  },
  {
    value: "multi-city",
    label: "Visit multiple cities",
    helper: "Split the trip across two or more overnight bases."
  },
  {
    value: "recommend",
    label: "Let RouteMosaic recommend the best structure",
    helper: "We'll compare convenience, variety, travel time, and hotel changes before proposing the best route."
  }
];

export const defaultRoutePreferences = {
  tripStructure: "recommend",
  placesInMind: "",
  // Places Already in Mind / Must-do Places directly become candidate names
  // for regional-extension research (see splitList usage below) -- a
  // free-typed, unverified short or misspelled name (e.g. "Ashville" for
  // Asheville, NC) can resolve to a same-named place hundreds of miles away
  // with no relation to the trip at all (confirmed live: it resolved to
  // Ashville, Virginia). These arrays track which comma-separated segments
  // of placesInMind/mustDoPlaces were added via a verified, geocoded
  // autocomplete suggestion (see placeTagsField in app.js) rather than
  // typed free text, so the UI can show which entries are trustworthy. The
  // *Locations maps carry that suggestion's real coordinates, keyed by name
  // -- candidateStops() below uses them for a real distance estimate instead
  // of guessing (see inferDriveMinutes).
  placesInMindVerified: [],
  placesInMindLocations: {},
  mustDoPlaces: "",
  mustDoPlacesVerified: [],
  mustDoPlacesLocations: {},
  placesToAvoid: "",
  openToNearbyCities: "Yes",
  maxHotelChanges: "1",
  maxTransferDriveTime: "3 hours",
  maxDayTripDriveTime: "2 hours",
  arrivalDateTime: "",
  departureDateTime: "",
  arrivalPoint: "",
  departurePoint: "",
  rentalCar: "Unknown",
  knownHotelOrNeighborhood: "",
  existingReservations: "",
  recoveryAfterArrival: "Yes",
  nightDrivingComfort: "Prefer to avoid",
  earlyStarts: "Open if worth it",
  sunriseInterest: "Optional",
  sunsetInterest: "Interested",
  photographyImportance: "Medium",
  remoteAreaComfort: "Moderate",
  offlineMaps: "Yes"
};

const MIN_MULTI_CITY_TRANSFER_MINUTES = 45;

export function ensureRouteArchitecture(trip) {
  trip.routePreferences = { ...defaultRoutePreferences, ...(trip.routePreferences || {}) };
  trip.routeOptions ||= [];
  trip.approvedTripShape ||= null;
  return trip;
}

export function routeRecommendationRequired(trip) {
  ensureRouteArchitecture(trip);
  return ["one-base-day-trips", "multi-city", "recommend"].includes(trip.routePreferences.tripStructure);
}

export function approvedRouteStillValid(trip) {
  ensureRouteArchitecture(trip);
  return Boolean(trip.approvedTripShape?.userApprovalTimestamp && trip.approvedTripShape?.inputSignature === routeInputSignature(trip));
}

export function resetRouteApproval(trip) {
  ensureRouteArchitecture(trip);
  trip.routeOptions = [];
  trip.approvedTripShape = null;
  return trip;
}

export function generateRouteArchitectureOptions(trip) {
  ensureRouteArchitecture(trip);
  const signature = routeInputSignature(trip);
  const rawDestination = normalizePlaceName(trip.destinationDisplay || trip.destination || "Destination");
  const origin = normalizePlaceName(trip.fromDisplay || trip.from || "Origin");
  const days = Math.max(1, Number(trip.days || 1));
  const nights = calculateTripNights(days);
  const prefs = trip.routePreferences;
  const maxHotelChanges = parseIntegerPreference(prefs.maxHotelChanges, 1);
  const maxTransferMinutes = parseHoursToMinutes(prefs.maxTransferDriveTime) || 180;
  const maxDayTripMinutes = parseHoursToMinutes(prefs.maxDayTripDriveTime) || 120;
  const allCandidates = candidateStops(trip, rawDestination);
  const depth = estimateDestinationDepth(trip, allCandidates);

  // A country/state/broad region cannot be a hotel base. When the traveler named
  // specific places to include, anchor the trip on the first one they listed instead
  // of using the broad destination text directly as a lodging base.
  const explicitCandidates = allCandidates.filter((item) => item.explicit);
  const primaryFromRefinement = depth.destinationScope === "regional-or-broad" && explicitCandidates.length ? explicitCandidates[0] : null;
  const destination = primaryFromRefinement ? primaryFromRefinement.name : rawDestination;
  const candidates = primaryFromRefinement
    ? allCandidates.filter((item) => item.name.toLowerCase() !== primaryFromRefinement.name.toLowerCase())
    : allCandidates;
  const remainingExplicit = candidates.filter((item) => item.explicit);

  const options = [];

  if (["one-city", "one-base-day-trips", "recommend"].includes(prefs.tripStructure)) {
    options.push(oneCityOption({ trip, origin, destination, days, nights, depth, signature, primaryFromRefinement, remainingExplicit }));
  }

  if (["one-base-day-trips", "recommend"].includes(prefs.tripStructure) && maxDayTripMinutes >= 60) {
    options.push(dayTripOption({ trip, destination, days, nights, candidates, depth, maxDayTripMinutes, signature, primaryFromRefinement, remainingExplicit }));
  }

  if (["multi-city", "recommend"].includes(prefs.tripStructure) && maxHotelChanges > 0) {
    const primaryCoordinates = primaryDestinationCoordinates(trip);
    const stops = buildMultiCityChain(trip, destination, primaryCoordinates, candidates, depth, maxHotelChanges, maxTransferMinutes);
    if (stops.length) options.push(multiCityOption({ trip, destination, days, nights, stops, maxHotelChanges, signature, primaryFromRefinement, remainingExplicit }));
  }

  const filtered = options
    .filter((option) => option.hotelChanges <= maxHotelChanges)
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.confidence - a.confidence)
    .slice(0, 3)
    .map((option, index) => ({ ...option, rank: index + 1, recommended: index === 0 || option.recommended }));

  return filtered.length ? filtered : [oneCityOption({ trip, origin, destination, days, nights, depth, signature, primaryFromRefinement, remainingExplicit })];
}

// Every explicit "Cities or Regions to Include" entry must end up accounted for on
// every option: as the primary base, an additional overnight base, a day trip, or
// explicitly excluded with a human-readable reason. Nothing may silently disappear.
function refinementCoverage({ primaryFromRefinement, remainingExplicit, usedAsBase = [], usedAsDayTrip = [], excludedReason }) {
  const used = new Set([...usedAsBase, ...usedAsDayTrip].map((name) => name.toLowerCase()));
  const excludedRefinements = remainingExplicit
    .filter((item) => !used.has(item.name.toLowerCase()))
    .map((item) => ({ name: item.name, reason: excludedReason }));
  return {
    includedRefinements: [...(primaryFromRefinement ? [primaryFromRefinement.name] : []), ...usedAsBase],
    dayTripRefinements: usedAsDayTrip,
    excludedRefinements
  };
}

export function approveRouteOption(trip, optionId) {
  ensureRouteArchitecture(trip);
  const options = trip.routeOptions?.length ? trip.routeOptions : generateRouteArchitectureOptions(trip);
  const option = options.find((item) => item.id === optionId) || options[0];
  trip.routeOptions = options;
  trip.approvedTripShape = {
    ...structuredClone(option),
    approvedStops: option.sequence,
    rejectedSuggestedStops: options.filter((item) => item.id !== option.id).flatMap((item) => item.sequence).filter((item) => !option.sequence.includes(item)),
    fullExperienceDays: Math.max(0, Number(trip.days || 0) - option.transferDays.length),
    userApprovalTimestamp: new Date().toISOString(),
    inputSignature: routeInputSignature(trip)
  };
  return trip.approvedTripShape;
}

export function routeInputSignature(trip) {
  const prefs = trip.routePreferences || {};
  return JSON.stringify({
    from: trip.fromDisplay || trip.from || "",
    destination: trip.destinationDisplay || trip.destination || "",
    days: trip.days || "",
    startDate: trip.startDate || "",
    endDate: trip.endDate || "",
    transportation: trip.transportation || "",
    travelerCount: travelerTotal(trip),
    tripStructure: prefs.tripStructure || "",
    placesInMind: prefs.placesInMind || "",
    mustDoPlaces: prefs.mustDoPlaces || "",
    placesToAvoid: prefs.placesToAvoid || "",
    openToNearbyCities: prefs.openToNearbyCities || "",
    maxHotelChanges: prefs.maxHotelChanges || "",
    maxTransferDriveTime: prefs.maxTransferDriveTime || "",
    maxDayTripDriveTime: prefs.maxDayTripDriveTime || "",
    arrivalPoint: prefs.arrivalPoint || "",
    departurePoint: prefs.departurePoint || ""
  });
}

export function estimateDestinationDepth(trip, candidates = []) {
  const days = Math.max(1, Number(trip.days || 1));
  const destination = normalizePlaceName(trip.destinationDisplay || trip.destination || "");
  const geocodedType = String(trip.destinationLocation?.locationType || "");
  // The un-geocoded fallback below is meant to catch a destination that IS
  // simply a state/region/country (the traveler typed "Florida" with
  // nothing more specific) -- testing the FULL destination string for that
  // false-positives on every ordinary city in one of these states, since a
  // normally-formatted "City, State, Country" name always contains the
  // state name too. Confirmed live: "Miami, Florida, United States" (without
  // a resolved locationType, e.g. free-typed rather than picked from
  // autocomplete) read as "broad", which silently replaced Miami with the
  // first explicit "Places Already in Mind" city as the trip's real primary
  // destination -- Miami itself disappeared from a Miami + Orlando trip.
  // Test only the destination's own leading segment (before any state/
  // country suffix), matching the same "core name" pattern already used for
  // candidate matching elsewhere in this file.
  const destinationCore = destination.split(",")[0].trim();
  const broad = ["Country", "State or region", "State", "Region"].includes(geocodedType)
    || (!geocodedType && /\b(california|michigan|texas|florida|europe|japan|italy|southern california|northern michigan)\b/i.test(destinationCore));
  const explicitRegions = splitList(trip.destinationRegions).length + splitList(trip.routePreferences?.placesInMind).length;
  const interestCount = (trip.preferences || []).filter((pref) => pref.category === "experiences").length;
  let attractionCapacity = broad ? 8 : 6;
  if (/\b(los angeles|new york|paris|tokyo|chicago|dallas|austin|houston|san francisco|london)\b/i.test(destination)) attractionCapacity = 12;
  if (/\b(national park|glacier|yellowstone|yosemite|michigan|upper peninsula)\b/i.test(destination)) attractionCapacity = 9;
  attractionCapacity += Math.min(5, explicitRegions + interestCount);
  const canFill = attractionCapacity >= days * 2;
  return {
    destination,
    destinationScope: broad ? "regional-or-broad" : "city-or-focused-region",
    attractionCapacity,
    tripLengthPressure: days > 4 && !canFill ? "needs-complements" : "sufficient-depth",
    canFillTripStrongly: canFill,
    reasons: [
      broad ? "Destination reads as a region, state, country, or broad travel area." : "Destination reads as a focused city or local area.",
      canFill ? "The primary destination appears deep enough for a strong first route option." : "The destination may benefit from day trips or a nearby base if travel limits allow."
    ]
  };
}

export function destinationExpansionScore(trip, primaryDestination, candidate, depth = estimateDestinationDepth(trip)) {
  const text = `${trip.description || ""} ${trip.destinationRegions || ""} ${trip.routePreferences?.placesInMind || ""} ${trip.routePreferences?.mustDoPlaces || ""}`.toLowerCase();
  const name = String(candidate.name || "").toLowerCase();
  const explicitMention = text.includes(name);
  const transferBurdenMinutes = candidate.driveMinutes || 120;
  const addedExperienceValue = explicitMention ? 24 : depth.canFillTripStrongly ? 12 : 20;
  const uniqueness = candidate.type === "national-park" || candidate.type === "coast" || candidate.type === "island" ? 16 : 12;
  const transferBurden = Math.max(0, 22 - Math.round(transferBurdenMinutes / 12));
  const lodgingBurden = parseIntegerPreference(trip.routePreferences?.maxHotelChanges, 1) > 0 ? 10 : -80;
  const routeCompatibility = transferBurdenMinutes <= (parseHoursToMinutes(trip.routePreferences?.maxTransferDriveTime) || 180) ? 14 : -60;
  const interestMatch = explicitMention ? 18 : /\b(scenic|coast|beach|mountain|lake|waterfall|museum|history|food|culture)\b/i.test(text) ? 10 : 6;
  const dayCountFit = Number(trip.days || 0) >= 4 ? 12 : -20;
  const budgetImpact = /strict/i.test(trip.budget?.strictness || "") ? -8 : 4;
  const total = addedExperienceValue + uniqueness + transferBurden + lodgingBurden + routeCompatibility + interestMatch + dayCountFit + budgetImpact;
  return { total, addedExperienceValue, uniqueness, transferBurden, transferBurdenMinutes, lodgingBurden, routeCompatibility, interestMatch, budgetImpact, dayCountFit };
}

function primaryDestinationCoordinates(trip) {
  const lat = trip.destinationLat ?? trip.destinationLocation?.latitude;
  const lng = trip.destinationLng ?? trip.destinationLocation?.longitude;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null;
}

// A candidate's driveMinutes (from candidateStops) is always measured from
// the PRIMARY destination, regardless of what order stops actually end up
// in -- confirmed live against real routes: Las Vegas to LA is a reasonable
// 4h15m, but LA measured from Phoenix (the primary destination on a
// Phoenix -> Grand Canyon -> Vegas -> LA trip) reads as a ~9-hour leg and
// gets rejected, even though the traveler would never actually drive that
// leg -- they'd drive from Vegas. Recompute the leg from wherever the chain
// actually is right now when we know real coordinates for both ends; fall
// back to the precomputed hub-relative/guessed value when we don't (a
// keyword-based guess has no reference point to recompute from anyway).
function chainLegMinutes(fromCoordinates, entry) {
  if (fromCoordinates && entry.coordinates) {
    const miles = haversineMiles(fromCoordinates.lat, fromCoordinates.lng, entry.coordinates.lat, entry.coordinates.lng);
    if (Number.isFinite(miles) && miles > 0) return estimatedDriveMinutesForMiles(miles);
  }
  return entry.driveMinutes || 120;
}

// Builds the multi-city stop sequence leg by leg from wherever the chain
// currently ends (starting at the primary destination), instead of picking
// the top-scored candidates by their distance from the primary destination
// alone. Explicitly-requested places are always tried first at each step;
// among those, the nearest reachable one from the current position wins.
// Quality (destinationExpansionScore) is evaluated using the REAL leg the
// stop would travel in this chain position, not its hub-relative distance,
// so a place that's a poor fit from the hub but a good fit from the
// previous stop scores correctly.
function buildMultiCityChain(trip, destination, primaryCoordinates, candidates, depth, maxHotelChanges, maxTransferMinutes) {
  const chain = [];
  let position = primaryCoordinates;
  let remaining = [...candidates];
  while (chain.length < maxHotelChanges && remaining.length) {
    const withLeg = remaining
      .map((candidate) => ({ candidate, legMinutes: chainLegMinutes(position, candidate) }))
      // candidate.explicit is `true` for traveler-named places and simply
      // absent (undefined) for auto-suggested ones -- Number(undefined) is
      // NaN, and `NaN - 1` is also NaN, which silently breaks a numeric sort
      // comparator (most engines treat a NaN result as "equal," leaving
      // explicit and inferred candidates in whatever order they happened to
      // already be in). Confirmed live: an explicit "San Diego" request lost
      // to an auto-suggested "Malibu" purely because of this. Coerce to a
      // real boolean before subtracting.
      .sort((a, b) => Number(Boolean(b.candidate.explicit)) - Number(Boolean(a.candidate.explicit)) || a.legMinutes - b.legMinutes);
    // A place close enough to be a same-day excursion isn't worth checking
    // out of one hotel and into another for -- confirmed live: "Lake Norman"
    // (a ~25 minute drive from Charlotte, effectively the same metro area)
    // had nothing stopping it from being proposed as its own multi-city
    // hotel base. MIN_MULTI_CITY_TRANSFER_MINUTES mirrors the server's own
    // "local" classification boundary (round-trip <= 90 min, i.e. one-way
    // <= 45 min) so a place this close routes into a day trip instead.
    const next = withLeg.find((item) => item.legMinutes <= maxTransferMinutes && item.legMinutes >= MIN_MULTI_CITY_TRANSFER_MINUTES);
    if (!next) break;
    const score = destinationExpansionScore(trip, destination, { ...next.candidate, driveMinutes: next.legMinutes }, depth);
    remaining = remaining.filter((item) => item !== next.candidate);
    if (score.total < 58) continue;
    chain.push({ candidate: next.candidate, score });
    position = next.candidate.coordinates || position;
  }
  return chain;
}

function oneCityOption({ trip, origin, destination, days, nights, depth, signature, primaryFromRefinement, remainingExplicit }) {
  const coverage = refinementCoverage({
    primaryFromRefinement,
    remainingExplicit,
    excludedReason: "Not included in this single-base option; see the multi-city or day-trip options to include it."
  });
  return {
    id: uid("route"),
    tripShapeType: "single-city",
    title: `${destination} base`,
    recommended: trip.routePreferences.tripStructure === "one-city" || depth.canFillTripStrongly,
    destinationScope: depth.destinationScope,
    primaryDestination: destination,
    sequence: [destination],
    hotelBases: [tripBase(destination, nights, trip)],
    nightsPerBase: [{ base: destination, nights }],
    transferDays: [],
    majorDriveDays: [],
    dayTripCandidates: [],
    hotelChanges: 0,
    approximateTransferTime: "No base transfer",
    totalMajorDriving: "Local daily routing only",
    confidence: depth.canFillTripStrongly ? 86 : 72,
    whyMatches: `Keeps the trip simple from ${origin} and avoids losing time to luggage, check-in, and transfer logistics.`,
    benefits: ["No hotel changes", "Deeper coverage of the primary destination", "More flexible backup days"],
    tradeoffs: ["Less regional variety", "Some cross-town travel may still be required"],
    assumptions: depth.reasons,
    inputSignature: signature,
    ...coverage
  };
}

function dayTripOption({ trip, destination, days, nights, candidates, maxDayTripMinutes, signature, primaryFromRefinement, remainingExplicit }) {
  const dayTrips = candidates.filter((candidate) => (candidate.driveMinutes || 90) <= maxDayTripMinutes).slice(0, 3);
  const coverage = refinementCoverage({
    primaryFromRefinement,
    remainingExplicit,
    usedAsDayTrip: dayTrips.filter((item) => item.explicit).map((item) => item.name),
    excludedReason: `Estimated travel time exceeds your day-trip comfort of ${Math.round(maxDayTripMinutes / 60)} hour(s), or only the top 3 closest day-trip candidates are shown.`
  });
  return {
    id: uid("route"),
    tripShapeType: "one-base-day-trips",
    title: `${destination} base with day trips`,
    recommended: trip.routePreferences.tripStructure === "one-base-day-trips",
    destinationScope: "city-plus-nearby",
    primaryDestination: destination,
    sequence: [destination],
    hotelBases: [tripBase(destination, nights, trip)],
    nightsPerBase: [{ base: destination, nights }],
    transferDays: [],
    majorDriveDays: dayTrips.map((item) => `${destination} to ${item.name} day trip`),
    dayTripCandidates: dayTrips.map((item) => item.name),
    hotelChanges: 0,
    approximateTransferTime: "No hotel transfer",
    totalMajorDriving: dayTrips.length ? `Up to ${Math.round(maxDayTripMinutes / 60)} hours on selected day-trip days` : "No major day trips identified yet",
    confidence: dayTrips.length ? 80 : 64,
    whyMatches: "Adds variety without changing hotels, so nearby places are proposed but not silently added to the final itinerary.",
    benefits: ["One hotel base", "Nearby variety", "Easy to cut day trips if tired"],
    tradeoffs: ["Longer individual driving days", "Day trips must return before evening plans"],
    assumptions: ["Day trips stay within the selected day-trip driving comfort.", "Nearby cities remain optional until approved."],
    inputSignature: signature,
    ...coverage
  };
}

function distributeStopNights(totalNights, stopCount) {
  if (stopCount <= 0) return { primaryNights: totalNights, stopNights: [] };
  const stopNights = [];
  let remaining = totalNights;
  for (let index = 0; index < stopCount; index += 1) {
    const nightsForStop = Math.max(1, Math.min(2, Math.floor(remaining / (stopCount - index + 1))));
    stopNights.push(nightsForStop);
    remaining -= nightsForStop;
  }
  return { primaryNights: Math.max(1, remaining), stopNights };
}

function multiCityOption({ trip, destination, days, nights, stops, maxHotelChanges, signature, primaryFromRefinement, remainingExplicit }) {
  const { primaryNights, stopNights } = distributeStopNights(nights, stops.length);
  const stopNames = stops.map((item) => item.candidate.name);
  const totalTransferMinutes = stops.reduce((sum, item) => sum + item.score.transferBurdenMinutes, 0);
  const coverage = refinementCoverage({
    primaryFromRefinement,
    remainingExplicit,
    usedAsBase: stopNames,
    excludedReason: `Adding this as another overnight base would exceed your current hotel-change comfort (${maxHotelChanges}) or estimated transfer-time comfort; increase either preference or drop another city to include it.`
  });
  return {
    id: uid("route"),
    tripShapeType: "multi-city",
    title: `${destination} + ${stopNames.join(" + ")}`,
    recommended: trip.routePreferences.tripStructure === "multi-city" || (!estimateDestinationDepth(trip).canFillTripStrongly && maxHotelChanges > 0),
    destinationScope: "multi-base",
    primaryDestination: destination,
    sequence: [destination, ...stopNames],
    hotelBases: [tripBase(destination, primaryNights, trip), ...stops.map((item, index) => tripBase(item.candidate.name, stopNights[index], trip))],
    nightsPerBase: [{ base: destination, nights: primaryNights }, ...stops.map((item, index) => ({ base: item.candidate.name, nights: stopNights[index] }))],
    transferDays: stops.map((item) => `Transfer to ${item.candidate.name}`),
    // Each leg now travels from wherever the chain actually was at that
    // point, not always from the primary destination -- label it that way
    // (e.g. "Las Vegas to Los Angeles", not "Phoenix to Los Angeles").
    majorDriveDays: stops.map((item, index) => `${[destination, ...stopNames][index]} to ${item.candidate.name}`),
    dayTripCandidates: [],
    hotelChanges: stops.length,
    approximateTransferTime: formatMinutes(totalTransferMinutes),
    totalMajorDriving: formatMinutes(totalTransferMinutes),
    confidence: Math.min(88, Math.max(62, Math.round(stops.reduce((sum, item) => sum + item.score.total, 0) / stops.length))),
    whyMatches: `Adds ${stopNames.join(", ")} because ${stops.length > 1 ? "their expansion scores justify" : `its expansion score (${stops[0].score.total}) justifies`} the transfer burden for this trip.`,
    benefits: ["More regional variety", "Different neighborhoods or scenery", "Better fit for explicitly requested nearby places"],
    tradeoffs: [`${stops.length} hotel change${stops.length === 1 ? "" : "s"}`, "Luggage/check-out/check-in time required", "Less time in the primary destination"],
    assumptions: ["No unapproved additional city is included.", "Each transfer day must include hotel checkout, luggage, and check-in buffers."],
    expansionScores: stops.map((item) => item.score),
    inputSignature: signature,
    ...coverage
  };
}

function candidateStops(trip, destination) {
  const explicit = [
    ...splitList(trip.destinationRegions),
    ...splitList(trip.routePreferences?.placesInMind),
    ...splitList(trip.routePreferences?.mustDoPlaces)
  ].filter((item) => item && normalizePlaceName(item) !== destination);
  const knownLocations = {
    ...(trip.routePreferences?.placesInMindLocations || {}),
    ...(trip.routePreferences?.mustDoPlacesLocations || {})
  };
  const locationsByKey = Object.fromEntries(Object.entries(knownLocations).map(([name, coords]) => [name.toLowerCase(), coords]));
  const described = inferNearbyCandidates(`${destination} ${trip.description || ""}`);
  const merged = [
    ...explicit.map((name) => {
      const coords = locationsByKey[String(name).toLowerCase()];
      const coordinates = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng) ? { lat: Number(coords.lat), lng: Number(coords.lng) } : null;
      return {
        name: normalizePlaceName(name),
        driveMinutes: driveMinutesFor(trip, coords, name),
        coordinates,
        type: inferStopType(name),
        explicit: true
      };
    }),
    ...described.map((item) => ({ ...item, coordinates: null, explicit: false }))
  ];
  const seen = new Set();
  return merged.filter((candidate) => {
    const key = candidate.name.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function inferNearbyCandidates(text) {
  const lower = String(text || "").toLowerCase();
  const candidates = [];
  const add = (name, driveMinutes, type = "city") => candidates.push({ name, driveMinutes, type });
  if (lower.includes("los angeles") || lower.includes("southern california")) {
    add("Santa Barbara", 105, "coast");
    add("San Diego", 130, "city");
    add("Malibu", 55, "coast");
  }
  if (lower.includes("michigan") || lower.includes("upper peninsula")) {
    add("Munising", 300, "nature");
    add("Mackinac Island", 150, "island");
    add("Traverse City", 150, "city");
    add("Sleeping Bear Dunes", 35, "national-park");
  }
  if (lower.includes("dallas")) {
    add("Fort Worth Stockyards", 45, "culture");
    add("Grapevine", 35, "small-town");
  }
  if (lower.includes("charlotte")) {
    add("Asheville", 130, "mountain");
    add("Lake Norman", 35, "lake");
  }
  return candidates;
}

function tripBase(name, nights, trip) {
  return {
    placeId: normalizePlaceName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    canonicalName: normalizePlaceName(name),
    shortName: normalizePlaceName(name).split(",")[0],
    coordinates: null,
    checkInDate: "",
    checkOutDate: "",
    nights: Math.max(0, Number(nights || 0)),
    knownHotel: trip.routePreferences?.knownHotelOrNeighborhood || "",
    preferredArea: trip.routePreferences?.knownHotelOrNeighborhood || "",
    suggestedArea: "",
    parkingNeed: /rent a car|drive/i.test(trip.transportation || "") ? "Confirm parking before booking." : "Parking need not specified.",
    breakfastIncluded: (trip.lodging?.styles || []).includes("Free breakfast"),
    luggageNotes: "Build final itinerary with checkout, luggage storage, and check-in buffers."
  };
}

function splitList(value) {
  return String(value || "").split(/[,;\n]+/).map((item) => normalizePlaceName(item)).filter(Boolean);
}

function parseIntegerPreference(value, fallback) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function parseHoursToMinutes(value) {
  const text = String(value || "").toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
  const minuteMatch = text.match(/(\d+)\s*m/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const number = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 60) : 0;
}

// A verified suggestion carries a real geocoded location -- use it instead
// of the blind inferDriveMinutes() guess whenever one is available. Falls
// back to the guess only for free-typed or hard-coded-list candidates that
// were never resolved through the autocomplete.
function driveMinutesFor(trip, location, name) {
  const destLat = trip.destinationLat ?? trip.destinationLocation?.latitude;
  const destLng = trip.destinationLng ?? trip.destinationLocation?.longitude;
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && Number.isFinite(destLat) && Number.isFinite(destLng)) {
    const miles = haversineMiles(destLat, destLng, location.lat, location.lng);
    if (Number.isFinite(miles) && miles > 0) return estimatedDriveMinutesForMiles(miles);
  }
  return inferDriveMinutes(name);
}

// A flat ~42mph-equivalent conversion badly understates genuine long-haul
// interstate legs -- confirmed against real Google Maps routes: Phoenix to
// LA is 372 road miles in 5h38m (~66mph), and Las Vegas to LA is 270 road
// miles in 4h15m (~63mph), both far faster than the old flat factor implied
// once compounded with the straight-line-vs-road-distance gap (it estimated
// Phoenix-to-LA at over 9 hours). Short, traffic-heavy local hops really are
// slower than that on average, so use a distance-tiered speed instead of one
// constant: this is a straight-line estimate feeding a "day trip vs.
// overnight base" decision, not a routing engine, so it only needs to be in
// the right neighborhood, not precise.
function estimatedDriveMinutesForMiles(miles) {
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  const impliedMph = miles <= 30 ? 32 : miles <= 100 ? 46 : 62;
  const buffer = miles > 25 ? 20 : 8;
  return Math.round((miles / impliedMph) * 60) + buffer;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const radiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inferDriveMinutes(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("san diego")) return 130;
  if (lower.includes("santa barbara")) return 105;
  if (lower.includes("mackinac") || lower.includes("traverse") || lower.includes("munising")) return 150;
  if (lower.includes("stockyard") || lower.includes("grapevine")) return 45;
  return 90;
}

function inferStopType(name) {
  const lower = String(name || "").toLowerCase();
  if (/beach|coast|santa barbara|malibu/.test(lower)) return "coast";
  if (/park|dunes|glacier|yosemite|yellowstone/.test(lower)) return "national-park";
  if (/island/.test(lower)) return "island";
  if (/lake|waterfall/.test(lower)) return "nature";
  return "city";
}

function formatMinutes(minutes) {
  const value = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (!hours) return `${mins} min`;
  return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
}
