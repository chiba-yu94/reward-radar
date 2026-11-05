# Monetization and analytics

## GA4 activation

Production builds are off by default. A missing `GA4_MEASUREMENT_ID` or an unset `GA4_PRIVACY_READY` omits the analytics script and consent UI and keeps the original same-origin CSP. The measurement ID is public configuration, separate from any credential.

1. Create a dedicated GA4 web stream for `https://reward-radar.rewardradar42.workers.dev/` and copy its `G-…` measurement ID.
2. In Admin → Data streams → the stream, turn **Enhanced measurement off**. Reward Radar sends its own page views and application clicks. Automatic collection could duplicate events and collect raw URLs. Keep Google signals, advertising personalization, user-provided data and other tag destinations disabled. Enable the stream's email redaction. Set retention to the minimum available for the intended reports.
3. Set GitHub repository variables `GA4_MEASUREMENT_ID` and `GA4_PRIVACY_READY=true` only after completing step 2. Run `gh workflow run publish.yml --ref main`. Verify both languages with a fresh browser profile: Reject should cause zero Google analytics requests, Accept should create one page view, and a click on an official application link should create one event. Check GA4 Realtime/DebugView using test traffic and the browser network panel before relying on reports. Do not add a second GA or Tag Manager snippet.
4. To disable collection for everyone, unset `GA4_PRIVACY_READY` or remove `GA4_MEASUREMENT_ID` and rebuild. Individual visitors can withdraw through Analytics settings in the footer or privacy page.

Analytics is limited to canonical Japanese and English pages. The language picker, error pages and URLs carrying a query string or arbitrary fragment are excluded. The site sends its canonical route, locale, listing ID where applicable and a broad referrer category. Raw referrers, URL queries, entered search terms, outbound URLs, names and emails are excluded. GA4 cookie identifiers and device/connection information are handled by Google after consent. The CSP opens only Google Tag's `/gtag/` script path and the analytics transport endpoints on configured builds. Ad consent values remain denied. [Google privacy information](https://policies.google.com/technologies/partner-sites) · [GA4 PII guidance](https://support.google.com/analytics/answer/6366371?hl=en) · [Page views](https://developers.google.com/analytics/devguides/collection/ga4/views?technology=websites) · [CSP guidance](https://developers.google.com/tag-platform/security/guides/csp)

## GA4 reports

Register `site_language`, `traffic_group`, `page_group`, and `opportunity_id` as event-scoped custom dimensions before collecting production data. In Explore, use Event count with these dimensions and filters.

| Report | Event | Grouping or filter |
| --- | --- | --- |
| Page views | `page_view` | Page path |
| Traffic sources | `page_view` | `traffic_group` (search, social, other referral, internal, direct/unknown) |
| Japanese and English traffic | `page_view` | `site_language` (`ja` or `en`), the page language |
| Popular giveaways | `page_view` | `page_group=sweepstakes`, grouped by `opportunity_id` |
| Official application links | `application_click` | `opportunity_id`, `site_language` |
| Approved affiliate links | `affiliate_click` | `opportunity_id`, `site_language` |

Traffic groups are based on the browser's available referrer information and are distinct from GA4's campaign or session acquisition reports. Counts represent activity by consenting visitors on eligible pages. Clicks are directional measurements and may be lost to browser restrictions. Partner dashboards supply verified conversions.

## Affiliate approval and private ledger

The same approval gate covers Japanese and international partners. Preserve `official_url` and keep `affiliate_url` null during application. Before enabling a link, verify approval, the permitted website and audience territory, the official destination, program restrictions, commission and disclosure rules. Store the approval evidence privately. In the repository record only the opaque review ID, exact approved public affiliate URL and official destination, channel `reward-radar-website`, review flags and expiry in `affiliate_review`. Set `affiliate_approval_status=approved` after review. An approved link appears separately from the organizer URL, with a Japanese or English commission disclosure and `rel="sponsored nofollow noopener noreferrer"`. Expired and revoked approvals are suppressed. Revoke or review approvals if terms or destinations change.

Copy `data/revenue-example.json` to the Git-ignored `var/` directory or another private owner-controlled location. Run `python3 -m radar.revenue var/revenue-YYYY-MM.json`. Leave unmeasured figures null. Record page views, official-link clicks, affiliate clicks, verified conversions, actual receipts, fees and direct costs separately. Reconcile foreign receipts at the documented settlement rate or actual JPY received, and avoid deducting a fee twice. Track progress toward ¥5,000 per month in net receipts before personal income tax.

## AdSense readiness

Google's Sites rules allow registrable domains, sites on Public Suffix List platforms and certain managed host-partner sites. The current PSL lists `workers.dev`, with no `*.workers.dev` entry. The registrable domain under that rule is `rewardradar42.workers.dev`. Reward Radar's live `reward-radar.rewardradar42.workers.dev` is one label below it. The published rules suggest the exact live hostname may be rejected or reduced to the account-level domain. Cloudflare documents Worker addresses at the two-label hostname used by this site. Acceptance can only be confirmed in the owner's AdSense Sites screen. If the screen rejects or rewrites the address to a host that cannot be verified, leave the integration off. No domain purchase is planned. [AdSense site rules](https://support.google.com/adsense/answer/12170421?hl=en) · [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) · [Cloudflare hostname format](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

If AdSense accepts the exact site, use a verification option it provides, such as the issued meta tag or `ads.txt`, and wait for the site to be marked Ready. The inert `adsense-slot` and lack of ad scripts are intentional. The analytics consent UI is separate from ad consent and is not a Google-certified CMP. Before serving ads, review cookie and personalized-ad consent and vendor disclosures. For personalized ads to users in the EEA, UK and Switzerland, use a Google-certified CMP that integrates with IAB TCF, such as Google's own Privacy & messaging where suitable. Verify regional and ad-mode rules, withdrawal controls, and CSP before enabling ad tags. Keep ads off if eligibility or compliant operation cannot be confirmed at zero cost. [AdSense verification](https://support.google.com/adsense/answer/12169212?hl=en) · [Publisher CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en) · [Privacy & messaging](https://support.google.com/adsense/answer/7670013?hl=en)

Support [rewardradar.support@gmail.com](mailto:rewardradar.support@gmail.com)
