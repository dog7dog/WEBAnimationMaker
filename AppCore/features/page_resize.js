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
  _syncPageBadge();
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

// ══════════════════════════════════════════════════════════════
// ページの区切り線
//   「1ページ＝画面1つ分」がどこで折り返すのかを、デザイン中に見せる。
//   実際に見る人の画面の高さは分からないので、pageViewHeight を目安にする。
//   あわせて各線に px も出して、「ここが何px地点か」を読めるようにする。
// ══════════════════════════════════════════════════════════════

let showPageGuides = localStorage.getItem('mpPageGuides') !== '0';

function drawPageGuides() {
  if (!showPageGuides) return;
  const step = Number(pageViewHeight) || 0;
  if (step < 40 || typeof ctx === 'undefined' || !ctx) return;

  ctx.save();
  ctx.lineWidth = 1;
  for (let n = 1; n * step < cv.height; n++) {
    const y = n * step;
    ctx.setLineDash([9, 6]);
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(cv.width, y + 0.5);
    ctx.stroke();

    // 「ここから2ページ目 / 720px」と、左端に小さく出す
    const label = (n + 1) + 'ページ目  ' + y + 'px';
    ctx.setLineDash([]);
    ctx.font = '11px monospace';
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(16, 26, 38, 0.82)';
    ctx.fillRect(6, y + 4, w, 17);
    ctx.fillStyle = 'rgba(150, 205, 255, 0.95)';
    ctx.textBaseline = 'top';
    ctx.fillText(label, 12, y + 7);
  }
  ctx.restore();
}

// ── 「実際のプレビューの1ページ」に合わせる ─────────────────
//   別タブで開いたプレビュー窓の表示範囲を、そのまま1ページとして使う。
//   横はキャンバスの幅(docW)に、縦は区切り線の間隔(pageViewHeight)になる。
//   窓は開いたあとで大きさを変えられるので、押した時点の大きさを測る。

function applyPreviewViewport(v) {
  if (!v || !(v.w > 0) || !(v.h > 0)) return false;

  if (typeof saveState === 'function') saveState();
  docW = Math.round(v.w);
  pageViewHeight = Math.round(v.h);
  // ページが1画面より短いと区切り線が1本も出ないので、最低1ページ分は確保する
  if (docH < pageViewHeight) docH = pageViewHeight;

  try {
    localStorage.setItem('mpDocW', String(docW));
    localStorage.setItem('mpDocH', String(docH));
    localStorage.setItem('mpPageViewH', String(pageViewHeight));
  } catch (e) { /* 保存できなくても続行 */ }

  if (typeof resizeCanvas === 'function') resizeCanvas();
  if (typeof syncAll === 'function') syncAll();
  _syncPageBadge();
  if (typeof toast === 'function') {
    toast('ti-device-desktop', '1ページ = ' + docW + ' × ' + pageViewHeight + 'px に合わせました');
  }
  return true;
}

function matchPageToPreview() {
  const live = typeof getSitePreviewViewport === 'function' ? getSitePreviewViewport() : null;
  if (live) { applyPreviewViewport(live); return; }

  // まだ開いていなければ開いて、表示できたところで測る
  if (typeof openSitePreview !== 'function') return;
  if (typeof setStatus === 'function') setStatus('プレビューを開いて大きさを測っています…');
  // 基準にする窓なので、実際の閲覧に近い大きさで開く
  openSitePreview({ fullSize: true });

  let tries = 0;
  const timer = setInterval(() => {
    const v = typeof getSitePreviewViewport === 'function' ? getSitePreviewViewport() : null;
    if (v) { clearInterval(timer); applyPreviewViewport(v); return; }
    if (++tries > 40) {
      clearInterval(timer);
      if (typeof toast === 'function') {
        toast('ti-alert-triangle', 'プレビューの大きさを読めませんでした（ポップアップの許可を確認してください）');
      }
    }
  }, 150);
}

function setPageViewHeight(h) {
  const next = Math.max(40, Math.min(PAGE_MAX_HEIGHT, Math.round(Number(h) || 0)));
  pageViewHeight = next;
  try { localStorage.setItem('mpPageViewH', String(next)); } catch (e) { /* noop */ }
  if (typeof redraw === 'function') redraw();
  _syncPageBadge();
}

// 1ページずつ吸い付くスクロールの切り替え。書き出したページにも効く。
function togglePageSnap() {
  pageSnap = !pageSnap;
  const btn = document.getElementById('mp-page-snap');
  if (btn) btn.classList.toggle('on', pageSnap);
  if (typeof syncAll === 'function') syncAll();
  if (typeof toast === 'function') {
    toast(pageSnap ? 'ti-magnet' : 'ti-magnet-off',
      'ページごとに吸い付く: ' + (pageSnap ? 'ON' : 'OFF'));
  }
}

function togglePageGuides() {
  showPageGuides = !showPageGuides;
  try { localStorage.setItem('mpPageGuides', showPageGuides ? '1' : '0'); } catch (e) { /* noop */ }
  if (typeof redraw === 'function') redraw();
  _syncPageBadge();
  if (typeof setStatus === 'function') {
    setStatus('ページの区切り線: ' + (showPageGuides ? 'ON' : 'OFF'));
  }
}

function _syncPageBadge() {
  const badge = document.getElementById('mp-page-badge');
  if (!badge) return;
  badge.classList.toggle('off', !showPageGuides);
  document.getElementById('mp-page-snap')?.classList.toggle('on', pageSnap);
  const input = document.getElementById('mp-page-h');
  if (input && document.activeElement !== input) input.value = pageViewHeight;
  const wEl = document.getElementById('mp-page-w');
  if (wEl) wEl.textContent = docW || 0;
  const info = document.getElementById('mp-page-count');
  if (info) {
    const pages = Math.max(1, Math.ceil((docH || 0) / (Number(pageViewHeight) || 1)));
    info.textContent = '全' + pages + 'ページ / ' + (docH || 0) + 'px';
  }
}

// 「画面の高さ」を決める小さな操作パネル（キャンバスの左下）
function initPageBadge() {
  const area = document.getElementById('canvas-area');
  if (!area || document.getElementById('mp-page-badge')) return;

  const badge = document.createElement('div');
  badge.id = 'mp-page-badge';
  badge.innerHTML = '<button id="mp-page-toggle" title="ページの区切り線を表示/非表示">'
    + '<i class="ti ti-layout-rows"></i></button>'
    + '<span class="mp-page-lbl">1ページ</span>'
    + '<span id="mp-page-w" class="mp-page-num" title="キャンバスの幅"></span>'
    + '<span class="mp-page-lbl">×</span>'
    + '<input id="mp-page-h" type="number" min="40" max="4000" step="10" title="1ページ（画面1つ分）の高さ">'
    + '<span class="mp-page-lbl">px</span>'
    + '<button id="mp-page-match" title="別タブのプレビュー窓の大きさを、そのまま1ページにする">'
    + '<i class="ti ti-device-desktop"></i></button>'
    + '<button id="mp-page-snap" title="1ページずつピタッと止まるスクロールにする">'
    + '<i class="ti ti-magnet"></i></button>'
    + '<span id="mp-page-count" title="今のページの長さ"></span>';
  area.appendChild(badge);

  badge.querySelector('#mp-page-toggle').onclick = togglePageGuides;
  badge.querySelector('#mp-page-match').onclick = matchPageToPreview;
  badge.querySelector('#mp-page-snap').onclick = togglePageSnap;
  const input = badge.querySelector('#mp-page-h');
  input.addEventListener('input', e => setPageViewHeight(e.target.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  _syncPageBadge();
}

window.matchPageToPreview = matchPageToPreview;
window.togglePageSnap = togglePageSnap;
window.applyPreviewViewport = applyPreviewViewport;
window.drawPageGuides = drawPageGuides;
window.togglePageGuides = togglePageGuides;
window.setPageViewHeight = setPageViewHeight;

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
function _initPageFeatures() {
  initPageResize();
  initPageBadge();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initPageFeatures);
} else {
  _initPageFeatures();
}
