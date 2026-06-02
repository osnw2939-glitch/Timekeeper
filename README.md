# 整理券管理システム

店舗で配布する物理整理券カードと、おおよその再来店時刻を管理するWebアプリです。

## 画面

- 管理画面: `/`
- お客さま向け進行状況: `/public.html`

## 基本ルール

- 開店時刻は9:00
- 開店時は7組まで同時に案内可能
- 9:00前に発券した場合、1〜7組目は9:00案内
- 8組目は9:15ごろ案内
- 9組目以降は初期進行ペースに沿って加算
- 30組来店後は直近30組の来店処理間隔から平均ペースを計算
- カード番号は設定枚数を超えたら1番に戻る
- 実番は当日の通し番号として増え続ける

## 自動更新

- 管理画面は自動更新しません
- お客さま向けページは60秒ごとに更新します
- お客さま向けページのタブが非表示の間は更新を停止します
- 再表示されたら即時に更新します

## バックエンド

Vercel Serverless Functions + Supabase REST API を使います。

- `api/tickets.js`
  - 管理画面用の発券、来店、不在、取消、リセット
- `api/settings.js`
  - 管理画面用の設定保存
- `api/public-status.js`
  - お客さま向け進行状況
- `supabase/schema.sql`
  - Supabaseテーブル定義

## Vercel環境変数

VercelのEnvironment Variablesに以下を設定してください。

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_TOKEN
```

`ADMIN_TOKEN` は管理画面で入力する管理用パスコードです。推測されにくい長めの文字列にしてください。

例:

```text
ADMIN_TOKEN=shop-ticket-2026-long-random-text
```

## セキュリティ

- SupabaseのService Role KeyはVercel Functions側だけで使用します
- フロントエンドにService Role Keyは出しません
- `tickets` と `daily_settings` はRLSを有効化します
- 管理APIの `/api/tickets` と `/api/settings` は `ADMIN_TOKEN` が必要です
- お客さま向けの `/api/public-status` は公開APIです
