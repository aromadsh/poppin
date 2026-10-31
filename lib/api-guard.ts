import { ResearchError } from "./research";

export function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}

/** Keep the response active while sequential web searches finish behind the gateway. */
export function streamJson(task: Promise<unknown>) {
  const encoder = new TextEncoder();
  let closed = false, heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); };
      const finish = (value: unknown) => {
        clearInterval(heartbeat);
        if (closed) return;
        send(value); closed = true; controller.close();
      };
      send({ type: "progress" });
      heartbeat = setInterval(() => send({ type: "progress" }), 10_000);
      void task.then(data => finish({ type: "result", data }), async error => {
        const response = error instanceof ResearchError ? researchErrorResponse(error) : json({ error: "주변 팝업을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", code: "internal_error" }, 500);
        finish({ type: "error", data: await response.json() });
      });
    },
    cancel() { closed = true; clearInterval(heartbeat); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" } });
}

/** Keep operator setup details out of production responses, including their error codes. */
export function researchErrorResponse(error: ResearchError, development = import.meta.env?.DEV === true) {
  const serviceCodes = new Set(["billing_required", "spend_limit", "usage_limit", "upstream_limit", "not_configured", "model_unavailable", "service_unavailable"]);
  let message = error.message, code = error.code;
  if (!development && serviceCodes.has(code)) {
    message = "현재 분석 서비스를 이용할 수 없습니다. 나중에 다시 확인해 주세요.";
    code = "service_unavailable";
  } else if (!development && code === "upstream_rate_limit") {
    message = "요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.";
    code = "rate_limited";
  }
  if (error.status >= 500) console.warn("[PopPin] service request failed", { code: error.code, status: error.status });
  return json({ error: message, code }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
}

export async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function apiKey() {
  const local = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  if (local) return local;
  try {
    const { env } = await import("cloudflare:workers");
    return (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  } catch { return undefined; }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new ResearchError("forbidden", "이 사이트에서 요청해 주세요.", 403);
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ResearchError("invalid_input", "JSON 형식으로 요청해 주세요.", 415);
  const tooLarge = () => new ResearchError("invalid_input", `입력 내용은 ${maxBytes / 1024}KB 이내로 줄여 주세요.`, 413);
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new ResearchError("invalid_input", "팝업 정보를 입력해 주세요.", 400);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("invalid_input", "입력 형식을 확인해 주세요.", 400);
  } finally { reader.releaseLock(); }
}

type Operation = "analyze" | "lookup";
const ips = new Map<string, { start: number; total: number; analyze: number; lookup: number }>();
let globalWindow = { start: Date.now(), count: 0 };
let active = 0;

// shortcut: both routes share this isolate-local budget; use a Durable Object for a cross-isolate production budget.
export function acquireBudget(ip: string, operation: Operation) {
  const now = Date.now();
  for (const [key, bucket] of ips) if (now - bucket.start >= 10 * 60_000) ips.delete(key);
  if (now - globalWindow.start >= 60 * 60_000) globalWindow = { start: now, count: 0 };
  const bucket = ips.get(ip) ?? { start: now, total: 0, analyze: 0, lookup: 0 };
  if (bucket.total >= 800 || bucket[operation] >= (operation === "analyze" ? 300 : 600) || globalWindow.count >= 4000)
    throw new ResearchError("rate_limited", "검색·분석 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", 429);
  if (active >= 200) throw new ResearchError("busy", "다른 검색·분석을 진행 중입니다. 잠시 후 다시 시도해 주세요.", 429);
  if (ips.size >= 1000 && !ips.has(ip)) ips.delete(ips.keys().next().value!);
  ips.set(ip, { ...bucket, total: bucket.total + 1, [operation]: bucket[operation] + 1 });
  globalWindow.count++;
  active++;
  let released = false;
  return () => { if (!released) { active--; released = true; } };
}
