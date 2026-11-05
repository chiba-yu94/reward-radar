# Localization

- Add UI copy in both branches of `site/locales.mjs`. Keep identical key structure. The build rejects missing or empty values.
- Add distinct `title_ja/en`, `description_ja/en`, `eligibility_ja/en` and both `reward_conditions` variants for each record. Keep translations factual and retain all known residence, age, consent, application, spending and redemption restrictions.
- A locale changes the interface, search text and formatting. It does not change the country filter or the underlying eligibility set.
- Store deadlines with the provider's original zone converted to UTC using its stated cutoff. Japanese pages show JST. English pages show UTC. Leave an unpublished deadline null. Use ISO currency codes and retain the provider's original amount.
- Add the same route key in both languages. The generator emits canonical URLs, reciprocal language links and sitemap alternatives. Run `npm test` and test both language links on the same detail path.
