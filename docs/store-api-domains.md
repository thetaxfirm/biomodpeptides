# Store API domain boundaries

The public `/api/store/[action]` URLs are unchanged. The route file owns transport dispatch and error translation; `lib/store-api/` owns the existing action implementations.

| Module | Responsibility |
| --- | --- |
| `write-input` | Same-origin check, streamed 30,000-byte limit, JSON object validation |
| `shared` | No-store JSON responses and the existing trimmed-string validator |
| `context` | Per-request read/write context and authenticated audit capabilities |
| `state-read` | Browser session, cart recovery, public store state and staff access summary |
| `account-read`, `account-write` | Customer/guest account visibility, profile and saved addresses |
| `cart-write`, `shopper` | Saved packs, cart/wishlist/promo actions and shared shopper/session helpers |
| `auth-write` | Existing login, registration, recovery, refresh and logout contracts |
| `checkout-read`, `checkout-write` | Hosted payment page, guest checkout, delivery choice, checkout/resume/reconcile |
| `inquiry-write`, `contact-capture` | Contact/stock requests, signup offers and secondary CRM capture |
| `admin-early-read` | Permission-gated original COA documents, changes and diagnostic reports |
| `admin-read` | Today, section-specific reads and the compatibility admin bootstrap |
| `admin-write` | Central action-to-permission map, authenticated actor and audited database context |
| `admin-orders` | Order queries, archive, preorder plan/release, handoff and payment/fulfillment actions |
| `admin-requests` | Conversations, replies, forwarding, holds and support resolution |
| `admin-settings` | General store and correspondence settings |
| `admin-catalog` | Product edits and scheduled presale campaigns |
| `admin-team` | Staff/site-update access and the retired reward-write response |

Handlers return a response for their own action, or `undefined` without side effects for another action. Dispatch order retains the signed reply bridge before browser origin/body/session checks and retains early protected reads before customer-session recovery. Unknown admin actions still require owner access before returning not found.

Admin handlers receive the authenticated actor and audit capabilities from `admin-write`. Their `run` capability is the audited writer; it must not be replaced with the raw runtime writer. Domain-specific permissions, validations, optimistic versions and existing provider guards stay in their original services and handlers.

The compatibility endpoints remain available to older open clients. Extraction is not a change to financial execution, message approval, catalog policy, customer ownership or fulfillment eligibility.

`tests/store-api-dispatch-v1.cjs` executes the dispatcher and domain modules under isolated service mocks, including streamed request limits, all admin permission families, the separate bridge boundary and audit attribution. `tests/store-api-fixture.cjs` lets existing behavioral fixtures load the real modules while retaining their provider/database guards; source-wiring tests select exact action AST branches instead of relying on adjacent sections of the former monolith. Compiled Worker suites remain the integration check for framework/runtime behavior.
