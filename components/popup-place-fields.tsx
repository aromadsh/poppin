"use client";

import type { PlaceRow } from "../lib/place-input";
import { useState } from "react";

type Props = {
  place: PlaceRow;
  index: number;
  removable: boolean;
  update: (id: string, key: "name" | "genre" | "address" | "stayMinutes", value: string | number) => void;
  remove: (id: string) => void;
  lookup: (id: string) => Promise<void>;
  select: (id: string, candidateId: string) => void;
  composing?: (id: string, value: boolean) => void;
  setReservation: (id: string, reservation: PlaceRow["reservation"]) => void;
  dateFrom: string;
  dateTo: string;
};
function Arrow(){return <svg viewBox="0 0 256 256" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M64 192 192 64M64 64h128v128"/></svg>}

export function PopupPlaceFields({place:p,index,removable,update,remove,lookup,select,composing,setReservation,dateFrom,dateTo}:Props) {
  const searching=p.lookupStatus==="loading";
  const pending=searching||p.lookupStatus==="scheduled";
  const choices=p.lookupResult?.candidates||[];
  const unresolved=["not_found","past","unconfirmed","error"].includes(p.lookupStatus);
  const id=p.id;
  return <fieldset className="place-fieldset" aria-busy={searching}>
    <legend><span className="number-chip">0{index+1}</span> 방문 장소 {index+1}</legend>
    {removable&&<button type="button" className="remove-place" aria-label={`방문 장소 ${index+1} 삭제`} onClick={()=>remove(id)}><svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" aria-hidden="true"><path d="m64 64 128 128M192 64 64 192"/></svg></button>}
    <div className="field name-lookup-field">
      <label htmlFor={`name-${id}`}>팝업명 <span>이름만 입력하세요</span></label>
      <div className="name-lookup-input"><input id={`name-${id}`} required minLength={2} maxLength={100} value={p.name} placeholder="가고 싶은 팝업의 이름" autoComplete="off" aria-describedby={`lookup-hint-${id} lookup-status-${id}`} onCompositionStart={()=>composing?.(id,true)} onCompositionEnd={()=>composing?.(id,false)} onChange={e=>update(id,"name",e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing){e.preventDefault();void lookup(id)}}}/><button type="button" className="lookup-button" disabled={searching||p.name.trim().length<2} onClick={()=>void lookup(id)} aria-label={`방문 장소 ${index+1} 주소와 장르 다시 찾기`}>{searching?"찾는 중":"다시 찾기"}</button></div>
      <p className="lookup-hint" id={`lookup-hint-${id}`}>입력을 잠시 멈추면 주소와 장르를 자동으로 찾아요.</p>
    </div>
    <div id={`lookup-status-${id}`} className={`lookup-status ${unresolved?"lookup-warning":""}`} role="status" aria-live="polite" aria-atomic="true">
      {searching?<><span className="lookup-state-dot"/>공개 웹에서 행사와 주소를 확인하고 있어요.</>:p.lookupMessage||"공개된 행사 정보와 선택한 방문 기간을 함께 확인합니다."}
    </div>
    {searching&&<div className="lookup-skeleton" aria-hidden="true"><span/><span/></div>}
    {p.lookupStatus==="choices"&&<div className="lookup-candidates" role="group" aria-label={`방문 장소 ${index+1} 검색 후보`}><p className="lookup-choice-heading">방문할 팝업을 선택해 주세요.</p>{choices.filter(c=>c.status==="active").map(c=><div className="lookup-option" key={c.id}><button type="button" onClick={()=>select(id,c.id)}><strong>{c.name}</strong><span>{c.address}</span><small>{c.genre} · {c.eventStart||"시작일 미확인"} ~ {c.eventEnd||"종료일 미확인"}</small><span className="lookup-select-label">이 행사 선택</span></button><div className="lookup-candidate-sources">{c.sources.slice(0,2).map(s=><a href={s.url} target="_blank" rel="noopener noreferrer" key={s.url}>{s.title} <Arrow/></a>)}</div></div>)}</div>}
    {p.lookupStatus==="resolved"&&choices.some(c=>c.status==="active")&&<div className="lookup-proof"><span>{p.autoAddress||p.autoGenre?"확인된 정보를 채웠어요. 수정할 수 있어요.":"직접 입력한 값은 그대로 유지했어요."}</span>{choices.filter(c=>c.status==="active"&&(c.address===p.address||choices.length===1)).slice(0,1).flatMap(c=>c.sources.slice(0,1)).map(s=><a href={s.url} target="_blank" rel="noopener noreferrer" key={s.url}>검색 출처 확인 <Arrow/></a>)}</div>}
    {unresolved&&choices.length>0&&<details className="lookup-unconfirmed"><summary>확인된 관련 행사 {choices.length}개</summary>{choices.map(c=><div key={c.id}><strong>{c.name}</strong><p>{c.address||"주소 미확인"}</p><p>{c.status==="past"?"종료 행사":"기간 또는 일치 여부 미확인"} · {c.eventStart||"미확인"} ~ {c.eventEnd||"미확인"}</p><p>{c.reason}</p>{c.sources.slice(0,1).map(s=><a href={s.url} target="_blank" rel="noopener noreferrer" key={s.url}>원문 확인 <Arrow/></a>)}</div>)}</details>}
    <div className="field-row"><div className="field"><label htmlFor={`genre-${id}`}>장르 <span>{p.autoGenre?"자동입력":"수정 가능"}</span></label><input id={`genre-${id}`} maxLength={80} list="genres" value={p.genre} placeholder={pending?"검색 결과를 기다리고 있어요":"자동으로 채워집니다"} onChange={e=>update(id,"genre",e.target.value)}/></div><div className="field"><label htmlFor={`stay-${id}`}>체류 시간</label><select id={`stay-${id}`} value={p.stayMinutes} onChange={e=>update(id,"stayMinutes",Number(e.target.value))}>{[30,45,60,90,120].map(n=><option key={n} value={n}>{n}분</option>)}</select></div></div>
    <div className="field"><label htmlFor={`address-${id}`}>주소 <span>{p.autoAddress?"자동입력":"수정 가능"}</span></label><input id={`address-${id}`} maxLength={240} value={p.address} placeholder={pending?"주소를 확인하는 중이에요":"자동입력 후 수정할 수 있어요"} onChange={e=>update(id,"address",e.target.value)}/></div>
    {unresolved&&<p className="lookup-manual-hint">정확한 행사명으로 다시 찾거나, 알고 있는 주소와 장르를 직접 입력해 주세요.</p>}
    <p className="lookup-hint">상세 주소도 입력할 수 있어요. 검색은 행사명과 도로명·지역을 함께 사용하며, 같은 건물의 다른 행사는 구분합니다.</p>
    <ReservationFields key={`${p.name}:${p.address}:${dateFrom}:${dateTo}`} place={p} dateFrom={dateFrom} dateTo={dateTo} setReservation={setReservation}/>
  </fieldset>;
}

function ReservationFields({ place: p, dateFrom, dateTo, setReservation }: Pick<Props, "place" | "dateFrom" | "dateTo" | "setReservation">) {
  const [enabled, setEnabled] = useState(Boolean(p.reservation || p.reservationDraft));
  const [date, setDate] = useState(p.reservation?.date || p.reservationDraft?.date || "");
  const [time, setTime] = useState(p.reservation?.time || p.reservationDraft?.time || "");
  const [error, setError] = useState("");
  const confirmed = p.reservation?.date === date && p.reservation?.time === time;
  const id = p.id;
  function confirm() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < dateFrom || date > dateTo || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError("방문 기간 안의 예약 날짜와 올바른 시간을 입력해 주세요."); return;
    }
    setError(""); setReservation(id, { date, time, confirmed: true });
  }
  return <div className="reservation-fields">
    <label className="reservation-toggle"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setReservation(id, undefined); setError(""); }}/> 이미 사전 예약한 장소예요</label>
    {enabled && <>
      <p className="lookup-hint" id={`reservation-hint-${id}`}>예약처의 내 예약 화면에서 행사명과 장소를 확인한 뒤 예약 날짜·시간을 입력하세요. 예약번호·이름·연락처는 입력하지 마세요. 입력한 시간을 기준으로 방문 일정을 계산합니다.</p>
      <div className="field-row"><div className="field"><label htmlFor={`reservation-date-${id}`}>예약 날짜</label><input id={`reservation-date-${id}`} type="date" required ref={node => { node?.setCustomValidity(confirmed ? "" : "예약 시간을 일정에 반영해 주세요."); }} value={date} min={dateFrom} max={dateTo} aria-describedby={`reservation-hint-${id}`} onChange={e => { setDate(e.target.value); setReservation(id, undefined); setError(""); }}/></div><div className="field"><label htmlFor={`reservation-time-${id}`}>예약 시간</label><input id={`reservation-time-${id}`} type="time" required value={time} onChange={e => { setTime(e.target.value); setReservation(id, undefined); setError(""); }}/></div></div>
      <button type="button" className="lookup-button" onClick={confirm} disabled={confirmed}>예약 시간 일정에 반영</button>
      <p role="status" className="lookup-hint">{confirmed ? `일정에 반영된 예약 시간: ${date} ${time}` : "반영 버튼을 눌러 예약 시간을 저장해 주세요."}</p>
      {error && <p role="alert" className="lookup-manual-hint">{error}</p>}
    </>}
  </div>;
}



