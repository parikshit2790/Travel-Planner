import {
  calculateInclusiveTripDays,
  calculateTripEndDate,
  calculateTripNights,
  getTripIssues,
  travelerTotal,
  uid
} from "./domain.js";
import { createGenericDestinationProfile, getDestinationProfile, resolveDestinationProfile } from "./destination-data.js";
import { buildDestinationIntelligence } from "./destination-intelligence.js";

export const PLAN_VERSION = "routemosaic-local-planner-v1";

export const planningWeights = {
  priority: 3,
  preferenceMatch: 18,
  regionFit: 14,
  timeFit: 8,
  accessibilityGood: 18,
  accessibilityLimitedPenalty: -80,
  budgetFit: 8,
  weatherBalance: 5,
  duplicatePenalty: -90,
  diversityPenalty: -8,
  mustDo: 30,
  hardExclusion: -999
};

const dayThemes = [
  ["santa-monica", "venice"],
  ["griffith-park", "hollywood", "los-feliz"],
  ["brentwood", "beverly-hills", "westwood"],
  ["downtown", "arts-district", "little-tokyo"],
  ["malibu", "santa-monica"],
  ["museum-row", "beverly-hills", "weho"],
  ["pasadena"],
  ["south-bay", "venice"],
  ["universal-city"]
];

const mealDefaults = {
  breakfast: "8:00 AM",
  lunch: "12:30 PM",
  dinner: "6:30 PM"
};

export function normalizePlanningInput(trip, variationSeed = 0) {
  const numberOfDays = normalizeDayCount(trip);
  const startDate = trip.startDate || "";
  const endDate = startDate && numberOfDays ? calculateTripEndDate(startDate, numberOfDays) : trip.endDate || "";
  const pace = normalizePace(trip.schedule?.pace);
  const maxActivities = Number(trip.schedule?.majorActivities || paceDefaults(pace).activities);
  return {
    sourceTripId: trip.id || "",
    origin: trip.fromDisplay || trip.from || "",
    destination: trip.destinationDisplay || trip.destination || "",
    startDate,
    endDate,
    numberOfDays,
    travelers: travelerTotal(trip),
    pace,
    maxActivities: Math.max(1, Math.min(4, maxActivities || paceDefaults(pace).activities)),
    wakeUp: trip.schedule?.wakeUp || "8:00 AM",
    earliestActivity: trip.schedule?.earliestActivity || "9:00 AM",
    latestReturn: trip.schedule?.latestReturn || "9:30 PM",
    maxDrivingMinutes: parseHoursToMinutes(trip.transport?.maxDrivingDay) || 240,
    walkingLimit: trip.activity?.walking || "Easy walking",
    hiking: trip.activity?.hiking || "No hiking",
    groupType: trip.groupType || "Solo trip",
    childCount: Number(trip.children || 0),
    seniorCount: Number(trip.seniors || 0),
    food: structuredClone(trip.food || {}),
    alcohol: structuredClone(trip.alcohol || {}),
    budget: structuredClone(trip.budget || {}),
    lodging: structuredClone(trip.lodging || {}),
    transportation: trip.transportation || "",
    transport: structuredClone(trip.transport || {}),
    preferences: structuredClone(trip.preferences || []),
    travelersDetail: structuredClone(trip.travelers || []),
    mustHavePlaces: splitList(trip.mustHavePlaces),
    avoidPlaces: splitList(trip.avoidPlaces),
    routePreferences: structuredClone(trip.routePreferences || {}),
    approvedTripShape: structuredClone(trip.approvedTripShape || null),
    variationSeed,
    unknownPreferences: collectUnknownPreferences(trip)
  };
}

export function generateTripPlan(trip, options = {}) {
  const normalized = normalizePlanningInput(trip, options.variationSeed || 0);
  const blockingIssues = getTripIssues(trip).filter((issue) => issue.blocking);
  if (blockingIssues.length) {
    return { status: "invalid", errors: blockingIssues, normalized };
  }
  if (!normalized.startDate || !normalized.endDate || !normalized.numberOfDays) {
    return { status: "invalid", errors: [{ severity: "blocking", issue: "Trip dates are required before generating a plan.", action: "Edit Trip Basics" }], normalized };
  }
  const destinationProfile = resolveDestinationProfile(normalized.destination);
  if (!destinationProfile) return { status: "invalid", errors: [{ severity: "blocking", issue: "Destination is required before generating a plan.", action: "Edit Trip Basics" }], normalized };

  const constraints = buildTravelerConstraintProfile(normalized);
  const destinationIntelligence = buildDestinationIntelligence(destinationProfile, normalized, constraints);
  const scored = scoreCandidates(destinationProfile, normalized, constraints, destinationIntelligence);
  const tripShapeOptions = buildTripShapeOptions(destinationProfile, normalized, destinationIntelligence);
  const rawDays = buildDays(destinationProfile, normalized, constraints, scored, destinationIntelligence);
  const hotelBase = buildHotelBase(destinationProfile, normalized, rawDays);
  const days = buildDetailedTripDays(destinationProfile, normalized, constraints, rawDays, hotelBase);
  const foodPlan = buildFoodPlan(destinationProfile, normalized, constraints, days);
  const routeSummary = buildRouteSummary(destinationProfile, days);
  const budgetSummary = buildBudgetSummary(normalized, days);
  const advisories = buildAdvisories(destinationProfile, normalized, constraints, days, budgetSummary);
  const tripGuide = buildDetailedTripGuide(destinationProfile, normalized, constraints, days, hotelBase, routeSummary, budgetSummary, tripShapeOptions);
  const plan = {
    id: uid("plan"),
    sourceTripId: normalized.sourceTripId,
    generatedAt: new Date().toISOString(),
    generationVersion: PLAN_VERSION,
    status: "ready",
    origin: normalized.origin,
    destination: destinationProfile.canonicalName,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    numberOfDays: normalized.numberOfDays,
    travelers: normalized.travelers,
    preferencesSnapshot: structuredClone(normalized),
    overview: buildOverview(destinationProfile, normalized, days, budgetSummary, routeSummary),
    hotelBase,
    days,
    foodPlan,
    routeSummary,
    budgetSummary,
    tripGuide,
    advisories,
    unresolvedConflicts: advisories.filter((item) => item.severity === "conflict" || item.severity === "blocking"),
    generationMetadata: {
      destinationProfileId: destinationProfile.id,
      destinationProfileSnapshot: destinationProfile,
      usesGenericDestinationProfile: destinationProfile.id.startsWith("generic-"),
      approvedTripShape: normalized.approvedTripShape,
      routeApprovalRequired: Boolean(normalized.routePreferences?.tripStructure && normalized.routePreferences.tripStructure !== "one-city"),
      hotelBase,
      variationSeed: normalized.variationSeed,
      scoringWeights: planningWeights,
      destinationIntelligence: summarizeDestinationIntelligence(destinationIntelligence),
      tripShapeOptions,
      unsupportedPreferences: normalized.unknownPreferences
    }
  };
  const validation = validateTripPlan(plan);
  if (validation.blocking.length) {
    plan.status = "needs-review";
    plan.advisories.push(...validation.blocking);
  }
  return { status: "ready", plan };
}

function buildHotelBase(profile, input, days) {
  const regions = days.map((day) => day.region);
  if (profile.id !== "los-angeles") {
    const primaryRegion = profile.regions.find((region) => region.id === profile.planningRules.defaultHotelRegion) || profile.regions[0];
    const alternatives = profile.regions.filter((region) => region.name !== primaryRegion.name).slice(0, 2).map((region) => region.name);
    return {
      primary: primaryRegion.name,
      alternatives,
      reason: `${primaryRegion.name} is suggested as a practical planning base because it keeps the first itinerary pass central, flexible, and easier to verify for ${profile.canonicalName}.`,
      tradeoffs: "This is a starter base recommendation. Confirm real lodging neighborhoods, transit access, parking, safety, and travel times before booking.",
      splitStaySuggestion: input.numberOfDays >= 7 && input.lodging.changeHotels !== "Stay in one place" ? "A split stay may help if your verified must-do sights are far apart, but confirm distances first." : "One base is preferred until exact local distances are confirmed."
    };
  }
  const wantsQuiet = (input.alcohol.preferences || []).some((item) => /quiet|walk|sunset/i.test(item));
  const wantsNightlife = (input.alcohol.preferences || []).some((item) => /nightlife|live music|bars/i.test(item)) && input.alcohol.primary !== "No Alcohol";
  const lowWalking = /minimal|easy/i.test(input.walkingLimit || "");
  let primary = "Beverly Grove / Museum Row";
  if (regions.some((region) => /Santa Monica|Malibu|Venice/.test(region)) && wantsQuiet) primary = "Santa Monica";
  if (wantsNightlife) primary = "West Hollywood or Beverly Grove";
  if (regions.filter((region) => /Downtown|Little Tokyo|Arts/.test(region)).length >= 2) primary = "Downtown Los Angeles";
  if (regions.some((region) => /Pasadena/.test(region)) && input.numberOfDays <= 3) primary = "Pasadena";
  return {
    primary,
    alternatives: ["Santa Monica", "West Hollywood", "Beverly Grove / Museum Row"].filter((item) => item !== primary).slice(0, 2),
    reason: `${primary} is suggested as a planning base because it balances the selected regions, ${input.pace.toLowerCase()} pace, and evening preferences without claiming hotel availability.`,
    tradeoffs: lowWalking ? "Choose lodging with parking, elevator access, and short pickup/drop-off paths." : "Los Angeles is spread out; even a central base still requires daily drive-time buffers.",
    splitStaySuggestion: input.numberOfDays >= 7 && input.lodging.changeHotels !== "Stay in one place" ? "A westside plus Pasadena/Downtown split stay could reduce some late-trip driving, but it is optional." : "One base is preferred for this trip."
  };
}

function summarizeDestinationIntelligence(intelligence) {
  const candidate = (item) => ({
    name: item.place.name,
    categories: item.categories,
    score: item.score,
    accepted: item.accepted,
    reason: item.reason,
    routeTime: item.routeFeasibility
  });
  return {
    destinationIdentity: intelligence.destinationIdentity,
    categoryCoverage: intelligence.categoryCoverage,
    experienceGaps: intelligence.experienceGaps,
    routeOptions: intelligence.routeOptions,
    researchConfidence: intelligence.researchConfidence,
    sourceFreshness: intelligence.sourceFreshness,
    consideredCandidates: (intelligence.allCandidates || []).slice(0, 40).map(candidate),
    rejectedCandidates: (intelligence.allCandidates || []).filter((item) => !item.accepted).slice(0, 12).map(candidate)
  };
}

export function buildTravelerConstraintProfile(input) {
  const restrictionText = input.travelersDetail.flatMap((traveler) => traveler.restrictions || []).join(" ").toLowerCase();
  const foodText = [...(input.food.diet || []), ...(input.food.restrictions || []), restrictionText].join(" ").toLowerCase();
  const noAlcohol = input.alcohol.primary === "No Alcohol" || (input.alcohol.preferences || []).some((item) => /no alcohol|hide alcohol/i.test(item));
  const minimalWalking = /minimal|wheelchair|stroller|mobility/.test(`${input.walkingLimit} ${restrictionText}`.toLowerCase());
  return {
    noAlcohol,
    minimalWalking,
    wheelchairRequired: /wheelchair/.test(restrictionText),
    mobilityNeeds: /mobility|minimal walking|wheelchair|stroller/.test(restrictionText),
    seriousDietary: /allergy|gluten|lactose|mandatory|halal|kosher|jain|avoid beef|avoid pork|avoid seafood/.test(foodText),
    dietarySummary: buildDietarySummary(input, foodText),
    accessibilitySummary: minimalWalking || /mobility|wheelchair|stroller/.test(restrictionText)
      ? "RouteMosaic reduced walking intensity, preferred accessible or easier stops, and added rest/free-time buffers where practical."
      : "No individual accessibility restriction was specified; venue conditions should still be confirmed before travel.",
    latestReturnMinutes: parseTime(input.latestReturn) ?? 21 * 60 + 30,
    breakfastMinutes: parseTime(input.food.breakfastTime) ?? parseTime(mealDefaults.breakfast),
    lunchMinutes: parseTime(input.food.lunchTime) ?? parseTime(mealDefaults.lunch),
    dinnerMinutes: parseTime(input.food.dinnerTime) ?? parseTime(mealDefaults.dinner)
  };
}

export function scoreCandidates(profile, input, constraints, intelligence = buildDestinationIntelligence(profile, input, constraints)) {
  const selectedLabels = [
    ...input.preferences.map((pref) => pref.label),
    ...(input.food.cuisine || []),
    ...(input.alcohol.preferences || [])
  ].map(normalizeText);
  const avoid = new Set(input.avoidPlaces.map(normalizeText));
  const must = input.mustHavePlaces.map(normalizeText);
  const intelligenceById = new Map((intelligence.allCandidates || []).map((item) => [item.place.id, item]));
  return profile.places.map((place) => {
    const intelligenceItem = intelligenceById.get(place.id);
    const reasons = [];
    let score = intelligenceItem ? intelligenceItem.score * 2 : place.priorityScore * planningWeights.priority;
    const placeText = normalizeText(`${place.name} ${place.categories.join(" ")} ${place.tags.join(" ")}`);
    if (intelligenceItem?.reason) reasons.push(intelligenceItem.reason);
    if (selectedLabels.some((label) => label && placeText.includes(label))) {
      score += planningWeights.preferenceMatch;
      reasons.push("Matches selected trip interests.");
    }
    if (must.some((label) => label && placeText.includes(label))) {
      score += planningWeights.mustDo;
      reasons.push("Matches a must-do note.");
    }
    if ([...avoid].some((label) => label && placeText.includes(label))) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected by avoid list.");
    }
    if (constraints.minimalWalking && place.accessibility === "limited") {
      score += planningWeights.accessibilityLimitedPenalty;
      reasons.push("Reduced because walking/accessibility may be difficult.");
    } else if (place.accessibility === "good") {
      score += planningWeights.accessibilityGood;
      reasons.push("Good accessibility profile for planning.");
    }
    if (budgetBand(input) === "budget" && place.estimatedCostHigh <= 35) score += planningWeights.budgetFit;
    if (place.weatherDependency === "low") score += planningWeights.weatherBalance;
    if (intelligenceItem?.routeFeasibility?.classification === "overnight-recommended") {
      score -= input.numberOfDays >= 5 ? 18 : 65;
      reasons.push("Better as an optional regional extension than a casual in-city stop.");
    }
    if (intelligenceItem?.routeFeasibility?.classification === "not-practical") score += planningWeights.hardExclusion;
    return { place, score, reasons, intelligence: intelligenceItem };
  }).sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
}

export function buildDays(profile, input, constraints, scored, intelligence = null) {
  const scheduled = new Set();
  const themes = destinationDayThemes(profile, input, intelligence);
  return Array.from({ length: input.numberOfDays }, (_, index) => {
    const date = addDays(input.startDate, index);
    const themeRegions = themes[index % themes.length];
    const themeCandidates = scored.filter((item) => themeRegions.includes(item.place.regionId) && !scheduled.has(item.place.id) && item.score > -200);
    const fillCandidates = scored.filter((item) => !themeRegions.includes(item.place.regionId) && !scheduled.has(item.place.id) && item.score > -200);
    const candidates = [...themeCandidates, ...fillCandidates.slice(0, Math.max(0, input.maxActivities - themeCandidates.length))];
    const fullDay = candidates.find((item) => item.place.bestTimeOfDay === "full-day");
    const activityCount = fullDay && input.maxActivities <= 2 ? 1 : Math.min(input.maxActivities, fullDay ? 1 : candidates.length);
    const selected = (fullDay && index > 0 && input.maxActivities >= 3 ? [fullDay] : candidates).slice(0, activityCount);
    selected.forEach((item) => scheduled.add(item.place.id));
    const region = profile.regions.find((item) => item.id === themeRegions[0]) || profile.regions[0];
    const scheduleItems = scheduleDay(profile, input, constraints, selected.map((item) => item.place), index);
    const backups = buildBackups(profile, constraints, themeRegions, selected.map((item) => item.place), scheduled);
    const warnings = [];
    const dailyDriveMinutes = scheduleItems.filter((item) => item.type === "travel").reduce((sum, item) => sum + item.durationMinutes, 0);
    if (dailyDriveMinutes > input.maxDrivingMinutes) warnings.push(`Estimated driving exceeds your ${Math.round(input.maxDrivingMinutes / 60)} hour daily preference.`);
    const dailyBudget = estimateDayBudget(input, scheduleItems);
    return {
      id: uid("day"),
      dayNumber: index + 1,
      date,
      title: `${region.name} day`,
      theme: dayThemeLabel(themeRegions),
      region: region.name,
      summary: `A ${input.pace.toLowerCase()} day grouped around ${themeRegions.map((id) => regionName(profile, id)).join(" and ")} to reduce unnecessary cross-city travel.`,
      weatherPlanningNote: weatherNote(scheduleItems, date),
      scheduleItems,
      backupOptions: backups,
      dailyBudget,
      dailyDriveMinutes,
      warnings,
      locked: false,
      generationReasoningSummary: `Grouped ${themeRegions.map((id) => regionName(profile, id)).join(" + ")} stops for route efficiency and selected activities that fit ${input.pace.toLowerCase()} pace, stated interests, and traveler constraints.`
    };
  });
}

function destinationDayThemes(profile, input, intelligence = null) {
  if (profile.id === "charlotte") {
    const themes = charlotteIntelligentThemes(input, intelligence);
    return rotate(themes, input.variationSeed).slice(0, input.numberOfDays);
  }
  if (profile.id === "dallas") {
    return rotate([
      ["downtown-dealey", "arts-district", "uptown"],
      ["white-rock", "smu-park-cities"],
      ["bishop-arts", "deep-ellum"],
      ["fort-worth-stockyards"],
      ["fair-park", "deep-ellum"],
      ["arlington"],
      ["arts-district", "downtown-dealey"]
    ], input.variationSeed).slice(0, input.numberOfDays);
  }
  if (profile.id === "detroit") {
    return rotate([
      ["downtown", "santa-monica"],
      ["griffith-park", "los-feliz", "hollywood"],
      ["museum-row", "beverly-hills", "brentwood", "westwood"],
      ["arts-district", "little-tokyo", "south-bay"],
      ["venice", "santa-monica", "malibu"],
      ["weho", "downtown"],
      ["pasadena"]
    ], input.variationSeed).slice(0, input.numberOfDays);
  }
  const profileRegions = profile.regions.map((region) => region.id);
  const hasDefaultThemes = dayThemes.flat().some((regionId) => profileRegions.includes(regionId));
  if (profile.id === "los-angeles" || hasDefaultThemes) return rotate(dayThemes, input.variationSeed).slice(0, input.numberOfDays);
  return Array.from({ length: input.numberOfDays }, (_, index) => {
    const anchor = profile.regions[(index + input.variationSeed) % profile.regions.length] || profile.regions[0];
    return [anchor.id, ...(anchor.neighboringRegionIds || [])].filter((regionId) => profileRegions.includes(regionId)).slice(0, input.pace === "Packed" ? 3 : 2);
  });
}

function charlotteIntelligentThemes(input, intelligence) {
  const selected = normalizeText([
    input.hiking,
    input.walkingLimit,
    ...(input.preferences || []).map((pref) => pref.label),
    ...(input.food?.cuisine || []),
    ...(input.alcohol?.preferences || []),
    ...(input.mustHavePlaces || [])
  ].join(" "));
  const wantsNature = /nature|outdoor|hike|scenic|water|lake|waterfall|mountain/.test(selected);
  const wantsFood = /food|cuisine|dining|restaurant|nightlife|bar|brewery|live music/.test(selected);
  const regional = intelligence?.nearbyDayTrips?.find((item) => item.routeFeasibility.classification !== "overnight-recommended")?.place.regionId || "whitewater-center";
  const overnight = intelligence?.regionalOvernightExtensions?.[0]?.place.regionId || "asheville-blue-ridge";
  if (wantsNature) {
    return [
      ["uptown"],
      [regional],
      ["crowders-mountain", "lake-wylie"],
      ["south-end", "noda", "plaza-midwood"],
      ["lake-norman"],
      [overnight],
      ["camp-north-end", "uptown"]
    ];
  }
  if (wantsFood) {
    return [
      ["uptown"],
      ["south-end", "plaza-midwood"],
      ["noda", "camp-north-end"],
      ["ballantyne", "south-end"],
      [regional],
      ["lake-norman"],
      ["uptown", "south-end"]
    ];
  }
  return [
    ["uptown"],
    ["whitewater-center", "lake-wylie"],
    ["south-end", "noda"],
    ["camp-north-end", "plaza-midwood"],
    ["lake-norman"],
    ["crowders-mountain"],
    ["concord", "uptown"]
  ];
}

function scheduleDay(profile, input, constraints, places, dayIndex) {
  const items = [];
  const buffers = paceDefaults(input.pace).buffer;
  const mealDuration = input.pace === "Relaxed" ? 75 : 60;
  const travelContext = tripTravelContext(profile, input);
  const isArrivalDay = dayIndex === 0 && travelContext.needsArrivalLogistics;
  const isDepartureDay = dayIndex === input.numberOfDays - 1 && travelContext.needsDepartureLogistics;
  const breakfastStart = constraints.breakfastMinutes;
  const activityStart = Math.max(parseTime(input.earliestActivity) ?? 9 * 60, breakfastStart + 60, isArrivalDay ? 16 * 60 : 0);
  const firstRegion = places[0]?.regionId || "santa-monica";
  if (isArrivalDay) {
    addMeal(items, "breakfast", breakfastStart, 45, "Pre-departure breakfast", {
      primary: "Breakfast before leaving or on the first route stop",
      secondary: "Simple cafe or hotel breakfast before departure",
      text: "Keep breakfast simple before the arrival travel block. Choose a cafe, hotel breakfast, or route stop that fits the group; verify menus and timing directly.",
      cuisine: "Flexible",
      price: moneyRange(mealCost(input, "breakfast").low, mealCost(input, "breakfast").high),
      reservation: "No reservation needed for a simple travel-morning breakfast."
    }, firstRegion, input, constraints);
    items.push(arrivalTravelItem(profile, input, travelContext));
    addMeal(items, "lunch", Math.max(12 * 60, travelContext.arrivalMinutes - 45), mealDuration, mealTitle(profile, firstRegion, "lunch"), mealRecommendation(profile, input, firstRegion, "lunch"), firstRegion, input, constraints);
    items.push(simpleItem("lodging", Math.max(15 * 60, travelContext.arrivalMinutes + 45), 45, "Hotel check-in and reset", "Check in, park, unpack lightly, and leave a buffer before any first-evening plans."));
  } else {
    addMeal(items, "breakfast", breakfastStart, 45, mealTitle(profile, firstRegion, "breakfast"), mealRecommendation(profile, input, firstRegion, "breakfast"), firstRegion, input, constraints);
  }
  let cursor = activityStart;
  const dayPlaces = isDepartureDay ? places.filter((place) => isDepartureFriendly(place)).slice(0, 1) : places;
  dayPlaces.forEach((place, index) => {
    if (isTimeSensitiveClosed(place, cursor)) {
      items.push(simpleItem("note", cursor, 20, `Verify hours for ${place.name}`, `${place.name} is not scheduled as a late activity because opening hours are not verified for this time window.`));
      cursor += 30;
      return;
    }
    if (index > 0) {
      const previous = dayPlaces[index - 1];
      const travel = estimateTravel(profile, previous, place);
      items.push(travelItem(previous.name, place.name, cursor, travel));
      cursor += travel.durationMinutes + buffers;
    }
    if (index === 1 && cursor > constraints.lunchMinutes - 30) {
      addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, mealTitle(profile, place.regionId, "lunch"), mealRecommendation(profile, input, place.regionId, "lunch"), place.regionId, input, constraints);
      cursor = Math.max(cursor, constraints.lunchMinutes + mealDuration + buffers);
    }
    items.push(activityItem(place, cursor, constraints, index));
    cursor += place.typicalDurationMinutes + buffers;
  });
  if (!items.some((item) => item.type === "lunch")) {
    const lunchRegion = places[0]?.regionId || firstRegion;
    addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, mealTitle(profile, lunchRegion, "lunch"), mealRecommendation(profile, input, lunchRegion, "lunch"), lunchRegion, input, constraints);
  }
  const afterActivities = Math.max(cursor, constraints.dinnerMinutes - (input.pace === "Packed" ? 45 : 90));
  if (input.pace !== "Packed") {
    items.push(simpleItem("freeTime", afterActivities, input.pace === "Relaxed" ? 90 : 60, "Reset and free time", "A buffer window to rest, freshen up, or handle traffic without compressing dinner."));
  }
  const dinnerRegion = places.at(-1)?.regionId || firstRegion;
  addMeal(items, "dinner", constraints.dinnerMinutes, input.pace === "Relaxed" ? 90 : 75, mealTitle(profile, dinnerRegion, "dinner"), mealRecommendation(profile, input, dinnerRegion, "dinner"), dinnerRegion, input, constraints);
  const eveningStart = constraints.dinnerMinutes + (input.pace === "Relaxed" ? 105 : 90);
  const evening = eveningItem(profile, input, constraints, dinnerRegion, eveningStart, dayIndex);
  if (!isDepartureDay && (evening.endTimeMinutes <= constraints.latestReturnMinutes || input.pace === "Packed")) items.push(evening);
  else items.push(simpleItem("note", eveningStart, 20, "Early return", "Skipped a late evening activity to respect the preferred return time."));
  if (isDepartureDay) {
    items.push(simpleItem("lodging", 10 * 60, 30, "Hotel checkout", "Check out, load bags, and keep the final day lighter so the return trip is not rushed."));
    items.push(departureTravelItem(profile, input, travelContext));
  }
  return sortAndFormat(items);
}

function activityItem(place, start, constraints, index) {
  return {
    id: uid("item"),
    type: "activity",
    startTimeMinutes: start,
    endTimeMinutes: start + place.typicalDurationMinutes,
    durationMinutes: place.typicalDurationMinutes,
    title: place.name,
    description: place.shortDescription,
    placeId: place.id,
    regionId: place.regionId,
    neighborhood: "",
    areaLabel: "",
    locationLabel: place.name,
    category: place.categories[0] || "activity",
    tags: place.tags,
    estimatedCostPerPerson: { low: place.estimatedCostLow, high: place.estimatedCostHigh },
    travelFromPrevious: null,
    accessibilityNotes: accessibilityNote(place, constraints),
    dietaryNotes: "",
    weatherDependency: place.weatherDependency,
    indoorOutdoor: place.indoorOutdoor,
    reservationRecommended: place.reservationRecommended,
    sourceMetadata: place.sourceMetadata || {
      provider: "unknown",
      providerPlaceId: place.id,
      retrievedName: place.name,
      retrievedAt: "",
      sourceUrl: "",
      dataConfidence: "unknown",
      dataFreshness: "unknown"
    },
    mustDo: false,
    locked: false,
    source: "curated-local-data",
    replaceable: true,
    customItem: false
  };
}

function addMeal(items, type, start, duration, title, recommendation, regionId, input, constraints) {
  const meal = typeof recommendation === "string" ? { text: recommendation, primary: "", secondary: "", cuisine: "", price: "", reservation: "" } : recommendation;
  items.push({
    id: uid("item"),
    type,
    startTimeMinutes: start,
    endTimeMinutes: start + duration,
    durationMinutes: duration,
    title,
    description: meal.text,
    mealDetails: {
      primaryOption: meal.primary,
      secondaryOption: meal.secondary,
      cuisine: meal.cuisine,
      priceRange: meal.price,
      reservationGuidance: meal.reservation,
      hoursConfidence: "Unverified; confirm current hours before relying on this meal."
    },
    placeId: "",
    regionId,
    neighborhood: "",
    areaLabel: "",
    locationLabel: meal.primary || regionId,
    category: "meal",
    tags: ["meal", type],
    estimatedCostPerPerson: mealCost(input, type),
    travelFromPrevious: null,
    accessibilityNotes: "Choose a venue that fits the group's mobility needs; confirm step-free access when required.",
    dietaryNotes: constraints.dietarySummary,
    weatherDependency: "low",
    indoorOutdoor: "indoor",
    reservationRecommended: type === "dinner" && /reservation|must-do/i.test(input.food.reservations || ""),
    mustDo: false,
    locked: false,
    source: "local-meal-planner",
    replaceable: true,
    customItem: false
  });
}

function simpleItem(type, start, duration, title, description) {
  return {
    id: uid("item"),
    type,
    startTimeMinutes: start,
    endTimeMinutes: start + duration,
    durationMinutes: duration,
    title,
    description,
    placeId: "",
    neighborhood: "",
    locationLabel: "",
    category: type,
    tags: [type],
    estimatedCostPerPerson: { low: 0, high: 0 },
    travelFromPrevious: null,
    accessibilityNotes: "",
    dietaryNotes: "",
    weatherDependency: "low",
    indoorOutdoor: "mixed",
    reservationRecommended: false,
    mustDo: false,
    locked: false,
    source: "planner",
    replaceable: type !== "travel",
    customItem: false
  };
}

function tripTravelContext(profile, input) {
  const transportText = `${input.transportation || ""} ${input.transport?.mode || ""}`.toLowerCase();
  const origin = normalizeText(input.origin);
  const destination = normalizeText(input.destination || profile.canonicalName);
  const sameDestination = origin && destination && (origin === destination || destination.includes(origin) || origin.includes(destination));
  const driving = /drive|car|rent/.test(transportText) && !/fly/.test(transportText);
  const originCoordinates = input.fromLocation?.latitude && input.fromLocation?.longitude
    ? { lat: Number(input.fromLocation.latitude), lng: Number(input.fromLocation.longitude) }
    : knownLocationCoordinates(input.origin);
  const destinationCoordinates = profile.regions[0]?.centerCoordinates;
  const distance = originCoordinates && destinationCoordinates ? haversineMiles(originCoordinates.lat, originCoordinates.lng, destinationCoordinates.lat, destinationCoordinates.lng) : 0;
  const driveMinutes = distance ? Math.max(60, Math.round(distance / 0.72) + 35) : driving ? 180 : 150;
  return {
    needsArrivalLogistics: Boolean(driving && input.origin && !sameDestination),
    needsDepartureLogistics: Boolean(driving && input.origin && !sameDestination && input.numberOfDays > 1),
    transportMode: driving ? "drive" : "fly",
    departureMinutes: driving ? 8 * 60 : 9 * 60,
    arrivalMinutes: driving ? Math.min(15 * 60, 8 * 60 + driveMinutes) : 13 * 60 + 30,
    originDriveMinutes: driveMinutes,
    originDistanceMiles: Math.round(distance),
    estimateType: distance ? "coordinate-arrival-estimate" : "conservative-arrival-estimate"
  };
}

function knownLocationCoordinates(value) {
  const text = normalizeText(value);
  if (/augusta/.test(text) && /georgia|ga/.test(text)) return { lat: 33.4735, lng: -82.0105 };
  if (/charlotte/.test(text)) return { lat: 35.2271, lng: -80.8431 };
  if (/asheville/.test(text)) return { lat: 35.5951, lng: -82.5515 };
  return null;
}

function isDepartureFriendly(place) {
  const text = normalizeText(`${place.name} ${place.categories?.join(" ")} ${place.tags?.join(" ")}`);
  if (/full day|theme park|estate|waterfall|day trip|nearby excursion|hike|mountain|whitewater/.test(text)) return false;
  return Number(place.typicalDurationMinutes || 0) <= 120;
}

function isTimeSensitiveClosed(place, startMinutes) {
  const text = normalizeText(`${place.name} ${place.categories?.join(" ")} ${place.tags?.join(" ")}`);
  const needsDaytime = /museum|visitor center|estate|gallery|garden|arboretum|nature center|ticket|tour/.test(text);
  return needsDaytime && startMinutes >= 17 * 60;
}

function arrivalTravelItem(profile, input, context) {
  const duration = context.originDriveMinutes;
  const description = context.transportMode === "drive"
    ? `Drive from ${input.origin || "your origin"} to ${profile.canonicalName}; includes conservative fuel, restroom, meal, parking, and arrival buffer. Assumes an ${formatTime(context.departureMinutes)} departure because no exact departure time was entered.`
    : `Arrival logistics for ${profile.canonicalName}; includes airport or station buffer, luggage, rental car or transfer pickup, and hotel approach time.`;
  return {
    ...simpleItem("travel", context.departureMinutes, duration, `Travel to ${profile.canonicalName}`, description),
    travelFromPrevious: {
      mode: context.transportMode === "drive" ? "Drive" : "Arrival transfer",
      durationMinutes: duration,
      distanceMiles: context.originDistanceMiles,
      fromLabel: input.origin || "Origin",
      toLabel: profile.canonicalName,
      estimateType: context.estimateType,
      note: "Conservative arrival-day estimate; verify live traffic or flight times."
    },
    replaceable: false
  };
}

function departureTravelItem(profile, input, context) {
  const duration = Math.max(60, context.originDriveMinutes);
  const start = Math.max(12 * 60 + 30, 18 * 60 - duration);
  const description = context.transportMode === "drive"
    ? `Return drive toward ${input.origin || "your origin"} with a conservative buffer. Keep final sightseeing short unless you intentionally extend the trip.`
    : "Departure buffer for checkout, luggage, airport/station transfer, security or boarding time, and contingency.";
  return {
    ...simpleItem("travel", start, duration, `Depart ${profile.canonicalName}`, description),
    travelFromPrevious: {
      mode: context.transportMode === "drive" ? "Drive" : "Departure transfer",
      durationMinutes: duration,
      distanceMiles: context.originDistanceMiles,
      fromLabel: profile.canonicalName,
      toLabel: input.origin || "Origin",
      estimateType: context.estimateType,
      note: "Conservative departure-day estimate; verify live traffic or flight times."
    },
    replaceable: false
  };
}

function travelItem(fromLabel, toLabel, start, travel) {
  return {
    ...simpleItem("travel", start, travel.durationMinutes, `Estimated drive to ${toLabel}`, `Estimated drive: ${travel.durationMinutes}-${travel.durationMinutes + 15} minutes depending on traffic.`),
    travelFromPrevious: travel,
    locationLabel: `${fromLabel} to ${toLabel}`,
    replaceable: false
  };
}

function eveningItem(profile, input, constraints, regionId, start, dayIndex) {
  const quiet = (input.alcohol.preferences || []).some((item) => /quiet|walk|sunset|dessert/i.test(item)) || constraints.noAlcohol;
  const nightlife = (input.alcohol.preferences || []).some((item) => /nightlife|bar|brewery|live music/i.test(item)) && !constraints.noAlcohol;
  const title = quiet ? "Quiet evening option" : nightlife && dayIndex % 2 === 1 ? "Optional live-music evening" : "Low-key neighborhood evening";
  const description = constraints.noAlcohol
    ? "Alcohol-focused venues are suppressed; use a dessert cafe, beach walk, or scenic neighborhood stroll."
    : nightlife && dayIndex % 2 === 1
      ? "Choose a live-music or drinks-optional venue; confirm schedule and reservations directly."
      : "Keep the evening flexible with a sunset viewpoint, cafe, or relaxed walk.";
  return {
    ...simpleItem("evening", start, quiet ? 75 : 105, title, description),
    regionId,
    neighborhood: "",
    areaLabel: "",
    locationLabel: regionName(profile, regionId),
    estimatedCostPerPerson: { low: 10, high: nightlife ? 45 : 25 },
    dietaryNotes: constraints.noAlcohol ? "No-alcohol preference applied." : "",
    reservationRecommended: nightlife
  };
}

function buildBackups(profile, constraints, regionIds, primaryPlaces, scheduled) {
  const primaryIds = new Set(primaryPlaces.map((place) => place.id));
  const build = (sameRegionOnly) => profile.places
    .filter((place) => (!sameRegionOnly || regionIds.includes(place.regionId)) && !primaryIds.has(place.id) && !scheduled.has(place.id))
    .filter((place) => !constraints.minimalWalking || place.accessibility !== "limited")
    .sort((a, b) => (b.indoorOutdoor === "indoor") - (a.indoorOutdoor === "indoor") || b.priorityScore - a.priorityScore)
    .map((place) => ({
      id: uid("backup"),
      title: place.name,
      description: place.shortDescription,
      placeId: place.id,
      reason: place.indoorOutdoor === "indoor" ? "Indoor alternative for rain, heat, or low-energy moments." : constraints.minimalWalking ? "Lower-walking alternative near the same route." : "Nearby replacement if the primary activity is unavailable.",
      indoorOutdoor: place.indoorOutdoor,
      estimatedDurationMinutes: place.typicalDurationMinutes,
      estimatedCostPerPerson: { low: place.estimatedCostLow, high: place.estimatedCostHigh },
      accessibilityNotes: accessibilityNote(place, constraints)
    }));
  const local = build(true);
  return (local.length ? local : build(false)).slice(0, 2);
}

export function replaceActivity(plan, itemId, placeId) {
  return mutatePlan(plan, (draft, profile) => {
    const place = profile.places.find((candidate) => candidate.id === placeId);
    if (!place) return;
    for (const day of draft.days) {
      const index = day.scheduleItems.findIndex((item) => item.id === itemId && item.type === "activity" && !item.locked);
      if (index >= 0) {
        day.scheduleItems[index] = { ...activityItem(place, day.scheduleItems[index].startTimeMinutes, buildTravelerConstraintProfile(draft.preferencesSnapshot), index), id: itemId };
        recalculateDay(day, draft.preferencesSnapshot, profile);
      }
    }
  });
}

export function moveActivity(plan, itemId, direction) {
  return mutatePlan(plan, (draft, profile) => {
    const allDays = draft.days;
    for (let dayIndex = 0; dayIndex < allDays.length; dayIndex += 1) {
      const day = allDays[dayIndex];
      const index = day.scheduleItems.findIndex((item) => item.id === itemId && !item.locked);
      if (index < 0) continue;
      if (direction === "earlier" && index > 0) [day.scheduleItems[index - 1], day.scheduleItems[index]] = [day.scheduleItems[index], day.scheduleItems[index - 1]];
      if (direction === "later" && index < day.scheduleItems.length - 1) [day.scheduleItems[index + 1], day.scheduleItems[index]] = [day.scheduleItems[index], day.scheduleItems[index + 1]];
      if (direction === "nextDay" && allDays[dayIndex + 1]) allDays[dayIndex + 1].scheduleItems.splice(1, 0, day.scheduleItems.splice(index, 1)[0]);
      if (direction === "prevDay" && allDays[dayIndex - 1]) allDays[dayIndex - 1].scheduleItems.splice(1, 0, day.scheduleItems.splice(index, 1)[0]);
      recalculateDay(day, draft.preferencesSnapshot, profile);
      if (allDays[dayIndex + 1]) recalculateDay(allDays[dayIndex + 1], draft.preferencesSnapshot, profile);
      if (allDays[dayIndex - 1]) recalculateDay(allDays[dayIndex - 1], draft.preferencesSnapshot, profile);
      return;
    }
  });
}

export function addCustomStop(plan, custom) {
  return mutatePlan(plan, (draft, profile) => {
    const day = draft.days[Math.max(0, Math.min(draft.days.length - 1, Number(custom.dayNumber || 1) - 1))];
    const start = parseTime(custom.startTime) ?? 15 * 60;
    day.scheduleItems.push({
      ...simpleItem(custom.type || "activity", start, Number(custom.durationMinutes || 60), custom.title || "Custom stop", custom.notes || "User-added custom stop."),
      id: uid("custom"),
      locationLabel: custom.locationLabel || "Custom location",
      estimatedCostPerPerson: { low: Number(custom.cost || 0), high: Number(custom.cost || 0) },
      indoorOutdoor: custom.indoorOutdoor || "mixed",
      mustDo: Boolean(custom.mustDo),
      locked: Boolean(custom.locked),
      customItem: true,
      source: "user"
    });
    recalculateDay(day, draft.preferencesSnapshot, profile);
  });
}

export function removeScheduleItem(plan, itemId) {
  return mutatePlan(plan, (draft, profile) => {
    for (const day of draft.days) {
      const before = day.scheduleItems.length;
      day.scheduleItems = day.scheduleItems.filter((item) => item.id !== itemId || item.locked || item.mustDo);
      if (day.scheduleItems.length !== before) {
        day.scheduleItems.push(simpleItem("freeTime", 15 * 60, 60, "Open time", "Freed by removing an itinerary item."));
        recalculateDay(day, draft.preferencesSnapshot, profile);
      }
    }
  });
}

export function toggleItemLock(plan, itemId) {
  return mutatePlan(plan, (draft) => {
    draft.days.forEach((day) => day.scheduleItems.forEach((item) => {
      if (item.id === itemId) item.locked = !item.locked;
    }));
  });
}

export function toggleItemMustDo(plan, itemId) {
  return mutatePlan(plan, (draft) => {
    draft.days.forEach((day) => day.scheduleItems.forEach((item) => {
      if (item.id === itemId && item.type === "activity") item.mustDo = !item.mustDo;
    }));
  });
}

export function toggleDayLock(plan, dayId) {
  return mutatePlan(plan, (draft) => {
    const day = draft.days.find((item) => item.id === dayId);
    if (day) day.locked = !day.locked;
  });
}

export function regenerateDay(plan, dayId) {
  return mutatePlan(plan, (draft, profile) => {
    const index = draft.days.findIndex((day) => day.id === dayId);
    if (index < 0 || draft.days[index].locked) return;
    const locked = draft.days[index].scheduleItems.filter((item) => item.locked || item.mustDo || item.customItem);
    const input = { ...draft.preferencesSnapshot, variationSeed: (draft.generationMetadata.variationSeed || 0) + index + 1 };
    const constraints = buildTravelerConstraintProfile(input);
    const scored = scoreCandidates(profile, input, constraints);
    const replacement = buildDays(profile, { ...input, numberOfDays: 1, startDate: draft.days[index].date }, constraints, scored)[0];
    replacement.id = draft.days[index].id;
    replacement.dayNumber = draft.days[index].dayNumber;
    replacement.date = draft.days[index].date;
    replacement.scheduleItems = [...locked, ...replacement.scheduleItems.filter((item) => !locked.some((lockedItem) => lockedItem.placeId && lockedItem.placeId === item.placeId))];
    recalculateDay(replacement, input, profile);
    draft.days[index] = replacement;
  });
}

export function regenerateMeals(plan) {
  return mutatePlan(plan, (draft, profile) => {
    const input = draft.preferencesSnapshot;
    const constraints = buildTravelerConstraintProfile(input);
    draft.days.forEach((day) => {
      day.scheduleItems = day.scheduleItems.map((item) => {
        if (!["breakfast", "lunch", "dinner"].includes(item.type) || item.locked) return item;
        const meal = mealRecommendation(profile, input, item.regionId || item.neighborhood || "santa-monica", item.type);
        return { ...item, description: meal.text, mealDetails: { ...(item.mealDetails || {}), primaryOption: meal.primary, secondaryOption: meal.secondary, cuisine: meal.cuisine, priceRange: meal.price, reservationGuidance: meal.reservation }, dietaryNotes: constraints.dietarySummary };
      });
    });
    refreshPlanTotals(draft, profile);
  });
}

export function regeneratePlanPreservingLocks(plan) {
  const input = { ...plan.preferencesSnapshot, variationSeed: (plan.generationMetadata.variationSeed || 0) + 7 };
  const tripLike = denormalizedTrip(input);
  const next = generateTripPlan(tripLike, { variationSeed: input.variationSeed });
  if (next.status !== "ready") return plan;
  const draft = next.plan;
  plan.days.forEach((day, index) => {
    if (day.locked) draft.days[index] = day;
    else {
      const locked = day.scheduleItems.filter((item) => item.locked || item.mustDo || item.customItem);
      if (locked.length && draft.days[index]) draft.days[index].scheduleItems = [...locked, ...draft.days[index].scheduleItems];
    }
  });
  refreshPlanTotals(draft, resolvePlanProfile(draft));
  return draft;
}

function mutatePlan(plan, fn) {
  const draft = structuredClone(plan);
  const profile = resolvePlanProfile(draft);
  fn(draft, profile);
  refreshPlanTotals(draft, profile);
  return draft;
}

function recalculateDay(day, input, profile) {
  let cursor = Math.min(...day.scheduleItems.map((item) => item.startTimeMinutes).filter(Number.isFinite), 8 * 60);
  day.scheduleItems = day.scheduleItems.filter((item) => item.type !== "travel").sort((a, b) => a.startTimeMinutes - b.startTimeMinutes);
  day.scheduleItems.forEach((item, index) => {
    item.startTimeMinutes = index === 0 ? item.startTimeMinutes : Math.max(cursor, item.startTimeMinutes);
    item.endTimeMinutes = item.startTimeMinutes + item.durationMinutes;
    cursor = item.endTimeMinutes + paceDefaults(input.pace).buffer;
  });
  day.scheduleItems = sortAndFormat(day.scheduleItems);
  day.dailyDriveMinutes = day.scheduleItems.filter((item) => item.type === "travel").reduce((sum, item) => sum + item.durationMinutes, 0);
  day.dailyBudget = estimateDayBudget(input, day.scheduleItems);
  day.warnings = validateDay(day).map((warning) => warning.message);
}

function refreshPlanTotals(plan, profile) {
  const constraints = buildTravelerConstraintProfile(plan.preferencesSnapshot);
  const hotelBase = buildHotelBase(profile, plan.preferencesSnapshot, plan.days);
  plan.hotelBase = hotelBase;
  plan.days = buildDetailedTripDays(profile, plan.preferencesSnapshot, constraints, plan.days, hotelBase);
  plan.routeSummary = buildRouteSummary(profile, plan.days);
  plan.budgetSummary = buildBudgetSummary(plan.preferencesSnapshot, plan.days);
  plan.foodPlan = buildFoodPlan(profile, plan.preferencesSnapshot, constraints, plan.days);
  plan.advisories = buildAdvisories(profile, plan.preferencesSnapshot, constraints, plan.days, plan.budgetSummary);
  const intelligence = buildDestinationIntelligence(profile, plan.preferencesSnapshot, constraints);
  const tripShapeOptions = plan.generationMetadata?.tripShapeOptions || buildTripShapeOptions(profile, plan.preferencesSnapshot, intelligence);
  plan.tripGuide = buildDetailedTripGuide(profile, plan.preferencesSnapshot, constraints, plan.days, hotelBase, plan.routeSummary, plan.budgetSummary, tripShapeOptions);
  plan.overview = buildOverview(profile, plan.preferencesSnapshot, plan.days, plan.budgetSummary, plan.routeSummary);
}

function resolvePlanProfile(plan) {
  return getDestinationProfile(plan.generationMetadata.destinationProfileId)
    || plan.generationMetadata.destinationProfileSnapshot
    || createGenericDestinationProfile(plan.destination)
    || createGenericDestinationProfile(plan.preferencesSnapshot?.destination);
}

function buildFoodPlan(profile, input, constraints, days) {
  const mealRecommendations = days.map((day) => ({
    dayId: day.id,
    dayNumber: day.dayNumber,
    meals: day.scheduleItems.filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type)).map((item) => ({
      type: item.type,
      time: item.startTime,
      recommendation: item.description,
      dietaryNotes: item.dietaryNotes,
      estimatedCostPerPerson: item.estimatedCostPerPerson
    }))
  }));
  return {
    dailyMealSummary: "Meals are placed around activity regions and preferred meal times using style recommendations rather than live restaurant availability.",
    dietaryHandlingSummary: constraints.dietarySummary,
    cuisineCoverage: (input.food.cuisine || []).length ? input.food.cuisine.join(", ") : "Varied local options",
    reservationNotes: /reservation|must-do/i.test(input.food.reservations || "") ? `Plan reservations for must-do dinners in ${profile.canonicalName}, especially around the verified evening or central dining area.` : "Reservations are optional; verify hours and availability directly.",
    foodBudgetEstimate: input.food.foodBudgetPerPerson || "$15-$30 per person/day",
    mealRecommendations,
    foodAreas: profile.foodAreas.map((area) => ({ name: area.name, regionId: area.regionId, cuisines: area.cuisines, dietarySupport: area.dietarySupport })).slice(0, 6)
  };
}

function buildRouteSummary(profile, days) {
  const orderedRegions = [...new Set(days.map((day) => day.region))];
  const orderedStops = days.flatMap((day) => day.scheduleItems.filter((item) => item.type === "activity").map((item) => item.title));
  const totalEstimatedDriveMinutes = days.reduce((sum, day) => sum + day.dailyDriveMinutes, 0);
  const totalEstimatedDistanceMiles = Math.round(totalEstimatedDriveMinutes * 0.65);
  return {
    orderedRegions,
    orderedStops,
    totalEstimatedDriveMinutes,
    totalEstimatedDistanceMiles,
    routeLogicExplanation: `The planner groups each day by compatible ${profile.canonicalName} areas to reduce repeated cross-city travel.`,
    mapPlaceholderData: days.map((day) => ({ dayNumber: day.dayNumber, region: day.region, stops: day.scheduleItems.filter((item) => item.type === "activity").map((item) => item.title) })),
    trafficDisclaimer: "Drive times are planning estimates only; they are not live traffic predictions."
  };
}

function buildBudgetSummary(input, days) {
  const travelers = input.travelers || 1;
  const activityLow = sumCost(days, "low") * travelers;
  const activityHigh = sumCost(days, "high") * travelers;
  const foodDaily = foodDailyBudget(input);
  const foodLow = foodDaily.low * input.numberOfDays * travelers;
  const foodHigh = foodDaily.high * input.numberOfDays * travelers;
  const driveLow = Math.max(80, days.reduce((sum, day) => sum + day.dailyDriveMinutes, 0) * 0.5);
  const driveHigh = driveLow + 120;
  const parkingLow = input.numberOfDays * 20;
  const parkingHigh = input.numberOfDays * 45;
  const contingencyLow = 100;
  const contingencyHigh = 220;
  const categories = [
    { category: "Activities and admissions", low: roundMoney(activityLow), high: roundMoney(activityHigh), description: "Curated attraction cost estimates." },
    { category: "Food", low: roundMoney(foodLow), high: roundMoney(foodHigh), description: "Based on per-person food budget and three planned meals per day." },
    { category: "Local transportation or driving", low: roundMoney(driveLow), high: roundMoney(driveHigh), description: "Rental-car local driving and fuel-style planning estimate." },
    { category: "Parking", low: roundMoney(parkingLow), high: roundMoney(parkingHigh), description: "Parking varies by neighborhood, attraction, and lodging choice." },
    { category: "Optional evening activities", low: roundMoney(input.numberOfDays * 20), high: roundMoney(input.numberOfDays * 70), description: "Dessert, live music, or low-key evening options." },
    { category: "Contingency", low: contingencyLow, high: contingencyHigh, description: "Buffer for timing changes, snacks, and small route changes." }
  ];
  const totalLow = categories.reduce((sum, item) => sum + item.low, 0);
  const totalHigh = categories.reduce((sum, item) => sum + item.high, 0);
  return {
    currency: "USD",
    totalLow,
    totalHigh,
    perPersonLow: Math.round(totalLow / travelers),
    perPersonHigh: Math.round(totalHigh / travelers),
    categories,
    assumptions: ["Estimates exclude airfare.", "Lodging is shown only as a preference because confirmed lodging costs are not collected.", "No live prices or availability were checked."],
    excludedCosts: ["Airfare", "Confirmed hotel costs", "Real-time tickets", "Rideshare surge pricing"]
  };
}

function buildAdvisories(profile, input, constraints, days, budget) {
  const advisories = profile.generalAdvisories.map((message, index) => advisory(`general-${index}`, "info", "planning", index ? "Verify details directly" : "Planning estimates only", message, "Confirm details closer to travel."));
  if (constraints.seriousDietary) advisories.push(advisory("dietary-confirmation", "caution", "dietary", "Confirm dietary restrictions", "Mandatory dietary restrictions and allergies are applied, but restaurants should confirm ingredients and preparation directly.", "Call or message restaurants before dining."));
  if (constraints.mobilityNeeds) advisories.push(advisory("accessibility-confirmation", "caution", "accessibility", "Confirm accessibility conditions", "The plan favors easier and more accessible stops, but venue conditions can change.", "Confirm elevators, paths, parking, and drop-off details directly."));
  if (constraints.noAlcohol) advisories.push(advisory("no-alcohol", "info", "evening", "Alcohol-focused venues suppressed", "Evening recommendations avoid bar- or alcohol-led planning.", "Use cafe, walk, dessert, or live-music options that do not require drinking."));
  days.forEach((day) => {
    if (day.dailyDriveMinutes > input.maxDrivingMinutes) advisories.push(advisory(`drive-${day.id}`, "caution", "route", `Day ${day.dayNumber} may exceed driving comfort`, `Estimated driving is ${formatDuration(day.dailyDriveMinutes)}.`, "Remove or replace one distant stop."));
    if (!day.backupOptions.length && day.scheduleItems.some((item) => item.weatherDependency === "high")) advisories.push(advisory(`backup-${day.id}`, "caution", "weather", `Day ${day.dayNumber} needs a backup`, "This outdoor-heavy day has limited same-region indoor backups.", "Keep the day flexible if weather is poor."));
  });
  if (input.unknownPreferences.length) advisories.push(advisory("unknown-preferences", "info", "preferences", "Some preferences were retained but not fully interpreted", input.unknownPreferences.join(", "), "Review generated days and replace items as needed."));
  if (budget.totalHigh < budget.totalLow) advisories.push(advisory("budget", "blocking", "budget", "Budget estimate failed validation", "Budget high estimate is lower than low estimate.", "Regenerate or review budget settings."));
  return advisories;
}

function buildOverview(profile, input, days, budget, route) {
  const activities = days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity");
  return {
    title: `Your ${profile.canonicalName} trip is ready`,
    subtitle: `${input.numberOfDays} day${input.numberOfDays === 1 ? "" : "s"} from ${input.origin || "your origin"} to ${profile.canonicalName}.`,
    destinationSummary: profile.summary,
    travelerSummary: `${input.travelers} traveler${input.travelers === 1 ? "" : "s"} · ${input.groupType}`,
    dateSummary: `${formatDisplayDate(input.startDate)} – ${formatDisplayDate(input.endDate)} (${input.numberOfDays} days / ${calculateTripNights(input.numberOfDays)} nights)`,
    paceSummary: `${input.pace} pace · up to ${input.maxActivities} major activities per day`,
    planningHighlights: [
      "Regional days reduce unnecessary cross-city driving.",
      "Meal recommendations apply group food preferences and traveler restrictions.",
      "Outdoor-heavy days include backup options where alternatives are available.",
      "Drive times, costs, and hours are estimates, not live data."
    ],
    estimatedTotalCost: moneyRange(budget.totalLow, budget.totalHigh),
    estimatedCostPerPerson: moneyRange(budget.perPersonLow, budget.perPersonHigh),
    totalScheduledActivities: activities.length,
    totalEstimatedDriveMinutes: route.totalEstimatedDriveMinutes,
    totalEstimatedActivityMinutes: activities.reduce((sum, item) => sum + item.durationMinutes, 0),
    majorRegionsCovered: route.orderedRegions
  };
}

function buildTripShapeOptions(profile, input, intelligence) {
  const coreRegions = profile.regions.slice(0, Math.min(3, profile.regions.length)).map((region) => region.name);
  const dayTrips = (intelligence?.nearbyDayTrips || []).slice(0, 3);
  const overnight = (intelligence?.regionalOvernightExtensions || [])[0];
  const base = profile.regions.find((region) => region.id === profile.planningRules.defaultHotelRegion) || profile.regions[0];
  const maxSightseeingDays = Math.max(1, input.numberOfDays - (input.transportation && !sameAreaTrip(input, profile) ? 2 : 0));
  const options = [
    {
      id: "shape-single-base",
      structureType: dayTrips.length ? "One base plus local day trips" : "Single-city depth",
      routeSequence: [profile.canonicalName, ...dayTrips.map((item) => item.place.name)],
      overnightBases: [{ base: base?.name || profile.canonicalName, nights: Math.max(0, calculateTripNights(input.numberOfDays)) }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${Math.round((dayTrips.reduce((sum, item) => sum + item.routeFeasibility.estimatedDriveMinutesRoundTrip, 0) + input.numberOfDays * 25) / 60)}-${Math.round((dayTrips.reduce((sum, item) => sum + item.routeFeasibility.estimatedDriveMinutesRoundTrip, 0) + input.numberOfDays * 45) / 60)} hours`,
      longestDrivingDay: dayTrips[0] ? `${dayTrips[0].place.name} day, about ${formatDuration(dayTrips[0].routeFeasibility.estimatedDriveMinutesRoundTrip)}` : "Local days only",
      fullSightseeingDays: maxSightseeingDays,
      arrivalAssumptions: "Keep first day lighter until arrival, car pickup, luggage, and check-in are complete.",
      departureAssumptions: "Protect departure buffers and avoid deep visits after checkout.",
      experienceMix: experienceMixSummary(profile, dayTrips),
      advantages: ["Least lodging friction", "Easy to understand", "Keeps optional regional ideas controllable"],
      tradeoffs: dayTrips.length ? ["Some longer out-and-back days", "Distant extensions may be better as a split stay"] : ["Less regional variety"],
      costImpact: "Lowest lodging-change cost; day-trip fuel or transit may increase.",
      whyItFitsUser: `${input.pace} pace with ${input.travelers} traveler${input.travelers === 1 ? "" : "s"} favors a reliable base before adding optional distance.`,
      confidence: dayTrips.length || profile.places.length >= input.numberOfDays * 2 ? "high" : "medium"
    }
  ];
  if (overnight && input.numberOfDays >= 4) {
    options.push({
      id: "shape-regional-extension",
      structureType: "One base plus one overnight extension",
      routeSequence: [profile.canonicalName, overnight.place.name, profile.canonicalName],
      overnightBases: [
        { base: base?.name || profile.canonicalName, nights: Math.max(1, calculateTripNights(input.numberOfDays) - 1) },
        { base: overnight.place.name, nights: 1 }
      ],
      hotelChanges: 2,
      majorTransferDays: [`Transfer to ${overnight.place.name}`, `Return from ${overnight.place.name}`],
      totalEstimatedDriving: `${formatDuration(overnight.routeFeasibility.estimatedDriveMinutesRoundTrip + 90)} plus local driving`,
      longestDrivingDay: `${overnight.place.name}, about ${formatDuration(overnight.routeFeasibility.estimatedDriveMinutesRoundTrip)}`,
      fullSightseeingDays: Math.max(1, maxSightseeingDays - 1),
      arrivalAssumptions: "Primary destination first, then extension after the trip has momentum.",
      departureAssumptions: "Return to the departure base before the final travel day unless open-jaw travel is confirmed.",
      experienceMix: `City anchors plus ${overnight.place.categories?.[0] || "regional"} extension.`,
      advantages: ["More memorable regional variety", "Reduces one very long out-and-back day"],
      tradeoffs: ["Adds packing and hotel-change overhead", "Needs explicit approval before booking"],
      costImpact: "Higher lodging and transit friction; may be worth it for longer vacations.",
      whyItFitsUser: "Useful only if the traveler values regional nature or a distinct second base more than simplicity.",
      confidence: overnight.routeFeasibility.classification === "overnight-recommended" ? "high" : "medium"
    });
  }
  if (coreRegions.length >= 2) {
    options.push({
      id: "shape-core-depth",
      structureType: "Single-city depth",
      routeSequence: coreRegions,
      overnightBases: [{ base: base?.name || profile.canonicalName, nights: Math.max(0, calculateTripNights(input.numberOfDays)) }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${formatDuration(input.numberOfDays * 30)}-${formatDuration(input.numberOfDays * 55)} local movement`,
      longestDrivingDay: "No intentional long regional drive",
      fullSightseeingDays: maxSightseeingDays,
      arrivalAssumptions: "Arrival is handled as logistics first, then a light evening.",
      departureAssumptions: "Departure day remains short and flexible.",
      experienceMix: `Deeper focus on ${coreRegions.slice(0, 3).join(", ")}.`,
      advantages: ["More time in each area", "Lower risk of exhaustion", "Simpler meal and lodging planning"],
      tradeoffs: ["May miss signature nearby experiences"],
      costImpact: "Predictable local cost range.",
      whyItFitsUser: "Best if the traveler prefers certainty, lower driving, and fewer hotel changes.",
      confidence: "medium"
    });
  }
  return options.slice(0, 3);
}

function buildDetailedTripDays(profile, input, constraints, days, hotelBase) {
  return days.map((day, index) => {
    const archetype = dayArchetype(day, input, index);
    const activities = day.scheduleItems.filter((item) => item.type === "activity");
    const priorityCandidates = activities.length ? activities : day.scheduleItems.filter((item) => ["travel", "lodging", "dinner", "evening"].includes(item.type));
    const meals = day.scheduleItems.filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type));
    const dontMissItems = priorityRows(day, priorityCandidates.slice(0, Math.max(1, Math.min(2, priorityCandidates.length))), "dontMiss");
    const worthDoingItems = priorityRows(day, priorityCandidates.slice(dontMissItems.length, dontMissItems.length + 2), "worthDoing");
    const bonusItems = [
      ...priorityRows(day, priorityCandidates.slice(dontMissItems.length + worthDoingItems.length), "bonus"),
      ...day.backupOptions.slice(0, Math.max(0, 2 - Math.max(0, activities.length - 2))).map((backup) => ({
        activity: backup.title,
        preferredTime: "If timing allows",
        startEndWindow: "Flexible",
        duration: formatDuration(backup.estimatedDurationMinutes),
        cost: moneyRange(backup.estimatedCostPerPerson.low, backup.estimatedCostPerPerson.high),
        bookingRequired: "No",
        offlineMapRequired: backup.indoorOutdoor === "outdoor" ? "Yes" : "No",
        location: backup.title,
        routeRelevance: backup.reason,
        whyItMatters: backup.description || backup.reason,
        scheduleItemId: "",
        placeId: backup.placeId
      }))
    ].slice(0, 3);
    const expectedSpending = dailySpendingBreakdown(day, input);
    return {
      ...day,
      routeOrLocation: dayRouteLabel(profile, day, input, index),
      startingBase: index === 0 && !sameAreaTrip(input, profile) ? input.origin || "Origin" : hotelBase.primary,
      endingBase: index === input.numberOfDays - 1 && !sameAreaTrip(input, profile) ? input.origin || "Origin" : hotelBase.primary,
      hotel: index === input.numberOfDays - 1 && !sameAreaTrip(input, profile) ? "Departure / home base" : hotelBase.primary,
      totalExpectedDriving: formatDuration(day.dailyDriveMinutes),
      dayArchetype: archetype,
      todaysTopFive: topFiveForDay(day, archetype),
      prioritySections: {
        dontMiss: dontMissItems,
        worthDoing: worthDoingItems,
        bonusStops: bonusItems
      },
      dailyFoodPlan: meals.map((meal) => mealGuideRow(meal)),
      eveningPlan: eveningPlanForDay(day, archetype, constraints),
      expectedSpending,
      quickTips: quickTipsForDay(day, archetype, input),
      tomorrowPrep: tomorrowPrepForDay(days[index + 1], day, input),
      delayStrategy: delayStrategyForDay(day, archetype)
    };
  });
}

function buildDetailedTripGuide(profile, input, constraints, days, hotelBase, routeSummary, budgetSummary, tripShapeOptions) {
  return {
    planningStages: [
      { stage: "Destination Intelligence", status: "complete", summary: `${profile.places.length} candidate places, ${profile.foodAreas.length} food areas, and ${profile.regions.length} route regions were considered.` },
      { stage: "Trip Shape", status: "complete", summary: `${tripShapeOptions.length} trip-shape option${tripShapeOptions.length === 1 ? "" : "s"} evaluated before day planning.` },
      { stage: "Daily Route and Priority Design", status: "complete", summary: "Days are organized by archetype, route grouping, and priority tier." },
      { stage: "Detailed Trip Guide", status: "complete", summary: "Output includes meals, costs, offline maps, reservations, prep, and delay strategy." }
    ],
    tripShapeOptions,
    quickReference: days.map((day) => ({
      dayNumber: day.dayNumber,
      date: formatDisplayDate(day.date),
      routeOrLocation: day.routeOrLocation,
      hotelOrBase: day.hotel,
      dontMiss: day.prioritySections.dontMiss.map((item) => item.activity).join(" · ") || day.todaysTopFive,
      dinnerIdea: day.dailyFoodPlan.find((meal) => meal.meal === "Dinner")?.primaryOption || "Verify a dinner near the final activity",
      expectedSpend: day.expectedSpending.totalRange,
      bookingAlert: day.prioritySections.dontMiss.some((item) => item.bookingRequired === "Yes") ? "Book or confirm" : "No major booking flagged"
    })),
    lodgingPlan: buildLodgingPlan(input, days, hotelBase),
    reservationsToComplete: buildReservationList(days),
    offlineMaps: buildOfflineMapList(profile, input, days),
    packingList: buildPackingList(profile, input, constraints, days),
    budgetWorkbook: {
      currency: budgetSummary.currency,
      categories: budgetSummary.categories,
      totalRange: moneyRange(budgetSummary.totalLow, budgetSummary.totalHigh),
      perPersonRange: moneyRange(budgetSummary.perPersonLow, budgetSummary.perPersonHigh)
    },
    assumptions: [
      "Plans use provider and curated destination data, but hours, traffic, ticket prices, menus, and availability still require direct verification.",
      "Mandatory traveler restrictions and allergies override general group preferences.",
      "Bonus Stops are the first items to cut when timing gets tight."
    ],
    sourceFreshness: profile.sourceMetadata?.freshness || profile.sourceMetadata?.retrievedAt || "Planning data snapshot; verify official sources before travel.",
    practicalStandardChecks: {
      answersBestRoute: Boolean(routeSummary.orderedRegions.length),
      answersSleepEachNight: Boolean(hotelBase.primary),
      answersTruePriorities: days.every((day) => day.prioritySections.dontMiss.length),
      answersOptionalCuts: days.every((day) => day.prioritySections.bonusStops.length || day.delayStrategy.cutFirst),
      answersBookings: true,
      answersOfflineMaps: true,
      answersFood: days.every((day) => day.dailyFoodPlan.length),
      answersDailyCost: days.every((day) => day.expectedSpending.totalRange),
      answersTomorrowPrep: days.every((day) => day.tomorrowPrep.length),
      answersRisks: true,
      answersMemorableSpecifics: days.some((day) => day.prioritySections.dontMiss.some((item) => item.placeId))
    }
  };
}

export function validateTripPlan(plan) {
  const blocking = [];
  const publicText = JSON.stringify({
    overview: plan.overview,
    days: plan.days,
    foodPlan: plan.foodPlan,
    routeSummary: plan.routeSummary,
    hotelBase: plan.hotelBase,
    tripGuide: plan.tripGuide
  });
  const internalLeak = internalOutputTerms().find((term) => publicText.toLowerCase().includes(term));
  if (internalLeak) blocking.push(advisory("internal-language", "blocking", "content", "Internal planning language leaked", "Generated itinerary includes internal provider or taxonomy wording.", "Regenerate with sanitized destination data."));
  if (plan.days.length !== plan.numberOfDays) blocking.push(advisory("day-count", "blocking", "dates", "Incorrect day count", "Generated day count does not match the inclusive trip length.", "Regenerate after fixing dates."));
  plan.days.forEach((day) => {
    if (!day.date) blocking.push(advisory(`date-${day.id}`, "blocking", "dates", `Day ${day.dayNumber} missing date`, "Every generated day must have a date.", "Regenerate the trip."));
    validateDay(day).forEach((issue) => blocking.push(advisory(`day-${day.id}-${issue.code}`, "blocking", "schedule", `Day ${day.dayNumber} schedule issue`, issue.message, "Regenerate or move conflicting items.")));
    if (day.scheduleItems.some((item) => item.weatherDependency === "high") && !day.backupOptions.length) {
      blocking.push(advisory(`backup-${day.id}`, "caution", "weather", `Day ${day.dayNumber} backup missing`, "Outdoor-heavy days should include at least one backup option.", "Replace one item with a lower-weather-dependency option."));
    }
  });
  return { blocking };
}

function validateDay(day) {
  const issues = [];
  const items = [...day.scheduleItems].sort((a, b) => a.startTimeMinutes - b.startTimeMinutes);
  items.forEach((item, index) => {
    if (item.endTimeMinutes <= item.startTimeMinutes) issues.push({ code: "duration", message: `${item.title} must end after it starts.` });
    if (index > 0 && item.startTimeMinutes < items[index - 1].endTimeMinutes) issues.push({ code: "overlap", message: `${item.title} overlaps another schedule item.` });
  });
  return issues;
}

export function compatibleAlternatives(plan, itemId) {
  const profile = resolvePlanProfile(plan);
  const current = plan.days.flatMap((day) => day.scheduleItems).find((item) => item.id === itemId);
  if (!profile || !current) return [];
  const input = plan.preferencesSnapshot;
  const constraints = buildTravelerConstraintProfile(input);
  return scoreCandidates(profile, input, constraints)
    .filter(({ place }) => place.id !== current.placeId && (!(current.regionId || current.neighborhood) || place.regionId === (current.regionId || current.neighborhood) || place.accessibility === "good"))
    .slice(0, 6)
    .map(({ place, reasons }) => ({
      placeId: place.id,
      title: place.name,
      description: place.shortDescription,
      region: regionName(profile, place.regionId),
      category: place.categories[0] || "activity",
      duration: place.typicalDurationMinutes,
      cost: moneyRange(place.estimatedCostLow, place.estimatedCostHigh),
      indoorOutdoor: place.indoorOutdoor,
      walkingLevel: place.accessibility === "limited" ? "Higher walking" : place.accessibility === "good" ? "Lower walking" : "Moderate walking",
      accessibilityFit: constraints.minimalWalking && place.accessibility === "good" ? "Strong accessibility fit" : place.accessibility === "limited" ? "Accessibility caution" : "Standard accessibility check",
      routeImpact: place.regionId === (current.regionId || current.neighborhood) ? "Low route impact" : "Timing may shift for route fit",
      group: place.regionId === (current.regionId || current.neighborhood) ? "Nearby Alternative" : place.indoorOutdoor === "indoor" ? "Indoor Backup" : place.estimatedCostHigh <= 20 ? "Lower-Cost Option" : "Best Fit",
      reason: reasons[0] || "Compatible with this route and preference profile."
    }));
}

function normalizeDayCount(trip) {
  const start = trip.startDate;
  const end = trip.endDate;
  const inclusive = start && end ? calculateInclusiveTripDays(start, end) : null;
  if (inclusive && inclusive > 0) return inclusive;
  return Number(trip.days || 0);
}

function sameAreaTrip(input, profile) {
  const origin = normalizeText(input.origin);
  const destination = normalizeText(input.destination || profile.canonicalName);
  return Boolean(origin && destination && (origin === destination || origin.includes(destination) || destination.includes(origin)));
}

function experienceMixSummary(profile, dayTrips) {
  const categories = new Set(profile.places.flatMap((place) => place.categories || []).slice(0, 18));
  const mix = [
    categories.has("museum") || categories.has("history") ? "culture" : "",
    categories.has("nature") || categories.has("park") || dayTrips.length ? "outdoors" : "",
    categories.has("food") || profile.foodAreas.length ? "food" : "",
    dayTrips.length ? "nearby excursions" : ""
  ].filter(Boolean);
  return mix.length ? titleCase(mix.join(", ")) : "Balanced local highlights";
}

function dayArchetype(day, input, index) {
  const text = normalizeText(`${day.title} ${day.theme} ${day.region} ${day.scheduleItems.map((item) => `${item.title} ${item.category} ${(item.tags || []).join(" ")}`).join(" ")}`);
  if (index === 0 && day.scheduleItems.some((item) => item.title.startsWith("Travel to "))) return "Arrival day";
  if (index === input.numberOfDays - 1 && day.scheduleItems.some((item) => item.title.startsWith("Depart "))) return "Departure day";
  if (/resort|beach|pool|spa/.test(text)) return "Resort day";
  if (/scenic drive|road trip|parkway|viewpoint|overlook/.test(text) && day.dailyDriveMinutes >= 90) return "Scenic drive day";
  if (/waterfall|mountain|hike|trail|lake|nature|garden|park|whitewater/.test(text)) return "Nature day";
  if (/ferry|excursion|island|cruise|day trip/.test(text)) return "Excursion day";
  if (/food|restaurant|market|brewery|neighborhood|district|downtown|arts/.test(text)) return "Neighborhood and food day";
  if (day.scheduleItems.filter((item) => item.type === "travel").length >= 2 || day.dailyDriveMinutes >= 120) return "Transfer day";
  if (day.scheduleItems.some((item) => item.reservationRecommended)) return "Signature attraction day";
  return "Full destination day";
}

function dayRouteLabel(profile, day, input, index) {
  if (index === 0 && day.scheduleItems.some((item) => item.title.startsWith("Travel to "))) return `${input.origin || "Origin"} -> ${profile.canonicalName}`;
  if (index === input.numberOfDays - 1 && day.scheduleItems.some((item) => item.title.startsWith("Depart "))) return `${profile.canonicalName} -> ${input.origin || "Origin"}`;
  const activityRegions = [...new Set(day.scheduleItems.filter((item) => item.regionId).map((item) => regionName(profile, item.regionId)))].slice(0, 3);
  return activityRegions.length ? activityRegions.join(" -> ") : day.region;
}

function topFiveForDay(day, archetype) {
  const important = day.scheduleItems
    .filter((item) => item.type === "travel" || item.type === "lodging" || item.type === "activity" || item.type === "dinner" || item.type === "evening")
    .map((item) => item.type === "dinner" ? "Dinner" : item.title)
    .slice(0, 5);
  while (important.length < 5) {
    important.push(archetype.includes("Departure") ? "Protect departure buffer" : important.length === 4 ? "Rest buffer" : "Flexible backup");
  }
  return important.slice(0, 5).join(" - ");
}

function priorityRows(day, items, priority) {
  return items.map((item) => ({
    activity: item.title,
    preferredTime: item.startTime || "Flexible",
    startEndWindow: item.startTime && item.endTime ? `${item.startTime}-${item.endTime}` : "Flexible",
    duration: formatDuration(item.durationMinutes || 0),
    cost: item.estimatedCostPerPerson ? moneyRange(item.estimatedCostPerPerson.low, item.estimatedCostPerPerson.high) : "$0-$0",
    bookingRequired: item.reservationRecommended ? "Yes" : "No",
    offlineMapRequired: item.indoorOutdoor === "outdoor" || item.weatherDependency === "high" ? "Yes" : "No",
    location: item.locationLabel || item.title,
    routeRelevance: priority === "dontMiss" ? "Defines the day; protect this before optional stops." : priority === "worthDoing" ? "Good fit if the main timing holds." : "Cut first if late.",
    whyItMatters: item.description,
    scheduleItemId: item.id,
    placeId: item.placeId || ""
  }));
}

function mealGuideRow(meal) {
  const details = meal.mealDetails || {};
  return {
    meal: titleCase(meal.type),
    time: meal.startTime || "",
    actualRestaurantOrLocation: details.primaryOption || meal.locationLabel || meal.title,
    primaryOption: details.primaryOption || meal.title,
    backupOption: details.secondaryOption || "Pick a nearby verified backup with matching dietary support",
    suggestedCuisineOrDish: details.cuisine || "Local option",
    dietaryCompatibility: meal.dietaryNotes || "Confirm dietary needs directly.",
    cost: meal.estimatedCostPerPerson ? moneyRange(meal.estimatedCostPerPerson.low, meal.estimatedCostPerPerson.high) : "$0-$0",
    reservationGuidance: details.reservationGuidance || "Verify hours and reserve if this is a must-do meal.",
    openingHoursConfidence: details.hoursConfidence || "Unverified; confirm current hours.",
    distanceFromRoute: meal.locationLabel ? "Placed near the day route area." : "Confirm exact distance from route.",
    placeIdOrSource: meal.placeId || meal.source || "local-meal-planner"
  };
}

function eveningPlanForDay(day, archetype, constraints) {
  const evening = day.scheduleItems.find((item) => item.type === "evening");
  if (archetype === "Departure day") return "No late evening plan. Protect departure logistics and rest.";
  if (!evening) return "Conditional quiet evening only; skip it if dinner or driving runs late.";
  const status = constraints.noAlcohol ? "primary no-alcohol-compatible option" : evening.reservationRecommended ? "optional nightlife option" : "primary relaxed option";
  return `${evening.title}: ${evening.description} Treat this as a ${status}; cut it before any Don’t Miss item.`;
}

function dailySpendingBreakdown(day, input) {
  const travelers = input.travelers || 1;
  const mealItems = day.scheduleItems.filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type));
  const activityItems = day.scheduleItems.filter((item) => item.type === "activity");
  const travelMinutes = day.scheduleItems.filter((item) => item.type === "travel").reduce((sum, item) => sum + item.durationMinutes, 0);
  const foodLow = mealItems.reduce((sum, item) => sum + (item.estimatedCostPerPerson?.low || 0), 0) * travelers;
  const foodHigh = mealItems.reduce((sum, item) => sum + (item.estimatedCostPerPerson?.high || 0), 0) * travelers;
  const activityLow = activityItems.reduce((sum, item) => sum + (item.estimatedCostPerPerson?.low || 0), 0) * travelers;
  const activityHigh = activityItems.reduce((sum, item) => sum + (item.estimatedCostPerPerson?.high || 0), 0) * travelers;
  const fuelLow = Math.round(travelMinutes * 0.15);
  const fuelHigh = Math.round(travelMinutes * 0.28 + 10);
  const parkingLow = activityItems.length ? 5 : 0;
  const parkingHigh = activityItems.length ? 25 : 10;
  const miscellaneousLow = 10;
  const miscellaneousHigh = 30;
  const low = foodLow + activityLow + fuelLow + parkingLow + miscellaneousLow;
  const high = foodHigh + activityHigh + fuelHigh + parkingHigh + miscellaneousHigh;
  return {
    food: moneyRange(foodLow, foodHigh),
    fuel: moneyRange(fuelLow, fuelHigh),
    parking: moneyRange(parkingLow, parkingHigh),
    activities: moneyRange(activityLow, activityHigh),
    tickets: moneyRange(activityLow, activityHigh),
    transit: moneyRange(fuelLow, fuelHigh),
    miscellaneous: moneyRange(miscellaneousLow, miscellaneousHigh),
    totalRange: moneyRange(low, high)
  };
}

function quickTipsForDay(day, archetype, input) {
  const tips = [];
  if (day.prioritySections?.dontMiss?.some((item) => item.offlineMapRequired === "Yes") || day.dailyDriveMinutes >= 90) tips.push("Download offline maps for the day route before leaving Wi-Fi.");
  if (archetype === "Arrival day") tips.push("Keep arrival day light until check-in, parking, and bags are handled.");
  if (archetype === "Departure day") tips.push("Do not add a deep final stop unless your departure window is intentionally late.");
  if (day.prioritySections?.dontMiss?.some((item) => item.bookingRequired === "Yes")) tips.push("Confirm tickets or reservations before the day starts.");
  if (day.scheduleItems.some((item) => item.weatherDependency === "high")) tips.push("Check weather in the morning and move indoor backups forward if needed.");
  if (input.travelers > 1) tips.push("Agree on the Don’t Miss items before leaving so Bonus Stops are easy to cut.");
  return tips.slice(0, 5);
}

function tomorrowPrepForDay(nextDay, day, input) {
  if (!nextDay) return ["Set alarms for departure or checkout.", "Keep IDs, chargers, and essentials accessible.", "Save receipts and notes for the trip wrap-up."];
  const prep = [];
  if (nextDay.scheduleItems.some((item) => item.type === "travel") || nextDay.dailyDriveMinutes >= 90) prep.push("Fuel or charge the vehicle and download tomorrow’s route offline.");
  if (nextDay.scheduleItems.some((item) => item.reservationRecommended)) prep.push("Confirm tomorrow’s tickets, reservations, parking, and arrival window.");
  if (nextDay.scheduleItems.some((item) => item.weatherDependency === "high")) prep.push("Check tomorrow’s forecast and pack shoes, layers, water, and sun/rain gear.");
  if (nextDay.dayNumber !== day.dayNumber + 1 || input.lodging.changeHotels !== "Stay in one place") prep.push("Keep luggage organized in case checkout or a base change becomes necessary.");
  prep.push(`Aim to start Day ${nextDay.dayNumber} by ${nextDay.scheduleItems.find((item) => item.type === "activity")?.startTime || input.earliestActivity}.`);
  return prep.slice(0, 5);
}

function delayStrategyForDay(day, archetype) {
  const bonus = day.prioritySections?.bonusStops?.[0]?.activity || "the lowest-priority optional stop";
  const worth = day.prioritySections?.worthDoing?.[0]?.activity || "a lower-priority Worth Doing item";
  const keep = day.prioritySections?.dontMiss?.map((item) => item.activity).join(", ") || "travel and meal anchors";
  return {
    keep,
    move: worth,
    cutFirst: bonus,
    latestSafeDepartureTime: archetype === "Departure day" ? "Protect the departure buffer entered for the trip." : day.scheduleItems.find((item) => item.type === "travel")?.startTime || "No fixed departure; protect dinner and return time.",
    backupTrigger: day.scheduleItems.some((item) => item.weatherDependency === "high") ? "Use indoor or lower-weather backup if rain, heat, visibility, or trail conditions are poor." : "Use backups if the first Don’t Miss item runs more than 45 minutes late."
  };
}

function buildLodgingPlan(input, days, hotelBase) {
  const nights = calculateTripNights(input.numberOfDays);
  return {
    recommendedBase: hotelBase.primary,
    nights,
    hotelChangeCount: /change|split|multiple/i.test(input.lodging.changeHotels || "") ? "User open to changes; verify before booking." : 0,
    nightlyPlan: days.slice(0, Math.max(0, nights)).map((day) => ({
      night: day.dayNumber,
      date: formatDisplayDate(day.date),
      sleepArea: day.hotel || hotelBase.primary,
      whyThisBase: day.dayArchetype === "Departure day" ? "Keeps departure simple." : "Keeps the next day route and meals practical."
    })),
    notes: [hotelBase.reason, hotelBase.tradeoffs, hotelBase.splitStaySuggestion]
  };
}

function buildReservationList(days) {
  const rows = [];
  days.forEach((day) => {
    day.prioritySections.dontMiss.concat(day.prioritySections.worthDoing).forEach((item) => {
      if (item.bookingRequired === "Yes") rows.push({ dayNumber: day.dayNumber, item: item.activity, timing: item.preferredTime, priority: "Confirm before travel", reason: item.whyItMatters });
    });
    day.dailyFoodPlan.filter((meal) => /reserve|must-do/i.test(meal.reservationGuidance)).forEach((meal) => rows.push({ dayNumber: day.dayNumber, item: meal.primaryOption, timing: meal.time, priority: "Meal reservation check", reason: meal.reservationGuidance }));
  });
  return rows.length ? rows : [{ dayNumber: "", item: "No required bookings detected", timing: "Before trip", priority: "Verify anyway", reason: "Still confirm hours, tickets, parking, and closures directly." }];
}

function buildOfflineMapList(profile, input, days) {
  const regions = new Set();
  days.forEach((day) => {
    if (day.dailyDriveMinutes >= 60 || day.prioritySections.dontMiss.some((item) => item.offlineMapRequired === "Yes")) regions.add(day.region);
    day.scheduleItems.filter((item) => item.regionId && (item.type === "activity" || item.type === "travel")).forEach((item) => regions.add(regionName(profile, item.regionId)));
  });
  const items = [...regions].slice(0, 8).map((region) => ({ region, reason: "Useful for driving, parking, trailheads, or weak-signal areas." }));
  if (input.origin && !sameAreaTrip(input, profile)) items.unshift({ region: `${input.origin} to ${profile.canonicalName}`, reason: "Arrival/departure route should be available offline." });
  return items;
}

function buildPackingList(profile, input, constraints, days) {
  const hasNature = days.some((day) => /Nature|Scenic|Excursion/.test(day.dayArchetype));
  const hasReservations = days.some((day) => day.prioritySections.dontMiss.some((item) => item.bookingRequired === "Yes"));
  const hasNight = days.some((day) => /night|evening|sunset|stargaz/i.test(day.eveningPlan));
  return [
    { category: "Documents", items: ["Photo ID", "reservation confirmations", hasReservations ? "ticket screenshots" : "saved itinerary PDF"].filter(Boolean) },
    { category: "Navigation", items: ["offline maps", "charging cable", "car mount or transit app"] },
    { category: "Comfort", items: ["walking shoes", "daypack", "reusable water bottle", hasNature ? "sun/rain layer" : "light layer"].filter(Boolean) },
    { category: "Food and health", items: [constraints.seriousDietary ? "allergy or dietary notes for restaurants" : "snacks", "medications", "hand sanitizer"] },
    { category: "Destination-specific", items: [hasNature ? "trail or outdoor clothes" : "city casual outfit", hasNight ? "evening layer" : "rest-day clothes", profile.currency !== "USD" ? `${profile.currency} payment backup` : "parking payment app"].filter(Boolean) }
  ];
}

function normalizePace(value) {
  if (/relaxed/i.test(value || "")) return "Relaxed";
  if (/packed|active/i.test(value || "")) return "Packed";
  return "Balanced";
}

function paceDefaults(pace) {
  if (pace === "Relaxed") return { activities: 2, buffer: 25 };
  if (pace === "Packed") return { activities: 4, buffer: 10 };
  return { activities: 3, buffer: 18 };
}

function splitList(value) {
  return String(value || "").split(/,|\n/).map((item) => item.trim()).filter(Boolean);
}

function collectUnknownPreferences(trip) {
  return (trip.preferences || []).filter((pref) => pref.category === "Custom").map((pref) => pref.label);
}

function parseHoursToMinutes(value) {
  const match = /(\d+(?:\.\d+)?)/.exec(String(value || ""));
  return match ? Math.round(Number(match[1]) * 60) : null;
}

function parseTime(value) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(value || "").trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatTime(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${meridiem}`;
}

function sortAndFormat(items) {
  let cursor = -Infinity;
  return items.sort((a, b) => a.startTimeMinutes - b.startTimeMinutes).map((item) => {
    const startTimeMinutes = item.startTimeMinutes < cursor ? cursor : item.startTimeMinutes;
    const endTimeMinutes = startTimeMinutes + item.durationMinutes;
    cursor = endTimeMinutes + (item.type === "travel" ? 8 : 10);
    return {
      ...item,
      startTimeMinutes,
      endTimeMinutes,
      startTime: formatTime(startTimeMinutes),
      endTime: formatTime(endTimeMinutes)
    };
  });
}

function addDays(startValue, offset) {
  const [year, month, day] = startValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year) return value || "";
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${day}, ${year}`;
}

function rotate(values, seed) {
  const offset = Math.abs(Number(seed || 0)) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function regionName(profile, id) {
  return profile.regions.find((region) => region.id === id)?.name || id;
}

function dayThemeLabel(regions) {
  if (regions.includes("santa-monica")) return "Coast, beach, and sunset";
  if (regions.includes("griffith-park")) return "Views, film history, and hillside scenery";
  if (regions.includes("downtown")) return "Culture, architecture, and food";
  if (regions.includes("malibu")) return "Scenic coastal drive";
  if (regions.includes("pasadena")) return "Gardens and relaxed culture";
  return "Regional highlights";
}

function estimateTravel(profile, fromPlaceOrRegion, toPlaceOrRegion) {
  const fromRegionId = typeof fromPlaceOrRegion === "string" ? fromPlaceOrRegion : fromPlaceOrRegion?.regionId;
  const toRegionId = typeof toPlaceOrRegion === "string" ? toPlaceOrRegion : toPlaceOrRegion?.regionId;
  const fromCoordinates = coordinatesFor(profile, fromPlaceOrRegion);
  const toCoordinates = coordinatesFor(profile, toPlaceOrRegion);
  const route = profile.scenicRoutes.find((item) => (item.originRegionId === fromRegionId && item.destinationRegionId === toRegionId) || (item.originRegionId === toRegionId && item.destinationRegionId === fromRegionId));
  if (fromCoordinates && toCoordinates) {
    const distanceMiles = haversineMiles(fromCoordinates.lat, fromCoordinates.lng, toCoordinates.lat, toCoordinates.lng);
    const minimum = Math.ceil(distanceMiles / (route?.tags?.includes("scenic") || distanceMiles > 18 ? 0.65 : 0.45));
    const routeMinutes = route?.estimatedDriveMinutes;
    const durationMinutes = Math.max(8, Math.round(routeMinutes ? Math.max(routeMinutes, minimum) : minimum + (distanceMiles > 20 ? 18 : 8)));
    return {
      mode: "Drive",
      durationMinutes,
      distanceMiles: Math.max(0.5, Math.round(distanceMiles * 10) / 10),
      fromLabel: placeOrRegionLabel(profile, fromPlaceOrRegion, fromRegionId),
      toLabel: placeOrRegionLabel(profile, toPlaceOrRegion, toRegionId),
      estimateType: route ? "curated-coordinate-estimate" : "coordinate-plausibility-estimate",
      note: `Estimated drive: about ${durationMinutes} minutes over ${Math.max(0.5, Math.round(distanceMiles * 10) / 10)} miles. Verify live traffic before traveling.`
    };
  }
  if (fromRegionId === toRegionId) return { mode: "Drive", durationMinutes: 12, distanceMiles: 3, fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), estimateType: "same-area-estimate", note: "Short same-area transfer estimate; verify exact location and parking." };
  const minutes = route?.estimatedDriveMinutes || 35;
  return { mode: "Drive", durationMinutes: minutes, distanceMiles: route?.estimatedDistanceMiles || Math.round(minutes * 0.7), fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), estimateType: "curated-region-estimate", note: `Estimated drive: about ${minutes} minutes. Verify live traffic before traveling.` };
}

function coordinatesFor(profile, placeOrRegion) {
  if (!placeOrRegion) return null;
  if (typeof placeOrRegion === "object") {
    if (Number.isFinite(placeOrRegion.coordinates?.lat) && Number.isFinite(placeOrRegion.coordinates?.lng)) return placeOrRegion.coordinates;
    if (Number.isFinite(placeOrRegion.latitude) && Number.isFinite(placeOrRegion.longitude)) return { lat: Number(placeOrRegion.latitude), lng: Number(placeOrRegion.longitude) };
  }
  const regionId = typeof placeOrRegion === "string" ? placeOrRegion : placeOrRegion.regionId;
  const region = profile.regions.find((item) => item.id === regionId);
  return region?.centerCoordinates || null;
}

function placeOrRegionLabel(profile, placeOrRegion, regionId) {
  if (typeof placeOrRegion === "object" && placeOrRegion?.name) return placeOrRegion.name;
  return regionName(profile, regionId);
}

function mealTitle(profile, regionId, mealType) {
  const region = regionName(profile, regionId);
  if (mealType === "breakfast") return `${region} breakfast option`;
  if (mealType === "lunch") return `${region} lunch option`;
  return `${region} dinner option`;
}

function mealRecommendation(profile, input, regionId, mealType) {
  const area = profile.foodAreas.find((candidate) => candidate.regionId === regionId && candidate.mealTypes.includes(mealType)) || profile.foodAreas.find((candidate) => candidate.mealTypes.includes(mealType));
  const cuisine = (input.food.cuisine || []).find((item) => area?.cuisines.some((cuisineName) => normalizeText(cuisineName).includes(normalizeText(item)))) || (input.food.cuisine || [])[0] || "local";
  const primaryPlace = mealCandidatePlace(profile, regionId, mealType);
  const secondaryPlace = mealCandidatePlace(profile, regionId, mealType, primaryPlace?.id) || mealCandidatePlace(profile, area?.regionId, mealType, primaryPlace?.id);
  const primary = primaryPlace?.name || specificFoodAreaLabel(profile, area, regionId, mealType);
  const secondary = secondaryPlace?.name || secondaryFoodOption(profile, area, regionId);
  const price = moneyRange(mealCost(input, mealType).low, mealCost(input, mealType).high);
  const reservation = mealType === "dinner" ? "Reserve if this is a must-do meal or the group is larger; otherwise verify hours day-of." : "Reservations usually optional; verify hours and menus day-of.";
  return {
    primary,
    secondary,
    text: `${primary}. Backup: ${secondary}. Cuisine fit: ${titleCase(cuisine)} / local options. Estimated ${price} per person. ${reservation} Dietary and allergy safety must be confirmed directly with the restaurant.`,
    cuisine: titleCase(cuisine),
    price,
    reservation
  };
}

function mealCandidatePlace(profile, regionId, mealType, excludedId = "") {
  const regionMatches = profile.places
    .filter((place) => place.regionId === regionId && place.id !== excludedId)
    .filter((place) => isMealCandidate(place, mealType))
    .sort((a, b) => b.priorityScore - a.priorityScore);
  if (regionMatches.length) return regionMatches[0];
  return profile.places
    .filter((place) => place.id !== excludedId)
    .filter((place) => isMealCandidate(place, mealType))
    .sort((a, b) => b.priorityScore - a.priorityScore)[0] || null;
}

function isMealCandidate(place, mealType) {
  const text = normalizeText(`${place.name} ${place.categories.join(" ")} ${place.tags.join(" ")}`);
  if (!/food|dining|restaurant|market|food hall|cafe|bakery|breakfast|brunch|rooftop|brewery|bar|dessert/.test(text)) return false;
  if (/museum|hall of fame|park|walk|trail|greenway|mountain|lake|theme park|speedway|science|aviation|garden/.test(normalizeText(place.categories.join(" ")))) return false;
  if (mealType === "breakfast") return /breakfast|brunch|cafe|bakery|food/.test(text);
  if (mealType === "lunch") return /lunch|food|market|food hall|cafe|casual|dining/.test(text);
  return /dinner|food|dining|rooftop|restaurant|evening|brewery|bar/.test(text);
}

function specificFoodAreaLabel(profile, area, regionId, mealType) {
  if (!area?.name) return `${regionName(profile, regionId)} ${mealType}`;
  return area.name
    .replace(/restaurants and food halls/i, "verified dining candidates")
    .replace(/dining and breweries/i, "dinner candidates")
    .replace(/cafes, breweries, and casual food/i, "cafe and dinner candidates")
    .replace(/neighborhood dining/i, "restaurant candidates")
    .replace(/food and events/i, "food vendors and event-night dining")
    .replace(/waterfront dining/i, "waterfront restaurant candidates");
}

function secondaryFoodOption(profile, area, regionId) {
  const sameRegion = profile.foodAreas.find((candidate) => candidate.id !== area?.id && candidate.regionId === regionId);
  const other = profile.foodAreas.find((candidate) => candidate.id !== area?.id);
  return specificFoodAreaLabel(profile, sameRegion || other, regionId, "backup") || `${regionName(profile, regionId)} local restaurant backup`;
}

function mealCost(input, mealType) {
  const band = String(input.food.foodBudgetPerPerson || "").toLowerCase();
  const budget = band.includes("15") || band.includes("30") ? [10, 25] : band.includes("60") ? [20, 45] : [25, 70];
  if (mealType === "breakfast") return { low: Math.max(8, budget[0] - 3), high: Math.max(15, budget[1] - 8) };
  if (mealType === "lunch") return { low: budget[0], high: budget[1] };
  return { low: budget[0] + 5, high: budget[1] + 20 };
}

function foodDailyBudget(input) {
  const text = String(input.food.foodBudgetPerPerson || "").toLowerCase();
  if (text.includes("15") || text.includes("30")) return { low: 45, high: 85 };
  if (text.includes("60")) return { low: 70, high: 140 };
  return { low: 55, high: 120 };
}

function estimateDayBudget(input, items) {
  const low = items.reduce((sum, item) => sum + (item.estimatedCostPerPerson?.low || 0), 0) * input.travelers + 25;
  const high = items.reduce((sum, item) => sum + (item.estimatedCostPerPerson?.high || 0), 0) * input.travelers + 55;
  return { currency: "USD", low: roundMoney(low), high: roundMoney(high), label: moneyRange(low, high) };
}

function sumCost(days, key) {
  return days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").reduce((sum, item) => sum + (item.estimatedCostPerPerson?.[key] || 0), 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) / 10) * 10;
}

function moneyRange(low, high) {
  return `$${roundMoney(low).toLocaleString()}-$${roundMoney(high).toLocaleString()}`;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  return `${hours} hr${hours === 1 ? "" : "s"}${mins ? ` ${mins} min` : ""}`;
}

function weatherNote(items, date) {
  const month = Number(String(date).split("-")[1]);
  const outdoorHeavy = items.filter((item) => item.weatherDependency === "high").length >= 2;
  if (month >= 6 && month <= 9 && outdoorHeavy) return "Check heat and sun exposure closer to travel; shift to the indoor backup during excessive heat.";
  if (items.some((item) => item.indoorOutdoor === "outdoor")) return "Check the local forecast closer to the trip; adjust outdoor timing for heat, rain, wind, or poor visibility.";
  return "Mostly indoor or mixed day; still confirm hours and ticketing before travel.";
}

function accessibilityNote(place, constraints) {
  if (constraints.wheelchairRequired && place.accessibility !== "good") return "Accessibility is uncertain for this stop; consider replacing with a stronger accessible alternative.";
  if (constraints.minimalWalking && place.accessibility === "limited") return "Walking intensity may be too high for the stated mobility needs.";
  if (place.accessibility === "good") return "Planned as a lower-friction option; confirm current access details directly.";
  return "Expect some walking; adjust or replace if comfort changes.";
}

function buildDietarySummary(input, foodText) {
  const selected = [...(input.food.diet || []), ...(input.food.restrictions || [])].filter(Boolean);
  const travelerRestrictions = input.travelersDetail.flatMap((traveler, index) => (traveler.restrictions || []).filter((restriction) => /food|gluten|lactose|vegetarian|vegan|halal|kosher|jain|beef|pork|seafood|allergy/i.test(restriction)).map((restriction) => `${traveler.name || `Traveler ${index + 1}`}: ${restriction}`));
  const summary = [...selected, ...travelerRestrictions];
  if (!summary.length) return "No mandatory dietary restriction was entered; recommendations stay flexible.";
  return `${summary.join(", ")} applied. Confirm ingredients, preparation, and cross-contact directly with restaurants.`;
}

function budgetBand(input) {
  const value = String(input.budget.style || input.budget.total || "").toLowerCase();
  if (/budget|1500|strict/.test(value)) return "budget";
  if (/luxury|premium/.test(value)) return "premium";
  return "moderate";
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCase(value) {
  return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const radiusMiles = 3958.8;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function internalOutputTerms() {
  return [
    "google places landmark candidate",
    "google places food candidate",
    "openrouteservice point-of-interest candidate",
    "provider-found",
    "provider-retrieved",
    "culture-area",
    "nature-area",
    "central-area",
    "food and evening area",
    "food-area",
    "raw slug"
  ];
}

function advisory(id, severity, category, title, message, resolutionSuggestion, relatedDayId = "", relatedScheduleItemId = "") {
  return { id, severity, category, title, message, relatedDayId, relatedScheduleItemId, resolutionSuggestion };
}

function denormalizedTrip(input) {
  return {
    id: input.sourceTripId,
    from: input.origin,
    fromDisplay: input.origin,
    destination: input.destination,
    destinationDisplay: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    days: input.numberOfDays,
    groupType: input.groupType,
    adults: input.travelers,
    children: input.childCount,
    seniors: input.seniorCount,
    preferences: input.preferences,
    travelers: input.travelersDetail,
    food: input.food,
    alcohol: input.alcohol,
    schedule: { pace: input.pace, majorActivities: input.maxActivities, latestReturn: input.latestReturn, earliestActivity: input.earliestActivity },
    activity: { walking: input.walkingLimit, hiking: input.hiking },
    transport: input.transport,
    budget: input.budget,
    lodging: input.lodging,
    mustHavePlaces: input.mustHavePlaces?.join(", ") || "",
    avoidPlaces: input.avoidPlaces?.join(", ") || ""
  };
}
