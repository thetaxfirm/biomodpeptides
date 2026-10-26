# AI traffic report disclosure, October 26, 2026 v1

The newly merged collector groups recognized AI utm_source tags as AI even without a referrer, and now covers published news pages. The admin report still described every bucket as a known referring hostname and labeled the bucket AI site. This could overstate the evidence behind an owner-facing growth report.

The report now labels the bucket **AI referrer or tag**, calls the breakdown Source categories, and explains that tags are client-provided, do not prove a citation/acquisition, and affect new events only. Historical buckets were not reclassified. Collector behavior, event schema, privacy exclusions, runtime flags and stored counts are unchanged. Counts remain events rather than unique visitors.

The existing isolated traffic-dashboard suite and full release gate/build verify the report still renders complete periods, partial-day and unavailable states. Signed-in production rendering remains a separate verification gap; no counts, customer data or settings were mutated. Exact source/deployment verification is recorded in the dated sprint receipt.
