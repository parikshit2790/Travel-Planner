import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { experienceCategories } from "../src/domain.js";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const agents = readFileSync("../AGENTS.md", "utf8");

const categories = Object.keys(experienceCategories);

assert.equal(categories.length, 8);
assert.deepEqual(categories, [
  "Nature and Scenery",
  "Outdoor Activities",
  "Water Experiences",
  "City and Culture",
  "Relaxation",
  "Entertainment",
  "Special Experiences",
  "Seasonal Experiences"
]);

assert.ok(app.includes("Experience Categories"));
assert.ok(app.includes("category-grid"));
assert.ok(app.includes("category-row"));
assert.ok(app.includes("category-count"));
assert.ok(app.includes("category-summary"));
assert.ok(app.includes("None selected"));
assert.ok(app.includes("experienceCategoryDescription"));
assert.ok(app.includes("Mountains, forests, lakes, vistas"));
assert.ok(app.includes("selected.length ? \"Edit\" : \"Add\""));
assert.ok(app.includes("openExperience:${esc(category)}"));
assert.ok(app.includes("title=\"${esc(selected.length ? fullSummary : experienceCategoryDescription(category))}\""));
assert.ok(!app.includes("category-table-wrap"));
assert.ok(!app.includes("<table class=\"category-table\""));

assert.ok(css.includes(".category-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));"));
assert.ok(css.includes(".category-grid { grid-template-columns: 1fr; }"));
assert.ok(css.includes(".category-row { min-width: 0; min-height: 60px;"));
assert.ok(css.includes(".category-row:hover"));
assert.ok(css.includes(".category-action"));
assert.ok(css.includes(".category-copy strong, .category-summary"));
assert.ok(css.includes(".category-nature .category-icon"));
assert.ok(css.includes(".category-count.empty-selection"));
assert.ok(css.includes("white-space: nowrap"));
assert.ok(!/category-[^{]*\{[^}]*max-height/s.test(css));
assert.ok(!/category-[^{]*\{[^}]*overflow-y:\s*auto/s.test(css));
assert.ok(!/category-[^{]*\{[^}]*overflow-y:\s*scroll/s.test(css));
assert.ok(!/category-table-wrap/.test(css));
assert.ok(!/ScrollArea|carousel|pagination|virtualized/i.test(app));

assert.ok(agents.includes("Small configuration lists must not use hidden internal scrolling"));
assert.ok(agents.includes("fewer than approximately 10 compact categories"));

console.log("Trip style categories layout tests passed");
