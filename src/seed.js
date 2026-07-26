import { addOrUpdatePreference, calculateTripEndDate, createTripDraft, syncTravelersToCounts } from "./domain.js?v=50";

const trip = createTripDraft();

export const initialState = {
  activeStep: 1,
  trip,
  profiles: [],
  preview: null,
  lastSaved: null,
  savedTripsOpen: false,
  providerStatus: null
};

export function createSampleLosAngelesTrip(today = new Date()) {
  const sample = createTripDraft();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() + 60);
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  sample.from = "Charlotte, North Carolina";
  sample.fromDisplay = "Charlotte, North Carolina";
  sample.destination = "Los Angeles, California";
  sample.destinationDisplay = "Los Angeles, California";
  sample.days = 5;
  sample.startDate = startDate;
  sample.endDate = calculateTripEndDate(startDate, 5);
  sample.transportation = "Fly and rent a car";
  sample.description = "Sample Los Angeles trip with beaches, scenic viewpoints, culture, vegetarian-friendly food, quiet evenings, and one optional live-music night.";
  sample.originalText = sample.description;
  sample.adults = 2;
  sample.groupType = "Couple trip";
  sample.schedule.pace = "Balanced";
  sample.schedule.wakeUp = "8:00 AM";
  sample.schedule.earliestActivity = "9:00 AM";
  sample.schedule.majorActivities = 3;
  sample.schedule.freeTime = "2 hours";
  sample.schedule.latestReturn = "9:30 PM";
  sample.activity.walking = "Easy walking";
  sample.activity.hiking = "Easy hikes";
  sample.transport.maxDrivingDay = "4 hours";
  sample.transport.maxContinuous = "2 hours";
  sample.transport.routePreference = "Balanced";
  sample.food.diet = ["Vegetarian", "Chicken preferred"];
  sample.food.restrictions = ["Avoid beef"];
  sample.food.cuisine = ["Indian", "Italian", "Mexican", "Local cuisine", "Cafes"];
  sample.food.breakfast = "Hearty & filling";
  sample.food.lunch = "Flexible";
  sample.food.dinner = "Relaxed & indulgent";
  sample.food.foodBudgetPerPerson = "$15 - $30 per day";
  sample.food.driveForFood = "Short drives OK";
  sample.food.reservations = "Willing for must-do";
  sample.food.breakfastTime = "7:30 AM";
  sample.food.lunchTime = "12:30 PM";
  sample.food.dinnerTime = "6:30 PM";
  sample.alcohol.primary = "Occasional drinks";
  sample.alcohol.preferences = ["Quiet evening venues", "Evening walks", "Sunset activities", "Live music", "Occasional drinks"];
  sample.budget.style = "Moderate";
  sample.budget.total = "$1,500-$3,500";
  sample.budget.strictness = "Flexible";
  sample.lodging.styles = ["Hotel", "Free parking", "Free breakfast"];
  ["Beaches", "Scenic drives", "Photography", "Museums", "Architecture", "Food experiences", "Local culture", "Sunset"].forEach((label) => addOrUpdatePreference(sample, "experiences", label, label === "Beaches" ? "Strong preference" : "Nice to have", "Sample Trip"));
  syncTravelersToCounts(sample);
  sample.travelers[1].restrictions = ["Mobility limitation"];
  sample.sampleTrip = true;
  return sample;
}
