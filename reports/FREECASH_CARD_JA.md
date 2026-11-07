# Freecashカード改修報告

実施日：2026年11月7日。対象はFreebie Trailのホーム、掲載一覧、Rewardsに表示するFreecashカードと、その計測・回帰テスト。

## 表示と文章

`natural-writing`を使い、日本語・英語の自然さと元の条件・確度を確認した。既存の `docs/DESIGN_SYSTEM.md` の色、余白、フォーカス、ボタンを使用した。

カードは「何をするか→費用と重要な制限→主ボタン→短い紹介報酬の説明」の順とした。タイトルはFreecashに短縮。会社名、広告対象国の件数、確認日の行を取り除き、サービス内容を先に読めるようにした。背景と枠線は他のサービスと同じ白・ニュートラル色。広告・PR／Advertisementのラベルは残した。

日本語：

> ゲームやアンケートで得た報酬を、承認後に現金やギフトカードに交換できます。

英語：

> Complete game milestones or surveys, then redeem approved rewards for cash or gift cards.

購入・課金が必要なタスクがあること、16歳以上かつ契約できること、本人確認と地域制限はカードにも表示。国の全一覧、世帯ごとのアカウント制限、出金の最低額・手数料・地域差、確認日、非アフィリエイトの公式リンクは詳細ページで確認できる。削除・保証への言い換えはしていない。

タスク報酬／Task rewardsという分類と、具体的なゲーム・アンケートの説明で、アンケートパネル・研究参加・懸賞と区別した。Rewardsには懸賞を混在させず、サイト運営者向けの提携制度も引き続き別ページとしている。

## CTA・開示・計測

主ボタンは1つ。「Freecashを見る」／「View Freecash」から、既存の承認済みImpact URLへ移動する。隣に控えめな「対象地域・出金条件」／「Eligibility & cashout」の詳細リンクを置いた。ボタン直下の説明で、条件を満たす登録などにより当サイトが紹介報酬を受け取る場合があることを伝える。

既存の承認URL、対象地域、審査期限、失効時の抑止を維持。`rel="sponsored nofollow noopener noreferrer"` も保持した。Impactや決済のアカウント設定は変更していない。[公式広告ガイドライン](https://freecash.com/en/policies/partner-advertiser-policy)、[利用規約](https://freecash.com/en/policies/terms)、[出金条件](https://freecash.com/academy/en/support/withdrawal/issues/withdrawal-limits)を参照した。

新しくカードから直接移動できるため、GA4のカード計測にも `affiliate_click` を追加。ホーム・一覧・Rewardsのそれぞれで、`opportunity_id=freecash`、`page_group=affiliate`、表示言語を維持する。同意前・拒否後・撤回後は計測せず、検索語やリンク先URLは送らない。テスト中の外部リンクとGoogleの通信はインターセプトし、実際のImpact成果やGA4イベントを発生させていない。

## 実画面の比較

Chromeで日本語・英語を375／390／768／1440pxで撮影・確認。375pxで日本語の末尾だけが残る折り返しも調整した。

390pxのRewards内カード高：日本語 約485→308px、英語 約413→352px。表示高の測定であり、収益や成果率の改善を意味しない。

| 画面 | Before | After |
|---|---|---|
| 日本語390px | [画像](freecash-card/before-ja-390-rewards.png) | [画像](freecash-card/after-ja-390-rewards.png) |
| 英語390px | [画像](freecash-card/before-en-390-rewards.png) | [画像](freecash-card/after-en-390-rewards.png) |
| 日本語1440px | [画像](freecash-card/before-ja-1440-rewards.png) | [画像](freecash-card/after-ja-1440-rewards.png) |
| 英語1440px | [画像](freecash-card/before-en-1440-rewards.png) | [画像](freecash-card/after-en-1440-rewards.png) |

[サービス比較の全体像・英語1440px](freecash-card/after-en-1440-comparison.png)／[日本語375px](freecash-card/after-ja-375-rewards.png)。全撮影画像とログはローカルの `var/freecash-card-qa/` に保存した。

## 検証

- Python 16件・Node 15件成功。カードの内容、主CTAが1つであること、広告URLとrel属性、詳細に残す条件を検査。
- 既存のブラウザー回帰、日英4幅・8ページ種別のUX検証、75ページのSEO検証が成功。
- GA4無効時と有効時を検証。カードの3掲載先と詳細で、同意後の帰属と拒否・撤回時の停止を確認。
- axeでホーム・Rewards・一覧・詳細×日英4幅＝32条件を検査し、検出違反0。横はみ出しなし。
- WebKitでも日英の390／1440pxを確認。物理iPhone／実機Safariは利用していない。
- ローカルRewardsのLighthouseはPerformance／Accessibility／Best Practices／SEOが各100。ラボ測定であり、実ユーザー指標や収益の測定ではない。
- 依存関係監査は脆弱性0。新しい本番依存パッケージや有料サービスは追加していない。

## 公開

[本番Rewards](https://freebietrail.com/ja/rewards/)／[English Rewards](https://freebietrail.com/en/rewards/)へ反映済み。

- 公開コミット：`8f75953d6adeb8bee5bd15beef88ef97944fd504`。
- [GitHubの全検証](https://github.com/chiba-yu94/reward-radar/actions/runs/42341363953)：成功。
- [収集・ビルド・本番公開](https://github.com/chiba-yu94/reward-radar/actions/runs/42341663327)：全ジョブ成功。
- 本番でも16枚を撮影し、上記After画像を実際の公開画面に置き換えた。
- 日英のホーム・Rewards・一覧で、主CTAが1つ、正しい承認済みURLとrel属性、詳細リンク、白い背景を確認した。コンソールエラー0。
- 本番で、同意前・拒否後・撤回後の停止と、同意後の正しい `affiliate_click` 帰属を確認した。
- ブラウザーの時刻を審査期限後に進め、カード非表示を確認した。
- 本番のCSS・client・analyticsファイルをSHA-256でソースと照合し、3件とも一致した。[検証記録](freecash-card/production-checks.json)。

最初のアフィリエイト表示改修は `4e3c0ca3fa86470c918ffe139a76c4d4d7336cf1`、その後に狭い画面の日本語と失効時の回帰テストを調整した。この報告と証拠は文書コミットに保存する。

追加の継続費用：0円。
