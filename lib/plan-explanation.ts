import type { DayPlan } from "./planner";

/** Arithmetic from the selected schedule, never an AI-generated reason or queue prediction. */
export function explainPlan(day: DayPlan) {
  const travel = day.stops.reduce((sum, stop) => sum + stop.travelMinutes, 0);
  const stay = day.stops.reduce((sum, stop) => sum + stop.stayMinutes, 0);
  const wait = day.stops.reduce((sum, stop) => sum + stop.waitMax, 0);
  const unknownWait = day.stops.filter(stop => !stop.waitKnown).reduce((sum, stop) => sum + stop.waitMax, 0);
  return { visits: day.stops.length, travel, stay, wait, unknownWait, openingGap: Math.max(0, day.totalMinutes - travel - stay - wait), total: day.totalMinutes };
}
