import { initialState } from "./seed.js?v=28";
import {
  STORAGE_KEY,
  SAVED_DRAFT_KEY,
  addOrUpdatePreference,
  analyzeTrip,
  countUniqueActivePreferences,
  countSelectedExperiences,
  experienceCategories,
  generatePlanPreview,
  getTripIssues,
  groupTypes,
  importanceWeights,
  interpretFreeText,
  foodAndRestrictionWarnings,
  getUniqueSelectedExperiences,
  isBroadLocation,
  locationVerificationLabel,
  migrateTripState,
  normalizePlaceName,
  optionSets,
  preferenceOwners,
  reconcileTripDates,
  removePreference,
  reconcileTripStylePreferences,
  saveProfile,
  syncTravelersToCounts,
  calculateTripNights,
  tripBasicsIssues,
  travelerTotal,
  travelerWarnings,
  travelerRestrictionOptions,
  validateBasics
} from "./domain.js";
import { createLocationSearchProvider, LOCATION_MIN_QUERY_LENGTH, LOCATION_SEARCH_DEBOUNCE_MS } from "./location-provider.js";

let state = load();
const locationProvider = createLocationSearchProvider();
const locationTimers = {};
let ui = {
  openRestrictionTravelerId: null,
  restrictionSearch: "",
  focusRestrictionTriggerId: null,
  showWarnings: false,
  showPreferences: false,
  interpretationError: "",
  toast: "",
  openExperienceCategory: null,
  experienceSearch: "",
  openFoodSection: null,
  foodDraft: null,
  foodSearch: "",
  openLodgingPicker: false,
  planningPrinciplesOpen: false,
  planningPrinciplesSuppressHover: false,
  focusPlanningPrinciples: false,
  activeLocationField: null,
  locationSuggestions: { from: [], destination: [], destinationRegions: [] },
  locationLoading: { from: false, destination: false, destinationRegions: false },
  locationError: { from: "", destination: "", destinationRegions: "" },
  locationHighlight: { from: -1, destination: -1, destinationRegions: -1 },
  locationRequestId: { from: 0, destination: 0, destinationRegions: 0 },
  touchedBasicsFields: new Set(),
  basicsSubmitAttempted: false
};

let globalListenersBound = false;

const steps = [
  "Trip Basics",
  "Travelers",
  "Trip Style",
  "Food and Evenings",
  "Comfort and Budget",
  "Review"
];

const stepSubtitles = [
  "Where, when, and who",
  "Who's coming",
  "Your travel vibe",
  "Taste and unwind",
  "Travel your way",
  "Finalize and go"
];

const stepHeadings = [
  ["Where should your next trip take you?", "Add the essential details. RouteMosaic will use them to shape a realistic itinerary."],
  ["Who is going on this trip?", "Add the group composition and traveler-specific needs."],
    ["What kind of experience do you want?", "Choose style scales and only the experiences that matter."],
  ["How do you want to eat and spend your evenings?", "Set group-wide dining, dietary, alcohol, and evening preferences."],
  ["Set your comfort level and budget.", "Help us fine-tune your trip to match your style, comfort, and budget."],
  ["Review your plan before we build the trip.", "Check your selections and confirm that everything looks good."]
];

function load() {
  clearTransientWizardStorage();
  const loaded = structuredClone(initialState);
  migrateTripState(loaded.trip);
  reconcileTripStylePreferences(loaded.trip);
  syncTravelersToCounts(loaded.trip);
  return loaded;
}

function clearTransientWizardStorage() {
  [
    STORAGE_KEY,
    "routemosaic-personalization-state-v1",
    "routemosaic-personalization-state-v2",
    "routemosaic-personalization-state-v3",
    "activeTripDraft",
    "tripWizardState",
    "lastPlanningRequest",
    "currentStep"
  ].forEach((key) => localStorage.removeItem(key));
}

function persist(message = "Saved") {
  reconcileTripStylePreferences(state.trip);
  state.lastSaved = `${message} ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  render();
}

function saveExplicitDraft() {
  reconcileTripStylePreferences(state.trip);
  const draft = {
    savedAt: new Date().toISOString(),
    activeStep: state.activeStep,
    trip: structuredClone(state.trip),
    preview: structuredClone(state.preview)
  };
  localStorage.setItem(SAVED_DRAFT_KEY, JSON.stringify(draft));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function input(path, value, label, type = "text") {
  return `<input aria-label="${esc(label)}" placeholder="${esc(label)}" data-field="${esc(path)}" type="${type}" value="${esc(value ?? "")}">`;
}

function textarea(path, value, label) {
  return `<textarea aria-label="${esc(label)}" data-field="${esc(path)}">${esc(value ?? "")}</textarea>`;
}

function select(path, value, options, label) {
  const choices = value === "" && !options.includes("") ? ["", ...options] : options;
  return `<select aria-label="${esc(label)}" data-field="${esc(path)}">${choices.map((option) => `<option ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>`;
}

function checkbox(path, checked, label) {
  return `<input aria-label="${esc(label)}" data-check="${esc(path)}" type="checkbox" ${checked ? "checked" : ""}>`;
}

function table(headers, rows, empty = "Nothing yet.") {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td class="empty" colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}

function badge(text) {
  return `<span class="badge ${String(text).toLowerCase().replaceAll(" ", "-")}">${esc(text)}</span>`;
}

function button(label, action, tone = "") {
  return `<button class="${tone}" data-action="${esc(action)}">${esc(label)}</button>`;
}

function titleCase(value) {
  return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function tripDateSummary(trip) {
  if (!Number(trip.days)) return "Dates not set";
  if (!trip.startDate || !trip.endDate || !Number(trip.days)) return `${trip.days || 0} day${Number(trip.days) === 1 ? "" : "s"}`;
  return `${trip.days} day${Number(trip.days) === 1 ? "" : "s"} · ${formatDateRange(trip.startDate, trip.endDate)}`;
}

function dateParts(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function monthName(month) {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1];
}

function formatDateRange(startValue, endValue) {
  const start = dateParts(startValue);
  const end = dateParts(endValue);
  if (!start || !end) return `${startValue}–${endValue}`;
  if (start.year === end.year && start.month === end.month) return `${monthName(start.month)} ${start.day}–${end.day}, ${start.year}`;
  if (start.year === end.year) return `${monthName(start.month)} ${start.day}–${monthName(end.month)} ${end.day}, ${start.year}`;
  return `${monthName(start.month)} ${start.day}, ${start.year}–${monthName(end.month)} ${end.day}, ${end.year}`;
}

function shortMonthName(month) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1];
}

function formatShortDateRange(startValue, endValue) {
  const start = dateParts(startValue);
  const end = dateParts(endValue);
  if (!start || !end) return `${startValue}–${endValue}`;
  if (start.year === end.year && start.month === end.month) return `${shortMonthName(start.month)} ${start.day}–${end.day}, ${start.year}`;
  if (start.year === end.year) return `${shortMonthName(start.month)} ${start.day}–${shortMonthName(end.month)} ${end.day}, ${start.year}`;
  return `${shortMonthName(start.month)} ${start.day}, ${start.year}–${shortMonthName(end.month)} ${end.day}, ${end.year}`;
}

function render() {
  const trip = state.trip;
  const travelerCount = travelerTotal(trip);
  const issueCount = visibleReviewIssues().length;
  const [heading, supportingText] = stepHeadings[state.activeStep - 1];
  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      <aside class="side">
        <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div><strong>RouteMosaic</strong><small>Personalized trip builder</small></div></div>
        <nav class="steps">${steps.map((step, index) => stepNavButton(step, index + 1)).join("")}</nav>
        ${SidebarScenicIllustration()}
        ${PlanningPrinciplesFooter()}
      </aside>
      <main class="wizard-main step-${state.activeStep}">
        <header class="top ${state.activeStep > 1 ? "step-top" : ""}">
          <div>
            <p class="eyebrow">${esc(steps[state.activeStep - 1])}</p>
            <h1>${esc(heading)}</h1>
            <p>${esc(supportingText)}</p>
          </div>
          ${PageHeaderIllustration(state.activeStep)}
        </header>
        ${state.activeStep === 1 ? tripBasicsChrome(trip, travelerCount, issueCount) : wizardChrome(trip, travelerCount, issueCount)}
        ${ui.showWarnings && issueCount ? warningTray() : ""}
        ${ui.showPreferences ? acceptedPreferencesTray() : ""}
        ${ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : ""}
        ${stepView()}
      </main>
    </div>
    ${restrictionOverlay()}
    ${locationAutocompleteOverlay()}
    ${experienceOverlay()}
    ${foodSectionOverlay()}
    ${lodgingOverlay()}`;
  bind();
  positionRestrictionOverlay();
}

function PageHeaderIllustration(stepNumber) {
  return [
    TripBasicsHeaderGraphic,
    TravelersHeaderGraphic,
    TripStyleHeaderGraphic,
    FoodEveningsHeaderGraphic,
    ComfortBudgetHeaderGraphic,
    ReviewHeaderGraphic
  ][stepNumber - 1]?.() || "";
}

function TravelHeaderIllustration() {
  return TripBasicsHeaderGraphic();
}

function headerImage(src, alt, className = "") {
  return `<img class="page-header-illustration ${className}" src="${esc(`${src}?v=43`)}" alt="${esc(alt)}" loading="eager" decoding="async">`;
}

function headerScenery(content, className = "") {
  return `<svg class="page-header-illustration ${className}" viewBox="0 0 470 156" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="headerSky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--surface-tint)" />
        <stop offset="1" stop-color="var(--sunrise)" />
      </linearGradient>
      <linearGradient id="headerWater" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#bceeff" />
        <stop offset="1" stop-color="var(--turquoise)" />
      </linearGradient>
      <linearGradient id="headerRoute" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="var(--turquoise)" />
        <stop offset="1" stop-color="var(--accent)" />
      </linearGradient>
      <linearGradient id="headerOrange" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffb347" />
        <stop offset="1" stop-color="#ff6500" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="470" height="156" rx="28" fill="url(#headerSky)" opacity="0.74" />
    ${content}
  </svg>`;
}

function TripBasicsHeaderGraphic() {
  return headerImage("src/assets/header-trip-basics.png", "Scenic mountain lake destination illustration", "trip-basics-graphic");
}

function TravelersHeaderGraphic() {
  return headerImage("src/assets/header-travelers.png", "Travelers enjoying a scenic waterfront illustration", "travelers-graphic");
}

function TripStyleHeaderGraphic() {
  return headerImage("src/assets/header-trip-style.png", "Mountain exploration route illustration", "trip-style-graphic");
}

function FoodEveningsHeaderGraphic() {
  return headerImage("src/assets/header-food-evenings.png", "Waterfront dinner at sunset illustration", "food-evenings-graphic");
}

function ComfortBudgetHeaderGraphic() {
  return headerImage("src/assets/header-comfort-budget.png", "Hotel suitcase passport and travel budget illustration", "comfort-budget-graphic");
}

function ReviewHeaderGraphic() {
  return headerImage("src/assets/header-review.png", "Traveler reviewing a finished trip plan illustration", "review-graphic");
}

function SidebarScenicIllustration() {
  return `<img class="sidebar-scenic-illustration" src="src/assets/sidebar-lighthouse.png?v=43" alt="Lighthouse beside a calm lake at dusk" loading="eager" decoding="async">`;
}

function PlanningPrinciplesFooter() {
  return `<div class="planning-principles ${ui.planningPrinciplesOpen ? "open" : ""} ${ui.planningPrinciplesSuppressHover ? "suppress-hover" : ""}">
    <button class="planning-principles-trigger" type="button" aria-expanded="${ui.planningPrinciplesOpen}" aria-controls="planning-principles-popover" data-action="togglePlanningPrinciples">
      <span aria-hidden="true">ⓘ</span>
      <strong>Planning Principles</strong>
    </button>
    <div class="planning-popover" id="planning-principles-popover" role="dialog" aria-label="Planning Principles">
      <strong>No Stereotypes</strong>
      <p>Group labels provide context only. Recommendations follow explicit preferences and restrictions.</p>
    </div>
  </div>`;
}

function metric(label, value, sub) {
  const action = label === "Issues" ? ` data-action="toggleWarnings" role="button" tabindex="0"` : label === "Preferences" ? ` data-action="togglePreferences" role="button" tabindex="0"` : "";
  return `<article class="metric metric-${label.toLowerCase()} ${action ? "clickable" : ""}"${action}><span class="metric-icon" aria-hidden="true">${summaryIcon(label)}</span><div><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(sub)}</span></div></article>`;
}

function summaryIcon(label) {
  return {
    Travelers: iconSvg("travelers"),
    Dates: iconSvg("calendar"),
    Issues: iconSvg("warning"),
    Preferences: iconSvg("heart")
  }[label] || "";
}

function iconSvg(name) {
  const icons = {
    travelers: `<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="4"/><circle cx="17" cy="10" r="3"/><path d="M2.5 21c.8-4.4 3-7 6.5-7s5.7 2.6 6.5 7"/><path d="M14.5 20c.6-3.2 2.3-5 4.7-5 1.4 0 2.6.6 3.5 1.9"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2z"/><path d="M8 2v5M16 2v5M3 10h18M7 14h3M14 14h3M7 18h3M14 18h3"/></svg>`,
    warning: `<svg viewBox="0 0 24 24"><path d="M12 3 22 21H2z"/><path d="M12 9v5M12 18h.01"/></svg>`,
    heart: `<svg viewBox="0 0 24 24"><path d="M20.8 5.7a5.2 5.2 0 0 0-7.4 0L12 7.1l-1.4-1.4a5.2 5.2 0 1 0-7.4 7.4L12 22l8.8-8.9a5.2 5.2 0 0 0 0-7.4z"/></svg>`,
    mapPin: `<svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-13A7 7 0 0 0 5 9c0 6.9 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
    person: `<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 21c1-5 3.7-8 8-8s7 3 8 8"/></svg>`,
    scale: `<svg viewBox="0 0 24 24"><path d="M12 3v18M5 7h14M7 7l-4 7h8zM17 7l-4 7h8z"/></svg>`,
    leaf: `<svg viewBox="0 0 24 24"><path d="M21 4C12 4 5 9 5 18c0 0 8-1 13-8"/><path d="M5 18c2-4 5-7 9-9"/></svg>`,
    cloud: `<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.2 8.5 4.8 4.8 0 0 0 7 18z"/></svg>`,
    mountain: `<svg viewBox="0 0 24 24"><path d="M3 20 10 7l4 7 2-3 5 9z"/><path d="m10 7 2.5 4.5L15 9"/></svg>`,
    trees: `<svg viewBox="0 0 24 24"><path d="M7 4 2 13h4l-3 5h8l-3-5h4zM17 6l-4 7h3l-2 4h7l-2-4h3z"/><path d="M7 18v3M17 17v4"/></svg>`,
    hiking: `<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="m9 21 2-7-3-3 3-4 4 3 3 1M14 12l3 9M7 13l-3 3M18 10l2 11"/></svg>`,
    water: `<svg viewBox="0 0 24 24"><path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13z"/><path d="M9 16c1.4 1.2 4.6 1.2 6 0"/></svg>`,
    city: `<svg viewBox="0 0 24 24"><path d="M4 21V9h6v12M10 21V4h7v17M17 21v-9h3v9"/><path d="M7 12h.01M7 16h.01M13 8h.01M13 12h.01M13 16h.01"/></svg>`,
    lotus: `<svg viewBox="0 0 24 24"><path d="M12 20c-5 0-8-3-9-7 4 0 7 2 9 7z"/><path d="M12 20c5 0 8-3 9-7-4 0-7 2-9 7z"/><path d="M12 20c-3-4-3-8 0-13 3 5 3 9 0 13z"/></svg>`,
    mask: `<svg viewBox="0 0 24 24"><path d="M4 5c4 2 12 2 16 0v7c0 5-3.5 8-8 8s-8-3-8-8z"/><path d="M8 11h.01M16 11h.01M9 16c2 1 4 1 6 0"/></svg>`,
    star: `<svg viewBox="0 0 24 24"><path d="m12 2 2.8 6 6.2.8-4.6 4.5 1.2 6.3L12 16.5l-5.6 3.1 1.2-6.3L3 8.8 9.2 8z"/></svg>`,
    snow: `<svg viewBox="0 0 24 24"><path d="M12 2v20M4 6l16 12M20 6 4 18M7 4l5 4 5-4M7 20l5-4 5 4"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    check: `<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>`,
    camera: `<svg viewBox="0 0 24 24"><path d="M4 8h4l2-3h4l2 3h4v11H4z"/><circle cx="12" cy="14" r="4"/></svg>`,
    accessibility: `<svg viewBox="0 0 24 24"><circle cx="12" cy="4" r="2"/><path d="M12 7v6M7 9h10M9 21l3-8 3 8M5 21h14"/></svg>`,
    clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>`,
    car: `<svg viewBox="0 0 24 24"><path d="M5 16h14M7 16v3M17 16v3M6 16l2-6h8l2 6M8 10l1-3h6l1 3"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/></svg>`,
    bed: `<svg viewBox="0 0 24 24"><path d="M4 5v14M4 12h16v7M8 12V8h5a3 3 0 0 1 3 3v1"/></svg>`,
    dollar: `<svg viewBox="0 0 24 24"><path d="M12 3v18M17 7.5c-1-1-2.4-1.5-4.2-1.5-2.2 0-3.8 1-3.8 2.7 0 1.8 1.7 2.4 4.1 3 2.5.6 4.2 1.2 4.2 3.3 0 1.8-1.7 3-4.3 3-1.9 0-3.6-.6-4.9-1.8"/></svg>`,
    sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>`,
    moon: `<svg viewBox="0 0 24 24"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 7 7 0 1 0 20 15.5z"/></svg>`,
    wine: `<svg viewBox="0 0 24 24"><path d="M8 3h8v5a4 4 0 0 1-8 0zM12 12v8M8 21h8"/></svg>`,
    utensils: `<svg viewBox="0 0 24 24"><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M14 3v18M14 3c4 2 5 6 2 9h-2"/></svg>`,
    chef: `<svg viewBox="0 0 24 24"><path d="M7 10a4 4 0 0 1 3-6 4 4 0 0 1 7 1.5A3.5 3.5 0 0 1 17 12H7a3.5 3.5 0 0 1 0-7"/><path d="M6 12h12l-1 8H7zM9 16h6"/></svg>`
  };
  return icons[name] || "";
}

function tripBasicsChrome(trip, travelerCount, issueCount) {
  const hasContext = String(trip.from || "").trim() && String(trip.destination || "").trim();
  return `${hasContext ? tripContextBar(trip, travelerCount, issueCount) : ""}
  <section class="status-grid basics-status">
    ${metric("Travelers", travelerCount, trip.groupType)}
    ${metric("Dates", trip.days || "Not set", trip.startDate && trip.endDate ? formatShortDateRange(trip.startDate, trip.endDate) : tripDateSummary(trip))}
    ${metric("Issues", issueCount, issueCount === 1 ? "Travel note" : issueCount ? "Travel notes" : "No trip notes")}
    ${metric("Preferences", countUniqueActivePreferences(trip), "Preferences selected")}
  </section>`;
}

function wizardChrome(trip, travelerCount, issueCount) {
  return `${tripContextBar(trip, travelerCount, issueCount)}
  <section class="status-grid wizard-status">
    ${metric("Travelers", travelerCount, trip.groupType)}
    ${metric("Dates", formatShortDateRange(trip.startDate, trip.endDate), `${trip.days || 0} day${Number(trip.days) === 1 ? "" : "s"}`)}
    ${metric("Issues", issueCount, issueCount === 1 ? "Review required" : issueCount ? "Review required" : "No trip notes")}
    ${metric("Preferences", countUniqueActivePreferences(trip), "Selected")}
  </section>`;
}

function tripContextBar(trip, travelerCount, issueCount) {
  const showEditBasics = state.activeStep !== 1;
  return `<section class="trip-context">
    <strong title="${esc(heroDestination(trip))}"><span class="trip-context-icon" aria-hidden="true">${iconSvg("mapPin")}</span>${esc(heroDestination(trip))}</strong>
    <span><span class="trip-context-icon" aria-hidden="true">${iconSvg("calendar")}</span>${esc(formatDateRange(trip.startDate, trip.endDate))}</span>
    <span><span class="trip-context-icon" aria-hidden="true">${iconSvg("person")}</span>${travelerCount} traveler${travelerCount === 1 ? "" : "s"}</span>
    <span><span class="trip-context-icon" aria-hidden="true">${iconSvg("scale")}</span>${esc(trip.schedule.pace)} pace</span>
    <button class="${issueCount ? "issue-button" : "sr-only"}" data-action="toggleWarnings">${issueCount} issue${issueCount === 1 ? "" : "s"}</button>
    ${showEditBasics ? `<button data-step="1">Edit Trip Basics</button>` : ""}
  </section>`;
}

function warningTray() {
  const warnings = visibleReviewIssues().map((issue) => issue.issue);
  return `<section class="panel warning-tray">${table(["Issue"], warnings.map((warning) => `<tr><td>${esc(warning)}</td></tr>`), "No issues.")}</section>`;
}

function acceptedPreferencesTray() {
  return `<section class="panel secondary">${table(["Category", "Preference", "Importance", "Source"], state.trip.preferences.map((pref) => `<tr><td>${esc(titleCase(pref.category))}</td><td>${esc(pref.label)}</td><td>${esc(pref.importance)}</td><td>${esc((pref.sources || [pref.source || "Explicit Selection"]).join(", "))}</td></tr>`), "No accepted preferences yet.")}</section>`;
}

function allIssueMessages() {
  return reviewIssues().map((issue) => issue.issue);
}

function visibleReviewIssues() {
  if (state.activeStep !== 1) return reviewIssues();
  const visibleBasics = new Set(visibleTripBasicsIssues().map((issue) => issue.issue));
  return reviewIssues().filter((issue) => issue.owningStep || visibleBasics.has(issue.issue));
}

function visibleTripBasicsIssues() {
  return tripBasicsIssues(state.trip).filter((issue) => {
    if (!issue.blocking) return true;
    const locationField = issue.field === "trip.from" ? "from" : issue.field === "trip.destination" ? "destination" : "";
    return ui.basicsSubmitAttempted || ui.touchedBasicsFields.has(issue.field) || (locationField && ui.touchedBasicsFields.has(locationField));
  });
}

function blockingValidationIssues() {
  return reviewIssues().filter((issue) => issue.blocking).map((issue) => issue.issue);
}

function stepNavButton(step, stepNumber) {
  const complete = stepNumber < state.activeStep || (stepNumber === 1 && !tripBasicsIssues(state.trip).some((issue) => issue.blocking));
  const futureDisabled = stepNumber > 1 && tripBasicsIssues(state.trip).some((issue) => issue.blocking);
  const classes = [state.activeStep === stepNumber ? "active" : "", complete ? "complete" : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" data-step="${stepNumber}" ${state.activeStep === stepNumber ? `aria-current="step"` : ""} ${futureDisabled ? "disabled" : ""}>
    <span>${complete ? "✓" : stepNumber}</span>
    <strong>${esc(step)}</strong>
    <small class="step-subtitle">${esc(stepSubtitles[stepNumber - 1])}</small>
  </button>`;
}

function heroDestination(trip) {
  const destination = normalizePlaceName(trip.destinationDisplay || trip.destination || "Where are you going?");
  return tripBasicsIssues(trip).some((issue) => issue.field === "trip.destinationRegions") ? `${destination} · Region Not Selected` : destination;
}

function heroMeta(trip) {
  return `From ${normalizePlaceName(trip.fromDisplay || trip.from || "origin not set")} · ${tripDateSummary(trip)} · ${trip.transportation}`;
}

function heroDescription(trip) {
  const text = String(trip.originalText || trip.description || "").trim();
  if (!text) return "Add your original trip request below.";
  const interpreted = interpretFreeText(text).map((pref) => pref.label).slice(0, 2).join(" and ");
  return interpreted || text;
}

function stepView() {
  if (state.activeStep === 1) return basicsStep();
  if (state.activeStep === 2) return travelersStep();
  if (state.activeStep === 3) return styleStep();
  if (state.activeStep === 4) return foodStep();
  if (state.activeStep === 5) return comfortStep();
  return reviewStep();
}

function basicsStep() {
  const trip = state.trip;
  const issues = visibleTripBasicsIssues();
  const blocking = issues.some((issue) => issue.blocking);
  const status = stepStatus(trip, issues);
  return `<section class="panel trip-basics-panel">
    <div class="panel-head"><div><p class="eyebrow">Step 1</p><h2>Trip Basics</h2></div>${badge(status)}</div>
    <div class="form-grid basics-grid">
      ${locationField("from", "Traveling From", trip.from, trip.fromLocation, trip.fromVerificationStatus)}
      ${locationField("destination", "Destination", trip.destination, trip.destinationLocation, trip.destinationVerificationStatus)}
      ${fieldShell("Number of Days", input("trip.days", trip.days, "Number of Days", "number"), "Inclusive trip length.")}
      ${fieldShell("Transportation", select("trip.transportation", trip.transportation, optionSets.transportation, "Transportation"), "Used for route feasibility.")}
      ${fieldShell("Start Date", input("trip.startDate", trip.startDate, "Start Date", "date"), "First travel day.")}
      ${fieldShell("End Date", input("trip.endDate", trip.endDate, "End Date", "date"), "Calculated from start date and trip length.")}
    </div>
    ${destinationRegionsField(trip)}
    ${routeSummary(trip)}
    ${Number(trip.days) ? `<p class="derived-summary">☀ ${esc(tripDateSummary(trip))} · ${calculateTripNights(Number(trip.days))} night${calculateTripNights(Number(trip.days)) === 1 ? "" : "s"}</p>` : ""}
    <div class="field-shell full"><label for="trip-description">Trip Description</label>${textarea("trip.description", trip.description, "Trip Description").replace("<textarea", `<textarea id="trip-description"`)}<small class="field-helper">Describe must-do places, pace, and important constraints.</small></div>
    <div class="button-row"><button class="secondary-action" data-action="interpretText">Interpret My Trip</button></div>
    ${ui.interpretationError ? `<div class="callout bad-callout">${esc(ui.interpretationError)}</div>` : ""}
    ${tripAdvisoryPanel(issues)}
    <div class="wizard-footer">${button("Save and Exit", "saveExit")}<button class="primary" data-action="continueBasics" title="${blocking ? "Resolve blocking Trip Basics issues before continuing." : "Continue to Travelers"}">Continue</button></div>
  </section>
  ${quickInterpretTable()}`;
}

function fieldShell(labelText, control, helper = "") {
  const id = `field-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `<div class="field-shell"><label for="${id}">${esc(labelText)}</label>${control.replace(/<(input|select|textarea)/, `<$1 id="${id}"`)}<small class="field-helper">${esc(helper || " ")}</small></div>`;
}

function locationField(field, labelText, value, location, verificationStatus) {
  const active = ui.activeLocationField === field;
  const helper = locationVerificationLabel(location, verificationStatus === "Location Not Verified" ? "Select a suggestion to verify this location." : verificationStatus);
  const statusClass = location?.verificationStatus === "Verified" ? "verified" : "needs-review";
  const panelId = `location-results-${field}`;
  const activeId = ui.locationHighlight[field] >= 0 ? `${panelId}-${ui.locationHighlight[field]}` : "";
  const clearLabel = field === "from" ? "Clear Traveling From" : field === "destination" ? "Clear Destination" : "Clear Location";
  return `<div class="field-shell location-field">
    <label for="location-${field}">${esc(labelText)}</label>
    <div class="location-control">
      <input id="location-${field}" role="combobox" aria-autocomplete="list" aria-expanded="${active}" aria-controls="${panelId}" ${activeId ? `aria-activedescendant="${activeId}"` : ""} aria-describedby="location-helper-${field}" autocomplete="off" data-location-field="${esc(field)}" value="${esc(value || "")}" placeholder="${field === "from" ? "City, airport, state, or country" : "City, region, state, or country"}">
      ${String(value || "").trim() ? `<button class="location-clear" type="button" aria-label="${esc(clearLabel)}" data-action="clearLocation:${esc(field)}">×</button>` : ""}
      <span class="verification-pill ${statusClass}" aria-label="${esc(helper)}">${location?.verificationStatus === "Verified" ? "✓ Verified" : "Select from suggestions"}</span>
    </div>
    <small id="location-helper-${field}" class="field-helper">${esc(helper)}</small>
  </div>`;
}

function destinationRegionsField(trip) {
  const needs = tripBasicsIssues(trip).some((issue) => issue.field === "trip.destinationRegions");
  if (!needs && !String(trip.destinationRegions || "").trim()) return "";
  const title = isBroadLocation(trip.destinationLocation) ? `${trip.destinationLocation.normalizedName} covers a large area. Add a city or region for a more realistic itinerary.` : "Add specific cities or regions so RouteMosaic can build a realistic route.";
  return `<section class="refinement-panel full" aria-label="Destination refinement">
    <strong>Destination Refinement</strong>
    <p>${esc(title)}</p>
    ${fieldShell("Cities or Regions to Include", input("trip.destinationRegions", trip.destinationRegions, "Cities or Regions to Include"), "Use places you know you want included. RouteMosaic will not assume a region for you.")}
  </section>`;
}

function tripAdvisoryPanel(issues) {
  if (!issues.length) return "";
  return `<div class="advisory-stack">${issues.map((issue) => `<section class="advisory-panel ${issue.blocking ? "blocking" : "advisory"}" aria-label="${esc(issue.blocking ? "Blocking issue" : "Advisory")}">
    <span aria-hidden="true">${issue.blocking ? "!" : "i"}</span>
    <div><strong>${esc(issue.blocking ? "Needs Attention" : issue.issue.includes("large destination") ? "Broad Destination Advisory" : "Trip Advisory")}</strong><p>${esc(issue.issue)}</p></div>
    <button class="small" data-action="focusField:${esc(issue.field)}">${esc(issue.action)}</button>
  </section>`).join("")}</div>`;
}

function stepStatus(trip, issues) {
  if (!String(trip.from || trip.destination || trip.description || "").trim()) return "Not Started";
  if (issues.some((issue) => issue.blocking)) return "Needs Attention";
  if (reviewIssues().some((issue) => !issue.blocking)) return "Ready with advisory";
  if (!String(trip.description || "").trim()) return "In Progress";
  return "Trip basics ready";
}

function routeSummary(trip) {
  if (!String(trip.from || "").trim() || !String(trip.destination || "").trim()) return "";
  const from = trip.fromLocation?.normalizedName || normalizePlaceName(trip.from || "Origin");
  const destination = trip.destinationRegions ? `${trip.destinationRegions} and ${trip.destinationLocation?.normalizedName || normalizePlaceName(trip.destination)}` : trip.destinationLocation?.normalizedName || normalizePlaceName(trip.destination || "Destination");
  return `<section class="route-summary full"><strong>${esc(from)} → ${esc(destination)}</strong><span>${esc(trip.transportation)} · ${routeVerificationSummary(trip)} · Route time will be calculated during itinerary planning.</span></section>`;
}

function routeVerificationSummary(trip) {
  const origin = trip.fromLocation?.verificationStatus === "Verified";
  const destination = trip.destinationLocation?.verificationStatus === "Verified";
  if (origin && destination) return "Origin and destination verified";
  if (origin || destination) return "Partially verified";
  return "Locations need verification";
}

function travelersStep() {
  const trip = state.trip;
  const isSolo = trip.groupType === "Solo trip";
  const total = travelerTotal(trip);
  const warnings = travelerWarnings(trip);
  const childAges = childAgeValues(trip);
  return `<section class="panel travelers-panel">
    <div class="panel-head compact-head"><div><p class="eyebrow">Step 2</p><h2>Travelers</h2></div>${badge(`${total} traveler${total === 1 ? "" : "s"}`)}</div>
    ${warnings.length ? `<div class="warning-list"><strong>${warnings.length} traveler issue${warnings.length === 1 ? "" : "s"} require review</strong>${warnings.map((warning) => `<p>${esc(warning)}</p>`).join("")}</div>` : ""}
    <div class="form-grid travelers-composition-grid">
      <label>Group Type ${select("trip.groupType", trip.groupType, groupTypes, "Group Type")}</label>
      <label>Adults (18+) ${input("trip.adults", trip.adults, "Adults", "number")}</label>
      <label>Children (0-17) ${input("trip.children", trip.children, "Children", "number")}</label>
      ${Number(trip.children || 0) > 0 ? childAges.map((age, index) => `<label>Child ${index + 1} age ${input(`childAge.${index}`, age, `Child ${index + 1} age`)}</label>`).join("") : ""}
      <label>Seniors (65+) ${input("trip.seniors", trip.seniors, "Seniors", "number")}</label>
      <label>Shared Preferences ${select("trip.samePreferences", trip.samePreferences ? "Yes" : "No", ["Yes", "No"], "Shared Preferences")}</label>
    </div>
    <div class="special-considerations" aria-label="Traveler planning considerations">
      ${considerationPill("No mobility restrictions", !travelerHasRestriction(trip, /mobility|walking|wheelchair|stroller/i), "accessibility")}
      ${considerationPill("Dietary restrictions", travelerHasRestriction(trip, /food|gluten|lactose|vegetarian|vegan|halal|kosher|jain|beef|pork|seafood/i), "leaf")}
      ${considerationPill("Medical needs", travelerHasRestriction(trip, /medical/i), "heart")}
      ${considerationPill("Accessibility needs", travelerHasRestriction(trip, /accessibility|wheelchair|stroller/i), "person")}
    </div>
    <p class="helper-text">Add details only when a traveler has an individual restriction, accessibility need, or preference that differs from the rest of the group.</p>
    ${travelerTable(trip, isSolo)}
    ${wizardFooter("Back", "Save and Exit", "Continue")}
  </section>`;
}

function travelerTable(trip, isSolo) {
  return `<div class="table-wrap traveler-table-wrap"><table class="traveler-table"><thead><tr><th>Traveler</th><th>Age Group</th><th>Individual Restrictions or Accessibility Needs</th><th>Actions</th></tr></thead><tbody>${trip.travelers.map((traveler, index) => `<tr><td><div class="traveler-identity"><span class="traveler-avatar avatar-${(index % 4) + 1}" aria-hidden="true">${travelerInitial(traveler, index)}</span><div><label class="sr-only" for="traveler-name-${traveler.id}">Traveler ${index + 1} name</label><input id="traveler-name-${traveler.id}" aria-label="Traveler ${index + 1} name" placeholder="Optional name" data-field="traveler.${traveler.id}.name" value="${esc(traveler.name || "")}"><small>${esc(index === 0 ? "Lead traveler" : "Companion")}</small></div></div></td><td>${select(`traveler.${traveler.id}.ageGroup`, traveler.ageGroup, ["Adult", "Child", "Senior"], "Age group")}</td><td>${restrictionCell(traveler, index)}${travelerNotesField(traveler)}</td><td>${removeTravelerButton(trip, traveler, index, isSolo)}</td></tr>`).join("")}</tbody></table></div>`;
}

function travelerInitial(traveler, index) {
  return esc((traveler.name || `T${index + 1}`).trim().slice(0, 1).toUpperCase());
}

function travelerHasRestriction(trip, pattern) {
  return (trip.travelers || []).some((traveler) => (traveler.restrictions || []).some((restriction) => pattern.test(restriction)));
}

function considerationPill(label, active, icon) {
  return `<span class="consideration-pill ${active ? "active" : ""}"><span aria-hidden="true">${iconSvg(icon)}</span>${esc(label)}</span>`;
}

function travelerNotesField(traveler) {
  return `<input class="traveler-notes-input" aria-label="Individual notes" placeholder="Individual notes" data-field="traveler.${traveler.id}.notes" value="${esc(traveler.notes || "")}">`;
}

function removeTravelerButton(trip, traveler, index, isSolo) {
  const onlyTraveler = travelerTotal(trip) <= 1 || isSolo;
  return `<button class="small danger" aria-label="Remove Traveler ${index + 1}" title="${onlyTraveler ? "A trip must have at least one traveler." : `Remove Traveler ${index + 1}`}" data-action="removeTraveler:${traveler.id}" ${onlyTraveler ? "disabled" : ""}>Remove</button>`;
}

function restrictionCell(traveler) {
  const selected = traveler.restrictions || [];
  const summary = restrictionSummary(selected);
  const isOpen = ui.openRestrictionTravelerId === traveler.id;
  const title = selected.join(", ") || "No restrictions selected";
  return `<div class="restriction-cell">
    <button class="restriction-trigger" aria-haspopup="dialog" aria-expanded="${isOpen}" aria-controls="restriction-panel-${traveler.id}" aria-label="Restrictions or needs for ${esc(traveler.name || "traveler")}" title="${esc(title)}" data-restriction-trigger="${esc(traveler.id)}" data-action="toggleRestrictions:${traveler.id}">
      <span>${esc(summary)}</span><small aria-live="polite">${selected.length} selected</small><b aria-hidden="true">⌄</b>
    </button>
  </div>`;
}

function restrictionSummary(selected) {
  if (!selected.length) return "Select restrictions";
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.slice(0, 2).join(", ")} +${selected.length - 2}`;
}

function restrictionOverlay() {
  if (!ui.openRestrictionTravelerId || state.activeStep !== 2) return "";
  const traveler = state.trip.travelers.find((item) => item.id === ui.openRestrictionTravelerId);
  if (!traveler) return "";
  return `<div class="restriction-layer" data-action="closeRestrictions:${traveler.id}">
    ${restrictionPopover(traveler)}
  </div>`;
}

function locationAutocompleteOverlay() {
  const field = ui.activeLocationField;
  if (!field || state.activeStep !== 1) return "";
  const inputValue = field === "from" ? state.trip.from : field === "destination" ? state.trip.destination : state.trip.destinationRegions;
  const suggestions = ui.locationSuggestions[field] || [];
  const loading = ui.locationLoading[field];
  const error = ui.locationError[field];
  const panelId = `location-results-${field}`;
  return `<div class="location-layer" data-action="closeLocationSuggestions">
    <div class="location-results-panel" id="${panelId}" role="listbox" aria-label="Location suggestions" data-location-panel="${esc(field)}">
      ${locationProvider ? "" : `<p class="location-message">Location search is not connected. You can still continue with typed text.</p>`}
      ${loading ? `<p class="location-message" role="status">Loading location suggestions...</p>` : ""}
      ${error ? `<p class="location-message provider-error">${esc(error)} <button class="small" data-action="retryLocationSearch:${esc(field)}">Try Again</button></p>` : ""}
      ${!loading && !error && locationProvider && String(inputValue || "").trim().length < LOCATION_MIN_QUERY_LENGTH ? `<p class="location-message">Type at least ${LOCATION_MIN_QUERY_LENGTH} characters to search verified places.</p>` : ""}
      ${!loading && !error && locationProvider && String(inputValue || "").trim().length >= LOCATION_MIN_QUERY_LENGTH && !suggestions.length ? `<p class="location-message" role="status">No verified suggestions yet. You can continue with typed text.</p>` : ""}
      ${suggestions.map((suggestion, index) => locationSuggestionRow(field, suggestion, index)).join("")}
    </div>
  </div>`;
}

function locationSuggestionRow(field, suggestion, index) {
  const selected = ui.locationHighlight[field] === index;
  const icon = locationIcon(suggestion.locationType);
  const meta = [suggestion.locationType, suggestion.city, suggestion.stateOrProvince, suggestion.country, suggestion.airportCode].filter(Boolean).join(" · ");
  const query = suggestion.originalInput || locationValue(field);
  return `<button id="location-results-${field}-${index}" class="location-result ${selected ? "active" : ""}" role="option" aria-selected="${selected}" data-action="selectLocation:${esc(field)}:${index}">
    <span aria-hidden="true">${icon}</span>
    <strong>${highlightMatch(suggestion.normalizedName || suggestion.displayName, query)}</strong>
    <small>${highlightMatch(meta || suggestion.displayName, query)}</small>
  </button>`;
}

function highlightMatch(value, query) {
  const text = String(value || "");
  const needle = String(query || "").trim();
  if (!needle) return esc(text);
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return esc(text);
  return `${esc(text.slice(0, index))}<mark>${esc(text.slice(index, index + needle.length))}</mark>${esc(text.slice(index + needle.length))}`;
}

function locationIcon(type) {
  if (type === "Airport") return "✈";
  if (type === "City") return "⌂";
  if (type === "State" || type === "Province") return "◇";
  if (type === "Country") return "◎";
  if (type === "Region") return "⌁";
  return "•";
}

function experienceOverlay() {
  if (!ui.openExperienceCategory) return "";
  const category = ui.openExperienceCategory;
  const search = ui.experienceSearch.toLowerCase();
  const options = (experienceCategories[category] || []).filter((option) => option.toLowerCase().includes(search));
  const selected = selectedExperiences().filter((pref) => experienceCategoryFor(pref.label) === category);
  return `<div class="restriction-layer" data-action="closeExperience">
    <div class="choice-panel experience-dialog" role="dialog" aria-modal="true" aria-label="${esc(category)}">
      <div class="dialog-head">
        <div><p class="eyebrow">Experience Category</p><h2>${esc(category)}</h2><span>${selected.length} selected</span></div>
        <button class="icon-button" aria-label="Close ${esc(category)}" data-action="closeExperience">×</button>
      </div>
      <input class="restriction-search" aria-label="Search ${esc(category)}" placeholder="Search experiences" data-field="ui.experienceSearch" value="${esc(ui.experienceSearch)}">
      <div class="choice-list">${options.length ? options.map((option) => {
        const existing = selectedExperiences().find((pref) => normalizeLabel(pref.label) === normalizeLabel(option));
        return `<label class="experience-option ${existing ? "selected" : ""}">
          ${checkbox(`pref.experiences.${option}`, Boolean(existing), option)}
          <span class="restriction-check" aria-hidden="true">${existing ? "✓" : ""}</span>
          <span><strong>${esc(option)}</strong><small>${esc(experienceDescription(option))}</small></span>
          ${existing ? select(`prefImportance.${existing.id}`, existing.importance, activeImportanceOptions(), `${option} importance`) : ""}
        </label>`;
      }).join("") : `<p class="empty compact-empty">No experiences match this search.</p>`}</div>
      <div class="restriction-actions"><button data-action="clearExperience:${esc(category)}">Clear All</button><button data-action="closeExperience">Cancel</button><button class="primary" data-action="closeExperience">Save Selections</button></div>
    </div>
  </div>`;
}

function restrictionPopover(traveler) {
  const q = ui.restrictionSearch.toLowerCase();
  const groups = [
    ["Food and Dietary", ["Food allergy", "Gluten intolerance", "Lactose intolerance", "Mandatory vegetarian", "Mandatory vegan", "Halal requirement", "Kosher requirement", "Jain food requirement", "Avoid beef", "Avoid pork", "Avoid seafood"]],
    ["Mobility and Accessibility", ["Mobility limitation", "Wheelchair accessibility", "Stroller requirement", "Minimal walking"]],
    ["Other", ["Medical travel consideration", "Other"]]
  ];
  return `<div class="restriction-popover" id="restriction-panel-${traveler.id}" role="dialog" aria-modal="false" aria-label="Restrictions or Needs" data-restriction-panel>
    <div class="restriction-title">Restrictions or Needs</div>
    <input class="restriction-search" aria-label="Search restrictions" placeholder="Search restrictions" data-field="ui.restrictionSearch" value="${esc(ui.restrictionSearch)}">
    <div class="restriction-options">
      ${groups.map(([title, options]) => {
        const filtered = options.filter((option) => option.toLowerCase().includes(q));
        if (!filtered.length) return "";
        return `<div class="restriction-group"><h4>${esc(title)}</h4>${filtered.map((option) => `<label class="restriction-option">${checkbox(`travelerRestriction.${traveler.id}.${option}`, traveler.restrictions?.includes(option), option)}<span class="restriction-check" aria-hidden="true">${traveler.restrictions?.includes(option) ? "✓" : ""}</span><span>${esc(option)}</span></label>`).join("")}</div>`;
      }).join("")}
      ${traveler.restrictions?.includes("Other") ? `<label class="other-restriction">Describe the restriction or need <input aria-label="Describe the restriction or need" placeholder="Describe the restriction or need" data-field="traveler.${traveler.id}.otherRestrictionText" value="${esc(traveler.otherRestrictionText || "")}"></label>` : ""}
    </div>
    <div class="restriction-actions"><button data-action="clearRestrictions:${traveler.id}">Clear all</button><button class="primary" data-action="closeRestrictions:${traveler.id}">Done</button></div>
  </div>`;
}

function positionRestrictionOverlay() {
  const panel = document.querySelector("[data-restriction-panel]");
  const trigger = ui.openRestrictionTravelerId ? document.querySelector(`[data-restriction-trigger="${CSS.escape(ui.openRestrictionTravelerId)}"]`) : null;
  if (!panel || !trigger) return;
  if (window.matchMedia("(max-width: 760px)").matches) {
    panel.removeAttribute("style");
    return;
  }
  const gap = 8;
  const padding = 12;
  const rect = trigger.getBoundingClientRect();
  const panelWidth = Math.min(Math.max(rect.width, 440), 520, window.innerWidth - padding * 2);
  const maxHeight = Math.min(360, window.innerHeight - padding * 2);
  const below = window.innerHeight - rect.bottom - gap - padding;
  const above = rect.top - gap - padding;
  const placeAbove = below < Math.min(300, maxHeight) && above > below;
  const left = Math.min(Math.max(rect.left, padding), window.innerWidth - panelWidth - padding);
  const top = placeAbove ? Math.max(padding, rect.top - gap - maxHeight) : Math.min(rect.bottom + gap, window.innerHeight - maxHeight - padding);
  panel.style.width = `${panelWidth}px`;
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function styleStep() {
  const selected = selectedExperiences();
  const selectedCount = countSelectedExperiences(state.trip);
  return `<div class="step-sections trip-style-screen">
    <section class="compact-section premium-section core-style-section">
      <div class="section-head"><div><h2>Core Style</h2><p>Set the overall feel without adding duplicate experience preferences.</p></div></div>
      <div class="style-scale-grid">
        ${styleSelectControl("trip.style.balance", state.trip.style.balance, ["Nature", "Mostly Nature", "Balanced", "Mostly Urban", "Urban"], "Core Style", "More time in nature, less in cities.", "leaf")}
        ${styleSelectControl("trip.style.atmosphere", state.trip.style.atmosphere, ["Very Quiet", "Relaxed", "Balanced", "Social", "Lively"], "Atmosphere", "Unwind, go at your own pace.", "cloud")}
        ${styleSelectControl("trip.style.locationFeel", state.trip.style.locationFeel, ["Secluded", "Quiet Area", "Balanced", "Central", "Busy District"], "Location Feel", "Off the beaten path, with stunning views.", "mountain")}
      </div>
    </section>
    <section class="compact-section premium-section">
      <div class="section-head"><div><h2>Experience Categories</h2><p>Choose only the environments, activities, and moments that should shape the itinerary.</p></div></div>
      ${experienceCategoryTable()}
    </section>
    <section class="compact-section premium-section selected-priorities">
      <div class="section-head"><div><h2>Selected Priorities</h2><p>${selectedCount} experience${selectedCount === 1 ? "" : "s"}</p></div></div>
      ${selectedExperienceTable(selected)}
    </section>
    <section class="compact-section premium-section custom-experience">
      <div class="section-head"><div><h2>Add a Specific Experience</h2><p>Northern lights viewing, a secluded lake cabin, Chicago architecture, one romantic dinner, or a scenic train ride.</p></div></div>
      <div class="custom-experience-row">
        ${input("trip.style.customExperience", state.trip.style.customExperience, "Describe something you want to include")}
        ${select("trip.style.customImportance", state.trip.style.customImportance || "Nice to have", activeImportanceOptions(), "Custom experience importance")}
        <button class="primary" data-action="addCustomExperience">Add</button>
      </div>
      ${ui.interpretationError ? `<p class="bad-text">${esc(ui.interpretationError)}</p>` : ""}
    </section>
    ${wizardFooter("Back", "Save and Exit", "Continue")}
  </div>`;
}

function segmentedControl(path, value, options, label, helper) {
  return `<div class="scale-control">
    <div><strong>${esc(label)}</strong><small>${esc(helper)}</small></div>
    <div class="segmented" role="radiogroup" aria-label="${esc(label)}">
      ${options.map((option) => `<button type="button" class="segment ${option === value ? "selected" : ""}" role="radio" aria-checked="${option === value}" data-segment="${esc(path)}" data-action="setField:${esc(path)}:${esc(option)}">${esc(option)}</button>`).join("")}
    </div>
  </div>`;
}

function styleSelectControl(path, value, options, label, helper, icon) {
  return `<div class="scale-control style-select-card">
    <strong>${esc(label)}</strong>
    <div class="style-select-control">
      <span class="style-select-icon icon-${esc(icon)}" aria-hidden="true">${iconSvg(icon)}</span>
      <select aria-label="${esc(label)}" data-field="${esc(path)}">
        ${options.map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(styleDisplayLabel(path, option))}</option>`).join("")}
      </select>
    </div>
    <small>${esc(helper)}</small>
  </div>`;
}

function styleDisplayLabel(path, option) {
  const labels = {
    "trip.style.balance": {
      Nature: "Nature-Focused",
      "Mostly Nature": "Nature Leaning",
      Balanced: "Balanced",
      "Mostly Urban": "City Leaning",
      Urban: "City-Focused"
    },
    "trip.style.atmosphere": {
      "Very Quiet": "Very Quiet",
      Relaxed: "Relaxed",
      Balanced: "Balanced",
      Social: "Social",
      Lively: "Lively"
    },
    "trip.style.locationFeel": {
      Secluded: "Remote & Scenic",
      "Quiet Area": "Quiet & Scenic",
      Balanced: "Balanced",
      Central: "Central",
      "Busy District": "Busy District"
    }
  };
  return labels[path]?.[option] || option;
}

function preferencePicker(category, title, options) {
  return `<div class="picker"><h3>${title}</h3><div class="chip-grid">${options.map((option) => {
    const existing = state.trip.preferences.find((pref) => pref.category === category && pref.label === option);
    return `<label class="chip ${existing ? "selected" : ""}">${checkbox(`pref.${category}.${option}`, Boolean(existing), option)}<span>${esc(option)}</span>${select(`importance.${category}.${option}`, existing?.importance || "Nice to have", Object.keys(importanceWeights), `${option} importance`)}</label>`;
  }).join("")}</div></div>`;
}

function selectedExperiences() {
  return getUniqueSelectedExperiences(state.trip);
}

function activeImportanceOptions() {
  return Object.keys(importanceWeights).filter((option) => option !== "Neutral");
}

function experienceCategoryTable() {
  const rows = Object.keys(experienceCategories).map((category) => experienceCategoryRow(category));
  return `<div class="category-grid" aria-label="Experience Categories">${rows.join("")}</div>`;
}

function experienceCategoryRow(category) {
  const options = experienceCategories[category];
  const selected = selectedExperiences().filter((pref) => options.some((option) => normalizeLabel(option) === normalizeLabel(pref.label)));
  const summary = selected.map((pref) => pref.label).slice(0, 3).join(", ") + (selected.length > 3 ? ` +${selected.length - 3}` : "");
  const fullSummary = selected.map((pref) => pref.label).join(", ") || "None selected";
  const visual = experienceCategoryVisual(category);
  return `<article class="category-row category-${esc(visual.tone)}" aria-label="${esc(`${category}: ${selected.length} selected. ${fullSummary}`)}">
    <span class="category-icon" aria-hidden="true">${experienceCategoryIcon(category)}</span>
    <div class="category-copy">
      <strong>${esc(category)}</strong>
      <span class="category-summary" title="${esc(selected.length ? fullSummary : experienceCategoryDescription(category))}">${esc(experienceCategoryDescription(category))}</span>
    </div>
    <span class="category-count ${selected.length ? "has-selection" : "empty-selection"}" aria-label="${selected.length} selected">${selected.length} selected</span>
    <button class="small category-action" aria-label="${esc(`${selected.length ? "Edit" : "Add"} ${category} experiences`)}" data-action="openExperience:${esc(category)}">${selected.length ? "Edit" : "Add"}</button>
  </article>`;
}

function experienceCategoryIcon(category) {
  return iconSvg(experienceCategoryVisual(category).icon);
}

function experienceCategoryVisual(category) {
  return {
    "Nature and Scenery": { icon: "trees", tone: "nature" },
    "Outdoor Activities": { icon: "hiking", tone: "outdoor" },
    "Water Experiences": { icon: "water", tone: "water" },
    "City and Culture": { icon: "city", tone: "city" },
    Relaxation: { icon: "lotus", tone: "relaxation" },
    Entertainment: { icon: "mask", tone: "entertainment" },
    "Special Experiences": { icon: "star", tone: "special" },
    "Seasonal Experiences": { icon: "snow", tone: "seasonal" }
  }[category] || { icon: "star", tone: "default" };
}

function experienceCategoryDescription(category) {
  return {
    "Nature and Scenery": "Mountains, forests, lakes, vistas",
    "Outdoor Activities": "Hiking, kayaking, biking, more",
    "Water Experiences": "Lakes, waterfalls, rivers",
    "City and Culture": "Local culture, history, small towns",
    Relaxation: "Rest, unwind, slow moments",
    Entertainment: "Live music, shows, events",
    "Special Experiences": "Unique tours, once-in-a-lifetime",
    "Seasonal Experiences": "Fall colors, winter fun, more"
  }[category] || "Experiences for this trip";
}

function selectedExperienceTable(selected) {
  const cards = selected.slice(0, 8).map((pref) => priorityCard(pref)).join("");
  return `<div class="priority-card-grid">
    ${cards || `<p class="empty compact-empty priority-empty">No specific experiences selected yet.<br>Choose categories above or describe something specific below.</p>`}
    <button class="priority-add-card" data-action="focusCustomExperience"><span aria-hidden="true">${iconSvg("plus")}</span><strong>Add a Specific Experience</strong></button>
  </div>${selected.length > 8 ? `<button class="link-button view-all" data-action="togglePreferences">View All ${selected.length} Selected Experiences</button>` : ""}`;
}

function priorityCard(pref) {
  return `<article class="priority-card">
    <span class="priority-thumb priority-thumb-${esc(priorityThumbKey(pref.label))}" aria-hidden="true">${priorityThumbIcon(pref.label)}</span>
    <div>
      <strong>${esc(pref.label)}</strong>
      <label class="priority-select-label"><span class="priority-check" aria-hidden="true">${iconSvg(priorityTone(pref.importance) === "high" ? "check" : "warning")}</span>${prioritySelect(pref)}</label>
    </div>
    <button class="icon-button danger priority-remove" aria-label="Remove ${esc(pref.label)}" title="Remove ${esc(pref.label)}" data-action="removePref:${pref.id}">×</button>
  </article>`;
}

function prioritySelect(pref) {
  return `<select aria-label="${esc(`${pref.label} importance`)}" data-field="prefImportance.${esc(pref.id)}" class="priority-select priority-${esc(priorityTone(pref.importance))}">
    ${activeImportanceOptions().map((option) => `<option value="${esc(option)}" ${option === pref.importance ? "selected" : ""}>${esc(priorityDisplayLabel(option))}</option>`).join("")}
  </select>`;
}

function priorityDisplayLabel(importance) {
  if (importance === "Must have" || importance === "Strong preference") return "High Priority";
  if (importance === "Nice to have") return "Medium Priority";
  if (importance === "Avoid" || importance === "Must avoid") return "Avoid";
  return importance;
}

function priorityTone(importance) {
  if (importance === "Must have" || importance === "Strong preference") return "high";
  if (importance === "Avoid" || importance === "Must avoid") return "avoid";
  return "medium";
}

function priorityThumbKey(label) {
  if (/lake|nature|mountain|forest/i.test(label)) return "nature";
  if (/waterfall/i.test(label)) return "waterfall";
  if (/drive|road/i.test(label)) return "drive";
  if (/photo|camera/i.test(label)) return "photo";
  if (/water|river|beach/i.test(label)) return "water";
  return "default";
}

function priorityThumbIcon(label) {
  if (/photo|camera/i.test(label)) return iconSvg("camera");
  if (/waterfall|water|lake|river|beach/i.test(label)) return iconSvg("water");
  if (/drive|road/i.test(label)) return iconSvg("mapPin");
  return iconSvg("mountain");
}

function experienceCategoryFor(label) {
  return Object.entries(experienceCategories).find(([, options]) => options.some((option) => normalizeLabel(option) === normalizeLabel(label)))?.[0] || "Custom";
}

function normalizeLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function experienceDescription(option) {
  if (/hiking|walks|cycling|adventure|winter/i.test(option)) return "Activity preference used when building daily movement.";
  if (/museum|history|architecture|art|culture/i.test(option)) return "Culture preference for itinerary themes and neighborhoods.";
  if (/nightlife|music|theater|sports|festival/i.test(option)) return "Evening or event interest.";
  if (/lake|waterfall|forest|beach|park|sunrise|sunset|stargazing|wildlife/i.test(option)) return "Scenery preference for routing and time of day.";
  return "Trip priority saved only when selected.";
}

function foodStep() {
  const trip = state.trip;
  const foodWarnings = foodAndRestrictionWarnings(trip);
  const travelerFoodCount = trip.travelers.filter((traveler) => (traveler.restrictions || []).some((restriction) => /food|gluten|lactose|vegetarian|vegan|halal|kosher|jain|beef|pork|seafood/i.test(restriction))).length;
  const eveningActivities = selectedEveningActivities(trip);
  const nightlife = selectedNightlifeAndDrinks(trip);
  const mealRows = [
    ["Breakfast", trip.food.breakfast || "Hearty & filling", trip.food.breakfastTime || "7:30 - 8:30 AM", "Prefer protein-rich options", "Preferred Breakfast Time"],
    ["Lunch", trip.food.lunch || "Balanced & light", trip.food.lunchTime || "12:30 - 1:30 PM", "Light so we can explore more", "Preferred Lunch Time"],
    ["Dinner", trip.food.dinner || "Relaxed & indulgent", trip.food.dinnerTime || "6:30 - 7:30 PM", "Enjoy local specialties", "Preferred Dinner Time"]
  ];
  return `<section class="panel food-panel">
    <div class="panel-head"><div><p class="eyebrow">Step 4</p><h2>Food and Evenings</h2><p>Help us plan meals and experiences you'll love.</p></div><span class="badge food-context" title="These preferences apply to the whole group. Individual traveler restrictions are managed in Travelers.">Group Preferences</span></div>
    <div class="food-layout food-summary-layout">
      <div class="food-column">
        <section class="food-summary-card diet-card">
          <div class="food-card-title"><span aria-hidden="true">${iconSvg("leaf")}</span><h3>Diet and Restrictions</h3></div>
          ${foodSummaryLine("Group Diet", trip.food.diet, "No group diet selected", "diet")}
          ${foodSummaryLine("Food Avoidances", trip.food.restrictions, "No group-wide avoidances", "avoid")}
          ${travelerFoodCount ? `<div class="traveler-food-notice"><span aria-hidden="true">${iconSvg("travelers")}</span><p>${travelerFoodCount} traveler-specific restriction${travelerFoodCount === 1 ? "" : "s"} will also be applied.</p><button class="link-button" data-step="2">Review Traveler Restrictions</button></div>` : ""}
        </section>
        <section class="food-summary-card cuisine-card">
          <div class="food-card-title"><span aria-hidden="true">${iconSvg("chef")}</span><h3>Cuisine Interests</h3></div>
          ${foodCuisinePreview(trip.food.cuisine)}
        </section>
      </div>
      <div class="food-column">
        <section class="food-summary-card meals-card">
          <div class="food-card-title"><span aria-hidden="true">${iconSvg("utensils")}</span><h3>Meals</h3></div>
          ${table(["Meal", "Style", "Preferred Time", "Notes"], mealRows.map(([meal, preference, time, note, timeLabel]) => `<tr><td><span class="meal-label"><span aria-hidden="true">${mealIcon(meal)}</span>${esc(meal)}</span></td><td>${select(`trip.food.${meal.toLowerCase()}`, preference, mealPreferenceOptions(meal), `${meal} Style`)}</td><td>${input(`trip.food.${meal.toLowerCase()}Time`, time, timeLabel)}</td><td>${input(`trip.food.${meal.toLowerCase()}Note`, note, `${meal} Notes`)}</td></tr>`))}
        </section>
        <section class="food-summary-card evening-card">
          <div class="food-card-title"><span aria-hidden="true">${iconSvg("moon")}</span><h3>Evening Preferences</h3></div>
          ${foodSummaryLine("Evening Activities", eveningActivities, "No evening activity preferences selected", "eveningActivities")}
          ${foodSummaryLine("Drinks and Nightlife", nightlife, "No drinks or nightlife preferences selected", "nightlife")}
        </section>
      </div>
    </div>
    <section class="food-summary-card details-card">
      <div class="food-card-title"><span aria-hidden="true">${iconSvg("dollar")}</span><h3>Food Planning Details</h3><button class="small" data-action="openFoodSection:details">Edit</button></div>
      <div class="food-detail-row">
        ${foodDetailItem("dollar", "Food Budget per Person", trip.food.foodBudgetPerPerson || "$15 - $30 per day")}
        ${foodDetailItem("car", "Drive for Food", trip.food.driveForFood || "Short drives OK")}
        ${foodDetailItem("calendar", "Reservations", trip.food.reservations || "Willing for must-do")}
        ${foodDetailItem("utensils", "Breakfast Source", trip.food.breakfast || "Hotel breakfast preferred")}
        ${foodDetailItem("bed", "Packed Lunch", trip.food.lunch === "Packed lunch acceptable" ? "Acceptable" : "Occasionally")}
      </div>
    </section>
    ${foodWarnings.length ? `<div class="warning-list"><strong>${foodWarnings.length} food planning warning${foodWarnings.length === 1 ? "" : "s"}</strong>${foodWarnings.map((warning) => `<p>${esc(warning)}</p>`).join("")}</div>` : ""}
    ${wizardFooter("Back", "Save and Exit", "Continue")}
  </section>`;
}

function foodSummaryRow(key, title, values) {
  const summary = values.length ? values.slice(0, 4).join(" · ") + (values.length > 4 ? ` +${values.length - 4}` : "") : "No selections yet";
  return `<article class="summary-row"><div><strong>${esc(title)}</strong><span>${esc(summary)}</span></div><button data-action="openFoodSection:${esc(key)}">Edit</button></article>`;
}

function foodSummaryLine(label, values, emptyText, key) {
  const hasValues = values.length > 0;
  return `<div class="food-summary-line">
    <div><strong>${esc(label)}</strong>${foodSelectedSummary(values, emptyText, "", key, false)}</div>
    <span class="selected-count">${hasValues ? `${values.length} selected` : "None selected"}</span>
    <button class="small" aria-label="${esc(`${hasValues ? "Edit" : "Add"} ${label}`)}" data-action="openFoodSection:${esc(key)}">${hasValues ? "Edit" : "Add"}</button>
  </div>`;
}

function foodSelectedSummary(values, emptyText, helperText = "", key = "", includeAction = true) {
  const list = values.filter(Boolean);
  const hasValues = list.length > 0;
  const summary = hasValues ? foodValuePills(list) : `<p>${esc(emptyText)}</p>`;
  return `<div class="food-selected-summary">
    <div class="food-selected-values" title="${esc(list.join(", "))}" aria-label="${esc(hasValues ? `${list.length} selected: ${list.join(", ")}` : emptyText)}">${summary}</div>
    ${!hasValues && helperText ? `<small>${esc(helperText)}</small>` : ""}
    ${includeAction ? `<button class="small" data-action="openFoodSection:${esc(key)}">${hasValues ? "Edit" : "Add"}</button>` : ""}
  </div>`;
}

function foodValuePills(values, max = 3) {
  const shown = values.slice(0, max).map((value) => `<span class="food-value-pill">${esc(value)}</span>`).join("");
  return `${shown}${values.length > max ? `<span class="food-value-count">+${values.length - max}</span>` : ""}`;
}

function foodCuisinePreview(values) {
  const hasValues = values.length > 0;
  if (!hasValues) {
    return `<div class="cuisine-preview empty"><p>No cuisine preferences selected</p><small>We can recommend varied local options.</small><button class="small" data-action="openFoodSection:cuisine">Add</button></div>`;
  }
  const shown = values.slice(0, 4);
  return `<div class="cuisine-preview">
    <div class="cuisine-preview-grid">${shown.map((option) => `<div class="cuisine-preview-card"><span aria-hidden="true">${cuisineIcon(option)}</span><strong>${esc(option)}</strong></div>`).join("")}<button class="cuisine-add-card" data-action="openFoodSection:cuisine"><span aria-hidden="true">${iconSvg("plus")}</span>Add more</button></div>
    <div class="cuisine-preview-footer"><span>${values.length} selected</span><button class="small" data-action="openFoodSection:cuisine">${hasValues ? "Edit" : "Add"}</button></div>
  </div>`;
}

function foodDetailItem(icon, label, value) {
  return `<div class="food-detail-item"><i aria-hidden="true">${iconSvg(icon)}</i><div><span>${esc(label)}</span><strong>${esc(value)}</strong></div></div>`;
}

function compactList(values, max = 3) {
  const shown = values.slice(0, max);
  return `${shown.join(" · ")}${values.length > max ? ` +${values.length - max}` : ""}`;
}

function cuisineIcon(option) {
  if (/indian|asian/i.test(option)) return "🍜";
  if (/italian/i.test(option)) return "🍕";
  if (/mexican/i.test(option)) return "🌮";
  if (/american/i.test(option)) return "🍔";
  if (/mediterranean/i.test(option)) return "🫒";
  if (/local/i.test(option)) return "📍";
  return "☕";
}

function mealPreferenceOptions(meal) {
  if (meal === "Breakfast") return ["Hearty & filling", "Hotel breakfast preferred", "Quick breakfast preferred", "Flexible"];
  if (meal === "Lunch") return ["Balanced & light", "Restaurant lunch preferred", "Packed lunch acceptable", "Flexible"];
  return ["Relaxed & indulgent", "Restaurant dinner preferred", "Fine-dining interest", "Flexible"];
}

function foodSettingItem(icon, label, control) {
  return `<label class="food-setting-item"><span aria-hidden="true">${iconSvg(icon)}</span><strong>${esc(label)}</strong>${control}</label>`;
}

function selectedEveningActivities(trip) {
  const activities = ["Quiet evening venues", "Evening walks", "Sunset activities", "Live music", "Dessert or cafe evenings"];
  return (trip.alcohol.preferences || []).filter((item) => activities.includes(item));
}

function selectedNightlifeAndDrinks(trip) {
  const details = ["No alcohol", "Alcohol acceptable", "Occasional drinks", "Cocktails", "Bars", "Breweries", "Wineries", "Distilleries", "Nightlife", "Party-focused nightlife"];
  const selected = (trip.alcohol.preferences || []).filter((item) => details.includes(item));
  if (trip.alcohol.primary && trip.alcohol.primary !== "Not Specified") selected.unshift(trip.alcohol.primary);
  return [...new Set(selected)];
}

function mealIcon(meal) {
  if (meal === "Breakfast") return iconSvg("sun");
  if (meal === "Lunch") return iconSvg("sun");
  return iconSvg("moon");
}

function foodToggleChip(path, option, selectedValues, tone) {
  const selected = selectedValues.includes(option);
  return `<label class="food-chip food-${esc(tone)} ${selected ? "selected" : ""}">
    ${checkbox(`${path}.${option}`, selected, option)}
    <span aria-hidden="true">${foodChipIcon(option, tone)}</span>
    <strong>${esc(option)}</strong>
  </label>`;
}

function foodChipIcon(option, tone) {
  if (/vegetarian|vegan|chicken|seafood|halal/i.test(option)) return iconSvg("leaf");
  if (/avoid|limited/i.test(option)) return iconSvg("warning");
  if (/music|bars|breweries|nightlife/i.test(option)) return iconSvg("star");
  if (/walk|sunset|quiet/i.test(option)) return iconSvg("trees");
  return tone === "cuisine" ? iconSvg("mapPin") : iconSvg("heart");
}

function foodSectionOverlay() {
  if (!ui.openFoodSection) return "";
  const draft = ui.foodDraft || createFoodDraft(ui.openFoodSection);
  const sections = {
    diet: ["Group Diet", [["Group Diet", "food.diet", ["Vegetarian", "Vegan", "Pescatarian", "Non-vegetarian", "Chicken preferred", "Seafood acceptable", "Halal", "Kosher", "Jain", "Gluten-free", "Dairy-free", "Low-carb", "Diabetic-conscious", "Other"]]]],
    avoid: ["Food Avoidances", [["Food Avoidances", "food.restrictions", ["Avoid beef", "Avoid pork", "Avoid seafood", "Limited seafood", "Avoid eggs", "Avoid dairy", "Avoid spicy food", "Other"]]]],
    cuisine: ["Cuisine Interests", [["Cuisine Interests", "food.cuisine", ["No preference", ...optionSets.cuisine]]]],
    eveningActivities: ["Evening Activities", [["Evening Activities", "alcohol.preferences", ["Quiet evening venues", "Evening walks", "Sunset activities", "Live music", "Dessert or cafe evenings"]]]],
    nightlife: ["Drinks and Nightlife", [["Drinks and Nightlife", "alcohol.preferences", ["No alcohol", "Alcohol acceptable", "Occasional drinks", "Cocktails", "Bars", "Breweries", "Wineries", "Distilleries", "Nightlife", "Party-focused nightlife"]]]],
    details: ["Food Planning Details", []]
  };
  const [title, groups] = sections[ui.openFoodSection];
  const selectedCount = foodDraftSelectionCount(draft);
  return `<div class="restriction-layer" data-action="cancelFoodSection">
    <div class="choice-panel" role="dialog" aria-label="${esc(title)}">
      <div class="dialog-head"><div><h2>${esc(title)}</h2><span>${selectedCount} selected</span></div><button class="icon-button" aria-label="Close ${esc(title)}" data-action="cancelFoodSection">×</button></div>
      ${ui.openFoodSection !== "details" ? `<label class="restriction-search">Search ${input("ui.foodSearch", ui.foodSearch || "", `Search ${title}`)}</label>` : ""}
      ${ui.openFoodSection === "nightlife" ? `<label>Alcohol Preference ${select("foodDraft.alcoholPrimary", draft.alcoholPrimary, ["Not Specified", "No Alcohol", "Alcohol acceptable", "Interested in drinks"], "Alcohol Preference")}</label><label>Alcohol-Focused Recommendations ${select("foodDraft.alcoholVisibility", draft.alcoholVisibility, ["Show Normally", "De-emphasize", "Hide Completely"], "Alcohol-Focused Recommendations")}</label>` : ""}
      ${ui.openFoodSection === "details" ? foodDetailsEditor(draft) : ""}
      <div class="choice-list">${groups.map(([groupTitle, path, options]) => `<div class="restriction-group"><h4>${esc(groupTitle)}</h4>${options.filter((option) => !ui.foodSearch || option.toLowerCase().includes(ui.foodSearch.toLowerCase())).map((option) => {
        const values = foodDraftValues(draft, path);
        return `<label class="restriction-option">${checkbox(`${path}.${option}`, values.includes(option), option)}<span class="restriction-check" aria-hidden="true">${values.includes(option) ? "✓" : ""}</span><span>${esc(option)}</span></label>`;
      }).join("")}</div>`).join("")}</div>
      <div class="restriction-actions"><button data-action="clearFoodDraft">Clear All</button><button data-action="cancelFoodSection">Cancel</button><button class="primary" data-action="saveFoodSection">Save Selections</button></div>
    </div>
  </div>`;
}

function createFoodDraft(section) {
  return {
    section,
    food: structuredClone(state.trip.food),
    alcohol: structuredClone(state.trip.alcohol),
    alcoholPrimary: state.trip.alcohol.primary,
    alcoholVisibility: state.trip.alcohol.recommendationVisibility
  };
}

function foodDraftValues(draft, path) {
  return path.split(".").reduce((obj, part) => obj[part], draft);
}

function foodDraftSelectionCount(draft) {
  if (draft.section === "details") return 0;
  if (draft.section === "diet") return draft.food.diet.length;
  if (draft.section === "avoid") return draft.food.restrictions.length;
  if (draft.section === "cuisine") return draft.food.cuisine.length;
  if (draft.section === "eveningActivities") return selectedEveningActivities({ alcohol: draft.alcohol }).length;
  if (draft.section === "nightlife") return selectedNightlifeAndDrinks({ alcohol: { ...draft.alcohol, primary: draft.alcoholPrimary } }).length;
  return 0;
}

function foodDetailsEditor(draft) {
  return `<div class="details-editor">
    <label>Food Budget per Person ${select("foodDraft.food.foodBudgetPerPerson", draft.food.foodBudgetPerPerson || "~$15-$30 per person/day", ["~$15-$30 per person/day", "~$30-$60 per person/day", "~$60-$100 per person/day", "Custom"], "Food Budget per Person")}</label>
    <label>Willingness to Drive for Food ${select("foodDraft.food.driveForFood", draft.food.driveForFood || "Short drive is acceptable", ["No extra driving", "Short drive is acceptable", "Flexible for excellent food"], "Willingness to Drive for Food")}</label>
    <label>Reservation Willingness ${select("foodDraft.food.reservations", draft.food.reservations || "Willing for must-do restaurants", ["Avoid reservations", "Willing for must-do restaurants", "Comfortable reserving restaurants"], "Reservation Willingness")}</label>
    <label>Breakfast Source Preference ${select("foodDraft.food.breakfast", draft.food.breakfast || "Hotel breakfast preferred", ["Hotel breakfast preferred", "Quick breakfast preferred", "Flexible"], "Breakfast Source Preference")}</label>
    <label>Packed Lunch ${select("foodDraft.food.lunch", draft.food.lunch || "Flexible", ["Packed lunch acceptable", "Restaurant lunch preferred", "Flexible"], "Packed Lunch")}</label>
  </div>`;
}

function clearFoodDraft() {
  const draft = ui.foodDraft;
  if (!draft) return;
  if (draft.section === "diet") draft.food.diet = [];
  if (draft.section === "avoid") draft.food.restrictions = [];
  if (draft.section === "cuisine") draft.food.cuisine = [];
  if (draft.section === "eveningActivities") draft.alcohol.preferences = draft.alcohol.preferences.filter((item) => !["Quiet evening venues", "Evening walks", "Sunset activities", "Live music", "Dessert or cafe evenings"].includes(item));
  if (draft.section === "nightlife") {
    draft.alcohol.preferences = draft.alcohol.preferences.filter((item) => !["No alcohol", "Alcohol acceptable", "Occasional drinks", "Cocktails", "Bars", "Breweries", "Wineries", "Distilleries", "Nightlife", "Party-focused nightlife"].includes(item));
    draft.alcoholPrimary = "Not Specified";
  }
}

function saveFoodDraft() {
  state.trip.food = structuredClone(ui.foodDraft.food);
  state.trip.alcohol = structuredClone(ui.foodDraft.alcohol);
  state.trip.alcohol.primary = ui.foodDraft.alcoholPrimary;
  state.trip.alcohol.recommendationVisibility = ui.foodDraft.alcoholVisibility;
  if (state.trip.alcohol.primary === "No Alcohol") clearAlcoholFocusedSelections();
  ui.openFoodSection = null;
  ui.foodDraft = null;
  ui.foodSearch = "";
}

function lodgingOverlay() {
  if (!ui.openLodgingPicker) return "";
  return `<div class="restriction-layer" data-action="closeLodging">
    <div class="choice-panel" role="dialog" aria-label="Accommodation Preferences">
      <div class="restriction-title">Accommodation Preferences</div>
      <div class="choice-list">${optionSets.lodging.map((option) => `<label class="restriction-option">${checkbox(`lodging.styles.${option}`, state.trip.lodging.styles.includes(option), option)}<span class="restriction-check" aria-hidden="true">${state.trip.lodging.styles.includes(option) ? "✓" : ""}</span><span>${esc(option)}</span></label>`).join("")}</div>
      <div class="restriction-actions"><button data-action="closeLodging">Done</button></div>
    </div>
  </div>`;
}

function multiSelect(path, title, options, values) {
  return `<div class="picker"><h3>${title}</h3><div class="small-chip-grid">${options.map((option) => `<label class="small-chip ${values.includes(option) ? "selected" : ""}">${checkbox(`${path}.${option}`, values.includes(option), option)}${esc(option)}</label>`).join("")}</div></div>`;
}

function comfortStep() {
  const trip = state.trip;
  const issues = reviewIssues().filter((issue) => issue.owningStep === 5 || issue.field?.startsWith("trip.schedule") || issue.field?.startsWith("trip.budget") || issue.issue.includes("Dinner Time"));
  const hikingInterest = selectedExperiences().some((pref) => /hiking|outdoor/i.test(pref.label) && !/avoid/i.test(pref.importance));
  const carRelevant = /drive|car|rent/i.test(trip.transportation);
  const evRelevant = trip.transport.electricVehicle || /electric|ev|charging/i.test(`${trip.transport.rentalCar} ${trip.transport.charging}`);
  return `<section class="panel comfort-panel">
    <div class="panel-head"><div><p class="eyebrow">Step 5</p><h2>Comfort and Budget</h2></div>${badge(`${trip.schedule.pace} pace`)}</div>
    <div class="comfort-card-grid">
      ${comfortCard(1, "Daily Schedule", "Define your ideal daily rhythm.", "calendar", "blue", table(["Setting", "Preference"], [
        `<tr><td>Pace</td><td>${select("trip.schedule.pace", trip.schedule.pace, ["Very relaxed", "Relaxed", "Balanced", "Active", "Packed"], "Pace")}</td></tr>`,
        `<tr><td>Wake-Up Time</td><td>${input("trip.schedule.wakeUp", trip.schedule.wakeUp || "8:00 AM", "Wake-Up Time")}</td></tr>`,
        `<tr><td>Earliest Activity</td><td>${input("trip.schedule.earliestActivity", trip.schedule.earliestActivity || "9:00 AM", "Earliest Activity")}</td></tr>`,
        `<tr><td>Latest Return</td><td>${input("trip.schedule.latestReturn", trip.schedule.latestReturn || "10:00 PM", "Latest Return")}</td></tr>`,
        `<tr><td>Major Activities per Day</td><td>${input("trip.schedule.majorActivities", trip.schedule.majorActivities || 2, "Major Activities per Day", "number")}</td></tr>`,
        `<tr><td>Desired Free Time per Day</td><td>${input("trip.schedule.freeTime", trip.schedule.freeTime || "2 hours", "Desired Free Time per Day")}</td></tr>`
      ]))}
      ${comfortCard(2, "Physical Comfort", "Tell us about your activity comfort.", "hiking", "green", `${!hikingInterest ? `<p class="sr-only">Hiking is not currently selected as an interest. <button class="small" data-action="addHikingInterest">Add Hiking Interest</button></p>` : ""}
        ${table(["Setting", "Preference"], [
          `<tr><td>Walking Ability</td><td>${select("trip.activity.walking", trip.activity.walking === "Not Specified" ? "Easy walking" : trip.activity.walking, ["Minimal walking", "Easy walking", "Moderate walking", "High walking tolerance"], "Walking Ability")}</td></tr>`,
          `<tr><td>Hiking Interest</td><td>${select("trip.activity.hiking", trip.activity.hiking === "No hiking" ? "Easy hikes" : trip.activity.hiking, ["No hiking", "Easy hikes", "Moderate hikes", "Difficult hikes"], "Hiking Interest")}</td></tr>`,
          `<tr><td>Maximum Hiking Difficulty</td><td>${select("trip.activity.hiking", trip.activity.hiking, ["No hiking", "Easy hikes", "Moderate hikes", "Difficult hikes"], "Maximum Hiking Difficulty")}</td></tr>`,
          `<tr><td>Maximum Hiking Duration</td><td>${input("trip.activity.maxHikeDuration", trip.activity.maxHikeDuration || "2 hours", "Maximum Hiking Duration")}</td></tr>`,
          `<tr><td>Maximum Hiking Distance</td><td>${input("trip.activity.maxHikeDistance", trip.activity.maxHikeDistance || "4 miles", "Maximum Hiking Distance")}</td></tr>`
        ])}`)}
      ${comfortCard(3, "Transportation Limits", "Set your preferences for getting around.", "car", "purple", `${!carRelevant ? `<p class="sr-only">Driving limits are hidden because the selected transportation method is ${esc(trip.transportation)}.</p>` : ""}
        ${table(["Setting", "Preference"], [
          `<tr><td>Maximum Driving per Day</td><td>${input("trip.transport.maxDrivingDay", trip.transport.maxDrivingDay || "4 hours", "Maximum Driving per Day")}</td></tr>`,
          `<tr><td>Maximum Continuous Driving</td><td>${input("trip.transport.maxContinuous", trip.transport.maxContinuous || "2 hours", "Maximum Continuous Driving")}</td></tr>`,
          `<tr><td>Scenic Route Preference</td><td>${select("trip.transport.routePreference", trip.transport.routePreference || (trip.transport.scenicRoutes ? "Prefer Scenic Routes" : "Balanced"), ["Prefer Fastest Route", "Balanced", "Prefer Scenic Routes"], "Scenic Route Preference")}</td></tr>`,
          `<tr><td>Toll Preference</td><td>${select("trip.transport.tolls", trip.transport.tolls, ["Avoid Tolls", "Use Tolls When Helpful", "No Preference"], "Toll Preference")}</td></tr>`,
          `<tr><td>Ferry Preference</td><td>${select("trip.transport.ferries", trip.transport.ferries, ["Avoid Ferries", "Ferries Are Acceptable", "Interested in Ferries", "No Preference"], "Ferry Preference")}</td></tr>`,
          `<tr><td>Rental Car Requirements</td><td>${input("trip.transport.rentalCar", trip.transport.rentalCar, "Rental Car Requirements")}</td></tr>`,
          evRelevant ? `<tr><td>Electric Vehicle Charging Needs</td><td>${input("trip.transport.charging", trip.transport.charging, "Electric Vehicle Charging Needs")}</td></tr>` : ""
        ].filter(Boolean))}`)}
      ${comfortCard(4, "Budget and Accommodation", "Let us know your budget and lodging style.", "bed", "orange", table(["Setting", "Preference"], [
          `<tr><td>Budget Style</td><td>${select("trip.budget.style", trip.budget.style === "Not Specified" ? "Moderate" : trip.budget.style, ["Budget", "Moderate", "Premium", "Luxury", "Custom amount"], "Budget Style")}</td></tr>`,
          `<tr><td>Total Budget</td><td>${input("trip.budget.total", trip.budget.total || "$1,500-$3,500", "Total Budget")}${budgetHint(trip)}</td></tr>`,
          `<tr><td>Budget Strictness</td><td>${select("trip.budget.strictness", trip.budget.strictness, ["Strict", "Flexible"], "Budget Strictness")}</td></tr>`,
          `<tr><td>Maximum Nightly Lodging Budget</td><td>${input("trip.budget.lodging", trip.budget.lodging || "$260", "Maximum Nightly Lodging Budget")}</td></tr>`,
          `<tr><td>Maximum Hotel Changes</td><td>${select("trip.lodging.changeHotels", trip.lodging.changeHotels, ["Stay in one place", "Minimize hotel changes", "Open to moving"], "Maximum Hotel Changes")}</td></tr>`,
          `<tr><td>Accommodation Preferences</td><td>${esc(chipSummary(trip.lodging.styles.length ? trip.lodging.styles : ["Hotel", "Free parking", "Free breakfast"]))} <button class="small" data-action="openLodging">Edit</button></td></tr>`
        ]))}
    </div>
    <div class="comfort-tip"><span aria-hidden="true">${iconSvg("leaf")}</span><strong>Tip:</strong> Your comfort and budget settings help us balance experiences, travel time, and costs for the best overall trip.</div>
    ${issues.length ? stepIssueTable(issues) : ""}
    ${wizardFooter("Back", "Save and Exit", "Continue")}
  </section>`;
}

function comfortCard(number, title, subtitle, icon, tone, body) {
  return `<section class="comfort-card comfort-${esc(tone)}">
    <div class="comfort-card-header">
      <span class="comfort-number"><b>${number}</b><i aria-hidden="true">${iconSvg(icon)}</i></span>
      <div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>
    </div>
    ${body}
  </section>`;
}

function reviewStep() {
  const trip = state.trip;
  const blocking = blockingValidationIssues();
  const issues = reviewIssues();
  const status = blocking.length ? "Needs Attention" : issues.length ? "Ready with Warnings" : "Ready to Build";
  return `<section class="panel review-panel">
    <div class="panel-head"><div><p class="eyebrow">Step 6 of 6</p><h2>Review Your Trip</h2></div><div class="review-head-actions">${badge(status)}<button class="small">Expand All</button></div></div>
    <section class="review-overview"><strong>${esc(heroDestination(trip))}</strong><span>${esc(tripDateSummary(trip))}</span><span>${travelerTotal(trip)} travelers</span><span>${esc(trip.schedule.pace)} pace</span></section>
    <div class="review-grid">
      ${reviewCard("Trip Basics", 1, "basics", [["Origin", trip.fromDisplay || trip.from], ["Destination", heroDestination(trip)], ["Dates", formatDateRange(trip.startDate, trip.endDate)], ["Trip Length", `${trip.days} days / ${calculateTripNights(Number(trip.days || 0))} nights`], ["Transportation", trip.transportation]])}
      ${reviewCard("Travelers", 2, "travelers", [["Trip Type", trip.groupType], ["Adults", trip.adults], ["Children", trip.children], ["Seniors (65+)", trip.seniors]])}
      ${reviewCard("Trip Style", 3, "style", [["Nature Focus", trip.style.balance], ["Atmosphere", trip.style.atmosphere], ["Location Feel", trip.style.locationFeel], ["Top Experiences", topExperienceSummary()]])}
      ${reviewCard("Food and Evenings", 4, "food", [["Diet", chipSummary(trip.food.diet)], ["Avoid", chipSummary(trip.food.restrictions)], ["Limits", chipSummary(trip.food.restrictions)], ["Evenings", chipSummary(trip.alcohol.preferences)]])}
      ${reviewCard("Comfort and Budget", 5, "comfort", [["Pace", `${trip.schedule.pace} pace`], ["Major Activities / Day", trip.schedule.majorActivities || 2], ["Max Driving / Day", trip.transport.maxDrivingDay || "4 hours"], ["Budget Range", trip.budget.total || "$1,500-$3,500"], ["Accommodation", chipSummary(trip.lodging.styles.length ? trip.lodging.styles : ["Hotel with free parking and breakfast"])]])}
      ${reviewIssuesCard(issues)}
    </div>
    ${wizardFooter("Back", "Save and Exit", "Build My Trip", blocking.length ? "disabled" : "")}
  </section>
  ${previewSection()}`;
}

function quickInterpretTable() {
  const interpreted = state.trip.interpretedSuggestions || [];
  const selectedCount = interpreted.filter((pref) => pref.include && !pref.applied).length;
  return `<section class="panel secondary"><div class="panel-head"><div><p class="eyebrow">Original Request</p><h2>Interpreted Preferences</h2></div><button data-action="applyInterpretation" ${selectedCount ? "" : "disabled"}>Apply Selected Preferences</button></div>
    <p class="muted">${esc(state.trip.originalText || state.trip.description || "Add a trip description, then interpret it.")}</p>
    ${table(["Category", "Interpretation", "Importance", "Source", "Include", "Edit"], interpreted.map((pref) => `<tr><td>${esc(titleCase(pref.category))}</td><td>${input(`interp.${pref.id}.label`, pref.label, "Interpretation")}</td><td>${select(`interp.${pref.id}.importance`, pref.importance, Object.keys(importanceWeights), "Importance")}</td><td>${esc(pref.source || "Trip Description")}</td><td>${checkbox(`interpInclude.${pref.id}`, pref.include && !pref.applied, "Include")}</td><td>${pref.applied ? badge("Applied") : `<button class="small" data-action="removeInterpretation:${pref.id}">Remove</button>`}</td></tr>`), "Use Interpret My Trip to preview suggestions before applying them.")}
    ${interpreted.some((pref) => pref.label === "Adventure activities") ? `<div class="callout"><strong>What does adventure mean to you?</strong><div class="small-chip-grid">${["Outdoor activities", "Hiking", "Water activities", "Road trips", "Theme parks", "Extreme sports", "Local exploration", "Other"].map((option) => `<label class="small-chip">${checkbox(`adventure.${option}`, false, option)}<span>${esc(option)}</span></label>`).join("")}</div></div>` : ""}
  </section>`;
}

function reviewCard(title, step, tone, rows) {
  return `<article class="review-card review-${esc(tone)}">
    <div class="review-card-art" aria-hidden="true"></div>
    <div class="review-card-content">
      <div class="panel-head mini-head"><h3>${esc(title)}</h3><button data-step="${step}">Edit</button></div>
      ${table(["Item", "Selection"], rows.map(([item, value]) => `<tr><td>${esc(item)}</td><td>${esc(displayValue(value))}</td></tr>`))}
    </div>
  </article>`;
}

function reviewIssuesCard(issues) {
  const firstIssue = issues[0];
  return `<article class="review-card review-issues issues-card">
    <div class="review-card-art" aria-hidden="true"></div>
    <div class="review-card-content">
      <div class="panel-head mini-head"><h3>Issues and Advisories</h3><button data-step="${firstIssue?.owningStep || 1}">Edit</button></div>
      ${firstIssue ? `<div class="issue-summary"><strong>${esc(firstIssue.issue)}</strong><p>${esc(firstIssue.action || "Review this item before building your trip.")}</p></div>` : `<div class="issue-summary clear"><strong>No issues found.</strong><p>Your trip is ready to build.</p></div>`}
    </div>
  </article>`;
}

function topExperienceSummary() {
  const selected = selectedExperiences().map((pref) => pref.label);
  return selected.length ? selected.slice(0, 4).join(", ") : "Not Selected";
}

function chipSummary(values) {
  const list = (values || []).filter(Boolean);
  return list.length ? list.join(" · ") : "Not Selected";
}

function displayValue(value, fallback = "Not Provided") {
  if (value === 0) return "0";
  if (Array.isArray(value)) return value.length ? value.join(" · ") : "None";
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function travelerExceptionSummary(trip) {
  const exceptions = (trip.travelers || []).flatMap((traveler, index) => (traveler.restrictions || []).map((restriction) => `${traveler.name || `Traveler ${index + 1}`}: ${restriction}`));
  return exceptions.length ? exceptions.join(" · ") : "None";
}

function preferenceSummaryByImportance(...importanceValues) {
  const matches = selectedExperiences().filter((pref) => importanceValues.includes(pref.importance)).map((pref) => pref.label);
  return matches.length ? matches.slice(0, 5).join(" · ") : "None";
}

function reviewIssues() {
  return getTripIssues(state.trip);
}

function crossStepIssues() {
  const issues = [];
  const alcohol = state.trip.alcohol.preferences || [];
  if (state.trip.alcohol.primary === "No Alcohol" && alcohol.some((item) => ["Cocktails", "Bars", "Breweries", "Wineries", "Distilleries"].includes(item))) {
    issues.push({ severity: "Critical", issue: "No Alcohol conflicts with alcohol-focused interests.", action: "Edit Alcohol" });
  }
  if (state.trip.food.dinnerTime && state.trip.schedule.latestReturn && state.trip.food.dinnerTime > state.trip.schedule.latestReturn) {
    issues.push({ severity: "Warning", issue: "Preferred Dinner Time is later than Latest Return.", action: "Edit Food or Comfort" });
  }
  if (state.trip.budget.strictness === "Strict" && !String(state.trip.budget.total || "").trim()) {
    issues.push({ severity: "Warning", issue: "Strict budget needs a Total Budget.", action: "Edit Comfort and Budget" });
  }
  if (state.trip.activity.hiking === "No hiking" && selectedExperiences().some((pref) => /hiking/i.test(pref.label) && !/avoid/i.test(pref.importance))) {
    issues.push({ severity: "Warning", issue: "Hiking is selected in Trip Style but capability says No hiking.", action: "Edit Trip Style or Comfort" });
  }
  return issues;
}

function stepIssueTable(issues) {
  return `<div class="issue-table">${table(["Severity", "Issue", "Action"], issues.map((issue) => `<tr><td>${esc(issue.severity)}</td><td>${esc(issue.issue)}</td><td><button class="small" data-action="focusIssue:${esc(issue.field || "")}:${issue.owningStep || state.activeStep}">${esc(issue.action)}</button></td></tr>`))}</div>`;
}

function budgetHint(trip) {
  if (trip.budget.strictness === "Strict" || trip.budget.style === "Custom amount") return `<small class="field-note">Required for strict or custom budgets.</small>`;
  return `<small class="field-note">Optional; an exact total improves itinerary accuracy.</small>`;
}

function whyItFits() {
  const reasons = [];
  const selected = selectedExperiences();
  if (selected.some((pref) => /lakes|waterfalls/i.test(pref.label))) reasons.push("Lakes and waterfalls are selected experiences.");
  reasons.push(`The group prefers a ${state.trip.schedule.pace.toLowerCase()} pace with ${state.trip.schedule.majorActivities} major activities per day.`);
  if (state.trip.food.diet.length || state.trip.food.restrictions.length) reasons.push(`Restaurants must support ${chipSummary([...state.trip.food.diet, ...state.trip.food.restrictions])}.`);
  reasons.push(`Driving is limited to ${state.trip.transport.maxDrivingDay} per day.`);
  if ((state.trip.alcohol.preferences || []).includes("Quiet evening venues")) reasons.push("Quiet evening venues are preferred.");
  return reasons.slice(0, 5);
}

function wizardFooter(backLabel, saveLabel, primaryLabel, primaryDisabled = "") {
  const backButton = backLabel ? button(backLabel, "prev") : "";
  const primaryAction = primaryLabel === "Build My Trip" ? "generatePreview" : primaryLabel === "Continue" ? "next" : "noop";
  return `<div class="wizard-footer">${backButton}${button(saveLabel, "saveExit")}<button class="primary" data-action="${primaryAction}" ${primaryDisabled}>${esc(primaryLabel)}</button></div>`;
}

function previewSection() {
  const preview = state.preview;
  if (!preview) return "";
  return `<section class="panel preview"><div class="panel-head"><div><p class="eyebrow">Generated preview</p><h2>${esc(preview.summary)}</h2></div>${badge("Provider facts not connected")}</div>
    ${table(["Day", "Morning", "Afternoon", "Evening", "Trust note"], preview.days.map((day) => `<tr><td>Day ${day.day}</td><td>${esc(day.morning)}</td><td>${esc(day.afternoon)}</td><td>${esc(day.evening)}</td><td>${esc(day.note)}</td></tr>`))}
    ${table(["Prioritized"], preview.prioritized.map((pref) => `<tr><td>Recommended because ${esc(pref.label)} is ${esc(pref.importance.toLowerCase())}.</td></tr>`), "No priorities yet.")}
    ${table(["Not prioritized"], preview.avoided.map((pref) => `<tr><td>Not prioritized because ${esc(pref.label)} is marked ${esc(pref.importance.toLowerCase())}.</td></tr>`), "No avoided preferences.")}
  </section>`;
}

function bind() {
  document.querySelectorAll("[data-step]").forEach((el) => el.addEventListener("click", () => {
    ui.openRestrictionTravelerId = null;
    ui.restrictionSearch = "";
    state.activeStep = Number(el.dataset.step);
    persist("Opened");
  }));
  document.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("change", () => updateField(el.dataset.field, el.value));
    if ((el.matches("input") || el.matches("textarea")) && el.dataset.field !== "ui.restrictionSearch") {
      el.addEventListener("input", () => {
        updateFieldDraft(el.dataset.field, el.value);
        el.dataset.dirtyDraft = "true";
      });
      el.addEventListener("blur", () => {
        if (el.dataset.dirtyDraft === "true") {
          delete el.dataset.dirtyDraft;
          persist();
        }
      });
    }
  });
  document.querySelectorAll(".restriction-search").forEach((el) => el.addEventListener("input", () => updateField(el.dataset.field, el.value)));
  document.querySelectorAll("[data-check]").forEach((el) => el.addEventListener("change", () => updateCheck(el.dataset.check, el.checked)));
  document.querySelectorAll("[data-location-field]").forEach((el) => {
    el.addEventListener("focus", () => openLocationSuggestions(el.dataset.locationField));
    el.addEventListener("input", () => updateLocationDraft(el.dataset.locationField, el.value));
    el.addEventListener("keydown", (event) => handleLocationKeydown(event, el.dataset.locationField));
  });
  document.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", (event) => {
    if ((el.matches(".restriction-layer") || el.matches(".location-layer")) && event.target !== el) return;
    action(el.dataset.action);
  }));
  document.querySelectorAll("[data-segment]").forEach((el) => el.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const group = [...document.querySelectorAll(`[data-segment="${CSS.escape(el.dataset.segment)}"]`)];
    const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = group[(group.indexOf(el) + direction + group.length) % group.length];
    event.preventDefault();
    next.focus();
    action(next.dataset.action);
  }));
  document.querySelectorAll(".planning-principles").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (!ui.planningPrinciplesSuppressHover) el.classList.add("hover-open");
    });
    el.addEventListener("mouseleave", () => {
      ui.planningPrinciplesSuppressHover = false;
      el.classList.remove("hover-open", "suppress-hover");
    });
  });
  if (!globalListenersBound) {
    document.addEventListener("keydown", closeDialogsOnEscape);
    window.addEventListener("resize", positionRestrictionOverlay);
    window.addEventListener("scroll", positionRestrictionOverlay, true);
    window.addEventListener("resize", positionLocationOverlay);
    window.addEventListener("scroll", positionLocationOverlay, true);
    document.addEventListener("pointerdown", closeLocationOnOutsidePointer, true);
    document.addEventListener("pointerdown", closePlanningPrinciplesOnOutsidePointer, true);
    globalListenersBound = true;
  }
  if (ui.focusRestrictionTriggerId) {
    const id = ui.focusRestrictionTriggerId;
    ui.focusRestrictionTriggerId = null;
    requestAnimationFrame(() => document.querySelector(`[data-restriction-trigger="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  }
  if (ui.focusPlanningPrinciples) {
    ui.focusPlanningPrinciples = false;
    requestAnimationFrame(() => document.querySelector(".planning-principles-trigger")?.focus({ preventScroll: true }));
  }
  positionLocationOverlay();
}

function bindLocationPanelActions() {
  document.querySelectorAll(".location-layer [data-action]").forEach((el) => el.addEventListener("click", (event) => {
    if (el.matches(".location-layer") && event.target !== el) return;
    action(el.dataset.action);
  }));
}

function refreshLocationPanel() {
  const existingLayer = document.querySelector(".location-layer");
  const overlay = locationAutocompleteOverlay();
  document.querySelectorAll("[data-location-field]").forEach((input) => {
    input.setAttribute("aria-expanded", input.dataset.locationField === ui.activeLocationField ? "true" : "false");
    input.removeAttribute("aria-activedescendant");
  });
  existingLayer?.remove();
  if (!overlay) return;
  document.querySelector("#app")?.insertAdjacentHTML("beforeend", overlay);
  bindLocationPanelActions();
  const field = ui.activeLocationField;
  const input = field ? document.querySelector(`[data-location-field="${CSS.escape(field)}"]`) : null;
  if (input) {
    const panelId = `location-results-${field}`;
    const activeId = ui.locationHighlight[field] >= 0 ? `${panelId}-${ui.locationHighlight[field]}` : "";
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", panelId);
    if (activeId) input.setAttribute("aria-activedescendant", activeId);
    else input.removeAttribute("aria-activedescendant");
  }
  positionLocationOverlay();
}

function closeDialogsOnEscape(event) {
  if (event.key !== "Escape") return;
  if (ui.openRestrictionTravelerId) closeRestrictions(ui.openRestrictionTravelerId);
  else if (ui.activeLocationField) ui.activeLocationField = null;
  else if (ui.openExperienceCategory) {
    ui.openExperienceCategory = null;
    ui.experienceSearch = "";
  } else if (ui.openFoodSection) ui.openFoodSection = null;
  else if (ui.openLodgingPicker) ui.openLodgingPicker = false;
  else if (ui.planningPrinciplesOpen) closePlanningPrinciples();
  else return;
  persist("Updated");
}

function closePlanningPrinciples() {
  ui.planningPrinciplesOpen = false;
  ui.planningPrinciplesSuppressHover = true;
  ui.focusPlanningPrinciples = true;
}

function closePlanningPrinciplesOnOutsidePointer(event) {
  if (!ui.planningPrinciplesOpen) return;
  if (event.target?.closest?.(".planning-principles")) return;
  ui.planningPrinciplesOpen = false;
  ui.planningPrinciplesSuppressHover = false;
  render();
}

function closeLocationOnOutsidePointer(event) {
  if (!ui.activeLocationField) return;
  const target = event.target;
  if (target?.closest?.(".location-results-panel") || target?.closest?.(".location-field")) return;
  ui.activeLocationField = null;
  refreshLocationPanel();
}

function openLocationSuggestions(field) {
  ui.activeLocationField = field;
  ui.locationHighlight[field] = -1;
  queueLocationSearch(field, locationValue(field));
  refreshLocationPanel();
}

function updateLocationDraft(field, value) {
  ui.touchedBasicsFields.add(field);
  const path = field === "from" ? "trip.from" : field === "destination" ? "trip.destination" : "trip.destinationRegions";
  setPath(state, path, value);
  if (field === "from") {
    state.trip.fromDisplay = normalizePlaceName(value);
    state.trip.fromVerificationStatus = "NeedsReview";
    state.trip.fromPlaceId = "";
    state.trip.fromLat = null;
    state.trip.fromLng = null;
    state.trip.fromAirportCode = "";
    state.trip.fromLocation = null;
    markLocationFieldNeedsReview(field);
  }
  if (field === "destination") {
    state.trip.destinationDisplay = normalizePlaceName(value);
    state.trip.destinationVerificationStatus = "NeedsReview";
    state.trip.destinationPlaceId = "";
    state.trip.destinationLat = null;
    state.trip.destinationLng = null;
    state.trip.destinationAirportCode = "";
    state.trip.destinationLocation = null;
    state.trip.destinationRefinementStatus = "Not Started";
    markLocationFieldNeedsReview(field);
  }
  ui.activeLocationField = field;
  queueLocationSearch(field, value);
}

function markLocationFieldNeedsReview(field) {
  const input = document.querySelector(`[data-location-field="${CSS.escape(field)}"]`);
  const shell = input?.closest(".location-field");
  const pill = shell?.querySelector(".verification-pill");
  const helper = shell?.querySelector(".field-helper");
  if (pill) {
    pill.textContent = "Select from suggestions";
    pill.classList.remove("verified");
    pill.classList.add("needs-review");
    pill.setAttribute("aria-label", "Select a suggestion to verify this location.");
  }
  if (helper) helper.textContent = "Select a suggestion to verify this location.";
}

function locationValue(field) {
  if (field === "from") return state.trip.from;
  if (field === "destination") return state.trip.destination;
  return state.trip.destinationRegions;
}

function queueLocationSearch(field, value) {
  clearTimeout(locationTimers[field]);
  const requestId = (ui.locationRequestId[field] || 0) + 1;
  ui.locationRequestId[field] = requestId;
  ui.locationError[field] = "";
  ui.locationHighlight[field] = -1;
  if (!locationProvider || String(value || "").trim().length < LOCATION_MIN_QUERY_LENGTH) {
    ui.locationLoading[field] = false;
    ui.locationSuggestions[field] = [];
    refreshLocationPanel();
    return;
  }
  ui.locationLoading[field] = true;
  refreshLocationPanel();
  locationTimers[field] = setTimeout(async () => {
    try {
      const suggestions = await locationProvider.search(String(value || "").trim());
      if (ui.locationRequestId[field] !== requestId) return;
      ui.locationSuggestions[field] = suggestions.map((suggestion) => ({ ...suggestion, originalInput: value })).slice(0, 8);
      ui.locationError[field] = "";
    } catch {
      if (ui.locationRequestId[field] !== requestId) return;
      ui.locationSuggestions[field] = [];
      ui.locationError[field] = "We could not load location suggestions. You can continue with this location or try again.";
      if (field === "from") state.trip.fromVerificationStatus = "ProviderUnavailable";
      if (field === "destination") state.trip.destinationVerificationStatus = "ProviderUnavailable";
    } finally {
      if (ui.locationRequestId[field] !== requestId) return;
      ui.locationLoading[field] = false;
      refreshLocationPanel();
    }
  }, LOCATION_SEARCH_DEBOUNCE_MS);
}

function handleLocationKeydown(event, field) {
  const suggestions = ui.locationSuggestions[field] || [];
  if (event.key === "Escape") {
    ui.activeLocationField = null;
    refreshLocationPanel();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
  if (!suggestions.length) return;
  event.preventDefault();
  if (event.key === "ArrowDown") ui.locationHighlight[field] = (ui.locationHighlight[field] + 1 + suggestions.length) % suggestions.length;
  if (event.key === "ArrowUp") ui.locationHighlight[field] = (ui.locationHighlight[field] - 1 + suggestions.length) % suggestions.length;
  if (event.key === "Enter") {
    selectLocationSuggestion(field, Math.max(0, ui.locationHighlight[field]));
    persist("Updated");
    return;
  }
  refreshLocationPanel();
}

function selectLocationSuggestion(field, index) {
  const suggestion = ui.locationSuggestions[field]?.[index];
  if (!suggestion) return;
  ui.touchedBasicsFields.add(field);
  if (field === "from") {
    state.trip.from = suggestion.normalizedName;
    state.trip.fromDisplay = suggestion.normalizedName;
    state.trip.fromVerificationStatus = "Verified";
    state.trip.fromPlaceId = suggestion.providerPlaceId;
    state.trip.fromLat = suggestion.latitude;
    state.trip.fromLng = suggestion.longitude;
    state.trip.fromAirportCode = suggestion.airportCode || "";
    state.trip.fromLocation = suggestion;
  }
  if (field === "destination") {
    state.trip.destination = suggestion.normalizedName;
    state.trip.destinationDisplay = suggestion.normalizedName;
    state.trip.destinationVerificationStatus = "Verified";
    state.trip.destinationPlaceId = suggestion.providerPlaceId;
    state.trip.destinationLat = suggestion.latitude;
    state.trip.destinationLng = suggestion.longitude;
    state.trip.destinationAirportCode = suggestion.airportCode || "";
    state.trip.destinationLocation = suggestion;
    state.trip.destinationRefinementStatus = isBroadLocation(suggestion) ? "Needs Refinement" : "Refined";
  }
  ui.activeLocationField = null;
  ui.locationSuggestions[field] = [];
  ui.locationHighlight[field] = -1;
}

function clearLocationField(field) {
  clearTimeout(locationTimers[field]);
  ui.touchedBasicsFields.add(field);
  ui.locationRequestId[field] = (ui.locationRequestId[field] || 0) + 1;
  ui.locationSuggestions[field] = [];
  ui.locationLoading[field] = false;
  ui.locationError[field] = "";
  ui.locationHighlight[field] = -1;
  if (ui.activeLocationField === field) ui.activeLocationField = null;
  if (field === "from") {
    state.trip.from = "";
    state.trip.fromDisplay = "";
    state.trip.fromVerificationStatus = "Location Not Verified";
    state.trip.fromPlaceId = "";
    state.trip.fromLat = null;
    state.trip.fromLng = null;
    state.trip.fromAirportCode = "";
    state.trip.fromLocation = null;
  }
  if (field === "destination") {
    state.trip.destination = "";
    state.trip.destinationDisplay = "";
    state.trip.destinationVerificationStatus = "Location Not Verified";
    state.trip.destinationPlaceId = "";
    state.trip.destinationLat = null;
    state.trip.destinationLng = null;
    state.trip.destinationAirportCode = "";
    state.trip.destinationLocation = null;
    state.trip.destinationRegions = "";
    state.trip.destinationRefinements = [];
    state.trip.destinationRefinementStatus = "Not Started";
  }
  if (field === "destinationRegions") {
    state.trip.destinationRegions = "";
    state.trip.destinationRefinements = [];
  }
}

function positionLocationOverlay() {
  const panel = document.querySelector("[data-location-panel]");
  const field = ui.activeLocationField;
  const input = field ? document.querySelector(`[data-location-field="${CSS.escape(field)}"]`) : null;
  if (!panel || !input) return;
  if (window.matchMedia("(max-width: 760px)").matches) {
    panel.removeAttribute("style");
    return;
  }
  const rect = input.getBoundingClientRect();
  const padding = 12;
  const width = Math.min(Math.max(rect.width, 320), window.innerWidth - padding * 2);
  const maxHeight = Math.min(320, window.innerHeight - padding * 2);
  const below = window.innerHeight - rect.bottom - padding;
  const above = rect.top - padding;
  const placeAbove = below < 220 && above > below;
  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.left = `${Math.min(Math.max(rect.left, padding), window.innerWidth - width - padding)}px`;
  panel.style.top = `${placeAbove ? Math.max(padding, rect.top - maxHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - maxHeight - padding)}px`;
}

function closeRestrictions(id, restoreFocus = true) {
  ui.openRestrictionTravelerId = null;
  ui.restrictionSearch = "";
  if (restoreFocus) ui.focusRestrictionTriggerId = id;
}

function updateField(path, value) {
  if (path.startsWith("trip.")) ui.touchedBasicsFields.add(path);
  if (path.startsWith("prefImportance.")) {
    const pref = state.trip.preferences.find((item) => item.id === path.split(".")[1]);
    if (pref) {
      pref.importance = value;
      pref.weight = importanceWeights[value];
      pref.source = "User correction";
    }
  } else if (path.startsWith("importance.")) {
    const [, category, ...labelParts] = path.split(".");
    const label = labelParts.join(".");
    const existing = state.trip.preferences.find((item) => item.category === category && item.label === label);
    if (existing) {
      existing.importance = value;
      existing.weight = importanceWeights[value];
      existing.source = "User correction";
    }
  } else if (path.startsWith("traveler.")) {
    const [, id, key] = path.split(".");
    const traveler = state.trip.travelers.find((item) => item.id === id);
    if (traveler) traveler[key] = value;
  } else if (path.startsWith("interp.")) {
    const [, id, key] = path.split(".");
    const suggestion = state.trip.interpretedSuggestions.find((item) => item.id === id);
    if (suggestion) {
      suggestion[key] = value;
      if (key === "importance") suggestion.weight = importanceWeights[value];
    }
  } else if (path === "ui.restrictionSearch") {
    ui.restrictionSearch = value;
  } else if (path === "ui.experienceSearch") {
    ui.experienceSearch = value;
  } else if (path === "ui.foodSearch") {
    ui.foodSearch = value;
  } else if (path.startsWith("foodDraft.") && ui.foodDraft) {
    setPath(ui, path, value);
    if (path === "foodDraft.alcoholPrimary" && value === "No Alcohol") clearAlcoholFocusedSelections(ui.foodDraft.alcohol);
  } else if (path.startsWith("childAge.")) {
    setChildAge(Number(path.split(".")[1]), value);
  } else {
    if (["trip.groupType", "trip.adults", "trip.children", "trip.seniors"].includes(path) && !canChangeTravelerCount(path, value)) {
      render();
      return;
    }
    setPath(state, path, value);
    if (path === "trip.from") {
      state.trip.fromDisplay = normalizePlaceName(value);
      state.trip.fromVerificationStatus = "Location Not Verified";
    }
    if (path === "trip.destination") {
      state.trip.destinationDisplay = normalizePlaceName(value);
      state.trip.destinationVerificationStatus = "Location Not Verified";
      if (!tripBasicsIssues(state.trip).some((issue) => issue.field === "trip.destinationRegions")) state.trip.destinationRegions = state.trip.destinationRegions || "";
    }
    if (path === "trip.alcohol.primary" && value === "No Alcohol") clearAlcoholFocusedSelections();
    if (["trip.days", "trip.startDate", "trip.endDate"].includes(path)) reconcileTripDates(state.trip, path);
    if (["trip.groupType", "trip.adults", "trip.children", "trip.seniors"].includes(path)) syncTravelersToCounts(state.trip);
    if (path === "trip.description") state.trip.originalText = value;
  }
  persist();
}

function updateFieldDraft(path, value) {
  if (path.startsWith("trip.") || path.startsWith("childAge.")) ui.touchedBasicsFields.add(path);
  if (path.startsWith("interp.")) {
    const [, id, key] = path.split(".");
    const suggestion = state.trip.interpretedSuggestions.find((item) => item.id === id);
    if (suggestion) {
      suggestion[key] = value;
      if (key === "importance") suggestion.weight = importanceWeights[value];
    }
    return;
  }
  if (path.startsWith("traveler.")) {
    const [, id, key] = path.split(".");
    const traveler = state.trip.travelers.find((item) => item.id === id);
    if (traveler) traveler[key] = value;
    return;
  }
  if (path.startsWith("childAge.")) {
    setChildAge(Number(path.split(".")[1]), value);
    return;
  }
  if (!path.startsWith("trip.")) return;
  setPath(state, path, value);
  if (path === "trip.from") {
    state.trip.fromDisplay = normalizePlaceName(value);
    state.trip.fromVerificationStatus = "Location Not Verified";
  }
  if (path === "trip.destination") {
    state.trip.destinationDisplay = normalizePlaceName(value);
    state.trip.destinationVerificationStatus = "Location Not Verified";
  }
  if (["trip.days", "trip.startDate", "trip.endDate"].includes(path)) reconcileTripDates(state.trip, path);
  if (path === "trip.description") state.trip.originalText = value;
}

function canChangeTravelerCount(path, value) {
  const before = travelerTotal(state.trip);
  const simulated = structuredClone(state.trip);
  setPath({ trip: simulated }, path, value);
  const after = travelerTotal(simulated);
  if (after >= before) return true;
  const removed = state.trip.travelers.slice(after);
  const hasPopulated = removed.some((traveler) => traveler.name || traveler.notes || traveler.otherRestrictionText || traveler.restrictions?.length);
  return !hasPopulated || confirm("Reducing the traveler count will remove populated traveler information. Continue?");
}

function updateCheck(path, checked) {
  if (path.startsWith("pref.")) {
    const [, category, ...labelParts] = path.split(".");
    const label = labelParts.join(".");
    if (checked) addOrUpdatePreference(state.trip, category, label, "Nice to have");
    else {
      const pref = state.trip.preferences.find((item) => item.category === category && item.label === label);
      if (pref) removePreference(state.trip, pref.id);
    }
  } else if (path.startsWith("food.") || path.startsWith("alcohol.") || path.startsWith("lodging.")) {
    const parts = path.split(".");
    const option = parts.pop();
    const root = ui.foodDraft && ui.openFoodSection && (path.startsWith("food.") || path.startsWith("alcohol.")) ? ui.foodDraft : state.trip;
    const target = parts.reduce((obj, part) => obj[part], root);
    if (checked && !target.includes(option)) target.push(option);
    if (!checked && target.includes(option)) target.splice(target.indexOf(option), 1);
    if (path === "food.cuisine.No preference" && checked) root.food.cuisine = ["No preference"];
    if (path.startsWith("food.cuisine.") && checked && option !== "No preference") root.food.cuisine = root.food.cuisine.filter((item) => item !== "No preference");
    if (path.startsWith("alcohol.preferences.") && checked && option === "No alcohol") {
      root.alcohol.primary = "No Alcohol";
      clearAlcoholFocusedSelections(root.alcohol);
    }
    if (path.startsWith("alcohol.preferences.") && checked && ["Cocktails", "Bars", "Breweries", "Wineries", "Distilleries"].includes(option) && root.alcohol.primary === "No Alcohol") {
      root.alcohol.primary = "Interested in drinks";
    }
  } else if (path.startsWith("travelerRestriction.")) {
    const [, id, ...optionParts] = path.split(".");
    const option = optionParts.join(".");
    const traveler = state.trip.travelers.find((item) => item.id === id);
    traveler.restrictions ||= [];
    if (checked && !traveler.restrictions.includes(option)) traveler.restrictions.push(option);
    if (!checked) {
      if (option === "Other" && traveler.otherRestrictionText?.trim() && !confirm("Discard the Other restriction description for this traveler?")) {
        render();
        return;
      }
      traveler.restrictions = traveler.restrictions.filter((item) => item !== option);
      if (option === "Other") traveler.otherRestrictionText = "";
    }
  } else if (path.startsWith("interpInclude.")) {
    const id = path.split(".")[1];
    const suggestion = state.trip.interpretedSuggestions.find((item) => item.id === id);
    if (suggestion && !suggestion.applied) suggestion.include = checked;
  } else {
    setPath(state, path, checked);
  }
  persist();
}

function setPath(root, path, value) {
  const parts = path.split(".");
  let target = root;
  for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
  const last = parts.at(-1);
  if (path === "trip.samePreferences") {
    target[last] = value === "Yes";
    return;
  }
  target[last] = typeof target[last] === "number" ? Number(value) : value === "true" ? true : value === "false" ? false : value;
}

function action(name) {
  if (name === "next") state.activeStep = Math.min(6, state.activeStep + 1);
  if (name === "prev") state.activeStep = Math.max(1, state.activeStep - 1);
  if (name === "next" || name === "prev") {
    ui.openRestrictionTravelerId = null;
    ui.restrictionSearch = "";
    ui.openExperienceCategory = null;
    ui.experienceSearch = "";
  }
  if (name === "continueBasics") {
    ui.basicsSubmitAttempted = true;
    if (tripBasicsIssues(state.trip).some((issue) => issue.blocking)) {
      ui.showWarnings = true;
      ui.toast = "Resolve Step 1 issues before continuing.";
    } else {
      state.activeStep = 2;
      ui.toast = "";
    }
  }
  if (name === "interpretText") {
    const basicsErrors = validateBasics(state.trip);
    if (basicsErrors.length) {
      ui.interpretationError = "Resolve the Trip Basics issues before interpreting this trip.";
    } else if (!String(state.trip.description || "").trim()) {
      ui.interpretationError = "Add a Trip Description before interpreting.";
    } else {
      ui.interpretationError = "";
      state.trip.originalText = state.trip.description;
      state.trip.interpretedSuggestions = interpretFreeText(state.trip.description).map((pref) => ({ ...pref, include: true, applied: false }));
      ui.toast = state.trip.interpretedSuggestions.length ? "Interpretation preview ready." : "No supported preferences found yet.";
    }
  }
  if (name === "applyInterpretation") {
    const selected = (state.trip.interpretedSuggestions || []).filter((pref) => pref.include && !pref.applied);
    selected.forEach((pref) => {
      addOrUpdatePreference(state.trip, pref.category, pref.label, pref.importance, pref.source || "Trip Description");
      pref.applied = true;
      pref.include = false;
    });
    ui.toast = selected.length ? "Selected preferences applied." : "";
  }
  if (name.startsWith("removePref:")) removePreference(state.trip, name.split(":")[1]);
  if (name.startsWith("setField:")) {
    const [, path, ...valueParts] = name.split(":");
    setPath(state, path, valueParts.join(":"));
    reconcileTripStylePreferences(state.trip);
  }
  if (name.startsWith("removeInterpretation:")) {
    const id = name.split(":")[1];
    state.trip.interpretedSuggestions = (state.trip.interpretedSuggestions || []).filter((item) => item.id !== id);
  }
  if (name.startsWith("focusField:")) {
    const field = name.split(":")[1];
    requestAnimationFrame(() => (document.querySelector(`[data-field="${CSS.escape(field)}"]`) || document.querySelector(`[data-location-field="${CSS.escape(field.replace("trip.", ""))}"]`))?.focus());
  }
  if (name.startsWith("focusIssue:")) {
    const [, field, step] = name.split(":");
    state.activeStep = Number(step || state.activeStep);
    requestAnimationFrame(() => {
      if (field) document.querySelector(`[data-field="${CSS.escape(field)}"]`)?.focus();
    });
  }
  if (name === "addHikingInterest") {
    addOrUpdatePreference(state.trip, "experiences", "Hiking", "Nice to have", "Explicit Selection");
    state.trip.activity.hiking = "Easy hikes";
    ui.toast = "Hiking interest added.";
  }
  if (name.startsWith("openExperience:")) {
    ui.openExperienceCategory = name.split(":").slice(1).join(":");
    ui.experienceSearch = "";
  }
  if (name === "closeExperience") {
    ui.openExperienceCategory = null;
    ui.experienceSearch = "";
  }
  if (name.startsWith("clearExperience:")) {
    const category = name.split(":").slice(1).join(":");
    const labels = new Set((experienceCategories[category] || []).map(normalizeLabel));
    state.trip.preferences = state.trip.preferences.filter((pref) => !(pref.category === "experiences" && labels.has(normalizeLabel(pref.label))));
  }
  if (name.startsWith("selectLocation:")) {
    const [, field, index] = name.split(":");
    selectLocationSuggestion(field, Number(index));
  }
  if (name.startsWith("clearLocation:")) clearLocationField(name.split(":")[1]);
  if (name === "closeLocationSuggestions") ui.activeLocationField = null;
  if (name.startsWith("retryLocationSearch:")) {
    const field = name.split(":")[1];
    ui.activeLocationField = field;
    queueLocationSearch(field, locationValue(field));
  }
  if (name === "addCustomExperience") {
    const original = String(state.trip.style.customExperience || "").trim();
    const label = titleCase(original).slice(0, 80);
    if (!original) {
      ui.interpretationError = "Describe a specific experience before adding it.";
    } else if (selectedExperiences().some((pref) => normalizeLabel(pref.label) === normalizeLabel(label))) {
      ui.interpretationError = "That experience is already selected.";
    } else {
      addOrUpdatePreference(state.trip, "experiences", label, state.trip.style.customImportance || "Nice to have", "Custom Experience");
      const pref = state.trip.preferences.find((item) => normalizeLabel(item.label) === normalizeLabel(label) && item.category === "experiences");
      if (pref) pref.originalText = original;
      state.trip.style.customExperience = "";
      ui.interpretationError = "";
      ui.toast = "Specific experience added.";
    }
  }
  if (name === "focusCustomExperience") {
    requestAnimationFrame(() => document.querySelector('[data-field="trip.style.customExperience"]')?.focus());
  }
  if (name.startsWith("openFoodSection:")) {
    ui.openFoodSection = name.split(":")[1];
    ui.foodDraft = createFoodDraft(ui.openFoodSection);
    ui.foodSearch = "";
  }
  if (name === "cancelFoodSection" || name === "closeFoodSection") {
    ui.openFoodSection = null;
    ui.foodDraft = null;
    ui.foodSearch = "";
  }
  if (name === "clearFoodDraft" && ui.foodDraft) clearFoodDraft();
  if (name === "saveFoodSection" && ui.foodDraft) saveFoodDraft();
  if (name === "openLodging") ui.openLodgingPicker = true;
  if (name === "closeLodging") ui.openLodgingPicker = false;
  if (name.startsWith("toggleRestrictions:")) {
    const id = name.split(":")[1];
    if (ui.openRestrictionTravelerId === id) closeRestrictions(id);
    else ui.openRestrictionTravelerId = id;
    ui.restrictionSearch = "";
  }
  if (name.startsWith("closeRestrictions:")) {
    closeRestrictions(name.split(":")[1]);
  }
  if (name.startsWith("clearRestrictions:")) {
    const id = name.split(":")[1];
    const traveler = state.trip.travelers.find((item) => item.id === id);
    if (traveler) {
      const hasOtherText = traveler.restrictions?.includes("Other") && traveler.otherRestrictionText?.trim();
      if (hasOtherText && !confirm("Clear the Other restriction description for this traveler?")) return;
      traveler.restrictions = [];
      if (hasOtherText) traveler.otherRestrictionText = "";
    }
  }
  if (name.startsWith("removeTraveler:")) removeTraveler(name.split(":")[1]);
  if (name === "toggleWarnings") ui.showWarnings = !ui.showWarnings;
  if (name === "togglePreferences") ui.showPreferences = !ui.showPreferences;
  if (name === "togglePlanningPrinciples") {
    ui.planningPrinciplesOpen = !ui.planningPrinciplesOpen;
    ui.planningPrinciplesSuppressHover = false;
  }
  if (name === "saveExit") {
    saveExplicitDraft();
    ui.toast = "Draft saved.";
  }
  if (name === "saveProfile") saveProfile(state, `Profile ${state.profiles.length + 1}`, state.trip);
  if (name === "generatePreview") {
    if (blockingValidationIssues().length) {
      ui.showWarnings = true;
      ui.toast = "Resolve blocking issues before building your trip.";
    } else {
      state.preview = generatePlanPreview(state.trip);
      state.activeStep = 6;
    }
  }
  persist("Updated");
}

function clearAlcoholFocusedSelections(alcohol = state.trip.alcohol) {
  const focused = ["Cocktails", "Bars", "Breweries", "Wineries", "Distilleries"];
  const selected = (alcohol.preferences || []).filter((item) => focused.includes(item));
  if (!selected.length || confirm("No Alcohol conflicts with drink-focused options. Clear those options?")) {
    alcohol.preferences = (alcohol.preferences || []).filter((item) => !focused.includes(item));
    alcohol.recommendationVisibility = "Hide Completely";
  }
}

function childAgeValues(trip) {
  const count = Number(trip.children || 0);
  const values = String(trip.childrenAges || "").split(",").map((value) => value.trim()).filter(Boolean);
  return Array.from({ length: count }, (_, index) => values[index] || "");
}

function setChildAge(index, value) {
  const values = childAgeValues(state.trip);
  values[index] = value;
  state.trip.childrenAges = values.join(", ");
}

function removeTraveler(id) {
  const total = travelerTotal(state.trip);
  if (total <= 1) return;
  const traveler = state.trip.travelers.find((item) => item.id === id);
  const populated = traveler && (traveler.name || traveler.notes || traveler.otherRestrictionText || traveler.restrictions?.length);
  if (populated && !confirm("Remove this populated traveler row?")) return;
  if (traveler?.ageGroup === "Child" && Number(state.trip.children) > 0) state.trip.children -= 1;
  else if (traveler?.ageGroup === "Senior" && Number(state.trip.seniors) > 0) state.trip.seniors -= 1;
  else if (Number(state.trip.adults) > 0) state.trip.adults -= 1;
  syncTravelersToCounts(state.trip);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
