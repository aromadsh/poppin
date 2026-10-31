import { planVisits, validateInput, walkInStatus, type DayPlan, type Input, type PlaceEvidence } from "./planner";
import { ResearchError, researchPlaces, validDate } from "./research";
import { scoreTaste, tasteLabel, type TasteSignal } from "./taste-scoring";
import { normalizeClassification } from "./event-taxonomy";
import { buildSearchPlan } from "./search-plan";
import { discoverNearby, type DiscoveryCandidate, type DiscoveryQuery } from "./nearby-discovery";
import type { ResearchSnapshot } from "./analysis-store";

export type NearbyStatus = "ready" | "reservation_required" | "needs_confirmation" | "needs_verification" | "unavailable" | "time_conflict";
export type NearbyRecommendation = {
  id: string; place: Input["places"][number]; evidence: PlaceEvidence;
  distanceMeters: number | null; suggestedDate: string; tasteScore: number; reasons: string[]; status: NearbyStatus;
  additionalTravelMinutes: number | null; additionalTotalMinutes: number | null;
  proposedInput: Input; plan: DayPlan | null; retrievedAt: string;
};
export type NearbyUnlocated = { name: string; address: string; genre: string; eventStart: string; eventEnd: string; sourceUrl: string };
export type NearbyReport = { recommendations: NearbyRecommendation[]; unlocated: NearbyUnlocated[]; anchorCoordinatesMissing?: boolean; verificationIncomplete?: boolean; retrievedAt: string; cached: boolean; searchCount: number; discoveredCount: number; checkedCount: number; date: string | null; replaceIndex: number | null };
const keyText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/팝업스토어|팝업|[^\p{L}\p{N}]/gu, "");
export function sameEvent(a: Input["places"][number], b: Input["places"][number]) {
  return keyText(a.name) === keyText(b.name) && keyText(a.address) === keyText(b.address);
}
function sourcedCoordinates(ev: PlaceEvidence) {
  return ev.matched && ev.status === "verified" && ev.identity?.locationStatus !== "mismatch"
    && ev.sources.some(s => s.matched) && ev.lat != null && ev.lng != null
    && Number.isFinite(ev.lat) && Number.isFinite(ev.lng) && Math.abs(ev.lat) <= 90 && Math.abs(ev.lng) <= 180;
}
export function distanceMeters(a: PlaceEvidence, b: PlaceEvidence) {
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat! - a.lat!) / 2) ** 2 + Math.cos(rad(a.lat!)) * Math.cos(rad(b.lat!)) * Math.sin(rad(b.lng! - a.lng!) / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h))));
}
function classification(ev: PlaceEvidence) {
  const urls = new Set(ev.sources.filter(s => s.matched).map(s => s.url));
  return normalizeClassification(ev.classification, url => ev.matched && typeof url === "string" && urls.has(url) ? url : null);
}
function affinity(ev: PlaceEvidence, anchors: PlaceEvidence[], preferences: string, signals: TasteSignal[]) {
  const explicit = scoreTaste([ev], preferences, signals).events[0];
  const current = classification(ev);
  const similar = anchors.map(classification).some(other => current.category !== "unclassified" && current.category === other.category
    || current.experienceTags.some(tag => other.experienceTags.includes(tag)));
  // Selected places are a weaker signal. Never counteract an explicit dislike.
  const implicit = similar && !explicit.matches.some(m => m.points < 0) ? 10 : 0;
  return { score: explicit.score + implicit, reasons: [
    ...explicit.matches.map(m => `${m.label} ${m.points > 0 ? "선호 일치" : "비선호 포함"}`),
    ...(implicit ? ["선택한 팝업과 주제·체험 방식이 비슷해요"] : []),
  ] };
}

export function validateNearbySelection(input: Input, research: ResearchSnapshot, anchorIndex: number, replaceIndex: number | null, date: string | null, now: Date) {
  try { validateInput(input, now); }
  catch (error) { throw new ResearchError("invalid_input", error instanceof Error ? error.message : "방문 조건을 확인해 주세요.", 400); }
  if (!Number.isInteger(anchorIndex) || !input.places[anchorIndex]) throw new ResearchError("invalid_input", "기준 장소를 선택해 주세요.", 400);
  if (date !== null && (date < input.dateFrom || date > input.dateTo || !validDate(date))) throw new ResearchError("invalid_input", "방문 기간 안의 날짜를 선택해 주세요.", 400);
  if (input.places.length === 3 && (replaceIndex === null || !Number.isInteger(replaceIndex) || !input.places[replaceIndex] || replaceIndex === anchorIndex || input.places[replaceIndex].reservation))
    throw new ResearchError("invalid_input", "기준 장소와 예약한 장소를 제외하고 교체할 장소를 선택해 주세요.", 400);
  if (input.places.length < 3 && replaceIndex !== null) throw new ResearchError("invalid_input", "현재 일정에는 장소를 추가할 수 있습니다.", 400);
  const anchor = research.evidence.find(ev => ev.index === anchorIndex);
  if (!anchor) throw new ResearchError("anchor_unverified", "기준 장소의 분석 정보가 없어요. 방문 조건을 다시 분석해 주세요.", 400);
  return anchor;
}

export function rankNearby(input: Input, research: ResearchSnapshot, anchorIndex: number, replaceIndex: number | null, date: string | null,
  candidates: { place: Input["places"][number]; evidence: PlaceEvidence; retrievedAt: string }[], now: Date): NearbyRecommendation[] {
  const anchor = validateNearbySelection(input, research, anchorIndex, replaceIndex, date, now);
  const dateFrom = date ?? input.dateFrom, dateTo = date ?? input.dateTo;
  const signals = research.tasteSignals ?? [];
  const retained = input.places.map((_, i) => i).filter(i => i !== replaceIndex);
  const baseInput = { ...input, places: retained.map(i => input.places[i]) };
  const retainedEvidence = retained.flatMap((index, i) => {
    const ev = research.evidence.find(ev => ev.index === index); return ev ? [{ ...ev, index: i }] : [];
  });
  const baselineDays = planVisits(input, research.evidence, now, signals).days;
  const seen = new Set<string>();
  const ranked = candidates.flatMap(({ place, evidence: ev, retrievedAt }, i): NearbyRecommendation[] => {
    if (input.places.some(p => sameEvent(p, place) || keyText(p.name) === keyText(place.name)) || research.evidence.some(original => original.matched && original.identity?.name && ev.identity?.name && keyText(original.identity.name) === keyText(ev.identity.name))
      || !ev.matched || ev.status !== "verified" || !ev.sources.some(s => s.matched)
      || ev.identity?.locationStatus !== "confirmed" || !ev.eventStart || !ev.eventEnd || ev.eventEnd < dateFrom || ev.eventStart > dateTo) return [];
    const distance = sourcedCoordinates(anchor) && sourcedCoordinates(ev) ? distanceMeters(anchor, ev) : null;
    if (distance !== null && distance > 2000) return [];
    const identity = `${keyText(ev.identity?.name || place.name)}:${keyText(ev.identity?.address || place.address)}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const proposedInput = { ...input, places: [...baseInput.places, { ...place, stayMinutes: 45 }] };
    const candidateEvidence = { ...ev, index: proposedInput.places.length - 1 };
    const plan = planVisits(proposedInput, [...retainedEvidence, candidateEvidence], now, signals);
    const inRange = (day: { date: string }) => day.date >= dateFrom && day.date <= dateTo;
    const strict = plan.days.find(d => inRange(d) && d.complete);
    const conditional = plan.conditionalDays.find(d => inRange(d) && d.complete);
    const booking = plan.reservationCandidates.find(c => c.index === candidateEvidence.index)?.windows.find(inRange);
    const suggestedDate = strict?.date ?? conditional?.date ?? booking?.date
      ?? ev.hours.find(inRange)?.date ?? (ev.eventStart > dateFrom ? ev.eventStart : dateFrom);
    const baseline = baselineDays.find(d => d.date === suggestedDate && d.complete);
    const status: NearbyStatus = strict ? "ready" : conditional ? "needs_confirmation" : booking ? "reservation_required"
      : distance === null || !ev.hours.some(inRange) ? "needs_verification"
      : walkInStatus(ev) !== "available" && (ev.admission?.reservation === "sold_out" || walkInStatus(ev) === "unavailable") ? "unavailable" : "time_conflict";
    const taste = affinity(ev, retainedEvidence, input.preferences, signals);
    return [{ id: `nearby-${i}`, place: proposedInput.places.at(-1)!, evidence: candidateEvidence, distanceMeters: distance, suggestedDate,
      tasteScore: taste.score, reasons: taste.reasons, status,
      additionalTravelMinutes: strict && baseline ? strict.totalTravelMinutes - baseline.totalTravelMinutes : null,
      additionalTotalMinutes: strict && baseline ? strict.totalMinutes - baseline.totalMinutes : null,
      proposedInput, plan: strict ?? conditional ?? null, retrievedAt }];
  });
  const priority = { ready: 0, needs_confirmation: 1, reservation_required: 2, needs_verification: 3, time_conflict: 4, unavailable: 5 };
  ranked.sort((a, b) => priority[a.status] - priority[b.status]
    || (b.tasteScore * 2 - (b.additionalTravelMinutes ?? 0) * 2 - (b.distanceMeters ?? 2000) / 100) - (a.tasteScore * 2 - (a.additionalTravelMinutes ?? 0) * 2 - (a.distanceMeters ?? 2000) / 100));
  // Avoid filling the entire shortlist with a single topic when alternatives exist.
  return (Object.keys(priority) as NearbyStatus[]).flatMap(status => {
    const picked: NearbyRecommendation[] = [], deferred: NearbyRecommendation[] = [], disliked: NearbyRecommendation[] = [];
    for (const item of ranked.filter(item => item.status === status)) {
      if (item.tasteScore < 0) { disliked.push(item); continue; }
      const category = classification(item.evidence).category;
      if (picked.filter(p => classification(p.evidence).category === category).length >= 2) deferred.push(item);
      else picked.push(item);
    }
    return [...picked, ...deferred, ...disliked];
  }).slice(0, 3);
}

type Dependencies = { discover: typeof discoverNearby; research: typeof researchPlaces };
export function createNearbyService(deps: Dependencies = { discover: discoverNearby, research: researchPlaces }) {
  const catalogs = new Map<string, { expires: number; value: Awaited<ReturnType<typeof discoverNearby>>; retrievedAt: string }>();
  const verified = new Map<string, { expires: number; value: ResearchSnapshot }>();
  const pendingDiscovery = new Map<string, Promise<Awaited<ReturnType<typeof discoverNearby>>>>();
  const pendingResearch = new Map<string, Promise<ResearchSnapshot>>();
  const TTL = 20 * 60_000;
  return async (input: Input, research: ResearchSnapshot, anchorIndex: number, replaceIndex: number | null, date: string | null, secret: string, now = new Date()): Promise<NearbyReport> => {
    const anchor = validateNearbySelection(input, research, anchorIndex, replaceIndex, date, now);
    const address = anchor.matched && anchor.identity?.locationStatus === "confirmed" && anchor.identity.address
      ? anchor.identity.address : input.places[anchorIndex].address;
    const dateFrom = date ?? input.dateFrom, dateTo = date ?? input.dateTo;
    const area = buildSearchPlan({ ...input, places: [{ ...input.places[anchorIndex], address }] })[0].regionHints.join(" ") || address;
    const signals = research.tasteSignals ?? [];
    const anchorTopic = classification(anchor);
    const topics = [...new Set([
      ...signals.filter(s => s.direction === "like").map(tasteLabel),
      tasteLabel({ axis: "category", id: anchorTopic.category }),
      tasteLabel({ axis: "subcategory", id: anchorTopic.subcategory }),
      ...anchorTopic.experienceTags.map(id => tasteLabel({ axis: "experience", id })),
    ])].filter(label => label !== "미분류");
    const query: DiscoveryQuery = { area, address, anchorName: input.places[anchorIndex].name,
      lat: sourcedCoordinates(anchor) ? anchor.lat : null, lng: sourcedCoordinates(anchor) ? anchor.lng : null,
      dateFrom, dateTo, topics, preferences: input.preferences,
      excludedNames: input.places.map(p => p.name) };
    const key = JSON.stringify(query);
    for (const cache of [catalogs, verified]) for (const [id, item] of cache) if (item.expires <= now.getTime()) cache.delete(id);
    let searchCount = 0, cached = true;
    let catalog = catalogs.get(key);
    if (!catalog) {
      let task = pendingDiscovery.get(key);
      if (!task) { task = deps.discover(query, secret); pendingDiscovery.set(key, task); }
      try {
        const value = await task;
        catalog = { expires: now.getTime() + TTL, value, retrievedAt: new Date().toISOString() };
        if (catalogs.size >= 50) catalogs.delete(catalogs.keys().next().value!);
        catalogs.set(key, catalog); searchCount += value.searchCount; cached = false;
      } finally { pendingDiscovery.delete(key); }
    }
    const leads = catalog.value.candidates.filter(c => !input.places.some(p => keyText(p.name) === keyText(c.name)));
    const score = (lead: DiscoveryCandidate) => affinity({ ...anchor, classification: lead.classification,
      sources: lead.classification.sourceUrls.map(url => ({ title: "발견 근거", url, matched: true, publishedAt: null, note: "후보 분류" })) }, research.evidence, input.preferences, signals).score;
    // Discovery classification is only a preliminary shortlist signal; verified evidence is used in final ranking.
    leads.sort((a, b) => score(b) - score(a));
    let checkedCount = 0, retrievedAt = catalog.retrievedAt, verificationIncomplete = catalog.value.incomplete ?? false;
    const candidates: Parameters<typeof rankNearby>[5] = [];
    let recommendations: NearbyRecommendation[] = [];
    // Check later leads when early ones fail location/date verification. Each research request accepts at most three places.
    for (let offset = 0; offset < Math.min(leads.length, 8)
      && recommendations.filter(item => ["ready", "needs_confirmation", "reservation_required"].includes(item.status)).length < 3; offset += 3) {
      const selected = leads.slice(offset, Math.min(offset + 3, 8));
      const verificationInput: Input = { ...input, dateFrom, dateTo, preferences: "", places: selected.map(c => ({ name: c.name, address: c.address, genre: c.genre || "미분류", stayMinutes: 45 })) };
      const verificationKey = JSON.stringify(verificationInput);
      let checked = verified.get(verificationKey)?.value;
      if (!checked) {
        try {
          let task = pendingResearch.get(verificationKey);
          if (!task) { task = deps.research(verificationInput, secret, selected.map((lead, index) => ({ index, urls: lead.sourceUrls ?? [] }))); pendingResearch.set(verificationKey, task); }
          checked = await task;
          if (verified.size >= 50) verified.delete(verified.keys().next().value!);
          verified.set(verificationKey, { expires: now.getTime() + TTL, value: checked });
          searchCount += checked.searchCount; cached = false;
        } catch (error) {
          if (!checkedCount) throw error;
          verificationIncomplete = true;
          break;
        } finally { pendingResearch.delete(verificationKey); }
      }
      checkedCount += selected.length;
      retrievedAt = checked.retrievedAt;
      candidates.push(...selected.flatMap((lead, index) => {
        const ev = checked!.evidence.find(e => e.index === index);
        return ev ? [{ place: verificationInput.places[index], evidence: ev, retrievedAt: checked!.retrievedAt }] : [];
      }));
      recommendations = rankNearby(input, research, anchorIndex, replaceIndex, date, candidates, now);
    }
    return { recommendations, unlocated: [], anchorCoordinatesMissing: !sourcedCoordinates(anchor), verificationIncomplete, retrievedAt, cached, searchCount, discoveredCount: catalog.value.candidates.length, checkedCount, date, replaceIndex };
  };
}
export const nearbyService = createNearbyService();
