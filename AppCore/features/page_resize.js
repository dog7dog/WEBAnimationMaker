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
const PAGE_SIDE_MARGIN = 24;    // キャンバスの左右に残す余白
const PAGE_TOP_MARGIN = 16;     // キャンバスの上に残す余白

function _pageZoom() {
  return (typeof mpView !== 'undefined' && mpView.zoom) || 1;
}

// 拡大後のキャンバスの大きさ（画面上のpx）
function _pageViewSize() {
  const z = _pageZoom();
  return {
    w: Math.round((typeof docW === 'number' ? docW : 1280) * z),
    h: Math.round((typeof docH === 'number' ? docH : 720) * z)
  };
}

// キャンバスを #cv-wrap のどこに置くか（スクロールする中身の中での位置）。
//   横: 余白ぶんの余裕があれば中央。無ければ左に余白だけ空けてスクロールさせる。
//   縦: ページは上から下へ伸びるので、上端をそろえて少しだけ余白を空ける。
// 定規の目盛りもこの位置を基準にするので、ズレないよう1か所にまとめてある。
function canvasViewOffset() {
  const wrap = document.getElementById('cv-wrap');
  const { w } = _pageViewSize();
  const clientW = wrap ? wrap.clientWidth : w;
  const x = clientW >= w + PAGE_SIDE_MARGIN * 2
    ? Math.round((clientW - w) / 2)
    : PAGE_SIDE_MARGIN;
  return { x, y: PAGE_TOP_MARGIN };
}
window.canvasViewOffset = canvasViewOffset;

// キャンバス上の座標 → #cv-wrap の中での位置（px）。
// キャンバスに重ねて出すもの（ブラシの丸、座標の吹き出し）の置き場所に使う。
function canvasPointToWrap(x, y) {
  const z = _pageZoom();
  const off = canvasViewOffset();
  return { x: off.x + x * z, y: off.y + y * z };
}
window.canvasPointToWrap = canvasPointToWrap;

// キャンバスの表示サイズに合わせて、下端バーとスクロール範囲を置き直す。
// docW/docH やズームが変わるたびに呼ぶ（resizeCanvas / mpApplyZoom から）。
function syncCanvasExtent() {
  const handle = document.getElementById('cv-resize-handle');
  const extent = document.getElementById('cv-extent');
  if (!handle || !extent) return;

  const { w, h } = _pageViewSize();
  const off = canvasViewOffset();

  // キャンバス本体（と、重ねてあるWebGL用）を置く
  const cvEl = document.getElementById('cv');
  const three = document.getElementById('cv-three');
  [cvEl, three].forEach(el => {
    if (!el) return;
    el.style.left = off.x + 'px';
    el.style.top = off.y + 'px';
  });

  extent.style.width = (off.x + w + PAGE_SIDE_MARGIN) + 'px';
  extent.style.height = (off.y + h + PAGE_BOTTOM_MARGIN) + 'px';
  handle.style.left = off.x + 'px';
  handle.style.width = w + 'px';
  handle.style.top = (off.y + h) + 'px';

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
