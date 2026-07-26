const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_SOURCE_URL = "https://openai.com";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_TIMEOUT_MS = 10000;

export async function openAiDestinationResearch(destination, trip = {}, config = {}) {
  const apiKey = config.aiApiKey || "";
  if (!apiKey) throw aiProviderError("OPENAI_API_KEY_REQUIRED", "AI destination research is not configured.", false, 500);
  const destinationName = String(trip?.destinationDisplay || trip?.destination || destination || "").trim();
  if (!destinationName) throw aiProviderError("DESTINATION_REQUIRED", "Destination is required.", false, 400);
  const { response, json } = await postOpenAiResponse(config, {
      model: openAiModel(config),
      tools: [{ type: "web_search_preview" }],
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
      max_output_tokens: 7000
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
  const timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
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
    "Create a destination profile that a vacation planner can schedule directly.",
    "Include 8-12 regions/neighborhoods, 20-32 places, 6-10 food areas, and 5-10 routes or nearby excursions.",
    "Places must include iconic must-dos, local neighborhoods, weather backups, food/market anchors, scenic/outdoor options, and nearby day trips when appropriate.",
    "For Paris, for example, this should include major first-time anchors, neighborhoods, Seine/walkable moments, food districts, and nearby Versailles/Giverny-style excursions when appropriate."
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
  const places = normalizePlaces(raw.places, regions);
  const foodAreas = normalizeFoodAreas(raw.foodAreas, regions);
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
    summary: clean(raw.summary) || `${canonicalName} destination profile generated from live destination research.`,
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
    sourceMetadata: {
      provider: "openai",
      retrievedAt: new Date().toISOString(),
      freshness: "ai-assisted-destination-research",
      candidateCount: places.length,
      sourceUrl: OPENAI_SOURCE_URL
    }
  };
}

function normalizeRegions(value, canonicalName) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 12).map((item, index) => ({
    id: slug(item.id || item.name || `region-${index + 1}`),
    name: clean(item.name),
    summary: clean(item.summary) || `Planning area in ${canonicalName}.`,
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
      name: clean(item.name),
      regionId,
      shortDescription: clean(item.shortDescription) || "Destination-research candidate. Verify details before travel.",
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
      openingTimeGuidance: clean(item.openingTimeGuidance) || "Confirm current opening hours before travel.",
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
        retrievedName: clean(item.name),
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
    name: clean(item.name),
    regionId: regionIdFor(item.regionId, regions, index),
    cuisines: strings(item.cuisines, 10),
    mealTypes: strings(item.mealTypes, 5),
    budgetLevels: strings(item.budgetLevels, 5),
    dietarySupport: strings(item.dietarySupport, 10),
    eveningSuitability: strings(item.eveningSuitability, 6),
    shortDescription: clean(item.shortDescription) || "Food area from destination research; verify menus directly."
  }));
}

function normalizeRoutes(value, regions) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => item?.name).slice(0, 12).map((item, index) => ({
    id: slug(item.id || item.name || `route-${index + 1}`),
    name: clean(item.name),
    originRegionId: regionIdFor(item.originRegionId, regions, index),
    destinationRegionId: regionIdFor(item.destinationRegionId, regions, index + 1),
    estimatedDriveMinutes: clampNumber(item.estimatedDriveMinutes, 5, 360, 25),
    estimatedDistanceMiles: clampNumber(item.estimatedDistanceMiles, 1, 250, 8),
    tags: strings(item.tags, 8),
    bestTimeOfDay: clean(item.bestTimeOfDay) || "afternoon",
    notes: clean(item.notes) || "Verify current route conditions before departure."
  }));
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
      scenicRoutes: { type: "array", items: { type: "object", additionalProperties: true } }
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
