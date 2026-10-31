import type { Input } from "./planner";
import type { researchPlaces } from "./research";

export type ResearchSnapshot = Awaited<ReturnType<typeof researchPlaces>> & {
  nearbyProposal?: { analysisId: string; anchorIndex: number; replaceIndex: number | null; date: string | null };
};
const TTL = 20 * 60_000;

async function database(): Promise<D1Database | null> {
  let bindings: typeof import("cloudflare:workers");
  try { bindings = await import("cloudflare:workers"); }
  catch { return null; } // Plain Node tests have no Worker bindings.
  if (!bindings.env.DB) throw new Error("Analysis storage requires the DB binding.");
  return bindings.env.DB;
}

/** Server-owned snapshots survive Worker changes; browser evidence is never accepted. */
export function createAnalysisStore(getDatabase = database) {
  const snapshots = new Map<string, { input: Input; research: ResearchSnapshot; expires: number }>();
  return {
    async rememberAnalysis(input: Input, research: ResearchSnapshot, now = Date.now()) {
      const id = crypto.randomUUID(), expires = now + TTL;
      const inputJson = JSON.stringify(input), researchJson = JSON.stringify(research);
      const db = await getDatabase();
      if (db) {
        await db.batch([
          db.prepare("DELETE FROM analysis_snapshots WHERE expires_at <= ?").bind(now),
          db.prepare("INSERT INTO analysis_snapshots (id, input_json, research_json, expires_at) VALUES (?, ?, ?, ?)")
            .bind(id, inputJson, researchJson, expires),
        ]);
      } else {
        for (const [key, item] of snapshots) if (item.expires <= now) snapshots.delete(key);
        if (snapshots.size >= 50) snapshots.delete(snapshots.keys().next().value!);
        snapshots.set(id, { input: JSON.parse(inputJson), research: JSON.parse(researchJson), expires });
      }
      return id;
    },
    async readAnalysis(id: string, now = Date.now()) {
      const db = await getDatabase();
      if (db) {
        const row = await db.prepare("SELECT input_json, research_json, expires_at FROM analysis_snapshots WHERE id = ? AND expires_at > ?")
          .bind(id, now).first<{ input_json: string; research_json: string; expires_at: number }>();
        return row ? { input: JSON.parse(row.input_json) as Input, research: JSON.parse(row.research_json) as ResearchSnapshot, expires: row.expires_at } : null;
      }
      const item = snapshots.get(id);
      if (!item || item.expires <= now) { snapshots.delete(id); return null; }
      return structuredClone(item);
    },
  };
}

export const { rememberAnalysis, readAnalysis } = createAnalysisStore();
