// ── カラー ───────────────────────────────────────────────────
//   ツールバーには「塗り」と「枠線」の2つの色の枠がある。
//   クリックした方が選ばれ（colorTarget）、パレットはその色に効く。
//   どちらの見本も、図形を選んでいればその図形の色を、
//   選んでいなければ次に描く図形の設定を映す。

// 図形の種類ごとの「塗り」の枠の意味
//   塗りと枠線を持つ図形 … 塗り
//   テキスト             … 文字の色
//   線・ペン・ブラシ     … 線の色
//   画像                 … 色を持たない（枠ごと触れなくする）
const COLORLESS_TYPES = ['image', 'webgl-image'];
const LINE_COLOR_TYPES = ['line', 'pen', 'brush', 'mod-brush'];

let colorTarget = 'fill';

function _isHexColor(c) { return /^#[0-9a-f]{6}$/i.test(c || ''); }

// 選択中の図形の変更なら、変える前に履歴を積む（⌘Zで戻せるように）
function _beforeSelectedEdit() {
  if (selected && typeof beginPropertyEdit === 'function') beginPropertyEdit();
}

function setColor(c) {
  _beforeSelectedEdit();
  color = c;
  if (selected) { selected.color = c; redraw(); }
  syncColorControls();
}

// 枠線の色を決める。null を渡すと「塗りと同じ」に戻す。
// 塗りの色と同じく、次に描く図形の設定と、選択中の図形の両方に効く。
function setStrokeColor(c) {
  const applies = selected && STROKE_COLOR_TYPES.includes(selected.type);
  if (applies) _beforeSelectedEdit();
  strokeColor = c || null;
  if (applies) {
    selected.strokeColor = strokeColor;
    redraw();
  }
  syncColorControls();
}

function setFill(on) {
  const applies = selected && STROKE_COLOR_TYPES.includes(selected.type);
  if (applies) _beforeSelectedEdit();
  doFill = !!on;
  if (applies) { selected.fill = doFill; redraw(); }
  syncColorControls();
}

// パレットの色を、いま選んでいる枠（塗り / 枠線）に入れる
function applyPaletteColor(c) {
  if (_effectiveColorTarget() === 'stroke') setStrokeColor(c);
  else setColor(c);
}

function setColorTarget(target) {
  colorTarget = target === 'stroke' ? 'stroke' : 'fill';
  syncColorControls();
}

// 枠線を持たない図形を選んでいるときは、枠線を選んでいても塗りとして扱う
function _effectiveColorTarget() {
  if (colorTarget !== 'stroke') return 'fill';
  if (selected && !STROKE_COLOR_TYPES.includes(selected.type)) return 'fill';
  return 'stroke';
}

// ツールバーの色まわりを、今の状態（選択中の図形 or 次に描く図形の設定）に合わせる
function syncColorControls() {
  const fillSlot = document.getElementById('fill-slot');
  const strokeSlot = document.getElementById('stroke-area');
  if (!fillSlot || !strokeSlot) return;

  const type = selected ? selected.type : null;
  const colorless = !!type && COLORLESS_TYPES.includes(type);
  const hasStroke = !type || STROKE_COLOR_TYPES.includes(type);

  // ── 塗り ──
  const fillColor = (selected ? selected.color : color) || color;
  const fillOn = selected ? !!selected.fill : doFill;
  document.getElementById('cur-color').style.setProperty('--swatch', fillColor);
  document.getElementById('cur-color').classList.toggle('empty', hasStroke && !fillOn);
  if (_isHexColor(fillColor)) document.getElementById('cpicker').value = fillColor;

  const chk = document.getElementById('fill-chk');
  chk.checked = fillOn;
  // 塗りつぶしの有無は、塗りと枠線を持つ図形にしか意味がない
  chk.style.display = hasStroke ? '' : 'none';

  document.getElementById('fill-lbl').textContent =
    type === 'text' ? '文字色' : (LINE_COLOR_TYPES.includes(type) ? '線の色' : '塗り');
  fillSlot.classList.toggle('disabled', colorless);

  // ── 枠線 ──
  const strokeTarget = selected && STROKE_COLOR_TYPES.includes(type) ? selected : null;
  const own = strokeTarget ? strokeTarget.strokeColor : strokeColor;
  const strokeShown = own || fillColor;
  strokeSlot.classList.toggle('disabled', !hasStroke);
  strokeSlot.classList.toggle('linked', !own);
  document.getElementById('cur-stroke').style.background = strokeShown;
  if (_isHexColor(strokeShown)) document.getElementById('stroke-picker').value = strokeShown;

  // ── いま選んでいる枠と、パレットの印 ──
  const target = _effectiveColorTarget();
  fillSlot.classList.toggle('active', !colorless && target === 'fill');
  strokeSlot.classList.toggle('active', !colorless && target === 'stroke');
  const activeColor = String(target === 'stroke' ? strokeShown : fillColor).toLowerCase();
  document.querySelectorAll('.pdot').forEach(d => {
    d.classList.toggle('active', String(d.dataset.c).toLowerCase() === activeColor);
  });
  const paletteEl = document.getElementById('palette');
  if (paletteEl) {
    paletteEl.classList.toggle('disabled', colorless);
    paletteEl.title = target === 'stroke' ? 'クリックで枠線の色にする' : 'クリックで' + document.getElementById('fill-lbl').textContent + 'にする';
  }
}
// 見本をクリック → その枠を選んで、色ピッカーを開く
document.getElementById('cur-color').addEventListener('click', () => {
  setColorTarget('fill');
  document.getElementById('cpicker').click();
});
document.getElementById('cur-stroke').addEventListener('click', () => {
  setColorTarget('stroke');
  document.getElementById('stroke-picker').click();
});
// ラベルのあたりをクリックしても枠を選べるようにする
document.getElementById('fill-slot').addEventListener('click', e => {
  if (e.target.id !== 'cur-color') setColorTarget('fill');
});
document.getElementById('stroke-area').addEventListener('click', e => {
  if (e.target.id !== 'cur-stroke' && !e.target.closest('#stroke-link-btn')) setColorTarget('stroke');
});

document.getElementById('cpicker').addEventListener('input', e => setColor(e.target.value));
document.getElementById('stroke-picker').addEventListener('input', e => setStrokeColor(e.target.value));
document.getElementById('stroke-link-btn').addEventListener('click', () => setStrokeColor(null));
document.getElementById('fill-chk').addEventListener('change', e => setFill(e.target.checked));
document.querySelectorAll('.pdot').forEach(d => d.addEventListener('click', () => applyPaletteColor(d.dataset.c)));

document.getElementById('canvas-bg-picker').addEventListener('input', e => {
  if (typeof beginPropertyEdit === 'function') beginPropertyEdit();
  canvasBg = e.target.value;
  redraw();
});

// ツールバーボタン
document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);
document.getElementById('del-btn').addEventListener('click', deleteSelected);

// ── File menu helpers ───────────────────────────────────────
function toggleFileMenu() {
  document.getElementById('file-menu')?.classList.toggle('open');
}
function closeFileMenu() {
  document.getElementById('file-menu')?.classList.remove('open');
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('file-wrap');
  if (wrap && !wrap.contains(e.target)) closeFileMenu();
});

// ══════════════════════════════════════════════════════════════
// 追加: グループ化 + FPS変更（既存ボタン処理を壊さない安全版）
// ══════════════════════════════════════════════════════════════
function initGroupAndFpsControls() {
  const fpsSel = document.getElementById('fps-select');
  if (fpsSel) {
    fpsSel.value = String(FPS);
    fpsSel.addEventListener('change', () => {
      FPS = Number(fpsSel.value || 24);
      localStorage.setItem('mlcFPS', String(FPS));
      setStatus('FPS: ' + FPS);
    });
  }

  document.getElementById('group-btn')?.addEventListener('click', groupSelectedShapes);
  document.getElementById('ungroup-btn')?.addEventListener('click', ungroupSelectedShapes);

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (e.key.toLowerCase() === '*') {
      e.preventDefault();
      groupSelectedShapes();
    }
    if (e.key.toLowerCase() === 'u') {
      e.preventDefault();
      ungroupSelectedShapes();
    }
  });
}
