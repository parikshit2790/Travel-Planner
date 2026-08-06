const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_SOURCE_URL = "https://openai.com";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_TIMEOUT_MS = 40000;

export async function openAiDestinationResearch(destination, trip = {}, config = {}) {
  const apiKey = config.aiApiKey || "";
  if (!apiKey) throw aiProviderError("OPENAI_API_KEY_REQUIRED", "AI destination research is not configured.", false, 500);
  const destinationName = String(trip?.destinationDisplay || trip?.destination || destination || "").trim();
  if (!destinationName) throw aiProviderError("DESTINATION_REQUIRED", "Destination is required.", false, 400);
  const { response, json } = await postOpenAiResponse(config, {
      model: openAiModel(config),
      input: [
        {
          role: "system",
          content: "You are RouteMosaic's destination intelligence engine. Create practical, followable vacation planning data. Include must-see attractions, neighborhoods, food districts, seasonal cautions, nearby day trips, and realistic grouping. Do not invent operating hours, current availability, prices, or guarantees. Return JSON only."
        },
        {
          role: "user",
          content: destinationPrompt(destinationName, trip)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "route_mosaic_destination_profile",
          strict: false,
          schema: destinationProfileSchema()
        }
      },
      max_output_tokens: 9000
    });
  if (!response.ok) {
    throw openAiErrorFromResponse(response, json, "AI destination research failed.");
  }
  const parsed = parseStructuredOutput(json);
  const profile = normalizeAiDestinationProfile(parsed, destinationName);
  if (!profile) throw aiProviderError("AI_DESTINATION_RESEARCH_INVALID", "AI destination research returned unusable planning data.", true, 502);
  return profile;
}

export async function openAiSmokeCheck(config = {}) {
  const apiKey = config.aiApiKey || "";
  if (!apiKey) throw aiProviderError("OPENAI_API_KEY_REQUIRED", "AI destination research is not configured.", false, 500);
  const model = openAiModel(config);
  const startedAt = Date.now();
  const { response, json } = await postOpenAiResponse(config, {
      model,
      input: [
        {
          role: "system",
          content: "Return only the requested structured JSON. No prose."
        },
        {
          role: "user",
          content: "Return ok=true and provider=openai."
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "route_mosaic_openai_smoke",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok", "provider"],
            properties: {
              ok: { type: "boolean" },
              provider: { type: "string" }
            }
          }
        }
      },
      max_output_tokens: 300
    });
  if (!response.ok) {
    throw openAiErrorFromResponse(response, json, "AI smoke check failed.");
  }
  let parsed;
  try {
    parsed = parseStructuredOutput(json);
  } catch {
    throw aiProviderError("AI_INVALID_RESPONSE", "AI smoke check returned malformed structured output.", true, 502);
  }
  if (parsed?.ok !== true || parsed?.provider !== "openai") {
    throw aiProviderError("AI_INVALID_RESPONSE", "AI smoke check returned an invalid response.", true, 502);
  }
  return {
    ok: true,
    provider: "openai",
    model,
    httpStatus: response.status,
    durationMs: Date.now() - startedAt
  };
}

async function postOpenAiResponse(config, body) {
  const apiKey = config.aiApiKey || "";
  if (!apiKey) throw aiProviderError("OPENAI_API_KEY_REQUIRED", "AI destination research is not configured.", false, 500);
  const timeoutMs = Number(config.openAiRequestTimeoutMs || config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  } catch (error) {
    if (error?.name === "AbortError") throw aiProviderError("AI_TIMEOUT", "AI destination research timed out.", true, 408);
    throw aiProviderError("AI_PROVIDER_UNAVAILABLE", "AI destination research network request failed.", true, 503);
  } finally {
    clearTimeout(timeoutId);
  }
}

function openAiModel(config) {
  return clean(config.aiModel) || DEFAULT_OPENAI_MODEL;
}

function openAiErrorFromResponse(response, json, fallbackMessage) {
  const status = Number(response?.status || 0);
  const message = publicOpenAiMessage(json);
  const rawCode = String(json?.error?.code || json?.error?.type || "").toLowerCase();
  const combined = `${rawCode} ${message}`.toLowerCase();
  if (status === 401) return aiProviderError("AI_AUTH_FAILED", "AI authentication failed.", false, status);
  if (status === 403) return aiProviderError("AI_PERMISSION_DENIED", "AI provider permission denied.", false, status);
  if (status === 404 && /model|not found|does not exist/.test(combined)) return aiProviderError("AI_MODEL_UNAVAILABLE", "Configured AI model is unavailable.", false, status);
  if (status === 429 && /quota|billing|insufficient|credit/.test(combined)) return aiProviderError("AI_QUOTA_EXCEEDED", "AI provider quota or billing is unavailable.", true, status);
  if (status === 429) return aiProviderError("AI_RATE_LIMITED", "AI provider is rate limited.", true, status);
  if (status === 400 && /model|unsupported/.test(combined)) return aiProviderError("AI_MODEL_UNAVAILABLE", "Configured AI model is unavailable.", false, status);
  if (status === 400) return aiProviderError("AI_INVALID_REQUEST", message || fallbackMessage, false, status);
  if (status >= 500) return aiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider is temporarily unavailable.", true, status);
  return aiProviderError("AI_PROVIDER_UNAVAILABLE", message || fallbackMessage, status >= 500, status || 503);
}

function destinationPrompt(destinationName, trip) {
  return [
    `Destination: ${destinationName}`,
    `Origin: ${trip?.fromDisplay || trip?.from || "not provided"}`,
    `Trip dates: ${trip?.startDate || "not provided"} to ${trip?.endDate || "not provided"}`,
    `Days: ${trip?.days || trip?.numberOfDays || "not provided"}`,
    `Travelers: adults ${trip?.adults ?? ""}, children ${trip?.children ?? ""}, seniors ${trip?.seniors ?? ""}`,
    `Transportation: ${trip?.transportation || "not provided"}`,
    `Pace: ${trip?.schedule?.pace || "Balanced"}`,
    "Create a destination profile a vacation planner can schedule directly. One short sentence per description; keep the whole response compact and fast to generate.",
    "Include 6-7 regions/neighborhoods, 14-18 places, 4-6 food areas, and 2-4 routes or nearby excursions.",
    "Places must mix iconic must-dos, neighborhoods, weather backups, food/market anchors, outdoor options, and nearby day trips. Prioritize destination-defining, officially significant experiences over ordinary suburban parks, farms, recreation centers, schools, offices, or generic local facilities; skip family entertainment centers, hotels, and generic search-result businesses unless explicitly requested.",
    "Food candidates must be actual named restaurants, cafes, bakeries, food halls, or bars/breweries covering breakfast, lunch, dinner, and cafes separately -- never an attraction, a neighborhood, or a generic 'area'. Do not repeat the same restaurant pair across the whole trip.",
    "Every destination type (including major cities) sits within a broader travel region. If the trip is 4+ days, include a compact regionalDestinationProfile (primaryDestination, gatewayTowns, metroOrTourismRegion, nearbyDayTrips, overnightExtensions, regionalConfidence) naming real, well-known nearby destinations worth a day trip or a one-night extension within roughly a 4-hour drive -- for example a major city's nearest mountains, coast, or a famous regional draw, not just in-city options. Also include regionalCandidateCities: an array of up to 3 of the single strongest options as plain geocodable \"City, State\" or \"City, Country\" names only (for example \"Asheville, NC\"), ranked best first -- no descriptions, just the names, so they can be looked up directly. For mountain, national-park, lake, coastal, island, wine-country, or resort destinations specifically, also name real scenic corridors and trail/waterfall places instead of using the park name as one generic activity. Do not silently add a second overnight base -- extensions are optional information for the traveler to approve.",
    "This has no live web access, so only include well-established, long-standing places you are confident are still operating; skip anything you're unsure has closed, renamed, or changed recently. Use current-status language: no discontinued tours or stale former-venue identities.",
    "Never include internal provider wording (candidate, Google Places, openrouteservice, category slug, central-area, culture-area, food-area, raw taxonomy labels) in any name or description."
  ].join("\n");
}

function parseStructuredOutput(json) {
  if (json?.output_text) return JSON.parse(json.output_text);
  const chunks = [];
  for (const item of json?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" || content?.type === "text") chunks.push(content.text);
    }
  }
  const text = chunks.join("").trim();
  if (!text) return null;
  return JSON.parse(text);
}

function normalizeAiDestinationProfile(raw, fallbackName) {
  if (!raw || typeof raw !== "object") return null;
  const canonicalName = clean(raw.canonicalName) || fallbackName;
  const regions = normalizeRegions(raw.regions, canonicalName);
  const basePlaces = normalizePlaces(raw.places, regions);
  const foodAreas = normalizeFoodAreas(raw.foodAreas, regions);
  const places = mergeFoodAreasIntoPlaces(basePlaces, foodAreas);
  const scenicRoutes = normalizeRoutes(raw.scenicRoutes, regions);
  if (regions.length < 4 || places.length < 8 || foodAreas.length < 3) return null;
  return {
    id: `ai-${slug(canonicalName)}`,
    canonicalName,
    aliases: uniqueStrings([canonicalName.toLowerCase(), ...(raw.aliases || [])]),
    country: clean(raw.country),
    state: clean(raw.state),
    timezone: clean(raw.timezone),
    currency: clean(raw.currency) || "USD",
    summary: cleanPublicPlanningText(raw.summary) || `${canonicalName} destination profile generated from destination research.`,
    seasonalNotes: strings(raw.seasonalNotes, 5),
    generalAdvisories: [
      ...strings(raw.generalAdvisories, 5),
      "Verify current hours, timed tickets, closures, accessibility, menus, prices, and transportation conditions before booking or traveling."
    ].slice(0, 6),
    planningRules: {
      defaultHotelRegion: clean(raw.planningRules?.defaultHotelRegion) || regions[0].id,
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions,
    places,
    foodAreas,
    scenicRoutes,
    scenicCorridors: normalizeScenicCorridors(raw.scenicCorridors, regions),
    hikesAndWaterfalls: normalizeHikesAndWaterfalls(raw.hikesAndWaterfalls, regions),
    regionalDestinationProfile: normalizeRegionalDestinationProfile(raw.regionalDestinationProfile),
    sourceMetadata: {
      provider: "openai",
      retrievedAt: new Date().toISOString(),
      freshness: "ai-assisted-destination-research",
      candidateCount: places.length,
      sourceUrl: OPENAI_SOURCE_URL
    }
  };
}

function mergeFoodAreasIntoPlaces(places, foodAreas) {
  const existingNames = new Set(places.map((place) => place.name.toLowerCase()));
  const foodPlaces = foodAreas
    .filter((area) => !existingNames.has(area.name.toLowerCase()))
    .map((area, index) => ({
      id: slug(`food-${area.name}-${index}`),
      name: area.name,
      regionId: area.regionId,
      shortDescription: area.shortDescription || `${area.name} is a dining option; confirm menu, hours, and dietary fit directly.`,
      categories: ["restaurant", "food"],
      tags: ["restaurant", ...(area.mealTypes?.length ? area.mealTypes : ["lunch", "dinner"]), ...(area.cuisines || []).slice(0, 2)],
      suitableFor: ["solo", "couple", "family", "senior"],
      typicalDurationMinutes: 70,
      minimumDurationMinutes: 40,
      maximumDurationMinutes: 120,
      estimatedCostLow: area.budgetLevels?.includes("budget") ? 10 : 20,
      estimatedCostHigh: area.budgetLevels?.includes("premium") ? 90 : 50,
      indoorOutdoor: "indoor",
      weatherDependency: "low",
      accessibility: "moderate",
      dietaryRelevance: area.dietarySupport?.length ? area.dietarySupport : ["confirm dietary needs directly"],
      openingTimeGuidance: "Confirm current opening hours before travel.",
      bestTimeOfDay: area.mealTypes?.includes("breakfast") ? "morning" : area.mealTypes?.includes("dinner") ? "dinner" : "lunch",
      reservationRecommended: area.mealTypes?.includes("dinner"),
      seasonalNotes: [],
      conflictTags: [],
      priorityScore: 72 - index,
      coordinates: null,
      backupForTags: [],
      sourceMetadata: {
        provider: "openai",
        providerPlaceId: slug(`food-${area.name}-${index}`),
        retrievedName: area.name,
        retrievedAt: new Date().toISOString(),
        sourceUrl: OPENAI_SOURCE_URL,
        dataConfidence: "ai-assisted",
        dataFreshness: "ai-assisted-destination-research"
      }
    }));
  return [...places, ...foodPlaces];
}

function normalizeRegions(value, canonicalName) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 12).map((item, index) => ({
    id: slug(item.id || item.name || `region-${index + 1}`),
    name: cleanPublicPlanningText(item.name),
    summary: cleanPublicPlanningText(item.summary) || `Planning area in ${canonicalName}.`,
    centerCoordinates: coordinates(item.centerCoordinates),
    tags: strings(item.tags, 8),
    neighboringRegionIds: strings(item.neighboringRegionIds, 8).map(slug),
    typicalTravelMinutesToRegions: {}
  }));
}

function normalizePlaces(value, regions) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 36).map((item, index) => {
    const regionId = regionIdFor(item.regionId, regions, index);
    const categories = strings(item.categories, 8);
    return {
      id: slug(item.id || item.name || `place-${index + 1}`),
      name: cleanPublicPlanningText(item.name),
      regionId,
      shortDescription: cleanPublicPlanningText(item.shortDescription) || "Destination research stop. Verify details before travel.",
      categories: categories.length ? categories : ["culture"],
      tags: strings(item.tags, 10),
      suitableFor: strings(item.suitableFor, 6).length ? strings(item.suitableFor, 6) : ["solo", "couple", "family", "senior"],
      typicalDurationMinutes: clampNumber(item.typicalDurationMinutes, 45, 480, 90),
      minimumDurationMinutes: clampNumber(item.minimumDurationMinutes, 30, 240, 45),
      maximumDurationMinutes: clampNumber(item.maximumDurationMinutes, 60, 600, 150),
      estimatedCostLow: clampNumber(item.estimatedCostLow, 0, 500, 0),
      estimatedCostHigh: clampNumber(item.estimatedCostHigh, 0, 1000, 40),
      indoorOutdoor: clean(item.indoorOutdoor) || "mixed",
      weatherDependency: clean(item.weatherDependency) || "medium",
      accessibility: clean(item.accessibility) || "moderate",
      dietaryRelevance: strings(item.dietaryRelevance, 6),
      openingTimeGuidance: cleanPublicPlanningText(item.openingTimeGuidance) || "Confirm current opening hours before travel.",
      bestTimeOfDay: clean(item.bestTimeOfDay) || (categories.includes("food") ? "lunch" : "afternoon"),
      reservationRecommended: Boolean(item.reservationRecommended),
      seasonalNotes: strings(item.seasonalNotes, 4),
      conflictTags: strings(item.conflictTags, 6),
      priorityScore: clampNumber(item.priorityScore, 40, 100, Math.max(55, 95 - index)),
      coordinates: coordinates(item.coordinates),
      backupForTags: strings(item.backupForTags, 8),
      sourceMetadata: {
        provider: "openai",
        providerPlaceId: slug(item.id || item.name || `place-${index + 1}`),
        retrievedName: cleanPublicPlanningText(item.name),
        retrievedAt: new Date().toISOString(),
        sourceUrl: OPENAI_SOURCE_URL,
        dataConfidence: "ai-assisted",
        dataFreshness: "ai-assisted-destination-research"
      }
    };
  });
}

function normalizeFoodAreas(value, regions) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 12).map((item, index) => ({
    id: slug(item.id || item.name || `food-${index + 1}`),
    name: cleanPublicPlanningText(item.name),
    regionId: regionIdFor(item.regionId, regions, index),
    cuisines: strings(item.cuisines, 10),
    mealTypes: strings(item.mealTypes, 5),
    budgetLevels: strings(item.budgetLevels, 5),
    dietarySupport: strings(item.dietarySupport, 10),
    eveningSuitability: strings(item.eveningSuitability, 6),
    shortDescription: cleanPublicPlanningText(item.shortDescription) || "Food area from destination research; verify menus directly."
  }));
}

function normalizeRoutes(value, regions) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 12).map((item, index) => ({
    id: slug(item.id || item.name || `route-${index + 1}`),
    name: cleanPublicPlanningText(item.name),
    originRegionId: regionIdFor(item.originRegionId, regions, index),
    destinationRegionId: regionIdFor(item.destinationRegionId, regions, index + 1),
    estimatedDriveMinutes: clampNumber(item.estimatedDriveMinutes, 5, 360, 25),
    estimatedDistanceMiles: clampNumber(item.estimatedDistanceMiles, 1, 250, 8),
    tags: strings(item.tags, 8),
    bestTimeOfDay: clean(item.bestTimeOfDay) || "afternoon",
    notes: cleanPublicPlanningText(item.notes) || "Verify current route conditions before departure.",
    start: cleanPublicPlanningText(item.start),
    end: cleanPublicPlanningText(item.end),
    recommendedStops: strings(item.recommendedStops, 12).map(cleanPublicPlanningText),
    overlooks: strings(item.overlooks, 10).map(cleanPublicPlanningText),
    hikes: strings(item.hikes, 10).map(cleanPublicPlanningText),
    waterfalls: strings(item.waterfalls, 10).map(cleanPublicPlanningText),
    parking: cleanPublicPlanningText(item.parking),
    seasonalClosures: strings(item.seasonalClosures, 6).map(cleanPublicPlanningText),
    daylightRequired: Boolean(item.daylightRequired),
    offlineMapRecommended: Boolean(item.offlineMapRecommended),
    fullExperienceDurationMinutes: clampNumber(item.fullExperienceDurationMinutes, 30, 600, clampNumber(item.estimatedDriveMinutes, 5, 360, 25))
  }));
}

function normalizeScenicCorridors(value, regions) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 14).map((item, index) => ({
    id: slug(item.id || item.name || `corridor-${index + 1}`),
    name: cleanPublicPlanningText(item.name),
    start: cleanPublicPlanningText(item.start),
    end: cleanPublicPlanningText(item.end),
    originRegionId: regionIdFor(item.originRegionId, regions, index),
    destinationRegionId: regionIdFor(item.destinationRegionId, regions, index + 1),
    routeDistanceMiles: clampNumber(item.routeDistanceMiles || item.estimatedDistanceMiles, 0, 250, 0),
    routeDurationMinutes: clampNumber(item.routeDurationMinutes || item.estimatedDriveMinutes, 0, 360, 0),
    recommendedStops: strings(item.recommendedStops, 14).map(cleanPublicPlanningText),
    overlooks: strings(item.overlooks, 12).map(cleanPublicPlanningText),
    hikes: strings(item.hikes, 12).map(cleanPublicPlanningText),
    waterfalls: strings(item.waterfalls, 12).map(cleanPublicPlanningText),
    parking: cleanPublicPlanningText(item.parking),
    seasonalClosures: strings(item.seasonalClosures, 8).map(cleanPublicPlanningText),
    daylightRequired: Boolean(item.daylightRequired),
    offlineMapRecommended: Boolean(item.offlineMapRecommended),
    fullExperienceDurationMinutes: clampNumber(item.fullExperienceDurationMinutes, 30, 600, item.routeDurationMinutes || 180),
    sourceMetadata: { provider: "openai", dataConfidence: "ai-assisted", sourceUrl: OPENAI_SOURCE_URL }
  }));
}

function normalizeHikesAndWaterfalls(value, regions) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.trailName || item?.name).slice(0, 20).map((item, index) => ({
    id: slug(item.id || item.trailName || item.name || `trail-${index + 1}`),
    trailName: cleanPublicPlanningText(item.trailName || item.name),
    trailhead: cleanPublicPlanningText(item.trailhead),
    regionId: regionIdFor(item.regionId, regions, index),
    coordinates: coordinates(item.coordinates),
    parking: cleanPublicPlanningText(item.parking),
    roundTripDistanceMiles: clampNumber(item.roundTripDistanceMiles, 0, 30, 0),
    elevationGainFeet: clampNumber(item.elevationGainFeet, 0, 8000, 0),
    estimatedDurationMinutes: clampNumber(item.estimatedDurationMinutes, 30, 600, 120),
    difficulty: cleanPublicPlanningText(item.difficulty),
    terrain: cleanPublicPlanningText(item.terrain),
    waterfallOrViewpoint: cleanPublicPlanningText(item.waterfallOrViewpoint),
    crowdLevel: cleanPublicPlanningText(item.crowdLevel),
    earlyStartRecommended: Boolean(item.earlyStartRecommended),
    seasonalCondition: cleanPublicPlanningText(item.seasonalCondition),
    weatherSensitivity: cleanPublicPlanningText(item.weatherSensitivity),
    travelerFit: cleanPublicPlanningText(item.travelerFit),
    backupOption: cleanPublicPlanningText(item.backupOption),
    sourceConfidence: clean(item.sourceConfidence) || "ai-assisted",
    sourceMetadata: { provider: "openai", dataConfidence: "ai-assisted", sourceUrl: OPENAI_SOURCE_URL }
  }));
}

function normalizeRegionalDestinationProfile(value) {
  if (!value || typeof value !== "object") return null;
  return {
    primaryDestination: cleanPublicPlanningText(value.primaryDestination),
    gatewayTowns: strings(value.gatewayTowns, 8).map(cleanPublicPlanningText),
    metroOrTourismRegion: cleanPublicPlanningText(value.metroOrTourismRegion || value.tourismRegion),
    parkRelationship: cleanPublicPlanningText(value.parkRelationship),
    majorGeographicZones: strings(value.majorGeographicZones, 12).map(cleanPublicPlanningText),
    scenicCorridors: strings(value.scenicCorridors, 12).map(cleanPublicPlanningText),
    entertainmentZones: strings(value.entertainmentZones, 10).map(cleanPublicPlanningText),
    foodZones: strings(value.foodZones, 10).map(cleanPublicPlanningText),
    realisticBaseOptions: strings(value.realisticBaseOptions, 8).map(cleanPublicPlanningText),
    nearbyDayTrips: strings(value.nearbyDayTrips, 12).map(cleanPublicPlanningText),
    overnightExtensions: strings(value.overnightExtensions, 8).map(cleanPublicPlanningText),
    regionalCandidateCities: strings(value.regionalCandidateCities, 3).map(clean).filter((name) => name.length <= 60 && /^[a-z0-9][a-z0-9 .'\-]*,\s*[a-z0-9][a-z0-9 .'\-]*$/i.test(name)),
    regionalConfidence: clean(value.regionalConfidence) || "medium"
  };
}

function destinationProfileSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["canonicalName", "aliases", "country", "state", "timezone", "currency", "summary", "seasonalNotes", "generalAdvisories", "planningRules", "regions", "places", "foodAreas", "scenicRoutes"],
    properties: {
      canonicalName: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
      country: { type: "string" },
      state: { type: "string" },
      timezone: { type: "string" },
      currency: { type: "string" },
      summary: { type: "string" },
      seasonalNotes: { type: "array", items: { type: "string" } },
      generalAdvisories: { type: "array", items: { type: "string" } },
      planningRules: { type: "object", additionalProperties: true },
      regions: { type: "array", items: { type: "object", additionalProperties: true } },
      places: { type: "array", items: { type: "object", additionalProperties: true } },
      foodAreas: { type: "array", items: { type: "object", additionalProperties: true } },
      scenicRoutes: { type: "array", items: { type: "object", additionalProperties: true } },
      scenicCorridors: { type: "array", items: { type: "object", additionalProperties: true } },
      hikesAndWaterfalls: { type: "array", items: { type: "object", additionalProperties: true } },
      regionalDestinationProfile: { type: ["object", "null"], additionalProperties: true }
    }
  };
}

function regionIdFor(value, regions, index) {
  const id = slug(value || "");
  if (regions.some((region) => region.id === id)) return id;
  return regions[index % regions.length]?.id || regions[0]?.id || "central-area";
}

function strings(value, limit) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, limit) : [];
}

function uniqueStrings(value) {
  return [...new Set(strings(value, 20))];
}

function coordinates(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPublicPlanningText(value) {
  return clean(value)
    .replace(/\bGoogle Places\s+\w+\s+candidate\b/ig, "destination research stop")
    .replace(/\bGoogle Places candidate\b/ig, "destination research stop")
    .replace(/\bopenrouteservice point-of-interest candidate\b/ig, "destination research stop")
    .replace(/\bprovider[- ]?(found|retrieved)\b/ig, "researched")
    .replace(/\bcentral-area\b/ig, "downtown area")
    .replace(/\bculture-area\b/ig, "museum and landmark area")
    .replace(/\bnature-area\b/ig, "outdoor area")
    .replace(/\bfood-area\b/ig, "restaurant area")
    .replace(/\bCentral area\b/g, "Downtown area")
    .replace(/\bCulture and landmarks\b/g, "Museums and landmarks")
    .replace(/\bFood and evening area\b/g, "Restaurant and evening area")
    .replace(/\braw slug\b/ig, "planning label");
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "item";
}

function publicOpenAiMessage(json) {
  return String(json?.error?.message || json?.message || "").replace(/api[_ -]?key|bearer\s+[a-z0-9._-]+/ig, "credentials").slice(0, 180);
}

function aiProviderError(code, message, retryable = false, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.status = status;
  return error;
}
