# 公募パルス 終了報告

## 完了

- 2026-11-05 に非公開 GitHub リポジトリのミラー、リポジトリ・ワークフローの台帳、関連原稿、公開 note の HTML、Render 紹介ページを、Mac のアクセス制限付きディレクトリに保存しました。ミラーは `git fsck --full` を通過しました。バックアップの場所はオーナーへの作業報告で共有します。
- Daily JGrants Sync、Launch Metrics、Test Email Notification、Offline regression tests の4本を無効化し、非完了の実行がないことを確認しました。GitHub のリポジトリ Webhook は0件でした。Mac の crontab と LaunchAgents に名称が一致する項目はありませんでした。
- Render の本体 `koubo-pulse` と専用紹介サイト `koubo-pulse-info` を同じリポジトリの関連サービスと確認し、管理画面で両方を停止しました。双方とも `Suspended by you` を確認しました。停止は復元可能で、サーバー側のログイン・同期・通知経路は停止対象に含まれます。
- Behind the Specs の該当記事 `nb55ae90264c8` を下書きに戻しました。差分監視に関する PRE-002 は既に未公開の原稿でした。記事 ID で対象を照合しました。

- 旧 GitHub リポジトリは非公開のままアーカイブしました。停止後の未ログイン確認では Render の2 URL が HTTP 503、対象 note が HTTP 404 を返しました。

## 2026-11-05 追加調査

- Supabase の専用組織 `KouboPulse` に `koubo-pulse` プロジェクト1件が残っています。プロジェクトは稼働中で、組織の請求画面は Free Plan でした。GitHub の接続、Edge Functions、`pg_cron` と `pg_net` は確認されませんでした。表示された連携は Data API と Vault です。
- Supabase には認証ユーザーとアプリ用テーブルが残っています。自動バックアップの表示は `No backups` でした。集計だけを実行し、個人データと秘密鍵は取得していません。保持期間と必要なバックアップの範囲を確定してから、停止または削除を判断します。
- Resend は送信専用の既存キー1本を確認しました。最終利用ログは公募パルスの送信でした。カスタムドメイン、Webhook、一斉配信、予約メールはいずれも0件でした。請求画面は月額0 USDで、請求書と支払方法の登録はありませんでした。キーが他の送信経路と共有されていないか、最終利用ログだけでは確定できないため保持しています。
- Render の Hobby ワークスペースで確認した未請求額は 0.00 USD でした。停止済みの2サービスは復元可能な状態で保持しています。

```sh
gh workflow list -R chiba-yu94/koubo-pulse --all
gh repo view chiba-yu94/koubo-pulse --json isArchived,visibility
curl -sS -o /dev/null -w '%{http_code}\n' https://koubo-pulse.onrender.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://koubo-pulse-info.onrender.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://note.com/behind_specs/n/nb55ae90264c8
```

## 残作業

- [Supabase](https://supabase.com/dashboard/sign-in) の対象 Organization と Project を確認し、保持対象の業務データを暗号化して保全します。復元可能性を確認してからプロジェクトの停止・削除を判断します。
- [Resend](https://resend.com/login) のキーを使っているアプリと運用経路を照合し、公募パルス専用と確定した場合だけ無効化します。キー値を記録・共有する必要はありません。
