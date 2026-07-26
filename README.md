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
PLACE_PROVIDER=mock
PLACE_API_KEY=
ROUTE_PROVIDER=mock
ROUTE_API_KEY=
WEATHER_PROVIDER=
WEATHER_API_KEY=
AI_PROVIDER=
AI_API_KEY=
AI_MODEL=gpt-4.1-mini
PROVIDER_TIMEOUT_MS=10000
CACHE_TTL_SECONDS=86400
```

Supported provider adapters in this build:

- `PLACE_PROVIDER=mock` for local deterministic destination/place data.
- `ROUTE_PROVIDER=mock` for local deterministic route estimates.
- `ROUTE_PROVIDER=approximate` for clearly labeled coordinate-style estimates.
- Empty `WEATHER_PROVIDER` returns seasonal guidance only.
- `AI_PROVIDER` and `AI_API_KEY`/`OPENAI_API_KEY` are reserved for future enrichment and are not required for current deterministic generation.

Mock providers are for local development and deterministic tests. Public production worldwide claims require at least one real place-data provider adapter and one real route-data provider adapter. Do not put secret keys in public frontend variables.

### Admin Setup

1. For local development, create `website/.env.local` from `.env.example`.
2. Use `PLACE_PROVIDER=mock` and `ROUTE_PROVIDER=mock` only for deterministic development and tests.
3. Do not use `VITE_`, `NEXT_PUBLIC_`, or other client-exposed prefixes for provider keys.
4. On Vercel, add provider variables under Project Settings -> Environment Variables.
5. Set values separately for Production and Preview.
6. Redeploy after changing environment variables; already-built deployments do not pick up new values.
7. Keep API keys secret. No real keys belong in `.env.example`, README, frontend code, or committed files.
8. When real place/route adapters are added, enable required provider billing, restrict keys to approved APIs/domains where supported, and use HTTPS endpoints with timeouts below the Vercel runtime limit.

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

- `POST /api/locations/search`
- `POST /api/destinations/research`
- `POST /api/destination-profile`
- `POST /api/routes/estimate`
- `POST /api/weather/summary`
- `POST /api/providers/status`
- `POST /api/trips/generate`
- `POST /api/trips/regenerate-day`
- `POST /api/trips/regenerate-meals`
- `POST /api/activities/alternatives`

The SPA rewrite excludes `/api/*` so Vercel functions are not intercepted by `index.html`.

## Data Pipeline

1. Resolve origin and destination.
2. Research destination via configured providers.
3. Normalize regions, places, food areas, route estimates, and metadata.
4. Register the generated profile client-side.
5. Inject the profile into the planner.
6. Score and group nearby activities.
7. Add meals, travel, buffers, evenings, backups, budget, hotel-base suggestion, and advisories.
8. Validate the structured plan.

Every activity keeps source metadata: provider, provider place ID, retrieved name, retrieval time, confidence, freshness, and source URL when available.

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
```

`test:providers` currently checks the provider contract with deterministic mock data. Expand it to live-provider smoke tests only after real adapters and credentials are available. Do not run live-provider tests in CI without secrets.

## Known Limitations

- Current real-provider adapters are scaffolded behind server routes; mock mode is deterministic and not suitable for public worldwide claims.
- Weather returns seasonal guidance unless a weather provider is configured.
- Route estimates use configured provider data or explicitly labeled fallback estimates.
- Specific restaurants are included only when retrieved from a configured place provider.
