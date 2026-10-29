# Customer reply desk simplification, October 28, 2026

Owner request: show the customer's exact message, one order result, a prepared editable reply from Kim C., COA and discount controls, and Send. Remove the optional-follow-up banner and bulky suggestions. No customer email is authorized by this change.

Changed by Codex from shared main b4accc0. Affected route: `/admin?tab=requests`; affected files: `components/store/request-inbox.tsx`, its CSS module, and the isolated request-desk regression suite. No order, payment, discount definition, original report, credential, or email-delivery setting is changed.

The main pane preserves the original customer wording and explicitly distinguishes a form or no customer message. A compact order line uses the existing live store evidence, including paid, shipped, delivered, refunded, cancelled, pending and unavailable states. Internal order notes are not customer text. The order-origin queue is labelled Orders.

Opening an eligible unanswered case creates an unsent AI draft after history and attachment checks settle. Verified matched COA forms retain their factual local preparation. Sent, uncertain-send, owner-review and inactive cases cannot trigger automatic drafting. Repeated polling cannot enqueue another attempt for the same inquiry; AI failure requires an explicit retry. Edited text is preserved. Sending still requires the authorized sender's explicit Send action and the existing revision, attachment and duplicate-send guards.

COA and discount selectors are together under the editable reply. Original PDF verification and attachment names remain visible. Repeated discount selection does not duplicate the offer. AI rewriting and escalation remain under More actions. Template suggestions, public-link insertion, redundant banners and the long send explanation are removed from the normal view. Historical correspondence and internal evidence remain available in collapsed disclosures.

Verification: focused tests cover verbatim wording, compact evidence states, automatic unsent drafting after reads, no repeated attempts after AI failure, preservation of edits, exclusion of answered/uncertain cases, COA checks, discounts and existing single-send protections. The production build runs TypeScript and all 108 isolated release suites. Exact source/deployment and live verification are recorded in the local release receipt after publication. No test emails or production test orders are used.
