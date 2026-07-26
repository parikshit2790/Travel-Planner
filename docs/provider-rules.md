# Provider Rules

openrouteservice is connected as the production place and route provider when these server-side variables are configured:

- `PLACE_PROVIDER=openrouteservice`
- `ROUTE_PROVIDER=openrouteservice`
- `OPENROUTESERVICE_API_KEY=<secret key>`

`PLACE_API_KEY` and `ROUTE_API_KEY` remain accepted as generic fallback key slots, but `OPENROUTESERVICE_API_KEY` is preferred.

The website must not fake:

- Weather
- Aurora probability
- Opening hours
- Exact prices
- Live traffic-adjusted route times
- Reservation availability
- Restaurant suitability

Use deterministic logic for validation, conflicts, budget limits, physical restrictions, and alcohol/driving warnings.
