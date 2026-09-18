// ══════════════════════════════════════════════════════════════
// 図形 → CSS宣言 の変換（DOM/CSSミラーと書き出しCSSの共通土台）
//   canvas座標系の図形データを、実DOM要素に適用できるCSS宣言へ変換する
//   純粋関数だけを置く（DOMには触らない）。
//   ライブのキャンバスタブ(dom-mirror.js)と、将来のCSS書き出しの
//   両方がこの1箇所を使うことで「見た目がズレない」を担保する。
//
//   要素構造は2階層にする:
//     .el-<id>            … 位置/サイズ/不透明度（Trigger/Actionのtransform対象）
//       └ .mlc-el-inner   … 図形自身の見た目（背景/枠/角丸/文字）と基準の回転
//   図形自身の回転を内側に置くのは、Trigger/Actionが外側にかけるCSS transform
//   （scale/rotate等）と打ち消し合わないようにするため。
//   （SVG側で同じ理由からネストした<g>に分けているのと同じ考え方）
// ══════════════════════════════════════════════════════════════

// div+CSSでは表現しづらく、内側に<svg>を入れて描く図形タイプ
const DOM_MIRROR_DIV_TYPES = ['rect', 'circle', 'text', 'webgl-image', 'image'];

function shapeUsesInnerSvg(s) {
  return !DOM_MIRROR_DIV_TYPES.includes(s?.type);
}

// 図形1つ分のCSS宣言を { outer, inner } で返す
// origin を渡すとその点からの相対位置になる（グループの中に入れるときに使う）
function shapeToCssDecl(s, origin) {
  const b = getBounds(s);
  const ox = origin ? origin.x : 0;
  const oy = origin ? origin.y : 0;
  // 画面に貼り付く図形は、スクロールしても同じ位置に残す。
  //   position:sticky を使う。fixed だと基準がブラウザの画面になり、
  //   プレビューではアプリのUIの上にはみ出してしまう。sticky なら
  //   「ページ（ステージ）の中で、画面の上から◯px の所に留まる」になり、
  //   書き出したページでもプレビューでも同じCSSのまま正しく貼り付く。
  //   流れの中に置く必要があるので、他の図形（絶対配置）とは別扱いにし、
  //   場所取りぶんの高さは margin で打ち消す。
  //   グループの中の図形は、外枠ごと動くので対象外。
  const sticky = !!s.sticky && !origin;
  const outer = sticky ? {
    position: 'sticky',
    top: Math.round(b.y) + 'px',
    'margin-left': Math.round(b.x) + 'px',
    'margin-bottom': (-Math.round(b.h)) + 'px',
    'z-index': '5',
  } : {
    position: 'absolute',
    left: Math.round(b.x - ox) + 'px',
    top: Math.round(b.y - oy) + 'px',
    width: Math.round(b.w) + 'px',
    height: Math.round(b.h) + 'px',
    'box-sizing': 'border-box',
    opacity: String((s.opa ?? 100) / 100),
    // Trigger/ActionのCSS transformが要素の中心を基準に効くようにする
    'transform-origin': 'center'
  };
  if (sticky) {
    outer.width = Math.round(b.w) + 'px';
    outer.height = Math.round(b.h) + 'px';
    outer['box-sizing'] = 'border-box';
    outer.opacity = String((s.opa ?? 100) / 100);
    outer['transform-origin'] = 'center';
  }

  const inner = {
    width: '100%',
    height: '100%',
    'box-sizing': 'border-box'
  };

  if (shapeUsesInnerSvg(s)) {
    // 内側<svg>で描く図形（多角形・三角形など）は、SVGの頂点計算の時点で
    // 既に s.rot が反映されている。線・ペンはそもそも回転を持たない。
    // ここで再度 rotate すると二重回転になるので何もしない。
    return { outer, inner };
  }

  const rot = Number(s.rot) || 0;
  if (rot) {
    inner.transform = 'rotate(' + rot + 'deg)';
    inner['transform-origin'] = 'center';
  }

  const stroke = Number(s.sw) || 0;

  switch (s.type) {
    case 'rect':
      if (s.fill) inner.background = s.color;
      if (stroke > 0) inner.border = stroke + 'px solid ' + shapeStrokeColor(s);
      if (s.rr) inner['border-radius'] = Math.round(s.rr) + 'px';
      break;

    case 'circle':
      if (s.fill) inner.background = s.color;
      if (stroke > 0) inner.border = stroke + 'px solid ' + shapeStrokeColor(s);
      inner['border-radius'] = '50%';
      break;

    case 'text': {
      const fs = Number(s.fontSize) || 24;
      inner.color = s.color;
      inner['font-family'] = s.fontFamily || 'sans-serif';
      inner['font-size'] = fs + 'px';
      inner['line-height'] = Math.round(fs * 1.3) + 'px';
      inner.padding = '4px';
      inner['white-space'] = 'pre-wrap';
      inner['overflow-wrap'] = 'break-word';
      break;
    }

    case 'webgl-image':
    case 'image':
      if (s.src) {
        inner['background-image'] = 'url("' + s.src + '")';
        inner['background-size'] = '100% 100%';
        inner['background-repeat'] = 'no-repeat';
      }
      break;
  }

  return { outer, inner };
}

// { color: 'red' } → "color:red;color2:..." （インラインstyle属性用）
function cssDeclToInlineStyle(decl) {
  return Object.entries(decl || {})
    .map(([k, v]) => k + ':' + v)
    .join(';');
}

// 図形1つ分のCSSルール（.el-<id> と その内側）を組み立てる。
//   インラインstyleではなくCSSルールとして出すのが重要。
//   インラインstyleはクラスセレクタより強いため、Trigger/Actionが生成する
//   `.el-x:hover { opacity: … }` のようなルールが打ち消されてしまう。
//   ルールとして出しておけば通常のカスケードで上書きでき、
//   そのままWebサイトへコピーできるCSSにもなる。
function shapeCssRules(s, i, origin) {
  const { outer, inner } = shapeToCssDecl(s, origin);
  const cls = '.el-' + safeCssIdent(s.id || ('s' + i));
  return cls + ' {\n' + cssDeclToText(outer) + '\n}\n'
    + cls + ' > .mlc-el-inner {\n' + cssDeclToText(inner) + '\n}';
}

// { color: 'red' } → "  color: red;\n..." （CSSルール本体用）
function cssDeclToText(decl, indent = '  ') {
  return Object.entries(decl || {})
    .map(([k, v]) => indent + k + ': ' + v + ';')
    .join('\n');
}

// ── グループ ─────────────────────────────────────────────────
// グループはメンバーを内包する1つの要素として扱う。
// 外側に .grp-<groupId> を置き、その中にメンバーを相対配置することで、
// Trigger/Actionの対象に「グループ全体」を指定できるようにする
// （拡大・移動・フェードなどがまとまって効く）。
function groupCssRules(groupId) {
  const b = getGroupBounds(groupId);
  if (!b) return '';
  const decl = {
    position: 'absolute',
    left: Math.round(b.x) + 'px',
    top: Math.round(b.y) + 'px',
    width: Math.round(b.w) + 'px',
    height: Math.round(b.h) + 'px',
    'transform-origin': 'center'
  };
  return '.grp-' + safeCssIdent(groupId) + ' {\n' + cssDeclToText(decl) + '\n}';
}

// Trigger/Actionの対象id → CSSセレクタ。
// グループは 'grp:<groupId>' という形の対象idで指定する。
function interactionTargetSelector(targetId) {
  const raw = String(targetId || '');
  return raw.startsWith('grp:')
    ? '.grp-' + safeCssIdent(raw.slice(4))
    : '.el-' + safeCssIdent(raw);
}
