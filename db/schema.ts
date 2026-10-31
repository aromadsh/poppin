import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const analysisSnapshots = sqliteTable("analysis_snapshots", {
  id: text("id").primaryKey(),
  inputJson: text("input_json").notNull(),
  researchJson: text("research_json").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("analysis_snapshots_expires_at_idx").on(table.expiresAt)]);
