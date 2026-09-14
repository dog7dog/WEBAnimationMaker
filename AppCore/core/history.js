// ── Undo / Redo ──────────────────────────────────────────────
const MAX_HISTORY = 80;

function snapshot() {
  return JSON.stringify({
    shapes: shapes.map(s => { const { snap, ...rest } = s; return rest; }),
    selectedId: selected?.id ?? null,
    multiSelectedIds: multiSelected.slice(),
    FPS,
    canvasBg,
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
// スライダーのドラッグや色ピッカーの操作は input イベントが連続で来るので、
// 毎回積むと1回の操作を戻すのに何十回も⌘Zが要る。
// 少し間が空いたら次の操作とみなし、ひと続きの変更の手前で1回だけ積む。
// （変更を反映する「前」に呼ぶこと）
const PROPERTY_EDIT_GAP = 600;
let _propertyEditTimer = null;

function beginPropertyEdit() {
  if (!_propertyEditTimer) saveState();
  clearTimeout(_propertyEditTimer);
  _propertyEditTimer = setTimeout(() => { _propertyEditTimer = null; }, PROPERTY_EDIT_GAP);
}

// ⌘Zの直後にまた変更したら、それは別の操作として積み直す
function _endPropertyEdit() {
  clearTimeout(_propertyEditTimer);
  _propertyEditTimer = null;
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
