import { readAnalysis } from "@/lib/analysis-store";
import { planVisits, validateInput } from "@/lib/planner";
import { forecastQueues } from "@/lib/forecast";
import { ResearchError } from "@/lib/research";
import { json, readJsonBody, researchErrorResponse, sameOrigin } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await readJsonBody(request, 1024) as { proposalId?: unknown };
    if (!body || typeof body.proposalId !== "string" || body.proposalId.length > 100) throw new ResearchError("invalid_input", "추천 장소를 다시 선택해 주세요.", 400);
    const saved = readAnalysis(body.proposalId);
    if (!saved) throw new ResearchError("analysis_expired", "추천 정보가 만료됐어요. 주변 팝업을 다시 찾아 주세요.", 409);
    const now = new Date();
    const input = validateInput(saved.input, now);
    return json({ input, analysis: { ...saved.research, analysisId: body.proposalId, plan: planVisits(input, saved.research.evidence, now, saved.research.tasteSignals),
      forecasts: forecastQueues(input, saved.research.evidence, now), cached: true } });
  } catch (error) {
    if (error instanceof ResearchError) return researchErrorResponse(error);
    return json({ error: "선택한 추천 일정을 반영하지 못했습니다.", code: "internal_error" }, 500);
  }
}
