import { validateInput, planVisits, type Input } from "@/lib/planner";
import { researchPlaces, ResearchError } from "@/lib/research";
import { forecastQueues } from "@/lib/forecast";
import { json, digest, apiKey, readJsonBody, sameOrigin, acquireBudget } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
const TTL = 10 * 60_000;
type Research = Awaited<ReturnType<typeof researchPlaces>>;
const cache = new Map<string, { expires: number; value: Research }>();
const inflight = new Map<string, Promise<Research>>();
function analyze(input: Input, result: Research, cached: boolean) {
  const now = new Date();
  return json({ ...result, plan: planVisits(input, result.evidence, now), forecasts: forecastQueues(input, result.evidence, now), cached });
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    let input: Input;
    try { input = validateInput(await readJsonBody(request, 8192)); }
    catch (error) {
      if (error instanceof ResearchError) throw error;
      throw new ResearchError("invalid_input", error instanceof Error ? error.message : "입력을 확인해 주세요.", 400);
    }
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
    const release = acquireBudget(ip, "analyze");
    const task = researchPlaces(input, secret).then(result => {
      if (cache.size >= 50) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + TTL, value: result });
      return result;
    });
    inflight.set(key, task);
    try { return analyze(input, await task, false); } finally { inflight.delete(key); release(); }
  } catch (error) {
    if (error instanceof ResearchError) return json({ error: error.message, code: error.code }, error.status, error.status === 429 ? { "Retry-After": "60" } : {});
    return json({ error: "분석 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.", code: "internal_error" }, 500);
  }
}

export function GET() { return json({ error: "POST 요청을 사용해 주세요.", code: "method_not_allowed" }, 405, { Allow: "POST" }); }
