import test from "node:test";
import { readFileSync } from "node:fs";
import type { Input } from "../lib/planner";
import assert from "node:assert/strict";
import { PopupPlacesController } from "../lib/place-input";
import type { LookupCandidate, LookupResult } from "../lib/lookup";

const dates = ["2099-10-30", "2099-10-31"] as const;
const candidate = (id = "a", extra: Partial<LookupCandidate> = {}): LookupCandidate => ({ id, name: "테스트 팝업", address: "서울 성동구 연무장길 1", genre: "캐릭터", eventStart: dates[0], eventEnd: dates[1], status: "active", sources: [{ title: "공식 안내", url: "https://example.com/popup", publishedAt: null }], reason: "공식 안내 확인", ...extra });
const result = (status: LookupResult["status"] = "unique", candidates = [candidate()]): LookupResult => ({ status, candidates, retrievedAt: new Date().toISOString(), cached: false, model: "gpt-6.1-sol", searchCount: 1 });
function setup() {
  const calls: { body: Record<string, string>; signal: AbortSignal; answer: (data: LookupResult, ok?: boolean) => void }[] = [];
  const fetcher = ((_url: unknown, init: RequestInit) => new Promise<Response>(resolve => calls.push({ body: JSON.parse(init.body as string), signal: init.signal as AbortSignal, answer: (data, ok = true) => resolve(new Response(JSON.stringify(data), { status: ok ? 200 : 500 })) }))) as typeof fetch;
  const controller = new PopupPlacesController(dates[0], dates[1], fetcher);
  const id = controller.getSnapshot()[0].id;
  return { controller, id, calls, row: () => controller.getSnapshot().find(row => row.id === id)! };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("automatic lookup calls the default browser fetch with its global receiver", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async function (this: unknown) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    calls++;
    return Response.json(result());
  } as typeof fetch;
  const c = new PopupPlacesController(...dates);
  t.after(() => { c.deactivate(); globalThis.fetch = original; });
  const id = c.getSnapshot()[0].id;
  c.updatePlace(id, "name", "코치 'LIVE YOUR STORY' 팝업");
  t.mock.timers.tick(1200);
  await settle();
  assert.equal(calls, 1);
  assert.equal(c.getSnapshot()[0].lookupStatus, "resolved");
});

test("connection and unreadable responses stay distinct from a sourced empty search", async t => {
  for (const [fetcher, expected] of [
    [async () => { throw new TypeError("private network details"); }, /연결하지 못/],
    [async () => new Response("<html>server error</html>"), /응답을 읽을 수 없/],
    [async () => Response.json({ unexpected: true }), /응답을 읽을 수 없/],
    [async () => Response.json(result("not_found", [])), /일치하는 행사를 찾지 못/],
  ] as const) {
    const c = new PopupPlacesController(...dates, fetcher as typeof fetch);
    t.after(() => c.deactivate());
    const id = c.getSnapshot()[0].id;
    c.updatePlace(id, "name", "테스트 팝업");
    await c.lookupNow(id);
    assert.match(c.getSnapshot()[0].lookupMessage, expected);
    assert.doesNotMatch(c.getSnapshot()[0].lookupMessage, /private network|<html>/);
  }
});

test("confirmed reservation survives submission and clears when event identity changes", async t => {
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업");
  const lookup = c.lookupNow(id); calls[0].answer(result()); await lookup;
  const reservation = { date: dates[0], time: "13:00", confirmed: true as const };
  c.setReservation(id, reservation);
  assert.deepEqual((await c.resolvePlaces())[0].reservation, reservation);
  c.updatePlace(id, "address", "다른 건물");
  assert.equal(c.getSnapshot()[0].reservation, undefined);
  c.setReservation(id, reservation);
  c.setDates(dates[0], dates[0]);
  assert.equal(c.getSnapshot()[0].reservation, undefined);
  c.setReservation(id, reservation);
  c.updatePlace(id, "name", "다른 행사");
  assert.equal(c.getSnapshot()[0].reservation, undefined);
});

test("name-only submit starts and awaits unique lookup, returning only analyzer fields", async t => {
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업");
  const submission = c.resolvePlaces();
  assert.equal(calls.length, 1);
  assert.equal(row().lookupStatus, "loading");
  calls[0].answer(result());
  assert.deepEqual(await submission, [{ name: "테스트 팝업", address: "서울 성동구 연무장길 1", genre: "캐릭터", stayMinutes: 45 }]);
  assert.equal(row().autoAddress, true);
});

test("multiple candidates require explicit active selection", async t => {
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업");
  const lookup = c.lookupNow(id);
  calls[0].answer(result("multiple", [candidate(), candidate("b", { address: "서울 마포구 2" }), candidate("old", { status: "past" })]));
  await lookup;
  assert.equal(row().address, "");
  await assert.rejects(c.resolvePlaces(), /선택|직접/);
  c.selectCandidate(id, "old");
  assert.equal(row().address, "");
  c.selectCandidate(id, "b");
  assert.equal((await c.resolvePlaces())[0].address, "서울 마포구 2");
});

test("not found, past, unconfirmed and errors allow manual completion", async t => {
  for (const status of ["not_found", "past", "unconfirmed", "error"] as const) {
    const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
    c.updatePlace(id, "name", "테스트 팝업");
    const lookup = c.lookupNow(id);
    calls[0].answer(result(status === "error" ? "not_found" : status, []), status !== "error");
    await lookup;
    assert.equal(row().lookupStatus, status);
    const unresolved = c.resolvePlaces();
    if (status === "error") calls[1].answer(result("not_found", []));
    await assert.rejects(unresolved, /직접/);
    c.updatePlace(id, "address", "직접 주소"); c.updatePlace(id, "genre", "직접 장르");
    assert.equal((await c.resolvePlaces())[0].address, "직접 주소");
    assert.equal(calls.length, status === "error" ? 2 : 1);
  }
});

test("old responses cannot overwrite renamed rows even when fetch ignores abort", async t => {
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "처음 팝업"); const old = c.lookupNow(id);
  c.updatePlace(id, "name", "나중 팝업"); const latest = c.lookupNow(id);
  assert.equal(calls[0].signal.aborted, true);
  calls[1].answer(result("unique", [candidate("new", { address: "새 주소" })])); await latest;
  calls[0].answer(result()); await old;
  assert.equal(row().address, "새 주소");
});

test("deletion and replacement use stable ids and cannot resurrect deleted rows", async t => {
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); const lookup = c.lookupNow(id);
  c.removePlace(id); c.addPlace();
  calls[0].answer(result()); await lookup;
  assert.equal(c.getSnapshot().length, 1);
  assert.notEqual(c.getSnapshot()[0].id, id);
  assert.equal(c.getSnapshot()[0].address, "");
});

test("manual edits before or during lookup are preserved independently", async t => {
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); c.updatePlace(id, "genre", "내 취향");
  const lookup = c.lookupNow(id); c.updatePlace(id, "address", "내 주소");
  calls[0].answer(result()); await lookup;
  assert.equal(row().genre, "내 취향"); assert.equal(row().address, "내 주소");
  assert.equal(row().autoAddress, false); assert.equal(row().autoGenre, false);
});

test("debounce, shared in-flight requests and result cache avoid repeated searches", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스"); t.mock.timers.tick(700);
  c.updatePlace(id, "name", "테스트 팝업"); t.mock.timers.tick(1199);
  assert.equal(calls.length, 0); t.mock.timers.tick(1);
  c.addPlace(); const second = c.getSnapshot()[1].id;
  c.updatePlace(second, "name", "테스트 팝업"); const lookup = c.lookupNow(second);
  assert.equal(calls.length, 1);
  c.removePlace(id); assert.equal(calls[0].signal.aborted, false);
  calls[0].answer(result()); await lookup;
  c.updatePlace(second, "name", "다른 팝업"); c.updatePlace(second, "name", "테스트 팝업");
  await c.lookupNow(second); assert.equal(calls.length, 1);
  assert.equal(c.getSnapshot()[0].address, "서울 성동구 연무장길 1");
});

test("date changes invalidate automatic values, preserve manual values and discard old responses", async t => {
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); let lookup = c.lookupNow(id); calls[0].answer(result()); await lookup;
  c.updatePlace(id, "genre", "직접 장르");
  c.setDates("2099-11-01", "2099-11-02");
  assert.equal(row().address, ""); assert.equal(row().genre, "직접 장르");
  lookup = c.lookupNow(id);
  assert.equal(calls[1].body.dateFrom, "2099-11-01");
  c.setDates("2099-11-02", "2099-11-01"); calls[1].answer(result()); await lookup;
  assert.equal(row().address, ""); assert.match(row().lookupMessage, /날짜/);
  await assert.rejects(c.resolvePlaces(), /날짜/); assert.equal(calls.length, 2);
});

test("submit rejects if any user input changes while its lookup is pending", async t => {
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); const submission = c.resolvePlaces();
  c.updatePlace(id, "stayMinutes", 90); calls[0].answer(result());
  await assert.rejects(submission, /변경.*다시/);
});

test("lifecycle cleanup aborts lookups and allows StrictMode reactivation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); t.mock.timers.tick(1200);
  c.deactivate(); c.activate(); t.mock.timers.tick(1200);
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls.length, 2);
  calls[0].answer(result("unique", [candidate("stale", { address: "옛 주소" })])); await settle();
  assert.equal(row().address, "");
  calls[1].answer(result()); await settle(); assert.equal(row().address, "서울 성동구 연무장길 1");
});

test("IME composition pauses automatic lookup until the completed name is idle", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.setComposing(id, true); c.updatePlace(id, "name", "테스트 팝업");
  t.mock.timers.tick(5000); assert.equal(calls.length, 0);
  await assert.rejects(c.resolvePlaces(), /입력.*마친/);
  c.setComposing(id, false); t.mock.timers.tick(1199); assert.equal(calls.length, 0);
  t.mock.timers.tick(1); assert.equal(calls.length, 1); calls[0].answer(result()); await settle();
});

test("one-character names need manual details and invalid dates never reach lookup", async t => {
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "팝"); await assert.rejects(c.resolvePlaces(), /2~100|직접/);
  assert.equal(calls.length, 0);
  c.updatePlace(id, "address", "직접 주소"); c.updatePlace(id, "genre", "직접 장르");
  assert.equal((await c.resolvePlaces())[0].name, "팝");
  c.setDates("2099-02-30", dates[1]); await assert.rejects(c.resolvePlaces(), /날짜/);
  c.setDates("2099-10-01", dates[1]); await assert.rejects(c.resolvePlaces(), /날짜/);
  assert.equal(calls.length, 0);
});

test("pending submit rejects promptly when its row is deleted even if fetch never settles", async t => {
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); const submission = c.resolvePlaces();
  c.removePlace(id); await assert.rejects(submission, /변경.*다시/);
  calls[0].answer(result()); await settle();
});

test("initial row ids stay deterministic across server and client controller creation", t => {
  const first = setup(), second = setup(); t.after(() => { first.controller.deactivate(); second.controller.deactivate(); });
  assert.equal(first.id, second.id);
});

test("a stalled lookup times out, aborts fetch and permits manual completion", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); const lookup = c.lookupNow(id);
  t.mock.timers.tick(70_000); await lookup;
  assert.equal(calls[0].signal.aborted, true); assert.equal(row().lookupStatus, "error");
  assert.match(row().lookupMessage, /시간.*직접/);
  calls[0].answer(result()); await settle(); assert.equal(row().address, "");
});

test("a bounded server rate-limit reason is displayed with the manual-entry option", async t => {
  const fetcher = (async () => new Response(JSON.stringify({ error: "검색 요청 한도를 초과했어요. 1분 후 다시 시도해 주세요." }), { status: 429 })) as typeof fetch;
  const c = new PopupPlacesController(...dates, fetcher); t.after(() => c.deactivate());
  const id = c.getSnapshot()[0].id; c.updatePlace(id, "name", "테스트 팝업"); await c.lookupNow(id);
  assert.match(c.getSnapshot()[0].lookupMessage, /한도.*1분.*직접/);
});

test("three name-only rows queue behind a two-request limit and all resolve", async t => {
  const { controller: c, calls } = setup(); t.after(() => c.deactivate());
  c.addPlace(); c.addPlace();
  c.getSnapshot().forEach((row, index) => c.updatePlace(row.id, "name", `팝업 ${index}`));
  const submission = c.resolvePlaces(); assert.equal(calls.length, 2);
  calls[0].answer(result()); await settle(); assert.equal(calls.length, 3);
  calls[1].answer(result()); calls[2].answer(result());
  assert.equal((await submission).length, 3);
});

test("explicit submit retries an earlier request error once without an automatic retry loop", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); const lookup = c.lookupNow(id);
  calls[0].answer(result(), false); await lookup;
  t.mock.timers.tick(10_000); assert.equal(calls.length, 1);
  const submission = c.resolvePlaces(); assert.equal(calls.length, 2);
  calls[1].answer(result()); assert.equal((await submission)[0].address, "서울 성동구 연무장길 1");
});

test("cancelled queued rows never issue a fetch when a running slot becomes available", async t => {
  const { controller: c, calls } = setup(); t.after(() => c.deactivate());
  c.addPlace(); c.addPlace();
  const ids = c.getSnapshot().map(row => row.id);
  ids.forEach((id, index) => c.updatePlace(id, "name", `팝업 ${index}`));
  const pending = ids.map(c.lookupNow); assert.equal(calls.length, 2);
  c.removePlace(ids[2]); calls[0].answer(result()); calls[1].answer(result());
  await Promise.all(pending); await settle(); assert.equal(calls.length, 2);
});

test("a verified address still autofills when genre is unknown and manual genre completes it", async t => {
  const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "테스트 팝업"); const lookup = c.lookupNow(id);
  calls[0].answer(result("unique", [candidate("a", { genre: "" })])); await lookup;
  assert.equal(row().address, "서울 성동구 연무장길 1"); assert.equal(row().genre, "");
  assert.equal(row().lookupStatus, "resolved"); assert.match(row().lookupMessage, /장르.*직접/);
  await assert.rejects(c.resolvePlaces(), /장르.*직접|주소와 장르.*직접/);
  c.updatePlace(id, "genre", "수동 장르"); assert.equal((await c.resolvePlaces())[0].genre, "수동 장르");
  assert.equal(calls.length, 1);
});


test("preset restores saved inputs and an unapplied reservation without automatic lookup", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date("2026-10-31T00:00:00Z").getTime() });
  const preset = JSON.parse(readFileSync(new URL("./fixtures/seongsu-manual-input-20261031.json", import.meta.url), "utf8")) as { input: Input; reservationDrafts: { placeIndex: number; date: string; time: string }[] };
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "이전 입력");
  c.loadPreset(preset.input, preset.reservationDrafts);
  c.setDates(preset.input.dateFrom, preset.input.dateTo);
  c.deactivate(); c.activate();
  t.mock.timers.tick(10000); await settle();
  assert.equal(calls.length, 0);
  assert.equal(c.getSnapshot().length, 3);
  assert.equal(c.getSnapshot()[0].stayMinutes, 120);
  assert.deepEqual(c.getSnapshot()[0].reservationDraft, { date: "2026-11-02", time: "14:00" });
  assert.equal(c.getSnapshot()[0].reservation, undefined);
  assert.equal(c.getSnapshot()[0].lookupStatus, "manual");
  assert.deepEqual(await c.resolvePlaces(), preset.input.places);
  const firstId = c.getSnapshot()[0].id;
  c.loadPreset(preset.input, preset.reservationDrafts);
  assert.notEqual(c.getSnapshot()[0].id, firstId);
  assert.equal(calls.length, 0);
});

test("preset replacement aborts pending lookup and rejects stale results", async t => {
  const { controller: c, id, calls } = setup(); t.after(() => c.deactivate());
  c.updatePlace(id, "name", "이전 입력");
  const pending = c.lookupNow(id);
  c.loadPreset({ places: [{ name: "저장한 입력", address: "저장한 주소", genre: "뷰티", stayMinutes: 45 }], dateFrom: dates[0], dateTo: dates[1], timeFrom: "11:00", timeTo: "19:00", preferences: "" });
  assert.equal(calls[0].signal.aborted, true);
  calls[0].answer(result()); await pending;
  assert.equal(c.getSnapshot()[0].address, "저장한 주소");
  assert.equal(c.getSnapshot()[0].lookupResult, undefined);
  assert.equal(calls.length, 1);
});


test("자동 분류는 입력 상태에 보관하고 장르·장소 수정 시 초기화한다", async t => {
  const classification = { version: 1 as const, category: "beauty" as const, subcategory: "skincare" as const, experienceTags: ["product_trial" as const], sourceUrls: ["https://example.com/popup"] };
  for (const field of ["genre", "name", "address"] as const) {
    const { controller: c, id, calls, row } = setup(); t.after(() => c.deactivate());
    c.updatePlace(id, "name", "테스트 팝업");
    const lookup = c.lookupNow(id); calls[0].answer(result("unique", [candidate("a", { classification })])); await lookup;
    assert.deepEqual(row().classification, classification);
    c.updatePlace(id, field, "직접 수정");
    assert.equal(row().classification, undefined);
  }
});
