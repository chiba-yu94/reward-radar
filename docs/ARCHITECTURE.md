# Architecture

1. The reviewed registry records the exact official source and approved destination per listing. Editorial bilingual facts and structured values live in `data/opportunities.json`.
2. An Ubuntu runner with read-only repository permission queries only reviewed official API endpoints. It produces an observation with a source ID, status, UTC time and approved revision. No source HTML, executable code or deployment credential enters this job.
3. A separate Ubuntu job checks out the same Git revision. It validates input, allowlists output, writes local SQLite, generates static assets and produces a deployment artifact. Only approved records from active sources reach the public dataset. The SQLite database is disposable for hosted jobs. The Git inputs retain expired records and their review history.
4. A production environment job uploads the validated artifact to Cloudflare Workers Static Assets. Wrangler is pinned in the npm lockfile. The config has no application Worker script, cron trigger, database or runtime binding.
5. Browsers receive HTML and one sanitized JSON file from the same origin. Initial content works without JavaScript. Search and filters work entirely in the browser. Client-side deadline checks cover cached pages and the interval between builds.

Production keeps serving the previous successful deploy when collection, validation or the build fails. Cloudflare deployment history and retained build artifacts give two recovery paths. The local SQLite transaction keeps past opportunity IDs when the reviewed dataset is rebuilt. Do not commit SQLite files or customer data.
