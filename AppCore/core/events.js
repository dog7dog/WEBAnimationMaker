// ── コピペ ───────────────────────────────────────────────────
function copySelected() {
  if (!selected) return;
  clipboard = JSON.parse(JSON.stringify(selected));
  // ブラシのキャッシュ(snap)はcanvas要素で、JSONを通すと空オブジェクトに
  // なってしまう。持ち回さず、貼り付けたあとに pts から作り直す。
  delete clipboard.snap;
  setStatus(selected.name + ' をコピー');
}

function paste() {
  if (!clipboard) return;
  const copy = JSON.parse(JSON.stringify(clipboard));
  delete copy.snap;
  copy.id = 'shape_copy_' + Math.random().toString(36).slice(2, 8);
  copy.layerId = getDrawableActiveLayerId();
  delete copy.groupId;
  // 元の上に重ならないよう少しずらす。型ごとの座標の持ち方は
  // moveShape() が知っているので、そちらに任せる
  moveShape(copy, 20, 20);
  const base = copy.name.replace(/ コピー\d*$/, '');
  const cnt = shapes.filter(s => s.name.startsWith(base + ' コピー')).length;
  copy.name = base + ' コピー' + (cnt > 0 ? cnt + 1 : '');
  saveState();
  shapes.push(copy);
  // ブラシは描画がキャッシュ頼りなので、移動後の座標で作り直す
  if (copy.type === 'brush' && typeof rebuildBrushSnap === 'function') rebuildBrushSnap(copy);
  selected = copy;
  clipboard = JSON.parse(JSON.stringify(copy));
  delete clipboard.snap;
  syncAll();
  setStatus(copy.name + ' をペースト');
}

function deleteSelected() {
  if (!selected && (!multiSelected || !multiSelected.length)) return;
  ensureShapeIds();
  const ids = new Set(multiSelected || []);
  if (selected?.id) ids.add(selected.id);
  const deletable = shapes.filter(s => ids.has(s.id) && canEditShape(s));
  if (!deletable.length) { setStatus('ロック中のレイヤーは削除できません'); return; }
  const delIds = new Set(deletable.map(s => s.id));
  saveState();
  shapes.splice(0, shapes.length, ...shapes.filter(s => !delIds.has(s.id)));
  selected = null;
  multiSelected = [];
  syncAll();
  setStatus(deletable.length > 1 ? `${deletable.length}個を削除しました` : '削除しました');
}

// ── キーボードショートカット ──────────────────────────────────
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;

  // Shift: まっすぐ引きモード（INPUT中でも有効）
  if (e.key === 'Shift' && !straightMode) {
    straightMode = true;
    snapBase = (isDown && penPts.length > 0)
      ? { ...penPts[penPts.length - 1] }
      : { x: sx, y: sy };
  }

  if (isTypingContext()) return;

  // ⌘⇧C: 選択中の画像をOSのクリップボードへ（他のアプリへ貼れるようにする）。
  // Shiftを押すと e.key は 'C' になるので、大文字小文字を揃えて見る。
  if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
    if (typeof copySelectedImageToClipboard === 'function') copySelectedImageToClipboard();
    e.preventDefault();
  } else if (mod && e.key.toLowerCase() === 'c') {
    copySelected();
    e.preventDefault();
  }

  // ⌘V は打ち消さない。クリップボードの画像を拾うためにネイティブの
  // paste イベントを通し、図形の貼り付けもそちらから呼ぶ
  // （paste イベントが来ないブラウザ向けのフォールバック付き）。
  if (mod && e.key.toLowerCase() === 'v') {
    if (typeof schedulePasteFallback === 'function') schedulePasteFallback();
    else { paste(); e.preventDefault(); }
  }
  if (mod && e.key === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
  if (mod && e.key === 'z' && e.shiftKey) { redo(); e.preventDefault(); }
  if (mod && e.key === 'p') { openSitePreview(); e.preventDefault(); }
  if (mod && e.key === 's') { saveProject(); e.preventDefault(); }
  if (e.key === 'Escape') { deleteSelected(); }
  if (e.key === ']' && mod) { bringForward(); e.preventDefault(); }
  if (e.key === '[' && mod) { sendBackward(); e.preventDefault(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); }

  // ツールショートカット
  const toolKeys = { v: 'select', r: 'rect', c: 'circle', t: 'triangle', p: 'polygon', l: 'line', e: 'eraser' };
  if (!mod && toolKeys[e.key]) setTool(toolKeys[e.key]);
});

document.addEventListener('keyup', e => {
  if (e.key === 'Shift') { straightMode = false; snapBase = null; }
});

// ── ツール選択 ────────────────────────────────────────────────
function setTool(t) {
  if (t !== 'select') {
    marqueeSelecting = false;
    marqueeRect = null;
    marqueeAppend = false;
  }
  tool = t;
  if (t !== "mod-brush") {
    document.querySelectorAll(".rp-btn[data-mod-brush]").forEach(b => {
      b.classList.remove("active");
    });
  }
  document.querySelectorAll('.rp-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === t);
  });
  cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  if (typeof syncProps === 'function') syncProps();
  redraw();
}

window.setTool = setTool;

document.querySelectorAll('.rp-btn[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});

// ── マウスイベント ────────────────────────────────────────────
cv.addEventListener('mousedown', e => {
  const { x, y } = canvasCoords(e);
  sx = x; sy = y;
  isDown = true;

  if (tool === 'mod-brush') {
    modBrushPoints = [{ x, y }];
    return;
  }

  if (tool === 'select') {
    // ハンドルヒット
    const hk = hitHandle(selected, x, y);
  if (hk) {

    const isPtsShape =
      selected &&
      (selected.type === 'pen' ||
      selected.type === 'brush' ||
      selected.type === 'mod-brush');

    freeTransforming = isPtsShape && e.altKey;

    resizing = true;
    resizeHandle = hk;

    const _b = getBounds(selected);
    resizeStart = {
      x: _b.x,
      y: _b.y,
      w: _b.w,
      h: _b.h,
      bcx: _b.x + _b.w / 2,
      bcy: _b.y + _b.h / 2,
      shape: JSON.parse(JSON.stringify(selected))
    };

    dragOx = x;
    dragOy = y;
    return;
  }
    // 図形ヒット
    const hit = shapes.slice().reverse().find(s => !s.hidden && canEditShape(s) && hitTest(s, x, y));
    if (hit) {
      saveState();
      ensureShapeIds();
      const hitAlreadySelected = multiSelected.includes(hit.id);
      if (e.shiftKey) {
        if (!multiSelected.includes(hit.id)) multiSelected.push(hit.id);
      } else if (hitAlreadySelected && multiSelected.length > 1) {
        // 範囲選択後は、選択済み図形をつかんでも複数選択を維持する。
      } else {
        multiSelected = [hit.id];
      }
      selected = hit; dragSel = true; dragOx = x; dragOy = y;
      syncProps(); syncLayers();
    } else {
      marqueeSelecting = true;
      marqueeAppend = e.shiftKey;
      marqueeRect = { x1: x, y1: y, x2: x, y2: y };
      selected = marqueeAppend ? selected : null;
      dragSel = false;
      if (!marqueeAppend) multiSelected = [];
      syncProps(); syncLayers();
    }
    redraw(); return;
  }

  if (tool === 'eraser') {
    // 通常の hitTest（ロック・非表示レイヤーは除外）
    let hit = shapes.slice().reverse().find(s => canEditShape(s) && hitTest(s, x, y));

    // ブラシは snap 画像なので hitTest が効かない
    // → ブラシの pts（描画軌跡）に近い点があれば消す
    if (!hit) {
      hit = shapes.slice().reverse().find(s => {
        if (s.type !== 'brush' || !s.pts || !s.pts.length) return false;
        const r = (s.sw || 16) / 2 + 8;
        return s.pts.some(p => Math.hypot(p.x - x, p.y - y) <= r);
      });
    }
    if (!hit) {
      hit = shapes.slice().reverse().find(s => {
        if (!['brush', 'mod-brush', 'pen'].includes(s.type) || !s.pts || !s.pts.length) return false;
        const r = (s.sw || 16) / 2 + 8;
        return s.pts.some(p => Math.hypot(p.x - x, p.y - y) <= r);
      });
    }
    // それでも見つからない場合: ブラシの snap がキャンバス全体を覆っているので
    // snap を持つブラシの最後のものを消す（ドラッグ消しゴム風）
    if (!hit) {
      const brushes = shapes.filter(s => s.type === 'brush' && s.snap);
      if (brushes.length > 0) hit = brushes[brushes.length - 1];
    }

    if (hit) {
      saveState();
      shapes.splice(0, shapes.length, ...shapes.filter(s => s !== hit));
      if (selected === hit) selected = null;
      _eraserHover = null;
      syncAll();
    }
    return;
  }

  if (tool === 'brush') {
    brushPts = []; bLastX = null; bLastY = null;
    stampBrush(x, y); brushPts.push({ x, y }); bLastX = x; bLastY = y;
    return;
  }

  if (tool === 'pen') { penPts = [{ x, y }]; return; }

});

cv.addEventListener('mousemove', e => {
  const { x, y } = canvasCoords(e);
  // Shift を押しながらドラッグ: snapBase を基準に水平/垂直スナップ
  if (isDown && straightMode && snapBase && ['pen', 'path', 'line'].includes(tool)) {
    const snapped = applyStrightSnap(x, y, snapBase.x, snapBase.y);
    ghostX = snapped.x;
    ghostY = snapped.y;
  } else {
    ghostX = x; ghostY = y;
  }

  // カーソル更新（ドラッグ中でなくても）
  if (tool === 'select' && !isDown && selected) {
    const hk = hitHandle(selected, x, y);
    if (hk) cv.style.cursor = getHandles(getBounds(selected))[hk].cur;
    else if (hitTest(selected, x, y)) cv.style.cursor = 'move';
    else cv.style.cursor = 'default';
  }

  if (tool === 'brush') updateBrushCursor(x, y);
  else hideBrushCursor();

  // 消しゴム: ホバーハイライトのみ（削除は mousedown で行う）
  if (tool === 'eraser') {
    let _hover = shapes.slice().reverse().find(s => hitTest(s, x, y));
    if (!_hover) {
      _hover = shapes.slice().reverse().find(s => {
        if (s.type !== 'brush' || !s.pts || !s.pts.length) return false;
        const r = (s.sw || 16) / 2 + 8;
        return s.pts.some(p => Math.hypot(p.x - x, p.y - y) <= r);
      });
    }
    _eraserHover = _hover || null;
    redraw();
  }

  if (!isDown) return;

  if (tool === 'mod-brush') {
    modBrushPoints.push({ x, y });
    redraw();

    const brush = window.AnimationApp?.activeModBrush;
    if (brush && brush.draw) {
      brush.draw(ctx, modBrushPoints, {
        color,
        sw,
        opa,
        preview: true
      });
    }

    return;
  }

  if (tool === 'select' && resizing && selected) {
    applyResize(selected, resizeHandle, resizeStart, x - dragOx, y - dragOy);
    syncProps(); redraw(); return;
  }
  if (tool === 'select' && marqueeSelecting && marqueeRect) {
    marqueeRect.x2 = x;
    marqueeRect.y2 = y;
    redraw(); return;
  }
  if (tool === 'select' && dragSel && selected) {
    const dx = x - dragOx;
    const dy = y - dragOy;
    moveShape(selected, dx, dy);
    moveSelectionMembers(selected, dx, dy);
    dragOx = x; dragOy = y;
    redraw(); return;
  }

  if (tool === 'brush') { drawBrushStroke(x, y); return; }
  if (tool === 'pen') {
    // ペン: フリーハンド（Shiftで水平/垂直）
    let px = x, py = y;
    if (straightMode && snapBase) {
      const sn = applyStrightSnap(x, y, snapBase.x, snapBase.y);
      px = sn.x; py = sn.y;
    }
    const last = penPts[penPts.length - 1];
    if (!last || Math.hypot(px - last.x, py - last.y) >= 2) penPts.push({ x: px, y: py });
    redraw(); return;
  }
  redraw(); // ghost
});

cv.addEventListener('mouseup', e => {


  if (!isDown) return;
  isDown = false;
  _eraserHover = null;
  if (tool === 'mod-brush') {
    const brush = window.AnimationApp?.activeModBrush;

    if (brush && modBrushPoints.length > 1) {
      saveState();

      const added = {
        type: 'mod-brush',
        brushId: brush.id,
        brushModId: brush.modId || brush.id,
        pts: [...modBrushPoints],
        color,
        sw,
        opa,
        dash,
        hidden: false,
        name: brush.name || 'MODブラシ',
        layerId: getDrawableActiveLayerId()
      };

      shapes.push(added);
      selected = added;
      syncAll();
      setStatus(`${added.name} を追加`);
    }

    modBrushPoints = [];
    dragSel = false;
    redraw();
    return;
  };
  if (resizing) {
    resizing = false;
    resizeHandle = null;
    resizeStart = null;
    freeTransforming = false;
    cv.style.cursor = 'default';
    syncProps(); redraw(); return;
  }

  if (tool === 'select' && marqueeSelecting) {
    const { x, y } = canvasCoords(e);
    finishMarqueeSelection(x, y);
    return;
  }

  const { x, y } = canvasCoords(e);
  const dx = x - sx, dy = y - sy;
  let added = null;

  if (tool === 'brush' && brushPts.length > 0) {
    // ブラシストロークだけをオフスクリーン canvas に描いて保存
    const snap = document.createElement('canvas');
    snap.width = cv.width;
    snap.height = cv.height;
    const sctx = snap.getContext('2d');
    // 現在のブラシ描画をオフスクリーンに再現
    brushPts.forEach((p, idx) => {
      if (idx === 0) return;
      const prev = brushPts[idx - 1];
      const r = brushSize / 2;
      const grad = sctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
      const a = brushOpa / 100 * 0.4;
      grad.addColorStop(0, hexToRgba(color, a));
      grad.addColorStop(1, hexToRgba(color, 0));
      sctx.fillStyle = grad;
      sctx.beginPath(); sctx.arc(p.x, p.y, r, 0, Math.PI * 2); sctx.fill();
    });
    added = {
      type: 'brush', pts: [...brushPts], snap, color, opa: brushOpa,
      sw: brushSize, dash: '0', hidden: false, name: 'ブラシ', layerId: getDrawableActiveLayerId()
    };
    bLastX = null; bLastY = null; brushPts = [];
  } else if (tool === 'pen' && penPts.length > 1) {
    added = { type: 'pen', pts: [...penPts], color, sw, opa, dash, hidden: false, name: 'ペン', layerId: getDrawableActiveLayerId() };
  } else if (tool === 'rect' && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    added = {
      type: 'rect', x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(dx), h: Math.abs(dy),
      color, strokeColor, sw, rr, rot, opa, dash, fill: doFill, scaleX: 1, scaleY: 1,
      hidden: false, name: '四角形', layerId: getDrawableActiveLayerId()
    };
  } else if (tool === 'circle' && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    added = {
      type: 'circle', cx: (sx + x) / 2, cy: (sy + y) / 2, rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2,
      color, strokeColor, sw, rot, opa, dash, fill: doFill,
      hidden: false, name: '円', layerId: getDrawableActiveLayerId()
    };
  } else if (tool === 'triangle' && Math.hypot(dx, dy) > 10) {
    added = {
      type: 'triangle', cx: (sx + x) / 2, cy: (sy + y) / 2, r: Math.hypot(dx, dy) / 2,
      color, strokeColor, sw, rot, opa, dash, fill: doFill, scaleX: 1, scaleY: 1,
      hidden: false, name: '三角形', layerId: getDrawableActiveLayerId()
    };
  } else if (tool === 'polygon' && Math.hypot(dx, dy) > 10) {
    added = {
      type: 'polygon', cx: (sx + x) / 2, cy: (sy + y) / 2, r: Math.hypot(dx, dy) / 2, sides,
      color, strokeColor, sw, rot, opa, dash, fill: doFill, scaleX: 1, scaleY: 1,
      hidden: false, name: `${sides}角形`, layerId: getDrawableActiveLayerId()
    };
  } else if (tool === 'line' && Math.hypot(dx, dy) > 5) {
    added = {
      type: 'line', x1: sx, y1: sy, x2: x, y2: y,
      color, sw, opa, dash, hidden: false, name: '直線', layerId: getDrawableActiveLayerId()
    };
  } else if (tool === 'text') {
    const hasDrag = Math.abs(dx) > 5 || Math.abs(dy) > 5;
    added = {
      type: 'text',
      x: hasDrag ? Math.min(sx, x) : sx,
      y: hasDrag ? Math.min(sy, y) : sy,
      w: hasDrag ? Math.abs(dx) : 200,
      h: hasDrag ? Math.abs(dy) : 60,
      rot: 0, text: '', fontFamily: textFontFamily, fontSize: textFontSize,
      color, opa, hidden: false, name: 'テキスト', layerId: getDrawableActiveLayerId()
    };
  }

  if (added) {
    // 同名の図形があれば番号をつける
    const base = added.name;
    const cnt = shapes.filter(s => s.name.startsWith(base)).length;
    if (cnt > 0) added.name = base + ' ' + (cnt + 1);
    saveState();
    shapes.push(added);
    selected = added;
    syncAll();
    setStatus(added.name + ' を追加');
    if (added.type === 'text') {
      setTool('select');
      openTextInlineEditor(added);
    }
  }

  if (tool !== 'path') penPts = [];
  dragSel = false;
  redraw();
});

// テキスト図形: ダブルクリックで編集
cv.addEventListener('dblclick', e => {
  if (tool !== 'select') return;
  const { x, y } = canvasCoords(e);
  const hit = shapes.slice().reverse().find(s => !s.hidden && s.type === 'text' && canEditShape(s) && hitTest(s, x, y));
  if (!hit) return;
  e.preventDefault();
  selected = hit;
  multiSelected = [];
  syncProps(); syncLayers(); redraw();
  openTextInlineEditor(hit);
});

// path ツール: ダブルクリックでパス確定

cv.addEventListener('contextmenu', e => {
  e.preventDefault();
  const { x, y } = canvasCoords(e);
  const hit = shapes.slice().reverse().find(s => !s.hidden && canEditShape(s) && hitTest(s, x, y));
  if (hit) showContextMenu(e.clientX, e.clientY, hit);
});

cv.addEventListener('mouseleave', () => hideBrushCursor());

// ── 右クリックメニュー ────────────────────────────────────────
function showContextMenu(x, y, shape) {
  document.getElementById('ctx-menu-el')?.remove();
  const menu = document.createElement('div');
  menu.id = 'ctx-menu-el';
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const items = [
    {
      label: '🗑 削除',
      fn: () => { saveState(); shapes.splice(0, shapes.length, ...shapes.filter(s => s !== shape)); selected = null; multiSelected = []; syncAll(); }
    },
  ];

  items.forEach(it => {
    if (!it) { const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); return; }
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.textContent = it.label;
    el.onclick = () => { it.fn(); menu.remove(); };
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

// ── テキストボックス: インライン編集 ────────────────────────────
let _textEditorState = null;

function closeTextInlineEditor(commit = true) {
  const st = _textEditorState;
  if (!st) return;
  _textEditorState = null; // textarea.remove() が blur を誘発しても再入しないよう先にクリア
  const { shape, textarea } = st;
  if (commit) {
    shape.text = textarea.value;
    if (!shape.text.trim()) {
      const idx = shapes.indexOf(shape);
      if (idx !== -1) shapes.splice(idx, 1);
      if (selected === shape) selected = null;
    }
  }
  textarea.remove();
  syncAll();
}

function openTextInlineEditor(shape) {
  closeTextInlineEditor(true);
  selected = shape;

  const r = cv.getBoundingClientRect();
  // 画面上の見た目に重ねる。図形の値はドキュメント座標なので、ズームを掛ける
  // （掛けないと、拡大・縮小しているときに編集枠が文字からずれる）。
  const z = (typeof mpView !== 'undefined' && mpView.zoom) || 1;
  const fontSize = shape.fontSize || 24;
  const ta = document.createElement('textarea');
  ta.className = 'mp-text-inline-editor';
  ta.spellcheck = false;
  ta.value = shape.text || '';
  ta.style.left = (r.left + shape.x * z) + 'px';
  ta.style.top = (r.top + shape.y * z) + 'px';
  ta.style.width = (shape.w * z) + 'px';
  ta.style.height = (shape.h * z) + 'px';
  ta.style.fontFamily = shape.fontFamily || 'sans-serif';
  ta.style.fontSize = (fontSize * z) + 'px';
  ta.style.lineHeight = Math.round(fontSize * 1.3 * z) + 'px';
  ta.style.color = shape.color || '#fff';
  ta.style.background = canvasBg;
  document.body.appendChild(ta);

  _textEditorState = { shape, textarea: ta };
  ta.focus();
  ta.select();

  ta.addEventListener('input', () => { shape.text = ta.value; redraw(); });
  ta.addEventListener('keydown', e => {
    // stopPropagation必須: textareaを閉じてDOMから外すと、バブリング中に
    // document側のEscapeハンドラ(deleteSelected)がisTypingContext()を
    // 「編集中でない」と誤判定し、確定直後の図形を消してしまうため
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTextInlineEditor(true); }
  });
  ta.addEventListener('blur', () => closeTextInlineEditor(true));

  redraw();
}
