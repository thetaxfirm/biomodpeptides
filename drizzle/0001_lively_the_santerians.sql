CREATE TABLE `inventory_reservations` (
	`order_id` text NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`order_id`, `product_id`)
);
--> statement-breakpoint
CREATE INDEX `reservations_product` ON `inventory_reservations` (`product_id`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `cart` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_owner_active` ON `orders` (`owner`) WHERE status IN ('creating','awaiting_payment','pending','review');--> statement-breakpoint
CREATE TRIGGER reserve_inventory_before_order BEFORE INSERT ON orders
WHEN NEW.status = 'creating'
BEGIN
 SELECT CASE WHEN EXISTS (
 SELECT 1 FROM (SELECT json_extract(value,'$.id') AS product_id, SUM(json_extract(value,'$.quantity')) AS quantity FROM json_each(NEW.data,'$.items') GROUP BY product_id) AS item
 LEFT JOIN product_overrides p ON p.id=item.product_id
 WHERE json_extract(p.data,'$.stockQuantity') IS NULL OR item.quantity > json_extract(p.data,'$.stockQuantity') - COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.product_id=item.product_id),0)
 ) THEN RAISE(ABORT,'Inventory is no longer available. Please update your cart.') END;
 SELECT CASE WHEN json_extract(NEW.data,'$.campaignId') IS NOT NULL AND
 COALESCE((SELECT SUM(json_extract(o.data,'$.unitCount')) FROM orders o WHERE o.owner=NEW.owner AND json_extract(o.data,'$.campaignId')=json_extract(NEW.data,'$.campaignId') AND o.status NOT IN ('failed','cancelled')),0) + json_extract(NEW.data,'$.unitCount') > json_extract(NEW.data,'$.campaignLimit')
 THEN RAISE(ABORT,'Presale customer limit exceeded.') END;
END;
--> statement-breakpoint
CREATE TRIGGER reserve_inventory_after_order AFTER INSERT ON orders
WHEN NEW.status='creating'
BEGIN
 INSERT INTO inventory_reservations(order_id,product_id,quantity)
 SELECT NEW.id,json_extract(value,'$.id'),SUM(json_extract(value,'$.quantity')) FROM json_each(NEW.data,'$.items') GROUP BY json_extract(value,'$.id');
END;
--> statement-breakpoint
CREATE TRIGGER settle_inventory_after_payment AFTER UPDATE OF status ON orders
WHEN NEW.status='paid' AND OLD.status!='paid'
BEGIN
 UPDATE product_overrides SET data=json_set(data,'$.stockQuantity',json_extract(data,'$.stockQuantity')-COALESCE((SELECT quantity FROM inventory_reservations r WHERE r.order_id=NEW.id AND r.product_id=product_overrides.id),0)) WHERE id IN (SELECT product_id FROM inventory_reservations WHERE order_id=NEW.id);
 DELETE FROM inventory_reservations WHERE order_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER release_inventory_after_failure AFTER UPDATE OF status ON orders
WHEN NEW.status IN ('failed','cancelled') AND OLD.status NOT IN ('failed','cancelled')
BEGIN
 DELETE FROM inventory_reservations WHERE order_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER protect_reserved_inventory BEFORE UPDATE ON product_overrides
WHEN json_extract(NEW.data,'$.stockQuantity') < COALESCE((SELECT SUM(quantity) FROM inventory_reservations WHERE product_id=NEW.id AND order_id IN (SELECT id FROM orders WHERE status IN ('creating','awaiting_payment','pending','review'))),0)
BEGIN SELECT RAISE(ABORT,'Inventory cannot be reduced below reserved orders.'); END;
