# Isolated admin browser regression

`tests/admin-browser-v1.mjs` drives real Chrome against the built Worker using an isolated Miniflare database. It migrates a temporary D1 database, creates synthetic customers, orders, requests and authentication, and removes the database when finished. Every outbound request is denied except the mocked authentication GET. The browser intercepts the production-origin URLs and serves them locally; it never visits the live storefront or uses an existing browser profile.

First run the normal gated production build in the checkout to verify. Install Playwright outside the repository if it is not already available, then provide its module and Chrome executable:

```sh
BIOMOD_DEPLOY=true npm run build
BIOMOD_BROWSER_ROOT=/absolute/path/to/built-checkout \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
BIOMOD_BROWSER_SCREENSHOTS=/absolute/path/to/synthetic-evidence \
node tests/admin-browser-v1.mjs
```

The checkout path can also be the first argument. Without `PLAYWRIGHT_MODULE`, the script resolves an installed `playwright` package. Screenshots and `browser-report.json` default to the AI Workspace temporary directory printed by the script. The report records the tested Worker entry fingerprint, scenario results, browser errors and warnings, failed API responses, and blocked external requests. Any of those failures produces a nonzero exit code.

Coverage includes every desktop admin section; shipping/alert draft boundaries and shipping reload; product links and Today filters; real checkout price preview; campaign lifecycle; reward adjustments; manual, built-in and business promo controls; request conversations; preorder estimate ownership with immutable purchase terms; public product/cart/closed-checkout rendering; expanded forms at 390px; night mode and keyboard focus. Provider purchases, messages, live records and production authentication are outside this test.

For a focused diagnosis, `BIOMOD_BROWSER_CASE='shipping|preorder'` runs matching scenario names. Run the complete suite again before reporting browser QA complete. This suite requires built artifacts and external browser tooling, so it is an explicit post-build check rather than a prerequisite of the source release gate.
