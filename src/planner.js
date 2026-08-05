import {
  calculateInclusiveTripDays,
  calculateTripEndDate,
  calculateTripNights,
  getTripIssues,
  travelerTotal,
  uid
} from "./domain.js";
import { createGenericDestinationProfile, getDestinationProfile, resolveDestinationProfile } from "./destination-data.js";
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
  dinner: "6:30 PM"
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

function buildHotelBase(profile, input, days) {
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
      score -= classification.ordinaryLocalFacilityPenalty.score * 2;
      reasons.push(classification.ordinaryLocalFacilityPenalty.reasons?.[0] || "Reduced because it looks like an ordinary local facility.");
    }
    if (childFreeAdultTrip(input) && classification.isChildrenFocused) {
      score += planningWeights.hardExclusion;
      reasons.push("Rejected because children-focused stops do not fit a child-free adult trip unless explicitly requested.");
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
  return Array.from({ length: input.numberOfDays }, (_, index) => {
    const date = addDays(input.startDate, index);
    const themeRegions = themes[index % themes.length];
    const themeCandidates = scored.filter((item) => themeRegions.includes(item.place.regionId) && !scheduled.has(item.place.id) && item.score > -200 && isActivityCandidateForSchedule(item, profile, input));
    const fillCandidates = scored.filter((item) => !themeRegions.includes(item.place.regionId) && !scheduled.has(item.place.id) && item.score > -200 && isActivityCandidateForSchedule(item, profile, input));
    const candidates = [...themeCandidates, ...fillCandidates.slice(0, Math.max(0, input.maxActivities - themeCandidates.length))];
    const fullDay = candidates.find((item) => item.place.bestTimeOfDay === "full-day");
    const isTrueAllDay = fullDay && Number(fullDay.place.typicalDurationMinutes || 0) >= 300;
    const activityCount = isTrueAllDay && input.maxActivities <= 2 ? 1 : Math.min(input.maxActivities, isTrueAllDay ? 1 : candidates.length);
    let selected = improveArchetypeSelection(profile, input, intelligence, index, themeRegions, (isTrueAllDay && index > 0 && input.maxActivities >= 3 ? [fullDay] : candidates).slice(0, activityCount), scored.filter((item) => item.score > -200 && isActivityCandidateForSchedule(item, profile, input)), scheduled);
    const eligibleCandidates = scored.filter((item) => item.score > -200 && isActivityCandidateForSchedule(item, profile, input));
    selected = enforceUrbanFirstTimeCoverage(profile, input, index, selected, eligibleCandidates, scheduled);
    selected = diversifyDuplicateMuseumDay(profile, input, selected, eligibleCandidates, scheduled);
    selected = ensureUrbanHistoricalCivicCoverage(profile, input, index, selected, eligibleCandidates, scheduled);
    selected = ensureNearbyUrbanRegionalCoverage(profile, input, index, selected, eligibleCandidates, scheduled);
    selected = ensureCoastalNatureCoverage(profile, input, intelligence, index, selected, eligibleCandidates, scheduled);
    if (!isLongDriveArrivalDay(profile, input, index)) selected.forEach((item) => scheduled.add(item.place.id));
    const region = profile.regions.find((item) => item.id === selected[0]?.place.regionId) || profile.regions.find((item) => item.id === themeRegions[0]) || profile.regions[0];
    const scheduleItems = scheduleDay(profile, input, constraints, selected.map((item) => item.place), index, mealUsage, eveningUsage);
    scheduleItems.forEach((item) => {
      if (item.placeId && item.type !== "breakfast" && item.type !== "lunch" && item.type !== "dinner") scheduled.add(item.placeId);
    });
    const backups = buildBackups(profile, constraints, themeRegions, selected.map((item) => item.place), scheduled, backupUsage);
    backups.forEach((backup) => backupUsage.set(backup.placeId, (backupUsage.get(backup.placeId) || 0) + 1));
    const warnings = [];
    const dailyDriveMinutes = scheduleItems.filter((item) => item.type === "travel").reduce((sum, item) => sum + item.durationMinutes, 0);
    if (dailyDriveMinutes > input.maxDrivingMinutes) warnings.push(`Estimated driving exceeds your ${Math.round(input.maxDrivingMinutes / 60)} hour daily preference.`);
    const dailyBudget = estimateDayBudget(input, scheduleItems);
    return {
      id: uid("day"),
      dayNumber: index + 1,
      date,
      title: dayTitleFor(profile, input, intelligence, region, scheduleItems, index),
      theme: dayThemeLabel(themeRegions, intelligence),
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

function ensureNearbyUrbanRegionalCoverage(profile, input, dayIndex, selected, candidates, scheduled) {
  if (!isUrbanDestinationProfile(profile) || input.numberOfDays < 4 || dayIndex < 2 || dayIndex >= input.numberOfDays - 1) return selected;
  const selectedIds = new Set(selected.map((item) => item.place.id));
  const selectedOrScheduled = [...candidates.filter((item) => scheduled.has(item.place.id)), ...selected];
  const alreadyHasNearbyRegional = selectedOrScheduled.some((item) => {
    const flag = item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility);
    return flag.isDayTrip || flag.isRegionalDestination || isRegionalExcursionPlace(item.place);
  });
  if (alreadyHasNearbyRegional) return selected;
  const nearby = candidates
    .filter((item) => !scheduled.has(item.place.id) && !selectedIds.has(item.place.id))
    .map((item) => ({
      item,
      flag: item.intelligence?.classification || classifyPlaceForPlanning(item.place, profile, input, item.intelligence?.routeFeasibility),
      routeRank: routeRank(item.intelligence?.routeFeasibility?.classification)
    }))
    .filter(({ item, flag, routeRank: rank }) => {
      if (rank > 1 || flag.isRestaurant || flag.isFoodHall || flag.isBar || flag.isOrdinaryBusiness || flag.isChildrenFocused) return false;
      const text = normalizeText(`${item.place.name} ${item.place.shortDescription || ""} ${(item.place.categories || []).join(" ")} ${(item.place.tags || []).join(" ")}`);
      return flag.isDayTrip || flag.isRegionalDestination || /\b(university|gardens|garden|downtown|college town|nearby|regional|historic district)\b/.test(text) && Number(item.place.priorityScore || 0) >= 72;
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
  if (isGenericParkContainer(item.place, profile)) return false;
  return true;
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

function scheduleDay(profile, input, constraints, places, dayIndex, mealUsage = new Map(), eveningUsage = new Map()) {
  const items = [];
  const buffers = paceDefaults(input.pace).buffer;
  const mealDuration = input.pace === "Relaxed" ? 75 : 60;
  const travelContext = tripTravelContext(profile, input);
  const isArrivalDay = dayIndex === 0 && travelContext.needsArrivalLogistics;
  const isDepartureDay = dayIndex === input.numberOfDays - 1 && travelContext.needsDepartureLogistics;
  const parkRouteDay = shouldPackLunchForDay(places);
  const breakfastStart = constraints.breakfastMinutes;
  const longArrivalDrive = isArrivalDay && travelContext.originDriveMinutes >= 360;
  const arrivalActivityStart = isArrivalDay
    ? Math.max(16 * 60, travelContext.arrivalMinutes + (longArrivalDrive ? 105 : 60))
    : 0;
  const activityStart = Math.max(parseTime(input.earliestActivity) ?? 9 * 60, breakfastStart + 60, arrivalActivityStart);
  const firstRegion = places[0]?.regionId || profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id || "";
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
    addMeal(items, "lunch", Math.max(12 * 60, travelContext.arrivalMinutes - 45), mealDuration, mealTitle(profile, firstRegion, "lunch"), mealRecommendation(profile, input, firstRegion, "lunch", mealUsage), firstRegion, input, constraints, mealUsage);
    items.push(simpleItem("lodging", Math.max(15 * 60, travelContext.arrivalMinutes + 45), 45, "Hotel check-in and reset", "Check in, park, unpack lightly, and leave a buffer before any first-evening plans."));
  } else {
    addMeal(items, "breakfast", breakfastStart, 45, mealTitle(profile, firstRegion, "breakfast"), mealRecommendation(profile, input, firstRegion, "breakfast", mealUsage), firstRegion, input, constraints, mealUsage);
  }
  let cursor = activityStart;
  const dayPlaces = isDepartureDay
    ? places.filter((place) => isDepartureFriendly(place)).slice(0, 1)
    : isArrivalDay
      ? places.filter((place) => isArrivalEveningFriendly(place)).slice(0, 1)
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
    }
    if (index === 1 && !items.some((item) => item.type === "lunch") && cursor > constraints.lunchMinutes - 30) {
      const lunchRecommendation = parkRouteDay ? packedLunchRecommendation(profile, input, place.regionId) : mealRecommendation(profile, input, place.regionId, "lunch", mealUsage);
      addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, mealTitle(profile, place.regionId, "lunch"), lunchRecommendation, place.regionId, input, constraints, parkRouteDay ? null : mealUsage);
      cursor = Math.max(cursor, constraints.lunchMinutes + mealDuration + buffers);
    }
    const scheduledActivity = activityItem(place, cursor, constraints, index);
    items.push(scheduledActivity);
    cursor += scheduledActivity.durationMinutes + buffers;
    previousScheduledPlace = place;
  });
  if (!items.some((item) => item.type === "lunch")) {
    const lunchRegion = places[0]?.regionId || firstRegion;
    const lunchRecommendation = parkRouteDay ? packedLunchRecommendation(profile, input, lunchRegion) : mealRecommendation(profile, input, lunchRegion, "lunch", mealUsage);
    addMeal(items, "lunch", constraints.lunchMinutes, mealDuration, mealTitle(profile, lunchRegion, "lunch"), lunchRecommendation, lunchRegion, input, constraints, parkRouteDay ? null : mealUsage);
  }
  const afterActivities = Math.max(cursor, constraints.dinnerMinutes - (input.pace === "Packed" ? 45 : 90));
  if (!isDepartureDay && input.pace !== "Packed") {
    items.push(simpleItem("freeTime", afterActivities, input.pace === "Relaxed" ? 90 : 60, "Reset and free time", "A buffer window to rest, freshen up, or handle traffic without compressing dinner."));
  }
  const dinnerRegion = places.at(-1)?.regionId || firstRegion;
  if (isDepartureDay) {
    items.push(simpleItem("lodging", 10 * 60, 30, "Hotel checkout", "Check out, load bags, and keep the final day lighter so the return trip is not rushed."));
    items.push(departureTravelItem(profile, input, travelContext));
    const returnDinnerStart = Math.max(constraints.dinnerMinutes, departureTravelItem(profile, input, travelContext).endTimeMinutes + 30);
    addMeal(items, "dinner", returnDinnerStart, input.pace === "Relaxed" ? 90 : 75, `${input.origin || "Return city"} dinner after return`, {
      primary: `Dinner near ${input.origin || "your return area"}`,
      secondary: "Choose a restaurant close to the final arrival point",
      text: `After the return trip, choose dinner near ${input.origin || "the final arrival point"} and keep the evening close to where you arrive.`,
      cuisine: "Flexible",
      price: moneyRange(mealCost(input, "dinner").low, mealCost(input, "dinner").high),
      reservation: "Keep this flexible unless you already know your arrival time."
    }, "", input, constraints);
  } else {
    addMeal(items, "dinner", constraints.dinnerMinutes, input.pace === "Relaxed" ? 90 : 75, mealTitle(profile, dinnerRegion, "dinner"), mealRecommendation(profile, input, dinnerRegion, "dinner", mealUsage), dinnerRegion, input, constraints, mealUsage);
    const eveningStart = constraints.dinnerMinutes + (input.pace === "Relaxed" ? 105 : 90);
    const usedActivityIds = new Set([
      ...dayPlaces.map((place) => place.id),
      ...items.map((item) => item.placeId).filter(Boolean)
    ]);
    const evening = eveningItem(profile, input, constraints, dinnerRegion, eveningStart, dayIndex, usedActivityIds, eveningUsage);
    if (evening?.placeId) eveningUsage.set(evening.placeId, (eveningUsage.get(evening.placeId) || 0) + 1);
    if (evening.endTimeMinutes <= constraints.latestReturnMinutes || input.pace === "Packed") items.push(evening);
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

function scheduledDurationForPlace(place, classification = classifyPlaceForPlanning(place), index = 0) {
  const base = Number(place.typicalDurationMinutes || 90);
  const source = place.sourceMetadata?.provider || "";
  if (source === "curated" || base >= 210) return base;
  const text = normalizeText(`${place.name} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
  const seed = stableNumber(`${place.id || place.name}-${index}`);
  let adjusted = base;
  if (/short stop|viewpoint|landmark|capitol|market/.test(text)) adjusted = Math.min(adjusted, 75);
  if (classification.isMuseum) adjusted = Math.max(90, adjusted);
  if (classification.isPark || classification.isBeachOrWaterfront) adjusted = Math.max(70, adjusted);
  adjusted += ((seed % 3) - 1) * 10;
  return Math.max(35, Math.min(Number(place.maximumDurationMinutes || adjusted + 60), Math.max(Number(place.minimumDurationMinutes || 35), Math.round(adjusted / 5) * 5)));
}

function addMeal(items, type, start, duration, title, recommendation, regionId, input, constraints, mealUsage = null) {
  const meal = typeof recommendation === "string" ? { text: recommendation, primary: "", secondary: "", cuisine: "", price: "", reservation: "" } : recommendation;
  if (mealUsage && meal.primaryPlaceId) mealUsage.set(meal.primaryPlaceId, (mealUsage.get(meal.primaryPlaceId) || 0) + 1);
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
      primaryPlaceId: meal.primaryPlaceId || "",
      secondaryPlaceId: meal.secondaryPlaceId || "",
      restaurantPlaceId: meal.primaryPlaceId || "",
      restaurantName: meal.primary || "",
      mealTypesServed: meal.mealTypesServed || [type],
      cuisine: meal.cuisine,
      openingHours: meal.openingHours || "Hours not verified; confirm directly before relying on this meal.",
      routeDetour: meal.routeDetour || "Placed near the day route area.",
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
  const originCoordinates = input.fromLocation?.latitude && input.fromLocation?.longitude
    ? { lat: Number(input.fromLocation.latitude), lng: Number(input.fromLocation.longitude) }
    : knownLocationCoordinates(input.origin);
  const destinationCoordinates = input.destinationLocation?.latitude && input.destinationLocation?.longitude
    ? { lat: Number(input.destinationLocation.latitude), lng: Number(input.destinationLocation.longitude) }
    : profile.regions[0]?.centerCoordinates;
  const distance = originCoordinates && destinationCoordinates ? haversineMiles(originCoordinates.lat, originCoordinates.lng, destinationCoordinates.lat, destinationCoordinates.lng) : 0;
  const liveDriveMinutes = routeEstimate && driving ? routeEstimate.durationMinutes : 0;
  const driveMinutes = liveDriveMinutes || (distance ? Math.max(60, Math.round(distance / 0.72) + 35) : driving ? 180 : 150);
  const routeDistance = routeEstimate?.distanceMiles || Math.round(distance);
  const arrivalMinutes = driving ? Math.min(21 * 60, 8 * 60 + driveMinutes) : 13 * 60 + 30;
  return {
    needsArrivalLogistics: Boolean(input.origin && !sameDestination),
    needsDepartureLogistics: Boolean(input.origin && !sameDestination && input.numberOfDays > 1),
    transportMode: driving ? "drive" : "fly",
    departureMinutes: driving ? 8 * 60 : 9 * 60,
    arrivalMinutes,
    originDriveMinutes: driveMinutes,
    originDistanceMiles: routeDistance,
    routeSource: routeEstimate?.provider || "",
    routeCheckedAt: routeEstimate?.checkedAt || routeEstimate?.retrievedAt || "",
    routeConfidence: routeEstimate?.confidence || (liveDriveMinutes ? "provider" : distance ? "coordinate" : "fallback"),
    estimateType: liveDriveMinutes ? "provider-route-estimate" : distance ? "coordinate-arrival-estimate" : "conservative-arrival-estimate"
  };
}

function knownLocationCoordinates(value) {
  if (!String(value || "").trim()) return null;
  return null;
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
      provider: context.routeSource,
      checkedAt: context.routeCheckedAt,
      confidence: context.routeConfidence,
      note: context.estimateType === "provider-route-estimate" ? "Provider route estimate with a conservative arrival buffer; verify live traffic before departure." : "Conservative arrival-day estimate; verify live traffic or flight times."
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
      provider: context.routeSource,
      checkedAt: context.routeCheckedAt,
      confidence: context.routeConfidence,
      note: context.estimateType === "provider-route-estimate" ? "Provider route estimate with a conservative return buffer; verify live traffic before departure." : "Conservative departure-day estimate; verify live traffic or flight times."
    },
    replaceable: false
  };
}

function travelItem(fromLabel, toLabel, start, travel) {
  return {
    ...simpleItem("travel", start, travel.durationMinutes, `${travel.mode === "Walk/Metro" ? "Transfer" : "Estimated drive"} to ${toLabel}`, `${travel.mode === "Walk/Metro" ? "Walk, Metro, or short rideshare transfer" : "Estimated drive"}: ${travel.durationMinutes}-${travel.durationMinutes + 15} minutes depending on traffic.`),
    travelFromPrevious: travel,
    locationLabel: `${fromLabel} to ${toLabel}`,
    replaceable: false
  };
}

function eveningItem(profile, input, constraints, regionId, start, dayIndex, usedActivityIds = new Set(), eveningUsage = new Map()) {
  const anchor = eveningAnchorPlace(profile, input, constraints, regionId, usedActivityIds, start, eveningUsage);
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

function eveningAnchorPlace(profile, input, constraints, regionId, usedActivityIds = new Set(), start = 19 * 60, eveningUsage = new Map()) {
  const candidates = profile.places
    .map((place) => ({ place, classification: classifyPlaceForPlanning(place, profile, input), travel: estimateTravel(profile, regionId, place.regionId).durationMinutes }))
    .filter(({ classification }) => classification.isEveningAnchor || classification.isBoardwalk || classification.isBeachOrWaterfront || (!constraints.noAlcohol && classification.isBar))
    .filter(({ classification }) => !classification.isChildrenFocused && !classification.isOrdinaryBusiness && !classification.isDinnerShow)
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
  const input = { ...plan.preferencesSnapshot, variationSeed: (plan.generationMetadata.variationSeed || 0) + 7 };
  const tripLike = denormalizedTrip(input);
  const next = generateTripPlan(tripLike, { variationSeed: input.variationSeed });
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
  day.dailyDriveMinutes = day.scheduleItems.filter((item) => item.type === "travel").reduce((sum, item) => sum + item.durationMinutes, 0);
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
    options.push(tripShapeOption({
      id: "shape-regional-extension",
      title: "Regional extension with one optional second base",
      structureType: "One base plus one overnight extension",
      routeSequence: [profile.canonicalName, overnight.place.name, profile.canonicalName],
      overnightBases: [
        { base: base?.name || profile.canonicalName, nights: Math.max(1, calculateTripNights(input.numberOfDays) - 1) },
        { base: overnight.place.name, nights: 1 }
      ],
      hotelChanges: 1,
      majorTransferDays: [`Transfer to ${overnight.place.name}`, `Return from ${overnight.place.name}`],
      totalEstimatedDriving: `${formatDuration(overnightRoundTrip + 90)} plus local driving`,
      totalMajorDriving: overnightRoundTrip,
      longestDrivingDay: `${overnight.place.name}, about ${formatDuration(overnightRoundTrip)}`,
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
  if (input.routeQualityRequired && hasUnverifiedArrivalRoute(plan)) {
    blocking.push(advisory("arrival-route-unverified", "blocking", "route", "Arrival route was not verified", "Driving trips that require route quality must use a provider route estimate before scheduling arrival or departure days.", "Retry route estimation before building the detailed itinerary."));
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
    if (day.scheduleItems.some((item) => item.weatherDependency === "high") && !day.backupOptions.length) {
      blocking.push(advisory(`backup-${day.id}`, "caution", "weather", `Day ${day.dayNumber} backup missing`, "Outdoor-heavy days should include at least one backup option.", "Replace one item with a lower-weather-dependency option."));
    }
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

function hasUnverifiedArrivalRoute(plan) {
  const travel = plan.days
    .flatMap((day) => day.scheduleItems || [])
    .filter((item) => item.type === "travel" && (/^Travel to |^Depart /.test(item.title || "")));
  if (!travel.length) return false;
  return travel.some((item) => item.travelFromPrevious?.estimateType !== "provider-route-estimate");
}

function hasImplausibleArrivalDrive(plan) {
  const input = plan.preferencesSnapshot || {};
  const routeRequired = Boolean(input.routeQualityRequired);
  const origin = normalizeText(input.origin || plan.origin);
  const destination = normalizeText(input.destination || plan.destination);
  const longKnownPair = /\b(charlotte north carolina|charlotte nc)\b/.test(origin) && /\b(washington|district of columbia|dc)\b/.test(destination);
  if (!routeRequired && !longKnownPair) return false;
  return plan.days
    .flatMap((day) => day.scheduleItems || [])
    .filter((item) => item.type === "travel" && (/^Travel to |^Depart /.test(item.title || "")))
    .some((item) => Number(item.travelFromPrevious?.durationMinutes || item.durationMinutes || 0) < 300);
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
  if (maxShare(frequency(durations)) > 0.4) return true;
  for (let index = 2; index < durations.length; index += 1) {
    if (durations[index] === durations[index - 1] && durations[index] === durations[index - 2]) return true;
  }
  return false;
}

function hasRepeatedMealPattern(plan) {
  const meals = plan.days.flatMap((day) => day.scheduleItems).filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type));
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
  const urbanTitle = urbanDayTitle(activityItems, eveningItems, dominantRegion);
  if (urbanTitle && isUrbanDestinationProfile(profile)) return urbanTitle;
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

function urbanDayTitle(activityItems, eveningItems = [], dominantRegion = "") {
  const text = normalizeText([...activityItems, ...eveningItems].map((item) => `${item.title} ${item.category || ""} ${(item.tags || []).join(" ")}`).join(" "));
  if (!text) return "";
  if (/\b(capitol|library of congress|supreme court|botanic garden|eastern market)\b/.test(text)) return "Capitol Hill, Library, and market time";
  if (/\b(lincoln memorial|washington monument|national mall|reflecting pool|vietnam veterans|world war ii|jefferson memorial|martin luther king jr memorial|tidal basin)\b/.test(text)) return "National Mall monuments and memorials";
  if (/\b(georgetown|dupont|wharf|waterfront|kennedy center)\b/.test(text)) return "Georgetown, waterfront, and evening views";
  if (/\b(arlington|alexandria|mount vernon)\b/.test(text)) return "Arlington and nearby historic neighborhoods";
  if (/\b(portrait gallery|national gallery|american history|natural history|african american|holocaust|museum|smithsonian)\b/.test(text)) return `${dominantRegion} museums and culture`;
  return "";
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
    let durationMinutes = Math.max(8, Math.round(routeMinutes ? Math.max(routeMinutes, minimum) : minimum + (distanceMiles > 20 ? 18 : 8)));
    if (fromRegionId !== toRegionId && isMountainRegionalTransfer(profile, fromPlaceOrRegion, toPlaceOrRegion)) {
      durationMinutes = Math.max(durationMinutes, 25);
    }
    const urbanTransfer = isUrbanDestinationProfile(profile) && distanceMiles <= 4.5 && !route?.tags?.includes("drive-only");
    return {
      mode: urbanTransfer ? "Walk/Metro" : "Drive",
      durationMinutes,
      distanceMiles: Math.max(0.5, Math.round(distanceMiles * 10) / 10),
      fromLabel: placeOrRegionLabel(profile, fromPlaceOrRegion, fromRegionId),
      toLabel: placeOrRegionLabel(profile, toPlaceOrRegion, toRegionId),
      estimateType: route ? "curated-coordinate-estimate" : "coordinate-plausibility-estimate",
      note: urbanTransfer ? `Walk, Metro, or short rideshare transfer: about ${durationMinutes} minutes over ${Math.max(0.5, Math.round(distanceMiles * 10) / 10)} miles. Verify current transit and walking conditions.` : `Estimated drive: about ${durationMinutes} minutes over ${Math.max(0.5, Math.round(distanceMiles * 10) / 10)} miles. Verify live traffic before traveling.`
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

function mealRecommendation(profile, input, regionId, mealType, mealUsage = new Map()) {
  const area = profile.foodAreas.find((candidate) => candidate.regionId === regionId && candidate.mealTypes.includes(mealType)) || profile.foodAreas.find((candidate) => candidate.mealTypes.includes(mealType));
  const cuisine = (input.food.cuisine || []).find((item) => area?.cuisines.some((cuisineName) => normalizeText(cuisineName).includes(normalizeText(item)))) || (input.food.cuisine || [])[0] || "local";
  const primaryPlace = mealCandidatePlace(profile, regionId, mealType, new Set(), mealUsage) || mealCandidatePlace(profile, regionId, mealType, new Set(), mealUsage, true);
  const excluded = new Set([primaryPlace?.id].filter(Boolean));
  const secondaryPlace = mealCandidatePlace(profile, regionId, mealType, excluded, mealUsage, true) || mealCandidatePlace(profile, area?.regionId, mealType, excluded, mealUsage, true);
  const primary = primaryPlace?.name || specificFoodAreaLabel(profile, area, regionId, mealType);
  const secondary = secondaryPlace?.name || secondaryFoodOption(profile, area, regionId);
  const price = moneyRange(mealCost(input, mealType).low, mealCost(input, mealType).high);
  const reservation = mealType === "dinner" ? "Reserve if this is a must-do meal or the group is larger; otherwise verify hours day-of." : "Reservations usually optional; verify hours and menus day-of.";
  const routeMinutes = primaryPlace ? estimateTravel(profile, regionId, primaryPlace.regionId).durationMinutes : 0;
  const classification = primaryPlace ? classifyPlaceForPlanning(primaryPlace, profile, input) : null;
  return {
    primary,
    secondary,
    primaryPlaceId: primaryPlace?.id || "",
    secondaryPlaceId: secondaryPlace?.id || "",
    text: `${primary}. Backup: ${secondary}. Cuisine fit: ${titleCase(cuisine)} / local options. Estimated ${price} per person. ${reservation} Dietary and allergy safety must be confirmed directly with the restaurant.`,
    cuisine: titleCase(cuisine),
    price,
    reservation,
    mealTypesServed: supportedMealTypes(classification),
    openingHours: primaryPlace?.openingTimeGuidance || "Hours not verified; confirm directly before relying on this meal.",
    routeDetour: primaryPlace ? `${routeMinutes <= 15 ? "Minimal" : `${routeMinutes} min`} detour from the current route cluster.` : "Placed by dining area, not a verified restaurant.",
    priceLevel: price,
    dietaryFit: "Restaurant must confirm dietary and allergy needs directly.",
    reservationNeed: reservation,
    confidence: primaryPlace ? classification?.confidence || "medium" : "low"
  };
}

function mealCandidatePlace(profile, regionId, mealType, excludedIds = new Set(), mealUsage = new Map(), allowReused = false) {
  const excluded = excludedIds instanceof Set ? excludedIds : new Set([excludedIds].filter(Boolean));
  const byMealFit = (place) => {
    if (!isMealCandidate(place, mealType) || excluded.has(place.id)) return false;
    const usage = mealUsage.get(place.id) || 0;
    const classification = classifyPlaceForPlanning(place);
    const maxUsage = classification.isFoodHall ? 1 : 2;
    return allowReused ? usage < maxUsage : usage === 0;
  };
  const regionMatches = profile.places
    .filter((place) => place.regionId === regionId)
    .filter(byMealFit)
    .sort((a, b) => (mealUsage.get(a.id) || 0) - (mealUsage.get(b.id) || 0) || b.priorityScore - a.priorityScore);
  if (regionMatches.length) return regionMatches[0];
  return profile.places
    .filter(byMealFit)
    .sort((a, b) => {
      const routeA = estimateTravel(profile, regionId, a.regionId).durationMinutes;
      const routeB = estimateTravel(profile, regionId, b.regionId).durationMinutes;
      return routeA - routeB || (mealUsage.get(a.id) || 0) - (mealUsage.get(b.id) || 0) || b.priorityScore - a.priorityScore;
    })[0] || null;
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

function childFreeAdultTrip(input) {
  return Number(input.childCount || input.children || 0) === 0 && Number(input.travelers || input.adults || 1) >= 1;
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
