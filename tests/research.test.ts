import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import type { Input } from "../lib/planner";
import { buildSearchPlan } from "../lib/search-plan";
import { eventInformation } from "../lib/event-status";
const { parseResearchResponse, researchPlaces, ResearchError, MODEL, addressSearchHints } = await import(new URL("../lib/research.ts", import.meta.url).href) as typeof import("../lib/research");

const now = new Date("2026-10-30T00:00:00Z");
const input: Input = { places: [{ name: "테스트 팝업", address: "서울 성동구 테스트", genre: "캐릭터", stayMinutes: 60 }], dateFrom: "2026-10-30", dateTo: "2026-10-31", timeFrom: "10:00", timeTo: "18:00", preferences: "" };
const official = "https://example.com/official";
const unrelated = "https://example.com/related";

test("detailed Korean addresses provide street and locality search fallbacks without losing building numbers", () => {
  assert.deepEqual(addressSearchHints("서울 광진구 아차산로 272 스타시티몰 3층 브이스퀘어"), ["서울 광진구 아차산로 272", "서울 광진구"]);
  assert.deepEqual(addressSearchHints("서울 성동구 성수동2가 123-4 A동 201호"), ["서울 성동구 성수동2가 123-4", "서울 성동구 성수동2가"]);
  assert.deepEqual(addressSearchHints("경기 양평군 양서면"), ["경기 양평군 양서면"]);
  assert.deepEqual(addressSearchHints("  서울   성동구 연무장길 12-3 (성수동) 2층 "), ["서울 성동구 연무장길 12-3", "서울 성동구"]);
});

test("research preserves detailed addresses but sends separate broader discovery hints", async () => {
  const original = globalThis.fetch;
  const detailed = { ...input, places: [{ ...input.places[0], address: "서울 광진구 아차산로 272 스타시티몰 3층 브이스퀘어", reservation: { date: "2026-10-30", time: "12:00", confirmed: true as const } }] };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const sent = JSON.parse(body.input);
    assert.equal(sent.places[0].address, detailed.places[0].address);
    assert.deepEqual(sent.places[0].searchLocations, ["서울 광진구 아차산로 272", "서울 광진구"]);
    assert.equal("reservation" in sent.places[0], false);
    assert.equal(JSON.stringify(sent).includes('"reservation"'), false);
    assert.match(body.instructions, /Discovery is not verification/);
    assert.match(body.instructions, /different building number/);
    return Response.json(response());
  };
  try { await researchPlaces(detailed, "unit-test-placeholder"); }
  finally { globalThis.fetch = original; }
});
function evidence(overrides: Record<string, unknown> = {}) {
  return { index: 0, matched: true, status: "verified", eventStart: "2026-10-01", eventEnd: "2026-11-03", eventSourceUrl: official,
    identity: { name: "테스트 팝업", venue: "테스트 행사장", address: "서울 성동구 테스트", locationStatus: "confirmed", note: "행사 공지에서 같은 장소 확인", sourceUrls: [official] },
    hours: [{ date: "2026-10-30", open: "10:00", close: "18:00", lastEntry: null as string | null, sourceUrl: official }], admission: { reservation: "not_required", lastEntry: null, note: "예약 없는 현장 입장", sourceUrl: official }, lat: 37.5, lng: 127, locationSourceUrl: official,
    value: "공식 굿즈", summary: "공식 공지 확인", supportUrls: [official], queue: [{ date: "2026-10-29", time: "12:00", min: 20, max: 40, kind: "observed", sourceUrl: official }],
    sources: [{ title: "공식 공지", url: official, publishedAt: "2026-10-01", matched: true, note: "장소와 행사 연도 일치" }], ...overrides };
}
function response(entries = [evidence()], urls = [official, unrelated], tasteSignals: unknown = []) {
  return { status: "completed", output: [
    { type: "web_search_call", status: "completed", action: { type: "search", sources: urls.map(url => ({ type: "url", url, title: url })) } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ evidence: entries, tasteSignals }), annotations: [] }] },
  ] };
}

test("확정 주소의 누락된 좌표를 별도 검색해 여러 장소 일정에 반영한다", async () => {
  const { planVisits } = await import("../lib/planner");
  const address = "서울 성동구 연무장길 65 LECT성수 2층";
  const request = { ...input, places: [{ ...input.places[0], address }, { ...input.places[0], name: "두번째 팝업", address: "서울 성동구 연무장길 60" }] };
  const original = globalThis.fetch;
  const mapUrl = "https://example.com/address-map";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (++calls === 1) return Response.json(response([
      evidence({ lat: null, lng: null, locationSourceUrl: null, identity: { ...evidence().identity, address } }), evidence({ index: 1 }),
    ]));
    assert.equal(body.model, MODEL);
    assert.deepEqual(JSON.parse(body.input).places, [{ index: 0, address, searchAddress: "서울 성동구 연무장길 65" }]);
    const raw = response([], [mapUrl]);
    raw.output[1].content![0].text = JSON.stringify({ locations: [{ index: 0, address: "서울 성동구 연무장길 65", lat: 37.5001, lng: 127.0001, sourceUrl: mapUrl }] });
    return Response.json(raw);
  };
  try {
    const result = await researchPlaces(request, "test");
    assert.equal(calls, 2);
    assert.equal(result.evidence[0].lat, 37.5001);
    assert.equal(result.evidence[0].sources.find(s => s.url === mapUrl)?.matched, true);
    assert.equal(result.searchCount, 2);
    assert.equal(planVisits(request, result.evidence, now).days[0].stops.length, 2);
  } finally { globalThis.fetch = original; }
});

test("주소 좌표 보충은 다른 건물·가짜 출처·모호한 결과를 거부하고 검색 실패 시 기존 분석을 보존한다", async t => {
  const address = "서울 성동구 연무장길 65 LECT성수";
  const request = { ...input, places: [{ ...input.places[0], address }] };
  const mapUrl = "https://example.com/address-map";
  const location = { index: 0, address: "서울특별시 성동구 연무장길 65", lat: 37.5001, lng: 127.0001, sourceUrl: mapUrl };
  const scenarios = [
    { name: "주소 표기 정규화", locations: [location], accepted: true },
    { name: "다른 건물", locations: [{ ...location, address: "서울 성동구 연무장길 650" }] },
    { name: "다른 도로", locations: [{ ...location, address: "서울 성동구 왕십리로 65" }] },
    { name: "검색되지 않은 출처", locations: [{ ...location, sourceUrl: "https://invented.example/map" }] },
    { name: "좌표 범위 오류", locations: [{ ...location, lat: 999 }] },
    { name: "모호한 좌표", locations: [location, { ...location, lat: 37.6 }] },
    { name: "검색 실패", locations: [], failed: true },
    { name: "연결 실패", locations: [], offline: true },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls === 1) return Response.json(response([evidence({ lat: null, lng: null, identity: { ...evidence().identity, address } })]));
      if (scenario.offline) throw new Error("offline");
      if (scenario.failed) return Response.json({}, { status: 503 });
      const raw = response([], [mapUrl]);
      raw.output[1].content![0].text = JSON.stringify({ locations: scenario.locations });
      return Response.json(raw);
    };
    try {
      const result = await researchPlaces(request, "test");
      assert.equal(calls, 2);
      assert.equal(result.evidence[0].lat, scenario.accepted ? location.lat : null);
      assert.equal(result.evidence[0].status, "verified");
      assert.equal(result.evidence[0].hours.length, 1);
    } finally { globalThis.fetch = original; }
  });
});

test("주소가 미확정이거나 기존 좌표가 있으면 별도 좌표 검색을 하지 않는다", async t => {
  for (const extra of [{}, { lat: null, lng: null, matched: false }, { lat: null, lng: null, identity: { ...evidence().identity, locationStatus: "ambiguous" } }, { lat: null, lng: null }]) await t.test(JSON.stringify(extra), async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(response([evidence(extra)])); };
    try {
      await researchPlaces(input, "test");
      assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
  });
});

test("nearby source hints are sent for research but cannot authorize an unsearched coordinate source", async () => {
  const original = globalThis.fetch;
  const hinted = "https://example.com/discovery-only";
  const sourceHints = [{ index: 0, urls: [hinted] }];
  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(JSON.parse(String(init?.body)).input);
    assert.deepEqual(sent.sourceHints, sourceHints);
    return Response.json(response([evidence({ locationSourceUrl: hinted })]));
  };
  try {
    const result = await researchPlaces(input, "test", sourceHints);
    assert.equal(result.evidence[0].status, "verified");
    assert.equal(result.evidence[0].lat, null);
    assert.equal(result.evidence[0].lng, null);
  } finally { globalThis.fetch = original; }
});

test("actual search URLs support facts and every unused returned source is retained as unmatched", () => {
  const result = parseResearchResponse(response(), input, now);
  assert.equal(result.searchCount, 1);
  assert.equal(result.evidence[0].status, "verified");
  assert.equal(result.evidence[0].hours.length, 1);
  assert.equal(result.evidence[0].queue.length, 1);
  assert.equal(result.evidence[0].sources.find(s => s.url === unrelated)?.matched, false);
});

test("discovery uses event/year and area/venue hints before the original detailed address", () => {
  const detailed = { ...input, places: [{ ...input.places[0], address: "서울특별시 송파구 올림픽로 300 롯데월드몰 잠실점 지하1층" }] };
  const plan = buildSearchPlan(detailed)[0];
  assert.deepEqual(plan.regionHints, ["서울", "송파구"]);
  assert.deepEqual(plan.venueHints, ["롯데월드몰", "잠실점"]);
  assert.equal(plan.stages[0].queries[0], "테스트 팝업 2026");
  assert.ok(plan.stages[1].queries.every(query => !query.includes("300") && !query.includes("지하1층")));
  assert.ok(plan.stages[2].queries[0].includes(detailed.places[0].address));
  assert.equal(detailed.places[0].address, plan.originalAddress);
  assert.ok(buildSearchPlan({ ...input, dateFrom: "2026-12-30", dateTo: "2027-01-02" })[0].stages[0].queries.some(query => query.includes("2027")));
});

test("detailed, area and venue inputs retain a sourced event without requiring identical address text", () => {
  for (const address of ["서울특별시 송파구 올림픽로 300 롯데월드몰 1층", "잠실", "롯데월드몰 잠실점"]) {
    const request = { ...input, places: [{ ...input.places[0], address }] };
    const item = evidence({ identity: { name: "테스트 팝업", venue: "롯데월드몰 잠실점", address: "서울 송파구 올림픽로 300", locationStatus: "confirmed", note: "공식 행사 공지와 행사장 안내를 교차 확인", sourceUrls: [official] } });
    const result = parseResearchResponse(response([item]), request, now).evidence[0];
    assert.equal(result.status, "verified");
    assert.equal(result.identity?.venue, "롯데월드몰 잠실점");
  }
});

test("another branch, ambiguous candidates and unsupported location claims cannot enter schedules", () => {
  for (const locationStatus of ["mismatch", "ambiguous", "unknown", "confirmed"]) {
    const item = evidence({ identity: { name: "테스트 팝업", venue: "다른 지점", address: null, locationStatus, note: "장소 확인 필요", sourceUrls: locationStatus === "confirmed" ? ["https://invented.example/location"] : [official] } });
    const result = parseResearchResponse(response([item]), input, now).evidence[0];
    assert.equal(result.matched, false);
    assert.equal(result.status, "not_found");
    assert.deepEqual(result.hours, []);
    assert.equal(result.eventStart, null);
    assert.match(eventInformation(result, input).label, /장소/);
  }
});

test("a confirmed event remains visible when hours or admission are missing", () => {
  const result = parseResearchResponse(response([evidence({ hours: [], admission: undefined })]), input, now).evidence[0];
  assert.equal(result.status, "verified");
  assert.equal(result.matched, true);
  assert.equal(eventInformation(result, input).label, "행사 확인 · 영업시간 미확인");
  assert.equal(result.admission?.reservation, "unknown");
  const partial = parseResearchResponse(response(), input, now).evidence[0];
  assert.equal(eventInformation(partial, input).label, "행사 확인 · 일부 날짜 영업시간 미확인");
});

test("invented URLs cannot prove events, hours, coordinates or queue observations", () => {
  const result = parseResearchResponse(response([evidence()], [unrelated]), input, now).evidence[0];
  assert.equal(result.status, "not_found");
  assert.equal(result.matched, false);
  assert.equal(result.eventStart, null);
  assert.equal(result.lat, null);
  assert.deepEqual(result.hours, []);
  assert.deepEqual(result.queue, []);
  assert.equal(result.sources.some(s => s.url === official), false);
});

test("text saying it searched is insufficient without a completed real search call", () => {
  const raw = response();
  raw.output.shift();
  assert.throws(() => parseResearchResponse(raw, input, now), (error: unknown) => error instanceof ResearchError && error.code === "search_failed");
});

test("past events are excluded from current verification even if the model labels them verified", () => {
  const result = parseResearchResponse(response([evidence({ eventStart: "2025-10-01", eventEnd: "2025-11-03" })]), input, now).evidence[0];
  assert.equal(result.status, "past");
  assert.deepEqual(result.hours, []);
});

test("future observations/publication dates and unsupported date-specific hours are discarded", () => {
  const item = evidence();
  item.queue.push({ date: "2026-11-01", time: "12:00", min: 10, max: 20, kind: "observed", sourceUrl: official });
  item.hours.push({ date: "2026-10-31", open: "10:00", close: "18:00", lastEntry: null, sourceUrl: "https://invented.example/fake" });
  item.sources[0].publishedAt = "2027-01-01";
  const result = parseResearchResponse(response([item]), input, now).evidence[0];
  assert.equal(result.queue.length, 1);
  assert.equal(result.hours.length, 1);
  assert.equal(result.sources[0].publishedAt, null);
});

test("missing or duplicate model indices cannot be associated with the wrong input", () => {
  const result = parseResearchResponse(response([evidence(), evidence()]), input, now).evidence[0];
  assert.equal(result.status, "not_found");
});

test("annotation URLs are accepted, while unsafe protocols are rejected", () => {
  const raw = response([evidence()], []);
  const content = raw.output[1] as unknown as { content: { annotations: Record<string, unknown>[] }[] };
  content.content[0].annotations.push({ type: "url_citation", url: official, title: "공식 공지" }, { type: "url_citation", url: "javascript:alert(1)" });
  const result = parseResearchResponse(raw, input, now).evidence[0];
  assert.equal(result.status, "verified");
  assert.equal(result.sources.length, 1);
});

test("a matched source without event-date support remains unconfirmed", () => {
  const result = parseResearchResponse(response([evidence({ eventSourceUrl: null })]), input, now).evidence[0];
  assert.equal(result.status, "unconfirmed");
  assert.equal(result.eventStart, null);
  assert.deepEqual(result.hours, []);
});

test("reservation claims require their own real matched source", () => {
  const missing = parseResearchResponse(response([evidence({ admission: undefined })]), input, now).evidence[0];
  assert.equal(missing.admission?.reservation, "unknown");
  const invented = parseResearchResponse(response([evidence({ admission: { reservation: "not_required", lastEntry: "16:00", note: "허구", sourceUrl: "https://invented.example/fake" } })]), input, now).evidence[0];
  assert.equal(invented.admission?.reservation, "unknown");
  assert.equal(invented.admission?.lastEntry, null);
  assert.equal(invented.admission?.sourceUrl, undefined);
});

test("reservation candidates retain the validated admission link, not an unrelated search result", () => {
  const reservation = { reservation: "required_unknown", lastEntry: null, note: "사전예약 11월 4일 오픈", sourceUrl: official + "#booking" };
  const result = parseResearchResponse(response([evidence({ admission: reservation })]), input, now).evidence[0];
  assert.equal(result.admission?.sourceUrl, official);
  const unsupported = parseResearchResponse(response([evidence({ admission: { ...reservation, sourceUrl: unrelated } })]), input, now).evidence[0];
  assert.equal(unsupported.admission?.reservation, "unknown");
  assert.equal(unsupported.admission?.sourceUrl, undefined);
});

test("sold-out policy and explicit date-specific entry cutoff survive as structured constraints", () => {
  const item = evidence({ admission: { reservation: "sold_out", lastEntry: "16:00", note: "현재 매진", sourceUrl: official } });
  item.hours[0].lastEntry = "15:30";
  const result = parseResearchResponse(response([item]), input, now).evidence[0];
  assert.equal(result.admission?.reservation, "sold_out");
  assert.equal(result.admission?.lastEntry, "16:00");
  assert.equal(result.hours[0].lastEntry, "15:30");
});

test("opening hours never create a made-up admission deadline", () => {
  const result = parseResearchResponse(response(), input, now).evidence[0];
  assert.equal(result.admission?.lastEntry, null);
  assert.equal(result.hours[0].lastEntry, null);
});

test("Korea midnight keeps actual local-day reports and rejects observations later than now", () => {
  const item = evidence();
  item.queue = [
    { date: "2026-10-30", time: "00:15", min: 10, max: 20, kind: "observed", sourceUrl: official },
    { date: "2026-10-30", time: "00:45", min: 10, max: 20, kind: "observed", sourceUrl: official },
  ];
  item.sources[0].publishedAt = "2026-10-30";
  const result = parseResearchResponse(response([item]), input, new Date("2026-10-29T15:30:00Z")).evidence[0];
  assert.equal(result.sources[0].publishedAt, "2026-10-30");
  assert.deepEqual(result.queue.map(q => q.time), ["00:15"]);
});

test("malformed explicit entry restrictions cannot be silently dropped into unrestricted visits", () => {
  const general = parseResearchResponse(response([evidence({ admission: { reservation: "not_required", lastEntry: "오후 4시", note: "입장마감", sourceUrl: official } })]), input, now).evidence[0];
  assert.equal(general.admission?.reservation, "unknown");
  const item = evidence();
  item.hours[0].lastEntry = "오후 4시";
  assert.deepEqual(parseResearchResponse(response([item]), input, now).evidence[0].hours, []);
});

test("route reuses cached research while recomputing today's plan and exposes forecasts without paid requests", async t => {
  const moduleUrl = (source: string) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64");
  const forecastUrl = moduleUrl(await readFile(new URL("../lib/forecast.ts", import.meta.url), "utf8"));
  const plannerUrl = moduleUrl((await readFile(new URL("../lib/planner.ts", import.meta.url), "utf8")).replace('"./forecast"', JSON.stringify(forecastUrl)).replace('"./taste-scoring"', JSON.stringify(new URL("../lib/taste-scoring.ts", import.meta.url).href)));
  const researched = { ...parseResearchResponse(response(), input, now), retrievedAt: now.toISOString(), model: MODEL };
  researched.tasteSignals.push({ axis: "subcategory", id: "skincare", direction: "like", quote: "스킨케어가 좋아요" });
  researched.evidence[0].classification = { version: 1, category: "beauty", subcategory: "skincare", experienceTags: [], sourceUrls: [official] };
  const researchUrl = moduleUrl(`export let calls=0; export class ResearchError extends Error{constructor(code,message,status=502){super(message);this.code=code;this.status=status;}}; export async function researchPlaces(){ calls++; return ${JSON.stringify(researched)}; }`);
  const guardUrl = moduleUrl((await readFile(new URL("../lib/api-guard.ts", import.meta.url), "utf8"))
    .replace('"./research"', JSON.stringify(researchUrl))
    .replace('typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined', '"unit-test-placeholder"'));
  const routeSource = (await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"))
    .replace('"@/lib/planner"', JSON.stringify(plannerUrl)).replace('"@/lib/research"', JSON.stringify(researchUrl)).replace('"@/lib/forecast"', JSON.stringify(forecastUrl))
    .replace('"@/lib/analysis-store"', JSON.stringify(new URL("../lib/analysis-store.ts", import.meta.url).href))
    .replace('"@/lib/api-guard"', JSON.stringify(guardUrl));
  const route = await import(moduleUrl(routeSource)) as { POST(request: Request): Promise<Response>; GET(): Response };
  const upstream = await import(researchUrl) as { calls: number };
  const url = "https://poppin.example/api/analyze";
  const request = () => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://poppin.example" }, body: JSON.stringify(input) });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-30T00:59:00Z") });
  const first = await (await route.POST(request())).json() as { cached: boolean; plan: { days: { stops: { arrival: string }[] }[] }; forecasts: unknown[] };
  assert.equal(first.cached, false);
  assert.equal(first.plan.days[0].stops[0].arrival, "10:00");
  assert.deepEqual(first.forecasts, []);
  t.mock.timers.tick(6 * 60_000);
  const second = await (await route.POST(request())).json() as typeof first;
  assert.equal(second.cached, true);
  assert.equal(second.plan.days[0].stops[0].arrival, "10:05");
  assert.equal(upstream.calls, 1);
  assert.equal(route.GET().status, 405);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example" }, body: "{}" }))).status, 403);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status, 400);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(8193) }))).status, 413);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }))).status, 415);
  assert.equal(upstream.calls, 1);
  await t.test("explicit refresh bypasses saved research while normal requests reuse the replacement", async () => {
    const refresh = request();
    refresh.headers.set("X-PopPin-Refresh", "1");
    const refreshed = await (await route.POST(refresh)).json() as typeof first;
    assert.equal(refreshed.cached, false);
    assert.equal(upstream.calls, 2);
    const reused = await (await route.POST(request())).json() as typeof first;
    assert.equal(reused.cached, true);
    assert.equal(upstream.calls, 2);
  });
  await t.test("API는 추출한 취향을 일정 계산에 연결하고 캐시에서도 점수를 유지한다", async () => {
    const requestWithTaste = () => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://poppin.example" }, body: JSON.stringify({ ...input, preferences: "스킨케어가 좋아요" }) });
    const scored = await (await route.POST(requestWithTaste())).json() as { cached: boolean; plan: { taste: { events: { score: number }[] }; days: { tasteScore: number }[] } };
    assert.equal(scored.plan.taste.events[0].score, 50);
    assert.equal(scored.plan.days[0].tasteScore, 50);
    const callsBeforeCache = upstream.calls;
    const cached = await (await route.POST(requestWithTaste())).json() as typeof scored;
    assert.equal(cached.cached, true);
    assert.equal(cached.plan.days[0].tasteScore, 50);
    assert.equal(upstream.calls, callsBeforeCache);
  });
});

test("one bounded API request uses the approved model and mandatory hosted search", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    count++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6.1-sol");
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.store, false);
    assert.equal(body.max_tool_calls, 4);
    assert.equal(body.max_output_tokens, 9000);
    assert.equal(body.tool_choice, "required");
    assert.equal(body.tools[0].type, "web_search");
    assert.deepEqual(body.include, ["web_search_call.action.sources"]);
    assert.equal(body.text.format.strict, true);
    const suppliedInput = JSON.parse(body.input);
    assert.equal(suppliedInput.searchPlan[0].originalAddress, input.places[0].address);
    assert.equal(suppliedInput.searchPlan[0].stages.length, 3);
    return Response.json(response());
  };
  try {
    const result = await researchPlaces(input, "unit-test-placeholder");
    assert.equal(result.model, MODEL);
    assert.equal(count, 1);
  } finally { globalThis.fetch = original; }
});

test("model unavailability returns a sanitized explicit error with no model fallback", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ error: { code: "model_not_found", message: "raw upstream sensitive detail" } }, { status: 404 }); };
  try {
    await assert.rejects(researchPlaces(input, "unit-test-placeholder"), (error: unknown) => error instanceof ResearchError && error.code === "model_unavailable" && !error.message.includes("sensitive"));
    assert.equal(count, 1);
  } finally { globalThis.fetch = original; }
});

test("upstream 429 distinguishes billing, spend, usage and temporary rate limits without leaking upstream details", async t => {
  const cases = [
    { code: "insufficient_quota", type: "insufficient_quota", expected: "billing_required" },
    { code: "credit_balance_exhausted", type: "insufficient_quota", expected: "billing_required" },
    { code: "project_spend_limit_exceeded", type: "insufficient_quota", expected: "spend_limit" },
    { code: "organization_spend_limit_exceeded", type: "insufficient_quota", expected: "spend_limit" },
    { code: "organization_usage_limit_exceeded", type: "insufficient_quota", expected: "usage_limit" },
    { code: null, type: "insufficient_quota", expected: "billing_required" },
    { code: "rate_limit_exceeded", type: "rate_limit_error", expected: "upstream_rate_limit" },
    { code: "slow_down", type: "rate_limit_error", expected: "upstream_rate_limit" },
    { code: "unknown_code", type: "unknown", expected: "upstream_limit" },
  ];
  for (const scenario of cases) await t.test(String(scenario.code), async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => { calls++; return Response.json({ error: { code: scenario.code, type: scenario.type, message: "raw upstream sensitive detail" } }, { status: 429 }); };
    try {
      await assert.rejects(researchPlaces(input, "unit-test-placeholder"), (error: unknown) => error instanceof ResearchError && error.status === 503 && error.code === scenario.expected && !error.message.includes("sensitive"));
      assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
  });
});

test("production API hides billing and configuration details while development keeps actionable diagnostics", async t => {
  const { researchErrorResponse } = await import(new URL("../lib/api-guard.ts", import.meta.url).href) as typeof import("../lib/api-guard");
  t.mock.method(console, "warn", () => {});
  for (const code of ["billing_required", "spend_limit", "usage_limit", "upstream_limit", "not_configured", "model_unavailable", "service_unavailable"]) {
    const error = new ResearchError(code, "개발 진단: OpenAI Billing 설정을 확인해 주세요.", 503);
    const production = await researchErrorResponse(error, false).json() as { error: string; code: string };
    assert.equal(production.code, "service_unavailable");
    assert.doesNotMatch(production.error, /OpenAI|Billing|크레딧|프로젝트|모델|키/);
    const development = await researchErrorResponse(error, true).json() as { error: string; code: string };
    assert.equal(development.error, error.message);
    assert.equal(development.code, code);
  }
  const temporary = await researchErrorResponse(new ResearchError("upstream_rate_limit", "개발 진단", 503), false).json() as { error: string; code: string };
  assert.equal(temporary.code, "rate_limited");
  assert.match(temporary.error, /요청이 몰리/);
  const invalid = await researchErrorResponse(new ResearchError("invalid_input", "날짜를 확인해 주세요.", 400), false).json() as { error: string; code: string };
  assert.equal(invalid.error, "날짜를 확인해 주세요.");
});

test("walk-in requires its own real matched source and remains independent of reservation sellout", () => {
  const walkIn = { status: "available", note: "예약 없이 현장 접수 가능", sourceUrl: official };
  const confirmed = parseResearchResponse(response([evidence({ admission: { reservation: "sold_out", lastEntry: null, note: "예약 매진, 현장 접수 별도", sourceUrl: official, walkIn } })]), input, now).evidence[0];
  assert.equal(confirmed.admission?.reservation, "sold_out");
  assert.equal(confirmed.admission?.walkIn?.status, "available");
  assert.equal(confirmed.admission?.walkIn?.sourceUrl, official);
  assert.deepEqual(confirmed.queue.length, 1);
  const unsupported = parseResearchResponse(response([evidence({ admission: { reservation: "available", lastEntry: null, note: "사전예약 제공", sourceUrl: official, walkIn: { ...walkIn, sourceUrl: "https://invented.example/walkin" } } })]), input, now).evidence[0];
  assert.equal(unsupported.admission?.walkIn?.status, "unknown");
  assert.equal(unsupported.admission?.walkIn?.sourceUrl, null);
  const invalidCutoff = parseResearchResponse(response([evidence({ admission: { reservation: "available", lastEntry: "오후 4시", note: "입장 마감", sourceUrl: official, walkIn } })]), input, now).evidence[0];
  assert.equal(invalidCutoff.admission?.walkIn?.status, "unknown");
  assert.equal(invalidCutoff.admission?.invalidLastEntry, true);
});


test("분석 분류는 해당 행사에 일치하는 검색 출처가 필요하며 사용자 장르로 대체하지 않는다", () => {
  const classification = { version: 1, category: "culture_education", subcategory: "media_education", experienceTags: ["escape_room", "puzzle"], sourceUrls: [official] };
  const classify = (extra: Record<string, unknown> = {}) => parseResearchResponse(response([evidence({ classification, ...extra })]), input, now).evidence[0].classification;
  assert.equal(classify()?.subcategory, "media_education");
  assert.equal(classify({ matched: false })?.category, "unclassified");
  assert.equal(classify({ classification: { ...classification, sourceUrls: [unrelated] } })?.category, "unclassified");
  assert.equal(classify({ classification: undefined })?.category, "unclassified");
});


test("취향 추출은 입력 문구에 근거하고 행사 분류와 독립적으로 반환한다", () => {
  const request = { ...input, preferences: "뷰티는 싫고 방탈출이 좋아요" };
  const signals = [
    { axis: "category", id: "beauty", direction: "dislike", quote: "뷰티는 싫고" },
    { axis: "experience", id: "escape_room", direction: "like", quote: "방탈출이 좋아요" },
    { axis: "experience", id: "photo_zone", direction: "like", quote: "사진이 좋아요" },
  ];
  const result = parseResearchResponse(response([evidence()], undefined, signals), request, now);
  assert.deepEqual(result.tasteSignals, signals.slice(0, 2));
  assert.equal(result.evidence[0].classification?.category, "unclassified");
  assert.deepEqual(parseResearchResponse(response(), request, now).tasteSignals, []);
});

test("AI prediction is kept even without matched evidence, labeled with the model and stripped of links and out-of-range picks", () => {
  const prediction = { likelyStart: "2026-10-01", likelyEnd: "2026-09-01", hours: { open: "11:00", close: "10:00" }, admission: "reservation",
    crowd: [{ day: "weekday", hour: 10, level: "low", waitMin: 0, waitMax: 10 }, { day: "weekday", hour: 10, level: "high", waitMin: 0, waitMax: 10 }, { day: "weekend", hour: 25, level: "high", waitMin: 0, waitMax: 10 }, { day: "weekend", hour: 14, level: "high", waitMin: 30, waitMax: 20 }],
    busyDates: [{ date: "2026-10-31", level: "very_high", reason: "주말 https://evil.example/x 방문" }, { date: "2026-12-25", level: "high", reason: "범위 밖" }],
    bestVisits: [{ date: "2026-10-30", time: "10:00", reason: "평일 오전" }, { date: "2026-10-30", time: "오전", reason: "형식 오류" }],
    rationale: "추정 근거입니다.", confidence: "low" };
  const parsed = parseResearchResponse(response([evidence({ matched: false, status: "not_found", prediction })]), input, now).evidence[0];
  assert.equal(parsed.matched, false);
  assert.deepEqual(parsed.prediction, { model: MODEL, likelyStart: "2026-10-01", likelyEnd: null, hours: null, admission: "reservation",
    crowd: [{ day: "weekday", hour: 10, level: "low", waitMin: 0, waitMax: 10 }], busyDates: [{ date: "2026-10-31", level: "very_high", reason: "주말 방문" }],
    bestVisits: [{ date: "2026-10-30", time: "10:00", reason: "평일 오전" }], rationale: "추정 근거입니다.", confidence: "low" });
  // A prediction never fills sourced fields.
  assert.deepEqual([parsed.eventStart, parsed.hours, parsed.queue], [null, [], []]);
});
