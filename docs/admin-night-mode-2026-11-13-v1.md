# Night mode for administration — Nov 13 2026, colour rule revised Nov 16

## What the owner asked

> "can you add a night mode slider in the settings that only works locally for whoever switches on
> their device only"

A switch in administration's Settings, remembered on the device that flips it and nowhere else.

## Why it is a preference, not a setting

Everything else on that screen is a store setting: one value, saved to the server, true for
everybody. This is the opposite. It lives in the browser's own local storage under
`bm_admin_theme`, is never sent anywhere, and there is no server field for it to drift out of step
with. Switching it on changes nothing for another administrator, for staff, or for a customer.

So the switch sits **above the settings form and outside it**. Inside, a personal display choice
could ride along with a store save and reach everyone; a test asserts the ordering, and that the
`config` payload is still exactly the program flags and pack discounts.

## The colour rule (owner, Nov 16 2026)

> "dont make the colors just inverted keep all of the regular colors the same just black out the
> background and use white font instead of black keep all the other colors red, yellow, etc the
> same"

The first cut recoloured the palette: the amber notice went brown, the error red was lightened, the
navy save button inverted to white. That read as an inverted theme rather than a dark one, and it
was wrong.

The rule now is narrow. **Only the background and the text move.** Rendered side by side, light and
dark differ in exactly two computed values:

| | light | night |
|---|---|---|
| page background | `rgb(255, 255, 255)` | `rgb(12, 12, 14)` |
| text, headings included | `rgb(43, 16, 48)` | `rgb(255, 255, 255)` |
| save button | `rgb(43, 16, 48)` | `rgb(43, 16, 48)` |
| notice background | `rgb(246, 237, 219)` | `rgb(246, 237, 219)` |
| error red | `rgb(139, 54, 44)` | `rgb(139, 54, 44)` |
| in-stock green | `rgb(77, 99, 59)` | `rgb(77, 99, 59)` |

There are **two** token layers, and both matter. The shadcn set on `:root` (`--background`,
`--foreground`, `--card`, `--border`, `--input`, `--muted`) and the storefront's own brand set from
`storefront-v25.css` (`--bm-ink`, `--bm-surface`, `--bm-line`, `--bm-selected`, `--bm-secondary`).
The admin screens read the brand set directly — the page heading is `color: var(--bm-ink)` — so
missing it leaves headings in plum on a black page.

Only text and surface tokens are redefined. `--primary`, `--destructive`, `--ring`, `--gold`,
`--copper`, `--bm-action`, `--bm-navy`, `--bm-cyan`, `--bm-hover` and `--bm-on-dark` are left
alone, and a test fails if any of them appears in the night-mode block. `--bm-ink` happens to hold
the same plum as `--bm-action`, but it is the text token, so it turns white while the button colour
beside it does not.

The one thing that has to be said out loud: a panel that keeps a light background now has to keep
its own dark text, because the page text around it is white. That is why the amber notice and the
error line carry an explicit colour — the same ones daylight computes, not approximations.

The navy button is kept as-is, so against a black page only its edge is hard to find. It gets a
grey border, which gives it a shape without touching its colour.

`color-scheme: dark` comes with it, so the browser darkens its own scrollbars, caret and native
controls instead of leaving bright ones behind.

Selectors are anchored to `html[data-theme='dark']`, never `[data-theme='dark']`. The bare
attribute ties with `:root` on specificity and would then depend on which stylesheet happened to
load last; `html` + attribute outranks it outright.

## Screens that paint their own colours (Nov 16)

The token work above covers anything that reads the shared sets. `orders-admin.module.css` did not:
it hardcoded about twenty colours of its own, so night mode left the whole Orders table in plum on
black — customer names, totals, statuses and every link.

It now declares its palette once at the top (`--ord-ink`, `--ord-quiet`, `--ord-link`, `--ord-line`,
`--ord-rule`, `--ord-surface`, `--ord-row`, `--ord-hover`, `--ord-soft`, `--ord-chosen`) with the
exact values it already had, and night mode is a second set. Daylight is unchanged.

One trap worth recording. Converting the hardcoded values with a find-and-replace rewrote the
palette block itself, leaving `--ord-ink: var(--ord-ink)`. A custom property defined as itself is
circular, resolves to nothing and falls back to the inherited colour — so every border and rule in
the table silently went plum while no individual rule looked wrong. It was caught by reading the
computed values out of a rendered page, not by reading the stylesheet. A test now pins each
daylight value literally and fails on any `--ord-*: var(--ord-*)`.

The brand plum needed one more distinction: `.text-button` is `color: var(--bm-action)`, so the
same token is a button **fill** in one place and **link text** in another. As a fill it is kept
untouched; as text on black it lifts to a light tint of itself, the same move the body text makes.

### Easier to read, both themes

The owner also asked for the table itself to be more legible. Changed for light and night alike:
cells align to the top so a three-line cell and a one-line cell start level; column widths are set
so the customer name stops wrapping after one word; `overflow-wrap` is `break-word` rather than
`anywhere`, so an email breaks between its parts instead of mid-word; the leading status word in a
cell is no longer the smallest text on the row; headers are uppercase and quiet; rows have a stripe
and a stronger hover; and figures are tabular so totals line up.

## Failing quietly

A display preference must never be able to stop administration from loading, so every path is
defensive:

- **No browser at all** (server render, test harness): reading returns light, saving and applying
  do nothing.
- **Storage that refuses** (private browsing, blocked site data): reading returns light, saving is
  swallowed, and the page still changes for the current visit. The owner is not shown an error
  about a colour scheme.
- **Any other stored value** — `DARK`, `true`, `1`, an empty string, a JSON blob — reads as light.
  A hand-edited value cannot come to mean something new.
- **Switching off removes the key and the attribute** rather than storing `light`. There is no dark
  rule left behind to win a later cascade, and nothing to migrate if this is ever replaced.

## Checks

`tests/admin-night-mode-v1.cjs` — the real module against a fake browser: default light, remembered
across loads, cleared outright when switched off, junk values read as light, inert with no browser
and with refusing storage, never reaching the network, plus the switch's placement outside the
settings form and the stylesheet's specificity anchor.

Mutations verified to fail: treating any stored value as dark, saving `light` as a value instead of
clearing it, leaving the page dark after switching off, dropping the try/catch around storage,
dropping the missing-browser guard, weakening the selector to `[data-theme='dark']`, moving the
switch inside the settings form, recolouring `--primary` or `--bm-action`, inverting the save
button, darkening the amber notice, leaving a light panel without dark text, giving the brand text
token anything other than white, defining an orders token as itself, and letting a hardcoded colour
back into the orders stylesheet.

Rendered in both themes against the built stylesheet and compared computed value by computed
value: the table above is that comparison.

`npm run check:release` — TypeScript and 132 isolated suites, plus a full build.

## Known limit

Administration renders in the browser, so on a cold load the page paints light for an instant
before the saved preference is read and applied. Removing that flash means running a snippet in the
document head on every page of the site, including the storefront, which is a larger change than
the switch is worth today.
