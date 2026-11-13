# Administration moves to a side nav with dropdowns — Nov 13 2026

## What the owner asked

> "i want the literalt affilates tab to have a drop down if you hover over it and a section for the
> resturants under that the leads to its own sopt not in the middle of the page also i want to
> right aling all of the tabs to the right hand side of the screen instead of across and have drop
> downs on the sections is appicaplble"

and, on seeing it:

> "i ment on the left hand side not the right"

Three things: Restaurants becomes a destination of its own rather than a fold inside the affiliate
page; the tabs move from a row across the top to a column down the left; a section holding more
than one page opens on hover.

## Sections, not a strip

`adminSections` names the twelve sections in the order the day runs. A section holding one page is
that page. A section holding several renders a label and a menu, and every page inside it is a real
tab with its own address (`?tab=traffic`) exactly as before.

Two sections have more than one page today:

- **Affiliates** — Affiliate program, Restaurants
- **Reports** — Sales reports, Traffic, Search, Change log

Reports previously used a different mechanism: one tab plus a separate row of buttons underneath
the strip. That row is gone; it was the same idea built twice.

A test derives both lists from the source and fails if a page is declared but sits in no section, or
sits in two. Adding a page without giving it a home is the obvious way to strand one, and it is the
kind of mistake nobody notices until a screen is unreachable.

## Hover, touch and the keyboard all reach the pages

The menu is held open by `:hover` **and** `:focus-within`. Arrowing along the list moves focus into
a section's pages and opens it on the way; without the focus rule the keyboard would skip straight
past everything behind a dropdown.

The section label is itself a button that opens the page it is currently showing, so a touch screen
with no hover still gets somewhere useful on the first tap rather than nothing at all.

Below 900px there is neither hover nor room for a column: the list returns to a wrapping row across
the top and **every page is listed outright**, because a menu that only opens on hover would be
unreachable there.

## Restaurants has its own screen

`<TabsContent value="restaurants">` renders the twenty slots on a page of their own. The `<details>`
fold in the middle of the affiliate page is gone, and `affiliate-program.tsx` no longer imports it.

It stays exactly as restrictive as it was: the fold was shown to the owner alone, so the tab is
filtered to `role === 'owner'` rather than to the `store:write` its endpoint requires. Widening who
can see it was not part of the ask, so it was not done quietly as a side effect of moving it.

## Verified

The styles live in `components/store/admin-nav.module.css`, the pattern the other admin screens
already use, so `app/globals.css` is untouched. Its old `.admin-tabs` and `.admin-report-switch`
rules are now dead: nothing carries those class names any more.

The layout was rendered with the real `Tabs` primitives against the **built** stylesheet and
screenshotted, rather than reasoned about: at 1440px the nav measures 206px wide at the left edge
with the page content beside it, the Affiliates menu opens to its right, and at 420px all sixteen
pages are listed with no horizontal page scroll.

`tests/admin-read-recovery-v1.cjs` covers the structure: one section marked open at a time and
naming the page it is on, every page in exactly one section, Restaurants owner-only, Affiliates
becoming a dropdown only for the owner, all four report pages reachable, and the stylesheet keeping
the column on the left with the hover/focus and narrow-screen rules intact.

Mutations verified to fail: moving the nav to the other side, dropping the narrow-screen fallback,
dropping the focus-within rule, showing Restaurants to every role, stranding Restaurants with no
section, and never marking which section you are in.

`npm run check:release` — TypeScript and 128 isolated suites, plus a full `npm run build`.

## What did not change

Every page's address, permissions, and content. This is navigation only: no screen was rewritten,
and `?tab=` links already sent out still land where they did.
