const generatedDestinationProfiles = [];

export const destinationProfiles = [
  {
    id: "los-angeles",
    canonicalName: "Los Angeles, California, USA",
    aliases: ["los angeles", "los angeles ca", "los angeles california", "la", "l.a.", "greater los angeles", "santa monica los angeles", "los angeles metropolitan area"],
    country: "United States",
    state: "California",
    timezone: "America/Los_Angeles",
    currency: "USD",
    summary: "A spread-out coastal city with beaches, hills, museums, film history, food districts, and evening neighborhoods best planned by region.",
    seasonalNotes: [
      "August days can be warm inland and cooler near the coast; check the forecast closer to travel.",
      "Coastal sunset plans should include a light layer because evenings can cool quickly.",
      "Outdoor viewpoints benefit from sun protection and water."
    ],
    generalAdvisories: [
      "Drive times are planning estimates only and can vary meaningfully with traffic.",
      "Opening hours, ticketing, accessibility conditions, and reservations should be confirmed directly before travel."
    ],
    planningRules: {
      defaultHotelRegion: "santa-monica",
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions: [
      region("santa-monica", "Santa Monica", "Beach base with pier, parks, sunset walks, and easy food options.", 34.0195, -118.4912, ["coast", "beach", "sunset", "walkable"], ["venice", "malibu", "brentwood"]),
      region("venice", "Venice", "Boardwalk energy, canals, creative shopping, and beach culture.", 33.985, -118.4695, ["coast", "beach", "local-neighborhood", "shopping"], ["santa-monica", "brentwood"]),
      region("malibu", "Malibu", "Scenic coast, viewpoints, beaches, and a dedicated driving day.", 34.0259, -118.7798, ["coast", "scenic-drive", "nature", "sunset"], ["santa-monica", "brentwood"]),
      region("hollywood", "Hollywood", "Film landmarks, classic theater exteriors, viewpoints, and lively evening access.", 34.1016, -118.3269, ["film", "landmark", "tourist", "evening"], ["griffith-park", "los-feliz", "weho"]),
      region("griffith-park", "Griffith Park", "City views, observatory grounds, trails, and nature close to Hollywood.", 34.1366, -118.2942, ["viewpoint", "nature", "hiking", "sunset"], ["hollywood", "los-feliz"]),
      region("los-feliz", "Los Feliz", "Low-key neighborhood for cafes, relaxed dinners, and Griffith access.", 34.1085, -118.2872, ["cafes", "quiet-evening", "local-neighborhood"], ["griffith-park", "hollywood"]),
      region("downtown", "Downtown Los Angeles", "Architecture, markets, museums, music halls, Little Tokyo, and Arts District combinations.", 34.0522, -118.2437, ["culture", "food", "architecture", "museums"], ["arts-district", "little-tokyo"]),
      region("arts-district", "Arts District", "Murals, casual food, galleries, and evening dining clusters.", 34.0416, -118.2355, ["art", "food", "nightlife"], ["downtown", "little-tokyo"]),
      region("little-tokyo", "Little Tokyo", "Compact cultural district with food, shops, and nearby downtown museums.", 34.049, -118.2401, ["culture", "food", "walkable"], ["downtown", "arts-district"]),
      region("museum-row", "Museum Row / Miracle Mile", "Museum cluster, tar pits, markets, and nearby Grove/Farmers Market area.", 34.0639, -118.3569, ["museums", "culture", "indoor-backup"], ["beverly-hills", "weho"]),
      region("beverly-hills", "Beverly Hills", "Gardens, shopping streets, and polished low-walking sightseeing.", 34.0736, -118.4004, ["shopping", "gardens", "low-walking"], ["museum-row", "weho", "brentwood"]),
      region("weho", "West Hollywood", "Restaurants, live music, nightlife, and evening streets.", 34.09, -118.3617, ["evening", "nightlife", "food"], ["hollywood", "beverly-hills", "museum-row"]),
      region("brentwood", "Getty Center / Brentwood", "Getty Center, westside viewpoints, and easy pairing with Westwood or Beverly Hills.", 34.079, -118.474, ["museum", "architecture", "viewpoint"], ["santa-monica", "beverly-hills", "westwood"]),
      region("westwood", "Westwood", "Village streets, UCLA area, and westside meal access.", 34.0635, -118.4455, ["food", "local-neighborhood"], ["brentwood", "beverly-hills"]),
      region("pasadena", "Pasadena", "Gardens, architecture, Old Pasadena, and a self-contained northeast day.", 34.1478, -118.1445, ["gardens", "culture", "low-walking"], ["griffith-park", "downtown"]),
      region("universal-city", "Universal City", "Theme-park anchor suited to a full-day plan.", 34.1381, -118.3534, ["theme-park", "family", "full-day"], ["hollywood", "griffith-park"]),
      region("south-bay", "Manhattan Beach / South Bay", "Beach pier, calmer coast, and a lower-key sunset alternative.", 33.8847, -118.4109, ["beach", "sunset", "quiet-evening"], ["venice", "santa-monica"])
    ],
    places: [
      place("santa-monica-pier", "Santa Monica Pier", "santa-monica", "Classic oceanfront stop with rides, views, and people-watching.", ["landmark", "beach", "family"], ["Famous landmarks", "Beaches", "Sunset"], 90, 0, 20, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "afternoon", 92),
      place("santa-monica-beach", "Santa Monica Beach", "santa-monica", "Flexible beach time close to food and sunset paths.", ["beach", "relaxation", "nature"], ["Beaches", "Relaxation", "Sunset"], 90, 0, 0, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "afternoon", 88),
      place("palisades-park", "Palisades Park", "santa-monica", "Clifftop ocean views with an easier walking profile than many hikes.", ["viewpoint", "easy-walk", "sunset"], ["Scenic drives", "Photography", "Sunset"], 60, 0, 0, "outdoor", "medium", "good", ["solo", "couple", "family", "senior"], "evening", 82),
      place("venice-beach", "Venice Beach", "venice", "Lively boardwalk and beach scene best paired with the canals or Abbot Kinney.", ["beach", "local-culture", "walk"], ["Beaches", "Local culture", "Photography"], 90, 0, 0, "outdoor", "high", "moderate", ["solo", "couple", "family"], "afternoon", 78),
      place("venice-canals", "Venice Canals", "venice", "Calmer residential canal walk for photos and a slower coastal moment.", ["walk", "architecture", "quiet"], ["Photography", "Architecture", "Relaxation"], 50, 0, 0, "outdoor", "medium", "moderate", ["solo", "couple", "senior"], "morning", 76),
      place("abbot-kinney", "Abbot Kinney area", "venice", "Creative shopping and casual food street near Venice.", ["shopping", "food", "local-neighborhood"], ["Shopping", "Food experiences", "Local culture"], 75, 0, 30, "mixed", "low", "good", ["solo", "couple"], "afternoon", 72),
      place("griffith-observatory", "Griffith Observatory", "griffith-park", "City-view anchor with science exhibits and memorable sunset positioning.", ["viewpoint", "museum", "landmark"], ["Photography", "Sunset", "Museums"], 120, 0, 0, "mixed", "high", "good", ["solo", "couple", "family", "senior"], "evening", 96),
      place("griffith-park-easy-view", "Griffith Park easy viewpoint", "griffith-park", "Lower-intensity viewpoint option for scenery without a strenuous hike.", ["viewpoint", "easy-walk", "nature"], ["Scenic drives", "Photography", "Easy outdoor walks"], 60, 0, 0, "outdoor", "high", "moderate", ["solo", "couple", "family", "senior"], "morning", 80),
      place("runyon-canyon", "Runyon Canyon", "hollywood", "Popular hillside walk with city views; best only when the group wants more walking.", ["hiking", "viewpoint", "outdoor"], ["Hiking", "Photography", "Adventure activities"], 100, 0, 0, "outdoor", "high", "limited", ["solo", "couple"], "morning", 66),
      place("hollywood-walk", "Hollywood Walk of Fame area", "hollywood", "Compact film-history sightseeing zone with a busy tourist feel.", ["film", "landmark", "walk"], ["Famous landmarks", "Local culture"], 60, 0, 0, "outdoor", "medium", "moderate", ["solo", "couple", "family"], "afternoon", 64),
      place("tcl-chinese", "TCL Chinese Theatre area", "hollywood", "Historic cinema exterior and classic Hollywood photo stop.", ["film", "landmark", "architecture"], ["Architecture", "Famous landmarks"], 45, 0, 0, "outdoor", "medium", "moderate", ["solo", "couple", "family"], "afternoon", 63),
      place("hollywood-bowl-overlook", "Hollywood Bowl overlook", "hollywood", "Short viewpoint stop above Hollywood when traffic and timing fit.", ["viewpoint", "photo", "short-stop"], ["Photography", "Scenic drives"], 35, 0, 0, "outdoor", "medium", "limited", ["solo", "couple"], "morning", 58),
      place("getty-center", "The Getty Center", "brentwood", "Architecture, gardens, art, and broad city views in one westside anchor.", ["museum", "architecture", "gardens", "viewpoint"], ["Art", "Architecture", "Museums", "Photography"], 180, 0, 30, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 95),
      place("getty-villa", "Getty Villa", "malibu", "Antiquities-focused museum setting near the coast; reservation planning is useful.", ["museum", "architecture", "coast"], ["Art", "Architecture", "Museums"], 150, 0, 30, "mixed", "medium", "good", ["solo", "couple", "senior"], "morning", 80),
      place("lacma-area", "Los Angeles County Museum of Art area", "museum-row", "Museum Row anchor with public art and indoor planning flexibility.", ["museum", "art", "indoor"], ["Art", "Museums", "Photography"], 140, 20, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 86),
      place("academy-museum", "Academy Museum area", "museum-row", "Film-focused museum option near other Miracle Mile stops.", ["museum", "film", "indoor"], ["Museums", "Film", "Local culture"], 120, 20, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 82),
      place("la-brea", "La Brea Tar Pits", "museum-row", "Science and outdoor grounds paired naturally with Museum Row.", ["museum", "science", "family"], ["Museums", "Family activities"], 90, 10, 20, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "afternoon", 75),
      place("farmers-market", "The Original Farmers Market", "museum-row", "Casual food hall-style stop with many cuisine styles near the Grove.", ["food", "market", "casual"], ["Food experiences", "Local markets", "Casual dining"], 75, 15, 35, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "lunch", 83),
      place("the-grove", "The Grove area", "museum-row", "Shopping and stroll-friendly break near Farmers Market.", ["shopping", "walk", "food"], ["Shopping", "Relaxation"], 60, 0, 20, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 61),
      place("the-broad", "The Broad area", "downtown", "Contemporary art anchor near downtown architecture and Grand Park.", ["museum", "art", "indoor"], ["Art", "Museums", "Architecture"], 100, 0, 25, "indoor", "low", "good", ["solo", "couple", "senior"], "morning", 86),
      place("disney-concert-hall", "Walt Disney Concert Hall exterior area", "downtown", "Architectural photo stop that pairs well with downtown museums.", ["architecture", "photo", "short-stop"], ["Architecture", "Photography"], 40, 0, 0, "outdoor", "medium", "good", ["solo", "couple", "family", "senior"], "afternoon", 72),
      place("grand-central-market", "Grand Central Market area", "downtown", "Busy food hall and downtown lunch anchor with many casual options.", ["food", "market", "casual"], ["Food experiences", "Local markets", "Casual dining"], 75, 15, 35, "mixed", "low", "moderate", ["solo", "couple", "family"], "lunch", 84),
      place("arts-district", "Arts District", "arts-district", "Murals, galleries, and flexible dinner or coffee stops.", ["art", "food", "walk"], ["Art", "Local culture", "Food experiences"], 90, 0, 20, "mixed", "medium", "moderate", ["solo", "couple"], "afternoon", 74),
      place("little-tokyo", "Little Tokyo", "little-tokyo", "Compact cultural district with shops, sweets, and casual meals.", ["culture", "food", "walk"], ["Local culture", "Food experiences"], 85, 0, 25, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 76),
      place("olvera-street", "Olvera Street", "downtown", "Historic pedestrian street and cultural stop near Union Station.", ["history", "culture", "walk"], ["History", "Local culture"], 75, 0, 20, "outdoor", "medium", "moderate", ["solo", "couple", "family", "senior"], "morning", 68),
      place("beverly-gardens", "Beverly Gardens Park", "beverly-hills", "Low-walking photo and garden stop along a polished corridor.", ["garden", "photo", "easy-walk"], ["Photography", "Relaxation"], 45, 0, 0, "outdoor", "medium", "good", ["solo", "couple", "senior"], "afternoon", 64),
      place("rodeo-drive", "Rodeo Drive", "beverly-hills", "Window-shopping and architecture stroll with a premium feel.", ["shopping", "architecture", "walk"], ["Shopping", "Architecture"], 60, 0, 0, "outdoor", "medium", "good", ["solo", "couple", "senior"], "afternoon", 58),
      place("weho-evening", "West Hollywood evening area", "weho", "Dinner, live music, dessert, or nightlife zone depending on evening preferences.", ["evening", "food", "live-music", "nightlife"], ["Live music", "Nightlife", "Food experiences"], 120, 20, 60, "mixed", "low", "good", ["solo", "couple"], "evening", 76),
      place("malibu-coast", "Malibu scenic coast", "malibu", "Scenic coastal drive with viewpoints and slower beach stops.", ["scenic-drive", "coast", "viewpoint"], ["Scenic drives", "Beaches", "Photography"], 150, 0, 20, "outdoor", "high", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 90),
      place("point-dume", "Point Dume", "malibu", "Coastal viewpoint with dramatic scenery; walking intensity depends on access choice.", ["viewpoint", "coast", "nature"], ["Photography", "Beaches", "Sunset"], 80, 0, 0, "outdoor", "high", "limited", ["solo", "couple", "family"], "afternoon", 78),
      place("el-matador-style", "Malibu coastal viewpoint", "malibu", "Rocky beach-style viewpoint category for photos when access is appropriate.", ["viewpoint", "coast", "photo"], ["Photography", "Beaches"], 70, 0, 0, "outdoor", "high", "limited", ["solo", "couple"], "afternoon", 70),
      place("universal-studios", "Universal Studios Hollywood", "universal-city", "Full-day theme park anchor with rides, shows, and studio-themed experiences.", ["theme-park", "family", "full-day"], ["Theme parks", "Family activities", "Entertainment"], 480, 120, 180, "mixed", "low", "good", ["solo", "couple", "family"], "full-day", 82),
      place("california-science-center", "California Science Center area", "downtown", "Family-friendly science museum zone with indoor backup value.", ["museum", "science", "family"], ["Museums", "Family activities"], 150, 0, 20, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 74),
      place("natural-history", "Natural History Museum area", "downtown", "Indoor museum option that pairs with Exposition Park attractions.", ["museum", "history", "family"], ["Museums", "History", "Family activities"], 140, 15, 25, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 72),
      place("huntington", "Huntington Library, Art Museum, and Botanical Gardens", "pasadena", "Large gardens and art collections suited to a dedicated Pasadena day.", ["gardens", "museum", "architecture"], ["Gardens", "Art", "Relaxation"], 210, 20, 35, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 88),
      place("old-pasadena", "Old Pasadena", "pasadena", "Walkable dining, architecture, and shopping district for a calmer evening.", ["food", "shopping", "historic"], ["Local culture", "Shopping", "Food experiences"], 100, 0, 25, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "evening", 70),
      place("manhattan-beach-pier", "Manhattan Beach Pier", "south-bay", "Calmer beach pier and sunset option away from busier westside beach zones.", ["beach", "pier", "sunset"], ["Beaches", "Sunset", "Relaxation"], 80, 0, 0, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "evening", 68),
      place("indoor-backup-museums", "Indoor backup museum cluster", "museum-row", "Flexible indoor museum alternative for heat, rain, or low-energy days.", ["museum", "backup", "indoor"], ["Museums", "Art", "Family activities"], 120, 10, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 65),
      place("quiet-dessert-evening", "Quiet dessert or cafe evening", "los-feliz", "Low-key cafe or dessert area for a calmer night without alcohol focus.", ["quiet-evening", "dessert", "food"], ["Dessert or cafe evenings", "Relaxation"], 75, 10, 25, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "evening", 73)
    ],
    foodAreas: [
      foodArea("santa-monica-food", "Santa Monica casual coastal dining", "santa-monica", ["American", "Italian", "Mexican", "Vegetarian-friendly", "Cafes"], ["breakfast", "lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Avoid beef", "Dairy-free"], ["quiet"]),
      foodArea("venice-abbot-food", "Abbot Kinney and Venice cafes", "venice", ["Mexican", "American", "Cafes", "Bakeries", "Vegetarian-friendly"], ["breakfast", "lunch"], ["moderate"], ["Vegetarian", "Vegan", "Gluten-free"], ["quiet"]),
      foodArea("downtown-market-food", "Downtown market-style dining", "downtown", ["Mexican", "Japanese", "American", "Desserts", "Casual dining"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Avoid pork", "Avoid beef"], ["lively"]),
      foodArea("little-tokyo-food", "Little Tokyo casual food area", "little-tokyo", ["Japanese", "Asian", "Desserts"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Seafood acceptable"], ["quiet"]),
      foodArea("museum-row-food", "Farmers Market and Museum Row options", "museum-row", ["American", "Mexican", "Mediterranean", "Desserts", "Casual dining"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Halal-aware", "Avoid beef"], ["quiet"]),
      foodArea("weho-food", "West Hollywood dinner and live-music area", "weho", ["Italian", "Mediterranean", "American", "Fine dining"], ["dinner"], ["moderate", "premium"], ["Vegetarian", "Vegan", "Gluten-free"], ["nightlife", "live-music"]),
      foodArea("pasadena-food", "Old Pasadena dining", "pasadena", ["American", "Italian", "Mexican", "Cafes"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Avoid beef"], ["quiet"]),
      foodArea("malibu-food", "Malibu coastal casual dining", "malibu", ["American", "Seafood", "Cafes"], ["lunch", "dinner"], ["moderate", "premium"], ["Vegetarian", "Limited seafood"], ["sunset"])
    ],
    scenicRoutes: [
      route("coast-santa-monica-malibu", "Santa Monica to Malibu coastal drive", "santa-monica", "malibu", 45, 24, ["coast", "scenic-drive", "sunset"], "afternoon", "Use as a dedicated coastal segment; traffic can vary widely."),
      route("westside-beach-loop", "Santa Monica and Venice coastal loop", "santa-monica", "venice", 20, 6, ["beach", "short-drive"], "afternoon", "Good same-day pairing with low region friction."),
      route("griffith-hollywood-link", "Griffith Park and Hollywood link", "griffith-park", "hollywood", 18, 5, ["viewpoint", "film"], "afternoon", "Use for a scenery plus Hollywood day."),
      route("downtown-arts-link", "Downtown, Little Tokyo, and Arts District link", "downtown", "arts-district", 12, 3, ["culture", "food"], "afternoon", "Works best as one compact cultural day.")
    ]
  },
  {
    id: "charlotte",
    canonicalName: "Charlotte, North Carolina, USA",
    aliases: ["charlotte", "charlotte nc", "charlotte north carolina", "charlotte north carolina united states", "queen city"],
    country: "United States",
    state: "North Carolina",
    timezone: "America/New_York",
    currency: "USD",
    summary: "A compact but varied city best planned by district: Uptown museums and sports, South End food and the Rail Trail, NoDa arts, Plaza Midwood evenings, Freedom Park, plus nearby outdoor and day-trip anchors.",
    seasonalNotes: [
      "August is hot and humid; protect outdoor blocks with indoor backups, hydration, and lighter midday pacing.",
      "Storms can move through quickly in summer, so keep museum, food hall, and indoor culture backups ready.",
      "Major events, sports, concerts, and NASCAR race weekends can change lodging, traffic, and parking conditions."
    ],
    generalAdvisories: [
      "Confirm attraction hours, timed tickets, parking rules, accessibility, and reservation needs directly before travel.",
      "Nearby outings such as the Whitewater Center, Carowinds, Lake Norman, and Concord should be treated as half-day or full-day anchors.",
      "Use rideshare or light rail for dense evening districts when parking or drinks are part of the plan."
    ],
    planningRules: {
      defaultHotelRegion: "uptown",
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions: [
      region("uptown", "Uptown Charlotte", "Museums, parks, sports venues, skyline views, restaurants, and the strongest first-time orientation base.", 35.2271, -80.8431, ["downtown", "museums", "sports", "walkable"], ["south-end", "freedom-park", "plaza-midwood"]),
      region("south-end", "South End and Rail Trail", "Light rail, breweries, casual food, murals, shopping, and an easy evening corridor.", 35.211, -80.8607, ["food", "rail-trail", "evening", "local-neighborhood"], ["uptown", "freedom-park"]),
      region("noda", "NoDa", "Arts district with murals, live music, independent food, breweries, and a lively but compact neighborhood feel.", 35.2479, -80.8041, ["art", "music", "food", "nightlife"], ["plaza-midwood", "camp-north-end", "uptown"]),
      region("plaza-midwood", "Plaza Midwood", "Relaxed local restaurants, bars, coffee, boutiques, and evening energy east of Uptown.", 35.2217, -80.8126, ["food", "evening", "local-neighborhood"], ["noda", "uptown", "freedom-park"]),
      region("freedom-park", "Freedom Park and Dilworth", "Green space, neighborhood streets, Little Sugar Creek Greenway, cafes, and easier outdoor time.", 35.1904, -80.8458, ["park", "greenway", "easy-walk"], ["uptown", "south-end"]),
      region("camp-north-end", "Camp North End", "Adaptive reuse campus with art, food, markets, events, and a creative Charlotte feel.", 35.2473, -80.8344, ["art", "food", "events", "local-culture"], ["uptown", "noda"]),
      region("whitewater-center", "U.S. National Whitewater Center area", "Outdoor adventure anchor with trails, rafting-style activities, zip lines, food, and riverfront-style relaxation.", 35.2726, -81.0062, ["outdoor", "adventure", "full-day"], ["uptown", "lake-norman"]),
      region("lake-norman", "Lake Norman and Davidson", "Nearby lake towns, waterfront dining, Davidson main street, Cornelius, and a slower scenic half-day.", 35.4993, -80.8487, ["lake", "day-trip", "scenic", "food"], ["uptown", "whitewater-center"]),
      region("concord", "Concord and motorsports", "Charlotte Motor Speedway, Concord Mills area, race-weekend energy, and northern suburbs.", 35.3525, -80.6866, ["motorsports", "shopping", "day-trip"], ["uptown", "noda"]),
      region("carowinds", "Carowinds and south Charlotte", "Theme-park anchor and south-side family outing, best planned as a dedicated block.", 35.1047, -80.9431, ["theme-park", "family", "full-day"], ["uptown", "south-end"])
    ],
    places: [
      place("nascar-hall-of-fame", "NASCAR Hall of Fame", "uptown", "Signature Charlotte museum for racing history, interactive exhibits, and a strong first-time Uptown anchor.", ["museum", "motorsports", "indoor"], ["Museums", "Sports", "Family activities"], 140, 25, 40, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 96),
      place("romare-bearden-park", "Romare Bearden Park", "uptown", "Skyline-facing park near ballpark, restaurants, and short Uptown photo walks.", ["park", "skyline", "easy-walk"], ["Photography", "Easy outdoor walks", "Relaxation"], 50, 0, 0, "outdoor", "medium", "good", ["solo", "couple", "family", "senior"], "afternoon", 82),
      place("mint-museum-uptown", "Mint Museum Uptown", "uptown", "Indoor art anchor in Uptown, easy to pair with Bechtler, Levine Center for the Arts, or a skyline meal.", ["museum", "art", "indoor"], ["Art", "Museums", "Architecture"], 120, 10, 25, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 88),
      place("bechtler-museum", "Bechtler Museum of Modern Art area", "uptown", "Compact modern art and architecture stop near the Levine Center for the Arts.", ["museum", "art", "architecture"], ["Art", "Museums", "Architecture"], 80, 10, 25, "indoor", "low", "good", ["solo", "couple", "senior"], "afternoon", 78),
      place("discovery-place-science", "Discovery Place Science", "uptown", "Hands-on science museum and reliable indoor backup for families, heat, or rain.", ["museum", "science", "family"], ["Museums", "Family activities", "Indoor backup"], 130, 20, 35, "indoor", "low", "good", ["solo", "couple", "family"], "morning", 84),
      place("fourth-ward-walk", "Fourth Ward historic walk", "uptown", "Historic neighborhood loop with Victorian homes, pocket parks, and lower-cost city context.", ["history", "architecture", "walk"], ["History", "Architecture", "Photography"], 60, 0, 0, "outdoor", "medium", "moderate", ["solo", "couple", "family", "senior"], "morning", 76),
      place("south-end-rail-trail", "South End Rail Trail", "south-end", "Walkable corridor for murals, shops, breweries, casual restaurants, and light-rail-friendly exploring.", ["walk", "food", "murals"], ["Evening walks", "Local culture", "Casual dining"], 100, 0, 35, "mixed", "medium", "good", ["solo", "couple", "family"], "afternoon", 86),
      place("optimist-hall", "Optimist Hall", "uptown", "Food hall-style stop with flexible casual dining and group-friendly options near NoDa/Uptown transitions.", ["food", "market", "casual"], ["Food experiences", "Casual dining", "Cafes"], 75, 15, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "lunch", 86),
      place("noda-arts-district", "NoDa arts district", "noda", "Murals, live music, breweries, coffee, and independent restaurants in Charlotte's arts neighborhood.", ["art", "music", "food"], ["Art", "Live music", "Local culture"], 110, 0, 45, "mixed", "low", "moderate", ["solo", "couple", "family"], "evening", 88),
      place("plaza-midwood-evening", "Plaza Midwood evening area", "plaza-midwood", "Local dinner, dessert, bars, and neighborhood streets for a more Charlotte-specific night.", ["evening", "food", "local-neighborhood"], ["Dessert or cafe evenings", "Bars", "Local culture"], 100, 15, 50, "mixed", "low", "moderate", ["solo", "couple"], "evening", 78),
      place("freedom-park", "Freedom Park", "freedom-park", "Large park and lake area for easy walking, downtime, and a calm outdoor break close to Dilworth.", ["park", "nature", "easy-walk"], ["Nature", "Easy outdoor walks", "Relaxation"], 80, 0, 0, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "morning", 84),
      place("little-sugar-creek-greenway", "Little Sugar Creek Greenway", "freedom-park", "Paved greenway segment for low-pressure walking, biking-style scenery, and neighborhood connections.", ["greenway", "walk", "nature"], ["Evening walks", "Nature", "Photography"], 70, 0, 0, "outdoor", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 80),
      place("camp-north-end", "Camp North End", "camp-north-end", "Creative campus with murals, food vendors, events, markets, and a strong local Charlotte feel.", ["art", "food", "events"], ["Art", "Street food", "Local culture"], 110, 0, 45, "mixed", "low", "moderate", ["solo", "couple", "family"], "afternoon", 90),
      place("whitewater-center", "U.S. National Whitewater Center", "whitewater-center", "Major nearby outdoor anchor for trails, rafting-style activities, zip lines, music events, and casual food.", ["outdoor", "adventure", "full-day"], ["Outdoor Activities", "Water Experiences", "Live music"], 240, 10, 90, "outdoor", "high", "moderate", ["solo", "couple", "family"], "morning", 94),
      place("lake-norman-davidson", "Lake Norman and Davidson half-day", "lake-norman", "Waterfront towns, Davidson's main street, lake views, and slower dining north of Charlotte.", ["lake", "day-trip", "scenic"], ["Scenic drives", "Local cuisine", "Relaxation"], 180, 0, 45, "mixed", "medium", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 86),
      place("carowinds", "Carowinds", "carowinds", "Theme park and water-park-style seasonal anchor south of Charlotte; keep it as a dedicated block.", ["theme-park", "family", "full-day"], ["Theme parks", "Family activities", "Entertainment"], 360, 45, 100, "mixed", "high", "moderate", ["solo", "couple", "family"], "full-day", 82),
      place("charlotte-motor-speedway", "Charlotte Motor Speedway area", "concord", "Motorsports and race-event area northeast of Charlotte, strongest when tours or events match dates.", ["motorsports", "event", "day-trip"], ["Sports", "Entertainment", "Famous landmarks"], 150, 15, 80, "mixed", "medium", "moderate", ["solo", "couple", "family"], "afternoon", 76),
      place("sullenberger-aviation-museum", "Sullenberger Aviation Museum", "uptown", "Aviation-focused indoor option near the airport side of Charlotte, useful for arrival/departure day or rainy backup.", ["museum", "aviation", "indoor"], ["Museums", "History", "Family activities"], 110, 15, 30, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 72),
      place("daniel-stowe-botanical-garden", "Daniel Stowe Botanical Garden", "lake-norman", "Garden-focused nearby outing west of Charlotte for a slower scenic break when time allows.", ["garden", "day-trip", "nature"], ["Gardens", "Photography", "Relaxation"], 150, 15, 30, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 74),
      place("indoor-uptown-backup", "Uptown indoor museum backup", "uptown", "Use Mint Museum, Bechtler, Discovery Place, or NASCAR Hall of Fame as weather-flexible swaps.", ["museum", "backup", "indoor"], ["Museums", "Indoor backup", "Family activities"], 120, 10, 40, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 70)
    ],
    foodAreas: [
      foodArea("uptown-food", "Uptown restaurants and food halls", "uptown", ["American", "Italian", "Local cuisine", "Cafes", "Casual dining"], ["breakfast", "lunch", "dinner"], ["budget", "moderate", "premium"], ["Vegetarian", "Gluten-free", "Avoid pork"], ["quiet", "lively"]),
      foodArea("south-end-food", "South End dining and breweries", "south-end", ["American", "Mexican", "Italian", "Cafes", "Casual dining"], ["lunch", "dinner"], ["moderate"], ["Vegetarian", "Vegan", "Gluten-free"], ["nightlife", "live-music"]),
      foodArea("noda-food", "NoDa cafes, breweries, and casual food", "noda", ["American", "Mexican", "Cafes", "Bakeries", "Vegetarian-friendly"], ["breakfast", "lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Vegan"], ["live-music", "lively"]),
      foodArea("plaza-midwood-food", "Plaza Midwood neighborhood dining", "plaza-midwood", ["American", "Mediterranean", "Mexican", "Desserts", "Bars"], ["dinner"], ["moderate"], ["Vegetarian", "Gluten-free"], ["nightlife", "quiet"]),
      foodArea("camp-north-end-food", "Camp North End food and events", "camp-north-end", ["Street food", "American", "Cafes", "Desserts"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian"], ["lively"]),
      foodArea("lake-norman-food", "Lake Norman waterfront dining", "lake-norman", ["American", "Seafood", "Cafes", "Desserts"], ["lunch", "dinner"], ["moderate", "premium"], ["Vegetarian", "Limited seafood"], ["sunset", "quiet"])
    ],
    scenicRoutes: [
      route("uptown-south-end", "Uptown to South End Rail Trail corridor", "uptown", "south-end", 12, 3, ["walkable", "food", "murals"], "afternoon", "Use light rail or rideshare when parking is inconvenient."),
      route("uptown-noda-camp", "Uptown, NoDa, and Camp North End loop", "uptown", "camp-north-end", 18, 6, ["art", "food", "local-culture"], "afternoon", "Good creative-neighborhood pairing with flexible meals."),
      route("uptown-freedom-park", "Uptown to Freedom Park and Dilworth", "uptown", "freedom-park", 15, 4, ["park", "greenway", "easy-walk"], "morning", "Use this for a calmer outdoor block close to the city."),
      route("charlotte-whitewater", "Charlotte to U.S. National Whitewater Center", "uptown", "whitewater-center", 25, 14, ["outdoor", "adventure", "nearby"], "morning", "Treat as a half-day or full-day anchor, not a quick stop."),
      route("charlotte-lake-norman", "Charlotte to Lake Norman and Davidson", "uptown", "lake-norman", 35, 24, ["lake", "day-trip", "scenic"], "afternoon", "Best when the plan needs a slower nearby escape."),
      route("charlotte-carowinds", "Charlotte to Carowinds", "uptown", "carowinds", 25, 15, ["theme-park", "family", "nearby"], "morning", "Use as a dedicated ticketed outing.")
    ]
  },
  {
    id: "dallas",
    canonicalName: "Dallas, Texas, USA",
    aliases: ["dallas", "dallas tx", "dallas texas", "dallas texas united states", "dfw", "dallas fort worth"],
    country: "United States",
    state: "Texas",
    timezone: "America/Chicago",
    currency: "USD",
    summary: "A North Texas city best planned by districts: Dealey Plaza and downtown history, the Arts District, Deep Ellum, Bishop Arts, White Rock Lake, Fair Park, and nearby Fort Worth Stockyards.",
    seasonalNotes: [
      "August can be very hot; keep indoor museums, shaded meals, and shorter outdoor blocks in the middle of the day.",
      "The State Fair of Texas changes Fair Park demand and traffic in fall; verify dates before anchoring a fair day.",
      "Sports and concert events in Arlington can add traffic, parking pressure, and longer evenings."
    ],
    generalAdvisories: [
      "Confirm museum hours, timed tickets, event schedules, parking, accessibility, and restaurant reservations before travel.",
      "Fort Worth Stockyards is a real nearby excursion from Dallas, not a quick downtown stop; plan it as a half-day or full evening.",
      "Use rideshare or transit for nightlife-heavy areas such as Deep Ellum when drinking or late return is likely."
    ],
    planningRules: {
      defaultHotelRegion: "downtown-dealey",
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions: [
      region("downtown-dealey", "Downtown and Dealey Plaza", "JFK history, Reunion Tower, West End, aquarium, skyline views, and compact first-time Dallas orientation.", 32.779, -96.808, ["history", "downtown", "landmark", "walkable"], ["arts-district", "deep-ellum", "bishop-arts"]),
      region("arts-district", "Dallas Arts District", "Museums, sculpture, performing arts, Klyde Warren Park, architecture, and weather-flexible culture.", 32.7897, -96.7986, ["museums", "art", "architecture", "park"], ["downtown-dealey", "uptown"]),
      region("deep-ellum", "Deep Ellum", "Murals, live music, bars, casual food, and a lively evening neighborhood east of downtown.", 32.784, -96.7837, ["music", "murals", "nightlife", "food"], ["downtown-dealey", "arts-district"]),
      region("bishop-arts", "Bishop Arts District", "Oak Cliff boutiques, cafes, restaurants, galleries, and a walkable local-neighborhood evening.", 32.747, -96.8288, ["shopping", "food", "local-neighborhood", "art"], ["downtown-dealey"]),
      region("uptown", "Uptown and Klyde Warren Park", "Green space, restaurants, walkable connections, and an easy link between downtown and the Arts District.", 32.7933, -96.8016, ["park", "food", "walkable"], ["arts-district", "downtown-dealey"]),
      region("white-rock", "White Rock Lake and Arboretum", "Lake scenery, gardens, easier outdoor time, and a calmer break from downtown.", 32.8235, -96.7168, ["lake", "garden", "nature", "scenic"], ["smu-park-cities", "fair-park"]),
      region("smu-park-cities", "SMU and Park Cities", "George W. Bush Presidential Center, Highland Park Village, polished cafes, and lower-intensity museum time.", 32.8407, -96.7845, ["museum", "shopping", "campus"], ["arts-district", "white-rock"]),
      region("fair-park", "Fair Park and South Dallas", "Art Deco architecture, seasonal State Fair energy, gardens, museums, and sports/event context.", 32.7797, -96.7646, ["architecture", "event", "history"], ["deep-ellum", "white-rock"]),
      region("arlington", "Arlington sports and entertainment", "AT&T Stadium, Globe Life Field, Six Flags, and event-heavy half-day or evening options.", 32.7473, -97.0945, ["sports", "theme-park", "event", "nearby"], ["downtown-dealey", "fort-worth-stockyards"]),
      region("fort-worth-stockyards", "Fort Worth Stockyards", "Historic Western district with cattle drives, shopping, rodeo, restaurants, and live music west of Dallas.", 32.7881, -97.3486, ["nearby", "western", "history", "full-day"], ["arlington", "downtown-dealey"])
    ],
    places: [
      place("sixth-floor-museum", "The Sixth Floor Museum at Dealey Plaza", "downtown-dealey", "Essential Dallas history stop inside the former Texas School Book Depository, focused on JFK and the events around Dealey Plaza.", ["museum", "history", "landmark"], ["History", "Museums", "Famous landmarks"], 120, 18, 30, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 98),
      place("dealey-plaza", "Dealey Plaza and Grassy Knoll", "downtown-dealey", "Compact outdoor companion to the Sixth Floor Museum for historic context and downtown orientation.", ["history", "landmark", "walk"], ["History", "Photography", "Famous landmarks"], 45, 0, 0, "outdoor", "medium", "moderate", ["solo", "couple", "family", "senior"], "morning", 86),
      place("reunion-tower", "Reunion Tower GeO-Deck", "downtown-dealey", "Skyline viewpoint that works well near sunset or as a first-day Dallas orientation.", ["viewpoint", "landmark", "skyline"], ["Photography", "Sunset", "Famous landmarks"], 75, 20, 45, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "evening", 84),
      place("dallas-world-aquarium", "The Dallas World Aquarium", "downtown-dealey", "Indoor aquarium and rainforest-style attraction near West End, useful for families or hot/rainy days.", ["aquarium", "family", "indoor"], ["Family activities", "Museums", "Indoor backup"], 120, 25, 40, "indoor", "low", "good", ["solo", "couple", "family"], "afternoon", 82),
      place("dallas-farmers-market", "Dallas Farmers Market", "downtown-dealey", "Food hall, local vendors, casual lunch, and an easy downtown break.", ["food", "market", "casual"], ["Local markets", "Street food", "Casual dining"], 75, 10, 35, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "lunch", 78),
      place("dallas-museum-of-art", "Dallas Museum of Art", "arts-district", "Major Arts District anchor with broad collections and a strong indoor culture block.", ["museum", "art", "indoor"], ["Art", "Museums", "Architecture"], 140, 0, 25, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 92),
      place("nasher-sculpture-center", "Nasher Sculpture Center", "arts-district", "Modern sculpture museum and garden that pairs naturally with the Dallas Museum of Art.", ["museum", "art", "garden"], ["Art", "Museums", "Gardens"], 90, 10, 25, "mixed", "medium", "good", ["solo", "couple", "senior"], "afternoon", 84),
      place("perot-museum", "Perot Museum of Nature and Science", "arts-district", "Hands-on science museum with architecture, family appeal, and excellent heat/rain backup value.", ["museum", "science", "family"], ["Museums", "Family activities", "Architecture"], 140, 20, 35, "indoor", "low", "good", ["solo", "couple", "family"], "afternoon", 88),
      place("klyde-warren-park", "Klyde Warren Park", "uptown", "Urban deck park connecting Uptown and the Arts District, with food trucks, shade breaks, and casual programming.", ["park", "food", "easy-walk"], ["Easy outdoor walks", "Casual dining", "Relaxation"], 60, 0, 20, "outdoor", "medium", "good", ["solo", "couple", "family", "senior"], "afternoon", 82),
      place("deep-ellum", "Deep Ellum murals and live music area", "deep-ellum", "Dallas evening district for murals, barbecue, music venues, bars, and casual food.", ["music", "murals", "evening"], ["Live music", "Nightlife", "Local culture"], 120, 10, 70, "mixed", "low", "moderate", ["solo", "couple"], "evening", 86),
      place("bishop-arts", "Bishop Arts District", "bishop-arts", "Walkable Oak Cliff neighborhood for boutiques, galleries, coffee, dinner, dessert, and a local Dallas feel.", ["shopping", "food", "local-neighborhood"], ["Shopping", "Cafes", "Local culture"], 110, 0, 55, "mixed", "low", "good", ["solo", "couple", "family"], "afternoon", 88),
      place("dallas-arboretum", "Dallas Arboretum and Botanical Garden", "white-rock", "Garden and White Rock Lake-side outing for flowers, lake views, photography, and slower outdoor time.", ["garden", "lake", "nature"], ["Gardens", "Photography", "Relaxation"], 150, 15, 30, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "morning", 90),
      place("white-rock-lake", "White Rock Lake", "white-rock", "Scenic lake loop and picnic-style outdoor break; best early or late during hot months.", ["lake", "nature", "easy-walk"], ["Nature", "Evening walks", "Photography"], 90, 0, 0, "outdoor", "high", "moderate", ["solo", "couple", "family", "senior"], "evening", 78),
      place("bush-center", "George W. Bush Presidential Center", "smu-park-cities", "Presidential library and museum on the SMU campus, useful for history and indoor planning.", ["museum", "history", "indoor"], ["Museums", "History", "Architecture"], 120, 20, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 80),
      place("highland-park-village", "Highland Park Village", "smu-park-cities", "Historic upscale shopping village with architecture, cafes, and a polished low-intensity break.", ["shopping", "architecture", "cafes"], ["Shopping", "Architecture", "Cafes"], 75, 0, 50, "mixed", "low", "good", ["solo", "couple", "senior"], "afternoon", 66),
      place("fair-park", "Fair Park Art Deco and State Fair grounds", "fair-park", "Large Art Deco fairgrounds and seasonal State Fair hub; confirm events and museum openings.", ["architecture", "event", "history"], ["Architecture", "History", "Seasonal Experiences"], 130, 0, 50, "mixed", "high", "moderate", ["solo", "couple", "family"], "afternoon", 76),
      place("dallas-zoo", "Dallas Zoo", "bishop-arts", "Family-friendly zoo south of downtown; best as a dedicated morning block in cooler hours.", ["zoo", "family", "outdoor"], ["Family activities", "Nature", "Outdoor Activities"], 180, 20, 40, "outdoor", "high", "moderate", ["solo", "couple", "family"], "morning", 72),
      place("att-stadium", "AT&T Stadium or Arlington sports event", "arlington", "Nearby event anchor for Cowboys games, stadium tours, concerts, or Arlington sports nights.", ["sports", "event", "nearby"], ["Sports", "Entertainment", "Famous landmarks"], 180, 25, 120, "mixed", "low", "good", ["solo", "couple", "family"], "afternoon", 74),
      place("six-flags-over-texas", "Six Flags Over Texas", "arlington", "Full-day theme park option between Dallas and Fort Worth, strongest for families or thrill-focused trips.", ["theme-park", "family", "full-day"], ["Theme parks", "Family activities", "Entertainment"], 420, 45, 110, "mixed", "high", "moderate", ["solo", "couple", "family"], "full-day", 70),
      place("fort-worth-stockyards", "Fort Worth Stockyards", "fort-worth-stockyards", "Western heritage day or evening with cattle drives, shops, restaurants, rodeo options, and live music.", ["history", "western", "nearby"], ["History", "Local culture", "Live music"], 240, 0, 90, "mixed", "medium", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 96),
      place("stockyards-cattle-drive", "Fort Worth Herd cattle drive", "fort-worth-stockyards", "Time-sensitive Stockyards highlight; build the day around the cattle-drive schedule when conditions permit.", ["western", "event", "history"], ["Famous landmarks", "Seasonal Experiences", "Family activities"], 60, 0, 0, "outdoor", "medium", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 88),
      place("fort-worth-cultural-district", "Fort Worth Cultural District", "fort-worth-stockyards", "Nearby museum district option with major art museums, gardens, and a calmer culture pairing before Stockyards evening.", ["museum", "art", "nearby"], ["Art", "Museums", "Architecture"], 180, 10, 35, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "morning", 76)
    ],
    foodAreas: [
      foodArea("downtown-dallas-food", "Downtown and West End dining", "downtown-dealey", ["Tex-Mex", "American", "Steakhouses", "Casual dining"], ["lunch", "dinner"], ["budget", "moderate", "premium"], ["Vegetarian", "Avoid pork", "Gluten-free"], ["quiet", "lively"]),
      foodArea("bishop-arts-food", "Bishop Arts restaurants and cafes", "bishop-arts", ["Tex-Mex", "Italian", "American", "Cafes", "Desserts"], ["breakfast", "lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Vegan", "Gluten-free"], ["quiet"]),
      foodArea("deep-ellum-food", "Deep Ellum barbecue, tacos, and nightlife food", "deep-ellum", ["Barbecue", "Tex-Mex", "American", "Bars", "Desserts"], ["dinner"], ["budget", "moderate"], ["Vegetarian", "Limited beef"], ["nightlife", "live-music"]),
      foodArea("arts-district-food", "Arts District and Klyde Warren food", "arts-district", ["Food trucks", "American", "Cafes", "Fine dining"], ["lunch", "dinner"], ["budget", "moderate", "premium"], ["Vegetarian", "Gluten-free"], ["quiet", "lively"]),
      foodArea("white-rock-food", "White Rock Lake and East Dallas dining", "white-rock", ["American", "Cafes", "Casual dining", "Desserts"], ["breakfast", "lunch"], ["budget", "moderate"], ["Vegetarian", "Dairy-free"], ["quiet"]),
      foodArea("stockyards-food", "Fort Worth Stockyards dining", "fort-worth-stockyards", ["Texas barbecue", "Steakhouses", "Tex-Mex", "Bars"], ["lunch", "dinner"], ["moderate", "premium"], ["Vegetarian", "Avoid beef"], ["live-music", "nightlife"])
    ],
    scenicRoutes: [
      route("downtown-arts-uptown", "Downtown, Arts District, and Klyde Warren link", "downtown-dealey", "arts-district", 12, 3, ["culture", "walkable", "museum"], "morning", "Best grouped to avoid unnecessary driving and parking changes."),
      route("downtown-bishop", "Downtown to Bishop Arts", "downtown-dealey", "bishop-arts", 15, 5, ["food", "local-neighborhood"], "afternoon", "Good lunch or dinner pairing after downtown history."),
      route("arts-white-rock", "Arts District to White Rock Lake and Arboretum", "arts-district", "white-rock", 20, 8, ["garden", "lake", "scenic"], "morning", "Use earlier in summer heat."),
      route("dallas-arlington", "Dallas to Arlington sports and theme-park corridor", "downtown-dealey", "arlington", 35, 20, ["sports", "theme-park", "nearby"], "afternoon", "Traffic varies heavily around games and concerts."),
      route("dallas-stockyards", "Dallas to Fort Worth Stockyards", "downtown-dealey", "fort-worth-stockyards", 55, 35, ["nearby", "western", "day-trip"], "afternoon", "Plan as a half-day or evening excursion; verify cattle drive and rodeo schedules.")
    ]
  },
  {
    id: "detroit",
    canonicalName: "Detroit, Michigan, USA",
    aliases: ["detroit", "detroit mi", "detroit michigan", "detroit michigan united states", "motor city"],
    country: "United States",
    state: "Michigan",
    timezone: "America/Detroit",
    currency: "USD",
    summary: "A Great Lakes city best planned by district: riverfront and Belle Isle scenery, Midtown museums and Motown history, Eastern Market food, Corktown architecture, and a strong Dearborn day for The Henry Ford.",
    seasonalNotes: [
      "August is usually warm and good for riverfront, Belle Isle, and outdoor markets; keep indoor museum backups for storms or heat.",
      "Check Tigers, Lions, concerts, and downtown events because they can change parking and traffic patterns.",
      "Belle Isle and riverfront plans are strongest in daylight and around sunset, with weather flexibility."
    ],
    generalAdvisories: [
      "Detroit attraction hours, timed tickets, event schedules, parking rules, and bridge/tunnel traffic should be verified before travel.",
      "The Henry Ford and Greenfield Village can consume most of a day; do not overload that day.",
      "Some neighborhoods are best navigated by car or rideshare; keep evening routes simple and confirm parking."
    ],
    planningRules: {
      defaultHotelRegion: "downtown",
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions: [
      region("santa-monica", "Detroit Riverfront", "RiverWalk, Hart Plaza, Cullen Plaza, skyline views, casual food, and sunset-friendly walks.", 42.3298, -83.0396, ["riverfront", "walkable", "sunset", "views"], ["downtown", "venice", "malibu"]),
      region("venice", "Belle Isle", "Island park with conservatory, aquarium, skyline viewpoints, beach areas, and scenic drives.", 42.343, -82.9743, ["park", "waterfront", "nature", "scenic-drive"], ["santa-monica", "griffith-park"]),
      region("malibu", "Grosse Pointe and lakefront drive", "A lower-key lakefront scenic extension for architecture, parks, and calmer Great Lakes views.", 42.3861, -82.9119, ["lakefront", "scenic-drive", "architecture"], ["venice", "santa-monica"]),
      region("hollywood", "Midtown and New Center", "Detroit Institute of Arts, Motown Museum, Fisher Building, Wayne State area, and culture-heavy planning.", 42.3589, -83.0668, ["museum", "music", "architecture", "culture"], ["griffith-park", "los-feliz", "museum-row"]),
      region("griffith-park", "Cultural Center", "DIA, Detroit Historical Museum, public library, science center, and walkable museum clustering.", 42.3594, -83.0633, ["museums", "indoor", "history"], ["hollywood", "museum-row"]),
      region("los-feliz", "New Center and Boston-Edison", "Motown, Fisher Building, historic homes, cafes, and lower-key evening positioning.", 42.3694, -83.0769, ["music", "architecture", "historic"], ["hollywood", "griffith-park"]),
      region("downtown", "Downtown Detroit", "Campus Martius, Guardian Building, Capitol Park, theatres, stadiums, and riverfront access.", 42.3314, -83.0458, ["architecture", "landmark", "food", "evening"], ["santa-monica", "arts-district", "little-tokyo"]),
      region("arts-district", "Eastern Market", "Murals, market sheds, food vendors, cafes, and a strong Saturday morning anchor.", 42.3487, -83.0414, ["market", "food", "murals", "local-culture"], ["downtown", "little-tokyo"]),
      region("little-tokyo", "Corktown and Michigan Central", "Historic streets, Michigan Central, restaurants, coffee, Roosevelt Park, and old Detroit character.", 42.3317, -83.077, ["historic", "food", "architecture"], ["downtown", "arts-district"]),
      region("museum-row", "Dearborn and The Henry Ford", "The Henry Ford Museum, Greenfield Village, Ford Rouge Factory Tour, and Arab American dining.", 42.3033, -83.2341, ["museum", "history", "full-day", "family"], ["brentwood", "beverly-hills"]),
      region("beverly-hills", "Ford campus and Greenfield Village", "Large-scale museum campus planning with historic buildings, exhibits, and ticketed experiences.", 42.303, -83.229, ["museum", "history", "low-walking"], ["museum-row", "westwood"]),
      region("weho", "Downtown evening district", "Theatre District, Capitol Park, Greektown, jazz, dessert, and drinks-optional evening routes.", 42.335, -83.047, ["evening", "food", "live-music", "nightlife"], ["downtown", "santa-monica"]),
      region("brentwood", "Dearborn food corridor", "Middle Eastern restaurants, bakeries, cafes, and dinner positioning around Dearborn.", 42.3223, -83.1763, ["food", "cafes", "local-neighborhood"], ["museum-row", "westwood"]),
      region("westwood", "Arab American National Museum area", "Cultural museum, Dearborn downtown, bakeries, and neighborhood dining.", 42.322, -83.1765, ["culture", "museum", "food"], ["brentwood", "museum-row"]),
      region("pasadena", "Detroit suburbs day trip", "Cranbrook, Royal Oak, Ferndale, or outer-area day planning when the trip has more time.", 42.489, -83.145, ["gardens", "architecture", "shopping"], ["hollywood", "downtown"]),
      region("universal-city", "Major event or full-day anchor", "Sports, concerts, a full museum campus day, or a ticketed experience that should not be overpacked.", 42.34, -83.055, ["event", "family", "full-day"], ["downtown", "hollywood"]),
      region("south-bay", "Southwest Detroit", "Mexicantown, murals, local food, and a compact cultural food-focused extension.", 42.3202, -83.0938, ["food", "culture", "local-neighborhood"], ["little-tokyo", "downtown"])
    ],
    places: [
      place("detroit-riverwalk", "Detroit RiverWalk", "santa-monica", "Follow the riverfront path for skyline views, public art, Cullen Plaza, and an easy first orientation to the city.", ["riverfront", "walk", "viewpoint"], ["Evening walks", "Photography", "Sunset", "Easy outdoor walks"], 90, 0, 0, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "afternoon", 94),
      place("hart-plaza-guardian", "Hart Plaza and Guardian Building", "downtown", "Pair the riverfront civic plaza with the Guardian Building's Art Deco lobby and downtown architecture.", ["architecture", "landmark", "history"], ["Architecture", "History", "Photography", "Famous landmarks"], 85, 0, 0, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "morning", 88),
      place("campus-martius", "Campus Martius and Capitol Park", "downtown", "Use the central square and nearby streets for coffee, people-watching, and a compact downtown food break.", ["walk", "food", "downtown"], ["Local culture", "Cafes", "Casual dining"], 60, 0, 25, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 72),
      place("dia", "Detroit Institute of Arts", "griffith-park", "A major art anchor with the Detroit Industry Murals and enough depth for a meaningful museum block.", ["museum", "art", "indoor"], ["Art", "Museums", "History"], 150, 10, 25, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 96),
      place("detroit-historical", "Detroit Historical Museum", "griffith-park", "A practical companion to DIA for city history, neighborhood context, and indoor backup value.", ["museum", "history", "indoor"], ["Museums", "History", "Local culture"], 90, 0, 15, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 82),
      place("motown-museum", "Motown Museum", "los-feliz", "A music-history must-do at Hitsville U.S.A.; timed-entry planning matters and it pairs well with Midtown/New Center.", ["music", "museum", "history"], ["Music", "Museums", "Local culture"], 90, 15, 30, "indoor", "low", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 92),
      place("fisher-building", "Fisher Building", "los-feliz", "A dramatic Art Deco stop in New Center for architecture, photos, and a lower-walking culture break.", ["architecture", "landmark", "indoor"], ["Architecture", "Photography", "History"], 45, 0, 15, "indoor", "low", "good", ["solo", "couple", "senior"], "morning", 76),
      place("belle-isle-conservatory", "Belle Isle Aquarium and Conservatory area", "venice", "Use Belle Isle's aquarium, conservatory, gardens, and skyline pull-offs as a scenic, flexible park day.", ["park", "aquarium", "garden"], ["Nature", "Gardens", "Family activities", "Photography"], 150, 0, 20, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 90),
      place("belle-isle-sunset", "Belle Isle sunset viewpoint", "venice", "A low-cost scenic stop for Detroit skyline photos and relaxed Great Lakes evening energy.", ["viewpoint", "sunset", "scenic-drive"], ["Sunset", "Photography", "Scenic drives"], 60, 0, 0, "outdoor", "high", "moderate", ["solo", "couple", "family", "senior"], "evening", 78),
      place("grosse-pointe-lakefront", "Grosse Pointe lakefront architecture drive", "malibu", "A calm lakefront extension for residential architecture, park edges, and a slower scenic drive after Belle Isle.", ["scenic-drive", "architecture", "lakefront"], ["Scenic drives", "Architecture", "Photography", "Relaxation"], 80, 0, 15, "outdoor", "medium", "moderate", ["solo", "couple", "senior"], "afternoon", 70),
      place("eastern-market", "Eastern Market", "arts-district", "Plan market sheds, murals, local food, and coffee here; Saturday morning is the strongest version if dates align.", ["market", "food", "murals"], ["Local markets", "Street food", "Local culture", "Photography"], 120, 0, 35, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 88),
      place("dequindre-cut", "Dequindre Cut Greenway", "arts-district", "A mural-lined greenway connecting Eastern Market toward the riverfront; good for a short walk or bike-style break.", ["walk", "murals", "greenway"], ["Evening walks", "Photography", "Outdoor Activities"], 50, 0, 0, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "afternoon", 74),
      place("corktown-michigan-central", "Corktown and Michigan Central Station area", "little-tokyo", "Historic Corktown streets, Roosevelt Park, Michigan Central exterior, coffee, and dinner options in one compact district.", ["historic", "architecture", "food"], ["Architecture", "Local culture", "Cafes", "Photography"], 100, 0, 30, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "afternoon", 84),
      place("mexicantown", "Mexicantown and Southwest Detroit", "south-bay", "A food-forward cultural district for murals, bakeries, tacos, and a relaxed local meal.", ["food", "culture", "local-neighborhood"], ["Mexican", "Bakeries", "Local culture", "Casual dining"], 90, 10, 35, "mixed", "low", "moderate", ["solo", "couple", "family"], "lunch", 80),
      place("the-henry-ford", "The Henry Ford Museum of American Innovation", "museum-row", "A full, followable museum anchor for cars, aviation, civil-rights history, design, and American innovation.", ["museum", "history", "full-day"], ["Museums", "History", "Family activities", "Architecture"], 240, 25, 40, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "morning", 98),
      place("greenfield-village", "Greenfield Village", "beverly-hills", "Historic village campus adjacent to The Henry Ford; best when the group wants a longer Dearborn day.", ["history", "outdoor", "full-day"], ["History", "Outdoor Activities", "Family activities"], 180, 25, 40, "outdoor", "high", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 86),
      place("arab-american-museum", "Arab American National Museum", "westwood", "A meaningful Dearborn cultural stop that pairs naturally with Middle Eastern lunch or dinner.", ["museum", "culture", "indoor"], ["Museums", "Middle Eastern", "Local culture"], 90, 8, 15, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 76),
      place("dearborn-food", "Dearborn Middle Eastern food and bakery stop", "brentwood", "Build in time for Lebanese, Yemeni, Iraqi, or bakery-style food; confirm dietary needs directly.", ["food", "bakery", "local-neighborhood"], ["Middle Eastern", "Bakeries", "Desserts", "Casual dining"], 75, 12, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "dinner", 86),
      place("fox-theatre-district", "Fox Theatre and downtown entertainment district", "weho", "A good evening zone for a show, music, dessert, or drinks-optional downtown walk.", ["evening", "architecture", "live-music"], ["Live music", "Entertainment", "Architecture", "Dessert or cafe evenings"], 105, 10, 70, "mixed", "low", "good", ["solo", "couple", "family"], "evening", 78),
      place("greektown-evening", "Greektown evening area", "weho", "Dinner, dessert, and lively streets near downtown; use rideshare if drinking or after late events.", ["evening", "food", "nightlife"], ["Nightlife", "Bars", "Casual dining", "Desserts"], 90, 15, 55, "mixed", "low", "good", ["solo", "couple"], "evening", 70),
      place("cranbrook", "Cranbrook Art Museum and gardens", "pasadena", "An outer-area architecture, art, and garden day when the trip has enough time for a suburb excursion.", ["museum", "garden", "architecture"], ["Art", "Gardens", "Architecture", "Photography"], 180, 10, 30, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 74),
      place("sports-event-anchor", "Detroit sports or concert night", "universal-city", "Leave room for a Tigers, Lions, Red Wings, Pistons, concert, or theatre event if one matches your dates.", ["event", "entertainment", "full-day"], ["Entertainment", "Sports", "Live music"], 180, 30, 120, "mixed", "low", "good", ["solo", "couple", "family"], "evening", 68),
      place("indoor-midtown-backup", "Midtown indoor backup cluster", "griffith-park", "Use DIA, Detroit Historical Museum, the science center area, or nearby indoor culture if weather turns.", ["museum", "backup", "indoor"], ["Museums", "Family activities", "Art"], 120, 0, 35, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 72)
    ],
    foodAreas: [
      foodArea("downtown-detroit-food", "Downtown Detroit casual dining", "downtown", ["American", "Italian", "Mexican", "Vegetarian-friendly", "Cafes"], ["breakfast", "lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Avoid beef", "Gluten-free"], ["quiet", "lively"]),
      foodArea("eastern-market-food", "Eastern Market food halls and vendors", "arts-district", ["Local cuisine", "Street food", "American", "Mexican", "Bakeries"], ["breakfast", "lunch"], ["budget", "moderate"], ["Vegetarian", "Avoid pork", "Avoid beef"], ["lively"]),
      foodArea("corktown-food", "Corktown restaurants and coffee", "little-tokyo", ["American", "Mexican", "Cafes", "Casual dining"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Gluten-free"], ["quiet"]),
      foodArea("midtown-food", "Midtown museum-day dining", "hollywood", ["American", "Mediterranean", "Cafes", "Vegetarian-friendly"], ["breakfast", "lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Vegan", "Dairy-free"], ["quiet"]),
      foodArea("dearborn-food-area", "Dearborn Middle Eastern dining", "brentwood", ["Middle Eastern", "Bakeries", "Desserts", "Casual dining"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Halal", "Avoid pork"], ["quiet"]),
      foodArea("riverfront-food", "Riverfront and downtown evening dining", "santa-monica", ["American", "Seafood", "Italian", "Desserts", "Cafes"], ["lunch", "dinner"], ["moderate"], ["Vegetarian", "Limited seafood"], ["sunset", "quiet"]),
      foodArea("greektown-food", "Greektown and theatre district dining", "weho", ["Mediterranean", "American", "Desserts", "Bars"], ["dinner"], ["moderate", "premium"], ["Vegetarian", "Gluten-free"], ["nightlife", "live-music"])
    ],
    scenicRoutes: [
      route("riverfront-belle-isle", "Detroit Riverfront to Belle Isle", "santa-monica", "venice", 15, 5, ["riverfront", "park", "scenic-drive"], "afternoon", "A natural scenic pairing; confirm Belle Isle access, parking, and event closures."),
      route("downtown-midtown", "Downtown to Midtown cultural center", "downtown", "griffith-park", 12, 3, ["museum", "architecture"], "morning", "Good same-day pairing when museum hours align."),
      route("midtown-new-center", "Midtown to New Center and Motown", "griffith-park", "los-feliz", 10, 3, ["music", "history"], "afternoon", "Keep timed Motown entry buffered."),
      route("downtown-eastern-corktown", "Downtown, Eastern Market, and Corktown loop", "downtown", "little-tokyo", 14, 4, ["market", "food", "historic"], "afternoon", "Works well as a compact local-culture day."),
      route("detroit-dearborn", "Detroit to Dearborn museum day", "downtown", "museum-row", 25, 12, ["museum", "history", "food"], "morning", "Leave early and avoid overpacking The Henry Ford day.")
    ]
  }
];

function region(id, name, summary, lat, lng, tags, neighboringRegionIds) {
  return { id, name, summary, centerCoordinates: { lat, lng }, tags, neighboringRegionIds, typicalTravelMinutesToRegions: {} };
}

function place(id, name, regionId, shortDescription, categories, tags, duration, costLow, costHigh, indoorOutdoor, weatherDependency, accessibility, suitableFor, bestTimeOfDay, priorityScore) {
  return {
    id,
    name,
    regionId,
    shortDescription,
    categories,
    tags,
    suitableFor,
    typicalDurationMinutes: duration,
    minimumDurationMinutes: Math.max(30, Math.round(duration * 0.65)),
    maximumDurationMinutes: Math.round(duration * 1.35),
    estimatedCostLow: costLow,
    estimatedCostHigh: costHigh,
    indoorOutdoor,
    weatherDependency,
    accessibility,
    dietaryRelevance: categories.includes("food") ? ["local options vary"] : [],
    openingTimeGuidance: bestTimeOfDay === "evening" ? "Best later in the day; confirm hours." : "Confirm current hours before travel.",
    bestTimeOfDay,
    reservationRecommended: categories.includes("theme-park") || categories.includes("museum") || categories.includes("evening"),
    seasonalNotes: [],
    conflictTags: accessibility === "limited" ? ["minimal-walking"] : [],
    priorityScore,
    coordinates: null,
    backupForTags: indoorOutdoor === "indoor" ? ["weather", "heat", "rain"] : accessibility === "good" ? ["low-walking"] : [],
    sourceMetadata: {
      provider: "curated",
      providerPlaceId: id,
      retrievedName: name,
      retrievedAt: "curated",
      sourceUrl: "",
      dataConfidence: "high",
      dataFreshness: "curated"
    }
  };
}

function foodArea(id, name, regionId, cuisines, mealTypes, budgetLevels, dietarySupport, eveningSuitability) {
  return { id, name, regionId, cuisines, mealTypes, budgetLevels, dietarySupport, eveningSuitability, shortDescription: `${name} with ${cuisines.slice(0, 3).join(", ")} options.` };
}

function route(id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags, bestTimeOfDay, notes) {
  return { id, name, originRegionId, destinationRegionId, estimatedDriveMinutes, estimatedDistanceMiles, tags, bestTimeOfDay, notes };
}

export function resolveDestinationProfile(destination) {
  const normalized = String(destination || "").toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return [...generatedDestinationProfiles, ...destinationProfiles].find((profile) => profile.aliases.some((alias) => normalized === alias.replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim()) || normalized.includes(profile.aliases[0])) || createGenericDestinationProfile(destination);
}

export function getDestinationProfile(id) {
  return [...generatedDestinationProfiles, ...destinationProfiles].find((profile) => profile.id === id) || null;
}

export function registerGeneratedDestinationProfile(profile) {
  const normalized = normalizeGeneratedDestinationProfile(profile);
  if (!normalized) return null;
  const existingIndex = generatedDestinationProfiles.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) generatedDestinationProfiles.splice(existingIndex, 1, normalized);
  else generatedDestinationProfiles.unshift(normalized);
  return normalized;
}

function normalizeGeneratedDestinationProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const canonicalName = String(profile.canonicalName || "").trim();
  if (!canonicalName) return null;
  const id = String(profile.id || `generated-${canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`).slice(0, 72);
  const aliases = Array.isArray(profile.aliases) && profile.aliases.length ? profile.aliases : [canonicalName.toLowerCase()];
  const regions = Array.isArray(profile.regions) ? profile.regions.filter((item) => item?.id && item?.name).slice(0, 18) : [];
  const places = Array.isArray(profile.places) ? profile.places.filter((item) => item?.id && item?.name && item?.regionId).slice(0, 42) : [];
  const foodAreas = Array.isArray(profile.foodAreas) ? profile.foodAreas.filter((item) => item?.id && item?.name && item?.regionId).slice(0, 14) : [];
  const scenicRoutes = Array.isArray(profile.scenicRoutes) ? profile.scenicRoutes.filter((item) => item?.id && item?.originRegionId && item?.destinationRegionId).slice(0, 14) : [];
  if (regions.length < 4 || places.length < 8 || foodAreas.length < 3) return null;
  return {
    id,
    canonicalName,
    aliases,
    country: String(profile.country || ""),
    state: String(profile.state || ""),
    timezone: String(profile.timezone || ""),
    currency: String(profile.currency || "USD"),
    summary: String(profile.summary || `${canonicalName} generated destination profile.`),
    seasonalNotes: arrayOfStrings(profile.seasonalNotes, 4),
    generalAdvisories: arrayOfStrings(profile.generalAdvisories, 5),
    planningRules: {
      defaultHotelRegion: String(profile.planningRules?.defaultHotelRegion || regions[0].id),
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions: regions.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      summary: String(item.summary || ""),
      centerCoordinates: item.centerCoordinates || { lat: 0, lng: 0 },
      tags: arrayOfStrings(item.tags, 8),
      neighboringRegionIds: arrayOfStrings(item.neighboringRegionIds, 8),
      typicalTravelMinutesToRegions: item.typicalTravelMinutesToRegions || {}
    })),
    places: places.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      regionId: String(item.regionId),
      shortDescription: String(item.shortDescription || ""),
      categories: arrayOfStrings(item.categories, 8),
      tags: arrayOfStrings(item.tags, 10),
      suitableFor: arrayOfStrings(item.suitableFor, 6).length ? arrayOfStrings(item.suitableFor, 6) : ["solo", "couple", "family", "senior"],
      typicalDurationMinutes: Number(item.typicalDurationMinutes || 90),
      minimumDurationMinutes: Number(item.minimumDurationMinutes || 45),
      maximumDurationMinutes: Number(item.maximumDurationMinutes || 150),
      estimatedCostLow: Number(item.estimatedCostLow || 0),
      estimatedCostHigh: Number(item.estimatedCostHigh || 35),
      indoorOutdoor: String(item.indoorOutdoor || "mixed"),
      weatherDependency: String(item.weatherDependency || "medium"),
      accessibility: String(item.accessibility || "moderate"),
      dietaryRelevance: arrayOfStrings(item.dietaryRelevance, 6),
      openingTimeGuidance: String(item.openingTimeGuidance || "Confirm current hours before travel."),
      bestTimeOfDay: String(item.bestTimeOfDay || "afternoon"),
      reservationRecommended: Boolean(item.reservationRecommended),
      seasonalNotes: arrayOfStrings(item.seasonalNotes, 4),
      conflictTags: arrayOfStrings(item.conflictTags, 6),
      priorityScore: Number(item.priorityScore || 70),
      coordinates: item.coordinates || null,
      backupForTags: arrayOfStrings(item.backupForTags, 8)
      ,
      sourceMetadata: item.sourceMetadata || {
        provider: "generated-provider",
        providerPlaceId: String(item.id),
        retrievedName: String(item.name),
        retrievedAt: new Date().toISOString(),
        sourceUrl: "",
        dataConfidence: "medium",
        dataFreshness: "retrieved"
      }
    })),
    foodAreas: foodAreas.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      regionId: String(item.regionId),
      cuisines: arrayOfStrings(item.cuisines, 10),
      mealTypes: arrayOfStrings(item.mealTypes, 5),
      budgetLevels: arrayOfStrings(item.budgetLevels, 5),
      dietarySupport: arrayOfStrings(item.dietarySupport, 10),
      eveningSuitability: arrayOfStrings(item.eveningSuitability, 6),
      shortDescription: String(item.shortDescription || "")
    })),
    scenicRoutes: scenicRoutes.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      originRegionId: String(item.originRegionId),
      destinationRegionId: String(item.destinationRegionId),
      estimatedDriveMinutes: Number(item.estimatedDriveMinutes || 20),
      estimatedDistanceMiles: Number(item.estimatedDistanceMiles || 8),
      tags: arrayOfStrings(item.tags, 8),
      bestTimeOfDay: String(item.bestTimeOfDay || "afternoon"),
      notes: String(item.notes || "Confirm current conditions before departure.")
    }))
  };
}

function arrayOfStrings(value, limit) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit) : [];
}

export function createGenericDestinationProfile(destination) {
  const name = String(destination || "").trim();
  if (!name) return null;
  const canonicalName = name.replace(/\s+/g, " ");
  return {
    id: `generic-${canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "destination"}`,
    canonicalName,
    aliases: [canonicalName.toLowerCase()],
    country: "",
    state: "",
    timezone: "",
    currency: "USD",
    summary: `${canonicalName} will be planned with a flexible starter itinerary. Recommendations use preference-based activity categories because detailed local attraction data has not been curated yet.`,
    seasonalNotes: [
      "Check local weather, opening hours, closures, and travel conditions before confirming the day.",
      "Keep outdoor and scenic plans flexible until current conditions are verified."
    ],
    generalAdvisories: [
      "This destination uses RouteMosaic's generic planning mode, not curated local venue data.",
      "Verify exact locations, hours, reservations, accessibility, dietary safety, prices, and travel times before booking or traveling."
    ],
    planningRules: {
      defaultHotelRegion: "downtown",
      maxRegionChangesRelaxed: 1,
      maxRegionChangesBalanced: 2,
      maxRegionChangesPacked: 3
    },
    regions: [
      region("santa-monica", "Arrival area", "A low-friction arrival or orientation area near lodging, transit, or the first meal.", 0, 0, ["arrival", "orientation", "easy"], ["downtown", "museum-row"]),
      region("venice", "Local neighborhood", "A neighborhood-focused block for cafes, shopping streets, markets, and relaxed discovery.", 0, 0, ["local-neighborhood", "food", "shopping"], ["santa-monica", "downtown"]),
      region("malibu", "Scenic edge", "A scenic route, viewpoint, waterfront, countryside, or landscape-focused outing.", 0, 0, ["scenic-drive", "nature", "viewpoint"], ["santa-monica", "griffith-park"]),
      region("hollywood", "Signature sights", "Recognizable landmarks, main squares, public viewpoints, and first-time visitor anchors.", 0, 0, ["landmark", "tourist", "photo"], ["griffith-park", "downtown"]),
      region("griffith-park", "Nature and viewpoints", "Parks, gardens, easy walks, viewpoints, and lower-intensity outdoor time.", 0, 0, ["nature", "viewpoint", "easy-walk"], ["hollywood", "malibu"]),
      region("los-feliz", "Quiet evening area", "Calmer dinner, dessert, cafe, sunset, or evening-walk planning.", 0, 0, ["quiet-evening", "cafes", "sunset"], ["griffith-park", "downtown"]),
      region("downtown", "Central district", "Museums, architecture, markets, local food, transit access, and compact urban planning.", 0, 0, ["culture", "food", "architecture", "museums"], ["arts-district", "little-tokyo", "museum-row"]),
      region("arts-district", "Creative district", "Murals, galleries, design streets, maker spaces, casual food, and flexible evenings.", 0, 0, ["art", "food", "nightlife"], ["downtown", "little-tokyo"]),
      region("little-tokyo", "Cultural quarter", "Heritage streets, local shops, food clusters, cultural districts, and compact walks.", 0, 0, ["culture", "food", "walkable"], ["downtown", "arts-district"]),
      region("museum-row", "Museum and market area", "Indoor museums, markets, public art, and food halls for weather-flexible planning.", 0, 0, ["museums", "culture", "indoor-backup"], ["downtown", "beverly-hills"]),
      region("beverly-hills", "Polished leisure area", "Gardens, premium shopping streets, lower-walking sightseeing, and relaxed breaks.", 0, 0, ["shopping", "gardens", "low-walking"], ["museum-row", "weho"]),
      region("weho", "Dining and nightlife area", "Dinner zones, live music, dessert, bars, and nightlife if selected by the group.", 0, 0, ["evening", "nightlife", "food"], ["downtown", "museum-row"]),
      region("brentwood", "Viewpoint and culture area", "A viewpoint, architectural site, garden, or larger culture anchor.", 0, 0, ["museum", "architecture", "viewpoint"], ["santa-monica", "museum-row"]),
      region("westwood", "Campus or village area", "A village, university district, cafe zone, or residential neighborhood pause.", 0, 0, ["food", "local-neighborhood"], ["brentwood", "beverly-hills"]),
      region("pasadena", "Day-trip district", "A self-contained day-trip area with gardens, old town streets, history, or scenic surroundings.", 0, 0, ["gardens", "culture", "low-walking"], ["downtown", "griffith-park"]),
      region("universal-city", "Ticketed anchor area", "A full-day ticketed attraction, major tour, theme park, performance, or must-do anchor.", 0, 0, ["theme-park", "family", "full-day"], ["hollywood", "downtown"]),
      region("south-bay", "Relaxed waterfront or park area", "A slower beach, lakefront, riverfront, garden, promenade, or sunset alternative.", 0, 0, ["beach", "sunset", "quiet-evening"], ["venice", "santa-monica"])
    ],
    places: [
      place("arrival-orientation", `${canonicalName} arrival orientation`, "santa-monica", "Easy first-day orientation around lodging, transit, a casual meal, and a short scenic stroll.", ["arrival", "easy-walk", "food"], ["Relaxation", "Local culture", "Photography"], 90, 0, 20, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 82),
      place("signature-landmarks", "Signature landmarks and viewpoints", "hollywood", "A focused block for the best-known landmark area, main viewpoint, or classic first-time sights.", ["landmark", "viewpoint", "photo"], ["Famous landmarks", "Photography", "Scenic drives"], 120, 0, 35, "outdoor", "medium", "moderate", ["solo", "couple", "family", "senior"], "morning", 88),
      place("central-culture", "Central culture and architecture walk", "downtown", "Museums, architecture, historic streets, public spaces, and local context grouped in the central district.", ["culture", "architecture", "museum"], ["Museums", "Architecture", "History"], 150, 10, 45, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "morning", 86),
      place("local-market", "Local market or food hall", "downtown", "A flexible lunch stop around local specialties, market stalls, or a food hall-style area.", ["food", "market", "casual"], ["Food experiences", "Local markets", "Casual dining"], 75, 15, 35, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "lunch", 84),
      place("museum-weather-backup", "Museum or indoor backup", "museum-row", "Weather-flexible museum, gallery, science center, aquarium, or indoor cultural stop.", ["museum", "indoor", "backup"], ["Museums", "Art", "Family activities"], 130, 10, 40, "indoor", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 80),
      place("creative-neighborhood", "Creative neighborhood and local shops", "arts-district", "Galleries, murals, independent shops, coffee, casual dining, and local streets.", ["art", "shopping", "food"], ["Art", "Shopping", "Local culture"], 95, 0, 30, "mixed", "low", "moderate", ["solo", "couple", "family"], "afternoon", 76),
      place("heritage-quarter", "Cultural quarter and heritage streets", "little-tokyo", "A compact area for local culture, heritage sites, specialty shops, sweets, and casual food.", ["culture", "food", "walk"], ["Local culture", "History", "Food experiences"], 85, 0, 30, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "afternoon", 78),
      place("scenic-route", "Scenic route and viewpoint", "malibu", "A scenic drive, waterfront route, countryside loop, or viewpoint-centered outing.", ["scenic-drive", "viewpoint", "nature"], ["Scenic drives", "Photography", "Nature"], 150, 0, 30, "outdoor", "high", "moderate", ["solo", "couple", "family", "senior"], "afternoon", 90),
      place("easy-nature", "Easy nature, garden, or park time", "griffith-park", "Parks, botanical gardens, waterfront paths, or easy outdoor time tuned to walking comfort.", ["nature", "garden", "easy-walk"], ["Nature", "Gardens", "Easy outdoor walks"], 100, 0, 25, "outdoor", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 84),
      place("premium-leisure", "Gardens, shopping, and relaxed leisure", "beverly-hills", "A polished lower-intensity area for gardens, shopping streets, cafes, or scenic rest time.", ["shopping", "garden", "relaxation"], ["Shopping", "Relaxation", "Photography"], 80, 0, 35, "mixed", "medium", "good", ["solo", "couple", "senior"], "afternoon", 70),
      place("quiet-evening", "Quiet dinner, dessert, or evening walk", "los-feliz", "A calm evening plan centered on dinner, dessert, cafe time, sunset, or an easy stroll.", ["quiet-evening", "dessert", "food"], ["Dessert or cafe evenings", "Evening walks", "Relaxation"], 80, 15, 35, "mixed", "low", "good", ["solo", "couple", "family", "senior"], "evening", 82),
      place("nightlife-evening", "Live music or nightlife district", "weho", "A flexible evening zone for live music, cocktails, bars, or nightlife when those preferences are selected.", ["evening", "live-music", "nightlife"], ["Live music", "Nightlife", "Bars"], 120, 20, 70, "mixed", "low", "good", ["solo", "couple"], "evening", 74),
      place("full-day-anchor", "Full-day ticketed or must-do anchor", "universal-city", "A theme park, guided tour, boat day, performance, major museum, or other full-day reservation anchor.", ["theme-park", "tour", "full-day"], ["Theme parks", "Tours", "Entertainment"], 420, 60, 160, "mixed", "low", "good", ["solo", "couple", "family"], "full-day", 72),
      place("day-trip-area", "Self-contained day-trip area", "pasadena", "A nearby district or day-trip zone with enough sights and meals to avoid repeated cross-town travel.", ["day-trip", "gardens", "culture"], ["Gardens", "History", "Scenic drives"], 210, 15, 55, "mixed", "medium", "good", ["solo", "couple", "family", "senior"], "morning", 78),
      place("relaxed-waterfront", "Relaxed waterfront, riverfront, or sunset area", "south-bay", "A lower-key scenic area for sunset, a gentle walk, and an easier evening pace.", ["beach", "sunset", "quiet"], ["Sunset", "Relaxation", "Photography"], 90, 0, 25, "outdoor", "high", "good", ["solo", "couple", "family", "senior"], "evening", 76)
    ],
    foodAreas: [
      foodArea("central-food", "Central local dining area", "downtown", ["Local cuisine", "American", "Casual dining", "Vegetarian-friendly"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Avoid beef", "Gluten-free"], ["quiet"]),
      foodArea("market-food", "Market or food hall options", "downtown", ["Local cuisine", "Street food", "Desserts", "Casual dining"], ["lunch"], ["budget", "moderate"], ["Vegetarian", "Avoid pork", "Avoid beef"], ["lively"]),
      foodArea("neighborhood-cafes", "Neighborhood cafes and bakeries", "venice", ["Cafes", "Bakeries", "American", "Vegetarian-friendly"], ["breakfast", "lunch"], ["budget", "moderate"], ["Vegetarian", "Vegan", "Dairy-free"], ["quiet"]),
      foodArea("cultural-dining", "Cultural quarter dining", "little-tokyo", ["Indian", "Italian", "Mexican", "Chinese", "Japanese", "Middle Eastern"], ["lunch", "dinner"], ["budget", "moderate"], ["Vegetarian", "Halal", "Kosher", "Jain"], ["quiet"]),
      foodArea("scenic-dining", "Scenic-route casual dining", "malibu", ["Local cuisine", "American", "Seafood", "Cafes"], ["lunch", "dinner"], ["moderate", "premium"], ["Vegetarian", "Limited seafood"], ["sunset"]),
      foodArea("evening-dining", "Evening dining district", "weho", ["Italian", "Mediterranean", "American", "Fine dining"], ["dinner"], ["moderate", "premium"], ["Vegetarian", "Vegan", "Gluten-free"], ["nightlife", "live-music"])
    ],
    scenicRoutes: [
      route("arrival-central-link", "Arrival area to central district", "santa-monica", "downtown", 25, 10, ["orientation", "short-drive"], "morning", "Use as a practical first route after confirming actual lodging."),
      route("central-culture-link", "Central culture district link", "downtown", "museum-row", 18, 6, ["culture", "museum"], "afternoon", "Keep cultural stops grouped to reduce backtracking."),
      route("scenic-edge-link", "Scenic edge route", "griffith-park", "malibu", 45, 24, ["scenic-drive", "nature"], "afternoon", "Confirm exact route conditions before departure."),
      route("evening-link", "Central district to evening area", "downtown", "weho", 20, 7, ["evening", "food"], "evening", "Use rideshare or a designated driver if alcohol is involved.")
    ]
  };
}
