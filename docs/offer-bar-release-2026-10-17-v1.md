# Moving offer bar and featured menu items (October 17, 2026, v1)

Author: Claude agent for the owner. Owner request: make Softgels and Sprays stand out in the menu ("color blinking whatever"), and turn the shipping strip into a moving bar that leads with "save big with 10-pack", after reviewing what other sites show.

## What other stores show (reviewed October 17)

Of 12 homepages checked (research-compound stores such as Kylo, SwissChems, Paramount, NextChems, Core, Biotech, Ascension, Modern Aminos; DTC brands Momentous, Transparent Labs, Thorne), the most common bar messages were a free-shipping threshold ($99 to $200), a dispatch cutoff, testing claims, a membership offer, new-product notices and contact details. The strongest bars rotate two to four short messages, each with one concrete number. Weak patterns: purity claims with no proof behind them ("99% purity guaranteed"), repeating the brand name, contact-only bars, countdown urgency. Peptide Sciences, PureRawz and AG1 blocked automated reading.

## Change (commits 235f29c and the follow-up)

- `components/store/header.tsx`: the announcement strip is now a scrolling gold bar with four links: "Save N% with a 10-pack · Mix and match any vials" (/multi-pack?size=10; N is the live 10-pack discount, the same setting the homepage pack cards use, 20% today), "Free USPS Priority Mail on orders of $250 or more · U.S. orders" (only when a free-shipping threshold is set), "Order by 2 p.m. Pacific · In-stock weekday orders process the same business day" (the published cutoff), and "Check the lot · Batch records and lab reports in our library" (/testing). It pauses on hover and keyboard focus; the loop copy is hidden from screen readers and the keyboard; reduced-motion visitors see it still.
- Softgels and Sprays are copper and bold with a slow glint every few seconds, in the desktop menu and the phone menu; plum on hover; the glint stops for reduced motion.
- `app/storefront-v36.css` (new), `app/layout.tsx`, `tests/offer-bar-v1.cjs` (release gate).

## Verification

- `npm run check:release`: TypeScript and 95 suites passed; production build passed. Workers Builds success 22:23:21 UTC.
- Local dev preview checked at desktop and phone widths, including the phone menu. Live: the bar shows all four lines after the store settings load (the server-rendered HTML shows three; the shipping line joins on load), and Softgels and Sprays show in copper.

## Suggestions for the owner (not built)

- A "You're $X away from free Priority Mail" line in the cart (Transparent Labs pattern).
- If the "Become a member" program has a concrete benefit, add it to the bar.
- New-product launches as a temporary fifth line when one is released.
