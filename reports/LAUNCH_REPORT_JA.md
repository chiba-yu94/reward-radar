# Reward Radar 公開報告

2026-11-05 に Cloudflare Workers Free の Static Assets で Reward Radar を公開しました。本番は [日本語](https://reward-radar.rewardradar42.workers.dev/ja/) と [English](https://reward-radar.rewardradar42.workers.dev/en/) です。初回公開版で日英トップ、一覧、検索、国フィルター、詳細、言語切り替え、CSP、robots、サイトマップ、404 を確認しました。ブラウザーは375px・1280pxです。現在は手動デプロイの運用です。

## 消費者向け拡張

新版の公開用成果物は20件です。購入不要の懸賞8件、条件達成型の無料特典3件、アンケート・調査6件、デジタル特典1件、別ページのSaaS提携2件です。デジタル特典1件はアンケート回答によるクレジットです。購入が必要な還元、費用を確認できなかった抽選、学生向けの開発特典は履歴に保持し、一般一覧から外しました。

追加した懸賞は、Calbee Jagabee、JA和歌山の米、山崎製パンのチャームとデジタル特典、埼玉県の旬の農産物、ドトールのカフェラテ、タカラトミーのコナンカード、コトブキヤのフィギュア、トンボ鉛筆の文具・グッズです。

手動登録は台帳23件中、現行の公開用成果物に20件です。自動入力は GitHub Education の監視1本と埼玉県の発見用RSS 2本です。RSS 初回確認は2本とも取得成功、未レビューの新規候補0件でした。公式ページの事実を確認した日英の要約だけを掲載します。

## 再現と運用

```sh
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
python3 -m radar.discovery
python3 -m radar.pipeline collect --observation var/observation.json
python3 -m radar.pipeline publish --observation var/observation.json
export SITE_ORIGIN=https://reward-radar.rewardradar42.workers.dev
npm run build
WRANGLER_SEND_METRICS=false npm exec -- wrangler deploy --dry-run
node site/smoke.mjs
TEST_ORIGIN="$SITE_ORIGIN" npm run test:browser
```

日次設定は05:23 JST。初回の時刻起動は別途確認します。広告リンクは0件で、AdSense と第三者のアクセス解析は無効です。新規の月額費用は0円です。月5,000円の純収益に向け、食品・日用品の比較を充実させ、承認済みの提携先で実入金と費用を月次照合します。
