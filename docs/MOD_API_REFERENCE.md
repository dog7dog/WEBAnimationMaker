# MOD API Reference

`window.AnimationApp` が WEBAnimationMaker の公開 API です。  
MOD の `main.js` 内で `const api = window.AnimationApp;` として参照します。

---

## registerMod(mod)

MOD をシステムに登録します。`main.js` の先頭で必ず呼んでください。

```js
api.registerMod({
  id: "my_mod",          // 必須。ユニークな識別子
  name: "My MOD",        // 表示名
  version: "1.0.0",
  description: "説明文"
});
```

---

## registerTool(tool)

右パネルにツールボタンを追加します。

```js
api.registerTool({
  id: "my_tool",         // 必須
  name: "マイツール",    // ボタンの title に表示
  icon: "◆"             // ボタン内 HTML（絵文字・HTMLどちらも可）
});
```

アクティブなツールか確認するには:

```js
if (api.activeModTool?.id === "my_tool") { ... }
```

---

## registerBrush(brush)

カスタムブラシを登録します。ストローク描画を自分でコントロールできます。

```js
api.registerBrush({
  id: "my_brush",
  name: "マイブラシ",
  icon: "🖌",
  // 必須: ストロークの全ポイントを毎フレーム受け取って描画する
  draw(ctx, points, opts) {
    ctx.save();
    ctx.strokeStyle = opts.color || "#fff";
    ctx.lineWidth = opts.sw || 4;
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
  },
  // 任意: レイヤーパネルのサムネイル用SVGを返す
  toSVG(shape) { ... }
});
```

`draw(ctx, points, opts)` は、ストローク中は毎回**全ポイント配列**（`{ x, y }` の配列）を受け取って呼ばれます
（`onStart`/`onMove`/`onEnd` のような分割コールバックはありません）。`opts` は描画中
（ストロークプレビュー時）は `{ color, sw, opa, preview: true }`、確定後の再描画時は
保存された shape オブジェクトそのものが渡されます。

---

## registerShapeType(type, renderer)

カスタム図形タイプを登録します。`draw` が必須で、残りは省略可能です。

```js
api.registerShapeType("my_shape", {
  // 必須: Canvas 2D で図形を描画する
  draw(ctx, s) {
    ctx.save();
    ctx.globalAlpha = (s.opa || 100) / 100;
    ctx.strokeStyle = s.color || "#fff";
    ctx.lineWidth = s.sw || 2;
    // ... 描画処理 ...
    ctx.restore();
  },

  // バウンディングボックスを返す
  getBounds(s) {
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  },

  // 中心座標を返す
  getCenter(s) {
    return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  },

  // 移動
  move(s, dx, dy) {
    s.x += dx;
    s.y += dy;
  },

  // リサイズ（handle: 'se'|'sw'|'ne'|'nw'|'n'|'s'|'e'|'w'）
  resize(s, handle, start, nx, ny, nw, nh) {
    s.x = nx; s.y = ny;
    s.w = Math.max(4, nw);
    s.h = Math.max(4, nh);
  },

  // SVG 書き出し用（レイヤーパネルのサムネイル表示に使われる）
  toSVG(s) {
    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"
              fill="none" stroke="${s.color}" stroke-width="${s.sw || 2}"/>`;
  }
});
```

> `registerShapeType` で追加した図形は、デザインタブの自前キャンバス上でのみ
> `draw()` によって描画されます。HTML書き出しやキャンバスタブのDOMプレビューは
> 参照しないため、そのままでは書き出したページ上に表示されません。書き出した
> ページでも見た目を再現したい場合は、`registerActionBlock` 等でCSS/JSとして
> 別途表現するか、書き出し後のHTMLに手を加える必要があります。

---

## addShape(shape)

キャンバスに図形を追加します。アクティブレイヤーに自動で配置されます。

```js
api.addShape({
  type: "my_shape",      // registerShapeType で登録した type
  name: "マイ図形",      // レイヤーパネルの表示名
  x: 100, y: 100,
  w: 120, h: 80,
  // color / sw / opa / dash / fill / rot は省略時にエディタ設定値が使われる
});
```

**Shape の共通フィールド:**

| フィールド | 型 | 説明 |
|---|---|---|
| `type` | string | 図形タイプ |
| `name` | string | レイヤーパネル表示名 |
| `color` | string | 色 (CSS color) |
| `sw` | number | 線の太さ |
| `opa` | number | 不透明度 (0–100) |
| `dash` | string | 破線パターン例: `"5,3"` |
| `fill` | boolean | 塗りつぶし |
| `rot` | number | 回転角度 (度) |
| `hidden` | boolean | 個別非表示 |
| `engine` | string | `"canvas2d"` (省略時) または `"threejs"` |
| `layerId` | string | 配置レイヤー (省略時はアクティブレイヤー) |

---

## getSelected()

現在選択中の図形オブジェクトを返します。未選択時は `null`。

```js
const s = api.getSelected();
if (s) console.log(s.type, s.x, s.y);
```

---

## setSelectedPatch(patch)

選択中の図形のプロパティを更新し、パネルを同期します。

```js
api.setSelectedPatch({ color: "#ff0000", sw: 4 });
```

---

## redraw()

キャンバスを再描画します。

```js
api.redraw();
```

---

## registerTriggerBlock(type, spec) / registerActionBlock(type, spec)

コーディングタブ（Blockly）に、独自のトリガー・アクションブロックを追加します。

追加したブロックは、既存のトリガー/アクション（クリック・スクロール・拡大・移動…）と
同じ仕組みに間借りするので、ツールボックスへの表示・CSS/JS生成・警告チェックは
自動でついてきます。MOD側で追加の登録は不要です。そのぶん、`trigger` / `action` には
**既存の種別のどれか**を指定する必要があります（表は下記）。まったく新しい効果を
CSSレベルから足したい場合はこの2つの対象外です。

```js
// アクションブロックの例: 傾ける(skew)を使った「グリッチ」ブロック
api.registerActionBlock("mod_glitch", {
  action: "skew",              // 必須。INTERACTION_ACTION_TYPES のいずれか
  category: "action",          // 省略可。"action"(既定) / "entrance" / "exit" / "loop"
  duration: 0.3,                // 省略可。時間欄の既定値（秒）
  parts: [{ el: "TARGET_EL" }, "にグリッチをかける"],
  tooltip: "一瞬だけガタつかせます",
  toParams: (block) => ({ dx: 20, dy: -10 })
});

// トリガーブロックの例: ダブルタップ(dblclickを流用)
api.registerTriggerBlock("mod_when_double_tap", {
  trigger: "dblclick",         // 必須。INTERACTION_TRIGGER_TYPES のいずれか
  toggleMode: "toggle",        // 必須。INTERACTION_TOGGLE_MODES のいずれか
  parts: [{ el: "TRIGGER_EL" }, "をダブルタップしたら"]
});
```

`type` はアプリ内で一意な識別子です。他のMODや組み込みブロックと衝突しないよう、
`"mod_<あなたのMODのid>_..."` のように名前空間を切ってください。重複していたり
`trigger`/`action` が未対応の種別だと、コンソールに警告を出して登録を拒否します
（`false` が返ります）。

`parts` の書式は `registerShapeType` 等と同じ Blockly ブロックの部品指定です。
`{ el: "NAME" }`（図形選択）・`{ num: "NAME", def, min, max, step }`（数値）・
`{ menu: "NAME", options }`（選択肢）・`{ text: "NAME", def }`（文字入力）・
文字列そのまま（ラベル）が使えます。

**INTERACTION_TRIGGER_TYPES**: `click` `dblclick` `hover` `press` `inview` `load`
`key` `scroll` `scrollpage` `scrollany` `timer` `scrollview` `scrollprogress`

**INTERACTION_TOGGLE_MODES**: `once`（1回きり）`hold`（押している/乗っている間）
`toggle`（ON/OFF切り替え）`scrub`（スクロール位置に連動。`scrollview`/`scrollprogress`専用）

**INTERACTION_ACTION_TYPES**: `scale` `fade` `move` `slide` `rotate` `show` `hide`
`skew` `flip` `stretch` `blur` `brightness` `grayscale` `saturate` `hue` `glow`
`pulse` `spin` `float` `shake` `swing` `blink` `bounce` `path`

`toParams(block)` は単一の `{ type: action, params }` を、`toActions(block)` は
複数のアクション `[{ type, params }, ...]` を組み立てます（どちらか一方が必須）。
複数のアクションを1ブロックにまとめたい場合（例: 拡大しながらフェード）は
`toActions` を使ってください。組み込みの「大きくしながら出す」ブロックが実例です。

---

## registerUI(ui)

任意のパネルエリアにカスタム UI を追加します。

```js
api.registerUI({
  id: "my_ui",
  position: "right",     // "top" | "right" | "bottom" | "left" | "editor-top"
  title: "マイ設定",     // オプション
  html: `<button onclick="doSomething()">実行</button>`,

  // render / onMount で DOM を直接操作することもできる
  render(wrap, api) { ... },
  onMount(wrap, api) { ... }
});
```

---

## registerFileMenuItem(item)

ファイルメニューにアイテムを追加します。

```js
api.registerFileMenuItem({
  id: "my_export",
  label: "カスタム書き出し",
  icon: "ti-download",   // Tabler Icons クラス名（省略可）
  onClick(api) {
    // 書き出し処理
  }
});
```

---

## createLayer(options)

新しいレイヤーを作成してレイヤーパネルに追加します。作成したレイヤーがアクティブになります。

```js
const layer = api.createLayer({
  name: "WebGL Effects",    // 省略時 "New Layer"
  type: "normal",           // "normal"（省略時）または "folder"
  parentId: null,           // フォルダ内に入れる場合は親フォルダの id
  color: "#8b5cf6",         // レイヤーパネルのカラードット（省略時なし）
  visible: true,            // 省略時 true
  locked: false,            // 省略時 false
  opacity: 1,               // 0.0〜1.0（省略時 1）
  blendMode: "source-over"  // CSS globalCompositeOperation（省略時 "source-over"）
});
// → 作成したレイヤーオブジェクトを返す
```

**典型的な使い方（addObject と組み合わせる）:**

```js
const layer = api.createLayer({ name: "Particle Layer", color: "#ff9900" });

api.addObject({
  engine: "threejs",
  type: "particle",
  name: "パーティクル",
  layerId: layer.id       // 作成したレイヤーに配置
});
```

**フォルダを作成してレイヤーを入れる:**

```js
const folder = api.createLayer({ name: "WebGL Group", type: "folder" });
const child  = api.createLayer({ name: "Effects",     parentId: folder.id });
```

> `type: "folder"` のレイヤーは `addShape` / `addObject` の対象になりません。
> 図形の追加先は `getDrawableActiveLayerId()` が自動的に子レイヤーへ振り分けます。

---

## getLayers / isLayerVisible / isLayerLocked

```js
// 全レイヤーを取得
const layers = api.getLayers();
// 例: [ { id, name, type, visible, locked, opacity, ... }, ... ]

// レイヤー状態の確認（フォルダの継承も考慮）
api.isLayerVisible("layer-1");  // → boolean
api.isLayerLocked("layer-1");   // → boolean
```

---

## addObject(obj) / removeObject(id) / updateObject(id, patch)

Three.js など非 Canvas2D エンジンのオブジェクトを shapes[] に登録します。

```js
const obj = api.addObject({
  type: "my_3d_object",
  engine: "threejs",          // 省略時 "threejs"
  name: "3Dオブジェクト",
  color: "#3B8AE6",
  sw: 1, opa: 100, dash: "0", fill: false
});

api.updateObject(obj.id, { name: "名前変更" });
api.removeObject(obj.id);
```

---

## registerThreeRenderer(callbacks)

Three.js レンダラーがレイヤー状態の変化を受け取るためのコールバックを登録します。

```js
api.registerThreeRenderer({
  onLayerVisibility(layerId, visible) { ... },
  onLayerLock(layerId, locked)        { ... },
  onObjectHidden(objectId, hidden, shape) { ... }
});
```

---

## ユーティリティ

```js
api.toast("ti-check", "完了しました");   // トースト通知
api.setStatus("処理中...");              // ステータスバー

const bounds = api.getBounds(shape);    // → { x, y, w, h }
const center = api.getCenter(shape);    // → { x, y }

const snapshot = api.getSceneSnapshot();
// → { width, height, bg, fps, shapes[] }
```

---

## getObjectsByLayer(layerId) / getObjectsByEngine(engine)

```js
// 特定レイヤーの全オブジェクト（エンジン問わず）
api.getObjectsByLayer("layer-1");

// 特定エンジンの全オブジェクト
api.getObjectsByEngine("threejs");
```

---

## getAsset(modId, path)

ZIP形式でインストールしたMODに同梱したアセット（画像など）の Blob URL を取得します。

```js
const url = api.getAsset("my_mod", "assets/icon.png");
img.src = url;
```

MODの実行コード内（`main.js`）では、`__assets["assets/icon.png"]` で直接参照する方が簡単です。
`getAsset` は他のMODのアセットを参照したい場合や、`modId` を動的に扱いたい場合に使います。

---

## libraries — 外部ライブラリの読み込み

MODが Three.js や物理演算エンジンなど、外部ライブラリをCDN等から読み込むための唯一の窓口です。
テキストエディタやAI生成コードから外部URLへ直接 `<script>` を差し込むことはできない仕組みになっており、
読み込みは必ずこの `api.libraries` を経由します。

```js
// 宣言 + 即読み込み（Promiseで本体が返る）
const THREE = await api.libraries.load({
  id: "three",              // 省略時は name を使う
  name: "Three.js",
  type: "script",           // "script"(既定・UMDグローバル) | "module"(ES Module)
  url: "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js",
  globalName: "THREE"       // type: "script" のとき、読み込み後に window から取り出す変数名
});

// 「使えるようにだけしておく」宣言のみ（即読み込みしない）
api.libraries.declare("cannon", {
  name: "Cannon-es",
  type: "module",
  url: "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js"
});

// 登録済みか確認してから取得（初回のみ読み込み、以降はキャッシュを返す）
if (api.libraries.has("cannon")) {
  const CANNON = await api.libraries.get("cannon");
}

// 登録済み一覧
api.libraries.list();
// → [{ id, name, description, source, globalName }, ...]
```

`load` が渡す `opts.load` にカスタム関数を指定すると、UMD以外の特殊な読み込み処理
（グローバル変数名が動的に決まる場合など）にも対応できます。`mod.json` の
`libraries` フィールドで宣言した内容も、内部的にはこの `declare()` と同じ扱いになります。
