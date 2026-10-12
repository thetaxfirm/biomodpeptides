# EasyPost inside TryBiomod Admin v1

Author: Codex. October 11, 2026 Pacific. Scope: TryBiomod only.

Owner request: explain EasyPost fully within Admin and let staff use shipping controls without opening the provider dashboard; distinguish an actual connection from saved configuration.

Changes: Orders now includes an embedded EasyPost guide explaining rates, labels, billing, team packing responsibility, carrier handoff, tracking states and account tasks not supported here. The connection check reports timestamped API acceptance separately from webhook configuration/registration; a webhook lookup failure no longer falsely marks authenticated API access disconnected. Unknown, unconfigured and failed states remain explicit. No API keys, provider account identifiers or customer details are returned in diagnostics. Production mode, funding and successful webhook delivery are not inferred from API authentication.

Existing order controls remain available. Show label previews an HTTPS label image in Admin, hides it on request and explains unsupported formats. Print label opens the existing original file; it does not buy postage. Tracking controls show whether a carrier refresh time was recorded. The panel explicitly warns not to retry an uncertain postage purchase until the existing provider shipment is reconciled. This change does not implement pickup booking, account funding, refunds, editable parcel dimensions or recovery from uncertain label purchase outcomes.

Affected files: components/store/fulfillment-admin.tsx, components/store/shipping-admin.tsx, components/store/shipping-help.module.css, lib/easypost.ts and the focused regression/release-check files. Affected URLs: /admin?tab=orders and /api/admin/shipping. No schema, catalog, runtime binding or order-data change.

Verification: required build passed TypeScript and 34 isolated suites; actual built-Worker shipping tests passed with isolated D1 and mocked providers. New tests cover connection/unknown webhook states, duplicate-click prevention, failure recovery, guide copy and label preview/hide/error without provider writes. Actual React components were clicked in a local synthetic preview; desktop and 390px iframe layouts inspected. This preview is not evidence of a production carrier connection. Production Admin remains sign-in protected, with authenticated live API verification pending owner sign-in.

Public provider references used for behavior: https://docs.easypost.com/docs/shipments and https://docs.easypost.com/docs/trackers . Carrier tracking and postage do not establish physical packing or pickup.

Deployment commit/version and post-deploy checks are recorded in the private generated release evidence. No real label, payment or email was created by verification. Existing collaborator drafts and undeployed visitor work remain untouched in their original checkout.
