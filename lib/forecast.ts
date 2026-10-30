import type { Input, PlaceEvidence } from "./planner";

export type QueueForecast = {
  index: number;
  date: string;
  time: string;
  min: number;
  max: number;
  sampleCount: number;
  dayCount: number;
  latestObservation: string;
  sourceUrls: string[];
  confidence: "low" | "medium";
  method: string;
};

const DAY = 86_400_000;
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function minute(time: string, end = false) {
  if (end && time === "24:00") return 1440;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
}
function weekend(date: string) { return [0, 6].includes(new Date(date).getUTCDay()); }
function httpUrl(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

export function forecastQueues(input: Input, evidence: PlaceEvidence[], now = new Date()): QueueForecast[] {
  if (!Number.isFinite(now.getTime()) || !validDate(input.dateFrom) || !validDate(input.dateTo)) return [];
  const localNow = new Date(now.getTime() + 9 * 60 * 60_000);
  const today = localNow.toISOString().slice(0, 10), todayStamp = Date.parse(today);
  const nowMinute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const result: QueueForecast[] = [];
  for (const ev of evidence) {
    if (!input.places[ev.index] || ev.matched !== true || ev.status !== "verified" || !validDate(ev.eventStart) || !validDate(ev.eventEnd) || ev.eventEnd < ev.eventStart) continue;
    const urls = new Set(ev.sources.filter((s) => s.matched && httpUrl(s.url)).map((s) => s.url));
    const unique = new Map<string, PlaceEvidence["queue"][number]>();
    for (const q of ev.queue) {
      if (q.kind !== "observed" || !validDate(q.date) || q.date < ev.eventStart || q.date > ev.eventEnd || Date.parse(q.date) < todayStamp - 20 * DAY || q.date > today || !Number.isFinite(minute(q.time)) || (q.date === today && minute(q.time) > nowMinute) || !urls.has(q.sourceUrl) || !Number.isFinite(q.min) || !Number.isFinite(q.max) || q.min < 0 || q.max < q.min || q.max > 720) continue;
      const key = `${q.date}|${q.time}|${q.sourceUrl}`;
      const previous = unique.get(key);
      unique.set(key, previous ? { ...q, min: Math.min(previous.min, q.min), max: Math.max(previous.max, q.max) } : q);
    }
    const observed = [...unique.values()];
    for (let stamp = Date.parse(input.dateFrom), count = 0; stamp <= Date.parse(input.dateTo) && count < 14; stamp += DAY, count++) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      if (date < today || date < ev.eventStart || date > ev.eventEnd) continue;
      const bins = new Set<number>();
      for (const h of ev.hours.filter((h) => h.date === date)) {
        const open = minute(h.open), close = minute(h.close, true);
        if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) continue;
        for (let bin = Math.ceil(open / 60) * 60; bin < close; bin += 60) {
          if (date !== today || bin >= nowMinute) bins.add(bin);
        }
      }
      for (const bin of [...bins].sort((a, b) => a - b)) {
        const samples = observed.filter((q) => weekend(q.date) === weekend(date) && Math.abs(minute(q.time) - bin) <= 60);
        const dayCount = new Set(samples.map((q) => q.date)).size;
        if (samples.length < 3 || dayCount < 2) continue;
        const latest = samples.map((q) => `${q.date}T${q.time}:00+09:00`).sort().pop()!;
        const recent = todayStamp - Date.parse(latest.slice(0, 10)) <= 7 * DAY;
        result.push({
          index: ev.index, date, time: `${String(bin / 60).padStart(2, "0")}:00`,
          min: Math.max(0, Math.floor(Math.min(...samples.map((q) => q.min)) * 0.75 - 5)),
          max: Math.ceil(Math.max(...samples.map((q) => q.max)) * 1.25 + 10),
          sampleCount: samples.length, dayCount, latestObservation: latest,
          sourceUrls: [...new Set(samples.map((q) => q.sourceUrl))].sort(),
          confidence: samples.length >= 6 && dayCount >= 3 && recent ? "medium" : "low",
          method: `동일 행사·${weekend(date) ? "주말" : "평일"}·최근 21일·해당 정시 ±60분 관측. 최솟값×0.75−5분~최댓값×1.25+10분으로 확장한 통계적 추정이며 실제 대기를 보장하지 않습니다.`,
        });
      }
    }
  }
  return result.sort((a, b) => a.index - b.index || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
