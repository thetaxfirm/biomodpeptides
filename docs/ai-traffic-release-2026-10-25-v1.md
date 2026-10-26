# AI traffic release, October 25, 2026 v1

Author: Claude (owner request: "50% of traffic from AI by end of week"). Source commit `31deb86` on main; Workers Builds and release-check succeeded, and the live bundle `provider-DVIIUGB8.js` contains the new classifier.

## Finding

The traffic report showed zero AI visits. Two causes, one in our measurement and one in discovery:

1. **Measurement.** `trafficSourceGroup` classified a visit as AI only from the browser referrer, and only for six hosts. ChatGPT, Perplexity and other assistant apps often send no referrer; ChatGPT instead tags outbound links with `utm_source=chatgpt.com`. Those visits were counted as `direct_or_unavailable`.
2. **Discovery.** Google indexes the site. Bing, which ChatGPT search, Copilot and DuckDuckGo draw on, held about 20 of our URLs (Oct 24 log), and a Bing `site:trybiomod.com` query on Oct 25 returned no trybiomod result at all. Only 17 of 52 product records are published for search (`lib/seo-publication-v1.json`, holds retained).

## Change

- `lib/traffic-navigation.ts`: a landing whose `utm_source` names an AI assistant is grouped `ai` (read in the browser only, never sent or stored; internal navigations stay `internal`). Added assistant hosts: Gemini/Bard/NotebookLM, Copilot (incl. Edge `edgeservices.bing.com`), Grok, Mistral, DeepSeek, Meta AI, You.com, Phind, Poe, Kagi, Duck.ai, Character.ai.
- `components/store/traffic-measurement.tsx`: passes `window.location.search` to the classifier.
- `tests/traffic-measurement-v1.cjs`: tagged/untagged, spoofed-suffix, internal and new-host cases.

## Verification

- `npm run check:release`: TypeScript and 102 isolated suites passed.
- IndexNow: 32 live sitemap URLs submitted 2026-10-26T06:56Z, `200 OK`; Bing IndexNow ping `200`.
- Live server HTML, `llms.txt`, robots (all AI crawlers allowed, `200` for GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Claude-SearchBot) and Product/Offer/FAQ structured data were already in place; no change needed.

## Gaps and owner actions

- Bing Webmaster Tools needs the owner's sign-in: verify trybiomod.com (`public/BingSiteAuth.xml` is live), submit the sitemap, URL-submit the product pages, and run Site Move from biomodpeptides.com. Its AI Performance report then shows citations.
- Old-domain redirects still take 2–3 hops (Cloudflare rule on biomodpeptides.com, owner dashboard).
- 35 product records remain held from search; AI engines cannot cite pages they cannot index. Releasing holds is an owner decision per record.
- Earned mentions (Reddit threads, review/COA libraries) are what assistants cite most; drafts in `backlink-corrections-v1.md` remain unsent pending owner approval.
- Historical days are not reclassified; AI counts start from this deploy.
