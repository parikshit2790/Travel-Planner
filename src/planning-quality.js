import { classifyPlaceForPlanning, firstTimeVisitorValueFor } from "./destination-intelligence.js";

export const PLANNING_STAGE_NAMES = [
  "destination-understanding",
  "dynamic-research-plan",
  "multi-source-research-normalization",
  "candidate-ontology-classification",
  "destination-opportunity-graph",
  "traveler-fit-filtering",
  "coverage-and-route-shape-selection",
  "geographic-clustering",
  "opening-hours-and-seasonality-screening",
  "meal-and-evening-placement",
  "hard-validation",
  "independent-quality-critique",
  "bounded-repair-loop",
  "final-rendering"
];

const CATEGORY_BY_CLASSIFICATION = [
  ["restaurant", (flag) => flag.isRestaurant || flag.isFoodHall],
  ["bar-or-nightlife", (flag) => flag.isBar],
  ["beach-or-waterfront", (flag) => flag.isBeachOrWaterfront || flag.isBoardwalk || flag.isPier],
  ["outdoor-nature", (flag) => flag.isPark || flag.isMountainOrTrail || flag.isWaterActivity],
  ["museum-or-culture", (flag) => flag.isMuseum || flag.isNeighborhood],
  ["evening-anchor", (flag) => flag.isEveningAnchor],
  ["family-attraction", (flag) => flag.isFamilyFocused || flag.isChildrenFocused],
  ["shopping-entertainment", (flag) => flag.isEntertainmentCenter],
  ["attraction", () => true]
];

export function buildPlanningStageTrace(extra = {}) {
  return PLANNING_STAGE_NAMES.map((name, index) => ({
    index: index + 1,
    name,
    status: extra[name] || "completed"
  }));
}

export function buildDynamicResearchPlan(profile, input, intelligence) {
  const archetype = intelligence?.destinationArchetype || {};
  const primaryArchetype = archetype.primaryArchetype || "mixed urban/nature";
  const cityName = shortDestinationName(profile);
  const coreDomains = [
    "signature attractions",
    "neighborhood character",
    "route-compatible meals",
    "weather backups",
    "first-time visitor anchors",
    "practical travel time",
    "opening-hours confidence"
  ];
  const archetypeDomains = domainsForArchetype(primaryArchetype);
  const profileSnapshot = {
    canonicalName: profile.canonicalName,
    city: cityName,
    stateOrRegion: profile.state || profile.country || "",
    country: profile.country || "",
    primaryArchetype,
    secondaryArchetypes: archetype.secondaryArchetypes || [],
    definingExperiences: archetype.definingExperiences || [],
    expectedCategoryMix: archetype.expectedCategoryMix || {},
    foodIdentity: archetype.foodIdentity || "local dining",
    eveningStrength: archetype.eveningStrength || "unknown",
    regionalExtensions: archetype.regionalExtensions || [],
    regionalDestinationProfile: intelligence?.regionalDestinationProfile || null,
    confidence: archetype.confidence || intelligence?.researchConfidence || "starter"
  };
  return {
    destinationProfile: profileSnapshot,
    researchDomains: [...new Set([...coreDomains, ...archetypeDomains])],
    candidateIntakePolicy: {
      requiredFields: ["name", "coordinates or region", "type", "duration", "cost", "route fit", "traveler fit", "source confidence"],
      rejectIf: [
        "ordinary business without destination value",
        "children-focused stop for child-free adult trips unless explicitly requested",
        "restaurant used as an attraction",
        "attraction used as a meal venue",
        "regional stop beyond the trip's drive budget"
      ]
    },
    cachePolicy: {
      keyParts: [
        stableKey(profile.canonicalName),
        stableKey(profile.country || ""),
        stableKey(primaryArchetype),
        String(input.numberOfDays || ""),
        monthBucket(input.startDate),
        "planner-quality-v1"
      ].filter(Boolean),
      excludesPersonalData: true,
      excludesTravelerNames: true,
      invalidation: "destination profile, provider data, schema version, or travel season changes"
    }
  };
}

export function normalizePlanningCandidate(candidate, profile, input = {}) {
  const place = candidate?.place || candidate || {};
  const classification = candidate?.classification || classifyPlaceForPlanning(place, profile, input, candidate?.routeFeasibility);
  const primaryType = primaryTypeFor(classification);
  const secondaryTypes = secondaryTypesFor(classification);
  const routeFeasibility = candidate?.routeFeasibility || {};
  const sourceConfidence = sourceConfidenceFor(candidate, place);
  const rejectionReasons = [];
  if (classification.isOrdinaryBusiness) rejectionReasons.push("ordinary-business");
  if (classification.isChildrenFocused && childFreeAdultTrip(input)) rejectionReasons.push("children-focused-mismatch");
  if (routeFeasibility.classification === "not-practical") rejectionReasons.push("route-not-practical");
  return {
    candidateId: place.id || candidate?.id || stableKey(place.name),
    providerPlaceId: place.sourceMetadata?.providerPlaceId || place.id || "",
    canonicalName: place.name || "Unnamed candidate",
    coordinates: coordinatesFor(place),
    city: shortDestinationName(profile),
    region: regionName(profile, place.regionId),
    geographicScope: routeFeasibility.classification || "local",
    geographicCluster: place.regionId || profile.planningRules?.defaultHotelRegion || "destination-core",
    primaryType,
    secondaryTypes,
    archetypeFit: archetypeFitFor(classification, profile, candidate),
    travelerFit: classification.travelerFit || { score: 0, reasons: [] },
    destinationSignificance: classification.destinationSignificance || { score: Number(place.priorityScore || 0), reasons: [] },
    firstTimeVisitorValue: firstTimeVisitorValueFor(place, profile, classification),
    ordinaryLocalFacilityPenalty: classification.ordinaryLocalFacilityPenalty || { score: 0, reasons: [] },
    localSignificance: Number(candidate?.significanceScore || place.priorityScore || 0),
    uniqueness: uniquenessFor(place, classification),
    seasonalFit: seasonalFitFor(place, input),
    openingHoursConfidence: openingHoursConfidenceFor(place),
    realisticDurationMin: Number(place.minimumDurationMinutes || Math.max(30, Number(place.typicalDurationMinutes || 90) - 30)),
    realisticDurationMax: Number(place.maximumDurationMinutes || Math.max(Number(place.typicalDurationMinutes || 90), 120)),
    priceConfidence: priceConfidenceFor(place),
    mealCapabilities: mealCapabilitiesFor(classification),
    ageAudience: classification.isChildrenFocused ? "children-focused" : classification.isFamilyFocused ? "family" : "adult-compatible",
    accessibility: place.accessibility || "unknown",
    bookingNeed: place.reservationRecommended ? "recommended" : "optional",
    routeCompatibility: routeFeasibility,
    sourceConfidence,
    accepted: Boolean(candidate?.accepted ?? rejectionReasons.length === 0),
    rejectionReasons
  };
}

export function buildDestinationOpportunityGraph(profile, input, intelligence, researchProfile = null) {
  const nodes = (intelligence?.allCandidates || [])
    .map((candidate) => normalizePlanningCandidate(candidate, profile, input))
    .filter((node) => node.canonicalName && node.accepted)
    .slice(0, 80);
  const edges = [];
  for (let index = 0; index < nodes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
      const from = nodes[index];
      const to = nodes[otherIndex];
      const distanceMiles = distanceBetween(from.coordinates, to.coordinates);
      const sameCluster = from.geographicCluster === to.geographicCluster;
      const routeMinutes = sameCluster ? Math.max(8, Math.round(distanceMiles / 0.45) + 8) : Math.max(18, Math.round(distanceMiles / 0.7) + 12);
      const relationship = relationshipFor(from, to, sameCluster, routeMinutes);
      if (relationship !== "distant-unrelated" || routeMinutes <= 65) {
        edges.push({
          from: from.candidateId,
          to: to.candidateId,
          relationship,
          sameCluster,
          routeMinutes,
          distanceMiles,
          validSameDay: routeMinutes <= 65,
          redundancy: redundantTypes(from, to)
        });
      }
    }
  }
  return {
    destination: profile.canonicalName,
    destinationProfile: researchProfile,
    nodes,
    edges: edges.slice(0, 180),
    coverage: coverageFor(nodes),
    routing: routingCoverageFor(edges, nodes),
    createdBy: "deterministic-planning-quality-layer"
  };
}

export function summarizeOpportunityGraph(graph) {
  return {
    destination: graph.destination,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    coverage: graph.coverage,
    routing: graph.routing,
    sampleNodes: graph.nodes.slice(0, 16).map((node) => ({
      candidateId: node.candidateId,
      canonicalName: node.canonicalName,
      primaryType: node.primaryType,
      cluster: node.geographicCluster,
      accepted: node.accepted,
      destinationSignificance: node.destinationSignificance?.score || 0
    }))
  };
}

export function evaluateDestinationOpportunityCoverage(graph, destinationProfile = {}) {
  const failures = [];
  const coverage = graph.coverage || {};
  if (!coverage.attraction) failures.push("missing-attraction-candidates");
  if (!coverage.restaurant) failures.push("missing-meal-candidates");
  if ((destinationProfile.primaryArchetype === "beach/coastal") && !coverage["beach-or-waterfront"]) failures.push("missing-beach-waterfront-candidates");
  if ((destinationProfile.primaryArchetype === "mountain") && !coverage["outdoor-nature"]) failures.push("missing-outdoor-nature-candidates");
  if ((destinationProfile.primaryArchetype === "major city") && !(coverage["museum-or-culture"] || coverage.neighborhood)) failures.push("missing-city-culture-candidates");
  return {
    pass: failures.length === 0,
    hardFailures: failures,
    coverage,
    minimums: {
      attraction: 1,
      restaurant: 1,
      archetypeSpecific: destinationProfile.primaryArchetype || "mixed urban/nature"
    }
  };
}

const INTERNAL_ID_KEYS = new Set(["id", "placeId", "regionId", "dayId", "itemId", "destinationProfileId", "sourceTripId", "originRegionId", "destinationRegionId", "candidateId"]);

function publicFacingJsonText(plan) {
  return JSON.stringify({
    overview: plan.overview,
    days: plan.days,
    foodPlan: plan.foodPlan,
    routeSummary: plan.routeSummary,
    hotelBase: plan.hotelBase,
    tripGuide: plan.tripGuide
  }, (key, value) => (INTERNAL_ID_KEYS.has(key) ? undefined : value));
}

export function critiquePlanDeterministically(plan, graph = {}) {
  const issues = [];
  const hardFailures = [];
  const allItems = (plan.days || []).flatMap((day) => day.scheduleItems || []);
  const publicText = publicFacingJsonText(plan).toLowerCase();

  if (isProviderGeneratedPlan(plan) && /(google places|openrouteservice point-of-interest candidate|provider-found|provider-retrieved|culture-area|central-area|food-area|nature-area|central area day|google places .* candidate|core area|museums and historic sights|parks and outdoor stops|dining and evening area|stop to consider|breakfast option|lunch option|dinner option|no items in this tier|skipped a late evening activity)/.test(publicText)) {
    hardFailures.push("internal-or-template-language");
  }
  if ((plan.days || []).length !== Number(plan.numberOfDays || 0)) hardFailures.push("day-count-mismatch");
  const mealItems = allItems.filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type) && !item.structurallyUnbacked);
  const mealNames = mealItems.map((item) => normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || item.title)).filter(Boolean);
  const repeatedMeal = mostCommonCount(mealNames);
  if (hasSameVenueForAllMealTypes(mealItems)) hardFailures.push("universal-restaurant-dominance");
  if (mealNames.length >= 6 && repeatedMeal > Math.ceil(mealNames.length * 0.7)) hardFailures.push("universal-restaurant-dominance");
  else if (mealNames.length >= 4 && repeatedMeal > Math.ceil(mealNames.length * 0.45)) issues.push("restaurant-repetition-risk");
  if (hasFixedDurationDominance(allItems)) issues.push("fixed-duration-dominance");
  if (hasFixedCostDominance(allItems)) issues.push("fixed-cost-dominance");
  if (hasRepeatedDaytimeEvening(plan)) hardFailures.push("duplicated-daytime-evening");
  if (hasRawPlaceLabel(allItems)) hardFailures.push("raw-place-label");
  if (isProviderGeneratedPlan(plan) && !isDisclosedStarterFallbackPlan(plan) && hasUnverifiedMealDominance(mealItems)) hardFailures.push("meal-research-insufficient");
  if ((plan.days || []).some((day) => genericDayTitle(day.title))) issues.push("generic-day-title");
  if (hasMuseumDominance(plan)) hardFailures.push("category-concentration");
  if (hasSamePrimaryMealForMultipleDays(mealItems)) hardFailures.push("meal-repetition");
  if (hasMealVenueThatLooksLikeActivity(mealItems)) hardFailures.push("meal-venue-not-restaurant");
  if ((graph.coverage?.restaurant || 0) === 0 && mealItems.length) hardFailures.push("meal-candidates-not-backed-by-graph");
  if ((graph.coverage?.attraction || 0) === 0) hardFailures.push("destination-attraction-coverage-missing");
  if (hasSignatureCoverageFailure(plan, graph)) hardFailures.push("signature-attraction-coverage");
  if (hasOrdinaryLocalFacilityPromotion(plan, graph)) hardFailures.push("ordinary-local-facility-overpromotion");
  if (hasStaleAttractionRecommendation(plan)) hardFailures.push("stale-attraction-recommended");
  if (hasWeakFirstTimeCoverage(plan, graph)) hardFailures.push("first-time-coverage-insufficient");
  const regionalQuality = regionalDestinationQuality(plan, graph);
  regionalQuality.hardFailures.forEach((failure) => hardFailures.push(failure));
  regionalQuality.issues.forEach((issue) => issues.push(issue));
  if ((plan.days || []).some((day) => (day.backupOptions || []).some((backup) => Number(backup.estimatedDurationMinutes || 0) > 240))) issues.push("backup-too-large");
  if ((plan.days || []).some((day) => hasImplausibleDaySpan(day.scheduleItems || []))) hardFailures.push("day-schedule-exceeds-calendar-day");

  const subScores = {
    destinationFit: scoreFrom(100, hardFailures.includes("destination-attraction-coverage-missing") ? 35 : 0, hardFailures.includes("signature-attraction-coverage") ? 38 : 0, hardFailures.includes("first-time-coverage-insufficient") ? 32 : 0, hardFailures.includes("ordinary-local-facility-overpromotion") ? 35 : 0, hardFailures.includes("category-concentration") ? 30 : 0, issues.includes("generic-day-title") ? 8 : 0),
    routeLogic: scoreFrom(100, hardFailures.includes("day-count-mismatch") ? 40 : 0, issues.includes("backup-too-large") ? 8 : 0),
    mealValidity: scoreFrom(100, hardFailures.includes("universal-restaurant-dominance") ? 35 : 0, hardFailures.includes("meal-repetition") ? 30 : 0, hardFailures.includes("meal-venue-not-restaurant") ? 35 : 0, hardFailures.includes("meal-candidates-not-backed-by-graph") ? 20 : 0, hardFailures.includes("meal-research-insufficient") ? 35 : 0, issues.includes("restaurant-repetition-risk") ? 6 : 0),
    scheduleRealism: scoreFrom(100, issues.includes("fixed-duration-dominance") ? 18 : 0, hardFailures.includes("duplicated-daytime-evening") ? 30 : 0, hardFailures.includes("raw-place-label") ? 30 : 0, hardFailures.includes("stale-attraction-recommended") ? 45 : 0, hardFailures.includes("day-schedule-exceeds-calendar-day") ? 60 : 0),
    costRealism: scoreFrom(100, issues.includes("fixed-cost-dominance") ? 18 : 0),
    languageQuality: scoreFrom(100, hardFailures.includes("internal-or-template-language") ? 60 : 0, issues.includes("generic-day-title") ? 8 : 0),
    mealDiversity: regionalQuality.scores.mealDiversity,
    cafeDiversity: regionalQuality.scores.cafeDiversity,
    mealRouteFit: regionalQuality.scores.mealRouteFit,
    regionalFoodCoverage: regionalQuality.scores.regionalFoodCoverage,
    regionalPlanning: regionalQuality.scores.regionalPlanning
  };
  const score = Math.round(Object.values(subScores).reduce((sum, value) => sum + value, 0) / Object.values(subScores).length);
  return {
    critic: "deterministic-route-mosaic-quality-critic-v1",
    threshold: 85,
    pass: score >= 85 && hardFailures.length === 0,
    score,
    subScores,
    issues,
    hardFailures,
    checkedRules: [
      "destination specificity",
      "meal venue validity",
      "day count",
      "template-language leakage",
      "duration and cost variation",
      "backup plausibility",
      "candidate graph coverage",
      "experience category concentration",
      "meal repetition",
      "first-time signature coverage",
      "ordinary local facility suppression",
      "current-status confidence",
      "regional corridor and gateway-town coverage",
      "mountain destination park specificity",
      "meal diversity and route fit",
      "single calendar-day schedule span"
    ]
  };
}

function hasImplausibleDaySpan(items) {
  const starts = items.map((item) => Number(item.startTimeMinutes)).filter(Number.isFinite);
  const ends = items.map((item) => Number(item.endTimeMinutes)).filter(Number.isFinite);
  if (!starts.length || !ends.length) return false;
  return (Math.max(...ends) - Math.min(...starts)) > 20 * 60;
}

export function calculateTemplateSimilarityScore(plan) {
  const allItems = (plan.days || []).flatMap((day) => day.scheduleItems || []);
  const durationCounts = frequency(allItems.filter((item) => item.type === "activity").map((item) => item.durationMinutes));
  const costCounts = frequency(allItems.filter((item) => item.type === "activity").map((item) => `${item.estimatedCostPerPerson?.low || 0}-${item.estimatedCostPerPerson?.high || 0}`));
  const titlePatterns = frequency((plan.days || []).map((day) => normalizeText(day.title).replace(/[a-z]+/g, "x")));
  const maxDurationShare = maxShare(durationCounts);
  const maxCostShare = maxShare(costCounts);
  const maxTitlePatternShare = maxShare(titlePatterns);
  return {
    score: Math.round((maxDurationShare * 35 + maxCostShare * 35 + maxTitlePatternShare * 30) * 100) / 100,
    maxDurationShare,
    maxCostShare,
    maxTitlePatternShare,
    flags: [
      maxDurationShare > 0.7 ? "duration-template-risk" : "",
      maxCostShare > 0.7 ? "cost-template-risk" : "",
      maxTitlePatternShare > 0.7 ? "title-template-risk" : ""
    ].filter(Boolean)
  };
}

export function buildPlannerObservabilitySummary({ researchPlan, graph, coverageValidation, critique, templateSimilarity }) {
  return {
    mode: "safe-planner-observability",
    destination: researchPlan?.destinationProfile?.canonicalName || graph?.destination || "",
    primaryArchetype: researchPlan?.destinationProfile?.primaryArchetype || "",
    candidateCount: graph?.nodes?.length || 0,
    graphEdgeCount: graph?.edges?.length || 0,
    coveragePass: Boolean(coverageValidation?.pass),
    criticScore: critique?.score || 0,
    criticPass: Boolean(critique?.pass),
    templateSimilarityScore: templateSimilarity?.score || 0,
    secretValuesIncluded: false
  };
}

function domainsForArchetype(archetype) {
  if (archetype === "beach/coastal") return ["beaches and waterfront access", "coastal nature", "sunset/evening waterfront", "seafood and breakfast"];
  if (archetype === "mountain") return ["trailheads", "scenic drives", "viewpoints", "waterfalls", "weather-safe town blocks"];
  if (archetype === "national park") return ["named scenic corridors", "trailheads", "waterfalls", "visitor areas", "gateway towns", "park closures and parking", "packed lunch planning"];
  if (archetype === "major city") return ["landmarks", "museums", "historic neighborhoods", "food districts", "transit and parking"];
  if (archetype === "food destination") return ["signature restaurants", "markets", "regional cuisine", "reservation needs"];
  return ["signature local anchors", "nearby nature", "neighborhoods", "food districts"];
}

function primaryTypeFor(classification) {
  return CATEGORY_BY_CLASSIFICATION.find(([, predicate]) => predicate(classification))?.[0] || "attraction";
}

function secondaryTypesFor(classification) {
  return CATEGORY_BY_CLASSIFICATION
    .filter(([, predicate]) => predicate(classification))
    .map(([type]) => type)
    .filter((type) => type !== "attraction");
}

function relationshipFor(from, to, sameCluster, routeMinutes) {
  if (from.primaryType === "restaurant" && to.primaryType !== "restaurant") return "valid-meal-near-activity";
  if (to.primaryType === "restaurant" && from.primaryType !== "restaurant") return "valid-meal-near-activity";
  if (sameCluster && redundantTypes(from, to)) return "same-cluster-redundant";
  if (sameCluster) return "same-cluster-complement";
  if (routeMinutes <= 65) return "same-day-route-compatible";
  return "distant-unrelated";
}

function redundantTypes(from, to) {
  return from.primaryType === to.primaryType && !["restaurant", "attraction"].includes(from.primaryType);
}

function coverageFor(nodes) {
  return nodes.reduce((coverage, node) => {
    coverage[node.primaryType] = (coverage[node.primaryType] || 0) + 1;
    if (!["restaurant", "bar-or-nightlife"].includes(node.primaryType)) coverage.attraction = (coverage.attraction || 0) + 1;
    node.secondaryTypes.forEach((type) => {
      coverage[type] = (coverage[type] || 0) + 1;
    });
    return coverage;
  }, {});
}

function routingCoverageFor(edges, nodes) {
  const validEdges = edges.filter((edge) => edge.validSameDay).length;
  return {
    validSameDayEdges: validEdges,
    averageEdgesPerNode: nodes.length ? Math.round((validEdges / nodes.length) * 10) / 10 : 0
  };
}

function sourceConfidenceFor(candidate, place) {
  if (candidate?.accepted && candidate?.score >= 70) return "high";
  if (place.sourceMetadata?.dataConfidence) return place.sourceMetadata.dataConfidence;
  if (place.id) return "medium";
  return "low";
}

function archetypeFitFor(classification, profile, candidate) {
  const archetype = profile?.destinationArchetype?.primaryArchetype || "";
  if (archetype === "beach/coastal" && (classification.isBeachOrWaterfront || classification.isBoardwalk || classification.isWaterActivity)) return "strong";
  if (archetype === "mountain" && classification.isMountainOrTrail) return "strong";
  if (candidate?.score >= 80) return "strong";
  if (candidate?.score >= 55) return "moderate";
  return "supporting";
}

function uniquenessFor(place, classification) {
  if (classification.isOrdinaryBusiness) return "low";
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.tags || []).join(" ")}`);
  if (/signature|only|unique|historic|national|famous|local/.test(text)) return "high";
  return "moderate";
}

function seasonalFitFor(place, input) {
  const month = Number(String(input.startDate || "").split("-")[1]);
  const text = normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.seasonalNotes || []).join(" ")}`);
  if (month >= 6 && month <= 9 && /heat|summer|beach|water|sun/.test(text)) return "season-aware";
  if (month <= 2 || month === 12) return /indoor|museum|winter/.test(text) ? "good" : "verify-weather";
  return "generally-compatible";
}

function openingHoursConfidenceFor(place) {
  if (/confirm|verify|unknown/i.test(place.openingTimeGuidance || "")) return "low";
  return place.openingTimeGuidance ? "medium" : "unknown";
}

function priceConfidenceFor(place) {
  const low = Number(place.estimatedCostLow);
  const high = Number(place.estimatedCostHigh);
  if (Number.isFinite(low) && Number.isFinite(high) && high >= low) return "medium";
  return "low";
}

function mealCapabilitiesFor(classification) {
  return [
    classification.servesBreakfast ? "breakfast" : "",
    classification.servesLunch ? "lunch" : "",
    classification.servesDinner ? "dinner" : ""
  ].filter(Boolean);
}

function coordinatesFor(place) {
  if (Number.isFinite(place.coordinates?.lat) && Number.isFinite(place.coordinates?.lng)) return place.coordinates;
  if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) return { lat: Number(place.latitude), lng: Number(place.longitude) };
  return null;
}

function distanceBetween(from, to) {
  if (!from || !to) return 25;
  const radiusMiles = 3958.8;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function regionName(profile, id) {
  return profile?.regions?.find((region) => region.id === id)?.name || id || "";
}

function shortDestinationName(profile) {
  return String(profile?.canonicalName || "").split(",")[0].trim();
}

function monthBucket(value) {
  const month = String(value || "").split("-")[1];
  return month ? `month-${month}` : "season-unknown";
}

function stableKey(value) {
  return normalizeText(value).replace(/\s+/g, "-");
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function childFreeAdultTrip(input) {
  return Number(input.childCount || input.children || 0) === 0 && Number(input.travelers || input.adults || 1) >= 1;
}

function genericDayTitle(value) {
  const text = String(value || "").trim();
  return /^(regional highlights|central area day|culture and landmarks day|parks and viewpoints day|beach, boardwalk, and oceanfront evening|coastal nature and scenic water)$/i.test(text)
    || /\b(museums and historic sights|parks and outdoor stops|dining and evening area)\b/i.test(text);
}

function hasSameVenueForAllMealTypes(mealItems) {
  const byName = mealItems.reduce((groups, item) => {
    if (!item.mealDetails?.primaryPlaceId) return groups;
    const name = normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || "");
    if (!name) return groups;
    groups[name] ||= new Set();
    groups[name].add(item.type);
    return groups;
  }, {});
  return Object.values(byName).some((types) => types.size >= 3);
}

function hasSamePrimaryMealForMultipleDays(mealItems) {
  const byName = frequency(mealItems
    .filter((item) => item.mealDetails?.primaryPlaceId)
    .map((item) => normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || ""))
    .filter(Boolean));
  return Object.values(byName).some((count) => count >= 3);
}

function hasMealVenueThatLooksLikeActivity(mealItems) {
  return mealItems.some((item) => {
    const text = normalizeText(`${item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || item.title} ${item.description || ""}`);
    if (!text) return false;
    const restaurantSignal = /\b(restaurant|cafe|coffee|bakery|brunch|breakfast|diner|bistro|grill|taqueria|pizzeria|pizza|bbq|barbecue|ramen|sushi|tavern|kitchen|eatery|deli|sandwich|seafood|steakhouse|burger|tacos|dessert|food hall|public market|market hall)\b/.test(text);
    const activitySignal = /\b(rail trail|greenway|arts district|museum|park|lake|mountain|waterfall|campus|neighborhood|walking route|scenic drive|visitor center|hall of fame)\b/.test(text);
    return activitySignal && !restaurantSignal;
  });
}

function tripDaysFor(plan) {
  return Number(plan?.numberOfDays || plan?.days?.length || 0);
}

function hasSignatureCoverageFailure(plan, graph = {}) {
  const nodes = destinationDefiningNodes(graph);
  if (!nodes.length) return false;
  const publicText = publicPlanText(plan);
  const topLocal = nodes.filter((node) => !/overnight|long-day-trip|not-practical/.test(node.geographicScope || "")).slice(0, 5);
  const includedTopLocal = topLocal.filter((node) => publicText.includes(normalizeText(node.canonicalName)));
  if (topLocal[0]?.firstTimeVisitorValue?.score >= 90 && !includedTopLocal.length) return true;
  // A short trip has far fewer schedule slots to include signature stops than a
  // long one; requiring the same absolute coverage count regardless of trip
  // length unfairly rejects otherwise-solid short trips.
  const requiredTopLocal = tripDaysFor(plan) <= 2 ? 1 : 2;
  if (topLocal.length >= 4 && includedTopLocal.length < Math.min(requiredTopLocal, topLocal.length)) return true;
  return false;
}

function hasWeakFirstTimeCoverage(plan, graph = {}) {
  const nodes = destinationDefiningNodes(graph);
  if (nodes.length < 4) return false;
  const publicText = publicPlanText(plan);
  const included = nodes.slice(0, 10).filter((node) => publicText.includes(normalizeText(node.canonicalName)));
  const tripDays = tripDaysFor(plan);
  // A 2-day trip realistically has room for only ~3-4 major activity slots
  // total, so requiring 2+ confirmed signature-attraction inclusions can be
  // stricter than the trip's own schedule capacity allows.
  const requiredIncluded = tripDays <= 2 ? 1 : Math.min(3, nodes.length);
  const archetype = plan?.generationMetadata?.destinationArchetype?.primaryArchetype || plan?.generationMetadata?.destinationProfile?.primaryArchetype || "";
  if (/mountain|national park/.test(archetype)) {
    const hasScenicOrTrail = included.some((node) => /\b(outdoor|park|trail|mountain|waterfall|scenic|overlook|corridor|parkway|kuwohi|gap|cove|fork|river road)\b/.test(`${node.primaryType} ${node.secondaryTypes?.join(" ")} ${normalizeText(node.canonicalName)}`));
    const hasGatewayOrEntertainment = included.some((node) => /\b(neighborhood|district|downtown|gateway|entertainment|theme park|island|dollywood|anakeesta|skypark|gatlinburg|pigeon forge)\b/.test(`${node.primaryType} ${node.secondaryTypes?.join(" ")} ${normalizeText(node.canonicalName)}`));
    if (tripDays <= 2) return included.length < requiredIncluded || !(hasScenicOrTrail || hasGatewayOrEntertainment);
    return included.length < requiredIncluded || !(hasScenicOrTrail && hasGatewayOrEntertainment);
  }
  const hasCulture = included.some((node) => /museum|culture|historic|landmark|civil|human rights|national/.test(`${node.primaryType} ${node.secondaryTypes?.join(" ")} ${normalizeText(node.canonicalName)}`));
  const hasNeighborhood = included.some((node) => /neighborhood|district|market|beltline|public market|food hall/.test(`${node.primaryType} ${node.secondaryTypes?.join(" ")} ${normalizeText(node.canonicalName)}`));
  const hasOutdoor = included.some((node) => /outdoor|park|garden|trail|mountain|waterfront|monument|memorial|national mall|promenade|river|water/.test(`${node.primaryType} ${node.secondaryTypes?.join(" ")} ${normalizeText(node.canonicalName)}`));
  const publicUrbanBalance = /\b(capitol|library of congress|civic|government|cathedral|parliament|city hall)\b/.test(publicText)
    && /\b(museum|gallery|art|history|culture)\b/.test(publicText)
    && /\b(neighborhood|district|market|waterfront|wharf|promenade|monument|memorial|national mall)\b/.test(publicText);
  if (publicUrbanBalance && included.length >= requiredIncluded) return false;
  // Requiring all three categories (culture + neighborhood + outdoor) among a
  // destination's own top signature attractions is fragile: many genuinely
  // strong, diverse candidate sets (e.g. LA's Getty/Griffith Park/Dodger
  // Stadium/Hollywood Walk of Fame) simply don't happen to include a single
  // POI explicitly labeled "neighborhood" or "district" -- that's about how
  // the destination's landmarks are typed, not evidence the plan is thin.
  // Two of the three categories is still meaningful evidence against a
  // single-category-dominated plan.
  const categoriesPresent = [hasCulture, hasNeighborhood, hasOutdoor].filter(Boolean).length;
  return included.length < requiredIncluded || categoriesPresent < 2;
}

function hasOrdinaryLocalFacilityPromotion(plan, graph = {}) {
  const publicText = publicPlanText(plan);
  const definingNames = new Set(destinationDefiningNodes(graph).slice(0, 8).map((node) => normalizeText(node.canonicalName)));
  const includedDefining = [...definingNames].filter((name) => publicText.includes(name)).length;
  const requiredDefining = tripDaysFor(plan) <= 2 ? 1 : 3;
  const ordinaryNodes = (graph.nodes || []).filter((node) => Number(node.ordinaryLocalFacilityPenalty?.score || 0) >= 50 || (node.rejectionReasons || []).includes("ordinary-business"));
  return ordinaryNodes.some((node) => publicText.includes(normalizeText(node.canonicalName)) && includedDefining < requiredDefining);
}

function hasStaleAttractionRecommendation(plan) {
  const text = publicPlanText(plan);
  return /\b(cnn studio tour|old cnn studio tour|permanently closed|no longer operates|discontinued tour|defunct attraction)\b/.test(text);
}

function regionalDestinationQuality(plan, graph = {}) {
  const hardFailures = [];
  const issues = [];
  const archetype = plan?.generationMetadata?.destinationArchetype?.primaryArchetype || plan?.generationMetadata?.destinationProfile?.primaryArchetype || "";
  const publicText = publicPlanText(plan);
  // This block's vocabulary (scenicTerms/hikeTerms/gatewayTerms below) is
  // specific to Great Smoky Mountains-style gateway destinations, so it must
  // only fire for destinations actually classified that way. A loose
  // substring match against arbitrary regional/plan text (previously also
  // checked here) is too easy for an unrelated destination to trip by
  // coincidence -- e.g. any city whose regional day-trip suggestions happen
  // to mention a national park -- so this now relies solely on the
  // deliberately-computed archetype classification.
  const applies = /^(mountain|national-park)$/.test(archetype);
  const mealItems = (plan.days || []).flatMap((day) => day.scheduleItems || []).filter((item) => ["breakfast", "lunch", "dinner"].includes(item.type));
  const mealNames = mealItems.map((item) => normalizeText(item.mealDetails?.restaurantName || item.mealDetails?.primaryOption || "")).filter(Boolean);
  const uniqueMeals = new Set(mealNames);
  const cafeMeals = mealNames.filter((name) => /\b(cafe|coffee|bakery|breakfast|brunch|market|deli)\b/.test(name));
  const packedMeals = mealNames.filter((name) => /\b(packed lunch|picnic)\b/.test(name));
  const routedMeals = mealItems.filter((item) => item.mealDetails?.routeDetour && !/not a verified|confirm exact/i.test(item.mealDetails.routeDetour)).length;
  const mealDiversity = scoreFrom(100, mealNames.length >= 6 && uniqueMeals.size < Math.ceil(mealNames.length * 0.6) ? 34 : 0, mostCommonCount(mealNames) >= 3 ? 22 : 0);
  const cafeDiversity = scoreFrom(100, mealItems.length >= 8 && cafeMeals.length + packedMeals.length < 2 ? 20 : 0);
  const mealRouteFit = scoreFrom(100, mealItems.length && routedMeals < Math.ceil(mealItems.length * 0.75) ? 18 : 0);
  const regionalFoodCoverage = scoreFrom(100, mealItems.length >= 8 && uniqueMeals.size < 5 ? 24 : 0);
  if (!applies) {
    return {
      hardFailures,
      issues,
      scores: { mealDiversity, cafeDiversity, mealRouteFit, regionalFoodCoverage, regionalPlanning: 100 }
    };
  }
  const scenicTerms = /\b(newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|scenic drive|scenic corridor|parkway|overlook)\b/;
  const hikeTerms = /\b(gatlinburg trail|grotto falls|laurel falls|rainbow falls|abrams falls|cataract falls|waterfall|trailhead|hike|trail)\b/;
  const gatewayTerms = /\b(gatlinburg|pigeon forge|sevierville|gateway town|downtown|old mill|the island in pigeon forge)\b/;
  const entertainmentTerms = /\b(the island in pigeon forge|dollywood|anakeesta|skypark|ober gatlinburg|mountain coaster|show|live music|entertainment district)\b/;
  const noveltyTerms = /\b(knife works|knife store|motorcycle museum|crime museum|alcatraz east|haunted house|wax museum|mirror maze|great smoky mountains railroad)\b/;
  const genericPark = /\bgreat smoky mountains national park\b/.test(publicText) && !scenicTerms.test(publicText) && !hikeTerms.test(publicText);
  if (genericPark) hardFailures.push("generic-park-container-scheduled");
  if ((plan.numberOfDays || 0) >= 4) {
    if (!scenicTerms.test(publicText)) hardFailures.push("regional-scenic-corridor-missing");
    if (!hikeTerms.test(publicText)) hardFailures.push("regional-trail-or-waterfall-missing");
    if (!gatewayTerms.test(publicText)) hardFailures.push("regional-gateway-town-coverage-missing");
    if (!entertainmentTerms.test(publicText)) issues.push("regional-evening-entertainment-light");
  }
  if (noveltyTerms.test(publicText) && !/\bmust have|explicitly requested|traveler requested\b/.test(publicText)) hardFailures.push("novelty-attraction-overpromotion");
  if (mealDiversity < 75) hardFailures.push("regional-meal-diversity-insufficient");
  if (cafeDiversity < 82) issues.push("cafe-diversity-light");
  const regionalPlanning = scoreFrom(100,
    hardFailures.includes("generic-park-container-scheduled") ? 38 : 0,
    hardFailures.includes("regional-scenic-corridor-missing") ? 30 : 0,
    hardFailures.includes("regional-trail-or-waterfall-missing") ? 26 : 0,
    hardFailures.includes("regional-gateway-town-coverage-missing") ? 20 : 0,
    hardFailures.includes("novelty-attraction-overpromotion") ? 32 : 0,
    issues.includes("regional-evening-entertainment-light") ? 8 : 0);
  return {
    hardFailures,
    issues,
    scores: { mealDiversity, cafeDiversity, mealRouteFit, regionalFoodCoverage, regionalPlanning }
  };
}

function destinationDefiningNodes(graph = {}) {
  return (graph.nodes || [])
    .filter((node) => !["restaurant", "bar-or-nightlife"].includes(node.primaryType))
    .filter((node) => Number(node.firstTimeVisitorValue?.score || 0) >= 58)
    .sort((a, b) => Number(b.firstTimeVisitorValue?.score || 0) - Number(a.firstTimeVisitorValue?.score || 0) || Number(b.destinationSignificance?.score || 0) - Number(a.destinationSignificance?.score || 0));
}

function publicPlanText(plan) {
  return normalizeText(JSON.stringify({
    overview: plan.overview,
    days: plan.days,
    foodPlan: plan.foodPlan,
    routeSummary: plan.routeSummary,
    hotelBase: plan.hotelBase,
    tripGuide: plan.tripGuide
  }, (key, value) => (INTERNAL_ID_KEYS.has(key) ? undefined : value)));
}

function hasMuseumDominance(plan) {
  const archetype = plan?.generationMetadata?.destinationArchetype?.primaryArchetype || plan?.generationMetadata?.destinationProfile?.primaryArchetype || "";
  if (/beach|coastal|mountain|resort/i.test(archetype)) return false;
  const planText = normalizeText(`${plan.destination || ""} ${plan.overview?.destinationSummary || ""} ${(plan.days || []).map((day) => `${day.title} ${day.summary}`).join(" ")}`);
  if (/\b(beach|coastal|ocean|waterfront|riverwalk|island|harbor|marina)\b/.test(planText) && /\b(beach|waterfront|riverwalk|island|harbor|marina|park|garden|trail|outdoor)\b/.test(planText)) return false;
  const activityItems = (plan.days || []).flatMap((day) => (day.scheduleItems || []).filter((item) => item.type === "activity"));
  if (activityItems.length < 4 || explicitMuseumIntent(plan)) return false;
  const museumItems = activityItems.filter((item) => /\b(museum|gallery|exhibition|historic house|history center)\b/i.test(`${item.title} ${item.category || ""} ${(item.tags || []).join(" ")}`));
  const outdoorOrNeighborhood = activityItems.filter((item) => /\b(park|garden|greenway|trail|lake|mountain|waterfall|whitewater|neighborhood|district|market|camp|waterfront|beach|boardwalk|scenic|food|arts|art|local culture|evening)\b/i.test(`${item.title} ${item.category || ""} ${(item.tags || []).join(" ")}`));
  if (outdoorOrNeighborhood.length >= Math.max(3, museumItems.length)) return false;
  if (museumItems.length >= 3 && museumItems.length / activityItems.length > 0.42) return true;
  if (museumItems.length >= 2 && outdoorOrNeighborhood.length === 0) return true;
  // Some real destinations (e.g. a historic district with several distinct,
  // worthwhile museums close together) legitimately cluster museums into one
  // route-efficient day without the overall trip being museum-dominated.
  // Require a clearer single-day glut before flagging it.
  return (plan.days || []).some((day) => (day.scheduleItems || []).filter((item) => item.type === "activity" && /\b(museum|gallery|exhibition)\b/i.test(`${item.title} ${item.category || ""} ${(item.tags || []).join(" ")}`)).length >= 4);
}

function explicitMuseumIntent(plan) {
  const prefs = plan?.preferencesSnapshot || {};
  const text = normalizeText([
    prefs.preferences?.join(" "),
    prefs.mustHavePlaces?.join(" "),
    prefs.tripDescription,
    prefs.destination
  ].filter(Boolean).join(" "));
  return /\b(museum|museums|gallery|galleries|history|historic|art collection|architecture tour)\b/.test(text);
}

function hasFixedDurationDominance(items) {
  const activityDurations = items.filter((item) => item.type === "activity").map((item) => item.durationMinutes);
  if (activityDurations.length < 5) return false;
  if (maxShare(frequency(activityDurations)) > 0.4) return true;
  for (let index = 2; index < activityDurations.length; index += 1) {
    if (activityDurations[index] === activityDurations[index - 1] && activityDurations[index] === activityDurations[index - 2]) return true;
  }
  return false;
}

function hasFixedCostDominance(items) {
  const costs = items
    .filter((item) => item.type === "activity")
    .map((item) => `${item.estimatedCostPerPerson?.low || 0}-${item.estimatedCostPerPerson?.high || 0}`);
  return costs.length >= 5 && maxShare(frequency(costs)) > 0.45;
}

function hasRepeatedDaytimeEvening(plan) {
  return (plan.days || []).some((day) => {
    const activityIds = new Set((day.scheduleItems || []).filter((item) => item.type === "activity" && item.placeId).map((item) => item.placeId));
    return (day.scheduleItems || []).some((item) => item.type === "evening" && item.placeId && activityIds.has(item.placeId));
  });
}

function hasRawPlaceLabel(items) {
  return items.some((item) => /^(access\s*\d*|entrance\s*\d*|parking\s*\d*|trailhead\s*\d*|gate\s*\d*|pier access|beach access|map point|unnamed road)$/i.test(String(item.title || "").trim()));
}

function hasUnverifiedMealDominance(mealItems) {
  if (mealItems.length < 4) return false;
  const backed = mealItems.filter((item) => item.mealDetails?.primaryPlaceId).length;
  return backed < Math.ceil(mealItems.length * 0.6);
}

export function isDisclosedStarterFallbackPlan(plan) {
  const freshness = plan?.generationMetadata?.destinationProfileSnapshot?.sourceMetadata?.freshness || "";
  return Boolean(plan?.generationMetadata?.usesGenericDestinationProfile) || /starter-fallback/i.test(freshness);
}

function isProviderGeneratedPlan(plan) {
  const provider = plan?.generationMetadata?.destinationProfileSnapshot?.sourceMetadata?.provider
    || plan?.generationMetadata?.sourceDiagnostics?.destinationResearchSource
    || "";
  return /^(google|openrouteservice|openai|generated-provider|test-live)$/i.test(provider);
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

function scoreFrom(base, ...deductions) {
  return Math.max(0, Math.round(base - deductions.reduce((sum, value) => sum + value, 0)));
}
