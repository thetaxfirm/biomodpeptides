CREATE TABLE IF NOT EXISTS `inventory_reservations` ( `order_id` text NOT NULL, `product_id` integer NOT NULL, `quantity` integer NOT NULL, PRIMARY KEY(`order_id`, `product_id`) );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reservations_product` ON `inventory_reservations` (`product_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `orders_owner_active` ON `orders` (`owner`) WHERE status IN ('creating','awaiting_payment','pending','review');
