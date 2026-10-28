# Admin orders and replies coherence - October 28, 2026

Owner requested a consistent order workflow, current purchase/contact evidence before follow-ups, removal of stale proposals and contradictory examples, and no customer sends during this work.

## Behavior

Orders and Today now share one classifier. Primary views are Pack & ship, Needs attention, Payment to confirm, Track parcels and All orders. Delivered, refunded, cancelled, unsuccessful payment, test and archived records remain distinct secondary views. Payment and shipment display separately: a bought label is not carrier handoff; a store-recorded handoff is not a carrier scan. Failed payment verification takes priority and hides fulfillment controls. Existing order values, money, inventory, carrier evidence and historical records are preserved. Print queues omit parcels already handed over.

The reply desk shows current matched-account purchase and recorded contact evidence before the composer. Exact email/account matching does not infer identity from a name. Test and unclassified orders remain distinct. Recorded purchase status is not fresh payment-provider verification. Missing or bounded source coverage is explicit. COA form submissions count as incoming contacts but generated form/order notes are not presented as customer-written emails. Provider-accepted recovery emails appear in history without claiming inbox delivery. Internal optional follow-ups no longer count as unanswered customer messages.

Checkout follow-up suggestions and their saved revisions recheck later purchases, customer contact and recent outgoing records, including at the final send boundary. Staff can explicitly clear a reminder and start a different message. A limited recorded history does not stand in for a complete fresh mailbox search. The separately maintained automatic checkout-recovery scheduler is unchanged by this release.

Cross-customer edited email examples no longer enter the drafting prompt. Historical correspondence remains private evidence. Existing product-specific COA checks and owner send authorization remain. A protected owner cleanup action retires only unsent, unlocked drafts last changed before 2026-10-28 22:00 UTC, invalidates their revisions and approvals, and reports changed/approved/pending-outcome counts. Sent or uncertain outcomes and newer staff work remain intact. The local Jarvis bridge can supersede only matching older pending local drafts from that explicit retirement receipt.

The companion Jarvis change checks connected mailbox metadata before drafting and uses a scoped factual reply profile. It provides coverage, dates and contact direction without adding private mailbox text to drafting inputs.

## Verification and scope

Affected URLs: `/admin?tab=overview`, `/admin?tab=orders`, `/admin?tab=requests`; protected reply APIs, print queues and the local Jarvis TryBiomod bridge. Isolated regression coverage includes shared queue counts/navigation, payment-review control gating, print selection, COA contact, later purchases beyond ten recent orders, revision preservation and retirement races. No live payment, label, customer email or delivery-provider test is part of verification. Exact final source, checks, deployment and owner cleanup results are recorded after publication. The stopped change-history importer is not run.
