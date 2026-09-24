# WEBAnimationMaker MOD SDK

WEBAnimationMaker は `window.AnimationApp` を通じて外部 MOD からキャンバス・レイヤー・
コーディングタブを拡張できます。

---

## MOD でできること

| カテゴリ | できること |
|---|---|
| **カスタム図形** | 独自の描画ロジックを持つ図形タイプを追加 |
| **カスタムツール** | 右パネルにツールボタンを追加し、マウスイベントを乗っ取る |
| **カスタムブラシ** | ストローク描画を完全にコントロールするブラシを追加 |
| **コーディングブロック** | コーディングタブ（Blockly）に独自のトリガー・アクションブロックを追加 |
| **カスタム UI** | top / right / bottom / left / editor-top エリアに HTML パネルを追加 |
| **ファイルメニュー** | 「ファイル」メニューに独自の書き出し・読み込み項目を追加 |
| **Three.js 統合** | WebGL レンダラーを 2D レイヤーと同じ管理下に置く（レンダラー自体はMOD側で用意） |
| **シーン読み取り** | shapes / layers / インタラクション情報を取得して外部ツールと連携 |
| **外部ライブラリ** | `mod.json` の宣言、または `api.libraries` 経由でCDN上のライブラリを読み込む |

---

## MOD の構成

MOD は **ZIPファイル1つ**として配布・インストールします。ZIPの中身は次のとおりです。

```
my_mod.zip
├ mod.json    ← 必須。メタデータと読み込むファイルのリスト（manifest.json でも可）
├ main.js     ← エントリポイント
└ style.css   ← オプション
```

### mod.json の最小構成

```json
{
  "id": "my_mod",
  "name": "My MOD",
  "version": "1.0.0",
  "description": "説明",
  "scripts": ["main.js"],
  "styles": []
}
```

`scripts` を省略すると `main.js` が読み込まれます。`level` フィールドは
MOD一覧に表示されるだけの飾りで、権限制御には使われていません。
`enabled` フィールドは古いサーバー配布時代の名残で、現在は読まれません
（インストールしたMODは常に有効です。無効化したい場合はアンインストールします）。

`libraries` フィールド（省略可）で、外部ライブラリの宣言もできます。

```json
{
  "libraries": [
    { "id": "three", "name": "Three.js", "type": "script",
      "url": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js",
      "globalName": "THREE" }
  ]
}
```

宣言のみで即読み込みはされません。`main.js` 側で `api.libraries.get("three")`
（または `api.libraries.load(...)`）を呼んだ時点で初めて読み込まれます。
詳細は [MOD_API_REFERENCE.md](./MOD_API_REFERENCE.md#libraries--外部ライブラリの読み込み) を参照してください。

### main.js の最小構成

```js
(function () {
  const api = window.AnimationApp;
  if (!api) return;

  api.registerMod({
    id: "my_mod",
    name: "My MOD",
    version: "1.0.0",
    description: "説明"
  });

  // ここから機能を追加する
})();
```

即時関数 `(function(){ ... })()` で囲むことでグローバル汚染を防ぎます。

---

## 読み込みの仕組み

1. `mod.json`（または `manifest.json`）と `main.js` などをZIPにまとめる
2. ツールバーの「MOD」→「MODをインストール」からZIPを選ぶ
3. セキュリティ確認ダイアログで「インストール」を押す
4. ZIPの中身がブラウザの IndexedDB に保存され、`main.js` が実行される
5. 次回以降の起動時も、IndexedDBに保存されたMODが自動で読み込まれる

インストール済みMODは「MOD一覧」からアンインストールできます。
MODが追加したブロック・図形・UIなどを個別に取り消す仕組みは無いため、
アンインストール後は確認をはさんでページが自動的に再読み込みされます。

---

## 保存データへの影響

`addShape()` で追加した図形は `.mlc` プロジェクトファイルに保存されます。
再読み込み時にその MOD がインストールされていないと、図形タイプが未登録のまま
読み込まれます（データは失われません）。

保存データに MOD の識別子が記録されるため、必要な MOD が不足している場合は
警告が表示されます。

---

## 詳細リファレンス

- [MOD_API_REFERENCE.md](./MOD_API_REFERENCE.md) — 全 API の仕様
- [MOD_DEVELOPMENT_GUIDE.md](./MOD_DEVELOPMENT_GUIDE.md) — 実装手順
- [api.html](./api.html) — 同内容をブラウザで読めるドキュメントサイト

サンプルMODは同梱していません。上記のリファレンスと開発ガイドに、
実装例のコードを掲載しています。
