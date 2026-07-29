const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";
const GOOGLE_ROUTES_BASE_URL = "https://routes.googleapis.com";
const GOOGLE_SOURCE_URL = "https://developers.google.com/maps";
const TOURISM_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "national_park",
  "historical_landmark",
  "cultural_landmark",
  "performing_arts_theater",
  "amusement_park",
  "aquarium",
  "zoo",
  "botanical_garden",
  "hiking_area",
  "marina",
  "market",
  "shopping_mall",
  "restaurant",
  "cafe",
  "bar"
]);
const REJECTED_TYPES = new Set([
  "lodging",
  "school",
  "university",
  "insurance_agency",
  "bank",
  "doctor",
  "dentist",
  "hospital",
  "pharmacy",
  "real_estate_agency",
  "local_government_office",
  "car_dealer",
  "gas_station",
  "parking"
]);

export async function googleLocationSearch(query, config) {
  const input = String(query || "").trim();
  const json = await googlePlacesRequest("/places:autocomplete", {
    config,
    operation: "places-autocomplete",
    fieldMask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
    body: {
      input,
      includedPrimaryTypes: ["locality", "administrative_area_level_1", "country", "tourist_attraction", "national_park"],
      languageCode: "en"
    }
  });
  const suggestions = Array.isArray(json?.suggestions) ? json.suggestions : [];
  const locations = [];
  for (const suggestion of suggestions.slice(0, 6)) {
    const prediction = suggestion.placePrediction;
    if (!prediction?.placeId) continue;
    const details = await googlePlaceDetails(prediction.placeId, config).catch(() => null);
    const location = normalizeGoogleLocation(details, input, prediction);
    if (location) locations.push(location);
  }
  if (!locations.length) {
    const fallback = await googleTextSearch(`${input}`, config, "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types", 5);
    locations.push(...fallback.map((place) => normalizeGoogleLocation(place, input)).filter(Boolean));
  }
  return dedupeBy(locations, (item) => item.providerPlaceId).slice(0, 8);
}

export async function googleDestinationResearch(destination, trip = {}, config) {
  const destinationLocation = locationFromTrip(trip) || (await resolveDestination(destination, config));
  if (!destinationLocation) throw googleProviderError("DESTINATION_RESEARCH_FAILED", "Destination could not be resolved.", false, 502);
  const destinationName = destinationLocation.canonicalName || String(destination || "").trim();
  const [attractions, nearby, restaurants] = await Promise.all([
    googleTextSearch(`best tourist attractions and museums in ${destinationName}`, config, placeFieldMask(), 20),
    googleNearbySearch(destinationLocation, config, ["tourist_attraction", "museum", "park"], 50000, 20),
    googleTextSearch(`best restaurants cafes food halls in ${destinationName}`, config, placeFieldMask(), 10)
  ]);
  const tourismCandidates = dedupeBy([...attractions, ...nearby], (place) => place.id)
    .filter(isTourismPlace)
    .sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a));
  const foodCandidates = dedupeBy(restaurants, (place) => place.id).filter(isFoodPlace).slice(0, 8);
  if (!tourismCandidates.length) {
    throw googleProviderError("INVALID_PROVIDER_RESPONSE", "Destination research did not find reliable tourism candidates.", true, 502);
  }
  const places = tourismCandidates.slice(0, 30);
  const regions = buildGoogleRegions(destinationLocation, places);
  return {
    id: `google-${slug(destinationName)}`,
    canonicalName: destinationName,
    aliases: [destinationName.toLowerCase(), String(destination || "").toLowerCase()].filter(Boolean),
    country: destinationLocation.country || "",
    state: destinationLocation.stateOrProvince || "",
    timezone: "",
    currency: "USD",
    summary: `${destinationName} profile generated from live destination and food research.`,
    seasonalNotes: ["Verify current hours, timed tickets, closures, crowd conditions, and weather before booking."],
    generalAdvisories: [
      "Live place data helps identify options, but hours, prices, availability, accessibility, and dietary safety still need direct verification.",
      "Nearby excursions may require route and traffic verification before final scheduling."
    ],
    planningRules: {
      defaultHotelRegion: regions[0].id,
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions,
    places: places.map((place, index) => profilePlaceFromGooglePlace(place, regionForGooglePlace(place, regions, destinationLocation), destinationName, index)),
    foodAreas: buildGoogleFoodAreas(foodCandidates, regions, destinationName),
    scenicRoutes: buildGoogleScenicRoutes(regions),
    sourceMetadata: {
      provider: "google",
      retrievedAt: new Date().toISOString(),
      freshness: "live-google-places",
      candidateCount: places.length,
      sourceUrl: GOOGLE_SOURCE_URL
    }
  };
}

export async function googleRouteEstimate(origin, destination, mode = "driving", config) {
  const originCoordinates = await resolveRouteCoordinates(origin, config);
  const destinationCoordinates = await resolveRouteCoordinates(destination, config);
  if (!originCoordinates || !destinationCoordinates) {
    throw googleProviderError("ROUTE_POINTS_REQUIRED", "Origin and destination coordinates are required.", false, 400);
  }
  const json = await googleRoutesRequest("/directions/v2:computeRoutes", {
    config,
    operation: "routes-compute",
    fieldMask: "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    body: {
      origin: { location: { latLng: { latitude: originCoordinates.lat, longitude: originCoordinates.lng } } },
      destination: { location: { latLng: { latitude: destinationCoordinates.lat, longitude: destinationCoordinates.lng } } },
      travelMode: routeTravelMode(mode),
      routingPreference: mode === "walking" ? undefined : "TRAFFIC_UNAWARE"
    }
  });
  const route = json?.routes?.[0];
  if (!route?.duration || !Number.isFinite(Number(route.distanceMeters))) {
    throw googleProviderError("INVALID_PROVIDER_RESPONSE", "Google Routes did not return duration and distance.", true, 502);
  }
  return {
    durationMinutes: Math.max(1, Math.round(durationSeconds(route.duration) / 60)),
    distanceMiles: Math.max(0.1, Math.round(Number(route.distanceMeters) / 1609.344 * 10) / 10),
    mode,
    profile: routeTravelMode(mode).toLowerCase(),
    provider: "google",
    retrievedAt: new Date().toISOString(),
    trafficAware: false,
    fromCoordinates: originCoordinates,
    toCoordinates: destinationCoordinates,
    disclaimer: "Estimated travel time; traffic and conditions may vary."
  };
}

export async function googleRouteMatrixSmokeCheck(config) {
  const json = await googleRoutesRequest("/distanceMatrix/v2:computeRouteMatrix", {
    config,
    operation: "routes-matrix",
    fieldMask: "originIndex,destinationIndex,duration,distanceMeters,status",
    body: {
      origins: [{ waypoint: { location: { latLng: { latitude: 35.2271, longitude: -80.8431 } } } }],
      destinations: [{ waypoint: { location: { latLng: { latitude: 35.7796, longitude: -78.6382 } } } }],
      travelMode: "DRIVE"
    }
  });
  const rows = Array.isArray(json) ? json : [];
  const first = rows[0];
  if (!first?.duration || !Number.isFinite(Number(first.distanceMeters))) {
    throw googleProviderError("INVALID_PROVIDER_RESPONSE", "Google Route Matrix did not return duration and distance.", true, 502);
  }
  return { durationMinutes: Math.max(1, Math.round(durationSeconds(first.duration) / 60)), distanceMiles: Math.max(0.1, Number(first.distanceMeters) / 1609.344) };
}

export async function googleProviderHealthCheck(config, { requestId = "provider-health" } = {}) {
  const result = {
    provider: "google",
    placeProviderAvailable: false,
    destinationResearchAvailable: false,
    routeProviderAvailable: false,
    routeMatrixAvailable: false,
    details: {}
  };
  result.details.places = await healthOperation(requestId, "google", "places-autocomplete", () => googleLocationSearch("Raleigh", config));
  result.placeProviderAvailable = result.details.places.success && result.details.places.resultCount > 0;
  result.details.destinationResearch = await healthOperation(requestId, "google", "destination-research", () => googleDestinationResearch("Charlotte, North Carolina, United States", {
    destinationLocation: { canonicalName: "Charlotte, North Carolina, United States", latitude: 35.2271, longitude: -80.8431, country: "United States", stateOrProvince: "North Carolina" }
  }, config));
  result.destinationResearchAvailable = result.details.destinationResearch.success && result.details.destinationResearch.resultCount > 0;
  result.details.routes = await healthOperation(requestId, "google", "routes-compute", () => googleRouteEstimate({ lat: 35.2271, lng: -80.8431 }, { lat: 35.7796, lng: -78.6382 }, "driving", config));
  result.routeProviderAvailable = result.details.routes.success;
  result.details.routeMatrix = await healthOperation(requestId, "google", "routes-matrix", () => googleRouteMatrixSmokeCheck(config));
  result.routeMatrixAvailable = result.details.routeMatrix.success;
  return result;
}

async function healthOperation(requestId, provider, operation, callback) {
  const startedAt = Date.now();
  console.info("[RouteMosaic provider-health]", JSON.stringify({ requestId, provider, operation, adapterInitialized: true, requestStarted: true }));
  try {
    const value = await callback();
    const resultCount = Array.isArray(value) ? value.length : Array.isArray(value?.places) ? value.places.length : value?.durationMinutes ? 1 : 0;
    const safe = { success: true, httpStatus: 200, errorCode: "", resultCount, durationMs: Date.now() - startedAt };
    console.info("[RouteMosaic provider-health]", JSON.stringify({ requestId, provider, operation, ...safe }));
    return safe;
  } catch (error) {
    const safe = { success: false, httpStatus: error?.status || 0, errorCode: sanitizeErrorCode(error?.code), resultCount: 0, durationMs: Date.now() - startedAt };
    console.info("[RouteMosaic provider-health]", JSON.stringify({ requestId, provider, operation, ...safe }));
    return safe;
  }
}

async function resolveDestination(destination, config) {
  const locations = await googleLocationSearch(destination, config);
  return locations[0] || null;
}

async function googlePlaceDetails(placeId, config) {
  return googlePlacesRequest(`/places/${encodeURIComponent(placeId)}`, {
    config,
    operation: "place-details",
    method: "GET",
    fieldMask: "id,displayName,formattedAddress,location,addressComponents,types,primaryType,rating,userRatingCount,editorialSummary"
  });
}

async function googleTextSearch(textQuery, config, fieldMask = placeFieldMask(), pageSize = 10) {
  const json = await googlePlacesRequest("/places:searchText", {
    config,
    operation: "places-text-search",
    fieldMask,
    body: { textQuery, languageCode: "en", pageSize }
  });
  return Array.isArray(json?.places) ? json.places : [];
}

async function googleNearbySearch(center, config, includedTypes, radiusMeters = 30000, maxResultCount = 20) {
  const json = await googlePlacesRequest("/places:searchNearby", {
    config,
    operation: "places-nearby-search",
    fieldMask: placeFieldMask(),
    body: {
      includedTypes,
      maxResultCount,
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: {
          center: { latitude: center.latitude, longitude: center.longitude },
          radius: radiusMeters
        }
      }
    }
  });
  return Array.isArray(json?.places) ? json.places : [];
}

async function googlePlacesRequest(path, { config, operation, method = "POST", fieldMask, body } = {}) {
  return googleRequest(`${GOOGLE_PLACES_BASE_URL}${path}`, { config, operation, method, fieldMask, body });
}

async function googleRoutesRequest(path, { config, operation, fieldMask, body } = {}) {
  return googleRequest(`${GOOGLE_ROUTES_BASE_URL}${path}`, { config, operation, method: "POST", fieldMask, body });
}

async function googleRequest(url, { config, operation, method = "POST", fieldMask, body } = {}) {
  const apiKey = googleApiKey(config);
  if (!apiKey) throw googleProviderError("PROVIDER_CONFIGURATION_REQUIRED", "Google Maps API key is required.", false, 500);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, Number(config?.googleRequestTimeoutMs || config?.timeoutMs || 10000)));
  let response;
  let json;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {})
      },
      body: body ? JSON.stringify(removeUndefined(body)) : undefined
    });
    json = await response.json().catch(() => ({}));
  } catch (error) {
    if (error?.name === "AbortError") throw googleProviderError("GOOGLE_TIMEOUT", "Google provider request timed out.", true, 408);
    if (error?.code === "REQUEST_TIMEOUT" || error?.status === 408 || String(error?.message || "").toLowerCase().includes("timed out")) throw googleProviderError("GOOGLE_TIMEOUT", "Google provider request timed out.", true, 408);
    throw googleProviderError("PROVIDER_UNAVAILABLE", "Google provider request failed.", true, 503);
  } finally {
    clearTimeout(timeoutId);
  }
  if (response.ok) return json;
  throw googleProviderError(mapGoogleErrorCode(response.status, json, operation), "Google provider request failed.", response.status >= 500, response.status);
}

function googleApiKey(config) {
  return config?.googleMapsApiKey || config?.placeApiKey || config?.routeApiKey || "";
}

function mapGoogleErrorCode(status, json, operation) {
  const providerStatus = String(json?.error?.status || json?.status || "").toUpperCase();
  const message = String(json?.error?.message || json?.message || "").toLowerCase();
  if (status === 408 || message.includes("timeout")) return "GOOGLE_TIMEOUT";
  if (status === 429 || providerStatus === "RESOURCE_EXHAUSTED") return message.includes("quota") ? "PROVIDER_QUOTA_EXCEEDED" : "RATE_LIMITED";
  if (status === 401 || providerStatus === "UNAUTHENTICATED") return "PROVIDER_AUTH_FAILED";
  if (status === 403 || providerStatus === "PERMISSION_DENIED") {
    if (message.includes("billing") || message.includes("has not been used") || message.includes("disabled") || message.includes("not enabled")) return "PROVIDER_CONFIGURATION_REQUIRED";
    return "PROVIDER_AUTH_FAILED";
  }
  if (status === 400 || providerStatus === "INVALID_ARGUMENT") {
    if (message.includes("field") || message.includes("mask") || message.includes("api key")) return "PROVIDER_CONFIGURATION_REQUIRED";
    return "INVALID_PROVIDER_RESPONSE";
  }
  if (operation && status >= 500) return "PROVIDER_UNAVAILABLE";
  return "PROVIDER_UNAVAILABLE";
}

function normalizeGoogleLocation(place, originalInput = "", prediction = {}) {
  const location = place?.location;
  if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return null;
  const components = Array.isArray(place.addressComponents) ? place.addressComponents : [];
  const city = componentValue(components, ["locality", "postal_town"]) || displayText(place.displayName) || displayText(prediction.structuredFormat?.mainText);
  const stateOrProvince = componentValue(components, ["administrative_area_level_1"]);
  const country = componentValue(components, ["country"]);
  const canonicalName = compactName([city, stateOrProvince, country]) || place.formattedAddress || displayText(prediction.text) || originalInput;
  return {
    id: place.id || prediction.placeId || `google-${slug(canonicalName)}`,
    originalInput,
    canonicalName,
    displayName: canonicalName,
    normalizedName: canonicalName,
    city,
    stateOrProvince,
    stateOrRegion: stateOrProvince,
    country,
    countryCode: componentShortValue(components, ["country"]),
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    coordinates: { lat: Number(location.latitude), lng: Number(location.longitude) },
    locationType: locationTypeFromGoogleTypes(place.types || prediction.types || []),
    aliases: [place.formattedAddress, displayText(place.displayName), displayText(prediction.text)].filter(Boolean),
    providerPlaceId: place.id || prediction.placeId || `google-${slug(canonicalName)}`,
    boundingRegion: null,
    timezone: "",
    provider: "google",
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

async function resolveRouteCoordinates(value, config) {
  if (Array.isArray(value) && value.length >= 2) return { lat: Number(value[1]), lng: Number(value[0]) };
  if (value?.lat !== undefined && value?.lng !== undefined) return { lat: Number(value.lat), lng: Number(value.lng) };
  if (value?.latitude !== undefined && value?.longitude !== undefined) return { lat: Number(value.latitude), lng: Number(value.longitude) };
  const location = (await googleLocationSearch(String(value || ""), config))[0];
  return location ? { lat: location.latitude, lng: location.longitude } : null;
}

function buildGoogleRegions(destinationLocation, places) {
  const city = destinationLocation.canonicalName.split(",")[0].trim() || "Destination";
  const center = {
    id: "central-area",
    name: `${city} orientation district`,
    summary: `Primary orientation area around ${destinationLocation.canonicalName}.`,
    centerCoordinates: { lat: destinationLocation.latitude, lng: destinationLocation.longitude },
    tags: ["central", "orientation"],
    neighboringRegionIds: ["culture-area", "food-area", "nearby-region"],
    typicalTravelMinutesToRegions: {}
  };
  const culturePlace = places.find((place) => hasAnyType(place, ["museum", "historical_landmark", "cultural_landmark", "art_gallery", "tourist_attraction"])) || places[0];
  const naturePlace = places.find((place) => hasAnyType(place, ["park", "national_park", "botanical_garden", "hiking_area"])) || places[1] || places[0];
  const foodPlace = places.find(isFoodPlace) || places[2] || places[0];
  const nearbyPlace = places.find((place) => distanceMiles(destinationLocation, placeLocation(place)) >= 18) || places[3] || places[0];
  return [
    center,
    regionFromGooglePlace("culture-area", regionNameFromPlace(city, culturePlace, "arts and history"), culturePlace, ["culture", "landmark"], ["central-area", "food-area"]),
    regionFromGooglePlace("nature-area", regionNameFromPlace(city, naturePlace, "parks and gardens"), naturePlace, ["nature", "viewpoint"], ["central-area", "culture-area"]),
    regionFromGooglePlace("food-area", regionNameFromPlace(city, foodPlace, "restaurant district"), foodPlace, ["food", "evening"], ["central-area", "culture-area"]),
    regionFromGooglePlace("nearby-region", regionNameFromPlace(city, nearbyPlace, "regional side trip"), nearbyPlace, ["nearby", "day-trip", "scenic"], ["central-area", "nature-area"])
  ];
}

function regionNameFromPlace(city, place, fallback) {
  const name = displayText(place?.displayName);
  if (!name) return `${city} ${fallback}`;
  return `${name} area`;
}

function regionFromGooglePlace(id, name, place, tags, neighboringRegionIds) {
  const location = placeLocation(place) || { lat: 0, lng: 0 };
  return {
    id,
    name,
    summary: `${name} grouped from nearby visitor stops. Verify exact hours, tickets, access, and travel time before finalizing.`,
    centerCoordinates: location,
    tags,
    neighboringRegionIds,
    typicalTravelMinutesToRegions: {}
  };
}

function profilePlaceFromGooglePlace(place, region, destinationName, index) {
  const name = displayText(place.displayName) || place.formattedAddress || `Place ${index + 1}`;
  const category = googleCategory(place);
  const duration = durationForGoogleCategory(category, place, index);
  const cost = costForGoogleCategory(category, place, index);
  return {
    id: place.id || `google-place-${index}`,
    name,
    regionId: region.id,
    shortDescription: googleDescription(place, destinationName, category),
    categories: [category, ...(place.types || []).slice(0, 4)],
    tags: [titleCase(category), "Visitor stop", "Verify before travel"],
    suitableFor: ["solo", "couple", "family", "senior"],
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.max(30, duration - 45),
    maximumDurationMinutes: category === "nearby-excursion" ? 300 : duration + 75,
    estimatedCostLow: cost.low,
    estimatedCostHigh: cost.high,
    indoorOutdoor: category === "nature" ? "outdoor" : category === "museum" ? "indoor" : "mixed",
    weatherDependency: category === "nature" ? "high" : category === "museum" ? "low" : "medium",
    accessibility: "moderate",
    dietaryRelevance: category === "food" ? ["confirm dietary needs directly"] : [],
    openingTimeGuidance: "Confirm current opening hours, timed tickets, and closures before travel.",
    bestTimeOfDay: category === "food" ? "lunch" : index % 3 === 0 ? "morning" : index % 3 === 1 ? "afternoon" : "evening",
    reservationRecommended: category === "food" || category === "museum",
    seasonalNotes: [],
    conflictTags: [],
    priorityScore: Math.max(50, Math.round((Number(place.rating || 4) * 12) + Math.min(35, Number(place.userRatingCount || 0) / 100) + 30 - index)),
    coordinates: placeLocation(place),
    backupForTags: category === "museum" ? ["weather", "rain", "heat"] : [],
    sourceMetadata: {
      provider: "google",
      providerPlaceId: place.id || `google-place-${index}`,
      retrievedName: name,
      retrievedAt: new Date().toISOString(),
      sourceUrl: GOOGLE_SOURCE_URL,
      dataConfidence: "provider",
      dataFreshness: "live-google-places"
    }
  };
}

function buildGoogleFoodAreas(foodCandidates, regions, destinationName) {
  const candidates = foodCandidates.slice(0, 5);
  if (!candidates.length) {
    return ["Central dining area", "Local cafes and bakeries", "Dinner district"].map((name, index) => ({
      id: `google-food-${index + 1}`,
      name,
      regionId: regions[index % regions.length]?.id || "food-area",
      cuisines: ["Local cuisine"],
      mealTypes: index === 1 ? ["breakfast", "lunch"] : ["lunch", "dinner"],
      budgetLevels: ["moderate"],
      dietarySupport: ["Confirm menus directly"],
      eveningSuitability: ["quiet", "casual"],
      shortDescription: `${name} for ${destinationName}; verify restaurant choices directly.`
    }));
  }
  return candidates.map((place, index) => ({
    id: `google-food-${slug(displayText(place.displayName) || index)}`,
    name: displayText(place.displayName) || `Food area ${index + 1}`,
    regionId: regionForGooglePlace(place, regions, null).id,
    cuisines: ["Local cuisine"],
    mealTypes: foodMealTypesForGooglePlace(place, index),
    budgetLevels: ["moderate"],
    dietarySupport: ["Confirm menus directly"],
    eveningSuitability: ["quiet", "casual", "social"],
    shortDescription: `${displayText(place.displayName)} can work as a meal stop for ${destinationName}. Verify menus, reservations, and dietary fit.`
  }));
}

function buildGoogleScenicRoutes(regions) {
  return regions.slice(1).map((region, index) => ({
    id: `google-route-${region.id}`,
    name: `${regions[0]?.name || "Primary area"} to ${region.name}`,
    originRegionId: "central-area",
    destinationRegionId: region.id,
    estimatedDriveMinutes: 15 + index * 10,
    estimatedDistanceMiles: 4 + index * 6,
    tags: region.tags || [],
    bestTimeOfDay: index === regions.length - 2 ? "morning" : "afternoon",
    notes: "Verify live traffic and route conditions before departure."
  }));
}

function regionForGooglePlace(place, regions, destinationLocation) {
  const category = googleCategory(place);
  if (destinationLocation && distanceMiles(destinationLocation, placeLocation(place)) >= 18) return regions.find((region) => region.id === "nearby-region") || regions[0];
  if (category === "food") return regions.find((region) => region.id === "food-area") || regions[0];
  if (category === "nature") return regions.find((region) => region.id === "nature-area") || regions[0];
  if (["museum", "landmark", "culture"].includes(category)) return regions.find((region) => region.id === "culture-area") || regions[0];
  return regions.find((region) => region.id === "central-area") || regions[0];
}

function isTourismPlace(place) {
  const name = `${displayText(place?.displayName)} ${place?.formattedAddress || ""}`.toLowerCase();
  const types = new Set(place?.types || []);
  if ([...types].some((type) => REJECTED_TYPES.has(type))) return false;
  if (isRawProviderPlaceName(displayText(place?.displayName))) return false;
  if (/\b(insurance|hampton inn|hotel|motel|school|bank|medical|doctor|dentist|apartment|parking|gas station)\b/i.test(name)) return false;
  return [...types].some((type) => TOURISM_TYPES.has(type));
}

function isFoodPlace(place) {
  return !isRawProviderPlaceName(displayText(place?.displayName)) && hasAnyType(place, ["restaurant", "cafe", "bakery", "bar", "meal_takeaway", "food"]);
}

function googlePlaceScore(place) {
  const rating = Number(place?.rating || 0);
  const count = Number(place?.userRatingCount || 0);
  const tourismBoost = isTourismPlace(place) ? 20 : 0;
  return rating * 15 + Math.min(35, count / 75) + tourismBoost;
}

function googleDescription(place, destinationName, category) {
  const editorial = place?.editorialSummary?.text;
  if (editorial) return `${editorial} Verify current hours, tickets, and access before travel.`;
  return `${displayText(place.displayName)} is a ${titleCase(category)} visitor stop for ${destinationName}. Verify current hours, tickets, access, and availability before travel.`;
}

function foodMealTypesForGooglePlace(place, index = 0) {
  const types = new Set(place?.types || []);
  const name = displayText(place?.displayName).toLowerCase();
  if (types.has("bakery") || types.has("cafe") || /coffee|breakfast|brunch|bakery|bagel|pancake|diner/.test(name)) return ["breakfast", "lunch"];
  if (types.has("bar") || /bar|brewery|cocktail|wine/.test(name)) return ["dinner"];
  return index % 3 === 0 ? ["lunch", "dinner"] : index % 3 === 1 ? ["breakfast", "lunch"] : ["dinner"];
}

function googleCategory(place) {
  if (hasAnyType(place, ["restaurant", "cafe", "bakery", "bar"])) return "food";
  if (hasAnyType(place, ["park", "national_park", "botanical_garden", "hiking_area", "marina"])) return "nature";
  if (hasAnyType(place, ["museum", "art_gallery"])) return "museum";
  if (hasAnyType(place, ["historical_landmark", "cultural_landmark", "tourist_attraction"])) return "landmark";
  if (hasAnyType(place, ["performing_arts_theater", "amusement_park", "aquarium", "zoo"])) return "entertainment";
  return "culture";
}

function hasAnyType(place, types) {
  const all = new Set(place?.types || []);
  return types.some((type) => all.has(type));
}

function durationForGoogleCategory(category, place = {}, index = 0) {
  const text = `${displayText(place.displayName)} ${(place.types || []).join(" ")}`.toLowerCase();
  const bump = (stableNumber(place.id || displayText(place.displayName) || index) % 3) * 15;
  if (category === "food") return 60 + bump;
  if (/garden|botanical|state park|national park|zoo|aquarium|estate/.test(text)) return 135 + bump;
  if (category === "nature") return 90 + bump;
  if (category === "museum") return 105 + bump;
  if (category === "entertainment") return 120 + bump;
  return 75 + bump;
}

function costForGoogleCategory(category, place = {}, index = 0) {
  const text = `${displayText(place.displayName)} ${(place.types || []).join(" ")}`.toLowerCase();
  const bump = (stableNumber(place.id || displayText(place.displayName) || index) % 3) * 5;
  if (/beach|park|riverwalk|trail|memorial|monument|viewpoint/.test(text) || category === "nature") return { low: 0, high: 10 + bump };
  if (/garden|estate|aquarium|zoo/.test(text)) return { low: 15, high: 35 + bump };
  if (category === "museum") return { low: 12, high: 28 + bump };
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

function placeFieldMask() {
  return "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.rating,places.userRatingCount,places.editorialSummary";
}

function componentValue(components, wantedTypes) {
  return components.find((component) => wantedTypes.some((type) => component.types?.includes(type)))?.longText || "";
}

function componentShortValue(components, wantedTypes) {
  return components.find((component) => wantedTypes.some((type) => component.types?.includes(type)))?.shortText || "";
}

function displayText(value) {
  if (typeof value === "string") return value;
  return value?.text || "";
}

function locationTypeFromGoogleTypes(types) {
  if (types.includes("country")) return "Country";
  if (types.includes("administrative_area_level_1")) return "State or region";
  if (types.includes("national_park")) return "National park";
  if (types.includes("tourist_attraction")) return "Attraction";
  return "City";
}

function placeLocation(place) {
  if (!place?.location) return null;
  return { lat: Number(place.location.latitude), lng: Number(place.location.longitude) };
}

function distanceMiles(a, b) {
  if (!a || !b) return 0;
  const lat1 = Number(a.latitude ?? a.lat);
  const lon1 = Number(a.longitude ?? a.lng);
  const lat2 = Number(b.latitude ?? b.lat);
  const lon2 = Number(b.longitude ?? b.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeTravelMode(mode) {
  return String(mode || "").toLowerCase().includes("walk") ? "WALK" : "DRIVE";
}

function durationSeconds(value) {
  if (typeof value === "number") return value;
  const match = String(value || "").match(/([\d.]+)s/);
  return match ? Number(match[1]) : Number(value || 0);
}

function compactName(parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).filter((part, index, array) => array.indexOf(part) === index).join(", ");
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, removeUndefined(item)]));
}

function titleCase(value) {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "item";
}

function sanitizeErrorCode(code) {
  return String(code || "PROVIDER_UNAVAILABLE").replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
}

function googleProviderError(code, message, retryable = false, status = 500) {
  const error = new Error(message);
  error.code = sanitizeErrorCode(code);
  error.retryable = retryable;
  error.status = status;
  return error;
}
