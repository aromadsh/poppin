"use client";
import { useEffect, useRef, useState } from "react";
import type { Input } from "../lib/planner";
import type { AnalysisResult } from "../lib/analysis-types";
import type { NearbyRecommendation, NearbyReport } from "../lib/nearby";

type Item = Omit<NearbyRecommendation, "proposedInput" | "evidence" | "plan"> & { proposalId: string };
type Report = Omit<NearbyReport, "recommendations"> & { recommendations: Item[] };
const labels = { ready: "시간·입장 조건 충족", reservation_required: "예약 필요", needs_confirmation: "입장 확인 필요", time_conflict: "시간 조건 미충족", needs_verification: "방문 조건 확인 필요", unavailable: "입장 조건 미충족" };
export function NearbyRecommendations({ analysisId, input, disabled, onApply }: {
  analysisId: string; input: Input; date: string; disabled: boolean;
  onApply: (input: Input, analysis: AnalysisResult, date: string) => void;
}) {
  const [anchor, setAnchor] = useState(0), [date, setDate] = useState<string | null>(null);
  const [replace, setReplace] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const replaceOptions = input.places.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== anchor && !p.reservation);
  const needsReplacement = input.places.length === 3;
  const capacity = needsReplacement ? 1 : 3 - input.places.length;
  async function search() {
    if (busy || disabled || needsReplacement && replace === null) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 330_000);
    setBusy(true); setError(""); setReport(null); setSelected([]);
    try {
      const response = await fetch("/api/nearby", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, anchorIndex: anchor, replaceIndex: replace, date }), signal: controller.signal });
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw new Error(data.error || "주변 팝업 검색을 완료하지 못했어요.");
      if (!controller.signal.aborted) setReport(data);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "연결을 확인해 주세요."); else if (request.current === controller) setError("주변 검색이 중단되거나 시간이 초과됐어요. 다시 시도해 주세요."); }
    finally { clearTimeout(timer); if (request.current === controller) setBusy(false); }
  }
  async function apply() {
    if (busy || disabled || !selected.length || selected.length > capacity) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/nearby/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId, proposalIds: selected }), signal: controller.signal });
      const data = await response.json() as { input: Input; analysis: AnalysisResult; date: string; error?: string };
      if (!response.ok) throw new Error(data.error || "추천을 반영하지 못했어요.");
      if (!controller.signal.aborted) onApply(data.input, data.analysis, data.date);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "다시 시도해 주세요."); else setError("반영 시간이 초과됐어요. 다시 시도해 주세요."); }
    finally { clearTimeout(timer); if (request.current === controller) setBusy(false); }
  }
  return <section className="nearby-section" aria-label="취향에 맞는 주변 팝업" aria-busy={busy}>
    <h3>함께 들르기 좋은 주변 팝업</h3>
    <p>입력한 방문 기간 {input.dateFrom} ~ {input.dateTo} 안에서 취향에 맞는 주변 팝업 후보를 최대 3곳 찾아요. 원하는 후보를 선택한 뒤 기존 장소를 포함해 최대 3곳의 전체 경로를 한 번에 계산하세요.</p>
    <fieldset disabled={busy || disabled} className="nearby-controls">
      <label>기준 장소<select value={anchor} onChange={e => { setAnchor(Number(e.target.value)); setReplace(null); setReport(null); setSelected([]); }}>{input.places.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select></label>
      <label>방문 날짜 (선택)<input type="date" min={input.dateFrom} max={input.dateTo} value={date ?? ""} onChange={e => { setDate(e.target.value || null); setReport(null); setSelected([]); }}/></label>
      {needsReplacement && <label>교체할 장소<select value={replace ?? ""} onChange={e => { setReplace(e.target.value === "" ? null : Number(e.target.value)); setReport(null); setSelected([]); }}><option value="">직접 선택해 주세요</option>{replaceOptions.map(({ p, i }) => <option key={i} value={i}>{p.name}</option>)}</select></label>}
      <button type="button" className="button secondary" disabled={needsReplacement && replace === null} onClick={() => void search()}>{busy ? "주변 팝업 확인 중…" : "주변 팝업 찾기"}</button>
    </fieldset>
    <p className="input-note">날짜를 따로 고르지 않으면 위 방문 기간 전체를 비교합니다. {disabled ? "입력 조건이 바뀌었거나 저장된 분석 정보가 없어요. 방문 일정을 다시 분석해 주세요." : needsReplacement ? "현재 3곳이므로 후보 1곳으로 교체합니다. 기준 장소와 예약한 장소는 유지합니다." : `기존 ${input.places.length}곳과 예약 시간을 유지하고 후보를 최대 ${capacity}곳 추가합니다.`} 주변 검색은 별도 API 비용이 발생할 수 있으며, 같은 검색 결과는 20분간 재사용합니다.</p>
    {error && <p role="alert">{error}</p>}
    {report && <><p className="input-note">{new Date(report.retrievedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 확인 · {report.cached ? "저장된 검색 정보" : "새로 확인한 검색 정보"} · 방문 기간의 운영 정보 기준</p>
      {report.anchorCoordinatesMissing && <p role="status">기준 장소의 지도 좌표가 확인되지 않아 주소를 기준으로 찾았어요. 거리와 이동 시간은 지도에서 확인해 주세요.</p>}
      {report.verificationIncomplete && <p role="status">일부 후보의 추가 확인을 마치지 못했어요. 지금까지 확인한 결과를 먼저 보여드려요.</p>}
      {!report.recommendations.length ? <p role="status">위치와 행사 기간을 확인한 주변 후보를 찾지 못했어요. 주변에 행사가 없다는 뜻은 아닙니다.</p> : <div className="nearby-grid">{report.recommendations.map(item => <article className={`nearby-card${selected.includes(item.proposalId) ? " is-selected" : ""}`} key={item.id}>
        <span className="status-badge">{labels[item.status]}</span><h4>{item.place.name}</h4><p>{item.place.genre}</p>
        <dl className="event-facts"><div><dt>기준 장소와 직선거리</dt><dd>{item.distanceMeters === null ? "거리 확인 필요" : `${item.distanceMeters}m`}</dd></div><div><dt>검토 날짜</dt><dd>{item.suggestedDate}</dd></div><div><dt>추가할 체류 시간</dt><dd>{item.place.stayMinutes}분</dd></div>
          <div><dt>기존 일정 대비 이동</dt><dd>{item.additionalTravelMinutes === null ? "비교 정보 부족" : `${item.additionalTravelMinutes > 0 ? "+" : ""}${item.additionalTravelMinutes}분`}</dd></div>
          <div><dt>기존 일정 대비 총 시간</dt><dd>{item.additionalTotalMinutes === null ? "비교 정보 부족" : `${item.additionalTotalMinutes > 0 ? "+" : ""}${item.additionalTotalMinutes}분`}</dd></div></dl>
        <ul>{item.reasons.length ? item.reasons.map(reason => <li key={reason}>{reason}</li>) : <li>명시적인 취향 일치 정보가 부족한 주변 후보예요.</li>}</ul>
        {item.status !== "ready" && <p className="input-note">{item.status === "reservation_required" ? "예약을 확보한 뒤 예약 시간을 입력해야 합니다." : item.status === "needs_confirmation" ? "입장 조건을 확인해야 일정에 방문 가능한 것으로 계산할 수 있습니다." : item.status === "needs_verification" ? "확인할 후보로 추가할 수 있어요. 위치·운영시간·입장 조건을 확인하기 전에는 전체 동선이 확정되지 않습니다." : "운영시간·입장 조건·기존 일정과의 충돌을 확인해야 합니다."}</p>}
        <button type="button" className="button secondary" aria-pressed={selected.includes(item.proposalId)} aria-label={`${item.place.name} ${selected.includes(item.proposalId) ? "선택 해제" : "선택"}`}
          disabled={busy || disabled || !selected.includes(item.proposalId) && selected.length >= capacity}
          onClick={() => setSelected(current => current.includes(item.proposalId) ? current.filter(id => id !== item.proposalId) : current.length < capacity ? [...current, item.proposalId] : current)}>{selected.includes(item.proposalId) ? "선택됨 · 해제" : "경로에 넣을 후보로 선택"}</button>
      </article>)}</div>}
      {report.recommendations.length > 0 && <div className="nearby-selection">
        <p role="status">{selected.length}곳 선택 / 최대 {capacity}곳 · 반영 후 총 {input.places.length - (needsReplacement ? 1 : 0) + selected.length}곳{selected.length >= capacity ? " · 다른 후보를 고르려면 선택을 해제하세요." : ""}</p>
        <button type="button" className="button primary" disabled={busy || disabled || !selected.length} onClick={() => void apply()}>{busy ? "전체 경로 계산 중…" : "선택한 팝업으로 전체 경로 계산"}</button>
      </div>}
      <p className="input-note">직선거리 기준이며 실제 보행 경로와 다릅니다. 현재 인기·실시간 대기·예약 잔여석을 확인한 결과는 아닙니다. 전체 경로 계산 버튼을 누르면 선택한 후보를 한 번에 반영합니다. 저장된 분석 정보를 재사용하며, 운영·입장 조건이 미확인인 후보는 확정 일정에서 제외될 수 있어요.</p>
    </>}
  </section>;
}
