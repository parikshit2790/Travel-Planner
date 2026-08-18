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

export async function googleLocationSearch(query, config, locationBias = null) {
  const input = String(query || "").trim();
  const bias = locationBias && Number.isFinite(locationBias.latitude) && Number.isFinite(locationBias.longitude)
    ? { circle: { center: { latitude: locationBias.latitude, longitude: locationBias.longitude }, radius: 50000 } }
    : undefined;
  const json = await googlePlacesRequest("/places:autocomplete", {
    config,
    operation: "places-autocomplete",
    fieldMask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
    body: {
      input,
      includedPrimaryTypes: ["locality", "administrative_area_level_1", "country", "tourist_attraction", "national_park"],
      languageCode: "en",
      ...(bias ? { locationBias: bias } : {})
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
    const fallback = await googleTextSearch(`${input}`, config, "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types", 5, locationBias);
    locations.push(...fallback.map((place) => normalizeGoogleLocation(place, input)).filter(Boolean));
  }
  return dedupeBy(locations, (item) => item.providerPlaceId).slice(0, 8);
}

export async function googleDestinationResearch(destination, trip = {}, config) {
  const destinationLocation = locationFromTrip(trip) || (await resolveDestination(destination, config));
  if (!destinationLocation) throw googleProviderError("DESTINATION_RESEARCH_FAILED", "Destination could not be resolved.", false, 502);
  const destinationName = destinationLocation.canonicalName || String(destination || "").trim();
  // A longer trip needs more meal slots filled with real, non-repeating
  // restaurants than a fixed small candidate pool can sustain -- scale the
  // restaurant fetch and candidate count with trip length.
  const tripDays = Number(trip?.days || trip?.numberOfDays || 0);
  // Previously requested a smaller result count here for regional-extension
  // candidates on the theory that a large destination's full-size query was
  // itself slow. Direct live measurement disproved that: the real delay was
  // OpenAI's primary-research timeout eating the shared request budget
  // (fixed separately, see openAiRequestTimeoutMs), and the reduced count
  // caused post-filter candidate lists to sometimes come back empty even for
  // destinations that previously succeeded reliably (e.g. Sedona). Use the
  // same full-size query for every caller.
  const restaurantFetchCount = tripDays >= 7 ? 20 : 14;
  // A single "best restaurants...food halls" query is dominated by generic,
  // broadly-touristy results (food courts, malls, chains) because that
  // framing is exactly what surfaces mainstream Google results. A second
  // query framed around local/authentic/neighborhood dining pulls a
  // genuinely different slice of Google's index -- this is what actually
  // brings in cultural and neighborhood-specific restaurants, not just a
  // bigger number of the same kind of place.
  const localRestaurantFetchCount = tripDays >= 7 ? 16 : 12;
  const foodCandidateLimit = tripDays >= 7 ? 24 : 16;
  // A pure "best attractions IN {city}" query never surfaces well-known
  // regional day trips just outside the city itself -- confirmed live: for
  // Miami, this query's top 20 results never included Everglades National
  // Park, Everglades Safari Park, or Biscayne National Park, even though
  // all three are among the most commonly recommended Miami day trips. A
  // "day trips near {city}" query surfaces exactly these in its own top 20.
  const [attractions, dayTrips, nearby, restaurants, localRestaurants] = await Promise.all([
    googleTextSearch(`best tourist attractions and museums in ${destinationName}`, config, placeFieldMask(), 20),
    googleTextSearch(`best day trips and nearby attractions from ${destinationName}`, config, placeFieldMask(), 15),
    googleNearbySearch(destinationLocation, config, ["tourist_attraction", "museum", "park"], 50000, 20),
    googleTextSearch(`best restaurants cafes food halls in ${destinationName}`, config, placeFieldMask(), restaurantFetchCount),
    googleTextSearch(`local authentic restaurants and neighborhood eateries in ${destinationName}`, config, placeFieldMask(), localRestaurantFetchCount)
  ]);
  // Unlike the nearby search (already geo-bounded by radius), a text search
  // like "best restaurants in X" can return loosely-related results from a
  // different city entirely if Google's text relevance ranking is loose --
  // seen live as a Houston result inside a Baton Rouge search. Reject any
  // candidate too far from the resolved destination to plausibly belong to it.
  const withinDestinationRadius = (place) => {
    const location = placeLocation(place);
    return !location || distanceMiles(destinationLocation, location) <= 40;
  };
  // A well-known, iconic day-trip landmark can legitimately sit just past a
  // tight 40-mile bound -- confirmed live: Everglades National Park's own
  // visitor entrance is right around that boundary from central Miami and
  // got silently excluded, even though it's one of the most commonly
  // recommended Miami day trips. This is a textually correct match (Google's
  // own relevance ranking found it because it genuinely is a well-known
  // "attraction near Miami"), unlike the Houston-in-Baton-Rouge case, which
  // was a text-relevance failure, not a distance one. Give tourism
  // candidates specifically a wider berth; food stays tight, since a
  // 45+ mile restaurant is never a reasonable same-day dinner pick.
  const withinTourismRadius = (place) => {
    const location = placeLocation(place);
    return !location || distanceMiles(destinationLocation, location) <= 60;
  };
  const tourismCandidates = dedupeBy([...attractions, ...dayTrips, ...nearby], (place) => place.id)
    .filter(isTourismPlace)
    .filter(withinTourismRadius)
    .sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a));
  const foodCandidates = dedupeBy([...restaurants, ...localRestaurants], (place) => place.id)
    .filter(isFoodPlace)
    .filter(withinDestinationRadius)
    .sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a))
    .slice(0, foodCandidateLimit);
  if (!tourismCandidates.length) {
    throw googleProviderError("INVALID_PROVIDER_RESPONSE", "Destination research did not find reliable tourism candidates.", true, 502);
  }
  const places = tourismCandidates.slice(0, 30);
  const regions = buildGoogleRegions(destinationLocation, places);
  const existingPlaceIds = new Set(places.map((place) => place.id));
  const namedFoodPlaces = foodCandidates.filter((place) => !existingPlaceIds.has(place.id));
  const profilePlaces = [
    ...places.map((place, index) => profilePlaceFromGooglePlace(place, regionForGooglePlace(place, regions, destinationLocation), destinationName, index)),
    ...namedFoodPlaces.map((place, index) => profilePlaceFromGooglePlace(place, regionForGooglePlace(place, regions, destinationLocation), destinationName, places.length + index))
  ];
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
    places: profilePlaces,
    foodAreas: buildGoogleFoodAreas(foodCandidates, regions, destinationName),
    scenicRoutes: buildGoogleScenicRoutes(regions),
    sourceMetadata: {
      provider: "google",
      retrievedAt: new Date().toISOString(),
      freshness: "live-google-places",
      candidateCount: profilePlaces.length,
      sourceUrl: GOOGLE_SOURCE_URL
    }
  };
}

const INTEREST_KEYWORDS = {
  hiking: /hik|trail|summit|overlook|ridge/i,
  "water activities": /lake|river|water|kayak|paddle|falls?\b|waterfall|beach|boat/i,
  "national park": /national park|state park|forest|wilderness/i,
  mountain: /mountain|blue ridge|peak|ridge|summit/i
};

async function researchRegionalExtensionCandidate(cityName, primaryLocation, maxDriveMinutes, activeKeywordPatterns, config) {
  // Resolve with a bias toward the primary destination first, then hand the
  // already-resolved location to googleDestinationResearch (via
  // locationFromTrip) instead of letting it re-resolve unbiased -- see
  // resolveDestination's own comment for why this matters.
  const biasedLocation = primaryLocation ? await resolveDestination(cityName, config, primaryLocation).catch(() => null) : null;
  const candidateProfile = await googleDestinationResearch(cityName, biasedLocation ? { destinationLocation: biasedLocation, destinationDisplay: biasedLocation.canonicalName } : {}, config);
  const candidateCenter = candidateProfile.regions[0]?.centerCoordinates;
  if (!primaryLocation || !candidateCenter) return null;
  const route = await googleRouteEstimate(primaryLocation, candidateCenter, "driving", config);
  if (!route?.durationMinutes || route.durationMinutes > maxDriveMinutes) return null;
  const rankedPlaces = [...candidateProfile.places].sort((a, b) => {
    const boost = (place) => activeKeywordPatterns.some((pattern) => pattern.test(`${place.name} ${place.shortDescription} ${(place.tags || []).join(" ")}`)) ? 1000 : 0;
    return (boost(b) + b.priorityScore) - (boost(a) + a.priorityScore);
  });
  // A pure priority-score ranking is dominated by attractions, which silently
  // drops every restaurant candidate before it ever reaches this extension
  // region -- guarantee a handful of real named restaurants survive so the
  // region has schedulable meal candidates, not just sightseeing stops.
  const isFoodPlace = (place) => place.categories?.includes("restaurant") || place.categories?.includes("food");
  const nonFoodPlaces = rankedPlaces.filter((place) => !isFoodPlace(place));
  const foodPlaces = rankedPlaces.filter(isFoodPlace);
  // Same problem, different category: the interest-keyword boost above gives
  // every nature/hiking-tagged place a +1000 bump, so a traveler with strong
  // outdoor interests gets a top-7 slice that is ENTIRELY nature places --
  // confirmed live for an Asheville extension researched for a hiking/
  // mountains/national-parks traveler, where Biltmore Estate (the region's
  // single best-known non-nature landmark) never survived the slice. That
  // left the region with no landmark/museum/entertainment candidate at all,
  // which then fails the quality critic's gateway-or-entertainment coverage
  // check regardless of how strong the nature coverage is. Guarantee at
  // least one non-nature "character" place survives, mirroring the
  // restaurant guarantee just above.
  // "landmark" alone is too loose a signal to guarantee against -- Google's
  // own categorization cascade (see googleCategory) falls through to
  // "landmark" for anything tagged tourist_attraction that isn't already
  // food/nature/museum/entertainment, which silently catches things like a
  // working orchard. Confirmed live: that false-positive let an orchard
  // satisfy this guarantee and Biltmore Estate (a real "museum"-categorized
  // landmark) never got promoted. Require the reliable, Google-verified
  // "museum" or "entertainment" categorization first; only fall back to the
  // broader landmark/culture bucket if neither exists.
  const isCharacterPlace = (place) => ["museum", "entertainment"].includes(place.categories?.[0]);
  const isBroadCharacterPlace = (place) => ["landmark", "culture"].includes(place.categories?.[0]);
  let selectedNonFood = nonFoodPlaces.slice(0, 7);
  if (!selectedNonFood.some(isCharacterPlace)) {
    const bestCharacterPlace = nonFoodPlaces.find(isCharacterPlace) || nonFoodPlaces.find(isBroadCharacterPlace);
    if (bestCharacterPlace) selectedNonFood = [...selectedNonFood.slice(0, 6), bestCharacterPlace];
  }
  return {
    cityName,
    canonicalName: candidateProfile.canonicalName,
    centerCoordinates: candidateCenter,
    route,
    // 3 restaurants (each reusable at most twice) caps a regional-extension
    // base at 6 meal-fills before its own food pool runs dry -- confirmed
    // live: a 3-night, 9-meal Orlando stay exhausted it by day 2 and started
    // falling back to Miami restaurants 200+ miles away. candidateProfile
    // already fetched a full restaurant list for this city; take more of
    // what's already there instead of one more API round-trip.
    places: [...selectedNonFood, ...foodPlaces.slice(0, 8)],
    foodAreas: candidateProfile.foodAreas.slice(0, 3)
  };
}

export async function discoverRegionalExtensions(primaryLocation, candidateCityNames, interestLabels, config, { maxDriveMinutes = 240, maxCandidates = 2 } = {}) {
  const interests = (interestLabels || []).map((label) => String(label || "").toLowerCase());
  const activeKeywordPatterns = Object.entries(INTEREST_KEYWORDS)
    .filter(([key]) => interests.some((label) => label.includes(key)))
    .map(([, pattern]) => pattern);
  const candidateNames = (candidateCityNames || []).slice(0, maxCandidates);
  // Earlier revisions staggered/delayed candidates here to work around what
  // looked like a load-related failure. The actual root cause (confirmed via
  // a direct, isolated route-estimate call) was Google's Directions API
  // failing outright for a specific origin/destination pair regardless of
  // timing or concurrency -- now handled with a coordinate-distance fallback
  // in googleRouteEstimate, so candidates no longer need artificial
  // staggering to succeed. Research every candidate concurrently.
  const extendedTimeoutConfig = { ...config, googleRequestTimeoutMs: Math.max(20000, Number(config?.googleRequestTimeoutMs || config?.timeoutMs || 10000)) };
  const settled = await Promise.allSettled(candidateNames.map((cityName) =>
    researchRegionalExtensionCandidate(cityName, primaryLocation, maxDriveMinutes, activeKeywordPatterns, extendedTimeoutConfig)
  ));
  const results = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      if (outcome.value) results.push(outcome.value);
    } else {
      console.warn("[RouteMosaic planner] Regional extension candidate research failed", JSON.stringify({ cityName: candidateNames[index], code: outcome.reason?.code || "REGIONAL_EXTENSION_CANDIDATE_FAILED" }));
    }
  });
  return results;
}

export async function googleRouteEstimate(origin, destination, mode = "driving", config) {
  const originCoordinates = await resolveRouteCoordinates(origin, config);
  const destinationCoordinates = await resolveRouteCoordinates(destination, config);
  if (!originCoordinates || !destinationCoordinates) {
    throw googleProviderError("ROUTE_POINTS_REQUIRED", "Origin and destination coordinates are required.", false, 400);
  }
  // Directly measured live: Google's Directions API can genuinely fail to
  // compute a route for a real, legitimate origin/destination pair (seen
  // reproducibly for Phoenix -> Grand Canyon National Park South Rim, while
  // Phoenix -> Sedona succeeds cleanly) -- most likely the destination's
  // resolved point (a large park's geocoded center) doesn't snap to Google's
  // road network the way a town center does. The coordinates themselves
  // resolved successfully above; only the turn-by-turn directions call
  // failed. A traveler-approved overnight base must not silently disappear
  // from the trip because one geocoded point is awkward for a directions
  // API -- fall back to a straight-line-distance estimate rather than
  // dropping the candidate entirely.
  // Configuration, auth, quota, and timeout failures must keep propagating
  // as real errors (provider health checks and callers depend on seeing
  // them) -- only a *successful* API call that comes back with no usable
  // route should fall back to a coordinate-based estimate below.
  const travelMode = routeTravelMode(mode);
  // TRANSIT mode rejects the DRIVE-only routingPreference field entirely and
  // needs a departureTime to return real transit schedule data -- there's no
  // specific travel date/time paired with an intra-day leg estimate like
  // this, so use a near-future placeholder (next Tuesday 10am local-ish UTC)
  // purely to get Google to compute a representative transit itinerary.
  const json = await googleRoutesRequest("/directions/v2:computeRoutes", {
    config,
    operation: "routes-compute",
    fieldMask: "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    body: {
      origin: { location: { latLng: { latitude: originCoordinates.lat, longitude: originCoordinates.lng } } },
      destination: { location: { latLng: { latitude: destinationCoordinates.lat, longitude: destinationCoordinates.lng } } },
      travelMode,
      ...(travelMode === "TRANSIT" ? { departureTime: nextRepresentativeTransitDeparture() } : { routingPreference: mode === "walking" ? undefined : "TRAFFIC_UNAWARE" })
    }
  });
  const route = json?.routes?.[0];
  if (!route?.duration || !Number.isFinite(Number(route.distanceMeters))) {
    console.warn("[RouteMosaic planner] Google Directions returned no usable route, falling back to coordinate-based estimate", JSON.stringify({ mode }));
    const miles = distanceMiles(originCoordinates, destinationCoordinates);
    const averageMph = mode === "walking" ? 3 : 43;
    const durationMinutes = Math.max(1, Math.round((miles / averageMph) * 60) + (mode === "walking" ? 0 : 20));
    return {
      durationMinutes,
      distanceMiles: Math.max(0.1, Math.round(miles * 10) / 10),
      mode,
      profile: routeTravelMode(mode).toLowerCase(),
      provider: "coordinate-approximation",
      retrievedAt: new Date().toISOString(),
      trafficAware: false,
      fromCoordinates: originCoordinates,
      toCoordinates: destinationCoordinates,
      disclaimer: "Turn-by-turn directions were unavailable for this route; estimated from straight-line distance. Verify actual travel time before booking."
    };
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

// A short or slightly misspelled regional-extension name (e.g. "Ashville"
// for Asheville, NC, or "Smokey Mountain" for Great Smoky Mountains
// National Park) can resolve to an exact-spelling match hundreds of miles
// away in a different state entirely -- confirmed live: an approved
// Charlotte-area multi-city route resolved "Ashville" to Ashville,
// Virginia and "Smokey Mountain" to Newport, Tennessee. Google's
// locationBias only weakly re-ranks results that far from the bias point,
// so also explicitly prefer whichever returned candidate is geographically
// closest to the primary destination when one is supplied, rather than
// trusting rank-order alone.
export async function resolveDestination(destination, config, locationBias = null) {
  const locations = await googleLocationSearch(destination, config, locationBias);
  if (!locations.length) return null;
  if (!locationBias || !Number.isFinite(locationBias.latitude) || !Number.isFinite(locationBias.longitude)) return locations[0];
  // Re-sorting every candidate by raw distance to the bias point -- not just
  // picking among same-named cities -- lets a textually unrelated place win
  // by a few miles. Confirmed live: resolving "Orlando" biased toward Miami
  // returned Orlando FL, Orlando OK, Orlando KY, Azalea Park FL, and Conway
  // FL (a real Orlando-area neighborhood); Conway sits a few miles closer to
  // Miami than Orlando's own city center, so it silently won and "Orlando"
  // was replaced by "Conway, Florida" throughout the whole trip. Distance
  // bias exists to pick the right one among genuinely same-named
  // cities (e.g. "Charlotte, NC" vs "Charlotte, FL") -- restrict it to
  // candidates whose own city name actually matches what was typed, and
  // only fall through to the full result set if none do.
  // AI-suggested regional candidate cities always arrive in "City, State"
  // form (enforced by normalizeRegionalDestinationProfile's own validation
  // regex), not a bare name -- comparing the FULL query string against
  // location.city (always just the bare city) would never match that
  // format at all, silently falling through to the same unfiltered
  // closest-wins bug for every AI-suggested extension. Compare on each
  // side's own leading segment so both a bare name ("Orlando") and a
  // qualified one ("Fort Lauderdale, FL") match correctly.
  const query = String(destination || "").trim().toLowerCase();
  const queryCore = query.split(",")[0].trim();
  const exactMatches = locations.filter((location) => {
    const city = String(location.city || "").trim().toLowerCase();
    return city === query || city === queryCore;
  });
  const pool = exactMatches.length ? exactMatches : locations;
  return [...pool].sort((a, b) => distanceMiles(locationBias, a) - distanceMiles(locationBias, b))[0];
}

// AI-sourced destination research (openai-destination-provider.js) discovers
// real, well-chosen places and neighborhoods but has no access to a mapping
// service, so it cannot supply trustworthy coordinates -- a language model
// asked for latitude/longitude is a guess, not a lookup. Downstream routing
// math (estimateTravel) silently falls back to region-center coordinates,
// or worse to a near-zero clamped distance, whenever a place's own
// coordinates are missing. This grounds each AI-sourced place against real
// Google Places data without changing which places were chosen or how
// they're described -- only their physical location gets filled in.
export async function groundPlacesWithCoordinates(profile, destinationName, config) {
  const places = Array.isArray(profile?.places) ? profile.places : [];
  const hasCoordinates = (value) => Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
  const needsGrounding = places.filter((place) => !hasCoordinates(place.coordinates));
  if (!needsGrounding.length) return profile;
  const lightFieldMask = "places.id,places.location";
  // Firing one Google call per ungrounded place all at once (a full AI
  // profile can easily be 20-30 places) is a real burst-load pattern on top
  // of whatever else a single request is already doing concurrently
  // (regional extension research, food supplementing) -- cap how many
  // grounding calls are in flight at once instead of firing every place
  // simultaneously, to keep total concurrent Google API load bounded.
  const results = await mapWithConcurrencyLimit(needsGrounding, 6, (place) => googleTextSearch(`${place.name}, ${destinationName}`, config, lightFieldMask, 1));
  needsGrounding.forEach((place, index) => {
    const outcome = results[index];
    if (outcome.status !== "fulfilled" || !outcome.value?.length) return;
    const location = placeLocation(outcome.value[0]);
    if (location) place.coordinates = location;
  });
  (profile.regions || []).forEach((region) => {
    if (hasCoordinates(region.centerCoordinates)) return;
    const grounded = places.filter((place) => place.regionId === region.id && hasCoordinates(place.coordinates));
    if (!grounded.length) return;
    region.centerCoordinates = {
      lat: grounded.reduce((sum, place) => sum + place.coordinates.lat, 0) / grounded.length,
      lng: grounded.reduce((sum, place) => sum + place.coordinates.lng, 0) / grounded.length
    };
  });
  return profile;
}

// AI destination research asks the model to invent a small, fixed number of
// food areas (4-6 for a typical trip) with no grounding at all, which is the
// same "too few, too generic" pattern already fixed for the Google-primary
// path -- just never applied here since this path only runs when OpenAI
// research is primary. Supplements (never replaces) the AI-chosen food
// picks with real, named restaurants from Google, deduped against what the
// AI already found and assigned to the nearest existing (now-grounded)
// region by real distance.
export async function supplementFoodCandidates(profile, destinationName, tripDays, config) {
  const regions = Array.isArray(profile?.regions) ? profile.regions : [];
  const existingPlaces = Array.isArray(profile?.places) ? profile.places : [];
  const hasCoordinates = (value) => Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
  const destinationLocation = regions.map((region) => region.centerCoordinates).find(hasCoordinates)
    || existingPlaces.map((place) => place.coordinates).find(hasCoordinates);
  if (!destinationLocation || !regions.length) return profile;
  const fetchCount = tripDays >= 7 ? 16 : 12;
  const localFetchCount = tripDays >= 7 ? 14 : 10;
  const [restaurants, localRestaurants] = await Promise.all([
    googleTextSearch(`best restaurants cafes food halls in ${destinationName}`, config, placeFieldMask(), fetchCount),
    googleTextSearch(`local authentic restaurants and neighborhood eateries in ${destinationName}`, config, placeFieldMask(), localFetchCount)
  ]);
  const existingNames = new Set(existingPlaces.map((place) => normalizePlaceNameForDedupe(place.name)));
  const withinDestinationRadius = (place) => {
    const location = placeLocation(place);
    return !location || distanceMiles(destinationLocation, location) <= 40;
  };
  const candidates = dedupeBy([...restaurants, ...localRestaurants], (place) => place.id)
    .filter(isFoodPlace)
    .filter(withinDestinationRadius)
    .filter((place) => !existingNames.has(normalizePlaceNameForDedupe(displayText(place.displayName))))
    .sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a))
    .slice(0, tripDays >= 7 ? 14 : 10);
  if (!candidates.length) return profile;
  const nearestRegionFor = (place) => {
    const location = placeLocation(place);
    if (!location) return regions[0];
    let best = regions[0];
    let bestDistance = Infinity;
    for (const region of regions) {
      if (!hasCoordinates(region.centerCoordinates)) continue;
      const distance = distanceMiles(region.centerCoordinates, location);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = region;
      }
    }
    return best;
  };
  const startIndex = existingPlaces.length;
  const supplementedPlaces = candidates.map((place, index) => profilePlaceFromGooglePlace(place, nearestRegionFor(place), destinationName, startIndex + index));
  profile.places = [...existingPlaces, ...supplementedPlaces];
  return profile;
}

function normalizePlaceNameForDedupe(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function googlePlaceDetails(placeId, config) {
  return googlePlacesRequest(`/places/${encodeURIComponent(placeId)}`, {
    config,
    operation: "place-details",
    method: "GET",
    fieldMask: "id,displayName,formattedAddress,location,addressComponents,types,primaryType,rating,userRatingCount,editorialSummary"
  });
}

async function googleTextSearch(textQuery, config, fieldMask = placeFieldMask(), pageSize = 10, locationBias = null) {
  const bias = locationBias && Number.isFinite(locationBias.latitude) && Number.isFinite(locationBias.longitude)
    ? { circle: { center: { latitude: locationBias.latitude, longitude: locationBias.longitude }, radius: 50000 } }
    : undefined;
  const json = await googlePlacesRequest("/places:searchText", {
    config,
    operation: "places-text-search",
    fieldMask,
    body: { textQuery, languageCode: "en", pageSize, ...(bias ? { locationBias: bias } : {}) }
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

// Places must be grouped by where they actually are, not by what category
// Google assigns them -- a category bucket like "culture-area" absorbs every
// museum and landmark city-wide regardless of neighborhood, then gets named
// after whichever one happened to match first (e.g. a Smithsonian annex near
// the airport becoming the label for a downtown history museum's "region").
// This clusters places by real coordinates instead, so each region is an
// actual walkable/drivable area, and names it after its own highest-scored
// member -- meaningful now because that member is genuinely representative
// of everything grouped with it.
const NEARBY_THRESHOLD_MILES = 18;

function buildGoogleRegions(destinationLocation, places) {
  const city = destinationLocation.canonicalName.split(",")[0].trim() || "Destination";
  const corePlaces = places.filter((place) => {
    const location = placeLocation(place);
    return !location || distanceMiles(destinationLocation, location) < NEARBY_THRESHOLD_MILES;
  });
  const nearbyPlaces = places.filter((place) => !corePlaces.includes(place));
  // Farthest-point k-means seeding claims true geographic outliers (a single
  // estate or park miles from anything else) as cluster seeds first,
  // regardless of how high k is set -- leaving too few remaining seeds to
  // subdivide a genuinely dense downtown core (DC's Mall, Capitol Hill, Penn
  // Quarter, Georgetown, etc. are all within a few miles of each other) into
  // separate walkable areas. Pull isolated places out first so they each get
  // their own accurately-named region without consuming the core's budget,
  // then cluster only the dense remainder with a dedicated budget.
  const isolationThresholdMiles = 3;
  const denseAndIsolated = splitDenseAndIsolated(corePlaces, isolationThresholdMiles);
  // A destination's own geographic spread matters as much as how many
  // candidates it has -- a count-only cluster budget (capped at 7 regardless
  // of area) forces a geographically large city like New York into the same
  // number of regions as a compact downtown, so genuinely distant landmarks
  // (Statue of Liberty, Brooklyn Bridge) end up sharing one cluster. Raise
  // the ceiling when the core candidate pool itself spans a wide area.
  const coreDiameterMiles = maxDistanceFromCentroid(denseAndIsolated.dense);
  const maxClusterCount = coreDiameterMiles > 8 ? 12 : 7;
  const denseClusterCount = Math.max(3, Math.min(maxClusterCount, Math.round(denseAndIsolated.dense.length / 6) || 3));
  const denseClusters = denseAndIsolated.dense.length ? balancedGeographicClusters(denseAndIsolated.dense, denseClusterCount) : [];
  // k-means assigns every point to its nearest centroid regardless of how
  // far away that centroid actually is, so two genuinely distant landmarks
  // can still land in the same cluster if nothing closer claimed them first
  // -- confirmed live: Statue of Liberty and Brooklyn Bridge, several miles
  // apart, ended up in one region named "Brooklyn Bridge area". Peel off any
  // member farther than a realistic same-neighborhood walking/rideshare
  // bound from its cluster's own centroid into its own region, the same way
  // splitDenseAndIsolated already does for places with no nearby neighbor at
  // all.
  const maxClusterRadiusMiles = 2.5;
  const cappedClusters = denseClusters.flatMap((members) => capClusterRadius(members, maxClusterRadiusMiles));
  const clusters = [
    ...cappedClusters,
    ...denseAndIsolated.isolated.map((place) => [place])
  ].filter((members) => members.length);
  // A neighborhood/sublocality address component is often a borough-level
  // label in dense cities (e.g. Google tags most of Manhattan's own
  // sublocality_level_1 as "Manhattan" regardless of which part of it a
  // place sits in) -- confirmed live: four geographically distinct NYC
  // clusters all came out named "Manhattan area". Track names as they're
  // assigned and fall back any collision to the place-based name, which is
  // per-cluster-representative and so virtually guaranteed to differ.
  const usedRegionNames = new Set();
  const regions = clusters.map((members) => {
    const locations = members.map(placeLocation).filter(Boolean);
    const center = locations.length
      ? { lat: locations.reduce((sum, l) => sum + l.lat, 0) / locations.length, lng: locations.reduce((sum, l) => sum + l.lng, 0) / locations.length }
      : { lat: destinationLocation.latitude, lng: destinationLocation.longitude };
    const representative = clusterNamingRepresentative(members, center);
    let name = regionNameForCluster(city, representative, members);
    // "Central" is a real Google-tagged neighborhood/sublocality name in some
    // cities (confirmed live: Denver) -- appended with " area" like every
    // other cluster name here, it collides with our own internal
    // central-area region-id convention and reads as leaked internal jargon
    // to the quality gate. openai-destination-provider.js already renames
    // this exact case for its own region names; match that here.
    if (/^central area$/i.test(name.trim())) name = "Downtown area";
    if (usedRegionNames.has(name)) name = regionNameFromPlace(city, representative, "area");
    usedRegionNames.add(name);
    return {
      id: slug(`area-${displayText(representative?.displayName) || city}`),
      name,
      summary: `Cluster of nearby visitor stops around ${displayText(representative?.displayName) || city}. Verify exact hours, tickets, access, and travel time before finalizing.`,
      centerCoordinates: center,
      tags: ["geographic-cluster"],
      neighboringRegionIds: [],
      typicalTravelMinutesToRegions: {}
    };
  }).sort((a, b) => distanceMiles(destinationLocation, a.centerCoordinates) - distanceMiles(destinationLocation, b.centerCoordinates));
  if (regions.length) regions[0].id = "central-area";
  if (nearbyPlaces.length) {
    const representative = [...nearbyPlaces].sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a))[0];
    const location = placeLocation(representative) || { lat: destinationLocation.latitude, lng: destinationLocation.longitude };
    regions.push({
      id: "nearby-region",
      name: regionNameFromPlace(city, representative, "regional side trip"),
      summary: `Nearby day-trip or regional destinations outside the core ${city} area.`,
      centerCoordinates: location,
      tags: ["nearby", "day-trip", "scenic"],
      neighboringRegionIds: [],
      typicalTravelMinutesToRegions: {}
    });
  }
  regions.forEach((region) => {
    region.neighboringRegionIds = regions.filter((other) => other.id !== region.id).map((other) => other.id);
  });
  return regions.length ? regions : [{
    id: "central-area",
    name: `${city} orientation district`,
    summary: `Primary orientation area around ${destinationLocation.canonicalName}.`,
    centerCoordinates: { lat: destinationLocation.latitude, lng: destinationLocation.longitude },
    tags: ["central", "orientation"],
    neighboringRegionIds: [],
    typicalTravelMinutesToRegions: {}
  }];
}

// A place with no other place within thresholdMiles of it is geographically
// isolated -- it should be its own region rather than either swallowing a
// k-means seed slot (as an outlier) or getting dumped into a large,
// unrelated cluster by nearest-centroid assignment.
function splitDenseAndIsolated(places, thresholdMiles) {
  const withLocation = places.map((place) => ({ place, location: placeLocation(place) })).filter((item) => item.location);
  const withoutLocation = places.filter((place) => !placeLocation(place));
  const dense = [];
  const isolated = [];
  withLocation.forEach(({ place, location }, index) => {
    const nearestDistance = withLocation.reduce((min, other, otherIndex) => {
      if (otherIndex === index) return min;
      return Math.min(min, distanceMiles(location, other.location));
    }, Infinity);
    if (nearestDistance > thresholdMiles) isolated.push(place);
    else dense.push(place);
  });
  return { dense: [...dense, ...withoutLocation], isolated };
}

// Farthest-point seeding places centroids at the extremes of the point
// cloud, so a genuinely dense sub-area (e.g. DC's National Mall, where a
// dozen+ museums sit within a half-mile of each other) can end up entirely
// inside one seed's cluster while the other seeds -- placed at the sparser
// edges -- end up with only one or two members each. Recursively bisecting
// any cluster that ends up disproportionately large re-seeds k-means on
// just that subset, which finds real internal structure now that it isn't
// being compared against far-away points anymore.
function balancedGeographicClusters(places, k, maxShareOfWhole = 0.4) {
  let clusters = geographicClusters(places, k);
  const maxSize = Math.max(8, Math.ceil(places.length * maxShareOfWhole));
  for (let guard = 0; guard < 6; guard += 1) {
    const oversizedIndex = clusters.findIndex((cluster) => cluster.length > maxSize);
    if (oversizedIndex === -1) break;
    const subClusters = geographicClusters(clusters[oversizedIndex], 2).filter((cluster) => cluster.length);
    if (subClusters.length < 2) break;
    clusters.splice(oversizedIndex, 1, ...subClusters);
  }
  return clusters;
}

// Simple k-means over place coordinates (few iterations is plenty at
// city scale). Seeds centroids via farthest-point sampling for reasonable
// spread instead of picking k random members.
function geographicClusters(places, k) {
  const withLocation = places.map((place) => ({ place, location: placeLocation(place) })).filter((item) => item.location);
  const withoutLocation = places.filter((place) => !placeLocation(place));
  if (!withLocation.length) return withoutLocation.length ? [withoutLocation] : [];
  const targetK = Math.max(1, Math.min(k, withLocation.length));
  const centroids = [withLocation[0].location];
  while (centroids.length < targetK) {
    let farthest = null;
    let farthestDistance = -1;
    for (const { location } of withLocation) {
      const minDistance = Math.min(...centroids.map((centroid) => distanceMiles(centroid, location)));
      if (minDistance > farthestDistance) {
        farthestDistance = minDistance;
        farthest = location;
      }
    }
    centroids.push(farthest);
  }
  let assignments = withLocation.map(() => 0);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    assignments = withLocation.map(({ location }) => {
      let best = 0;
      let bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const distance = distanceMiles(centroid, location);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    });
    centroids.forEach((_, clusterIndex) => {
      const members = withLocation.filter((_, i) => assignments[i] === clusterIndex).map((item) => item.location);
      if (members.length) {
        centroids[clusterIndex] = {
          lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
          lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length
        };
      }
    });
  }
  const clusters = Array.from({ length: targetK }, () => []);
  withLocation.forEach(({ place }, i) => clusters[assignments[i]].push(place));
  if (withoutLocation.length) clusters[0].push(...withoutLocation);
  return clusters;
}

// Cheap proxy for "how geographically spread out is this candidate pool" --
// distance from the centroid to the farthest member, rather than a full
// O(n^2) pairwise diameter (not worth the cost at this candidate-pool size).
function maxDistanceFromCentroid(places) {
  const locations = places.map(placeLocation).filter(Boolean);
  if (locations.length < 2) return 0;
  const center = {
    lat: locations.reduce((sum, l) => sum + l.lat, 0) / locations.length,
    lng: locations.reduce((sum, l) => sum + l.lng, 0) / locations.length
  };
  return locations.reduce((max, location) => Math.max(max, distanceMiles(center, location)), 0);
}

// Recomputes the cluster's own centroid and peels off any member beyond
// maxRadiusMiles from it into its own singleton region. Recurses once on the
// remaining (now tighter) cluster in case removing an outlier meaningfully
// shifts the centroid and exposes another one.
function capClusterRadius(members, maxRadiusMiles) {
  if (members.length <= 1) return [members];
  const locations = members.map((place) => ({ place, location: placeLocation(place) }));
  const located = locations.filter((item) => item.location);
  if (located.length <= 1) return [members];
  const center = {
    lat: located.reduce((sum, item) => sum + item.location.lat, 0) / located.length,
    lng: located.reduce((sum, item) => sum + item.location.lng, 0) / located.length
  };
  const kept = [];
  const outliers = [];
  locations.forEach((item) => {
    if (item.location && distanceMiles(center, item.location) > maxRadiusMiles) outliers.push(item.place);
    else kept.push(item.place);
  });
  if (!outliers.length || !kept.length) return [members];
  return [...capClusterRadius(kept, maxRadiusMiles), ...outliers.map((place) => [place])];
}

// A cluster with more than a couple of members isn't accurately described by
// just its single highest-scored member's own name -- confirmed live: a
// cluster containing Central Park (a Google "neighborhood" component of its
// own) got named "The Metropolitan Museum of Art area" purely because the
// Met scored higher, even though the cluster genuinely spans both. Prefer a
// real neighborhood/sublocality name from the representative place's own
// address components when one exists; keep the existing "<top place> area"
// pattern for singletons/pairs or when no such component is available.
// Naming a cluster purely by its single highest-rated member picks whoever
// has the best rating/review count regardless of where in the cluster they
// sit -- confirmed live: a ~15-member Midtown cluster spanning Times Square,
// Bryant Park, and Rockefeller Center got named "Intrepid Museum area"
// because the Intrepid Museum (a distinct attraction on a far-west pier)
// outscored everything else, even though it sits at the cluster's edge and
// has nothing to do with the far more central, recognizable places a
// traveler's day actually contains. Prefer the highest-scored member among
// those closest to the cluster's own geographic center, so the name reflects
// somewhere actually representative of the area, not just whoever has the
// best reviews.
function clusterNamingRepresentative(members, center) {
  if (members.length <= 2) return [...members].sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a))[0];
  const withDistance = members.map((place) => ({ place, distance: (() => {
    const location = placeLocation(place);
    return location ? distanceMiles(center, location) : Infinity;
  })() })).sort((a, b) => a.distance - b.distance);
  const centralPool = withDistance.slice(0, Math.max(1, Math.ceil(withDistance.length / 2))).map((item) => item.place);
  return [...centralPool].sort((a, b) => googlePlaceScore(b) - googlePlaceScore(a))[0];
}

function regionNameForCluster(city, representative, members) {
  if (members.length > 2) {
    const neighborhood = componentValue(Array.isArray(representative?.addressComponents) ? representative.addressComponents : [], ["neighborhood", "sublocality_level_1", "sublocality"]);
    if (neighborhood) return `${neighborhood} area`;
  }
  return regionNameFromPlace(city, representative, "area");
}

function regionNameFromPlace(city, place, fallback) {
  const name = displayText(place?.displayName);
  if (!name) return `${city} ${fallback}`;
  return `${name} area`;
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
  const location = placeLocation(place);
  if (destinationLocation && location && distanceMiles(destinationLocation, location) >= NEARBY_THRESHOLD_MILES) {
    return regions.find((region) => region.id === "nearby-region") || regions[regions.length - 1] || regions[0];
  }
  if (!location) return regions[0];
  let best = regions[0];
  let bestDistance = Infinity;
  for (const region of regions) {
    if (region.id === "nearby-region") continue;
    const distance = distanceMiles(region.centerCoordinates, location);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region;
    }
  }
  return best;
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

const GENERIC_PLACE_TYPES = new Set([
  "restaurant", "food", "point_of_interest", "establishment", "food_store",
  "meal_takeaway", "meal_delivery", "tourist_attraction", "store", "landmark"
]);

function specificTypeLabel(place) {
  const candidates = [place?.primaryType, ...(place?.types || [])].filter(Boolean);
  const specific = candidates.find((type) => !GENERIC_PLACE_TYPES.has(type));
  return specific ? titleCase(specific).toLowerCase() : "";
}

function googleDescription(place, destinationName, category) {
  const editorial = place?.editorialSummary?.text;
  if (editorial) return `${editorial} Verify current hours, tickets, and access before travel.`;
  const name = displayText(place.displayName);
  const specificType = specificTypeLabel(place);
  const rating = Number(place?.rating || 0);
  const reviewCount = Number(place?.userRatingCount || 0);
  const ratingClause = rating >= 3.5 && reviewCount >= 15
    ? `, rated ${rating.toFixed(1)} from ${reviewCount >= 1000 ? `${Math.round(reviewCount / 100) / 10}k+` : `${reviewCount}+`} Google reviews`
    : "";
  if (specificType) {
    return `${name} is a ${specificType} in ${destinationName}${ratingClause}. Verify current hours, menu, and availability directly before relying on this pick.`;
  }
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
  // addressComponents (same billing tier as the already-requested
  // formattedAddress) is needed to name a multi-member region after a real
  // neighborhood/sublocality instead of just its single highest-scored
  // member's own place name -- see regionNameForCluster.
  return "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.rating,places.userRatingCount,places.editorialSummary,places.addressComponents";
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
  const text = String(mode || "").toLowerCase();
  if (text.includes("walk")) return "WALK";
  if (text.includes("transit")) return "TRANSIT";
  return "DRIVE";
}

// A representative weekday mid-morning departure a week out -- transit
// service patterns vary by day/time, so a fixed generic timestamp (e.g. an
// arbitrary past date, or literal "now" during a late-night generation run)
// can return sparse or off-hours schedules. This is only meant to produce a
// plausible transit itinerary for duration estimation, not a real booking.
function nextRepresentativeTransitDeparture() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(15, 0, 0, 0);
  return date.toISOString();
}

function durationSeconds(value) {
  if (typeof value === "number") return value;
  const match = String(value || "").match(/([\d.]+)s/);
  return match ? Number(match[1]) : Number(value || 0);
}

function compactName(parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).filter((part, index, array) => array.indexOf(part) === index).join(", ");
}

async function mapWithConcurrencyLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
