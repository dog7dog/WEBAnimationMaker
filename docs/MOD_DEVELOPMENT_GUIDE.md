# MOD 開発ガイド

このガイドではカスタム図形とツールを持つ MOD をゼロから作る手順を説明します。
サンプルMODは同梱していないため、下記のコードをそのまま出発点にしてください。

---

## ステップ 1: フォルダを作る

```
my_mod/
├ mod.json
└ main.js
```

最終的にこのフォルダの中身を **ZIPファイルにまとめて**配布・インストールします
（`mods/` のようなアプリ内フォルダは使いません）。
MOD ID はアルファベット・数字・アンダースコアのみ使えます。

---

## ステップ 2: mod.json を作る

```json
{
  "id": "my_mod",
  "name": "My MOD",
  "version": "1.0.0",
  "description": "最初の MOD です。",
  "scripts": ["main.js"],
  "styles": []
}
```

| フィールド | 説明 |
|---|---|
| `id` | システム内でユニークな識別子。`registerMod()` に渡す `id` と一致させる |
| `name` | MOD一覧に表示される名前 |
| `version` | セマンティックバージョン |
| `description` | MOD一覧に表示される説明文 |
| `scripts` | 読み込む JS ファイルのリスト（実行順。省略時は `main.js`） |
| `styles` | 読み込む CSS ファイルのリスト（省略可） |

ファイル名は `mod.json` / `manifest.json` のどちらでも認識されます。
`level` / `enabled` フィールドは受け付けはしますが、現在は読まれません
（詳細は [MOD_SDK.md](./MOD_SDK.md) を参照）。

---

## ステップ 3: main.js を作る

```js
(function () {
  const api = window.AnimationApp;
  if (!api) return;          // WEBAnimationMaker以外の環境対策

  // ── 登録 ────────────────────────────────────────────────
  api.registerMod({
    id: "my_mod",
    name: "My MOD",
    version: "1.0.0",
    description: "最初の MOD です。"
  });

  // ── 図形タイプの定義 ────────────────────────────────────
  api.registerShapeType("my_shape", {
    draw(ctx, s) {
      ctx.save();
      ctx.globalAlpha = (s.opa || 100) / 100;
      ctx.strokeStyle = s.color || "#fff";
      ctx.lineWidth = s.sw || 2;
      ctx.beginPath();
      ctx.rect(s.x, s.y, s.w, s.h);
      if (s.fill) { ctx.fillStyle = s.color; ctx.fill(); }
      ctx.stroke();
      ctx.restore();
    },
    getBounds(s) { return { x: s.x, y: s.y, w: s.w, h: s.h }; },
    getCenter(s) { return { x: s.x + s.w / 2, y: s.y + s.h / 2 }; },
    move(s, dx, dy) { s.x += dx; s.y += dy; },
    resize(s, handle, start, nx, ny, nw, nh) {
      s.x = nx; s.y = ny;
      s.w = Math.max(4, nw);
      s.h = Math.max(4, nh);
    },
    toSVG(s) {
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"
        fill="${s.fill ? s.color : 'none'}" stroke="${s.color}" stroke-width="${s.sw || 2}"/>`;
    }
  });

  // ── ツールボタン ────────────────────────────────────────
  api.registerTool({
    id: "my_tool",
    name: "My Shape",
    icon: "⬜"
  });

  // ── マウス操作でキャンバスに配置 ────────────────────────
  const cv = document.getElementById("cv");
  let drawing = false, startX = 0, startY = 0;

  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener("mousedown", function (e) {
    if (api.activeModTool?.id !== "my_tool") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const p = canvasPos(e);
    startX = p.x; startY = p.y;
    drawing = true;
  }, true);

  cv.addEventListener("mouseup", function (e) {
    if (!drawing || api.activeModTool?.id !== "my_tool") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drawing = false;

    const p = canvasPos(e);
    const x = Math.min(startX, p.x);
    const y = Math.min(startY, p.y);
    const w = Math.max(10, Math.abs(p.x - startX));
    const h = Math.max(10, Math.abs(p.y - startY));

    api.addShape({ type: "my_shape", name: "My Shape", x, y, w, h });

    // ツールを解除して選択ツールに戻る
    api.activeModTool = null;
    document.querySelectorAll(".rp-btn[data-mod-tool]")
            .forEach(b => b.classList.remove("active"));
    if (window.setTool) window.setTool("select");
  }, true);

})();
```

---

## ステップ 4: registerMod() を呼ぶ

`main.js` の先頭で必ず呼んでください。これを呼ばないと MOD がシステムに認識されません。

---

## ステップ 5: ツールや図形を登録する

`registerShapeType` → `registerTool` の順で登録するのが安全です。
両方とも `api.registerMod()` の後に呼んでください。

複数の図形タイプや複数のツールを登録することもできます。

---

## ステップ 6: ZIPにまとめてインストールする

```bash
cd my_mod
zip -X -r ../my_mod.zip mod.json main.js
```

1. WEBAnimationMaker を起動します。
2. ツールバーの「MOD」（パズルのアイコン）→「MODをインストール」から、
   作った ZIP を選びます。
3. セキュリティ確認ダイアログで「インストール」を押します。
4. MOD一覧に名前が出て、右パネルにボタンが追加されていれば認識されています。

うまく読み込まれない場合は、ブラウザの開発者ツールのコンソールに
`[MOD loaded]` のログが出ているか確認してください。`mod.json` のJSONが
壊れている、または `id`/`scripts` が抜けていると、インストール時にエラー
メッセージが表示されます。

---

## よくあるパターン

### プロパティパネルと連動する

選択中の図形のプロパティを変更したいとき:

```js
document.getElementById("my-slider").addEventListener("input", function () {
  api.setSelectedPatch({ myProp: Number(this.value) });
});
```

### カスタム UI を右パネルに追加する

```js
api.registerUI({
  id: "my_ui",
  position: "right",
  title: "オプション",
  html: `<label>サイズ <input id="my-size" type="range" min="10" max="200" value="60"></label>`,
  onMount(wrap, api) {
    wrap.querySelector("#my-size").addEventListener("input", function () {
      const s = api.getSelected();
      if (s && s.type === "my_shape") api.setSelectedPatch({ r: Number(this.value) });
    });
  }
});
```

### ファイルメニューに書き出し項目を追加する

```js
api.registerFileMenuItem({
  id: "my_export",
  label: "JSON で書き出し",
  icon: "ti-file-export",
  onClick(api) {
    const scene = api.getSceneSnapshot();
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "scene.json"; a.click();
    URL.revokeObjectURL(url);
    api.toast("ti-check", "書き出し完了");
  }
});
```

### コーディングタブに独自のブロックを追加する

既存のトリガー/アクション（クリック・スクロール・拡大・移動…）を組み合わせた
新しいブロックを追加できます。ツールボックス表示・CSS/JS生成・警告チェックは
自動でついてくるので、ブロックの見た目と組み合わせ方だけを書けば十分です。

```js
api.registerActionBlock("mod_glitch", {
  action: "skew",                                  // 既存のアクション種別のどれか
  parts: [{ el: "TARGET_EL" }, "にグリッチをかける"],
  toParams: (block) => ({ dx: 20, dy: -10 })
});

api.registerTriggerBlock("mod_when_double_tap", {
  trigger: "dblclick",                             // 既存のトリガー種別のどれか
  toggleMode: "toggle",
  parts: [{ el: "TRIGGER_EL" }, "をダブルタップしたら"]
});
```

詳しい仕様・対応する種別の一覧は
[MOD_API_REFERENCE.md](./MOD_API_REFERENCE.md#registertriggerblocktype-spec--registeractionblocktype-spec)
を参照してください。

### 追加した図形をコーディングタブで動かす

`addShape()` で追加した図形は、通常の図形と同じようにコーディングタブの
図形選択欄に並びます。動きを付けるのに特別な対応は不要です。

---

## チェックリスト

- [ ] `mod.json` の `id` と `registerMod()` に渡す `id` が一致している
- [ ] `main.js` が即時関数 `(function(){ ... })()` で囲まれている
- [ ] `api` の存在確認 (`if (!api) return`) がある
- [ ] `registerMod()` が最初に呼ばれている
- [ ] `draw()` 内で `ctx.save()` / `ctx.restore()` している
- [ ] `getBounds()` が正しいバウンディングボックスを返している
- [ ] マウスイベントで `e.preventDefault()` + `e.stopImmediatePropagation()` している
- [ ] 独自ブロックの `trigger` / `action` は、既存の対応種別のどれかにしている
