import { walkInStatus, type PlaceEvidence } from "../lib/planner";

const reservationLabels = {
  not_required: "불필요", available: "예약처 확인", required_unknown: "필수 · 잔여석 미확인",
  sold_out: "매진", unknown: "미확인",
};
const walkInLabels = { available: "가능 · 대기 별도", unavailable: "불가", unknown: "미확인" };

export function AdmissionSummary({ evidence, date, diagnostics = false }: { evidence: PlaceEvidence; date?: string; diagnostics?: boolean }) {
  const admission = evidence.admission;
  const selectedDate = date ?? evidence.hours[0]?.date;
  const hours = evidence.hours.filter(h => h.date === selectedDate);
  const cutoffs = [...new Set(hours.map(h => h.lastEntry ?? admission?.lastEntry).filter(Boolean))];
  const notes = [admission?.note, admission?.walkIn?.note].filter(Boolean).join(" ");
  // Only shorten explicit arrival guidance; never invent a lead time or schedule an alert.
  const leadTimes = [...notes.matchAll(/예약(?:\s*시간)?\s*(\d{1,3})\s*분\s*전[^.。\n]{0,20}?(?:도착|방문)/g)].map(match => Number(match[1]));
  const uniqueLeadTimes = [...new Set(leadTimes)];
  return <div className="admission-summary">
    <dl className="event-facts">
      <div><dt>운영시간{selectedDate ? ` · ${selectedDate.slice(5).replace("-", "/")}` : ""}</dt><dd>{hours.length ? hours.map(h => `${h.open}–${h.close}`).join(" / ") : "미확인"}</dd></div>
      <div><dt>입장 마감</dt><dd>{cutoffs.length ? cutoffs.join(" / ") : admission?.lastEntry || "미확인"}</dd></div>
      <div><dt>도착 안내</dt><dd>{uniqueLeadTimes.length === 1 ? `예약 ${uniqueLeadTimes[0]}분 전 도착` : "별도 확인 필요"}</dd></div>
      <div><dt>사전예약</dt><dd>{reservationLabels[admission?.reservation ?? "unknown"]}</dd></div>
      <div><dt>현장 입장</dt><dd>{walkInLabels[walkInStatus(evidence)]}</dd></div>
    </dl>
    {diagnostics && <details className="admission-diagnostics"><summary>QA · 입장 근거</summary><p>{admission?.note}</p><p>{admission?.walkIn?.note}</p>{admission?.walkIn?.sourceUrl && <a href={admission.walkIn.sourceUrl} target="_blank" rel="noopener noreferrer">현장 입장 안내 출처</a>}</details>}
  </div>;
}
