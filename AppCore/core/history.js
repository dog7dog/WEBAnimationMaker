// ── Undo / Redo ──────────────────────────────────────────────
const MAX_HISTORY = 80;

function snapshot() {
  return JSON.stringify({
    shapes: shapes.map(s => { const { snap, ...rest } = s; return rest; }),
    selectedId: selected?.id ?? null,
    multiSelectedIds: multiSelected.slice(),
    FPS,
    canvasBg,
    docW,
    docH,
    pageViewHeight,
    layers: layers.map(l => ({ ...l })),
    activeLayerId,
  });
}

function restore(data) {
  const state = JSON.parse(data);

  shapes.length = 0;
  shapes.push(...state.shapes);

  selected = shapes.find(s => s.id === state.selectedId) ?? null;
  multiSelected = state.multiSelectedIds ?? [];

  if (state.FPS != null)      FPS      = state.FPS;
  if (state.canvasBg != null) canvasBg = state.canvasBg;
  if (Number(state.pageViewHeight) > 0) pageViewHeight = state.pageViewHeight;
  // ページの高さ・幅も戻す（下端バーで伸ばした分を⌘Zで取り消せるように）
  if (Number(state.docW) > 0 && Number(state.docH) > 0
      && (state.docW !== docW || state.docH !== docH)) {
    docW = state.docW;
    docH = state.docH;
    try { localStorage.setItem('mpDocW', String(docW)); localStorage.setItem('mpDocH', String(docH)); } catch (e) {}
    if (typeof resizeCanvas === 'function') resizeCanvas();
  }
  if (state.layers?.length) {
    layers.length = 0;
    layers.push(...state.layers);
  }
  if (state.activeLayerId) activeLayerId = state.activeLayerId;

  syncAll();
}

function saveState() {
  const snap = snapshot();
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

// 色・線幅・角度などのプロパティ変更を「元に戻す」できるようにする。
// （変更を反映する「前」に呼ぶこと）
//
// key を渡すと、同じ key の変更が続いているあいだは1回の操作にまとめる。
// スライダーのドラッグや色ピッカーの操作は input イベントが連続で来るので、
// 毎回積むと1回の操作を戻すのに何十回も⌘Zが要るため。
// key を渡さない変更（パレットのクリック、チェックの切り替えなど）は
// 1回ずつ別の操作として積む。素早く続けてクリックしても混ざらない。
const PROPERTY_EDIT_GAP = 600;
let _propertyEditTimer = null;
let _propertyEditKey = null;

function beginPropertyEdit(key) {
  const continuing = key && key === _propertyEditKey && _propertyEditTimer;
  if (!continuing) saveState();
  clearTimeout(_propertyEditTimer);
  _propertyEditKey = key || null;
  _propertyEditTimer = key
    ? setTimeout(() => { _propertyEditTimer = null; _propertyEditKey = null; }, PROPERTY_EDIT_GAP)
    : null;
}

// ⌘Zの直後にまた変更したら、それは別の操作として積み直す
function _endPropertyEdit() {
  clearTimeout(_propertyEditTimer);
  _propertyEditTimer = null;
  _propertyEditKey = null;
}

function undo() {
  _endPropertyEdit();
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  setStatus('元に戻しました');
}

function redo() {
  _endPropertyEdit();
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  setStatus('やり直しました');
}
