CREATE TABLE IF NOT EXISTS `addresses` ( `id` text PRIMARY KEY NOT NULL, `owner` text NOT NULL, `data` text NOT NULL, `created` integer NOT NULL );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `addresses_owner` ON `addresses` (`owner`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `campaigns` ( `id` text PRIMARY KEY NOT NULL, `data` text NOT NULL, `active` integer DEFAULT 0 NOT NULL );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `orders` ( `id` text PRIMARY KEY NOT NULL, `owner` text NOT NULL, `request_key` text NOT NULL, `status` text NOT NULL, `data` text NOT NULL, `total` integer NOT NULL, `checkout_ref` text, `checkout_url` text, `payment_ref` text, `notification_id` text, `created` integer NOT NULL, `updated` integer NOT NULL );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `orders_owner_request` ON `orders` (`owner`,`request_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `orders_capture_unique` ON `orders` (`payment_ref`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `orders_notification_unique` ON `orders` (`notification_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orders_owner_created` ON `orders` (`owner`,`created`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_overrides` ( `id` integer PRIMARY KEY NOT NULL, `data` text NOT NULL );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `profiles` ( `id` text PRIMARY KEY NOT NULL, `name` text DEFAULT '' NOT NULL, `phone` text DEFAULT '' NOT NULL, `company` text DEFAULT '' NOT NULL, `research_accepted` integer DEFAULT 0 NOT NULL, `wishlist` text DEFAULT '[]' NOT NULL, `created` integer NOT NULL );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limits` ( `key` text PRIMARY KEY NOT NULL, `count` integer DEFAULT 1 NOT NULL, `expires` integer NOT NULL );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requests` ( `id` text PRIMARY KEY NOT NULL, `owner` text, `kind` text NOT NULL, `data` text NOT NULL, `status` text DEFAULT 'new' NOT NULL, `created` integer NOT NULL );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `requests_owner_kind` ON `requests` (`owner`,`kind`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rewards` ( `id` text PRIMARY KEY NOT NULL, `owner` text NOT NULL, `points` integer NOT NULL, `reason` text NOT NULL, `created` integer NOT NULL );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rewards_owner` ON `rewards` (`owner`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` ( `id` text PRIMARY KEY NOT NULL, `cart` text DEFAULT '[]' NOT NULL, `wishlist` text DEFAULT '[]' NOT NULL, `updated` integer NOT NULL );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` ( `key` text PRIMARY KEY NOT NULL, `value` text NOT NULL );
