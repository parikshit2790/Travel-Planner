import { createTripDraft } from "./domain.js";

const trip = createTripDraft();
trip.from = "Charlotte";
trip.fromDisplay = "Charlotte";
trip.destination = "Los Angeles";
trip.destinationDisplay = "Los Angeles";
trip.days = 5;
trip.startDate = "2026-08-20";
trip.endDate = "2026-08-25";
trip.adults = 2;
trip.groupType = "Couple trip";
trip.food.diet = ["Vegetarian", "Chicken preferred"];
trip.food.restrictions = ["Avoid beef", "Avoid pork", "Limited seafood"];
trip.food.cuisine = ["Indian", "Italian", "Mexican", "Local cuisine", "Cafes and bakeries"];
trip.food.breakfast = "Hearty & filling";
trip.food.lunch = "Flexible";
trip.food.dinner = "Relaxed & indulgent";
trip.food.foodBudgetPerPerson = "$15 - $30 per day";
trip.food.driveForFood = "Short drives OK";
trip.food.reservations = "Willing for must-do";
trip.food.breakfastTime = "7:30 - 8:30 AM";
trip.food.lunchTime = "12:30 - 1:30 PM";
trip.food.dinnerTime = "6:30 - 7:30 PM";
trip.alcohol.primary = "Occasional drinks";
trip.alcohol.preferences = ["Quiet evening venues", "Evening walks", "Sunset activities", "Occasional drinks", "Breweries"];

export const initialState = {
  activeStep: 1,
  trip,
  profiles: [],
  preview: null,
  lastSaved: null
};
