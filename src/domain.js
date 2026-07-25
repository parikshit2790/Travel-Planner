export const STORAGE_KEY = "routemosaic-personalization-state-v3";
export const SAVED_DRAFT_KEY = "routemosaic-explicit-draft-v1";
export const SAVED_TRIPS_KEY = "routemosaic-local-saved-trips-v1";

export const importanceWeights = {
  "Must have": 100,
  "Strong preference": 80,
  "Nice to have": 45,
  Neutral: 0,
  Avoid: -70,
  "Must avoid": -100
};

const coreStyleValueReplacements = {
  "Strongly Nature": "Nature",
  "Strongly Urban": "Urban",
  "Very Lively": "Lively"
};

const coreStylePreferenceKeys = new Set([
  normalizePreferenceKey("environment", "Nature"),
  normalizePreferenceKey("environment", "Urban"),
  normalizePreferenceKey("environment", "Balanced nature and city"),
  normalizePreferenceKey("atmosphere", "Very Quiet"),
  normalizePreferenceKey("atmosphere", "Quiet"),
  normalizePreferenceKey("atmosphere", "Relaxed"),
  normalizePreferenceKey("atmosphere", "Balanced"),
  normalizePreferenceKey("atmosphere", "Social"),
  normalizePreferenceKey("atmosphere", "Lively"),
  normalizePreferenceKey("atmosphere", "Very Lively"),
  normalizePreferenceKey("style", "Secluded"),
  normalizePreferenceKey("style", "Quiet Area"),
  normalizePreferenceKey("style", "Balanced"),
  normalizePreferenceKey("style", "Central"),
  normalizePreferenceKey("style", "Busy District")
]);

export const groupTypes = [
  "Solo trip",
  "Couple trip",
  "Family trip",
  "Friends trip",
  "Girls trip",
  "Boys trip",
  "Multi-generational trip",
  "Business and leisure trip",
  "Bachelor or bachelorette trip",
  "Anniversary trip",
  "Honeymoon",
  "Birthday trip",
  "Reunion",
  "Other"
];

export const optionSets = {
  environment: ["Nature", "Urban", "Balanced nature and city", "Mountains", "Lakes", "Rivers", "Waterfalls", "Beaches", "Forests", "Snow", "Scenic countryside", "Small towns", "Historic towns", "Major cities", "Downtown areas", "Waterfront areas", "Secluded areas", "Remote areas", "Quiet neighborhoods", "Busy entertainment districts", "Tourist areas", "Local neighborhoods", "Luxury areas", "Rustic areas"],
  experiences: ["Aurora or northern lights", "Stargazing", "Sunrise", "Sunset", "Scenic drives", "Photography", "Wildlife viewing", "Waterfalls", "Lakes", "National parks", "State parks", "Easy hikes", "Moderate hikes", "Difficult hikes", "Boat tours", "Cruises", "Ferries", "Kayaking", "Canoeing", "Swimming", "Beaches", "Museums", "History", "Architecture", "Art", "Live music", "Theater", "Sports", "Festivals", "Shopping", "Local markets", "Nightlife", "Bars", "Breweries", "Wineries", "Spas", "Romantic experiences", "Family activities", "Children's attractions", "Adventure activities", "Relaxation", "Food experiences", "Local culture", "Hidden gems", "Famous landmarks"],
  atmosphere: ["Very private", "Secluded", "Quiet", "Relaxed", "Romantic", "Social", "Lively", "Party-focused", "Family-friendly", "Adults-only preferred", "Tourist-friendly", "Local atmosphere", "Luxury", "Casual", "Rustic", "Adventure-focused"],
  diet: ["Vegetarian", "Vegan", "Pescatarian", "Non-vegetarian", "Chicken preferred", "Seafood acceptable", "Halal", "Kosher", "Jain", "Gluten-free", "Dairy-free", "Low-carb", "Diabetic-conscious", "Other"],
  restrictions: ["Avoid beef", "Avoid pork", "Avoid seafood", "Limited seafood", "Avoid eggs", "Avoid dairy", "Avoid spicy food", "Other"],
  cuisine: ["Indian", "American", "Italian", "Mexican", "Mediterranean", "Chinese", "Japanese", "Thai", "Korean", "Middle Eastern", "Local cuisine", "Fine dining", "Casual dining", "Street food", "Cafes", "Bakeries", "Desserts"],
  meal: ["Hotel breakfast preferred", "Quick breakfast preferred", "Restaurant lunch preferred", "Packed lunch acceptable", "Restaurant dinner preferred", "Fine-dining interest"],
  alcohol: ["No alcohol", "Hide alcohol-focused recommendations", "Alcohol acceptable", "Occasional drinks", "Cocktails", "Bars", "Breweries", "Wineries", "Distilleries", "Quiet evening venues", "Live music", "Nightlife", "Party-focused nightlife", "Dessert or cafe evenings", "Evening walks", "Sunset activities", "Designated driver required", "Rideshare preferred after drinking"],
  lodging: ["Hotel", "Resort", "Cabin", "Vacation rental", "Hostel", "Boutique hotel", "Luxury hotel", "Budget hotel", "Downtown hotel", "Airport hotel", "Waterfront", "Mountain view", "Secluded property", "Walkable location", "Free parking", "Free breakfast", "Kitchen required", "Pet-friendly", "Family-friendly", "Adults-only", "Accessible room"],
  transportation: ["Drive from origin", "Fly", "Fly and rent a car", "Train", "Bus", "Public transportation", "Rideshare", "Walking-focused", "Mixed transportation"]
};

export const travelerRestrictionOptions = [
  "Food allergy",
  "Gluten intolerance",
  "Lactose intolerance",
  "Mandatory vegetarian",
  "Mandatory vegan",
  "Halal requirement",
  "Kosher requirement",
  "Jain food requirement",
  "Avoid beef",
  "Avoid pork",
  "Avoid seafood",
  "Mobility limitation",
  "Wheelchair accessibility",
  "Stroller requirement",
  "Minimal walking",
  "Medical travel consideration",
  "Other"
];

export const preferenceOwners = {
  "trip.from": 1,
  "trip.destination": 1,
  "trip.destinationRegions": 1,
  "trip.dates": 1,
  "trip.transportation": 1,
  "trip.description": 1,
  "trip.mustHavePlaces": 1,
  "trip.avoidPlaces": 1,
  "travelers.composition": 2,
  "travelers.restrictions": 2,
  "style.balance": 3,
  "style.atmosphere": 3,
  "style.locationFeel": 3,
  "style.experiences": 3,
  "food.diet": 4,
  "food.restrictions": 4,
  "food.cuisine": 4,
  "food.meals": 4,
  "alcohol.preference": 4,
  "evening.preferences": 4,
  "schedule.pace": 5,
  "schedule.majorActivities": 5,
  "schedule.latestReturn": 5,
  "comfort.walking": 5,
  "transport.drivingLimits": 5,
  "budget.total": 5,
  "lodging.requirements": 5
};

export const experienceCategories = {
  "Nature and Scenery": ["Mountains", "Lakes", "Waterfalls", "Forests", "Beaches", "Scenic drives", "Viewpoints", "Wildlife", "National parks", "State parks", "Sunrise", "Sunset", "Stargazing"],
  "Outdoor Activities": ["Hiking", "Easy outdoor walks", "Cycling", "Adventure activities", "Winter activities", "Scenic trains", "Road trips"],
  "Water Experiences": ["Boat tours", "Cruises", "Ferries", "Kayaking", "Canoeing", "Swimming", "Beach time"],
  "City and Culture": ["Museums", "History", "Architecture", "Art", "Local neighborhoods", "Famous landmarks", "Shopping", "Markets", "Local culture"],
  Relaxation: ["Slow mornings", "Spa", "Resort time", "Scenic cafes", "Hotel downtime"],
  Entertainment: ["Live music", "Theater", "Sports", "Festivals", "Nightlife", "Casinos"],
  "Special Experiences": ["Northern lights", "Photography", "Romantic experiences", "Hidden gems", "Food experiences", "Family activities", "Theme parks", "Tours"],
  "Seasonal Experiences": ["Snow", "Fall colors", "Holiday markets", "Wildflowers", "Summer festivals"]
};

export function normalizePreferenceKey(category, label) {
  return `${String(category || "general").toLowerCase().replaceAll(" ", "_")}.${String(label || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

export function mergePreferenceSources(existingSources, source) {
  return [...new Set([...(existingSources || []), source].filter(Boolean))];
}

const broadDestinations = [
  "california",
  "michigan",
  "florida",
  "texas",
  "europe",
  "italy",
  "japan",
  "northern michigan",
  "pacific northwest"
];

const broadLocationTypes = new Set(["State", "Province", "Region", "Country", "Multi-country Region"]);

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function preference(category, label, importance = "Nice to have", source = "Explicit selection") {
  return {
    id: uid("pref"),
    category,
    label,
    value: true,
    importance,
    weight: importanceWeights[importance],
    source
  };
}

export function createTripDraft() {
  return {
    id: uid("trip"),
    from: "",
    fromDisplay: "",
    fromVerificationStatus: "Location Not Verified",
    fromLocation: null,
    fromPlaceId: "",
    fromLat: null,
    fromLng: null,
    fromAirportCode: "",
    destination: "",
    destinationDisplay: "",
    destinationVerificationStatus: "Location Not Verified",
    destinationLocation: null,
    destinationRefinements: [],
    destinationRefinementStatus: "Not Started",
    destinationPlaceId: "",
    destinationLat: null,
    destinationLng: null,
    destinationAirportCode: "",
    destinationRegions: "",
    description: "",
    days: "",
    startDate: "",
    endDate: "",
    transportation: "",
    groupType: "Solo trip",
    adults: 1,
    children: 0,
    childrenAges: "",
    seniors: 0,
    samePreferences: true,
    travelers: [
      { id: uid("traveler"), name: "", ageGroup: "Adult", notes: "", restrictions: [], otherRestrictionText: "" }
    ],
    preferences: [],
    originalText: "",
    interpretedSuggestions: [],
    style: {
      balance: "Balanced",
      atmosphere: "Balanced",
      locationFeel: "Balanced",
      customExperience: ""
    },
    migrationReport: [],
    schedule: {
      pace: "Balanced",
      wakeUp: "",
      earliestActivity: "",
      dinnerTime: "",
      latestEnd: "",
      latestReturn: "",
      sunrise: false,
      lateNight: false,
      freeTime: "",
      majorActivities: "",
      restBreaks: true,
      hotelBreaks: false,
      dislikesHotelChanges: true
    },
    activity: {
      walking: "Not Specified",
      hiking: "No hiking",
      maxHikeDistance: "",
      maxHikeDuration: "",
      maxElevation: "",
      accessibility: []
    },
    food: {
      diet: [],
      restrictions: [],
      cuisine: [],
      mealStyle: [],
      breakfast: "",
      lunch: "Flexible",
      dinner: "",
      foodBudgetPerPerson: "",
      driveForFood: "",
      reservations: "",
      mealTimes: "",
      breakfastTime: "",
      lunchTime: "",
      dinnerTime: ""
    },
    alcohol: {
      preferences: [],
      primary: "Not Specified",
      recommendationVisibility: "Show Normally",
      nightlifeLevel: "Low",
      preferredNights: "",
      latestReturn: "",
      transportAfterDrinking: "",
      hideAlcohol: false
    },
    lodging: {
      styles: [],
      maxNightlyBudget: "",
      rooms: 1,
      beds: "",
      changeHotels: "Minimize hotel changes",
      maxDistance: "30 minutes"
    },
    transport: {
      style: "Fly and rent a car",
      maxDrivingDay: "",
      maxContinuous: "",
      scenicRoutes: false,
      fastestRoute: false,
      tolls: "No Preference",
      ferries: "No Preference",
      rentalCar: "",
      childSeat: false,
      accessible: false,
      electricVehicle: false,
      charging: ""
    },
    budget: {
      style: "Not Specified",
      total: "",
      lodging: "",
      food: "",
      activities: "",
      transportation: "",
      mustDoSpend: true,
      freeAttractions: true,
      paidTours: "",
      strictness: "Flexible"
    },
    mustHavePlaces: "",
    avoidPlaces: "",
    confirmedPlans: ""
  };
}

export function migrateTripState(trip) {
  trip.fromDisplay ||= normalizePlaceName(trip.from || "");
  trip.fromVerificationStatus ||= "Location Not Verified";
  trip.fromLocation ||= null;
  trip.fromPlaceId ||= "";
  trip.fromLat ??= null;
  trip.fromLng ??= null;
  trip.fromAirportCode ||= "";
  trip.destinationDisplay ||= normalizePlaceName(trip.destination || "");
  trip.destinationVerificationStatus ||= "Location Not Verified";
  trip.destinationLocation ||= null;
  trip.destinationRefinements ||= [];
  trip.destinationRefinementStatus ||= trip.destinationRefinements.length ? "Refined" : "Not Started";
  trip.destinationPlaceId ||= "";
  trip.destinationLat ??= null;
  trip.destinationLng ??= null;
  trip.destinationAirportCode ||= "";
  trip.destinationRegions ||= "";
  trip.originalText ||= trip.description || "";
  trip.interpretedSuggestions ||= [];
  trip.style ||= {};
  trip.style.balance ||= inferStyleBalance(trip.preferences || []);
  trip.style.atmosphere ||= inferAtmosphere(trip.preferences || []);
  trip.style.locationFeel ||= inferLocationFeel(trip.preferences || []);
  trip.style.customExperience ||= "";
  trip.style.customImportance ||= "Nice to have";
  trip.migrationReport ||= [];
  trip.schedule ||= {};
  trip.schedule.latestReturn ||= trip.alcohol?.latestReturn || trip.schedule.latestEnd || "";
  trip.food ||= {};
  trip.food.dinnerTime ||= trip.schedule.dinnerTime || trip.food.dinnerTime || "";
  trip.alcohol ||= {};
  trip.alcohol.primary ||= (trip.alcohol.preferences || []).includes("No alcohol") ? "No Alcohol" : "Not Specified";
  trip.alcohol.recommendationVisibility ||= trip.alcohol.hideAlcohol ? "Hide Completely" : "Show Normally";
  trip.transport ||= {};
  trip.transport.routePreference ||= trip.transport.scenicRoutes ? "Prefer Scenic Routes" : "Balanced";
  trip.transport.tolls = {
    Avoid: "Avoid Tolls",
    Flexible: "Use Tolls When Helpful",
    Okay: "No Preference"
  }[trip.transport.tolls] || trip.transport.tolls || "No Preference";
  trip.transport.ferries = {
    "Interested in ferries": "Interested in Ferries",
    Interested: "Interested in Ferries",
    Flexible: "Ferries Are Acceptable",
    Avoid: "Avoid Ferries"
  }[trip.transport.ferries] || trip.transport.ferries || "No Preference";
  reconcileTripDates(trip);
  trip.food.diet ||= [];
  trip.food.restrictions ||= [];
  trip.food.cuisine ||= [];
  trip.food.mealStyle ||= [];
  trip.alcohol.preferences ||= [];
  trip.travelers ||= [];

  for (const traveler of trip.travelers) {
    traveler.restrictions ||= [];
    traveler.notes ||= "";
    traveler.otherRestrictionText ||= "";
    if (/^Traveler \d+$/i.test(String(traveler.name || ""))) traveler.name = "";
    delete traveler.gender;
  }

  const foodCategories = new Set(["diet", "restrictions", "alcohol"]);
  for (const pref of [...(trip.preferences || [])]) {
    if (pref.category === "diet" && !trip.food.diet.includes(pref.label)) trip.food.diet.push(pref.label);
    if (pref.category === "restrictions" && !trip.food.restrictions.includes(pref.label)) trip.food.restrictions.push(pref.label);
    if (pref.category === "alcohol" && !trip.alcohol.preferences.includes(pref.label)) trip.alcohol.preferences.push(pref.label);
  }
  trip.preferences = (trip.preferences || []).filter((pref) => !foodCategories.has(pref.category));

  trip.food.diet = normalizeOptions(trip.food.diet, {
    "Chicken only": "Chicken preferred",
    "Non vegetarian": "Non-vegetarian"
  });
  trip.alcohol.preferences = normalizeOptions(trip.alcohol.preferences, {
    "Avoid alcohol-focused places": "Hide alcohol-focused recommendations",
    "Alcohol is acceptable": "Alcohol acceptable",
    "Interested in cocktails": "Cocktails",
    "Interested in bars": "Bars",
    "Interested in breweries": "Breweries",
    "Interested in wineries": "Wineries",
    "Interested in distilleries": "Distilleries",
    "Interested in nightlife": "Nightlife",
    "Prefer quiet evening venues": "Quiet evening venues"
  });
  reconcileTripStylePreferences(trip);
  return trip;
}

export function normalizeCoreStyleValue(value) {
  return coreStyleValueReplacements[value] || value || "Balanced";
}

export function excludeNeutralPreferences(preferences) {
  return (preferences || []).filter((pref) => pref.active !== false && pref.importance !== "Neutral" && Number(pref.weight ?? importanceWeights[pref.importance] ?? 0) !== 0);
}

export function removeCoreStyleDuplicates(trip) {
  trip.preferences = (trip.preferences || []).filter((pref) => {
    const key = pref.key || normalizePreferenceKey(pref.category, pref.label);
    return !coreStylePreferenceKeys.has(key);
  });
  return trip;
}

export function getUniqueSelectedExperiences(trip) {
  const deduped = removeDuplicatePreferences(trip.preferences || []);
  return excludeNeutralPreferences(deduped)
    .filter((pref) => pref.category === "experiences")
    .sort((a, b) => Math.abs((b.weight ?? 0)) - Math.abs((a.weight ?? 0)) || String(a.label).localeCompare(String(b.label)));
}

export function countSelectedExperiences(trip) {
  return getUniqueSelectedExperiences(trip).length;
}

export function reconcileTripStylePreferences(trip) {
  trip.style ||= {};
  trip.style.balance = normalizeCoreStyleValue(trip.style.balance);
  trip.style.atmosphere = normalizeCoreStyleValue(trip.style.atmosphere);
  trip.style.locationFeel = normalizeCoreStyleValue(trip.style.locationFeel);
  trip.preferences = removeDuplicatePreferences(trip.preferences || []);
  removeCoreStyleDuplicates(trip);
  trip.preferences = excludeNeutralPreferences(trip.preferences);
  return trip;
}

function inferStyleBalance(preferences) {
  const hasNature = preferences.some((pref) => ["Nature", "Lakes", "Waterfalls", "Mountains", "Forests"].includes(pref.label));
  const hasUrban = preferences.some((pref) => ["Urban", "Major cities", "Downtown areas"].includes(pref.label));
  if (hasNature && !hasUrban) return "Mostly Nature";
  if (hasUrban && !hasNature) return "Mostly Urban";
  return "Balanced";
}

function inferAtmosphere(preferences) {
  const hasQuiet = preferences.some((pref) => ["Quiet", "Secluded", "Relaxed"].includes(pref.label));
  const hasLively = preferences.some((pref) => ["Lively", "Social", "Party-focused"].includes(pref.label));
  if (hasQuiet && !hasLively) return "Relaxed";
  if (hasLively && !hasQuiet) return "Social";
  return "Balanced";
}

function inferLocationFeel(preferences) {
  const hasSecluded = preferences.some((pref) => ["Secluded areas", "Remote areas", "Quiet neighborhoods"].includes(pref.label));
  const hasCentral = preferences.some((pref) => ["Downtown areas", "Busy entertainment districts", "Central"].includes(pref.label));
  if (hasSecluded && !hasCentral) return "Quiet Area";
  if (hasCentral && !hasSecluded) return "Central";
  return "Balanced";
}

export function normalizePlaceName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function localDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateFromLocalValue(value) {
  const parts = localDateParts(value);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

function formatLocalDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateInclusiveTripDays(startDate, endDate) {
  const start = dateFromLocalValue(startDate);
  const end = dateFromLocalValue(endDate);
  if (!start || !end) return null;
  return Math.round((end - start) / 86400000) + 1;
}

export function calculateTripEndDate(startDate, days) {
  const start = dateFromLocalValue(startDate);
  const count = Number(days);
  if (!start || !Number.isInteger(count) || count < 1) return "";
  const end = new Date(start);
  end.setDate(start.getDate() + count - 1);
  return formatLocalDateValue(end);
}

export function calculateTripNights(days) {
  const count = Number(days);
  return Number.isInteger(count) && count > 0 ? Math.max(0, count - 1) : 0;
}

export function reconcileTripDates(trip, changedField = "") {
  const days = Number(trip.days);
  if (changedField === "trip.endDate" && trip.startDate && trip.endDate) {
    const inclusive = calculateInclusiveTripDays(trip.startDate, trip.endDate);
    if (inclusive && inclusive > 0) trip.days = inclusive;
    return trip;
  }
  if ((changedField === "trip.days" || changedField === "trip.startDate" || !changedField) && trip.startDate && Number.isInteger(days) && days > 0) {
    trip.endDate = calculateTripEndDate(trip.startDate, days);
  } else if (trip.startDate && trip.endDate) {
    const inclusive = calculateInclusiveTripDays(trip.startDate, trip.endDate);
    if (inclusive && inclusive > 0) trip.days = inclusive;
  }
  return trip;
}

export function validateTripDateRange(trip) {
  const issues = [];
  if (trip.days === "" || trip.days === null || trip.days === undefined) return issues;
  const days = Number(trip.days);
  if (!Number.isInteger(days)) issues.push({ severity: "Critical", issue: "Number of Days must be a whole number.", action: "Fix Number of Days", field: "trip.days", blocking: true });
  else if (days < 1) issues.push({ severity: "Critical", issue: "Number of Days must be at least 1.", action: "Fix Number of Days", field: "trip.days", blocking: true });
  else if (days > 60) issues.push({ severity: "Critical", issue: "Number of Days cannot exceed 60.", action: "Fix Number of Days", field: "trip.days", blocking: true });
  if (trip.startDate && trip.endDate) {
    const inclusive = calculateInclusiveTripDays(trip.startDate, trip.endDate);
    if (inclusive !== null && inclusive < 1) issues.push({ severity: "Critical", issue: "End Date cannot be before Start Date.", action: "Fix End Date", field: "trip.endDate", blocking: true });
  }
  return issues;
}

export function destinationNeedsClarification(trip) {
  const destination = String(trip.destination || "").trim().toLowerCase();
  if (!destination) return false;
  const broad = broadDestinations.includes(destination);
  const structuredBroad = isBroadLocation(trip.destinationLocation);
  return (broad || structuredBroad) && !String(trip.destinationRegions || "").trim() && !(trip.destinationRefinements || []).length;
}

export function isBroadLocation(location) {
  return Boolean(location && broadLocationTypes.has(location.locationType));
}

export function locationVerificationLabel(location, fallbackStatus = "Location Not Verified") {
  if (location?.verificationStatus === "Verified") return "Verified";
  if (fallbackStatus === "ProviderUnavailable") return "Suggestions are unavailable. You can keep typing.";
  if (fallbackStatus === "NeedsReview") return "Select a suggestion to verify this location.";
  return fallbackStatus === "Location Not Verified" ? "Select a suggestion to verify this location." : fallbackStatus || "Select a suggestion to verify this location.";
}

export function tripBasicsIssues(trip) {
  const issues = [];
  if (!String(trip.from || "").trim()) issues.push({ severity: "Critical", issue: "Traveling From is required.", action: "Add Traveling From", field: "trip.from", blocking: true });
  if (!String(trip.destination || "").trim()) issues.push({ severity: "Critical", issue: "Destination is required.", action: "Add Destination", field: "trip.destination", blocking: true });
  issues.push(...validateTripDateRange(trip));
  if (destinationNeedsClarification(trip)) {
    issues.push({
      severity: "Advisory",
      issue: `${normalizePlaceName(trip.destination)} is a large destination. Choose one or more cities or regions so we can build a realistic route.`,
      action: "Add Cities or Regions",
      field: "trip.destinationRegions",
      blocking: false
    });
  }
  return issues;
}

function normalizeOptions(values, replacements) {
  return [...new Set((values || []).map((value) => replacements[value] || value))];
}

export function travelerTotal(trip) {
  if (trip.groupType === "Solo trip") return 1;
  return Math.max(1, Number(trip.adults || 0) + Number(trip.children || 0) + Number(trip.seniors || 0));
}

export function syncTravelersToCounts(trip) {
  if (trip.groupType === "Solo trip") {
    trip.adults = 1;
    trip.children = 0;
    trip.childrenAges = "";
    trip.seniors = 0;
    trip.samePreferences = true;
  }

  const total = travelerTotal(trip);
  const existing = trip.travelers || [];
  const next = [];
  for (let index = 0; index < total; index += 1) {
    const ageGroup = index < Number(trip.adults || 0) ? "Adult" : index < Number(trip.adults || 0) + Number(trip.children || 0) ? "Child" : "Senior";
    next.push({
      id: existing[index]?.id || uid("traveler"),
      name: /^Traveler \d+$/i.test(String(existing[index]?.name || "")) ? "" : existing[index]?.name || "",
      ageGroup: existing[index]?.ageGroup || ageGroup,
      notes: existing[index]?.notes || "",
      restrictions: existing[index]?.restrictions || [],
      otherRestrictionText: existing[index]?.otherRestrictionText || ""
    });
  }
  trip.travelers = next;
  return trip;
}

export function travelerWarnings(trip) {
  const warnings = [];
  const total = travelerTotal(trip);
  if ((trip.travelers || []).length !== total) {
    warnings.push(`Traveler rows must match the group count of ${total}.`);
  }
  if (trip.groupType === "Solo trip" && total !== 1) {
    warnings.push("Solo trip should have exactly 1 traveler.");
  }
  if (Number(trip.children || 0) > 0 && !String(trip.childrenAges || "").trim()) {
    warnings.push("Children's ages help avoid unsuitable activities and should be entered.");
  }
  (trip.travelers || []).forEach((traveler, index) => {
    if (!String(traveler.ageGroup || "").trim()) warnings.push(`${traveler.name || `Traveler ${index + 1}`} needs an age group.`);
  });
  return warnings;
}

export function foodAndRestrictionWarnings(trip) {
  const warnings = [];
  const groupRestrictions = new Set([...(trip.food?.diet || []), ...(trip.food?.restrictions || [])]);
  for (const traveler of trip.travelers || []) {
    for (const restriction of traveler.restrictions || []) {
      if (["Food allergy", "Gluten intolerance", "Lactose intolerance", "Mandatory vegetarian restriction", "Mandatory vegan restriction", "Halal requirement", "Kosher requirement", "Jain food requirement", "Avoid beef", "Avoid pork"].includes(restriction)) {
        const compatible = restriction.includes("vegetarian") ? groupRestrictions.has("Vegetarian") : restriction.includes("vegan") ? groupRestrictions.has("Vegan") : restriction.includes("Halal") ? groupRestrictions.has("Halal") : restriction.includes("Kosher") ? groupRestrictions.has("Kosher") : restriction.includes("Jain") ? groupRestrictions.has("Jain") : restriction.includes("beef") ? groupRestrictions.has("Avoid beef") : restriction.includes("pork") ? groupRestrictions.has("Avoid pork") : false;
        if (!compatible) warnings.push(`${traveler.name || "Traveler"} has ${restriction}; restaurant planning must satisfy this even if it is not a group-wide food preference.`);
      }
    }
  }
  if ((trip.alcohol?.preferences || []).includes("No alcohol") && (trip.alcohol?.preferences || []).some((value) => ["Bars", "Breweries", "Wineries", "Distilleries", "Party-focused nightlife"].includes(value))) {
    warnings.push("Alcohol preferences conflict. Hide or downgrade alcohol-focused evening recommendations.");
  }
  return warnings;
}

export function interpretFreeText(text) {
  const lower = text.toLowerCase();
  const matches = [];
  const rules = [
    ["environment", "Lakes", ["lake", "lakes"]],
    ["environment", "Secluded areas", ["secluded", "quiet", "private", "remote"]],
    ["environment", "Urban", ["city", "downtown", "urban"]],
    ["experiences", "Adventure activities", ["adventure", "advanture"]],
    ["experiences", "Aurora or northern lights", ["aurora", "northern lights"]],
    ["experiences", "Stargazing", ["stargazing", "stars", "night sky"]],
    ["experiences", "Photography", ["photography", "photo", "photos"]],
    ["experiences", "Architecture", ["architecture"]],
    ["experiences", "Nightlife", ["nightlife", "bars", "club"]],
    ["experiences", "Scenic drives", ["scenic drive", "road trip"]],
    ["diet", "Vegetarian", ["vegetarian"]],
    ["restrictions", "Avoid beef", ["no beef", "avoid beef"]],
    ["restrictions", "Avoid pork", ["no pork", "avoid pork"]],
    ["alcohol", "No alcohol", ["no alcohol", "avoid alcohol"]],
    ["alcohol", "Interested in breweries", ["brewery", "breweries"]],
    ["lodging", "Cabin", ["cabin", "cabins"]],
    ["lodging", "Downtown hotel", ["downtown hotel"]],
    ["lodging", "Secluded property", ["secluded cabin", "secluded property"]]
  ];
  for (const [category, label, needles] of rules) {
    if (needles.some((needle) => lower.includes(needle))) {
      matches.push(preference(category, label, "Strong preference", "Trip Description"));
    }
  }
  if (lower.includes("avoid") && lower.includes("nightlife")) {
    matches.push(preference("atmosphere", "Party-focused", "Avoid", "Trip Description"));
  }
  return dedupePreferences(matches);
}

export function dedupePreferences(preferences) {
  const seen = new Map();
  for (const pref of preferences) {
    const key = pref.key || normalizePreferenceKey(pref.category, pref.label);
    pref.key = key;
    pref.active ??= true;
    pref.sources = mergePreferenceSources(pref.sources, pref.source || "Explicit Selection");
    const existing = seen.get(key);
    if (!existing) seen.set(key, pref);
    else {
      existing.sources = mergePreferenceSources(existing.sources, pref.source);
      existing.source = existing.sources.join(", ");
      if (Math.abs(pref.weight) > Math.abs(existing.weight) || pref.source === "Explicit Selection") {
        existing.importance = pref.importance;
        existing.weight = pref.weight;
        existing.label = pref.label;
        existing.category = pref.category;
      }
    }
  }
  return [...seen.values()];
}

export function addOrUpdatePreference(trip, category, label, importance, source = "Explicit selection") {
  return upsertCanonicalPreference(trip, { category, label, importance, source });
}

export function upsertCanonicalPreference(trip, { category, label, importance = "Nice to have", source = "Explicit Selection", owningStep = null, travelerId = null }) {
  trip.preferences ||= [];
  const key = normalizePreferenceKey(category, label);
  const existing = trip.preferences.find((pref) => (pref.key || normalizePreferenceKey(pref.category, pref.label)) === key && (pref.travelerId || null) === travelerId);
  if (existing) {
    existing.importance = importance;
    existing.weight = importanceWeights[importance];
    existing.source = source;
    existing.sources = mergePreferenceSources(existing.sources, source);
    existing.active = true;
    existing.lastUpdatedAt = new Date().toISOString();
  } else {
    const next = preference(category, label, importance, source);
    next.key = key;
    next.owningStep = owningStep;
    next.sources = mergePreferenceSources([], source);
    next.travelerId = travelerId;
    next.active = true;
    next.lastUpdatedAt = new Date().toISOString();
    trip.preferences.push(next);
  }
  trip.preferences = removeDuplicatePreferences(trip.preferences);
  return trip;
}

export function removeDuplicatePreferences(preferences) {
  return dedupePreferences(preferences || []);
}

export function countUniqueActivePreferences(trip) {
  return removeDuplicatePreferences(trip.preferences || []).filter((pref) => pref.active !== false).length;
}

export function getPreferencesByOwningStep(trip, step) {
  return removeDuplicatePreferences(trip.preferences || []).filter((pref) => pref.owningStep === step || inferOwningStep(pref) === step);
}

export function inferOwningStep(pref) {
  if (["diet", "restrictions", "food", "cuisine", "meal", "alcohol", "evening"].includes(pref.category)) return 4;
  if (["environment", "experiences", "atmosphere", "style"].includes(pref.category)) return 3;
  return pref.owningStep || 3;
}

export function removePreference(trip, id) {
  trip.preferences = trip.preferences.filter((pref) => pref.id !== id);
}

export function validateBasics(trip) {
  return tripBasicsIssues(trip).filter((issue) => issue.blocking).map((issue) => issue.issue);
}

export function parseTimeOfDay(value) {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(value || "").trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3]?.toUpperCase();
  if (minutes > 59 || hours > 23) return null;
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function getTripIssues(trip) {
  const issues = [
    ...tripBasicsIssues(trip),
    ...travelerWarnings(trip).map((issue) => ({ severity: "Critical", issue, action: "Edit Travelers", field: "travelers", owningStep: 2, blocking: true })),
    ...analyzeTrip(trip).warnings.map((issue) => ({ severity: "Warning", issue, action: "Review plan assumptions", owningStep: 6, blocking: false })),
    ...foodAndRestrictionWarnings(trip).map((issue) => ({ severity: "Warning", issue, action: "Review food settings", owningStep: 4, blocking: false }))
  ];
  const alcohol = trip.alcohol?.preferences || [];
  if (trip.alcohol?.primary === "No Alcohol" && alcohol.some((item) => ["Cocktails", "Bars", "Breweries", "Wineries", "Distilleries"].includes(item))) {
    issues.push({ severity: "Critical", issue: "No Alcohol conflicts with alcohol-focused interests.", action: "Edit Alcohol", field: "trip.alcohol.primary", owningStep: 4, blocking: true });
  }
  const dinner = parseTimeOfDay(trip.food?.dinnerTime);
  const latestReturn = parseTimeOfDay(trip.schedule?.latestReturn);
  if (dinner !== null && latestReturn !== null && dinner > latestReturn) {
    issues.push({ severity: "Warning", issue: "Preferred Dinner Time is later than Latest Return.", action: "Edit Food or Comfort", field: "trip.food.dinnerTime", owningStep: 5, blocking: false });
  }
  if ((trip.budget?.strictness === "Strict" || trip.budget?.style === "Custom amount") && !String(trip.budget?.total || "").trim()) {
    issues.push({ severity: "Critical", issue: "Strict or custom budget requires a Total Budget.", action: "Add Total Budget", field: "trip.budget.total", owningStep: 5, blocking: true });
  }
  return issues;
}

export function analyzeTrip(trip) {
  const warnings = [];
  const explanations = [];
  const prefs = trip.preferences;
  const has = (category, label) => prefs.some((pref) => pref.category === category && pref.label === label && pref.weight > 0);
  const avoids = (category, label) => prefs.some((pref) => pref.category === category && pref.label === label && pref.weight < 0);
  const noAlcohol = trip.alcohol.hideAlcohol || trip.alcohol.preferences.includes("No alcohol") || trip.alcohol.preferences.includes("Avoid alcohol-focused places");

  if (trip.groupType.includes("Girls") || trip.groupType.includes("Boys") || trip.groupType.includes("Couple")) {
    explanations.push("Group type is used only for context. Recommendations should come from explicit preferences, not stereotypes.");
  }
  if (has("experiences", "Aurora or northern lights")) {
    warnings.push("Aurora visibility is never guaranteed. The plan should use flexible nighttime windows and avoid overloading the following morning.");
  }
  if (noAlcohol && (has("experiences", "Nightlife") || trip.alcohol.preferences.includes("Interested in bars") || trip.alcohol.preferences.includes("Interested in breweries"))) {
    warnings.push("Alcohol preferences conflict. Use alcohol-optional venues or hide alcohol-focused stops.");
  }
  if (trip.activity.walking === "Minimal walking" && (has("experiences", "Moderate hikes") || has("experiences", "Difficult hikes"))) {
    warnings.push("Hiking preferences may conflict with minimal walking. Clearly warn before suggesting strenuous activities.");
  }
  if (trip.budget.strictness === "Strict" && trip.budget.style === "Luxury") {
    warnings.push("Strict budget and luxury style may conflict. Show budget impact before generating.");
  }
  if (avoids("environment", "Urban") && has("environment", "Major cities")) {
    warnings.push("Urban preferences conflict. Prefer quieter neighborhoods or explain city tradeoffs.");
  }
  if (trip.transport.maxDrivingDay && parseFloat(trip.transport.maxDrivingDay) <= 2 && has("experiences", "Scenic drives")) {
    warnings.push("Scenic-drive interest may conflict with low driving tolerance. Suggest short scenic routes.");
  }
  explanations.push(...topPreferences(trip).slice(0, 4).map((pref) => `${pref.label} is ${pref.importance.toLowerCase()} for this trip.`));
  return { warnings, explanations };
}

export function topPreferences(trip) {
  return [...trip.preferences].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

export function generatePlanPreview(trip) {
  const analysis = analyzeTrip(trip);
  const top = topPreferences(trip).filter((pref) => pref.weight > 0).slice(0, 6);
  const avoid = topPreferences(trip).filter((pref) => pref.weight < 0).slice(0, 4);
  const days = Array.from({ length: Number(trip.days || 1) }, (_, index) => {
    const pace = trip.schedule.pace;
    const majorActivities = Number(trip.schedule.majorActivities || (pace === "Packed" ? 4 : pace === "Relaxed" ? 1 : 2));
    return {
      day: index + 1,
      morning: index === 0 ? "Arrival buffer and first easy activity" : `${trip.schedule.earliestActivity} start with ${top[index % Math.max(top.length, 1)]?.label || "destination highlight"}`,
      afternoon: `${majorActivities} major activity target; keep ${trip.schedule.freeTime} free time`,
      evening: trip.alcohol.hideAlcohol ? "Quiet alcohol-free evening option" : `${trip.schedule.dinnerTime} dinner; nightlife only if explicitly selected`,
      note: analysis.warnings[index % Math.max(analysis.warnings.length, 1)] || "No provider research connected yet; verify facts before final itinerary."
    };
  });
  return {
    id: uid("preview"),
    createdAt: new Date().toISOString(),
    summary: `A ${trip.schedule.pace.toLowerCase()} ${trip.groupType.toLowerCase()} to ${trip.destination || "TBD"} built from explicit preferences, not stereotypes.`,
    days,
    prioritized: top,
    avoided: avoid,
    warnings: analysis.warnings,
    explanations: analysis.explanations
  };
}

export function saveProfile(state, name, trip) {
  const profile = {
    id: uid("profile"),
    name,
    isDefault: state.profiles.length === 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preferences: structuredClone(trip.preferences),
    schedule: structuredClone(trip.schedule),
    activity: structuredClone(trip.activity),
    food: structuredClone(trip.food),
    alcohol: structuredClone(trip.alcohol),
    lodging: structuredClone(trip.lodging),
    transport: structuredClone(trip.transport),
    budget: structuredClone(trip.budget)
  };
  state.profiles.push(profile);
  return profile;
}
