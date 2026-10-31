import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTasteSignals, scoreTaste, type TasteSignal } from "../lib/taste-scoring";
import { planVisits, type Input, type PlaceEvidence } from "../lib/planner";

const url = "https://example.com/official";
const now = new Date("2026-10-30T00:00:00Z");
const signal = (extra: Partial<TasteSignal> = {}): TasteSignal => ({ axis: "subcategory", id: "skincare", direction: "like", quote: "스킨케어가 좋아요", ...extra });
function evidence(index: number, category: "beauty" | "food" = "beauty", extra: Partial<PlaceEvidence> = {}): PlaceEvidence {
  return { index, matched: true, status: "verified", eventStart: "2026-10-01", eventEnd: "2026-11-30", hours: [{ date: "2026-10-30", open: "10:00", close: "18:00" }],
    admission: { reservation: "not_required", lastEntry: null, note: "현장 입장 가능" },
    lat: 37.54, lng: 127.05, summary: "공식 안내", value: "체험", queue: [], sources: [{ title: "공식", url, matched: true, publishedAt: null, note: "행사 일치" }],
    classification: { version: 1, category, subcategory: category === "beauty" ? "skincare" : "pizza", experienceTags: ["product_trial", "escape_room"], sourceUrls: [url] }, ...extra };
}
function input(preferences = "스킨케어가 좋아요", count = 2): Input {
  return { places: Array.from({ length: count }, (_, index) => ({ name: `팝업 ${index}`, address: "서울 성동구", genre: "상세 설명", stayMinutes: 60 })), dateFrom: "2026-10-30", dateTo: "2026-10-30", timeFrom: "10:00", timeTo: "11:30", preferences };
}

test("사용자 문구와 고정 ID를 대조하고 임의·중복·상충 신호를 제거한다", () => {
  const raw = [signal(), signal(), signal({ id: "pizza" }), signal({ quote: "다른 사용자 문구" }), signal({ id: "unclassified" }), signal({ id: "__proto__" })];
  assert.deepEqual(normalizeTasteSignals(raw, "스킨케어가 좋아요"), [signal()]);
  assert.deepEqual(normalizeTasteSignals([signal(), signal({ direction: "dislike" })], "스킨케어가 좋아요"), []);
  assert.deepEqual(normalizeTasteSignals([signal()], ""), []);
  assert.deepEqual(normalizeTasteSignals([signal({ axis: "category", id: "beauty", quote: "대기를 피하고 싶어요" })], "대기를 피하고 싶어요"), []);
});

test("대분류와 소분류는 중복 가점하지 않고 체험 태그는 독립적으로 합산한다", () => {
  const preferences = "뷰티와 스킨케어가 좋아요. 방탈출도 좋아요";
  const signals = [signal({ axis: "category", id: "beauty", quote: "뷰티와 스킨케어가 좋아요" }), signal({ quote: "뷰티와 스킨케어가 좋아요" }), signal({ axis: "experience", id: "escape_room", quote: "방탈출도 좋아요" })];
  const report = scoreTaste([evidence(0)], preferences, signals);
  assert.equal(report.events[0].score, 70);
  assert.deepEqual(report.events[0].matches.map(match => match.points), [50, 20]);
});

test("비선호는 감점하고 미분류·일치하지 않는 취향은 비선호로 취급하지 않는다", () => {
  const raw = [signal({ direction: "dislike", quote: "스킨케어는 싫어요" })];
  const report = scoreTaste([evidence(0), evidence(1, "food"), evidence(2, "beauty", { classification: undefined })], "스킨케어는 싫어요", raw);
  assert.equal(report.events[0].score, -50);
  assert.equal(report.events[1].score, 0);
  assert.equal(report.events[2].status, "unclassified");
  for (const extra of [{ matched: false }, { sources: [] }, { classification: { ...evidence(0).classification!, sourceUrls: ["https://invented.example/event"] } }]) {
    assert.equal(scoreTaste([evidence(0, "beauty", extra)], "스킨케어가 좋아요", [signal()]).events[0].score, 0);
  }
});

test("두 곳 중 한 곳만 가능하면 취향 가점에 따라 실제 선택이 바뀌고 점수는 분리된다", () => {
  const events = [evidence(0, "food"), evidence(1, "beauty")];
  const baseline = planVisits(input(), events, now);
  const preferred = planVisits(input(), events, now, [signal()]);
  assert.equal(baseline.days[0].stops[0].index, 0);
  assert.equal(preferred.days[0].stops[0].index, 1);
  assert.equal(preferred.days[0].score, baseline.days[0].score);
  assert.equal(preferred.days[0].tasteScore, 50);
  assert.equal(preferred.days[0].rankingScore, preferred.days[0].score + 50);
});

test("취향은 방문 수·예약·운영 근거를 우회하지 않으며 미인식 시 기존 일정과 같다", () => {
  const events = [evidence(0), evidence(1, "food")];
  const full = planVisits({ ...input(), timeTo: "18:00" }, events, now, [signal()]);
  assert.equal(full.days[0].stops.length, 2);
  for (const extra of [{ hours: [] }, { matched: false }, { admission: { reservation: "required_unknown" as const, lastEntry: null, note: "예약 필수" } }]) {
    const plan = planVisits(input(), [evidence(0, "beauty", extra), evidence(1, "food")], now, [signal()]);
    assert.equal(plan.days[0].stops[0].index, 1);
  }
  const unsupported = planVisits(input("붐비는 곳을 피하고 싶어요"), events, now, [signal()]);
  assert.equal(unsupported.taste?.status, "unrecognized");
  assert.deepEqual(unsupported.days, planVisits(input(""), events, now).days);
});

test("취향 점수는 행사별 -100~100으로 제한하고 분류 미확인은 화면에서도 구분한다", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { TasteSummary, TasteMatchSummary } = await import("../components/taste-summary");
  const report = scoreTaste([evidence(0)], "스킨케어가 좋아요", [signal()]);
  assert.match(renderToStaticMarkup(createElement(TasteSummary, { report })), /스킨케어.*선호/);
  assert.match(renderToStaticMarkup(createElement(TasteMatchSummary, { taste: report.events[0] })), /취향 \+50점/);
  assert.match(renderToStaticMarkup(createElement(TasteMatchSummary, { taste: { index: 0, status: "unclassified", score: 0, matches: [] } })), /판단 보류/);
  assert.equal(renderToStaticMarkup(createElement(TasteSummary, { report: scoreTaste([], "", []) })), "");
  const ev = evidence(0); ev.classification!.experienceTags = ["escape_room", "puzzle", "exhibition", "shopping", "photo_zone"];
  const preferences = "스킨케어 방탈출 퍼즐 전시 쇼핑 사진을 좋아해요";
  const signals = [signal({ quote: preferences }), ...["escape_room", "puzzle", "exhibition", "shopping", "photo_zone"].map(id => signal({ axis: "experience", id, quote: preferences }))];
  assert.equal(scoreTaste([ev], preferences, signals).events[0].score, 100);
  assert.equal(scoreTaste([ev], preferences, signals.map(item => ({ ...item, direction: "dislike" }))).events[0].score, -100);
});
