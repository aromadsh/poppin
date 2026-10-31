"use client";
import { useEffect, useRef, useState } from "react";
import type { Input } from "../lib/planner";
import type { AnalysisResult } from "../lib/analysis-types";
import type { NearbyRecommendation, NearbyReport } from "../lib/nearby";

type Item = Omit<NearbyRecommendation, "proposedInput" | "evidence" | "plan"> & { proposalId: string };
type Report = Omit<NearbyReport, "recommendations"> & { recommendations: Item[] };
const labels = { ready: "시간·입장 조건 충족", reservation_required: "예약 필요", needs_confirmation: "입장 확인 필요", time_conflict: "시간 조건 미충족", needs_verification: "운영시간 확인 필요", unavailable: "입장 조건 미충족" };
export function NearbyRecommendations({ analysisId, input, date: initialDate, disabled, onApply }: {
  analysisId: string; input: Input; date: string; disabled: boolean;
  onApply: (input: Input, analysis: AnalysisResult, date: string) => void;
}) {
  const [anchor, setAnchor] = useState(0), [date, setDate] = useState(initialDate);
  const [replace, setReplace] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (disabled) { request.current?.abort(); setBusy(false); setReport(null); } }, [disabled]);
  const replaceOptions = input.places.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== anchor && !p.reservation);
  const needsReplacement = input.places.length === 3;
  async function search() {
    if (busy || disabled || needsReplacement && replace === null) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 330_000);
    setBusy(true); setError(""); setReport(null);
    try {
      const response = await fetch("/api/nearby", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, anchorIndex: anchor, replaceIndex: replace, date }), signal: controller.signal });
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw new Error(data.error || "주변 팝업 검색을 완료하지 못했어요.");
      if (!controller.signal.aborted) setReport(data);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "연결을 확인해 주세요."); else if (request.current === controller) setError("주변 검색이 중단되거나 시간이 초과됐어요. 다시 시도해 주세요."); }
    finally { clearTimeout(timer); if (request.current === controller) setBusy(false); }
  }
  async function apply(item: Item) {
    if (busy || disabled) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/nearby/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: item.proposalId }), signal: controller.signal });
      const data = await response.json() as { input: Input; analysis: AnalysisResult; error?: string };
      if (!response.ok) throw new Error(data.error || "추천을 반영하지 못했어요.");
      if (!controller.signal.aborted) onApply(data.input, data.analysis, date);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "다시 시도해 주세요."); else setError("반영 시간이 초과됐어요. 다시 시도해 주세요."); }
    finally { clearTimeout(timer); if (request.current === controller) setBusy(false); }
  }
  return <section className="nearby-section" aria-label="취향에 맞는 주변 팝업" aria-busy={busy}>
    <h3>함께 들르기 좋은 주변 팝업</h3>
    <p>분석한 장소 주변 약 2km에서 취향에 맞는 행사를 찾아요. 기준 장소와 예약 시간은 유지합니다.</p>
    <fieldset disabled={busy || disabled} className="nearby-controls">
      <label>기준 장소<select value={anchor} onChange={e => { setAnchor(Number(e.target.value)); setReplace(null); setReport(null); }}>{input.places.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select></label>
      <label>방문 날짜<input type="date" min={input.dateFrom} max={input.dateTo} value={date} onChange={e => { setDate(e.target.value); setReport(null); }}/></label>
      {needsReplacement && <label>교체할 장소<select value={replace ?? ""} onChange={e => { setReplace(e.target.value === "" ? null : Number(e.target.value)); setReport(null); }}><option value="">직접 선택해 주세요</option>{replaceOptions.map(({ p, i }) => <option key={i} value={i}>{p.name}</option>)}</select></label>}
      <button type="button" className="button secondary" disabled={needsReplacement && replace === null || !date} onClick={() => void search()}>{busy ? "주변 팝업 확인 중…" : "주변 팝업 찾기"}</button>
    </fieldset>
    <p className="input-note">{disabled ? "입력 조건이 바뀌었거나 저장된 분석 정보가 없어요. 방문 일정을 다시 분석해 주세요." : needsReplacement ? "최대 3곳 · 기준 장소와 예약한 장소는 교체하지 않습니다." : "원래 선택한 장소를 모두 유지하고 한 곳을 추가합니다."} 주변 검색은 별도 API 비용이 발생할 수 있으며, 같은 검색 결과는 20분간 재사용합니다.</p>
    {error && <p role="alert">{error}</p>}
    {report && <><p className="input-note">{new Date(report.retrievedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 확인 · {report.cached ? "저장된 검색 정보" : "새로 확인한 검색 정보"} · 방문 기간의 운영 정보 기준</p>
      {report.verificationIncomplete && <p role="status">일부 후보의 추가 확인을 마치지 못했어요. 지금까지 확인한 결과를 먼저 보여드려요.</p>}
      {!report.recommendations.length ? report.unlocated?.length ? null : <p role="status">위치와 행사 기간을 확인한 주변 후보를 찾지 못했어요. 주변에 행사가 없다는 뜻은 아닙니다.</p> : <div className="nearby-grid">{report.recommendations.map(item => <article className="nearby-card" key={item.id}>
        <span className="status-badge">{labels[item.status]}</span><h4>{item.place.name}</h4><p>{item.place.genre}</p>
        <dl className="event-facts"><div><dt>기준 장소와 직선거리</dt><dd>{item.distanceMeters}m</dd></div><div><dt>추가할 체류 시간</dt><dd>{item.place.stayMinutes}분</dd></div>
          <div><dt>기존 일정 대비 이동</dt><dd>{item.additionalTravelMinutes === null ? "비교 정보 부족" : `${item.additionalTravelMinutes > 0 ? "+" : ""}${item.additionalTravelMinutes}분`}</dd></div>
          <div><dt>기존 일정 대비 총 시간</dt><dd>{item.additionalTotalMinutes === null ? "비교 정보 부족" : `${item.additionalTotalMinutes > 0 ? "+" : ""}${item.additionalTotalMinutes}분`}</dd></div></dl>
        <ul>{item.reasons.length ? item.reasons.map(reason => <li key={reason}>{reason}</li>) : <li>명시적인 취향 일치 정보가 부족한 주변 후보예요.</li>}</ul>
        {item.status !== "ready" && <p className="input-note">{item.status === "reservation_required" ? "예약을 확보한 뒤 예약 시간을 입력해야 합니다." : item.status === "needs_confirmation" ? "입장 조건을 확인해야 일정에 방문 가능한 것으로 계산할 수 있습니다." : "운영시간·입장 조건·기존 일정과의 충돌을 확인해야 합니다."}</p>}
        <button type="button" className="button secondary" disabled={busy || disabled} onClick={() => void apply(item)}>{item.status === "ready" ? needsReplacement ? "이 장소로 교체" : "일정에 추가" : "확인할 후보로 반영"}</button>
      </article>)}</div>}
      {!!report.unlocated?.length && <div>
        <h4>위치를 확인할 행사도 찾았어요</h4>
        <p>행사와 주소·기간은 확인했지만, 2km 이내 여부와 이동 시간은 아직 확인되지 않았어요. 지도에서 위치를 확인해 주세요.</p>
        <div className="nearby-grid">{report.unlocated.map(item => <article className="nearby-card" key={`${item.name}:${item.address}`}>
          <span className="status-badge">거리 확인 필요</span><h4>{item.name}</h4><p>{item.genre}</p><p>{item.address}</p><p>{item.eventStart} ~ {item.eventEnd}</p>
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">행사 안내 확인</a>{" · "}
          <a href={`https://map.naver.com/p/search/${encodeURIComponent(item.address)}`} target="_blank" rel="noopener noreferrer">지도에서 위치 확인</a>
        </article>)}</div>
      </div>}
      <p className="input-note">직선거리 기준이며 실제 보행 경로와 다릅니다. 현재 인기·실시간 대기·예약 잔여석을 확인한 결과는 아닙니다. 선택 시 입력과 일정을 바꾸며, 원래 장소의 이전 분석 정보를 재사용해 별도 AI 호출 없이 재계산합니다.</p>
    </>}
  </section>;
}
