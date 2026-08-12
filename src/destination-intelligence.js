export const intelligenceCategories = [
  "signatureExperiences",
  "localFavorites",
  "neighborhoods",
  "natureAnchors",
  "waterExperiences",
  "familyAttractions",
  "entertainmentAnchors",
  "foodHalls",
  "breakfastCandidates",
  "lunchCandidates",
  "dinnerCandidates",
  "rooftopDining",
  "barsAndNightlife",
  "scenicDrives",
  "nearbyDayTrips",
  "regionalOvernightExtensions",
  "seasonalExperiences"
];

export function buildDestinationIntelligence(profile, input, constraints = {}) {
  const baseRegionId = profile.planningRules?.defaultHotelRegion || profile.regions[0]?.id || "";
  // A multi-city trip has a hotel base in each approved region, not just the
  // primary one -- confirmed live: an Asheville-based day of a Charlotte ->
  // Great Smoky Mountains -> Asheville -> Lake Norman trip kept failing the
  // quality gate because DuPont State Recreational Forest and Pisgah National
  // Forest (both a short local drive FROM Asheville) were being scored as a
  // "long-day-trip" from Charlotte, the only base this function ever knew
  // about. That route-burden penalty (and the resulting exclusion from
  // "topLocal" signature-coverage counting) discouraged scheduling exactly
  // the attractions each non-primary leg was built around. Evaluate distance
  // from whichever approved base is closest, not only the primary.
  const baseRegionIds = [baseRegionId, ...approvedBaseRegionIds(profile, input)].filter(Boolean);
  const selectedText = preferenceText(input);
  const maxRoundTripMinutes = Math.max(90, Number(input.maxDrivingMinutes || 240));
  const regionalDestinationProfile = buildRegionalDestinationProfile(profile, input);
  const opportunities = profile.places.map((place) => {
    const feasibility = bestRouteFeasibilityForPlace(profile, baseRegionIds, place, maxRoundTripMinutes);
    const classification = classifyPlaceForPlanning(place, profile, input, feasibility);
    const categorySet = classifyPlace(place, feasibility, classification);
    const userFitScore = userInterestScore(place, selectedText);
    const significanceScore = localSignificanceScore(place, profile);
    const routeBurdenPenalty = feasibility.classification === "not-practical" ? 120
      : feasibility.classification === "overnight-recommended" ? 38
        : feasibility.classification === "long-day-trip" ? 18
          : feasibility.classification === "easy-day-trip" ? 4
            : 0;
    const accessibilityPenalty = constraints.minimalWalking && place.accessibility === "limited" ? 45 : 0;
    const travelerPenalty = Math.min(90, Math.max(0, -classification.travelerFit.score));
    const ordinaryPenalty = classification.ordinaryLocalFacilityPenalty.score;
    const currentStatusPenalty = classification.isStaleOrClosedAttraction ? 260 : 0;
    const score = Math.round(significanceScore + classification.destinationSignificance.score + classification.firstTimeVisitorValue.score + userFitScore + classification.travelerFit.score - routeBurdenPenalty - accessibilityPenalty - ordinaryPenalty - currentStatusPenalty);
    const rejected = feasibility.classification === "not-practical"
      || classification.isOrdinaryBusiness
      || classification.isStaleOrClosedAttraction
      || childFreeAdultTrip(input) && classification.isChildrenFocused
      || travelerPenalty >= 70;
    return {
      id: place.id,
      place,
      categories: [...categorySet],
      classification,
      score,
      userFitScore,
      significanceScore,
      redundancyScore: redundancyScore(place),
      routeFeasibility: feasibility,
      accepted: !rejected,
      reason: rejected
        ? rejectionReason(classification, feasibility, input)
        : explanationFor(place, feasibility, userFitScore)
    };
  }).sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));

  const buckets = Object.fromEntries(intelligenceCategories.map((category) => [category, []]));
  opportunities.forEach((opportunity) => {
    opportunity.categories.forEach((category) => {
      if (buckets[category]) buckets[category].push(opportunity);
    });
  });

  const routeOptions = buildRouteOptions(profile, opportunities, input);
  const destinationArchetype = buildDestinationArchetype(profile, input, opportunities);
  return {
    destinationIdentity: {
      id: profile.id,
      canonicalName: profile.canonicalName,
      summary: profile.summary,
      baseRegionId
    },
    regionalDestinationProfile,
    destinationArchetype,
    ...Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.slice(0, 12)])),
    allCandidates: opportunities,
    routeOptions,
    categoryCoverage: categoryCoverage(buckets),
    experienceGaps: experienceGaps(buckets),
    researchConfidence: profile.id.startsWith("generic-") ? "starter" : "curated",
    sourceFreshness: profile.sourceMetadata?.freshness || "curated-or-generated"
  };
}

export function buildRegionalDestinationProfile(profile, input = {}) {
  const source = profile.regionalDestinationProfile || profile.regionalProfile || {};
  const profileText = normalizeText([
    profile.canonicalName,
    input.destination,
    profile.summary,
    ...(profile.regions || []).map((region) => `${region.name} ${region.summary || ""} ${(region.tags || []).join(" ")}`),
    ...(profile.places || []).map((place) => `${place.name} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`)
  ].join(" "));
  const isConnectedTourismRegion = Boolean(source.primaryDestination)
    || /\b(gateway|tourism region|national park|state park|parkway|scenic corridor|mountain town|resort town|day trip|nearby town|connected region|smoky|smokies|gatlinburg|pigeon forge|sevierville)\b/.test(profileText);
  if (!isConnectedTourismRegion) return null;
  const regions = profile.regions || [];
  const places = profile.places || [];
  const regionByTag = (pattern) => regions
    .filter((region) => pattern.test(normalizeText(`${region.name} ${region.summary || ""} ${(region.tags || []).join(" ")}`)))
    .map((region) => region.name);
  const placeNames = (pattern) => places
    .filter((place) => pattern.test(normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`)))
    .map((place) => place.name);
  const corridors = [
    ...(profile.scenicCorridors || []).map((item) => item.name),
    ...(profile.scenicRoutes || []).filter((route) => /scenic|road|parkway|loop|corridor|overlook|mountain|gap|cove|fork|river/i.test(`${route.name} ${(route.tags || []).join(" ")}`)).map((route) => route.name),
    ...placeNames(/\b(scenic drive|parkway|motor nature trail|road|loop road|overlook|gap|cove|kuwohi|clingsmans)\b/)
  ];
  const primaryDestination = source.primaryDestination || profile.canonicalName.split(",")[0];
  const gatewayTowns = arrayWithFallback(source.gatewayTowns, regionByTag(/\b(gateway|town|downtown|village|core|base|entertainment|tourism)\b/));
  const majorGeographicZones = arrayWithFallback(source.majorGeographicZones, regions.map((region) => region.name));
  const scenicCorridors = arrayWithFallback(source.scenicCorridors, corridors);
  const entertainmentZones = arrayWithFallback(source.entertainmentZones, [
    ...regionByTag(/\b(entertainment|evening|downtown|show|theme park|district)\b/),
    ...placeNames(/\b(island|downtown|skypark|theme park|show|coaster|distillery|entertainment district)\b/)
  ]);
  const foodZones = arrayWithFallback(source.foodZones, (profile.foodAreas || []).map((area) => area.name));
  const nearbyDayTrips = arrayWithFallback(source.nearbyDayTrips, placeNames(/\b(day trip|waterfall|trail|scenic|overlook|cove|parkway|nearby)\b/));
  const overnightExtensions = arrayWithFallback(source.overnightExtensions, placeNames(/\b(overnight|extension|railroad|bryson|asheville|blue ridge|second base)\b/));
  const regionCount = [gatewayTowns, majorGeographicZones, scenicCorridors, entertainmentZones, foodZones].filter((items) => items.length).length;
  return {
    primaryDestination,
    gatewayTowns: gatewayTowns.slice(0, 8),
    metroOrTourismRegion: source.metroOrTourismRegion || source.tourismRegion || profile.summary || profile.canonicalName,
    parkRelationship: source.parkRelationship || (/\bnational park|state park\b/.test(profileText) ? "Gateway region for park-based day planning." : ""),
    majorGeographicZones: majorGeographicZones.slice(0, 12),
    scenicCorridors: scenicCorridors.slice(0, 12),
    entertainmentZones: entertainmentZones.slice(0, 10),
    foodZones: foodZones.slice(0, 10),
    realisticBaseOptions: arrayWithFallback(source.realisticBaseOptions, gatewayTowns.length ? gatewayTowns : [profile.planningRules?.defaultHotelRegion || profile.canonicalName]).slice(0, 8),
    nearbyDayTrips: nearbyDayTrips.slice(0, 12),
    overnightExtensions: overnightExtensions.slice(0, 8),
    regionalConfidence: source.regionalConfidence || (regionCount >= 4 ? "high" : regionCount >= 2 ? "medium" : "starter")
  };
}

export function buildDestinationArchetype(profile, input = {}, opportunities = []) {
  const profileText = normalizeText([
    profile.canonicalName,
    profile.summary,
    ...(profile.regions || []).map((region) => `${region.name} ${region.summary || ""} ${(region.tags || []).join(" ")}`),
    ...(profile.places || []).map((place) => `${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`)
  ].join(" "));
  const placeFlags = opportunities.length
    ? opportunities.map((item) => item.classification || classifyPlaceForPlanning(item.place, profile, input, item.routeFeasibility))
    : (profile.places || []).map((place) => classifyPlaceForPlanning(place, profile, input));
  const count = (predicate) => placeFlags.filter(predicate).length;
  const nameText = normalizeText(`${profile.canonicalName} ${input.destination || ""}`);
  const beachScore = count((flag) => flag.isBeachOrWaterfront || flag.isBoardwalk || flag.isWaterActivity || flag.isPier) * 16
    + (/beach|coast|ocean|shore|island|myrtle|sea|waterfront|boardwalk/.test(profileText + " " + nameText) ? 38 : 0);
  const mountainScore = count((flag) => flag.isMountainOrTrail) * 15 + (/mountain|parkway|ridge|hike|trail|waterfall|national park|scenic corridor|overlook|gateway town|kuwohi|newfound gap|cades cove|roaring fork|little river|foothills parkway|gatlinburg|pigeon forge|sevierville|dollywood/.test(profileText + " " + nameText) ? 38 : 0);
  const cityScore = count((flag) => flag.isMuseum || flag.isNeighborhood) * 9 + (/downtown|museum|arts|architecture|historic|landmark|major city|capital/.test(profileText) ? 22 : 0);
  const foodScore = count((flag) => flag.isRestaurant || flag.isFoodHall) * 8 + (/seafood|food|dining|restaurant|culinary|market/.test(profileText) ? 20 : 0);
  const nightlifeScore = count((flag) => flag.isEveningAnchor || flag.isBar) * 12 + (/nightlife|live music|boardwalk|marshwalk|bars|evening/.test(profileText) ? 18 : 0);
  const themeParkScore = count((flag) => flag.isFamilyFocused || flag.isEntertainmentCenter) * 8 + (/theme park|amusement|rides|family entertainment/.test(profileText) ? 16 : 0);
  const resortScore = /resort|spa|all inclusive|beach club/.test(profileText) ? 42 : 0;
  const scored = [
    ["beach/coastal", beachScore],
    ["mountain", mountainScore],
    ["major city", cityScore],
    ["food destination", foodScore],
    ["nightlife destination", nightlifeScore],
    ["theme-park destination", themeParkScore],
    ["resort", resortScore]
  ].sort((a, b) => b[1] - a[1]);
  const primaryArchetype = scored[0]?.[1] > 0 ? scored[0][0] : "mixed urban/nature";
  const secondaryArchetypes = scored
    .filter(([name, score]) => name !== primaryArchetype && score >= Math.max(18, scored[0][1] * 0.18))
    .map(([name]) => name)
    .slice(0, 4);
  const definingExperiences = destinationDefiningExperiences(profile, primaryArchetype, placeFlags);
  const regionalExtensions = (profile.regions || [])
    .filter((region) => /north|south|inlet|landing|state park|island|mountain|lake|day trip|regional|extension/i.test(`${region.name} ${region.summary || ""}`))
    .map((region) => region.name)
    .slice(0, 6);
  return {
    primaryArchetype,
    secondaryArchetypes,
    definingExperiences,
    expectedCategoryMix: expectedCategoryMixFor(primaryArchetype, secondaryArchetypes),
    weatherSensitiveCategories: weatherSensitiveCategoriesFor(primaryArchetype),
    eveningStrength: nightlifeScore >= 36 || primaryArchetype === "nightlife destination" || (primaryArchetype === "beach/coastal" && nightlifeScore >= 20) ? "strong" : nightlifeScore >= 15 ? "moderate" : "light",
    foodIdentity: foodIdentityFor(profileText, primaryArchetype),
    regionalExtensions,
    travelerFit: travelerFitForArchetype(input, primaryArchetype),
    confidence: scored[0]?.[1] >= 70 ? "high" : scored[0]?.[1] >= 35 ? "medium" : "starter"
  };
}

export function localSignificanceScore(place, profile) {
  const text = textFor(place);
  const description = normalizeText(place.shortDescription || "");
  const isThinResearchDescription = /\b(is a landmark|is a popular|is a well[- ]known|is a notable|is a local|visitor stop|tourist stop|point of interest)\b/.test(description) && description.length > 0 && description.length < 200;
  const isGamblingVenue = /\b(casino|racino|slot machines|gambling|off track betting|poker room)\b/.test(text);
  let score = Number(place.priorityScore || 60);
  if (/signature|major|essential|famous|iconic|must see|must do|official tourism|tourist attraction|historical landmark|cultural landmark|hall of fame|museum|landmark|national|civil rights|aquarium|botanical|history center|historic site|historic district|olympic park|beltline|public market|whitewater|stockyards|biltmore|parkway|boardwalk|skywheel|marshwalk|barefoot landing|broadway at the beach|brookgreen|huntington beach|cherry grove|oceanfront|beach access|national park|scenic corridor|newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|dollywood|the island in pigeon forge|anakeesta|skypark|ober gatlinburg|grotto falls|laurel falls|rainbow falls|abrams falls|gatlinburg trail/.test(text)) score += 18;
  if (/food hall|market|rooftop|local|neighborhood|arts district|live music/.test(text)) score += 10;
  if (/day-trip|regional|mountain|lake|waterfall|state park|scenic|coastal|beach|waterfront|cruise|kayak|paddleboard|fishing/.test(text)) score += 12;
  if (/backup|generic|area$|walk$|candidate|starter planning/.test(text)) score -= 20;
  if (isThinResearchDescription) score -= 45;
  if (isGamblingVenue) score -= 35;
  if (ordinaryLocalFacilityPenaltyFor(place, {}).score >= 60) score -= 28;
  if (profile.id.startsWith("generic-")) score -= 10;
  return Math.max(0, Math.round(score));
}

export function categoryCoverage(buckets) {
  return {
    signature: buckets.signatureExperiences.length,
    nature: buckets.natureAnchors.length,
    food: buckets.foodHalls.length + buckets.breakfastCandidates.length + buckets.lunchCandidates.length + buckets.dinnerCandidates.length,
    neighborhoods: buckets.neighborhoods.length,
    evenings: buckets.barsAndNightlife.length + buckets.rooftopDining.length,
    regional: buckets.nearbyDayTrips.length + buckets.regionalOvernightExtensions.length,
    scenic: buckets.scenicDrives.length
  };
}

function buildRouteOptions(profile, opportunities, input) {
  const byCategory = (category) => opportunities.filter((item) => item.accepted && item.categories.includes(category));
  const signature = byCategory("signatureExperiences").slice(0, 4);
  const localNature = byCategory("natureAnchors").filter((item) => item.routeFeasibility.classification !== "overnight-recommended").slice(0, 4);
  const food = [...byCategory("foodHalls"), ...byCategory("rooftopDining"), ...byCategory("barsAndNightlife")].slice(0, 5);
  const dayTrips = byCategory("nearbyDayTrips").filter((item) => item.routeFeasibility.classification !== "overnight-recommended").slice(0, 4);
  const overnights = byCategory("regionalOvernightExtensions").slice(0, 4);
  const wantsRegional = Number(input.numberOfDays || 0) >= 5;
  return [
    {
      id: "city-essentials-local-outdoors",
      name: `${shortName(profile)} essentials + local outdoors`,
      structure: "one-base",
      drivingLevel: "lower",
      anchors: names([...signature.slice(0, 2), ...localNature.slice(0, 1), ...food.slice(0, 2)]),
      rationale: "Keeps one lodging base, mixes signature sights with local outdoor and food/evening anchors, and avoids unnecessary hotel changes."
    },
    {
      id: "city-plus-nature-day-trip",
      name: `${shortName(profile)} + nature day trip`,
      structure: "one-base-with-day-trip",
      drivingLevel: dayTrips[0]?.routeFeasibility.classification || "easy-day-trip",
      anchors: names([...signature.slice(0, 2), ...dayTrips.slice(0, 2), ...food.slice(0, 1)]),
      rationale: "Adds a more memorable regional nature block when the route burden is acceptable for the user's daily drive limit."
    },
    {
      id: "multi-base-regional-extension",
      name: `${shortName(profile)} + regional extension`,
      structure: "optional-split-stay",
      drivingLevel: "higher",
      anchors: names([...signature.slice(0, 1), ...overnights.slice(0, 3), ...food.slice(0, 1)]),
      rationale: wantsRegional
        ? "Evaluates a higher-variety structure with one possible hotel change when regional anchors are strong enough."
        : "Held as a future option because this trip length is short for a split stay."
    }
  ].filter((option) => option.anchors.length);
}

function routeFeasibility(profile, baseRegionId, regionId, maxRoundTripMinutes) {
  const oneWay = estimateRegionDriveMinutes(profile, baseRegionId, regionId);
  const roundTrip = oneWay * 2;
  let classification = "local";
  if (roundTrip <= 90) classification = "local";
  else if (roundTrip <= maxRoundTripMinutes) classification = "easy-day-trip";
  else if (roundTrip <= maxRoundTripMinutes + 120) classification = "long-day-trip";
  else if (oneWay <= 240) classification = "overnight-recommended";
  else classification = "not-practical";
  return {
    originRegionId: baseRegionId,
    destinationRegionId: regionId,
    estimatedOneWayMinutes: oneWay,
    estimatedRoundTripMinutes: roundTrip,
    classification
  };
}

// Mirrors the base-matching logic in planner.js's resolveApprovedTripShapeSchedule
// (base 0 is the primary destination itself and is already covered by
// defaultHotelRegion above; only secondary approved bases need matching
// here). Kept as a self-contained duplicate rather than an import from
// planner.js to avoid a circular dependency (planner.js imports from this
// file to build destination intelligence in the first place).
function approvedBaseRegionIds(profile, input) {
  const bases = Array.isArray(input?.approvedTripShape?.hotelBases) ? input.approvedTripShape.hotelBases : [];
  if (bases.length < 2) return [];
  const ids = [];
  bases.slice(1).forEach((base) => {
    const name = normalizeText(base?.canonicalName || base?.shortName || "");
    if (!name) return;
    const exactRequestedMatch = profile.regions.find((region) => region.requestedName && normalizeText(region.requestedName) === name);
    const region = exactRequestedMatch || profile.regions.find((candidate) => {
      const candidateName = normalizeText(candidate.name);
      const candidateCore = normalizeText(String(candidate.name || "").split(",")[0]);
      return candidateName === name || candidateName.includes(name) || name.includes(candidateName)
        || (candidateCore && (candidateCore === name || name.includes(candidateCore) || candidateCore.includes(name)));
    });
    if (region) ids.push(region.id);
  });
  return ids;
}

function bestRouteFeasibilityForPlace(profile, baseRegionIds, place, maxRoundTripMinutes) {
  const options = (baseRegionIds.length ? baseRegionIds : [""]).map((baseRegionId) => routeFeasibilityForPlace(profile, baseRegionId, place, maxRoundTripMinutes));
  return options.reduce((best, current) => (current.estimatedRoundTripMinutes < best.estimatedRoundTripMinutes ? current : best));
}

function routeFeasibilityForPlace(profile, baseRegionId, place, maxRoundTripMinutes) {
  const regionFeasibility = routeFeasibility(profile, baseRegionId, place.regionId, maxRoundTripMinutes);
  const base = profile.regions.find((region) => region.id === baseRegionId);
  if (!base?.centerCoordinates || !place?.coordinates) return regionFeasibility;
  const miles = haversineMiles(base.centerCoordinates.lat, base.centerCoordinates.lng, place.coordinates.lat, place.coordinates.lng);
  if (!Number.isFinite(miles) || miles <= 0) return regionFeasibility;
  const oneWay = Math.max(regionFeasibility.estimatedOneWayMinutes, Math.round(miles / 0.7) + (miles > 25 ? 20 : 8));
  const roundTrip = oneWay * 2;
  let classification = "local";
  if (roundTrip <= 90) classification = "local";
  else if (roundTrip <= maxRoundTripMinutes) classification = "easy-day-trip";
  else if (roundTrip <= maxRoundTripMinutes + 120) classification = "long-day-trip";
  else if (oneWay <= 240) classification = "overnight-recommended";
  else classification = "not-practical";
  return {
    ...regionFeasibility,
    estimatedOneWayMinutes: oneWay,
    estimatedRoundTripMinutes: roundTrip,
    classification,
    estimateType: "place-coordinate-feasibility"
  };
}

function estimateRegionDriveMinutes(profile, fromRegionId, toRegionId) {
  if (!fromRegionId || !toRegionId || fromRegionId === toRegionId) return 0;
  const exact = profile.scenicRoutes?.find((route) => route.originRegionId === fromRegionId && route.destinationRegionId === toRegionId)
    || profile.scenicRoutes?.find((route) => route.originRegionId === toRegionId && route.destinationRegionId === fromRegionId);
  if (exact) return Number(exact.estimatedDriveMinutes || 0);
  const from = profile.regions.find((region) => region.id === fromRegionId);
  const to = profile.regions.find((region) => region.id === toRegionId);
  const miles = from?.centerCoordinates && to?.centerCoordinates
    ? haversineMiles(from.centerCoordinates.lat, from.centerCoordinates.lng, to.centerCoordinates.lat, to.centerCoordinates.lng)
    : 20;
  return Math.max(12, Math.round(miles / 0.72) + 10);
}

export function classifyPlaceForPlanning(place, profile = {}, input = {}, feasibility = null) {
  const name = normalizeText(place.name);
  const categoryText = normalizeText((place.categories || []).join(" "));
  const tagText = normalizeText((place.tags || []).join(" "));
  const description = normalizeText(place.shortDescription || "");
  const text = `${name} ${categoryText} ${tagText} ${description}`;
  const categories = new Set((place.categories || []).map(normalizeText).filter(Boolean));
  const has = (pattern) => pattern.test(text);
  const categoryHas = (pattern) => pattern.test(categoryText);
  const isPier = has(/\b(pier|fishing pier)\b/);
  const isBoardwalk = has(/\b(boardwalk|promenade|marshwalk|riverwalk)\b/);
  const isBeachOrWaterfront = has(/\b(beach|oceanfront|waterfront|coastal|shore|surfside|cherry grove|north myrtle|sand|sunrise|sunset walk)\b/) || isBoardwalk;
  const isWaterActivity = has(/\b(cruise|dolphin|kayak|paddleboard|water sport|watersport|boat|fishing charter|sailing|parasail)\b/);
  const isDinnerShow = has(/\b(dinner show|medieval times|dolly parton s stampede|pirates voyage|theatre dinner)\b/);
  const isMountainOrTrail = has(/\b(mountain|ridge|parkway|hike|trail|waterfall|overlook|scenic corridor|motor nature trail|loop road|gap road|kuwohi|clingsmans|cades cove|roaring fork|little river road|foothills parkway)\b/);
  const isEveningAnchor = has(/\b(skywheel|boardwalk|marshwalk|barefoot landing|broadway at the beach|the island in pigeon forge|live music|nightlife|sunset|evening|rooftop|waterfront dining|show|theater|theatre|distillery)\b/);
  const isEntertainmentCenter = has(/\b(frankie|arcade|go kart|gokart|mini golf|laser tag|bowling|family entertainment|amusement center|trampoline|escape room|fun park|wax museum|ripley|mirror maze|mountain coaster|alpine coaster|the island in pigeon forge|theme park|dollywood)\b/);
  const isChildrenFocused = has(/\b(children|childrens|kids|kid friendly|toddler|playground|marbles kids|children s museum|children museum|edventure)\b/);
  const isFamilyFocused = isChildrenFocused || has(/\b(family|zoo|aquarium|theme park|amusement|science center)\b/);
  const isFoodHall = has(/\b(food hall|public market|market hall|marketplace|transfer co|food court)\b/);
  const isBar = has(/\b(bar|brewery|brewhouse|beer garden|taproom|cocktail|distillery|winery|wine bar)\b/);
  const eveningOnlyFoodArea = /evening/i.test(place.bestTimeOfDay || "") && categoryHas(/\b(quiet-evening|dessert|evening)\b/) && !categoryHas(/\b(breakfast|brunch|lunch|dinner|restaurant)\b/);
  const restaurantWords = /\b(restaurant|cafe|cafes|coffee|bakery|brunch|breakfast|diner|bistro|grill|taqueria|pizzeria|pizza|bbq|barbecue|ramen|sushi|tavern|kitchen|eatery|deli|sandwich|seafood|steakhouse|noodle|burger|tacos|dumpling|dessert|ice cream)\b/;
  const attractionOnlyFood = /\b(museum|park|garden|trail|greenway|lake|mountain|viewpoint|monument|memorial|stadium|arena|science center|children|playground|amusement|go kart|arcade|pier|boardwalk|promenade|skywheel|theater|theatre|show)\b/;
  const areaOrDistrictOnly = (/\b(neighborhood|district|corridor|campus|rail trail|greenway|arts district|market district|village|downtown|uptown|area|route|walk|stroll|murals|public space)\b/.test(name)
    || (/\b(walk|stroll|murals|art|arts|events|music)\b/.test(categoryText) && !/\b(dining|restaurant|food hall|market hall|public market)\b/.test(categoryText)))
    && !restaurantWords.test(name)
    && !/\b(food hall|public market|market hall|restaurant row|dining hall|brewery|bar|cafe|bakery)\b/.test(name);
  const specificRestaurantSignal = restaurantWords.test(text)
    || categoryHas(/\b(restaurant|cafe|bakery|bar|brewery|breakfast|brunch|dinner|dining|food hall)\b/)
    || categories.has("food")
    || isFoodHall;
  const isRestaurant = specificRestaurantSignal
    && (categories.has("restaurant") || !areaOrDistrictOnly)
    && !eveningOnlyFoodArea
    && !isEntertainmentCenter
    && !isPier
    && !isDinnerShow
    && (!attractionOnlyFood.test(categoryText) || isFoodHall || restaurantWords.test(name));
  const isMuseum = has(/\b(museum|gallery|science center|history center|historic house|presidential library|art institute)\b/);
  const isPark = has(/\b(park|garden|arboretum|greenway|trail|lake|preserve|nature|waterfall|beach|overlook|viewpoint|state park)\b/);
  const isNeighborhood = has(/\b(neighborhood|district|downtown|uptown|market district|arts district|warehouse district|city market|riverwalk|village|old town)\b/);
  const isCity = categories.has("city") || has(/\b(city of|downtown [a-z]+|nearby city|university town|college town)\b/);
  const isHotel = has(/\b(hotel|motel|inn|suites|lodging|resort|accommodation)\b/);
  const isOrdinaryBusiness = isHotel || has(/\b(insurance|bank|atm|pharmacy|clinic|hospital|dentist|doctor|law office|attorney|auto repair|tire|gas station|parking garage|storage|school|academy|realty|realtor|office|warehouse|funeral|police|fire station|post office)\b/);
  const isSensitiveOrExplicitContent = has(/\b(nude beach|nudist|clothing[- ]optional|swingers?|strip club|gentlemen s club|adult entertainment club|sex shop)\b/);
  const isGamblingVenue = has(/\b(casino|racino|slot machines|gambling|off track betting|poker room)\b/);
  // A stadium/arena is only a genuine plan-worthy stop if the traveler
  // actually wants a game/event/tour -- otherwise it's just a huge, mostly-
  // empty building most of the year. Confirmed live: MetLife Stadium (a
  // football venue in New Jersey, not even in the trip's own city)
  // appeared as a generic evening pick for a traveler with no stated
  // sports/event interest at all. See hasStatedInterest in planner.js for
  // how this gets enforced.
  const isSportsVenue = has(/\b(stadium|arena|ballpark|speedway|motor speedway|fieldhouse|coliseum)\b/) && !isEntertainmentCenter;
  // A destination-scale ticketed resort park is a half-to-full-day
  // commitment, not an ordinary 60-120 minute attraction -- confirmed live:
  // "The Wizarding World of Harry Potter - Hogsmeade" (a themed land inside
  // Universal's Islands of Adventure) and "Universal Studios Florida" (the
  // sibling park at the same resort) got scheduled as two separate ~1-2 hour
  // stops with an unrelated activity wedged between them. isEntertainmentCenter
  // already covers small local venues (mini golf, arcade, go-kart); this flag
  // is deliberately narrower, matching only major named resorts/parks and
  // their sub-lands so scheduledDurationForPlace can floor their duration and
  // buildDays can stop other activities from sharing that day.
  const isDestinationScalePark = has(/\b(universal studios|islands of adventure|universal orlando|wizarding world|hogsmeade|diagon alley|magic kingdom|epcot|hollywood studios|animal kingdom|walt disney world|disneyland|disney california adventure|six flags|busch gardens|seaworld|legoland|cedar point|knott s berry farm|hersheypark|kings island|silver dollar city|dollywood)\b/);
  // AI-sourced research sometimes bakes its own meta-commentary directly
  // into a place's NAME rather than a separate structured field -- confirmed
  // live: "Miami Seaquarium (weather/back-up option)" got scheduled as a
  // normal primary activity, contradicting the AI's own "back-up" framing.
  // Match only against the place's own name (not description/tags) so a
  // legitimately-named place mentioning "alternative" in passing isn't
  // caught.
  const isSelfDescribedBackup = /\((?:[^)]*\b(?:weather|rainy day|back[- ]?up|indoor alternative|alternate option|weather option)\b[^)]*)\)/i.test(place.name || "");
  const isThinResearchAttraction = /\b(is a landmark|is a popular|is a well[- ]known|is a notable|is a local|visitor stop|tourist stop|point of interest)\b/.test(description) && description.length > 0 && description.length < 200;
  const isStaleOrClosedAttraction = staleOrClosedAttractionFor(place);
  const routeScope = routeScopeFrom(feasibility, text);
  const breakfastSignalText = `${name} ${categoryText} ${description}`;
  const servesBreakfast = (isRestaurant || isFoodHall) && !eveningOnlyFoodArea && !isDinnerShow && (/\b(breakfast|brunch|cafe|coffee|bakery|diner)\b/.test(breakfastSignalText) || !isBar && !isFoodHall && !has(/\b(cocktail|nightclub|brewery|seafood|steakhouse|dinner|dining|evening)\b/));
  const servesLunch = (isRestaurant || isFoodHall) && !eveningOnlyFoodArea && !has(/\b(cocktail lounge|nightclub)\b/);
  const breakfastOrCafeFocused = categoryHas(/\b(breakfast|brunch|cafe|bakery)\b/) && !categoryHas(/\b(lunch|dinner|restaurant|dining|bar|brewery)\b/);
  const servesDinner = (isRestaurant || isFoodHall) && !eveningOnlyFoodArea && !breakfastOrCafeFocused && (isFoodHall || has(/\b(dinner|restaurant|bistro|grill|tavern|bar|brewery|food hall|dining|kitchen|pizzeria|bbq|barbecue|seafood|steakhouse)\b/) || !has(/\b(breakfast only)\b/));
  const travelerFit = travelerFitFor(place, input, { isChildrenFocused, isFamilyFocused, isEntertainmentCenter, isBar, isPark });
  const ordinaryLocalFacilityPenalty = ordinaryLocalFacilityPenaltyFor(place, { isMuseum, isPark, isNeighborhood, isRestaurant, isFoodHall, isBar, isEntertainmentCenter, isOrdinaryBusiness });
  const destinationSignificance = destinationSignificanceFor(place, profile, { isRestaurant, isMuseum, isPark, isNeighborhood, isEntertainmentCenter, isOrdinaryBusiness, isStaleOrClosedAttraction, isGamblingVenue, isThinResearchAttraction, ordinaryLocalFacilityPenalty, routeScope });
  const firstTimeVisitorValue = firstTimeVisitorValueFor(place, profile, { isRestaurant, isFoodHall, isBar, isMuseum, isPark, isNeighborhood, isFamilyFocused, isEntertainmentCenter, isOrdinaryBusiness, isStaleOrClosedAttraction, isGamblingVenue, isThinResearchAttraction, ordinaryLocalFacilityPenalty, routeScope });
  const currentStatusConfidence = currentStatusConfidenceFor(place, isStaleOrClosedAttraction);
  const primaryType = primaryTypeFor({ isRestaurant, isFoodHall, isBar, isEntertainmentCenter, isChildrenFocused, isMuseum, isPark, isNeighborhood, isCity, isHotel, categories, text });
  const secondaryTypes = [...new Set([
    isFoodHall ? "food-hall" : "",
    isRestaurant ? "restaurant" : "",
    isBar ? "bar-or-brewery" : "",
    isPier ? "pier" : "",
    isBoardwalk ? "boardwalk-or-promenade" : "",
    isBeachOrWaterfront ? "beach-or-waterfront" : "",
    isWaterActivity ? "water-activity" : "",
    isDinnerShow ? "dinner-show" : "",
    isEveningAnchor ? "evening-anchor" : "",
    isMountainOrTrail ? "mountain-or-trail" : "",
    isEntertainmentCenter ? "entertainment-center" : "",
    isChildrenFocused ? "children-focused" : "",
    isFamilyFocused ? "family-focused" : "",
    isMuseum ? "museum" : "",
    isPark ? "park-or-outdoor" : "",
    isNeighborhood ? "neighborhood" : "",
    routeScope
  ].filter(Boolean))];
  return {
    primaryType,
    secondaryTypes,
    isRestaurant,
    isFoodHall,
    isBar,
    isPier,
    isBoardwalk,
    isBeachOrWaterfront,
    isWaterActivity,
    isDinnerShow,
    isMountainOrTrail,
    isEveningAnchor,
    isEntertainmentCenter,
    isChildrenFocused,
    isFamilyFocused,
    isAdultFocused: isBar || has(/\b(cocktail|wine|brewery|distillery|nightlife|fine dining)\b/),
    isSensitiveOrExplicitContent,
    isGamblingVenue,
    isSportsVenue,
    isDestinationScalePark,
    isSelfDescribedBackup,
    isThinResearchAttraction,
    isMuseum,
    isPark,
    isNeighborhood,
    isCity,
    isRegionalDestination: ["easy-day-trip", "long-day-trip", "overnight-recommended"].includes(routeScope),
    isDayTrip: ["easy-day-trip", "long-day-trip"].includes(routeScope),
    isOvernightExtension: routeScope === "overnight-recommended",
    isHotel,
    isOrdinaryBusiness,
    isOrdinaryLocalFacility: ordinaryLocalFacilityPenalty.score >= 60,
    isStaleOrClosedAttraction,
    // A meal venue is not a valid backup for a sightseeing activity (only
    // for another meal), and a genuine regional/day-trip destination -- even
    // an "easy" one -- is a substantial outing on its own, not a quick
    // stand-in for a local activity that fell through.
    isBackupCompatible: !isOrdinaryBusiness && !isStaleOrClosedAttraction && !isChildrenFocused && !isEntertainmentCenter && !isDinnerShow && !isGamblingVenue && !isRestaurant && !isFoodHall && !["easy-day-trip", "long-day-trip", "overnight-recommended", "impractical"].includes(routeScope),
    servesBreakfast,
    servesLunch,
    servesDinner,
    travelerFit,
    destinationSignificance,
    firstTimeVisitorValue,
    ordinaryLocalFacilityPenalty,
    currentStatusConfidence,
    routeScope,
    confidence: confidenceFor(place, profile, text)
  };
}

function classifyPlace(place, feasibility, classification = classifyPlaceForPlanning(place, {}, {}, feasibility)) {
  const text = textFor(place);
  const nameText = normalizeText(place.name);
  const categoryText = normalizeText((place.categories || []).join(" "));
  const categories = new Set();
  if (!classification.isOrdinaryBusiness && !classification.isChildrenFocused && !classification.isStaleOrClosedAttraction && (classification.firstTimeVisitorValue.score >= 72 || /signature|hall of fame|speedway|discovery|mint|bechtler|sixth floor|stockyards|boardwalk|skywheel|marshwalk|brookgreen|huntington beach|broadway at the beach|barefoot landing|newfound gap|kuwohi|cades cove|roaring fork|little river road|foothills parkway|dollywood|the island in pigeon forge|anakeesta|skypark|ober gatlinburg/.test(nameText) || /museum|landmark|motorsports|science|beach|waterfront|national park|scenic corridor/.test(categoryText))) categories.add("signatureExperiences");
  if (/local|arts district|neighborhood|rail trail|noda|plaza|south end|camp north|bishop|deep ellum/.test(text)) categories.add("localFavorites");
  if (/neighborhood|district|rail trail|noda|plaza|south end|camp north|bishop|deep ellum|davidson/.test(text)) categories.add("neighborhoods");
  if (/nature|park|mountain|hike|garden|greenway|lake|waterfall|whitewater|arboretum|parkway|outdoor|beach|coastal|marsh|state park|brookgreen|national park|scenic corridor|overlook|trailhead|gap road|motor nature trail|loop road/.test(text)) categories.add("natureAnchors");
  if (/lake|river|water|whitewater|waterfall|beach|oceanfront|coastal|boardwalk|pier|cruise|kayak|paddleboard|fishing/.test(text)) categories.add("waterExperiences");
  if (/family|theme park|science|carowinds|aquarium|zoo/.test(text)) categories.add("familyAttractions");
  if (!classification.isChildrenFocused && /entertainment|live music|nightlife|theme park|sports|event|brewery|bars|speedway|skywheel|boardwalk|marshwalk|barefoot landing|broadway at the beach|the island in pigeon forge|dollywood|show|theater|theatre|sunset/.test(text)) categories.add("entertainmentAnchors");
  const foodCandidateText = `${nameText} ${categoryText} ${normalizeText((place.tags || []).join(" "))}`;
  if (classification.isFoodHall && /food hall|market|optimist|camp north|farmers market/.test(foodCandidateText)) categories.add("foodHalls");
  if (classification.servesBreakfast) categories.add("breakfastCandidates");
  if (classification.servesLunch) categories.add("lunchCandidates");
  if (classification.servesDinner) categories.add("dinnerCandidates");
  if (/rooftop|skyline|fahrenheit/.test(foodCandidateText)) categories.add("rooftopDining");
  if (/bar|brewery|nightlife|live music|evening|marshwalk|boardwalk|skywheel|barefoot landing|broadway at the beach/.test(foodCandidateText)) categories.add("barsAndNightlife");
  if (/scenic|drive|parkway|viewpoint|mountain|lake|newfound gap|kuwohi|clingsmans|cades cove|roaring fork|little river road|foothills parkway|motor nature trail|loop road|overlook/.test(text)) categories.add("scenicDrives");
  if (["easy-day-trip", "long-day-trip"].includes(feasibility.classification) || /day-trip|nearby|regional/.test(text)) categories.add("nearbyDayTrips");
  if (feasibility.classification === "overnight-recommended" || /overnight|extension|asheville|smoky|boone|blowing rock|grandfather/.test(text)) categories.add("regionalOvernightExtensions");
  if (/seasonal|event|race|concert|fair|music/.test(text)) categories.add("seasonalExperiences");
  if (!categories.size) categories.add("localFavorites");
  return categories;
}

function travelerFitFor(place, input, flags) {
  const reasons = [];
  let score = 0;
  const soloAdult = childFreeAdultTrip(input);
  const text = textFor(place);
  const explicitText = normalizeText([
    input.tripDescription,
    input.mustHavePlaces?.join(" "),
    input.preferences?.map((pref) => pref.label || pref).join(" ")
  ].filter(Boolean).join(" "));
  if (soloAdult && flags.isChildrenFocused) {
    score -= 90;
    reasons.push("Children-focused stop suppressed for a child-free adult trip.");
  } else if (soloAdult && flags.isFamilyFocused) {
    score -= 28;
    reasons.push("Family-focused stop reduced for a solo adult trip.");
  }
  if (soloAdult && flags.isEntertainmentCenter) {
    score -= 45;
    reasons.push("Family entertainment center reduced unless explicitly requested.");
  }
  if (flags.isPark && /easy|minimal/i.test(input.walkingLimit || "") && String(place.accessibility || "") === "limited") {
    score -= 30;
    reasons.push("Outdoor stop may exceed walking comfort.");
  }
  if (flags.isBar && input.alcohol?.primary === "No Alcohol") {
    score -= 55;
    reasons.push("Alcohol-led venue suppressed by no-alcohol preference.");
  }
  if (/\b(knife store|knife works|souvenir shop|gift shop|outlet mall|ordinary shop|mall)\b/.test(text) && !/\b(shopping|knife|souvenir|retail)\b/.test(explicitText)) {
    score -= 90;
    reasons.push("Generic retail stop suppressed unless explicitly requested.");
  }
  if (/\b(motorcycle museum|crime museum|alcatraz|haunted house|wax museum|mirror maze|oddities|novelty museum)\b/.test(text) && !/\b(motorcycle|crime|haunted|wax museum|oddities|novelty)\b/.test(explicitText)) {
    score -= 72;
    reasons.push("Narrow novelty attraction reduced unless explicitly requested.");
  }
  if (/\b(couple|date night|scenic|sunset|easy walk|quiet evening|viewpoint|cafe|waterfall)\b/.test(text) && /couple/i.test(input.groupType || "")) {
    score += 14;
    reasons.push("Couple-friendly scenery or evening fit.");
  }
  if (/\b(solo|self guided|downtown|walkable|museum|trail|cafe)\b/.test(text) && /solo/i.test(input.groupType || "")) {
    score += 10;
    reasons.push("Solo-friendly flexible pacing fit.");
  }
  if (!reasons.length) reasons.push("No traveler-fit conflict detected.");
  return { score, reasons };
}

function destinationSignificanceFor(place, profile, flags) {
  const text = textFor(place);
  let score = 0;
  const reasons = [];
  if (/national|state capitol|capitol|major|signature|iconic|must see|must do|official tourism|tourist attraction|historical landmark|cultural landmark|historic|presidential|civil rights|aquarium|art museum|natural sciences|history museum|history center|botanical|university|warehouse district|city market|public market|olympic park|beltline|national historical park|historic district|memorial|stockyards|sixth floor|duke|unc|boardwalk|skywheel|marshwalk|brookgreen|huntington beach|barefoot landing|broadway at the beach|oceanfront|beach access|cherry grove/.test(text)) {
    score += 26;
    reasons.push("Recognized as a destination-significant anchor.");
  }
  if (/one of the largest|world class|world renowned|nationally significant|civil rights|human rights|birth home|presidential|botanical garden|aquarium|historic park|olympic|landmark market/.test(text)) {
    score += 22;
    reasons.push("Carries strong first-time visitor or national/local identity value.");
  }
  if (flags.isBeachOrWaterfront || flags.isWaterActivity) score += 24;
  if (/newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|gatlinburg trail|grotto falls|laurel falls|rainbow falls|abrams falls|dollywood|the island in pigeon forge|anakeesta|skypark|ober gatlinburg/.test(text)) {
    score += 34;
    reasons.push("Recognized as a region-defining mountain, park, or entertainment anchor.");
  }
  if (flags.isEveningAnchor) score += 14;
  if (flags.isMuseum || flags.isPark || flags.isNeighborhood) score += 8;
  if (flags.isRestaurant && !flags.isNeighborhood) score -= 4;
  if (flags.isEntertainmentCenter && !/the island in pigeon forge|dollywood|skypark|anakeesta|ober gatlinburg/.test(text)) score -= 25;
  if (flags.isDinnerShow) score -= 20;
  if (flags.isGamblingVenue) score -= 40;
  if (flags.isThinResearchAttraction) score -= 55;
  if (flags.isOrdinaryBusiness) score -= 80;
  if (flags.ordinaryLocalFacilityPenalty?.score) score -= Math.round(flags.ordinaryLocalFacilityPenalty.score * 0.55);
  if (flags.isStaleOrClosedAttraction) score -= 140;
  if (["long-day-trip", "overnight-recommended", "impractical"].includes(flags.routeScope)) score -= 12;
  if (/generic|candidate|starter planning|area only|verify and replace/.test(text)) score -= 22;
  if (profile.id?.startsWith("generic-")) score -= 8;
  return { score, reasons: reasons.length ? reasons : ["Standard destination candidate."] };
}

export function firstTimeVisitorValueFor(place, profile = {}, flags = {}) {
  const text = textFor(place);
  const source = normalizeText(`${place.sourceMetadata?.sourceUrl || ""} ${place.sourceMetadata?.dataFreshness || ""} ${place.sourceMetadata?.dataConfidence || ""}`);
  let score = 0;
  const reasons = [];
  const add = (amount, reason) => {
    score += amount;
    if (reason) reasons.push(reason);
  };
  // "tourist attraction"/"historical landmark"/"cultural landmark" are Google's
  // own structural place-type tags (always present when Google classifies a
  // place that way), unlike editorial summary text which is frequently absent
  // or inconsistent between identical live requests. Trusting these keeps
  // scoring stable across API calls instead of swinging on whether an
  // editorial blurb happened to be present this time.
  if (/official tourism|visitor bureau|destination guide|must see|must do|first time|top attraction|tourist attraction|historical landmark|cultural landmark|iconic|signature|essential|famous|landmark/.test(text)) add(30, "Prominent first-time or official-tourism signal.");
  if (/national|national historical park|national historic site|presidential|civil rights|human rights|memorial|historic district|world class|one of the largest|world renowned/.test(text)) add(26, "Local or national significance signal.");
  if (/aquarium|botanical garden|art museum|history center|science center|olympic park|public market|food hall|market|beltline|riverwalk|boardwalk|stockyards|observatory|viewpoint|cathedral|palace|castle|monument/.test(text)) add(20, "Destination-defining attraction type.");
  if (/national park|scenic corridor|newfound gap|kuwohi|clingsmans dome|cades cove|roaring fork|little river road|foothills parkway|gatlinburg trail|grotto falls|laurel falls|rainbow falls|abrams falls|dollywood|the island in pigeon forge|anakeesta|skypark|ober gatlinburg/.test(text)) add(34, "Region-defining park, scenic, trail, or entertainment signal.");
  if (flags.isMuseum || flags.isNeighborhood || flags.isPark) add(8, "Adds cultural, neighborhood, or outdoor trip depth.");
  if (flags.isRestaurant || flags.isFoodHall || flags.isBar) add(flags.isFoodHall ? 12 : 4, "Useful as food or evening support, not a primary attraction by itself.");
  if (/couple|adult|solo|family|senior/.test(text)) add(4, "Has broad traveler fit metadata.");
  if (Number(place.typicalDurationMinutes || 0) >= 150) add(8, "Has enough experience depth for a major vacation block.");
  if (/high|official|retrieved|ai assisted|provider/.test(source)) add(4, "Has a current/provider-backed source signal.");
  if (flags.routeScope === "local") add(8, "Route-compatible for a first-time base itinerary.");
  if (flags.routeScope === "easy-day-trip") add(2, "Plausible nearby excursion.");
  if (flags.routeScope === "long-day-trip") score -= 10;
  if (flags.routeScope === "overnight-recommended") score -= 16;
  if (flags.isEntertainmentCenter) score -= 20;
  if (flags.isGamblingVenue) score -= 35;
  if (flags.isThinResearchAttraction) score -= 55;
  if (flags.isOrdinaryBusiness) score -= 80;
  if (flags.ordinaryLocalFacilityPenalty?.score) score -= flags.ordinaryLocalFacilityPenalty.score;
  if (flags.isStaleOrClosedAttraction) score -= 140;
  if (/backup|generic|candidate|starter planning|ordinary|local facility|sports field|playground|recreation center/.test(text)) score -= 18;
  return {
    score: Math.max(-140, Math.round(score)),
    band: score >= 88 ? "destination-defining" : score >= 58 ? "major" : score >= 30 ? "supporting" : "low",
    reasons: reasons.length ? reasons : ["No strong first-time visitor signal."]
  };
}

function ordinaryLocalFacilityPenaltyFor(place, flags = {}) {
  const text = textFor(place);
  if (flags.isOrdinaryBusiness) return { score: 140, reasons: ["Ordinary business without destination value."] };
  const reasons = [];
  let score = 0;
  const ordinaryPark = /\b(neighborhood park|community park|local park|playground|sports field|ball field|soccer field|skate park|dog park|recreation center|rec center|aquatic center|county park|municipal park)\b/.test(text);
  const ordinaryFarm = /\b(farm|orchard|pumpkin patch|corn maze|u pick|u-pick)\b/.test(text) && !/\b(winery|historic|national|state|botanical|world|signature|famous|official tourism|regional destination)\b/.test(text);
  const specialInterestWorship = /\b(temple|church|cathedral|mosque|synagogue|shrine)\b/.test(text) && !/\b(cathedral|historic|national|landmark|famous|architecture|official tourism|pilgrimage|world)\b/.test(text);
  const genericSuburbanFacility = /\b(suburban|ordinary|local facility|school campus|sports complex|community center)\b/.test(text);
  const genericRetail = /\b(knife store|knife works|souvenir shop|gift shop|outlet mall|ordinary shop|mall)\b/.test(text) && !/\b(historic market|public market|food hall|signature shopping district|official tourism|downtown district)\b/.test(text);
  const novelty = /\b(motorcycle museum|crime museum|alcatraz|haunted house|wax museum|mirror maze|oddities|novelty museum)\b/.test(text) && !/\b(signature|official tourism|nationally significant|historic)\b/.test(text);
  if (ordinaryPark) {
    score += 72;
    reasons.push("Ordinary local recreation facility.");
  }
  if (ordinaryFarm) {
    score += 64;
    reasons.push("Local farm/seasonal facility without strong destination signal.");
  }
  if (specialInterestWorship) {
    score += 48;
    reasons.push("Special-interest worship site reduced unless explicitly requested.");
  }
  if (genericSuburbanFacility) {
    score += 52;
    reasons.push("Generic suburban facility signal.");
  }
  if (genericRetail) {
    score += 96;
    reasons.push("Generic retail or souvenir stop without broad destination value.");
  }
  if (novelty) {
    score += 72;
    reasons.push("Narrow novelty attraction reduced unless requested.");
  }
  if ((flags.isMuseum || flags.isNeighborhood || flags.isRestaurant || flags.isFoodHall || flags.isBar) && score) score = Math.max(0, score - 24);
  return { score, reasons };
}

function staleOrClosedAttractionFor(place) {
  const text = textFor(place);
  if (/\b(old cnn studio tour|cnn studio tour)\b/.test(text) && !/\bcurrent official public tour exists\b/.test(text)) return true;
  return /\b(closed|permanently closed|no longer operates|discontinued|defunct)\b/.test(text)
    && !/\b(current|reopened|reimagined|reopened as|now operates|current identity verified)\b/.test(text);
}

function currentStatusConfidenceFor(place, stale) {
  const text = normalizeText(`${place.openingTimeGuidance || ""} ${(place.seasonalNotes || []).join(" ")} ${place.sourceMetadata?.dataFreshness || ""} ${place.sourceMetadata?.retrievedAt || ""}`);
  if (stale) return { score: 0, band: "stale-or-closed", lastVerifiedAt: place.sourceMetadata?.retrievedAt || "", reasons: ["Stale or discontinued attraction signal detected."] };
  if (/date specific|current|retrieved|official|verify current|confirm current/.test(text)) return { score: 74, band: "verify-current-before-booking", lastVerifiedAt: place.sourceMetadata?.retrievedAt || "", reasons: ["Current-status check is present but should be verified before travel."] };
  return { score: 45, band: "unknown", lastVerifiedAt: place.sourceMetadata?.retrievedAt || "", reasons: ["No date-specific operating status available."] };
}

function destinationDefiningExperiences(profile, primaryArchetype, placeFlags) {
  if (primaryArchetype === "beach/coastal") {
    return [
      "beach or oceanfront time",
      "boardwalk or waterfront walk",
      "coastal nature or garden",
      "seafood or waterfront dining",
      "evening entertainment or sunset"
    ];
  }
  if (primaryArchetype === "mountain" || primaryArchetype === "national park") return ["scenic viewpoints", "trails or easy nature walks", "regional drives", "weather-aware outdoor blocks"];
  if (primaryArchetype === "food destination") return ["signature dining", "local markets", "neighborhood food walks", "reservation-worthy dinners"];
  if (placeFlags.some((flag) => flag.isMuseum)) return ["signature museums", "walkable districts", "local dining", "evening neighborhoods"];
  return ["signature attractions", "local neighborhoods", "food and evening anchors", "outdoor or scenic option"];
}

function expectedCategoryMixFor(primaryArchetype, secondaryArchetypes) {
  if (primaryArchetype === "beach/coastal") {
    return {
      beachWaterfront: "required",
      signatureEntertainment: "high",
      coastalNature: "high",
      foodEvening: "high",
      museumsCulture: secondaryArchetypes.includes("major city") ? "moderate" : "low"
    };
  }
  if (primaryArchetype === "mountain" || primaryArchetype === "national park") return { outdoorNature: "required", scenicRoutes: "high", foodEvening: "moderate", indoorCulture: "backup" };
  if (primaryArchetype === "major city") return { signatureCulture: "high", neighborhoods: "high", foodEvening: "high", nature: "moderate" };
  return { signature: "high", localFood: "moderate", outdoors: "moderate", evening: "moderate" };
}

function weatherSensitiveCategoriesFor(primaryArchetype) {
  if (primaryArchetype === "beach/coastal") return ["beach", "water sports", "boat cruises", "piers", "outdoor boardwalks"];
  if (primaryArchetype === "mountain" || primaryArchetype === "national park") return ["hikes", "viewpoints", "scenic drives", "waterfalls"];
  return ["outdoor neighborhoods", "parks", "seasonal events"];
}

function foodIdentityFor(text, primaryArchetype) {
  if (/seafood|oceanfront|marshwalk|coastal/.test(text) || primaryArchetype === "beach/coastal") return "seafood, waterfront dining, casual beach lunches, and local breakfast spots";
  if (/barbecue|bbq/.test(text)) return "regional barbecue and casual local restaurants";
  if (/market|food hall|culinary|restaurant/.test(text)) return "local restaurants, markets, and reservation-worthy dinners";
  return "local restaurants and route-compatible meals";
}

function travelerFitForArchetype(input, primaryArchetype) {
  const soloAdult = childFreeAdultTrip(input);
  if (primaryArchetype === "beach/coastal" && soloAdult) return "Strong fit for beach, coastal nature, seafood, boardwalk, and flexible evening experiences; child-only attractions should be optional.";
  if (soloAdult) return "Solo adult trip; suppress child-focused anchors unless explicitly requested.";
  return "Use group composition and individual restrictions to filter activity intensity and meal choices.";
}

function routeScopeFrom(feasibility, text) {
  if (feasibility?.classification === "not-practical") return "impractical";
  if (feasibility?.classification) return feasibility.classification;
  if (/overnight|extension|split stay/.test(text)) return "overnight-recommended";
  if (/day trip|nearby excursion|regional/.test(text)) return "easy-day-trip";
  return "local";
}

function primaryTypeFor(flags) {
  if (flags.isHotel) return "hotel";
  if (flags.isFoodHall) return "food-hall";
  if (flags.isRestaurant) return "restaurant";
  if (flags.isBar) return "bar-or-brewery";
  if (flags.isEntertainmentCenter) return "entertainment-center";
  if (flags.isChildrenFocused) return "children-focused-attraction";
  if (flags.isMuseum) return "museum";
  if (flags.isPark) return "park-or-outdoor";
  if (flags.isNeighborhood) return "neighborhood";
  if (flags.isCity) return "city-or-town";
  if (flags.categories.has("history")) return "historic-site";
  return flags.text.includes("landmark") ? "landmark" : "attraction";
}

function confidenceFor(place, profile, text) {
  if (place.sourceMetadata?.dataConfidence === "provider" || place.sourceMetadata?.dataConfidence === "ai-assisted") return "medium";
  if (/starter planning|generic|candidate/.test(text) || profile.id?.startsWith("generic-")) return "low";
  return "medium";
}

function rejectionReason(classification, feasibility, input) {
  if (classification.isOrdinaryBusiness) return "Rejected because it appears to be an ordinary business rather than a traveler-facing destination stop.";
  if (classification.isStaleOrClosedAttraction) return "Rejected because current-status checks indicate the attraction, tour, or venue identity may be stale or discontinued.";
  if (childFreeAdultTrip(input) && classification.isChildrenFocused) return "Rejected because children-focused stops do not fit a child-free adult trip unless explicitly requested.";
  if (classification.travelerFit.score <= -70) return classification.travelerFit.reasons[0] || "Rejected because traveler fit is too weak.";
  if (feasibility.classification === "not-practical") return "Rejected because the route burden is too high for the configured daily drive limit.";
  return "Rejected because it did not meet planning quality thresholds.";
}

function childFreeAdultTrip(input) {
  return Number(input.childCount || input.children || 0) === 0 && Number(input.travelers || input.adults || 1) >= 1;
}

function userInterestScore(place, selectedText) {
  const text = textFor(place);
  let score = 0;
  if (/nature|outdoor|water|scenic|hike|lake|waterfall|mountain/.test(selectedText) && /nature|outdoor|water|scenic|hike|lake|waterfall|mountain|whitewater|parkway/.test(text)) score += 34;
  if (/food|cuisine|restaurant|dining|cafe|dessert|vegetarian/.test(selectedText) && /food|market|hall|restaurant|dining|cafe|bakery|rooftop/.test(text)) score += 30;
  if (/nightlife|bar|brewery|live music|evening/.test(selectedText) && /nightlife|bar|brewery|live music|evening|rooftop/.test(text)) score += 28;
  if (/family|theme|entertainment|rides/.test(selectedText) && /family|theme park|carowinds|science|entertainment/.test(text)) score += 28;
  if (/history|museum|art|culture|architecture/.test(selectedText) && /history|museum|art|culture|architecture/.test(text)) score += 26;
  if (/relax|quiet|easy walking|minimal/.test(selectedText) && /lake|garden|park|quiet|easy-walk|davidson|scenic/.test(text)) score += 18;
  return score;
}

function preferenceText(input) {
  return [
    input.pace,
    input.walkingLimit,
    input.hiking,
    ...(input.preferences || []).map((pref) => pref.label),
    ...(input.food?.diet || []),
    ...(input.food?.cuisine || []),
    ...(input.food?.cuisineInterests || []),
    ...(input.alcohol?.preferences || []),
    ...(input.mustHavePlaces || [])
  ].map(normalizeText).join(" ");
}

function redundancyScore(place) {
  const text = textFor(place);
  if (/park|walk|greenway/.test(text)) return 18;
  if (/food|evening|neighborhood/.test(text)) return 10;
  return 4;
}

function explanationFor(place, feasibility, userFitScore) {
  if (feasibility.classification === "overnight-recommended") return "Considered as a high-value regional extension, but better with an overnight or split stay.";
  if (feasibility.classification === "long-day-trip") return "Considered as a memorable but tiring day trip because the route burden is high.";
  if (userFitScore > 0) return "Accepted because it matches selected interests and has enough local significance.";
  return "Accepted as a credible destination candidate with useful category coverage.";
}

function experienceGaps(buckets) {
  const gaps = [];
  if (!buckets.signatureExperiences.length) gaps.push("signature experiences");
  if (!buckets.natureAnchors.length) gaps.push("nature or outdoor anchors");
  if (!buckets.foodHalls.length && !buckets.dinnerCandidates.length) gaps.push("food candidates");
  if (!buckets.nearbyDayTrips.length && !buckets.regionalOvernightExtensions.length) gaps.push("regional options");
  return gaps;
}

function names(items) {
  return [...new Set(items.map((item) => item.place.name))];
}

function arrayWithFallback(primary, fallback) {
  const values = Array.isArray(primary) && primary.length ? primary : fallback;
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function shortName(profile) {
  return profile.canonicalName.split(",")[0];
}

function textFor(place) {
  return normalizeText(`${place.name} ${place.shortDescription || ""} ${(place.categories || []).join(" ")} ${(place.tags || []).join(" ")}`);
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const radiusMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
