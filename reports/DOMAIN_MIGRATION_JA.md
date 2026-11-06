# 独自ドメイン移行記録

2026-11-06 JST。正規URLは https://freebietrail.com/。ルートと www を既存の reward-radar Worker に接続した。旧 workers.dev と www は元のパス・クエリを維持して301転送する。Registrar は Active、有効期限は2027-11-06、自動更新予定は2027-10-07と表示。登録者メールの個別の確認状態は未確認。

## 名称調査

- [J-PlatPat](https://www.j-platpat.inpit.go.jp/t0100) の出願・登録情報で「ＦＲＥＥＢＩＥＴＲＡＩＬ 懸賞さんぽ 懸賞散歩 フリービートレイル」の商標文字検索は0件。「フリービートレイル ケンショウサンポ」の類似称呼検索は4件。
- 近似候補の登録6671145「FREETRAIL」は株式会社ゴールドウイン、存続。指定は18・21・25類（かばん、生活用品、衣服など）と35類（各種商品の小売・卸売における顧客への便益）。広告・懸賞情報サイトとの直接の重複は確認できなかった。
- その他の類似称呼候補は登録5497442・5936335「懸賞電報」（ＳＧホールディングス株式会社、存続。16・35・38類等および39類）、登録5835091「PrinTrail」（株式会社メタテクノ、存続、42類）。これらは結果一覧の確認で、指定商品・役務の全文は未精査。
- [USPTO](https://tmsearch.uspto.gov/) の `CM:"freebie trail" OR CM:freebietrail` は0件。[WIPO](https://branddb.wipo.int/) の Freebie Trail 完全一致は0件。一般検索とアプリストアの検索結果で同名の懸賞情報サービスは確認できなかった。図形商標、各国の未登録名称、全件の類似判断は範囲外。権利上の安全性を保証するものではない。

## 配信と Google

- [CI](https://github.com/chiba-yu94/reward-radar/actions/runs/42192092740) と [移行後の手動配信](https://github.com/chiba-yu94/reward-radar/actions/runs/42192238858) が成功。新ドメインでの日次実行は次回以降に確認。
- [Search Console](https://search.google.com/u/2/search-console/sitemaps?resource_id=sc-domain%3Afreebietrail.com) は Yutchi Apps アカウントでDNS所有権確認済み。サイトマップ送信は成功。日英トップと日本語のProlific詳細は検出済み・インデックス未登録。旧ホストのプロパティは同アカウントに表示されず、アドレス変更は未申請。
- [GA4](https://analytics.google.com/analytics/web/?authuser=3#/a415205058p562924423/realtime/overview) は既存測定IDを継続。ストリームURLと名称を更新し、日本時間・日本円と拡張計測オフを確認。新ホストの日英から送信される言語パラメーターとHTTP 204、Realtimeの page_view と application_click を確認。
- [AdSense](https://adsense.google.com/adsense/u/3/pub-4046316117233479/sites/detail/url=freebietrail.com) は公開メタタグで所有権を確認し、審査リクエスト提出済み。ステータスは「準備中／審査待ち」。広告スクリプトは配信せず、支払い情報はアカウント画面で未入力。承認と広告用CMPは別途確認する。
