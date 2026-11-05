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

## 無料プランで手動更新

本番は `https://reward-radar.rewardradar42.workers.dev` です。現行の運用方針は手動デプロイです。期限切れはブラウザーで非表示になり、次回の手動デプロイ時に詳細ページとサイトマップから外れます。

1. Cloudflare にログインし、メール確認を済ませます。Workers & Pages で Workers Free と workers.dev のアカウントサブドメインを確認します。
2. `npm ci --ignore-scripts`、`npm test`、`python3 -m radar.pipeline collect --observation var/observation.json`、`python3 -m radar.pipeline publish --observation var/observation.json` を実行します。
3. 実際の本番 URL を `SITE_ORIGIN` に設定し `npm run build` を実行します。Wrangler は `npm exec -- wrangler login --use-keyring --scopes account:read workers_scripts:write` で認証できます。デプロイは `WRANGLER_SEND_METRICS=false npm run deploy` です。初回はダッシュボードから静的アセットをアップロードしました。既存 Worker の更新は Wrangler で行い、HTML の末尾スラッシュとカスタム 404 の挙動を確認します。
4. `SITE_ORIGIN=https://実際のホスト node site/smoke.mjs` で日英ルート、CSP、JSON、404 を検査します。日英の検索、居住地フィルター、詳細への言語切り替えをブラウザーでも確認します。
5. 将来、自動デプロイに切り替える場合は、main のみに制限済みの GitHub production Environment を使用します。Environment Secret に Cloudflare の対象アカウントのみに絞った Workers Scripts 編集用 `CLOUDFLARE_API_TOKEN` を登録します。リポジトリ変数 `CLOUDFLARE_ACCOUNT_ID`、`SITE_ORIGIN` を設定し、最後に `DEPLOY_ENABLED=true` を設定します。Actions を手動起動し、deploy と本番スモークの成功を確認します。秘密値はチャット、ログ、リポジトリに貼らないでください。
6. Search Console で本番 URL の URL プレフィックスプロパティを登録します。HTML ファイル方式を選び、発行された検証ファイルを静的ビルドに追加します。検証後に `sitemap.xml` を送信します。

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
