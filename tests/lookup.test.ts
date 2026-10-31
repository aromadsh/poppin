import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const { validateLookupInput, parseLookupResponse, lookupPlace } = await import(new URL("../lib/lookup.ts", import.meta.url).href) as typeof import("../lib/lookup");
const { ResearchError } = await import(new URL("../lib/research.ts", import.meta.url).href) as typeof import("../lib/research");
const now = new Date("2026-10-30T00:00:00Z");
const input = { name: "테스트 팝업", dateFrom: "2026-10-30", dateTo: "2026-10-31" };
const url = "https://example.com/popup";
function candidate(extra: Record<string, unknown> = {}) {
  return { name: input.name, exactNameMatch: true, address: "서울 성동구 연무장길 1", addressSourceUrl: url,
    genre: "캐릭터", genreSourceUrl: url, eventStart: "2026-10-20", eventEnd: "2026-11-01", eventYearExplicit: true, periodSourceUrl: url,
    sources: [{ title: "공식 안내", url, publishedAt: "2026-10-20" }], reason: "공식 행사 안내", ...extra };
}
function response(candidates = [candidate()], urls = [url]) {
  return { status: "completed", output: [
    { type: "web_search_call", status: "completed", action: { type: "search", sources: urls.map(url => ({ url, title: "공식 안내" })) } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ candidates }), annotations: [] }] },
  ] };
}
test("lookup validates name, Korea current date, real dates and inclusive 14-day range", () => {
  assert.deepEqual(validateLookupInput(input, now), input);
  for (const patch of [{ name: "가" }, { name: "x".repeat(101) }, { dateFrom: "2026-10-29" }, { dateTo: "2026-11-13" }, { dateTo: "2026-02-30" }])
    assert.throws(() => validateLookupInput({ ...input, ...patch }, now));
  assert.throws(() => validateLookupInput(input, new Date("2026-10-30T15:00:00Z")));
});
test("unique requires exact event name, sourced address and explicit overlapping event year", () => {
  const result = parseLookupResponse(response(), input, now);
  assert.equal(result.status, "unique");
  assert.equal(result.candidates[0].status, "active");
  assert.equal(result.candidates[0].address, candidate().address);
  assert.equal(result.searchCount, 1);
});
test("normal spelling differences preserve an exact named event without accepting another brand", () => {
  const requested = { ...input, name: "라이엇 게임즈 뮤직 앤 월즈 26 팝업스토어" };
  assert.equal(parseLookupResponse(response([candidate({ name: "라이엇 게임즈 뮤직 & 월즈2026" })]), requested, now).status, "unique");
  assert.equal(parseLookupResponse(response([candidate({ name: "다른 게임즈 뮤직 & 월즈2026" })]), requested, now).status, "unconfirmed");
});
test("same-name branches remain multiple; no result and past-year event are distinct", () => {
  assert.equal(parseLookupResponse(response([candidate(), candidate({ address: "부산 해운대구 해운대로 2" })]), input, now).status, "multiple");
  assert.equal(parseLookupResponse(response([]), input, now).status, "not_found");
  const past = parseLookupResponse(response([candidate({ eventStart: "2025-10-20", eventEnd: "2025-11-01" })]), input, now);
  assert.equal(past.status, "past");
  assert.equal(past.candidates[0].status, "past");
});
test("invented address links, missing years and mismatched names never permit autofill", () => {
  for (const patch of [{ addressSourceUrl: "https://fake.example/address" }, { eventYearExplicit: false }, { exactNameMatch: false }, { name: "다른 팝업" }, { periodSourceUrl: null }]) {
    const result = parseLookupResponse(response([candidate(patch)]), input, now);
    assert.equal(result.status, "unconfirmed");
    assert.equal(result.candidates[0].status, "unconfirmed");
  }
  const unverified = parseLookupResponse(response([candidate({ addressSourceUrl: "https://fake.example/address" })]), input, now);
  assert.equal(unverified.candidates[0].address, "");
  assert.equal(parseLookupResponse(response([candidate()], []), input, now).status, "not_found");
});
test("lookup requires completed hosted search and bounds published dates", () => {
  const raw = response(); raw.output.shift();
  assert.throws(() => parseLookupResponse(raw, input, now), (e: unknown) => e instanceof ResearchError && e.code === "search_failed");
  const result = parseLookupResponse(response([candidate({ sources: [{ title: "공식", url, publishedAt: "2027-01-01" }] })]), input, now);
  assert.equal(result.candidates[0].sources[0].publishedAt, null);
});
test("lookup uses approved model with mandatory bounded live search; unavailable model never falls back", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6.1-sol"); assert.equal(body.max_tool_calls, 2); assert.equal(body.max_output_tokens, 3000);
    assert.equal(body.reasoning.effort, "low"); assert.equal(body.store, false); assert.equal(body.tool_choice, "required");
    assert.ok(body.text.format.schema.properties.candidates.items.properties.classification.properties.category.enum.includes("beauty"));
    assert.equal(body.tools[0].type, "web_search"); assert.equal(body.text.format.strict, true);
    assert.match(body.instructions, /Asia\/Seoul/);
    return Response.json(response());
  };
  try {
    assert.equal((await lookupPlace(input, "unit-test-placeholder")).model, "gpt-6.1-sol");
    globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "model_not_found", message: "sensitive" } }, { status: 404 }); };
    await assert.rejects(lookupPlace(input, "unit-test-placeholder"), (e: unknown) => e instanceof ResearchError && e.code === "model_unavailable" && !e.message.includes("sensitive"));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

const moduleUrl = (source: string) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64");
async function guardModule(suffix: string) {
  return moduleUrl((await readFile(new URL("../lib/api-guard.ts", import.meta.url), "utf8"))
    .replace('"./research"', JSON.stringify(new URL("../lib/research.ts", import.meta.url).href))
    .replace('typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined', '"unit-test-placeholder"') + `\n// ${suffix}`);
}
test("shared budget enforces aggregate IP, per-operation, hourly and concurrent limits; release is idempotent", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  const guard = await import(await guardModule("budget")) as { acquireBudget(ip: string, op: "lookup" | "analyze"): () => void };
  const run = (ip: string, op: "lookup" | "analyze") => guard.acquireBudget(ip, op)();
  for (let i = 0; i < 600; i++) run("one", "lookup");
  assert.throws(() => run("one", "lookup"), (e: unknown) => e instanceof ResearchError && e.code === "rate_limited");
  for (let i = 0; i < 200; i++) run("one", "analyze");
  assert.throws(() => run("one", "analyze"), (e: unknown) => e instanceof ResearchError && e.code === "rate_limited");
  for (let i = 0; i < 300; i++) run("two", "analyze");
  assert.throws(() => run("two", "analyze"), (e: unknown) => e instanceof ResearchError && e.code === "rate_limited");
  const releaseA = guard.acquireBudget("three", "lookup");
  const releases = Array.from({ length: 199 }, (_, i) => guard.acquireBudget(`concurrent-${i}`, "analyze"));
  assert.throws(() => run("five", "lookup"), (e: unknown) => e instanceof ResearchError && e.code === "busy");
  releaseA(); releaseA();
  assert.doesNotThrow(() => run("released-slot", "lookup"));
  releases.forEach(release => release());
  for (let i = 0; i < 2699; i++) run(`remaining-${Math.floor(i / 500)}`, "lookup");
  assert.throws(() => run("new-ip", "lookup"), (e: unknown) => e instanceof ResearchError && e.code === "rate_limited");
  t.mock.timers.tick(60 * 60_000);
  assert.doesNotThrow(() => run("one", "analyze"));
});

test("lookup route caches and deduplicates free results, rejects invalid requests and shares analyze concurrency", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  const result = parseLookupResponse(response(), input, now);
  const researchUrl = new URL("../lib/research.ts", import.meta.url).href;
  const lookupUrl = moduleUrl(`export {validateLookupInput} from ${JSON.stringify(new URL("../lib/lookup.ts", import.meta.url).href)};
    export let calls=0; let pause=false; const waiting=[]; export function hold(){pause=true;} export function finish(){pause=false; for(const resolve of waiting.splice(0)) resolve(${JSON.stringify(result)});}
    export async function lookupPlace(){calls++; if(pause) return new Promise(resolve=>waiting.push(resolve)); return ${JSON.stringify(result)};}`);
  const guardUrl = await guardModule("routes");
  const source = (await readFile(new URL("../app/api/lookup/route.ts", import.meta.url), "utf8"))
    .replace('"@/lib/lookup"', JSON.stringify(lookupUrl)).replace('"@/lib/research"', JSON.stringify(researchUrl)).replace('"@/lib/api-guard"', JSON.stringify(guardUrl));
  const route = await import(moduleUrl(source)) as { POST(request: Request): Promise<Response>; GET(): Response };
  const upstream = await import(lookupUrl) as { calls: number; hold(): void; finish(): void };
  const guard = await import(guardUrl) as { acquireBudget(ip: string, op: "lookup" | "analyze"): () => void };
  const request = (name = input.name, headers: Record<string, string> = {}, body?: string) => new Request("https://poppin.example/api/lookup", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://poppin.example", ...headers }, body: body ?? JSON.stringify({ ...input, name }),
  });
  const data = async (response: Response) => await response.json() as { cached: boolean };
  const first = await data(await route.POST(request()));
  assert.equal(first.cached, false);
  assert.equal((await data(await route.POST(request()))).cached, true);
  assert.equal(upstream.calls, 1);
  assert.equal(route.GET().status, 405);
  assert.equal((await route.POST(request(input.name, { Origin: "https://other.example" }))).status, 403);
  assert.equal((await route.POST(request(input.name, {}, "{}"))).status, 400);
  assert.equal((await route.POST(request(input.name, {}, "x".repeat(4097)))).status, 413);
  assert.equal((await route.POST(request(input.name, { "Content-Type": "text/plain" }))).status, 415);
  upstream.hold();
  const pending = route.POST(request("동일 요청"));
  for (let i = 0; i < 100 && upstream.calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(upstream.calls, 2);
  const duplicate = route.POST(request("동일 요청"));
  const releaseAnalyze = Array.from({ length: 199 }, () => guard.acquireBudget("another-ip", "analyze"));
  assert.equal((await route.POST(request("다른 요청"))).status, 429);
  releaseAnalyze.forEach(release => release()); upstream.finish();
  assert.equal((await data(await pending)).cached, false);
  assert.equal((await data(await duplicate)).cached, true);
  assert.equal(upstream.calls, 2);
  for (let i = 0; i < 598; i++) assert.equal((await route.POST(request(`새 검색 ${i}`))).status, 200);
  assert.equal((await route.POST(request("횟수 초과"))).status, 429);
  assert.equal((await route.POST(request("새 검색 597"))).status, 200);
  assert.equal(upstream.calls, 600);
  t.mock.timers.tick(10 * 60_000 + 1);
  assert.equal((await data(await route.POST(request()))).cached, false);
  assert.equal(upstream.calls, 601);
});


test("자동 검색은 상세 장르를 유지하고 출처가 있는 고정 분류만 반환한다", () => {
  const classification = { version: 1, category: "beauty", subcategory: "skincare", experienceTags: ["product_trial"], sourceUrls: [url] };
  const lookup = (extra = {}) => parseLookupResponse(response([candidate({ genre: "뷰티·스킨케어 체험", classification: { ...classification, ...extra } })]), input, now).candidates[0];
  assert.equal(lookup().genre, "뷰티·스킨케어 체험");
  assert.equal(lookup().classification?.subcategory, "skincare");
  assert.equal(lookup({ subcategory: "pizza" }).classification?.subcategory, "unclassified");
  assert.equal(lookup({ sourceUrls: ["https://invented.example/event"] }).classification?.category, "unclassified");
  assert.equal(parseLookupResponse(response([candidate({ exactNameMatch: false, classification })]), input, now).candidates[0].classification?.category, "unclassified");
});
