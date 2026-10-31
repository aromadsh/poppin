import type { PlaceEvidence, PlanResult } from "./planner";
import type { QueueForecast } from "./forecast";

export type AnalysisResult = {
  analysisId?: string; evidence: PlaceEvidence[]; plan: PlanResult; forecasts: QueueForecast[];
  retrievedAt: string; cached: boolean; searchCount: number; model: string;
};
