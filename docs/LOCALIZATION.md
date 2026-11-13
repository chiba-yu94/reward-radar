# Localization

- Add UI copy in both branches of `site/locales.mjs`. Keep identical key structure. The build rejects missing or empty values.
- Add distinct `title_ja/en`, `description_ja/en`, `eligibility_ja/en` and both `reward_conditions` variants for each record. Keep translations factual and retain all known residence, age, consent, application, spending and redemption restrictions.
- A locale changes the interface, search text and formatting. It does not change the country filter or the underlying eligibility set.
- Store deadlines as UTC timestamps with seconds and retain the organizer's IANA `deadline_timezone`. Both translations display the same organizer-local deadline; verification dates display JST in Japanese and UTC in English. Date-only deadlines require the original zone and a UTC instant representing local 23:59:59; expiration occurs one second later, at the next local midnight. Never accept an unzoned timestamp. Leave an unknown deadline null; `availability: ongoing` is separate from unknown and ended. Use ISO currency codes and retain the provider's original amount.
- Add the same route key in both languages. The generator emits canonical URLs, reciprocal language links and sitemap alternatives. Run `npm test` and test both language links on the same detail path.
