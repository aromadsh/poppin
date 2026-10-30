import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import type { Input } from "../lib/planner";
const { parseResearchResponse, researchPlaces, ResearchError, MODEL } = await import(new URL("../lib/research.ts", import.meta.url).href) as typeof import("../lib/research");

const now = new Date("2026-10-30T00:00:00Z");
const input: Input = { places: [{ name: "테스트 팝업", address: "서울 성동구 테스트", genre: "캐릭터", stayMinutes: 60 }], dateFrom: "2026-10-30", dateTo: "2026-10-31", timeFrom: "10:00", timeTo: "18:00", preferences: "" };
const official = "https://example.com/official";
const unrelated = "https://example.com/related";
function evidence(overrides: Record<string, unknown> = {}) {
  return { index: 0, matched: true, status: "verified", eventStart: "2026-10-01", eventEnd: "2026-11-03", eventSourceUrl: official,
    hours: [{ date: "2026-10-30", open: "10:00", close: "18:00", lastEntry: null as string | null, sourceUrl: official }], admission: { reservation: "not_required", lastEntry: null, note: "예약 없는 현장 입장", sourceUrl: official }, lat: 37.5, lng: 127, locationSourceUrl: official,
    value: "공식 굿즈", summary: "공식 공지 확인", supportUrls: [official], queue: [{ date: "2026-10-29", time: "12:00", min: 20, max: 40, kind: "observed", sourceUrl: official }],
    sources: [{ title: "공식 공지", url: official, publishedAt: "2026-10-01", matched: true, note: "장소와 행사 연도 일치" }], ...overrides };
}
function response(entries = [evidence()], urls = [official, unrelated]) {
  return { status: "completed", output: [
    { type: "web_search_call", status: "completed", action: { type: "search", sources: urls.map(url => ({ type: "url", url, title: url })) } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ evidence: entries }), annotations: [] }] },
  ] };
}

test("actual search URLs support facts and every unused returned source is retained as unmatched", () => {
  const result = parseResearchResponse(response(), input, now);
  assert.equal(result.searchCount, 1);
  assert.equal(result.evidence[0].status, "verified");
  assert.equal(result.evidence[0].hours.length, 1);
  assert.equal(result.evidence[0].queue.length, 1);
  assert.equal(result.evidence[0].sources.find(s => s.url === unrelated)?.matched, false);
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
  const plannerUrl = moduleUrl((await readFile(new URL("../lib/planner.ts", import.meta.url), "utf8")).replace('"./forecast"', JSON.stringify(forecastUrl)));
  const researched = { ...parseResearchResponse(response(), input, now), retrievedAt: now.toISOString(), model: MODEL };
  const researchUrl = moduleUrl(`export let calls=0; export class ResearchError extends Error{constructor(code,message,status=502){super(message);this.code=code;this.status=status;}}; export async function researchPlaces(){ calls++; return ${JSON.stringify(researched)}; }`);
  const guardUrl = moduleUrl((await readFile(new URL("../lib/api-guard.ts", import.meta.url), "utf8"))
    .replace('"./research"', JSON.stringify(researchUrl))
    .replace('typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined', '"unit-test-placeholder"'));
  const routeSource = (await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"))
    .replace('"@/lib/planner"', JSON.stringify(plannerUrl)).replace('"@/lib/research"', JSON.stringify(researchUrl)).replace('"@/lib/forecast"', JSON.stringify(forecastUrl))
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
    assert.equal(body.max_output_tokens, 6000);
    assert.equal(body.tool_choice, "required");
    assert.equal(body.tools[0].type, "web_search");
    assert.deepEqual(body.include, ["web_search_call.action.sources"]);
    assert.equal(body.text.format.strict, true);
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
