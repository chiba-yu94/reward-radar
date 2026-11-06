# 運用手順

## 日次確認

GitHub Actions の **Collect and publish** は UTC 20:23（日本時間 05:23）に予定しています。既定ブランチ main のコードを GitHub ホストの Ubuntu で実行します。混雑で遅延・省略される場合があります。公開リポジトリは活動がない期間が続くと予定実行が停止する場合があります。リポジトリに不要なコミットを入れず、Actions の実行日時と有効状態を確認してください。

```sh
gh run list --workflow publish.yml --limit 10
gh workflow run publish.yml
gh run view RUN_ID --log-failed
gh run download RUN_ID -n source-observation -D var/observations/RUN_ID
```

公開工程に失敗した日は本番を前回成功版に維持します。

`gh run list --workflow publish.yml --event schedule --limit 5` で自動起動時刻を確認してください。翌朝、予定時刻を過ぎても実行がなければ GitHub の状態とワークフロー有効状態を確認し、手動起動します。

候補確認には `gh run download RUN_ID -n discovery-candidates -D var/discovery/RUN_ID` を使います。RSS 失敗の警告と「候補0件」の正常結果を区別します。候補は本文を取得せず、公式 URL のみ出力します。GitHub Education のリビジョンが変わった場合は、原文とリンク先を確認し、掲載への影響を判断してからレビュー済み識別子を更新します。手動ソースは30日以内に再確認します。掲載ページは古い確認に警告を表示し、日次の実行概要にも該当案件 ID が出ます。

## 本番の自動更新

本番は [Reward Radar](https://reward-radar.rewardradar42.workers.dev/) です。日次実行は収集とテストを通過した静的成果物を Workers Free に配信します。期限を過ぎた案件はブラウザーで非表示になり、次回の成功したデプロイで詳細ページとサイトマップから外れます。

GitHub の `production` Environment は `main` に制限しています。Cloudflare の対象アカウントに限定した Workers Scripts 編集用トークンを `CLOUDFLARE_API_TOKEN` として登録します。リポジトリ変数は `CLOUDFLARE_ACCOUNT_ID`、`SITE_ORIGIN`、`DEPLOY_ENABLED` です。トークンはデプロイ工程だけが参照します。秘密値はチャット、ログ、リポジトリに貼らないでください。

```sh
gh variable set DEPLOY_ENABLED --body false  # 停止または配信なしの検証
gh workflow run publish.yml --ref main
gh run list --workflow publish.yml --limit 5
```

再開時は無効の状態でビルドが成功したことを確認し、`gh variable set DEPLOY_ENABLED --body true` を実行します。手動でワークフローを起動し、`deploy` とその後の本番スモークテストの成功を確認します。停止設定は次に起動する実行に適用されます。既に配信中のジョブは必要に応じて Actions からキャンセルします。

Cloudflare の認証済みローカル環境から緊急で配信する場合は、公開用データの再生成・テスト後に本番 `SITE_ORIGIN` を指定して `npm run build` を行い、`WRANGLER_SEND_METRICS=false npm run deploy` を実行します。`SITE_ORIGIN=https://reward-radar.rewardradar42.workers.dev node site/smoke.mjs` で本番応答を確認します。

Search Console で本番 URL の URL プレフィックスプロパティを登録する場合は、HTML ファイル方式で発行された検証ファイルを静的ビルドに追加し、検証後に `sitemap.xml` を送信します。

### 計測

GA4 は初期状態で無効です。開始する場合は [GA4 設定手順](MONETIZATION.md#ga4-activation) に従い、専用のウェブストリームの拡張計測を停止してから GitHub のリポジトリ変数を設定します。無効に戻すには `GA4_PRIVACY_READY` を削除し、公開ワークフローを起動します。

### 復旧

Cloudflare の Worker の Deployments で動作確認済みの版へロールバックします。原因を直すまで自動デプロイを無効にしてください。過去のデータを再作成する場合は、別作業ツリーで既知の正常コミットからビルドし、現在日時で期限チェックを通します。Actions の `validated-static-site` は14日、`source-observation` は7日保持します。保存された静的成果物を再利用する場合は掲載期限を再確認してください。

### Lima

```sh
limactl list
limactl start --yes --name=reward-radar --arch=aarch64 --vm-type=vz --cpus=2 --memory=3 --disk=30 --plain --mount-none --set '.ssh.loadDotSSHPubKeys = false' template:ubuntu-24.04
limactl shell reward-radar -- bash -lc '
  set -eu
  uname -m
  grep ^PRETTY_NAME= /etc/os-release
  test -z "$(findmnt -rn -t virtiofs,9p,fuse.sshfs || :)"
  test ! -S /var/run/docker.sock
  test -z "${SSH_AUTH_SOCK:-}"
  test ! -d /Users
  test ! -e ~/.gitconfig
  test ! -e ~/.config/gh
  ss -lnt
'
limactl stop reward-radar
```

既に作成済みの場合は `limactl start reward-radar` から実行します。Lima のローカル制御用の鍵とゲスト SSH は存在します。ホストの個人鍵や認証エージェントは共有しません。ゲストからの一般的な外向き通信は可能です。既存の Bug Bounty VM と別に扱います。

- [GitHub Actions のスケジュール](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Search Console の所有権確認](https://support.google.com/webmasters/answer/9008080)
- 運用窓口 [rewardradar.support@gmail.com](mailto:rewardradar.support@gmail.com)

2026-11-06 の05:23 JST予定分は09:58:59 JSTに実行が作成され、collect、discover、publish、deploy はすべて成功しました。Cloudflare の新バージョンは09:59:49 JSTに記録され、本番 JSON の生成時刻は09:59:20 JSTでした。遅延の個別原因は実行ログに記録されていません。[実行ログ](https://github.com/chiba-yu94/reward-radar/actions/runs/42140680733)
