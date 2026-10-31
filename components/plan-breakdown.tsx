import type { DayPlan } from "../lib/planner";
import { explainPlan } from "../lib/plan-explanation";

export function PlanBreakdown({ day }: { day: DayPlan }) {
  const info = explainPlan(day);
  return <div className="plan-breakdown" aria-label="일정 시간 계산 내역">
    <h4>{day.aiPredicted ? "AI 예측이 맞다면 이렇게 계산돼요" : day.conditional ? "입장 조건이 충족된다면 이렇게 계산돼요" : "이 일정은 이렇게 계산했어요"}</h4>
    <p>{info.visits}곳 방문 · 장소 사이 이동 {info.travel}분 + 체류 {info.stay}분 + 확보한 대기 {info.wait}분{info.openingGap > 0 ? ` + 다음 장소 영업 시작 전 여유 ${info.openingGap}분` : ""} = 총 {info.total}분</p>
    {info.unknownWait > 0 && <p>확보한 대기 중 {info.unknownWait}분은 자료가 없어 둔 임시 여유입니다. 실제 대기시간 예측값이 아닙니다.</p>}
    {day.tasteScore !== undefined && day.tasteScore !== 0 && <p>방문 장소의 취향 점수 합계 {day.tasteScore > 0 ? "+" : ""}{day.tasteScore}점</p>}
    <small>첫 장소까지의 이동은 포함하지 않습니다. 영업시간·이동·체류·대기 상한을 반영한 계산이며 현장 입장을 보장하지 않습니다.</small>
  </div>;
}
