// ══════════════════════════════════════════════════════════════
// DOM/CSSミラー（キャンバスタブの実体）
//   図形データから「実際のDOM要素 + CSS」を組み立てる。
//   canvasにピクセルを描くのではなく本物のdiv/svgを並べるので、
//   生成したCSS/JSをそのまま動かせる＝Webサイトへコピーしたときと
//   同じものをプレビューできる。
//
//   幾何→CSSの対応は AppCore/canvas/domStyle.js に集約し、
//   ここはDOMの組み立てとステージ管理だけを担当する。
//
//   デザイン面(<canvas id="cv">)は従来どおりマウス編集用として残す。
//   両者は同じ getBounds()/getCenter() を見るので座標がズレない。
// ══════════════════════════════════════════════════════════════

function ensureMlcStage() {
  return document.getElementById('mlc-stage');
}

function _mirrorShapeVisible(s) {
  if (!s || s.hidden) return false;
  if (typeof layerIsVisible === 'function' && typeof layers !== 'undefined') {
    const layer = layers.find(l => l.id === (s.layerId || 'layer-1'));
    if (layer && !layerIsVisible(layer)) return false;
  }
  return true;
}

// 図形1つ分のDOM（外側div + 内側div[+svg]）を組み立てる
function buildMirrorElementHtml(s, i, origin) {
  if (!_mirrorShapeVisible(s)) return '';

  const cls = 'el-' + safeCssIdent(s.id || ('s' + i));

  let content = '';

  if (shapeUsesInnerSvg(s)) {
    // div+CSSで表せない図形は、外側divの矩形にぴったり合わせた<svg>で描く。
    // 内側SVGにはクラスを付けない（Trigger/Actionの対象は常に外側のdiv）。
    const b = getBounds(s);
    const svgInner = buildShapeSVGElement(s, i, { x: 0, y: 0 }, { className: '' });
    if (!svgInner) return '';
    content = '<svg width="100%" height="100%" viewBox="'
      + Math.round(b.x) + ' ' + Math.round(b.y) + ' '
      + Math.max(1, Math.round(b.w)) + ' ' + Math.max(1, Math.round(b.h))
      + '" style="overflow:visible;display:block">' + svgInner + '</svg>';
  } else if (s.type === 'text') {
    content = escapeHtml(s.text || '');
  }

  // スタイルはインラインではなくCSSルール側(buildMirrorStageCss)で当てる。
  // インラインstyleはクラスセレクタより強く、Trigger/Actionの生成CSS
  // (.el-x:hover 等)が効かなくなるため。
  return '<div class="' + cls + '">'
    + '<div class="mlc-el-inner">' + content + '</div>'
    + '</div>';
}

// ミラー内の全図形分のCSSルールをまとめて作る
// グループは1つの要素として扱うので、グループ枠 → メンバー(相対位置) の順に出す
function _eachMirrorEntry(fn) {
  if (typeof ensureShapeIds === 'function') ensureShapeIds();
  const drawnGroups = new Set();
  (shapes || []).forEach((s, i) => {
    if (!_mirrorShapeVisible(s)) return;

    if (s.groupId) {
      if (drawnGroups.has(s.groupId)) return;
      drawnGroups.add(s.groupId);
      const b = getGroupBounds(s.groupId);
      if (!b) return;
      const members = getGroupMembers(s.groupId).filter(_mirrorShapeVisible);
      if (!members.length) return;
      fn({ kind: 'group', groupId: s.groupId, bounds: b, members });
      return;
    }

    fn({ kind: 'shape', shape: s, index: i });
  });
}

function buildMirrorStageCss() {
  const out = [];
  _eachMirrorEntry(entry => {
    if (entry.kind === 'group') {
      out.push(groupCssRules(entry.groupId));
      const origin = { x: entry.bounds.x, y: entry.bounds.y };
      entry.members.forEach(m => out.push(shapeCssRules(m, shapes.indexOf(m), origin)));
      return;
    }
    out.push(shapeCssRules(entry.shape, entry.index));
  });
  out.push(buildSnapCss());
  return out.filter(Boolean).join('\n');
}

// 図形のCSSは、Trigger/Actionの生成CSSより「前」に置く必要がある
// （同じ詳細度なら後勝ちのため、インタラクション側が上書きできるように）
function _mirrorStyleEl() {
  let el = document.getElementById('mlc-shapes-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'mlc-shapes-style';
    const interactionsStyle = document.getElementById('mlc-interactions-style');
    if (interactionsStyle) document.head.insertBefore(el, interactionsStyle);
    else document.head.appendChild(el);
  }
  return el;
}

// ページごとに吸い付く（スナップ）ための目印。
// 1画面ぶんごとに置いた点に吸着させるので、要素の配置には影響しない。
function buildSnapMarkersHtml() {
  if (!pageSnap) return '';
  const step = Number(pageViewHeight) || 0;
  if (step < 40) return '';
  const out = [];
  for (let y = 0; y < (docH || 720); y += step) {
    out.push('<div class="mlc-snap" style="top:' + Math.round(y) + 'px"></div>');
  }
  return out.join('\n');
}

function buildSnapCss() {
  if (!pageSnap) return '';
  // スクロールする側（書き出し先ではページ全体、プレビューではステージの外枠）
  return 'html, #mlc-stage-wrap { scroll-snap-type: y proximity; }\n'
    + '.mlc-snap { position: absolute; left: 0; width: 1px; height: 1px;'
    + ' pointer-events: none; scroll-snap-align: start; }';
}

function buildMirrorStageHtml() {
  const out = [];
  _eachMirrorEntry(entry => {
    if (entry.kind === 'group') {
      const origin = { x: entry.bounds.x, y: entry.bounds.y };
      const inner = entry.members
        .map(m => buildMirrorElementHtml(m, shapes.indexOf(m), origin))
        .filter(Boolean)
        .join('\n  ');
      if (!inner) return;
      out.push('<div class="grp-' + safeCssIdent(entry.groupId) + '">\n  ' + inner + '\n</div>');
      return;
    }
    out.push(buildMirrorElementHtml(entry.shape, entry.index));
  });
  const snap = buildSnapMarkersHtml();
  if (snap) out.push(snap);
  return out.filter(Boolean).join('\n');
}

// ステージ全体を作り直す。表示領域に収まるよう縮小表示もここで行う。
function syncDomMirror() {
  const stage = ensureMlcStage();
  if (!stage) return;

  stage.style.width = (docW || 1280) + 'px';
  stage.style.height = (docH || 720) + 'px';
  stage.style.background = canvasBg || '#111111';
  _mirrorStyleEl().textContent = buildMirrorStageCss();
  stage.innerHTML = buildMirrorStageHtml();

  // 横がはみ出す場合だけ縮小する。縦は長いページを作れるので基準にしない
  // （高さにも合わせると、縦長のページが極端に小さく表示されてしまう）。
  // はみ出す分はスクロールして見る。
  //
  // 縮小には transform: scale() ではなく zoom を使う。transform は
  // 祖先要素にスタッキングコンテキスト/コンテイニングブロックを作ってしまい、
  // 「画面に貼り付く」(position: sticky) の子要素が正しく貼り付かなくなる
  // （スクロールしても追従せず画面外へ流れて行ってしまう）。zoom はレイアウト
  // そのものを縮めるので sticky が壊れず、場所取りぶんの高さ調整も不要になる。
  const wrap = stage.parentElement;
  if (wrap) {
    const availW = wrap.clientWidth - 32;
    const k = Math.min(1, availW / (docW || 1280));
    stage.style.zoom = k < 1 ? String(k) : '';
    stage.style.transform = '';
    stage.style.transformOrigin = '';
    stage.style.marginBottom = '';
  }

  // ノードを作り直したのでリスナーも失われている。プレビュー中なら貼り直す。
  if (typeof reattachInteractionListeners === 'function') reattachInteractionListeners();
}
