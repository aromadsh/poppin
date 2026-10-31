"use client";
import { useState } from "react";
import type { DayPlan } from "../lib/planner";
import { PlanBreakdown } from "./plan-breakdown";

export function ConditionalPlans({ days }: { days: DayPlan[] }) {
  const [selected, setSelected] = useState(0);
  const day = days[selected] ?? days[0];
  if (!day) return null;
  return <section className="conditional-plans" aria-label="입장 확인이 필요한 조건부 일정">
    <h3>입장 확인 후 검토할 조건부 일정</h3>
    <p className="conditional-warning"><b>방문 가능이 확인된 일정이 아닙니다.</b> 표시한 시간은 입장 조건이 충족된다는 가정으로 계산했습니다. 입장 방법을 확인하기 전에는 이 일정만 보고 방문하지 마세요.</p>
    <div className="day-options">{days.map((option, i) => <button type="button" className={option === day ? "day-option selected" : "day-option"} key={option.date} aria-pressed={option === day} onClick={() => setSelected(i)}>
      <span>조건부 대안</span><b>{option.date}</b><small>{option.stops.length}곳 · {option.totalMinutes}분</small>
    </button>)}</div>
    <ol className="conditional-stops">{day.stops.map(stop => <li key={stop.index}>
      <b>{stop.arrival} → {stop.departure} · {stop.name}</b><p>{stop.address}</p>
      {stop.condition ? <p className="conditional-warning">{stop.condition}</p> : <p>이 장소의 입장 조건은 일정에 반영했습니다.</p>}
    </li>)}</ol>
    <PlanBreakdown day={day}/>
    <p>예약 필수로 확인된 행사의 미보유 예약이나 매진 좌석을 가정해서 채운 일정은 아닙니다. 실제 예약 회차·잔여석과 현재 대기는 확인되지 않습니다.</p>
  </section>;
}
