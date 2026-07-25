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

Copy `.env.example` and configure provider variables in Vercel.

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

Mock providers are for local development and deterministic tests. Public production worldwide claims require at least one real place-data provider and one real route-data provider. Do not put secret keys in public frontend variables.

## Server Routes

- `POST /api/locations/search`
- `POST /api/destinations/research`
- `POST /api/destination-profile`
- `POST /api/routes/estimate`
- `POST /api/weather/summary`
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
pnpm run build
```

Provider smoke tests should be added as `test:providers` once real provider credentials are configured. Do not run live-provider tests in CI without secrets.

## Known Limitations

- Current real-provider adapters are scaffolded behind server routes; mock mode is deterministic and not suitable for public worldwide claims.
- Weather returns seasonal guidance unless a weather provider is configured.
- Route estimates use configured provider data or explicitly labeled fallback estimates.
- Specific restaurants are included only when retrieved from a configured place provider.
