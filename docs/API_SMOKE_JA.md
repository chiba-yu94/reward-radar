# Freebie Trailの手動API接続テスト

`Freebie Trail API smoke` は、公開済みのTimee×noteの1件から日英タイトル、ジャンル、締切、賞金、公式要項URLだけを取り、Responses APIへ1回送る。根拠のある項目の選択と日英要約に使う順序を決める構造化応答を検証する。検索ツール、データ書き込み、カレンダー・RSS・公開ビルドを呼び出さない。ログは固定の成功・スキップ・停止理由のみ。結果ファイルや公開アーティファクトは作成しない。 [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

## 初回の実行を許可するとき

1. DevelopのFreebie Trail専用プロジェクトを選ぶ。実行を許可する前に、クレジット残高と失効日、モデルの適用範囲、自動チャージと超過時の請求条件を確認する。負担が許容範囲と確認できた時点で、本人が専用プロジェクトのキーを用意する。
2. [freebie-trail-api の Environment secrets](https://github.com/chiba-yu94/reward-radar/settings/environments/28486372076/edit#environment-secrets) を開き、**Add environment secret** を押す。名前を `OPENAI_API_KEY` にして、値は本人が画面に直接入力する。リポジトリや組織に同名の共有Secretがある場合は、別のキーを使う事故を避けるためワークフローが停止する。 [GitHubの環境Secret手順](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-an-environment)
3. 許可した実行の直前に [Actionsのリポジトリ変数](https://github.com/chiba-yu94/reward-radar/settings/variables/actions) に `FREEBIE_TRAIL_API_SMOKE_ENABLED` を作り、値を `true` にする。未作成またはそれ以外の値では接続しない。
4. [Freebie Trail API smoke](https://github.com/chiba-yu94/reward-radar/actions/workflows/freebie-trail-api-smoke.yml) の **Run workflow** で、ブランチに `main` を選ぶ。クレジットを確認して1回の実行を許可する場合にだけ確認欄をオンにする。成功したときは `passed: one structured editorial response verified` が出る。接続確認後は変数を `false` に戻す。

## 上限と停止

ワークフローは既定で停止。日本時間の各日で最初の手動実行だけを接続対象とし、同時に実行されないようにしている。確認なしで当日に起動した場合でも最初の実行として数える。GitHub履歴で最初の実行だと確認できない場合、同じ実行の再試行、キー未設定は送信前に止まる。1実行1リクエスト、入力12,000バイト、応答32,000バイト、最大出力512トークン。429、他のHTTPエラー、予期しない応答は再試行せずに停止する。この上限はAPI組織の請求遮断とは別。

ローカルの通信契約とスキップ条件は模擬通信で確認できる。

```sh
python3 -m unittest discover -s tests -p 'test_api_smoke.py' -v
```
