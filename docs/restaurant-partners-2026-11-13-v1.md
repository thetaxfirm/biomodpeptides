# Restaurant partners: twenty slots — Nov 13 2026

## What the owner asked

> "20 personal links that i can change that lead to our website trybiomod.com that are personalized
> to resturaunts here in town … a drop down in the affilates progrm tab that is speciffically for
> resturaunts where i can go into the tab and assign a link that i can customize to their name that
> leads to our website that has their speciffic discount code on it automatically then when people
> use that link the resturant will get the credit for it"

> "i want to have it premade with 20 slots avalaible that i can basically just enter the restraunts
> name and then the system will update the promo code and vanity link to match"

Chosen by the owner: real commission (so the existing affiliate program, not a shortcut), a pretty
slug separate from the code, this programme kept apart from every other promo code, and an on/off
switch per slot.

## What already existed

Most of the mechanism. `/r/<CODE>` already checked the code belonged to an approved affiliate with
an accepted agreement and schedule, set a 30-day promo cookie and redirected to the shop. Credit was
already automatic: a trigger on order insert captures owner, agreement, schedule, commission rate,
hold days and basis at that instant, and self-referral is blocked. None of that needed changing.

Missing: twenty slots, a name-derived link and code, and a place to manage them.

## Deliberately not a second pricing path

A slot that is switched on writes its code into the ordinary stored-promo row. Checkout pricing,
the `/r/` links, affiliate approval and the promo report therefore keep reading exactly what they
read before, and none of those call sites was touched. Teaching four more of them about a new kind
of discount would have put the checkout price on a code path nobody has exercised. The only genuinely
new logic is how a name becomes a code, which is testable on its own.

## The slot model — `lib/restaurant-partners.ts`

Always exactly twenty rows in slot order, whatever is in storage, so the screen never has to guess.

"Mario's Pizza" becomes `/r/marios-pizza` and `MARIOSPIZZA`. An apostrophe closes the word up; codes
allow only letters and digits so there is nothing to separate words with. A name under the store's
three-character code floor gets its slot number appended rather than being refused — the owner is
typing a real restaurant's name and the machine should cope.

Guards:

- **A slot prices nothing until it is complete and switched on.** `active` is only honoured when the
  slot has a name, a link, a code and a discount. A stored row claiming otherwise is corrected on read.
- **A built-in store code is never shadowed.** A name colliding with one of the eleven source-level
  codes drops the code rather than quietly renaming it, so the owner cannot hand out a code that
  prices as the store's own. That slot cannot go live.
- **Collisions separate.** Three restaurants called Rio get `rio`/`rio-2`/`rio-3` and `RIO`/`RIO2`/`RIO3`.
- **Slots remember the codes they have issued** (`previous`, capped at ten).

That last one closed two real money leaks the tests caught:

1. **Renaming abandoned the old code live.** "Mario's Pizza" → "Marios Trattoria" left `MARIOSPIZZA`
   discounting forever, crediting nobody, with nothing pointing at it.
2. **Clearing a slot did the same**, because an emptied slot wiped its own memory.

A retired code is **switched off, never deleted**: it may already be printed on a table card, and a
customer typing it should be told it is not valid rather than quietly charged full price against a
code the store has forgotten.

`syncPartnerCodes` makes the promo row agree with the slots in **one** compare-and-set. A per-slot
loop that failed halfway would leave some restaurants live and others not, with no record of which.
Codes the programme does not own are copied through untouched.

## The link

`app/r/[code]/route.ts` resolves a vanity slug to its slot's code first, then falls through to
treating the input as a code. Links already handed out are unaffected. **The approved-affiliate
check is unchanged**: a link never grants credit on its own, and the screen says so.

## The screen

A `Restaurant partners · 20 slots` dropdown inside the Affiliates tab, owner only, matching the
`<details>` pattern already used there. Each slot takes a name and a percentage, previews the link
and code before saving, shows the live link with a copy button, lists retired codes, and has Save,
Switch on/off and Clear.

## Checks

`tests/restaurant-partners-v1.cjs` — derivation, twenty-slot invariant, collisions, the built-in
guard, the complete-and-on rule, and untrusted stored text.

`tests/restaurant-partners-route-v1.cjs` — the real endpoint against isolated SQLite: origin and
sign-in gates, slot bounds, nothing in the promo row until switched on, rename and clear retiring
the old code, unrelated codes untouched, every save recorded, a concurrent edit to another slot
preserved, and the screen wired into the Affiliates tab.

Mutations verified to fail: letting an incomplete slot go live (model and endpoint), forgetting
retired codes, shadowing a built-in code, sharing one link between two restaurants, and pricing from
a switched-off slot.

`npm run check:release` — TypeScript and 127 isolated suites.

## What this does not change

Each restaurant must still create an account, accept the partner agreement and accept the commission
schedule offered to them. Approval refuses without both. That is the contract and what the store
owes them, and no part of this bypasses it. The links are ready and waiting for the moment each
restaurant is approved.
