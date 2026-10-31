import type { Input } from "./planner";
import type { EventClassification } from "./event-taxonomy";
import type { LookupCandidate, LookupResult } from "./lookup";

export type PlaceRow = Input["places"][number] & {
  id: string;
  classification?: EventClassification;
  lookupStatus: "idle" | "scheduled" | "loading" | "resolved" | "choices" | "not_found" | "past" | "unconfirmed" | "error" | "manual";
  reservationDraft?: { date: string; time: string };
  lookupMessage: string;
  lookupResult?: LookupResult;
  autoAddress: boolean;
  autoGenre: boolean;
};
type Field = "name" | "genre" | "address" | "stayMinutes";
type Request = { controller: AbortController; promise: Promise<LookupResult>; users: Set<string> };
type RowState = { generation: number; manualAddress: boolean; manualGenre: boolean; composing: boolean; timer?: ReturnType<typeof setTimeout>; pending?: Promise<void>; request?: Request };
const messages = {
  unique: "주소와 장르를 찾았어요. 원하는 정보로 수정할 수 있어요.",
  multiple: "같은 이름의 행사가 여러 개예요. 방문할 행사를 선택하거나 주소와 장르를 직접 입력해 주세요.",
  not_found: "일치하는 행사를 찾지 못했어요. 이름을 확인하거나 주소와 장르를 직접 입력해 주세요.",
  past: "선택한 기간에 방문할 수 있는 행사를 찾지 못했어요. 기간을 확인하거나 주소와 장르를 직접 입력해 주세요.",
  unconfirmed: "현재 행사 정보를 확인하지 못했어요. 출처를 확인하거나 주소와 장르를 직접 입력해 주세요.",
  error: "자동 검색에 실패했어요. 다시 검색하거나 주소와 장르를 직접 입력해 주세요.",
  timeout: "검색 시간이 초과됐어요. 주소와 장르를 직접 입력하거나 나중에 다시 검색해 주세요.",
  connection: "검색 서버에 연결하지 못했어요. 서버 실행 상태와 연결을 확인한 뒤 다시 시도해 주세요.",
  response: "검색 서버의 응답을 읽을 수 없어요. 잠시 후 다시 시도하거나 주소와 장르를 직접 입력해 주세요.",
};
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function dateError(from: string, to: string) {
  if (!validDate(from) || !validDate(to)) return "방문 날짜를 올바르게 입력해 주세요.";
  const today = new Date(Date.now() + 9 * 60 * 60_000).toISOString().slice(0, 10);
  if (from < today) return "방문 날짜는 오늘 이후로 선택해 주세요.";
  if (to < from) return "마지막 날짜는 시작 날짜 이후로 선택해 주세요.";
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 13) return "방문 날짜는 최대 14일 범위로 선택해 주세요.";
  return "";
}

export class PopupPlacesController {
  private nextId = 0;
  private places: PlaceRow[] = [];
  private rows = new Map<string, RowState>();
  private listeners = new Set<() => void>();
  private requests = new Map<string, Request>();
  private jobs: (() => void)[] = [];
  private running = 0;
  private cache = new Map<string, { result: LookupResult; expires: number }>();
  private revision = 0;
  private active = true;

  constructor(private dateFrom: string, private dateTo: string, private fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {
    this.addPlace();
  }
  getSnapshot = () => this.places;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit() { for (const listener of this.listeners) listener(); }
  private patch(id: string, patch: Partial<PlaceRow>) {
    this.places = this.places.map(row => row.id === id ? { ...row, ...patch } : row);
    this.emit();
  }
  private release(id: string, request?: Request) {
    if (!request) return;
    request.users.delete(id);
    if (!request.users.size) {
      request.controller.abort();
      for (const [key, value] of this.requests) if (value === request) this.requests.delete(key);
    }
  }
  private cancel(id: string) {
    const state = this.rows.get(id);
    if (!state) return;
    state.generation++;
    clearTimeout(state.timer);
    state.timer = undefined;
    this.release(id, state.request);
    state.request = undefined;
    state.pending = undefined;
  }
  private schedule(id: string) {
    const row = this.places.find(row => row.id === id), state = this.rows.get(id);
    if (!row || !state || !this.active || state.composing) return;
    const problem = dateError(this.dateFrom, this.dateTo);
    if (problem) { this.patch(id, { lookupStatus: "error", lookupMessage: problem }); return; }
    const name = row.name.trim();
    if (name.length < 2 || name.length > 100) {
      this.patch(id, { lookupStatus: "idle", lookupMessage: name ? "팝업 이름을 2~100자로 입력하면 자동으로 찾아요." : "" });
      return;
    }
    this.patch(id, { lookupStatus: "scheduled", lookupMessage: "입력이 끝나면 주소와 장르를 자동으로 찾아요." });
    state.timer = setTimeout(() => { void this.lookupNow(id); }, 1200);
  }
  addPlace = () => {
    if (this.places.length >= 3) return;
    const id = `popup-${++this.nextId}`;
    this.rows.set(id, { generation: 0, manualAddress: false, manualGenre: false, composing: false });
    this.places = [...this.places, { id, name: "", genre: "", address: "", stayMinutes: 45, lookupStatus: "idle", lookupMessage: "", autoAddress: false, autoGenre: false }];
    this.revision++;
    this.emit();
  };
  loadPreset = (input: Input, drafts: { placeIndex: number; date: string; time: string }[] = [], message = "테스트 프리셋 입력값 · 실시간 검색 전") => {
    if (!input.places.length || input.places.length > 3) throw new Error("프리셋은 1~3곳을 포함해야 합니다.");
    for (const row of this.places) this.cancel(row.id);
    this.rows.clear();
    this.dateFrom = input.dateFrom;
    this.dateTo = input.dateTo;
    this.places = input.places.map((place, index) => {
      const id = `popup-${++this.nextId}`;
      this.rows.set(id, { generation: 0, manualAddress: true, manualGenre: true, composing: false });
      const draft = drafts.find(draft => draft.placeIndex === index);
      return { ...place, ...(place.reservation ? { reservation: { ...place.reservation } } : {}), id,
        ...(draft ? { reservationDraft: { date: draft.date, time: draft.time } } : {}),
        lookupStatus: "manual", lookupMessage: message, autoAddress: false, autoGenre: false };
    });
    this.revision++;
    this.emit();
  };
  removePlace = (id: string) => {
    if (!this.rows.has(id)) return;
    this.cancel(id);
    this.rows.delete(id);
    this.places = this.places.filter(row => row.id !== id);
    this.revision++;
    this.emit();
  };
  updatePlace = (id: string, key: Field, value: string | number) => {
    const row = this.places.find(row => row.id === id), state = this.rows.get(id);
    if (!row || !state || row[key] === value) return;
    if ((key === "stayMinutes") !== (typeof value === "number")) return;
    this.revision++;
    if (key === "name" || key === "address") this.patch(id, { reservation: undefined, reservationDraft: undefined, classification: undefined });
    if (key === "address") state.manualAddress = true;
    if (key === "genre") { state.manualGenre = true; this.patch(id, { classification: undefined }); }
    if (key === "name") {
      this.cancel(id);
      this.patch(id, { name: value as string, ...(row.autoAddress ? { address: "", autoAddress: false } : {}), ...(row.autoGenre ? { genre: "", autoGenre: false } : {}), lookupResult: undefined, lookupStatus: "idle", lookupMessage: "" });
      this.schedule(id);
    } else this.patch(id, { [key]: value, ...(key === "address" ? { autoAddress: false } : {}), ...(key === "genre" ? { autoGenre: false } : {}) });
  };
  setReservation = (id: string, reservation: Input["places"][number]["reservation"]) => {
    if (!this.rows.has(id)) return;
    this.revision++;
    this.patch(id, { reservation });
  };
  setComposing = (id: string, composing: boolean) => {
    const state = this.rows.get(id);
    if (!state || state.composing === composing) return;
    state.composing = composing;
    if (composing) this.cancel(id);
    else this.schedule(id);
  };
  setDates = (from: string, to: string) => {
    if (from === this.dateFrom && to === this.dateTo) return;
    this.dateFrom = from; this.dateTo = to; this.revision++;
    for (const row of this.places) {
      this.cancel(row.id);
      this.patch(row.id, { reservation: undefined, reservationDraft: undefined, classification: undefined, ...(row.autoAddress ? { address: "", autoAddress: false } : {}), ...(row.autoGenre ? { genre: "", autoGenre: false } : {}), lookupResult: undefined, lookupStatus: "idle", lookupMessage: "" });
      this.schedule(row.id);
    }
  };
  private request(name: string): Request {
    const key = JSON.stringify([name.trim().toLocaleLowerCase(), this.dateFrom, this.dateTo]);
    const existing = this.requests.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    const cached = this.cache.get(key);
    const body = JSON.stringify({ name: name.trim(), dateFrom: this.dateFrom, dateTo: this.dateTo });
    let failureMessage: string = messages.error;
    const promise = cached && cached.expires > Date.now() ? Promise.resolve({ ...cached.result, cached: true }) : (() => {
      let onAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error(controller.signal.reason === "timeout" ? messages.timeout : failureMessage));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const lookup = async () => {
        let response: Response;
        try {
          response = await this.fetcher("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
        } catch (error) {
          failureMessage = messages.connection;
          throw error;
        }
        if (!response.ok) {
          const error = await response.json().catch(() => null) as { error?: unknown } | null;
          if (typeof error?.error === "string" && error.error.trim()) failureMessage = `${error.error.trim().slice(0, 240)} 주소와 장르를 직접 입력해 계속할 수도 있어요.`;
          throw new Error(failureMessage);
        }
        failureMessage = messages.response;
        const data = await response.json() as LookupResult;
        if (!data || !["unique", "multiple", "not_found", "past", "unconfirmed"].includes(data.status) || !Array.isArray(data.candidates)) throw new Error(messages.response);
        if (!controller.signal.aborted) {
          if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { result: data, expires: Date.now() + 5 * 60_000 });
        }
        return data;
      };
      const queued = new Promise<LookupResult>((resolve, reject) => {
        this.jobs.push(() => {
          if (controller.signal.aborted) { reject(new Error(messages.error)); return; }
          this.running++;
          timer = setTimeout(() => controller.abort("timeout"), 70_000);
          Promise.race([lookup(), aborted]).then(resolve, reject).finally(() => { this.running--; this.drain(); });
        });
        this.drain();
      });
      return Promise.race([queued, aborted]).catch(error => {
        throw new Error(controller.signal.reason === "timeout" ? messages.timeout : failureMessage, { cause: error });
      }).finally(() => { clearTimeout(timer); controller.signal.removeEventListener("abort", onAbort); });
    })();
    const request = { controller, promise, users: new Set<string>() };
    this.requests.set(key, request);
    return request;
  }
  private drain() {
    while (this.running < 2 && this.jobs.length) this.jobs.shift()!();
  }
  private applyCandidate(id: string, candidate: LookupCandidate) {
    const state = this.rows.get(id);
    if (!state || candidate.status !== "active" || !candidate.address?.trim()) return false;
    const row = this.places.find(row => row.id === id)!;
    if (!state.manualAddress && row.address !== candidate.address) this.patch(id, { reservation: undefined });
    const genre = state.manualGenre ? this.places.find(row => row.id === id)?.genre : candidate.genre;
    this.patch(id, { classification: !state.manualGenre && (!state.manualAddress || row.address === candidate.address) ? candidate.classification : undefined, ...(!state.manualAddress ? { address: candidate.address, autoAddress: true } : {}), ...(!state.manualGenre ? { genre: candidate.genre || "", autoGenre: Boolean(candidate.genre?.trim()) } : {}), lookupStatus: "resolved", lookupMessage: genre?.trim() ? messages.unique : "주소를 확인했어요. 장르는 직접 입력해 주세요." });
    return true;
  }
  lookupNow = (id: string): Promise<void> => {
    const row = this.places.find(row => row.id === id), state = this.rows.get(id);
    if (!row || !state || !this.active) return Promise.resolve();
    if (state.pending) return state.pending;
    clearTimeout(state.timer); state.timer = undefined;
    const problem = dateError(this.dateFrom, this.dateTo) || (state.composing ? "이름 입력을 마친 뒤 다시 검색해 주세요." : row.name.trim().length < 2 || row.name.trim().length > 100 ? "팝업 이름을 2~100자로 입력하거나 주소와 장르를 직접 입력해 주세요." : "");
    if (problem) { this.patch(id, { lookupStatus: "error", lookupMessage: problem }); return Promise.resolve(); }
    const generation = ++state.generation;
    const request = this.request(row.name);
    request.users.add(id); state.request = request;
    this.patch(id, { lookupStatus: "loading", lookupMessage: "공개된 행사 안내에서 주소와 장르를 찾고 있어요." });
    const current = () => this.active && this.rows.get(id) === state && state.generation === generation;
    state.pending = (async () => {
      try {
        const data = await request.promise;
        if (!current()) return;
        this.patch(id, { lookupResult: data });
        const active = data.candidates.filter(candidate => candidate.status === "active");
        if (data.status === "unique" && active.length === 1 && this.applyCandidate(id, active[0])) return;
        const status = data.status === "multiple" || data.status === "unique" && active.length > 1 ? "choices" : data.status === "unique" ? "unconfirmed" : data.status;
        this.patch(id, { lookupStatus: status, lookupMessage: messages[status === "choices" ? "multiple" : status] });
      } catch (error) {
        if (current()) this.patch(id, { lookupStatus: "error", lookupMessage: error instanceof Error ? error.message : messages.error });
      } finally {
        this.release(id, request);
        if (current()) { state.pending = undefined; state.request = undefined; }
      }
    })();
    return state.pending;
  };
  selectCandidate = (id: string, candidateId: string) => {
    const row = this.places.find(row => row.id === id);
    const candidate = row?.lookupResult?.candidates.find(candidate => candidate.id === candidateId);
    if (candidate?.status === "active") { this.revision++; this.applyCandidate(id, candidate); }
  };
  resolvePlaces = async (): Promise<Input["places"]> => {
    const problem = dateError(this.dateFrom, this.dateTo);
    if (problem) throw new Error(problem);
    if (!this.places.length) throw new Error("방문할 팝업을 한 곳 이상 입력해 주세요.");
    const revision = this.revision;
    let unsubscribe = () => {};
    const changed = new Promise<never>((_, reject) => {
      unsubscribe = this.subscribe(() => { if (this.revision !== revision) reject(new Error("입력 조건이 변경됐어요. 현재 정보로 다시 분석해 주세요.")); });
    });
    try {
      await Promise.race([Promise.all(this.places.map(row => {
        const manual = this.rows.get(row.id)!;
        if (manual.composing) throw new Error("팝업 이름 입력을 마친 뒤 다시 분석해 주세요.");
        if (manual.manualAddress && manual.manualGenre && row.address.trim() && row.genre.trim()) return;
        if (["idle", "scheduled", "loading", "error"].includes(row.lookupStatus)) return this.lookupNow(row.id);
      })), changed]);
      if (revision !== this.revision) throw new Error("입력 조건이 변경됐어요. 현재 정보로 다시 분석해 주세요.");
      return this.places.map((row, index) => {
        const state = this.rows.get(row.id)!;
        const manual = state.manualAddress && state.manualGenre && row.address.trim() && row.genre.trim();
        if (!row.name.trim()) throw new Error(`${index + 1}번째 팝업 이름을 입력해 주세요.`);
        if (!manual && row.lookupStatus !== "resolved") throw new Error(`${row.name}: ${row.lookupMessage || messages.not_found}`);
        if (!row.address.trim() || !row.genre.trim()) throw new Error(`${row.name}: 주소와 장르를 직접 입력해 주세요.`);
        return { name: row.name.trim(), address: row.address.trim(), genre: row.genre.trim(), stayMinutes: row.stayMinutes, ...(row.reservation ? { reservation: row.reservation } : {}) };
      });
    } finally { unsubscribe(); }
  };
  deactivate = () => {
    this.active = false;
    for (const row of this.places) this.cancel(row.id);
  };
  activate = () => {
    if (this.active) return;
    this.active = true;
    for (const row of this.places) if (["idle", "scheduled", "loading"].includes(row.lookupStatus)) this.schedule(row.id);
  };
}
