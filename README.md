# RouteMosaic Website

RouteMosaic is a destination-agnostic trip-planning MVP. The wizard collects origin, destination, dates, travelers, interests, food preferences, pace, mobility, driving, budget, and evening preferences, then generates an editable day-by-day itinerary.

## Architecture

The app separates the planning engine from destination data:

- `src/domain.js` stores wizard data, validation, traveler restrictions, and preference normalization.
- `src/destination-data.js` stores curated profiles and runtime provider profiles.
- `src/planner.js` schedules days from an injected destination profile.
- `api/*` serverless routes handle provider-backed location search, destination research, route estimates, weather guidance, trip generation, regeneration, and alternatives.

Destination-specific places must come from retrieved provider data, curated data, or explicit mock test data. The planner must not substitute Los Angeles, Detroit, or any other city for another destination.

## Environment

Copy `.env.example` locally, then configure the same variables in Vercel for Preview and Production.

```bash
PLACE_PROVIDER=google
PLACE_API_KEY=
GOOGLE_MAPS_API_KEY=
OPENROUTESERVICE_API_KEY=
ROUTE_PROVIDER=google
ROUTE_API_KEY=
WEATHER_PROVIDER=
WEATHER_API_KEY=
AI_PROVIDER=openai
OPENAI_API_KEY=
AI_MODEL=gpt-5-mini
PROVIDER_TIMEOUT_MS=10000
GOOGLE_REQUEST_TIMEOUT_MS=10000
OPENAI_REQUEST_TIMEOUT_MS=40000
PLANNER_REQUEST_TIMEOUT_MS=55000
FRONTEND_GENERATION_TIMEOUT_MS=65000
CACHE_TTL_SECONDS=86400
```

Supported provider adapters in this build:

- `PLACE_PROVIDER=mock` for local deterministic destination/place data.
- `PLACE_PROVIDER=openrouteservice` for live location autocomplete, geocoding, destination resolution, and destination point-of-interest discovery.
- `PLACE_PROVIDER=google` for Google Places API (New) autocomplete, place details, text search, nearby search, and destination discovery.
- `ROUTE_PROVIDER=mock` for local deterministic route estimates.
- `ROUTE_PROVIDER=approximate` for clearly labeled coordinate-style estimates.
- `ROUTE_PROVIDER=openrouteservice` for live driving and walking route duration and distance estimates.
- `ROUTE_PROVIDER=google` for Google Routes API route duration, distance, and route matrix smoke checks.
- Empty `WEATHER_PROVIDER` returns seasonal guidance only.
- `AI_PROVIDER=openai` enables AI-assisted destination intelligence for high-quality worldwide trip profiles. `OPENAI_API_KEY` must be set server-side only. `AI_API_KEY` is accepted as a legacy alias, but production should use `OPENAI_API_KEY`. In production, RouteMosaic treats live place/route providers without destination intelligence as not ready for full trip generation.

Mock providers are for local development and deterministic tests. Public production worldwide planning should use Google Places/Routes plus OpenAI destination intelligence. Do not put secret keys in public frontend variables.

### Google Maps Platform Setup

Recommended Production variables:

```bash
PLACE_PROVIDER=google
ROUTE_PROVIDER=google
GOOGLE_MAPS_API_KEY=<secret key>
AI_PROVIDER=openai
OPENAI_API_KEY=<secret key>
AI_MODEL=gpt-5-mini
PROVIDER_TIMEOUT_MS=10000
GOOGLE_REQUEST_TIMEOUT_MS=10000
OPENAI_REQUEST_TIMEOUT_MS=40000
PLANNER_REQUEST_TIMEOUT_MS=55000
FRONTEND_GENERATION_TIMEOUT_MS=65000
```

Enable these Google APIs in the same Google Cloud project as the key:

- Places API (New)
- Routes API

Temporary key restrictions for initial Vercel server-side verification:

- Application restrictions: None
- API restrictions: Restrict key to Places API (New) and Routes API

Do not use HTTP referrer restrictions for this server-side key. Vercel serverless functions call Google REST APIs from the server, not from the user's browser, so browser referrer restrictions can block valid production requests.

### openrouteservice Setup

Use these Vercel Environment Variables for live autocomplete, geocoding, and routing:

```bash
PLACE_PROVIDER=openrouteservice
ROUTE_PROVIDER=openrouteservice
OPENROUTESERVICE_API_KEY=<secret key>
PROVIDER_TIMEOUT_MS=10000
GOOGLE_REQUEST_TIMEOUT_MS=10000
OPENAI_REQUEST_TIMEOUT_MS=40000
PLANNER_REQUEST_TIMEOUT_MS=55000
FRONTEND_GENERATION_TIMEOUT_MS=65000
```

`OPENROUTESERVICE_API_KEY` is the preferred key variable. `PLACE_API_KEY` and `ROUTE_API_KEY` remain accepted as backward-compatible generic key slots, but a single `OPENROUTESERVICE_API_KEY` is recommended so the same secret powers autocomplete, geocoding, POI research, and routing.

Get the API key from the official openrouteservice dashboard at `https://openrouteservice.org/dev/`. Enable access for geocoding/autocomplete, POIs, and directions according to your openrouteservice account limits. After changing Vercel variables, redeploy the Production deployment.

### AI Destination Intelligence Setup

Use OpenAI for production destination research so RouteMosaic can generate strong trip profiles for arbitrary places such as Paris, Tokyo, Dallas, national parks, and smaller towns:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=<secret key>
AI_MODEL=gpt-5-mini
PROVIDER_TIMEOUT_MS=10000
GOOGLE_REQUEST_TIMEOUT_MS=10000
OPENAI_REQUEST_TIMEOUT_MS=40000
PLANNER_REQUEST_TIMEOUT_MS=55000
FRONTEND_GENERATION_TIMEOUT_MS=65000
```

With `AI_PROVIDER=openai`, RouteMosaic asks the server-side destination intelligence adapter to produce structured regions, must-do places, neighborhoods, food areas, and nearby excursions. Google Places/Routes power location autocomplete, place lookup, POI discovery, and route estimates. If AI research fails, the app falls back to provider/map data and clearly lower-confidence starter planning anchors.

### Admin Setup

1. For local development, create `website/.env.local` from `.env.example`.
2. Use `PLACE_PROVIDER=mock` and `ROUTE_PROVIDER=mock` only for deterministic development and tests.
3. Do not use `VITE_`, `NEXT_PUBLIC_`, or other client-exposed prefixes for provider keys.
4. On Vercel, add provider variables under Project Settings -> Environment Variables.
5. Set values separately for Production and Preview.
6. Redeploy after changing environment variables; already-built deployments do not pick up new values.
7. Keep API keys secret. No real keys belong in `.env.example`, README, frontend code, or committed files.
8. Enable required provider billing, restrict keys to approved APIs where supported, and use HTTPS endpoints with timeouts below the Vercel runtime limit.
9. For RouteMosaic production, verify `/api/provider-health` after redeploying. It should return `success: true`, `data.mode: "live"`, `data.canGenerate: true`, `data.aiProviderAvailable: true`, `data.placeProviderAvailable: true`, `data.destinationResearchAvailable: true`, and `data.routeProviderAvailable: true`.

Expected development provider status:

```json
{
  "available": true,
  "status": "available",
  "canGenerate": true,
  "placeProvider": { "configured": true, "provider": "mock", "missingVariables": [], "status": "available" },
  "routeProvider": { "configured": true, "provider": "mock", "missingVariables": [], "status": "available" }
}
```

The public UI intentionally shows only a generic temporary-unavailable message when providers are missing. Exact missing variables are shown only in the development diagnostics panel.

## Server Routes

- `POST /api/planner` with an `action` body for destination research, trip generation, regeneration, alternatives, route estimates, and weather summaries.
- `POST /api/locations` with an `action` body for location search and future location-resolution actions.
- `GET /api/provider-health` for safe browser checks and `POST /api/provider-health` with an `action` body for public provider availability and development-only diagnostics.

The SPA rewrite excludes `/api/*` so Vercel functions are not intercepted by `index.html`.

## Data Pipeline

1. Resolve origin and destination.
2. Decide the trip shape before detailed daily scheduling: one city, one base with day trips, multi-city, road trip, fly-and-drive, or point-to-point.
3. Evaluate destination depth before recommending expansion. A longer trip does not automatically require another city.
4. Suggest nearby cities only when the destination expansion score justifies added experience value against transfer burden, hotel changes, budget, traveler comfort, and date count.
5. Require explicit user approval before a multi-city route or nearby destination can be used by the detailed itinerary engine.
6. Research destination via configured providers.
7. Normalize regions, places, food areas, route estimates, and metadata.
8. Register the generated profile client-side.
9. Inject the profile and approved trip shape into the planner.
10. Score and group nearby activities.
11. Add meals, travel, buffers, evenings, backups, budget, hotel-base suggestion, and advisories.
12. Validate the structured plan.

Every activity keeps source metadata: provider, provider place ID, retrieved name, retrieval time, confidence, freshness, and source URL when available.

## Trip Shape Rules

- Trip shape must be decided before daily activity scheduling.
- Trip Description captures intent; structured fields remain the source of truth.
- Extracted Trip Description preferences require user review before they become canonical preferences.
- Nearby cities may be suggested, but they must never be silently added.
- Multi-city routes require explicit user approval before detailed itinerary generation.
- Hotel changes, transfer burden, arrival/departure logistics, and day-trip driving limits must be scored before route approval.
- Approved route options are the source of truth for final itinerary destinations.
- The final itinerary must use only approved destinations and validated places.
- If the user sets zero hotel changes, multi-base options must be excluded.
- Broad destinations must be clarified or represented as route concepts before detailed generation.

## Trust Rules

RouteMosaic must not fabricate attractions, restaurants, routes, opening hours, prices, or weather. Availability, hours, prices, accessibility, dietary safety, weather, and travel times must be verified before travel. Exact hotel, flight, or ticket prices are not claimed unless a live approved provider supplies them.

## Local Run

```bash
cd website
python3 -m http.server 5174
```

Static local hosting does not run Vercel API functions. Use Vercel dev or deploy preview when testing `/api/*`.

## Validation

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run test:providers
pnpm run build
pnpm run verify:vercel-functions
```

`test:providers` checks the mock contract, openrouteservice adapter contract, and Google/OpenAI provider contract with mocked network responses. Google coverage includes Raleigh, Austin, Houston, Charlotte, Dallas, Detroit, one route, one route matrix, and provider-health aggregation. Do not run live-provider smoke tests in CI without secrets.

`pnpm test:openai` performs one server-side OpenAI Responses API smoke check with the configured `OPENAI_API_KEY` and `AI_MODEL`. It prints only safe status, model, HTTP status, structured-output validity, duration, and sanitized error code.

`verify:vercel-functions` reads `.vercel/output/functions` when Vercel output exists. Otherwise it counts deployable source route files under `api/`, `pages/api/`, `src/api/`, `app/api/`, and `functions/`. Keep shared server helpers outside `api/` so Vercel does not count them as functions. The RouteMosaic limit is 11 functions, keeping deployment safely under the Hobby-plan cap of 12.

## Known Limitations

- Google Places and Routes provide live provider data for location search, POI discovery, and driving/walking route estimates, but RouteMosaic still labels opening hours, availability, prices, accessibility, dietary safety, traffic, and weather as items to verify directly before travel.
- Weather returns seasonal guidance unless a weather provider is configured.
- Route estimates use configured provider data or explicitly labeled fallback estimates.
- Specific restaurants are included only when retrieved from a configured place provider.
