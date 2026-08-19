import { createSampleLosAngelesTrip, initialState } from "./seed.js?v=54";
import { routeMosaicApi } from "./api-client.js?v=54";
import {
  SAVED_TRIPS_KEY,
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
  calculateTripEndDate,
  calculateTripNights,
  tripBasicsIssues,
  travelerTotal,
  travelerWarnings,
  travelerRestrictionOptions,
  uid,
  validateBasics
} from "./domain.js";
import { createLocationSearchProvider, LOCATION_MIN_QUERY_LENGTH, LOCATION_SEARCH_DEBOUNCE_MS } from "./location-provider.js?v=54";
import {
  addCustomStop,
  compatibleAlternatives,
  moveActivity,
  regenerateDay,
  regenerateMeals,
  regeneratePlanPreservingLocks,
  removeScheduleItem,
  replaceActivity,
  toggleDayLock,
  toggleItemLock,
  toggleItemMustDo
} from "./planner.js?v=54";
import { registerGeneratedDestinationProfile } from "./destination-data.js";
import {
  approvedRouteStillValid,
  approveRouteOption,
  ensureRouteArchitecture,
  generateRouteArchitectureOptions,
  resetRouteApproval,
  routeRecommendationRequired,
  tripStructureOptions
} from "./route-architecture.js?v=54";

const TRIP_DESCRIPTION_PLACEHOLDER = "We are visiting Southern California for five days. We want famous LA highlights, scenic coastal views, vegetarian-friendly food, and relaxed evenings. We are open to adding San Diego, Santa Barbara, or another nearby destination if it improves the trip without excessive driving or hotel changes. We will fly in, rent a car, and prefer no more than three hours of driving per day.";
const TRIP_DESCRIPTION_SAMPLE = "We are visiting Southern California for five days. We want famous LA highlights, scenic coastal views, vegetarian-friendly food, and relaxed evenings. We are open to adding San Diego, Santa Barbara, or another nearby destination if it improves the trip without excessive driving or hotel changes. We will fly in, rent a car, and prefer no more than three hours of driving per day.";
const TRIP_DESCRIPTION_HELPER = "Tell us what would make this trip feel successful—must-dos, nearby cities, pace, food priorities, and anything to avoid.";

let state = load();
const locationProvider = createLocationSearchProvider();
const locationTimers = {};
let ui = {
  openDatePicker: null,
  datePickerViewMonth: null,
  showWarnings: false,
  showPreferences: false,
  interpretationError: "",
  toast: "",
  openExperienceCategory: null,
  experienceSearch: "",
  openFoodSection: null,
  foodDraft: null,
  foodSearch: "",
  openSpecialNeeds: false,
  planSection: "overview",
  planDialog: null,
  planDialogItemId: "",
  printSections: new Set(["overview", "itinerary", "food", "route", "budget", "advisories"]),
  customStopDraft: null,
  generatingPlan: false,
  planAnnouncement: "",
  planningPrinciplesOpen: false,
  planningPrinciplesSuppressHover: false,
  focusPlanningPrinciples: false,
  activeLocationField: null,
  locationSuggestions: { from: [], destination: [], destinationRegions: [], placesInMind: [], mustDoPlaces: [] },
  locationLoading: { from: false, destination: false, destinationRegions: false, placesInMind: false, mustDoPlaces: false },
  locationError: { from: "", destination: "", destinationRegions: "", placesInMind: "", mustDoPlaces: "" },
  locationHighlight: { from: -1, destination: -1, destinationRegions: -1, placesInMind: -1, mustDoPlaces: -1 },
  locationRequestId: { from: 0, destination: 0, destinationRegions: 0, placesInMind: 0, mustDoPlaces: 0 },
  // Places Already in Mind / Must-do Places are multi-value "tag" fields --
  // this holds the text currently being typed to add a new place, separate
  // from the already-added, comma-joined value in trip.routePreferences.
  placeTagDraft: { placesInMind: "", mustDoPlaces: "" },
  touchedBasicsFields: new Set(),
  basicsSubmitAttempted: false,
  // null = no manual toggle yet, so the section falls back to its
  // content-based default each render. Once the user opens or closes a
  // <details> panel by hand, remember that explicitly -- otherwise every
  // full re-render (which fires on any field change anywhere on the page,
  // including fields inside the panel itself) rebuilds the <details> element
  // from scratch without an open attribute and it snaps shut.
  routeDetailsOpen: null,
  comfortDetailsOpen: null
};

let globalListenersBound = false;

window.addEventListener("error", () => showFriendlyRuntimeError());
window.addEventListener("unhandledrejection", () => showFriendlyRuntimeError());

function showFriendlyRuntimeError() {
  const app = document.querySelector("#app");
  if (!app || app.querySelector(".runtime-error-banner")) return;
  app.insertAdjacentHTML("afterbegin", `<div class="runtime-error-banner" role="alert"><strong>Something went wrong.</strong><span>Your current browser session is still local. Refresh the page or reopen a saved trip from this browser.</span></div>`);
}

const steps = [
  "Trip Basics",
  "Trip Style",
  "Food and Evenings",
  "Review"
];

const stepSubtitles = [
  "Where, when, and who",
  "Your travel vibe",
  "Taste and unwind",
  "Finalize and go"
];

const stepHeadings = [
  ["Where should your next trip take you?", "Add the essential details. RouteMosaic will use them to shape a realistic itinerary."],
  ["What kind of experience do you want?", "Choose style scales and only the experiences that matter."],
  ["How do you want to eat and spend your evenings?", "Set group-wide dining, dietary, alcohol, and evening preferences."],
  ["Review your plan before we build the trip.", "Check your selections and confirm that everything looks good."]
];

const mockDestinationDataNames = ["new york", "seattle", "glacier", "maui", "paris", "tokyo", "iceland", "amalfi", "detroit", "charlotte", "los angeles"];

function load() {
  clearTransientWizardStorage();
  const loaded = structuredClone(initialState);
  loaded.plan = null;
  loaded.planStatus = "";
  loaded.planError = null;
  loaded.planStale = false;
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
  const draft = localTripRecord({
    savedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeStep: state.activeStep,
    trip: structuredClone(state.trip),
    preview: structuredClone(state.preview),
    plan: structuredClone(state.plan || null)
  });
  try {
    writeSavedTrip(draft);
    localStorage.setItem(SAVED_DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    ui.toast = error?.name === "QuotaExceededError" ? "Local storage is full. Delete an older saved trip and try again." : "We could not save this trip locally. Your current screen is still available.";
  }
}

function localTripRecord(record) {
  const destination = record.trip?.destinationDisplay || record.trip?.destination || "Untitled";
  return {
    schemaVersion: 1,
    id: record.trip?.id || uid("saved"),
    name: record.name || `${normalizePlaceName(destination)} trip`,
    savedAt: record.savedAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
    ...record
  };
}

function readSavedTrips() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_TRIPS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.schemaVersion === 1 && item.trip) : [];
  } catch {
    localStorage.removeItem(SAVED_TRIPS_KEY);
    return [];
  }
}

function writeSavedTrips(records) {
  localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(records));
}

function writeSavedTrip(record) {
  const records = readSavedTrips().filter((item) => item.id !== record.id);
  records.unshift(record);
  writeSavedTrips(records.slice(0, 20));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function input(path, value, label, type = "text", { min, max } = {}) {
  const bounds = type === "number" ? `${min !== undefined ? ` min="${esc(min)}"` : ""}${max !== undefined ? ` max="${esc(max)}"` : ""}` : "";
  return `<input aria-label="${esc(label)}" placeholder="${esc(label)}" data-field="${esc(path)}" type="${type}"${bounds} value="${esc(value ?? "")}">`;
}

// Plain text instead of type="date": Safari renders an empty native date
// input showing today's date at initial paint, before any event we could
// intercept even fires, and treats it as a real committed value the moment
// focus leaves the field -- confirmed live, twice, that no combination of
// event-listener gating stops it. A text field with the same YYYY-MM-DD
// storage format sidesteps the native widget's blank-state behavior
// entirely, so it starts (and stays) genuinely empty in every browser.
// readonly + calendar-only selection also sidesteps the MM/DD-vs-DD/MM
// ambiguity of a typed date on a site with a worldwide audience -- the
// displayed value is always the unambiguous "Aug 11, 2026" style, and the
// only way to set it is picking a real day off the grid.
function dateTextInput(path, value, label) {
  const open = ui.openDatePicker === path;
  return `<div class="date-field-wrap">
    <input aria-label="${esc(label)}" placeholder="Select a date" data-field="${esc(path)}" readonly data-action="toggleDatePicker:${esc(path)}" type="text" value="${esc(formatFriendlyDate(value))}">
    <button type="button" class="date-picker-toggle" aria-label="${open ? "Close" : "Open"} calendar for ${esc(label)}" aria-expanded="${open}" data-action="toggleDatePicker:${esc(path)}">${iconSvg("calendar")}</button>
  </div>`;
}

// Pairs a date picker with a plain type="time" input for the same day.
// Unlike dateTextInput's type="date" workaround above, type="time" needs no
// custom picker -- the Safari blank-state bug it sidesteps is specific to
// type="date", and this field is always prefilled with a real default value
// (never blank), so there's no equivalent edge case here.
function dateTimeField(datePath, dateValue, dateLabel, timePath, timeValue, timeLabel) {
  return `<div class="date-time-pair">
    ${dateTextInput(datePath, dateValue, dateLabel)}
    <input aria-label="${esc(timeLabel)}" data-field="${esc(timePath)}" type="time" value="${esc(timeValue ?? "")}">
  </div>`;
}

function todayDateParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function todayDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseDateTextValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatFriendlyDate(value) {
  const parsed = parseDateTextValue(value);
  if (!parsed) return "";
  return new Date(parsed.year, parsed.month - 1, parsed.day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Rendered as a top-level overlay (see datePickerOverlay/render call site),
// not nested inside the field -- the Trip Basics card it lives in
// (.step-1-zone) has overflow: hidden for its own decorative clipping, which
// silently clips any absolutely-positioned descendant regardless of
// z-index. Confirmed live: the dropdown rendered but was cut off at the
// card's edge. Positioned with fixed coordinates from
// positionDatePickerOverlay instead, the same escape hatch already used for
// the location-suggestions panel.
function datePickerOverlay() {
  const path = ui.openDatePicker;
  if (!path) return "";
  const currentValue = path === "trip.startDate" ? state.trip.startDate : state.trip.endDate;
  return `<div class="date-picker-layer" data-action="closeDatePicker">
    ${datePickerDropdown(path, currentValue)}
  </div>`;
}

function datePickerDropdown(path, currentValue) {
  const parsed = parseDateTextValue(currentValue);
  const view = ui.datePickerViewMonth || (parsed ? { year: parsed.year, month: parsed.month } : todayDateParts());
  const { year, month } = view;
  const todayValue = todayDateValue();
  // End Date must land after Start Date, not merely not-in-the-past --
  // calculateTripEndDate(startDate, 2) is "start date + 1 day", i.e. the
  // earliest valid End Date. Falls back to today's floor if Start Date isn't
  // set yet or the "+1 day" math can't resolve.
  const minValue = path === "trip.endDate" && state.trip.startDate
    ? (calculateTripEndDate(state.trip.startDate, 2) || todayValue)
    : todayValue;
  const minValueParts = parseDateTextValue(minValue) || todayDateParts();
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const totalDays = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(`<span class="date-picker-cell empty" aria-hidden="true"></span>`);
  for (let day = 1; day <= totalDays; day += 1) {
    const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const selected = currentValue === value;
    if (value < minValue) {
      cells.push(`<span class="date-picker-cell disabled" aria-hidden="true">${day}</span>`);
    } else {
      cells.push(`<button type="button" class="date-picker-cell${selected ? " selected" : ""}" data-action="pickDate:${esc(path)}:${value}">${day}</button>`);
    }
  }
  const atOrBeforeMinMonth = year < minValueParts.year || (year === minValueParts.year && month <= minValueParts.month);
  return `<div class="date-picker-dropdown" data-date-picker-panel="${esc(path)}">
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" aria-label="Previous month" data-action="datePickerNav:-1" ${atOrBeforeMinMonth ? "disabled" : ""}>&#8249;</button>
      <strong>${esc(monthLabel)}</strong>
      <button type="button" class="date-picker-nav" aria-label="Next month" data-action="datePickerNav:1">&#8250;</button>
    </div>
    ${path === "trip.endDate" && state.trip.startDate ? `<p class="date-picker-hint">Must be after ${esc(formatFriendlyDate(state.trip.startDate))}.</p>` : ""}
    <div class="date-picker-weekdays">${["S", "M", "T", "W", "T", "F", "S"].map((label) => `<span>${label}</span>`).join("")}</div>
    <div class="date-picker-grid">${cells.join("")}</div>
  </div>`;
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

let lastRenderedViewKey = "";

function render() {
  renderView();
  // Switching wizard steps, entering the plan view, or navigating to a
  // static page previously left the scroll position wherever it was on the
  // prior (often taller) page, leaving a blank gap above the new content
  // until the user manually scrolled up. Reset scroll only on an actual view
  // change, not on every re-render (e.g. while typing).
  const viewKey = `${window.location.pathname}|${state.activeStep}|${state.planStatus}|${Boolean(state.plan)}`;
  if (viewKey !== lastRenderedViewKey) {
    lastRenderedViewKey = viewKey;
    window.scrollTo(0, 0);
  }
}

function renderView() {
  if (isStaticInfoRoute()) {
    renderStaticInfoPage();
    return;
  }
  if (state.planStatus === "ready" && state.plan) {
    document.title = "Your Trip Plan | RouteMosaic";
    renderTripPlan();
    return;
  }
  if (state.planStatus === "unsupported" && state.planError) {
    renderUnsupportedPlan();
    return;
  }
  const trip = state.trip;
  document.title = state.activeStep === 4 ? "Review Your Trip | RouteMosaic" : "Plan a Trip | RouteMosaic";
  const travelerCount = travelerTotal(trip);
  const issueCount = visibleReviewIssues().length;
  const [heading, supportingText] = stepHeadings[state.activeStep - 1];
  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      <aside class="side">
        ${Brand()}
        <button class="saved-trips-button" data-action="toggleSavedTrips">Saved Trips</button>
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
    ${locationAutocompleteOverlay()}
    ${datePickerOverlay()}
    ${experienceOverlay()}
    ${foodSectionOverlay()}
    ${specialNeedsOverlay()}
    ${savedTripsDrawer()}
    ${globalFooter()}`;
  bind();
}

async function refreshProviderStatus({ rerender = true } = {}) {
  try {
    state.providerStatus = await routeMosaicApi.checkProviderHealth();
  } catch {
    state.providerStatus = {
      available: false,
      status: "temporarily unavailable",
      canGenerate: false,
      mode: "unavailable",
      placeProviderAvailable: false,
      routeProviderAvailable: false,
      weatherProviderAvailable: false,
      publicMessage: "Trip generation is temporarily unavailable. Please try again later.",
      checkedAt: new Date().toISOString()
    };
  }
  if (rerender) render();
}

function isStaticInfoRoute() {
  return ["/privacy", "/terms", "/travel-disclaimer", "/contact", "/saved-trips"].includes(window.location.pathname);
}

function BrandIcon() {
  return `<span class="brand-mark" aria-hidden="true"><img class="brand-icon" src="/public/favicon.svg?v=53" alt="" /></span>`;
}

function Brand() {
  return `<button type="button" class="brand" data-action="goHome" aria-label="Go to Trip Basics">${BrandIcon()}<div><strong>RouteMosaic</strong><small>Personalized trip builder</small></div></button>`;
}

function renderStaticInfoPage() {
  document.title = {
    "/privacy": "Privacy Policy | RouteMosaic",
    "/terms": "Terms of Use | RouteMosaic",
    "/travel-disclaimer": "Travel Disclaimer | RouteMosaic",
    "/contact": "Contact | RouteMosaic",
    "/saved-trips": "Saved Trips | RouteMosaic"
  }[window.location.pathname] || "RouteMosaic";
  document.querySelector("#app").innerHTML = `
    <main class="static-page">
      <a class="static-brand" href="/" data-link-home>${BrandIcon()}<strong>RouteMosaic</strong></a>
      ${staticPageContent(window.location.pathname)}
      ${globalFooter()}
    </main>`;
  bind();
}

function staticPageContent(path) {
  const effectiveDate = "July 25, 2026";
  if (path === "/privacy") return `<article class="static-card"><p class="eyebrow">Effective ${effectiveDate}</p><h1>Privacy Policy</h1>
    <p>RouteMosaic lets you enter trip dates, travelers, preferences, restrictions, notes, and generated itinerary details. At launch, there is no account system and saved trips are stored locally in your browser only when you choose Save.</p>
    <h2>Information You Enter</h2><p>You decide what trip details to provide. Avoid entering sensitive information that is not needed for travel planning.</p>
    <h2>Local Storage</h2><p>Saved trips are stored on this device in this browser. You can delete them from Saved Trips or by clearing browser site data.</p>
    <h2>Hosting And Logs</h2><p>Vercel and related infrastructure providers may process basic technical logs such as IP address, browser, device, pages requested, and error diagnostics. RouteMosaic does not sell personal information.</p>
    <h2>Cookies And Analytics</h2><p>No separate analytics product is configured in this codebase. If analytics are added later, this policy should be updated.</p>
    <h2>Children</h2><p>RouteMosaic is not directed to children. Adults should enter any child-travel details only as needed for planning.</p>
    <h2>Contact</h2><p>Privacy requests can be sent from the Contact page.</p></article>`;
  if (path === "/terms") return `<article class="static-card"><p class="eyebrow">Effective ${effectiveDate}</p><h1>Terms of Use</h1>
    <p>By using RouteMosaic, you agree to use it as an informational planning tool. RouteMosaic is not a travel agency, booking provider, safety authority, medical adviser, legal adviser, or accessibility certifier.</p>
    <h2>Your Responsibility</h2><p>You are responsible for verifying hours, prices, availability, reservations, accessibility, dietary safety, weather, travel conditions, laws, visas, health requirements, and safety information before booking or traveling.</p>
    <h2>No Guarantees</h2><p>Plans, budgets, travel times, routes, food suggestions, and advisories are estimates and may be wrong or incomplete.</p>
    <h2>Acceptable Use</h2><p>Do not misuse the service, attempt to disrupt it, or use generated content as a substitute for official or qualified advice.</p>
    <h2>Changes</h2><p>RouteMosaic may change, pause, or discontinue features. Coming Later controls are not promised release dates.</p></article>`;
  if (path === "/travel-disclaimer") return `<article class="static-card"><p class="eyebrow">Planning estimates only</p><h1>Travel Disclaimer</h1>
    <p>RouteMosaic provides planning estimates and suggestions. It does not verify live opening hours, live availability, reservations, accessibility, dietary safety, traffic, weather, or current prices.</p>
    <p>Drive times and distances are curated estimates. Budget ranges are estimates. Food suggestions are style and area recommendations, not confirmed restaurant availability. Accessibility details may change and must be confirmed directly with venues.</p>
    <p>Emergency, health, visa, legal, safety, and high-risk decisions require official sources or qualified professionals.</p></article>`;
  if (path === "/contact") return `<article class="static-card"><p class="eyebrow">Contact</p><h1>Contact RouteMosaic</h1>
    <p>For product feedback, bug reports, privacy requests, or general questions, email us. Clicking the link opens your email application.</p>
    <p><a class="primary-link" href="mailto:support@routemosaic.com?subject=RouteMosaic%20feedback">support@routemosaic.com</a></p>
    <ul><li>Product feedback</li><li>Bug report</li><li>Privacy request</li><li>General question</li></ul></article>`;
  return `<article class="static-card"><h1>Saved Trips</h1>${savedTripsList()}</article>`;
}

function globalFooter() {
  const year = new Date().getFullYear();
  return `<footer class="global-footer"><span>RouteMosaic © ${year}</span><span>Planning estimates only</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/travel-disclaimer">Travel Disclaimer</a><a href="/contact">Contact</a></footer>`;
}

function savedTripsDrawer() {
  if (!state.savedTripsOpen) return "";
  return `<div class="restriction-layer" data-action="toggleSavedTrips"><aside class="saved-trips-drawer" role="dialog" aria-label="Saved Trips">
    <div class="dialog-head"><div><h2>Saved Trips</h2><span>Saved locally in this browser</span></div><button class="icon-button" data-action="toggleSavedTrips" aria-label="Close saved trips">×</button></div>
    <p class="muted">Trips saved here are stored in this browser and may not appear on another device.</p>
    ${savedTripsList()}
  </aside></div>`;
}

function savedTripsList() {
  const records = readSavedTrips();
  if (!records.length) return `<p class="empty">No saved trips yet. Use Save and Exit to save a local draft.</p>`;
  return `<div class="saved-trip-list">${records.map((record) => `<article>
    <div><strong>${esc(record.name)}</strong><small>Updated ${esc(formatSavedDate(record.updatedAt))}</small></div>
    <div class="saved-trip-actions"><button data-action="openSavedTrip:${esc(record.id)}">Open</button><button data-action="duplicateSavedTrip:${esc(record.id)}">Duplicate</button><button data-action="renameSavedTrip:${esc(record.id)}">Rename</button><button data-action="deleteSavedTrip:${esc(record.id)}">Delete</button></div>
  </article>`).join("")}</div>`;
}

function formatSavedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderUnsupportedPlan() {
  const error = state.planError;
  document.querySelector("#app").innerHTML = `
    <div class="app-shell plan-shell">
      <aside class="side">
        ${Brand()}
        <button class="saved-trips-button" data-action="toggleSavedTrips">Saved Trips</button>
        <nav class="steps">${steps.map((step, index) => stepNavButton(step, index + 1)).join("")}</nav>
        ${SidebarScenicIllustration()}
        ${PlanningPrinciplesFooter()}
      </aside>
      <main class="wizard-main trip-plan-main">
        <section class="unsupported-plan panel">
          <p class="eyebrow">Destination data unavailable</p>
          <h1>Detailed planning is not ready for ${esc(error.destination || "this destination")} yet.</h1>
          <p>${esc(error.message)}</p>
          <div class="unsupported-actions">
            <button class="primary" data-action="editUnsupportedDestination">Edit Destination</button>
            <button data-action="returnToReview">Return to Review</button>
          </div>
          <div class="callout"><strong>Your wizard answers are preserved.</strong><p>RouteMosaic did not substitute another destination or fabricate destination-specific stops.</p></div>
        </section>
      </main>
    </div>`;
  bind();
}

function renderTripPlan() {
  const plan = state.plan;
  document.querySelector("#app").innerHTML = `
    <div class="app-shell plan-shell">
      <aside class="side">
        ${Brand()}
        <nav class="steps plan-side-nav">
          ${["Overview", "Itinerary", "Food", "Route", "Budget", "Advisories"].map((label) => `<button class="${ui.planSection === normalizePlanSection(label) ? "active" : ""}" data-action="planSection:${normalizePlanSection(label)}"><span>${planSectionIcon(label)}</span><strong>${esc(label)}</strong><small class="step-subtitle">${planSectionSubtitle(label)}</small></button>`).join("")}
        </nav>
        ${SidebarScenicIllustration()}
        ${PlanningPrinciplesFooter()}
      </aside>
      <main class="wizard-main trip-plan-main">
        <header class="plan-hero">
          <div>
            <p class="eyebrow">Generated Trip Plan</p>
            <h1>${esc(plan.overview.title)}</h1>
            <p>${esc(plan.overview.subtitle)}</p>
            ${mockPlanNotice()}
            ${state.planStale ? `<div class="stale-plan-warning" role="status"><strong>Preferences changed.</strong> This plan was generated from older preferences. Regenerate when you are ready.</div>` : ""}
          </div>
          <div class="plan-hero-actions">
            <button class="primary" data-action="regeneratePlan">Regenerate Plan</button>
            <button data-action="editPreferences">Edit Preferences</button>
            <button data-action="saveExit">Save Trip</button>
            <button data-action="openPrintOptions">Print / Save as PDF</button>
            <button disabled title="Coming Later">Export · Coming Later</button>
            <button disabled title="Coming Later">Share · Coming Later</button>
          </div>
        </header>
        <section class="plan-summary-strip" aria-label="Trip plan summary">
          ${planMetric("Destination", plan.destination, "mapPin")}
          ${planMetric("Dates", plan.overview.dateSummary, "calendar")}
          ${planMetric("Travelers", plan.overview.travelerSummary, "person")}
          ${planMetric("Pace", plan.overview.paceSummary, "scale")}
          ${planMetric("Budget", plan.overview.estimatedTotalCost, "dollar")}
        </section>
        <nav class="plan-tabs" aria-label="Trip plan sections">
          ${["overview", "itinerary", "food", "route", "budget", "advisories"].map((section) => `<button class="${ui.planSection === section ? "active" : ""}" data-action="planSection:${section}">${esc(titleCase(section))}</button>`).join("")}
        </nav>
        <div aria-live="polite" class="sr-only">${esc(ui.planAnnouncement)}</div>
        ${tripPlanSection()}
        ${planningDiagnosticsPanel()}
      </main>
    </div>
    ${planDialog()}
    ${savedTripsDrawer()}
    ${globalFooter()}`;
  bind();
}

function mockPlanNotice() {
  if (state.providerStatus?.mode !== "mock") return "";
  return `<div class="mock-plan-notice" role="status"><strong>Sample planning data.</strong> This itinerary was generated in demo mode from mock provider data. It is useful for testing the workflow, but it is not live destination research, current availability, live traffic, or verified worldwide coverage.</div>`;
}

function planningDiagnosticsPanel() {
  if (!new URLSearchParams(window.location.search).has("debugPlan")) return "";
  const metadata = state.plan?.generationMetadata || {};
  const input = state.plan?.preferencesSnapshot || {};
  return `<details class="planning-diagnostics">
    <summary>Planning diagnostics</summary>
    <pre>${esc(JSON.stringify({
      normalizedInput: {
        destination: input.destination,
        numberOfDays: input.numberOfDays,
        pace: input.pace,
        maxActivities: input.maxActivities,
        maxDrivingMinutes: input.maxDrivingMinutes,
        travelers: input.travelers
      },
      constraints: {
        food: state.plan.foodPlan.dietaryHandlingSummary,
        advisories: state.plan.advisories.map((item) => ({ severity: item.severity, category: item.category, title: item.title }))
      },
      metadata
    }, null, 2))}</pre>
  </details>`;
}

const PLAN_SECTION_RENDERERS = {
  overview: planOverviewSection,
  itinerary: planItinerarySection,
  food: planFoodSection,
  budget: planBudgetSection,
  advisories: planAdvisoriesSection,
  route: planRouteSection
};

function tripPlanSection() {
  const sections = Object.keys(PLAN_SECTION_RENDERERS);
  const firstIncluded = sections.find((section) => ui.printSections.has(section));
  return sections.map((section) => {
    const classes = ["plan-section-panel"];
    if (ui.planSection === section) classes.push("active");
    if (!ui.printSections.has(section)) classes.push("print-excluded");
    else if (section === firstIncluded) classes.push("print-first");
    return `<div class="${classes.join(" ")}" data-plan-section="${section}">${PLAN_SECTION_RENDERERS[section]()}</div>`;
  }).join("");
}

function normalizePlanSection(label) {
  return label.toLowerCase().replace(/[^a-z]+/g, "");
}

function planSectionIcon(label) {
  return { Overview: "✓", Itinerary: "2", Food: "3", Route: "4", Budget: "5", Advisories: "!" }[label] || "•";
}

function planSectionSubtitle(label) {
  return {
    Overview: "Trip payoff",
    Itinerary: "Day by day",
    Food: "Meals and safety",
    Route: "Regions and drives",
    Budget: "Cost ranges",
    Advisories: "Notes and conflicts"
  }[label] || "";
}

function planMetric(label, value, icon) {
  return `<article class="plan-metric"><span aria-hidden="true">${iconSvg(icon)}</span><div><small>${esc(label)}</small><strong>${esc(value)}</strong></div></article>`;
}

function planOverviewSection() {
  const plan = state.plan;
  const mapStops = plan.routeSummary?.mapStops;
  return `<section class="plan-section overview-section">
    ${mapStops && mapStops.length ? routeMapImageBlock(mapStops) : ""}
    <div class="plan-overview-grid">
      <article class="plan-payoff-card wide">
        <h2>Trip Overview</h2>
        <p>${esc(plan.overview.destinationSummary)}</p>
        <p><strong>${state.providerStatus?.mode === "mock" ? "Sample planning data, not live availability." : "Planning estimates—not live availability."}</strong> Verify current hours, availability, accessibility, menus, prices, weather, and travel conditions before booking or traveling. <a href="/travel-disclaimer">Read the travel disclaimer.</a></p>
        <div class="highlight-list">${plan.overview.planningHighlights.map((item) => `<span>${esc(item)}</span>`).join("")}</div>
      </article>
      ${plan.tripGuide ? `<article class="plan-payoff-card wide">
        <h3>Recommended Trip Shape</h3>
        ${tripShapeOptionCard(plan.tripGuide.tripShapeOptions?.[0])}
      </article>` : ""}
      ${plan.tripGuide ? `<article class="plan-payoff-card wide">
        <h3>Quick Reference</h3>
        <div class="guide-table quick-reference-table">
          <div><strong>Day</strong><strong>Route / Location</strong><strong>Sleep</strong><strong>Don’t Miss</strong><strong>Spend</strong></div>
          ${plan.tripGuide.quickReference.map((row) => `<div><span>${esc(`Day ${row.dayNumber}`)}<small>${esc(row.date)}</small></span><span>${esc(row.routeOrLocation)}</span><span>${esc(row.hotelOrBase)}</span><span>${esc(row.dontMiss)}</span><span>${esc(row.expectedSpend)}</span></div>`).join("")}
        </div>
      </article>` : ""}
      <article class="plan-payoff-card"><h3>Activities</h3><strong>${plan.overview.totalScheduledActivities}</strong><p>${esc(formatMinutes(plan.overview.totalEstimatedActivityMinutes))} scheduled activity time</p></article>
      <article class="plan-payoff-card"><h3>Driving</h3><strong>${esc(formatMinutes(plan.overview.totalEstimatedDriveMinutes))}</strong><p>Estimated local driving across the trip</p></article>
      <article class="plan-payoff-card"><h3>Budget</h3><strong>${esc(plan.overview.estimatedTotalCost)}</strong><p>${esc(plan.overview.estimatedCostPerPerson)} per person estimate</p></article>
      <article class="plan-payoff-card wide">
        <h3>Preferences Applied</h3>
        <p><strong>Diet:</strong> ${esc(plan.foodPlan.dietaryHandlingSummary)}</p>
        <p><strong>Accessibility:</strong> ${esc(state.plan.preferencesSnapshot ? planAccessibilitySummary() : "No special needs entered.")}</p>
      </article>
      <article class="plan-payoff-card wide">
        <h3>Suggested Hotel Base</h3>
        <p><strong>${esc(plan.hotelBase.primary)}</strong></p>
        <p>${esc(plan.hotelBase.reason)}</p>
        <p><strong>Alternatives:</strong> ${esc(plan.hotelBase.alternatives.join(", "))}</p>
        <p><strong>Tradeoff:</strong> ${esc(plan.hotelBase.tradeoffs)} ${esc(plan.hotelBase.splitStaySuggestion)}</p>
      </article>
      ${plan.tripGuide ? `<article class="plan-payoff-card wide">
        <h3>Reservations, Offline Maps, and Packing</h3>
        <div class="guide-action-grid">
          <div><h4>Must Confirm</h4>${plan.tripGuide.reservationsToComplete.slice(0, 5).map((item) => `<p><strong>${esc(item.item)}</strong><small>${esc(item.timing)} · ${esc(item.priority)}</small></p>`).join("")}</div>
          <div><h4>Download Offline</h4>${plan.tripGuide.offlineMaps.slice(0, 5).map((item) => `<p><strong>${esc(item.region)}</strong><small>${esc(item.reason)}</small></p>`).join("")}</div>
          <div><h4>Pack</h4>${plan.tripGuide.packingList.slice(0, 4).map((group) => `<p><strong>${esc(group.category)}</strong><small>${esc(group.items.join(", "))}</small></p>`).join("")}</div>
        </div>
      </article>` : ""}
    </div>
    <div class="day-preview-grid">${plan.days.map((day) => `<button class="day-preview-card" data-action="jumpToDay:${day.id}"><span>Day ${day.dayNumber}</span><strong>${esc(day.title)}</strong><small>${esc(day.theme)} · ${esc(day.dailyBudget.label)}</small></button>`).join("")}</div>
  </section>`;
}

function tripShapeOptionCard(option) {
  if (!option) return `<p>No trip-shape option is available for this plan.</p>`;
  return `<div class="trip-shape-card">
    <div>
      <span class="badge">${esc(option.structureType)}</span>
      <p><strong>Route:</strong> ${esc(option.routeSequence.join(" → "))}</p>
      <p><strong>Sleep:</strong> ${esc(option.overnightBases.map((base) => `${base.base} (${base.nights} night${base.nights === 1 ? "" : "s"})`).join(", "))}</p>
    </div>
    <div>
      <p><strong>Hotel changes:</strong> ${esc(String(option.hotelChanges))}</p>
      <p><strong>Longest drive:</strong> ${esc(option.longestDrivingDay)}</p>
      <p><strong>Fit:</strong> ${esc(option.whyItFitsUser)}</p>
    </div>
  </div>`;
}

function planAccessibilitySummary() {
  const text = state.plan.advisories.find((item) => item.category === "accessibility")?.message;
  return text || "No individual accessibility restriction was specified; activity notes still include walking and access assumptions.";
}

function planItinerarySection() {
  return `<section class="plan-section itinerary-section">
    <div class="plan-section-head"><div><h2>Day-by-day Itinerary</h2><p>Morning, afternoon, meals, travel estimates, backups, and editable schedule items.</p></div><button data-action="openCustomStop">Add Custom Stop</button></div>
    ${state.plan.days.map((day) => dayCard(day)).join("")}
  </section>`;
}

function dayCard(day) {
  return `<article class="itinerary-day" id="${esc(day.id)}">
    <div class="day-card-head">
      <div><p class="eyebrow">Day ${day.dayNumber} · ${esc(formatDateRange(day.date, day.date))}</p><h3>${esc(day.title)}</h3><p>${esc(day.summary)}</p></div>
      <div class="day-actions">
        <span class="badge">${esc(day.dailyBudget.label)}</span>
        <span class="badge">${esc(formatMinutes(day.dailyDriveMinutes))} drive</span>
        ${day.dayArchetype ? `<span class="badge">${esc(day.dayArchetype)}</span>` : ""}
        <button data-action="toggleDayLock:${esc(day.id)}">${day.locked ? "Unlock Day" : "Lock Day"}</button>
        <button data-action="regenerateDay:${esc(day.id)}" ${day.locked ? "disabled" : ""}>Regenerate Day</button>
      </div>
    </div>
    ${day.todaysTopFive ? `<div class="top-five"><strong>Today’s Top 5</strong><span>${esc(day.todaysTopFive)}</span></div>` : ""}
    <div class="weather-note"><strong>Weather note:</strong> ${esc(day.weatherPlanningNote)}</div>
    ${day.prioritySections ? priorityGuide(day) : ""}
    ${day.warnings.length ? `<div class="warning-list">${day.warnings.map((warning) => `<p>${esc(warning)}</p>`).join("")}</div>` : ""}
    <ol class="timeline">${day.scheduleItems.map((item) => timelineItem(item)).join("")}</ol>
    ${timelinePrintTable(day)}
    ${day.dailyFoodPlan ? dailyFoodGuide(day) : ""}
    ${day.expectedSpending ? dailyExecutionGuide(day) : ""}
    <div class="backup-options"><h4>Backup options</h4>${day.backupOptions.length ? day.backupOptions.map((backup) => `<article><strong>${esc(backup.title)}</strong><p>${esc(backup.reason)}</p><small>${esc(formatMinutes(backup.estimatedDurationMinutes))} · ${esc(backup.indoorOutdoor)} · ${esc(backup.accessibilityNotes)}</small></article>`).join("") : `<p>No same-region backup is available for this day.</p>`}</div>
    <p class="reasoning-summary">${esc(day.generationReasoningSummary)}</p>
  </article>`;
}

function priorityGuide(day) {
  return `<div class="priority-guide-grid">
    ${priorityColumn("Don’t Miss", day.prioritySections.dontMiss)}
    ${priorityColumn("Worth Doing", day.prioritySections.worthDoing)}
    ${priorityColumn("Bonus Stops", day.prioritySections.bonusStops)}
  </div>`;
}

function priorityColumn(title, rows) {
  return `<section class="priority-column"><h4>${esc(title)}</h4>${rows.length ? rows.map((row) => `<article><strong>${esc(row.activity)}</strong><span>${esc(row.preferredTime)} · ${esc(row.duration)} · ${esc(row.cost)}</span><small>${esc(row.routeRelevance)} ${row.bookingRequired === "Yes" ? "Book/confirm." : ""} ${row.offlineMapRequired === "Yes" ? "Download map." : ""}</small></article>`).join("") : `<p>No items in this tier.</p>`}</section>`;
}

function dailyFoodGuide(day) {
  return `<section class="daily-guide-panel"><h4>Food</h4><div class="guide-table meal-guide-table">
    <div><strong>Meal</strong><strong>Primary</strong><strong>Backup</strong><strong>Cost</strong><strong>Notes</strong></div>
    ${day.dailyFoodPlan.map((meal) => `<div><span>${esc(meal.meal)}<small>${esc(meal.time)}</small></span><span>${esc(meal.primaryOption)}</span><span>${esc(meal.backupOption)}</span><span>${esc(meal.cost)}</span><span>${esc(meal.reservationGuidance)}</span></div>`).join("")}
  </div></section>`;
}

function dailyExecutionGuide(day) {
  return `<section class="daily-guide-panel execution-guide">
    <div><h4>Expected Spending</h4><p>${esc(day.expectedSpending.totalRange)}</p><small>Food ${esc(day.expectedSpending.food)} · Activities ${esc(day.expectedSpending.activities)} · Transit ${esc(day.expectedSpending.transit)}</small></div>
    <div><h4>Quick Tips</h4>${day.quickTips.map((tip) => `<p>${esc(tip)}</p>`).join("")}</div>
    <div><h4>Tomorrow Prep</h4>${day.tomorrowPrep.map((tip) => `<p>${esc(tip)}</p>`).join("")}</div>
    <div><h4>Delay Strategy</h4><p><strong>Keep:</strong> ${esc(day.delayStrategy.keep)}</p><p><strong>Cut first:</strong> ${esc(day.delayStrategy.cutFirst)}</p><p>${esc(day.delayStrategy.backupTrigger)}</p></div>
  </section>`;
}

function timelineItem(item) {
  return `<li class="timeline-item item-${esc(item.type)} ${item.locked ? "locked" : ""} ${item.mustDo ? "must-do" : ""}">
    <div class="timeline-time"><strong>${esc(item.startTime)}</strong><span>${esc(item.endTime)}</span></div>
    <div class="timeline-dot" aria-hidden="true">${timelineIcon(item.type)}</div>
    <div class="timeline-body">
      <div class="timeline-title-row"><h4>${esc(item.title)}</h4><span>${esc(titleCase(item.type))}</span></div>
      <p>${esc(item.description)}</p>
      <div class="timeline-meta">
        <span>${esc(formatMinutes(item.durationMinutes))}</span>
        ${item.locationLabel ? `<span>${esc(item.locationLabel)}</span>` : ""}
        ${item.estimatedCostPerPerson ? `<span>${esc(moneyRangeDisplay(item.estimatedCostPerPerson.low, item.estimatedCostPerPerson.high))} pp est.</span>` : ""}
        ${item.travelFromPrevious ? `<span>${esc(item.travelFromPrevious.note)}</span>` : ""}
        ${item.reservationRecommended ? `<span>Reservation recommended</span>` : ""}
        ${item.customItem ? `<span>Custom</span>` : ""}
      </div>
      ${item.accessibilityNotes ? `<small class="timeline-note">${esc(item.accessibilityNotes)}</small>` : ""}
      ${item.dietaryNotes ? `<small class="timeline-note">${esc(item.dietaryNotes)}</small>` : ""}
      <div class="item-actions">
        ${item.type === "activity" ? `<button data-action="openReplace:${esc(item.id)}">Replace</button><button data-action="toggleMustDo:${esc(item.id)}">${item.mustDo ? "Unset Must Do" : "Mark Must Do"}</button>` : ""}
        ${item.replaceable ? `<button data-action="openMove:${esc(item.id)}">Move</button><button data-action="removeItem:${esc(item.id)}">Remove</button>` : ""}
        <button data-action="toggleItemLock:${esc(item.id)}">${item.locked ? "Unlock" : "Lock"}</button>
      </div>
    </div>
  </li>`;
}

// Print-only compact alternative to the interactive .timeline list above --
// hidden on screen (that list keeps its Replace/Move/Lock buttons and full
// descriptions), shown only in print via CSS, matching a printed-guide
// density (time/item/duration/cost per row) instead of a card per item.
function timelinePrintTable(day) {
  return `<table class="timeline-print-table">
    <thead><tr><th>Time</th><th>Plan</th><th>Duration</th><th>Cost</th></tr></thead>
    <tbody>${day.scheduleItems.map((item) => timelineTableRow(item)).join("")}</tbody>
  </table>`;
}

function timelineTableRow(item) {
  const cost = item.estimatedCostPerPerson ? moneyRangeDisplay(item.estimatedCostPerPerson.low, item.estimatedCostPerPerson.high) : "—";
  return `<tr><td>${esc(item.startTime)}</td><td>${timelineIcon(item.type)} ${esc(item.title)}</td><td>${esc(formatMinutes(item.durationMinutes))}</td><td>${cost}</td></tr>`;
}

function timelineIcon(type) {
  return { breakfast: "☀", lunch: "☀", "coffee-break": "☕", dinner: "☾", activity: "◆", travel: "→", freeTime: "⋯", rest: "◌", evening: "★", note: "i" }[type] || "•";
}

function planFoodSection() {
  const food = state.plan.foodPlan;
  return `<section class="plan-section food-plan-section">
    <div class="plan-section-head"><div><h2>Food Plan</h2><p>${esc(food.dailyMealSummary)}</p></div><button data-action="regenerateMeals">Regenerate Meals</button></div>
    <article class="plan-payoff-card wide"><h3>Dietary Handling</h3><p>${esc(food.dietaryHandlingSummary)}</p><p><strong>Cuisine coverage:</strong> ${esc(food.cuisineCoverage)}</p><p><strong>Reservations:</strong> ${esc(food.reservationNotes)}</p></article>
    <div class="meal-day-grid">${food.mealRecommendations.map((day) => `<article class="meal-day"><h3>Day ${day.dayNumber}</h3>${day.meals.map((meal) => `<p><strong>${esc(titleCase(meal.type))} · ${esc(meal.time)}</strong><br>${esc(meal.recommendation)}<br><small>${esc(moneyRangeDisplay(meal.estimatedCostPerPerson.low, meal.estimatedCostPerPerson.high))} pp estimate</small></p>`).join("")}</article>`).join("")}</div>
    <article class="plan-payoff-card wide"><h3>Food Areas</h3><div class="food-area-grid">${food.foodAreas.map((area) => `<span><strong>${esc(area.name)}</strong><small>${esc(area.cuisines.slice(0, 4).join(", "))}</small></span>`).join("")}</div></article>
  </section>`;
}

function lodgingNightGroups(nightlyPlan) {
  const groups = [];
  for (const night of nightlyPlan) {
    const last = groups[groups.length - 1];
    if (last && last.sleepArea === night.sleepArea && last.whyThisBase === night.whyThisBase) {
      last.endNight = night.night;
    } else {
      groups.push({ startNight: night.night, endNight: night.night, sleepArea: night.sleepArea, whyThisBase: night.whyThisBase });
    }
  }
  return groups;
}

function planRouteSection() {
  const route = state.plan.routeSummary;
  return `<section class="plan-section route-plan-section">
    <div class="plan-section-head"><div><h2>Route Overview</h2><p>${esc(route.routeLogicExplanation)}</p></div><span class="badge">${esc(formatMinutes(route.totalEstimatedDriveMinutes))} estimated drive</span></div>
    <div class="route-schematic">${route.mapPlaceholderData.map((day) => `<article><span>Day ${day.dayNumber}</span><strong>${esc(day.region)}</strong><small>${esc(day.stops.slice(0, 3).join(" → "))}</small></article>`).join("")}</div>
    <article class="plan-payoff-card wide"><h3>Major Stop Sequence</h3><p>${esc(route.orderedStops.join(" → "))}</p><p>${esc(route.trafficDisclaimer)}</p><p>Estimated distance: ${route.totalEstimatedDistanceMiles} miles.</p></article>
    ${state.plan.tripGuide ? `<article class="plan-payoff-card wide trip-shape-options-card"><h3>Trip Shape Options Considered</h3><div class="shape-options-list">${state.plan.tripGuide.tripShapeOptions.map((option) => tripShapeOptionCard(option)).join("")}</div></article>` : ""}
    ${state.plan.tripGuide ? `<article class="plan-payoff-card wide"><h3>Lodging Logic</h3><p><strong>${esc(state.plan.tripGuide.lodgingPlan.recommendedBase)}</strong> · ${esc(String(state.plan.tripGuide.lodgingPlan.nights))} nights</p><div class="lodging-night-grid">${lodgingNightGroups(state.plan.tripGuide.lodgingPlan.nightlyPlan).map((group) => `<span><strong>${esc(group.startNight === group.endNight ? `Night ${group.startNight}` : `Nights ${group.startNight}-${group.endNight}`)}</strong><small>${esc(group.sleepArea)} · ${esc(group.whyThisBase)}</small></span>`).join("")}</div></article>` : ""}
  </section>`;
}

function routeMapImageBlock(mapStops) {
  const stopsParam = encodeURIComponent(JSON.stringify(mapStops.map((stop) => ({ label: stop.label, lat: stop.lat, lng: stop.lng }))));
  return `<article class="plan-payoff-card wide route-map-card">
    <h3>Route Map</h3>
    <img class="route-map-image" src="/api/route-map?stops=${stopsParam}" alt="Map of the route with day-labeled stops" loading="eager" onerror="this.closest('.route-map-card')?.classList.add('route-map-error')">
    <div class="route-map-legend">${mapStops.map((stop, index) => `<span><strong>${index + 1}</strong>${esc(stop.label)} · ${esc(stop.regionName)}</span>`).join("")}</div>
  </article>`;
}

function planBudgetSection() {
  const budget = state.plan.budgetSummary;
  const max = Math.max(...budget.categories.map((item) => item.high), 1);
  return `<section class="plan-section budget-plan-section">
    <div class="plan-section-head"><div><h2>Budget Estimate</h2><p>${esc(moneyRangeDisplay(budget.totalLow, budget.totalHigh))} total · ${esc(moneyRangeDisplay(budget.perPersonLow, budget.perPersonHigh))} per person</p></div><span class="badge">${esc(budget.currency)}</span></div>
    <div class="budget-bars">${budget.categories.map((item) => `<article><div><strong>${esc(item.category)}</strong><span>${esc(moneyRangeDisplay(item.low, item.high))}</span></div><i style="--bar:${Math.max(8, Math.round((item.high / max) * 100))}%"></i><p>${esc(item.description)}</p></article>`).join("")}</div>
    <article class="plan-payoff-card wide"><h3>Assumptions and Exclusions</h3><p><strong>Assumptions:</strong> ${esc(budget.assumptions.join(" "))}</p><p><strong>Excluded:</strong> ${esc(budget.excludedCosts.join(", "))}</p></article>
  </section>`;
}

function planAdvisoriesSection() {
  const grouped = groupAdvisories(state.plan.advisories);
  return `<section class="plan-section advisories-plan-section">
    <div class="plan-section-head"><div><h2>Issues and Advisories</h2><p>Practical notes, conflicts, and planning assumptions.</p></div><span class="badge">${state.plan.advisories.length || "No"} notes</span></div>
    ${Object.entries(grouped).map(([severity, items]) => `<section class="advisory-group"><h3>${esc(titleCase(severity))}</h3>${items.length ? items.map((item) => `<article class="advisory-card ${esc(item.severity)}"><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(item.resolutionSuggestion)}</small></article>`).join("") : `<p class="empty">No ${esc(severity)} advisories.</p>`}</section>`).join("")}
  </section>`;
}

function groupAdvisories(advisories) {
  return {
    blocking: advisories.filter((item) => item.severity === "blocking"),
    conflict: advisories.filter((item) => item.severity === "conflict"),
    caution: advisories.filter((item) => item.severity === "caution"),
    info: advisories.filter((item) => item.severity === "info")
  };
}

function planDialog() {
  if (!ui.planDialog) return "";
  if (ui.planDialog === "replace") return replaceDialog();
  if (ui.planDialog === "move") return moveDialog();
  if (ui.planDialog === "custom") return customStopDialog();
  if (ui.planDialog === "print") return printOptionsDialog();
  return "";
}

const PRINT_SECTION_LABELS = {
  overview: "Overview",
  itinerary: "Itinerary",
  food: "Food",
  route: "Route",
  budget: "Budget",
  advisories: "Advisories"
};

function printOptionsDialog() {
  return `<div class="restriction-layer" data-action="closePlanDialog"><div class="choice-panel plan-dialog" role="dialog" aria-label="Print options">
    <div class="dialog-head"><div><h2>Print / Save as PDF</h2><span>Choose which sections to include -- fewer sections make a shorter PDF.</span></div><button class="icon-button" data-action="closePlanDialog" aria-label="Close">×</button></div>
    <div class="print-options-grid">${Object.entries(PRINT_SECTION_LABELS).map(([key, label]) => `<label class="print-option-item"><input type="checkbox" data-action="togglePrintSection:${key}" ${ui.printSections.has(key) ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>
    <div class="restriction-actions"><button data-action="closePlanDialog">Cancel</button><button class="primary" data-action="confirmPrint" ${ui.printSections.size ? "" : "disabled"}>Print</button></div>
  </div></div>`;
}

function replaceDialog() {
  const alternatives = compatibleAlternatives(state.plan, ui.planDialogItemId);
  return `<div class="restriction-layer" data-action="closePlanDialog"><div class="choice-panel plan-dialog" role="dialog" aria-label="Replace activity">
    <div class="dialog-head"><div><h2>Replace Activity</h2><span>${alternatives.length} compatible options</span></div><button class="icon-button" data-action="closePlanDialog" aria-label="Close">×</button></div>
    <div class="alternative-list">${alternatives.map((item) => `<button data-action="replaceWith:${esc(ui.planDialogItemId)}:${esc(item.placeId)}"><strong>${esc(item.group)} · ${esc(item.title)}</strong><span>${esc(item.description)}</span><small>${esc(item.region)} · ${esc(item.category)} · ${esc(formatMinutes(item.duration))} · ${esc(item.cost)} · ${esc(item.indoorOutdoor)} · ${esc(item.accessibilityFit)} · ${esc(item.routeImpact)} · ${esc(item.reason)}</small></button>`).join("") || `<p>No compatible alternatives found for this item.</p>`}</div>
  </div></div>`;
}

function moveDialog() {
  return `<div class="restriction-layer" data-action="closePlanDialog"><div class="choice-panel plan-dialog" role="dialog" aria-label="Move activity">
    <div class="dialog-head"><div><h2>Move Activity</h2><span>Recalculate timing after move</span></div><button class="icon-button" data-action="closePlanDialog" aria-label="Close">×</button></div>
    <div class="move-grid">
      <button data-action="moveItem:${esc(ui.planDialogItemId)}:earlier">Earlier same day</button>
      <button data-action="moveItem:${esc(ui.planDialogItemId)}:later">Later same day</button>
      <button data-action="moveItem:${esc(ui.planDialogItemId)}:prevDay">Previous day</button>
      <button data-action="moveItem:${esc(ui.planDialogItemId)}:nextDay">Next day</button>
    </div>
  </div></div>`;
}

function customStopDialog() {
  const draft = ui.customStopDraft || defaultCustomStopDraft();
  return `<div class="restriction-layer" data-action="closePlanDialog"><div class="choice-panel plan-dialog" role="dialog" aria-label="Add custom stop">
    <div class="dialog-head"><div><h2>Add Custom Stop</h2><span>Custom stops participate in timing and budget estimates.</span></div><button class="icon-button" data-action="closePlanDialog" aria-label="Close">×</button></div>
    <div class="details-editor">
      <label>Title ${input("customStop.title", draft.title, "Title")}</label>
      <label>Day ${select("customStop.dayNumber", String(draft.dayNumber), state.plan.days.map((day) => String(day.dayNumber)), "Day")}</label>
      <label>Start Time ${input("customStop.startTime", draft.startTime, "Start Time")}</label>
      <label>Duration Minutes ${input("customStop.durationMinutes", draft.durationMinutes, "Duration Minutes", "number", { min: 0, max: 720 })}</label>
      <label>Type ${select("customStop.type", draft.type, ["activity", "breakfast", "lunch", "dinner", "evening", "freeTime", "note"], "Type")}</label>
      <label>Location ${input("customStop.locationLabel", draft.locationLabel, "Location")}</label>
      <label>Cost per Person ${input("customStop.cost", draft.cost, "Cost per Person", "number", { min: 0, max: 5000 })}</label>
      <label>Indoor / Outdoor ${select("customStop.indoorOutdoor", draft.indoorOutdoor, ["indoor", "outdoor", "mixed"], "Indoor or outdoor")}</label>
      <label>Notes ${textarea("customStop.notes", draft.notes, "Notes")}</label>
      <label class="small-chip">${checkbox("customStop.mustDo", draft.mustDo, "Must Do")} Must Do</label>
      <label class="small-chip">${checkbox("customStop.locked", draft.locked, "Lock")} Lock</label>
    </div>
    <div class="restriction-actions"><button data-action="closePlanDialog">Cancel</button><button class="primary" data-action="saveCustomStop">Add Stop</button></div>
  </div></div>`;
}

function defaultCustomStopDraft() {
  return { title: "", dayNumber: 1, startTime: "3:00 PM", durationMinutes: 60, type: "activity", locationLabel: "", notes: "", cost: 0, indoorOutdoor: "mixed", mustDo: false, locked: false };
}

function formatMinutes(minutes) {
  const value = Number(minutes || 0);
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (!hours) return `${mins} min`;
  return `${hours} hr${hours === 1 ? "" : "s"}${mins ? ` ${mins} min` : ""}`;
}

function moneyRangeDisplay(low, high) {
  return `$${Number(low || 0).toLocaleString()}-$${Number(high || 0).toLocaleString()}`;
}

function PageHeaderIllustration(stepNumber) {
  return [
    TripBasicsHeaderGraphic,
    TripStyleHeaderGraphic,
    FoodEveningsHeaderGraphic,
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

function TripStyleHeaderGraphic() {
  return headerImage("src/assets/header-trip-style.png", "Mountain exploration route illustration", "trip-style-graphic");
}

function FoodEveningsHeaderGraphic() {
  return headerImage("src/assets/header-food-evenings.png", "Waterfront dinner at sunset illustration", "food-evenings-graphic");
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
  const action = label === "Issues" ? ` data-action="toggleWarnings" role="button" tabindex="0"`
    : label === "Preferences" ? ` data-action="togglePreferences" role="button" tabindex="0"`
    : label === "Travelers" ? ` data-step="1" role="button" tabindex="0"`
    : label === "Dates" ? ` data-step="1" role="button" tabindex="0"`
    : "";
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
    route: `<svg viewBox="0 0 24 24"><path d="M5 6c4 0 4 5 8 5s4 7 8 7"/><circle cx="5" cy="6" r="2.5"/><path d="M19 15l2 3-3 2"/></svg>`,
    sparkle: `<svg viewBox="0 0 24 24"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 4l.7 1.8L8 6.5l-2.3.7L5 9l-.7-1.8L2 6.5l2.3-.7z"/></svg>`,
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
    briefcase: `<svg viewBox="0 0 24 24"><path d="M6 8V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v2"/><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8v12M15 8v12M3 13h18"/></svg>`,
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
  const facts = tripSnapshotFacts(trip, issueCount);
  return `<section class="trip-snapshot ${facts.some((item) => item.real) ? "has-facts" : "empty"}" aria-label="Trip Snapshot">
    <div><p class="eyebrow">Trip Snapshot</p><strong>${facts.some((item) => item.real) ? "Your trip is taking shape" : "Start planning in three simple moves"}</strong></div>
    <div class="trip-snapshot-items">${facts.map((item) => snapshotItem(item)).join("")}</div>
  </section>`;
}

function tripSnapshotFacts(trip, issueCount) {
  const facts = [];
  const origin = String(trip.from || "").trim();
  const destination = String(trip.destination || "").trim();
  if (origin && destination) {
    facts.push({ icon: "mapPin", label: "Route", value: `${normalizePlaceName(trip.fromDisplay || trip.from)} → ${normalizePlaceName(trip.destinationDisplay || trip.destination)}`, real: true });
  } else if (origin || destination) {
    facts.push({ icon: "mapPin", label: origin ? "Origin added" : "Destination added", value: normalizePlaceName(origin || destination), real: true });
  }
  if (trip.startDate && trip.endDate && Number(trip.days)) {
    facts.push({ icon: "calendar", label: "Dates", value: `${formatShortDateRange(trip.startDate, trip.endDate)} · ${trip.days} day${Number(trip.days) === 1 ? "" : "s"}`, real: true });
  }
  const structure = tripStructureOptions.find((option) => option.value === trip.routePreferences?.tripStructure);
  if (structure && facts.length) facts.push({ icon: "route", label: "Trip shape", value: structure.label, real: true });
  const preferenceCount = countUniqueActivePreferences(trip);
  if (preferenceCount > 0) facts.push({ icon: "heart", label: "Preferences", value: `${preferenceCount} selected`, real: true });
  if (issueCount > 0) facts.push({ icon: "warning", label: "Needs attention", value: `${issueCount} issue${issueCount === 1 ? "" : "s"}`, real: true });
  if (facts.length) return facts.slice(0, 4);
  return [
    { icon: "mapPin", label: "Start with where you're going", value: "Origin and destination", real: false },
    { icon: "route", label: "Choose your trip shape", value: "One city, day trips, or multi-city", real: false },
    { icon: "heart", label: "Add what matters most", value: "Must-dos, pace, food, and avoidances", real: false }
  ];
}

function snapshotItem(item) {
  return `<article class="snapshot-item ${item.real ? "real" : "empty"}" title="${esc(item.label)}: ${esc(item.value)}">
    <span aria-hidden="true">${iconSvg(item.icon)}</span>
    <div><strong>${esc(item.label)}</strong><small>${esc(item.value)}</small></div>
  </article>`;
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
  return `<section class="panel warning-tray">${stepIssueTable(visibleReviewIssues())}</section>`;
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
  return reviewIssues().filter((issue) => visibleBasics.has(issue.issue));
}

function visibleTripBasicsIssues() {
  return [...tripBasicsIssues(state.trip), ...locationVerificationIssues(state.trip)].filter((issue) => {
    if (!issue.blocking) return true;
    const locationField = issue.field === "trip.from" ? "from" : issue.field === "trip.destination" ? "destination" : "";
    return ui.basicsSubmitAttempted || ui.touchedBasicsFields.has(issue.field) || (locationField && ui.touchedBasicsFields.has(locationField));
  });
}

function blockingValidationIssues() {
  return reviewIssues().filter((issue) => issue.blocking).map((issue) => issue.issue);
}

// Builds a toast message that names the specific problem(s) instead of a
// generic "resolve issues" -- shows every message when there are a few,
// caps the list and adds a "+N more" tail once it would otherwise get long.
function describeBlockingIssues(messages, prefix = "") {
  if (!messages.length) return "";
  if (messages.length === 1) return `${prefix}${messages[0]}`;
  const shown = messages.slice(0, 3);
  const remainder = messages.length - shown.length;
  return `${prefix}${messages.length} issues to resolve: ${shown.join(" ")}${remainder > 0 ? ` (+${remainder} more)` : ""}`;
}

function routeRelevantField(path) {
  return [
    "trip.from",
    "trip.destination",
    "trip.destinationRegions",
    "trip.days",
    "trip.startDate",
    "trip.endDate",
    "trip.transportation"
  ].includes(path) || path.startsWith("trip.routePreferences.");
}

function stepNavButton(step, stepNumber) {
  const complete = stepNumber < state.activeStep || (stepNumber === 1 && !tripBasicsIssues(state.trip).some((issue) => issue.blocking));
  const futureDisabled = stepNumber > 1 && tripBasicsIssues(state.trip).some((issue) => issue.blocking);
  const ownStepIssueCount = stepNumber > 1 ? reviewIssues().filter((issue) => issue.blocking && (issue.owningStep || 1) === stepNumber).length : 0;
  const classes = [state.activeStep === stepNumber ? "active" : "", complete ? "complete" : "", ownStepIssueCount ? "has-issue" : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" data-step="${stepNumber}" ${state.activeStep === stepNumber ? `aria-current="step"` : ""} ${futureDisabled ? "disabled" : ""}>
    <span>${complete ? "✓" : stepNumber}</span>
    <strong>${esc(step)}</strong>
    <small class="step-subtitle">${esc(stepSubtitles[stepNumber - 1])}</small>
    ${ownStepIssueCount ? `<em class="step-issue-badge" aria-label="${ownStepIssueCount} issue${ownStepIssueCount === 1 ? "" : "s"} on this step">${ownStepIssueCount}</em>` : ""}
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
  if (state.activeStep === 2) return styleStep();
  if (state.activeStep === 3) return foodStep();
  if (state.activeStep === 4 && routeRecommendationRequired(state.trip) && !approvedRouteStillValid(state.trip)) return routeRecommendationStep();
  return reviewStep();
}

const totalBudgetOptions = [
  "$1,000-$1,500", "$1,500-$2,000", "$2,000-$2,500", "$2,500-$3,000",
  "$3,000-$3,500", "$3,500-$4,000", "$4,000-$4,500", "$4,500-$5,000",
  "$5,000-$5,500", "$5,500-$6,000", "$6,000-$6,500", "$6,500-$7,000",
  "$7,000+"
];

const nightlyLodgingBudgetOptions = [
  "$50-$100", "$100-$150", "$150-$200", "$200-$250", "$250-$300",
  "$300-$350", "$350-$400", "$400-$450", "$450-$500", "$500-$550",
  "$550-$600", "$600-$650", "$650-$700", "$700-$750", "$750+"
];

function basicsStep() {
  const trip = state.trip;
  const issues = visibleTripBasicsIssues();
  const blocking = issues.some((issue) => issue.blocking);
  const status = stepStatus(trip, issues);
  const fieldIssues = new Map(issues.filter((issue) => issue.blocking && issue.field).map((issue) => [issue.field, issue]));
  return `<div class="trip-basics-experience">
    <section class="trip-basics-status-strip">
      <div><p class="eyebrow">Step 1</p><h2>Trip Basics</h2></div>${badge(status)}
    </section>
    ${sampleTripPanel(trip)}
    <section class="trip-essentials-section step-1-zone" aria-label="Trip Essentials">
      <div class="zone-head"><span aria-hidden="true">${iconSvg("mapPin")}</span><div><p class="eyebrow">Trip Essentials</p><h2>Tell us where and when.</h2></div></div>
      <div class="form-grid basics-grid">
        ${locationField("from", "Traveling From", trip.from, trip.fromLocation, trip.fromVerificationStatus, fieldIssues.get("trip.from"))}
        ${locationField("destination", "Destination", trip.destination, trip.destinationLocation, trip.destinationVerificationStatus, fieldIssues.get("trip.destination"))}
        ${fieldShell("Transportation", select("trip.transportation", trip.transportation, optionSets.transportation, "Transportation"), "Used for route feasibility.")}
        ${fieldShell("Start Date", dateTimeField("trip.startDate", trip.startDate, "Start Date", "trip.routePreferences.arrivalTime", trip.routePreferences?.arrivalTime || "08:00", "Arrival Time"), "First travel day and arrival time (defaults to 8:00 AM).", fieldIssues.get("trip.startDate"))}
        ${fieldShell("End Date", dateTimeField("trip.endDate", trip.endDate, "End Date", "trip.routePreferences.departureTime", trip.routePreferences?.departureTime || "20:00", "Departure Time"), "Last travel day and departure time (defaults to 8:00 PM); trip length is calculated from the two dates.", fieldIssues.get("trip.endDate"))}
        ${fieldShell("Trip Style", select("trip.budget.style", trip.budget.style === "Not Specified" ? "Moderate" : trip.budget.style, ["Budget", "Moderate", "Premium", "Luxury", "Custom amount"], "Trip Style"), "Sets the overall spending tier.")}
        ${fieldShell("Total Budget", select("trip.budget.total", trip.budget.total, totalBudgetOptions, "Total Budget"), trip.budget.style === "Custom amount" ? "Required for a custom budget." : "Optional; picking a range improves itinerary accuracy.", fieldIssues.get("trip.budget.total"))}
        ${fieldShell("Maximum Nightly Lodging Budget", select("trip.budget.lodging", trip.budget.lodging, nightlyLodgingBudgetOptions, "Maximum Nightly Lodging Budget"), "Used for hotel-tier suggestions.")}
      </div>
      ${destinationRegionsField(trip)}
      ${budgetIssueTable()}
    </section>
    ${whosTravelingSection(trip)}
    ${tripStructureSection(trip)}
    ${routeSummary(trip)}
    ${Number(trip.days) ? `<p class="derived-summary basics-derived-summary">☀ ${esc(tripDateSummary(trip))} · ${calculateTripNights(Number(trip.days))} night${calculateTripNights(Number(trip.days)) === 1 ? "" : "s"}</p>` : ""}
    <section class="trip-intent-section step-1-zone" aria-label="Trip Intent">
      <div class="zone-head"><span aria-hidden="true">${iconSvg("sparkle")}</span><div><p class="eyebrow">Trip Intent</p><h2>Tell us what would make this trip feel right.</h2></div></div>
      ${tripDescriptionField(trip)}
      <div class="button-row trip-intent-actions"><button class="secondary-action interpret-action" data-action="interpretText">${iconSvg("sparkle")}<span>Interpret My Trip</span></button></div>
      ${ui.interpretationError ? `<div class="callout bad-callout">${esc(ui.interpretationError)}</div>` : ""}
    </section>
    ${tripAdvisoryPanel(issues)}
    <div class="wizard-footer">${button("Save and Exit", "saveExit")}<button class="primary" data-action="continueBasics" title="${blocking ? "Resolve blocking Trip Basics issues before continuing." : "Continue to Trip Style"}">Continue</button></div>
  </div>
  ${quickInterpretTable()}`;
}

function whosTravelingSection(trip) {
  const total = travelerTotal(trip);
  const warnings = travelerWarnings(trip);
  const childAges = childAgeValues(trip);
  return `<section class="trip-essentials-section step-1-zone" aria-label="Who's Traveling">
    <div class="zone-head"><span aria-hidden="true">${iconSvg("person")}</span><div><p class="eyebrow">Who's Traveling</p><h2>Group and special needs.</h2></div>${badge(`${total} traveler${total === 1 ? "" : "s"}`)}</div>
    ${warnings.length ? `<div class="warning-list"><strong>${warnings.length} traveler issue${warnings.length === 1 ? "" : "s"} require review</strong>${warnings.map((warning) => `<p>${esc(warning)}</p>`).join("")}</div>` : ""}
    <div class="form-grid travelers-composition-grid">
      <label>Group Type ${select("trip.groupType", trip.groupType, groupTypes, "Group Type")}</label>
      <label>Adults (18+) ${input("trip.adults", trip.adults, "Adults", "number", { min: 1, max: 20 })}</label>
      <label>Children (0-17) ${input("trip.children", trip.children, "Children", "number", { min: 0, max: 15 })}</label>
      ${Number(trip.children || 0) > 0 ? childAges.map((age, index) => `<label>Child ${index + 1} age ${input(`childAge.${index}`, age, `Child ${index + 1} age`, "number", { min: 0, max: 17 })}</label>`).join("") : ""}
      <label>Seniors (65+) ${input("trip.seniors", trip.seniors, "Seniors", "number", { min: 0, max: 20 })}</label>
      <label class="special-needs-cell">Special Needs${specialNeedsTick(trip)}</label>
    </div>
  </section>`;
}

function tripStructureSection(trip) {
  ensureRouteArchitecture(trip);
  const prefs = trip.routePreferences;
  const showDayTripLimits = ["one-base-day-trips", "recommend"].includes(prefs.tripStructure);
  const showMultiCityLimits = ["multi-city", "recommend"].includes(prefs.tripStructure);
  const routeDetailsOpen = ui.routeDetailsOpen ?? Boolean(prefs.placesInMind || prefs.mustDoPlaces || prefs.placesToAvoid || ui.basicsSubmitAttempted);
  const comfortDetailsOpen = ui.comfortDetailsOpen ?? false;
  return `<section class="trip-structure-section full">
    <div class="section-kicker"><span>Choose your trip shape</span><strong>Decide how many bases and how much movement feels right.</strong></div>
    <div class="trip-structure-options">
      ${tripStructureOptions.map((option) => `<label class="trip-structure-card structure-${esc(option.value)} ${prefs.tripStructure === option.value ? "selected" : ""}">
        <input type="radio" name="trip-structure" data-field="trip.routePreferences.tripStructure" value="${esc(option.value)}" ${prefs.tripStructure === option.value ? "checked" : ""}>
        <i aria-hidden="true">${iconSvg(tripStructureIcon(option.value))}</i>
        <span><strong>${esc(option.label)}</strong><small>${esc(option.helper)}</small></span>
      </label>`).join("")}
    </div>
    <details class="progressive-fields route-shaping-fields" data-details="routeDetailsOpen" ${routeDetailsOpen ? "open" : ""}>
      <summary><span><i aria-hidden="true">${iconSvg("route")}</i>Route-shaping details</span>${preferenceChips(routePreferenceSummary(prefs))}</summary>
      <div class="form-grid route-detail-grid">
        ${placeTagsField("placesInMind", "Places Already in Mind", prefs, "Cities, neighborhoods, parks, or nearby areas you are already considering. Pick a suggestion for each one so it resolves to the right place.")}
        ${placeTagsField("mustDoPlaces", "Must-do Places", prefs, "RouteMosaic should protect these before lower-priority ideas. Pick a suggestion for each one so it resolves to the right place.")}
        ${fieldShell("Places to Avoid", input("trip.routePreferences.placesToAvoid", prefs.placesToAvoid, "Places to Avoid"), "Cities, neighborhoods, or activity types you do not want included.")}
        ${fieldShell("Open to Nearby Cities", select("trip.routePreferences.openToNearbyCities", prefs.openToNearbyCities, ["Yes", "No", "Only if clearly better"], "Open to Nearby Cities"), "Nearby cities are suggested only when the value justifies the burden.")}
        ${showMultiCityLimits ? fieldShell("Maximum Hotel Changes", select("trip.routePreferences.maxHotelChanges", prefs.maxHotelChanges, ["0", "1", "2", "3", "4", "5", "6"], "Maximum Hotel Changes"), "Multi-city options cannot exceed this.") : ""}
        ${showMultiCityLimits ? fieldShell("Maximum Transfer Driving Time", select("trip.routePreferences.maxTransferDriveTime", prefs.maxTransferDriveTime, ["1 hour", "2 hours", "3 hours", "4 hours", "5 hours", "6 hours", "7 hours", "8 hours", "9 hours", "10 hours"], "Maximum Transfer Driving Time"), "Applies to base-to-base transfer days.") : ""}
        ${showDayTripLimits ? fieldShell("Maximum Day-trip Driving Time", select("trip.routePreferences.maxDayTripDriveTime", prefs.maxDayTripDriveTime, ["1 hour", "2 hours", "3 hours", "4 hours", "5 hours", "6 hours", "7 hours", "8 hours"], "Maximum Day-trip Driving Time"), "Applies to round-trip side trips from one base.") : ""}
        ${/rent|drive/i.test(trip.transportation || "") ? fieldShell("Rental Car", select("trip.routePreferences.rentalCar", prefs.rentalCar, ["Yes", "No", "Unknown"], "Rental Car"), "Used for route and parking assumptions.") : ""}
        ${fieldShell("Known Hotel or Preferred Neighborhood", input("trip.routePreferences.knownHotelOrNeighborhood", prefs.knownHotelOrNeighborhood, "Known Hotel or Preferred Neighborhood"), "Optional, but it helps route clustering.")}
        ${fieldShell("Existing Reservations", textarea("trip.routePreferences.existingReservations", prefs.existingReservations, "Existing Reservations"), "Booked meals, tours, hotels, shows, ferries, or tickets.")}
      </div>
    </details>
    <details class="progressive-fields comfort-prep-fields" data-details="comfortDetailsOpen" ${comfortDetailsOpen ? "open" : ""}>
      <summary><span><i aria-hidden="true">${iconSvg("moon")}</i>Comfort and preparation preferences</span>${preferenceChips(comfortPreferenceSummary(prefs))}</summary>
      <div class="form-grid route-detail-grid">
        ${fieldShell("Need Recovery Time After Arrival", select("trip.routePreferences.recoveryAfterArrival", prefs.recoveryAfterArrival, ["Yes", "No", "Maybe"], "Need Recovery Time After Arrival"), "Keeps arrival day realistic.")}
        ${fieldShell("Night-driving Comfort", select("trip.routePreferences.nightDrivingComfort", prefs.nightDrivingComfort, ["Comfortable", "Prefer to avoid", "Avoid"], "Night-driving Comfort"), "Used for transfer and evening return planning.")}
        ${fieldShell("Open to Early Starts", select("trip.routePreferences.earlyStarts", prefs.earlyStarts, ["Yes", "Open if worth it", "Prefer not"], "Open to Early Starts"), "Useful for parks, ferries, and long transfers.")}
        ${fieldShell("Sunrise Interest", select("trip.routePreferences.sunriseInterest", prefs.sunriseInterest, ["High", "Optional", "No"], "Sunrise Interest"), "Only used when it fits the route.")}
        ${fieldShell("Sunset Interest", select("trip.routePreferences.sunsetInterest", prefs.sunsetInterest, ["High", "Interested", "No"], "Sunset Interest"), "Helps place scenic evenings.")}
      </div>
      ${["Secluded", "Quiet Area"].includes(trip.style?.locationFeel) ? `<p class="field-note remote-advisory">Your Location Feel leans toward secluded or remote areas -- downloading offline maps before you go is recommended.</p>` : ""}
    </details>
  </section>`;
}

function budgetIssueTable() {
  const budgetIssues = reviewIssues().filter((issue) => issue.owningStep === 1 && issue.field?.startsWith("trip.budget"));
  return budgetIssues.length ? stepIssueTable(budgetIssues) : "";
}

function tripStructureIcon(value) {
  return {
    "one-city": "city",
    "one-base-day-trips": "bed",
    "multi-city": "route",
    recommend: "sparkle"
  }[value] || "route";
}

function routePreferenceSummary(prefs) {
  return [`Nearby cities ${String(prefs.openToNearbyCities || "Yes").toLowerCase()}`, `${prefs.maxHotelChanges || "1"} hotel change`, `${prefs.maxTransferDriveTime || "3 hours"} transfer limit`];
}

function comfortPreferenceSummary(prefs) {
  return [`${prefs.nightDrivingComfort || "Prefer to avoid"} night driving`, `${prefs.earlyStarts || "Open if worth it"} early starts`, `Offline maps ${String(prefs.offlineMaps || "Yes").toLowerCase()}`];
}

function preferenceChips(items) {
  return `<small class="summary-chips">${items.map((item) => `<em>${esc(item)}</em>`).join("")}</small>`;
}

function tripDescriptionField(trip) {
  const sampleAdded = String(trip.description || "") === TRIP_DESCRIPTION_SAMPLE;
  return `<div class="field-shell full trip-description-field">
    <label for="trip-description">Trip Description</label>
    <textarea id="trip-description" data-field="trip.description" aria-describedby="trip-description-helper" placeholder="${esc(TRIP_DESCRIPTION_PLACEHOLDER)}">${esc(trip.description || "")}</textarea>
    <div class="trip-description-help-row">
      <small id="trip-description-helper" class="field-helper">${esc(TRIP_DESCRIPTION_HELPER)}</small>
      <button type="button" class="sample-description-button" data-action="useSampleDescription">${sampleAdded ? "Sample added" : "Use sample description"}</button>
    </div>
  </div>`;
}

function routeRecommendationStep() {
  ensureRouteArchitecture(state.trip);
  if (!state.trip.routeOptions?.length) state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
  const options = state.trip.routeOptions;
  const selectedId = state.trip.pendingRouteOptionId || options.find((option) => option.recommended)?.id || options[0]?.id || "";
  const selected = options.find((option) => option.id === selectedId) || options[0];
  return `<section class="panel route-recommendation-panel">
    <div class="panel-head">
      <div><p class="eyebrow">Route Recommendation</p><h2>Approve your trip shape before daily planning.</h2></div>
      ${badge("Route approval required")}
    </div>
    <p class="route-intro">RouteMosaic first decides whether this should be one city, one base with day trips, or a multi-city route. The detailed itinerary will only use the approved destinations.</p>
    <div class="route-option-grid">
      ${options.map((option) => routeOptionCard(option, selectedId)).join("")}
    </div>
    ${selected ? approvedRoutePreview(selected) : ""}
    <div class="route-action-strip" aria-label="Route refinement actions">
      <button data-action="routeFewerHotels">Fewer Hotel Changes</button>
      <button data-action="routeLessDriving">Reduce Driving</button>
      <button data-action="routeMoreVariety">More Variety</button>
      <button data-action="routeKeepOneBase">Keep One Base</button>
      <button data-action="regenerateRouteOptions">Regenerate Route Options</button>
    </div>
    <div class="wizard-footer">${button("Back", "prev")}${button("Save and Exit", "saveExit")}<button class="primary" data-action="approveRoute:${esc(selectedId)}">Approve Route</button></div>
  </section>`;
}

function routeOptionCard(option, selectedId) {
  const selected = option.id === selectedId;
  return `<article class="route-option-card ${selected ? "selected" : ""}">
    <div class="route-option-head">
      <div><p class="eyebrow">Option ${esc(String.fromCharCode(64 + (option.rank || 1)))}</p><h3>${esc(option.title)}</h3></div>
      ${option.recommended ? badge("Recommended") : badge(option.tripShapeType.replaceAll("-", " "))}
    </div>
    <dl class="route-metrics">
      <div><dt>Sequence</dt><dd>${esc(option.sequence.join(" → "))}</dd></div>
      <div><dt>Nights</dt><dd>${esc(option.nightsPerBase.map((item) => `${item.base}: ${item.nights}`).join(" · "))}</dd></div>
      <div><dt>Transfer</dt><dd>${esc(option.approximateTransferTime)}</dd></div>
      <div><dt>Hotel changes</dt><dd>${esc(option.hotelChanges)}</dd></div>
      <div><dt>Confidence</dt><dd>${esc(option.confidence)}%</dd></div>
    </dl>
    <p>${esc(option.whyMatches)}</p>
    <div class="route-columns">
      <div><strong>Benefits</strong><ul>${option.benefits.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>
      <div><strong>Tradeoffs</strong><ul>${option.tradeoffs.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>
    </div>
    ${requestedDestinationsCoverage(option)}
    <button class="${selected ? "primary" : ""}" data-action="selectRouteOption:${esc(option.id)}">${selected ? "Selected" : "Select Option"}</button>
  </article>`;
}

function requestedDestinationsCoverage(option) {
  const hasRefinements = (option.includedRefinements?.length || 0) > 0 || (option.dayTripRefinements?.length || 0) > 0 || (option.excludedRefinements?.length || 0) > 0;
  if (!hasRefinements) return "";
  return `<div class="route-columns">
    <div><strong>Your requested destinations</strong><ul>
      ${(option.includedRefinements || []).map((name) => `<li>${esc(name)} — included as an overnight base</li>`).join("")}
      ${(option.dayTripRefinements || []).map((name) => `<li>${esc(name)} — day trip</li>`).join("")}
      ${(option.excludedRefinements || []).map((item) => `<li>${esc(item.name)} — not included: ${esc(item.reason)}</li>`).join("")}
    </ul></div>
  </div>`;
}

function approvedRoutePreview(option) {
  return `<section class="approved-route-preview">
    <div><p class="eyebrow">Your Proposed Route</p><h3>${esc(option.sequence.join(" → "))}</h3></div>
    ${table(["Planning Item", "Route Decision"], [
      ["Arrival point", option.hotelBases[0]?.canonicalName || option.primaryDestination],
      ["Hotel bases", option.nightsPerBase.map((item) => `${item.base} (${item.nights} night${item.nights === 1 ? "" : "s"})`).join(" · ")],
      ["Transfer days", option.transferDays.length ? option.transferDays.join(" · ") : "None"],
      ["Optional day trips", option.dayTripCandidates.length ? option.dayTripCandidates.join(" · ") : "None approved yet"],
      ["Total hotel changes", option.hotelChanges],
      ["Total estimated major driving", option.totalMajorDriving],
      ["Arrival/departure assumptions", option.assumptions.join(" ")]
    ].map(([item, value]) => `<tr><td>${esc(item)}</td><td>${esc(value)}</td></tr>`))}
  </section>`;
}

function sampleTripPanel(trip) {
  const hasSample = Boolean(trip.sampleTrip);
  return `<section class="sample-trip-panel">
    <span class="sample-trip-icon" aria-hidden="true">${iconSvg("briefcase")}</span>
    <div><strong>${hasSample ? "Sample trip loaded" : "Try a sample trip"}</strong><p>${hasSample ? "You are editing a sample Los Angeles trip. All fields are editable." : "Load a realistic Los Angeles example."}</p></div>
    <div>
      ${hasSample ? `<button data-action="clearSampleTrip">Clear Sample</button>` : `<button data-action="loadSampleTrip">Try Los Angeles sample</button>`}
    </div>
  </section>`;
}

function fieldShell(labelText, control, helper = "", issue = null) {
  const id = `field-${labelText.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const helperText = issue ? issue.issue : helper;
  return `<div class="field-shell${issue ? " has-error" : ""}"><label for="${id}">${esc(labelText)}</label>${control.replace(/<(input|select|textarea)/, `<$1 id="${id}"`)}<small class="field-helper${issue ? " field-helper-error" : ""}">${esc(helperText || " ")}</small></div>`;
}

function locationField(field, labelText, value, location, verificationStatus, issue = null) {
  const active = ui.activeLocationField === field;
  const helper = issue ? issue.issue : locationVerificationLabel(location, verificationStatus === "Location Not Verified" ? "Select a suggestion to verify this location." : verificationStatus);
  const statusClass = location?.verificationStatus === "Verified" ? "verified" : "needs-review";
  const panelId = `location-results-${field}`;
  const activeId = ui.locationHighlight[field] >= 0 ? `${panelId}-${ui.locationHighlight[field]}` : "";
  const clearLabel = field === "from" ? "Clear Traveling From" : field === "destination" ? "Clear Destination" : "Clear Location";
  return `<div class="field-shell location-field${issue ? " has-error" : ""}">
    <label for="location-${field}">${esc(labelText)}</label>
    <div class="location-control">
      <input id="location-${field}" role="combobox" aria-autocomplete="list" aria-expanded="${active}" aria-controls="${panelId}" ${activeId ? `aria-activedescendant="${activeId}"` : ""} aria-describedby="location-helper-${field}" autocomplete="off" data-location-field="${esc(field)}" value="${esc(value || "")}" placeholder="${field === "from" ? "City, airport, state, or country" : "City, region, state, or country"}">
      ${String(value || "").trim() ? `<button class="location-clear" type="button" aria-label="${esc(clearLabel)}" data-action="clearLocation:${esc(field)}">×</button>` : ""}
      <span class="verification-pill ${statusClass}" aria-label="${esc(helper)}">${location?.verificationStatus === "Verified" ? "✓ Verified" : "Select from suggestions"}</span>
    </div>
    <small id="location-helper-${field}" class="field-helper${issue ? " field-helper-error" : ""}">${esc(helper)}</small>
  </div>`;
}

// Places Already in Mind / Must-do Places render as verified "tag" chips
// instead of a single free-text input -- see addVerifiedPlaceTag() for why
// (ambiguous/misspelled free text was resolving to wrong, unrelated cities).
function placeTagsField(field, labelText, prefs, helperText) {
  const active = ui.activeLocationField === field;
  const verified = new Set((prefs[`${field}Verified`] || []).map((name) => name.toLowerCase()));
  const tags = String(prefs[field] || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  const panelId = `location-results-${field}`;
  const activeId = ui.locationHighlight[field] >= 0 ? `${panelId}-${ui.locationHighlight[field]}` : "";
  return `<div class="field-shell location-field place-tags-field">
    <label for="location-${field}">${esc(labelText)}</label>
    ${tags.length ? `<ul class="place-tag-list" aria-label="${esc(labelText)}">${tags.map((tag, index) => {
      const isVerified = verified.has(tag.toLowerCase());
      return `<li class="place-tag ${isVerified ? "verified" : "unverified"}" title="${isVerified ? "Verified location" : "Not verified from suggestions -- may not resolve to the place you meant."}">
        <span aria-hidden="true">${isVerified ? "✓" : "⚠"}</span>${esc(tag)}
        <button type="button" class="place-tag-remove" aria-label="Remove ${esc(tag)}" data-action="removePlaceTag:${esc(field)}:${index}">×</button>
      </li>`;
    }).join("")}</ul>` : ""}
    <div class="location-control">
      <input id="location-${field}" role="combobox" aria-autocomplete="list" aria-expanded="${active}" aria-controls="${panelId}" ${activeId ? `aria-activedescendant="${activeId}"` : ""} aria-describedby="location-helper-${field}" autocomplete="off" data-location-field="${esc(field)}" value="${esc(locationValue(field))}" placeholder="Type a place, then pick a suggestion to add it">
    </div>
    <small id="location-helper-${field}" class="field-helper">${esc(helperText)}</small>
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

function locationAutocompleteOverlay() {
  const field = ui.activeLocationField;
  if (!field || state.activeStep !== 1) return "";
  const inputValue = locationValue(field);
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
      ${!loading && !error && locationProvider && String(inputValue || "").trim().length >= LOCATION_MIN_QUERY_LENGTH && !suggestions.length ? `<p class="location-message" role="status">No matching locations found. You may continue with the typed location, but it will remain unverified until a suggestion is selected.</p>` : ""}
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

function styleStep() {
  const trip = state.trip;
  const selected = selectedExperiences();
  const selectedCount = countSelectedExperiences(state.trip);
  const hikingInterest = selectedExperiences().some((pref) => /hiking|outdoor/i.test(pref.label) && !/avoid/i.test(pref.importance));
  const scheduleIssues = reviewIssues().filter((issue) => issue.owningStep === 2 || issue.field?.startsWith("trip.schedule") || issue.issue.includes("Dinner Time"));
  return `<div class="step-sections trip-style-screen">
    <section class="compact-section premium-section core-style-section">
      <div class="section-head"><div><h2>Core Style</h2><p>Set the overall feel without adding duplicate experience preferences.</p></div></div>
      <div class="style-scale-grid">
        ${styleSelectControl("trip.style.balance", state.trip.style.balance, ["Nature", "Mostly Nature", "Balanced", "Mostly Urban", "Urban"], "Core Style", "More time in nature, less in cities.", "leaf")}
        ${styleSelectControl("trip.style.atmosphere", state.trip.style.atmosphere, ["Very Quiet", "Relaxed", "Balanced", "Social", "Lively"], "Atmosphere", "Unwind, go at your own pace.", "cloud")}
        ${styleSelectControl("trip.style.locationFeel", state.trip.style.locationFeel, ["Secluded", "Quiet Area", "Balanced", "Central", "Busy District"], "Location Feel", "Off the beaten path, with stunning views.", "mountain")}
      </div>
    </section>
    <section class="compact-section premium-section daily-schedule-comfort-section">
      <div class="section-head"><div><h2>Daily Rhythm and Comfort</h2><p>How your days should run and how active you want to be.</p></div></div>
      <div class="comfort-card-grid">
        ${comfortCard(1, "Daily Schedule", "Define your ideal daily rhythm.", "calendar", "blue", table(["Setting", "Preference"], [
          `<tr><td>Pace</td><td>${select("trip.schedule.pace", trip.schedule.pace, ["Very relaxed", "Relaxed", "Balanced", "Active", "Packed"], "Pace")}</td></tr>`,
          `<tr><td>Wake-Up Time</td><td>${input("trip.schedule.wakeUp", trip.schedule.wakeUp || "8:00 AM", "Wake-Up Time")}</td></tr>`,
          `<tr><td>Earliest Activity</td><td>${input("trip.schedule.earliestActivity", trip.schedule.earliestActivity || "9:00 AM", "Earliest Activity")}</td></tr>`,
          `<tr><td>Latest Return</td><td>${input("trip.schedule.latestReturn", trip.schedule.latestReturn || "10:00 PM", "Latest Return")}</td></tr>`,
          `<tr><td>Major Activities per Day</td><td>${input("trip.schedule.majorActivities", trip.schedule.majorActivities || 2, "Major Activities per Day", "number", { min: 1, max: 8 })}</td></tr>`,
          `<tr><td>Desired Free Time per Day</td><td>${input("trip.schedule.freeTime", trip.schedule.freeTime || "2 hours", "Desired Free Time per Day")}</td></tr>`
        ]))}
        ${comfortCard(2, "Physical Comfort", "Tell us about your activity comfort.", "hiking", "green", `${!hikingInterest ? `<p class="sr-only">Hiking is not currently selected as an interest. <button class="small" data-action="addHikingInterest">Add Hiking Interest</button></p>` : ""}
          ${table(["Setting", "Preference"], [
            `<tr><td>Walking Ability</td><td>${select("trip.activity.walking", trip.activity.walking === "Not Specified" ? "Easy walking" : trip.activity.walking, ["Minimal walking", "Easy walking", "Moderate walking", "High walking tolerance"], "Walking Ability")}</td></tr>`,
            `<tr><td>Hiking Interest</td><td>${select("trip.activity.hiking", trip.activity.hiking === "No hiking" ? "Easy hikes" : trip.activity.hiking, ["No hiking", "Easy hikes", "Moderate hikes", "Difficult hikes"], "Hiking Interest")}</td></tr>`,
            `<tr><td>Maximum Hiking Duration</td><td>${input("trip.activity.maxHikeDuration", trip.activity.maxHikeDuration || "2 hours", "Maximum Hiking Duration")}</td></tr>`,
            `<tr><td>Maximum Hiking Distance</td><td>${input("trip.activity.maxHikeDistance", trip.activity.maxHikeDistance || "4 miles", "Maximum Hiking Distance")}</td></tr>`
          ])}`)}
      </div>
      ${scheduleIssues.length ? stepIssueTable(scheduleIssues) : ""}
    </section>
    <section class="compact-section premium-section experience-categories-section">
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

const priorityImportanceOptions = ["Must have", "Strong preference", "Nice to have", "Avoid"];

function prioritySelect(pref) {
  const value = pref.importance === "Must avoid" ? "Avoid" : pref.importance;
  return `<select aria-label="${esc(`${pref.label} importance`)}" data-field="prefImportance.${esc(pref.id)}" class="priority-select priority-${esc(priorityTone(pref.importance))}">
    ${priorityImportanceOptions.map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(priorityDisplayLabel(option))}</option>`).join("")}
  </select>`;
}

function priorityDisplayLabel(importance) {
  if (importance === "Must have") return "High";
  if (importance === "Strong preference") return "Medium";
  if (importance === "Nice to have") return "Low";
  if (importance === "Avoid" || importance === "Must avoid") return "Avoid";
  return importance;
}

function priorityTone(importance) {
  if (importance === "Must have") return "high";
  if (importance === "Strong preference") return "medium";
  if (importance === "Nice to have") return "low";
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
  const eveningActivities = selectedEveningActivities(trip);
  const nightlife = selectedNightlifeAndDrinks(trip);
  const mealRows = [
    ["Breakfast", trip.food.breakfast || "Hearty & filling", trip.food.breakfastTime || "7:30 - 8:30 AM", "Prefer protein-rich options", "Preferred Breakfast Time"],
    ["Lunch", trip.food.lunch || "Balanced & light", trip.food.lunchTime || "12:30 - 1:30 PM", "Light so we can explore more", "Preferred Lunch Time"],
    ["Dinner", trip.food.dinner || "Relaxed & indulgent", trip.food.dinnerTime || "6:30 - 7:30 PM", "Enjoy local specialties", "Preferred Dinner Time"]
  ];
  return `<section class="panel food-panel">
    <div class="panel-head"><div><p class="eyebrow">Step 3</p><h2>Food and Evenings</h2><p>Help us plan meals and experiences you'll love.</p></div><span class="badge food-context" title="These preferences apply to the whole group.">Group Preferences</span></div>
    <div class="food-layout food-summary-layout">
      <div class="food-column">
        <section class="food-summary-card diet-card">
          <div class="food-card-title"><span aria-hidden="true">${iconSvg("leaf")}</span><h3>Diet and Restrictions</h3></div>
          ${foodSummaryLine("Preferred diet", trip.food.diet, "No group diet selected", "diet")}
          ${foodSummaryLine("Food Avoidances", trip.food.restrictions, "No group-wide avoidances", "avoid")}
        </section>
        <section class="food-summary-card special-needs-card">
          <div class="food-card-title"><span aria-hidden="true">${iconSvg("travelers")}</span><h3>Special Needs</h3></div>
          ${specialNeedsSummaryLine(trip)}
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
      <div class="food-card-title"><span aria-hidden="true">${iconSvg("dollar")}</span><h3>Food Planning Details</h3><button class="small" aria-label="Edit Food Planning Details" data-action="openFoodSection:details">Edit</button></div>
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

function specialNeedsSummaryLine(trip) {
  const values = trip.specialNeeds || [];
  const hasValues = values.length > 0;
  return `<div class="food-summary-line">
    <div><strong>Group-wide needs</strong>${foodSelectedSummary(values, "No special needs selected", "", "", false)}</div>
    <span class="selected-count">${hasValues ? `${values.length} selected` : "None selected"}</span>
    <button class="small" aria-label="${esc(`${hasValues ? "Edit" : "Add"} Special Needs`)}" data-action="openSpecialNeeds">${hasValues ? "Edit" : "Add"}</button>
  </div>`;
}

function foodSummaryLine(label, values, emptyText, key) {
  const hasValues = values.length > 0;
  return `<div class="food-summary-line ${key === "avoid" ? "food-summary-line-bad" : ""}">
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
    return `<div class="cuisine-preview empty"><p>No cuisine preferences selected</p><small>We can recommend varied local options.</small><button class="small" aria-label="Add Cuisine Interests" data-action="openFoodSection:cuisine">Add</button></div>`;
  }
  const shown = values.slice(0, 4);
  return `<div class="cuisine-preview">
    <div class="cuisine-preview-grid">${shown.map((option) => `<div class="cuisine-preview-card"><span aria-hidden="true">${cuisineIcon(option)}</span><strong>${esc(option)}</strong></div>`).join("")}<button class="cuisine-add-card" aria-label="Add more Cuisine Interests" data-action="openFoodSection:cuisine"><span aria-hidden="true">${iconSvg("plus")}</span>Add more</button></div>
    <div class="cuisine-preview-footer"><span>${values.length} selected</span><button class="small" aria-label="${esc(hasValues ? "Edit Cuisine Interests" : "Add Cuisine Interests")}" data-action="openFoodSection:cuisine">${hasValues ? "Edit" : "Add"}</button></div>
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
    diet: ["Preferred diet", [["Preferred diet", "food.diet", ["Vegetarian", "Vegan", "Pescatarian", "Non-vegetarian", "Chicken preferred", "Seafood acceptable", "Halal", "Kosher", "Jain", "Gluten-free", "Dairy-free", "Low-carb", "Diabetic-conscious", "Other"]]]],
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

function specialNeedsOverlay() {
  if (!ui.openSpecialNeeds) return "";
  return `<div class="restriction-layer" data-action="closeSpecialNeeds">
    <div class="choice-panel" role="dialog" aria-label="Special Needs">
      <div class="restriction-title">Special Needs</div>
      ${specialNeedsField(state.trip)}
      <div class="restriction-actions"><button data-action="closeSpecialNeeds">Done</button></div>
    </div>
  </div>`;
}

function multiSelect(path, title, options, values) {
  return `<div class="picker"><h3>${title}</h3><div class="small-chip-grid">${options.map((option) => `<label class="small-chip ${values.includes(option) ? "selected" : ""}">${checkbox(`${path}.${option}`, values.includes(option), option)}${esc(option)}</label>`).join("")}</div></div>`;
}

// Group-level replacement for the old per-traveler restrictions table -- one
// compact multi-select instead of a per-person popover, since there's no
// traveler identity to attach the answer to anymore. Skips multiSelect()'s
// own <h3> since this renders as one column inside a labeled grid row, not a
// full-width section.
function specialNeedsTick(trip) {
  const values = trip.specialNeeds || [];
  const hasValues = values.length > 0;
  return `<div class="special-needs-tick">
    <div class="special-needs-tick-summary">${hasValues ? foodValuePills(values, 6) : `<span class="special-needs-tick-empty">None selected</span>`}</div>
    <button type="button" class="small" data-action="openSpecialNeeds">${hasValues ? "Edit" : "Add"}</button>
  </div>`;
}

function specialNeedsField(trip) {
  const values = trip.specialNeeds || [];
  return `<div class="special-needs-field">
    <div class="small-chip-grid compact-chip-grid">${travelerRestrictionOptions.map((option) => `<label class="small-chip compact-chip ${values.includes(option) ? "selected" : ""}">${checkbox(`specialNeeds.${option}`, values.includes(option), option)}${esc(option)}</label>`).join("")}</div>
    ${values.includes("Other") ? `<label class="other-restriction">Describe the Other special need <input aria-label="Describe the Other special need" placeholder="Describe the Other special need" data-field="trip.specialNeedsOtherText" value="${esc(trip.specialNeedsOtherText || "")}"></label>` : ""}
  </div>`;
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
    <div class="panel-head"><div><p class="eyebrow">Step 4 of 4</p><h2>Review Your Trip</h2></div><div class="review-head-actions">${badge(status)}<button class="small">Expand All</button></div></div>
    <section class="review-overview"><strong>${esc(heroDestination(trip))}</strong><span>${esc(tripDateSummary(trip))}</span><span>${travelerTotal(trip)} travelers</span><span>${esc(trip.schedule.pace)} pace</span></section>
    <div class="review-grid">
      ${reviewCard("Trip Basics", 1, "basics", [
        ["Origin", trip.fromDisplay || trip.from],
        ["Destination", heroDestination(trip)],
        ["Dates", formatDateRange(trip.startDate, trip.endDate)],
        ["Trip Length", `${trip.days} days / ${calculateTripNights(Number(trip.days || 0))} nights`],
        ["Transportation", trip.transportation],
        ["Approved Route", approvedRouteSummary(trip)],
        ["Travelers", `${trip.groupType} · ${trip.adults} adult${Number(trip.adults) === 1 ? "" : "s"}${Number(trip.children) ? `, ${trip.children} child${Number(trip.children) === 1 ? "" : "ren"}` : ""}${Number(trip.seniors) ? `, ${trip.seniors} senior${Number(trip.seniors) === 1 ? "" : "s"}` : ""}`],
        ["Budget Range", trip.budget.total || "Not selected"]
      ])}
      ${reviewCard("Trip Style", 2, "style", [
        ["Nature Focus", trip.style.balance],
        ["Atmosphere", trip.style.atmosphere],
        ["Location Feel", trip.style.locationFeel],
        ["Top Experiences", topExperienceSummary()],
        ["Pace", `${trip.schedule.pace} pace`],
        ["Major Activities / Day", trip.schedule.majorActivities || 2]
      ])}
      ${reviewCard("Food and Evenings", 3, "food", [["Diet", chipSummary(trip.food.diet)], ["Avoid", chipSummary(trip.food.restrictions)], ["Limits", chipSummary(trip.food.restrictions)], ["Evenings", chipSummary(trip.alcohol.preferences)]])}
      ${reviewIssuesCard(issues)}
    </div>
    ${generationProgressPanel()}
    ${providerDiagnosticsPanel()}
    ${wizardFooter("Back", "Save and Exit", ui.generatingPlan ? "Building..." : "Build My Trip", blocking.length || ui.generatingPlan ? "disabled" : "")}
  </section>
  ${previewSection()}`;
}

function generationProgressPanel() {
  if (!ui.generatingPlan && !ui.planAnnouncement) return "";
  const steps = [
    "Researching destination highlights",
    "Grouping nearby experiences",
    "Applying traveler and food preferences",
    "Scheduling the itinerary"
  ];
  return `<section class="generation-progress" role="status" aria-live="polite">
    <strong>${esc(ui.generatingPlan ? "Building your trip..." : "Trip planning update")}</strong>
    <span>${esc(ui.planAnnouncement || "Preparing trip plan.")}</span>
    <div>${steps.map((step) => `<i>${esc(step)}</i>`).join("")}</div>
  </section>`;
}

function providerDiagnosticsPanel() {
  const status = state.providerStatus;
  if (!status?.diagnostics) return "";
  const rows = [
    ["Place", status.diagnostics.placeProvider, status.placeProviderAvailable ? "available" : "unavailable", status.diagnostics.placeProviderMissing?.join(", ") || "None"],
    ["Route", status.diagnostics.routeProvider, status.routeProviderAvailable ? "available" : "unavailable", status.diagnostics.routeProviderMissing?.join(", ") || "None"],
    ["Weather", status.diagnostics.weatherProvider, status.weatherProviderAvailable ? "available" : "degraded", status.diagnostics.weatherProviderMissing?.join(", ") || "None"],
    ["AI", status.diagnostics.aiProvider, status.diagnostics.aiProviderMissing?.length ? "degraded" : "not required", status.diagnostics.aiProviderMissing?.join(", ") || "None"]
  ];
  return `<section class="panel provider-diagnostics">
    <div class="panel-head"><div><p class="eyebrow">Development Only</p><h3>Provider Configuration · ${esc(status.diagnostics.mode)}</h3></div><button data-action="refreshProviderStatus">Retry Configuration Check</button></div>
    ${table(["Service", "Provider", "Status", "Missing"], rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell || "")}</td>`).join("")}</tr>`))}
  </section>`;
}

function quickInterpretTable() {
  const interpreted = state.trip.interpretedSuggestions || [];
  if (!interpreted.length) return "";
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
  const providerIssue = firstIssue?.field === "provider.configuration";
  return `<article class="review-card review-issues issues-card">
    <div class="review-card-art" aria-hidden="true"></div>
    <div class="review-card-content">
      <div class="panel-head mini-head"><h3>Issues and Advisories</h3>${providerIssue ? `<button data-action="refreshProviderStatus">Retry</button>` : ""}</div>
      ${issues.length ? stepIssueTable(issues) : `<div class="issue-summary clear"><strong>No issues found.</strong><p>Your trip is ready to build.</p></div>`}
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
  const issues = [...getTripIssues(state.trip)];
  if (routeRecommendationRequired(state.trip) && !approvedRouteStillValid(state.trip)) {
    issues.unshift({
      severity: "Critical",
      blocking: true,
      field: "trip.routePreferences.tripStructure",
      owningStep: 4,
      issue: "Approve a trip route before building the detailed itinerary.",
      action: "Review route options and approve one route shape."
    });
  }
  if (state.activeStep === 4 && (!state.providerStatus || state.providerStatus.canGenerate === false)) {
    issues.unshift({
      severity: "Critical",
      blocking: true,
      field: "provider.configuration",
      owningStep: 4,
      issue: "Trip generation is temporarily unavailable because destination and route services are not configured.",
      action: "Trip generation is temporarily unavailable. Please try again later. Your trip inputs are saved in the current session."
    });
  }
  if (state.activeStep === 4) {
    issues.unshift(...locationVerificationIssues(state.trip));
    if (state.providerStatus?.mode === "mock" && !mockDestinationDataAvailable(state.trip.destinationDisplay || state.trip.destination)) {
      issues.unshift({
        severity: "Critical",
        blocking: true,
        field: "trip.destination",
        owningStep: 1,
        issue: "This destination is not available in the current demo data.",
        action: "Edit Trip Basics or use live providers for public trip generation."
      });
    }
  }
  return issues;
}

// A UI-only check, deliberately kept out of the shared domain.js
// tripBasicsIssues/getTripIssues -- those also gate generateTripPlan's own
// server-side pre-flight validation, and dozens of planner tests construct
// trip objects directly (bypassing the location-autocomplete UI entirely)
// without ever setting fromLocation/destinationLocation. Requiring
// verification there rejected every one of those fixtures. This check only
// needs to run where a human is actually driving the wizard.
function locationVerificationIssues(trip) {
  const issues = [];
  if (String(trip.from || "").trim() && trip.fromLocation?.verificationStatus !== "Verified") {
    issues.push({
      severity: "Critical",
      blocking: true,
      field: "trip.from",
      owningStep: 1,
      issue: "Traveling From must be selected from location suggestions before building.",
      action: "Edit Trip Basics and select a real origin suggestion."
    });
  }
  if (String(trip.destination || "").trim() && trip.destinationLocation?.verificationStatus !== "Verified") {
    issues.push({
      severity: "Critical",
      blocking: true,
      field: "trip.destination",
      owningStep: 1,
      issue: "Destination must be selected from location suggestions before building.",
      action: "Edit Trip Basics and select a real destination suggestion."
    });
  }
  return issues;
}

function approvedRouteSummary(trip) {
  if (!routeRecommendationRequired(trip)) return "Single-city route";
  if (!approvedRouteStillValid(trip)) return "Needs route approval";
  return `${trip.approvedTripShape.sequence.join(" → ")} · ${trip.approvedTripShape.hotelChanges} hotel change${trip.approvedTripShape.hotelChanges === 1 ? "" : "s"}`;
}

function mockDestinationDataAvailable(destination) {
  const normalized = String(destination || "").toLowerCase();
  return mockDestinationDataNames.some((name) => normalized.includes(name));
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
  const primaryAction = primaryLabel === "Build My Trip" || primaryLabel === "Building..." ? "buildTripPlan" : primaryLabel === "Continue" ? "next" : "noop";
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
    state.activeStep = Number(el.dataset.step);
    if (state.activeStep === 4) {
      refreshProviderStatus();
      return;
    }
    persist("Opened");
  }));
  document.querySelectorAll("[data-field]").forEach((el) => {
    // datetime-local (Arrival/Departure Date and Time) is still a native
    // picker and shares Start/End Date's Safari phantom-value risk (see
    // dateTextInput above), but isn't converted to text here -- it also
    // carries a time component, which needs its own dedicated input, not
    // attempted yet. This gate is a partial mitigation only, not a
    // confirmed fix: require real pointer/keyboard contact with the
    // element before trusting its committed value.
    if (el.type === "datetime-local") {
      const markInteracted = () => { el.dataset.userInteracted = "true"; };
      el.addEventListener("mousedown", markInteracted);
      el.addEventListener("keydown", markInteracted);
      el.addEventListener("change", () => {
        if (el.dataset.userInteracted !== "true") { render(); return; }
        updateField(el.dataset.field, el.value);
      });
      return;
    }
    // Start/End Date: readonly and calendar-only (see dateTextInput/
    // pickDate), so its DOM value is the friendly display text, not the
    // stored ISO date -- never sync it through the generic value listener.
    if (el.readOnly && (el.dataset.field === "trip.startDate" || el.dataset.field === "trip.endDate")) return;
    el.addEventListener("change", () => updateField(el.dataset.field, el.value));
    if (el.matches("input") || el.matches("textarea")) {
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
  // <details>'s native "toggle" event is queued, not synchronous -- it can
  // still be pending when a field changed right after opening the panel
  // triggers its own synchronous re-render, so that re-render reads the OLD
  // ui state and the panel appears to snap shut. Confirmed live: open
  // "Comfort and preparation preferences" then immediately change a select
  // inside it and the panel collapses. Listen on the summary's click
  // instead -- it fires synchronously, before the browser's native toggle
  // or any event a later action might trigger, so we can record the state
  // the click is ABOUT to produce (the inverse of the current open state)
  // immediately, with no race window at all.
  document.querySelectorAll("[data-details]").forEach((el) => {
    const summary = el.querySelector("summary");
    if (summary) summary.addEventListener("click", () => { ui[el.dataset.details] = !el.open; });
  });
  document.querySelectorAll(".restriction-search").forEach((el) => el.addEventListener("input", () => updateField(el.dataset.field, el.value)));
  document.querySelectorAll("[data-check]").forEach((el) => el.addEventListener("change", () => updateCheck(el.dataset.check, el.checked)));
  document.querySelectorAll("[data-location-field]").forEach((el) => {
    el.addEventListener("focus", () => openLocationSuggestions(el.dataset.locationField));
    el.addEventListener("input", () => updateLocationDraft(el.dataset.locationField, el.value));
    el.addEventListener("keydown", (event) => handleLocationKeydown(event, el.dataset.locationField));
  });
  document.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", (event) => {
    if ((el.matches(".restriction-layer") || el.matches(".location-layer") || el.matches(".date-picker-layer")) && event.target !== el) return;
    if (el.dataset.action === "buildTripPlan" || el.dataset.action === "regeneratePlan") {
      buildTripPlanAction(el.dataset.action);
      return;
    }
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
    window.addEventListener("resize", positionLocationOverlay);
    window.addEventListener("scroll", positionLocationOverlay, true);
    window.addEventListener("resize", positionDatePickerOverlay);
    window.addEventListener("scroll", positionDatePickerOverlay, true);
    document.addEventListener("pointerdown", closeLocationOnOutsidePointer, true);
    document.addEventListener("pointerdown", closePlanningPrinciplesOnOutsidePointer, true);
    document.addEventListener("pointerdown", closeDatePickerOnOutsidePointer, true);
    globalListenersBound = true;
  }
  if (ui.focusPlanningPrinciples) {
    ui.focusPlanningPrinciples = false;
    requestAnimationFrame(() => document.querySelector(".planning-principles-trigger")?.focus({ preventScroll: true }));
  }
  positionLocationOverlay();
  positionDatePickerOverlay();
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
  if (ui.activeLocationField) ui.activeLocationField = null;
  else if (ui.openExperienceCategory) {
    ui.openExperienceCategory = null;
    ui.experienceSearch = "";
  } else if (ui.openFoodSection) ui.openFoodSection = null;
  else if (ui.openSpecialNeeds) ui.openSpecialNeeds = false;
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

function closeDatePickerOnOutsidePointer(event) {
  if (!ui.openDatePicker) return;
  if (event.target?.closest?.(".date-field-wrap") || event.target?.closest?.(".date-picker-dropdown")) return;
  ui.openDatePicker = null;
  ui.datePickerViewMonth = null;
  render();
}

function openLocationSuggestions(field) {
  ui.activeLocationField = field;
  ui.locationHighlight[field] = -1;
  queueLocationSearch(field, locationValue(field));
  refreshLocationPanel();
}

function updateLocationDraft(field, value) {
  ui.touchedBasicsFields.add(field);
  if (field === "placesInMind" || field === "mustDoPlaces") {
    ui.placeTagDraft[field] = value;
    ui.activeLocationField = field;
    queueLocationSearch(field, value);
    return;
  }
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
  if (field === "placesInMind" || field === "mustDoPlaces") return ui.placeTagDraft[field] || "";
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
    } catch (error) {
      if (ui.locationRequestId[field] !== requestId) return;
      ui.locationSuggestions[field] = [];
      ui.locationError[field] = locationSearchErrorMessage(error);
      if (field === "from") state.trip.fromVerificationStatus = "ProviderUnavailable";
      if (field === "destination") state.trip.destinationVerificationStatus = "ProviderUnavailable";
    } finally {
      if (ui.locationRequestId[field] !== requestId) return;
      ui.locationLoading[field] = false;
      refreshLocationPanel();
    }
  }, LOCATION_SEARCH_DEBOUNCE_MS);
}

function locationSearchErrorMessage(error) {
  if (error?.code === "LOCATION_SEARCH_TIMEOUT" || error?.status === 504) return "Location search timed out. You may retry, or continue with the typed location.";
  if (error?.code === "PROVIDER_CONFIGURATION_REQUIRED" || error?.status === 503) return "Location search is temporarily unavailable. You may retry, or continue with the typed location.";
  if (error?.code === "LOCATION_SEARCH_FAILED" || error?.status === 502) return "Location search is temporarily unavailable. You may retry, or continue with the typed location.";
  return "Network problem while loading location suggestions. You may retry, or continue with the typed location.";
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
    if (ui.locationHighlight[field] < 0) return;
    selectLocationSuggestion(field, ui.locationHighlight[field]);
    persist("Updated");
    return;
  }
  refreshLocationPanel();
}

function selectLocationSuggestion(field, index) {
  const suggestion = ui.locationSuggestions[field]?.[index];
  if (!suggestion) return;
  ui.touchedBasicsFields.add(field);
  if (field === "placesInMind" || field === "mustDoPlaces") {
    addVerifiedPlaceTag(field, suggestion);
    return;
  }
  const hadApprovedRoute = (field === "from" || field === "destination") && Boolean(state.trip.approvedTripShape);
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
  if (hadApprovedRoute) {
    resetRouteApproval(state.trip);
    ui.toast = "Your approved route was reset because trip details changed. Re-approve it before building your trip.";
  }
  ui.activeLocationField = null;
  ui.locationSuggestions[field] = [];
  ui.locationHighlight[field] = -1;
}

// Places Already in Mind / Must-do Places are stored as the same
// comma-joined string splitList() already expects downstream (see
// route-architecture.js) -- only the INPUT experience changes. Appending a
// verified suggestion's real canonical name (not whatever the traveler
// typed) is what stops a short or misspelled name from ever reaching
// regional-extension research as ambiguous free text in the first place.
//
// The stored name must NOT contain a comma: this string is re-split on
// commas both here (for chip rendering) and by splitList() downstream, so a
// full "City, State, Country" name would get shredded into multiple bogus
// entries (confirmed live: "Asheville, North Carolina, United States" became
// three separate chips -- "Asheville", "North Carolina", "United States" --
// with "North Carolina" then feeding the route planner as a fake hotel
// base). Use the suggestion's bare place name instead; the location-bias fix
// already makes short names resolve correctly when re-geocoded downstream.
function addVerifiedPlaceTag(field, suggestion) {
  const rawName = String(suggestion.city || suggestion.normalizedName || suggestion.displayName || "").trim();
  const name = rawName.split(",")[0].trim();
  if (!name) return;
  const prefs = state.trip.routePreferences;
  const existing = String(prefs[field] || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  const verifiedKey = `${field}Verified`;
  const locationsKey = `${field}Locations`;
  prefs[verifiedKey] ||= [];
  prefs[locationsKey] ||= {};
  if (!existing.some((item) => item.toLowerCase() === name.toLowerCase())) {
    existing.push(name);
    prefs[field] = existing.join(", ");
  }
  if (!prefs[verifiedKey].includes(name)) prefs[verifiedKey].push(name);
  // Without a real coordinate, the route-shape recommender falls back to a
  // blind guess (see inferDriveMinutes in route-architecture.js) that can be
  // wildly wrong for anything it doesn't specifically recognize -- confirmed
  // live: "Lake Norman" (a ~25 minute drive from Charlotte, effectively the
  // same metro area) got guessed at 90 minutes and proposed as its own
  // multi-city hotel base instead of a same-base day trip. A verified
  // suggestion already carries a real geocoded location, so save it for the
  // recommender to use instead of guessing.
  if (Number.isFinite(suggestion.latitude) && Number.isFinite(suggestion.longitude)) {
    prefs[locationsKey][name] = { lat: suggestion.latitude, lng: suggestion.longitude };
  }
  const hadApprovedRoute = Boolean(state.trip.approvedTripShape);
  if (hadApprovedRoute) {
    resetRouteApproval(state.trip);
    ui.toast = "Your approved route was reset because trip details changed. Re-approve it before building your trip.";
  }
  ui.placeTagDraft[field] = "";
  ui.activeLocationField = null;
  ui.locationSuggestions[field] = [];
  ui.locationHighlight[field] = -1;
}

function removePlaceTag(field, index) {
  const prefs = state.trip.routePreferences;
  const existing = String(prefs[field] || "").split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  const [removed] = existing.splice(index, 1);
  prefs[field] = existing.join(", ");
  const verifiedKey = `${field}Verified`;
  const locationsKey = `${field}Locations`;
  if (removed) {
    prefs[verifiedKey] = (prefs[verifiedKey] || []).filter((item) => item.toLowerCase() !== removed.toLowerCase());
    if (prefs[locationsKey]) delete prefs[locationsKey][removed];
  }
  if (state.trip.approvedTripShape) {
    resetRouteApproval(state.trip);
    ui.toast = "Your approved route was reset because trip details changed. Re-approve it before building your trip.";
  }
}

function clearLocationField(field) {
  if (field === "placesInMind" || field === "mustDoPlaces") {
    clearTimeout(locationTimers[field]);
    ui.locationRequestId[field] = (ui.locationRequestId[field] || 0) + 1;
    ui.locationSuggestions[field] = [];
    ui.locationLoading[field] = false;
    ui.locationError[field] = "";
    ui.locationHighlight[field] = -1;
    ui.placeTagDraft[field] = "";
    if (ui.activeLocationField === field) ui.activeLocationField = null;
    return;
  }
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

function positionDatePickerOverlay() {
  const panel = document.querySelector("[data-date-picker-panel]");
  const path = ui.openDatePicker;
  const input = path ? document.querySelector(`[data-field="${CSS.escape(path)}"]`) : null;
  if (!panel || !input) return;
  if (window.matchMedia("(max-width: 760px)").matches) {
    panel.removeAttribute("style");
    return;
  }
  const rect = input.getBoundingClientRect();
  const padding = 12;
  const width = 264;
  const maxHeight = Math.min(360, window.innerHeight - padding * 2);
  const below = window.innerHeight - rect.bottom - padding;
  const above = rect.top - padding;
  const placeAbove = below < 300 && above > below;
  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${maxHeight}px`;
  panel.style.left = `${Math.min(Math.max(rect.left, padding), window.innerWidth - width - padding)}px`;
  panel.style.top = `${placeAbove ? Math.max(padding, rect.top - maxHeight - 8) : Math.min(rect.bottom + 8, window.innerHeight - maxHeight - padding)}px`;
}

// Number inputs' HTML min/max stop the native spinner and scroll-wheel-while-
// focused from going out of range in most browsers, but that's a UX nicety,
// not a guarantee -- confirmed live that scrolling over a number field could
// still drive it out of bounds (including negative). Clamp the committed
// value so these fields can never hold an invalid number regardless of how
// the browser's stepper behaves.
function clampInteger(value, min, max) {
  if (value === "" || !Number.isFinite(Number(value))) return value;
  return String(Math.min(max, Math.max(min, Math.round(Number(value)))));
}

function updateField(path, value) {
  if (path.startsWith("trip.")) ui.touchedBasicsFields.add(path);
  if (path.startsWith("trip.") && state.plan) state.planStale = true;
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
  } else if (path === "ui.experienceSearch") {
    ui.experienceSearch = value;
  } else if (path === "ui.foodSearch") {
    ui.foodSearch = value;
  } else if (path.startsWith("foodDraft.") && ui.foodDraft) {
    setPath(ui, path, value);
    if (path === "foodDraft.alcoholPrimary" && value === "No Alcohol") clearAlcoholFocusedSelections(ui.foodDraft.alcohol);
  } else if (path.startsWith("customStop.") && ui.customStopDraft) {
    if (path === "customStop.durationMinutes") value = clampInteger(value, 0, 720);
    if (path === "customStop.cost") value = clampInteger(value, 0, 5000);
    setPath(ui, path, value);
  } else if (path.startsWith("childAge.")) {
    setChildAge(Number(path.split(".")[1]), clampInteger(value, 0, 17));
  } else {
    if (path === "trip.adults") value = clampInteger(value, 1, 20);
    if (path === "trip.children") value = clampInteger(value, 0, 15);
    if (path === "trip.seniors") value = clampInteger(value, 0, 20);
    if (["trip.groupType", "trip.adults", "trip.children", "trip.seniors"].includes(path) && !canChangeTravelerCount(path, value)) {
      render();
      return;
    }
    if (path === "trip.days") value = clampInteger(value, 1, 60);
    if (path === "trip.schedule.majorActivities") value = clampInteger(value, 1, 8);
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
    if (routeRelevantField(path)) {
      const hadApprovedRoute = Boolean(state.trip.approvedTripShape);
      resetRouteApproval(state.trip);
      if (hadApprovedRoute) ui.toast = "Your approved route was reset because trip details changed. Re-approve it before building your trip.";
    }
  }
  persist();
}

function updateFieldDraft(path, value) {
  if (path.startsWith("trip.") || path.startsWith("childAge.")) ui.touchedBasicsFields.add(path);
  if (path.startsWith("trip.") && state.plan) state.planStale = true;
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
  if (routeRelevantField(path)) {
    const hadApprovedRoute = Boolean(state.trip.approvedTripShape);
    resetRouteApproval(state.trip);
    if (hadApprovedRoute) ui.toast = "Your approved route was reset because trip details changed. Re-approve it before building your trip.";
  }
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
    if (state.plan) state.planStale = true;
    const [, category, ...labelParts] = path.split(".");
    const label = labelParts.join(".");
    if (checked) addOrUpdatePreference(state.trip, category, label, "Nice to have");
    else {
      const pref = state.trip.preferences.find((item) => item.category === category && item.label === label);
      if (pref) removePreference(state.trip, pref.id);
    }
  } else if (path.startsWith("food.") || path.startsWith("alcohol.") || path.startsWith("lodging.") || path.startsWith("specialNeeds.")) {
    if (state.plan && !ui.foodDraft) state.planStale = true;
    const parts = path.split(".");
    const option = parts.pop();
    const root = ui.foodDraft && ui.openFoodSection && (path.startsWith("food.") || path.startsWith("alcohol.")) ? ui.foodDraft : state.trip;
    const target = parts.reduce((obj, part) => obj[part], root);
    if (!checked && option === "Other" && root.specialNeedsOtherText?.trim() && !confirm("Discard the Other special-need description?")) {
      render();
      return;
    }
    if (checked && !target.includes(option)) target.push(option);
    if (!checked && target.includes(option)) target.splice(target.indexOf(option), 1);
    if (!checked && path === "specialNeeds.Other") root.specialNeedsOtherText = "";
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
    if (state.plan) state.planStale = true;
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
  } else if (path.startsWith("customStop.") && ui.customStopDraft) {
    setPath(ui, path, checked);
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

async function buildTripPlanAction(name) {
  if (ui.generatingPlan) return;
  if (name !== "regeneratePlan" && routeRecommendationRequired(state.trip) && !approvedRouteStillValid(state.trip)) {
    state.activeStep = 4;
    state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
    state.trip.pendingRouteOptionId = state.trip.routeOptions.find((option) => option.recommended)?.id || state.trip.routeOptions[0]?.id || "";
    ui.toast = "Approve a route shape before building the detailed itinerary.";
    persist("Updated");
    return;
  }
  const blocking = blockingValidationIssues();
  if (blocking.length) {
    ui.showWarnings = true;
    ui.toast = describeBlockingIssues(blocking);
    persist("Updated");
    return;
  }
  ui.generatingPlan = true;
  ui.planAnnouncement = "Researching destination highlights and nearby day-trip options.";
  ui.toast = "Building your trip plan...";
  render();
  try {
    const destinationProfile = name !== "regeneratePlan" ? await ensureDestinationIntelligence() : null;
    ui.planAnnouncement = "Grouping nearby experiences, applying preferences, and scheduling your days.";
    render();
    const result = name === "regeneratePlan" && state.plan
      ? await routeMosaicApi.regeneratePlan(state.plan)
      : await routeMosaicApi.generateTrip(state.trip, destinationProfile, state.plan?.generationMetadata?.variationSeed || 0);
    if (result.status === "ready") {
      state.plan = result.plan;
      state.planStatus = "ready";
      state.planError = null;
      state.planStale = false;
      ui.planSection = "overview";
      ui.planAnnouncement = "Trip plan generated.";
      ui.toast = result.plan.generationMetadata.usesGenericDestinationProfile
        ? "Starter trip plan generated. Some destination intelligence is limited right now."
        : "Trip plan generated.";
    } else {
      state.planStatus = result.status;
      state.planError = result;
      ui.showWarnings = true;
      ui.toast = result.message || "Trip plan could not be generated yet.";
    }
  } catch (error) {
    state.planStatus = "";
    state.planError = error?.code ? { status: "error", code: error.code, message: error.message, retryable: error.retryable } : null;
    ui.showWarnings = true;
    ui.toast = error?.message || "Trip plan could not be generated yet.";
    ui.planAnnouncement = "Trip generation stopped before a complete plan was created.";
  }
  ui.generatingPlan = false;
  persist("Updated");
}

async function ensureDestinationIntelligence() {
  try {
    const data = await routeMosaicApi.researchDestination(state.trip);
    const profile = registerGeneratedDestinationProfile(data.profile);
    if (!profile) throw new Error("Destination research did not return a usable profile.");
    return profile;
  } catch (error) {
    if (error?.code === "PROVIDER_CONFIGURATION_REQUIRED") throw new Error("Trip generation is temporarily unavailable. Please try again later. Your trip inputs are saved in the current session.");
    throw error instanceof Error ? error : new Error("Destination research is unavailable right now. Your trip details are preserved.");
  }
}

function action(name) {
  if (name === "goHome") {
    state.activeStep = 1;
    state.plan = null;
    state.planStatus = "";
    state.planStale = false;
    state.planError = null;
    state.savedTripsOpen = false;
  }
  if (name === "loadSampleTrip") {
    const hasMeaningfulData = Boolean(String(state.trip.from || state.trip.destination || state.trip.description || "").trim() || state.trip.preferences.length || state.trip.food.diet.length || state.trip.food.restrictions.length);
    if (hasMeaningfulData && !confirm("Load the sample trip and replace your current unsaved entries?")) return;
    state.trip = createSampleLosAngelesTrip();
    state.activeStep = 1;
    state.plan = null;
    state.planStatus = "";
    state.planStale = false;
    ui.toast = "Sample Los Angeles trip loaded.";
  }
  if (name === "clearSampleTrip") {
    if (!confirm("Clear the sample and start fresh?")) return;
    state.trip = structuredClone(initialState.trip);
    migrateTripState(state.trip);
    syncTravelersToCounts(state.trip);
    state.activeStep = 1;
    state.plan = null;
    state.planStatus = "";
    ui.toast = "Sample cleared.";
  }
  if (name === "useSampleDescription") {
    const existing = String(state.trip.description || "").trim();
    if (existing && existing !== TRIP_DESCRIPTION_SAMPLE && !confirm("Replace the existing trip description with the sample?")) return;
    state.trip.description = TRIP_DESCRIPTION_SAMPLE;
    state.trip.originalText = TRIP_DESCRIPTION_SAMPLE;
    ui.interpretationError = "";
    ui.toast = "Sample description added.";
  }
  if (name === "toggleSavedTrips") state.savedTripsOpen = !state.savedTripsOpen;
  if (name.startsWith("openSavedTrip:")) {
    const record = readSavedTrips().find((item) => item.id === name.split(":")[1]);
    if (record) {
      state.trip = structuredClone(record.trip);
      migrateTripState(state.trip);
      syncTravelersToCounts(state.trip);
      state.preview = structuredClone(record.preview || null);
      state.plan = structuredClone(record.plan || null);
      state.planStatus = state.plan ? "ready" : "";
      state.activeStep = Math.min(4, record.activeStep || 1);
      state.savedTripsOpen = false;
      ui.toast = "Saved trip opened.";
    }
  }
  if (name.startsWith("deleteSavedTrip:")) {
    const id = name.split(":")[1];
    if (!confirm("Delete this locally saved trip?")) return;
    writeSavedTrips(readSavedTrips().filter((item) => item.id !== id));
    ui.toast = "Saved trip deleted.";
  }
  if (name.startsWith("duplicateSavedTrip:")) {
    const record = readSavedTrips().find((item) => item.id === name.split(":")[1]);
    if (record) {
      const copy = structuredClone(record);
      copy.id = uid("saved");
      copy.name = `${record.name} copy`;
      copy.savedAt = new Date().toISOString();
      copy.updatedAt = new Date().toISOString();
      copy.trip.id = uid("trip");
      writeSavedTrip(copy);
      ui.toast = "Saved trip duplicated.";
    }
  }
  if (name.startsWith("renameSavedTrip:")) {
    const id = name.split(":")[1];
    const records = readSavedTrips();
    const record = records.find((item) => item.id === id);
    if (record) {
      const next = prompt("Rename saved trip", record.name);
      if (next && next.trim()) {
        record.name = next.trim().slice(0, 80);
        record.updatedAt = new Date().toISOString();
        writeSavedTrips(records);
        ui.toast = "Saved trip renamed.";
      }
    }
  }
  if (name === "openPrintOptions") ui.planDialog = "print";
  if (name.startsWith("togglePrintSection:")) {
    const key = name.split(":")[1];
    if (ui.printSections.has(key)) ui.printSections.delete(key);
    else ui.printSections.add(key);
  }
  if (name === "confirmPrint" && ui.printSections.size) {
    ui.planDialog = null;
    requestAnimationFrame(() => window.print());
  }
  if (name.startsWith("planSection:")) ui.planSection = name.split(":")[1];
  if (name === "editPreferences") {
    state.planStatus = "";
    state.activeStep = 4;
    ui.toast = state.planStale ? "Existing plan is based on older preferences. Regenerate when ready." : "Preferences are ready to edit.";
  }
  if (name === "editUnsupportedDestination") {
    state.planStatus = "";
    state.planError = null;
    state.activeStep = 1;
    ui.toast = "Edit the destination, then build again.";
  }
  if (name === "returnToReview") {
    state.planStatus = "";
    state.planError = null;
    state.activeStep = 4;
  }
  if (name.startsWith("jumpToDay:")) {
    ui.planSection = "itinerary";
    requestAnimationFrame(() => document.getElementById(name.split(":")[1])?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  if (name.startsWith("openReplace:")) {
    ui.planDialog = "replace";
    ui.planDialogItemId = name.split(":")[1];
  }
  if (name.startsWith("openMove:")) {
    ui.planDialog = "move";
    ui.planDialogItemId = name.split(":")[1];
  }
  if (name === "openCustomStop") {
    ui.planDialog = "custom";
    ui.customStopDraft = defaultCustomStopDraft();
  }
  if (name === "closePlanDialog") {
    ui.planDialog = null;
    ui.planDialogItemId = "";
    ui.customStopDraft = null;
  }
  if (name.startsWith("replaceWith:")) {
    const [, itemId, placeId] = name.split(":");
    state.plan = replaceActivity(state.plan, itemId, placeId);
    ui.planDialog = null;
    ui.planAnnouncement = "Activity replaced and plan recalculated.";
  }
  if (name.startsWith("moveItem:")) {
    const [, itemId, direction] = name.split(":");
    state.plan = moveActivity(state.plan, itemId, direction);
    ui.planDialog = null;
    ui.planAnnouncement = "Activity moved and affected days recalculated.";
  }
  if (name === "saveCustomStop" && ui.customStopDraft) {
    state.plan = addCustomStop(state.plan, ui.customStopDraft);
    ui.planDialog = null;
    ui.customStopDraft = null;
    ui.planAnnouncement = "Custom stop added to the itinerary.";
  }
  if (name.startsWith("removeItem:")) {
    const itemId = name.split(":")[1];
    const item = state.plan?.days.flatMap((day) => day.scheduleItems).find((candidate) => candidate.id === itemId);
    if (item && (item.locked || item.mustDo) && !confirm("This item is locked or marked Must Do. Remove it anyway?")) return;
    state.plan = removeScheduleItem(state.plan, itemId);
    ui.planAnnouncement = "Item removed and schedule recalculated.";
  }
  if (name.startsWith("toggleItemLock:")) {
    state.plan = toggleItemLock(state.plan, name.split(":")[1]);
    ui.planAnnouncement = "Item lock state updated.";
  }
  if (name.startsWith("toggleMustDo:")) {
    state.plan = toggleItemMustDo(state.plan, name.split(":")[1]);
    ui.planAnnouncement = "Must Do state updated.";
  }
  if (name.startsWith("toggleDayLock:")) {
    state.plan = toggleDayLock(state.plan, name.split(":")[1]);
    ui.planAnnouncement = "Day lock state updated.";
  }
  if (name.startsWith("regenerateDay:")) {
    state.plan = regenerateDay(state.plan, name.split(":")[1]);
    ui.planAnnouncement = "Selected day regenerated while preserving locked and must-do items.";
  }
  if (name === "regenerateMeals") {
    state.plan = regenerateMeals(state.plan);
    ui.planAnnouncement = "Meals regenerated while activities stayed in place.";
  }
  if (name === "next") {
    const ownStepBlocking = reviewIssues().filter((issue) => issue.blocking && (issue.owningStep || 1) === state.activeStep);
    if (ownStepBlocking.length) {
      ui.showWarnings = true;
      ui.toast = describeBlockingIssues(ownStepBlocking.map((issue) => issue.issue));
      return persist("Updated");
    }
    state.activeStep = Math.min(4, state.activeStep + 1);
    if (state.activeStep === 4) {
      ui.openExperienceCategory = null;
      ui.experienceSearch = "";
      refreshProviderStatus();
      return;
    }
  }
  if (name === "prev") state.activeStep = Math.max(1, state.activeStep - 1);
  if (name === "next" || name === "prev") {
    ui.openExperienceCategory = null;
    ui.experienceSearch = "";
  }
  if (name === "continueBasics") {
    ui.basicsSubmitAttempted = true;
    const basicsBlocking = [...tripBasicsIssues(state.trip), ...locationVerificationIssues(state.trip)].filter((issue) => issue.blocking);
    if (basicsBlocking.length) {
      ui.showWarnings = true;
      ui.toast = describeBlockingIssues(basicsBlocking.map((issue) => issue.issue));
    } else {
      ensureRouteArchitecture(state.trip);
      state.activeStep = 2;
      ui.toast = "";
    }
  }
  if (name.startsWith("selectRouteOption:")) {
    state.trip.pendingRouteOptionId = name.split(":")[1];
    ui.toast = "Route option selected. Approve it to lock the trip shape.";
  }
  if (name.startsWith("approveRoute:")) {
    const id = name.split(":")[1] || state.trip.pendingRouteOptionId;
    approveRouteOption(state.trip, id);
    state.activeStep = 4;
    ui.toast = "Route approved. Detailed itinerary generation will use only this trip shape.";
  }
  if (name === "regenerateRouteOptions") {
    state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
    state.trip.pendingRouteOptionId = state.trip.routeOptions.find((option) => option.recommended)?.id || state.trip.routeOptions[0]?.id || "";
    state.trip.approvedTripShape = null;
    ui.toast = "Route options regenerated.";
  }
  if (name === "routeFewerHotels") {
    state.trip.routePreferences.maxHotelChanges = "0";
    state.trip.routePreferences.tripStructure = "one-base-day-trips";
    resetRouteApproval(state.trip);
    state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
    state.trip.pendingRouteOptionId = state.trip.routeOptions[0]?.id || "";
    ui.toast = "Route options now prioritize one hotel base.";
  }
  if (name === "routeLessDriving") {
    state.trip.routePreferences.maxTransferDriveTime = "2 hours";
    state.trip.routePreferences.maxDayTripDriveTime = "1 hour";
    resetRouteApproval(state.trip);
    state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
    state.trip.pendingRouteOptionId = state.trip.routeOptions[0]?.id || "";
    ui.toast = "Route options now reduce transfer and day-trip driving.";
  }
  if (name === "routeMoreVariety") {
    state.trip.routePreferences.tripStructure = "recommend";
    state.trip.routePreferences.openToNearbyCities = "Yes";
    if (state.trip.routePreferences.maxHotelChanges === "0") state.trip.routePreferences.maxHotelChanges = "1";
    resetRouteApproval(state.trip);
    state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
    state.trip.pendingRouteOptionId = state.trip.routeOptions[0]?.id || "";
    ui.toast = "Route options now compare broader variety.";
  }
  if (name === "routeKeepOneBase") {
    state.trip.routePreferences.tripStructure = "one-base-day-trips";
    state.trip.routePreferences.maxHotelChanges = "0";
    resetRouteApproval(state.trip);
    state.trip.routeOptions = generateRouteArchitectureOptions(state.trip);
    state.trip.pendingRouteOptionId = state.trip.routeOptions[0]?.id || "";
    ui.toast = "Route options now keep one hotel base.";
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
      if (field) (document.querySelector(`[data-field="${CSS.escape(field)}"]`) || document.querySelector(`[data-location-field="${CSS.escape(field.replace("trip.", ""))}"]`))?.focus();
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
  if (name.startsWith("removePlaceTag:")) {
    const [, field, index] = name.split(":");
    removePlaceTag(field, Number(index));
  }
  if (name === "closeLocationSuggestions") ui.activeLocationField = null;
  if (name === "closeDatePicker") ui.openDatePicker = null;
  if (name.startsWith("toggleDatePicker:")) {
    const path = name.slice("toggleDatePicker:".length);
    if (ui.openDatePicker === path) {
      ui.openDatePicker = null;
    } else {
      ui.openDatePicker = path;
      const current = path === "trip.startDate" ? state.trip.startDate : state.trip.endDate;
      const parsed = parseDateTextValue(current);
      ui.datePickerViewMonth = parsed ? { year: parsed.year, month: parsed.month } : todayDateParts();
    }
  }
  if (name.startsWith("datePickerNav:")) {
    const delta = Number(name.slice("datePickerNav:".length));
    const view = ui.datePickerViewMonth || todayDateParts();
    let { year, month } = view;
    month += delta;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    ui.datePickerViewMonth = { year, month };
  }
  if (name.startsWith("pickDate:")) {
    const [, path, value] = name.split(":");
    updateField(path, value);
    ui.openDatePicker = null;
    ui.datePickerViewMonth = null;
  }
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
  if (name === "openSpecialNeeds") ui.openSpecialNeeds = true;
  if (name === "closeSpecialNeeds") ui.openSpecialNeeds = false;
  if (name === "toggleWarnings") ui.showWarnings = !ui.showWarnings;
  if (name === "togglePreferences") ui.showPreferences = !ui.showPreferences;
  if (name === "togglePlanningPrinciples") {
    ui.planningPrinciplesOpen = !ui.planningPrinciplesOpen;
    ui.planningPrinciplesSuppressHover = false;
  }
  if (name === "refreshProviderStatus") {
    ui.toast = "Checking trip generation services...";
    refreshProviderStatus();
    return;
  }
  if (name === "saveExit") {
    saveExplicitDraft();
    ui.toast = "Draft saved.";
  }
  if (name === "saveProfile") saveProfile(state, `Profile ${state.profiles.length + 1}`, state.trip);
  if (name === "generatePreview") {
    const blocking = blockingValidationIssues();
    if (blocking.length) {
      ui.showWarnings = true;
      ui.toast = describeBlockingIssues(blocking);
    } else {
      state.preview = generatePlanPreview(state.trip);
      state.activeStep = 4;
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

if ("serviceWorker" in navigator) {
  let refreshingForServiceWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForServiceWorker) return;
    refreshingForServiceWorker = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("/sw.js").then((registration) => registration.update()).catch(() => {});
}
render();
