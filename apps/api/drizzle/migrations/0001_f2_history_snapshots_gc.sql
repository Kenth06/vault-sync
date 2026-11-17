ALTER TABLE `blobs` ADD `ref_since_seq` integer;--> statement-breakpoint
ALTER TABLE `blobs` ADD `orphaned_seq` integer;--> statement-breakpoint
CREATE INDEX `blobs_orphaned_at` ON `blobs` (`orphaned_at`);--> statement-breakpoint
ALTER TABLE `changes` ADD `size` integer;--> statement-breakpoint
ALTER TABLE `changes` ADD `mtime` integer;--> statement-breakpoint
CREATE INDEX `changes_from_path` ON `changes` (`from_path`);--> statement-breakpoint
UPDATE `blobs` SET `ref_since_seq` = (SELECT min(`seq`) FROM `changes` WHERE `changes`.`hash` = `blobs`.`hash`) WHERE `ref_since_seq` IS NULL;--> statement-breakpoint
UPDATE `blobs` SET `orphaned_seq` = (SELECT max(`seq`) FROM `changes` WHERE `changes`.`prev_hash` = `blobs`.`hash`) WHERE `refs` = 0 AND `ref_since_seq` IS NOT NULL AND `orphaned_seq` IS NULL;--> statement-breakpoint
UPDATE `changes` SET `size` = (SELECT `size` FROM `blobs` WHERE `blobs`.`hash` = `changes`.`hash`) WHERE `size` IS NULL AND `hash` IS NOT NULL;--> statement-breakpoint
UPDATE `changes` SET `mtime` = `at` WHERE `mtime` IS NULL AND `hash` IS NOT NULL;
