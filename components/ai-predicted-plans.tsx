"use client";
import { useState } from "react";
import type { AiPrediction, CrowdLevel, DayPlan, PlaceEvidence } from "../lib/planner";
import { PlanBreakdown } from "./plan-breakdown";

export const crowdText: Record<CrowdLevel, string> = { low: "한산", medium: "보통", high: "붐빔", very_high: "매우 붐빔" };
const crowdHeight: Record<CrowdLevel, number> = { low: 25, medium: 50, high: 75, very_high: 100 };
const dateLabel = (date: string) => new Date(date + "T12:00:00+09:00").toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Seoul" });

export function AiPredictedPlans({ days, evidence, names }: { days: DayPlan[]; evidence: PlaceEvidence[]; names: string[] }) {
  const [selected, setSelected] = useState(0);
  const day = days[selected] ?? days[0];
  if (!day) return null;
  const predicted = evidence.filter(e => e.prediction && day.stops.some(stop => stop.index === e.index && stop.aiPredicted));
  return <section className="ai-plans" aria-label="AI 예측 일정">
    <div className="ai-plans-title"><h3>AI가 대략 예측한 일정</h3><span>AI 예측 · {predicted[0]?.prediction?.model ?? "AI"}</span></div>
    <p className="ai-warning"><b>출처로 확인된 일정이 아닙니다.</b> 확인하지 못한 행사 기간·영업시간·입장 방식·혼잡을 AI가 예측해서 채웠습니다. 정확하지 않을 수 있으니 방문 전 공식 안내를 확인하세요.</p>
    <div className="day-options">{days.map((option, i) => <button type="button" className={option === day ? "day-option selected" : "day-option"} key={option.date} aria-pressed={option === day} onClick={() => setSelected(i)}>
      <span>{i === 0 ? "AI 추천" : `AI ${i + 1}번째`}</span><b>{dateLabel(option.date)}</b><small>{option.stops.length}곳 · {option.totalMinutes}분</small>
    </button>)}</div>
    <ol className="conditional-stops">{day.stops.map(stop => <li key={stop.index}>
      <b>{stop.arrival} → {stop.departure} · {stop.name}</b><p>{stop.address}</p>
      <div className="stop-tags"><span>체류 {stop.stayMinutes}분</span>{stop.waitKind === "ai" && <span>AI 예측 대기 {stop.waitMin}~{stop.waitMax}분</span>}{stop.crowdLevel && <span className={`crowd-tag ${stop.crowdLevel}`}>AI 혼잡 {crowdText[stop.crowdLevel]}</span>}</div>
      {stop.condition && <p className="ai-condition">{stop.condition}</p>}
    </li>)}</ol>
    <PlanBreakdown day={day}/>
    {predicted.map(e => <AiForecast key={e.index} prediction={e.prediction!} name={names[e.index]} date={day.date}/>)}
  </section>;
}

export function AiForecast({ prediction, name, date }: { prediction: AiPrediction; name?: string; date?: string }) {
  const initial = date && [0, 6].includes(new Date(date + "T12:00:00+09:00").getUTCDay()) ? "weekend" : "weekday";
  const [dayType, setDayType] = useState<"weekday" | "weekend">(initial);
  const slots = prediction.crowd.filter(slot => slot.day === dayType);
  return <div className="ai-forecast">
    <div className="ai-plans-title"><h4>{name ? `${name} · ` : ""}AI 혼잡 예측</h4><span>신뢰도 {prediction.confidence === "medium" ? "보통" : "낮음"}</span></div>
    {prediction.rationale && <p>{prediction.rationale}</p>}
    {(prediction.likelyStart || prediction.hours) && <p className="ai-guess">AI 추정 · 행사 기간 {prediction.likelyStart ?? "?"} ~ {prediction.likelyEnd ?? "?"}{prediction.hours ? ` · 영업 ${prediction.hours.open}~${prediction.hours.close}` : ""}</p>}
    {prediction.bestVisits.length > 0 && <ul className="ai-best">{prediction.bestVisits.map(v => <li key={v.date + v.time}><b>{dateLabel(v.date)} {v.time}</b> {v.reason}</li>)}</ul>}
    {slots.length > 0 && <>
      <div className="forecast-dates">{(["weekday", "weekend"] as const).map(type => <button key={type} type="button" className={type === dayType ? "selected" : ""} onClick={() => setDayType(type)}>{type === "weekday" ? "평일" : "주말"}</button>)}</div>
      <div className="chart-bars" role="img" aria-label={slots.map(s => `${s.hour}시 ${crowdText[s.level]}, 대기 ${s.waitMin}~${s.waitMax}분`).join(", ")}>{slots.map(s => <div className="chart-column" key={s.hour}><b>{s.waitMin}~{s.waitMax}</b><div className="bar-track"><span className={`crowd-bar ${s.level}`} style={{ height: `${crowdHeight[s.level]}%` }}/></div><strong>{String(s.hour).padStart(2, "0")}시</strong><em>{crowdText[s.level]}</em></div>)}</div>
    </>}
    {prediction.busyDates.length > 0 && <ul className="ai-best">{prediction.busyDates.map(d => <li key={d.date}><b>{dateLabel(d.date)} · {crowdText[d.level]}</b> {d.reason}</li>)}</ul>}
    <small>AI가 대략 예측한 값이며 관측이나 공식 정보가 아닙니다. 막대 위 숫자는 예상 현장 대기(분)입니다.</small>
  </div>;
}
