# Sources

`data/sources.json` records provider, official evidence, exact approved destination, country scope, language, permission basis, method, cadence and review date. Last successful run and errors are recorded by Actions artifacts and in the local SQLite source observation. Registry values for last automatic run are initially null.

## Add or revise a source

1. Read the provider's official eligibility, dates, spending, method, and payout rules. Check the participation page and any redirect destinations. Record the official links and the actual review date.
2. Choose `manual` and `editorial-summary` for independently written facts with links. Keep the provider's copy, HTML, images, branding assets and program directory out of publication. A manual source is never fetched by the scheduled collector.
3. Before adding automation, document the official API or feed, applicable terms, access and reuse scope, robots directives when applicable, rate limit and exact endpoint. A permissive robots file does not authorize redistribution. The current adapter is deliberately limited to reviewed files in GitHub's official docs repository. Add an adapter with equivalent URL controls and fixtures to support a different provider.
4. Add the bilingual record. Use a country list only where explicit, null for unverified, and `worldwide_reviewed: true` in the source registry only where the official source explicitly permits worldwide participation. When a country list is partial, explain that in both translations. Keep amounts, currency, cost or times null if missing. For purchase-only programs with a variable price, use `kind: purchase` and null amount.
5. Review the changes and run `npm test`. Changed sources and destinations stay pending until the reviewed inputs are updated. For GitHub Contents, a new blob identifier requires review of the underlying file and any referenced conditions.

## Initial review and ongoing checks

The initial registry holds 15 live listings and one expired historical entry. The d POINT daily draw states its maximum advertised points and directs users to in-app terms. The Rakuten Ichiba draw has an explicit end notice and is excluded from active data. Prolific's residency list includes Japan. Microsoft Rewards lists more markets than the filter's verified subset. UserTesting's location eligibility depends on current recruitment. The source registry and details preserve those distinctions.

The only automated source is GitHub Education. The unauthenticated public REST Contents endpoint publishes a blob identifier. The collector checks the identifier and discards the response without republishing text. An unchanged document does not establish current availability of every downstream benefit. Review other sources manually at least every 30 days, and more often for dated promotions.

- [GitHub REST Contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content)
- [GitHub Docs repository license](https://github.com/github/docs/blob/main/LICENSE)
- [Prolific participant eligibility](https://participant-help.prolific.com/en/articles/445007-who-can-participate-in-studies-on-prolific)
- [Official d POINT draw details](https://dpoint.docomo.ne.jp/content/daily_kuji/index.html)
