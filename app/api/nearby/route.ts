import { z } from "zod";
import { readAnalysis, rememberAnalysis } from "@/lib/analysis-store";
import { nearbyService } from "@/lib/nearby";
import { ResearchError } from "@/lib/research";
import { acquireBudget, apiKey, digest, json, readJsonBody, researchErrorResponse, sameOrigin } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
const schema = z.object({ analysisId: z.string().uuid(), anchorIndex: z.number().int().min(0).max(2), replaceIndex: z.number().int().min(0).max(2).nullable(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) });
const pending = new Map<string, Promise<unknown>>();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const parsed = schema.safeParse(await readJsonBody(request, 2048));
    if (!parsed.success) throw new ResearchError("invalid_input", "기준 장소와 방문 날짜를 확인해 주세요.", 400);
    const { analysisId, anchorIndex, replaceIndex, date } = parsed.data;
    const saved = await readAnalysis(analysisId);
    if (!saved) throw new ResearchError("analysis_expired", "확인한 행사 정보가 만료됐어요. 방문 일정을 다시 분석해 주세요.", 409);
    const key = await digest(JSON.stringify(parsed.data));
    const existing = pending.get(key);
    if (existing) return json(await existing);
    const secret = await apiKey();
    if (!secret) throw new ResearchError("not_configured", "주변 행사 검색 키가 연결되지 않았습니다.", 503);
    const ip = await digest(request.headers.get("cf-connecting-ip") ?? "local-preview");
    const pendingAfterAwait = pending.get(key);
    if (pendingAfterAwait) return json(await pendingAfterAwait);
    const release = acquireBudget(ip, "analyze");
    const task = nearbyService(saved.input, saved.research, anchorIndex, replaceIndex, date, secret).then(async report => ({ ...report,
      recommendations: await Promise.all(report.recommendations.map(async item => {
        const retained = saved.input.places.map((_, i) => i).filter(i => i !== replaceIndex);
        const evidence = retained.flatMap((index, i) => {
          const ev = saved.research.evidence.find(e => e.index === index); return ev ? [{ ...ev, index: i }] : [];
        });
        const proposalId = await rememberAnalysis(item.proposedInput, { ...saved.research, evidence: [...evidence, item.evidence], retrievedAt: report.retrievedAt,
          nearbyProposal: { analysisId, anchorIndex, replaceIndex, date } });
        const { proposedInput: _input, evidence: _evidence, plan: _plan, ...publicItem } = item;
        void _input; void _evidence; void _plan;
        return { ...publicItem, proposalId };
      })),
    }));
    pending.set(key, task);
    try { return json(await task); } finally { pending.delete(key); release(); }
  } catch (error) {
    if (error instanceof ResearchError) return researchErrorResponse(error);
    return json({ error: "주변 팝업을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "internal_error" }, 500);
  }
}
export function GET() { return json({ error: "POST 요청을 사용해 주세요." }, 405, { Allow: "POST" }); }
