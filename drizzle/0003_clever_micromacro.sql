CREATE TABLE `saved_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`products` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_packs_owner_updated` ON `saved_packs` (`owner`,`updated`);