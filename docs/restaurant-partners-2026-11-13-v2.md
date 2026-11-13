# Restaurant partners: the link is the code — Nov 13 2026

Supersedes [v1](restaurant-partners-2026-11-13-v1.md), shipped earlier the same day. Everything in
v1 about the slot model, the retire-never-delete rule, the single compare-and-set and the unchanged
commission contract still holds. What changed is the identifier and the fact that the link now
works at all.

## What the owner asked

> "i just want the link to be trybiomod.com/nameofcompany"

> "okay what if we changed it to trybiomod.com/companyname then percent or number at the end so just
> the promo code basically"

So: one identifier, not two. The address a restaurant hands out **is** the discount code, in lower
case.

## One identifier

"Mario's Pizza" at 15% becomes code `MARIOSPIZZA15` and link `trybiomod.com/mariospizza15`. The slug
is the code lower-cased — there is no separate derivation to drift apart from it, and the owner has
one string to read down the phone.

Because the discount is part of the code, **changing the percentage changes the code and the link**.
The old one is retired rather than dropped, exactly as a rename already was, so a card already
printed resolves to a page telling the customer it is no longer valid instead of silently charging
full price.

Collisions now separate with a **letter**: three restaurants called Rio get `RIO15`, `RIO15B`,
`RIO15C`. The previous numeric suffix produced `RIO152`, which reads as a hundred and fifty-two per
cent.

## The address has to be free

A restaurant link is a bare top-level path, so a code landing on a name the storefront already
serves would be shadowed by the real page and the link would quietly do nothing.
`RESERVED_SLUGS` lists the storefront's own pages, the account/checkout/administration routes and
the paths served outside the page tree; the single-segment entries of the old-URL redirect table are
**derived** from `lib/legacy-routes`, which holds 47 of them and grows.

`tests/restaurant-slug-reserved-v1.cjs` reads the real route tables and fails if the site gains a
top-level route the list does not cover, so it cannot silently fall behind. Administration refuses a
name whose code lands on a reserved address with 409 and a plain sentence, so a link and the page it
would have shadowed can never both exist.

## Resolution lives in `proxy.ts`, not the catch-all page

The first attempt resolved links in `app/[...path]/page.tsx`. Three dependency guards refused it —
`public-batch-consumers-v1.cjs` ("Unexpected public route dependency"), `admin-landing-v1.cjs`, then
`Cannot find module 'cloudflare:workers'` — because reaching the database from that page drags the
Worker runtime into every harness that renders it. That approach was reverted entirely.

`proxy.ts` already runs on every request and already holds the runtime, so it costs nothing there.
The lookup is reached only by a GET or HEAD for a **single** path segment that is not reserved, so
ordinary traffic — the home page, `/shop`, `/product/…`, `/api/…` — never pays for it. A match
redirects **302, never 301**: a slot can be renamed or switched off, and a browser must not cache an
address the owner may reassign tomorrow. An unreadable settings row leaves the storefront exactly as
it was — a 404 for an unknown address, which is what happened before any of this existed.

## The link now actually applies the discount

This is the real bug v1 shipped with. `/r/<code>` set the promo cookie only for an **approved
affiliate member**. A restaurant slot is not an affiliate member, so following
`trybiomod.com/mariospizza15` landed the customer on the shop with no discount and nothing to show
for the link. The screen already promised otherwise in so many words: *"the link still applies the
discount, but the sale is credited to nobody."*

A live slot's own code now sets the cookie directly. These are the store's own codes, and the order
trigger that pays commission matches approved members only, so arriving this way still credits
nobody — the contract in v1 is untouched. The affiliate path is unchanged and still tested.

Nothing else gets a cookie: not a retired code, not a slot that is switched off, not an unknown
address.

## The preview was wrong too

The admin panel previewed `trybiomod.com/marios-pizza` while the save produced
`trybiomod.com/mariospizza15`. It now derives the preview the same way the save does, discount
included, and the superseded `slugFromName` helper is gone rather than left for someone to reuse.

## Checks

`tests/restaurant-partners-v1.cjs` — the name and discount becoming one code that is also the link,
collisions separating, a built-in store code never shadowed, a slot pricing nothing until it is
complete and switched on, untrusted stored text throughout.

`tests/restaurant-partners-route-v1.cjs` — the real endpoint against isolated SQLite, plus **the
link followed for real**: a live slot's bare link applies its discount, as does the code written out
and in any case; a retired, switched-off or unknown address applies nothing; an approved affiliate
link still works and an unapproved one still does not.

`tests/restaurant-slug-reserved-v1.cjs` — the reserved list against the real route tables.

Mutations verified to fail: dropping the restaurant short-circuit in `/r`, ignoring the on/off
switch, a code that stops carrying its discount, treating a deeper path as a link, leaving reserved
pages unprotected, and removing the proxy redirect.

`npm run check:release` — TypeScript and 128 isolated suites.

## Still outstanding

Commission is **not** paid on these links. The owner chose real commission early on and then chose
to keep this programme apart from everything else; the panel says plainly that a sale is credited to
nobody until that restaurant is an approved affiliate with an accepted agreement and schedule. The
links are ready for the moment one is.
