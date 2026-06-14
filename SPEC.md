# Bioスケジューラ 仕様書

バイオリズムとスケジュール（ローカル予定＋Googleカレンダー）、天気、祝日を1画面で見られる
PWA（Progressive Web App）。インストール不要のブラウザアプリで、スマホのホーム画面にも追加できる。

- 公開URL: https://eins2019.github.io/bio-scheduler/
- リポジトリ: https://github.com/eins2019/bio-scheduler
- 現行バージョン: v1.20
- アプリ表示名: 「BioSKD」（タイトル先頭にバイオリズム波のアイコンを表示）

---

## 1. 技術スタック

| 項目 | 内容 |
|---|---|
| 形態 | 静的サイト（ビルド不要・素のHTML/CSS/JS） |
| グラフ | Chart.js 4.4.1（CDN: cdnjs） |
| カレンダー連携 | Google Identity Services + Google API Client（gapi） |
| 天気 | Open‑Meteo（APIキー不要・16日先まで） |
| ホスティング | GitHub Pages（`main`ブランチ / ルート、HTTPS強制） |
| オフライン | Service Worker（PWA） |
| データ保存 | ブラウザの localStorage（端末ローカル・サーバー保存なし） |

外部依存（実行時に読み込む/通信する先）:

- `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js`
- `https://accounts.google.com/gsi/client`（OAuth）
- `https://apis.google.com/js/api.js`（gapi）
- `https://www.googleapis.com/...`（カレンダーAPI）
- `https://api.open-meteo.com/v1/forecast`（天気）
- `https://geocoding-api.open-meteo.com/v1/search`（都市名検索）

---

## 2. ディレクトリ／ファイル構成

リポジトリはフラット構成（サブディレクトリなし）。

```
bio-scheduler/
├── index.html        画面の骨組み・全CSS・スクリプト読み込み・SW登録
├── app.js            アプリ本体（描画・予定・バイオリズム・天気・UI操作）
├── gcal.js           Googleカレンダー連携（OAuth・予定取得）・祝日データ
├── sw.js             Service Worker（キャッシュ戦略・オフライン）
├── manifest.json     PWAマニフェスト（名前・アイコン・表示モード）
├── icon-192.png      アプリアイコン（192px）
├── icon-512.png      アプリアイコン（512px）
├── SPEC.md           本仕様書
└── MANUAL.md         利用マニュアル
```

行数の目安: app.js ≈ 1180 / gcal.js ≈ 229 / index.html ≈ 255 / sw.js ≈ 103。

### 各ファイルの役割

- **index.html**: ツールバー（生年月日・今日・連携・週開始・直感線・天気・ヘルプ・月/週/2週タブ）、
  ナビゲーション、メインエリア、バイオリズム枠、詳細パネル、バックアップ欄。`<style>`に全CSS。
  末尾でChart.js・GIS・gapi・app.js・gcal.jsを読み込み、Service Workerを登録。
- **app.js**: 月/週/2週の描画、バイオリズム計算とグラフ、予定の追加・削除・ポップアップ、
  天気取得、各種UI操作（スワイプ・スクロール・リサイズ・トグル）、バックアップ。
- **gcal.js**: GISトークンクライアント初期化、連携ボタン処理、カレンダー予定の取得・反映、
  日本の祝日（2024〜2027の静的データ）の供給。
- **sw.js**: HTML/JSはネットワーク優先（更新が1リロードで届く）、画像はキャッシュ優先、
  Google/API系は常にネットワーク。オフライン時はキャッシュにフォールバック。

---

## 3. データ保存（localStorage）

すべて端末のブラウザ内に保存。サーバーやGoogleには保存しない（連携は読み取り専用）。

| キー | 内容 |
|---|---|
| `bio_bday` | 生年月日（YYYY‑MM‑DD） |
| `bio_events` | ローカル予定（`{ "YYYY-MM-DD": [ {title, hourStart, hourEnd, source:'local'} ] }`） |
| `bio_gcal_cache` | Googleカレンダー予定のキャッシュ（リロード直後の表示維持用） |
| `bio_gcal_autologin` | 連携済みフラグ（`'1'`） |
| `bio_weather_cache` | 天気のキャッシュ（取得時刻＋WMO天気コード＋最高/最低気温、3時間有効） |
| `bio_weather_loc` | 天気の地域設定（`{mode:'geo'}` または `{mode:'fixed',name,lat,lon}`） |
| `bio_week_start` | 週の開始曜日（`'0'`=日 / `'1'`=月） |
| `bio_show_intuition` | 直感波（第4波）表示（`'1'`=表示） |
| `bio_sched_h` | スケジュール領域の高さ（px） |
| `bio_allday_h` | 終日欄の高さ（px） |

> 注意: localStorageはブラウザのデータ削除・PWA入れ直し・iOSのストレージ自動削除等で消える。
> 大事なローカル予定は画面下部の「書き出し」でJSONバックアップを取ること。

---

## 4. バイオリズム

誕生日からの経過日数 `days = floor((対象日 − 生年月日)/86400000)` を用い、各波は正弦波。

| 波 | 周期 | 記号/色 | ユング心理機能 |
|---|---|---|---|
| 身体 P | 23日 | ■ 青 #378ADD | 感覚（Sensation） |
| 感情 S | 28日 | ● 橙 #D85A30 | 感情（Feeling） |
| 知性 I | 33日 | ▲ 緑 #1D9E75 | 思考（Thinking） |
| 直感 N | 38日 | ○点線 紫 #8E5BD9 | 直観（Intuition） |

`value = sin(2π · days / 周期)`。直感波は「直感線」トグルがONのときのみ表示・判定に参加。

- **要注意日（⚠️）**: いずれかの波が0ライン（基準線）を**横切る**日（前後の符号比較で判定）。
- **好調日（😊）**: 全リズムが高調期（>0）かつ0近傍の要注意がない日。
- 月/週/2週カレンダーの日付横、およびグラフ下の日別行に ⚠️/😊 を表示。
- グラフ下の日別行は、各日の**天気アイコン＋最高(赤)/最低(青)気温＋状態アイコン**を表示
  （旧版の曜日ラベルと3色スコアバーは廃止）。チャートX軸には日付＋曜日を表示。

---

## 5. 連携・外部サービス

- **Google カレンダー**: OAuth 2.0（GISトークンクライアント方式）。スコープは
  `calendar.readonly`（読み取り専用）。`primary`カレンダーの過去1年〜未来1年を取得。
  クライアントID: `432441205151-...apps.googleusercontent.com`。
  - 承認済みJavaScript生成元に `https://eins2019.github.io`（および開発用 `http://localhost:8000`）を登録。
  - 起動時の自動ポップアップはブラウザにブロックされるため廃止。前回連携済みなら
    「Google再連携」ボタンのクリックで silent 再取得。キャッシュ予定は起動時に表示。
- **天気**: Open‑Meteo。現在地（Geolocation）／主要都市（13都市）／都市名検索（ジオコーディング）。
  天気コードに加え**最高/最低気温**（temperature_2m_max/min）も取得。週/2週ヘッダーで曜日の横に
  天気アイコン、その下に最高気温（赤）・最低気温（青）を表示。
- **祝日**: gcal.js内の静的データ（2024〜2027年）。連携不要で表示。

---

## 6. PWA / Service Worker

- `manifest.json`: name「Bioスケジューラ」、display standalone、アイコン192/512、theme #1F5C99。
- `sw.js`（CACHE名 `bio-scheduler-vX.Y`）:
  - HTML/JS: ネットワーク優先 →（失敗時）キャッシュ。
  - 画像など: キャッシュ優先 →（無ければ）ネットワーク。
  - Google/googleapis/gstatic/gsi: 常にネットワーク（キャッシュしない）。
  - オフライン時はindex.htmlにフォールバック。

---

## 7. バージョニングとデプロイ

- 版を上げるときは **app.js の `APP_VER` と sw.js の `CACHE_NAME` を同じ番号に**更新する
  （SWキャッシュを更新し、変更を1リロードで配信するため）。画面右上にも版を表示。
- デプロイ: `main`へ push → GitHub Pagesが自動ビルド → 公開URLに反映。

---

## 8. 対応環境

- モダンブラウザ（Chrome / Safari / Edge）。iPhone/Androidのホーム画面追加でPWA動作。
- 必須機能: localStorage、Service Worker、Pointer Events、CSS sticky、Geolocation（天気・任意）。
