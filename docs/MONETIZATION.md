# Monetization

## Affiliates

The same approval gate covers Japanese consumer programs and international SaaS programs. Keep the official URL available and affiliate URL null during application. Collect evidence of actual approval and verify channel, territory, restrictions, commission, threshold and disclosure terms. Store approval evidence in a private owner-controlled location. The repository should contain only an opaque review ID, the exact approved public affiliate link, approved official destination, channel `reward-radar-website`, review booleans and expiry timestamp in `affiliate_review`. Set `affiliate_approval_status` to `approved` and run all tests. Paid links are labeled in each language and carry `rel="sponsored nofollow noopener noreferrer"`. Revoke promptly if terms, URLs or rights change.

## AdSense

The inert `adsense-slot` template on details is the insertion point. It loads no ad code. The static templates, CSP, privacy policy and disclosures currently reflect that state. Upon approval of both the account and site, verify site eligibility and publisher ID in AdSense. Add only the issued `ads.txt` and approved script. Review the documented provider-specific CSP and use an appropriate consent flow before any tracking scripts can run. Keep first-party filtering independent of ad consent. If a paid domain or billing is required, leave ads disabled.

## Measurement and net receipts

Copy `data/revenue-example.json` into `var/` and keep the completed ledger private. Run `python3 -m radar.revenue var/revenue-YYYY-MM.json`. Keep unmeasured views or clicks null. Visits and outbound clicks currently have no instrumentation. Before adding measurement, verify privacy settings and document any consent requirement. Prefer aggregated, low-retention data. Affiliate clicks and conversions are separate fields. Use partner dashboards for verified conversions and reconcile actual bank or payment-provider receipts. Enter gross receipts before fees, platform fees and direct costs separately, avoiding a double deduction if a provider reports only net payouts. Use documented settlement FX or actual JPY receipt for foreign payouts. Report net revenue before personal income tax.

Editorial comparisons can be published before program approval. Prioritize comparisons that answer an audience question using official material, then apply only to programs that explicitly allow the site and its audience. Use reconciled receipts to track the JPY 5,000, 8,000 and 15,000 milestones. Do not infer revenue from traffic or commission rates.

- [Google AdSense site approval help](https://support.google.com/adsense/answer/12169212?hl=en)
- Support [rewardradar.support@gmail.com](mailto:rewardradar.support@gmail.com)

Keep the affiliate page separate from the giveaway directory. The operator may start by documenting relevant consumer comparisons, applying to an eligible program, and measuring confirmed receipts against the monthly goal.
