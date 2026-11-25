# Sources

`data/sources.json` records provider, official evidence, exact approved destination, country scope, language, permission basis, method, cadence and review date. Last successful run and errors are recorded by Actions artifacts and in the local SQLite source observation. Registry values for last automatic run are initially null.

## Add or revise a source

1. Read the provider's official eligibility, dates, spending, method, and payout rules. Check the participation page and any redirect destinations. Record the official links and the actual review date.
2. Choose `manual` and `editorial-summary` for independently written facts with links. Keep the provider's copy, HTML, images, branding assets and program directory out of publication. A manual source is never fetched by the scheduled collector.
3. Before adding automation, document the official API or feed, applicable terms, access and reuse scope, robots directives when applicable, rate limit and exact endpoint. A permissive robots file does not authorize redistribution. The current adapter is deliberately limited to reviewed files in GitHub's official docs repository. Add an adapter with equivalent URL controls and fixtures to support a different provider.
4. Add the bilingual record. Use a country list only where explicit, null for unverified, and `worldwide_reviewed: true` in the source registry only where the official source explicitly permits worldwide participation. When a country list is partial, explain that in both translations. Keep amounts, currency, cost or times null if missing. For purchase-only programs with a variable price, use `kind: purchase` and null amount.
5. Review the changes and run `npm test`. Changed sources and destinations stay pending until the reviewed inputs are updated. For GitHub Contents, a new blob identifier requires review of the underlying file and any referenced conditions.

## Discovery and review

`data/discovery-sources.json` lists the Saitama Prefecture press and highlights RSS feeds. The prefecture explicitly offers these feeds for automated reading. The reviewed endpoints serve RSS 1.0, and the published robots file did not disallow them for the collector. The collector fetches each exact endpoint once per run. It matches giveaway terms in headlines and retains only deduplicated first-party article URLs and feed IDs. It neither follows candidate URLs nor republishes headlines or summaries. The Asahi Group RSS terms explicitly prohibit reuse beyond private use, so that feed is excluded.

Run `python3 -m radar.discovery` or download the `discovery-candidates` artifact. For each candidate, verify the organizer, original rules, all redirects, geographic and age restrictions, free participation and prize claim, personal information at both stages, translations and expiry. Only then add the exact source and destination to the reviewed registry. Dated campaign deadlines are converted from the provider's time zone. If a Japanese source only states a date, display the date without a time and stop listing it after that date in Japan.

Free sweepstakes need documented organizer, cost and privacy checks. Cash, gift-card, electronics and other exceptional prizes additionally require explicit country eligibility and known data requirements for entry and claim. Check fees, impersonation indicators, official claim channel and prize details before setting the enhanced review flag. A shipping-only restriction never supplies missing evidence about residence.

## November 5 expansion

Eight manual campaigns came from official organizer pages. The registry has 23 manual records, of which 20 appear in the revised release. It retains the ended Rakuten app draw, the purchase-required Rebates listing, and the d POINT draw whose entry cost was unconfirmed. The professional GitHub student benefit remains in operational history and is monitored by one official API endpoint; it is excluded from public results. The two RSS endpoints are separate discovery inputs. Their first checked run yielded no candidates.

## Quest board and application guides

Use `data/editorial.json` for quest reviews and site-hosted articles. The existing discovery job writes URLs for review to `var/candidates.json`. Editors can use those URLs or other official public pages to start a quest review. The publisher emits quests from the reviewed registry and has no path from the RSS output to public listings. The Yamanashi candidate uses manual review of the official site and rules.

- Record an unresolved quest with `status: candidate`, its official source and the gaps in the review. Before switching to `approved`, check that the official rules establish current acceptance, eligibility from Japan, no up-front payment or deposit, and how the reward is paid. When the site owner explicitly approves a listing whose official rules omit residency, record `review.japan_eligible: "not-stated"`. The board and detail page label residency eligibility as unconfirmed. Report any prize redemption territory separately. Record the review date, the official listing and evidence URLs, the closing timestamp, and the task, eligibility, reward conditions and payment method in each available language. Use `completion` for completion fees, `selection` for accepted work and `prize` for competition winners. For a date-only cutoff, follow the opportunity convention of recording the last second of the final local date and setting `deadline_date_only` to true.
- Change a quest to `closed` when the organizer closes it early. The build excludes candidates, closed quests, expired deadlines and reviews that are 30 days old. An already-open browser page uses the same deadline and review-date rules to hide expired quest actions.
- Use `status: draft` for unpublished articles. Review sources and text before setting `approved`. Give each actual translation its own entry under `copy`. Check original records before publishing an application account and omit personal information. The initial article uses Yamanashi’s published rules as a worked example.

- [Saitama Prefecture RSS instructions](https://www.pref.saitama.lg.jp/kense/koho/homepage/rss.html)
- [Asahi Group RSS terms](https://www.asahigroup-holdings.com/newsroom/rss.html)
- [GitHub REST Contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content)

## Application effort

Record `application` only after checking official organizer rules. Its source URL must be the approved primary or supporting source. Record the review timestamp, whether entry is web-only, whether an SNS account or free organizer membership is required, supported platforms, and the actions on the shortest verified path. Use null for unresolved flags. The publication pipeline calculates the action count and difficulty from these facts. It prioritizes free, SNS-free web entry, then confirmed SNS-free routes and low-effort social routes. Writing a new or quote post and linking accounts count as more involved. Feed discoveries begin with unknown values and remain in the review queue until the organizer evidence is checked.
