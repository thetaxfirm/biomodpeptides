# Softgel and spray preorder release, October 12, 2026

Owner direction: all currently listed softgels and nasal/spray products are preorder, 15% off, expected to mail early November, with limited initial runs. Scope: TryBiomod only.

## Behavior

- The 18 existing products (4357, 852, 781, 780, 779, 778, 777, 776, 775, 774, 773, 772, 771, 770, 769, 768, 767, 782) receive an automatic 15% preorder price. This is a shared pricing rule, not a display-only reduction or a required promo code.
- The notice states: Limited initial run. Estimated dispatch: early November 2026. Timing may change. Full notices explain payment is collected at checkout and mixed orders ship together when all items are ready. Cart advises a separate order for sooner items.
- Current runtime base-price, pack-price, stock and publication overrides remain authoritative. Scheduled sales do not compound with the preorder offer. Existing pack and promo discounts still apply afterward. Order snapshots preserve the purchased terms and existing historical orders remain unchanged.
- Home/shop/search, product pages, alternate product suggestions, comparison, fixed packs, mixed packs, mini-cart, cart, checkout, saved customer/admin order views and eligible search schema share the preorder state. Public research-use and documentation qualifiers remain.
- Staff can disable or edit the offer in the product editor. A stale editor cannot omit preorder state and silently restore an old default. There is no automatic release on an invented November date.
- Preorders are excluded from ordinary abandoned-checkout recovery so that their saved terms are not repriced. Paid preorder records remain visible to fulfillment with their estimated timing; payment does not mean physically mailed.

## Verification before publication

- TypeScript, whitespace and 38 isolated release suites passed, followed by the gated production build.
- Pricing regression covers all 18 products, fixed/mixed packs, runtime overrides, disabled offers, stock/publication guards and all five existing promo codes with normalized case/spaces.
- Independent review passed pricing, order snapshots, receipts and built-Worker checkout recovery. A temporary isolated Worker test confirmed preorders create no ordinary recovery email/job while regular checkout recovery still works.
- Isolated compiled-Worker preview used current nonsecret catalog overrides, a temporary database and blocked external providers. LUMEN 3-pack: $483.30 regular pack, $410.81 preorder pack; lowercase biomod15 applied $61.62 further savings, final items total $349.19. No live purchase, payment, email or shipping label was created.
- Desktop visual checks covered softgel collection, LUMEN and APEX product offers, nasal catalog and cart. The browser viewport override did not take effect (reported width stayed 1280); mobile visual verification is not claimed.
- Intervening shared changes 0a343fe, 5f6cb71 and fa79b31 (author Ash Taha) add Bing verification and staff roles. These are preserved; the combined release must pass the complete gate again before publication.

## Release receipt

Exact merged commit, hosted checks/build, deployed version, live URLs and any remaining gaps are recorded in the dated private release receipt after publication. Provider inbox delivery, actual shipping and sales outcomes are not established by this release.
