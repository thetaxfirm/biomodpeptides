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

// Shopping stages are unlinked daily counts, not visitor journeys or payments.
export const shoppingDaily=sqliteTable('shopping_daily',{
  day:text('day').notNull(),stage:text('stage').notNull(),eventCount:integer('event_count').notNull(),
},t=>[primaryKey({columns:[t.day,t.stage]}),
  check('shopping_valid_day',sql`${t.day} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND strftime('%Y-%m-%d',${t.day},'+0 days') IS NOT NULL AND strftime('%Y-%m-%d',${t.day},'+0 days')=${t.day}`),
  check('shopping_stage',sql`${t.stage} IN ('cart_add_confirmed','cart_view','checkout_signin_view','checkout_form_view','delivery_quote_confirmed','checkout_handoff_ready')`),
  check('shopping_count',sql`typeof(${t.eventCount})='integer' AND ${t.eventCount} BETWEEN 1 AND 50000`),
]);

// Operational COA replies and request alerts; no credentials or original PDF bytes.
export const coaDeliveryOutbox=sqliteTable('coa_delivery_outbox',{
 id:text('id').primaryKey(),requestId:text('request_id').notNull(),purpose:text('purpose').notNull(),status:text('status').notNull(),reason:text('reason').notNull(),recipient:text('recipient'),recipientHash:text('recipient_hash'),dedupeKey:text('dedupe_key'),duplicateOf:text('duplicate_of'),documentHash:text('document_hash'),attachmentName:text('attachment_name'),productName:text('product_name'),strength:text('strength'),lot:text('lot'),reportId:text('report_id'),templateVersion:text('template_version').notNull(),sender:text('sender'),replyTo:text('reply_to'),subject:text('subject'),body:text('body'),payloadHash:text('payload_hash'),idempotencyKey:text('idempotency_key').notNull(),attempts:integer('attempts').notNull().default(0),firstAttemptAt:integer('first_attempt_at'),nextAttemptAt:integer('next_attempt_at').notNull(),leaseToken:text('lease_token'),leaseUntil:integer('lease_until'),providerId:text('provider_id'),acceptedAt:integer('accepted_at'),created:integer('created').notNull(),updated:integer('updated').notNull(),
},t=>[uniqueIndex('coa_delivery_request_purpose').on(t.requestId,t.purpose),uniqueIndex('coa_delivery_recipient_report').on(t.dedupeKey).where(sql`${t.purpose}='coa' AND ${t.dedupeKey} IS NOT NULL`),index('coa_delivery_ready').on(t.status,t.nextAttemptAt),index('coa_delivery_quota').on(t.purpose,t.firstAttemptAt,t.recipientHash),check('coa_delivery_purpose',sql`${t.purpose} IN ('coa','request-alert')`),check('coa_delivery_status',sql`${t.status} IN ('queued','sending','accepted','manual_review','duplicate')`),check('coa_delivery_attempts',sql`${t.attempts} BETWEEN 0 AND 5`)]);

// Private original laboratory PDFs, provisioned separately from this public repository.
export const coaOriginalReports=sqliteTable('coa_original_reports',{
 sha256:text('sha256').primaryKey(),data:text('data').notNull(),enabled:integer('enabled').notNull().default(0),
},t=>[check('coa_original_hash',sql`length(${t.sha256})=64 AND ${t.sha256} NOT GLOB '*[^a-f0-9]*'`),check('coa_original_enabled',sql`${t.enabled} IN (0,1)`)]);
// Staff below the owner level (owners are STORE_ADMIN_EMAILS). See lib/staff.ts.
export const staff=sqliteTable('staff',{
 email:text('email').primaryKey(),name:text('name').notNull().default(''),role:text('role').notNull(),active:integer('active').notNull().default(1),
 created:integer('created').notNull(),updated:integer('updated').notNull(),updatedBy:text('updated_by').notNull(),
},t=>[check('staff_email',sql`${t.email}=lower(trim(${t.email})) AND length(${t.email}) BETWEEN 3 AND 254`),check('staff_role',sql`${t.role} IN ('manager','fulfillment','support')`),check('staff_active',sql`${t.active} IN (0,1)`)]);
export const staffAudit=sqliteTable('staff_audit',{
 id:text('id').primaryKey(),actor:text('actor').notNull(),email:text('email').notNull(),role:text('role').notNull(),active:integer('active').notNull(),created:integer('created').notNull(),
},t=>[index('staff_audit_created').on(t.created),check('staff_audit_active',sql`${t.active} IN (0,1)`)]);

// Append-only audit records are enforced by database triggers in 0020_change_history.sql.
export const changeEvents=sqliteTable('change_events',{
 id:text('id').primaryKey(),occurredAt:integer('occurred_at').notNull(),recordedAt:integer('recorded_at').notNull(),
 source:text('source').notNull(),actor:text('actor').notNull(),actorType:text('actor_type').notNull(),action:text('action').notNull(),
 entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),summary:text('summary').notNull(),status:text('status').notNull(),
 changes:text('changes').notNull(),evidenceUrl:text('evidence_url'),evidenceRef:text('evidence_ref'),
},t=>[index('change_events_time').on(sql`${t.occurredAt} DESC`,sql`${t.id} DESC`),index('change_events_source_time').on(t.source,sql`${t.occurredAt} DESC`,sql`${t.id} DESC`),check('change_events_json',sql`json_valid(${t.changes})`)]);
export const changeHistorySync=sqliteTable('change_history_sync',{
 source:text('source').primaryKey(),syncedAt:integer('synced_at').notNull(),state:text('state').notNull(),description:text('description').notNull(),
});
// A singleton row exists only inside each audit transaction, never across network calls.
export const changeContext=sqliteTable('change_context',{
 id:integer('id').primaryKey(),actor:text('actor').notNull(),actorType:text('actor_type').notNull(),source:text('source').notNull(),action:text('action'),summary:text('summary'),
},t=>[check('change_context_singleton',sql`${t.id}=1`)]);
