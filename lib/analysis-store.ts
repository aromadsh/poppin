import type { Input } from "./planner";
import type { researchPlaces } from "./research";

export type ResearchSnapshot = Awaited<ReturnType<typeof researchPlaces>>;
const snapshots = new Map<string, { input: Input; research: ResearchSnapshot; expires: number }>();
const TTL = 20 * 60_000;

/** Isolate-local, bounded snapshots: never accept evidence supplied by the browser. */
export function rememberAnalysis(input: Input, research: ResearchSnapshot, now = Date.now()) {
  for (const [id, item] of snapshots) if (item.expires <= now) snapshots.delete(id);
  if (snapshots.size >= 50) snapshots.delete(snapshots.keys().next().value!);
  const id = crypto.randomUUID();
  snapshots.set(id, { input: structuredClone(input), research: structuredClone(research), expires: now + TTL });
  return id;
}
export function readAnalysis(id: string, now = Date.now()) {
  const item = snapshots.get(id);
  if (!item || item.expires <= now) { snapshots.delete(id); return null; }
  return item;
}
