# BioSKD 一般公開（Google OAuth 本番公開）チェックリスト

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
- [ ] アプリ名: **BioSKD**
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
- [ ] スコープ justification（用途説明・英語推奨）例:
      > BioSKD displays the user's Google Calendar events in read-only mode alongside their
      > biorhythm chart. We only read events to show them in the app; we never create, modify,
      > or delete events, and we do not send calendar data to any server.

---

## 4. 動作デモ動画（審査で要求されることが多い）

- [ ] 連携ボタン → Google同意画面 → 予定が表示される、までの一連を画面録画（英語UIだと尚良）
- [ ] OAuthクライアントID（`432441205151-...`）が映る形で、同意フローを示す

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
