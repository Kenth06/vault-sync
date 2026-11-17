CREATE TABLE `batches` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`seq_from` integer,
	`seq_to` integer,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`refs` integer DEFAULT 0 NOT NULL,
	`orphaned_at` integer
);
--> statement-breakpoint
CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`op` text NOT NULL,
	`hash` text,
	`prev_hash` text,
	`from_path` text,
	`device_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `changes_path` ON `changes` (`path`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`last_seen` integer,
	`revoked` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`path` text PRIMARY KEY NOT NULL,
	`hash` text,
	`size` integer,
	`mtime` integer,
	`seq` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`seq` integer PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`files` integer NOT NULL,
	`bytes` integer NOT NULL,
	`at` integer NOT NULL
);
