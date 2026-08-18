import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const agents = readFileSync("../AGENTS.md", "utf8");

[
  "PageHeaderIllustration",
  "TripBasicsHeaderGraphic",
  "TripStyleHeaderGraphic",
  "FoodEveningsHeaderGraphic",
  "ReviewHeaderGraphic"
].forEach((name) => assert.ok(app.includes(`function ${name}`) || app.includes(`${name},`), `${name} is part of the visual system`));
assert.ok(!app.includes("function TravelersHeaderGraphic"), "Travelers is no longer a standalone step");
assert.ok(!app.includes("function ComfortBudgetHeaderGraphic"), "Comfort and Budget is no longer a standalone step");

assert.ok(app.includes("${PageHeaderIllustration(state.activeStep)}"));
assert.ok(app.includes("SidebarScenicIllustration()"));
assert.ok(app.includes("src/assets/sidebar-lighthouse.png"));
assert.ok(app.includes("PlanningPrinciplesFooter()"));
assert.ok(app.includes("planningPrinciplesOpen"));
assert.ok(app.includes("planningPrinciplesSuppressHover"));
assert.ok(app.includes("togglePlanningPrinciples"));
assert.ok(app.includes("closePlanningPrinciplesOnOutsidePointer"));
assert.ok(app.includes("closePlanningPrinciples()"));
assert.ok(app.includes("focusPlanningPrinciples"));
assert.ok(!app.includes("class=\"side-note\""));
assert.ok(app.includes("stepSubtitles"));
assert.ok(app.includes("Where, when, and who"));
assert.ok(app.includes("Your travel vibe"));
assert.ok(app.includes("Taste and unwind"));
assert.ok(app.includes("Finalize and go"));
assert.ok(!app.includes("Who's coming"));
assert.ok(!app.includes("Travel your way"));
assert.ok(app.includes("stepNumber < state.activeStep"));
assert.ok(app.includes("class=\"step-subtitle\""));
assert.ok(app.includes("class=\"trip-context-icon\""));
assert.ok(app.includes("class=\"metric-icon\""));
assert.ok(app.includes("selected.length} selected"));

assert.ok(css.includes(".page-header-illustration"));
assert.ok(css.includes(".steps button.active { background: linear-gradient"));
assert.ok(css.includes(".steps button.complete span { background: #2bb673"));
assert.ok(css.includes(".sidebar-scenic-illustration"));
assert.ok(css.includes(".planning-principles-trigger"));
assert.ok(css.includes("max-height: 44px"));
assert.ok(css.includes(".planning-popover"));
assert.ok(css.includes(".planning-principles.hover-open:not(.suppress-hover)"));
assert.ok(!css.includes(".side-note"));
assert.ok(css.includes(".trip-context-icon"));
assert.ok(css.includes(".metric-icon"));
assert.ok(css.includes(".wizard-footer { position: sticky"));
assert.ok(css.includes(".issues-card"));
assert.ok(css.includes("@media (max-width: 760px)"));

assert.ok(agents.includes("reference images are the visual source of truth"));
assert.ok(agents.includes("presentation-only"));
assert.ok(agents.includes("top-right page illustration"));
assert.ok(agents.includes("screenshot-verified"));

console.log("Visual system tests passed");
