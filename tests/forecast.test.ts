import test from "node:test";
import assert from "node:assert/strict";
import type { Input, PlaceEvidence } from "../lib/planner";
const { forecastQueues } = await import(new URL("../lib/forecast.ts", import.meta.url).href) as typeof import("../lib/forecast");
const now = new Date("2026-10-30T03:00:00Z");
const input: Input = { places: [{ name: "테스트 팝업", genre: "전시", address: "서울 성동구", stayMinutes: 30 }], dateFrom: "2026-11-02", dateTo: "2026-11-02", timeFrom: "10:00", timeTo: "18:00", preferences: "" };
const url = "https://example.com/event";
const point = (date: string, time: string, min = 10, max = 40): PlaceEvidence["queue"][number] => ({ date, time, min, max, sourceUrl: url, kind: "observed" });
function evidence(): PlaceEvidence {
  return { index: 0, matched: true, status: "verified", eventStart: "2026-10-01", eventEnd: "2026-11-10", admission: { reservation: "not_required", lastEntry: null, note: "현장 입장" }, hours: [{ date: "2026-11-02", open: "10:00", close: "18:00" }], lat: 37.54, lng: 127.05, summary: "운영 확인", value: "전시", queue: [point("2026-10-28", "11:00"), point("2026-10-28", "11:30"), point("2026-10-29", "11:00")], sources: [{ title: "운영 공지", url, publishedAt: null, matched: true, note: "동일 행사" }] };
}

test("서로 다른 2일의 3개 관측으로 보수적인 미래 구간과 출처를 만든다", () => {
  const result = forecastQueues(input, [evidence()], now);
  const bin = result.find((item) => item.time === "11:00")!;
  assert.equal(bin.date, "2026-11-02");
  assert.equal(bin.sampleCount, 3);
  assert.equal(bin.dayCount, 2);
  assert.ok(bin.min <= 10 && bin.max >= 40);
  assert.equal(bin.latestObservation, "2026-10-29T11:00:00+09:00");
  assert.deepEqual(bin.sourceUrls, [url]);
  assert.equal(bin.confidence, "low");
  assert.match(bin.method, /평일/);
  assert.ok(result.every((item) => item.time >= "10:00" && item.time < "18:00"));
});

test("관측 수·서로 다른 날짜·주말 조건이 부족하면 추정하지 않는다", () => {
  const ev = evidence();
  ev.queue = ev.queue.slice(0, 2);
  assert.deepEqual(forecastQueues(input, [ev], now), []);
  ev.queue = [point("2026-10-28", "10:30"), point("2026-10-28", "11:00"), point("2026-10-28", "11:30")];
  assert.deepEqual(forecastQueues(input, [ev], now), []);
  const weekend = { ...input, dateFrom: "2026-10-31", dateTo: "2026-10-31" };
  ev.hours = [{ date: "2026-10-31", open: "10:00", close: "18:00" }];
  ev.queue = evidence().queue;
  assert.deepEqual(forecastQueues(weekend, [ev], now), []);
  ev.queue = [point("2026-10-24", "11:00"), point("2026-10-24", "11:30"), point("2026-10-25", "11:00")];
  assert.equal(forecastQueues(weekend, [ev], now).find((item) => item.time === "11:00")?.sampleCount, 3);
});

test("21일 밖·다른 행사 기간·미래 관측·검증 안 된 출처는 제외한다", () => {
  for (const invalid of [point("2026-10-01", "11:00"), point("2026-11-01", "11:00"), { ...point("2026-10-29", "11:00"), sourceUrl: "https://other.example/data" }, { ...point("2026-10-29", "11:00"), kind: "estimate" as const }]) {
    const ev = evidence(); ev.queue = [ev.queue[0], ev.queue[1], invalid];
    assert.deepEqual(forecastQueues(input, [ev], now), []);
  }
  const ev = evidence(); ev.eventStart = "2026-10-29";
  assert.deepEqual(forecastQueues(input, [ev], now), []);
  ev.eventStart = "2026-10-01"; ev.sources[0].matched = false;
  assert.deepEqual(forecastQueues(input, [ev], now), []);
});

test("같은 관측 복제로 표본 수를 늘리지 않는다", () => {
  const ev = evidence(); ev.queue = [ev.queue[0], ev.queue[0], ev.queue[2]];
  assert.deepEqual(forecastQueues(input, [ev], now), []);
});

test("행사 종료 후 또는 과거 날짜에 미래 추정을 만들지 않는다", () => {
  const ev = evidence(); ev.eventEnd = "2026-11-01";
  assert.deepEqual(forecastQueues(input, [ev], now), []);
  ev.eventEnd = "2026-11-10"; ev.hours = [{ date: "2026-10-29", open: "10:00", close: "18:00" }];
  assert.deepEqual(forecastQueues({ ...input, dateFrom: "2026-10-29", dateTo: "2026-10-29" }, [ev], now), []);
});

test("최근 3일 이상 6개 관측이 있을 때만 중간 신뢰도로 표시한다", () => {
  const ev = evidence();
  ev.queue = ["2026-10-27", "2026-10-28", "2026-10-29"].flatMap((date) => [point(date, "11:00"), point(date, "11:30")]);
  const bin = forecastQueues(input, [ev], now).find((item) => item.time === "11:00")!;
  assert.equal(bin.confidence, "medium");
  assert.equal(bin.sampleCount, 6);
  assert.equal(bin.dayCount, 3);
});
