# Bio-Scheduler 一般公開（Google OAuth 本番公開）チェックリスト

不特定多数が Googleカレンダー連携を使えるようにするには、OAuth同意画面を「本番」に公開し、
機微なスコープ（`calendar.readonly`）の **Google 審査** を通す必要があります。本書はその準備手順。

> サイト本体（バイオリズム・天気・ローカル予定・バックアップ）は審査不要で既に公開済み。
> 審査が要るのは Googleカレンダー連携だけ。

---

## 0. 事前に用意済みのもの（このリポジトリ）

- ✅ アプリ本体（公開URL: https://eins2019.github.io/bio-scheduler/ ）
- ✅ プライバシーポリシー: https://eins2019.github.io/bio-scheduler/privacy.html
  （Limited Use 文言・データの取り扱い・連絡先を記載）
- ✅ アプリ内フッターからポリシーへのリンク
- ✅ 連絡先メール: eins56@gmail.com

---

## 1. ドメイン所有の確認（重要・つまずきやすい）

OAuthの「承認済みドメイン」は **Google Search Console で所有確認** が必要。

- [ ] Google Search Console で `eins2019.github.io` を **URLプレフィックス** で登録
      （`https://eins2019.github.io/bio-scheduler/`）し、HTMLファイル設置 or metaタグで確認。
- 注意: `github.io` は共有ドメインのため、審査でドメイン所有の扱いが厳しくなる場合がある。
  スムーズにしたいなら **独自ドメイン**（例: お名前.com等で年1,000円程度）を取得し、
  GitHub Pages にカスタムドメインを設定 → そのドメインで所有確認するのが確実。
  - 独自ドメインにした場合、OAuthの「承認済みJavaScript生成元」も新ドメインに更新すること。

---

## 2. OAuth 同意画面の設定（Google Cloud Console）

「APIとサービス」→「OAuth同意画面」で以下を登録:

- [ ] User Type: **External**
- [ ] アプリ名: **Bio-Scheduler**
- [ ] ユーザーサポートメール: **eins56@gmail.com**
- [ ] アプリのロゴ: （任意。設定するとブランド審査も入る。icon-512.png 等）
- [ ] アプリのホームページ: `https://eins2019.github.io/bio-scheduler/`
- [ ] プライバシーポリシーURL: `https://eins2019.github.io/bio-scheduler/privacy.html`
- [ ] 利用規約URL: （任意）
- [ ] 承認済みドメイン: `eins2019.github.io`（または独自ドメイン）
- [ ] デベロッパー連絡先メール: **eins56@gmail.com**

---

## 3. スコープと用途説明

- [ ] スコープに `https://www.googleapis.com/auth/calendar.readonly` を追加
- [ ] スコープ justification（審査フォームにそのまま貼れる確定版・英語）:

> Bio-Scheduler is a free personal Progressive Web App that shows the user's biorhythm chart
> together with their schedule, local weather, and Japanese public holidays on a single
> screen. We request the read-only Google Calendar scope
> (https://www.googleapis.com/auth/calendar.readonly) solely to fetch the signed-in user's
> own calendar events and display them in the app's week and month views, next to the
> biorhythm chart, so the user can plan around their existing appointments.
>
> The data is used only for on-screen display on the user's device. We never create, modify,
> or delete calendar events. Bio-Scheduler has no backend server: calendar data is processed in the
> browser and cached only in the device's local storage; it is never transmitted to or stored
> on any server we control, and it is never shared with third parties or used for advertising.
> A narrower scope is not sufficient because we need to read the user's events to display
> them; we do not need any write access. Our use of Google user data complies with the
> Google API Services User Data Policy, including the Limited Use requirements.

---

## 4. 動作デモ動画（審査で要求されることが多い）

- [x] 連携ボタン → Google同意画面 → 予定が表示される、までの一連を画面録画
- [x] OAuthクライアントID（`432441205151-...`）が映る形で、同意フローを示す
- [x] YouTube に**限定公開（Unlisted）**でアップロード済み → 審査フォームにそのURLを貼る

### YouTube 説明欄に貼る英文（審査担当向け・確定版）

> This video demonstrates how Bio-Scheduler (https://eins2019.github.io/bio-scheduler/) uses the
> Google Calendar read-only scope.
>
> 1. The app opens at https://eins2019.github.io/bio-scheduler/ (shown in the address bar).
> 2. The user clicks "Connect Google Calendar".
> 3. The Google consent screen appears, showing the OAuth client ID (in the URL) and the
>    requested permission: "See and download any calendar you can access using your Google
>    Calendar" (the calendar.readonly scope).
> 4. After the user grants permission, their calendar events are displayed in read-only mode
>    in the app's week/month view, next to the biorhythm chart.
> 5. Bio-Scheduler never creates, edits, or deletes events, and never sends calendar data to any server.
>
> OAuth Client ID: 432441205151-3vjl7v963me25blgfepmebt12ligpibh.apps.googleusercontent.com
> Scope: https://www.googleapis.com/auth/calendar.readonly

### ナレーション台本（録画に音声を入れる場合・英語）

1. "This is Bio-Scheduler, a personal biorhythm and schedule web app, at eins2019.github.io/bio-scheduler."
2. "I tap Connect Google Calendar to link my account."
3. "Here is the Google consent screen. The URL shows our OAuth client ID, and the app is
   requesting read-only access to my Google Calendar."
4. "After I allow it, my calendar events appear in the week view, next to my biorhythm chart."
5. "Bio-Scheduler only reads events to display them. It never changes my calendar and never sends my
   data to any server."

---

## 5. 本番公開して申請

- [ ] OAuth同意画面を「テスト」→ **「アプリを公開」**（本番）
- [ ] 機微スコープのため「確認のため送信」→ Googleの審査へ
- [ ] 審査は数日〜数週間。完了まで本番でも「確認されていないアプリ」警告が出る場合あり

---

## 6. 公開後の運用メモ

- 承認済みJavaScript生成元・リダイレクトは公開ドメインに合わせて維持。
- プライバシーポリシー内容を変えたら最終更新日を更新。
- スコープを増やす場合は再審査が必要。

---

## 参考リンク

- OAuth同意画面: https://console.cloud.google.com/apis/credentials/consent
- 認証情報（クライアントID）: https://console.cloud.google.com/apis/credentials
- User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Search Console: https://search.google.com/search-console
