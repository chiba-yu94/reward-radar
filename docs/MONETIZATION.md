# Monetization and analytics

## GA4 activation

Production builds are off by default. A missing `GA4_MEASUREMENT_ID` or an unset `GA4_PRIVACY_READY` omits the analytics script and consent UI and keeps the original same-origin CSP. The measurement ID is public configuration, separate from any credential.

1. Create a dedicated GA4 web stream for `https://freebietrail.com/` and copy its `G-…` measurement ID.
2. In Admin → Data streams → the stream, turn **Enhanced measurement off**. Freebie Trail sends its own page views and application clicks. Automatic collection could duplicate events and collect raw URLs. Keep Google signals, advertising personalization, user-provided data and other tag destinations disabled. Enable the stream's email redaction. Set retention to the minimum available for the intended reports.
3. Set GitHub repository variables `GA4_MEASUREMENT_ID` and `GA4_PRIVACY_READY=true` only after completing step 2. Run `gh workflow run publish.yml --ref main`. Verify both languages with a fresh browser profile: Reject should cause zero Google analytics requests, Accept should create one page view, and a click on an official application link should create one event. Check GA4 Realtime/DebugView using test traffic and the browser network panel before relying on reports. Do not add a second GA or Tag Manager snippet.
4. To disable collection for everyone, unset `GA4_PRIVACY_READY` or remove `GA4_MEASUREMENT_ID` and rebuild. Individual visitors can withdraw through Analytics settings in the footer or privacy page.

Analytics runs on Japanese and English pages after consent, including arrivals with campaign or directory-filter query strings. The language picker, error pages and unrecognized fragments are excluded. The site sends its clean canonical path, locale, listing ID where applicable and a broad referrer category. It leaves the address bar and filters intact. Raw referrers, URL queries (including UTM values), entered search terms, outbound URLs, names and emails are excluded from the site's analytics payload. GA4 cookie identifiers and device/connection information are handled by Google after consent. The CSP opens only Google Tag's `/gtag/` script path and the analytics transport endpoints on configured builds. Ad consent values remain denied. [Google privacy information](https://policies.google.com/technologies/partner-sites) · [GA4 PII guidance](https://support.google.com/analytics/answer/6366371?hl=en) · [Page views](https://developers.google.com/analytics/devguides/collection/ga4/views?technology=websites) · [CSP guidance](https://developers.google.com/tag-platform/security/guides/csp)

For Tag Assistant, start with a localized page such as `https://freebietrail.com/en/`, then allow analytics on the site. If the debug window cannot connect, check the collect requests and GA4 Realtime separately. [Google troubleshooting](https://support.google.com/tagmanager/answer/10039345?hl=en)

When changing tag startup, verify the first real collect request for a visit from an external referrer. The sanitized page location and referrer and the automatic page-view setting must be set before Google tag initialization. The test stub checks command order but cannot detect changes in Google's live tag.

## GA4 reports

### Register custom dimensions

1. Sign in to the Freebie Trail GA4 property with Editor or Administrator access.
2. Go to **Admin → Data display → Custom definitions → Custom dimensions**. Check the existing definitions for the event parameter names below before creating any.
3. For each missing parameter, choose **Create custom dimension**, enter the display name and exact event parameter below, set **Scope** to **Event**, and save.

| Display name | Event parameter |
| --- | --- |
| Site language | `site_language` |
| Traffic group | `traffic_group` |
| Page group | `page_group` |
| Opportunity ID | `opportunity_id` |

4. Once data has arrived, allow 24–48 hours for reporting. In **Explore → Free form**, import the custom dimensions and **Event name**. Add **Event count**, put the dimensions in Rows, and filter by the relevant event name. Use **Total users** for language comparisons. The definitions are created in GA4 by the property operator. [Google Analytics instructions](https://support.google.com/analytics/answer/14239696)

### Report examples

| Report | Event | Grouping or filter |
| --- | --- | --- |
| Page views | `page_view` | Page path |
| Traffic sources | `page_view` | `traffic_group` (search, social, other referral, internal, direct/unknown) |
| Japanese and English traffic | `page_view` | `site_language` (`ja` or `en`), the page language |
| Popular giveaways | `page_view` | `page_group=sweepstakes`, grouped by `opportunity_id` |
| Official application links | `application_click` | `opportunity_id`, `site_language` |
| Approved affiliate links | `affiliate_click` | `opportunity_id`, `site_language` |

Traffic groups are based on the browser's available referrer information. The existing `page_referrer` value points to the site's own origin and `ignore_referrer` stays enabled because Google uses that field to calculate traffic sources. Visits with UTM values count as visits under the clean page path. Use Search Console for Google organic clicks and impressions, and `traffic_group` for broad referral categories among consenting visitors. A visitor who uses both site languages may be counted in both language groups. Official application links open a new tab so the listing stays loaded while GA4 dispatches the click. Clicks are directional measurements and may be lost to browser restrictions. Partner dashboards supply verified conversions. [Google tag configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config#page_referrer)

## Affiliate approval and private ledger

Impact website ownership can be verified with the static homepage meta tag generated from the public `IMPACT_VERIFICATION_ID` repository variable.

The same approval gate covers Japanese and international partners. Preserve `official_url` and keep `affiliate_url` null during application. Before enabling a link, verify approval, the permitted website and audience territory, the official destination, program restrictions, commission and disclosure rules. Store the approval evidence privately. In the repository record only the opaque review ID, exact approved public affiliate URL and official destination, channel `reward-radar-website`, review flags and expiry in `affiliate_review`. Set `affiliate_approval_status=approved` after review. An approved link appears separately from the organizer URL, with a Japanese or English commission disclosure and `rel="sponsored nofollow noopener noreferrer"`. Expired and revoked approvals are suppressed. Revoke or review approvals if terms or destinations change.

Copy `data/revenue-example.json` to the Git-ignored `var/` directory or another private owner-controlled location. Run `python3 -m radar.revenue var/revenue-YYYY-MM.json`. Leave unmeasured figures null. Record page views, official-link clicks, affiliate clicks, verified conversions, actual receipts, fees and direct costs separately. Reconcile foreign receipts at the documented settlement rate or actual JPY received, and avoid deducting a fee twice. Track progress toward ¥5,000 per month in net receipts before personal income tax.

## AdSense readiness

The canonical site for review is https://freebietrail.com/. The former workers.dev address was rejected during signup. The verification-only publisher ID is a GitHub repository variable, and builds include its meta tag only on the canonical origin. No ad tag is loaded.

If AdSense accepts the exact site, use a verification option it provides, such as the issued meta tag or `ads.txt`, and wait for the site to be marked Ready. The inert `adsense-slot` and lack of ad scripts are intentional. The analytics consent UI is separate from ad consent and is not a Google-certified CMP. Before serving ads, review cookie and personalized-ad consent and vendor disclosures. For personalized ads to users in the EEA, UK and Switzerland, use a Google-certified CMP that integrates with IAB TCF, such as Google's own Privacy & messaging where suitable. Verify regional and ad-mode rules, withdrawal controls, and CSP before enabling ad tags. Keep ads off if eligibility or compliant operation cannot be confirmed at zero cost. [AdSense verification](https://support.google.com/adsense/answer/12169212?hl=en) · [Publisher CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en) · [Privacy & messaging](https://support.google.com/adsense/answer/7670013?hl=en)

Support [support@freebietrail.com](mailto:support@freebietrail.com)

## Hapitas placement

The separate bilingual home-page placement remains disabled unless the owner supplies the official account-issued referral URL as `HAPITAS_REFERRAL_URL` and the exact URL and website use have been reviewed before setting `HAPITAS_REFERRAL_APPROVED=true`. It is labeled as advertising. The November 2026 placement expires at midnight JST after November 30 and is removed from future builds. Open pages also hide the placement when the cutoff passes. Review the next official campaign before changing the copy or dates. [November terms](https://sp.hapitas.jp/special/referral202611?apn=search_keyword) · [Official program help](https://faq.hapitas.jp/hc/ja/articles/360035931734)


The placement is separate from the giveaway listings. Its consent-gated `affiliate_click` carries `opportunity_id=hapitas-referral`, `page_group=affiliate-placement`, and the page language. It does not send the referral URL or code to GA4. Check referral credits separately in Hapitas. For the November referrer campaign, the account holder must also enter the campaign in Hapitas by the campaign deadline. [Official program](https://hapitas.jp/referral)

## Freecash website placement

Freecash appears in the consumer Rewards directory, homepage rewards preview and general search, labeled Sponsored / 広告・PR. Publisher affiliate programs remain on `/affiliates/`. The compact neutral Freecash card leads with game milestones and surveys, then states spending, age/contract, identity-check and country restrictions. Its single primary CTA opens the existing approved Impact link, with a short commission disclosure directly below and a secondary detail link for eligibility and cashout rules. Card clicks retain opportunity_id=freecash and page_group=affiliate after analytics consent. The detail page keeps the full market list, payout requirements, verification date and secondary non-affiliate official link. The published `affiliate` data category is retained for compatibility; the UI calls this task rewards, not SaaS affiliate. No new ad scripts are loaded. The organizer URL remains separate from the Impact link. The placement lists the markets covered by the advertisement. Service eligibility and redemption details come from Freecash's public terms. [Freecash terms](https://freecash.com/en/policies/terms) · [Advertising guidelines](https://freecash.com/en/policies/partner-advertiser-policy)

Store contract and review evidence privately. Recheck the active terms, market list, link destination, and copy before the internal expiry recorded in `affiliate_review`. If Impact changes or cancels the agreement, update the review or set `affiliate_approval_status=revoked` and `affiliate_url=null`, then run the existing publish workflow. A missing, revoked, or expired review suppresses the sponsored service at build time. Open pages suppress its links at expiry.
