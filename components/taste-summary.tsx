import { tasteLabel, type TasteReport, type EventTaste } from "../lib/taste-scoring";

export function TasteSummary({ report }: { report?: TasteReport }) {
  if (!report || report.status === "not_requested") return null;
  return <div className="taste-summary" aria-label="반영한 취향">
    <h3>반영한 취향</h3>
    {report.signals.length ? <div className="stop-tags">{report.signals.map(signal => <span key={`${signal.axis}:${signal.id}`}>{tasteLabel(signal)} {signal.direction === "like" ? "선호" : "비선호"}</span>)}</div> : <p>행사 분류와 연결할 취향을 확인하지 못해 추가 점수는 적용하지 않았어요.</p>}
  </div>;
}

export function TasteMatchSummary({ taste }: { taste?: EventTaste }) {
  if (!taste || taste.status === "no_preferences") return null;
  const capped = taste.matches.reduce((sum, match) => sum + match.points, 0) !== taste.score;
  return <div className="taste-match">
    {taste.status === "unclassified" ? <span>취향 판단 보류 · 분류 미확인</span> : <>
      <strong>취향 {taste.score > 0 ? "+" : ""}{taste.score}점{capped ? " · 점수 한도 적용" : ""}</strong>
      <span>{taste.matches.length ? taste.matches.map(match => `${match.label} ${match.points > 0 ? "+" : ""}${match.points}`).join(" · ") : "확인된 취향 일치 없음"}</span>
    </>}
  </div>;
}
