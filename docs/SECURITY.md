# Security

The collector requires HTTPS and exact reviewed endpoints, resolves every address, rejects prohibited addresses, and pins the socket to a checked IP while retaining TLS hostname verification. All redirects fail closed. Responses have a size cap and socket timeout. No proxy, content execution, login, automated application or replay is used. The adapter accepts only the reviewed GitHub Contents origin and repository path.

Publication checks country verification, finite amounts, timestamps, closed enumerations, translations, stable slugs, duplicate IDs and URLs, and independently recorded destination approval. It sends only a narrow JSON projection to the public site. The static renderer escapes text and attributes. Client filtering uses existing DOM elements and does not render HTML from JSON. CSP permits same-origin CSS, scripts, images and JSON only. Apply-related links point directly to the reviewed provider and use no referrer. External provider redirects after a visitor clicks remain under the provider's control.

Use GitHub-hosted Ubuntu runners. Keep deploy credentials in the production environment, limited to the intended Cloudflare account. Only the deploy step receives the token. Protect `main` and the environment if multiple contributors get write access. Review changes to workflows, dependencies and destination approvals. Pin third-party actions by commit and use the lockfile with install scripts disabled. Rotate scoped credentials on compromise.

To disable a compromised source, set its `active` field to false, inspect related rows and verify the output without them. Run tests and deploy immediately from the reviewed commit. If the pipeline is blocked, use the validated local build and a scoped deployment credential. Consider suspending the public Worker at the dashboard if the dataset is unsafe to serve and a replacement is unavailable. Re-enable only after revalidating source terms and destinations.

Report suspected security issues to [rewardradar.support@gmail.com](mailto:rewardradar.support@gmail.com). Keep credentials and identity documents out of reports.
