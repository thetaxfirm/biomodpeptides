import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
export const sessions = sqliteTable('sessions', { id: text('id').primaryKey(), cart: text('cart').notNull().default('[]'), wishlist: text('wishlist').notNull().default('[]'), updated: integer('updated').notNull() });
export const profiles = sqliteTable('profiles', { id: text('id').primaryKey(), name: text('name').notNull().default(''), phone: text('phone').notNull().default(''), company: text('company').notNull().default(''), researchAccepted: integer('research_accepted').notNull().default(0), wishlist: text('wishlist').notNull().default('[]'), created: integer('created').notNull() });
export const addresses = sqliteTable('addresses', { id: text('id').primaryKey(), owner: text('owner').notNull(), data: text('data').notNull(), created: integer('created').notNull() }, t => [index('addresses_owner').on(t.owner)]);
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const overrides = sqliteTable('product_overrides', { id: integer('id').primaryKey(), data: text('data').notNull() });
export const campaigns = sqliteTable('campaigns', { id: text('id').primaryKey(), data: text('data').notNull(), active: integer('active').notNull().default(0) });
export const requests = sqliteTable('requests', { id: text('id').primaryKey(), owner: text('owner'), kind: text('kind').notNull(), data: text('data').notNull(), status: text('status').notNull().default('new'), created: integer('created').notNull() }, t => [index('requests_owner_kind').on(t.owner, t.kind)]);
export const orders = sqliteTable('orders', { id: text('id').primaryKey(), owner: text('owner').notNull(), requestKey: text('request_key').notNull(), status: text('status').notNull(), data: text('data').notNull(), total: integer('total').notNull(), checkoutRef: text('checkout_ref'), checkoutUrl: text('checkout_url'), paymentRef: text('payment_ref'), notificationId: text('notification_id'), created: integer('created').notNull(), updated: integer('updated').notNull() }, t => [uniqueIndex('orders_owner_active').on(t.owner).where(sql `status IN ('creating','awaiting_payment','pending','review')`), uniqueIndex('orders_owner_request').on(t.owner, t.requestKey), uniqueIndex('orders_capture_unique').on(t.paymentRef), uniqueIndex('orders_notification_unique').on(t.notificationId), index('orders_owner_created').on(t.owner, t.created)]);
export const rewards = sqliteTable('rewards', { id: text('id').primaryKey(), owner: text('owner').notNull(), points: integer('points').notNull(), reason: text('reason').notNull(), created: integer('created').notNull() }, t => [index('rewards_owner').on(t.owner)]);
export const rateLimits = sqliteTable('rate_limits', { key: text('key').primaryKey(), count: integer('count').notNull().default(1), expires: integer('expires').notNull() });
export const reservations = sqliteTable('inventory_reservations', { orderId: text('order_id').notNull(), productId: integer('product_id').notNull(), quantity: integer('quantity').notNull() }, t => [primaryKey({ columns: [t.orderId, t.productId] }), index('reservations_product').on(t.productId)]);

export const customerCarts=sqliteTable('customer_carts',{id:text('id').primaryKey(),cart:text('cart').notNull().default('[]'),updated:integer('updated').notNull()});
export const savedPacks=sqliteTable('saved_packs',{id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),products:text('products').notNull(),updated:integer('updated').notNull()},t=>[index('saved_packs_owner_updated').on(t.owner,t.updated)]);
export const guards=sqliteTable('transaction_guards',{id:text('id').primaryKey(),valid:integer('valid').notNull()},t=>[check('valid_transaction',sql`${t.valid}=1`)]);

// Broad daily page-view aggregates, deliberately separate from shopping sessions.
export const trafficDaily=sqliteTable('traffic_daily',{
  day:text('day').notNull(),pageGroup:text('page_group').notNull(),sourceGroup:text('source_group').notNull(),eventCount:integer('event_count').notNull(),
},t=>[primaryKey({columns:[t.day,t.pageGroup,t.sourceGroup]}),
  check('traffic_valid_day',sql`${t.day} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',${t.day},'+0 days') IS NOT NULL AND strftime('%Y-%m-%d',${t.day},'+0 days')=${t.day}`),
  check('traffic_page_group',sql`${t.pageGroup} IN ('home','catalog','product','documents','guide','about','locations','contact','policy')`),
  check('traffic_source_group',sql`${t.sourceGroup} IN ('search','ai','social','external_other','internal','direct_or_unavailable')`),
  check('traffic_count',sql`typeof(${t.eventCount})='integer' AND ${t.eventCount} BETWEEN 1 AND 50000`),
]);
export const trafficMetricsHealth=sqliteTable('traffic_metrics_health',{
  id:integer('id').primaryKey(),lastAttempt:integer('last_attempt').notNull(),lastSuccess:integer('last_success'),lastFailure:integer('last_failure'),lastStatus:text('last_status').notNull(),
},t=>[check('traffic_health_singleton',sql`${t.id}=1`),
  check('traffic_health_attempt',sql`typeof(${t.lastAttempt})='integer' AND ${t.lastAttempt}>=0`),
  check('traffic_health_success',sql`${t.lastSuccess} IS NULL OR (typeof(${t.lastSuccess})='integer' AND ${t.lastSuccess}>=0)`),
  check('traffic_health_failure',sql`${t.lastFailure} IS NULL OR (typeof(${t.lastFailure})='integer' AND ${t.lastFailure}>=0)`),
  check('traffic_health_status',sql`${t.lastStatus} IN ('ok','failed')`),
]);
