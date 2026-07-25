# Personalization Model

RouteMosaic uses group type only as context. Recommendations must come from explicit traveler preferences, trip preferences, restrictions, confirmed plans, and user-corrected interpretations.

Preference importance maps to weights:

| Importance | Weight |
| --- | ---: |
| Must have | 100 |
| Strong preference | 80 |
| Nice to have | 45 |
| Neutral | 0 |
| Avoid | -70 |
| Must avoid | -100 |

Original user text is stored alongside structured preferences so the planner can explain how it interpreted the request.

Food source of truth:

- Step 4 stores group-wide food, alcohol, dining, and nightlife preferences as trip food preferences.
- Step 2 stores only traveler-specific restrictions or accessibility needs.
- Traveler restrictions override or add to group food preferences during planning.
