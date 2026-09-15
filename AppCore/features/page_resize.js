// ══════════════════════════════════════════════════════════════
// ページの高さをドラッグで伸ばす（サイトメーカー風）
//   キャンバス下端のバーを下へ引くと docH が伸び、ページが縦に長くなる。
//   #cv-wrap はスクロールできるので、画面に収まらない長さのページも作れる。
//
//   ズームは CSS transform なので、#cv の「場所取り」は実寸のままで
//   拡大後の見た目とズレる。スクロールできる範囲は #cv-extent に
//   拡大後のサイズを持たせて表し、下端バーもそこへ合わせて置く。
//   ドラッグ量は zoom で割ってドキュメント座標に直してから足す。
// ══════════════════════════════════════════════════════════════

const PAGE_MIN_HEIGHT = 80;
const PAGE_MAX_HEIGHT = 20000;
const PAGE_RESIZE_STEP = 10;    // 10px刻み（Shiftを押している間は1px）
const PAGE_BOTTOM_MARGIN = 64;  // バーの下に残す余白（掴みやすさと、伸ばす余地）

function _pageZoom() {
  return (typeof mpView !== 'undefined' && mpView.zoom) || 1;
}

// キャンバスの表示サイズに合わせて、下端バーとスクロール範囲を置き直す。
// docW/docH やズームが変わるたびに呼ぶ（resizeCanvas / mpApplyZoom から）。
function syncCanvasExtent() {
  const handle = document.getElementById('cv-resize-handle');
  const extent = document.getElementById('cv-extent');
  if (!handle || !extent) return;

  const z = _pageZoom();
  const w = Math.round((typeof docW === 'number' ? docW : 1280) * z);
  const h = Math.round((typeof docH === 'number' ? docH : 720) * z);

  extent.style.width = w + 'px';
  extent.style.height = (h + PAGE_BOTTOM_MARGIN) + 'px';
  handle.style.width = w + 'px';
  handle.style.top = h + 'px';

  const label = document.getElementById('cv-rh-size');
  if (label) label.textContent = (docW || 0) + ' × ' + (docH || 0);
}

// 高さを変える。実際に変わったら true。
function setPageHeight(h) {
  const next = Math.max(PAGE_MIN_HEIGHT, Math.min(PAGE_MAX_HEIGHT, Math.round(h)));
  if (next === docH) return false;
  docH = next;
  // resizeCanvas() の中から syncCanvasExtent() も呼ばれる
  if (typeof resizeCanvas === 'function') resizeCanvas();
  else syncCanvasExtent();
  return true;
}

// 伸ばし終わったら保存する（次に開いたときも同じ高さで始まる）
function _commitPageHeight() {
  try { localStorage.setItem('mpDocH', String(docH)); } catch (e) { /* 保存できなくても続行 */ }
  if (typeof setStatus === 'function') setStatus('ページの高さ ' + docH + 'px');
}

// 一番下にある図形に合わせて高さを詰める（バーのダブルクリック）
function fitPageHeightToContent() {
  const list = (typeof shapes !== 'undefined' ? shapes : []) || [];
  const visible = list.filter(s => s && !s.hidden);
  if (!visible.length) {
    if (typeof toast === 'function') toast('ti-info-circle', '図形がありません');
    return;
  }
  let bottom = 0;
  visible.forEach(s => {
    const b = typeof getBounds === 'function' ? getBounds(s) : null;
    if (b) bottom = Math.max(bottom, b.y + b.h);
  });
  if (typeof saveState === 'function') saveState();
  if (setPageHeight(Math.ceil(bottom) + 40)) _commitPageHeight();
  if (typeof toast === 'function') toast('ti-arrows-vertical', '中身に合わせました: ' + docH + 'px');
}

function initPageResize() {
  const handle = document.getElementById('cv-resize-handle');
  if (!handle || handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';
  syncCanvasExtent();

  let dragging = false;
  let startY = 0;
  let startHeight = 0;
  let changed = false;

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = true;
    changed = false;
    startY = e.clientY;
    startHeight = docH;
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 非対応でも続行 */ }
    // キャンバスの描画操作やパンに拾わせない
    e.preventDefault();
    e.stopPropagation();
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const delta = (e.clientY - startY) / _pageZoom();
    let h = startHeight + delta;
    if (!e.shiftKey) h = Math.round(h / PAGE_RESIZE_STEP) * PAGE_RESIZE_STEP;

    // 伸ばす前の高さを1回だけ履歴に積む（⌘Zで元の高さに戻せるように）
    if (!changed && Math.round(h) !== startHeight) {
      if (typeof saveState === 'function') saveState();
      changed = true;
    }
    if (setPageHeight(h) && typeof setStatus === 'function') {
      setStatus('ページの高さ ' + docH + 'px');
    }
  });

  const finish = e => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    if (changed) _commitPageHeight();
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);

  handle.addEventListener('dblclick', e => {
    e.preventDefault();
    fitPageHeightToContent();
  });
}

window.syncCanvasExtent = syncCanvasExtent;
window.fitPageHeightToContent = fitPageHeightToContent;

// このファイルは app.js より後に読まれるので、自分で初期化する
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPageResize);
} else {
  initPageResize();
}
