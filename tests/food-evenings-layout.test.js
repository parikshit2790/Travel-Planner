import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/app.js", "utf8");
const css = readFileSync("src/styles.css", "utf8");

const foodStep = app.match(/function foodStep\(\) \{([\s\S]*?)\nfunction foodSummaryRow/)?.[1] || "";
const foodOverlay = app.match(/function foodSectionOverlay\(\) \{([\s\S]*?)\nfunction createFoodDraft/)?.[1] || "";
const detailsCard = foodStep.match(/<section class="food-summary-card details-card">([\s\S]*?)<\/section>/)?.[1] || "";

assert.ok(foodStep.includes("Diet and Restrictions"));
assert.ok(foodStep.includes("Cuisine Interests"));
assert.ok(foodStep.includes("Meals"));
assert.ok(foodStep.includes("Evening Preferences"));
assert.ok(foodStep.includes("Food Planning Details"));
assert.ok(foodStep.includes("food-summary-layout"));
assert.ok(foodStep.includes("foodSummaryLine(\"Group Diet\""));
assert.ok(foodStep.includes("foodSummaryLine(\"Food Avoidances\""));
assert.ok(foodStep.includes("foodCuisinePreview(trip.food.cuisine"));
assert.ok(app.includes("function foodCuisinePreview"));
assert.ok(foodStep.includes("foodSummaryLine(\"Evening Activities\""));
assert.ok(foodStep.includes("foodSummaryLine(\"Drinks and Nightlife\""));

assert.ok(!foodStep.includes("Gluten-free"));
assert.ok(!foodStep.includes("Avoid spicy food"));
assert.ok(!foodStep.includes("Party-focused nightlife"));
assert.ok(!foodStep.includes("cuisine-tile-grid"));
assert.ok(!foodStep.includes("food-settings-bar"));
assert.ok(!foodStep.includes(">More<"));

assert.ok(detailsCard.includes("Food Budget per Person"));
assert.ok(detailsCard.includes("Drive for Food"));
assert.ok(detailsCard.includes("Reservations"));
assert.ok(!detailsCard.includes("Preferred Breakfast Time"));
assert.ok(!detailsCard.includes("Preferred Dinner Time"));
assert.ok(!detailsCard.includes("Alcohol Preference"));

assert.ok(foodOverlay.includes("Cancel"));
assert.ok(foodOverlay.includes("Save Selections"));
assert.ok(foodOverlay.includes("Clear All"));
assert.ok(foodOverlay.includes("No preference"));
assert.ok(foodOverlay.includes("Alcohol-Focused Recommendations"));
assert.ok(app.includes("function createFoodDraft"));
assert.ok(app.includes("function saveFoodDraft"));
assert.ok(app.includes("function clearFoodDraft"));
assert.ok(app.includes("clearAlcoholFocusedSelections(root.alcohol)"));

assert.ok(css.includes(".food-summary-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));"));
assert.ok(css.includes(".food-summary-card"));
assert.ok(css.includes(".cuisine-preview-grid"));
assert.ok(css.includes(".cuisine-add-card"));
assert.ok(css.includes(".food-summary-line"));
assert.ok(css.includes(".food-detail-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));"));
assert.ok(css.includes(".food-summary-layout { grid-template-columns: 1fr; }"));
assert.ok(css.includes(".meals-card table, .meals-card thead, .meals-card tbody, .meals-card tr, .meals-card td { display: block;"));

console.log("Food and evenings layout tests passed");
