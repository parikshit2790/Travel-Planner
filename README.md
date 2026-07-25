# RouteMosaic Website

This fresh website-first version focuses on the personalization intake, because that is the core of generating different itineraries for different travelers.

## Run

```bash
cd website
python3 -m http.server 5174
```

Open `http://127.0.0.1:5174`.

## What Works

- Six-step guided planning flow
- Quick planning from a plain-English trip description
- Structured preference interpretation while preserving original text
- Group type, traveler counts, traveler-specific notes
- Environment, experience, atmosphere, food, alcohol, lodging, transportation, comfort, and budget inputs
- Preference importance and weights
- Editable review table
- Reusable traveler profile saving
- Deterministic planning warnings
- Itinerary preview that does not claim live provider facts
- Local browser persistence and PWA shell

## Validation

```bash
node --check src/app.js
node --check src/domain.js
node --check src/seed.js
node tests/domain.test.js
node scripts/build.js
```

No external providers are connected yet. The app intentionally shows provider facts as not connected/TBD.
