# Architecture

1. The reviewed registry records the exact official source and approved destination per listing. Editorial bilingual facts and structured values live in `data/opportunities.json`.
2. An Ubuntu runner with read-only repository permission queries only reviewed official API endpoints. It produces an observation with a source ID, status, UTC time and approved revision. No source HTML, executable code or deployment credential enters this job.
3. A separate Ubuntu job checks out the same Git revision. It validates input, allowlists output, writes local SQLite, generates static assets and produces a deployment artifact. Only approved records from active sources reach the public dataset. The SQLite database is disposable for hosted jobs. The Git inputs retain expired records and their review history.
4. A production environment job uploads the validated artifact to Cloudflare Workers Static Assets. Wrangler is pinned in the npm lockfile. A small Worker handles canonical-host, HTTPS and trailing-slash redirects and query-page robot headers. There is no cron trigger, database or paid runtime binding.
5. A separate discovery job subscribes to reviewed public feeds and writes URL-only review candidates to a seven-day GitHub artifact. It has no publication or deployment dependency. Human-reviewed entries are committed to the source registry and listing file.
6. Browsers receive HTML and one sanitized JSON file from the same origin. Initial content works without JavaScript. Search and filters work entirely in the browser. Client-side deadline checks cover cached pages and the interval between builds.

Production keeps serving the previous successful deploy when collection, validation or the build fails. Cloudflare deployment history and retained build artifacts give two recovery paths. The local SQLite transaction keeps past opportunity IDs when the reviewed dataset is rebuilt. Do not commit SQLite files or customer data.

## Publication quality gate

`python3 -m radar.qa` reuses the actual input validator and publisher in temporary storage. Invalid schema, timestamps, country codes, duplicates, scoped affiliate approvals and the three known category regressions fail the gate. `--dataset var/published.json` also compares published values to reviewed inputs. Missing geographic evidence, unknown deadlines, stale checks and unclassified prizes are review warnings, allowing existing unknowns to migrate without stopping all updates. Reports go to `var/quality-report.json`, Markdown and Actions summaries/artifacts.

`shipping_countries`, `service_countries` and `promotion_countries` are independent of `eligible_countries`. Null means unverified. No inference from shipping to residence is allowed. Additional geographic facts require a reviewed evidence URL. Reviewed advertising markets are stored separately from general service eligibility.

The optional `--check-links` mode sends at most 40 HEAD requests and two per host, without redirects or retries. Automatic probes require an already authorized API endpoint or explicit `link_check_allowed: true` after a permission review. Manual sources remain unfetched. Affiliate tracking links are syntax/scope checked but never visited automatically. 403/429/timeouts are inconclusive; 404/410 and redirects require review rather than automatic removal.

Public data is validated again before the builder touches `dist`. A failed pipeline update preserves the previous JSON and rolls back SQLite changes; CI never uploads a deployment artifact after a failed gate or build. The prior Cloudflare deployment remains live. Browser freshness derives from `last_checked_at` alone and uses the same code as the builder. Non-applicable warning text is absent from HTML text nodes.

Date-sensitive integration tests read `tests/fixtures/reviewed/` at a fixed UTC clock, independently of future editorial changes. Verify separately validates and renders the current production inputs before running those fixtures. Scheduled publication always republishes the actual reviewed inputs after tests and never deploys the fixture dataset. When adding regressions, update fixtures deliberately; do not advance a test clock to make a failure disappear.
