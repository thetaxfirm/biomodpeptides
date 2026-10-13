# Canonical host redirect release, October 12, 2026

Author: Claude, at the owner's request ("make sure we are visible in Bing").

## Problem

Bing (and DuckDuckGo, which draws on Bing) returned one trybiomod.com page for `site:trybiomod.com` (`/research-use-only`) and no result for nonbranded product queries checked the same evening. `https://www.trybiomod.com/*` and `http://trybiomod.com/*` answered 200 with `X-Robots-Tag: noindex, nofollow` and a canonical pointing at the apex. The Bing Webmaster property being verified was the www host, so crawls starting there were told to drop each page instead of being sent to it.

## Change

Commit 5a4b5cf. `canonicalRedirect()` in `lib/seo-policy.ts`, called first in `proxy.ts`: public GET/HEAD pages on `www.trybiomod.com` or plain `http://` answer 301 to the same path and query on `https://trybiomod.com`. Not redirected: private paths (`/admin`, `/api`, `/auth`, `/account`, `/cart`, `/checkout`, `/payment`, sign-in and password routes), any non-GET/HEAD method, other hosts (including the workers.dev fallback), and the whole rule when indexing is disabled. Static public files are served before the proxy, so `www.trybiomod.com/BingSiteAuth.xml` and the IndexNow key stay reachable for verification. Regression: `tests/canonical-host-redirect-v1.cjs`, added to the release gate.

Commit 0a343fe (earlier the same day) added the second Bing verification key `C98CEC8E8D91252EB1DC2470FF5A6BB6` beside the October 9 key.

## Verification

- `npm run check:release`: TypeScript and 63 suites passed. `BIOMOD_DEPLOY=true npm run build` completed.
- GitHub Website consistency run 38350920288 succeeded. Cloudflare version eb668635-4dc9-4a35-b7fa-89ad411e12db deployed 2026-10-13T05:22:43Z; later versions from other contributors include it.
- Live, after deploy: `www.trybiomod.com/shop` and `http://trybiomod.com/faq` 301 to the https apex; query strings preserved; `www.trybiomod.com/admin/login` 200 (not redirected); `www.trybiomod.com/BingSiteAuth.xml` 200 with both keys; apex `/shop` 200 with no noindex header; `biomodpeptides.com` still 301s to the apex.
- IndexNow resubmission: 200 OK, 28 sitemap URLs, 2026-10-13T05:36Z.

## Open items

- Bing Webmaster Tools needs the owner's sign-in: verify the property, prefer `https://trybiomod.com/` as the site, resubmit the sitemap, and use Site Move from biomodpeptides.com (Google's Change of Address is already done, see `domain-move-v1.md`).
- Index growth is not yet observed; recheck `site:trybiomod.com` on Bing/DuckDuckGo after a few days.
