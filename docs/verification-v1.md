# Storefront review, version 1

Real data: 45 catalog products, 45 testing records, 21 PDF certificates. Six mismatches between product and certificate lots are explicitly retained. A product photograph mislabeled as a COA is not presented as a certificate. Conflicting bottle specifications are marked for confirmation.

Browser checks completed on the local storefront: product search found BPC-containing products; BPC-157 added to cart; increasing quantity recalculated $49 to $98; selecting 5-Amino-1MQ, AOD 9604 and BPC-157 completed a 3-pack at $177 with zero discount; completed pack added to cart; testing search displayed matching and mismatched lots; BPC-157 certificate viewer opened with original PDF link; age confirmation worked; mobile layout at 390px had no horizontal overflow or broken images and navigation drawer opened.

Server checks cover price tampering, incomplete packs, invalid quantities, durable carts/wishlists, cross-origin rejection and unauthenticated admin/checkout rejection. Isolated checks exercise the same SQL used by the transactional inventory operations and cover reservations, overselling, active attempt uniqueness, payment settlement, uncertain attempts, reserved inventory protection and stale inventory edit rejection. Isolated Chase checks cover integer amounts, redirect allowlist, exact capture amounts, duplicate captures, saved reference validation and disabled unconfigured checkout.

No real customer signup, email message, payment, purchase, refund or production inventory change was attempted. Managed authentication, tax and Chase integration need configuration and end-to-end testing against the owner's authorized accounts. No claim of complete parity with unobserved private Crush flows is made.
