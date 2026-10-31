import { walkInStatus, type Input, type PlaceEvidence } from "./planner";

/** Display event discovery separately from the stricter schedule eligibility rules. */
export function eventInformation(ev: PlaceEvidence, input: Pick<Input, "dateFrom" | "dateTo">) {
  if (!ev.matched) {
    if (ev.identity?.locationStatus === "mismatch") return { label: "장소 불일치", detail: ev.identity.note, confirmed: false };
    if (ev.identity?.name) return { label: "후보 발견 · 장소 확인 필요", detail: ev.identity.note || "입력한 주소와 같은 장소인지 확인할 근거가 부족합니다.", confirmed: false };
    return { label: "행사 검색 미확보", detail: "행사명·지역·행사장으로 찾은 자료에서 해당 행사를 확인하지 못했습니다.", confirmed: false };
  }
  if (ev.status === "past") return { label: "선택 기간 전 종료", detail: `확인된 행사 종료일은 ${ev.eventEnd}입니다.`, confirmed: false };
  if (ev.eventStart && ev.eventStart > input.dateTo) return { label: "선택 기간 이후 행사", detail: `확인된 행사 시작일은 ${ev.eventStart}입니다.`, confirmed: false };
  if (ev.status !== "verified") return { label: "행사 발견 · 기간 확인 필요", detail: "장소 일치 근거는 있지만 선택한 방문 기간에 운영하는지 확인되지 않았습니다.", confirmed: false };
  const from = ev.eventStart && ev.eventStart > input.dateFrom ? ev.eventStart : input.dateFrom;
  const to = ev.eventEnd && ev.eventEnd < input.dateTo ? ev.eventEnd : input.dateTo;
  const dates = new Set(ev.hours.filter(h => h.date >= from && h.date <= to).map(h => h.date));
  const dayCount = Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (!dates.size) return { label: "행사 확인 · 영업시간 미확인", detail: "행사와 기간은 찾았지만 선택한 날짜의 영업시간 근거가 없어 일정을 계산할 수 없습니다.", confirmed: true };
  const hoursDetail = dates.size < dayCount ? `선택 기간 중 ${dates.size}일의 영업시간만 확인됐습니다. 확인된 날짜만 일정 계산에 사용합니다.` : "선택 기간의 영업시간이 확인됐습니다.";
  const admissionDetail = walkInStatus(ev) === "available" ? " 현장 입장 가능 안내가 있습니다. 실제 대기는 별도 확인이 필요합니다." : !ev.admission || ev.admission.reservation === "unknown" ? " 예약·현장 입장 정책은 아직 확인되지 않았습니다. 조건부 일정의 확인 사항을 살펴보세요." : " 예약 확인 후보와 입력한 예약 날짜·시간을 함께 확인해 주세요.";
  return { label: dates.size < dayCount ? "행사 확인 · 일부 날짜 영업시간 미확인" : "행사·영업시간 확인", detail: hoursDetail + admissionDetail, confirmed: true };
}
