# Cannon.js Physics MOD

[cannon-es](https://github.com/pmndrs/cannon-es)（Cannon.jsの保守版フォーク）を使って、キャンバス上の図形に重力・衝突などの2D物理シミュレーションを追加するMODです。

## 機能

- ツールバーに「剛体」「床」タグ付けボタンと再生コントロールを追加
- 対応図形は四角形(`rect`)・円(`circle`)のみ
- 「剛体」は重力の影響を受けて動き、「床」は静止した壁・地面として機能します
- Z軸方向の移動とX/Y軸周りの回転を封じ、2D的な挙動になるようにしています（`linearFactor`/`angularFactor`）
- 重力・反発係数はツールバーの数値入力から調整可能
- 「リセット」で再生開始前の位置に戻せます

## 使い方

1. Magic Paint を起動し「Mods」を開いて `物理演算 (Cannon.js) MOD` を有効化する
2. 四角形や円を配置し、選択した状態でツールバーの「剛体」または「床」を押してタグ付け
3. ▶ ボタンで再生。重力に従って剛体が落下し、床や他の剛体と衝突します
4. ⏸ で停止、↺ で位置をリセット

## 注意点

- 初回再生時に cannon-es を CDN (jsdelivr) から動的読み込みします。オフライン環境では動作しません
- タイムラインのキーフレーム/GSAPアニメーションと物理演算は同時に再生できません（`physicsRunning` フラグで排他制御）
- 図形の削除・タイプ変更を物理演算の再生中に行うと、シミュレーション対象がズレる可能性があります。再生中の編集は避けてください

## ファイル構成

```
cannon_physics/
├ mod.json    メタデータ
├ main.js     物理シミュレーション本体
├ style.css   ツールバーUIの見た目
└ README.md   このファイル
```

## 参考ドキュメント

- [MOD_API_REFERENCE.md](../../docs/MOD_API_REFERENCE.md)
- [MOD_DEVELOPMENT_GUIDE.md](../../docs/MOD_DEVELOPMENT_GUIDE.md)
