import test from "node:test";
import assert from "node:assert/strict";
import type { Input, PlaceEvidence } from "../lib/planner";

// Native Node type stripping resolves the actual TypeScript file at runtime.
const { validateInput, planVisits } = await import(new URL("../lib/planner.ts", import.meta.url).href) as typeof import("../lib/planner");
const now = new Date("2026-10-30T00:00:00Z");
function input(count = 1): Input {
  return { places: Array.from({ length: count }, (_, i) => ({ name: `팝업 ${i}`, genre: "캐릭터", address: `서울 성동구 ${i}`, stayMinutes: 60 })), dateFrom: "2026-10-30", dateTo: "2026-10-30", timeFrom: "10:00", timeTo: "18:00", preferences: "" };
}
function evidence(index = 0, overrides: Partial<PlaceEvidence> = {}): PlaceEvidence {
  return { index, matched: true, status: "verified", eventStart: "2026-10-01", eventEnd: "2026-11-30", hours: [{ date: "2026-10-30", open: "10:00", close: "18:00" }], admission: { reservation: "not_required", lastEntry: null, note: "예약 없이 현장 입장" }, lat: 37.54, lng: 127.05, value: "관심 굿즈", summary: "공식 운영 공지", queue: [], sources: [{ title: "공식 공지", url: "https://example.com/official", publishedAt: null, matched: true, note: "운영 확인" }], ...overrides };
}

test("예약 본인 확인은 예약 날짜와 시각에만 반영하고 운영 근거는 계속 요구한다", () => {
  const raw = input();
  Object.assign(raw.places[0], { reservation: { date: "2026-10-30", time: "13:00", confirmed: true } });
  const ev = evidence(0, { admission: { reservation: "required_unknown", lastEntry: null, note: "사전 예약 필수" } });
  const result = planVisits(raw, [ev], now);
  assert.equal(result.days[0]?.stops[0].arrival, "13:00");
  assert.equal(planVisits(raw, [{ ...ev, matched: false }], now).days.length, 0);
  Object.assign(raw.places[0], { reservation: { date: "2026-10-31", time: "13:00", confirmed: true } });
  assert.throws(() => validateInput(raw, now), /예약.*방문 기간/);
});

test("확인하지 않았거나 잘못된 예약 입력은 거부한다", () => {
  for (const reservation of [{ date: "2026-10-30", time: "25:00", confirmed: true }, { date: "2026-10-30", time: "13:00", confirmed: false }, { date: "2026-02-30", time: "13:00", confirmed: true }]) {
    const raw = input(); Object.assign(raw.places[0], { reservation });
    assert.throws(() => validateInput(raw, now), /예약/);
  }
});

test("예약 시각은 방문시간·영업시간·이동시간·행사 근거를 우회하지 않는다", () => {
  const raw = input();
  raw.places[0].reservation = { date: "2026-10-30", time: "13:00", confirmed: true };
  for (const ev of [evidence(0, { hours: [{ date: "2026-10-30", open: "14:00", close: "18:00" }] }), evidence(0, { admission: { reservation: "unknown", lastEntry: null, note: "미확인" } })]) {
    assert.equal(planVisits(raw, [ev], now).days.length, 0);
  }
  assert.equal(planVisits({ ...raw, timeFrom: "14:00" }, [evidence()], now).days.length, 0);
  const pair = input(2);
  pair.places.forEach(p => { p.reservation = { date: "2026-10-30", time: "13:00", confirmed: true }; });
  assert.equal(planVisits(pair, [evidence(), evidence(1)], now).days[0].stops.length, 1);
});

test("입력 경계와 서울 날짜를 검증하고 텍스트를 정리한다", () => {
  const raw = input(); raw.places[0].name = "  팝업  ";
  assert.equal(validateInput(raw, now).places[0].name, "팝업");
  for (const bad of [null, { ...input(), places: [] }, input(4), { ...input(), dateFrom: "2026-02-30" }, { ...input(), dateTo: "2026-11-13" }, { ...input(), timeTo: "09:00" }, { ...input(), preferences: "x".repeat(1001) }, { ...input(), places: [{ ...input().places[0], stayMinutes: 0 }] }]) {
    assert.throws(() => validateInput(bad, now), Error);
  }
  assert.throws(() => validateInput(input(), new Date("2026-10-30T16:00:00Z")), /과거/);
});

test("명시된 날짜별 영업시간 안에 체류와 미확인 대기 30분을 모두 넣는다", () => {
  const result = planVisits(input(), [evidence(0, { hours: [{ date: "2026-10-30", open: "12:00", close: "14:00" }] })], now);
  assert.equal(result.days.length, 1);
  assert.deepEqual(result.days[0].stops[0], { index: 0, name: "팝업 0", address: "서울 성동구 0", arrival: "12:00", departure: "13:30", travelMinutes: 0, waitMin: 0, waitMax: 30, waitKnown: false, waitKind: "unknown", stayMinutes: 60 });
  assert.equal(result.days[0].totalMinutes, 90);
  assert.ok(result.notes.some((note: string) => note.includes("30분") && note.includes("미확인")));
});

test("현재 시각 이전 방문과 영업 종료 뒤 체류를 추천하지 않는다", () => {
  const result = planVisits(input(), [evidence()], new Date("2026-10-30T07:01:00Z"));
  assert.equal(result.days[0].stops[0].arrival, "16:01");
  assert.equal(result.days[0].stops[0].departure, "17:31");
  assert.equal(planVisits(input(), [evidence()], new Date("2026-10-30T07:31:00Z")).days.length, 0);
});

test("과거 행사·다른 날짜 시간·출처 누락·장소 불일치는 추천에서 제외한다", () => {
  for (const bad of [evidence(0, { status: "past" }), evidence(0, { eventEnd: "2026-10-29" }), evidence(0, { eventStart: null }), evidence(0, { hours: [{ date: "2026-10-31", open: "10:00", close: "18:00" }] }), evidence(0, { sources: [] }), evidence(0, { matched: false }), evidence(0, { status: "unconfirmed" })]) {
    const result = planVisits(input(), [bad], now);
    assert.equal(result.days.length, 0);
    assert.equal(result.excluded[0].index, 0);
    assert.ok(result.excluded[0].reason.length > 0);
  }
  assert.equal(planVisits(input(), [], now).days.length, 0);
});

test("이동시간 때문에 불가능한 전체 경로는 부분 방문으로 표시한다", () => {
  const request = input(2); request.timeTo = "12:00";
  const result = planVisits(request, [evidence(), evidence(1, { lat: 35.17, lng: 129.07 })], now);
  assert.equal(result.days[0].complete, false);
  assert.equal(result.days[0].stops.length, 1);
  assert.equal(result.excluded.length, 1);
});

test("좌표 없는 장소는 단독 방문만 허용한다", () => {
  const result = planVisits(input(2), [evidence(), evidence(1, { lat: null, lng: null })], now);
  assert.equal(result.days[0].stops.length, 1);
  assert.equal(result.days[0].complete, false);
  assert.match(result.excluded[0].reason, /좌표/);
  assert.equal(planVisits(input(), [evidence(0, { lat: null, lng: null })], now).days[0].complete, true);
});

test("날짜가 맞는 관측 대기 상한을 사용해 방문 순서를 바꾼다", () => {
  const request = input(2); request.timeTo = "13:00";
  request.places.forEach((p) => { p.stayMinutes = 30; });
  request.places[1].stayMinutes = 60;
  const queue = (time: string, min: number, max: number) => ({ date: "2026-10-30", time, min, max, kind: "observed" as const, sourceUrl: "https://example.com/official" });
  const first = evidence(0, { queue: [queue("10:00", 90, 100), queue("11:00", 0, 0), queue("12:00", 90, 100)] });
  const second = evidence(1, { queue: [queue("10:00", 0, 0), queue("11:00", 90, 100), queue("12:00", 90, 100)] });
  const result = planVisits(request, [first, second], now);
  assert.deepEqual(result.days[0].stops.map((stop: { index: number }) => stop.index), [1, 0]);
  assert.equal(result.days[0].totalWaitMax, 0);
  assert.equal(result.days[0].complete, true);
});

test("다른 날짜·추정치·60분을 벗어난 관측은 대기 근거로 쓰지 않는다", () => {
  const result = planVisits(input(), [evidence(0, { queue: [
    { date: "2026-10-29", time: "10:00", min: 0, max: 0, kind: "observed", sourceUrl: "https://example.com/official" },
    { date: "2026-10-30", time: "10:00", min: 0, max: 0, kind: "estimate", sourceUrl: "https://example.com/official" },
    { date: "2026-10-30", time: "23:00", min: 0, max: 0, kind: "observed", sourceUrl: "https://example.com/official" },
  ] })], now);
  assert.equal(result.days[0].stops[0].waitKnown, false);
  assert.equal(result.days[0].totalWaitMax, 30);
});

test("정확한 날짜만 계획하고 점수가 높은 날짜를 먼저 제시한다", () => {
  const request = input(); request.dateTo = "2026-10-31";
  const ev = evidence(0, { hours: [{ date: "2026-10-30", open: "10:00", close: "18:00" }, { date: "2026-10-31", open: "10:00", close: "18:00" }], queue: [{ date: "2026-10-31", time: "10:00", min: 0, max: 0, kind: "observed", sourceUrl: "https://example.com/official" }] });
  const result = planVisits(request, [ev], now);
  assert.deepEqual(result.days.map((day: { date: string }) => day.date), ["2026-10-31", "2026-10-30"]);
  assert.ok(result.days[0].score > result.days[1].score);
});

test("대기 상한과 도보 이동을 포함한 연속 경로를 계산한다", () => {
  const request = input(2);
  const queue = [{ date: "2026-10-30", time: "11:00", min: 5, max: 20, kind: "observed" as const, sourceUrl: "https://example.com/official" }];
  const result = planVisits(request, [evidence(0, { queue }), evidence(1, { lat: 37.541, queue })], now);
  const day = result.days[0];
  assert.equal(day.complete, true);
  assert.equal(day.totalTravelMinutes, 3);
  assert.equal(day.stops[1].travelMinutes, 3);
  assert.ok(day.totalWaitMax >= day.totalWaitMin);
  assert.ok(day.stops.every((stop: { arrival: string; departure: string }) => stop.arrival >= "10:00" && stop.departure <= "18:00"));
});

test("대기 하한만으로 마감 안에 들어오는 일정은 거절한다", () => {
  const request = input(); request.timeTo = "11:15";
  const result = planVisits(request, [evidence(0, { queue: [{ date: "2026-10-30", time: "10:00", min: 0, max: 30, kind: "observed", sourceUrl: "https://example.com/official" }] })], now);
  assert.equal(result.days.length, 0);
});

test("휴게시간을 건너뛰어 다음 영업 구간에서 체류한다", () => {
  const result = planVisits(input(), [evidence(0, { hours: [{ date: "2026-10-30", open: "10:00", close: "11:00" }, { date: "2026-10-30", open: "13:00", close: "16:00" }] })], now);
  assert.equal(result.days[0].stops[0].arrival, "13:00");
  assert.equal(result.days[0].stops[0].departure, "14:30");
});

test("30분 경계 전의 정확한 시작시각을 후보에 포함한다", () => {
  const request = input(); request.timeFrom = "10:10"; request.timeTo = "10:55"; request.places[0].stayMinutes = 10;
  const result = planVisits(request, [evidence()], now);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].stops[0].arrival, "10:10");
  assert.equal(result.days[0].stops[0].departure, "10:50");
});

test("예약이 필요하거나 입장 조건이 불명인 장소는 확정 일정에서 제외한다", () => {
  for (const reservation of ["available", "required_unknown", "sold_out", "unknown"] as const) {
    const result = planVisits(input(), [evidence(0, { admission: { reservation, lastEntry: null, note: "예약 조건" } })], now);
    assert.equal(result.days.length, 0, reservation);
    assert.match(result.excluded[0].reason, /예약|입장/);
  }
  assert.equal(planVisits(input(), [evidence(0, { admission: undefined })], now).days.length, 0);
});

test("입장마감에 대기 상한을 포함하고 날짜별 마감을 우선한다", () => {
  const request = input(); request.timeFrom = "12:00"; request.timeTo = "14:00";
  const admission = { reservation: "not_required" as const, lastEntry: "12:20", note: "마지막 입장" };
  assert.equal(planVisits(request, [evidence(0, { admission })], now).days.length, 0);
  admission.lastEntry = "12:30";
  assert.equal(planVisits(request, [evidence(0, { admission })], now).days.length, 1);
  const ev = evidence(0, { admission, hours: [{ date: "2026-10-30", open: "12:00", close: "14:00", lastEntry: "12:20" }] });
  assert.equal(planVisits(request, [ev], now).days.length, 0);
  ev.hours[0].lastEntry = "잘못된 시간";
  assert.equal(planVisits(request, [ev], now).days.length, 0);
});

test("충분한 최근 관측이 있으면 미래 대기를 추정하고 상한을 확보한다", () => {
  const request = input(); request.dateFrom = request.dateTo = "2026-11-02"; request.timeFrom = "11:00"; request.timeTo = "13:00";
  const ev = evidence(0, { hours: [{ date: "2026-11-02", open: "11:00", close: "13:00" }], queue: [
    { date: "2026-10-28", time: "11:00", min: 10, max: 40, kind: "observed", sourceUrl: "https://example.com/official" },
    { date: "2026-10-28", time: "11:30", min: 10, max: 40, kind: "observed", sourceUrl: "https://example.com/official" },
    { date: "2026-10-29", time: "11:00", min: 10, max: 40, kind: "observed", sourceUrl: "https://example.com/official" },
  ] });
  const result = planVisits(request, [ev], now);
  assert.equal(result.days[0].stops[0].waitKind, "forecast");
  assert.equal(result.days[0].stops[0].waitKnown, true);
  assert.equal(result.days[0].totalWaitMax, 60);
  assert.equal(result.days[0].stops[0].departure, "13:00");
  assert.ok(result.notes.some((note) => note.includes("통계적 추정") && note.includes("보장")));
  ev.queue.push({ date: "2026-11-02", time: "11:00", min: 2, max: 5, kind: "observed", sourceUrl: "https://example.com/official" });
  const observed = planVisits(request, [ev], now);
  assert.equal(observed.days[0].stops[0].waitKind, "observed");
  assert.equal(observed.days[0].totalWaitMax, 5);
});

test("같은 방문 수에서는 미확인 30분을 짧은 대기로 간주해 근거 있는 추정보다 선호하지 않는다", () => {
  const request = input(); request.dateFrom = request.dateTo = "2026-11-02"; request.timeFrom = "11:00"; request.timeTo = "15:00";
  const ev = evidence(0, { hours: [{ date: "2026-11-02", open: "11:00", close: "15:00" }], queue: [
    { date: "2026-10-28", time: "11:00", min: 10, max: 40, kind: "observed", sourceUrl: "https://example.com/official" },
    { date: "2026-10-28", time: "11:30", min: 10, max: 40, kind: "observed", sourceUrl: "https://example.com/official" },
    { date: "2026-10-29", time: "11:00", min: 10, max: 40, kind: "observed", sourceUrl: "https://example.com/official" },
  ] });
  const day = planVisits(request, [ev], now).days[0];
  assert.equal(day.stops[0].waitKind, "forecast");
  assert.equal(day.stops[0].arrival, "11:00");
  assert.equal(day.totalWaitMax, 60);
  assert.equal(day.complete, true);
});
