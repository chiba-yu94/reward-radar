# 公募パルス 終了報告

## 完了

- 2026-11-05 に非公開 GitHub リポジトリのミラー、リポジトリ・ワークフローの台帳、関連原稿、公開 note の HTML、Render 紹介ページを、Mac のアクセス制限付きディレクトリに保存しました。ミラーは `git fsck --full` を通過しました。バックアップの場所はオーナーへの作業報告で共有します。
- Daily JGrants Sync、Launch Metrics、Test Email Notification、Offline regression tests の4本を無効化し、非完了の実行がないことを確認しました。GitHub のリポジトリ Webhook は0件でした。Mac の crontab と LaunchAgents に名称が一致する項目はありませんでした。
- Render の本体 `koubo-pulse` と専用紹介サイト `koubo-pulse-info` を同じリポジトリの関連サービスと確認し、管理画面で両方を停止しました。双方とも `Suspended by you` を確認しました。停止は復元可能で、サーバー側のログイン・同期・通知経路は停止対象に含まれます。
- Behind the Specs の該当記事 `nb55ae90264c8` を下書きに戻しました。差分監視に関する PRE-002 は既に未公開の原稿でした。記事 ID で対象を照合しました。

## 未確認・保留

- Supabase は運用 PostgreSQL と Auth、Resend はログインメールと通知に使用していたことをソースで確認しました。プロジェクト、API キー、送信ドメインの共有状況、バックアップ・保持要件、実際の請求を管理画面で照合できていません。リソースと利用者データは保持しました。
- 管理画面で Supabase の対象 Project と Render の接続先を照合し、暗号化した DB/Auth の必要データと保持期間を確定します。Cron、Edge Functions、Webhooks、Auth 連携を確認します。Resend は対象キー、送信元と最近の履歴を確認し、専用キーと確定した場合だけ無効化します。各サービスの請求履歴を確認します。
- Render の永久削除はバックアップ・保持範囲を確定してから判断します。今回の停止により両サービスが稼働対象から外れました。アカウント全体の過去および現在の請求は別途確認が必要です。

```sh
gh workflow list -R chiba-yu94/koubo-pulse --all
gh repo view chiba-yu94/koubo-pulse --json isArchived,visibility
curl -sS -o /dev/null -w '%{http_code}\n' https://koubo-pulse.onrender.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://koubo-pulse-info.onrender.com/
curl -sS -o /dev/null -w '%{http_code}\n' https://note.com/behind_specs/n/nb55ae90264c8
```
