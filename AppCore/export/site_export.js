// ══════════════════════════════════════════════════════════════
// Webページとしての書き出し
//   キャンバスタブに出ているものと同じ HTML + CSS + JS を書き出す。
//   プレビュー用の別実装を作らず、dom-mirror.js / codegen-css.js /
//   codegen-js.js の出力をそのまま束ねるだけにしてあるので、
//   「Magic Paintでは動いたのにコピーしたら動かない」が起きない。
// ══════════════════════════════════════════════════════════════

function buildSiteParts() {
  // 「変形」「軌道」は図形の今の位置から差分を出している。書き出す直前に
  // ブロックからルールを作り直して、最新の配置を反映する
  // （キャンバスタブを開かずに書き出しても古い位置にならないように）。
  if (typeof refreshInteractionsFromBlockly === 'function') refreshInteractionsFromBlockly();

  const shapesCss = typeof buildMirrorStageCss === 'function' ? buildMirrorStageCss() : '';
  const bodyHtml = typeof buildMirrorStageHtml === 'function' ? buildMirrorStageHtml() : '';
  const { css: interactionCss, js } =
    typeof generateInteractionCode === 'function' ? generateInteractionCode() : { css: '', js: '' };

  const stageCss =
    '#mlc-stage {\n'
    + '  position: relative;\n'
    + '  width: ' + (docW || 1280) + 'px;\n'
    + '  height: ' + (docH || 720) + 'px;\n'
    + '  background: ' + (canvasBg || '#111111') + ';\n'
    // clip にしておくと、はみ出しは隠しつつ「スクロールする枠」にはならない。
    // hidden だとステージ自身がスクロール枠と見なされ、スクロール連動の
    // 結びつけ先がここで止まってしまう（ページのスクロールに繋がらない）。
    + '  overflow: clip;\n'
    + '}';

  return { stageCss, shapesCss, interactionCss, js, bodyHtml };
}

// そのまま貼れる1枚のHTMLを組み立てる
function buildSiteHtml() {
  const { stageCss, shapesCss, interactionCss, js, bodyHtml } = buildSiteParts();
  const title = (document.getElementById('proj-name')?.textContent || 'Magic Paint').replace('.mlc', '');

  return '<!DOCTYPE html>\n'
    + '<html lang="ja">\n<head>\n<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '<title>' + escapeHtml(title) + '</title>\n'
    + '<style>\n'
    + 'body { margin: 0; display: flex; justify-content: center; align-items: center;\n'
    + '       min-height: 100vh; background: #1b1b1b; }\n\n'
    + '/* ── ステージ ── */\n' + stageCss + '\n\n'
    + '/* ── 図形 ── */\n' + shapesCss + '\n\n'
    + '/* ── インタラクション ── */\n' + (interactionCss || '/* なし */') + '\n'
    + '</style>\n</head>\n<body>\n'
    + '<div id="mlc-stage">\n' + bodyHtml + '\n</div>\n'
    + (js.trim() ? '<script>\n' + js + '\n</script>\n' : '')
    + '</body>\n</html>\n';
}

function exportSiteHtml() {
  if (typeof ensureShapeIds === 'function') ensureShapeIds();
  const html = buildSiteHtml();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const name = (document.getElementById('proj-name')?.textContent || 'magic-paint').replace('.mlc', '');

  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (typeof closeFileMenu === 'function') closeFileMenu();
  if (typeof toast === 'function') toast('ti-file-export', 'HTMLを書き出しました');
}

// 直前に開いたプレビュー窓。ここの表示サイズが「実際の1ページ」になる。
let _sitePreviewWin = null;

// 窓の「外枠」を指定して開いても、タイトルバーのぶん中身は小さくなる。
// 中身がキャンバスの幅ちょうどになるよう、開いたあとで差を詰める。
// （こうしておかないと「プレビューに合わせる」を押すたびに幅がずれていく）
function _fitPreviewWindowToPage(win) {
  let tries = 0;
  const timer = setInterval(() => {
    let inner = 0;
    try { inner = win.closed ? -1 : win.innerWidth; } catch (e) { inner = -1; }
    if (inner < 0 || ++tries > 20) { clearInterval(timer); return; }
    if (!inner) return;
    clearInterval(timer);
    const diff = (docW || 1280) - inner;
    if (Math.abs(diff) < 2) return;
    try { win.resizeBy(diff, 0); } catch (e) { /* 動かせない環境もある */ }
  }, 100);
}

// プレビュー窓の表示範囲（px）。開いていない・読めない場合は null。
//   窓は開いたあとで大きさを変えられるので、値は毎回その場で測る。
function getSitePreviewViewport() {
  try {
    const w = _sitePreviewWin;
    if (w && !w.closed && w.innerWidth > 0 && w.innerHeight > 0) {
      return { w: Math.round(w.innerWidth), h: Math.round(w.innerHeight) };
    }
  } catch (e) {
    // 別ドメイン扱いなどで読めないことがある（file:// で開いた場合など）
  }
  return null;
}

// 別タブで開いて動作を確認する（書き出すものと同じHTML）
//   opts.fullSize: 画面いっぱいの大きさで開く。
//     「1ページをプレビューに合わせる」で基準にする窓は、キャンバスの
//     大きさから決めると堂々巡りになる（窓に合わせる→次はその窓の大きさが
//     基準になる…）ので、実際の閲覧に近い大きさで開く。
function openSitePreview(opts = {}) {
  if (typeof ensureShapeIds === 'function') ensureShapeIds();
  const blob = new Blob([buildSiteHtml()], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const size = opts.fullSize
    ? { w: screen.availWidth, h: screen.availHeight }
    : { w: Math.min((docW || 1280) + 80, 1400), h: Math.min((docH || 720) + 120, 900) };
  const win = window.open(url, 'mlc-site-preview', 'width=' + size.w + ',height=' + size.h);
  if (!win) {
    if (typeof toast === 'function') toast('ti-alert-triangle', 'ポップアップをブロックされました');
  } else {
    _sitePreviewWin = win;
    if (!opts.fullSize) _fitPreviewWindowToPage(win);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  if (typeof closeFileMenu === 'function') closeFileMenu();
}

window.exportSiteHtml = exportSiteHtml;
window.openSitePreview = openSitePreview;
window.getSitePreviewViewport = getSitePreviewViewport;
