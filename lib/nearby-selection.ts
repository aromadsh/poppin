import type { Input } from "./planner";
import type { ResearchSnapshot } from "./analysis-store";
import { ResearchError } from "./research";
import { sameEvent, validateNearbySelection } from "./nearby";
import { sameInput } from "./input-snapshot";

type Snapshot = { input: Input; research: ResearchSnapshot };

/** Combine server-owned proposals before calculating the route, never client evidence. */
export function combineNearbySelection(analysisId: string, base: Snapshot, proposals: Snapshot[], now: Date) {
  const context = proposals[0]?.research.nearbyProposal;
  if (!context || context.analysisId !== analysisId) throw new ResearchError("invalid_input", "주변 후보를 다시 선택해 주세요.", 400);
  validateNearbySelection(base.input, base.research, context.anchorIndex, context.replaceIndex, context.date, now);
  const retained = base.input.places.map((_, i) => i).filter(i => i !== context.replaceIndex);
  if (retained.length + proposals.length > 3) throw new ResearchError("invalid_input", "기존 장소를 포함해 최대 3곳까지 선택할 수 있어요.", 400);
  const input = { ...base.input, places: retained.map(i => base.input.places[i]) };
  const evidence = retained.flatMap((index, i) => {
    const ev = base.research.evidence.find(ev => ev.index === index);
    return ev ? [{ ...ev, index: i }] : [];
  });
  for (const proposal of proposals) {
    const selection = proposal.research.nearbyProposal;
    const place = proposal.input.places.at(-1);
    const ev = proposal.research.evidence.find(ev => ev.index === proposal.input.places.length - 1);
    const original = { ...proposal.input, places: proposal.input.places.slice(0, -1) };
    const expected = { ...base.input, places: retained.map(i => base.input.places[i]) };
    if (!selection || selection.analysisId !== analysisId || selection.anchorIndex !== context.anchorIndex || selection.replaceIndex !== context.replaceIndex || selection.date !== context.date
      || !sameInput(expected, original) || !place || !ev) throw new ResearchError("invalid_input", "같은 검색에서 찾은 주변 후보를 다시 선택해 주세요.", 400);
    if (input.places.some(existing => sameEvent(existing, place))) throw new ResearchError("invalid_input", "중복된 팝업은 한 번만 선택해 주세요.", 400);
    evidence.push({ ...ev, index: input.places.length });
    input.places.push(place);
  }
  return { input, research: { ...base.research, evidence, retrievedAt: proposals.map(p => p.research.retrievedAt).sort().at(-1)! }, date: context.date };
}
