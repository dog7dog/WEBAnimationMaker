// ══════════════════════════════════════════════════════════════
// Feature Pack: ビューポート
//   グリッド / スナップ / ズーム・パン / オニオンスキン
//   既存 redraw(), canvasCoords() を
//   ラップして機能追加（コア改変なし）
// ══════════════════════════════════════════════════════════════

const mpView = {
  grid: false,
  gridSize: 32,
  snap: false,
  zoom: 1,
};

// ── 設定の永続化 ──
function mpViewLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('mpView') || '{}');
    Object.assign(mpView, s);
  } catch (e) {}
  mpView.zoom = 1; // ズームは毎回リセット
}
function mpViewSave() {
}

// ══════════════════════════════════════════════════════════════
// グリッド + オニオン: redraw をラップ
// ══════════════════════════════════════════════════════════════
let _mpOrigRedraw = null;
function mpInstallRedrawHook() {
  if (typeof redraw !== 'function' || _mpOrigRedraw) return;
  _mpOrigRedraw = redraw;
  window.redraw = function () {
    _mpOrigRedraw();
    if (mpView.grid) mpDrawGrid();
  };
  // グローバル参照も更新（他モジュールが redraw を直接呼ぶ場合に備える）
  try { redraw = window.redraw; } catch (e) {}
}

function mpDrawGrid() {
  const g = mpView.gridSize;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = g; x < cv.width; x += g) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, cv.height); }
  for (let y = g; y < cv.height; y += g) { ctx.moveTo(0, y + 0.5); ctx.lineTo(cv.width, y + 0.5); }
  ctx.stroke();
  // 中心線
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(cv.width / 2 + 0.5, 0); ctx.lineTo(cv.width / 2 + 0.5, cv.height);
  ctx.moveTo(0, cv.height / 2 + 0.5); ctx.lineTo(cv.width, cv.height / 2 + 0.5);
  ctx.stroke();
  ctx.restore();
}

// オニオンスキン: 前後フレームを薄く重ねる
// ══════════════════════════════════════════════════════════════
// スナップ: canvasCoords をラップして格子に吸着
// ══════════════════════════════════════════════════════════════
let _mpOrigCoords = null;
function mpInstallCoordsHook() {
  if (typeof canvasCoords !== 'function' || _mpOrigCoords) return;
  _mpOrigCoords = canvasCoords;
  window.canvasCoords = function (e) {
    let p = mpApplyZoomToCoords(e);
    if (mpView.snap && mpView.grid) {
      const g = mpView.gridSize;
      p = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    }
    return p;
  };
  try { canvasCoords = window.canvasCoords; } catch (e) {}
}

// ズーム適用時は rect スケールを補正
function mpApplyZoomToCoords(e) {
  const r = cv.getBoundingClientRect();
  const scaleX = cv.width / r.width;
  const scaleY = cv.height / r.height;
  return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
}

// ══════════════════════════════════════════════════════════════
// ズーム / パン（CSS transform で cv-wrap 内を拡大）
// ══════════════════════════════════════════════════════════════
function mpApplyZoom() {
  const cvEl = cv;
  const three = document.getElementById('cv-three');
  // Three.js編集モードのライブオーバーレイ(mods/webgl_threejs)は #cv と別要素の
  // ため、ここで一緒に scale しないと #cv だけがズームでずれて見た目が合わなくなる
  const threeOverlay = document.getElementById('je-threejs-overlay');
  const t = `scale(${mpView.zoom})`;
  cvEl.style.transformOrigin = 'top left';
  cvEl.style.transform = t;
  if (three) { three.style.transformOrigin = 'top left'; three.style.transform = t; }
  if (threeOverlay) { threeOverlay.style.transformOrigin = 'top left'; threeOverlay.style.transform = t; }
  // 拡大後の大きさに合わせて、下端バーとスクロール範囲を置き直す
  if (typeof syncCanvasExtent === 'function') syncCanvasExtent();
  mpUpdateZoomBadge();
}
function mpSetZoom(z) {
  mpView.zoom = Math.max(0.25, Math.min(4, z));
  mpApplyZoom();
}
function mpZoomIn() { mpSetZoom(mpView.zoom * 1.2); setStatus('ズーム ' + Math.round(mpView.zoom * 100) + '%'); }
function mpZoomOut() { mpSetZoom(mpView.zoom / 1.2); setStatus('ズーム ' + Math.round(mpView.zoom * 100) + '%'); }

// ── 「画面に合わせる」(ユーザーが明示的に押した時だけ動く。自動では呼ばない) ──
// ウィンドウのリサイズ等では勝手に発動しない。常時自動フィットさせると
// ルーラーの目盛りがズームに追従せず実サイズとズレて見える上、
// 「決めたキャンバスサイズより広がって見える」原因にもなっていたため。
function mpFitToWrap(opts = {}) {
  const wrap = document.getElementById('cv-wrap');
  if (!wrap || typeof docW !== 'number' || typeof docH !== 'number') return;
  const ww = wrap.offsetWidth, wh = wrap.offsetHeight;
  if (ww < 10 || wh < 10 || docW < 1 || docH < 1) return;
  // 幅に合わせる。縦は長いページを作れるようになったので基準にしない
  // （高さも見ると、縦長のページを開いた瞬間に極端な縮小になってしまう）。
  // 画面に収まらない分はスクロールして見る。
  // 決めたキャンバスサイズ以上には拡大しない（ウィンドウの方が大きい場合は等倍のまま）
  const fit = Math.min(1, ww / docW);
  mpView.zoom = Math.max(0.02, fit);
  mpApplyZoom();
  if (!opts.silent) setStatus('画面に合わせて表示 ' + Math.round(mpView.zoom * 100) + '%');
}
window.mpFitToWrap = mpFitToWrap;

function mpZoomReset() {
  mpFitToWrap();
  const wrap = document.getElementById('cv-wrap');
  if (wrap && wrap.scrollTo) wrap.scrollTo(0, 0);
}

function mpUpdateZoomBadge() {
  let badge = document.getElementById('mp-zoom-badge');
  if (!badge) {
    // #cv-wrap はスクロールするので、そこへ入れるとバッジも一緒に流れてしまう。
    // スクロールしない外側（#canvas-area）に置いて、常に隅に見えるようにする。
    const wrap = document.getElementById('canvas-area') || document.getElementById('cv-wrap');
    if (!wrap) return;
    badge = document.createElement('div');
    badge.id = 'mp-zoom-badge';
    badge.innerHTML = `
      <button id="mp-zoom-out" title="ズームアウト"><i class="ti ti-minus"></i></button>
      <span id="mp-zoom-val">100%</span>
      <button id="mp-zoom-in" title="ズームイン"><i class="ti ti-plus"></i></button>
      <button id="mp-zoom-reset" title="リセット"><i class="ti ti-zoom-reset"></i></button>`;
    wrap.appendChild(badge);
    badge.querySelector('#mp-zoom-out').onclick = mpZoomOut;
    badge.querySelector('#mp-zoom-in').onclick = mpZoomIn;
    badge.querySelector('#mp-zoom-reset').onclick = mpZoomReset;
  }
  const v = document.getElementById('mp-zoom-val');
  if (v) v.textContent = Math.round(mpView.zoom * 100) + '%';
}

// Ctrl+ホイールでズーム / Spaceドラッグでパン
function mpInstallZoomPan() {
  const wrap = document.getElementById('cv-wrap');
  if (!wrap) return;

  // パンでスクロール位置が変わった時もルーラーの目盛りを追従させる
  wrap.addEventListener('scroll', () => {
    if (typeof drawRulers === 'function') drawRulers();
  });

  wrap.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    mpSetZoom(mpView.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });

  let panning = false, sx0 = 0, sy0 = 0, sl = 0, st = 0;
  let spaceDown = false;
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isTypingContext()) {
      spaceDown = true; wrap.style.cursor = 'grab'; e.preventDefault();
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceDown = false; wrap.style.cursor = ''; }
  });
  wrap.addEventListener('mousedown', e => {
    if (!spaceDown) return;
    panning = true; wrap.style.cursor = 'grabbing';
    sx0 = e.clientX; sy0 = e.clientY; sl = wrap.scrollLeft; st = wrap.scrollTop;
    e.preventDefault(); e.stopPropagation();
  }, true);
  window.addEventListener('mousemove', e => {
    if (!panning) return;
    wrap.scrollLeft = sl - (e.clientX - sx0);
    wrap.scrollTop = st - (e.clientY - sy0);
  });
  window.addEventListener('mouseup', () => {
    if (panning) { panning = false; wrap.style.cursor = spaceDown ? 'grab' : ''; }
  });
}

// ── トグル ──
function mpToggleGrid() {
  mpView.grid = !mpView.grid;
  mpViewSave();
  if (typeof redraw === 'function') redraw();
  setStatus('グリッド: ' + (mpView.grid ? 'ON' : 'OFF'));
  mpSyncViewButtons();
}
function mpToggleSnap() {
  mpView.snap = !mpView.snap;
  if (mpView.snap && !mpView.grid) { mpView.grid = true; if (typeof redraw === 'function') redraw(); }
  mpViewSave();
  setStatus('スナップ: ' + (mpView.snap ? 'ON' : 'OFF'));
  mpSyncViewButtons();
}
function mpSyncViewButtons() {
  document.getElementById('mp-grid-btn')?.classList.toggle('on', mpView.grid);
  document.getElementById('mp-snap-btn')?.classList.toggle('on', mpView.snap);
}

window.mpToggleGrid = mpToggleGrid;
window.mpToggleSnap = mpToggleSnap;
window.mpZoomIn = mpZoomIn;
window.mpZoomOut = mpZoomOut;
window.mpZoomReset = mpZoomReset;
window.mpView = mpView;

// ── 初期化 ──
function mpViewInit() {
  mpViewLoad();
  mpInstallRedrawHook();
  mpInstallCoordsHook();
  mpInstallZoomPan();
  mpUpdateZoomBadge();
  mpSyncViewButtons();

  // ホットキー
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    const inField = isTypingContext();
    if (inField) return;
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); mpZoomIn(); }
    else if (mod && e.key === '-') { e.preventDefault(); mpZoomOut(); }
    else if (mod && e.key === '0') { e.preventDefault(); mpZoomReset(); }
else if (mod && e.key.toLowerCase() === 'b' && !e.shiftKey) {
 e.preventDefault(); mpToggleGrid(); }
  });

  if (mpView.grid && typeof redraw === 'function') redraw();
}

// core が全部読み込まれた後に初期化（app.js の後に読まれる想定だが保険）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(mpViewInit, 200));
} else {
  setTimeout(mpViewInit, 200);
}
