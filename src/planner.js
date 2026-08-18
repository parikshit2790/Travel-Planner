import {
  calculateInclusiveTripDays,
  calculateTripEndDate,
  calculateTripNights,
  getTripIssues,
  travelerTotal,
  uid
} from "./domain.js";
import { createGenericDestinationProfile, getDestinationProfile, registerGeneratedDestinationProfile, resolveDestinationProfile } from "./destination-data.js";
import { buildDestinationIntelligence, classifyPlaceForPlanning } from "./destination-intelligence.js";
import {
  buildDestinationOpportunityGraph,
  buildDynamicResearchPlan,
  buildPlannerObservabilitySummary,
  buildPlanningStageTrace,
  calculateTemplateSimilarityScore,
  critiquePlanDeterministically,
  evaluateDestinationOpportunityCoverage,
  isDisclosedStarterFallbackPlan,
  summarizeOpportunityGraph
} from "./planning-quality.js";

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
  // 6:30 PM sits exactly at the dinner window's floor below -- kept at its
  // original value since the window's earliest bound moved to match it.
  dinner: "6:30 PM"
};

// Traveler-facing meal time windows -- a real anchor time should land
// inside these, with room to spare (a meal shouldn't consume the entire
// window). Enforced two ways: mealDefaults above anchors each meal at or
// inside its window for an ordinary day, and buildAdvisories flags any day
// whose ACTUAL scheduled time falls outside one (see
// dayMealWindowAdvisories) -- deliberately a warning, not an automatic
// trim, so the traveler decides whether to cut an earlier stop or push the
// meal later themselves.
const MEAL_TIME_WINDOWS = {
  breakfast: { earliest: 7 * 60 + 30, latest: 9 * 60, label: "7:30-9:00 AM" },
  lunch: { earliest: 11 * 60 + 30, latest: 13 * 60, label: "11:30 AM-1:00 PM" },
  // Key matches the "coffee-break" item type string used below (not
  // camelCase) so titleCase(item.type) displays "Coffee Break" correctly --
  // titleCase only inserts a space at existing hyphens/underscores, and
  // camelCase has no word boundary for its regex to find.
  "coffee-break": { earliest: 16 * 60, latest: 16 * 60 + 30, label: "4:00-4:30 PM" },
  dinner: { earliest: 18 * 60 + 30, latest: 21 * 60 + 30, label: "6:30-9:30 PM" }
};

const RAW_PLACE_LABEL_PATTERN = /^(access\s*\d*|entrance\s*\d*|parking\s*\d*|trailhead\s*\d*|gate\s*\d*|pier access|beach access|map point|unnamed road)$/i;
const INTERNAL_PUBLIC_LANGUAGE_PATTERN = /(google places|openrouteservice point-of-interest candidate|provider-found|provider-retrieved|culture-area|central-area|food-area|nature-area|parks and viewpoints|culture and landmarks|central area|core area|museums and historic sights|parks and outdoor stops|dining and evening area|stop to consider|breakfast option|lunch option|dinner option|no items in this tier|skipped a late evening activity)/i;

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
    fromLocation: structuredClone(trip.fromLocation || null),
    destinationLocation: structuredClone(trip.destinationLocation || null),
    arrivalRouteEstimate: structuredClone(trip.arrivalRouteEstimate || trip.routeEstimate || null),
    routeQualityRequired: Boolean(trip.routeQualityRequired),
    preferences: structuredClone(trip.preferences || []),
    travelersDetail: structuredClone(trip.travelers || []),
    specialNeeds: structuredClone(trip.specialNeeds || []),
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
  const destinationProfile = (options.destinationProfileId && getDestinationProfile(options.destinationProfileId)) || resolveDestinationProfile(normalized.destination);
  if (!destinationProfile) return { status: "invalid", errors: [{ severity: "blocking", issue: "Destination is required before generating a plan.", action: "Edit Trip Basics" }], normalized };

  const constraints = buildTravelerConstraintProfile(normalized);
  const destinationIntelligence = buildDestinationIntelligence(destinationProfile, normalized, constraints);
  const dynamicResearchPlan = buildDynamicResearchPlan(destinationProfile, normalized, destinationIntelligence);
  const opportunityGraph = buildDestinationOpportunityGraph(destinationProfile, normalized, destinationIntelligence, dynamicResearchPlan.destinationProfile);
  const opportunityCoverageValidation = evaluateDestinationOpportunityCoverage(opportunityGraph, dynamicResearchPlan.destinationProfile);
  const scored = scoreCandidates(destinationProfile, normalized, constraints, destinationIntelligence);
  const tripShapeOptions = buildTripShapeOptions(destinationProfile, normalized, destinationIntelligence);
  const rawDays = buildDays(destinationProfile, normalized, constraints, scored, destinationIntelligence);
  const hotelBase = buildHotelBase(destinationProfile, normalized, rawDays);
  const days = buildDetailedTripDays(destinationProfile, normalized, constraints, rawDays, hotelBase);
  applyGeographicState(destinationProfile, normalized, days);
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
      destinationProfile: dynamicResearchPlan.destinationProfile,
      usesGenericDestinationProfile: destinationProfile.id.startsWith("generic-"),
      approvedTripShape: normalized.approvedTripShape,
      routeApprovalRequired: Boolean(normalized.routePreferences?.tripStructure && normalized.routePreferences.tripStructure !== "one-city"),
      hotelBase,
      variationSeed: normalized.variationSeed,
      scoringWeights: planningWeights,
      planningStages: buildPlanningStageTrace(),
      dynamicResearchPlan,
      destinationIntelligence: summarizeDestinationIntelligence(destinationIntelligence),
      sourceDiagnostics: options.sourceDiagnostics || {
        planningMode: destinationProfile.sourceMetadata?.provider === "mock" ? "mock" : "live",
        destinationResearchSource: destinationProfile.sourceMetadata?.provider || "unknown",
        routeSource: "planner-estimate",
        itinerarySource: "generated",
        usedPresetPlan: false,
        usedMockProvider: destinationProfile.sourceMetadata?.provider === "mock",
        usedTestFixture: destinationProfile.sourceMetadata?.provider === "mock"
      },
      destinationArchetype: destinationIntelligence.destinationArchetype,
      opportunityGraph: summarizeOpportunityGraph(opportunityGraph),
      opportunityCoverageValidation,
      tripShapeOptions,
      unsupportedPreferences: normalized.unknownPreferences
    }
  };
  const initialCritique = critiquePlanDeterministically(plan, opportunityGraph);
  const templateSimilarity = calculateTemplateSimilarityScore(plan);
  const repairLoop = attemptBoundedRepair(plan, {
    profile: destinationProfile,
    input: normalized,
    constraints,
    opportunityGraph,
    hotelBase,
    budgetSummary,
    tripShapeOptions
  }, initialCritique);
  const qualityCritique = repairLoop.finalCritique;
  plan.generationMetadata.qualityCritique = qualityCritique;
  plan.generationMetadata.templateSimilarity = templateSimilarity;
  plan.generationMetadata.repairLoop = repairLoop;
  plan.generationMetadata.observability = buildPlannerObservabilitySummary({
    researchPlan: dynamicResearchPlan,
    graph: opportunityGraph,
    coverageValidation: opportunityCoverageValidation,
    critique: qualityCritique,
    templateSimilarity
  });
  const validation = validateTripPlan(plan);
  const rejected = validation.blocking.length > 0 || !qualityCritique.pass;
  if (rejected) {
    plan.status = "needs-review";
    plan.advisories.push(...validation.blocking);
    const criticAdvisory = !qualityCritique.pass && !validation.blocking.some((item) => item.id.startsWith("quality-critic-"))
      ? [advisory("quality-critic-score", "blocking", "quality", "Quality critic score below threshold", `The independent planner critic scored this itinerary ${qualityCritique.score}/100 against a required threshold of ${qualityCritique.threshold}.`, "Regenerate with stronger candidate research; this plan was not shown to the traveler.")]
      : [];
    return { status: "quality-rejected", plan, errors: [...validation.blocking, ...criticAdvisory] };
  }
  return { status: "ready", plan };
}

function attemptBoundedRepair(plan, context, initialCritique) {
  const { profile, input, constraints, opportunityGraph, hotelBase, budgetSummary, tripShapeOptions } = context;
  const MAX_ATTEMPTS = 2;
  const MECHANICALLY_REPAIRABLE = new Set(["universal-restaurant-dominance", "meal-repetition", "duplicated-daytime-evening"]);
  if (initialCritique.pass) {
    return { attempted: false, attempts: 0, repaired: false, finalCritique: initialCritique, blockedBy: [], reason: "Plan passed deterministic quality gate on first generation." };
  }
  const isMechanicallyRepairable = (critique) => critique.hardFailures.length > 0 && critique.hardFailures.every((failure) => MECHANICALLY_REPAIRABLE.has(failure));
  if (!isMechanicallyRepairable(initialCritique)) {
    return { attempted: false, attempts: 0, repaired: false, finalCritique: initialCritique, blockedBy: initialCritique.hardFailures, reason: "Hard failures require stronger destination research or candidate data; mechanical repair was not attempted." };
  }
  let critique = initialCritique;
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS && !critique.pass && isMechanicallyRepairable(critique)) {
    attempts += 1;
    if (critique.hardFailures.includes("universal-restaurant-dominance") || critique.hardFailures.includes("meal-repetition")) {
      repairMealDomination(plan, profile, input, constraints);
    }
    if (critique.hardFailures.includes("duplicated-daytime-evening")) {
      repairDuplicateEveningItems(plan, profile, input, constraints);
    }
    plan.foodPlan = buildFoodPlan(profile, input, constraints, plan.days);
    plan.routeSummary = buildRouteSummary(profile, plan.days);
    plan.tripGuide = buildDetailedTripGuide(profile, input, constraints, plan.days, hotelBase, plan.routeSummary, budgetSummary, tripShapeOptions);
    plan.overview = buildOverview(profile, input, plan.days, budgetSummary, plan.routeSummary);
    critique = critiquePlanDeterministically(plan, opportunityGraph);
  }
  return {
    attempted: true,
    attempts,
    repaired: critique.pass,
    finalCritique: critique,
    blockedBy: critique.pass ? [] : critique.hardFailures,
    reason: critique.pass ? `Mechanically repaired meal or evening repetition within ${attempts} attempt(s).` : "Repair attempts exhausted without meeting the quality threshold; this plan will be rejected rather than shown."
  };
}

function repairMealDomination(plan, profile, input, constraints) {
  const mealUsage = new Map();
  plan.days.forEach((day) => {
    day.scheduleItems = day.scheduleItems.map((item) => {
      if (!["breakfast", "lunch", "dinner"].includes(item.type) || item.locked) {
        if (item.mealDetails?.primaryPlaceId) mealUsage.set(item.mealDetails.primaryPlaceId, (mealUsage.get(item.mealDetails.primaryPlaceId) || 0) + 1);
        return item;
      }
      const regionId = item.regionId || item.neighborhood || profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id;
      const meal = mealRecommendation(profile, input, regionId, item.type, mealUsage);
      if (meal.primaryPlaceId) mealUsage.set(meal.primaryPlaceId, (mealUsage.get(meal.primaryPlaceId) || 0) + 1);
      return {
        ...item,
        title: meal.primary,
        description: meal.text,
        estimatedCostPerPerson: mealCost(input, item.type),
        mealDetails: { ...(item.mealDetails || {}), restaurantName: meal.primary, primaryOption: meal.primary, primaryPlaceId: meal.primaryPlaceId, secondaryOption: meal.secondary, secondaryPlaceId: meal.secondaryPlaceId, cuisine: meal.cuisine, priceRange: meal.price, reservationGuidance: meal.reservation },
        dietaryNotes: constraints.dietarySummary
      };
    });
  });
}

function repairDuplicateEveningItems(plan, profile, input, constraints) {
  plan.days.forEach((day, index) => {
    const activityIds = new Set(day.scheduleItems.filter((item) => item.type === "activity" && item.placeId).map((item) => item.placeId));
    day.scheduleItems = day.scheduleItems.map((item) => {
      if (item.type !== "evening" || !item.placeId || !activityIds.has(item.placeId) || item.locked) return item;
      const start = item.startTimeMinutes ?? 19 * 60;
      const replacement = eveningItem(profile, input, constraints, item.regionId || day.scheduleItems[0]?.regionId, start, index, activityIds, new Map());
      return { ...replacement, id: item.id, startTimeMinutes: item.startTimeMinutes, endTimeMinutes: item.startTimeMinutes + replacement.durationMinutes };
    });
  });
}

// The traveler can approve a multi-city Trip Shape on the Review step
// (e.g. Phoenix -> Grand Canyon -> Sedona with 2 hotel changes) before the
// itinerary is generated. That approval must actually change which bases
// the plan sleeps in and which regions each day draws activities from --
// not just get echoed back as unused metadata. This resolves the approved
// hotelBases sequence into real region ids and a day-by-day allocation so
// buildHotelBase, buildDays, and the Route tab can all follow it.
function resolveApprovedTripShapeSchedule(profile, input) {
  const shape = input.approvedTripShape;
  const bases = Array.isArray(shape?.hotelBases) ? shape.hotelBases : [];
  if (!shape || bases.length < 2) return null;
  // The first approved base is the primary destination itself (e.g. "Phoenix,
  // Arizona, United States"), but no researched region is ever literally named
  // after the whole city -- regions are neighborhoods/districts. Anchor base 0
  // on the profile's own default hotel region instead of name-matching it; only
  // the approved secondary cities (each merged in as their own dedicated
  // regional-ext- region) need to be resolved by name.
  const primaryRegion = profile.regions.find((region) => region.id === profile.planningRules?.defaultHotelRegion) || profile.regions[0];
  const resolvedBases = bases.map((base, index) => {
    if (index === 0) {
      return primaryRegion ? { name: primaryRegion.name, regionId: primaryRegion.id, nights: Math.max(0, Number(base.nights || 0)) } : null;
    }
    const name = normalizeText(base?.canonicalName || base?.shortName || "");
    if (!name) return null;
    // Google's canonicalized region name can bear zero textual resemblance
    // to what was actually approved -- confirmed live: an approved "Lake
    // Norman, North Carolina" base resolved to "Cornelius, North Carolina"
    // (a real town on the lake, but no substring relationship at all). That
    // silently failed every fuzzy check below, which failed the whole
    // multi-city schedule closed and fell back to generic single-city
    // rotation -- which is what actually caused a "signature attraction
    // coverage" quality-gate rejection, not thin candidate data. Regions
    // merged from an approved regional extension carry the exact string
    // that was requested (requestedName) specifically to make this an exact
    // match instead of a guess.
    const exactRequestedMatch = profile.regions.find((candidate) => candidate.requestedName && normalizeText(candidate.requestedName) === name);
    // A researched region's name is often Google's fully canonicalized form
    // (e.g. "Grand Canyon National Park, Arizona, United States"), which can
    // drop or add words relative to what the traveler approved (e.g. "Grand
    // Canyon National Park South Rim") -- a plain substring check in either
    // direction fails for real place names like this. Also compare against
    // just the part before the first comma (the actual place name, without
    // the trailing state/country), which is far more likely to line up.
    const region = exactRequestedMatch || profile.regions.find((candidate) => {
      const candidateName = normalizeText(candidate.name);
      const candidateCore = normalizeText(String(candidate.name || "").split(",")[0]);
      return candidateName === name || candidateName.includes(name) || name.includes(candidateName)
        || (candidateCore && (candidateCore === name || name.includes(candidateCore) || candidateCore.includes(name)));
    });
    if (!region) return null;
    return { name: region.name, regionId: region.id, nights: Math.max(0, Number(base.nights || 0)) };
  });
  // If any approved base can't be matched to real researched region data
  // (or two approved bases collapse onto the same region), a multi-city
  // itinerary cannot actually be built -- fail closed to the normal
  // single-base path rather than silently dropping a city.
  if (resolvedBases.some((entry) => !entry)) return null;
  if (new Set(resolvedBases.map((entry) => entry.regionId)).size < resolvedBases.length) return null;

  const numberOfDays = Math.max(1, Number(input.numberOfDays || 1));
  const daysForBase = resolvedBases.map((entry) => Math.max(1, entry.nights || 1));
  let diff = numberOfDays - daysForBase.reduce((sum, value) => sum + value, 0);
  if (diff > 0) {
    daysForBase[daysForBase.length - 1] += diff;
  } else {
    let guard = 0;
    while (diff < 0 && guard < numberOfDays * 4) {
      const target = daysForBase.indexOf(Math.max(...daysForBase));
      if (daysForBase[target] > 1) {
        daysForBase[target] -= 1;
        diff += 1;
      } else {
        break;
      }
      guard += 1;
    }
  }

  const dayRegionIds = [];
  const dayBaseIndex = [];
  const transferDayIndexes = new Set();
  resolvedBases.forEach((entry, baseIndex) => {
    for (let i = 0; i < daysForBase[baseIndex] && dayRegionIds.length < numberOfDays; i += 1) {
      if (i === 0 && baseIndex > 0) transferDayIndexes.add(dayRegionIds.length);
      dayRegionIds.push(entry.regionId);
      dayBaseIndex.push(baseIndex);
    }
  });
  while (dayRegionIds.length < numberOfDays) {
    dayRegionIds.push(resolvedBases[resolvedBases.length - 1].regionId);
    dayBaseIndex.push(resolvedBases.length - 1);
  }

  return { bases: resolvedBases, dayRegionIds, dayBaseIndex, transferDayIndexes, hotelChanges: resolvedBases.length - 1 };
}

function buildHotelBase(profile, input, days) {
  const schedule = resolveApprovedTripShapeSchedule(profile, input);
  if (schedule) {
    const sequenceNames = schedule.bases.map((base) => base.name);
    return {
      primary: schedule.bases[0].name,
      alternatives: schedule.bases.slice(1).map((base) => base.name),
      sequence: schedule.bases,
      hotelChanges: schedule.hotelChanges,
      forDay: (dayIndex) => schedule.bases[schedule.dayBaseIndex[Math.min(Math.max(0, dayIndex), schedule.dayBaseIndex.length - 1)]]?.name || schedule.bases[0].name,
      reason: `Follows the route you approved: ${sequenceNames.join(" → ")}, with ${schedule.hotelChanges} hotel change${schedule.hotelChanges === 1 ? "" : "s"}.`,
      tradeoffs: "This follows the trip shape you approved on the Review step. Confirm real lodging neighborhoods, transit access, parking, and travel times before booking.",
      splitStaySuggestion: `${schedule.hotelChanges} hotel change${schedule.hotelChanges === 1 ? "" : "s"} as approved on the Review step.`
    };
  }
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

function summarizeDestinationIntelligence(intelligence) {
  const candidate = (item) => ({
    name: item.place.name,
    categories: item.categories,
    score: item.score,
    firstTimeVisitorValue: item.classification?.firstTimeVisitorValue,
    destinationSignificanceScore: item.classification?.destinationSignificance?.score || 0,
    travelerFitScore: item.classification?.travelerFit?.score || 0,
    routeFit: item.routeFeasibility?.classification || "",
    currentStatusConfidence: item.classification?.currentStatusConfidence,
    ordinaryLocalFacilityPenalty: item.classification?.ordinaryLocalFacilityPenalty,
    accepted: item.accepted,
    reason: item.reason,
    routeTime: item.routeFeasibility
  });
  return {
    destinationIdentity: intelligence.destinationIdentity,
    regionalDestinationProfile: intelligence.regionalDestinationProfile,
    categoryCoverage: intelligence.categoryCoverage,
    experienceGaps: intelligence.experienceGaps,
    routeOptions: intelligence.routeOptions,
    researchConfidence: intelligence.researchConfidence,
    sourceFreshness: intelligence.sourceFreshness,
    destinationArchetype: intelligence.destinationArchetype,
    consideredCandidates: (intelligence.allCandidates || []).slice(0, 40).map(candidate),
    rejectedCandidates: (intelligence.allCandidates || []).filter((item) => !item.accepted).slice(0, 12).map(candidate)
  };
}

export function buildTravelerConstraintProfile(input) {
  // Special Needs (a group-level field) replaced the per-traveler
  // restrictions table as the primary source; travelersDetail's restrictions
  // are folded in too as defense-in-depth for any pre-migration trip data
  // that still carries them.
  const restrictionText = [...input.travelersDetail.flatMap((traveler) => traveler.restrictions || []), ...(input.specialNeeds || [])].join(" ").toLowerCase();
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
    const publicText = `${place.name} ${place.shortDescription || ""} ${(place.tags || []).join(" ")}`;
    if (isRawPlaceLabel(place.name) || INTERNAL_PUBLIC_LANGUAGE_PATTERN.test(publicText)) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected because the source returned a raw/internal label rather than a visitor-ready stop.");
    }
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
    const classification = intelligenceItem?.classification || classifyPlaceForPlanning(place, profile, input, intelligenceItem?.routeFeasibility);
    if (classification.isOrdinaryBusiness) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected because it appears to be an ordinary business, not a destination stop.");
    }
    if (classification.isStaleOrClosedAttraction) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected because current-status checks indicate the attraction, tour, or venue identity may be stale or discontinued.");
    }
    if (classification.firstTimeVisitorValue?.score) {
      score += classification.firstTimeVisitorValue.score * 2;
      reasons.push(`First-time visitor value: ${classification.firstTimeVisitorValue.band}.`);
    }
    if (classification.ordinaryLocalFacilityPenalty?.score) {
      // A score >= 50 is exactly what the post-generation quality gate
      // (hasOrdinaryLocalFacilityPromotion) treats as unacceptable -- a soft
      // penalty alone still let these through as filler when nearby
      // alternatives were scarce, and the plan would fail the gate with no
      // way for a same-candidate-pool retry to avoid it. Excluding it here,
      // at the same threshold the gate uses, keeps a bad candidate from
      // being selected in the first place.
      if (classification.ordinaryLocalFacilityPenalty.score >= 50) {
        score += planningWeights.hardExclusion;
        reasons.push(classification.ordinaryLocalFacilityPenalty.reasons?.[0] || "Rejected because it looks like an ordinary local facility.");
      } else {
        score -= classification.ordinaryLocalFacilityPenalty.score * 2;
        reasons.push(classification.ordinaryLocalFacilityPenalty.reasons?.[0] || "Reduced because it looks like an ordinary local facility.");
      }
    }
    if (childFreeAdultTrip(input) && classification.isChildrenFocused) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected because children-focused stops do not fit a child-free adult trip unless explicitly requested.");
    } else if (classification.isSportsVenue && !hasStatedInterest(input, "Sports") && !explicitlyRequestedPlace(input, place)) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected because a sports venue does not fit without a stated sports/event interest or an explicit request.");
    } else if (classification.travelerFit?.score) {
      score += classification.travelerFit.score;
      if (classification.travelerFit.score < 0) reasons.push(classification.travelerFit.reasons?.[0] || "Reduced for traveler fit.");
    }
    if (seasonalMismatchPenalty(place, input)) {
      score -= seasonalMismatchPenalty(place, input);
      reasons.push("Reduced because seasonal value may be weak for the trip dates.");
    }
    if (intelligenceItem?.routeFeasibility?.classification === "overnight-recommended") {
      score -= input.numberOfDays >= 5 ? 18 : 65;
      reasons.push("Better as an optional regional extension than a casual in-city stop.");
    }
    if (intelligenceItem?.routeFeasibility?.classification === "not-practical") score += planningWeights.hardExclusion;
    const archetypeScore = archetypeScoreAdjustment(destinationIntelligenceArchetype(intelligence), classification, placeText, input);
    if (archetypeScore) {
      score += archetypeScore.score;
      reasons.push(archetypeScore.reason);
    }
    return { place, score, reasons, intelligence: intelligenceItem };
  }).sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
}

function destinationIntelligenceArchetype(intelligence) {
  return intelligence?.destinationArchetype || { primaryArchetype: "mixed urban/nature", secondaryArchetypes: [] };
}

function archetypeScoreAdjustment(archetype, classification, placeText, input) {
  if (archetype?.primaryArchetype === "mountain" || archetype?.primaryArchetype === "national park") {
    if (isGenericParkContainerText(placeText)) return { score: -180, reason: "Reduced because park days need specific roads, trails, overlooks, visitor areas, or waterfalls." };
    if (/newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|scenic corridor|motor nature trail|loop road/.test(placeText)) {
      return { score: 115, reason: "Boosted because this is a destination-defining scenic corridor or high-value park route." };
    }
    if (/grotto falls|laurel falls|rainbow falls|abrams falls|cataract falls|waterfall|trailhead|trail\b|hike\b|overlook/.test(placeText)) {
      return { score: 84, reason: "Boosted because mountain trips need real trail, waterfall, and overlook candidates." };
    }
    if (/the island in pigeon forge|dollywood|anakeesta|skypark|ober gatlinburg|downtown gatlinburg|old mill|show|live music|entertainment district/.test(placeText)) {
      return { score: 58, reason: "Boosted because gateway mountain regions need a town or evening entertainment block." };
    }
    if (/knife store|knife works|motorcycle museum|crime museum|haunted house|wax museum|mirror maze|ordinary shop|souvenir/.test(placeText)) {
      return { score: -130, reason: "Reduced because novelty retail or narrow special-interest attractions should not anchor a mountain vacation." };
    }
    if (classification.isRestaurant && /breakfast|brunch|cafe|bakery|lunch|dinner|local/.test(placeText)) return { score: 20, reason: "Boosted for route-compatible local food support." };
    return null;
  }
  if (archetype?.primaryArchetype !== "beach/coastal") return null;
  const userRejectsBeach = /avoid beach|no beach|skip beach|not beach/.test(normalizeText(`${input.mustHavePlaces?.join(" ")} ${input.avoidPlaces?.join(" ")}`));
  if (!userRejectsBeach && (classification.isBeachOrWaterfront || classification.isBoardwalk || classification.isWaterActivity || /oceanfront|marshwalk|skywheel|barefoot landing|broadway at the beach|brookgreen|huntington beach/.test(placeText))) {
    return { score: 95, reason: "Boosted because this is a destination-defining beach/coastal or waterfront experience." };
  }
  if (classification.isEveningAnchor) return { score: 54, reason: "Boosted because the destination has strong evening and waterfront entertainment value." };
  if (classification.isRestaurant && /seafood|waterfront|oceanfront|breakfast|brunch|cafe|bakery/.test(placeText)) return { score: 24, reason: "Boosted for coastal food identity and route-compatible dining." };
  if (classification.isMuseum && !/brookgreen|atalaya|coastal|local art/.test(placeText)) return { score: -34, reason: "Reduced because beach/coastal trips should not be dominated by generic indoor museum stops." };
  if (classification.isEntertainmentCenter && !/broadway at the beach|barefoot landing|skywheel/.test(placeText)) return { score: -58, reason: "Reduced because novelty entertainment is not a primary beach/coastal anchor." };
  return null;
}

function improveArchetypeSelection(profile, input, intelligence, dayIndex, themeRegions, selected, candidates, scheduled) {
  const archetype = intelligence?.destinationArchetype;
  if (archetype?.primaryArchetype === "mountain" || archetype?.primaryArchetype === "national park") {
    return improveMountainRegionalSelection(profile, input, intelligence, dayIndex, selected, candidates, scheduled);
  }
  if (isUrbanDestinationProfile(profile)) {
    return improveUrbanDestinationSelection(profile, input, dayIndex, selected, candidates, scheduled);
  }
  if (archetype?.primaryArchetype !== "beach/coastal") {
    return improveMixedDestinationSelection(profile, input, intelligence, dayIndex, selected, candidates, scheduled);
  }
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const selectedFlags = selected.map((item) => item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility));
  const hasBeach = selectedFlags.some((flag) => flag.isBeachOrWaterfront || flag.isBoardwalk);
  const hasNature = selected.some((item) => isCoastalNaturePlace(item.place, selectedFlags[selected.indexOf(item)]));
  const hasEvening = selectedFlags.some((flag) => flag.isEveningAnchor);
  const pick = (predicate) => candidates.find((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id) && predicate(item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility), item.place));
  const replacements = [...selected];
  const replaceLowest = (candidate) => {
    if (!candidate) return;
    const replaceIndex = replacements.findIndex((item) => {
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      return flag.isMuseum || flag.isEntertainmentCenter || !(flag.isBeachOrWaterfront || flag.isEveningAnchor || flag.isWaterActivity);
    });
    if (replaceIndex >= 0) replacements[replaceIndex] = candidate;
    else if (replacements.length < input.maxActivities) replacements.push(candidate);
    selectedIds.add(candidate.place.id);
  };
  if (!hasBeach && (dayIndex === 0 || dayIndex === 1)) replaceLowest(pick((flag) => flag.isBeachOrWaterfront || flag.isBoardwalk));
  if (!hasNature && dayIndex === 1) replaceLowest(pick((flag, place) => isCoastalNaturePlace(place, flag)));
  if (!hasEvening && dayIndex < input.numberOfDays - 1) replaceLowest(pick((flag) => flag.isEveningAnchor));
  return ensureMissingProtectedSignature(profile, input, replacements, candidates, scheduled, selectedIds).slice(0, input.maxActivities);
}

function improveUrbanDestinationSelection(profile, input, dayIndex, selected, candidates, scheduled) {
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const scheduledText = normalizeText(candidates.filter((item) => scheduled.has(item.place.id)).map((item) => `${item.place.name} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`).join(" "));
  const selectedHasRegionalExcursion = selected.some((item) => isRegionalExcursionPlace(item.place));
  if (selectedHasRegionalExcursion) {
    if (dayIndex < Math.max(2, input.numberOfDays - 2)) {
      const local = candidates
        .filter((item) => !scheduled.has(item.place.id) && !isRegionalExcursionPlace(item.place))
        .filter((item) => {
          const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
          return /\b(signature|must see|landmark|monument|memorial|national mall|capitol|library|museum|gallery|neighborhood|waterfront)\b/.test(text);
        })
        .slice(0, input.maxActivities);
      if (local.length) return local;
    }
    const regional = selected
      .filter((item) => isRegionalExcursionPlace(item.place))
      .sort((a, b) => Number(b.place.priorityScore || 0) - Number(a.place.priorityScore || 0))[0];
    const sameRegion = candidates
      .filter((item) => !scheduled.has(item.place.id) && item.place.regionId === regional.place.regionId && item.place.id !== regional.place.id)
      .filter((item) => !isRegionalExcursionPlace(item.place) || Number(item.place.typicalDurationMinutes || 0) <= 150)
      .slice(0, Math.max(0, input.maxActivities - 1));
    return [regional, ...sameRegion].slice(0, input.maxActivities);
  }
  const replacements = [...selected];
  const selectedText = normalizeText(selected.map((item) => `${item.place.name} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`).join(" "));
  const pick = (pattern) => candidates.find((item) => {
    if (scheduled.has(item.place.id) || selectedIds.has(item.place.id) || isRegionalExcursionPlace(item.place)) return false;
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    // Unlike every other coverage-guarantee "pick" helper in this file, this
    // one had no restaurant/food/bar exclusion at all -- a restaurant whose
    // own AI-generated name or description naturally mentions its
    // neighborhood (e.g. "La Mar by Gastón Acurio (Downtown / Bayside)")
    // matches these coverage patterns (waterfront, district, landmark) just
    // as easily as a real attraction. Confirmed live: two restaurants got
    // scheduled as standalone sightseeing "activities" (in addition to
    // their own separate meal slots), and one even became the day's title.
    if (flag.isRestaurant || flag.isFoodHall || flag.isBar || flag.isOrdinaryBusiness) return false;
    const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
    return pattern.test(text);
  });
  const replaceLowest = (candidate) => {
    if (!candidate) return;
    const replaceIndex = replacements.findIndex((item) => {
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      return flag.isMuseum || !/signature|landmark|monument|memorial|capitol|neighborhood|waterfront|market/i.test(`${item.place.categories?.join(" ")} ${item.place.tags?.join(" ")}`);
    });
    if (replaceIndex >= 0) replacements[replaceIndex] = candidate;
    else if (replacements.length < input.maxActivities) replacements.push(candidate);
    selectedIds.add(candidate.place.id);
  };
  const forceInclude = (candidate) => {
    if (!candidate) return;
    const replaceIndex = replacements.findIndex((item) => {
      const text = normalizeText(`${item.place.name} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
      return !/\b(monument|memorial|national mall|capitol|library)\b/.test(text);
    });
    if (replaceIndex >= 0) replacements[replaceIndex] = candidate;
    else if (replacements.length < input.maxActivities) replacements.push(candidate);
    else replacements[0] = candidate;
    selectedIds.add(candidate.place.id);
  };
  const hasProtectedSignature = [...candidates.filter((item) => scheduled.has(item.place.id)), ...replacements]
    .some((item) => protectedSignatureRank(item.place) >= 4);
  if (dayIndex > 0 && !hasProtectedSignature) {
    forceInclude(bestProtectedSignatureCandidate(candidates, selectedIds, scheduled));
  }
  if (dayIndex > 0 && !/\b(monument|memorial|national mall)\b/.test(`${selectedText} ${scheduledText}`)) forceInclude(pick(/\b(monument|memorial|national mall)\b/));
  if (dayIndex > 0 && !/\b(monument|memorial|national mall|signature|landmark)\b/.test(selectedText)) replaceLowest(pick(/\b(monument|memorial|national mall|signature|landmark)\b/));
  if (dayIndex > 0 && dayIndex < input.numberOfDays - 1 && !/\b(national gallery|art gallery|smithsonian|museum)\b/.test(selectedText)) replaceLowest(pick(/\b(national gallery|art gallery|smithsonian|museum)\b/));
  if (!/\b(neighborhood|waterfront|market|district|promenade)\b/.test(selectedText) && dayIndex < input.numberOfDays - 1) replaceLowest(pick(/\b(neighborhood|waterfront|market|district|promenade)\b/));
  const explicitMuseumIntent = hasExplicitMuseumIntent(input);
  const scheduledMuseumCount = candidates
    .filter((item) => scheduled.has(item.place.id))
    .filter((item) => {
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      return flag.isMuseum;
    }).length;
  let museumCount = replacements.filter((item) => {
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return flag.isMuseum;
  }).length;
  if (!explicitMuseumIntent && (scheduledMuseumCount >= 1 && museumCount > 0 || museumCount > 1)) {
    replacements.forEach((item, index) => {
      if (museumCount <= (scheduledMuseumCount >= 1 ? 0 : 1)) return;
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      if (!flag.isMuseum) return;
      const replacement = candidates.find((candidate) => {
        if (scheduled.has(candidate.place.id) || selectedIds.has(candidate.place.id) || isRegionalExcursionPlace(candidate.place)) return false;
        const candidateFlag = candidate.intelligence?.classification || classifyPlaceForPlanning(candidate.place, profile, input, candidate.intelligence?.routeFeasibility);
        return !candidateFlag.isMuseum && !candidateFlag.isRestaurant && !candidateFlag.isFoodHall && !candidateFlag.isBar && !candidateFlag.isOrdinaryBusiness;
      });
      if (replacement) {
        replacements[index] = replacement;
        selectedIds.add(replacement.place.id);
        museumCount -= 1;
      }
    });
  }
  return ensureMissingProtectedSignature(profile, input, replacements, candidates, scheduled, selectedIds).slice(0, input.maxActivities);
}

function improveMountainRegionalSelection(profile, input, intelligence, dayIndex, selected, candidates, scheduled) {
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const scheduledItems = candidates.filter((item) => scheduled.has(item.place.id));
  const allSelected = [...selected, ...scheduledItems];
  const already = {
    scenic: allSelected.some((item) => isScenicMountainCorridor(item.place)),
    hike: allSelected.some((item) => isHikeOrWaterfall(item.place)),
    town: allSelected.some((item) => isGatewayTownOrDowntown(item.place)),
    entertainment: allSelected.some((item) => isMountainEntertainment(item.place))
  };
  const replacements = [...selected];
  const pick = (predicate) => candidates.find((item) => {
    if (scheduled.has(item.place.id) || selectedIds.has(item.place.id)) return false;
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    if (flag.isRestaurant || flag.isFoodHall || flag.isBar || flag.isOrdinaryBusiness || flag.isChildrenFocused) return false;
    return predicate(item.place, flag, item);
  });
  const replaceLowest = (candidate) => {
    if (!candidate) return false;
    const replaceIndex = replacements.findIndex((item) => {
      const text = normalizeText(`${item.place.name} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
      return /museum|shop|retail|generic|area$|novelty|children|family entertainment/.test(text)
        || (!isScenicMountainCorridor(item.place) && !isHikeOrWaterfall(item.place) && !isGatewayTownOrDowntown(item.place) && !isMountainEntertainment(item.place));
    });
    if (replaceIndex >= 0) replacements[replaceIndex] = candidate;
    else if (replacements.length < input.maxActivities) replacements.push(candidate);
    else return false;
    selectedIds.add(candidate.place.id);
    return true;
  };
  const sightseeingDay = dayIndex > 0 && dayIndex < input.numberOfDays - 1;
  if (sightseeingDay && !already.scenic && (dayIndex === 1 || input.numberOfDays >= 4)) {
    const scenic = pick((place) => isScenicMountainCorridor(place));
    replaceLowest(scenic);
  }
  if (sightseeingDay && !already.hike && dayIndex >= 1) replaceLowest(pick((place) => isHikeOrWaterfall(place) && Number(place.typicalDurationMinutes || 0) <= 260));
  if (sightseeingDay && !already.entertainment && dayIndex >= 2) replaceLowest(pick((place) => isMountainEntertainment(place)));
  if (!already.town && dayIndex === 0) replaceLowest(pick((place) => isGatewayTownOrDowntown(place)));
  return replacements.slice(0, input.maxActivities);
}

function improveMixedDestinationSelection(profile, input, intelligence, dayIndex, selected, candidates, scheduled) {
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const selectedFlags = selected.map((item) => item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility));
  const scheduledItems = candidates.filter((item) => scheduled.has(item.place.id));
  const scheduledFlags = scheduledItems.map((item) => item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility));
  const selectedOrScheduled = [...selectedFlags, ...scheduledFlags];
  const explicitMuseumIntent = hasExplicitMuseumIntent(input);
  const scheduledMuseumCount = scheduledFlags.filter((flag) => flag.isMuseum).length;
  const hasOutdoor = selectedOrScheduled.some((flag) => flag.isPark || flag.isMountainOrTrail || flag.isWaterActivity || flag.isBeachOrWaterfront);
  const hasNearbyAnchor = selectedOrScheduled.some((flag) => flag.isDayTrip || flag.isOvernightExtension || flag.isRegionalDestination);
  const hasNeighborhood = selectedOrScheduled.some((flag) => flag.isNeighborhood || flag.isEveningAnchor);
  const hasMemorableNonMuseum = selectedOrScheduled.some((flag) => !flag.isMuseum && !flag.isRestaurant && !flag.isFoodHall && !flag.isBar);
  const replacements = [...selected];
  const selectedOrScheduledItems = [...selected, ...scheduledItems];
  const hasProtectedSignature = selectedOrScheduledItems.some((item) => protectedSignatureRank(item.place) >= 4);
  const pick = (predicate) => candidates.find((item) => {
    if (scheduled.has(item.place.id) || selectedIds.has(item.place.id)) return false;
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return predicate(flag, item.place, item);
  });
  if (!hasProtectedSignature && dayIndex > 0 && dayIndex < input.numberOfDays - 1) {
    const signature = bestProtectedSignatureCandidate(candidates, selectedIds, scheduled);
    if (signature) {
      const replaceIndex = replacements.findIndex((item) => {
        const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
        return flag.isMuseum || flag.isCity || flag.isNeighborhood || Number(item.place.priorityScore || 0) < Number(signature.place.priorityScore || 0);
      });
      if (replaceIndex >= 0) replacements[replaceIndex] = signature;
      else if (replacements.length < input.maxActivities) replacements.push(signature);
      selectedIds.add(signature.place.id);
    }
  }
  const signatureFullDay = candidates
    .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id))
    .find((item) => Number(item.place.priorityScore || 0) >= 94 && Number(item.place.typicalDurationMinutes || 0) >= 300 && routeRank(item.intelligence?.routeFeasibility?.classification) <= 1);
  if (signatureFullDay && dayIndex > 0 && dayIndex < input.numberOfDays - 1) return [signatureFullDay];
  if (dayIndex <= 1) {
    const topUnscheduledSignature = candidates
      .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id))
      .map((item) => ({
        item,
        flag: item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility),
        routeRank: routeRank(item.intelligence?.routeFeasibility?.classification)
      }))
      .filter(({ flag, routeRank: rank }) => rank <= 1 && Number(flag.firstTimeVisitorValue?.score || 0) >= 88 && !flag.isRestaurant && !flag.isFoodHall && !flag.isBar && (explicitMuseumIntent || scheduledMuseumCount < 2 || !flag.isMuseum))
      .sort((a, b) => Number(b.flag.firstTimeVisitorValue?.score || 0) - Number(a.flag.firstTimeVisitorValue?.score || 0) || b.item.score - a.item.score)[0]?.item || null;
    if (topUnscheduledSignature && !replacements.some((item) => {
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      return Number(flag.firstTimeVisitorValue?.score || 0) >= 88;
    })) {
      const replaceIndex = replacements.findIndex((item) => {
        const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
        return Number(flag.firstTimeVisitorValue?.score || 0) < 88 || flag.isNeighborhood || flag.isPark;
      });
      if (replaceIndex >= 0) replacements[replaceIndex] = topUnscheduledSignature;
      else if (replacements.length < input.maxActivities) replacements.push(topUnscheduledSignature);
      selectedIds.add(topUnscheduledSignature.place.id);
    }
  }
  const closerSignatureAnchor = candidates
    .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id))
    .map((item) => ({
      item,
      flag: item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility),
      routeRank: routeRank(item.intelligence?.routeFeasibility?.classification)
    }))
    .filter(({ flag, item, routeRank: rank }) => rank <= 1 && (flag.isDayTrip || flag.isRegionalDestination) && Number(item.place.typicalDurationMinutes || 0) >= 180)
    .sort((a, b) => a.routeRank - b.routeRank || b.item.place.priorityScore - a.item.place.priorityScore || b.item.score - a.item.score)[0]?.item || null;
  if (closerSignatureAnchor) {
    const replaceIndex = replacements.findIndex((item) => {
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      const rank = routeRank(item.intelligence?.routeFeasibility?.classification);
      const closerRank = routeRank(closerSignatureAnchor.intelligence?.routeFeasibility?.classification);
      return (flag.isDayTrip || flag.isRegionalDestination)
        && (rank > closerRank || Number(item.place.priorityScore || 0) + 8 < Number(closerSignatureAnchor.place.priorityScore || 0));
    });
    if (replaceIndex >= 0) {
      replacements[replaceIndex] = closerSignatureAnchor;
      selectedIds.add(closerSignatureAnchor.place.id);
      if (closerSignatureAnchor.place.bestTimeOfDay === "full-day" || Number(closerSignatureAnchor.place.typicalDurationMinutes || 0) >= 210) return [closerSignatureAnchor];
    }
  }
  const replaceLowestMuseumOrGeneric = (candidate) => {
    if (!candidate) return false;
    const replaceIndex = replacements.findIndex((item) => {
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      return flag.isMuseum || flag.isCity || (!flag.isPark && !flag.isNeighborhood && !flag.isEveningAnchor && !flag.isWaterActivity && !flag.isEntertainmentCenter);
    });
    if (replaceIndex >= 0) replacements[replaceIndex] = candidate;
    else if (replacements.length < input.maxActivities) replacements.push(candidate);
    else return false;
    selectedIds.add(candidate.place.id);
    return true;
  };
  if (!hasOutdoor && dayIndex > 0) {
    replaceLowestMuseumOrGeneric(pick((flag) => flag.isPark || flag.isMountainOrTrail || flag.isWaterActivity || flag.isBeachOrWaterfront || flag.isDayTrip));
  }
  if (!hasNearbyAnchor && input.numberOfDays >= 4 && dayIndex >= 1 && dayIndex < input.numberOfDays - 1) {
    const regionalAnchor = candidates
      .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id))
      .map((item) => ({
        item,
        flag: item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility),
        roundTrip: Number(item.intelligence?.routeFeasibility?.estimatedRoundTripMinutes || 0),
        routeRank: routeRank(item.intelligence?.routeFeasibility?.classification)
      }))
      .filter(({ flag, roundTrip }) => (flag.isDayTrip || flag.isRegionalDestination) && (!roundTrip || roundTrip <= Math.max(input.maxDrivingMinutes, 180)))
      .sort((a, b) => a.routeRank - b.routeRank || b.item.place.priorityScore - a.item.place.priorityScore || b.item.score - a.item.score)[0]?.item || null;
    if (regionalAnchor) {
      const replaceIndex = replacements.findIndex((item) => {
        const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
        return flag.isMuseum || flag.isNeighborhood || flag.isCity;
      });
      if (replaceIndex >= 0) {
        replacements[replaceIndex] = regionalAnchor;
        selectedIds.add(regionalAnchor.place.id);
        if (regionalAnchor.place.bestTimeOfDay === "full-day" || Number(regionalAnchor.place.typicalDurationMinutes || 0) >= 210) {
          return [regionalAnchor];
        }
      } else {
        replaceLowestMuseumOrGeneric(regionalAnchor);
      }
    }
  }
  if (!hasNeighborhood && dayIndex < input.numberOfDays - 1) {
    replaceLowestMuseumOrGeneric(pick((flag) => flag.isNeighborhood || flag.isEveningAnchor));
  }
  if (!hasMemorableNonMuseum && !explicitMuseumIntent) {
    replaceLowestMuseumOrGeneric(pick((flag) => !flag.isMuseum && !flag.isRestaurant && !flag.isFoodHall && !flag.isBar && !flag.isOrdinaryBusiness));
  }
  let museumCount = replacements.filter((item) => {
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return flag.isMuseum;
  }).length;
  if (!explicitMuseumIntent && (museumCount > 1 || scheduledMuseumCount >= 2 && museumCount > 0)) {
    replacements.forEach((item, index) => {
      if (museumCount <= 1 && scheduledMuseumCount < 2) return;
      const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
      if (!flag.isMuseum) return;
      const replacement = pick((candidateFlag) => !candidateFlag.isMuseum && !candidateFlag.isRestaurant && !candidateFlag.isFoodHall && !candidateFlag.isBar);
      if (replacement) {
        replacements[index] = replacement;
        selectedIds.add(replacement.place.id);
        museumCount -= 1;
      }
    });
  }
  return ensureMissingProtectedSignature(profile, input, replacements, candidates, scheduled, selectedIds).slice(0, input.maxActivities);
}

function routeRank(value) {
  if (value === "local") return 0;
  if (value === "easy-day-trip") return 1;
  if (value === "long-day-trip") return 3;
  if (value === "overnight-recommended") return 5;
  return 2;
}

function hasExplicitMuseumIntent(input) {
  const text = normalizeText([
    input.preferences?.join(" "),
    input.mustHavePlaces?.join(" "),
    input.tripDescription,
    input.routePreferences?.notes,
    input.destination
  ].filter(Boolean).join(" "));
  return /\b(museum|museums|gallery|galleries|history|historic|art collection|architecture tour)\b/.test(text);
}

function isCoastalNaturePlace(place, classification = classifyPlaceForPlanning(place)) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return classification.isPark && /state park|garden|marsh|brookgreen|huntington|atalaya|wildlife|coastal nature/.test(text);
}

function isScenicMountainCorridor(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return /\b(scenic corridor|scenic drive|parkway|motor nature trail|loop road|gap road|newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|overlook)\b/.test(text);
}

function isHikeOrWaterfall(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return /\b(hike|trail|trailhead|waterfall|falls|cataract|grotto|laurel|rainbow|abrams|nature walk)\b/.test(text);
}

function isGatewayTownOrDowntown(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return /\b(gateway town|downtown|village|main street|old mill|town core|local shops|arts district|walkable district|orientation district|gatlinburg|pigeon forge|sevierville)\b/.test(text);
}

function isMountainEntertainment(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return /\b(the island in pigeon forge|dollywood|anakeesta|skypark|ober gatlinburg|mountain coaster|alpine coaster|show|live music|entertainment district|theme park|distillery)\b/.test(text)
    && !/\b(knife works|knife store|crime museum|haunted house|wax museum|mirror maze)\b/.test(text);
}

function isGenericParkContainer(place, profile = {}) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  const destinationName = normalizeText(profile.canonicalName || "");
  return isGenericParkContainerText(text)
    || (destinationName && normalizeText(place.name) === destinationName && /\bnational park|state park|destination\b/.test(text));
}

function isGenericParkContainerText(text) {
  return /^(great smoky mountains national park|national park|state park|parks and scenery|area parks|park area)$/.test(String(text || "").trim())
    || /\bgreat smoky mountains national park\b/.test(text) && !/\b(newfound gap|kuwohi|clingsmans|cades cove|roaring fork|little river|foothills|trail|falls|visitor center|overlook|road|loop)\b/.test(text);
}

export function buildDays(profile, input, constraints, scored, intelligence = null) {
  const scheduled = new Set();
  const mealUsage = new Map();
  const eveningUsage = new Map();
  const backupUsage = new Map();
  const themes = destinationDayThemes(profile, input, intelligence);
  const approvedSchedule = resolveApprovedTripShapeSchedule(profile, input);
  return Array.from({ length: input.numberOfDays }, (_, index) => {
    const date = addDays(input.startDate, index);
    // An approved multi-city route overrides the normal theme-region
    // rotation -- each day must draw its activities from whichever base
    // (primary destination or approved regional extension) the traveler is
    // actually sleeping in that night, not from clustered local themes.
    const themeRegions = approvedSchedule ? [approvedSchedule.dayRegionIds[index]] : themes[index % themes.length];
    // When a multi-city route is approved, every other approved base's region
    // is reserved for its own dedicated day(s) -- a thin day in Phoenix must
    // never "fill" itself with a Grand Canyon or Sedona candidate that belongs
    // to a later day just because Phoenix's own candidates ran short, and a
    // Grand Canyon/Sedona day must never fill with a Phoenix candidate.
    // A regional-extension base (Grand Canyon, Sedona, ...) is always exactly
    // one merged region (its "regional-ext-" id), but the primary destination
    // can legitimately span many real sub-regions (downtown, midtown,
    // Camelback, Roosevelt Row, ...) -- excluding only the single
    // approvedSchedule.bases regionId per base (as before) left every OTHER
    // primary-destination sub-region unguarded, so real Phoenix places kept
    // leaking into Grand Canyon/Sedona days. Belonging is now judged by
    // whether a region is itself a "regional-ext-" region, not by an exact id
    // match against a single stored region per base.
    const isRegionalExtensionRegionId = (regionId) => String(regionId || "").startsWith("regional-ext-");
    const todayIsExtensionDay = approvedSchedule ? isRegionalExtensionRegionId(themeRegions[0]) : false;
    const belongsToAnotherApprovedBase = approvedSchedule
      ? (regionId) => (todayIsExtensionDay ? !themeRegions.includes(regionId) : isRegionalExtensionRegionId(regionId))
      : () => false;
    // Multi-region day themes are picked by category signal (a signature
    // landmark, a museum, a neighborhood spot) without regard to how far
    // apart those regions actually are, and a compact borough like Manhattan
    // is small enough that most of it stays under keepNearbyThemeRegions'
    // 45-minute cap by transit -- confirmed live: 9/11 Memorial (Lower
    // Manhattan) and Times Square (Midtown), about 4.5 miles apart, both
    // stayed in-theme and got scheduled the same day. Use a tighter
    // geographic cap just for picking the day's OWN activities in a dense
    // urban core; themeRegions itself stays untouched below (backups, the
    // day's region label, and multi-city logic all still need the wider
    // set), so this only narrows what's preferred, never what's reachable as
    // a fallback.
    const activityThemeRegions = isUrbanDestinationProfile(profile)
      ? themeRegions.filter((regionId) => {
          if (regionId === themeRegions[0]) return true;
          const anchor = profile.regions.find((candidate) => candidate.id === themeRegions[0]);
          const region = profile.regions.find((candidate) => candidate.id === regionId);
          if (!anchor?.centerCoordinates || !region?.centerCoordinates) return true;
          return haversineMiles(anchor.centerCoordinates.lat, anchor.centerCoordinates.lng, region.centerCoordinates.lat, region.centerCoordinates.lng) <= 3;
        })
      : themeRegions;
    const themeCandidates = scored.filter((item) => activityThemeRegions.includes(item.place.regionId) && !scheduled.has(item.place.id) && item.score > -200 && isActivityCandidateForSchedule(item, profile, input));
    // When a day's theme region(s) run short, filler used to come from
    // whichever other region had the next-highest-scored candidate,
    // regardless of distance -- confirmed live: Central Park (a different,
    // non-adjacent NYC region) filled in behind Times Square purely on
    // score, spreading a single day across Midtown and Upper Manhattan.
    // Prefer the geographically nearest other region's candidates first, so
    // filler still respects the day's own geography when it has to reach
    // outside the theme at all.
    const themeAnchorRegionId = activityThemeRegions[0];
    const fillCandidates = scored
      .filter((item) => !activityThemeRegions.includes(item.place.regionId) && !scheduled.has(item.place.id) && item.score > -200 && isActivityCandidateForSchedule(item, profile, input) && !belongsToAnotherApprovedBase(item.place.regionId))
      .sort((a, b) => {
        const minutesA = themeAnchorRegionId ? estimateTravel(profile, themeAnchorRegionId, a.place.regionId).durationMinutes : 0;
        const minutesB = themeAnchorRegionId ? estimateTravel(profile, themeAnchorRegionId, b.place.regionId).durationMinutes : 0;
        return minutesA - minutesB || b.score - a.score;
      });
    const candidates = [...themeCandidates, ...fillCandidates.slice(0, Math.max(0, input.maxActivities - themeCandidates.length))];
    const fullDay = candidates.find((item) => item.place.bestTimeOfDay === "full-day");
    const isTrueAllDay = fullDay && Number(fullDay.place.typicalDurationMinutes || 0) >= 300;
    const activityCount = isTrueAllDay && input.maxActivities <= 2 ? 1 : Math.min(input.maxActivities, isTrueAllDay ? 1 : candidates.length);
    const eligibleCandidates = scored.filter((item) => item.score > -200 && isActivityCandidateForSchedule(item, profile, input) && !belongsToAnotherApprovedBase(item.place.regionId));
    let selected = improveArchetypeSelection(profile, input, intelligence, index, themeRegions, (isTrueAllDay && index > 0 && input.maxActivities >= 3 ? [fullDay] : candidates).slice(0, activityCount), eligibleCandidates, scheduled);
    selected = enforceUrbanFirstTimeCoverage(profile, input, index, selected, eligibleCandidates, scheduled);
    selected = diversifyDuplicateMuseumDay(profile, input, selected, eligibleCandidates, scheduled);
    selected = ensureUrbanHistoricalCivicCoverage(profile, input, index, selected, eligibleCandidates, scheduled);
    selected = ensureNearbyUrbanRegionalCoverage(profile, input, index, selected, eligibleCandidates, scheduled);
    selected = ensureCoastalNatureCoverage(profile, input, intelligence, index, selected, eligibleCandidates, scheduled);
    // A destination-scale ticketed park (Universal Studios Florida, Islands
    // of Adventure/Hogsmeade, Magic Kingdom, ...) is a half-to-full-day
    // commitment on its own -- confirmed live: Hogsmeade, Gatorland, and
    // Universal Studios Florida were scheduled the same day, with the
    // traveler shown leaving the Universal resort for an unrelated park and
    // returning for a single hour. Once a day includes one of these, no
    // other non-park activity should share it, and only the single
    // highest-priority park pick survives -- a second ticketed park (even at
    // the same resort) the same day needs explicit traveler intent, not
    // automatic filler.
    const destinationScaleParkItems = selected.filter((item) => (item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input)).isDestinationScalePark);
    if (destinationScaleParkItems.length) {
      selected = [destinationScaleParkItems.slice().sort((a, b) => b.score - a.score)[0]];
    }
    // An approved multi-city base (e.g. Grand Canyon, Sedona) must never sit
    // empty on the one day the traveler is actually there -- normal scoring
    // (score > -200 threshold, archetype-specific penalties) can zero out a
    // thin regional-extension candidate pool entirely, silently leaving only
    // travel/hotel/meal items. Confirmed live: Phoenix -> Grand Canyon ->
    // Sedona produced zero scheduled activities on both extension days. Fall
    // back to the region's own highest-scoring real candidates, ignoring the
    // score floor, before accepting a logistics-only day for an approved base.
    if (approvedSchedule && selected.length === 0 && themeRegions[0]) {
      const homeRegionId = themeRegions[0];
      const fallbackPool = scored
        .filter((item) => item.place.regionId === homeRegionId && !scheduled.has(item.place.id) && isActivityCandidateForSchedule(item, profile, input))
        .sort((a, b) => b.score - a.score);
      if (fallbackPool.length) {
        selected = fallbackPool.slice(0, Math.max(1, Math.min(2, input.maxActivities)));
      }
    }
    if (!isLongDriveArrivalDay(profile, input, index)) selected.forEach((item) => scheduled.add(item.place.id));
    const regionalTransfer = approvedSchedule && approvedSchedule.transferDayIndexes.has(index)
      ? (() => {
          const fromRegionId = approvedSchedule.dayRegionIds[index - 1];
          const toRegionId = approvedSchedule.dayRegionIds[index];
          return { fromRegionId, toRegionId, fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), travel: estimateTravel(profile, fromRegionId, toRegionId) };
        })()
      : null;
    const scheduleItems = scheduleDay(profile, input, constraints, selected.map((item) => item.place), index, mealUsage, eveningUsage, regionalTransfer, approvedSchedule ? themeRegions[0] : null, scheduled);
    scheduleItems.forEach((item) => {
      if (item.placeId && item.type !== "breakfast" && item.type !== "lunch" && item.type !== "dinner") scheduled.add(item.placeId);
    });
    const backups = buildBackups(profile, constraints, themeRegions, selected.map((item) => item.place), scheduled, backupUsage);
    backups.forEach((backup) => backupUsage.set(backup.placeId, (backupUsage.get(backup.placeId) || 0) + 1));
    const warnings = [];
    const dailyDriveMinutes = groundTravelMinutes(scheduleItems);
    if (dailyDriveMinutes > input.maxDrivingMinutes) warnings.push(`Estimated driving exceeds your ${Math.round(input.maxDrivingMinutes / 60)} hour daily preference.`);
    const dailyBudget = estimateDayBudget(input, scheduleItems);
    const contentItems = scheduleItems.filter((item) => item.type === "activity" || item.type === "evening");
    const actualRegionIds = [...new Set(contentItems.map((item) => item.regionId).filter(Boolean))];
    // selected[0] is a pre-scheduling guess -- scheduleDay can drop it
    // entirely (isTimeSensitiveClosed, budget/duration limits) without that
    // ever showing up here, so a day's title and region label could name a
    // place that never actually appears in the day at all. Confirmed live: a
    // day titled "The Metropolitan Museum of Art area parks and scenery" had
    // Central Park, the High Line, and The Battery as its actual scheduled
    // activities -- the Met never made it into the final schedule. Derive
    // the region from what was actually scheduled (actualRegionIds, already
    // computed above from the same activity-and-evening item set the day's
    // own summary and dayRouteLabel use), falling back to the pre-scheduling
    // guess only when nothing got scheduled at all.
    const region = profile.regions.find((item) => item.id === actualRegionIds[0])
      || profile.regions.find((item) => item.id === selected[0]?.place.regionId)
      || profile.regions.find((item) => item.id === themeRegions[0])
      || profile.regions[0];
    const summaryRegionNames = (actualRegionIds.length ? actualRegionIds : themeRegions).map((id) => regionName(profile, id));
    const isLogisticsOnlyDay = contentItems.length === 0;
    const isMultiRegionDay = actualRegionIds.length > 1;
    // A logistics-only day's copy was always written for a departure
    // ("checkout... before departure"), even on an arrival day (which has no
    // checkout at all -- the traveler just checked IN) -- confirmed live: a
    // day titled "Arrival in New York" carried the summary "A lighter
    // balanced day for checkout, travel logistics, and a final meal before
    // departure." Distinguish which logistics-only day this actually is.
    const isArrivalLogisticsDay = isLogisticsOnlyDay && scheduleItems.some((item) => item.title.startsWith("Travel to "));
    const isDepartureLogisticsDay = isLogisticsOnlyDay && scheduleItems.some((item) => item.title.startsWith("Depart "));
    // A mid-trip regional-transfer day (moving to a new approved hotel base)
    // has the same "arrival day" shape as Day 1 -- light morning, a dedicated
    // travel block, check-in -- but was falling through to the generic
    // multi-region/single-region branches below, which read like an ordinary
    // sightseeing day instead of naming the move. Give it its own copy,
    // checked ahead of the logistics/region branches since a transfer day is
    // the more specific and more accurate category whether or not activities
    // got scheduled alongside the move.
    const isTransferDay = Boolean(regionalTransfer);
    const summary = isTransferDay
      ? `A lighter ${input.pace.toLowerCase()} day for the move to ${regionalTransfer.toLabel}, with time to settle in.`
      : isArrivalLogisticsDay
      ? `A lighter ${input.pace.toLowerCase()} day for travel, hotel check-in, and a first meal after arrival.`
      : isDepartureLogisticsDay
        ? `A lighter ${input.pace.toLowerCase()} day for checkout, travel logistics, and a final meal before departure.`
        : isLogisticsOnlyDay
          ? `A lighter ${input.pace.toLowerCase()} day built around travel logistics.`
          : isMultiRegionDay
            ? `A ${input.pace.toLowerCase()} day spanning ${summaryRegionNames.join(" and ")}, with about ${Math.round(dailyDriveMinutes)} minutes of driving between stops.`
            : `A ${input.pace.toLowerCase()} day focused on ${summaryRegionNames.join(" and ")}, grouped to avoid unnecessary cross-city travel.`;
    const generationReasoningSummary = isTransferDay
      ? `Kept the day light for the move to ${regionalTransfer.toLabel}, with time to settle in.`
      : isArrivalLogisticsDay
      ? `Kept the day light for travel and check-in logistics, with time for a first meal after arrival.`
      : isDepartureLogisticsDay
        ? `Kept the day light for checkout and departure logistics, with time for a final meal.`
        : isLogisticsOnlyDay
          ? `Kept the day light for travel logistics.`
          : isMultiRegionDay
            ? `Selected activities across ${summaryRegionNames.join(" + ")} that fit ${input.pace.toLowerCase()} pace, stated interests, and traveler constraints.`
            : `Grouped ${summaryRegionNames.join(" + ")} stops for route efficiency and selected activities that fit ${input.pace.toLowerCase()} pace, stated interests, and traveler constraints.`;
    return {
      id: uid("day"),
      dayNumber: index + 1,
      date,
      title: dayTitleFor(profile, input, intelligence, region, scheduleItems, index),
      theme: dayThemeLabel(themeRegions, intelligence),
      region: region.name,
      regionId: region.id,
      summary,
      weatherPlanningNote: weatherNote(scheduleItems, date),
      scheduleItems,
      backupOptions: backups,
      dailyBudget,
      dailyDriveMinutes,
      warnings,
      locked: false,
      generationReasoningSummary
    };
  });
}

function diversifyDuplicateMuseumDay(profile, input, selected, candidates, scheduled) {
  if (hasExplicitMuseumIntent(input)) return selected;
  const replacements = [...selected];
  let museumCount = replacements.filter((item) => {
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return flag.isMuseum;
  }).length;
  if (museumCount <= 1) return selected;
  const selectedIds = new Set(replacements.map((item) => item.place.id));
  replacements.forEach((item, index) => {
    if (museumCount <= 1) return;
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    if (!flag.isMuseum) return;
    if (isProtectedSignatureAnchor(item.place)) return;
    const replacement = candidates.find((candidate) => {
      if (scheduled.has(candidate.place.id) || selectedIds.has(candidate.place.id) || isRegionalExcursionPlace(candidate.place)) return false;
      const candidateFlag = candidate.intelligence?.classification || classifyPlaceForPlanning(candidate.place, profile, input, candidate.intelligence?.routeFeasibility);
      return !candidateFlag.isMuseum && !candidateFlag.isRestaurant && !candidateFlag.isFoodHall && !candidateFlag.isBar && !candidateFlag.isOrdinaryBusiness;
    });
    if (replacement) {
      replacements[index] = replacement;
      selectedIds.add(replacement.place.id);
      museumCount -= 1;
    }
  });
  return replacements;
}

function isProtectedSignatureAnchor(place) {
  // A highly-rated or glowingly-described restaurant (a real, common
  // pattern in AI-generated place descriptions -- "world renowned",
  // "one of the largest" wine lists, priorityScore 88+) can trip these same
  // flowery-language and high-score signals just as easily as an actual
  // landmark. This flag exists to protect a day's headline attraction from
  // being swapped out, not to protect a restaurant -- exclude food/bar
  // places up front regardless of how they score or read.
  const categories = (place.categories || []).map((category) => String(category).toLowerCase());
  if (categories.includes("restaurant") || categories.includes("food") || categories.includes("bar")) return false;
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return /\b(aquarium|botanical garden|civil rights|human rights|national historical park|national historic site|official tourism|world class|world renowned|one of the largest)\b/.test(text)
    || Number(place.priorityScore || 0) >= 88;
}

function ensureMissingProtectedSignature(profile, input, selected, candidates, scheduled, selectedIds) {
  if (hasExplicitMuseumIntent(input)) return selected;
  const current = [...candidates.filter((item) => scheduled.has(item.place.id)), ...selected];
  const currentText = normalizeText(current.map((item) => `${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`).join(" "));
  const missingPattern = !/\baquarium\b/.test(currentText)
    ? /\baquarium\b/
    : !/\b(national historical park|national historic site)\b/.test(currentText)
      ? /\b(national historical park|national historic site)\b/
      : !/\b(civil rights|human rights)\b/.test(currentText)
        ? /\b(civil rights|human rights)\b/
      : null;
  if (!missingPattern) return selected;
  const candidate = candidates
    .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id) && !isRegionalExcursionPlace(item.place))
    .filter((item) => missingPattern.test(normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`)))
    .sort((a, b) => protectedSignatureRank(b.place) - protectedSignatureRank(a.place) || Number(b.place.priorityScore || 0) - Number(a.place.priorityScore || 0) || b.score - a.score)[0];
  if (!candidate) return selected;
  const replacements = [...selected];
  const replaceIndex = replacements.findIndex((item) => !isProtectedSignatureAnchor(item.place) || protectedSignatureRank(item.place) < protectedSignatureRank(candidate.place));
  if (replaceIndex >= 0) replacements[replaceIndex] = candidate;
  else if (replacements.length < input.maxActivities) replacements.push(candidate);
  selectedIds.add(candidate.place.id);
  return replacements;
}

function bestProtectedSignatureCandidate(candidates, selectedIds, scheduled) {
  return candidates
    .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id) && !isRegionalExcursionPlace(item.place) && isProtectedSignatureAnchor(item.place))
    .sort((a, b) => protectedSignatureRank(b.place) - protectedSignatureRank(a.place) || Number(b.place.priorityScore || 0) - Number(a.place.priorityScore || 0) || b.score - a.score)[0] || null;
}

function protectedSignatureRank(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  if (/\b(aquarium|civil rights|human rights|national historical park|national historic site|national museum|smithsonian|official tourism top attraction|world class|world renowned|one of the largest)\b/.test(text)) return 4;
  if (/\b(official tourism|must see|first time|iconic|signature)\b/.test(text)) return 3;
  if (/\b(botanical garden|garden|park)\b/.test(text)) return 2;
  return 1;
}

function ensureUrbanHistoricalCivicCoverage(profile, input, dayIndex, selected, candidates, scheduled) {
  if (!isUrbanDestinationProfile(profile) || dayIndex <= 0 || dayIndex >= input.numberOfDays - 1) return selected;
  const coveredText = normalizeText(candidates.filter((item) => scheduled.has(item.place.id)).map((item) => `${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`).join(" "));
  if (/\b(national historical park|national historic site|civil rights|human rights|library of congress|capitol)\b/.test(coveredText)) return selected;
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const civic = candidates.find((item) => {
    if (scheduled.has(item.place.id) || selectedIds.has(item.place.id) || isRegionalExcursionPlace(item.place)) return false;
    const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
    return /\b(national historical park|national historic site|civil rights|human rights|library of congress|capitol)\b/.test(text);
  });
  if (!civic) return selected;
  const replacements = [...selected];
  const replaceIndex = replacements.findIndex((item) => {
    const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
    return !/\b(aquarium|national historical park|national historic site|civil rights|human rights|library of congress|capitol)\b/.test(text);
  });
  if (replaceIndex >= 0) replacements[replaceIndex] = civic;
  else if (replacements.length < input.maxActivities) replacements.push(civic);
  return replacements.slice(0, input.maxActivities);
}

// isDayTrip/isRegionalDestination come from routeFeasibility's app-wide
// 90-minute-round-trip "local" cutoff -- reasonable for most cities, but a
// genuinely sprawling one has ordinary IN-CITY attractions comfortably over
// that bound. Confirmed live: Fairchild Tropical Botanic Garden, a regular
// Miami garden a short drive from downtown, is a 110-minute round trip and
// got flagged as a "day trip" -- which satisfied nearby-regional-coverage
// before Everglades National Park (a genuine 200-minute round trip actually
// outside the city) ever got a chance to be considered. A place's regionId
// is a more reliable geographic signal here: buildGoogleRegions already
// buckets genuine geographic outliers into "nearby-region," and an approved
// regional extension always carries a "regional-ext-" id -- neither
// depends on a single noisy time threshold.
function isGeographicallyRegionalPlace(place) {
  return place.regionId === "nearby-region" || String(place.regionId || "").startsWith("regional-ext-") || isRegionalExcursionPlace(place);
}

function ensureNearbyUrbanRegionalCoverage(profile, input, dayIndex, selected, candidates, scheduled) {
  if (!isUrbanDestinationProfile(profile) || input.numberOfDays < 4 || dayIndex < 2 || dayIndex >= input.numberOfDays - 1) return selected;
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const selectedOrScheduled = [...candidates.filter((item) => scheduled.has(item.place.id)), ...selected];
  const alreadyHasNearbyRegional = selectedOrScheduled.some((item) => isGeographicallyRegionalPlace(item.place));
  if (alreadyHasNearbyRegional) return selected;
  const nearby = candidates
    .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id))
    .map((item) => ({
      item,
      flag: item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility),
      routeRank: routeRank(item.intelligence?.routeFeasibility?.classification)
    }))
    .filter(({ item, flag, routeRank: rank }) => {
      if (rank > 1 || flag.isRestaurant || flag.isFoodHall || flag.isBar || flag.isOrdinaryBusiness || flag.isChildrenFocused || flag.isGamblingVenue) return false;
      const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
      // "downtown" alone is too generic a signal here -- it also matches an
      // ordinary in-city museum's own category tag (e.g. a "museum, downtown,
      // indoor" fixture), which can then outscore a genuinely regional pick
      // like Duke Gardens and win this slot despite not being a day trip at
      // all. Confirmed live: this exact false-positive bumped Duke Gardens
      // out of a Raleigh itinerary in favor of a downtown Raleigh museum
      // once an unrelated scheduling shift changed which day this ran on.
      // Keep the more specific words that actually indicate a regional
      // excursion rather than just "is downtown."
      return isGeographicallyRegionalPlace(item.place) || /\b(university|gardens|garden|college town|historic district)\b/.test(text) && Number(item.place.priorityScore || 0) >= 72;
    })
    .sort((a, b) => a.routeRank - b.routeRank || Number(b.item.place.priorityScore || 0) - Number(a.item.place.priorityScore || 0) || b.item.score - a.item.score)[0]?.item;
  if (!nearby) return selected;
  const replacements = [...selected];
  const replaceIndex = replacements.findIndex((item) => {
    const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
    return !/\b(aquarium|national historical park|national historic site|civil rights|human rights|capitol|library of congress)\b/.test(text);
  });
  if (replaceIndex >= 0) replacements[replaceIndex] = nearby;
  else if (replacements.length < input.maxActivities) replacements.push(nearby);
  return replacements.slice(0, input.maxActivities);
}

function ensureCoastalNatureCoverage(profile, input, intelligence, dayIndex, selected, candidates, scheduled) {
  if (intelligence?.destinationArchetype?.primaryArchetype !== "beach/coastal" || dayIndex <= 0 || dayIndex >= input.numberOfDays - 1) return selected;
  const selectedOrScheduled = [...candidates.filter((item) => scheduled.has(item.place.id)), ...selected];
  if (selectedOrScheduled.some((item) => isCoastalNaturePlace(item.place, item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility)))) return selected;
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const coastalNature = candidates.find((item) => {
    if (scheduled.has(item.place.id) || selectedIds.has(item.place.id)) return false;
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return isCoastalNaturePlace(item.place, flag);
  });
  if (!coastalNature) return selected;
  const replacements = [...selected];
  const replaceIndex = replacements.findIndex((item) => {
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return !isCoastalNaturePlace(item.place, flag);
  });
  if (replaceIndex >= 0) replacements[replaceIndex] = coastalNature;
  else if (replacements.length < input.maxActivities) replacements.push(coastalNature);
  return replacements.slice(0, input.maxActivities);
}

function isLongDriveArrivalDay(profile, input, dayIndex) {
  if (dayIndex !== 0) return false;
  const context = tripTravelContext(profile, input);
  return Boolean(context.needsArrivalLogistics && context.originDriveMinutes >= 360);
}

function enforceUrbanFirstTimeCoverage(profile, input, dayIndex, selected, candidates, scheduled) {
  if (!isUrbanDestinationProfile(profile) || dayIndex <= 0 || dayIndex >= input.numberOfDays - 1) return selected;
  const publicText = normalizeText([
    ...[...scheduled].map((id) => profile.places.find((place) => place.id === id)?.name || ""),
    ...selected.map((item) => `${item.place.name} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`)
  ].join(" "));
  if (/\b(monument|memorial|national mall)\b/.test(publicText)) return selected;
  const landmark = candidates.find((item) => {
    if (scheduled.has(item.place.id) || selected.some((chosen) => chosen.place.id === item.place.id) || isRegionalExcursionPlace(item.place)) return false;
    const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
    return /\b(monument|memorial|national mall)\b/.test(text);
  });
  if (!landmark) return selected;
  const next = selected.length ? [...selected] : [landmark];
  const replaceIndex = next.findIndex((item) => {
    const text = normalizeText(`${item.place.name} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
    return !/\b(capitol|library|monument|memorial|national mall)\b/.test(text);
  });
  if (replaceIndex >= 0) next[replaceIndex] = landmark;
  else if (next.length < input.maxActivities) next.push(landmark);
  else next[0] = landmark;
  return next.slice(0, input.maxActivities);
}

function isActivityCandidateForSchedule(item, profile, input) {
  const classification = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
  if (classification.isOrdinaryBusiness || classification.isStaleOrClosedAttraction || classification.isChildrenFocused) return false;
  if (classification.isRestaurant || classification.isFoodHall || classification.isBar) return false;
  if (classification.isDinnerShow) return false;
  // isGamblingVenue was previously only hard-excluded in a couple of narrow
  // call sites (isBackupCompatible, eveningAnchorPlace), so a casino kept
  // re-entering through whichever other path selects daytime activity
  // candidates -- e.g. ensureNearbyUrbanRegionalCoverage, and the last day
  // of a trip (never covered by that function's dayIndex guard) fell back
  // to it too. This is the one gate every activity candidate must pass
  // through, so exclude it here instead of patching each caller.
  if (classification.isGamblingVenue) return false;
  // A place whose own name self-labels it as a weather/back-up option
  // (e.g. "Miami Seaquarium (weather/back-up option)") must not be
  // schedulable as the actual primary plan -- it's still eligible for the
  // real backups list via buildBackups, which has its own separate
  // isBackupCompatible gate.
  if (classification.isSelfDescribedBackup) return false;
  if (classification.isSensitiveOrExplicitContent && !preferencesRequestSensitiveContent(input)) return false;
  if (isGenericParkContainer(item.place, profile)) return false;
  return true;
}

function preferencesRequestSensitiveContent(input) {
  const text = normalizeText((input.preferences || []).map((pref) => pref.label || pref).join(" "));
  return /\b(nude beach|nudist|clothing[- ]optional)\b/.test(text);
}

function destinationDayThemes(profile, input, intelligence = null) {
  if (intelligence?.destinationArchetype?.primaryArchetype === "beach/coastal") {
    return beachCoastalThemes(profile, input, intelligence);
  }
  if (intelligence?.destinationArchetype?.primaryArchetype === "mountain" || intelligence?.destinationArchetype?.primaryArchetype === "national park") {
    return mountainRegionalThemes(profile, input, intelligence);
  }
  if (isUrbanDestinationProfile(profile)) {
    return urbanDestinationThemes(profile, input, intelligence);
  }
  const profileRegions = profile.regions.map((region) => region.id);
  const hasDefaultThemes = dayThemes.flat().some((regionId) => profileRegions.includes(regionId));
  if (hasDefaultThemes) return rotate(dayThemes, input.variationSeed).slice(0, input.numberOfDays);
  return coordinateClusterThemes(profile, input);
}

function urbanDestinationThemes(profile, input, intelligence = null) {
  const regionIds = profile.regions.map((region) => region.id);
  const defaultRegion = profile.planningRules?.defaultHotelRegion || regionIds[0];
  const byText = (pattern) => (intelligence?.allCandidates || [])
    .filter((item) => item.accepted && pattern.test(normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`)))
    .map((item) => item.place.regionId)
    .filter((id) => regionIds.includes(id));
  const signature = byText(/\b(signature|must see|landmark|monument|memorial|national mall|first time|iconic)\b/);
  const civic = byText(/\b(capitol|library|court|government|botanic|market|civic)\b/);
  const museums = byText(/\b(museum|gallery|smithsonian|art|history|zoo)\b/);
  const neighborhood = byText(/\b(neighborhood|waterfront|wharf|georgetown|market|district|promenade|evening|food)\b/);
  const regional = byText(/\b(regional|day trip|nearby|arlington|alexandria|mount vernon|state park|airport|suburban)\b/);
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const baseThemes = [
    unique([defaultRegion, signature[0], neighborhood[0]]),
    unique([signature[0], museums[0], defaultRegion]),
    unique([civic[0], museums[1], neighborhood[1]]),
    unique([neighborhood[0], museums[2], signature[1]]),
    unique([regional[0], neighborhood[2]]),
    unique([museums[3], civic[1], defaultRegion])
  ].map((theme) => keepNearbyThemeRegions(profile, theme.filter((id) => regionIds.includes(id)), input.pace === "Packed" ? 3 : 2)).filter((theme) => theme.length);
  return rotate(baseThemes.length ? baseThemes : coordinateClusterThemes(profile, input), input.variationSeed).slice(0, input.numberOfDays);
}

function mountainRegionalThemes(profile, input, intelligence) {
  const regionIds = profile.regions.map((region) => region.id);
  const defaultRegion = profile.planningRules?.defaultHotelRegion || regionIds[0];
  const byPlace = (predicate) => (intelligence?.allCandidates || [])
    .filter((item) => item.accepted && predicate(item.place, item.classification))
    .map((item) => item.place.regionId)
    .filter((id) => regionIds.includes(id));
  const gateway = byPlace((place) => isGatewayTownOrDowntown(place));
  const scenic = byPlace((place) => isScenicMountainCorridor(place));
  const hikes = byPlace((place) => isHikeOrWaterfall(place));
  const entertainment = byPlace((place) => isMountainEntertainment(place));
  const food = byPlace((place, flag) => flag.isRestaurant || flag.isFoodHall || flag.isEveningAnchor);
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const sightseeingDays = Math.max(1, Number(input.numberOfDays || 1) - 2);
  const themes = [
    unique([defaultRegion, gateway[0], food[0]]),
    unique([scenic[0], hikes[0], defaultRegion]),
    unique([entertainment[0], gateway[1], food[1]]),
    unique([scenic[1], hikes[1], gateway[0]]),
    unique([hikes[2], scenic[2], defaultRegion]),
    unique([gateway[2], entertainment[1], food[2]])
  ].map((theme) => keepNearbyThemeRegions(profile, theme.filter((id) => regionIds.includes(id)), input.pace === "Packed" ? 3 : 2)).filter((theme) => theme.length);
  const rotated = rotate(themes.length ? themes : coordinateClusterThemes(profile, input), input.variationSeed);
  if (input.numberOfDays <= 2) return rotated.slice(0, input.numberOfDays);
  if (input.numberOfDays === 3) return [rotated[0] || [defaultRegion], rotated.find((theme) => theme.some((id) => scenic.includes(id) || hikes.includes(id))) || rotated[1] || [defaultRegion], rotated[2] || rotated[0] || [defaultRegion]];
  return rotated.slice(0, Math.max(input.numberOfDays, sightseeingDays));
}

function beachCoastalThemes(profile, input, intelligence) {
  const clustered = coordinateClusterThemes(profile, input);
  const regionIds = profile.regions.map((region) => region.id);
  const byFlag = (predicate) => (intelligence?.allCandidates || [])
    .filter((item) => item.accepted && predicate(item.classification))
    .map((item) => item.place.regionId)
    .filter((id) => regionIds.includes(id));
  const defaultRegion = profile.planningRules?.defaultHotelRegion || regionIds[0];
  const beach = byFlag((flag) => flag.isBeachOrWaterfront || flag.isBoardwalk);
  const evening = byFlag((flag) => flag.isEveningAnchor);
  const nature = (intelligence?.allCandidates || [])
    .filter((item) => item.accepted)
    .filter((item) => {
      const flag = item.classification;
      const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
      return flag.isPark && (/state park|garden|marsh|brookgreen|huntington|atalaya|coastal wildlife/.test(text) || (flag.isBeachOrWaterfront && !/central|boardwalk/.test(text)));
    })
    .map((item) => item.place.regionId)
    .filter((id) => regionIds.includes(id));
  const entertainment = byFlag((flag) => flag.isEveningAnchor || flag.isBoardwalk);
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const themes = [
    unique([defaultRegion, beach[0], evening[0]]),
    unique([nature[0], evening[1], beach[1]]),
    unique([beach[2], entertainment[0]]),
    unique([entertainment[1], beach[3], nature[1]])
  ].map((theme) => keepNearbyThemeRegions(profile, theme.filter((id) => regionIds.includes(id)), input.pace === "Packed" ? 3 : 2)).filter((theme) => theme.length);
  return rotate(themes.length ? themes : clustered.length ? clustered : [[defaultRegion]], input.variationSeed).slice(0, input.numberOfDays);
}

function coordinateClusterThemes(profile, input) {
  const regions = (profile.regions || []).filter((region) => region?.id);
  if (!regions.length) return [[]];
  const ordered = rotate(regions, input.variationSeed);
  const limit = input.pace === "Packed" ? 3 : 2;
  return Array.from({ length: input.numberOfDays }, (_, index) => {
    const anchor = ordered[index % ordered.length];
    return keepNearbyThemeRegions(profile, [anchor.id, ...(anchor.neighboringRegionIds || [])], limit);
  });
}

function keepNearbyThemeRegions(profile, regionIds, limit) {
  const uniqueIds = [...new Set(regionIds.filter(Boolean))];
  const anchor = profile.regions.find((region) => region.id === uniqueIds[0]) || profile.regions[0];
  return uniqueIds
    .map((id) => ({ id, minutes: estimateTravel(profile, anchor?.id, id).durationMinutes }))
    .filter((item) => item.id === anchor?.id || item.minutes <= 45)
    .sort((a, b) => a.minutes - b.minutes)
    .map((item) => item.id)
    .slice(0, limit);
}

// A regional-transfer day's own activities run after hotel check-in and
// still need to leave room for a normally-timed dinner. Always keeps the
// first (highest-priority) candidate -- protects the day's headline stop --
// and only keeps a second one if the combined scheduled duration stays
// under a budget that leaves realistic room for travel legs and dinner.
function capRegionalTransferActivities(candidates, budgetMinutes = 200) {
  if (candidates.length <= 1) return candidates;
  const kept = [];
  let total = 0;
  for (const place of candidates) {
    const duration = scheduledDurationForPlace(place);
    if (kept.length && total + duration > budgetMinutes) break;
    kept.push(place);
    total += duration;
  }
  return kept;
}

function scheduleDay(profile, input, constraints, places, dayIndex, mealUsage = new Map(), eveningUsage = new Map(), regionalTransfer = null, homeRegionId = null, priorDaysScheduled = new Set()) {
  const items = [];
  const buffers = paceDefaults(input.pace).buffer;
  const mealDuration = input.pace === "Relaxed" ? 75 : 60;
  // A day that transfers to a newly-approved hotel base (e.g. Phoenix ->
  // Grand Canyon) is scheduled like an arrival day -- light morning,
  // dedicated travel block, check-in -- but using the inter-base drive
  // instead of the trip's overall origin-to-destination travel.
  // The final day of a multi-city trip needs the same kind of override: the
  // traveler may be departing from an approved base that is not the primary
  // destination (e.g. leaving from Great Smoky Mountains, not Charlotte), in
  // which case the return trip must be estimated from that base's actual
  // location, not the primary destination's.
  const defaultBaseRegionId = profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id || "";
  const departsFromNonPrimaryBase = !regionalTransfer && dayIndex === input.numberOfDays - 1 && homeRegionId && homeRegionId !== defaultBaseRegionId;
  const travelContext = regionalTransfer
    ? regionalTransferContext(regionalTransfer.travel)
    : departsFromNonPrimaryBase
      ? departureFromRegionContext(profile, input, homeRegionId)
      : tripTravelContext(profile, input);
  const isArrivalDay = Boolean(regionalTransfer) || (dayIndex === 0 && travelContext.needsArrivalLogistics);
  const isDepartureDay = !regionalTransfer && dayIndex === input.numberOfDays - 1 && travelContext.needsDepartureLogistics;
  const parkRouteDay = shouldPackLunchForDay(places);
  const breakfastStart = constraints.breakfastMinutes;
  // originDriveMinutes is always populated (a hypothetical "if you drove
  // instead" reference distance/time, used elsewhere for things like the
  // departure block's driving-mode formula), regardless of the trip's
  // actual transport mode -- confirmed live: a Charlotte -> Los Angeles
  // FLIGHT (~2100mi) has a huge hypothetical drive-time estimate, which
  // misfired this flag to true even though nobody is driving, silently
  // skipping both arrival-day lunch code paths (line ~1604 and the lunch
  // safety net) and leaving Day 1 with no lunch at all. Long-arrival-drive
  // handling only makes sense when the traveler is actually driving.
  const longArrivalDrive = isArrivalDay && travelContext.transportMode === "drive" && travelContext.originDriveMinutes >= 360;
  const arrivalActivityStart = isArrivalDay
    ? Math.max(16 * 60, travelContext.arrivalMinutes + (longArrivalDrive ? 105 : 60))
    : 0;
  const activityStart = Math.max(parseTime(input.earliestActivity) ?? 9 * 60, breakfastStart + 60, arrivalActivityStart);
  // When no activity got scheduled for the day (e.g. a thin regional-extension
  // candidate pool), falling back to the trip's default hotel region for meals
  // silently relocates them to the primary destination -- e.g. Grand Canyon's
  // breakfast/lunch/dinner recommending Phoenix restaurants. Prefer the day's
  // own approved base region (homeRegionId) before that trip-wide default.
  const firstRegion = places[0]?.regionId || homeRegionId || profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id || "";
  if (isArrivalDay) {
    // Breakfast sits at a fixed early-morning slot regardless of when the
    // arrival travel block itself lands -- confirmed live: an 8:00 AM flight
    // arrival (the assumed default when no exact time was entered) left
    // breakfast's normal ~8 AM slot falling AFTER arrival, yet it was still
    // titled "Pre-departure breakfast" and described as coming "before the
    // arrival travel block." Once the traveler has already landed, this is
    // just their first breakfast in town, not a pre-departure meal.
    // Comparing only against the arrival CLOCK TIME (the original fix above)
    // missed a more common case: a long flyMinutes estimate can push the
    // travel block's DEPARTURE well before dawn (e.g. 4:00 AM) while
    // breakfast stays pinned to its normal ~8 AM slot -- squarely inside the
    // block, not after it. Confirmed live: that left a "Pre-departure
    // breakfast" scheduled (by the later overlap-avoidance pass) to display
    // after the travel block had already ended, because the traveler's
    // normal breakfast time fell after they'd already left for the airport.
    // Compare against the block's DEPARTURE time instead, and anchor the
    // meal's actual slot to just after arrival when it can't fit before
    // departure, instead of leaving it to land wherever the generic
    // overlap-avoidance cursor happens to push it.
    const breakfastAfterArrival = travelContext.transportMode === "fly" && breakfastStart + 45 > travelContext.departureMinutes;
    const breakfastActualStart = breakfastAfterArrival ? Math.max(breakfastStart, travelContext.arrivalMinutes + 30) : breakfastStart;
    addMeal(items, "breakfast", breakfastActualStart, 45, breakfastAfterArrival ? "Arrival-morning breakfast" : "Pre-departure breakfast", {
      primary: breakfastAfterArrival ? "Breakfast after arrival, near the hotel or first stop" : "Breakfast before leaving or on the first route stop",
      secondary: "Simple cafe or hotel breakfast",
      text: breakfastAfterArrival
        ? "A simple first breakfast after arrival. Choose a cafe, hotel breakfast, or a stop near wherever you're headed first; verify menus and timing directly."
        : "Keep breakfast simple before the arrival travel block. Choose a cafe, hotel breakfast, or route stop that fits the group; verify menus and timing directly.",
      cuisine: "Flexible",
      price: moneyRange(mealCost(input, "breakfast").low, mealCost(input, "breakfast").high),
      reservation: "No reservation needed for a simple travel-morning breakfast."
    }, firstRegion, input, constraints, null, true);
    items.push(regionalTransfer
      ? arrivalTravelItem(profile, input, travelContext, regionalTransfer.fromLabel, regionalTransfer.toLabel)
      : arrivalTravelItem(profile, input, travelContext));
    // On a long-drive arrival day (6+ hours), the travel item's own buffer
    // already accounts for a meal stop along the way -- confirmed live: an
    // 11h17 drive landing at 8:12 PM still got a separate "lunch" scheduled
    // for 8:20 PM (timed relative to the real, very late arrival, but never
    // relabeled or dropped), immediately followed by a correctly-timed
    // dinner a couple hours later. A traveler does not eat two full meals
    // back to back after a day spent entirely driving. Skip this pre-arrival
    // lunch entirely when the drive is long; the day's one real meal is the
    // dinner scheduled after check-in below.
    if (!longArrivalDrive) {
      const arrivalLunchRecommendation = mealRecommendation(profile, input, firstRegion, "lunch", mealUsage, places[0]);
      addMeal(items, "lunch", Math.max(12 * 60, travelContext.arrivalMinutes - 45), mealDuration, mealTitle(profile, arrivalLunchRecommendation.primaryPlaceRegionId, "lunch"), arrivalLunchRecommendation, firstRegion, input, constraints, mealUsage);
    }
    items.push(simpleItem("lodging", Math.max(15 * 60, travelContext.arrivalMinutes + 45), 45, "Hotel check-in and reset", "Check in, park, unpack lightly, and leave a buffer before any first-evening plans."));
  } else {
    const breakfastRecommendation = mealRecommendation(profile, input, firstRegion, "breakfast", mealUsage, places[0]);
    addMeal(items, "breakfast", breakfastStart, 45, mealTitle(profile, breakfastRecommendation.primaryPlaceRegionId, "breakfast"), breakfastRecommendation, firstRegion, input, constraints, mealUsage);
  }
  let cursor = activityStart;
  // On a long-drive arrival day, dinner comes first (a tired traveler eats,
  // then maybe takes a short walk -- not the other way around), so the
  // single evening-friendly activity is handled separately below instead of
  // through the normal pre-dinner activity loop.
  // isArrivalEveningFriendly exists for the trip's own long-haul arrival day
  // (a light stroll near the hotel after a flight) and explicitly excludes
  // anything tagged "regional" -- but every place in an approved regional
  // extension (Grand Canyon, Sedona, ...) is tagged exactly that way by the
  // merge that brings its data in (confirmed live via a local repro: a real
  // 90-minute viewpoint and a 120-minute trail both got excluded, leaving
  // the day with zero scheduled activity beyond travel and dinner). Applied
  // to a base-transfer day, that filter throws out the destination's own
  // signature sights on the one day built around actually being there. A
  // transfer day (not a long-haul arrival) still has real daylight left
  // after checkin -- schedule real destination activities from the already
  // region-scoped candidate list, not a light-stroll-only subset.
  const dayPlaces = isDepartureDay
    ? places.filter((place) => isDepartureFriendly(place)).slice(0, 1)
    : isArrivalDay
      ? (longArrivalDrive
          ? []
          : regionalTransfer
            // A regional-transfer day already has hotel check-in ahead of its
            // activities, unlike an ordinary day -- capping by COUNT alone
            // (up to 2 activities) still let two genuinely long activities
            // (e.g. a 150min estate + a 130min nature area) push dinner past
            // midnight. Confirmed live: check-in at 3:00 PM, two such
            // activities back to back, dinner didn't start until 11:57 PM.
            // Cap by total scheduled duration too, so a transfer day that
            // already picked one substantial activity doesn't also take a
            // second one big enough to blow the evening.
            ? capRegionalTransferActivities(places.slice(0, Math.max(1, Math.min(2, input.maxActivities))))
            : places.filter((place) => isArrivalEveningFriendly(place)).slice(0, 1))
      : places;
  let previousScheduledPlace = null;
  dayPlaces.forEach((place, index) => {
    if (isTimeSensitiveClosed(place, cursor)) {
      return;
    }
    if (previousScheduledPlace) {
      const travel = estimateTravel(profile, previousScheduledPlace, place);
      items.push(travelItem(previousScheduledPlace.name, place.name, cursor, travel));
      cursor += travel.durationMinutes + buffers;
    } else {
      // The day's very first activity transition (breakfast/hotel area ->
      // first stop) never got a travel leg at all, on the assumption it's a
      // short in-neighborhood hop -- true for most urban first stops, but
      // wrong for a genuine regional excursion. Confirmed live:
      // "Everglades National Park gateway" was scheduled as Day 2's first
      // activity directly after breakfast with only a 15-minute gap,
      // despite being sharing the same nominal regionId as downtown Miami
      // and actually requiring a real 40+ minute drive each way. Only add
      // this leg when the first stop is genuinely far from the day's home
      // region, so ordinary nearby first stops (the common case) are
      // unaffected.
      const anchorTravel = estimateTravel(profile, firstRegion, place);
      if (anchorTravel.durationMinutes > 20) {
        items.push(travelItem(regionName(profile, firstRegion), place.name, cursor, anchorTravel));
        cursor += anchorTravel.durationMinutes + buffers;
      }
    }
    if (index === 1 && !items.some((item) => item.type === "lunch") && cursor > constraints.lunchMinutes - 30) {
      const lunchRecommendation = parkRouteDay ? packedLunchRecommendation(profile, input, place.regionId) : mealRecommendation(profile, input, place.regionId, "lunch", mealUsage, place);
      addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, mealTitle(profile, lunchRecommendation.primaryPlaceRegionId, "lunch"), lunchRecommendation, place.regionId, input, constraints, parkRouteDay ? null : mealUsage);
      cursor = Math.max(cursor, constraints.lunchMinutes + mealDuration + buffers);
    }
    const scheduledActivity = activityItem(place, cursor, constraints, index);
    items.push(scheduledActivity);
    cursor += scheduledActivity.durationMinutes + buffers;
    previousScheduledPlace = place;
  });
  // The lunch-safety-net below assumes the traveler is at the destination by
  // a normal midday hour; on a long-drive arrival day they are still en
  // route at that point (see the deliberate skip above), so it must not
  // fire here either.
  if (!items.some((item) => item.type === "lunch") && !longArrivalDrive) {
    const lunchRegion = places[0]?.regionId || firstRegion;
    const lunchRecommendation = parkRouteDay ? packedLunchRecommendation(profile, input, lunchRegion) : mealRecommendation(profile, input, lunchRegion, "lunch", mealUsage, places[0]);
    // On a departure day, the return-travel block (computed backward from a
    // fixed departure anchor) can span the fixed 12:30 PM lunch slot --
    // confirmed live that on a long-haul flight home, sortAndFormat's
    // generic overlap-avoidance pushed this "lunch" forward past the whole
    // travel block, landing it at 8:08 PM -- still labeled lunch, right
    // before the day's real "dinner after return". Anchor departure-day
    // lunch before that block instead of at the fixed default time, with a
    // late-morning floor so an unusually early departure doesn't push it
    // to an implausible hour.
    const lunchStart = isDepartureDay
      ? Math.max(10 * 60, Math.min(constraints.lunchMinutes, departureTravelBlock(travelContext).start - mealDuration - buffers))
      : constraints.lunchMinutes;
    addMeal(items, "lunch", lunchStart, mealDuration, mealTitle(profile, lunchRecommendation.primaryPlaceRegionId, "lunch"), lunchRecommendation, lunchRegion, input, constraints, parkRouteDay ? null : mealUsage);
  }
  // A coffee/snack break only gets its own scheduled block when the day
  // already has genuine room for it around 4:00-4:30 PM -- per explicit
  // instruction, this must never trim, delay, or otherwise touch anything
  // already scheduled. Skip entirely rather than force it in when there
  // isn't room; a real coffee run is a 5-minute drive-through pickup that
  // doesn't need its own planned slot.
  if (!isDepartureDay && !isArrivalDay && !longArrivalDrive && input.pace !== "Packed") {
    const coffeeWindow = MEAL_TIME_WINDOWS["coffee-break"];
    const coffeeDuration = 15;
    const overlapsCoffeeWindow = items.some((item) => item.startTimeMinutes < coffeeWindow.latest && item.endTimeMinutes + buffers > coffeeWindow.earliest);
    if (!overlapsCoffeeWindow) {
      items.push(simpleItem("coffee-break", coffeeWindow.earliest, coffeeDuration, "Coffee break", "A short coffee or snack stop -- grab something nearby or via drive-through; no need to plan around it."));
    }
  }
  const afterActivities = Math.max(cursor, constraints.dinnerMinutes - (input.pace === "Packed" ? 45 : 90));
  // A long-drive arrival day is already at or past a reasonable dinner hour
  // by the time check-in and the single evening-friendly activity finish;
  // a separate "reset and free time" block on top of that just pushes
  // dinner (and anything after it) later for no reason.
  if (!isDepartureDay && !longArrivalDrive && input.pace !== "Packed") {
    items.push(simpleItem("freeTime", afterActivities, input.pace === "Relaxed" ? 90 : 60, "Reset and free time", "A buffer window to rest, freshen up, or handle traffic without compressing dinner."));
  }
  const dinnerRegion = places.at(-1)?.regionId || firstRegion;
  if (isDepartureDay) {
    items.push(simpleItem("lodging", 10 * 60, 30, "Hotel checkout", "Check out, load bags, and keep the final day lighter so the return trip is not rushed."));
    const departureItem = departureTravelItem(profile, input, travelContext, travelContext.fromLabel || profile.canonicalName);
    items.push(departureItem);
    // A long return drive that already lands late in the evening should end
    // the trip at arrival, not force a generic "dinner after return" block
    // that can land near or after midnight.
    const returnDinnerCutoff = 21 * 60 + 30;
    if (departureItem.endTimeMinutes < returnDinnerCutoff) {
      const returnDinnerStart = Math.max(constraints.dinnerMinutes, departureItem.endTimeMinutes + 30);
      addMeal(items, "dinner", returnDinnerStart, input.pace === "Relaxed" ? 90 : 75, `${input.origin || "Return city"} dinner after return`, {
        primary: `Dinner near ${input.origin || "your return area"}`,
        secondary: "Choose a restaurant close to the final arrival point",
        text: `After the return trip, choose dinner near ${input.origin || "the final arrival point"} and keep the evening close to where you arrive.`,
        cuisine: "Flexible",
        price: moneyRange(mealCost(input, "dinner").low, mealCost(input, "dinner").high),
        reservation: "Keep this flexible unless you already know your arrival time."
      }, "", input, constraints, null, true);
    }
  } else {
    // cursor alone doesn't reflect the arrival day's own travel/check-in
    // items on a longArrivalDrive day specifically -- those get pushed
    // straight into `items` in the isArrivalDay branch above without
    // advancing cursor (dayPlaces stays empty on that path, so the forEach
    // loop that normally advances cursor never runs). Using cursor alone
    // here previously computed a too-early dinnerStart (~6:30 PM) even when
    // check-in itself already landed near 1 AM -- confirmed live: the
    // late-arrival check below compared against that too-early value,
    // decided the day *wasn't* late, kept a real restaurant recommendation,
    // and sortAndFormat's own overlap-avoidance then silently pushed that
    // "reserved" dinner to 12:55 AM anyway once it collided with the real
    // check-in end time. Only fold in items' own end times on that specific
    // path -- every other day already has cursor correctly tracking real
    // progress via the forEach loop, and widening this unconditionally
    // shifted dinner timing (and, through shared mealUsage/eveningUsage
    // state, later days' restaurant picks) on ordinary days that were never
    // broken.
    const dinnerStart = longArrivalDrive
      ? Math.max(constraints.dinnerMinutes, items.reduce((max, item) => Math.max(max, item.endTimeMinutes), cursor) + 10)
      : Math.max(constraints.dinnerMinutes, cursor);
    // A genuinely long single-day arrival drive (e.g. Denver -> Los Angeles,
    // ~14+ hours) can already push check-in itself past a normal dinner
    // hour -- confirmed live: hotel check-in at 11:28 PM, dinner (a real,
    // named restaurant with reservation guidance) scheduled for 12:23 AM,
    // and that fake midnight reservation then surfaced in the trip guide's
    // "Must Confirm" list. Past a late cutoff, give a flexible "wherever's
    // open near your hotel" recommendation instead of a specific restaurant
    // pick -- every day still needs a dinner entry, but it shouldn't imply
    // a bookable reservation that no traveler would actually make at
    // midnight.
    const lateArrivalCutoff = 21 * 60 + 30;
    const isLateArrivalDinner = longArrivalDrive && dinnerStart >= lateArrivalCutoff;
    const dinnerRecommendation = isLateArrivalDinner
      ? {
          primary: "Late-arrival dinner near your hotel",
          secondary: "Choose whatever's open close to check-in",
          text: "This drive lands late -- skip a planned restaurant and just find something open near the hotel. Keep it simple and confirm hours directly.",
          cuisine: "Flexible",
          price: moneyRange(mealCost(input, "dinner").low, mealCost(input, "dinner").high),
          reservation: "No reservation -- arrival timing is too late to plan around one."
        }
      : mealRecommendation(profile, input, dinnerRegion, "dinner", mealUsage, places.at(-1));
    const dinnerTitle = isLateArrivalDinner ? "Late-arrival dinner" : mealTitle(profile, dinnerRecommendation.primaryPlaceRegionId, "dinner");
    addMeal(items, "dinner", dinnerStart, input.pace === "Relaxed" ? 90 : 75, dinnerTitle, dinnerRecommendation, dinnerRegion, input, constraints, isLateArrivalDinner ? null : mealUsage, isLateArrivalDinner);
    // Arrival day already gets at most one light evening-friendly activity
    // via dayPlaces above (or none, on a long-drive day). Stacking a second,
    // independent evening block on top -- blind to how late the day already
    // ran -- is what produces post-midnight sightseeing after a long drive.
    if (!longArrivalDrive) {
      const eveningStart = dinnerStart + (input.pace === "Relaxed" ? 105 : 90);
      // A place already scheduled as a real daytime activity on an EARLIER
      // day (e.g. Day 1's headline attraction) must not resurface as a later
      // day's evening anchor -- confirmed live: Holocaust Memorial Miami
      // Beach was Day 1's 4-5:45 PM activity, then got picked again as Day
      // 2's 8-9:30 PM evening block. eveningUsage only soft-prefers unused
      // places as a sort tiebreaker; it doesn't hard-exclude a place used
      // earlier as a DAYTIME activity (only past evening picks). Union in
      // buildDays' cross-day `scheduled` set so this is a hard exclusion.
      const usedActivityIds = new Set([
        ...dayPlaces.map((place) => place.id),
        ...items.map((item) => item.placeId).filter(Boolean),
        ...priorDaysScheduled
      ]);
      const evening = eveningItem(profile, input, constraints, dinnerRegion, eveningStart, dayIndex, usedActivityIds, eveningUsage, homeRegionId);
      if (evening?.placeId) eveningUsage.set(evening.placeId, (eveningUsage.get(evening.placeId) || 0) + 1);
      if (evening.endTimeMinutes <= constraints.latestReturnMinutes || input.pace === "Packed") items.push(evening);
    } else if (isArrivalDay) {
      // A tired traveler eats first; only add a short optional walk after
      // dinner, and only if it can realistically finish at a reasonable
      // hour -- never stack a second full evening outing on top of dinner
      // after a drive this long.
      const walkPlace = places.find((place) => isArrivalEveningFriendly(place));
      const walkStart = dinnerStart + (input.pace === "Relaxed" ? 90 : 75) + 20;
      if (walkPlace && walkStart <= 21 * 60) {
        const walkActivity = activityItem(walkPlace, walkStart, constraints, 0);
        if (walkActivity.endTimeMinutes <= 22 * 60) items.push(walkActivity);
      }
    }
  }
  return sortAndFormat(items);
}

function shouldPackLunchForDay(places) {
  if (!Array.isArray(places) || places.length < 1) return false;
  const text = normalizeText(places.map((place) => `${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`).join(" "));
  const outdoorMinutes = places.reduce((sum, place) => /\b(scenic corridor|scenic drive|parkway|trail|hike|waterfall|overlook|national park|motor nature trail|loop road|gap road)\b/.test(normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`)) ? sum + Number(place.typicalDurationMinutes || 0) : sum, 0);
  return outdoorMinutes >= 180 || /\b(newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|remote trailhead|limited services)\b/.test(text);
}

function packedLunchRecommendation(profile, input, regionId) {
  const price = moneyRange(mealCost(input, "lunch").low, Math.max(mealCost(input, "lunch").low, Math.min(mealCost(input, "lunch").high, 24)));
  const region = regionName(profile, regionId);
  return {
    primary: "Packed lunch or picnic supplies",
    secondary: `${region} cafe or market before the park route`,
    primaryPlaceId: "",
    primaryPlaceRegionId: regionId,
    secondaryPlaceId: "",
    text: `Pack lunch, water, and snacks before the scenic or trail block, or buy picnic supplies near ${region} before leaving the town area. This avoids forcing a weak restaurant stop into a park route. Dietary and allergy safety must be confirmed directly when buying food.`,
    cuisine: "Flexible picnic",
    price,
    reservation: "No reservation. Buy before entering the scenic route or trail area.",
    mealTypesServed: ["lunch"],
    openingHours: "Buy supplies before the park route; confirm market or cafe hours directly.",
    routeDetour: "Designed for remote scenic or trail days with limited meal access.",
    priceLevel: price,
    dietaryFit: "Choose packed items that satisfy traveler restrictions and allergies.",
    reservationNeed: "No reservation.",
    confidence: "medium"
  };
}

function activityItem(place, start, constraints, index) {
  const classification = classifyPlaceForPlanning(place);
  const estimatedCost = costForPlace(place, classification);
  const durationMinutes = scheduledDurationForPlace(place, classification, index);
  return {
    id: uid("item"),
    type: "activity",
    startTimeMinutes: start,
    endTimeMinutes: start + durationMinutes,
    durationMinutes,
    title: place.name,
    description: place.shortDescription,
    placeId: place.id,
    regionId: place.regionId,
    neighborhood: "",
    areaLabel: "",
    locationLabel: place.name,
    category: place.categories[0] || "activity",
    tags: publicActivityTags(place, classification),
    estimatedCostPerPerson: estimatedCost,
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
    ,
    ...(classification.isBeachOrWaterfront ? { beachExperience: beachExperienceFor(place, classification) } : {})
  };
}

function publicActivityTags(place, classification = classifyPlaceForPlanning(place)) {
  const tags = Array.isArray(place.tags) ? place.tags : [];
  if (classification.isMuseum) return tags.filter((tag) => !/^museums?$/i.test(String(tag || "")));
  return tags;
}

// A "typical duration" reflects on-site time only, not the real-world
// overhead around it -- confirmed live: Statue of Liberty scheduled for
// 1h15m, which doesn't account for ferry ticketing/security, the ferry
// crossing itself, or the return trip. Layered on top of the existing
// duration (not replacing it), matching the reusable keyword-boost pattern
// already used for scoring in firstTimeVisitorValueFor
// (src/destination-intelligence.js).
const EXPERIENCE_OVERHEAD_MINUTES = [
  [/statue of liberty|ellis island|alcatraz|island ferry|ferry terminal/i, 90],
  [/empire state|one world observatory|top of the rock|skydeck|observation deck/i, 45]
];
const EXPERIENCE_OVERHEAD_CEILING_MINUTES = 300;

// Matching against shortDescription as well as name caused false positives --
// confirmed live: "The Battery" (a park with VIEWS of and ferry ACCESS to
// Liberty/Ellis Island, not the island experience itself) got its own
// description text "Ellis Island & Statue of Liberty views" matched by these
// keywords, inflating a 90-minute park stop to 190 minutes. Match on the
// place's own name only, since the overhead is specific to actually visiting
// that landmark, not places that merely mention or overlook it.
function experienceOverheadMinutes(place) {
  const text = place?.name || "";
  return EXPERIENCE_OVERHEAD_MINUTES.find(([pattern]) => pattern.test(text))?.[1] || 0;
}

function scheduledDurationForPlace(place, classification = classifyPlaceForPlanning(place), index = 0) {
  const base = Number(place.typicalDurationMinutes || 90);
  const source = place.sourceMetadata?.provider || "";
  const overhead = experienceOverheadMinutes(place);
  // A destination-scale ticketed resort park (Universal Studios Florida,
  // Islands of Adventure/Hogsmeade, Magic Kingdom, ...) needs parking,
  // security, park entry, internal transport, and ride queues on top of the
  // core visit -- treating it like an ordinary attraction produced a
  // 60-minute "Universal Studios Florida" block. This must return before the
  // normal min/max clamp below: confirmed live that flooring `adjusted` to
  // 300 there still got clamped straight back down to 165 by the place's
  // own (also-wrong) maximumDurationMinutes, since that clamp exists to
  // respect provider-set bounds for ordinary attractions, not to
  // second-guess a resort-park floor.
  if (classification.isDestinationScalePark) return Math.max(300, base, overhead ? base + overhead : 0);
  if (source === "curated" || base >= 210) return overhead ? Math.min(EXPERIENCE_OVERHEAD_CEILING_MINUTES, base + overhead) : base;
  const text = normalizeText(`${place.name} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  const seed = stableNumber(`${place.id || place.name}-${index}`);
  let adjusted = base;
  if (/short stop|viewpoint|landmark|capitol|market/.test(text)) adjusted = Math.min(adjusted, 75);
  if (classification.isMuseum) adjusted = Math.max(90, adjusted);
  if (classification.isPark || classification.isBeachOrWaterfront) adjusted = Math.max(70, adjusted);
  adjusted += ((seed % 5) - 2) * 8;
  const clamped = Math.max(35, Math.min(Number(place.maximumDurationMinutes || adjusted + 60), Math.max(Number(place.minimumDurationMinutes || 35), Math.round(adjusted / 5) * 5)));
  return overhead ? Math.min(EXPERIENCE_OVERHEAD_CEILING_MINUTES, clamped + overhead) : clamped;
}

function addMeal(items, type, start, duration, title, recommendation, regionId, input, constraints, mealUsage = null, structurallyUnbacked = false) {
  const meal = typeof recommendation === "string" ? { text: recommendation, primary: "", secondary: "", cuisine: "", price: "", reservation: "" } : recommendation;
  if (mealUsage && meal.primaryPlaceId) mealUsage.set(meal.primaryPlaceId, (mealUsage.get(meal.primaryPlaceId) || 0) + 1);
  items.push({
    id: uid("item"),
    type,
    structurallyUnbacked,
    startTimeMinutes: start,
    endTimeMinutes: start + duration,
    durationMinutes: duration,
    title,
    description: meal.text,
    mealDetails: {
      primaryOption: meal.primary,
      secondaryOption: meal.secondary,
      primaryPlaceId: meal.primaryPlaceId || "",
      secondaryPlaceId: meal.secondaryPlaceId || "",
      restaurantPlaceId: meal.primaryPlaceId || "",
      restaurantName: meal.primary || "",
      mealTypesServed: meal.mealTypesServed || [type],
      cuisine: meal.cuisine,
      openingHours: meal.openingHours || "Hours not verified; confirm directly before relying on this meal.",
      routeDetour: meal.routeDetour || "Placed near the day route area.",
      anchorDistanceMiles: Number.isFinite(meal.anchorDistanceMiles) ? meal.anchorDistanceMiles : null,
      priceLevel: meal.priceLevel || meal.price || "",
      dietaryFit: meal.dietaryFit || constraints.dietarySummary,
      reservationNeed: meal.reservationNeed || meal.reservation || "",
      confidence: meal.confidence || (meal.primaryPlaceId ? "medium" : "low"),
      priceRange: meal.price,
      reservationGuidance: meal.reservation,
      hoursConfidence: "Unverified; confirm current hours before relying on this meal."
    },
    placeId: meal.primaryPlaceId || "",
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
  const routeEstimate = normalizedArrivalRouteEstimate(input.arrivalRouteEstimate);
  // estimateArrivalRouteForGeneration (planner-actions.js) now always resolves
  // -- a live Google route on success, or an "average-estimate"-confidence
  // fallback after a retry fails -- so a populated routeEstimate no longer
  // implies it was actually live-verified. Distinguish the two explicitly.
  const isAverageEstimate = routeEstimate?.confidence === "average-estimate";
  const originCoordinates = input.fromLocation?.latitude && input.fromLocation?.longitude
    ? { lat: Number(input.fromLocation.latitude), lng: Number(input.fromLocation.longitude) }
    : knownLocationCoordinates(input.origin);
  const destinationCoordinates = input.destinationLocation?.latitude && input.destinationLocation?.longitude
    ? { lat: Number(input.destinationLocation.latitude), lng: Number(input.destinationLocation.longitude) }
    : profile.regions[0]?.centerCoordinates;
  const distance = originCoordinates && destinationCoordinates ? haversineMiles(originCoordinates.lat, originCoordinates.lng, destinationCoordinates.lat, destinationCoordinates.lng) : 0;
  const liveDriveMinutes = routeEstimate && driving && !isAverageEstimate ? routeEstimate.durationMinutes : 0;
  const averageDriveMinutes = routeEstimate && driving && isAverageEstimate ? routeEstimate.durationMinutes : 0;
  const driveMinutes = liveDriveMinutes || averageDriveMinutes || (distance ? estimatedArrivalDriveMinutes(distance) : driving ? 180 : 150);
  const routeDistance = routeEstimate?.distanceMiles || Math.round(distance);
  const estimatedFlightMinutes = distance ? Math.max(55, Math.round(distance / 7.5)) : 140;
  const flightGroundBufferMinutes = distance > 3000 ? 240 : distance > 1200 ? 195 : 150;
  const flyMinutes = Math.min(660, estimatedFlightMinutes + flightGroundBufferMinutes);
  // Flying has no live time source anywhere in this app (no flight-search API
  // is integrated), so a distance-based flight-duration guess was never
  // actually verifiable as an arrival TIME -- it just looked like a real
  // number. Use the traveler's own stated arrival/departure time when they
  // gave one (routePreferences.arrivalTime/departureTime, paired directly
  // with Start/End Date in the UI and prefilled with the same 8:00 AM/8:00 PM
  // default used below), and otherwise fall back to that clearly-disclosed
  // default instead of pretending distance/speed math produces a real ETA.
  // flyMinutes is still used as the travel block's estimated DURATION (a
  // reasonable distance-based guess is fine for "how long is this block on
  // the schedule"); it just no longer decides the CLOCK TIME everything else
  // gets anchored to.
  const defaultFlyArrivalMinutes = 8 * 60;
  const defaultFlyDepartureMinutes = 20 * 60;
  // The field is always prefilled (never blank) with the same default, so a
  // traveler who never touched it is indistinguishable from one who entered
  // exactly 8:00 AM/8:00 PM -- treat "still equals the default" as not
  // provided. This only affects which disclosure note is shown, not the
  // computed clock time, which is identical either way.
  const parsedArrivalMinutes = driving ? null : parseTimeOfDayMinutes(input.routePreferences?.arrivalTime);
  const parsedDepartureMinutes = driving ? null : parseTimeOfDayMinutes(input.routePreferences?.departureTime);
  const providedArrivalMinutes = parsedArrivalMinutes !== null && parsedArrivalMinutes !== defaultFlyArrivalMinutes ? parsedArrivalMinutes : null;
  const providedDepartureMinutes = parsedDepartureMinutes !== null && parsedDepartureMinutes !== defaultFlyDepartureMinutes ? parsedDepartureMinutes : null;
  // A very long-haul flight's total estimated travel+ground-buffer time
  // (flyMinutes) can exceed the gap between midnight and the assumed 8:00 AM
  // default arrival -- confirmed live: Charlotte -> Los Angeles (~2100mi,
  // ~477min estimate) pushed the arrival travel block's start to 12:03 AM,
  // which then failed the day-schedule-exceeds-calendar-day quality gate and
  // rejected the whole plan. Only the ASSUMED default arrival time may slip
  // later to absorb this (a traveler-provided arrival time is real
  // information and stays authoritative); the block's start floors at 4:00
  // AM and the rest of the day still agrees with whatever arrival time this
  // produces, since arrivalMinutes below is derived from the same value.
  const earliestPlausibleFlyDepartureMinutes = 4 * 60;
  const flyArrivalMinutes = providedArrivalMinutes !== null
    ? providedArrivalMinutes
    : Math.max(defaultFlyArrivalMinutes, earliestPlausibleFlyDepartureMinutes + flyMinutes);
  const arrivalMinutes = driving ? Math.min(21 * 60, 8 * 60 + driveMinutes) : flyArrivalMinutes;
  const flyEstimateType = providedArrivalMinutes !== null ? "traveler-provided-time" : "assumed-default-time";
  const flyDepartureAnchorMinutes = providedDepartureMinutes ?? defaultFlyDepartureMinutes;
  const flyDepartureEstimateType = providedDepartureMinutes !== null ? "traveler-provided-time" : "assumed-default-time";
  return {
    needsArrivalLogistics: Boolean(input.origin && !sameDestination),
    needsDepartureLogistics: Boolean(input.origin && !sameDestination && input.numberOfDays > 1),
    transportMode: driving ? "drive" : "fly",
    // For flying, the travel block's start is derived backward from the
    // honest arrival-clock-time anchor (so the block visually ends exactly
    // when the traveler said/was told they'd arrive), not the other way
    // around like the old departure-time-forward model.
    departureMinutes: driving ? 8 * 60 : Math.max(0, flyArrivalMinutes - flyMinutes),
    arrivalMinutes,
    flyMinutes,
    // Only meaningful for the departure day when flying; driving's departure
    // timing is still derived from originDriveMinutes as before.
    flyDepartureAnchorMinutes,
    flyDepartureEstimateType,
    originDriveMinutes: driveMinutes,
    originDistanceMiles: routeDistance,
    routeSource: routeEstimate?.provider || "",
    routeCheckedAt: routeEstimate?.checkedAt || routeEstimate?.retrievedAt || "",
    routeConfidence: driving
      ? (routeEstimate?.confidence || (liveDriveMinutes ? "provider" : "fallback"))
      : flyEstimateType,
    estimateType: driving
      ? (liveDriveMinutes ? "provider-route-estimate" : averageDriveMinutes ? "average-estimate" : distance ? "coordinate-arrival-estimate" : "conservative-arrival-estimate")
      : flyEstimateType
  };
}

// Parses a bare <input type="time"> value (e.g. "14:30") into minutes since
// midnight.
function parseTimeOfDayMinutes(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function knownLocationCoordinates(value) {
  if (!String(value || "").trim()) return null;
  return null;
}

// A multi-city trip's departure day travel is only ever computed via
// tripTravelContext's origin<->primary-destination distance, even when the
// traveler is actually leaving from a completely different, farther-away
// approved base (e.g. Great Smoky Mountains, not the primary Charlotte
// base) -- confirmed live: the departure item showed "Depart Charlotte" with
// Charlotte's ~2.5 hour drive time back to origin, when the real return
// drive from the actual last base would take meaningfully longer. Only used
// when the trip's departure region genuinely differs from the primary/
// default hotel region; estimateArrivalRouteForGeneration never pre-fetches
// a live route for this leg specifically, so it is always coordinate-based.
function departureFromRegionContext(profile, input, departureRegionId) {
  const region = profile.regions.find((candidate) => candidate.id === departureRegionId);
  const transportText = `${input.transportation || ""} ${input.transport?.mode || ""}`.toLowerCase();
  const driving = /drive|car|rent/.test(transportText) && !/fly/.test(transportText);
  const originCoordinates = input.fromLocation?.latitude && input.fromLocation?.longitude
    ? { lat: Number(input.fromLocation.latitude), lng: Number(input.fromLocation.longitude) }
    : knownLocationCoordinates(input.origin);
  const regionCoordinates = region?.centerCoordinates;
  const distance = originCoordinates && regionCoordinates ? haversineMiles(originCoordinates.lat, originCoordinates.lng, regionCoordinates.lat, regionCoordinates.lng) : 0;
  const driveMinutes = distance ? estimatedArrivalDriveMinutes(distance) : driving ? 180 : 150;
  const estimatedFlightMinutes = distance ? Math.max(55, Math.round(distance / 7.5)) : 140;
  const flightGroundBufferMinutes = distance > 3000 ? 240 : distance > 1200 ? 195 : 150;
  const flyMinutes = Math.min(660, estimatedFlightMinutes + flightGroundBufferMinutes);
  const parsedDepartureMinutes = driving ? null : parseTimeOfDayMinutes(input.routePreferences?.departureTime);
  const providedDepartureMinutes = parsedDepartureMinutes !== null && parsedDepartureMinutes !== 20 * 60 ? parsedDepartureMinutes : null;
  const flyDepartureAnchorMinutes = providedDepartureMinutes ?? 20 * 60;
  const flyDepartureEstimateType = providedDepartureMinutes !== null ? "traveler-provided-time" : "assumed-default-time";
  const arrivalMinutes = driving ? Math.min(21 * 60, 8 * 60 + driveMinutes) : flyDepartureAnchorMinutes;
  return {
    needsArrivalLogistics: true,
    needsDepartureLogistics: true,
    transportMode: driving ? "drive" : "fly",
    departureMinutes: driving ? 8 * 60 : Math.max(0, flyDepartureAnchorMinutes - flyMinutes),
    arrivalMinutes,
    flyMinutes,
    flyDepartureAnchorMinutes,
    flyDepartureEstimateType,
    originDriveMinutes: driveMinutes,
    originDistanceMiles: Math.round(distance),
    routeSource: "",
    routeCheckedAt: "",
    routeConfidence: driving ? (distance ? "coordinate" : "fallback") : flyDepartureEstimateType,
    estimateType: driving ? (distance ? "coordinate-arrival-estimate" : "conservative-arrival-estimate") : flyDepartureEstimateType,
    fromLabel: region?.name || profile.canonicalName
  };
}

function normalizedArrivalRouteEstimate(value) {
  if (!value || typeof value !== "object") return null;
  const rawMinutes = Number(value.durationMinutes || value.estimatedDurationMinutes || value.minutes || 0);
  const rawDistance = Number(value.distanceMiles || value.estimatedDistanceMiles || value.miles || 0);
  if (!Number.isFinite(rawMinutes) || rawMinutes < 30) return null;
  return {
    durationMinutes: Math.round(rawMinutes),
    distanceMiles: Number.isFinite(rawDistance) && rawDistance > 0 ? Math.round(rawDistance) : 0,
    provider: String(value.provider || value.source || "route-provider"),
    checkedAt: value.checkedAt || value.retrievedAt || "",
    confidence: value.confidence || "provider"
  };
}

function isArrivalEveningFriendly(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  if (Number(place.typicalDurationMinutes || 0) > 105) return false;
  if (/museum|tour|visitor center|capitol|library|zoo|estate|day trip|regional|park trail|waterfall/.test(text)) return false;
  return /neighborhood|waterfront|monument|memorial|walk|promenade|market|viewpoint|evening|sunset|district/.test(text);
}

function isDepartureFriendly(place) {
  const text = normalizeText(`${place.name} ${place.categories?.join(" ")} ${place.tags?.join(" ")}`);
  if (/full day|theme park|estate|waterfall|day trip|nearby excursion|hike|mountain|whitewater/.test(text)) return false;
  return Number(place.typicalDurationMinutes || 0) <= 120;
}

function isTimeSensitiveClosed(place, startMinutes) {
  const text = normalizeText(`${place.name} ${place.categories?.join(" ")} ${place.tags?.join(" ")}`);
  if (/boardwalk|skywheel|marshwalk|barefoot landing|broadway at the beach|oceanfront|beach walk|sunset/.test(text)) return false;
  const needsDaytime = /museum|visitor center|estate|gallery|garden|arboretum|nature center|ticket|tour/.test(text);
  return needsDaytime && startMinutes >= 17 * 60;
}

function regionalTransferContext(travel) {
  return {
    needsArrivalLogistics: true,
    needsDepartureLogistics: false,
    transportMode: "drive",
    departureMinutes: 9 * 60,
    arrivalMinutes: Math.min(21 * 60, 9 * 60 + travel.durationMinutes),
    originDriveMinutes: travel.durationMinutes,
    originDistanceMiles: travel.distanceMiles,
    routeSource: travel.estimateType || "",
    routeCheckedAt: "",
    routeConfidence: travel.estimateType === "curated-coordinate-estimate" ? "provider" : "coordinate",
    estimateType: "coordinate-arrival-estimate"
  };
}

function arrivalTravelNote(context) {
  if (context.estimateType === "provider-route-estimate") return "Provider route estimate with a conservative arrival buffer; verify live traffic before departure.";
  if (context.estimateType === "average-estimate") return `We couldn't verify live traffic data for this drive; assuming an average driving time of ${formatDuration(context.originDriveMinutes)}. Verify actual conditions before departure.`;
  if (context.estimateType === "traveler-provided-time") return "Using the arrival time you entered; verify this against your actual booking.";
  // The anchor itself (context.arrivalMinutes) can slip later than the
  // literal 8:00 AM default for a long-haul flight -- see the "very
  // long-haul flight" comment in tripTravelContext. Format the actual
  // anchor here instead of hardcoding "8:00 AM": confirmed live, a
  // long-distance trip showed a travel block ending well past 8:00 AM
  // while this note still claimed an 8:00 AM assumption, contradicting the
  // schedule the traveler could see right next to it.
  if (context.estimateType === "assumed-default-time") return `We don't have your exact flight arrival time, so we're assuming an arrival around ${formatTime(context.arrivalMinutes)} -- update this once you've booked your flight.`;
  if (context.estimateType === "coordinate-arrival-estimate") return "Estimated from straight-line distance between origin and destination; verify actual flight or drive times before booking.";
  return "No distance data available; verify actual flight or drive times before booking.";
}

function departureTravelNote(context) {
  if (context.estimateType === "provider-route-estimate") return "Provider route estimate with a conservative return buffer; verify live traffic before departure.";
  if (context.estimateType === "average-estimate") return `We couldn't verify live traffic data for this drive; assuming an average driving time of ${formatDuration(context.originDriveMinutes)}. Verify actual conditions before departure.`;
  // flyDepartureEstimateType is computed unconditionally in both
  // tripTravelContext and departureFromRegionContext (providedDepartureMinutes
  // is only ever meaningful when NOT driving, so it defaults to
  // "assumed-default-time" regardless of transport mode) -- confirmed live:
  // a driving departure from San Diego (real duration 14h28m from a
  // coordinate-based drive estimate) still showed "We don't have your exact
  // flight departure time, so we're assuming an 8:00 PM departure," because
  // this check ran before the correct coordinate-arrival-estimate fallback
  // below. Only trust it for an actual flying trip.
  if (context.transportMode !== "drive" && context.flyDepartureEstimateType === "traveler-provided-time") return "Using the departure time you entered; verify this against your actual booking.";
  if (context.transportMode !== "drive" && context.flyDepartureEstimateType === "assumed-default-time") return "We don't have your exact flight departure time, so we're assuming an 8:00 PM departure -- update this once you've booked your flight.";
  if (context.estimateType === "coordinate-arrival-estimate") return "Estimated from straight-line distance between origin and destination; verify actual flight or drive times before booking.";
  return "No distance data available; verify actual flight or drive times before booking.";
}

function arrivalTravelItem(profile, input, context, fromLabel = input.origin || "your origin", toLabel = profile.canonicalName) {
  const duration = context.transportMode === "drive" ? context.originDriveMinutes : Math.max(120, context.flyMinutes);
  const description = context.transportMode === "drive"
    ? `Drive from ${fromLabel} to ${toLabel}; includes conservative fuel, restroom, meal, parking, and arrival buffer. Assumes an ${formatTime(context.departureMinutes)} departure because no exact departure time was entered.`
    : `Arrival logistics for ${toLabel}; includes airport or station buffer, luggage, rental car or transfer pickup, and hotel approach time.`;
  return {
    ...simpleItem("travel", context.departureMinutes, duration, `Travel to ${toLabel}`, description),
    travelFromPrevious: {
      mode: context.transportMode === "drive" ? "Drive" : "Arrival transfer",
      durationMinutes: duration,
      distanceMiles: context.originDistanceMiles,
      fromLabel,
      toLabel,
      estimateType: context.estimateType,
      provider: context.routeSource,
      checkedAt: context.routeCheckedAt,
      confidence: context.routeConfidence,
      note: arrivalTravelNote(context)
    },
    replaceable: false
  };
}

function departureTravelBlock(context) {
  const duration = context.transportMode === "drive" ? Math.max(60, context.originDriveMinutes) : Math.max(120, context.flyMinutes);
  const start = context.transportMode === "drive" ? Math.max(12 * 60 + 30, 18 * 60 - duration) : Math.max(0, context.flyDepartureAnchorMinutes - duration);
  return { start, duration };
}

function departureTravelItem(profile, input, context, fromLabel = profile.canonicalName) {
  const { start, duration } = departureTravelBlock(context);
  const description = context.transportMode === "drive"
    ? `Return drive from ${fromLabel} toward ${input.origin || "your origin"} with a conservative buffer. Keep final sightseeing short unless you intentionally extend the trip.`
    : "Departure buffer for checkout, luggage, airport/station transfer, security or boarding time, and contingency.";
  return {
    ...simpleItem("travel", start, duration, `Depart ${fromLabel}`, description),
    travelFromPrevious: {
      mode: context.transportMode === "drive" ? "Drive" : "Departure transfer",
      durationMinutes: duration,
      distanceMiles: context.originDistanceMiles,
      fromLabel,
      toLabel: input.origin || "Origin",
      estimateType: context.estimateType,
      provider: context.routeSource,
      checkedAt: context.routeCheckedAt,
      confidence: context.routeConfidence,
      note: departureTravelNote(context)
    },
    replaceable: false
  };
}

const TRAVEL_MODE_COPY = {
  "Walk/Metro": { title: "Transfer", description: "Walk, Metro, or short rideshare transfer" },
  "Rideshare/Transit": { title: "Rideshare or transit", description: "Rideshare or public transit transfer" },
  Transit: { title: "Transit", description: "Public transit transfer" },
  Drive: { title: "Estimated drive", description: "Estimated drive" }
};

function travelItem(fromLabel, toLabel, start, travel) {
  const copy = TRAVEL_MODE_COPY[travel.mode] || TRAVEL_MODE_COPY.Drive;
  return {
    ...simpleItem("travel", start, travel.durationMinutes, `${copy.title} to ${toLabel}`, `${copy.description}: ${travel.durationMinutes}-${travel.durationMinutes + 15} minutes depending on traffic.`),
    travelFromPrevious: travel,
    locationLabel: `${fromLabel} to ${toLabel}`,
    replaceable: false
  };
}

// A "Fly and rent a car" (or any fly-based) trip's arrival/departure travel
// item is a flight -- comparing its duration against a "max driving per day"
// preference produces a nonsensical warning ("Estimated driving exceeds your
// 4 hour daily preference" on an 11-hour transatlantic flight day, confirmed
// live for a Denver-to-Rome trip). Ground transfers (actual driving, or a
// regional-extension base transfer that really is a drive) still belong in
// this total; only the flight-labeled arrival/departure item is excluded.
function groundTravelMinutes(scheduleItems) {
  return scheduleItems
    .filter((item) => item.type === "travel" && item.travelFromPrevious?.mode !== "Arrival transfer" && item.travelFromPrevious?.mode !== "Departure transfer")
    .reduce((sum, item) => sum + item.durationMinutes, 0);
}

function eveningItem(profile, input, constraints, regionId, start, dayIndex, usedActivityIds = new Set(), eveningUsage = new Map(), homeRegionId = null) {
  const anchor = eveningAnchorPlace(profile, input, constraints, regionId, usedActivityIds, start, eveningUsage, homeRegionId);
  if (anchor) {
    const classification = classifyPlaceForPlanning(anchor, profile, input);
    return {
      ...simpleItem("evening", start, classification.isBar ? 105 : 90, anchor.name, eveningAnchorDescription(anchor, constraints)),
      placeId: anchor.id,
      regionId: anchor.regionId,
      locationLabel: anchor.name,
      category: anchor.categories?.[0] || "evening",
      tags: [...(anchor.tags || []), "evening"],
      estimatedCostPerPerson: costForPlace(anchor, classification),
      weatherDependency: anchor.weatherDependency || (classification.isBeachOrWaterfront || classification.isBoardwalk ? "high" : "low"),
      indoorOutdoor: anchor.indoorOutdoor || (classification.isBeachOrWaterfront || classification.isBoardwalk ? "outdoor" : "mixed"),
      dietaryNotes: constraints.noAlcohol ? "No-alcohol preference applied." : "",
      reservationRecommended: Boolean(anchor.reservationRecommended && !classification.isBoardwalk && !classification.isBeachOrWaterfront),
      source: "local-evening-planner",
      ...(classification.isBeachOrWaterfront ? { beachExperience: beachExperienceFor(anchor, classification) } : {})
    };
  }
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

function eveningAnchorPlace(profile, input, constraints, regionId, usedActivityIds = new Set(), start = 19 * 60, eveningUsage = new Map(), homeRegionId = null) {
  // Daytime activity selection already refuses to let one approved
  // multi-city base's candidates leak into another base's day (see
  // belongsToAnotherApprovedBase in buildDays), but evening-anchor selection
  // searched every place in the whole merged profile regardless of region --
  // confirmed live: a Charlotte-area whitewater center got scheduled as the
  // 8 PM evening block on a day the traveler had already checked into a
  // Great Smoky Mountains hotel, hours away. Mirror the same base-isolation
  // rule daytime scheduling already uses.
  const homeIsExtensionBase = String(homeRegionId || "").startsWith("regional-ext-");
  const candidates = profile.places
    .map((place) => ({ place, classification: classifyPlaceForPlanning(place, profile, input), travel: estimateTravel(profile, regionId, place.regionId).durationMinutes }))
    .filter(({ place }) => !homeRegionId || (homeIsExtensionBase ? place.regionId === homeRegionId : !String(place.regionId || "").startsWith("regional-ext-")))
    .filter(({ classification }) => classification.isEveningAnchor || classification.isBoardwalk || classification.isBeachOrWaterfront || (!constraints.noAlcohol && classification.isBar))
    // A restaurant tagged "evening" (meaning it's a good dinner spot) trips
    // the isEveningAnchor keyword match, which would schedule it as a
    // standalone 90-minute sightseeing block right after dinner instead of
    // being the meal itself. Still allow a bar/restaurant combo through via
    // isBar, since that's a legitimate nightlife stop, not a meal masquerading
    // as an activity.
    .filter(({ classification }) => !classification.isChildrenFocused && !classification.isOrdinaryBusiness && !classification.isDinnerShow && !classification.isGamblingVenue && !classification.isSelfDescribedBackup && !((classification.isRestaurant || classification.isFoodHall) && !classification.isBar))
    .filter(({ place, classification }) => !(classification.isSportsVenue && !hasStatedInterest(input, "Sports") && !explicitlyRequestedPlace(input, place)))
    .filter(({ place, classification }) => Number(place.typicalDurationMinutes || 0) < 150 || classification.isBoardwalk || classification.isBeachOrWaterfront || classification.isBar || /evening|nightlife|dessert|rooftop|dinner|promenade|district|walk/i.test(`${place.name} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`))
    .filter(({ place }) => !usedActivityIds.has(place.id) && !isTimeSensitiveClosed(place, start))
    .sort((a, b) => {
      const regionScoreA = a.place.regionId === regionId ? 0 : a.travel;
      const regionScoreB = b.place.regionId === regionId ? 0 : b.travel;
      const usageA = eveningUsage.get(a.place.id) || 0;
      const usageB = eveningUsage.get(b.place.id) || 0;
      return usageA - usageB || regionScoreA - regionScoreB || b.place.priorityScore - a.place.priorityScore;
    });
  return candidates[0]?.place || null;
}

function eveningAnchorDescription(place, constraints) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.tags || []).join(" ")}`);
  if (/boardwalk|marshwalk|oceanfront|beach|sunset/.test(text)) {
    return `${place.shortDescription || place.name} Keep this as a conservative outdoor evening block; confirm parking, weather, and any ticketed add-ons.`;
  }
  if (/skywheel|show|live music|landing|broadway/.test(text)) {
    return `${place.shortDescription || place.name} Treat ticketed portions as conditional until current hours and tickets are confirmed; keep the surrounding public area as the backup.`;
  }
  return constraints.noAlcohol
    ? `${place.shortDescription || place.name} Use this as a no-alcohol-compatible evening anchor and skip bar-led stops.`
    : `${place.shortDescription || place.name} Confirm hours and live schedules before locking it in.`;
}

function buildBackups(profile, constraints, regionIds, primaryPlaces, scheduled, backupUsage = new Map()) {
  const primaryIds = new Set(primaryPlaces.map((place) => place.id));
  const anchorRegion = regionIds[0] || profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id || "";
  return profile.places
    .filter((place) => !primaryIds.has(place.id))
    .filter((place) => (backupUsage.get(place.id) || 0) < 2)
    .filter((place) => !constraints.minimalWalking || place.accessibility !== "limited")
    .map((place) => {
      const travel = estimateTravel(profile, anchorRegion, place.regionId);
      const classification = classifyPlaceForPlanning(place, profile, {}, { classification: travel.durationMinutes <= 45 ? "local" : travel.durationMinutes <= 90 ? "easy-day-trip" : "long-day-trip" });
      return { place, travel, classification };
    })
    .filter(({ place, travel, classification }) => {
      if (!classification.isBackupCompatible) return false;
      if (classification.isOrdinaryLocalFacility || Number(classification.ordinaryLocalFacilityPenalty?.score || 0) >= 50) return false;
      if (classification.travelerFit?.score <= -50) return false;
      if (isUrbanDestinationProfile(profile) && isRegionalExcursionPlace(place) && place.regionId !== anchorRegion) return false;
      if (isUrbanDestinationProfile(profile) && !regionIds.includes(place.regionId) && travel.durationMinutes > 25) return false;
      if (!regionIds.includes(place.regionId) && travel.durationMinutes > 45) return false;
      return true;
    })
    .sort((a, b) => (backupUsage.get(a.place.id) || 0) - (backupUsage.get(b.place.id) || 0) || (b.place.indoorOutdoor === "indoor") - (a.place.indoorOutdoor === "indoor") || b.place.priorityScore - a.place.priorityScore)
    .map(({ place, travel }) => ({
      id: uid("backup"),
      title: place.name,
      description: publicPlaceDescription(place.shortDescription),
      placeId: place.id,
      reason: place.indoorOutdoor === "indoor" ? `Indoor alternative in the same local cluster, about ${travel.durationMinutes} minutes away.` : constraints.minimalWalking ? "Lower-walking alternative near the same route." : `Nearby replacement in the same local cluster, about ${travel.durationMinutes} minutes away.`,
      indoorOutdoor: place.indoorOutdoor,
      estimatedDurationMinutes: place.typicalDurationMinutes,
      estimatedCostPerPerson: { low: place.estimatedCostLow, high: place.estimatedCostHigh },
      accessibilityNotes: accessibilityNote(place, constraints)
    }))
    .slice(0, 2);
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
        const meal = mealRecommendation(profile, input, item.regionId || item.neighborhood || profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id || "", item.type);
        return { ...item, description: meal.text, mealDetails: { ...(item.mealDetails || {}), primaryOption: meal.primary, secondaryOption: meal.secondary, cuisine: meal.cuisine, priceRange: meal.price, reservationGuidance: meal.reservation }, dietaryNotes: constraints.dietarySummary };
      });
    });
    refreshPlanTotals(draft, profile);
  });
}

export function regeneratePlanPreservingLocks(plan) {
  const profile = resolvePlanProfile(plan);
  registerGeneratedDestinationProfile(profile);
  const input = { ...plan.preferencesSnapshot, variationSeed: (plan.generationMetadata.variationSeed || 0) + 7 };
  const tripLike = denormalizedTrip(input);
  const next = generateTripPlan(tripLike, { variationSeed: input.variationSeed, destinationProfileId: profile.id });
  if (next.status !== "ready") return plan;
  const draft = next.plan;
  const lockedDaySnapshots = new Map();
  plan.days.forEach((day, index) => {
    if (day.locked) {
      const snapshot = structuredClone(day);
      lockedDaySnapshots.set(index, snapshot);
      draft.days[index] = snapshot;
    }
    else {
      const locked = day.scheduleItems.filter((item) => item.locked || item.mustDo || item.customItem);
      if (locked.length && draft.days[index]) draft.days[index].scheduleItems = [...locked, ...draft.days[index].scheduleItems];
    }
  });
  refreshPlanTotalsPreservingLockedDays(draft, resolvePlanProfile(draft), lockedDaySnapshots);
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
  day.dailyDriveMinutes = groundTravelMinutes(day.scheduleItems);
  day.dailyBudget = estimateDayBudget(input, day.scheduleItems);
  day.warnings = validateDay(day).map((warning) => warning.message);
}

function refreshPlanTotals(plan, profile) {
  const constraints = buildTravelerConstraintProfile(plan.preferencesSnapshot);
  const hotelBase = buildHotelBase(profile, plan.preferencesSnapshot, plan.days);
  plan.hotelBase = hotelBase;
  plan.days = buildDetailedTripDays(profile, plan.preferencesSnapshot, constraints, plan.days, hotelBase);
  applyGeographicState(profile, plan.preferencesSnapshot, plan.days);
  plan.routeSummary = buildRouteSummary(profile, plan.days);
  plan.budgetSummary = buildBudgetSummary(plan.preferencesSnapshot, plan.days);
  plan.foodPlan = buildFoodPlan(profile, plan.preferencesSnapshot, constraints, plan.days);
  plan.advisories = buildAdvisories(profile, plan.preferencesSnapshot, constraints, plan.days, plan.budgetSummary);
  const intelligence = buildDestinationIntelligence(profile, plan.preferencesSnapshot, constraints);
  const tripShapeOptions = plan.generationMetadata?.tripShapeOptions || buildTripShapeOptions(profile, plan.preferencesSnapshot, intelligence);
  plan.tripGuide = buildDetailedTripGuide(profile, plan.preferencesSnapshot, constraints, plan.days, hotelBase, plan.routeSummary, plan.budgetSummary, tripShapeOptions);
  plan.overview = buildOverview(profile, plan.preferencesSnapshot, plan.days, plan.budgetSummary, plan.routeSummary);
}

function refreshPlanTotalsPreservingLockedDays(plan, profile, lockedDaySnapshots) {
  if (!lockedDaySnapshots?.size) {
    refreshPlanTotals(plan, profile);
    return;
  }
  const constraints = buildTravelerConstraintProfile(plan.preferencesSnapshot);
  const hotelBase = buildHotelBase(profile, plan.preferencesSnapshot, plan.days);
  plan.hotelBase = hotelBase;
  plan.days = plan.days.map((day, index) => lockedDaySnapshots.get(index) || day);
  plan.routeSummary = buildRouteSummary(profile, plan.days);
  plan.budgetSummary = buildBudgetSummary(plan.preferencesSnapshot, plan.days);
  plan.foodPlan = buildFoodPlan(profile, plan.preferencesSnapshot, constraints, plan.days);
  plan.advisories = buildAdvisories(profile, plan.preferencesSnapshot, constraints, plan.days, plan.budgetSummary);
  const intelligence = buildDestinationIntelligence(profile, plan.preferencesSnapshot, constraints);
  const tripShapeOptions = plan.generationMetadata?.tripShapeOptions || buildTripShapeOptions(profile, plan.preferencesSnapshot, intelligence);
  plan.tripGuide = buildDetailedTripGuide(profile, plan.preferencesSnapshot, constraints, plan.days, hotelBase, plan.routeSummary, plan.budgetSummary, tripShapeOptions);
  plan.overview = buildOverview(profile, plan.preferencesSnapshot, plan.days, plan.budgetSummary, plan.routeSummary);
}

function applyGeographicState(profile, input, days) {
  days.forEach((day, dayIndex) => {
    let currentLocation = dayIndex === 0 && !sameAreaTrip(input, profile) ? input.origin || "Origin" : day.hotel || profile.canonicalName;
    let departedPrimary = false;
    day.scheduleItems = day.scheduleItems.map((item, itemIndex) => {
      const place = item.placeId ? profile.places.find((candidate) => candidate.id === item.placeId) : null;
      const region = item.regionId ? profile.regions.find((candidate) => candidate.id === item.regionId) : null;
      const before = currentLocation;
      const travel = item.travelFromPrevious || null;
      if (item.type === "travel" && travel?.toLabel) {
        currentLocation = travel.toLabel;
        const destinationCity = normalizeText(profile.canonicalName.split(",")[0]);
        const originLabel = normalizeText(input.origin || "");
        const toLabel = normalizeText(travel.toLabel);
        if (item.title?.startsWith("Depart ") || originLabel && toLabel.includes(originLabel) || destinationCity && /^depart /.test(normalizeText(item.title))) departedPrimary = true;
      } else if (place) {
        currentLocation = place.name;
      } else if (region) {
        currentLocation = region.name;
      } else if (item.type === "dinner" && dayIndex === days.length - 1 && !sameAreaTrip(input, profile)) {
        currentLocation = input.origin || currentLocation;
        departedPrimary = true;
      }
      const after = currentLocation;
      return {
        ...item,
        placeId: item.placeId || "",
        coordinates: place?.coordinates || region?.centerCoordinates || null,
        city: cityForItem(profile, input, item, place, region, departedPrimary),
        region: region?.name || item.region || "",
        currentLocationBefore: before,
        currentLocationAfter: after,
        travelDuration: travel?.durationMinutes || 0,
        travelDistance: travel?.distanceMiles || 0,
        overnightBase: day.hotel || "",
        hasDepartedPrimaryDestination: departedPrimary,
        tripCompleted: dayIndex === days.length - 1 && itemIndex === day.scheduleItems.length - 1
      };
    });
  });
}

function cityForItem(profile, input, item, place, region, departedPrimary) {
  if (departedPrimary || item.title?.includes("after return")) return input.origin || "";
  const canonicalCity = profile.canonicalName.split(",")[0].trim();
  const text = normalizeText(`${place?.name || ""} ${region?.name || ""} ${item.locationLabel || ""}`);
  const source = String(place?.sourceMetadata?.retrievedName || place?.name || region?.name || item.locationLabel || "");
  const sourceCity = source.split(",")[0].trim();
  if (sourceCity && sourceCity.length > 2 && !normalizeText(sourceCity).includes("route")) return sourceCity;
  if (text.includes(normalizeText(canonicalCity))) return canonicalCity;
  return canonicalCity;
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
  const orderedRegions = [...new Set(days.flatMap((day) => [
    day.region,
    ...day.scheduleItems
      .filter((item) => item.type === "activity" && item.regionId)
      .map((item) => regionName(profile, item.regionId))
  ].filter(Boolean)))];
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
    mapStops: buildRouteMapStops(profile, days),
    trafficDisclaimer: "Drive times are planning estimates only; they are not live traffic predictions."
  };
}

function buildRouteMapStops(profile, days) {
  // A day's region can be a broad container (e.g. a regional day-trip
  // extension bundling several distant attractions under one region id) --
  // confirmed live: a Colorado trip's "Boulder" day actually scheduled Rocky
  // Mountain National Park and Roxborough State Park, 60+ miles apart and
  // nowhere near Boulder itself, yet the map pinned that day at the region's
  // static center coordinate regardless. Pin each day at the centroid of its
  // OWN scheduled activities instead -- that's where the traveler is
  // actually going -- and only fall back to the region center for a day
  // with no coordinated activities (e.g. a rest or travel-only day).
  const groups = [];
  for (const day of days) {
    const region = profile.regions.find((item) => item.id === day.regionId);
    const dayCoordinates = day.scheduleItems
      .filter((item) => item.type === "activity" && item.coordinates && Number.isFinite(item.coordinates.lat) && Number.isFinite(item.coordinates.lng))
      .map((item) => item.coordinates);
    if (!dayCoordinates.length && !region?.centerCoordinates) continue;
    const last = groups[groups.length - 1];
    if (last && last.regionId === day.regionId) {
      last.endDay = day.dayNumber;
      last.coordinates.push(...dayCoordinates);
    } else {
      groups.push({
        regionId: day.regionId,
        regionName: region?.name || day.region,
        startDay: day.dayNumber,
        endDay: day.dayNumber,
        coordinates: dayCoordinates,
        fallbackCoordinates: region?.centerCoordinates || null
      });
    }
  }
  return groups.map((group) => {
    const center = group.coordinates.length ? centroid(group.coordinates) : group.fallbackCoordinates;
    return {
      label: group.startDay === group.endDay ? `Day ${group.startDay}` : `Day ${group.startDay}-${group.endDay}`,
      regionName: group.regionName,
      lat: center.lat,
      lng: center.lng
    };
  });
}

function centroid(points) {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length
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
  if ((input.approvedTripShape?.hotelBases || []).length > 1 && !resolveApprovedTripShapeSchedule(profile, input)) {
    advisories.push(advisory("approved-route-not-honored", "caution", "route", "Approved multi-city route could not be applied", "The multi-city route you approved on the Review step could not be matched to researched destination data for every approved city, so a single-base itinerary was generated instead.", "Regenerate after confirming destination research succeeded for every approved city, or adjust the approved route."));
  }
  days.forEach((day) => {
    if (day.dailyDriveMinutes > input.maxDrivingMinutes) advisories.push(advisory(`drive-${day.id}`, "caution", "route", `Day ${day.dayNumber} may exceed driving comfort`, `Estimated driving is ${formatDuration(day.dailyDriveMinutes)}.`, "Remove or replace one distant stop."));
    if (!day.backupOptions.length && day.scheduleItems.some((item) => item.weatherDependency === "high")) advisories.push(advisory(`backup-${day.id}`, "caution", "weather", `Day ${day.dayNumber} needs a backup`, "This outdoor-heavy day has limited same-region indoor backups.", "Keep the day flexible if weather is poor."));
    // A meal's own scheduling logic never enforces an upper bound on how
    // late a cascading day can push it (see the long-arrival-drive and
    // transfer-day fixes this session) -- rather than trim content
    // automatically, surface any meal that lands outside its normal window
    // as a warning so the traveler can decide whether to cut an earlier
    // stop or move the meal later themselves.
    day.scheduleItems.filter((item) => MEAL_TIME_WINDOWS[item.type]).forEach((item) => {
      const window = MEAL_TIME_WINDOWS[item.type];
      if (item.startTimeMinutes >= window.earliest && item.startTimeMinutes <= window.latest) return;
      const mealName = titleCase(item.type);
      advisories.push(advisory(
        `meal-window-${item.id}`,
        "caution",
        "schedule",
        `Day ${day.dayNumber} ${mealName.toLowerCase()} is outside the usual window`,
        `${mealName} is scheduled at ${formatTime(item.startTimeMinutes)}, outside the ${window.label} window.`,
        "Consider trimming an earlier stop or moving this meal later.",
        day.id,
        item.id
      ));
    });
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

function approvedTripShapeOptionCard(profile, input, schedule) {
  const sequenceNames = schedule.bases.map((base) => base.name);
  return tripShapeOption({
    id: "shape-approved",
    title: `Approved route: ${sequenceNames.join(" → ")}`,
    structureType: "Approved multi-city route",
    recommended: true,
    routeSequence: sequenceNames,
    overnightBases: schedule.bases.map((base) => ({ base: base.name, nights: base.nights })),
    hotelChanges: schedule.hotelChanges,
    majorTransferDays: [...schedule.transferDayIndexes].sort((a, b) => a - b).map((dayIndex) => `Day ${dayIndex + 1}: transfer to ${regionName(profile, schedule.dayRegionIds[dayIndex])}`),
    totalEstimatedDriving: "See day-by-day itinerary for transfer drive times",
    totalMajorDriving: 0,
    longestDrivingDay: "See day-by-day itinerary for transfer drive times",
    fullSightseeingDays: Math.max(0, input.numberOfDays - schedule.transferDayIndexes.size),
    arrivalAssumptions: "This is the route you approved on the Review step; the itinerary follows it directly.",
    departureAssumptions: "Departure logistics are handled from the final approved base.",
    experienceMix: `Follows your approved sequence across ${sequenceNames.join(", ")}.`,
    advantages: ["Matches the route you explicitly approved on the Review step"],
    tradeoffs: schedule.hotelChanges ? [`${schedule.hotelChanges} hotel change${schedule.hotelChanges === 1 ? "" : "s"}`, "Luggage/check-out/check-in time required on transfer days"] : [],
    costImpact: "Reflects the approved route's lodging and transfer plan.",
    whyItFitsUser: "This is the trip shape you reviewed and approved before generation.",
    confidence: 100
  });
}

function buildTripShapeOptions(profile, input, intelligence) {
  const approvedSchedule = resolveApprovedTripShapeSchedule(profile, input);
  if (approvedSchedule) return [approvedTripShapeOptionCard(profile, input, approvedSchedule)];
  if ((intelligence?.destinationArchetype?.primaryArchetype === "mountain" || intelligence?.destinationArchetype?.primaryArchetype === "national park") && intelligence?.regionalDestinationProfile) {
    return buildRegionalMountainTripShapeOptions(profile, input, intelligence);
  }
  const coreRegions = profile.regions.slice(0, Math.min(3, profile.regions.length)).map((region) => region.name);
  const dayTrips = (intelligence?.nearbyDayTrips || [])
    .filter((item) => ["local", "easy-day-trip"].includes(item.routeFeasibility?.classification))
    .slice(0, 3);
  const overnight = (intelligence?.regionalOvernightExtensions || [])[0];
  const base = profile.regions.find((region) => region.id === profile.planningRules.defaultHotelRegion) || profile.regions[0];
  const maxSightseeingDays = Math.max(1, input.numberOfDays - (input.transportation && !sameAreaTrip(input, profile) ? 2 : 0));
  const dayTripRoundTripMinutes = dayTrips.reduce((sum, item) => sum + Number(item.routeFeasibility?.estimatedRoundTripMinutes || 0), 0);
  const options = [
    tripShapeOption({
      id: "shape-single-base",
      title: "City-focused base with selective nearby nature",
      structureType: dayTrips.length ? "One base plus local day trips" : "Single-city depth",
      routeSequence: [profile.canonicalName, ...dayTrips.map((item) => item.place.name)],
      overnightBases: [{ base: base?.name || profile.canonicalName, nights: Math.max(0, calculateTripNights(input.numberOfDays)) }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${Math.round((dayTripRoundTripMinutes + input.numberOfDays * 25) / 60)}-${Math.round((dayTripRoundTripMinutes + input.numberOfDays * 45) / 60)} hours`,
      totalMajorDriving: dayTripRoundTripMinutes,
      longestDrivingDay: dayTrips[0] ? `${dayTrips[0].place.name} day, about ${formatDuration(dayTrips[0].routeFeasibility?.estimatedRoundTripMinutes || 0)}` : "Local days only",
      fullSightseeingDays: maxSightseeingDays,
      arrivalAssumptions: "Keep first day lighter until arrival, car pickup, luggage, and check-in are complete.",
      departureAssumptions: "Protect departure buffers and avoid deep visits after checkout.",
      experienceMix: experienceMixSummary(profile, dayTrips),
      advantages: ["Least lodging friction", "Easy to understand", "Keeps optional regional ideas controllable"],
      tradeoffs: dayTrips.length ? ["Some longer out-and-back days", "Distant extensions may be better as a split stay"] : ["Less regional variety"],
      costImpact: "Lowest lodging-change cost; day-trip fuel or transit may increase.",
      whyItFitsUser: `${input.pace} pace with ${input.travelers} traveler${input.travelers === 1 ? "" : "s"} favors a reliable base before adding optional distance.`,
      confidence: dayTrips.length || profile.places.length >= input.numberOfDays * 2 ? "high" : "medium"
    })
  ];
  if (overnight && input.numberOfDays >= 4) {
    const overnightRoundTrip = Number(overnight.routeFeasibility?.estimatedRoundTripMinutes || 0);
    const overnightBaseName = (profile.regions.find((region) => region.id === overnight.place.regionId)?.name) || overnight.place.name;
    options.push(tripShapeOption({
      id: "shape-regional-extension",
      title: "Regional extension with one optional second base",
      structureType: "One base plus one overnight extension",
      routeSequence: [profile.canonicalName, overnightBaseName, profile.canonicalName],
      overnightBases: [
        { base: base?.name || profile.canonicalName, nights: Math.max(1, calculateTripNights(input.numberOfDays) - 1) },
        { base: overnightBaseName, nights: 1 }
      ],
      hotelChanges: 1,
      majorTransferDays: [`Transfer to ${overnightBaseName}`, `Return from ${overnightBaseName}`],
      totalEstimatedDriving: `${formatDuration(overnightRoundTrip + 90)} plus local driving`,
      totalMajorDriving: overnightRoundTrip,
      longestDrivingDay: `${overnightBaseName}, about ${formatDuration(overnightRoundTrip)} (via ${overnight.place.name})`,
      fullSightseeingDays: Math.max(1, maxSightseeingDays - 1),
      arrivalAssumptions: "Primary destination first, then extension after the trip has momentum.",
      departureAssumptions: "Return to the departure base before the final travel day unless open-jaw travel is confirmed.",
      experienceMix: `City anchors plus ${overnight.place.categories?.[0] || "regional"} extension.`,
      advantages: ["More memorable regional variety", "Reduces one very long out-and-back day"],
      tradeoffs: ["Adds packing and hotel-change overhead", "Needs explicit approval before booking"],
      costImpact: "Higher lodging and transit friction; may be worth it for longer vacations.",
      whyItFitsUser: "Useful only if the traveler values regional nature or a distinct second base more than simplicity.",
      confidence: overnight.routeFeasibility.classification === "overnight-recommended" ? "high" : "medium"
    }));
  }
  if (coreRegions.length >= 2) {
    options.push(tripShapeOption({
      id: "shape-core-depth",
      title: "City-depth route with minimal regional driving",
      structureType: "Single-city depth",
      routeSequence: coreRegions,
      overnightBases: [{ base: base?.name || profile.canonicalName, nights: Math.max(0, calculateTripNights(input.numberOfDays)) }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${formatDuration(input.numberOfDays * 30)}-${formatDuration(input.numberOfDays * 55)} local movement`,
      totalMajorDriving: input.numberOfDays * 42,
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
    }));
  }
  if (isUrbanDestinationProfile(profile) && options.length < 3) {
    const neighborhoodRegions = profile.regions
      .filter((region) => /neighborhood|waterfront|market|district|arts|food|evening|old town|wharf|river/i.test(`${region.name} ${region.summary || ""} ${(region.tags || []).join(" ")}`))
      .map((region) => region.name)
      .slice(0, 4);
    options.push(tripShapeOption({
      id: "shape-neighborhood-evening-depth",
      title: "Signature sights plus neighborhood evenings",
      structureType: "Single-city depth",
      routeSequence: [profile.canonicalName, ...(neighborhoodRegions.length ? neighborhoodRegions : coreRegions)],
      overnightBases: [{ base: base?.name || profile.canonicalName, nights: Math.max(0, calculateTripNights(input.numberOfDays)) }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${formatDuration(input.numberOfDays * 20)}-${formatDuration(input.numberOfDays * 45)} local movement`,
      totalMajorDriving: input.numberOfDays * 32,
      longestDrivingDay: "No intentional regional excursion unless explicitly approved",
      fullSightseeingDays: maxSightseeingDays,
      arrivalAssumptions: "Use arrival evening for a simple neighborhood or waterfront orientation, not heavy sightseeing.",
      departureAssumptions: "Keep the final morning short and close to the base.",
      experienceMix: `Balances first-time anchors with ${neighborhoodRegions.slice(0, 3).join(", ") || "walkable neighborhoods and evening areas"}.`,
      advantages: ["More local texture", "Better evening flow", "Lower backtracking than scattered regional stops"],
      tradeoffs: ["Less nature or out-of-city variety"],
      costImpact: "Usually lower transport burden; dining choices drive cost more than attractions.",
      whyItFitsUser: "A balanced urban trip benefits from famous sights by day and walkable neighborhoods in the evening.",
      confidence: "medium"
    }));
  }
  return options.slice(0, 3);
}

function buildRegionalMountainTripShapeOptions(profile, input, intelligence) {
  const regional = intelligence.regionalDestinationProfile;
  const base = profile.regions.find((region) => region.id === profile.planningRules.defaultHotelRegion) || profile.regions[0];
  const gatewayNames = regional.gatewayTowns?.length ? regional.gatewayTowns : [base?.name || profile.canonicalName];
  const scenicAnchors = (intelligence.scenicDrives || []).filter((item) => ["local", "easy-day-trip"].includes(item.routeFeasibility?.classification)).slice(0, 4);
  const entertainment = (intelligence.entertainmentAnchors || []).filter((item) => ["local", "easy-day-trip"].includes(item.routeFeasibility?.classification)).slice(0, 3);
  const overnight = (intelligence.regionalOvernightExtensions || [])[0];
  const nights = Math.max(0, calculateTripNights(input.numberOfDays));
  const scenicMinutes = scenicAnchors.reduce((sum, item) => sum + Number(item.routeFeasibility?.estimatedRoundTripMinutes || 0), 0);
  const options = [
    tripShapeOption({
      id: "shape-regional-gateway-base",
      title: `${gatewayNames[0]} base with connected regional days`,
      structureType: "One base plus connected regional day trips",
      routeSequence: [gatewayNames[0], ...scenicAnchors.slice(0, 2).map((item) => item.place.name), ...entertainment.slice(0, 1).map((item) => item.place.name)],
      overnightBases: [{ base: base?.name || gatewayNames[0], nights }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${formatDuration(scenicMinutes + input.numberOfDays * 20)}-${formatDuration(scenicMinutes + input.numberOfDays * 40)} including scenic-route days`,
      totalMajorDriving: scenicMinutes,
      longestDrivingDay: scenicAnchors[0] ? `${scenicAnchors[0].place.name}, about ${formatDuration(scenicAnchors[0].routeFeasibility?.estimatedRoundTripMinutes || scenicAnchors[0].place.typicalDurationMinutes || 0)} with stops` : "Local gateway days only",
      fullSightseeingDays: Math.max(1, input.numberOfDays - 2),
      arrivalAssumptions: "Keep arrival light, then use full middle days for park/scenic/town clusters.",
      departureAssumptions: "Protect departure buffers and avoid a deep park route after checkout.",
      experienceMix: `Gateway town depth, scenic corridors, waterfalls or trails, and ${entertainment[0]?.place.name || "evening entertainment"}.`,
      advantages: ["No hotel changes", "Uses the connected tourism region", "Keeps park days weather-aware"],
      tradeoffs: ["Some out-and-back scenic driving", "Remote routes need offline maps and packed meals"],
      costImpact: "Lower lodging friction; parking, fuel, and ticketed mountain attractions may vary.",
      whyItFitsUser: `${input.pace} pace with ${input.travelers} traveler${input.travelers === 1 ? "" : "s"} favors a practical base and selected regional variety.`,
      confidence: regional.regionalConfidence || "medium"
    }),
    tripShapeOption({
      id: "shape-gateway-plus-entertainment",
      title: `${gatewayNames.slice(0, 2).join(" + ") || "Gateway towns"} with entertainment balance`,
      structureType: "One base, town-to-town regional mix",
      routeSequence: [...gatewayNames.slice(0, 2), ...entertainment.map((item) => item.place.name)],
      overnightBases: [{ base: base?.name || gatewayNames[0], nights }],
      hotelChanges: 0,
      majorTransferDays: ["Arrival day", input.numberOfDays > 1 ? "Departure day" : ""].filter(Boolean),
      totalEstimatedDriving: `${formatDuration(input.numberOfDays * 30)}-${formatDuration(input.numberOfDays * 55)} local and gateway movement`,
      totalMajorDriving: input.numberOfDays * 42,
      longestDrivingDay: "No intentionally extreme transfer day",
      fullSightseeingDays: Math.max(1, input.numberOfDays - 2),
      arrivalAssumptions: "Start with the selected town, then add nearby connected towns only when they improve the trip.",
      departureAssumptions: "End with a light town or cafe block.",
      experienceMix: "Town attractions, meals, cafes, evenings, and one scenic or waterfall day.",
      advantages: ["More food and evening variety", "Easy to cut if tired", "No silent second base"],
      tradeoffs: ["Less deep park coverage than the scenic-first option"],
      costImpact: "Moderate ticket and meal flexibility.",
      whyItFitsUser: "Useful when the traveler wants regional feel without overloading driving.",
      confidence: "medium"
    })
  ];
  if (overnight && input.numberOfDays >= 6 && input.lodging?.changeHotels !== "Stay in one place") {
    options.push(tripShapeOption({
      id: "shape-regional-extension",
      title: "Broader mountain-region extension with approval",
      structureType: "Optional second base",
      routeSequence: [gatewayNames[0], overnight.place.name],
      overnightBases: [{ base: base?.name || gatewayNames[0], nights: Math.max(1, nights - 1) }, { base: overnight.place.name, nights: 1 }],
      hotelChanges: 1,
      majorTransferDays: [`Transfer to ${overnight.place.name}`],
      totalEstimatedDriving: `${formatDuration(Number(overnight.routeFeasibility?.estimatedRoundTripMinutes || 0) + 120)} plus local driving`,
      totalMajorDriving: Number(overnight.routeFeasibility?.estimatedRoundTripMinutes || 0),
      longestDrivingDay: `${overnight.place.name}, about ${formatDuration(overnight.routeFeasibility?.estimatedRoundTripMinutes || 0)}`,
      fullSightseeingDays: Math.max(1, input.numberOfDays - 3),
      arrivalAssumptions: "Requires explicit approval before daily scheduling.",
      departureAssumptions: "Avoid adding this when the traveler wants zero hotel changes.",
      experienceMix: "Broader region variety with more transfer burden.",
      advantages: ["More regional variety"],
      tradeoffs: ["Adds packing, lodging, and route friction"],
      costImpact: "Higher lodging and transfer cost.",
      whyItFitsUser: "Only fits longer trips or explicit extension interest.",
      confidence: "medium"
    }));
  }
  return options.slice(0, 3);
}

function tripShapeOption(option) {
  return {
    ...option,
    name: option.name || option.title,
    sequence: option.routeSequence,
    nightsPerBase: option.overnightBases,
    benefits: option.advantages,
    totalMajorDriving: option.totalMajorDriving ?? 0
  };
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
      routeOrLocation: dayRouteLabel(profile, day, input, index, hotelBase),
      startingBase: index === 0 && !sameAreaTrip(input, profile) ? input.origin || "Origin" : (hotelBase.forDay ? hotelBase.forDay(index) : hotelBase.primary),
      endingBase: index === input.numberOfDays - 1 && !sameAreaTrip(input, profile) ? input.origin || "Origin" : (hotelBase.forDay ? hotelBase.forDay(index) : hotelBase.primary),
      hotel: index === input.numberOfDays - 1 && !sameAreaTrip(input, profile) ? "Departure / home base" : (hotelBase.forDay ? hotelBase.forDay(index) : hotelBase.primary),
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
      "Plans use provider destination research and traveler inputs, but hours, traffic, ticket prices, menus, and availability still require direct verification.",
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

const INTERNAL_ID_KEYS = new Set(["id", "placeId", "regionId", "dayId", "itemId", "destinationProfileId", "sourceTripId", "originRegionId", "destinationRegionId", "candidateId"]);

function publicFacingPlanText(plan) {
  return JSON.stringify({
    overview: plan.overview,
    days: plan.days,
    foodPlan: plan.foodPlan,
    routeSummary: plan.routeSummary,
    hotelBase: plan.hotelBase,
    tripGuide: plan.tripGuide
  }, (key, value) => (INTERNAL_ID_KEYS.has(key) ? undefined : value));
}

export function validateTripPlan(plan) {
  const blocking = [];
  const profile = resolvePlanProfile(plan);
  const input = plan.preferencesSnapshot || {};
  const publicText = publicFacingPlanText(plan);
  const internalLeak = internalOutputTerms().find((term) => publicText.toLowerCase().includes(term));
  if (internalLeak) blocking.push(advisory("internal-language", "blocking", "content", "Internal planning language leaked", "Generated itinerary includes internal provider or taxonomy wording.", "Regenerate with sanitized destination data."));
  if (plan.days.length !== plan.numberOfDays) blocking.push(advisory("day-count", "blocking", "dates", "Incorrect day count", "Generated day count does not match the inclusive trip length.", "Regenerate after fixing dates."));
  if (plan.generationMetadata?.destinationArchetype?.primaryArchetype === "beach/coastal" && !userRejectedBeach(input)) {
    const beachItems = plan.days.flatMap((day) => day.scheduleItems).filter((item) => item.beachExperience || /beach|boardwalk|oceanfront|waterfront|marshwalk/.test(normalizeText(`${item.title} ${item.category} ${(item.tags || []).join(" ")}`)));
    if (!beachItems.length) {
      blocking.push(advisory("beach-archetype-coverage", "blocking", "destination-fit", "Beach/coastal plan is missing beach or waterfront time", "A beach/coastal destination must include a real beach, waterfront, boardwalk, or coastal block unless the user rejected beach activities.", "Regenerate with a destination-defining beach or waterfront block."));
    }
  }
  if (hasUniformGenericPricing(plan)) {
    blocking.push(advisory("generic-pricing", "blocking", "budget", "Generic repeated pricing detected", "The itinerary uses repeated generic attraction price ranges instead of category-appropriate estimates.", "Regenerate with destination- and category-aware cost ranges."));
  }
  if (isProviderGeneratedPlan(plan) && hasRepeatedDurationPattern(plan)) {
    blocking.push(advisory("generic-duration", "blocking", "schedule", "Repeated generic durations detected", "The itinerary repeats the same duration across unrelated primary activities.", "Regenerate with place-specific duration estimates."));
  }
  if (hasRepeatedMealPattern(plan)) {
    blocking.push(advisory("meal-repetition", "blocking", "food", "Repeated restaurant pattern detected", "The itinerary repeats the same meal venue or relies on generic dining labels too often.", "Regenerate with route-specific restaurants for each meal."));
  }
  if (hasTemplatePublicLanguage(plan)) {
    blocking.push(advisory("template-language", "blocking", "quality", "Template planning language reached the itinerary", "The itinerary exposes generic region labels or placeholder recommendation wording instead of visitor-ready planning language.", "Regenerate after stronger destination normalization."));
  }
  if (hasDuplicateDaytimeEvening(plan)) {
    blocking.push(advisory("duplicated-evening", "blocking", "evening", "Evening repeats daytime activity", "A daytime activity is reused as evening filler on the same day.", "Regenerate with distinct verified evening options."));
  }
  if (hasImplausibleArrivalDrive(plan)) {
    blocking.push(advisory("arrival-route-implausible", "blocking", "route", "Arrival route is implausible", "The arrival or return drive is unrealistically short for the selected origin and destination.", "Regenerate with a reliable route provider estimate."));
  }
  const rawLabel = plan.days.flatMap((day) => day.scheduleItems).find((item) => item.placeId && isRawPlaceLabel(item.title));
  if (rawLabel) {
    blocking.push(advisory("raw-place-label", "blocking", "destination-fit", "Raw map label reached the itinerary", `${rawLabel.title} is not a visitor-ready attraction name.`, "Regenerate with meaningful canonical place names only."));
  }
  const coverageFailures = plan.generationMetadata?.opportunityCoverageValidation?.hardFailures || [];
  coverageFailures.forEach((failure) => {
    blocking.push(advisory(`opportunity-coverage-${failure}`, "blocking", "destination-fit", "Destination opportunity coverage is incomplete", `The planner could not prove required destination candidate coverage: ${failure}.`, "Regenerate after destination research returns stronger candidates."));
  });
  const criticFailures = plan.generationMetadata?.qualityCritique?.hardFailures || [];
  criticFailures.forEach((failure) => {
    blocking.push(advisory(`quality-critic-${failure}`, "blocking", "quality", "Quality critic rejected the itinerary", `The independent planner critic found a hard failure: ${failure}.`, "Regenerate with stricter candidate selection and scheduling constraints."));
  });
  plan.days.forEach((day) => {
    if (!day.date) blocking.push(advisory(`date-${day.id}`, "blocking", "dates", `Day ${day.dayNumber} missing date`, "Every generated day must have a date.", "Regenerate the trip."));
    validateDay(day).forEach((issue) => blocking.push(advisory(`day-${day.id}-${issue.code}`, "blocking", "schedule", `Day ${day.dayNumber} schedule issue`, issue.message, "Regenerate or move conflicting items.")));
    // A missing same-region indoor backup on an outdoor-heavy day is a soft
    // planning note (severity "caution"), not grounds for rejecting an
    // otherwise-valid itinerary -- buildAdvisories already surfaces this same
    // check to the user non-blockingly. Pushing it into this function's
    // "blocking" collection ignored its own declared severity and rejected
    // real, correct plans (confirmed live: an approved Phoenix -> Grand
    // Canyon -> Sedona itinerary was rejected solely for this).
    day.scheduleItems.forEach((item) => {
      const place = item.placeId ? profile.places.find((candidate) => candidate.id === item.placeId) : null;
      if (place && childFreeAdultTrip(input) && classifyPlaceForPlanning(place, profile, input).isChildrenFocused) {
        blocking.push(advisory(`traveler-fit-${item.id}`, "blocking", "traveler-fit", `Day ${day.dayNumber} has a child-focused stop`, `${place.name} does not fit a child-free adult trip unless explicitly requested.`, "Replace with an adult-fit destination anchor."));
      }
      if (["breakfast", "lunch", "dinner"].includes(item.type) && item.placeId) {
        const mealPlace = profile.places.find((candidate) => candidate.id === item.placeId);
        if (mealPlace && !isMealCandidate(mealPlace, item.type)) blocking.push(advisory(`meal-fit-${item.id}`, "blocking", "food", `${item.title} is not a valid meal venue`, "Meal recommendations must be actual restaurants, cafes, bakeries, food halls, or dining venues.", "Replace the meal with a route-compatible restaurant."));
      }
      if (item.hasDepartedPrimaryDestination && normalizeText(`${item.title} ${item.locationLabel} ${item.description}`).includes(normalizeText(profile.canonicalName.split(",")[0])) && !item.title.startsWith("Depart ")) {
        blocking.push(advisory(`post-departure-${item.id}`, "blocking", "route", `Day ${day.dayNumber} returns to the destination after departure`, "The itinerary schedules destination-specific activity or food after the traveler has departed the primary destination.", "Keep post-departure items near the final arrival area."));
      }
    });
  });
  return { blocking };
}

function userRejectedBeach(input) {
  return /avoid beach|no beach|skip beach|not beach/.test(normalizeText(`${input.mustHavePlaces?.join(" ")} ${input.avoidPlaces?.join(" ")}`));
}

function hasImplausibleArrivalDrive(plan) {
  const input = plan.preferencesSnapshot || {};
  if (!input.routeQualityRequired) return false;
  return plan.days
    .flatMap((day) => day.scheduleItems || [])
    .filter((item) => item.type === "travel" && (/^Travel to |^Depart /.test(item.title || "")))
    .some((item) => {
      const durationMinutes = Number(item.travelFromPrevious?.durationMinutes || item.durationMinutes || 0);
      const distanceMiles = Number(item.travelFromPrevious?.distanceMiles || 0);
      if (!durationMinutes || !distanceMiles) return false;
      const impliedMph = distanceMiles / (durationMinutes / 60);
      return impliedMph > 90;
    });
}

function hasUniformGenericPricing(plan) {
  const ranges = plan.days
    .flatMap((day) => day.scheduleItems)
    .filter((item) => item.type === "activity")
    .map((item) => moneyRange(item.estimatedCostPerPerson?.low || 0, item.estimatedCostPerPerson?.high || 0));
  const generic = ranges.filter((range) => range === "$10-$50" || range === "$10-$45");
  return ranges.length >= 4 && generic.length >= Math.ceil(ranges.length * 0.75);
}

function hasRepeatedDurationPattern(plan) {
  const durations = plan.days.flatMap((day) => day.scheduleItems).filter((item) => item.type === "activity").map((item) => item.durationMinutes);
  if (durations.length < 5) return false;
  // Real attraction durations cluster around a handful of plausible round
  // numbers (60/90/120 minutes), so a short run of matching values is weak
  // evidence of templating on its own -- require a clearer pattern (a
  // majority share, or a longer consecutive run) before flagging it.
  if (maxShare(frequency(durations)) > 0.6) return true;
  for (let index = 3; index < durations.length; index += 1) {
    if (durations[index] === durations[index - 1] && durations[index] === durations[index - 2] && durations[index] === durations[index - 3]) return true;
  }
  return false;
}

function hasRepeatedMealPattern(plan) {
  const meals = plan.days.flatMap((day) => day.scheduleItems).filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type) && !item.structurallyUnbacked);
  const names = meals.map((item) => normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || "")).filter(Boolean);
  const concrete = meals.filter((item) => item.mealDetails?.primaryPlaceId).length;
  const primaryByType = meals.reduce((groups, item) => {
    if (!isProviderGeneratedPlan(plan) && !item.mealDetails?.primaryPlaceId) return groups;
    const name = normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || "");
    if (!name) return groups;
    groups[name] ||= new Set();
    groups[name].add(item.type);
    return groups;
  }, {});
  if (Object.values(primaryByType).some((types) => types.size >= 3)) return true;
  if (isProviderGeneratedPlan(plan) && !isDisclosedStarterFallbackPlan(plan) && meals.length >= 4 && concrete < Math.ceil(meals.length * 0.6)) return true;
  const concreteNames = meals
    .filter((item) => item.mealDetails?.primaryPlaceId)
    .map((item) => normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || ""))
    .filter(Boolean);
  return concreteNames.length >= 4 && mostCommonCount(concreteNames) > Math.max(3, Math.ceil(concreteNames.length * 0.35));
}

function hasTemplatePublicLanguage(plan) {
  if (!isProviderGeneratedPlan(plan)) return false;
  return INTERNAL_PUBLIC_LANGUAGE_PATTERN.test(publicFacingPlanText(plan));
}

function hasDuplicateDaytimeEvening(plan) {
  return plan.days.some((day) => {
    const activities = new Set(day.scheduleItems.filter((item) => item.type === "activity" && item.placeId).map((item) => item.placeId));
    return day.scheduleItems.some((item) => item.type === "evening" && item.placeId && activities.has(item.placeId));
  });
}

function isProviderGeneratedPlan(plan) {
  const provider = plan?.generationMetadata?.destinationProfileSnapshot?.sourceMetadata?.provider
    || plan?.generationMetadata?.sourceDiagnostics?.destinationResearchSource
    || "";
  return /^(google|openrouteservice|openai|generated-provider|test-live)$/i.test(provider);
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
      description: publicPlaceDescription(place.shortDescription),
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

function dayRouteLabel(profile, day, input, index, hotelBase = null) {
  if (index === 0 && day.scheduleItems.some((item) => item.title.startsWith("Travel to "))) return `${input.origin || "Origin"} -> ${profile.canonicalName}`;
  // On a multi-city trip's departure day, the traveler is leaving from
  // whichever base they actually slept in last night, not necessarily the
  // trip's overall primary destination -- confirmed live: a Los Angeles ->
  // Malibu -> Santa Barbara -> San Diego route's departure day (spent
  // entirely in San Diego, USS Midway Museum) still labeled its route as
  // "Los Angeles -> Denver", hardcoding profile.canonicalName regardless of
  // where the trip actually ended. hotelBase.forDay already computes the
  // correct per-day base elsewhere (see startingBase below); use the same
  // source here instead of the trip-wide canonical name.
  if (index === input.numberOfDays - 1 && day.scheduleItems.some((item) => item.title.startsWith("Depart "))) {
    const departureBase = hotelBase?.forDay ? hotelBase.forDay(index) : profile.canonicalName;
    return `${departureBase} -> ${input.origin || "Origin"}`;
  }
  // Meals carry a regionId too (the theme region the food search targeted,
  // not necessarily where the restaurant landed -- see mealRecommendation's
  // profile-wide fallback), and breakfast always comes first chronologically.
  // Including them here let a day's "Route / Location" label be built almost
  // entirely from meal regions while its actual "Don't Miss" activities (a
  // separate, activity-only computation -- see buildDetailedTripDays) sat in
  // totally different, unrelated regions. Confirmed live: a New York day's
  // route read "The Met area -> Brooklyn Bridge area -> Intrepid Museum
  // area" while its Don't Miss items were Central Park and The Battery --
  // neither of which appeared in that list at all. Match the same
  // activity-and-evening-only item set the day's own summary/Don't Miss use.
  const activityRegions = [...new Set(day.scheduleItems.filter((item) => item.regionId && (item.type === "activity" || item.type === "evening")).map((item) => regionName(profile, item.regionId)))].slice(0, 3);
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
    hotelChangeCount: Number.isFinite(hotelBase.hotelChanges) ? hotelBase.hotelChanges : (/change|split|multiple/i.test(input.lodging.changeHotels || "") ? "User open to changes; verify before booking." : 0),
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
  return profile.regions.find((region) => region.id === id)?.name || "the local area";
}

function dayTitleFor(profile, input, intelligence, region, scheduleItems, index) {
  const activityItems = scheduleItems.filter((item) => item.type === "activity");
  const eveningItems = scheduleItems.filter((item) => item.type === "evening");
  const activityTitles = [...activityItems, ...eveningItems].map((item) => item.title);
  if (index === 0 && scheduleItems.some((item) => item.title.startsWith("Travel to "))) {
    const firstAnchor = activityTitles.find((title) => !/^Travel|Hotel|Reset/i.test(title));
    return firstAnchor ? `Arrival and ${shortTitle(firstAnchor)}` : `Arrival in ${profile.canonicalName.split(",")[0]}`;
  }
  if (index === input.numberOfDays - 1 && scheduleItems.some((item) => item.title.startsWith("Depart "))) {
    const firstAnchor = activityTitles[0];
    return firstAnchor ? `${shortTitle(firstAnchor)} and departure` : `Final morning and departure`;
  }
  const counts = categoryCountsForTitle(activityItems);
  const dominantRegion = dominantRegionName(profile, activityItems) || region.name;
  const mountainTitle = mountainRegionalDayTitle(activityItems, eveningItems);
  if (mountainTitle) return mountainTitle;
  if ((counts.beach + counts.waterfront) >= Math.max(1, Math.ceil(activityItems.length * 0.5))) {
    return `${dominantRegion} beach and waterfront`;
  }
  if (counts.nature >= Math.max(1, Math.ceil(activityItems.length * 0.5))) {
    return `${dominantRegion} parks and scenery`;
  }
  if (counts.culture >= Math.max(1, Math.ceil(activityItems.length * 0.5))) {
    return `${dominantRegion} museums and history`;
  }
  if (counts.entertainment >= Math.max(1, Math.ceil(activityItems.length * 0.5))) {
    return `${dominantRegion} entertainment and local flavor`;
  }
  const names = activityTitles.slice(0, 2).map(shortTitle).filter(Boolean);
  return names.length ? names.join(" and ") : `${region.name} highlights`;
}

function mountainRegionalDayTitle(activityItems, eveningItems = []) {
  const text = normalizeText([...activityItems, ...eveningItems].map((item) => `${item.title} ${item.category || ""} ${(item.tags || []).join(" ")}`).join(" "));
  if (!/\b(mountain|trail|waterfall|falls|parkway|overlook|scenic|gatlinburg|pigeon forge|sevierville|kuwohi|newfound gap|cades cove|roaring fork|little river|foothills|dollywood|island)\b/.test(text)) return "";
  if (/\bnewfound gap\b/.test(text) && /\bkuwohi|clingsmans\b/.test(text)) return "Newfound Gap and Kuwohi scenic day";
  if (/\bcades cove\b/.test(text)) return "Cades Cove and mountain scenery";
  if (/\broaring fork\b/.test(text)) return "Roaring Fork and Gatlinburg waterfalls";
  if (/\blittle river road\b/.test(text)) return "Little River Road and waterfall stops";
  if (/\bfoothills parkway\b/.test(text)) return "Foothills Parkway scenic overlooks";
  if (/\bdollywood\b/.test(text)) return "Dollywood and Pigeon Forge evening";
  if (/\bthe island in pigeon forge\b/.test(text)) return "The Island and Pigeon Forge entertainment";
  if (/\banakeesta|skypark|ober gatlinburg\b/.test(text)) return "Gatlinburg mountain attractions";
  if (/\bgrotto falls|laurel falls|rainbow falls|abrams falls|cataract falls\b/.test(text)) return "Waterfall trail and scenic town evening";
  if (/\bdowntown gatlinburg|gatlinburg\b/.test(text) && /\bpigeon forge|island|old mill\b/.test(text)) return "Gatlinburg and Pigeon Forge gateway day";
  if (/\btrail|hike|waterfall|falls\b/.test(text)) return "Trail and waterfall day";
  if (/\bscenic drive|parkway|overlook\b/.test(text)) return "Scenic drive and overlook day";
  return "";
}

function categoryCountsForTitle(items) {
  return items.reduce((counts, item) => {
    const text = normalizeText(`${item.title} ${item.category} ${(item.tags || []).join(" ")}`);
    if (/beach|pier|oceanfront|boardwalk/.test(text)) counts.beach += 1;
    if (/\b(riverwalk|waterfront|harbor|marina|lake|river|cruise|kayak|paddleboard)\b/.test(text)) counts.waterfront += 1;
    if (/park|garden|trail|preserve|marsh|nature|viewpoint|overlook/.test(text)) counts.nature += 1;
    if (/museum|historic|history|gallery|culture|landmark|mansion|house/.test(text)) counts.culture += 1;
    if (/music|show|theater|theatre|market|district|brewery|nightlife/.test(text)) counts.entertainment += 1;
    return counts;
  }, { beach: 0, waterfront: 0, nature: 0, culture: 0, entertainment: 0 });
}

function dominantRegionName(profile, items) {
  const counts = frequency(items.map((item) => item.regionId).filter(Boolean));
  const [regionId] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
  return regionId ? regionName(profile, regionId) : "";
}

function shortTitle(value) {
  return String(value || "").replace(/,.*$/, "").replace(/\s+and\s+.*$/, (match) => match.length > 34 ? "" : match).trim();
}

function dayThemeLabel(regions, intelligence = null) {
  if (intelligence?.destinationArchetype?.primaryArchetype === "beach/coastal") return "Beach, waterfront, food, and evening anchors";
  if (regions.some((region) => /beach|coast|water|bay|pier|harbor/i.test(region))) return "Coast, water, and sunset";
  if (regions.some((region) => /mountain|park|view|trail|garden/i.test(region))) return "Views, scenery, and open-air time";
  if (regions.some((region) => /downtown|center|market|arts|museum|historic/i.test(region))) return "Culture, architecture, and food";
  return "Regional highlights";
}

function precomputedTransitEstimate(profile, fromPlaceOrRegion, toPlaceOrRegion) {
  const fromId = typeof fromPlaceOrRegion === "object" ? fromPlaceOrRegion?.id : null;
  const toId = typeof toPlaceOrRegion === "object" ? toPlaceOrRegion?.id : null;
  if (!fromId || !toId || !Array.isArray(profile.transitEstimates)) return null;
  return profile.transitEstimates.find((entry) => (entry.fromPlaceId === fromId && entry.toPlaceId === toId) || (entry.fromPlaceId === toId && entry.toPlaceId === fromId)) || null;
}

function estimateTravel(profile, fromPlaceOrRegion, toPlaceOrRegion) {
  const fromRegionId = typeof fromPlaceOrRegion === "string" ? fromPlaceOrRegion : fromPlaceOrRegion?.regionId;
  const toRegionId = typeof toPlaceOrRegion === "string" ? toPlaceOrRegion : toPlaceOrRegion?.regionId;
  const fromCoordinates = coordinatesFor(profile, fromPlaceOrRegion);
  const toCoordinates = coordinatesFor(profile, toPlaceOrRegion);
  const route = profile.scenicRoutes.find((item) => (item.originRegionId === fromRegionId && item.destinationRegionId === toRegionId) || (item.originRegionId === toRegionId && item.destinationRegionId === fromRegionId));
  // A small, bounded set of flagship legs get a real, live Google Transit
  // estimate precomputed before scheduling (see
  // precomputeFlagshipTransitEstimates in planner-actions.js) -- use it
  // directly instead of the distance/keyword heuristic below whenever this
  // exact pair was one of them.
  const transitMatch = precomputedTransitEstimate(profile, fromPlaceOrRegion, toPlaceOrRegion);
  if (transitMatch) {
    return {
      mode: "Transit",
      durationMinutes: transitMatch.durationMinutes,
      distanceMiles: transitMatch.distanceMiles,
      fromLabel: placeOrRegionLabel(profile, fromPlaceOrRegion, fromRegionId),
      toLabel: placeOrRegionLabel(profile, toPlaceOrRegion, toRegionId),
      estimateType: "provider-transit-estimate",
      note: `Estimated via public transit (${transitMatch.durationMinutes} min); verify current schedules and fares.`
    };
  }
  if (fromCoordinates && toCoordinates) {
    const distanceMiles = haversineMiles(fromCoordinates.lat, fromCoordinates.lng, toCoordinates.lat, toCoordinates.lng);
    // The 0.65-miles-per-minute (~39mph) pace used for anything past 18
    // miles is tuned for regional roads, not genuine highway legs -- fine
    // for a 20-40 mile regional hop, badly wrong for an inter-city transfer.
    // Confirmed live: Miami to Orlando (~205 miles) came out around 5 hours,
    // versus a real ~3.5-4 hour drive. Keep the existing pace for scenic
    // routes (deliberately slow/twisty) and short-to-regional distances;
    // step up to a real highway speed only past 100 miles, where the route
    // is realistically dominated by interstate driving.
    const isScenic = Boolean(route?.tags?.includes("scenic"));
    const impliedMph = isScenic ? 39 : distanceMiles > 150 ? 60 : distanceMiles > 18 ? 39 : 27;
    const minimum = Math.ceil((distanceMiles / impliedMph) * 60);
    const routeMinutes = route?.estimatedDriveMinutes;
    let durationMinutes = Math.max(8, Math.round(routeMinutes ? Math.max(routeMinutes, minimum) : minimum + (distanceMiles > 20 ? 18 : 8)));
    if (fromRegionId !== toRegionId && isMountainRegionalTransfer(profile, fromPlaceOrRegion, toPlaceOrRegion)) {
      durationMinutes = Math.max(durationMinutes, 25);
    }
    const isUrban = isUrbanDestinationProfile(profile);
    const driveOnly = route?.tags?.includes("drive-only");
    const urbanTransfer = isUrban && distanceMiles <= 4.5 && !driveOnly;
    // Beyond comfortable walking distance, a dense transit-first destination
    // still shouldn't be told "Drive" by default -- that implies driving and
    // parking, which is usually the worst option in a city like this.
    const urbanRideshare = isUrban && !urbanTransfer && !driveOnly;
    const mode = urbanTransfer ? "Walk/Metro" : urbanRideshare ? "Rideshare/Transit" : "Drive";
    return {
      mode,
      durationMinutes,
      distanceMiles: Math.max(0.5, Math.round(distanceMiles * 10) / 10),
      fromLabel: placeOrRegionLabel(profile, fromPlaceOrRegion, fromRegionId),
      toLabel: placeOrRegionLabel(profile, toPlaceOrRegion, toRegionId),
      estimateType: route ? "curated-coordinate-estimate" : "coordinate-plausibility-estimate",
      note: urbanTransfer
        ? `Walk, Metro, or short rideshare transfer: about ${durationMinutes} minutes over ${Math.max(0.5, Math.round(distanceMiles * 10) / 10)} miles. Verify current transit and walking conditions.`
        : urbanRideshare
        ? `Estimated rideshare or public transit: about ${durationMinutes} minutes over ${Math.max(0.5, Math.round(distanceMiles * 10) / 10)} miles. Driving and parking may be slower in this area -- verify current transit options.`
        : `Estimated drive: about ${durationMinutes} minutes over ${Math.max(0.5, Math.round(distanceMiles * 10) / 10)} miles. Verify live traffic before traveling.`
    };
  }
  if (fromRegionId === toRegionId) return { mode: isUrbanDestinationProfile(profile) ? "Walk/Metro" : "Drive", durationMinutes: 12, distanceMiles: 3, fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), estimateType: "same-area-estimate", note: isUrbanDestinationProfile(profile) ? "Short same-area walk, Metro, or rideshare transfer estimate; verify accessibility and transit conditions." : "Short same-area transfer estimate; verify exact location and parking." };
  const minutes = route?.estimatedDriveMinutes || 35;
  return { mode: "Drive", durationMinutes: minutes, distanceMiles: route?.estimatedDistanceMiles || Math.round(minutes * 0.7), fromLabel: regionName(profile, fromRegionId), toLabel: regionName(profile, toRegionId), estimateType: "curated-region-estimate", note: `Estimated drive: about ${minutes} minutes. Verify live traffic before traveling.` };
}

function isMountainRegionalTransfer(profile, fromPlaceOrRegion, toPlaceOrRegion) {
  const archetype = profile.destinationArchetype?.primaryArchetype || "";
  const profileText = normalizeText([
    profile.canonicalName,
    profile.summary,
    ...(profile.regions || []).map((region) => region.name),
    ...(profile.scenicRoutes || []).map((route) => route.name)
  ].filter(Boolean).join(" "));
  if (archetype !== "mountain" && archetype !== "national-park" && !/\b(mountain|national park|parkway|ridge|trail|waterfall|falls|scenic route|scenic drive)\b/.test(profileText)) return false;
  const textFor = (value) => {
    const regionId = typeof value === "string" ? value : value?.regionId;
    return normalizeText([
      typeof value === "object" ? value.name : "",
      typeof value === "object" ? value.shortDescription : "",
      typeof value === "object" ? (value.categories || []).join(" ") : "",
      typeof value === "object" ? (value.tags || []).join(" ") : "",
      regionName(profile, regionId)
    ].filter(Boolean).join(" "));
  };
  return /\b(mountain|parkway|trail|waterfall|falls|arboretum|nature|garden|scenic|catawba|craggy|ridge)\b/.test(`${textFor(fromPlaceOrRegion)} ${textFor(toPlaceOrRegion)}`);
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

function preciseCoordinatesFor(place) {
  if (!place || typeof place !== "object") return null;
  if (Number.isFinite(place.coordinates?.lat) && Number.isFinite(place.coordinates?.lng)) return place.coordinates;
  if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) return { lat: Number(place.latitude), lng: Number(place.longitude) };
  return null;
}

function placeOrRegionLabel(profile, placeOrRegion, regionId) {
  if (typeof placeOrRegion === "object" && placeOrRegion?.name) return placeOrRegion.name;
  return regionName(profile, regionId);
}

function mealTitle(profile, regionId, mealType) {
  const region = regionName(profile, regionId);
  if (mealType === "breakfast") return `${region} breakfast`;
  if (mealType === "lunch") return `${region} lunch`;
  return `${region} dinner`;
}

const CUISINE_KEYWORDS = [
  "french", "italian", "mediterranean", "mexican", "chinese", "japanese", "indian", "thai",
  "vietnamese", "spanish", "greek", "korean", "cuban", "caribbean", "southern", "seafood",
  "steakhouse", "barbecue", "bbq", "pizza", "sushi", "peruvian", "ethiopian", "lebanese",
  "moroccan", "turkish", "german", "irish", "fusion", "tapas", "ramen", "dim sum",
  "brazilian", "argentine", "cajun", "creole", "farm to table", "vegan", "vegetarian",
  "gastropub", "steak", "bakery", "bistro", "brasserie", "trattoria", "cantina"
];

function cuisineFromPlace(place) {
  if (!place) return "";
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return CUISINE_KEYWORDS.find((keyword) => new RegExp(`\\b${keyword}\\b`).test(text)) || "";
}

function mealRecommendation(profile, input, regionId, mealType, mealUsage = new Map(), anchorPlace = null) {
  const area = profile.foodAreas.find((candidate) => candidate.regionId === regionId && candidate.mealTypes.includes(mealType)) || profile.foodAreas.find((candidate) => candidate.mealTypes.includes(mealType));
  const preferredCuisines = input.food.cuisine || [];
  const primaryPlace = mealCandidatePlace(profile, regionId, mealType, new Set(), mealUsage, false, anchorPlace, preferredCuisines) || mealCandidatePlace(profile, regionId, mealType, new Set(), mealUsage, true, anchorPlace, preferredCuisines);
  const classification = primaryPlace ? classifyPlaceForPlanning(primaryPlace, profile, input) : null;
  // The selected restaurant's own real cuisine (from its name/description/
  // Google place types) is a much stronger signal than the traveler's
  // stated cuisine interest, which is often unset -- falling back straight
  // to "local" regardless of what the venue actually serves is why a French
  // bistro or a Mediterranean restaurant both showed up as "Cuisine fit:
  // Local" even after real, diverse restaurants were being selected.
  // A food hall (Time Out Market, Vanderbilt Market, ...) hosts dozens of
  // independent vendors -- matching one incidental keyword from its own
  // description (e.g. a mention of a pizza stall) and presenting that as
  // "Pizza cuisine" misrepresents the whole venue. Skip the keyword match
  // entirely for food halls and say what it actually is instead.
  const cuisine = classification?.isFoodHall
    ? "Food hall"
    : cuisineFromPlace(primaryPlace)
      || (input.food.cuisine || []).find((item) => area?.cuisines.some((cuisineName) => normalizeText(cuisineName).includes(normalizeText(item))))
      || (input.food.cuisine || [])[0]
      || "local";
  const excluded = new Set([primaryPlace?.id].filter(Boolean));
  const secondaryPlace = mealCandidatePlace(profile, regionId, mealType, excluded, mealUsage, true, anchorPlace, preferredCuisines) || mealCandidatePlace(profile, area?.regionId, mealType, excluded, mealUsage, true, anchorPlace, preferredCuisines);
  const primary = primaryPlace?.name || specificFoodAreaLabel(profile, area, regionId, mealType);
  const secondary = secondaryPlace?.name || secondaryFoodOption(profile, area, regionId);
  const price = moneyRange(mealCost(input, mealType).low, mealCost(input, mealType).high);
  const reservation = mealType === "dinner" ? "Reserve if this is a must-do meal or the group is larger; otherwise verify hours day-of." : "Reservations usually optional; verify hours and menus day-of.";
  const routeMinutes = primaryPlace ? estimateTravel(profile, regionId, primaryPlace.regionId).durationMinutes : 0;
  const anchorPreciseCoordinates = preciseCoordinatesFor(anchorPlace);
  const primaryPreciseCoordinates = preciseCoordinatesFor(primaryPlace);
  const anchorDistanceMiles = anchorPreciseCoordinates && primaryPreciseCoordinates
    ? Math.round(haversineMiles(anchorPreciseCoordinates.lat, anchorPreciseCoordinates.lng, primaryPreciseCoordinates.lat, primaryPreciseCoordinates.lng) * 10) / 10
    : null;
  return {
    primary,
    secondary,
    primaryPlaceId: primaryPlace?.id || "",
    // mealCandidatePlace() falls back to a profile-wide search (any region,
    // ranked by travel time) whenever the intended theme region has no valid
    // meal candidate -- so the restaurant actually recommended can end up in
    // a completely different region than regionId. Confirmed live: a lunch
    // titled "Cape May County Park & Zoo area lunch" recommended Gordon
    // Ramsay Pub & Grill, an Atlantic City restaurant. Callers must derive
    // the display title from this resolved region, not the original theme
    // region, once the actual restaurant is known.
    primaryPlaceRegionId: primaryPlace?.regionId || regionId,
    secondaryPlaceId: secondaryPlace?.id || "",
    text: classification?.isFoodHall
      ? `${primary}. Backup: ${secondary}. Food hall with multiple independent vendors -- pick what you're in the mood for. Estimated ${price} per person. ${reservation} Dietary and allergy safety must be confirmed directly with each vendor.`
      : `${primary}. Backup: ${secondary}. ${titleCase(cuisine)} cuisine. Estimated ${price} per person. ${reservation} Dietary and allergy safety must be confirmed directly with the restaurant.`,
    cuisine: titleCase(cuisine),
    price,
    reservation,
    mealTypesServed: supportedMealTypes(classification),
    openingHours: primaryPlace?.openingTimeGuidance || "Hours not verified; confirm directly before relying on this meal.",
    routeDetour: primaryPlace ? `${routeMinutes <= 15 ? "Minimal" : `${routeMinutes} min`} detour from the current route cluster.` : "Placed by dining area, not a verified restaurant.",
    anchorDistanceMiles,
    priceLevel: price,
    dietaryFit: "Restaurant must confirm dietary and allergy needs directly.",
    reservationNeed: reservation,
    confidence: primaryPlace ? classification?.confidence || "medium" : "low"
  };
}

function mealQualityScore(place) {
  const classification = classifyPlaceForPlanning(place);
  return Number(place.priorityScore || 0) - (classification.isThinResearchAttraction ? 40 : 0);
}

function placeMatchesCuisine(place, preferredCuisines) {
  if (!preferredCuisines || !preferredCuisines.length) return false;
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return preferredCuisines.some((cuisine) => text.includes(normalizeText(cuisine)));
}

function mealCandidatePlace(profile, regionId, mealType, excludedIds = new Set(), mealUsage = new Map(), allowReused = false, anchorPlace = null, preferredCuisines = []) {
  const excluded = excludedIds instanceof Set ? excludedIds : new Set([excludedIds].filter(Boolean));
  // A regional-extension place (a day-trip or overnight-extension city, often
  // an hour or more away) must never be recommended as a meal for an ordinary
  // day back in the primary destination -- only when the day itself is that
  // extension region should its own local restaurants be eligible.
  const targetIsExtensionRegion = String(regionId || "").startsWith("regional-ext-");
  const byMealFit = (place) => {
    if (!isMealCandidate(place, mealType) || excluded.has(place.id)) return false;
    if (!targetIsExtensionRegion && (place.categories || []).includes("regional")) return false;
    const usage = mealUsage.get(place.id) || 0;
    const classification = classifyPlaceForPlanning(place);
    const maxUsage = classification.isFoodHall ? 1 : 2;
    return allowReused ? usage < maxUsage : usage === 0;
  };
  const anchorCoordinates = coordinatesFor(profile, anchorPlace);
  const distanceToAnchor = (place) => {
    const placeCoordinates = coordinatesFor(profile, place);
    return anchorCoordinates && placeCoordinates
      ? haversineMiles(anchorCoordinates.lat, anchorCoordinates.lng, placeCoordinates.lat, placeCoordinates.lng)
      : null;
  };
  // A place matching one of the traveler's stated cuisine interests should
  // win ties against equally-viable options -- otherwise a selected cuisine
  // interest (e.g. Indian) never actually influences which restaurant gets
  // picked, only the display label of whatever was chosen without it.
  const cuisineRank = (place) => (placeMatchesCuisine(place, preferredCuisines) ? 0 : 1);
  const regionMatches = profile.places
    .filter((place) => place.regionId === regionId)
    .filter(byMealFit)
    .sort((a, b) => {
      const usageDiff = (mealUsage.get(a.id) || 0) - (mealUsage.get(b.id) || 0);
      if (usageDiff) return usageDiff;
      const cuisineDiff = cuisineRank(a) - cuisineRank(b);
      if (cuisineDiff) return cuisineDiff;
      const distanceA = distanceToAnchor(a);
      const distanceB = distanceToAnchor(b);
      // Only let proximity override priority when the gap is large enough to
      // matter for a same-region meal choice; small gaps stay decided by
      // destination quality so a slightly closer weak candidate cannot beat
      // a clearly stronger one a few blocks further away.
      if (distanceA !== null && distanceB !== null && Math.abs(distanceA - distanceB) > 1.5) return distanceA - distanceB;
      return mealQualityScore(b) - mealQualityScore(a);
    });
  if (regionMatches.length) return regionMatches[0];
  // A regional-extension base's own food pool is a handful of researched
  // restaurants (see researchRegionalExtensionCandidate), which a multi-day
  // stay there can genuinely exhaust -- the cross-region fallback below has
  // no distance limit at all once that happens, so it can reach all the way
  // back into a different, 100+ mile away city. Confirmed live: a 3-night
  // Orlando stay ran out of local restaurants by day 2 and started serving
  // Miami restaurants (200+ miles away) for Orlando breakfasts. Reusing an
  // already-used local restaurant a third time is a far smaller compromise
  // than that -- try relaxing the SAME region's reuse cap before ever
  // considering another region at all.
  const relaxedSameRegionMatches = profile.places
    .filter((place) => place.regionId === regionId)
    .filter(byMealFit)
    .sort((a, b) => (mealUsage.get(a.id) || 0) - (mealUsage.get(b.id) || 0) || cuisineRank(a) - cuisineRank(b) || mealQualityScore(b) - mealQualityScore(a));
  if (relaxedSameRegionMatches.length) return relaxedSameRegionMatches[0];
  const crossRegionMatches = profile.places
    .filter(byMealFit)
    .map((place) => ({ place, routeMinutes: estimateTravel(profile, regionId, place.regionId).durationMinutes }))
    .sort((a, b) => a.routeMinutes - b.routeMinutes || (mealUsage.get(a.place.id) || 0) - (mealUsage.get(b.place.id) || 0) || cuisineRank(a.place) - cuisineRank(b.place) || mealQualityScore(b.place) - mealQualityScore(a.place));
  // A meal genuinely more than 90 minutes from where the traveler actually
  // is that day is worse than no verified pick at all -- the caller already
  // falls back to a generic "explore this area" placeholder when this
  // returns null (see mealRecommendation's specificFoodAreaLabel path).
  return crossRegionMatches.find((entry) => entry.routeMinutes <= 90)?.place || null;
}

function isMealCandidate(place, mealType) {
  const classification = classifyPlaceForPlanning(place);
  if (classification.isPier || classification.isMuseum || classification.isDinnerShow) return false;
  if (!classification.isRestaurant && !classification.isFoodHall && !(mealType === "dinner" && classification.isBar)) return false;
  if (classification.isEntertainmentCenter || classification.isChildrenFocused || classification.isOrdinaryBusiness) return false;
  if (mealType === "breakfast") return classification.servesBreakfast;
  if (mealType === "lunch") return classification.servesLunch;
  return classification.servesDinner;
}

function supportedMealTypes(classification) {
  if (!classification) return [];
  return [
    classification.servesBreakfast ? "breakfast" : "",
    classification.servesLunch ? "lunch" : "",
    classification.servesDinner ? "dinner" : ""
  ].filter(Boolean);
}

function specificFoodAreaLabel(profile, area, regionId, mealType) {
  if (!area?.name) return `${regionName(profile, regionId)} ${mealType}`;
  const mealNoun = mealType === "breakfast" ? "breakfast spots" : mealType === "lunch" ? "lunch spots" : "dinner spots";
  return area.name
    .replace(/\brestaurants$/i, mealNoun)
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

function costForPlace(place, classification = classifyPlaceForPlanning(place)) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  const admission = normalizeText(`${place.admissionStatus || ""} ${(place.pricingNotes || "")}`);
  if (/\bfree admission|free entry|admission free|no admission charge|free public access\b/.test(admission)
    || /\b(smithsonian|national mall|lincoln memorial|washington monument|national gallery of art|library of congress|united states capitol|us capitol|u s capitol|national portrait gallery|national museum of american history|national museum of natural history|national museum of african american history|united states botanic garden|u s botanic garden|national zoo)\b/.test(text)) {
    return { low: 0, high: 0 };
  }
  if (classification.isBeachOrWaterfront || classification.isBoardwalk || classification.isPier) {
    const high = /skywheel|cruise|water sport|watersport|fishing charter|parasail/.test(text) ? 80 : /state park|huntington|brookgreen|atalaya/.test(text) ? 35 : 20;
    return { low: Math.max(0, Number(place.estimatedCostLow || 0)), high: Math.max(Number(place.estimatedCostHigh || 0), high) };
  }
  if (classification.isWaterActivity) return { low: Math.max(35, Number(place.estimatedCostLow || 0)), high: Math.max(90, Number(place.estimatedCostHigh || 0)) };
  if (/skywheel/.test(text)) return { low: Math.max(15, Number(place.estimatedCostLow || 0)), high: Math.max(30, Number(place.estimatedCostHigh || 0)) };
  if (classification.isDinnerShow) return { low: Math.max(45, Number(place.estimatedCostLow || 0)), high: Math.max(95, Number(place.estimatedCostHigh || 0)) };
  return { low: Number(place.estimatedCostLow || 0), high: Number(place.estimatedCostHigh || 0) };
}

function isUrbanDestinationProfile(profile) {
  const text = normalizeText([
    profile.canonicalName,
    profile.summary,
    profile.destinationArchetype?.primaryArchetype,
    ...(profile.regions || []).map((region) => `${region.name} ${(region.tags || []).join(" ")}`),
    ...(profile.places || []).slice(0, 25).map((place) => `${place.name} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`)
  ].join(" "));
  return /\b(major city|capital|downtown|metro|urban|museum|historic district|neighborhood|national mall|capitol|smithsonian)\b/.test(text);
}

function isRegionalExcursionPlace(place) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  return /\b(day trip|regional|suburban|airport|dulles|outside the city|long excursion|state park|national park|great falls|udvar hazy|mount vernon)\b/.test(text);
}

function beachExperienceFor(place, classification = classifyPlaceForPlanning(place)) {
  const name = place.name || "Beach or waterfront";
  const text = normalizeText(`${name} ${place.shortDescription || ""} ${(place.tags || []).join(" ")}`);
  return {
    beachName: name,
    accessPoint: /state park|huntington/.test(text) ? "State-park beach access or visitor area" : /boardwalk|promenade/.test(text) ? "Boardwalk and adjacent public beach access" : /pier/.test(text) ? "Pier-adjacent public access" : "Public beach or waterfront access",
    parking: /state park|huntington/.test(text) ? "Use official state-park parking; fees and capacity vary." : "Confirm public parking, meters, and garage options before arrival.",
    expectedDuration: formatDuration(Number(place.typicalDurationMinutes || 90)),
    sunriseFit: /sunrise|east|beach|oceanfront|pier/.test(text) ? "good" : "possible",
    sunsetFit: /marshwalk|inlet|waterfront|landing|sunset/.test(text) ? "good" : "possible but not guaranteed on an east-facing beach",
    swimmingSuitability: classification.isBeachOrWaterfront && !classification.isPier && !classification.isBoardwalk ? "possible when conditions allow" : "not the primary purpose of this block",
    waterConditionsUnknown: true,
    lifeguardConfidence: "unknown; verify season, beach rules, and staffed areas locally",
    facilities: /state park|boardwalk|promenade|pier/.test(text) ? ["restrooms likely nearby", "parking or paid parking nearby"].join(", ") : "facilities vary by access point",
    crowdLevelEstimate: /central|boardwalk|skywheel/.test(text) ? "higher during peak beach hours" : "moderate; varies by season and weather",
    shadeAvailability: "limited on open sand; bring sun protection",
    equipmentNeeded: "sunscreen, water, towel or light layer, and shoes for walking",
    weatherBackup: "Shift to a nearby indoor dining, shopping, garden, or entertainment stop if rain, wind, or heat makes beach time unpleasant."
  };
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
  const dietaryPattern = /food|gluten|lactose|vegetarian|vegan|halal|kosher|jain|beef|pork|seafood|allergy/i;
  // Special Needs (group-level) is the primary source going forward;
  // travelersDetail is folded in too for any pre-migration trip data. Dedupe
  // since migration copies travelersDetail restrictions into specialNeeds,
  // so a migrated trip would otherwise list the same restriction twice.
  const specialNeedsDietary = (input.specialNeeds || []).filter((need) => dietaryPattern.test(need));
  const travelerRestrictions = input.travelersDetail.flatMap((traveler) => (traveler.restrictions || []).filter((restriction) => dietaryPattern.test(restriction)));
  const summary = [...new Set([...selected, ...specialNeedsDietary, ...travelerRestrictions])];
  if (!summary.length) return "No mandatory dietary restriction was entered; recommendations stay flexible.";
  return `${summary.join(", ")} applied. Confirm ingredients, preparation, and cross-contact directly with restaurants.`;
}

function budgetBand(input) {
  const value = String(input.budget.style || input.budget.total || "").toLowerCase();
  if (/budget|1500|strict/.test(value)) return "budget";
  if (/luxury|premium/.test(value)) return "premium";
  return "moderate";
}

function childFreeAdultTrip(input) {
  return Number(input.childCount || input.children || 0) === 0 && Number(input.travelers || input.adults || 1) >= 1;
}

// experienceCategories in src/domain.js (the UI's preference picker) already
// collects a "Sports" interest under Entertainment, alongside "Live music",
// "Festivals", "Nightlife" -- but nothing previously read that signal back
// out during planning, so it had no effect on which places got scheduled.
function hasStatedInterest(input, label) {
  const normalized = normalizeText(label);
  return (input.preferences || []).some((pref) => normalizeText(pref.label || "") === normalized);
}

// A place explicitly named in "Places Already in Mind" or "Must-do Places"
// (routePreferences.placesInMind/mustDoPlaces) is the traveler's own
// deliberate request, regardless of what interest categories they happened
// to also select -- it should never get filtered out on interest-mismatch
// grounds.
function explicitlyRequestedPlace(input, place) {
  const requestedText = normalizeText(`${input.routePreferences?.placesInMind || ""} ${input.routePreferences?.mustDoPlaces || ""}`);
  if (!requestedText.trim()) return false;
  const placeName = normalizeText(place?.name || "");
  return Boolean(placeName) && requestedText.includes(placeName);
}

function seasonalMismatchPenalty(place, input) {
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")} ${(place.seasonalNotes || []).join(" ")}`);
  const month = Number(String(input.startDate || "").split("-")[1]);
  if (!month) return 0;
  const lateSummer = month >= 7 && month <= 9;
  if (lateSummer && /\b(azalea|tulip|cherry blossom|spring bloom|spring flowers|flower bloom)\b/.test(text)) return 38;
  if ((month <= 2 || month === 12) && /\b(beach day|swimming|water park|summer concert)\b/.test(text)) return 18;
  return 0;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCase(value) {
  return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function publicPlaceDescription(value) {
  return String(value || "")
    .replace(/\bbreakfast option\b/gi, "breakfast pick")
    .replace(/\blunch option\b/gi, "lunch pick")
    .replace(/\bdinner option\b/gi, "dinner pick");
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

// A flat ~50mph-equivalent (distance/0.72 + 35min buffer) badly understates
// a genuine long-haul arrival/departure drive -- confirmed live: Miami to
// Orlando (~205 miles) came out around 5 hours versus a real ~3.5-4 hours.
// Keep the existing pace for shorter drives (a fixed 35-minute buffer
// dominates the estimate there anyway) and step up to a real highway speed
// only once the distance is genuinely highway-scale.
function estimatedArrivalDriveMinutes(distanceMiles) {
  if (!distanceMiles) return 0;
  const impliedMph = distanceMiles > 100 ? 60 : 43.2;
  return Math.max(60, Math.round((distanceMiles / impliedMph) * 60) + 35);
}

function internalOutputTerms() {
  return [
    "google places landmark candidate",
    "google places food candidate",
    "google places museum candidate",
    "google places candidate",
    "openrouteservice point-of-interest candidate",
    "provider-found",
    "provider-retrieved",
    "culture-area",
    "nature-area",
    "central-area",
    "central area",
    "culture and landmarks",
    "parks and viewpoints",
    "dining and evening neighborhoods",
    "food and evening area",
    "food-area",
    "raw slug"
  ];
}

function isRawPlaceLabel(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (RAW_PLACE_LABEL_PATTERN.test(text)) return true;
  return /^(access|entrance|parking|trailhead|gate)\s+\d+$/i.test(text);
}

function mostCommonCount(values) {
  return Math.max(0, ...Object.values(frequency(values)));
}

function frequency(values) {
  return values.reduce((counts, value) => {
    const key = String(value || "");
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function maxShare(counts) {
  const values = Object.values(counts);
  const total = values.reduce((sum, value) => sum + value, 0);
  return total ? Math.max(...values) / total : 0;
}

function stableNumber(value) {
  return String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
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
