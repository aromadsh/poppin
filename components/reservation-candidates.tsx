import type { ReservationCandidate } from "../lib/planner";

export function ReservationCandidates({ candidates }: { candidates: ReservationCandidate[] }) {
  if (!candidates.length) return null;

  return <section className="reservation-candidates" aria-label="예약 확인이 필요한 방문 후보">
    <p className="reservation-intro">행사 운영 시간과 방문 조건이 겹치는 범위예요. 실제 예약 회차와 잔여석은 확인이 필요합니다.</p>
    {candidates.map(candidate => <article className="source-group reservation-card" key={candidate.index}>
      <div className="source-group-heading">
        <h3>{candidate.name}</h3>
        <span className="status-badge">예약 확인 필요</span>
      </div>
      <p>{candidate.address}</p>
      <div className="stop-tags"><span>희망 체류 {candidate.stayMinutes}분</span><span>잔여석 미확인</span></div>
      <p className="admission-note">{candidate.note || "방문 전에 예약·입장 조건을 확인해 주세요."}</p>
      <h4>예약 회차를 찾아볼 날짜와 시간 범위</h4>
      <ul className="reservation-windows">
        {candidate.windows.map(window => <li key={`${window.date}-${window.from}-${window.to}`}>
          <strong>{new Date(`${window.date}T12:00:00+09:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" })}</strong>
          <span>{window.from}~{window.to}</span>
          {window.lastEntry && <small>최종 입장 {window.lastEntry}</small>}
        </li>)}
      </ul>
      <p className="reservation-note">표시된 범위는 확정 회차나 도착·퇴장 시간이 아닙니다. 희망 체류 시간과 실제 회차 길이는 다를 수 있습니다. 혼잡도가 낮은 순서로 추천한 결과도 아닙니다.</p>
      {candidate.sourceUrl && <a className="button secondary" href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">예약·회차 안내 확인</a>}
    </article>)}
  </section>;
}
