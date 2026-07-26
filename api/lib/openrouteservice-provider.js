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
  if (poiFeatures.length < 8) {
    throw providerError("DESTINATION_RESEARCH_INSUFFICIENT", "Not enough destination candidates were returned.", false);
  }
  const selectedFeatures = poiFeatures.slice(0, 30);
  const regions = buildRegions(destinationLocation, selectedFeatures);
  const places = selectedFeatures.map((feature, index) => placeFromPoiFeature(feature, regions[index % regions.length], destinationName, index));
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
    summary: `${destinationName} profile generated from openrouteservice geocoding and point-of-interest data.`,
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
      freshness: "live-provider",
      candidateCount: places.length,
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

async function openRouteServicePoiSearch(center, categoryGroupIds, config) {
  const response = await orsRequest("/pois", {
    config,
    method: "POST",
    body: {
      request: "pois",
      geometry: {
        geojson: { type: "Point", coordinates: center },
        buffer: 12000
      },
      filters: { category_group_ids: categoryGroupIds },
      limit: 80,
      sortby: "distance"
    }
  });
  return geojsonFeatures(response);
}

async function openRouteServicePoiCandidates(center, categoryGroupIds, config, destinationName, type) {
  try {
    const features = await openRouteServicePoiSearch(center, categoryGroupIds, config);
    if (features.length) return features;
  } catch (error) {
    if (error?.code === "OPENROUTESERVICE_RATE_LIMITED" || error?.code === "OPENROUTESERVICE_AUTH_FAILED") throw error;
  }
  return geocodePoiFallback(center, config, destinationName, type);
}

async function geocodePoiFallback(center, config, destinationName, type) {
  const queries = type === "food"
    ? ["restaurants", "cafes", "breakfast", "dinner", "local food"]
    : ["museums", "parks", "landmarks", "historic sites", "viewpoints", "galleries", "attractions", "gardens", "markets", "theaters"];
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
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: apiKey,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
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
  const center = {
    id: "central-area",
    name: "Central area",
    summary: `Central planning area around ${destinationLocation.canonicalName}.`,
    centerCoordinates: { lat: destinationLocation.latitude, lng: destinationLocation.longitude },
    tags: ["central", "orientation"],
    neighboringRegionIds: ["culture-area", "food-area"],
    typicalTravelMinutesToRegions: {}
  };
  const culture = regionFromFeature("culture-area", "Culture and landmarks", poiFeatures.find((feature) => poiCategory(feature).includes("culture")) || poiFeatures[0], ["culture", "landmark"], ["central-area", "food-area"]);
  const nature = regionFromFeature("nature-area", "Parks and viewpoints", poiFeatures.find((feature) => poiCategory(feature).includes("nature")) || poiFeatures[1] || poiFeatures[0], ["nature", "viewpoint"], ["central-area", "culture-area"]);
  const food = regionFromFeature("food-area", "Food and evening area", poiFeatures.find((feature) => poiCategory(feature).includes("food")) || poiFeatures[2] || poiFeatures[0], ["food", "evening"], ["central-area", "culture-area"]);
  return [center, culture, nature, food];
}

function regionFromFeature(id, name, feature, tags, neighboringRegionIds) {
  const coordinates = feature?.geometry?.coordinates || [0, 0];
  return {
    id,
    name,
    summary: `${name} grouped from openrouteservice point-of-interest candidates.`,
    centerCoordinates: { lat: Number(coordinates[1] || 0), lng: Number(coordinates[0] || 0) },
    tags,
    neighboringRegionIds,
    typicalTravelMinutesToRegions: {}
  };
}

function placeFromPoiFeature(feature, region, destinationName, index) {
  const props = feature.properties || {};
  const name = poiName(feature);
  const category = poiCategory(feature);
  return {
    id: String(props.osm_id || feature.id || `ors-place-${index}`).replace(/[^a-zA-Z0-9_-]/g, "-"),
    name,
    regionId: region.id,
    shortDescription: `${name} is an openrouteservice point-of-interest candidate for ${destinationName}. Confirm hours, access, and availability before travel.`,
    categories: [category, props.category_group || props.category || "point-of-interest"].filter(Boolean),
    tags: [titleCase(category), "Provider retrieved", "Local candidate"],
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: durationFor(category),
    minimumDurationMinutes: 45,
    maximumDurationMinutes: 180,
    estimatedCostLow: category === "nature" ? 0 : 10,
    estimatedCostHigh: category === "food" ? 40 : 35,
    indoorOutdoor: indoorOutdoorFor(category),
    weatherDependency: category === "nature" ? "high" : category === "museum" ? "low" : "medium",
    accessibility: "moderate",
    dietaryRelevance: category === "food" ? ["confirm dietary needs directly"] : [],
    openingTimeGuidance: "Confirm current opening hours before travel.",
    bestTimeOfDay: category === "food" ? "lunch" : index % 3 === 0 ? "morning" : index % 3 === 1 ? "afternoon" : "evening",
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
      dataConfidence: "provider",
      dataFreshness: "live-provider"
    }
  };
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
      shortDescription: `${poiName(feature)} is a provider-retrieved food candidate for ${destinationName}; confirm menus and restrictions directly.`
    };
  });
  while (areas.length < 3) {
    const region = regions[areas.length % regions.length];
    areas.push({
      id: `ors-food-area-${areas.length}`,
      name: `${region.name} dining area`,
      regionId: region.id,
      cuisines: ["Local cuisine", "Casual dining", "Cafes"],
      mealTypes: ["breakfast", "lunch", "dinner"],
      budgetLevels: ["budget", "moderate"],
      dietarySupport: ["Vegetarian"],
      eveningSuitability: ["quiet"],
      shortDescription: `Provider POIs around ${region.name}; confirm specific restaurant details directly.`
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
    estimatedDriveMinutes: 15 + index * 8,
    estimatedDistanceMiles: 4 + index * 3,
    tags: ["provider-estimate", "route"],
    bestTimeOfDay: "afternoon",
    notes: "Estimated travel time; traffic and conditions may vary."
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
  if (["locality", "localadmin", "county", "region", "country", "address", "street"].includes(layer)) return false;
  if (/\b(town of|city of|county of|municipality|township|borough|village of)\b/.test(name)) return false;
  if (/\b(hotel|motel|inn|suites|lodging|apartment|apartments|condo|realty|realtor|insurance|bank|atm|pharmacy|clinic|hospital|dentist|doctor|law office|attorney|auto|tires|gas station|fuel|parking|garage|warehouse|storage|school|academy|elementary|middle school|high school|church|cemetery|funeral|police|fire station|post office|courthouse)\b/.test(name)) return false;
  if (/\b(accommodation|hotel|motel|office|finance|insurance|healthcare|medical|education|school|residential|parking|fuel|automotive|government|administrative|religion|cemetery)\b/.test(text)) return false;
  return poiTravelScore(feature) >= 35;
}

function isFoodWorthyPoi(feature) {
  if (!hasPoiName(feature) || !feature?.geometry?.coordinates) return false;
  const name = poiName(feature).toLowerCase();
  const text = poiSearchText(feature);
  if (/\b(hotel|motel|inn|school|insurance|bank|office|pharmacy|gas station|parking)\b/.test(name)) return false;
  return /\b(restaurant|cafe|coffee|bakery|bar|brewery|food|market|dining|sustenance)\b/.test(text) || poiCategory(feature) === "food";
}

function poiTravelScore(feature, destinationName = "") {
  const name = poiName(feature).toLowerCase();
  const text = poiSearchText(feature);
  let score = 0;
  if (/\b(museum|gallery|science center|hall of fame|aquarium|botanical|garden|park|greenway|trail|theater|theatre|performing arts|historic|monument|memorial|landmark|viewpoint|overlook|waterfront|riverwalk|market|food hall|arts district|visitor center|zoo|amusement|theme park|stadium|arena)\b/.test(text)) score += 60;
  if (/\b(national|state park|nature preserve|conservatory|arboretum|heritage|cultural|public art|scenic)\b/.test(text)) score += 20;
  if (/\b(restaurant|cafe|bakery|brewery|market|food hall)\b/.test(text)) score += 12;
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
  if (/park|natural|viewpoint|garden|peak|beach/.test(text)) return "nature";
  if (/historic|monument|memorial|castle|ruins/.test(text)) return "history";
  if (/tourism|attraction|hotel|information/.test(text)) return "landmark";
  return "culture";
}

function coordinatesObject(coordinates) {
  return { lat: Number(coordinates?.[1] || 0), lng: Number(coordinates?.[0] || 0) };
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

function durationFor(category) {
  if (category === "museum") return 130;
  if (category === "nature") return 100;
  if (category === "food") return 75;
  return 90;
}

function indoorOutdoorFor(category) {
  if (category === "museum" || category === "food") return "indoor";
  if (category === "nature") return "outdoor";
  return "mixed";
}

function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "item";
}
