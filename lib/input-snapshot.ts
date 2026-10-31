import type { Input } from "./planner";

/** Compare values rather than object property order or form-only row metadata. */
export function sameInput(a: Input, b: Input | null) {
  const values = (input: Input) => [input.dateFrom, input.dateTo, input.timeFrom, input.timeTo, input.preferences,
    input.places.map(p => [p.name, p.address, p.genre, p.stayMinutes, p.reservation ? [p.reservation.date, p.reservation.time, p.reservation.confirmed] : null])];
  return b !== null && JSON.stringify(values(a)) === JSON.stringify(values(b));
}
