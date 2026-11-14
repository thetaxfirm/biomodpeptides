# Night mode for administration — Nov 13 2026

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

## Mostly a second set of values

The storefront already declares its colours as tokens on `:root` — `--background`, `--foreground`,
`--card`, `--border`, `--input`, `--muted` and the rest — and every shadcn control reads them. Dark
mode therefore redefines those tokens rather than repainting the interface, and only the handful of
admin surfaces that hardcode a colour need their own rule: the notices, the inputs, the dark save
button (which has to invert or it vanishes into the page), tables, and the side nav, which paints
its own colours.

`color-scheme: dark` comes with it, so the browser darkens its own scrollbars, caret and native
controls instead of leaving bright ones behind.

Selectors are anchored to `html[data-theme='dark']`, never `[data-theme='dark']`. The bare
attribute ties with `:root` on specificity and would then depend on which stylesheet happened to
load last; `html` + attribute outranks it outright.

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
dropping the missing-browser guard, weakening the selector to `[data-theme='dark']`, and moving the
switch inside the settings form.

Rendered in both themes against the built stylesheet and compared: dark gives `rgb(16, 20, 27)`
behind `rgb(230, 232, 227)` text with the save button inverted, and light is byte-for-byte the
screen that was there before.

`npm run check:release` — TypeScript and 129 isolated suites, plus a full build.

## Known limit

Administration renders in the browser, so on a cold load the page paints light for an instant
before the saved preference is read and applied. Removing that flash means running a snippet in the
document head on every page of the site, including the storefront, which is a larger change than
the switch is worth today.
