// ── カラー ───────────────────────────────────────────────────
function setColor(c) {
  color = c;
  document.getElementById('cur-color').style.background = c;
  document.getElementById('cpicker').value = c;
  document.querySelectorAll('.pdot').forEach(d => d.classList.toggle('active', d.dataset.c === c));
  if (selected) { selected.color = c; redraw(); }
  // 枠線が「塗りと同じ」のときは見本も追従させる
  syncStrokeSwatch();
}

// 枠線の色を決める。null を渡すと「塗りと同じ」に戻す。
// 塗りの色と同じく、次に描く図形の設定と、選択中の図形の両方に効く。
function setStrokeColor(c) {
  strokeColor = c || null;
  if (selected && STROKE_COLOR_TYPES.includes(selected.type)) {
    selected.strokeColor = strokeColor;
    redraw();
  }
  syncStrokeSwatch();
}

// 枠線の見本を今の状態に合わせる。
// 選択中の図形があればその図形の枠線を、なければ次に描く図形の設定を映す。
function syncStrokeSwatch() {
  const area = document.getElementById('stroke-area');
  if (!area) return;
  const target = selected && STROKE_COLOR_TYPES.includes(selected.type) ? selected : null;
  // 枠線を持たない図形（線・ペン・テキスト・画像）を選んでいるときは触れないようにする
  area.classList.toggle('disabled', !!selected && !target);

  const own = target ? target.strokeColor : strokeColor;
  const shown = own || (target ? target.color : color);
  area.classList.toggle('linked', !own);
  document.getElementById('cur-stroke').style.background = shown;
  const picker = document.getElementById('stroke-picker');
  if (/^#[0-9a-f]{6}$/i.test(shown)) picker.value = shown;
}

document.getElementById('cpicker').addEventListener('input', e => setColor(e.target.value));
document.getElementById('canvas-bg-picker').addEventListener('input', e => {
  canvasBg = e.target.value;
  redraw();
});
document.querySelectorAll('.pdot').forEach(d => d.addEventListener('click', () => setColor(d.dataset.c)));
document.getElementById('stroke-picker').addEventListener('input', e => setStrokeColor(e.target.value));
document.getElementById('stroke-link-btn').addEventListener('click', () => setStrokeColor(null));

document.getElementById('fill-chk').addEventListener('change', e => {
  doFill = e.target.checked;
  if (selected) { selected.fill = doFill; redraw(); }
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
