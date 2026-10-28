# Parcel reminder counts physical handoff as progress: October 28, 2026

Operator Codex. Scope: trybiomod.com. Reviewed the merged October 27 four-day digest and unscanned-label queue changes without replacing them.

A label created six days ago, with a five-day-old pre-transit carrier event, could be marked dropped off two hours ago and still enter the four-day digest. The digest used the first available timestamp and omitted the handoff. An isolated regression reproduced the old timestamp before this repair. No customer record or provider operation was used.

`lastMovedAt` now selects the latest valid recorded carrier event, handoff, label purchase or payment timestamp, falling back to order creation only when none exists. A later carrier event still wins. Malformed handoff input cannot erase the fallback. The existing four-day threshold, immediate carrier-problem branch, recipients, daily schedule and dismissal policy remain intact.

This changes eligibility for the scheduled reminder, not its delivery mechanism. No reminder was manually run or sent. The separate 24-hour post-handoff queue warning, To ship / Needs review split, payment verification, original documents, purchase snapshots and all storefront price/stock settings are untouched.

Validation is recorded in the dated sprint scorecard and receipt: failed-before/passed-after shipping regression, full release gate and production build, isolated compiled-Worker checks, exact source/build/deployment mapping and read-only live checks. A deployed scheduler is not proof of an email or Telegram delivery.
