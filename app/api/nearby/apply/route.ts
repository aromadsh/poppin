import { readAnalysis, rememberAnalysis } from "@/lib/analysis-store";
import { combineNearbySelection } from "@/lib/nearby-selection";
import { planVisits, validateInput } from "@/lib/planner";
import { forecastQueues } from "@/lib/forecast";
import { ResearchError } from "@/lib/research";
import { json, readJsonBody, researchErrorResponse, sameOrigin } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readJsonBody(request, 1024) as { analysisId?: unknown; proposalIds?: unknown; proposalId?: unknown };
    if (!body || typeof body !== "object") throw new ResearchError("invalid_input", "추천 장소를 다시 선택해 주세요.", 400);
    const now = new Date();
    if (body.proposalIds !== undefined) {
      if (typeof body.analysisId !== "string" || body.analysisId.length > 100 || !Array.isArray(body.proposalIds) || !body.proposalIds.length || body.proposalIds.length > 3
        || body.proposalIds.some(id => typeof id !== "string" || !id.length || id.length > 100) || new Set(body.proposalIds).size !== body.proposalIds.length)
        throw new ResearchError("invalid_input", "추가할 팝업을 중복 없이 선택해 주세요.", 400);
      const base = await readAnalysis(body.analysisId);
      const proposals = await Promise.all((body.proposalIds as string[]).map(id => readAnalysis(id)));
      if (!base || proposals.some(p => !p)) throw new ResearchError("analysis_expired", "추천 정보가 만료됐어요. 주변 팝업을 다시 찾아 주세요.", 409);
      const combined = combineNearbySelection(body.analysisId, base, proposals.map(p => p!), now);
      const input = validateInput(combined.input, now);
      const plan = planVisits(input, combined.research.evidence, now, combined.research.tasteSignals);
      const analysisId = await rememberAnalysis(input, combined.research);
      return json({ input, date: combined.date ?? plan.days.find(day => day.complete)?.date ?? plan.days[0]?.date ?? input.dateFrom,
        analysis: { ...combined.research, analysisId, plan, forecasts: forecastQueues(input, combined.research.evidence, now), cached: true } });
    }
    if (typeof body.proposalId !== "string" || body.proposalId.length > 100) throw new ResearchError("invalid_input", "추천 장소를 다시 선택해 주세요.", 400);
    const saved = await readAnalysis(body.proposalId);
    if (!saved) throw new ResearchError("analysis_expired", "추천 정보가 만료됐어요. 주변 팝업을 다시 찾아 주세요.", 409);
    const input = validateInput(saved.input, now);
    return json({ input, analysis: { ...saved.research, analysisId: body.proposalId, plan: planVisits(input, saved.research.evidence, now, saved.research.tasteSignals),
      forecasts: forecastQueues(input, saved.research.evidence, now), cached: true } });
  } catch (error) {
    if (error instanceof ResearchError) return researchErrorResponse(error);
    return json({ error: "선택한 추천 일정을 반영하지 못했습니다.", code: "internal_error" }, 500);
  }
}
