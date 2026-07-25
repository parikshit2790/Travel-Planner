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
    backupForTags: indoorOutdoor === "indoor" ? ["weather", "heat", "rain"] : accessibility === "good" ? ["low-walking"] : []
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
  return destinationProfiles.find((profile) => profile.aliases.some((alias) => normalized === alias.replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim()) || normalized.includes(profile.aliases[0])) || null;
}

export function getDestinationProfile(id) {
  return destinationProfiles.find((profile) => profile.id === id) || null;
}
