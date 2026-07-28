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
  const selectedText = preferenceText(input);
  const maxRoundTripMinutes = Math.max(90, Number(input.maxDrivingMinutes || 240));
  const opportunities = profile.places.map((place) => {
    const feasibility = routeFeasibilityForPlace(profile, baseRegionId, place, maxRoundTripMinutes);
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
    const ordinaryPenalty = classification.isOrdinaryBusiness ? 140 : 0;
    const score = Math.round(significanceScore + classification.destinationSignificance.score + userFitScore + classification.travelerFit.score - routeBurdenPenalty - accessibilityPenalty - ordinaryPenalty);
    const rejected = feasibility.classification === "not-practical"
      || classification.isOrdinaryBusiness
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
  const mountainScore = count((flag) => flag.isMountainOrTrail) * 15 + (/mountain|parkway|ridge|hike|trail|waterfall|national park/.test(profileText + " " + nameText) ? 28 : 0);
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
  let score = Number(place.priorityScore || 60);
  if (/signature|major|essential|famous|hall of fame|museum|landmark|national|whitewater|stockyards|biltmore|parkway|boardwalk|skywheel|marshwalk|barefoot landing|broadway at the beach|brookgreen|huntington beach|cherry grove|oceanfront|beach access/.test(text)) score += 18;
  if (/food hall|market|rooftop|local|neighborhood|arts district|live music/.test(text)) score += 10;
  if (/day-trip|regional|mountain|lake|waterfall|state park|scenic|coastal|beach|waterfront|cruise|kayak|paddleboard|fishing/.test(text)) score += 12;
  if (/backup|generic|area$|walk$|candidate|starter planning/.test(text)) score -= 20;
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
  const isMountainOrTrail = has(/\b(mountain|ridge|parkway|hike|trail|waterfall|overlook)\b/);
  const isEveningAnchor = has(/\b(skywheel|boardwalk|marshwalk|barefoot landing|broadway at the beach|live music|nightlife|sunset|evening|rooftop|waterfront dining)\b/);
  const isEntertainmentCenter = has(/\b(frankie|arcade|go kart|gokart|mini golf|laser tag|bowling|family entertainment|amusement center|trampoline|escape room|fun park|wax museum|ripley|mirror maze)\b/);
  const isChildrenFocused = has(/\b(children|childrens|kids|kid friendly|toddler|playground|marbles kids|children s museum|children museum|edventure)\b/);
  const isFamilyFocused = isChildrenFocused || has(/\b(family|zoo|aquarium|theme park|amusement|science center)\b/);
  const isFoodHall = has(/\b(food hall|public market|market hall|marketplace|transfer co|food court)\b/);
  const isBar = has(/\b(bar|brewery|brewhouse|beer garden|taproom|cocktail|distillery|winery|wine bar)\b/);
  const restaurantWords = /\b(restaurant|cafe|cafes|coffee|bakery|brunch|breakfast|diner|bistro|grill|taqueria|pizzeria|pizza|bbq|barbecue|ramen|sushi|tavern|kitchen|eatery|deli|sandwich|seafood|steakhouse|noodle|burger|tacos|dumpling|dessert|ice cream)\b/;
  const attractionOnlyFood = /\b(museum|park|garden|trail|greenway|lake|mountain|viewpoint|monument|memorial|stadium|arena|science center|children|playground|amusement|go kart|arcade|pier|boardwalk|promenade|skywheel|theater|theatre|show)\b/;
  const isRestaurant = (restaurantWords.test(text) || categoryHas(/\b(food|restaurant|cafe|bakery|bar)\b/) || isFoodHall)
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
  const routeScope = routeScopeFrom(feasibility, text);
  const servesBreakfast = isRestaurant && !isDinnerShow && (has(/\b(breakfast|brunch|cafe|coffee|bakery|diner)\b/) || !isBar && !has(/\b(cocktail|nightclub|brewery|seafood|steakhouse|dinner)\b/));
  const servesLunch = isRestaurant && !has(/\b(cocktail lounge|nightclub)\b/);
  const servesDinner = isRestaurant && (has(/\b(dinner|restaurant|bistro|grill|tavern|bar|brewery|food hall|kitchen|pizzeria|bbq|barbecue|seafood|steakhouse)\b/) || !has(/\b(breakfast only)\b/));
  const travelerFit = travelerFitFor(place, input, { isChildrenFocused, isFamilyFocused, isEntertainmentCenter, isBar, isPark });
  const destinationSignificance = destinationSignificanceFor(place, profile, { isRestaurant, isMuseum, isPark, isNeighborhood, isEntertainmentCenter, isOrdinaryBusiness, routeScope });
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
    isMuseum,
    isPark,
    isNeighborhood,
    isCity,
    isRegionalDestination: ["easy-day-trip", "long-day-trip", "overnight-recommended"].includes(routeScope),
    isDayTrip: ["easy-day-trip", "long-day-trip"].includes(routeScope),
    isOvernightExtension: routeScope === "overnight-recommended",
    isHotel,
    isOrdinaryBusiness,
    isBackupCompatible: !isOrdinaryBusiness && !isChildrenFocused && !isEntertainmentCenter && !isDinnerShow && !["long-day-trip", "overnight-recommended", "impractical"].includes(routeScope),
    servesBreakfast,
    servesLunch,
    servesDinner,
    travelerFit,
    destinationSignificance,
    routeScope,
    confidence: confidenceFor(place, profile, text)
  };
}

function classifyPlace(place, feasibility, classification = classifyPlaceForPlanning(place, {}, {}, feasibility)) {
  const text = textFor(place);
  const nameText = normalizeText(place.name);
  const categoryText = normalizeText((place.categories || []).join(" "));
  const categories = new Set();
  if (!classification.isOrdinaryBusiness && !classification.isChildrenFocused && (/signature|hall of fame|speedway|discovery|mint|bechtler|sixth floor|stockyards|boardwalk|skywheel|marshwalk|brookgreen|huntington beach|broadway at the beach|barefoot landing/.test(nameText) || /museum|landmark|motorsports|science|beach|waterfront/.test(categoryText))) categories.add("signatureExperiences");
  if (/local|arts district|neighborhood|rail trail|noda|plaza|south end|camp north|bishop|deep ellum/.test(text)) categories.add("localFavorites");
  if (/neighborhood|district|rail trail|noda|plaza|south end|camp north|bishop|deep ellum|davidson/.test(text)) categories.add("neighborhoods");
  if (/nature|park|mountain|hike|garden|greenway|lake|waterfall|whitewater|arboretum|parkway|outdoor|beach|coastal|marsh|state park|brookgreen/.test(text)) categories.add("natureAnchors");
  if (/lake|river|water|whitewater|waterfall|beach|oceanfront|coastal|boardwalk|pier|cruise|kayak|paddleboard|fishing/.test(text)) categories.add("waterExperiences");
  if (/family|theme park|science|carowinds|aquarium|zoo/.test(text)) categories.add("familyAttractions");
  if (!classification.isChildrenFocused && /entertainment|live music|nightlife|theme park|sports|event|brewery|bars|speedway|skywheel|boardwalk|marshwalk|barefoot landing|broadway at the beach|sunset/.test(text)) categories.add("entertainmentAnchors");
  const foodCandidateText = `${nameText} ${categoryText} ${normalizeText((place.tags || []).join(" "))}`;
  if (classification.isFoodHall && /food hall|market|optimist|camp north|farmers market/.test(foodCandidateText)) categories.add("foodHalls");
  if (classification.servesBreakfast) categories.add("breakfastCandidates");
  if (classification.servesLunch) categories.add("lunchCandidates");
  if (classification.servesDinner) categories.add("dinnerCandidates");
  if (/rooftop|skyline|fahrenheit/.test(foodCandidateText)) categories.add("rooftopDining");
  if (/bar|brewery|nightlife|live music|evening|marshwalk|boardwalk|skywheel|barefoot landing|broadway at the beach/.test(foodCandidateText)) categories.add("barsAndNightlife");
  if (/scenic|drive|parkway|viewpoint|mountain|lake/.test(text)) categories.add("scenicDrives");
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
  if (!reasons.length) reasons.push("No traveler-fit conflict detected.");
  return { score, reasons };
}

function destinationSignificanceFor(place, profile, flags) {
  const text = textFor(place);
  let score = 0;
  const reasons = [];
  if (/national|state capitol|capitol|major|signature|iconic|must see|must do|historic|presidential|art museum|natural sciences|history museum|botanical|university|warehouse district|city market|stockyards|sixth floor|duke|unc|boardwalk|skywheel|marshwalk|brookgreen|huntington beach|barefoot landing|broadway at the beach|oceanfront|beach access|cherry grove/.test(text)) {
    score += 26;
    reasons.push("Recognized as a destination-significant anchor.");
  }
  if (flags.isBeachOrWaterfront || flags.isWaterActivity) score += 24;
  if (flags.isEveningAnchor) score += 14;
  if (flags.isMuseum || flags.isPark || flags.isNeighborhood) score += 8;
  if (flags.isRestaurant && !flags.isNeighborhood) score -= 4;
  if (flags.isEntertainmentCenter) score -= 25;
  if (flags.isDinnerShow) score -= 20;
  if (flags.isOrdinaryBusiness) score -= 80;
  if (["long-day-trip", "overnight-recommended", "impractical"].includes(flags.routeScope)) score -= 12;
  if (/generic|candidate|starter planning|area only|verify and replace/.test(text)) score -= 22;
  if (profile.id?.startsWith("generic-")) score -= 8;
  return { score, reasons: reasons.length ? reasons : ["Standard destination candidate."] };
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
