import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { rankNearby, createNearbyService, validateNearbySelection } from "../lib/nearby";
import { discoverNearby, parseNearbyDiscovery } from "../lib/nearby-discovery";
import { rememberAnalysis, readAnalysis, type ResearchSnapshot } from "../lib/analysis-store";
import type { Input, PlaceEvidence } from "../lib/planner";
import { sameInput } from "../lib/input-snapshot";
const now = new Date("2099-10-31T00:00:00Z"), date = "2099-10-31", url = "https://example.com/event";
const input = (count = 1): Input => ({ places: Array.from({ length: count }, (_, i) => ({ name: `선택 장소 ${i}`, address: `서울 성동구 길 ${i}`, genre: "체험", stayMinutes: 45 })), dateFrom: date, dateTo: date, timeFrom: "11:00", timeTo: "19:00", preferences: "" });
const ev = (index = 0, extra: Partial<PlaceEvidence> = {}): PlaceEvidence => ({ index, matched: true, status: "verified", eventStart: date, eventEnd: "2099-11-05",
  identity: { name: `행사 ${index}`, venue: "성수", address: `서울 성동구 길 ${index}`, locationStatus: "confirmed", sourceUrls: [url], note: "일치" },
  hours: [{ date, open: "11:00", close: "19:00" }], admission: { reservation: "not_required", lastEntry: null, note: "현장 입장", sourceUrl: url },
  lat: 37.54, lng: 127.05, summary: "운영 확인", value: "체험", queue: [], sources: [{ title: "공식", url, publishedAt: null, matched: true, note: "일치" }],
  classification: { version: 1, category: "beauty", subcategory: "skincare", experienceTags: ["product_trial"], sourceUrls: [url] }, ...extra });
const snapshot = (count = 1): ResearchSnapshot => ({ evidence: Array.from({ length: count }, (_, i) => ev(i)), tasteSignals: [], searchCount: 1, retrievedAt: now.toISOString(), model: "gpt-6.1-sol" });
const candidate = (extra: Partial<PlaceEvidence> = {}) => ({ place: { name: "새 팝업", address: "서울 성동구 새길 7", genre: "뷰티", stayMinutes: 45 }, evidence: ev(0, { lat: 37.541, identity: { ...ev().identity!, name: "새 팝업", address: "서울 성동구 새길 7" }, ...extra }), retrievedAt: now.toISOString() });

test("form snapshot comparison ignores property order but invalidates changed constraints", () => {
  const original = input(), reordered = { ...original, places: original.places.map(p => ({ address: p.address, genre: p.genre, name: p.name, stayMinutes: p.stayMinutes })) };
  assert.equal(sameInput(original, reordered), true);
  assert.equal(sameInput(original, { ...reordered, preferences: "바뀐 취향" }), false);
  assert.equal(sameInput(original, null), false);
});

test("recommendation UI requires explicit search and protects booked replacement options", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { NearbyRecommendations } = await import("../components/nearby-recommendations");
  const request = input(3); request.places[1].reservation = { date, time: "14:00", confirmed: true };
  const html = renderToStaticMarkup(createElement(NearbyRecommendations, { analysisId: "test", input: request, date, disabled: false, onApply: () => {} }));
  assert.match(html, /주변 팝업 찾기/);
  assert.match(html, /교체할 장소/);
  assert.match(html, /별도 API 비용/);
  assert.equal((html.match(/value="1"/g) ?? []).length, 1); // anchor list only, never a replacement option
  assert.match(html, /button[^>]*disabled=""[^>]*>주변 팝업 찾기/);
});

test("nearby discovery only accepts actually searched address and explicit overlapping event years", () => {
  const lead = { name: "새 팝업", address: "서울 성동구 새길 7", genre: "뷰티", eventStart: date, eventEnd: "2099-11-05", yearExplicit: true, addressSourceUrl: url, periodSourceUrl: url, genreSourceUrl: url, classification: ev().classification };
  const raw = (item = lead) => ({ status: "completed", output: [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ title: "공식", url }] } }, { type: "message", content: [{ type: "output_text", text: JSON.stringify({ candidates: [item] }) }] }] });
  const query = { area: "성동구", lat: 37.54, lng: 127.05, dateFrom: date, dateTo: date };
  assert.equal(parseNearbyDiscovery(raw(), query).candidates.length, 1);
  assert.deepEqual(parseNearbyDiscovery(raw(), query).candidates[0].sourceUrls, [url]);
  for (const patch of [{ yearExplicit: false }, { periodSourceUrl: "https://invented.example" }, { eventEnd: "2098-11-05", eventStart: "2098-10-01" }])
    assert.equal(parseNearbyDiscovery(raw({ ...lead, ...patch }), query).candidates.length, 0);
});

test("adding a popup preserves all anchors and an exact reservation, with computed marginal times", () => {
  const request = input(); request.places[0].reservation = { date, time: "14:00", confirmed: true };
  const result = rankNearby(request, snapshot(), 0, null, date, [candidate()], now)[0];
  assert.equal(result.status, "ready");
  assert.equal(result.proposedInput.places.length, 2);
  assert.deepEqual(result.proposedInput.places[0].reservation, request.places[0].reservation);
  assert.equal(result.plan?.stops.find(s => s.index === 0)?.arrival, "14:00");
  assert.equal(typeof result.additionalTravelMinutes, "number");
  assert.equal(request.places.length, 1);
});

test("three-place replacement is explicit and never removes a reserved place or the anchor", () => {
  const request = input(3); request.places[1].reservation = { date, time: "14:00", confirmed: true };
  for (const replacement of [null, 0, 1]) assert.throws(() => validateNearbySelection(request, snapshot(3), 0, replacement, date, now), /교체/);
  const result = rankNearby(request, snapshot(3), 0, 2, date, [candidate()], now)[0];
  assert.equal(result.proposedInput.places.length, 3);
  assert.equal(result.proposedInput.places[0].name, request.places[0].name);
  assert.deepEqual(result.proposedInput.places[1].reservation, request.places[1].reservation);
});

test("faraway, old, mismatched, unsourced-coordinate and duplicate candidates never appear", () => {
  for (const patch of [{ lat: 35 }, { matched: false }, { sources: [] }, { lat: null }, { eventEnd: "2098-10-31" }, { identity: { ...ev().identity!, locationStatus: "ambiguous" as const } }])
    assert.deepEqual(rankNearby(input(), snapshot(), 0, null, date, [candidate(patch)], now), []);
  assert.equal(rankNearby(input(), snapshot(), 0, null, date, [candidate(), candidate()], now).length, 1);
  const existing = candidate(); existing.place = input().places[0];
  assert.deepEqual(rankNearby(input(), snapshot(), 0, null, date, [existing], now), []);
});

test("partial schedules, bookings and unknown admission never become a ready recommendation", () => {
  const booking = candidate({ admission: { reservation: "required_unknown", lastEntry: null, note: "예약 필요", sourceUrl: url } });
  assert.equal(rankNearby(input(), snapshot(), 0, null, date, [booking], now)[0].status, "reservation_required");
  const unknown = candidate({ admission: { reservation: "unknown", lastEntry: null, note: "미확인" } });
  assert.equal(rankNearby(input(), snapshot(), 0, null, date, [unknown], now)[0].status, "needs_confirmation");
  const short = { ...input(), timeTo: "12:00" };
  assert.equal(rankNearby(short, snapshot(), 0, null, date, [candidate()], now)[0].status, "time_conflict");
  assert.equal(rankNearby(short, snapshot(), 0, null, date, [candidate()], now)[0].plan, null);
});

test("explicit dislikes are not erased by similarity to a chosen anchor", () => {
  const request = { ...input(), preferences: "뷰티는 싫어요" }, research = snapshot();
  research.tasteSignals = [{ axis: "category", id: "beauty", direction: "dislike", quote: "뷰티는 싫어요" }];
  const result = rankNearby(request, research, 0, null, date, [candidate()], now)[0];
  assert.equal(result.tasteScore, -30);
  assert.ok(!result.reasons.some(r => r.includes("비슷")));
});

test("diversity never puts an unconfirmed itinerary ahead of a ready one", () => {
  const choices = Array.from({ length: 3 }, (_, i) => {
    const item = candidate(); item.place.name += i; item.evidence.identity!.name = `${item.evidence.identity!.name ?? ""}${i}`; return item;
  });
  const unknown = candidate({ admission: { reservation: "unknown", lastEntry: null, note: "미확인" }, classification: { version: 1, category: "food", subcategory: "pizza", experienceTags: [], sourceUrls: [url] } });
  unknown.place.name = "다른 후보"; unknown.evidence.identity!.name = "다른 후보";
  assert.ok(rankNearby(input(), snapshot(), 0, null, date, [...choices, unknown], now).every(item => item.status === "ready"));
});

test("discovery uses a bounded hosted search and never falls back to a different model", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tool_calls, 4); assert.equal(body.store, false);
    assert.equal(body.model, "gpt-6.1-sol"); assert.equal(body.tool_choice, "required");
    assert.equal(body.text.format.strict, true);
    return Response.json({}, { status: 404 });
  };
  try {
    await assert.rejects(discoverNearby({ area: "성수", lat: 37.54, lng: 127.05, dateFrom: date, dateTo: date }, "test-placeholder"), /모델/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("discovery sends separate broad and category searches with the full address", async () => {
  const original = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed", action: { type: "search", sources: [] } },
      { type: "message", content: [{ type: "output_text", text: '{"candidates":[]}' }] },
    ] });
  };
  try {
    await discoverNearby({ area: "서울 성동구 성수동", lat: 37.54, lng: 127.05, dateFrom: date, dateTo: date,
      address: "서울 성동구 연무장길 88", topics: ["뷰티", "스킨케어"], preferences: "스킨케어 좋아요" }, "test");
    const sent = JSON.parse(payload!.input as string);
    assert.deepEqual(sent.searchQueries, ["서울 성동구 성수동 뷰티 팝업 2099-10-31", "서울 성동구 성수동 스킨케어 팝업 2099-10-31", "서울 성동구 성수동 2099년 10월 팝업스토어 일정"]);
    assert.equal(sent.address, "서울 성동구 연무장길 88");
    assert.equal(sent.preferences, "스킨케어 좋아요");
  } finally { globalThis.fetch = original; }
});

test("catalog and verification cache reuse avoids paid calls, expires, and rejects invalid anchors before discovery", async () => {
  let searches = 0, checks = 0;
  const service = createNearbyService({ discover: async () => { searches++; return { candidates: [{ ...candidate().place, classification: ev().classification! }], searchCount: 1 }; },
    research: async () => { checks++; return { ...snapshot(), evidence: [candidate().evidence] }; } });
  const first = await service(input(), snapshot(), 0, null, date, "test", now);
  const second = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.equal(first.recommendations.length, 1); assert.equal(first.searchCount, 2);
  assert.equal(second.cached, true); assert.equal(second.searchCount, 0);
  assert.equal(searches, 1); assert.equal(checks, 1);
  await service(input(), snapshot(), 0, null, date, "test", new Date(now.getTime() + 21 * 60_000));
  assert.equal(searches, 2); assert.equal(checks, 2);
  const invalid = snapshot(); invalid.evidence[0].matched = false;
  await assert.rejects(service(input(), invalid, 0, null, date, "test", now), /위치/);
  assert.equal(searches, 2);
});

test("confirmed anchor addresses without coordinates can discover events without inventing distances or schedules", async () => {
  const research = snapshot(); research.evidence[0].lat = null; research.evidence[0].lng = null;
  let discoveries = 0;
  const service = createNearbyService({ discover: async query => {
    discoveries++;
    assert.equal(query.address, "서울 성동구 길 0");
    assert.equal(query.lat, null); assert.equal(query.lng, null);
    return { candidates: [{ ...candidate().place, classification: ev().classification! }], searchCount: 1 };
  }, research: async () => ({ ...snapshot(), evidence: [candidate().evidence] }) });
  const report = await service(input(), research, 0, null, date, "test", now);
  assert.equal(discoveries, 1);
  assert.equal(report.anchorCoordinatesMissing, true);
  assert.deepEqual(report.recommendations, []);
  assert.equal(report.unlocated[0].name, "새 팝업");
});

test("unverified or ambiguous anchors still reject discovery even with coordinates", async () => {
  let discoveries = 0;
  const service = createNearbyService({ discover: async () => { discoveries++; return { candidates: [], searchCount: 0 }; }, research: async () => snapshot() });
  for (const patch of [{ matched: false }, { status: "unconfirmed" as const }, { sources: [] },
    { identity: { ...ev().identity!, locationStatus: "ambiguous" as const } }]) {
    const research = snapshot(); research.evidence[0] = ev(0, patch);
    await assert.rejects(service(input(), research, 0, null, date, "test", now), /위치/);
  }
  assert.equal(discoveries, 0);
});

test("nearby discovery receives the selected day, full location and taste context, with separate caches", async () => {
  const queries: unknown[] = [];
  const service = createNearbyService({ discover: async query => { queries.push(query); return { candidates: [], searchCount: 1 }; }, research: async () => snapshot() });
  const request = { ...input(), dateTo: "2099-11-02", preferences: "스킨케어 좋아요" };
  const research = snapshot();
  research.tasteSignals = [{ axis: "subcategory", id: "skincare", direction: "like", quote: "스킨케어 좋아요" }];
  await service(request, research, 0, null, date, "test", now);
  const query = queries[0] as Record<string, unknown>;
  assert.equal(query.dateFrom, date);
  assert.equal(query.dateTo, date);
  assert.equal(query.area, "서울 성동구");
  assert.equal(query.address, "서울 성동구 길 0");
  assert.equal(query.preferences, "스킨케어 좋아요");
  assert.ok((query.topics as string[]).includes("스킨케어"));
  assert.ok((query.topics as string[]).includes("뷰티"));
  await service(request, research, 0, null, "2099-11-01", "test", now);
  await service({ ...request, preferences: "향수 좋아요" }, research, 0, null, date, "test", now);
  assert.equal(queries.length, 3);
});

test("rejected first batches do not hide later nearby candidates and verification is cached", async () => {
  let checks = 0;
  const leads = Array.from({ length: 8 }, (_, i) => ({ name: `주변 후보 ${i}`, address: `서울 성동구 새길 ${i}`, genre: "뷰티", classification: ev().classification! }));
  const service = createNearbyService({ discover: async () => ({ candidates: leads, searchCount: 1 }),
    research: async request => {
      checks++;
      assert.ok(request.places.length <= 3);
      return { ...snapshot(), evidence: request.places.map((place, index) => ev(index, {
        lat: place.name === "주변 후보 7" ? 37.541 : 35,
        identity: { ...ev().identity!, name: place.name, address: place.address },
      })) };
    } });
  const first = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.deepEqual(first.recommendations.map(item => item.place.name), ["주변 후보 7"]);
  assert.equal(first.checkedCount, 8);
  assert.equal(first.searchCount, 4);
  assert.equal(checks, 3);
  const second = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.equal(second.recommendations.length, 1);
  assert.equal(second.searchCount, 0);
  assert.equal(second.cached, true);
  assert.equal(checks, 3);
});

test("three unusable schedules do not stop discovery before a later visitable popup", async () => {
  const leads = Array.from({ length: 4 }, (_, i) => ({ name: `시간 후보 ${i}`, address: `서울 성동구 새길 ${i}`, genre: "뷰티", classification: ev().classification! }));
  const service = createNearbyService({ discover: async () => ({ candidates: leads, searchCount: 1 }),
    research: async request => ({ ...snapshot(), evidence: request.places.map((place, index) => ev(index, {
      identity: { ...ev().identity!, name: place.name, address: place.address },
      hours: [{ date, open: place.name === "시간 후보 3" ? "11:00" : "20:00", close: "22:00" }],
    })) }) });
  const report = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.equal(report.recommendations[0].place.name, "시간 후보 3");
  assert.equal(report.recommendations[0].status, "ready");
  assert.equal(report.checkedCount, 4);
});

test("verified events without coordinates remain visible without claiming a distance or ready itinerary", async () => {
  const service = createNearbyService({ discover: async () => ({ candidates: [{ ...candidate().place, classification: ev().classification! }], searchCount: 1 }),
    research: async () => ({ ...snapshot(), evidence: [candidate({ lat: null, lng: null }).evidence] }) });
  const report = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.equal(report.recommendations.length, 0);
  assert.deepEqual(report.unlocated, [{ name: "새 팝업", address: "서울 성동구 새길 7", genre: "뷰티", eventStart: date, eventEnd: "2099-11-05", sourceUrl: url }]);
});

test("the selected event cannot reappear as an unlocated candidate under an alias", async () => {
  const service = createNearbyService({ discover: async () => ({ candidates: [{ ...candidate().place, classification: ev().classification! }], searchCount: 1 }),
    research: async () => ({ ...snapshot(), evidence: [candidate({ lat: null, lng: null, identity: ev().identity }).evidence] }) });
  const report = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.deepEqual(report.unlocated, []);
});

test("a later verification failure preserves earlier results and marks the search incomplete", async () => {
  let checks = 0;
  const leads = Array.from({ length: 4 }, (_, i) => ({ name: `부분 후보 ${i}`, address: `서울 성동구 새길 ${i}`, genre: "뷰티", classification: ev().classification! }));
  const service = createNearbyService({ discover: async () => ({ candidates: leads, searchCount: 1 }),
    research: async request => {
      if (++checks > 1) throw new Error("upstream unavailable");
      return { ...snapshot(), evidence: request.places.map((place, index) => ev(index, {
        lat: index === 0 ? 37.541 : 35, identity: { ...ev().identity!, name: place.name, address: place.address },
      })) };
    } });
  const report = await service(input(), snapshot(), 0, null, date, "test", now);
  assert.equal(report.recommendations[0].place.name, "부분 후보 0");
  assert.equal(report.verificationIncomplete, true);
  assert.equal(report.checkedCount, 3);
});

test("analysis snapshots are opaque, copied, bounded by expiry and do not accept client evidence", () => {
  const original = input(), id = rememberAnalysis(original, snapshot(), now.getTime());
  original.places[0].name = "수정";
  assert.notEqual(readAnalysis(id, now.getTime())?.input.places[0].name, "수정");
  assert.equal(readAnalysis(id, now.getTime() + 20 * 60_000), null);
  assert.equal(readAnalysis("invented"), null);
});

const moduleUrl = (source: string) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64");
test("nearby endpoint accepts server snapshots only and returns opaque selection IDs", async () => {
  const id = rememberAnalysis(input(), snapshot());
  const recommendation = rankNearby(input(), snapshot(), 0, null, date, [candidate()], now)[0];
  const fake = moduleUrl(`export let calls=0; export async function nearbyService(){calls++;return ${JSON.stringify({ recommendations: [recommendation], retrievedAt: now.toISOString(), cached: false, searchCount: 2, discoveredCount: 1, checkedCount: 1, date, replaceIndex: null })};}`);
  const researchUrl = new URL("../lib/research.ts", import.meta.url).href;
  const guardSource = (await readFile(new URL("../lib/api-guard.ts", import.meta.url), "utf8")).replace('"./research"', JSON.stringify(researchUrl))
    .replace('typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined', '"test-placeholder"');
  let source = await readFile(new URL("../app/api/nearby/route.ts", import.meta.url), "utf8");
  source = source.replace('"@/lib/nearby"', JSON.stringify(fake)).replace('"@/lib/api-guard"', JSON.stringify(moduleUrl(guardSource)));
  for (const name of ["analysis-store", "research"]) source = source.replace(`"@/lib/${name}"`, JSON.stringify(new URL(`../lib/${name}.ts`, import.meta.url).href));
  // data: modules cannot resolve bare package imports.
  source = source.replace('"zod"', JSON.stringify(new URL("../node_modules/zod/index.js", import.meta.url).href));
  const route = await import(moduleUrl(source));
  const request = (analysisId: string, origin = "http://localhost") => new Request("http://localhost/api/nearby", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ analysisId, anchorIndex: 0, replaceIndex: null, date }) });
  assert.equal((await route.POST(request(id, "https://untrusted.example"))).status, 403);
  assert.equal((await route.POST(request("bad-id"))).status, 400);
  assert.equal((await route.POST(request(crypto.randomUUID()))).status, 409);
  const response = await route.POST(request(id)); assert.equal(response.status, 200);
  const data = await response.json() as { recommendations: { proposalId: string; evidence?: unknown; proposedInput?: unknown }[] };
  assert.ok(readAnalysis(data.recommendations[0].proposalId));
  assert.equal(data.recommendations[0].evidence, undefined);
  assert.equal(data.recommendations[0].proposedInput, undefined);
  assert.equal((await import(fake)).calls, 1);
});

test("applying a stored proposal recalculates without fetch and keeps reservations", async () => {
  const requestInput = input(); requestInput.places[0].reservation = { date, time: "14:00", confirmed: true };
  const id = rememberAnalysis(requestInput, snapshot());
  let source = await readFile(new URL("../app/api/nearby/apply/route.ts", import.meta.url), "utf8");
  for (const name of ["analysis-store", "planner", "forecast", "research", "api-guard"]) source = source.replace(`"@/lib/${name}"`, JSON.stringify(new URL(`../lib/${name}.ts`, import.meta.url).href));
  const route = await import(moduleUrl(source));
  const request = (proposalId: string) => new Request("http://localhost/api/nearby/apply", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ proposalId }) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected paid call"); };
  try {
    const response = await route.POST(request(id)); assert.equal(response.status, 200);
    const result = await response.json() as { input: Input; analysis: { cached: boolean } };
    assert.deepEqual(result.input.places[0].reservation, requestInput.places[0].reservation);
    assert.equal(result.analysis.cached, true);
    assert.equal((await route.POST(request("not-found"))).status, 409);
  } finally { globalThis.fetch = originalFetch; }
});
