# Reward Radar 公開報告

2026-11-05 に日英の静的サイト、Python 収集と SQLite、検索・絞り込み、公開用 JSON、検証・デプロイの GitHub Actions 定義を作成しました。初期データは掲載候補15件（消費者向け13件、SaaS提携2件）と、保持のみの期限切れ1件です。うち自動確認は GitHub Education の公開 API 1件で、その他は提供元の公式資料を手動で確認した要約です。

広告リンクは0件です。AdSense、外部アクセス解析は無効です。収益レポートはローカル台帳から集計できます。閲覧数、クリック数、成果数、入金はこの公開前報告では未計測です。新たな有料契約は発生していません。

## 再現

```sh
npm ci --ignore-scripts
npm audit --audit-level=high
npm test
python3 -m radar.pipeline collect --observation var/observation.json
python3 -m radar.pipeline publish --observation var/observation.json
python3 -m radar.health
npm run build
WRANGLER_SEND_METRICS=false npm exec -- wrangler deploy --dry-run
```

日英のページに加え、言語切り替え、ソースの失敗、国フィルター、通貨・タイムゾーン、期限切れ、広告承認、CSP、SSRF 防止と出力内の秘密値パターンを回帰試験しました。

公開リポジトリを作成し main をプッシュしました。手動起動した GitHub Actions で collect と publish が成功し、source-observation と validated-static-site が保存されました。Chromium の375px・1280pxで日英の主要5ルート、横スクロール、検索、国絞り込み、詳細の言語切り替えを確認しました。月5,000円に向けて、公式資料に基づく比較を公開し、申請・承認を経た提携先だけを対象に、月ごとに実入金と費用を照合します。
