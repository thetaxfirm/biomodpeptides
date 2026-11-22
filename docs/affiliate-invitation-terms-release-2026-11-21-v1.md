# Affiliate invitations carry their terms: Nov 21 2026

## What the owner asked

> "in affiliates, when I send out an email to someone for an affiliate program, on that same page, it
> should have the ability to create the amount I need to give discount, the name, what the person
> gets, and then it should update the rest of the site"

> "I just want to give them the terms (percentages and name they are agreeing to) like lupe10 or
> lupe15, and she gets 15% for everyone she refers. Or 10 and 10. Depends on the situation."

## Before

Admin > Affiliates had an email field and an "Authorize invitation" button. It saved the address and
emailed nobody. The code, the customer discount and the commission lived on a second form further
down the page that only appeared after the invited person had signed in and applied. Production had
two authorized invitations, no applications and no offers.

## Now

One form at the top of Admin > Affiliates, owner only:

| Field | Example | Notes |
| --- | --- | --- |
| Partner's email | the invited address | The invitation's identity. A wrong one is revoked and the right one invited. |
| Partner's name | Lupe | Used in the greeting and to make the code. |
| Customers get (% off) | 10 | Whole number, 1 to 90. |
| Partner earns (% of each sale) | 15 | 0 to 100, stored in hundredths of a percent. |
| Their code | LUPE10 | Writes itself from the name and the discount. The owner can type another. |
| Payment terms (folded) | 30-day hold, Check or ACH, online and in person | The starting values of the older per-partner offer form. Editable per person. |

Saving does the rest of the site in one step:

- **Checkout, Promo codes and the code report.** The code is created or repriced in the ordinary
  stored-promo row (`promo_codes_v1`), so pricing, the Promo codes tab and "Affiliate & promo code
  totals" read it like any other code. There is no second pricing path. The Promo codes list shows
  who it is for ("by owner for partner Lupe"), and the change log records the staff member.
- **The partner's page.** An invited person who signs in sees "Your terms from Biomod" before they
  apply. When they apply, the terms become their offer in the same database batch
  (`applyAffiliate`), as the same immutable schedule the older "Send offer" form writes. They then
  add their W-9 and license photo and sign it. Nothing is left for the owner to come back and fill in.
- **The invitation email.** "Email the invitation" on the row shows the exact message, takes one
  optional line from the owner, and sends it through the store's mail provider from the configured
  store mailbox under the name "Biomod Partner Program". The message is rebuilt on the server from
  the saved terms; the browser supplies only the address and the note. "Copy invitation" gives the
  same text for a text message or the owner's own email.

Changing terms before the partner applies renames the code when the discount changes (LUPE10 to
LUPE15) and switches the old code off. Revoking an invitation switches its code off. Codes are
switched off, never deleted, so an order that used one keeps its place in the report. Once a partner
has applied, the code is theirs: revoking the used invitation leaves it working, and their terms are
changed with "Send a new offer" on the partner record as before.

One code belongs to one partner: another active invitation, another partner's code or offer, a
Businesses slot (current or retired) and the built-in store codes are all refused with a message
that says which.

## What did not change

- Approval is still manual, by a second administrator, after the partner signs.
- Commission still accrues only on orders created after approval, through the existing order trigger.
- `/r/CODE` still applies a code on arrival only for an approved partner or a live Businesses slot.
  An invited partner's code works when typed at checkout; their share link starts working at approval.
  The invitation email says the code starts earning once Biomod approves the setup.
- The older "Send offer" form, the agreement, W-9 and ID vault, payouts and 1099 report are untouched.

## Talking points

Production has no published talking points. The older offer form refuses to save without one; the
invitation form does not, so the owner is never blocked from inviting. Instead an offer that came
from an invitation signs the current published version, and cannot be signed while there is none
(`offerPacket` lists "the one-page partner guide from Biomod" as still needed). The invitation form
shows a notice until the owner approves the talking points under "Partner offers, W-9s and
payments". The text is not published on the owner's behalf.

## Storage

Migration `0037_affiliate_invitation_terms.sql`, additive only:

- `affiliate_invitations` gains `name`, `code`, `discount_percent`, `commission_bps`, `hold_days`,
  `payout_methods`, `channels`, with a unique index on `code`. Existing rows keep working with no terms.
- New table `affiliate_invitation_emails`: one row per send attempt with the provider's answer
  (`sending`, `accepted`, `failed`, `unknown`). A row is claimed before the provider is called, so two
  clicks cannot send two emails. A claim older than two minutes no longer blocks. 50 emails a day.

No rows are seeded. No existing invitation, code, order or setting is rewritten. Rollback: the new
columns and table are inert without the new code, so reverting the source commit is sufficient.

## Checked across the affected chain

| Surface | Check |
| --- | --- |
| Checkout pricing | Built Worker: the real `/api/store/promo` quote takes 10% ($20.00) off the $200 fixture cart with `lupe10`; a revoked invitation's code is refused. |
| Promo codes tab and report | Built Worker: `/api/admin/promo-codes` lists LUPE10 at 10%, active, "for partner Lupe". Browser preview: listed on the Promo codes tab and in the totals table. |
| Case and spacing | Codes are upper-cased in the form and again on the server, and anything but 3 to 40 letters and digits is refused. Customers may type a code in any case, as before. |
| Partner page | Built Worker and browser preview: terms shown before applying; application lands in a ready offer; code and customer discount shown on the schedule. |
| Attribution | SQLite suite: after signature and approval a LUPE10 order of $200 less $20 earns $27.00 (15% of $180). |
| Share link | Built Worker: `/r/lupe10` sets no cookie before approval. |
| Roles | Route suite and built Worker: terms and the invitation email are owner only; a manager and a partner are refused; the actor comes from the session. |
| Email | SQLite suite with a stubbed provider: sender, recipient, reply-to, subject, text and escaped HTML; rejection, timeout, 5xx, double click, daily cap, paused enrollment, missing key. Built Worker: only the stub is reached. |
| Admin night mode and phone width | Browser preview at 1280px light and dark and at 375px. The three-field row ran off a phone screen through the shared `.form-row` rules; fixed in the form's own stylesheet. |
| History | Affiliate events `invitation.terms`, `invitation.emailed`, `offer.attached`; change log entries for every code created, repriced or switched off, attributed to the staff member. |

## Verification

- `npm run check:release`: TypeScript and 139 isolated suites, including the new
  `tests/affiliate-invitation-terms-v1.cjs` and the extended `tests/affiliate-route-v1.cjs`.
- Built Worker with local D1: new `tests/affiliate-invitation-terms-worker-v1.mjs`, plus
  `affiliate-worker-v1.mjs` and `affiliate-onboarding-worker-v1.mjs`. `shippingWorkerFixture` gained
  an optional `extraOutbound` hook so a suite can stub a provider of its own; every request it does
  not answer is still forbidden.
- Isolated browser preview of the built Worker with synthetic people at `example.invalid`: invite,
  rename by changing the discount, email to a local stub, copy, revoke, set terms on an existing
  invitation, partner view and application.
- No real partner, order, payment or email was used. No invitation was emailed by this release.

## Gaps

- No authenticated live check of the owner screen: the first real use is the owner's own.
- No real email was sent, so inbox placement of the invitation is unconfirmed until the owner's
  first send. The provider's answer is recorded on the row either way.
- `tests/shipping-services-worker-v1.mjs` fails on main before this change: the fixture has no stub
  for the EasyPost address check added after that suite was written, so its "no forbidden request"
  assertion trips. It is not in the release gate and is unrelated to this work; left as found.
- The two invitations already in production have no terms. They show "No terms yet" with a "Set
  terms" button; nothing was changed for them.

## Live record

Recorded after deployment in the section below.
