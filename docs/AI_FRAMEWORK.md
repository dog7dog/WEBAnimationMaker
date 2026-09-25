# WEBAnimationMaker AI Framework

WEBAnimationMaker にAIチャット機能を統合するフレームワークです。
自然言語で指示すると、AIが Canvas API / Three.js / アプリ内部API のコードを生成し、
プレビュー確認後にレイヤー適用・MOD化・エディタ送りができます。
キャンバスのスクリーンショットを添付して「添削して」も可能です（Vision対応）。

> 内部のシステムプロンプト（`AI_SYSTEM_PROMPT`）はまだ「Magic Paint」という
> 旧アプリ名でAIに自己紹介させています。動作に支障はありませんが、
> ブランド名としては古いままです。

**サーバーは不要です。** 以前はFlask（`ai_api.py`）が各社APIとの中継をしていましたが、
静的サイト化に合わせてブラウザから直接リクエストする形に移行しました。

---

## 構成

```text
ユーザー
↓
AIチャットパネル (AppCore/ai/ai_panel.js)
↓  ┌ Vision画像 / シーン情報 / 選択図形 を添付可能
AIClient (AppCore/ai/ai_client.js)
↓  fetch でブラウザから直接
OpenAI / Gemini / Claude / Grok
↓
生成結果 → コード表示 → 危険ワードチェック → プレビュー(編集可) → 適用 / MOD化 / エディタ送り
```

### ファイル

```text
AppCore/ai/
├ ai_client.js  ... 各社APIの呼び出し / キー・会話・統計の保存 / キャンバスキャプチャ
├ ai_panel.js   ... チャットUI / キー管理 / 履歴 / 統計
└ ai_apply.js   ... 危険ワードチェック / プレビュー / 適用 / MOD化
```

---

## 主な機能

### チャット & コード生成
- 4プロバイダー（OpenAI / Gemini / Claude / Grok）を切り替え
- APIキー登録・削除（マスク表示）・接続テスト
- モデル選択 + カスタムモデル名の直接入力
- temperature（創造性）スライダー
- **再生成**ボタン / **クイックアクション**チップ（星空・花火・雪・炎・波・パーティクル・ドット網・3D）

### Vision（画像理解）
- 📷 キャンバスのスクリーンショットをワンタップ添付 → 「これ添削して」
- 📎 画像ファイル添付（最大3枚 / 各4MBまで）

### コンテキスト送信
- 🧊 シーン情報（図形一覧・サイズ）をAIに渡して整合性のある修正コードを生成
- 👆 選択中の図形JSONを渡してピンポイント修正

### 生成コードの扱い
- **プレビュー**（別キャンバスで安全に再生・その場でコード編集も可能）
- **適用**（`AIコード`レイヤーとして追加。毎フレーム `t` 付き実行 / Undo・保存対象。
  デザインタブ・キャンバスタブ（DOM/CSSミラー）・書き出したHTMLのいずれでも
  同じように動く。適用した内容はテキストエディタのファイル一覧にも自動で
  反映されるので、あとから見返せる）
- **MOD化**（ZIP MODと同じブラウザ内ストアへ入れて即ロード）
- **エディタへ**（テキストエディタのファイルとして追加。コードの言語(JS/CSS/HTML)
  に応じた拡張子で追加される）
- **コピー**

### 会話管理
- 会話はブラウザに自動保存 → 履歴から読み込み / リネーム / 削除
- 会話を Markdown で書き出し
- 新規会話ボタン

### その他
- 📊 使用統計（プロバイダー別の回数・成功数・画像数・平均応答ms・文字数、過去30日）
- パネル幅のドラッグリサイズ（記憶される）
- `Ctrl + /` でパネル開閉

---

## AIClient のメソッド

`window.AIClient` がUI層から使う唯一の入口です。すべて Promise を返します。

| メソッド | 説明 |
|---|---|
| `listKeys()` | プロバイダー一覧（キーはマスク済み、vision可否付き） |
| `saveKey(provider, apiKey, model)` | キー保存 |
| `saveModel(provider, model)` | モデルのみ変更 |
| `deleteKey(provider)` | キー削除 |
| `testConnection(provider, model)` | 接続テスト |
| `chat(provider, messages, opts)` | チャット送信（画像・temperature・会話ID対応） |
| `listConversations()` / `getConversation(id)` | 会話一覧 / 取得 |
| `renameConversation(id, title)` / `deleteConversation(id)` | リネーム / 削除 |
| `stats()` | 使用統計（過去30日） |
| `installMod(mod)` | AI生成MODのインストール |
| `parseResponse(content)` | 応答から ```` ``` ```` コードブロックを抽出 |
| `captureCanvas(maxW)` | キャンバスを dataURL で取得 |

### ブラウザ内の保存先（localStorage）

```text
mpAiKeys           { provider: { api_key, model, updated_at } }
mpAiConversations  [{ id, title, provider, created_at, updated_at, messages:[...] }]
mpAiLogs           [{ provider, model, prompt_chars, response_chars,
                      image_count, duration_ms, ok, created_at }]  ... 直近500件
```

---

## チャット送信の形

```js
await AIClient.chat('openai', [
  { role: 'user', content: 'この絵を明るくして', images: ['data:image/png;base64,....'] }
], { model: 'gpt-4o', temperature: 0.7, conversationId: 12 });
```

画像は「最後のユーザーメッセージのみ」送信されます（トークン節約）。

---

## 対応プロバイダー

| provider | エンドポイント | デフォルトモデル | Vision | 動作確認 |
|---|---|---|---|---|
| openai | api.openai.com/v1/chat/completions | gpt-4o-mini | ✓ | 未確認 |
| gemini | generativelanguage.googleapis.com | gemini-2.0-flash | ✓ | ✅ |
| claude | api.anthropic.com/v1/messages | claude-sonnet-4-5 | ✓ | 未確認 |
| grok | api.x.ai/v1/chat/completions | grok-3-mini | ✓ | 未確認 |

モデル一覧は `ai_client.js` の `AI_PROVIDERS` で変更できます。

ブラウザから直接APIを叩くため、各社がブラウザ由来のリクエスト（CORS）を許可している
必要があります。個別の対応は以下のとおりです。

- **Claude** — `anthropic-dangerous-direct-browser-access: true` ヘッダを付けています
- **Gemini** — キーはURLの `?key=` ではなく `x-goog-api-key` ヘッダで送っています

接続できない場合はチャット欄にCORSの可能性を含むエラーが出ます。
`file://` で直接開いているとリクエストが拒否されるので、ローカルサーバー経由で開いてください。

---

## セキュリティ

- **APIキーはブラウザの localStorage に平文で保存されます。**
  サーバーを挟まない以上これは避けられません。同じブラウザを使える人と、
  このページで動くコード（インストールしたMODを含む）からは読めてしまいます。
  共有端末では使わず、使い終わったら設定画面から削除してください。
- キーは画面表示では常にマスクされ、APIのエラー本文に混ざっていた場合も `***` に置換します
- `mpAiLogs` にもキーは記録しません（統計は文字数・回数・時間のみ）
- 生成コードは**即実行しません**。必ず「プレビュー」「適用」操作を経由
- 危険ワード（`fetch` / `XMLHttpRequest` / `localStorage` / `sessionStorage` /
  `document.cookie` / `eval(` / `new Function` / `importScripts` / `import(` /
  `WebSocket` / `indexedDB` / `navigator.sendBeacon`）を含むコードは実行前に警告
- MODインストールは ID を `^[a-z0-9_]{1,40}$` に制限、固定ファイル名
  （mod.json / main.js / style.css）のみ
- 添付画像は image/* のみ・サイズ上限あり
