# Freebie Trail

A Japanese and English directory of free consumer giveaways and gifts. Surveys and rewards are secondary; affiliate programs have a separate page. Official terms, residence eligibility, spending and verification dates are visible on each listing. Any operating proceeds support independent game development, including PATCH_03.

Production: [Japanese](https://freebietrail.com/ja/) · [English](https://freebietrail.com/en/)

## Run locally

Requires Python 3.11+ and Node.js 22+. The collector and static site have no runtime package dependencies. Wrangler is pinned as a deployment tool.

```sh
npm ci --ignore-scripts
npm test
python3 -m radar.discovery
python3 -m radar.pipeline collect --observation var/observation.json
python3 -m radar.pipeline publish --observation var/observation.json
npm run build
WRANGLER_SEND_METRICS=false npm run dev
```

Open `http://127.0.0.1:8787/ja/` or `http://127.0.0.1:8787/en/`. Run `node site/smoke.mjs` in a second terminal. To build with no network, omit collection and run `python3 -m radar.pipeline publish` from the reviewed inputs.

- [Architecture](docs/ARCHITECTURE.md) and [Security](docs/SECURITY.md)
- [Sources](docs/DATA_SOURCES.md), [Localization](docs/LOCALIZATION.md) and [Ranking](docs/RANKING_METHOD.md)
- [Monetization](docs/MONETIZATION.md), [運用手順](docs/OPERATIONS_JA.md) and [費用管理](docs/COST_CONTROL_JA.md)
- [公開報告](reports/LAUNCH_REPORT_JA.md), [セキュリティ検証](reports/SECURITY_AUDIT_JA.md) and [公募パルス終了報告](reports/KOUBO_PULSE_RETIREMENT_JA.md)

Support: [support@freebietrail.com](mailto:support@freebietrail.com)

Browser regression checks (Chrome installed, Wrangler dev running): `npm run test:browser`. Set `TEST_ORIGIN` to exercise a deployed site.
