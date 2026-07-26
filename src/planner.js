import {
  calculateInclusiveTripDays,
  calculateTripEndDate,
  calculateTripNights,
  getTripIssues,
  travelerTotal,
  uid
} from "./domain.js?v=51";
import { createGenericDestinationProfile, getDestinationProfile, resolveDestinationProfile } from "./destination-data.js?v=51";

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
    transport: structuredClone(trip.transport || {}),
    preferences: structuredClone(trip.preferences || []),
    travelersDetail: structuredClone(trip.travelers || []),
    mustHavePlaces: splitList(trip.mustHavePlaces),
    avoidPlaces: splitList(trip.avoidPlaces),
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
  const scored = scoreCandidates(destinationProfile, normalized, constraints);
  const days = buildDays(destinationProfile, normalized, constraints, scored);
  const hotelBase = buildHotelBase(destinationProfile, normalized, days);
  const foodPlan = buildFoodPlan(destinationProfile, normalized, constraints, days);
  const routeSummary = buildRouteSummary(destinationProfile, days);
  const budgetSummary = buildBudgetSummary(normalized, days);
  const advisories = buildAdvisories(destinationProfile, normalized, constraints, days, budgetSummary);
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
    advisories,
    unresolvedConflicts: advisories.filter((item) => item.severity === "conflict" || item.severity === "blocking"),
    generationMetadata: {
      destinationProfileId: destinationProfile.id,
      destinationProfileSnapshot: destinationProfile,
      usesGenericDestinationProfile: destinationProfile.id.startsWith("generic-"),
      hotelBase,
      variationSeed: normalized.variationSeed,
      scoringWeights: planningWeights,
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

export function scoreCandidates(profile, input, constraints) {
  const selectedLabels = [
    ...input.preferences.map((pref) => pref.label),
    ...(input.food.cuisine || []),
    ...(input.alcohol.preferences || [])
  ].map(normalizeText);
  const avoid = new Set(input.avoidPlaces.map(normalizeText));
  const must = input.mustHavePlaces.map(normalizeText);
  return profile.places.map((place) => {
    const reasons = [];
    let score = place.priorityScore * planningWeights.priority;
    const placeText = normalizeText(`${place.name} ${place.categories.join(" ")} ${place.tags.join(" ")}`);
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
    return { place, score, reasons };
  }).sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
}

export function buildDays(profile, input, constraints, scored) {
  const scheduled = new Set();
  const themes = destinationDayThemes(profile, input);
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

function destinationDayThemes(profile, input) {
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

function scheduleDay(profile, input, constraints, places, dayIndex) {
  const items = [];
  const buffers = paceDefaults(input.pace).buffer;
  const mealDuration = input.pace === "Relaxed" ? 75 : 60;
  const breakfastStart = constraints.breakfastMinutes;
  const activityStart = Math.max(parseTime(input.earliestActivity) ?? 9 * 60, breakfastStart + 60);
  const firstRegion = places[0]?.regionId || "santa-monica";
  addMeal(items, "breakfast", breakfastStart, 45, "Breakfast near the day base", mealRecommendation(profile, input, firstRegion, "breakfast"), firstRegion, input, constraints);
  let cursor = activityStart;
  places.forEach((place, index) => {
    if (index > 0) {
      const previous = places[index - 1];
      const travel = estimateTravel(profile, previous.regionId, place.regionId);
      items.push(travelItem(previous.name, place.name, cursor, travel));
      cursor += travel.durationMinutes + buffers;
    }
    if (index === 1 && cursor > constraints.lunchMinutes - 30) {
      addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, "Lunch near the route", mealRecommendation(profile, input, place.regionId, "lunch"), place.regionId, input, constraints);
      cursor = Math.max(cursor, constraints.lunchMinutes + mealDuration + buffers);
    }
    items.push(activityItem(place, cursor, constraints, index));
    cursor += place.typicalDurationMinutes + buffers;
  });
  if (!items.some((item) => item.type === "lunch")) {
    const lunchRegion = places[0]?.regionId || firstRegion;
    addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, "Lunch near the main activity area", mealRecommendation(profile, input, lunchRegion, "lunch"), lunchRegion, input, constraints);
  }
  const afterActivities = Math.max(cursor, constraints.dinnerMinutes - (input.pace === "Packed" ? 45 : 90));
  if (input.pace !== "Packed") {
    items.push(simpleItem("freeTime", afterActivities, input.pace === "Relaxed" ? 90 : 60, "Reset and free time", "A buffer window to rest, freshen up, or handle traffic without compressing dinner."));
  }
  const dinnerRegion = places.at(-1)?.regionId || firstRegion;
  addMeal(items, "dinner", constraints.dinnerMinutes, input.pace === "Relaxed" ? 90 : 75, "Dinner aligned with your food preferences", mealRecommendation(profile, input, dinnerRegion, "dinner"), dinnerRegion, input, constraints);
  const eveningStart = constraints.dinnerMinutes + (input.pace === "Relaxed" ? 105 : 90);
  const evening = eveningItem(profile, input, constraints, dinnerRegion, eveningStart, dayIndex);
  if (evening.endTimeMinutes <= constraints.latestReturnMinutes || input.pace === "Packed") items.push(evening);
  else items.push(simpleItem("note", eveningStart, 20, "Early return", "Skipped a late evening activity to respect the preferred return time."));
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
    neighborhood: place.regionId,
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
  items.push({
    id: uid("item"),
    type,
    startTimeMinutes: start,
    endTimeMinutes: start + duration,
    durationMinutes: duration,
    title,
    description: recommendation,
    placeId: "",
    neighborhood: regionId,
    locationLabel: regionId,
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
    neighborhood: regionId,
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
        return { ...item, description: mealRecommendation(profile, input, item.neighborhood || "santa-monica", item.type), dietaryNotes: constraints.dietarySummary };
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
  plan.routeSummary = buildRouteSummary(profile, plan.days);
  plan.budgetSummary = buildBudgetSummary(plan.preferencesSnapshot, plan.days);
  plan.foodPlan = buildFoodPlan(profile, plan.preferencesSnapshot, buildTravelerConstraintProfile(plan.preferencesSnapshot), plan.days);
  plan.advisories = buildAdvisories(profile, plan.preferencesSnapshot, buildTravelerConstraintProfile(plan.preferencesSnapshot), plan.days, plan.budgetSummary);
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

export function validateTripPlan(plan) {
  const blocking = [];
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
    .filter(({ place }) => place.id !== current.placeId && (!current.neighborhood || place.regionId === current.neighborhood || place.accessibility === "good"))
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
      routeImpact: place.regionId === current.neighborhood ? "Low route impact" : "Timing may shift for route fit",
      group: place.regionId === current.neighborhood ? "Nearby Alternative" : place.indoorOutdoor === "indoor" ? "Indoor Backup" : place.estimatedCostHigh <= 20 ? "Lower-Cost Option" : "Best Fit",
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

function estimateTravel(profile, fromRegionId, toRegionId) {
  if (fromRegionId === toRegionId) return { mode: "Drive", durationMinutes: 8, distanceMiles: 2, fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), estimateType: "local-estimate", note: "Estimated short transfer; confirm real traffic day-of." };
  const route = profile.scenicRoutes.find((item) => (item.originRegionId === fromRegionId && item.destinationRegionId === toRegionId) || (item.originRegionId === toRegionId && item.destinationRegionId === fromRegionId));
  const minutes = route?.estimatedDriveMinutes || 32;
  return { mode: "Drive", durationMinutes: minutes, distanceMiles: route?.estimatedDistanceMiles || Math.round(minutes * 0.7), fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), estimateType: "curated-region-estimate", note: `Estimated drive: ${minutes}-${minutes + 15} minutes depending on traffic.` };
}

function mealRecommendation(profile, input, regionId, mealType) {
  const area = profile.foodAreas.find((candidate) => candidate.regionId === regionId && candidate.mealTypes.includes(mealType)) || profile.foodAreas.find((candidate) => candidate.mealTypes.includes(mealType));
  const cuisine = (input.food.cuisine || []).find((item) => area?.cuisines.some((cuisineName) => normalizeText(cuisineName).includes(normalizeText(item)))) || (input.food.cuisine || [])[0] || "local";
  if (mealType === "breakfast") return `Quick ${cuisine.toLowerCase()}-friendly breakfast or cafe option near ${regionName(profile, regionId)}; confirm dietary details directly.`;
  if (mealType === "lunch") return `Casual ${cuisine.toLowerCase()} lunch around ${area?.name || regionName(profile, regionId)} with route-friendly timing.`;
  return `${input.food.dinner || "Relaxed"} dinner near ${area?.name || regionName(profile, regionId)}; use reservations for must-do venues.`;
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
  if (items.some((item) => item.indoorOutdoor === "outdoor")) return "Check the forecast closer to the trip; coastal evenings can feel cooler than inland areas.";
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
