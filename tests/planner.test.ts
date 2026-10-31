import test from "node:test";
import assert from "node:assert/strict";
import type { Input, PlaceEvidence } from "../lib/planner";
import { explainPlan } from "../lib/plan-explanation";

// Native Node type stripping resolves the actual TypeScript file at runtime.
const { validateInput, planVisits } = await import(new URL("../lib/planner.ts", import.meta.url).href) as typeof import("../lib/planner");
const { forecastQueues } = await import(new URL("../lib/forecast.ts", import.meta.url).href) as typeof import("../lib/forecast");
const now = new Date("2026-10-30T00:00:00Z");
function input(count = 1): Input {
  return { places: Array.from({ length: count }, (_, i) => ({ name: `팝업 ${i}`, genre: "캐릭터", address: `서울 성동구 ${i}`, stayMinutes: 60 })), dateFrom: "2026-10-30", dateTo: "2026-10-30", timeFrom: "10:00", timeTo: "18:00", preferences: "" };
}
function evidence(index = 0, overrides: Partial<PlaceEvidence> = {}): PlaceEvidence {
  return { index, matched: true, status: "verified", eventStart: "2026-10-01", eventEnd: "2026-11-30", hours: [{ date: "2026-10-30", open: "10:00", close: "18:00" }], admission: { reservation: "not_required", lastEntry: null, note: "예약 없이 현장 입장" }, lat: 37.54, lng: 127.05, value: "관심 굿즈", summary: "공식 운영 공지", queue: [], sources: [{ title: "공식 공지", url: "https://example.com/official", publishedAt: null, matched: true, note: "운영 확인" }], ...overrides };
}

test("입력한 예약은 예약 날짜와 시각에만 반영하고 운영 근거는 계속 요구한다", () => {
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

test("행사를 찾았어도 영업시간이 없으면 검색 실패와 구분해 제외한다", () => {
  const result = planVisits(input(), [evidence(0, { hours: [], admission: { reservation: "unknown", lastEntry: null, note: "미확인" } })], now);
  assert.equal(result.days.length, 0);
  assert.match(result.excluded[0].reason, /행사는 확인.*영업시간/);
});

test("확인되지 않은 장소 후보는 다른 필드가 verified여도 일정을 생성하지 않는다", () => {
  for (const locationStatus of ["ambiguous", "mismatch", "unknown"] as const) {
    const result = planVisits(input(), [evidence(0, { identity: { name: "팝업 0", venue: "후보 행사장", address: null, locationStatus, note: "장소 근거 부족", sourceUrls: [] } })], now);
    assert.equal(result.days.length, 0);
    assert.match(result.excluded[0].reason, /장소|주소/);
  }
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

test("예약 제공·매진과 현장 입장 가능 여부를 독립적으로 처리한다", () => {
  for (const reservation of ["available", "sold_out", "unknown"] as const) {
    const ev = evidence(0, { admission: { reservation, lastEntry: null, note: "예약 정보", walkIn: { status: "available", note: "현장 접수 가능", sourceUrl: "https://example.com/official" } } });
    const result = planVisits(input(), [ev], now);
    assert.equal(result.days.length, 1, reservation);
    assert.equal(result.reservationCandidates.length, 0);
    assert.equal(result.conditionalDays.length, 0);
    assert.equal(result.days[0].stops[0].waitMax, 30);
    assert.equal(result.days[0].stops[0].waitKnown, false);
  }
});

test("예약 제공만으로 현장 입장을 허용하지 않고 예약 완료는 고정 시각을 지킨다", () => {
  const ev = evidence(0, { admission: { reservation: "available", lastEntry: null, note: "사전예약", walkIn: { status: "unavailable", note: "예약자만 입장", sourceUrl: "https://example.com/official" } } });
  const noBooking = planVisits(input(), [ev], now);
  assert.equal(noBooking.days.length, 0);
  assert.equal(noBooking.conditionalDays.length, 0);
  assert.equal(noBooking.reservationCandidates.length, 1);
  const request = input(); request.places[0].reservation = { date: "2026-10-30", time: "13:00", confirmed: true };
  const booked = planVisits(request, [ev], now);
  assert.equal(booked.days[0].stops[0].arrival, "13:00");
  request.timeFrom = "13:01";
  assert.equal(planVisits(request, [ev], now).days.length, 0);
});

test("입장 정책 미확인은 확정 일정과 분리된 조건부 일정으로만 표시한다", () => {
  const ev = evidence(0, { admission: { reservation: "unknown", lastEntry: "16:00", note: "정책 미확인" } });
  const result = planVisits(input(), [ev], now);
  assert.equal(result.days.length, 0);
  assert.equal(result.conditionalDays.length, 1);
  assert.equal(result.conditionalDays[0].conditional, true);
  assert.match(result.conditionalDays[0].stops[0].condition!, /입장 방법 미확인/);
  assert.equal(result.conditionalDays[0].stops[0].waitMax, 30);
  assert.equal(result.reservationCandidates.length, 0);
  assert.match(result.excluded[0].reason, /조건부/);
  const tooLate = input(); tooLate.timeFrom = "16:00";
  assert.equal(planVisits(tooLate, [ev], now).conditionalDays.length, 0);
});

test("행사·시간·출처·좌표 검증을 조건부 일정에서도 우회하지 않는다", () => {
  const unknown = evidence(0, { admission: undefined });
  for (const overrides of [{ hours: [] }, { matched: false }, { status: "unconfirmed" as const }, { status: "past" as const }, { sources: [] }, { eventEnd: "2026-10-29" }, { admission: { reservation: "unknown" as const, note: "미확인", lastEntry: null, invalidLastEntry: true as const } }]) {
    assert.equal(planVisits(input(), [{ ...unknown, ...overrides }], now).conditionalDays.length, 0);
  }
  const explicitNo = evidence(0, { admission: { reservation: "unknown", lastEntry: null, note: "미확인", walkIn: { status: "unavailable", note: "현장 불가", sourceUrl: "https://example.com/official" } } });
  assert.equal(planVisits(input(), [explicitNo], now).conditionalDays.length, 0);
  const mixed = planVisits(input(2), [evidence(), { ...unknown, index: 1, lat: null, lng: null }], now);
  assert.equal(mixed.days[0].stops.length, 1);
  assert.equal(mixed.conditionalDays[0].stops.length, 1);
  assert.equal(mixed.conditionalDays[0].stops[0].index, 1);
});

test("조건부 대안은 확정 일정을 대체하지 않으며 실제 계산값으로 시간을 설명한다", () => {
  const request = input(2);
  request.places[0].reservation = { date: "2026-10-30", time: "10:00", confirmed: true };
  const result = planVisits(request, [evidence(), evidence(1, { admission: undefined, hours: [{ date: "2026-10-30", open: "13:00", close: "18:00" }] })], now);
  assert.equal(result.days[0].stops.length, 1);
  assert.equal(result.conditionalDays[0].stops.length, 2);
  const day = result.conditionalDays[0], info = explainPlan(day);
  assert.equal(info.travel + info.stay + info.wait + info.openingGap, info.total);
  assert.equal(info.unknownWait, 60);
  assert.equal(info.visits, 2);
  assert.equal(info.openingGap, 90);
});

test("화면은 사전예약·현장 입장을 따로 표시하고 조건부 시각을 확정처럼 안내하지 않는다", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AdmissionSummary } = await import(new URL("../components/admission-summary.tsx", import.meta.url).href) as typeof import("../components/admission-summary");
  const { ConditionalPlans } = await import(new URL("../components/conditional-plans.tsx", import.meta.url).href) as typeof import("../components/conditional-plans");
  const mixed = evidence(0, { admission: { reservation: "sold_out", lastEntry: null, note: "예약 매진", walkIn: { status: "available", note: "현장 대기 가능", sourceUrl: "https://example.com/official" } } });
  const admissionHtml = renderToStaticMarkup(createElement(AdmissionSummary, { evidence: mixed }));
  assert.match(admissionHtml, /매진/);
  assert.match(admissionHtml, /가능 · 대기 별도/);
  assert.doesNotMatch(admissionHtml, /href=|현장 대기 가능/);
  const timed = evidence(0, { hours: [{ date: "2026-10-30", open: "11:00", close: "19:00", lastEntry: "18:00" }], admission: { reservation: "unknown", lastEntry: null, note: "네이버 사전예약 안내. 예약 10분 전 도착. 잔여 회차는 미확인." } });
  const compact = renderToStaticMarkup(createElement(AdmissionSummary, { evidence: timed, date: "2026-10-30" }));
  assert.match(compact, /11:00–19:00/);
  assert.match(compact, /18:00/);
  assert.match(compact, /예약 10분 전 도착/);
  assert.doesNotMatch(compact, /잔여 회차/);
  const otherDate = renderToStaticMarkup(createElement(AdmissionSummary, { evidence: timed, date: "2026-10-31" }));
  assert.doesNotMatch(otherDate, /11:00–19:00|18:00/);
  const qa = renderToStaticMarkup(createElement(AdmissionSummary, { evidence: mixed, diagnostics: true }));
  assert.match(qa, /현장 대기 가능|현장 입장 안내 출처/);
  assert.match(qa, /https:\/\/example.com\/official/);
  const result = planVisits(input(), [evidence(0, { admission: undefined })], now);
  const conditionalHtml = renderToStaticMarkup(createElement(ConditionalPlans, { days: result.conditionalDays }));
  assert.match(conditionalHtml, /방문 가능이 확인된 일정이 아닙니다/);
  assert.match(conditionalHtml, /입장 방법 미확인/);
  assert.match(conditionalHtml, /실제 대기시간 예측값이 아닙니다/);
  assert.equal(renderToStaticMarkup(createElement(ConditionalPlans, { days: [] })), "");
});

function reservationEvidence(overrides: Partial<PlaceEvidence> = {}): PlaceEvidence {
  return evidence(0, { admission: { reservation: "required_unknown", lastEntry: null, note: "전면 예약제 · 11월 4일 예약 오픈", sourceUrl: "https://example.com/official" }, ...overrides });
}

test("사쿠라 카페의 예약 미확인 8일을 확정 일정이나 혼잡도 대신 예약 확인 범위로 남긴다", () => {
  const request: Input = { places: [{ name: "카드캡터 사쿠라 콜라보 카페", genre: "캐릭터", address: "서울 성동구 서울숲 2길 43", stayMinutes: 60 }], dateFrom: "2026-11-11", dateTo: "2026-11-18", timeFrom: "10:00", timeTo: "19:00", preferences: "붐비는 시간을 피하고 싶어요" };
  const hours = Array.from({ length: 8 }, (_, i) => ({ date: `2026-11-${11 + i}`, open: "10:00", close: "19:00" }));
  const ev = reservationEvidence({ eventStart: "2026-11-11", eventEnd: "2026-11-29", hours, lat: null, lng: null });
  const result = planVisits(request, [ev], now);
  assert.deepEqual(result.days, []);
  assert.deepEqual(forecastQueues(request, [ev], now), []);
  assert.deepEqual(result.reservationCandidates, [{ index: 0, name: request.places[0].name, address: request.places[0].address, stayMinutes: 60, note: ev.admission!.note, sourceUrl: "https://example.com/official", windows: hours.map(h => ({ date: h.date, from: h.open, to: h.close, lastEntry: null })) }]);
  assert.match(result.excluded[0].reason, /예약/);
  assert.ok(result.notes.some(note => /예약.*후보/.test(note)));
  assert.ok(result.notes.some(note => /좌석/.test(note) && /입장/.test(note) && /혼잡/.test(note) && /보장하지/.test(note)));
  assert.ok(result.notes.every(note => !note.includes("확인된 근거와 방문 조건을 함께 만족하는 일정이 없습니다")));
});

test("예약 가능 안내도 예약 후보로만 남기고 현장 입장 일정과 분리한다", () => {
  const request = input(2);
  const reserved = reservationEvidence({ admission: { reservation: "available", lastEntry: null, note: "예약 가능 안내", sourceUrl: "https://example.com/official" } });
  const result = planVisits(request, [reserved, evidence(1)], now);
  assert.equal(result.reservationCandidates.length, 1);
  assert.equal(result.reservationCandidates[0].index, 0);
  assert.deepEqual(result.days[0].stops.map(stop => stop.index), [1]);
  assert.match(result.excluded[0].reason, /예약.*날짜/);
  assert.deepEqual(planVisits(input(), [evidence()], now).reservationCandidates, []);
});

test("입력한 예약은 지정 일시에만 계산하고 미예약 장소만 예약 후보로 남긴다", () => {
  const request = input(2); request.dateTo = "2026-10-31";
  request.places[0].reservation = { date: "2026-10-31", time: "13:00", confirmed: true };
  const hours = ["2026-10-30", "2026-10-31"].map(date => ({ date, open: "10:00", close: "18:00" }));
  const unreserved = reservationEvidence({ index: 1, hours });
  for (const reservation of ["available", "required_unknown", "sold_out"] as const) {
    const booked = reservationEvidence({ hours, admission: { reservation, lastEntry: null, note: "예약 입장" } });
    const result = planVisits(request, [booked, unreserved], now);
    assert.deepEqual(result.days.map(day => day.date), ["2026-10-31"], reservation);
    assert.deepEqual(result.days[0].stops.map(stop => [stop.index, stop.arrival]), [[0, "13:00"]], reservation);
    assert.deepEqual(result.reservationCandidates.map(candidate => candidate.index), [1], reservation);
    assert.deepEqual(result.reservationCandidates[0].windows.map(window => window.date), ["2026-10-30", "2026-10-31"]);
    const missed = planVisits({ ...request, timeFrom: "14:00" }, [booked, unreserved], now);
    assert.deepEqual(missed.days, [], reservation);
    assert.deepEqual(missed.reservationCandidates.map(candidate => candidate.index), [1], reservation);
  }
});

test("예약 후보도 행사 일치·기간·출처·영업시간 검증을 통과해야 한다", () => {
  const invalid: Partial<PlaceEvidence>[] = [
    ...(["unknown", "sold_out"] as const).map(reservation => ({ admission: { reservation, lastEntry: null, note: "입장 조건" } })),
    { admission: undefined }, { matched: false }, { status: "unconfirmed" }, { status: "not_found" }, { status: "past" },
    { eventStart: null }, { eventEnd: null }, { eventEnd: "2026-10-29" }, { eventStart: "2026-10-31" },
    { sources: [] }, { sources: [{ title: "관련 자료", url: "https://example.com/other", publishedAt: null, matched: false, note: "일치 미확인" }] },
    { hours: [] }, { hours: [{ date: "2026-10-31", open: "10:00", close: "18:00" }] }, { hours: [{ date: "2026-10-30", open: "18:00", close: "10:00" }] },
  ];
  for (const overrides of invalid) {
    const result = planVisits(input(), [reservationEvidence(overrides)], now);
    assert.deepEqual(result.days, []);
    assert.deepEqual(result.reservationCandidates, [], JSON.stringify(overrides));
    assert.equal(result.excluded.length, 1);
  }
});

test("예약 확인 범위는 실제 영업 구간과 방문 시간의 교집합이며 체류·현재 시각·입장마감을 지킨다", () => {
  const request = input(); request.timeFrom = "11:30"; request.timeTo = "16:00";
  const ev = reservationEvidence({ admission: { reservation: "required_unknown", lastEntry: "15:00", note: "예약 필수" }, hours: [
    { date: "2026-10-30", open: "13:00", close: "18:00", lastEntry: "14:30" },
    { date: "2026-10-30", open: "10:00", close: "12:00" },
    { date: "2026-10-30", open: "13:00", close: "18:00", lastEntry: "14:30" },
  ] });
  assert.deepEqual(planVisits(request, [ev], now).reservationCandidates[0].windows, [{ date: "2026-10-30", from: "13:00", to: "16:00", lastEntry: "14:30" }]);
  assert.deepEqual(planVisits(request, [ev], new Date("2026-10-30T05:01:01Z")).reservationCandidates[0].windows, [{ date: "2026-10-30", from: "14:02", to: "16:00", lastEntry: "14:30" }]);
  assert.deepEqual(planVisits(request, [ev], new Date("2026-10-30T05:31:00Z")).reservationCandidates, []);
  for (const lastEntry of ["12:59", "wrong", "19:00"]) {
    const invalid = reservationEvidence({ hours: [{ date: "2026-10-30", open: "13:00", close: "18:00", lastEntry }] });
    assert.deepEqual(planVisits(request, [invalid], now).reservationCandidates, [], lastEntry);
  }
  const exact = input(); exact.timeTo = "11:00";
  assert.deepEqual(planVisits(exact, [reservationEvidence()], now).reservationCandidates[0].windows, [{ date: "2026-10-30", from: "10:00", to: "11:00", lastEntry: null }]);
  exact.timeTo = "10:59";
  assert.deepEqual(planVisits(exact, [reservationEvidence()], now).reservationCandidates, []);
});

test("예약 후보의 링크는 실제로 일치한 안전한 입장 근거만 사용한다", () => {
  for (const sourceUrl of [undefined, null, "https://example.com/missing", "javascript:alert(1)"]) {
    const ev = reservationEvidence({ admission: { reservation: "required_unknown", lastEntry: null, note: "예약 필수", sourceUrl } });
    assert.equal(planVisits(input(), [ev], now).reservationCandidates[0].sourceUrl, null);
  }
  const ev = reservationEvidence(); ev.sources[0].matched = false;
  ev.sources.push({ ...evidence().sources[0], url: "https://example.com/event", matched: true });
  assert.equal(planVisits(input(), [ev], now).reservationCandidates[0].sourceUrl, null);
});

function sakuraPrediction(): NonNullable<PlaceEvidence["prediction"]> {
  const weekday = (hour: number) => hour === 10 ? { level: "low" as const, waitMin: 0, waitMax: 10 } : { level: "high" as const, waitMin: 20, waitMax: 40 };
  return {
    model: "gpt-6.1-sol", likelyStart: "2026-11-11", likelyEnd: "2026-11-29", hours: { open: "10:00", close: "20:00" }, admission: "reservation",
    crowd: [10, 11, 12, 13, 14, 15, 16, 17, 18].flatMap(hour => [{ day: "weekday" as const, hour, ...weekday(hour) }, { day: "weekend" as const, hour, level: "very_high" as const, waitMin: 40, waitMax: 90 }]),
    busyDates: [{ date: "2026-11-11", level: "very_high", reason: "오픈 첫날" }],
    bestVisits: [{ date: "2026-11-12", time: "10:00", reason: "오픈 다음 평일 첫 시간" }],
    rationale: "인기 IP 콜라보라 오픈 첫날과 주말이 붐빌 것으로 봅니다.", confidence: "low",
  };
}

test("근거를 찾지 못한 행사도 AI 예측으로 대략적인 일정을 따로 만들고 붐비지 않는 시간을 고른다", () => {
  const raw: Input = { places: [{ name: "카드캡터 사쿠라 콜라보 카페", genre: "캐릭터", address: "서울 성동구 서울숲2길 43", stayMinutes: 60 }], dateFrom: "2026-11-11", dateTo: "2026-11-18", timeFrom: "10:00", timeTo: "19:00", preferences: "분비는 시간은 피하고 싶어요." };
  const ev: PlaceEvidence = { index: 0, matched: false, status: "not_found", eventStart: null, eventEnd: null, hours: [], admission: { reservation: "unknown", lastEntry: null, note: "미확인" }, lat: null, lng: null, value: "확인된 정보 없음", summary: "근거 부족", queue: [], sources: [], prediction: sakuraPrediction() };
  const result = planVisits(raw, [ev], now);
  assert.equal(result.days.length, 0);
  assert.ok(result.aiDays.length > 0);
  const best = result.aiDays[0];
  assert.equal(best.aiPredicted, true);
  assert.equal(best.date, "2026-11-12");
  assert.deepEqual([best.stops[0].arrival, best.stops[0].waitKind, best.stops[0].crowdLevel, best.stops[0].aiPredicted], ["10:00", "ai", "low", true]);
  assert.match(best.stops[0].condition!, /AI 예측\(gpt-6\.1-sol, 신뢰도 낮음\).*행사 기간.*사전 예약 필요/);
  // The opening day and weekends rank below quiet weekdays.
  const order = result.aiDays.map(day => day.date);
  assert.ok(order.indexOf("2026-11-11") > order.indexOf("2026-11-13"));
  assert.ok(order.indexOf("2026-11-14") > order.indexOf("2026-11-13"));
  assert.ok(result.notes.some(note => note.includes("AI가 대략 예측")));
});

test("출처로 종료가 확인된 행사는 AI 예측으로도 되살리지 않고, 확정 일정이 있으면 AI 일정을 만들지 않는다", () => {
  const past = evidence(0, { status: "past", eventEnd: "2026-10-20", prediction: { ...sakuraPrediction(), likelyStart: "2026-10-01", likelyEnd: "2026-11-30" } });
  assert.deepEqual(planVisits(input(), [past], now).aiDays, []);
  assert.deepEqual(planVisits(input(), [evidence(0, { prediction: sakuraPrediction() })], now).aiDays, []);
});

test("관측 대기가 없으면 확정 일정에서도 AI 예측 대기를 쓰고, 붐비는 시간을 피한다", () => {
  const prediction = { ...sakuraPrediction(), crowd: [10, 11, 12, 13, 14, 15, 16, 17].map(hour => ({ day: "weekday" as const, hour, level: hour === 12 ? "low" as const : "high" as const, waitMin: hour === 12 ? 0 : 20, waitMax: hour === 12 ? 10 : 40 })), bestVisits: [], busyDates: [] };
  const result = planVisits({ ...input(), preferences: "붐비는 시간은 피하고 싶어요" }, [evidence(0, { prediction })], now);
  const stop = result.days[0].stops[0];
  assert.deepEqual([stop.arrival, stop.waitKind, stop.waitMax, stop.crowdLevel, stop.aiPredicted], ["12:00", "ai", 10, "low", undefined]);
  assert.equal(result.days[0].aiPredicted, undefined);
});
