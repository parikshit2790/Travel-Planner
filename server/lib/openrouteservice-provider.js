const ORS_BASE_URL = "https://api.openrouteservice.org";
const ORS_SOURCE_URL = "https://openrouteservice.org";
const POI_CATEGORY_GROUP_IDS = [130, 220, 260, 330, 360, 560, 620];
const FOOD_CATEGORY_GROUP_IDS = [560];

export async function openRouteServiceLocationSearch(query, config) {
  const text = String(query || "").trim();
  const json = await orsRequest(`/geocode/autocomplete?${new URLSearchParams({ text, size: "8" })}`, { config });
  return geocodeFeatures(json).map((feature) => normalizeLocationFeature(feature, text)).filter(Boolean).slice(0, 8);
}

export async function openRouteServiceDestinationResearch(destination, trip = {}, config) {
  const destinationLocation = locationFromTrip(trip) || (await resolveDestination(destination, config));
  if (!destinationLocation) throw providerError("DESTINATION_RESEARCH_FAILED", "Destination could not be resolved.", false);
  const center = [destinationLocation.longitude, destinationLocation.latitude];
  const destinationName = destinationLocation.canonicalName || String(destination || "").trim();
  const [placesResponse, foodResponse] = await Promise.all([
    openRouteServicePoiCandidates(center, POI_CATEGORY_GROUP_IDS, config, destinationName, "places"),
    openRouteServicePoiCandidates(center, FOOD_CATEGORY_GROUP_IDS, config, destinationName, "food")
  ]);
  const poiFeatures = dedupePoiFeatures(placesResponse)
    .filter(isTravelWorthyPoi)
    .sort((a, b) => poiTravelScore(b, destinationName) - poiTravelScore(a, destinationName));
  const foodFeatures = dedupePoiFeatures(foodResponse)
    .filter(isFoodWorthyPoi)
    .sort((a, b) => poiTravelScore(b, destinationName) - poiTravelScore(a, destinationName));
  const resilientFeatures = poiFeatures.length >= 8
    ? poiFeatures
    : [...poiFeatures, ...starterPoiFeatures(destinationLocation, destinationName, center, 10 - poiFeatures.length)];
  const selectedFeatures = selectDiversePoiFeatures(resilientFeatures, center, 34);
  const regions = buildRegions(destinationLocation, selectedFeatures);
  const places = selectedFeatures.map((feature, index) => placeFromPoiFeature(feature, regionForFeature(feature, regions, center), destinationName, index, center));
  const existingPlaceNames = new Set(places.map((place) => place.name.toLowerCase()));
  const namedFoodPlaces = foodFeatures
    .filter((feature) => !existingPlaceNames.has(poiName(feature).toLowerCase()))
    .slice(0, 12)
    .map((feature, index) => placeFromPoiFeature(feature, regionForFeature(feature, regions, center), destinationName, places.length + index, center));
  places.push(...namedFoodPlaces);
  const foodAreas = buildFoodAreas(foodFeatures, regions, destinationName);
  const scenicRoutes = buildScenicRoutes(regions);
  return {
    id: `ors-${slug(destinationName)}`,
    canonicalName: destinationName,
    aliases: [destinationName.toLowerCase(), String(destination || "").toLowerCase()].filter(Boolean),
    country: destinationLocation.country || "",
    state: destinationLocation.stateOrProvince || "",
    timezone: "",
    currency: "USD",
    summary: `${destinationName} profile generated from live geocoding and point-of-interest data.`,
    seasonalNotes: ["Check current weather, closures, opening hours, and operating conditions before travel."],
    generalAdvisories: [
      "Attractions, restaurants, accessibility, prices, and opening hours should be verified directly before travel.",
      "Estimated travel time; traffic and conditions may vary."
    ],
    planningRules: {
      defaultHotelRegion: regions[0].id,
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions,
    places,
    foodAreas,
    scenicRoutes,
    sourceMetadata: {
      provider: "openrouteservice",
      retrievedAt: new Date().toISOString(),
      freshness: poiFeatures.length >= 8 ? "live-provider" : "live-provider-with-starter-fallback",
      candidateCount: places.length,
      liveCandidateCount: poiFeatures.length,
      fallbackCandidateCount: Math.max(0, places.length - poiFeatures.length),
      sourceUrl: ORS_SOURCE_URL
    }
  };
}

export async function openRouteServiceRouteEstimate(origin, destination, mode = "driving", config) {
  const originCoordinates = await resolveRouteCoordinates(origin, config);
  const destinationCoordinates = await resolveRouteCoordinates(destination, config);
  if (!originCoordinates || !destinationCoordinates) {
    throw providerError("ROUTE_POINTS_REQUIRED", "Origin and destination coordinates are required.", false);
  }
  const profile = routeProfile(mode);
  const json = await orsRequest(`/v2/directions/${profile}/json`, {
    config,
    method: "POST",
    body: {
      coordinates: [originCoordinates, destinationCoordinates],
      instructions: false
    }
  });
  const summary = json?.routes?.[0]?.summary;
  if (!summary) throw providerError("ROUTE_ESTIMATE_FAILED", "Route provider did not return a route summary.", true);
  return {
    durationMinutes: Math.max(1, Math.round(Number(summary.duration || 0) / 60)),
    distanceMiles: Math.max(0.1, Math.round(Number(summary.distance || 0) / 1609.344 * 10) / 10),
    mode,
    profile,
    provider: "openrouteservice",
    retrievedAt: new Date().toISOString(),
    trafficAware: false,
    fromCoordinates: { lat: originCoordinates[1], lng: originCoordinates[0] },
    toCoordinates: { lat: destinationCoordinates[1], lng: destinationCoordinates[0] },
    disclaimer: "Estimated travel time; traffic and conditions may vary."
  };
}

async function resolveDestination(destination, config) {
  const json = await orsRequest(`/geocode/search?${new URLSearchParams({ text: String(destination || ""), size: "1" })}`, { config });
  return normalizeLocationFeature(geocodeFeatures(json)[0], destination);
}

async function openRouteServicePoiSearch(center, categoryGroupIds, config, bufferMeters = 15000) {
  const response = await orsRequest("/pois", {
    config,
    method: "POST",
    body: {
      request: "pois",
      geometry: {
        geojson: { type: "Point", coordinates: center },
        buffer: bufferMeters
      },
      filters: { category_group_ids: categoryGroupIds },
      limit: 80,
      sortby: "distance"
    }
  });
  return geojsonFeatures(response);
}

async function openRouteServicePoiCandidates(center, categoryGroupIds, config, destinationName, type) {
  const localBuffer = type === "food" ? 14000 : 18000;
  const nearbyBuffer = type === "food" ? 22000 : 85000;
  const candidates = [];
  try {
    const [localFeatures, nearbyFeatures] = await Promise.all([
      openRouteServicePoiSearch(center, categoryGroupIds, config, localBuffer),
      openRouteServicePoiSearch(center, categoryGroupIds, config, nearbyBuffer)
    ]);
    candidates.push(...tagProviderScope(localFeatures, "core"));
    candidates.push(...tagProviderScope(nearbyFeatures, "nearby"));
  } catch (error) {
    if (error?.code === "OPENROUTESERVICE_RATE_LIMITED" || error?.code === "OPENROUTESERVICE_AUTH_FAILED") throw error;
  }
  const fallback = await geocodePoiFallback(center, config, destinationName, type).catch((error) => {
    if (error?.code === "OPENROUTESERVICE_RATE_LIMITED" || error?.code === "OPENROUTESERVICE_AUTH_FAILED") throw error;
    return [];
  });
  candidates.push(...fallback);
  return dedupePoiFeatures(candidates);
}

async function geocodePoiFallback(center, config, destinationName, type) {
  const queries = type === "food"
    ? ["restaurants", "cafes", "breakfast", "dinner", "food halls", "local food"]
    : ["top attractions", "museums", "parks", "landmarks", "historic sites", "viewpoints", "galleries", "gardens", "markets", "theaters", "nearby day trips", "nature preserve", "scenic area"];
  const responses = await Promise.all(queries.map(async (query) => {
    const params = new URLSearchParams({
      text: `${query} in ${destinationName}`,
      size: "6",
      "focus.point.lon": String(center[0]),
      "focus.point.lat": String(center[1]),
      "boundary.circle.lon": String(center[0]),
      "boundary.circle.lat": String(center[1]),
      "boundary.circle.radius": "35"
    });
    const json = await orsRequest(`/geocode/search?${params}`, { config });
    return geocodeFeatures(json).map((feature) => tagGeocodePoiFeature(feature, query));
  }));
  return responses.flat();
}

function tagProviderScope(features, scope) {
  return features.map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      routeMosaicScope: scope
    }
  }));
}

function tagGeocodePoiFeature(feature, query) {
  return {
    ...feature,
    properties: {
      ...(feature.properties || {}),
      category_group: query,
      category: query,
      name: feature.properties?.name || feature.properties?.label || query
    }
  };
}

async function orsRequest(path, { config, method = "GET", body = null } = {}) {
  const apiKey = orsApiKey(config);
  if (!apiKey) throw providerError("OPENROUTESERVICE_API_KEY_REQUIRED", "openrouteservice API key is required.", false);
  const url = path.startsWith("http") ? new URL(path) : new URL(`${ORS_BASE_URL}${path}`);
  if (method === "GET") url.searchParams.set("api_key", apiKey);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, Number(config?.googleRequestTimeoutMs || config?.timeoutMs || 10000)));
  let response;
  let json;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: apiKey,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    json = await response.json().catch(() => ({}));
  } catch (error) {
    if (error?.name === "AbortError") throw providerError("GOOGLE_TIMEOUT", "Map provider request timed out.", true, 408);
    if (error?.code === "REQUEST_TIMEOUT" || error?.status === 408 || String(error?.message || "").toLowerCase().includes("timed out")) throw providerError("GOOGLE_TIMEOUT", "Map provider request timed out.", true, 408);
    throw providerError("OPENROUTESERVICE_UNAVAILABLE", "openrouteservice request failed.", true, 503);
  } finally {
    clearTimeout(timeoutId);
  }
  if (response.ok) return json;
  if (response.status === 429) throw providerError("OPENROUTESERVICE_RATE_LIMITED", "openrouteservice rate limit reached.", true, response.status);
  if (response.status === 401 || response.status === 403) throw providerError("OPENROUTESERVICE_AUTH_FAILED", "openrouteservice authorization failed.", false, response.status);
  const code = response.status >= 500 ? "OPENROUTESERVICE_UNAVAILABLE" : "OPENROUTESERVICE_REQUEST_FAILED";
  throw providerError(code, publicOrsMessage(json) || "openrouteservice request failed.", response.status >= 500, response.status);
}

function orsApiKey(config) {
  return config?.openRouteServiceApiKey || config?.placeApiKey || config?.routeApiKey || "";
}

function geocodeFeatures(json) {
  return Array.isArray(json?.features) ? json.features : [];
}

function geojsonFeatures(json) {
  return Array.isArray(json?.features) ? json.features : [];
}

function normalizeLocationFeature(feature, originalInput = "") {
  if (!feature?.geometry?.coordinates || feature.geometry.coordinates.length < 2) return null;
  const props = feature.properties || {};
  const [longitude, latitude] = feature.geometry.coordinates;
  const city = props.locality || props.localadmin || props.name || "";
  const stateOrProvince = props.region || props.macroregion || "";
  const country = props.country || "";
  const canonicalName = compactName([city || props.name || props.label, stateOrProvince, country]) || props.label || String(originalInput || "");
  return {
    id: props.id || feature.id || `ors-${slug(canonicalName)}`,
    originalInput,
    canonicalName,
    displayName: canonicalName,
    normalizedName: canonicalName,
    city,
    stateOrProvince,
    stateOrRegion: stateOrProvince,
    country,
    countryCode: String(props.country_a || "").toUpperCase(),
    latitude: Number(latitude),
    longitude: Number(longitude),
    coordinates: { lat: Number(latitude), lng: Number(longitude) },
    locationType: locationTypeFrom(props),
    aliases: [props.label, props.name].filter(Boolean),
    providerPlaceId: String(props.id || feature.id || `ors-${slug(canonicalName)}`),
    boundingRegion: null,
    timezone: "",
    provider: "openrouteservice",
    confidence: "provider",
    verificationStatus: "Verified",
    verifiedAt: new Date().toISOString()
  };
}

function locationFromTrip(trip) {
  const location = trip?.destinationLocation;
  if (!location?.latitude || !location?.longitude) return null;
  return {
    canonicalName: location.normalizedName || location.canonicalName || location.displayName || trip.destinationDisplay || trip.destination,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    country: location.country || "",
    stateOrProvince: location.stateOrProvince || location.stateOrRegion || ""
  };
}

function buildRegions(destinationLocation, poiFeatures) {
  const centerCoordinates = [destinationLocation.longitude, destinationLocation.latitude];
  const center = {
    id: "downtown-core",
    name: "Downtown and nearby core",
    summary: `Central planning area around ${destinationLocation.canonicalName}.`,
    centerCoordinates: { lat: destinationLocation.latitude, lng: destinationLocation.longitude },
    tags: ["central", "orientation"],
    neighboringRegionIds: ["arts-landmarks", "dining-evenings"],
    typicalTravelMinutesToRegions: {}
  };
  const culture = regionFromFeature("arts-landmarks", "Museums and landmark district", poiFeatures.find((feature) => ["culture", "museum", "history", "landmark", "entertainment"].includes(poiCategory(feature))) || poiFeatures[0], ["culture", "landmark"], ["downtown-core", "dining-evenings"]);
  const nature = regionFromFeature("parks-outdoors", "Parks, gardens, and outdoor routes", poiFeatures.find((feature) => poiCategory(feature) === "nature") || poiFeatures[1] || poiFeatures[0], ["nature", "viewpoint"], ["downtown-core", "arts-landmarks"]);
  const food = regionFromFeature("dining-evenings", "Restaurant and evening neighborhoods", poiFeatures.find((feature) => poiCategory(feature) === "food") || poiFeatures[2] || poiFeatures[0], ["food", "evening"], ["downtown-core", "arts-landmarks"]);
  const nearby = regionFromFeature("nearby-excursions", "Nearby regional options", poiFeatures.find((feature) => featureDistanceMiles(centerCoordinates, feature) >= 18) || poiFeatures.find((feature) => poiCategory(feature) === "nature") || poiFeatures[3] || poiFeatures[0], ["nearby", "day-trip", "scenic"], ["downtown-core", "parks-outdoors"]);
  return [center, culture, nature, food, nearby];
}

function regionFromFeature(id, name, feature, tags, neighboringRegionIds) {
  const coordinates = feature?.geometry?.coordinates || [0, 0];
  return {
    id,
    name,
    summary: `${name} grouped from nearby travel options. Verify exact hours, access, and travel time before finalizing.`,
    centerCoordinates: { lat: Number(coordinates[1] || 0), lng: Number(coordinates[0] || 0) },
    tags,
    neighboringRegionIds,
    typicalTravelMinutesToRegions: {}
  };
}

function placeFromPoiFeature(feature, region, destinationName, index, center) {
  const props = feature.properties || {};
  const name = poiName(feature);
  const category = poiCategory(feature);
  const distanceMiles = featureDistanceMiles(center, feature);
  const isNearby = region.id === "nearby-excursions" || distanceMiles >= 18;
  const isStarter = Boolean(props.routeMosaicStarter);
  const duration = isNearby ? Math.max(150, durationFor(category, feature, index)) : durationFor(category, feature, index);
  const cost = costFor(category, feature, index);
  return {
    id: String(props.osm_id || feature.id || `ors-place-${index}`).replace(/[^a-zA-Z0-9_-]/g, "-"),
    name,
    regionId: region.id,
    shortDescription: isStarter
      ? `${name} is a starter planning anchor for ${destinationName} because live place data was thin. Verify and replace it with a specific local stop before travel.`
      : isNearby
      ? `${name} is a nearby option for ${destinationName}, best treated as a half-day or day-trip idea after verifying hours, access, and travel time.`
      : `${name} is a ${titleCase(category)} option for ${destinationName}. Confirm hours, access, and availability before travel.`,
    categories: [category, isStarter ? "starter-anchor" : "", isNearby ? "nearby-excursion" : "", props.category_group || props.category || "point-of-interest"].filter(Boolean),
    tags: [titleCase(category), isStarter ? "Starter planning anchor" : isNearby ? "Nearby option" : "Locally relevant option", "Verify before travel"],
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: 45,
    maximumDurationMinutes: isNearby ? 300 : 180,
    estimatedCostLow: cost.low,
    estimatedCostHigh: cost.high,
    indoorOutdoor: indoorOutdoorFor(category),
    weatherDependency: category === "nature" ? "high" : category === "museum" ? "low" : "medium",
    accessibility: "moderate",
    dietaryRelevance: category === "food" ? ["confirm dietary needs directly"] : [],
    openingTimeGuidance: "Confirm current opening hours before travel.",
    bestTimeOfDay: isNearby ? "morning" : category === "food" ? "lunch" : index % 3 === 0 ? "morning" : index % 3 === 1 ? "afternoon" : "evening",
    reservationRecommended: category === "food" || category === "museum",
    seasonalNotes: [],
    conflictTags: [],
    priorityScore: Math.max(50, 94 - index * 2),
    coordinates: coordinatesObject(feature.geometry.coordinates),
    backupForTags: category === "museum" ? ["weather", "rain", "heat"] : [],
    sourceMetadata: {
      provider: "openrouteservice",
      providerPlaceId: String(props.osm_id || feature.id || `ors-place-${index}`),
      retrievedName: name,
      retrievedAt: new Date().toISOString(),
      sourceUrl: ORS_SOURCE_URL,
      dataConfidence: isStarter ? "low" : "provider",
      dataFreshness: isStarter ? "starter-fallback" : "live-provider"
    }
  };
}

function regionForFeature(feature, regions, center) {
  const category = poiCategory(feature);
  const distanceMiles = featureDistanceMiles(center, feature);
  if (distanceMiles >= 18) return regions.find((region) => region.id === "nearby-excursions") || regions[0];
  if (category === "food") return regions.find((region) => region.id === "dining-evenings") || regions[0];
  if (category === "nature") return regions.find((region) => region.id === "parks-outdoors") || regions[0];
  if (["museum", "history", "landmark", "entertainment"].includes(category)) return regions.find((region) => region.id === "arts-landmarks") || regions[0];
  return regions.find((region) => region.id === "downtown-core") || regions[0];
}

function buildFoodAreas(foodFeatures, regions, destinationName) {
  const candidates = foodFeatures.length ? foodFeatures.slice(0, 4) : [];
  const areas = candidates.map((feature, index) => {
    const region = regions[index % regions.length];
    return {
      id: `ors-food-${index}`,
      name: poiName(feature),
      regionId: region.id,
      cuisines: ["Local cuisine", "Casual dining", "Cafes", "Vegetarian-friendly"],
      mealTypes: ["breakfast", "lunch", "dinner"],
      budgetLevels: ["budget", "moderate"],
      dietarySupport: ["Vegetarian", "Gluten-free"],
      eveningSuitability: ["quiet"],
      shortDescription: `${poiName(feature)} is a food option for ${destinationName}; confirm menus, hours, and restrictions directly.`
    };
  });
  while (areas.length < 3) {
    const region = regions[areas.length % regions.length];
    areas.push({
      id: `ors-food-area-${areas.length}`,
      name: `${region.name} restaurants`,
      regionId: region.id,
      cuisines: ["Local cuisine", "Casual dining", "Cafes"],
      mealTypes: ["breakfast", "lunch", "dinner"],
      budgetLevels: ["budget", "moderate"],
      dietarySupport: ["Vegetarian"],
      eveningSuitability: ["quiet"],
      shortDescription: `Dining options around ${region.name}; confirm specific restaurant details directly.`
    });
  }
  return areas.slice(0, 6);
}

function buildScenicRoutes(regions) {
  return regions.slice(0, -1).map((region, index) => ({
    id: `${region.id}-${regions[index + 1].id}`,
    name: `${region.name} to ${regions[index + 1].name}`,
    originRegionId: region.id,
    destinationRegionId: regions[index + 1].id,
    estimatedDriveMinutes: estimatedRegionDriveMinutes(region, regions[index + 1]),
    estimatedDistanceMiles: estimatedRegionDistanceMiles(region, regions[index + 1]),
    tags: ["provider-estimate", "route"],
    bestTimeOfDay: "afternoon",
    notes: "Estimated travel time; traffic and conditions may vary."
  }));
}

function estimatedRegionDistanceMiles(origin, destination) {
  return Math.max(1, Math.round(haversineMiles(
    origin.centerCoordinates?.lat,
    origin.centerCoordinates?.lng,
    destination.centerCoordinates?.lat,
    destination.centerCoordinates?.lng
  )));
}

function estimatedRegionDriveMinutes(origin, destination) {
  const miles = estimatedRegionDistanceMiles(origin, destination);
  return Math.max(10, Math.round(miles / (miles > 18 ? 0.65 : 0.45)) + (miles > 18 ? 18 : 8));
}

function selectDiversePoiFeatures(features, center, limit) {
  const selected = [];
  const categoryCounts = new Map();
  const nearby = [];
  const core = [];
  features.forEach((feature) => {
    if (featureDistanceMiles(center, feature) >= 18) nearby.push(feature);
    else core.push(feature);
  });
  [...core, ...nearby].forEach((feature) => {
    if (selected.length >= limit) return;
    const category = poiCategory(feature);
    const count = categoryCounts.get(category) || 0;
    if (count >= 8 && selected.length < 16) return;
    selected.push(feature);
    categoryCounts.set(category, count + 1);
  });
  const nearbySelected = selected.filter((feature) => featureDistanceMiles(center, feature) >= 18).length;
  if (nearbySelected < 4) {
    nearby.slice(0, 4 - nearbySelected).forEach((feature) => {
      if (!selected.includes(feature) && selected.length < limit) selected.push(feature);
    });
  }
  return selected.slice(0, limit);
}

function starterPoiFeatures(destinationLocation, destinationName, center, count) {
  const city = String(destinationLocation.city || destinationName.split(",")[0] || destinationName).trim();
  const starters = [
    ["signature-sights", `${city} signature sights and downtown orientation`, "landmark", 0.01],
    ["central-culture", `${city} central culture and architecture area`, "museum", 0.015],
    ["local-market", `${city} local market or food hall area`, "food", 0.02],
    ["parks-viewpoints", `${city} parks, gardens, or viewpoint area`, "park", 0.025],
    ["creative-district", `${city} creative neighborhood and local shops`, "gallery", -0.015],
    ["evening-district", `${city} dinner and evening district`, "restaurant", -0.02],
    ["nearby-scenic", `Nearby scenic outing from ${city}`, "nature preserve", 0.32],
    ["nearby-day-trip", `Nearby day-trip area from ${city}`, "landmark", -0.34],
    ["indoor-backup", `${city} museum or indoor backup option`, "museum", 0.03],
    ["relaxed-walk", `${city} easy walk or waterfront-style area`, "park", -0.03]
  ];
  return starters.slice(0, Math.max(0, count)).map(([id, name, category, offset], index) => ({
    type: "Feature",
    id: `starter-${slug(destinationName)}-${id}`,
    geometry: {
      type: "Point",
      coordinates: [Number(center[0]) + Number(offset), Number(center[1]) + Number(offset) / 2]
    },
    properties: {
      osm_id: `starter-${slug(destinationName)}-${id}`,
      name,
      category,
      category_group: category,
      layer: "venue",
      routeMosaicScope: Math.abs(Number(offset)) > 0.2 ? "nearby" : "starter",
      routeMosaicStarter: true,
      osm_tags: { name, tourism: category }
    }
  }));
}

function dedupePoiFeatures(features) {
  const seen = new Set();
  return features.filter((feature) => {
    const key = `${poiName(feature).toLowerCase()}|${(feature.geometry?.coordinates || []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasPoiName(feature) {
  return Boolean(poiName(feature));
}

function isTravelWorthyPoi(feature) {
  if (!hasPoiName(feature) || !feature?.geometry?.coordinates) return false;
  const name = poiName(feature).toLowerCase();
  const props = feature.properties || {};
  const layer = String(props.layer || "").toLowerCase();
  const text = poiSearchText(feature);
  if (isRawProviderPlaceName(name)) return false;
  if (["locality", "localadmin", "county", "region", "country", "address", "street"].includes(layer)) return false;
  if (/\b(town of|city of|county of|municipality|township|borough|village of)\b/.test(name)) return false;
  if (/\b(hotel|motel|inn|suites|lodging|apartment|apartments|condo|realty|realtor|insurance|bank|atm|pharmacy|clinic|hospital|dentist|doctor|law office|attorney|auto|tires|gas station|fuel|parking|garage|warehouse|storage|school|academy|elementary|middle school|high school|church|cemetery|funeral|police|fire station|post office|courthouse)\b/.test(name)) return false;
  if (/\b(accommodation|hotel|motel|office|finance|insurance|healthcare|medical|education|school|residential|parking|fuel|automotive|government|administrative|religion|cemetery)\b/.test(text)) return false;
  return poiTravelScore(feature) >= 24;
}

function isFoodWorthyPoi(feature) {
  if (!hasPoiName(feature) || !feature?.geometry?.coordinates) return false;
  const name = poiName(feature).toLowerCase();
  const text = poiSearchText(feature);
  if (isRawProviderPlaceName(name)) return false;
  if (/\b(hotel|motel|inn|school|insurance|bank|office|pharmacy|gas station|parking)\b/.test(name)) return false;
  return /\b(restaurant|cafe|coffee|bakery|bar|brewery|food|market|dining|sustenance)\b/.test(text) || poiCategory(feature) === "food";
}

function poiTravelScore(feature, destinationName = "") {
  const name = poiName(feature).toLowerCase();
  const text = poiSearchText(feature);
  const scope = String(feature?.properties?.routeMosaicScope || "");
  const isStarter = Boolean(feature?.properties?.routeMosaicStarter);
  let score = 0;
  if (isStarter) score += 45;
  if (/\b(museum|gallery|science center|hall of fame|aquarium|botanical|garden|park|greenway|trail|theater|theatre|performing arts|historic|monument|memorial|landmark|viewpoint|overlook|waterfront|riverwalk|market|food hall|arts district|visitor center|zoo|amusement|theme park|stadium|arena)\b/.test(text)) score += 60;
  if (/\b(national|state park|nature preserve|conservatory|arboretum|heritage|cultural|public art|scenic)\b/.test(text)) score += 20;
  if (/\b(restaurant|cafe|bakery|brewery|market|food hall)\b/.test(text)) score += 12;
  if (scope === "nearby") score += 4;
  if (destinationName && name.includes(String(destinationName).toLowerCase().split(",")[0].trim())) score += 6;
  if (name.length >= 4) score += 8;
  if (/\b(church|cemetery|parking|school|office|hotel|insurance|bank|pharmacy|gas)\b/.test(text)) score -= 50;
  return score;
}

function poiSearchText(feature) {
  const props = feature?.properties || {};
  return `${props.name || ""} ${props.label || ""} ${props.category_group || ""} ${props.category || ""} ${props.layer || ""} ${JSON.stringify(props.osm_tags || {})}`.toLowerCase();
}

function poiName(feature) {
  const props = feature?.properties || {};
  return String(props.name || props.osm_tags?.name || props.label || "").trim();
}

function poiCategory(feature) {
  const props = feature?.properties || {};
  const text = `${props.category_group || ""} ${props.category || ""} ${JSON.stringify(props.osm_tags || {})}`.toLowerCase();
  if (/restaurant|cafe|bar|pub|food|sustenance/.test(text)) return "food";
  if (/museum|gallery|art|arts|culture/.test(text)) return "museum";
  if (/park|natural|viewpoint|garden|peak|beach|lake|water|trail|forest|preserve/.test(text)) return "nature";
  if (/theater|theatre|music|cinema|concert|arena|stadium|amusement|theme/.test(text)) return "entertainment";
  if (/historic|monument|memorial|castle|ruins/.test(text)) return "history";
  if (/tourism|attraction|landmark|information|viewpoint/.test(text)) return "landmark";
  return "culture";
}

function coordinatesObject(coordinates) {
  return { lat: Number(coordinates?.[1] || 0), lng: Number(coordinates?.[0] || 0) };
}

function featureDistanceMiles(center, feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(center) || !coordinates || coordinates.length < 2) return 0;
  return haversineMiles(Number(center[1]), Number(center[0]), Number(coordinates[1]), Number(coordinates[0]));
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

function coordinatesFrom(value) {
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]), Number(value[1])];
  if (value?.coordinates?.lng !== undefined && value?.coordinates?.lat !== undefined) return [Number(value.coordinates.lng), Number(value.coordinates.lat)];
  if (value?.longitude !== undefined && value?.latitude !== undefined) return [Number(value.longitude), Number(value.latitude)];
  if (value?.lng !== undefined && value?.lat !== undefined) return [Number(value.lng), Number(value.lat)];
  return null;
}

async function resolveRouteCoordinates(value, config) {
  const coordinates = coordinatesFrom(value);
  if (coordinates) return coordinates;
  const location = await resolveDestination(String(value || ""), config);
  if (!location) return null;
  return [location.longitude, location.latitude];
}

function routeProfile(mode) {
  const text = String(mode || "").toLowerCase();
  if (/walk|foot|pedestrian/.test(text)) return "foot-walking";
  return "driving-car";
}

function locationTypeFrom(props) {
  const layer = String(props.layer || "").toLowerCase();
  if (layer === "venue") return "Place";
  if (["locality", "localadmin", "county"].includes(layer)) return "City";
  if (layer === "region") return "State";
  if (layer === "country") return "Country";
  return titleCase(layer || "Place");
}

function publicOrsMessage(json) {
  return String(json?.error?.message || json?.message || "").replace(/api[_ -]?key/ig, "credentials").slice(0, 180);
}

function providerError(code, message, retryable = false, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.status = status;
  return error;
}

function compactName(parts) {
  return parts.filter(Boolean).filter((part, index, arr) => arr.indexOf(part) === index).join(", ");
}

function titleCase(value) {
  return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function durationFor(category, feature = {}, index = 0) {
  const text = poiSearchText(feature);
  const bump = (stableNumber(feature?.properties?.osm_id || feature?.id || poiName(feature) || index) % 3) * 15;
  if (/garden|botanical|estate|aquarium|zoo|national park|state park/.test(text)) return 135 + bump;
  if (category === "museum") return 105 + bump;
  if (category === "nature") return 90 + bump;
  if (category === "food") return 60 + bump;
  if (category === "entertainment") return 120 + bump;
  return 75 + bump;
}

function costFor(category, feature = {}, index = 0) {
  const text = poiSearchText(feature);
  const bump = (stableNumber(feature?.properties?.osm_id || feature?.id || poiName(feature) || index) % 3) * 5;
  if (/beach|park|riverwalk|trail|memorial|monument|viewpoint/.test(text) || category === "nature") return { low: 0, high: 10 + bump };
  if (/garden|estate|aquarium|zoo/.test(text)) return { low: 15, high: 35 + bump };
  if (category === "museum" || category === "history") return { low: 10, high: 25 + bump };
  if (category === "entertainment") return { low: 20, high: 55 + bump };
  if (category === "food") return { low: 12, high: 35 + bump };
  return { low: 0, high: 20 + bump };
}

function isRawProviderPlaceName(value) {
  return /^(access\s*\d*|entrance\s*\d*|parking\s*\d*|trailhead\s*\d*|gate\s*\d*|pier access|beach access|map point|unnamed road)$/i.test(String(value || "").trim());
}

function stableNumber(value) {
  return String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function indoorOutdoorFor(category) {
  if (category === "museum" || category === "food") return "indoor";
  if (category === "nature") return "outdoor";
  return "mixed";
}

function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "item";
}
