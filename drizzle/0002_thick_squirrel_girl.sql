CREATE TABLE IF NOT EXISTS `customer_carts` ( `id` text PRIMARY KEY NOT NULL, `cart` text DEFAULT '[]' NOT NULL, `updated` integer NOT NULL );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transaction_guards` ( `id` text PRIMARY KEY NOT NULL, `valid` integer NOT NULL, CONSTRAINT "valid_transaction" CHECK("transaction_guards"."valid"=1) );
--> statement-breakpoint
DROP TRIGGER IF EXISTS reserve_inventory_before_order;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reserve_inventory_after_order;
--> statement-breakpoint
DROP TRIGGER IF EXISTS settle_inventory_after_payment;
--> statement-breakpoint
DROP TRIGGER IF EXISTS release_inventory_after_failure;
--> statement-breakpoint
DROP TRIGGER IF EXISTS protect_reserved_inventory;
