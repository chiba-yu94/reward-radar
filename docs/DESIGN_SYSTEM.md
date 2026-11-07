# Freebie Trail interface

The primary task is to compare eligibility, prize or reward conditions and deadlines, then visit the organizer. The layout is an editorial directory with compact factual text. It uses static HTML, CSS and small browser modules; no UI framework, web fonts or new production dependencies.

## Tokens and hierarchy

- Page `#ffffff`; secondary surface `#f6f7f9`; borders `#d9dee5`.
- Main text `#202733`; secondary text `#586170`.
- Interactive accent `#2456a6`; hover `#193e7b`; selected filter surface `#edf3fc`. Blue consistently denotes links, actions and keyboard focus.
- Advertising text `#77501c`, border `#d5c19f`, surface `#fcf9f3`. These colors identify advertising labels and detail-page disclosures. Consumer service cards use the same white surface and neutral border as other cards; sponsorship is identified by its textual badge and adjacent disclosure. Advertising actions retain the same blue interaction token and have a nearby disclosure.
- The existing green route mark is retained for brand recognition; green has no other decorative role.
- System sans-serif fonts; body 16px, secondary text approximately 13.4px. H1 scales from 25.6px to 40px; detail H1 from 24px to 36.8px.
- Spacing tokens: 4, 8, 16, 24, 32px. Default radius 8px. Metadata uses horizontal rules instead of separate cards.
- Buttons and standalone controls have a minimum 44px height. Focus uses a 3px blue outline and 3px offset. Selected quick filters have a checkmark and border as well as a color change.
- Expired entries are suppressed; stale-source notices appear only after the stored threshold. Advertising has a textual label, not color alone.

## Responsive behavior

At widths below 1024px, the header uses a native disclosure menu and a compact language link with a full accessible label. Escape closes the menu and returns focus. Closed menu content is explicitly hidden to avoid WebKit overflow. At desktop widths the links sit alongside the brand.

At narrow widths, detail metadata uses a label/value row with a flexible value column. The two secondary detail sections form columns only above 768px. Card grids adapt to the available width. English card labels are shortened to Location and Account.

Home has a direct GET search form, two common shortcuts and a link to international listings. Actual listings follow immediately. Search initializes in a disabled fieldset with reserved layout, then restores allowlisted URL parameters. The result count is a live status. The advanced filter panel has bounded scrolling and a return-to-results button. Arbitrary query pages have a canonical base URL and `X-Robots-Tag: noindex, follow`.

## Consent, advertising and verification

Analytics consent remains opt-in. Accept and Reject use equal visual weight; settings remain in the banner and footer. The banner uses one short explanation. Google tag loading and events remain disabled before consent, after rejection and after withdrawal. Search terms are excluded from analytics.

Freecash keeps its reviewed Impact URL, market list and approval expiry. Costs are explained as free registration with some paid tasks, never unconditional free earnings. Full advertised markets are in an accessible disclosure. Redemption minimums and fees are attributed to the official help article and are not promised globally.

CSP continues to prohibit inline scripts and unapproved trackers. Same-origin form submission is allowed for direct search. `Cache-Control: no-transform` prevents Cloudflare from injecting its unconsented beacon; this must be verified in production with a browser user agent.

## Validation

`npm test`, `npm run test:browser`, `npm run test:ux`, `npm run test:analytics` and `npm run test:seo` cover content, source safety, sponsor expiry, locale parity, responsive controls, URL restoration, search, consent and metadata. Verify with analytics disabled and with a test measurement ID. External destinations are intercepted in analytics tests.

Visual QA uses real Chrome screenshots at 375, 390, 768 and 1440px in both languages. WebKit is an additional engine check, not a physical iPhone test. axe checks and Lighthouse are lab evidence; they do not establish complete WCAG conformance or real-user Core Web Vitals. Respect reduced motion.
