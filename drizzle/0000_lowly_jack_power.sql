CREATE TABLE `analysis_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`input_json` text NOT NULL,
	`research_json` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_snapshots_expires_at_idx` ON `analysis_snapshots` (`expires_at`);