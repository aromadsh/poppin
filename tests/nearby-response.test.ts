import test from "node:test";
import assert from "node:assert/strict";
import { readNearbyResponse } from "../lib/nearby-response";
import { streamJson } from "../lib/api-guard";
import { ResearchError } from "../lib/research";

test("검색이 완료되기 전에 진행 응답을 보내고 최종 결과를 읽는다", async () => {
  let complete!: (value: unknown) => void;
  const task = new Promise(resolve => { complete = resolve; });
  const response = streamJson(task);
  assert.match(response.headers.get("content-type")!, /ndjson/);
  const reader = response.clone().body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /progress/);
  const result = readNearbyResponse(response);
  complete({ recommendations: [{ id: "first" }] });
  assert.deepEqual(await result, { recommendations: [{ id: "first" }] });
  await reader.cancel();
});

test("긴 검색에는 진행 신호가 이어지고 연결 취소 후에도 공유 검색은 완료된다", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let complete!: (value: unknown) => void;
  const task = new Promise(resolve => { complete = resolve; });
  const response = streamJson(task), reader = response.body!.getReader();
  await reader.read();
  t.mock.timers.tick(120_000);
  for (let i = 0; i < 12; i++) assert.match(new TextDecoder().decode((await reader.read()).value), /progress/);
  await reader.cancel();
  complete({ recommendations: [] });
  await task;
});

test("스트림 검색 실패는 운영용 안내로 전달하고 내부 오류와 키 진단은 숨긴다", async () => {
  const response = streamJson(Promise.reject(new ResearchError("billing_required", "sensitive billing details", 503)));
  const result = await readNearbyResponse<{ error: string }>(response);
  assert.match(result.error, /분석 서비스/);
  assert.doesNotMatch(result.error, /sensitive|billing/);
  const unknown = await readNearbyResponse<{ error: string }>(streamJson(Promise.reject(new Error("secret"))));
  assert.doesNotMatch(unknown.error, /secret/);
});

test("HTML 오류·로그인 페이지와 잘못된 JSON에 파싱 원문 대신 재시도 안내를 표시한다", async () => {
  for (const response of [new Response("<!DOCTYPE html><html>gateway error</html>", { status: 504, headers: { "Content-Type": "text/html" } }),
    new Response("<!DOCTYPE html><html>sign in</html>", { headers: { "Content-Type": "text/html" } }),
    new Response("broken", { headers: { "Content-Type": "application/json" } })]) {
    await assert.rejects(readNearbyResponse(response), error => error instanceof Error && /다시|시간/.test(error.message) && !/Unexpected|DOCTYPE|JSON/.test(error.message));
  }
});

test("청크 경계와 한글 UTF-8 분할을 보존하고 완료되지 않은 스트림은 거부한다", async () => {
  const bytes = new TextEncoder().encode('{"type":"progress"}\n{"type":"result","data":{"name":"성수 팝업"}}\n');
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  assert.deepEqual(await readNearbyResponse(new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } })), { name: "성수 팝업" });
  await assert.rejects(readNearbyResponse(new Response('{"type":"progress"}\n', { headers: { "Content-Type": "application/x-ndjson" } })), /연결|다시/);
  const normal = await readNearbyResponse(Response.json({ error: "추천 정보가 만료됐어요.", code: "analysis_expired" }, { status: 409 }));
  assert.deepEqual(normal, { error: "추천 정보가 만료됐어요.", code: "analysis_expired" });
});
