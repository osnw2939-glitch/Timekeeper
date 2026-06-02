# 店舗整理券システム v1

目的は、店舗前の行列を減らし、お客さんに「番号」と「おおよその再来店時刻」を伝えることです。

## 運用思想

- 厳密な入退室管理ではなく、現場が迷わず使える整理券管理にする
- 発券、来店処理、不在処理を中心にする
- 不在者は別タブへ移動する
- 危険操作は右側の操作パネルに分離する
- 画面は装飾より余白と読みやすさを優先する

## 待ち時間ルール

- 開店時刻は9:00
- 9:00以前に発券した場合、最初の7組は9:00案内
- 8組目は9:15ごろ案内
- 9組目以降は1組あたり約1分ずつ加算
- 来店処理が30組未満の間は初期ルールを使う
- 30組来店後は直近30組の来店処理間隔から平均進行ペースを計算する

## 番号

- 実番: 当日の通し番号
- カード番号: 物理カード番号
- カード番号は連番で渡す
- 設定枚数を超えたら1番に戻る
- 来店処理でカードが回収済みになっても、次の発券は即1番に戻らない
- 持ち帰り・紛失カードは「カード番号を飛ばす」でスキップ登録する
- 現在の仮カード枚数は300枚

## フロントエンド

現在は `localStorage` で動作します。Vercelに静的配置できます。

管理画面:

```text
index.html
```

客用QRページ:

```text
public.html
```

客用ページは `/api/public-status` から現在の進行状況を取得します。

## バックエンド

Vercel Serverless Functions + Supabase REST API の雛形を追加しています。

- `api/tickets.js`
  - `GET /api/tickets?businessDate=YYYY-MM-DD`
  - `POST /api/tickets` with `action: issue`
  - `POST /api/tickets` with `action: admit`
  - `POST /api/tickets` with `action: no_show`
  - `POST /api/tickets` with `action: cancel`
  - `POST /api/tickets` with `action: skip_card`
  - `POST /api/tickets` with `action: reset`
- `api/settings.js`
  - `GET /api/settings?businessDate=YYYY-MM-DD`
  - `POST /api/settings` with `cardCount`, `initialPaceMinutes`
- `api/public-status.js`
  - `GET /api/public-status?businessDate=YYYY-MM-DD`
- `supabase/schema.sql`
- `tickets`
- `daily_settings`
  - `next_card_number`
  - `skipped_card_numbers`

必要な環境変数:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```
