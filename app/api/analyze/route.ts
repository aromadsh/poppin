import { validateInput, planVisits, type Input } from "@/lib/planner";
import { researchPlaces, ResearchError } from "@/lib/research";
import { forecastQueues } from "@/lib/forecast";

export const dynamic = "force-dynamic";
const TTL = 10 * 60_000;
type Research = Awaited<ReturnType<typeof researchPlaces>>;
const cache = new Map<string, { expires: number; value: Research }>();
const inflight = new Map<string, Promise<Research>>();
const ips = new Map<string, { start: number; count: number }>();
let globalWindow = { start: Date.now(), count: 0 };

function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}

function analyze(input: Input, result: Research, cached: boolean) {
  const now = new Date();
  return json({ ...result, plan: planVisits(input, result.evidence, now), forecasts: forecastQueues(input, result.evidence, now), cached });
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function apiKey() {
  const local = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  if (local) return local;
  try {
    const { env } = await import("cloudflare:workers");
    return (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  } catch { return undefined; }
}

async function readInput(request: Request): Promise<Input> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ResearchError("invalid_input", "JSON 형식으로 요청해 주세요.", 415);
  if (Number(request.headers.get("content-length")) > 8192) throw new ResearchError("invalid_input", "입력 내용은 8KB 이내로 줄여 주세요.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ResearchError("invalid_input", "장소와 방문 시간을 입력해 주세요.", 400);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new ResearchError("invalid_input", "입력 내용은 8KB 이내로 줄여 주세요.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return validateInput(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    // Validation errors come from our own bounded input validator, never upstream output.
    const message = error instanceof SyntaxError || error instanceof TypeError ? "입력 형식을 확인해 주세요." : error instanceof Error ? error.message : "입력을 확인해 주세요.";
    throw new ResearchError("invalid_input", message, 400);
  } finally { reader.releaseLock(); }
}

function guard(ip: string) {
  const now = Date.now();
  for (const [key, bucket] of ips) if (now - bucket.start >= TTL) ips.delete(key);
  if (now - globalWindow.start >= 60 * 60_000) globalWindow = { start: now, count: 0 };
  const bucket = ips.get(ip) ?? { start: now, count: 0 };
  if (bucket.count >= 3 || globalWindow.count >= 40) throw new ResearchError("rate_limited", "분석 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429);
  if (inflight.size >= 2) throw new ResearchError("busy", "다른 분석을 진행 중입니다. 잠시 후 다시 시도해 주세요.", 429);
  if (ips.size >= 1000 && !ips.has(ip)) ips.delete(ips.keys().next().value!);
  ips.set(ip, { ...bucket, count: bucket.count + 1 });
  globalWindow.count++;
}

// shortcut: rate and concurrency guards are isolate-local; use a Durable Object or platform rate binding for a shared production budget.
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const siteOrigin = new URL(request.url).origin;
    if ((origin && origin !== siteOrigin) || request.headers.get("sec-fetch-site") === "cross-site") throw new ResearchError("forbidden", "이 사이트에서 요청해 주세요.", 403);
    const input = await readInput(request);
    const refresh = request.headers.get("X-PopPin-Refresh") === "1";
    const key = await digest(JSON.stringify(input));
    const now = Date.now();
    for (const [hash, item] of cache) if (item.expires <= now) cache.delete(hash);
    const saved = cache.get(key);
    if (saved && !refresh) return analyze(input, saved.value, true);
    const pending = inflight.get(key);
    if (pending) return analyze(input, await pending, true);
    const secret = await apiKey();
    if (!secret) throw new ResearchError("not_configured", "분석 서비스 키가 아직 연결되지 않았습니다.", 503);
    const ip = await digest(request.headers.get("cf-connecting-ip") ?? "local-preview");
    // A different request can have started while the key/IP promises resolved.
    const savedAfterAwait = cache.get(key);
    if (!refresh && savedAfterAwait && savedAfterAwait.expires > Date.now()) return analyze(input, savedAfterAwait.value, true);
    const pendingAfterAwait = inflight.get(key);
    if (pendingAfterAwait) return analyze(input, await pendingAfterAwait, true);
    guard(ip);
    const task = researchPlaces(input, secret).then(result => {
      if (cache.size >= 50) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + TTL, value: result });
      return result;
    });
    inflight.set(key, task);
    try { return analyze(input, await task, false); } finally { inflight.delete(key); }
  } catch (error) {
    if (error instanceof ResearchError) return json({ error: error.message, code: error.code }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
    return json({ error: "분석 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.", code: "internal_error" }, 500);
  }
}

export function GET() { return json({ error: "POST 요청을 사용해 주세요.", code: "method_not_allowed" }, 405, { Allow: "POST" }); }
