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
    const feasibility = routeFeasibility(profile, baseRegionId, place.regionId, maxRoundTripMinutes);
    const categorySet = classifyPlace(place, feasibility);
    const userFitScore = userInterestScore(place, selectedText);
    const significanceScore = localSignificanceScore(place, profile);
    const routeBurdenPenalty = feasibility.classification === "not-practical" ? 120
      : feasibility.classification === "overnight-recommended" ? 38
        : feasibility.classification === "long-day-trip" ? 18
          : feasibility.classification === "easy-day-trip" ? 4
            : 0;
    const accessibilityPenalty = constraints.minimalWalking && place.accessibility === "limited" ? 45 : 0;
    const score = Math.round(significanceScore + userFitScore - routeBurdenPenalty - accessibilityPenalty);
    const rejected = feasibility.classification === "not-practical";
    return {
      id: place.id,
      place,
      categories: [...categorySet],
      score,
      userFitScore,
      significanceScore,
      redundancyScore: redundancyScore(place),
      routeFeasibility: feasibility,
      accepted: !rejected,
      reason: rejected
        ? "Rejected because the route burden is too high for the configured daily drive limit."
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
  return {
    destinationIdentity: {
      id: profile.id,
      canonicalName: profile.canonicalName,
      summary: profile.summary,
      baseRegionId
    },
    ...Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.slice(0, 12)])),
    allCandidates: opportunities,
    routeOptions,
    categoryCoverage: categoryCoverage(buckets),
    experienceGaps: experienceGaps(buckets),
    researchConfidence: profile.id.startsWith("generic-") ? "starter" : "curated",
    sourceFreshness: profile.sourceMetadata?.freshness || "curated-or-generated"
  };
}

export function localSignificanceScore(place, profile) {
  const text = textFor(place);
  let score = Number(place.priorityScore || 60);
  if (/signature|major|essential|famous|hall of fame|museum|landmark|national|whitewater|stockyards|biltmore|parkway/.test(text)) score += 18;
  if (/food hall|market|rooftop|local|neighborhood|arts district|live music/.test(text)) score += 10;
  if (/day-trip|regional|mountain|lake|waterfall|state park|scenic/.test(text)) score += 12;
  if (/backup|generic|area$|walk$/.test(text)) score -= 12;
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

function classifyPlace(place, feasibility) {
  const text = textFor(place);
  const nameText = normalizeText(place.name);
  const categoryText = normalizeText((place.categories || []).join(" "));
  const categories = new Set();
  if (/signature|hall of fame|speedway|discovery|mint|bechtler|sixth floor|stockyards/.test(nameText) || /museum|landmark|motorsports|science/.test(categoryText)) categories.add("signatureExperiences");
  if (/local|arts district|neighborhood|rail trail|noda|plaza|south end|camp north|bishop|deep ellum/.test(text)) categories.add("localFavorites");
  if (/neighborhood|district|rail trail|noda|plaza|south end|camp north|bishop|deep ellum|davidson/.test(text)) categories.add("neighborhoods");
  if (/nature|park|mountain|hike|garden|greenway|lake|waterfall|whitewater|arboretum|parkway|outdoor/.test(text)) categories.add("natureAnchors");
  if (/lake|river|water|whitewater|waterfall/.test(text)) categories.add("waterExperiences");
  if (/family|theme park|science|carowinds|aquarium|zoo/.test(text)) categories.add("familyAttractions");
  if (/entertainment|live music|nightlife|theme park|sports|event|brewery|bars|speedway/.test(text)) categories.add("entertainmentAnchors");
  const foodCandidateText = `${nameText} ${categoryText} ${normalizeText((place.tags || []).join(" "))}`;
  if (/food hall|market|optimist|camp north|farmers market/.test(foodCandidateText)) categories.add("foodHalls");
  if (/breakfast|brunch|cafe|bakery/.test(foodCandidateText)) categories.add("breakfastCandidates");
  if (/lunch|food|market|food hall|casual|dining/.test(foodCandidateText)) categories.add("lunchCandidates");
  if (/dinner|restaurant|dining|rooftop|evening|food/.test(foodCandidateText)) categories.add("dinnerCandidates");
  if (/rooftop|skyline|fahrenheit/.test(foodCandidateText)) categories.add("rooftopDining");
  if (/bar|brewery|nightlife|live music|evening/.test(foodCandidateText)) categories.add("barsAndNightlife");
  if (/scenic|drive|parkway|viewpoint|mountain|lake/.test(text)) categories.add("scenicDrives");
  if (["easy-day-trip", "long-day-trip"].includes(feasibility.classification) || /day-trip|nearby|regional/.test(text)) categories.add("nearbyDayTrips");
  if (feasibility.classification === "overnight-recommended" || /overnight|extension|asheville|smoky|boone|blowing rock|grandfather/.test(text)) categories.add("regionalOvernightExtensions");
  if (/seasonal|event|race|concert|fair|music/.test(text)) categories.add("seasonalExperiences");
  if (!categories.size) categories.add("localFavorites");
  return categories;
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
