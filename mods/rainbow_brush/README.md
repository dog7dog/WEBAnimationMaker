# Rainbow Brush MOD

ストロークを描いた距離に応じて色相(hue)が連続的に変化する虹色ブラシを追加する MOD です。

## 機能

- 🌈 ボタンを右パネルに追加
- 描画した長さに比例して赤→橙→黄→緑→青→紫と色が滑らかに変化
- プレビュー・SVG 書き出し（`.mlc` 保存 / エクスポート）にも対応

## 使い方

1. Magic Paint を起動し「Mods」を開いて `Rainbow Brush` を有効化する
2. 右パネルに 🌈 ボタンが表示される
3. 🌈 を選択してキャンバス上でドラッグすると虹色の線が描ける

## ファイル構成

```
rainbow_brush/
├ mod.json    メタデータ
├ main.js     ブラシの登録と描画ロジック
├ style.css   ツールボタンの見た目
└ README.md   このファイル
```

## カスタマイズのポイント

- `HUE_PER_PX`（main.js 冒頭）を変えると色の変化速度を調整できます
- `s.hueStart` を図形データに持たせると、ストロークごとに開始色をずらせます

## 参考ドキュメント

- [MOD_API_REFERENCE.md](../../docs/MOD_API_REFERENCE.md)
- [MOD_DEVELOPMENT_GUIDE.md](../../docs/MOD_DEVELOPMENT_GUIDE.md)
