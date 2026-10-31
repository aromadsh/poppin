import { lookupPlace, validateLookupInput, type LookupResult } from "@/lib/lookup";
import { ResearchError } from "@/lib/research";
import { json, digest, apiKey, readJsonBody, sameOrigin, acquireBudget, researchErrorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
const TTL = 10 * 60_000;
const cache = new Map<string, { expires: number; value: LookupResult }>();
const inflight = new Map<string, Promise<LookupResult>>();

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = validateLookupInput(await readJsonBody(request, 4096));
    const key = await digest(JSON.stringify(input));
    const now = Date.now();
    for (const [hash, saved] of cache) if (saved.expires <= now) cache.delete(hash);
    const saved = cache.get(key);
    if (saved) return json({ ...saved.value, cached: true });
    const pending = inflight.get(key);
    if (pending) return json({ ...await pending, cached: true });
    const secret = await apiKey();
    if (!secret) throw new ResearchError("not_configured", "검색 서비스 키가 아직 연결되지 않았습니다.", 503);
    const ip = await digest(request.headers.get("cf-connecting-ip") ?? "local-preview");
    // Another matching request may have started while resolving the key and IP hash.
    const savedAfterAwait = cache.get(key);
    if (savedAfterAwait && savedAfterAwait.expires > Date.now()) return json({ ...savedAfterAwait.value, cached: true });
    const pendingAfterAwait = inflight.get(key);
    if (pendingAfterAwait) return json({ ...await pendingAfterAwait, cached: true });
    const release = acquireBudget(ip, "lookup");
    const task = lookupPlace(input, secret).then(result => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + TTL, value: result });
      return result;
    });
    inflight.set(key, task);
    try { return json({ ...await task, cached: false }); }
    finally { inflight.delete(key); release(); }
  } catch (error) {
    if (error instanceof ResearchError) return researchErrorResponse(error);
    return json({ error: "검색 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.", code: "internal_error" }, 500);
  }
}

export function GET() { return json({ error: "POST 요청을 사용해 주세요.", code: "method_not_allowed" }, 405, { Allow: "POST" }); }
