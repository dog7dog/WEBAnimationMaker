// ══════════════════════════════════════════════════════════════
// Webページとしての書き出し
//   キャンバスタブに出ているものと同じ HTML + CSS + JS を書き出す。
//   プレビュー用の別実装を作らず、dom-mirror.js / codegen-css.js /
//   codegen-js.js の出力をそのまま束ねるだけにしてあるので、
//   「Magic Paintでは動いたのにコピーしたら動かない」が起きない。
// ══════════════════════════════════════════════════════════════

function buildSiteParts() {
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
    + '  overflow: hidden;\n'
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

// 別タブで開いて動作を確認する（書き出すものと同じHTML）
function openSitePreview() {
  if (typeof ensureShapeIds === 'function') ensureShapeIds();
  const blob = new Blob([buildSiteHtml()], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, 'mlc-site-preview',
    'width=' + Math.min((docW || 1280) + 80, 1400) + ',height=' + Math.min((docH || 720) + 120, 900));
  if (!win) {
    if (typeof toast === 'function') toast('ti-alert-triangle', 'ポップアップをブロックされました');
  } else {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  if (typeof closeFileMenu === 'function') closeFileMenu();
}

window.exportSiteHtml = exportSiteHtml;
window.openSitePreview = openSitePreview;
