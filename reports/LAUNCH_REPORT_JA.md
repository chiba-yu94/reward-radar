# Reward Radar 公開報告

2026-11-05 に Cloudflare Workers Free の Static Assets で Reward Radar を公開しました。本番は [日本語](https://reward-radar.rewardradar42.workers.dev/ja/) と [English](https://reward-radar.rewardradar42.workers.dev/en/) です。初回公開版で日英トップ、一覧、検索、国フィルター、詳細、言語切り替え、CSP、robots、サイトマップ、404 を確認しました。ブラウザーは375px・1280pxです。初回は手動で公開しました。

## 消費者向け拡張

新版の本番掲載は20件です。購入不要の懸賞8件、条件達成型の無料特典3件、アンケート・調査6件、デジタル特典1件、別ページのSaaS提携2件です。デジタル特典1件はアンケート回答によるクレジットです。購入が必要な還元、費用を確認できなかった抽選、学生向けの開発特典は履歴に保持し、一般一覧から外しました。

追加した懸賞は、Calbee Jagabee、JA和歌山の米、山崎製パンのチャームとデジタル特典、埼玉県の旬の農産物、ドトールのカフェラテ、タカラトミーのコナンカード、コトブキヤのフィギュア、トンボ鉛筆の文具・グッズです。

手動登録は台帳23件中、現行の公開用成果物に20件です。自動入力は GitHub Education の監視1本と埼玉県の発見用RSS 2本です。RSS 初回確認は2本とも取得成功、未レビューの新規候補0件でした。公式ページの事実を確認した日英の要約だけを掲載します。

## 本番確認

2026-11-05 16:18 JST に実装コミット `10ce981` を Wrangler で公開しました。Cloudflare の配信版 `7b8ecb15-feb8-4579-acb5-146a11b0a428` に100%を配信しました。本番の公開 JSON とサイトマップはローカル成果物と一致しました。新版でも日英のホーム、一覧、検索、居住地、詳細、言語切り替え、CSP、robots、404 を確認しました。除外した3件の詳細 URL は HTTP 404 を返しました。追加した公式リンクは7件を HTTP 200、コトブキヤ1件を通常のブラウザー表示で確認しました。

- [GitHub Actions の回帰・ブラウザー検証](https://github.com/chiba-yu94/reward-radar/actions/runs/41986259407)
- [収集・発見・公開用成果物の生成](https://github.com/chiba-yu94/reward-radar/actions/runs/41986260229)

## GitHub Actions による自動デプロイ

2026-11-05 17:34 JST に、既存ワークフローの手動起動で本番配信に成功しました。Cloudflare の配信版 `4621c3da-0416-4973-b650-1a65729576f7` に100%を配信しています。

- [事前検証](https://github.com/chiba-yu94/reward-radar/actions/runs/41995264782) は `DEPLOY_ENABLED=false` で実行しました。公開用ビルドが成功し、デプロイはスキップされ、既存の Cloudflare 配信版に変更はありませんでした。
- [本番デプロイ](https://github.com/chiba-yu94/reward-radar/actions/runs/41995435229) は `DEPLOY_ENABLED=true` で `main` から実行しました。production Environment は `main` のみを許可しています。Wrangler の認証先とリポジトリに登録された Cloudflare Account ID を照合しました。
- 本番の公開 JSON、サイトマップ、`robots.txt` は Actions の成果物と一致しました。日英のブラウザーテストに加え、期限を過ぎると懸賞が一覧から消え、詳細ページで応募リンクが非表示になることを、本番に対するブラウザー内の時刻変更で確認しました。
- 日次の実行予定は05:23 JSTです。時刻起動の初回実績は未確認です。期限切れ案件の詳細ページとサイトマップは、次回の成功したデプロイで更新されます。

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
