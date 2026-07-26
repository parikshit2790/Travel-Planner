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
  mustDoPlaces: "",
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
  const destination = normalizePlaceName(trip.destinationDisplay || trip.destination || "Destination");
  const origin = normalizePlaceName(trip.fromDisplay || trip.from || "Origin");
  const days = Math.max(1, Number(trip.days || 1));
  const nights = calculateTripNights(days);
  const prefs = trip.routePreferences;
  const maxHotelChanges = parseIntegerPreference(prefs.maxHotelChanges, 1);
  const maxTransferMinutes = parseHoursToMinutes(prefs.maxTransferDriveTime) || 180;
  const maxDayTripMinutes = parseHoursToMinutes(prefs.maxDayTripDriveTime) || 120;
  const candidates = candidateStops(trip, destination);
  const depth = estimateDestinationDepth(trip, candidates);
  const options = [];

  if (["one-city", "one-base-day-trips", "recommend"].includes(prefs.tripStructure)) {
    options.push(oneCityOption({ trip, origin, destination, days, nights, depth, signature }));
  }

  if (["one-base-day-trips", "recommend"].includes(prefs.tripStructure) && maxDayTripMinutes >= 60) {
    options.push(dayTripOption({ trip, origin, destination, days, nights, candidates, depth, maxDayTripMinutes, signature }));
  }

  if (["multi-city", "recommend"].includes(prefs.tripStructure) && maxHotelChanges > 0) {
    const scored = candidates
      .map((candidate) => ({ candidate, score: destinationExpansionScore(trip, destination, candidate, depth) }))
      .filter((item) => item.score.total >= 58 && item.score.transferBurdenMinutes <= maxTransferMinutes)
      .sort((a, b) => b.score.total - a.score.total);
    const best = scored[0];
    if (best) options.push(multiCityOption({ trip, origin, destination, days, nights, stop: best.candidate, score: best.score, maxHotelChanges, signature }));
  }

  const filtered = options
    .filter((option) => option.hotelChanges <= maxHotelChanges)
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.confidence - a.confidence)
    .slice(0, 3)
    .map((option, index) => ({ ...option, rank: index + 1, recommended: index === 0 || option.recommended }));

  return filtered.length ? filtered : [oneCityOption({ trip, origin, destination, days, nights, depth, signature })];
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
  const broad = /\b(california|michigan|texas|florida|europe|japan|italy|southern california|northern michigan)\b/i.test(destination);
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

function oneCityOption({ trip, origin, destination, days, nights, depth, signature }) {
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
    inputSignature: signature
  };
}

function dayTripOption({ trip, destination, days, nights, candidates, maxDayTripMinutes, signature }) {
  const dayTrips = candidates.filter((candidate) => (candidate.driveMinutes || 90) <= maxDayTripMinutes).slice(0, 3);
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
    inputSignature: signature
  };
}

function multiCityOption({ trip, destination, days, nights, stop, score, maxHotelChanges, signature }) {
  const secondBaseNights = Math.max(1, Math.min(2, nights - 2));
  const primaryNights = Math.max(1, nights - secondBaseNights);
  return {
    id: uid("route"),
    tripShapeType: "multi-city",
    title: `${destination} + ${stop.name}`,
    recommended: trip.routePreferences.tripStructure === "multi-city" || (!estimateDestinationDepth(trip).canFillTripStrongly && maxHotelChanges > 0),
    destinationScope: "multi-base",
    primaryDestination: destination,
    sequence: [destination, stop.name],
    hotelBases: [tripBase(destination, primaryNights, trip), tripBase(stop.name, secondBaseNights, trip)],
    nightsPerBase: [{ base: destination, nights: primaryNights }, { base: stop.name, nights: secondBaseNights }],
    transferDays: [`Transfer from ${destination} to ${stop.name}`],
    majorDriveDays: [`${destination} to ${stop.name}`],
    dayTripCandidates: [],
    hotelChanges: 1,
    approximateTransferTime: formatMinutes(score.transferBurdenMinutes),
    totalMajorDriving: formatMinutes(score.transferBurdenMinutes),
    confidence: Math.min(88, Math.max(62, score.total)),
    whyMatches: `Adds ${stop.name} because its expansion score (${score.total}) justifies the transfer burden for this trip.`,
    benefits: ["More regional variety", "Different neighborhoods or scenery", "Better fit for explicitly requested nearby places"],
    tradeoffs: ["One hotel change", "Luggage/check-out/check-in time required", "Less time in the primary destination"],
    assumptions: ["No unapproved third city is included.", "The transfer day must include hotel checkout, luggage, and check-in buffers."],
    expansionScore: score,
    inputSignature: signature
  };
}

function candidateStops(trip, destination) {
  const explicit = [
    ...splitList(trip.destinationRegions),
    ...splitList(trip.routePreferences?.placesInMind),
    ...splitList(trip.routePreferences?.mustDoPlaces)
  ].filter((item) => item && normalizePlaceName(item) !== destination);
  const described = inferNearbyCandidates(`${destination} ${trip.description || ""}`);
  const merged = [...explicit.map((name) => ({ name: normalizePlaceName(name), driveMinutes: inferDriveMinutes(name), type: inferStopType(name), explicit: true })), ...described];
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
