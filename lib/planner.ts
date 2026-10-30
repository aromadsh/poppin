import { forecastQueues, type QueueForecast } from "./forecast";

export type Input = {
  places: { name: string; genre: string; address: string; stayMinutes: number; reservation?: { date: string; time: string; confirmed: true } }[];
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  preferences: string;
};

export type PlaceEvidence = {
  index: number;
  matched: boolean;
  status: "verified" | "past" | "unconfirmed" | "not_found";
  eventStart: string | null;
  eventEnd: string | null;
  hours: { date: string; open: string; close: string; lastEntry?: string | null }[];
  admission?: { reservation: "not_required" | "available" | "required_unknown" | "sold_out" | "unknown"; lastEntry: string | null; note: string; sourceUrl?: string | null };
  lat: number | null;
  lng: number | null;
  value: string;
  summary: string;
  queue: { date: string; time: string; min: number; max: number; sourceUrl: string; kind: "observed" | "estimate" }[];
  sources: { title: string; url: string; publishedAt: string | null; matched: boolean; note: string }[];
};

export type Stop = {
  index: number;
  name: string;
  address: string;
  arrival: string;
  departure: string;
  travelMinutes: number;
  waitMin: number;
  waitMax: number;
  waitKnown: boolean;
  waitKind?: "observed" | "forecast" | "unknown";
  stayMinutes: number;
};
export type DayPlan = {
  date: string;
  stops: Stop[];
  totalMinutes: number;
  totalTravelMinutes: number;
  totalWaitMin: number;
  totalWaitMax: number;
  score: number;
  complete: boolean;
};
export type ReservationCandidate = {
  index: number;
  name: string;
  address: string;
  stayMinutes: number;
  note: string;
  sourceUrl: string | null;
  windows: { date: string; from: string; to: string; lastEntry: string | null }[];
};
export type PlanResult = { days: DayPlan[]; reservationCandidates: ReservationCandidate[]; excluded: { index: number; reason: string }[]; notes: string[] };

const DAY = 86_400_000;
function seoulNow(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("현재 날짜를 확인할 수 없습니다.");
  const local = new Date(now.getTime() + 9 * 60 * 60_000);
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() + (local.getUTCSeconds() || local.getUTCMilliseconds() ? 1 : 0) };
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function minutes(value: unknown, allowMidnight = false): number {
  if (allowMidnight && value === "24:00") return 1440;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function textField(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new Error(`${label}: ${min}~${max}자로 입력해 주세요.`);
  return value.trim();
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateInput(raw: unknown, now = new Date()): Input {
  if (!record(raw)) throw new Error("방문 조건을 올바르게 입력해 주세요.");
  if (!Array.isArray(raw.places) || raw.places.length < 1 || raw.places.length > 3) throw new Error("팝업은 1~3곳을 입력해 주세요.");
  const places = raw.places.map((place, index) => {
    if (!record(place)) throw new Error(`${index + 1}번째 팝업 정보를 확인해 주세요.`);
    if (!Number.isInteger(place.stayMinutes) || (place.stayMinutes as number) < 10 || (place.stayMinutes as number) > 240) throw new Error("체류시간은 10~240분 사이의 정수로 입력해 주세요.");
    let reservation: Input["places"][number]["reservation"];
    if (place.reservation !== undefined) {
      const r = place.reservation;
      if (!record(r) || r.confirmed !== true || !validDate(r.date) || !Number.isFinite(minutes(r.time))) throw new Error("예약 날짜·시간과 본인 확인을 완료해 주세요.");
      if (typeof raw.dateFrom !== "string" || typeof raw.dateTo !== "string" || r.date < raw.dateFrom || r.date > raw.dateTo) throw new Error("예약 날짜가 방문 기간 안에 있어야 합니다.");
      reservation = { date: r.date, time: r.time as string, confirmed: true };
    }
    return { name: textField(place.name, "팝업 이름", 1, 100), genre: textField(place.genre, "장르", 0, 80), address: textField(place.address, "주소", 1, 240), stayMinutes: place.stayMinutes as number, ...(reservation ? { reservation } : {}) };
  });
  if (!validDate(raw.dateFrom) || !validDate(raw.dateTo)) throw new Error("방문 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.");
  if (raw.dateFrom < seoulNow(now).date) throw new Error("과거 날짜에는 일정을 추천할 수 없습니다. 한국 시간 기준 오늘 이후를 선택해 주세요.");
  if (raw.dateTo < raw.dateFrom) throw new Error("마지막 날짜는 시작 날짜 이후여야 합니다.");
  if ((Date.parse(raw.dateTo) - Date.parse(raw.dateFrom)) / DAY > 13) throw new Error("검색 기간은 시작일부터 최대 14일입니다.");
  const from = minutes(raw.timeFrom), to = minutes(raw.timeTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error("방문 시간은 HH:MM 형식으로, 종료 시간을 시작 시간 뒤로 설정해 주세요.");
  return { places, dateFrom: raw.dateFrom, dateTo: raw.dateTo, timeFrom: raw.timeFrom as string, timeTo: raw.timeTo as string, preferences: textField(raw.preferences, "추가 조건", 0, 1000) };
}

function sourceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}
function evidenceProblem(ev: PlaceEvidence | undefined, input: Input, reserved: boolean, forReservationCandidate = false): string | null {
  if (!ev || ev.status === "not_found") return "입력한 장소에 해당하는 운영 근거를 찾지 못했습니다.";
  if (ev.matched !== true) return "이름과 주소가 입력한 장소와 일치하는지 확인되지 않았습니다.";
  if (ev.status === "past") return "이미 종료된 행사입니다.";
  if (ev.status !== "verified") return "현재 행사 운영 여부가 확인되지 않았습니다.";
  if (!validDate(ev.eventStart) || !validDate(ev.eventEnd) || ev.eventEnd < ev.eventStart) return "명시된 행사 시작일과 종료일이 필요합니다.";
  if (ev.eventEnd < input.dateFrom) return "선택한 기간 전에 종료된 행사입니다.";
  if (ev.eventStart > input.dateTo) return "선택한 기간 이후에 시작하는 행사입니다.";
  if (!Array.isArray(ev.sources) || !ev.sources.some((source) => source.matched === true && sourceUrl(source.url))) return "이 장소와 일치하는 확인 출처가 없습니다.";
  if (!reserved && ev.admission?.reservation === "sold_out") return "입장 예약이 매진되었습니다. 이미 예약했다면 예약 내역을 본인 확인해 주세요.";
  if (!reserved && !forReservationCandidate && ev.admission?.reservation === "available") return "예약 가능 안내만 확인되었습니다. 이미 예약했다면 예약 내역을 본인 확인해 주세요.";
  if (!reserved && !forReservationCandidate && ev.admission?.reservation === "required_unknown") return "사전 예약이 필요합니다. 예약 내역을 본인 확인해 주세요.";
  if (!ev.admission || ev.admission.reservation === "unknown") return "예약·입장 조건이 확인되지 않았습니다.";
  if (!Array.isArray(ev.hours) || !ev.hours.some((hour) => validDate(hour.date) && hour.date >= input.dateFrom && hour.date <= input.dateTo && hour.date >= ev.eventStart! && hour.date <= ev.eventEnd! && Number.isFinite(minutes(hour.open)) && minutes(hour.close, true) > minutes(hour.open))) return "선택한 날짜에 명시된 영업시간이 없습니다.";
  return null;
}
function reservationCandidate(input: Input, ev: PlaceEvidence | undefined, current: ReturnType<typeof seoulNow>): ReservationCandidate | null {
  if (!ev || (ev.admission?.reservation !== "available" && ev.admission?.reservation !== "required_unknown") || evidenceProblem(ev, input, false, true)) return null;
  const place = input.places[ev.index];
  if (place.reservation) return null;
  const windows = new Map<string, ReservationCandidate["windows"][number]>();
  for (const hour of ev.hours) {
    if (!validDate(hour.date) || hour.date < input.dateFrom || hour.date > input.dateTo || hour.date < ev.eventStart! || hour.date > ev.eventEnd!) continue;
    const open = minutes(hour.open), close = minutes(hour.close, true);
    if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) continue;
    const from = Math.max(open, minutes(input.timeFrom), hour.date === current.date ? current.minute : 0);
    const to = Math.min(close, minutes(input.timeTo));
    const lastEntry = hour.lastEntry ?? ev.admission.lastEntry;
    const entry = lastEntry == null ? null : minutes(lastEntry, true);
    if (entry !== null && (!Number.isFinite(entry) || from > entry || (hour.lastEntry != null && (entry < open || entry > close)))) continue;
    if (from + place.stayMinutes > to) continue;
    const window = { date: hour.date, from: clock(from), to: clock(to), lastEntry: lastEntry ?? null };
    windows.set(JSON.stringify(window), window);
  }
  if (!windows.size) return null;
  const admissionSource = ev.admission.sourceUrl;
  const supportedSource = sourceUrl(admissionSource) && ev.sources.some(source => source.matched && source.url === admissionSource) ? admissionSource! : null;
  return { index: ev.index, name: place.name, address: place.address, stayMinutes: place.stayMinutes, note: ev.admission.note, sourceUrl: supportedSource, windows: [...windows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.lastEntry ?? "").localeCompare(b.lastEntry ?? "")) };
}
function coordinates(ev: PlaceEvidence) {
  return typeof ev.lat === "number" && Number.isFinite(ev.lat) && Math.abs(ev.lat) <= 90 && typeof ev.lng === "number" && Number.isFinite(ev.lng) && Math.abs(ev.lng) <= 180;
}
function walkingMinutes(a: PlaceEvidence, b: PlaceEvidence): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat! - a.lat!), dLng = rad(b.lng! - a.lng!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat!)) * Math.cos(rad(b.lat!)) * Math.sin(dLng / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return Math.ceil(km * 1.3 / 4 * 60);
}
function waitAt(ev: PlaceEvidence, date: string, arrival: number, forecasts: QueueForecast[]) {
  const urls = new Set(ev.sources.filter((s) => s.matched).map((s) => s.url));
  const observed = (Array.isArray(ev.queue) ? ev.queue : []).filter((q) => q.kind === "observed" && q.date === date && Number.isFinite(minutes(q.time)) && Math.abs(minutes(q.time) - arrival) <= 60 && Number.isFinite(q.min) && Number.isFinite(q.max) && q.min >= 0 && q.max >= q.min && q.max <= 720 && urls.has(q.sourceUrl));
  const predicted = forecasts.filter((q) => q.index === ev.index && q.date === date && Math.abs(minutes(q.time) - arrival) <= 60);
  const available = observed.length ? observed : predicted;
  if (!available.length) return { min: 0, max: 30, known: false, kind: "unknown" as const };
  const nearest = Math.min(...available.map((q) => Math.abs(minutes(q.time) - arrival)));
  const points = available.filter((q) => Math.abs(minutes(q.time) - arrival) === nearest);
  return { min: Math.floor(Math.min(...points.map((q) => q.min))), max: Math.ceil(Math.max(...points.map((q) => q.max))), known: true, kind: observed.length ? "observed" as const : "forecast" as const };
}
function routes(indices: number[]): number[][] {
  return indices.flatMap((index) => [[index], ...routes(indices.filter((i) => i !== index)).map((rest) => [index, ...rest])]);
}
function schedule(input: Input, evidence: Map<number, PlaceEvidence>, forecasts: QueueForecast[], route: number[], date: string, start: number): DayPlan | null {
  if (route.length > 1 && route.some((index) => !coordinates(evidence.get(index)!))) return null;
  let cursor = start;
  const stops: Stop[] = [];
  for (const index of route) {
    const place = input.places[index], ev = evidence.get(index)!;
    const reservation = place.reservation;
    if (reservation && reservation.date !== date) return null;
    if (date < ev.eventStart! || date > ev.eventEnd!) return null;
    const travel = stops.length ? walkingMinutes(evidence.get(stops[stops.length - 1].index)!, ev) : 0;
    const ready = cursor + travel;
    const hours = ev.hours.filter((h) => h.date === date && Number.isFinite(minutes(h.open)) && minutes(h.close, true) > minutes(h.open)).sort((a, b) => minutes(a.open) - minutes(b.open));
    let stop: Stop | undefined;
    for (const hour of hours) {
      const arrival = reservation ? minutes(reservation.time) : Math.max(ready, minutes(hour.open));
      if (arrival < ready || arrival < minutes(hour.open)) continue;
      const wait = waitAt(ev, date, arrival, forecasts);
      const departure = arrival + wait.max + place.stayMinutes;
      const lastEntry = hour.lastEntry ?? ev.admission?.lastEntry;
      const entryAllowed = lastEntry == null || (Number.isFinite(minutes(lastEntry, true)) && arrival + wait.max <= minutes(lastEntry, true));
      if (entryAllowed && departure <= Math.min(minutes(hour.close, true), minutes(input.timeTo))) {
        stop = { index, name: place.name, address: place.address, arrival: clock(arrival), departure: clock(departure), travelMinutes: travel, waitMin: wait.min, waitMax: wait.max, waitKnown: wait.known, waitKind: wait.kind, stayMinutes: place.stayMinutes };
        cursor = departure;
        break;
      }
    }
    if (!stop) return null;
    stops.push(stop);
  }
  const totalMinutes = cursor - minutes(stops[0].arrival);
  const totalTravelMinutes = stops.reduce((sum, stop) => sum + stop.travelMinutes, 0);
  const totalWaitMin = stops.reduce((sum, stop) => sum + stop.waitMin, 0);
  const totalWaitMax = stops.reduce((sum, stop) => sum + stop.waitMax, 0);
  // One unknown wait costs more than any time saving within a day; visit count still dominates.
  const score = stops.length * 100_000 - totalMinutes - totalTravelMinutes * 2 - totalWaitMax * 2 - stops.filter((stop) => !stop.waitKnown).length * 5000;
  return { date, stops, totalMinutes, totalTravelMinutes, totalWaitMin, totalWaitMax, score, complete: stops.length === input.places.length };
}

export function planVisits(raw: Input, allEvidence: PlaceEvidence[], now = new Date()): PlanResult {
  const input = validateInput(raw, now), current = seoulNow(now);
  const evidence = new Map<number, PlaceEvidence>();
  const problems = new Map<number, string>();
  const reservationCandidates: ReservationCandidate[] = [];
  input.places.forEach((_, index) => {
    const ev = allEvidence.find((item) => item.index === index);
    const candidate = reservationCandidate(input, ev, current);
    if (candidate) reservationCandidates.push(candidate);
    const problem = evidenceProblem(ev, input, Boolean(input.places[index].reservation));
    if (problem) problems.set(index, problem);
    else evidence.set(index, ev!);
  });
  const candidates = routes([...evidence.keys()]);
  const forecasts = forecastQueues(input, [...evidence.values()], now);
  const days: DayPlan[] = [];
  for (let stamp = Date.parse(input.dateFrom); stamp <= Date.parse(input.dateTo); stamp += DAY) {
    const date = new Date(stamp).toISOString().slice(0, 10);
    const from = Math.max(minutes(input.timeFrom), date === current.date ? current.minute : 0);
    const starts = [from];
    for (let start = Math.ceil(from / 30) * 30; start < minutes(input.timeTo); start += 30) {
      if (start !== from) starts.push(start);
    }
    let best: DayPlan | undefined;
    for (const start of starts) {
      if (start >= minutes(input.timeTo)) continue;
      for (const route of candidates) {
        const plan = schedule(input, evidence, forecasts, route, date, start);
        if (plan && (!best || plan.score > best.score || (plan.score === best.score && plan.stops[0].arrival < best.stops[0].arrival))) best = plan;
      }
    }
    if (best) days.push(best);
  }
  days.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  const selected = new Set(days[0]?.stops.map((stop) => stop.index) ?? []);
  const excluded = input.places.flatMap((_, index) => {
    if (selected.has(index)) return [];
    const missingCoordinates = evidence.has(index) && input.places.length > 1 && [...evidence.values()].some((ev) => !coordinates(ev));
    return [{ index, reason: problems.get(index) ?? (missingCoordinates ? "일부 장소의 좌표가 확인되지 않아 여러 장소의 이동 경로를 계산할 수 없습니다. 단독 방문만 표시합니다." : "선택한 날짜·영업시간·입장마감·방문 시간 안에 이동, 대기, 체류를 모두 넣을 수 없습니다.") }];
  });
  const notes = ["한국 시간 기준이며, 방문 가능한 장소 수를 먼저 비교한 뒤 대기 근거가 있는 방문 수, 이동·대기 시간 순서로 정렬합니다.", "도보 이동은 직선거리 × 1.3, 시속 4km로 계산한 예상치입니다. 첫 장소까지 이동시간은 포함하지 않습니다."];
  if (reservationCandidates.length) notes.push("예약 확인 후보는 확인된 영업시간과 방문 가능시간이 겹치는 범위입니다. 실제 예약 회차·잔여 좌석·입장 조건·혼잡도는 보장하지 않습니다. 공식 안내에서 체류시간에 맞는 회차를 확인하고 예약해야 합니다.");
  if (allEvidence.some((ev) => ev.admission?.reservation !== "not_required")) notes.push("예약이 필요한 장소는 예약 내역을 본인 확인한 경우에만 입력한 예약 날짜·시간으로 계산합니다. 입장 조건 미확인 장소는 제외합니다.");
  if (input.places.some(place => place.reservation)) notes.push("예약 날짜·시간은 사용자 본인 확인 정보입니다. 예약처의 실제 조회·인증 결과가 아니며 입장을 보장하지 않습니다.");
  if (days.some((day) => day.stops.some((stop) => !stop.waitKnown))) notes.push("대기 근거 미확인: 해당 날짜·도착 시각 ±60분 안의 관측이 없는 방문은 대기 30분을 임시 확보했습니다. 실제 대기를 보장하지 않습니다.");
  if (days.length && !days[0].complete) notes.push("모든 장소를 방문하는 일정이 성립하지 않아 가능한 일부 장소만 표시합니다. 제외 사유를 확인해 주세요.");
  if (days.some((day) => day.stops.some((stop) => stop.waitKind === "observed"))) notes.push("관측 대기는 같은 날짜의 가장 가까운 시각을 사용하고, 일정에는 관측 범위의 상한을 확보합니다. 이후 현장 상황은 달라질 수 있습니다.");
  if (days.some((day) => day.stops.some((stop) => stop.waitKind === "forecast"))) notes.push("미래 대기는 동일 행사·최근 21일·같은 평일/주말 조건의 2일 이상·3개 이상 관측을 넓힌 통계적 추정입니다. 일정에는 추정 상한을 확보하지만 실제 대기를 보장하지 않습니다. 관측 사실과 구분해 확인해 주세요.");
  if (!days.length) notes.push(reservationCandidates.length ? "확정 일정 대신 예약 확인 후보를 표시합니다. 예약 완료나 입장 가능 여부를 확인한 결과는 아닙니다." : "확인된 근거와 방문 조건을 함께 만족하는 일정이 없습니다. 영업시간을 추정해서 채우지 않았습니다.");
  return { days, reservationCandidates, excluded, notes };
}
