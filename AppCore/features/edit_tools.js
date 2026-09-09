// ══════════════════════════════════════════════════════════════
// Feature Pack: 編集ツール
//   複製 / 反転 / z順序 / 整列・分布 / スポイト / パレット管理
//   既存の selectedGroupMembers(), moveShape(), getCenter(),
//   getBounds(), bringToFront/sendToBack, saveState, syncAll を利用
// ══════════════════════════════════════════════════════════════

function mpSelected() {
  if (typeof selectedGroupMembers === 'function') return selectedGroupMembers();
  if (selected) return [selected];
  return [];
}

// ── 複製 ──
function mpDuplicateSelected() {
  const items = mpSelected();
  if (!items.length) { setStatus('複製する図形がありません'); return; }
  saveState();
  const copies = items.map(s => {
    const c = JSON.parse(JSON.stringify(s, (k, v) => (k === 'snap' ? undefined : v)));
    c.id = 'shape_dup_' + Math.random().toString(36).slice(2, 8);
    if (c.groupId) c.groupId = c.groupId + '_dup';
    return c;
  });
  copies.forEach(c => { moveShape(c, 16, 16); shapes.push(c); });
  selected = copies[copies.length - 1];
  multiSelected = copies.map(c => c.id);
  syncAll();
  setStatus(copies.length > 1 ? `${copies.length}個を複製` : '複製しました');
}

// ── 反転 ──
function mpFlipSelected(horizontal) {
  const items = mpSelected();
  if (!items.length) { setStatus('反転する図形がありません'); return; }
  saveState();
  // 選択全体のバウンディングボックス中心を軸に反転
  const bb = mpGroupBounds(items);
  const axis = horizontal ? bb.x + bb.w / 2 : bb.y + bb.h / 2;
  items.forEach(s => mpFlipShape(s, horizontal, axis));
  syncAll();
  setStatus(horizontal ? '左右反転' : '上下反転');
}
function mpFlipH() { mpFlipSelected(true); }
function mpFlipV() { mpFlipSelected(false); }

function mpFlipShape(s, horizontal, axis) {
  const c = getCenter(s);
  const nc = horizontal ? { x: 2 * axis - c.x, y: c.y } : { x: c.x, y: 2 * axis - c.y };
  moveShape(s, nc.x - c.x, nc.y - c.y);
  // 図形固有の内部反転
  if (s.type === 'line') {
    if (horizontal) { const m = 2 * axis; s.x1 = m - s.x1; s.x2 = m - s.x2; }
    else { const m = 2 * axis; s.y1 = m - s.y1; s.y2 = m - s.y2; }
  } else if (s.type === 'pen' || s.type === 'brush' || s.type === 'mod-brush') {
    if (s.pts) s.pts = s.pts.map(p => horizontal ? { x: 2 * nc.x - p.x, y: p.y } : { x: p.x, y: 2 * nc.y - p.y });
  } else if (s.type === 'rect' || s.type === 'webgl-image') {
    if (horizontal) s.scaleX = -(s.scaleX || 1); else s.scaleY = -(s.scaleY || 1);
  } else if (['triangle', 'polygon', 'circle'].includes(s.type)) {
    if (horizontal) { s.scaleX = -(s.scaleX || 1); if (s.rot != null) s.rot = (180 - s.rot) % 360; }
    else { s.scaleY = -(s.scaleY || 1); if (s.rot != null) s.rot = (360 - s.rot) % 360; }
  }
}

// ── z順序（単体・複数対応） ──
function mpBringToFront() {
  const items = mpSelected(); if (!items.length) return;
  saveState();
  const set = new Set(items);
  const rest = shapes.filter(s => !set.has(s));
  shapes.splice(0, shapes.length, ...rest, ...items);
  syncAll(); setStatus('最前面へ');
}
function mpSendToBack() {
  const items = mpSelected(); if (!items.length) return;
  saveState();
  const set = new Set(items);
  const rest = shapes.filter(s => !set.has(s));
  shapes.splice(0, shapes.length, ...items, ...rest);
  syncAll(); setStatus('最背面へ');
}

// ── 整列 ──
function mpGroupBounds(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  items.forEach(s => {
    const b = getBounds(s);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function mpAlign(mode) {
  const items = mpSelected();
  if (items.length < 1) { setStatus('図形を選択してください'); return; }
  // 単体ならキャンバス基準、複数なら選択範囲基準
  const useCanvas = items.length === 1;
  const bb = useCanvas ? { x: 0, y: 0, w: cv.width, h: cv.height } : mpGroupBounds(items);
  saveState();
  items.forEach(s => {
    const b = getBounds(s);
    let dx = 0, dy = 0;
    if (mode === 'left') dx = bb.x - b.x;
    else if (mode === 'right') dx = (bb.x + bb.w) - (b.x + b.w);
    else if (mode === 'cx') dx = (bb.x + bb.w / 2) - (b.x + b.w / 2);
    else if (mode === 'top') dy = bb.y - b.y;
    else if (mode === 'bottom') dy = (bb.y + bb.h) - (b.y + b.h);
    else if (mode === 'cy') dy = (bb.y + bb.h / 2) - (b.y + b.h / 2);
    if (dx || dy) moveShape(s, dx, dy);
  });
  syncAll();
  setStatus('整列: ' + mode);
}

// ── 均等配置（分布） ──
function mpDistribute(horizontal) {
  const items = mpSelected();
  if (items.length < 3) { setStatus('3個以上選択してください'); return; }
  saveState();
  const withB = items.map(s => ({ s, b: getBounds(s) }));
  withB.sort((a, b) => horizontal ? a.b.x - b.b.x : a.b.y - b.b.y);
  const first = withB[0].b, last = withB[withB.length - 1].b;
  const start = horizontal ? first.x + first.w / 2 : first.y + first.h / 2;
  const end = horizontal ? last.x + last.w / 2 : last.y + last.h / 2;
  const step = (end - start) / (withB.length - 1);
  withB.forEach((it, i) => {
    const target = start + step * i;
    const c = horizontal ? it.b.x + it.b.w / 2 : it.b.y + it.b.h / 2;
    const d = target - c;
    moveShape(it.s, horizontal ? d : 0, horizontal ? 0 : d);
  });
  syncAll();
  setStatus('均等配置');
}

// ── スポイト（クリックで色を吸い取る） ──
let _mpEyedropperActive = false;
function mpStartEyedropper() {
  // ネイティブ EyeDropper API があれば優先
  if (window.EyeDropper) {
    const ed = new EyeDropper();
    ed.open().then(res => {
      if (res && res.sRGBHex && typeof setColor === 'function') {
        setColor(res.sRGBHex);
        toast('ti-color-picker', '色を取得: ' + res.sRGBHex);
      }
    }).catch(() => {});
    return;
  }
  // フォールバック: キャンバス上クリックでピクセル取得
  if (_mpEyedropperActive) return;
  _mpEyedropperActive = true;
  cv.style.cursor = 'crosshair';
  toast('ti-color-picker', 'キャンバスをクリックで色取得');
  const handler = e => {
    const rect = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (cv.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (cv.height / rect.height));
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      if (typeof setColor === 'function') setColor(hex);
      toast('ti-color-picker', '色を取得: ' + hex);
    } catch (err) { toast('ti-alert-triangle', '色取得に失敗'); }
    cleanup();
  };
  const cleanup = () => {
    _mpEyedropperActive = false;
    cv.style.cursor = '';
    cv.removeEventListener('click', handler, true);
  };
  cv.addEventListener('click', handler, true);
  setTimeout(() => { if (_mpEyedropperActive) cleanup(); }, 8000);
}

// ── パレット管理（カスタムスウォッチ） ──
function mpLoadSwatches() {
  try { return JSON.parse(localStorage.getItem('mpSwatches') || '[]'); }
  catch (e) { return []; }
}
function mpSaveSwatches(arr) {
  localStorage.setItem('mpSwatches', JSON.stringify(arr.slice(0, 24)));
}
function mpAddSwatch(c) {
  const col = c || (typeof color !== 'undefined' ? color : '#3B8AE6');
  const arr = mpLoadSwatches();
  if (arr.includes(col)) { toast('ti-info-circle', '既にパレットにあります'); return; }
  arr.unshift(col);
  mpSaveSwatches(arr);
  mpRenderSwatches();
  toast('ti-palette', 'パレットに追加: ' + col);
}
function mpRenderSwatches() {
  const palette = document.getElementById('palette');
  if (!palette) return;
  // 既存カスタム行を除去
  let row = document.getElementById('mp-custom-swatches');
  if (!row) {
    row = document.createElement('div');
    row.id = 'mp-custom-swatches';
    palette.parentNode.insertBefore(row, palette.nextSibling);
  }
  const arr = mpLoadSwatches();
  row.innerHTML = '';
  arr.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'mp-swatch';
    dot.style.background = c;
    dot.title = c + '（クリックで選択 / 右クリックで削除）';
    dot.onclick = () => { if (typeof setColor === 'function') setColor(c); };
    dot.oncontextmenu = e => {
      e.preventDefault();
      mpSaveSwatches(mpLoadSwatches().filter(x => x !== c));
      mpRenderSwatches();
    };
    row.appendChild(dot);
  });
  // ＋ボタン
  const add = document.createElement('button');
  add.className = 'mp-swatch-add';
  add.innerHTML = '<i class="ti ti-plus"></i>';
  add.title = '現在の色をパレットに追加';
  add.onclick = () => mpAddSwatch();
  row.appendChild(add);
}

window.mpDuplicateSelected = mpDuplicateSelected;
window.mpFlipH = mpFlipH;
window.mpFlipV = mpFlipV;
window.mpBringToFront = mpBringToFront;
window.mpSendToBack = mpSendToBack;
window.mpAlign = mpAlign;
window.mpDistribute = mpDistribute;
window.mpStartEyedropper = mpStartEyedropper;
window.mpAddSwatch = mpAddSwatch;
window.mpRenderSwatches = mpRenderSwatches;

// ── ホットキー: 複製(⌘D) / スポイト(I) ──
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const inField = isTypingContext();
  if (inField) return;
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); mpDuplicateSelected(); }
  if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); mpStartEyedropper(); }
});

document.addEventListener('DOMContentLoaded', mpRenderSwatches);
if (document.readyState !== 'loading') setTimeout(mpRenderSwatches, 100);
