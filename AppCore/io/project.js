// ══════════════════════════════════════════════════════════════
// ファイル保存・読み込み
// ══════════════════════════════════════════════════════════════
function serializeProject() {
  return {
    app: 'Magic Paint',
    version: '3.0.0',
    schemaVersion: 3,
    layers: layers.map(l => ({ ...l })),
    activeLayerId,
    shapes: shapes.map(s => {
      const { snap, _orig, ...rest } = s;
      return rest;
    }),
    color,
    canvasBg: canvasBg || '#111111',
    docW: docW || 1280,
    docH: docH || 720,
    // Trigger→Animation/Action。編集可能な原本はBlocklyワークスペース側で、
    // interactions はそこから再生成される導出データ（読み込みを速くするための控え）。
    blockly: typeof serializeBlocklyState === 'function' ? serializeBlocklyState() : null,
    interactions: (interactions || []).map(r => ({ ...r })),
    mods: getUsedMods()
  };
}

function getUsedMods() {
  const ids = new Set();

  shapes.forEach(s => {
    if (s.modId) ids.add(s.modId);
    if (s.brushModId) ids.add(s.brushModId);
  });

  return [...ids];
}

function checkRequiredMods(requiredMods) {
  const loadedIds = []
    .concat(LoadedMods.map(m => m.id))
    .concat((typeof LoadedZipMods !== 'undefined' ? LoadedZipMods : []).map(m => m.id));
  const missing = requiredMods.filter(id => !loadedIds.includes(id));

  if (missing.length) {
    setStatus(`必要MODが不足: ${missing.join(', ')}`);
    toast('ti-alert-triangle', '必要MODが不足しています');
  }
}

function deserializeProject(data) {
  if (data.app && data.app !== 'Magic Paint') {
    if (!confirm(`このファイルは "${data.app}" 形式です。開きますか？`)) return;
  }
  checkRequiredMods(data.mods || []);

  // レイヤー復元（旧形式は layer-1 に統合）
  if (data.layers && data.layers.length > 0) {
    layers.length = 0;
    layers.push(...data.layers);
    activeLayerId = data.activeLayerId || layers.find(l => l.type !== 'folder')?.id || layers[0].id;
  } else {
    layers.length = 0;
    layers.push({ id: 'layer-1', name: 'Layer 1', type: 'normal', parentId: null, visible: true, locked: false, opacity: 1, blendMode: 'source-over', color: null, collapsed: false });
    activeLayerId = 'layer-1';
  }

  const loadedShapes = (data.shapes || []).map(s => ({
    ...s,
    engine: s.engine || 'canvas2d',
    layerId: s.layerId || 'layer-1'
  }));
  shapes.length = 0;
  shapes.push(...loadedShapes);
  // 旧形式の図形に layerId を付与
  shapes.forEach(s => { if (!s.layerId) s.layerId = 'layer-1'; });
  // 旧KF形式({t, props:{...}})を新フラット形式へ移行
  if (typeof migrateLegacyKeyframes === 'function') {
    shapes.forEach(s => migrateLegacyKeyframes(s));
  }
  // パスの時間指定(pathStartT/pathEndTスカラー)をpathProgress KFへ移行
  if (typeof migratePathTimingScalars === 'function') {
    shapes.forEach(s => migratePathTimingScalars(s));
  }

  color = data.color || '#3B8AE6';
  // 旧形式のファイルには無いので、常に配列として復元する
  interactions = Array.isArray(data.interactions) ? data.interactions.map(r => ({ ...r })) : [];
  // ワークスペースが保存されていれば、そちらを原本として interactions を作り直す
  if (typeof restoreBlocklyState === 'function') restoreBlocklyState(data.blockly || null);
  if (data.canvasBg) { canvasBg = data.canvasBg; }
  // 保存されたドキュメントサイズを復元。無い旧形式のファイルは
  // 現在のサイズをそのまま維持する（強制的に縮めて図形を消さないため）。
  if (Number(data.docW) > 0 && Number(data.docH) > 0) {
    docW = Math.round(Number(data.docW));
    docH = Math.round(Number(data.docH));
  }
  setColor(color);
  selected = null;
  multiSelected = [];
  if (typeof resizeCanvas === 'function') resizeCanvas();
  if (typeof mpFitToWrap === 'function') mpFitToWrap({ silent: true });
  syncAll();
}

// 静的サイトとして動かすため、保存は .mlc ファイルの書き出しに一本化している。
// （以前はサーバーの /projects に保存し、失敗したらファイルへフォールバックしていた）
function saveProject() {
  const name = document.getElementById('proj-name').textContent.replace('.mlc', '') || '無題';
  const blob = new Blob([JSON.stringify({ name, data: serializeProject() })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.mlc';
  a.click();
  URL.revokeObjectURL(url);
  if (typeof closeFileMenu === 'function') closeFileMenu();
  toast('ti-device-floppy', '.mlcとして保存しました');
}

function exportMLC() {
  const name = document.getElementById('proj-name').textContent.replace('.mlc', '') || '無題';

  const blob = new Blob([
    JSON.stringify({ name, data: serializeProject() }, null, 2)
  ], { type: 'application/json' });

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.mlc';
  a.click();

  URL.revokeObjectURL(url);

  toast('ti-file-export', '.mlcを書き出しました');
}

function openMLC() {
  const input = document.createElement('input');

  input.type = 'file';
  input.accept = '.mlc,application/json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);

      if (!json.data) {
        throw new Error('無効なMLCファイル');
      }

      deserializeProject(json.data);

      document.getElementById('proj-name').textContent =
        (json.name || file.name.replace('.mlc', '')) + '.mlc';

      redraw();

      toast('ti-file-import', '.mlcを読み込みました');

    } catch (err) {
      console.error(err);

      toast('ti-alert-triangle', '.mlc読み込み失敗');
      setStatus('MLC読み込みエラー');
    }
  };

  input.click();
}

// 開くのもファイル選択のみ（プロジェクト一覧はサーバーが必要なため廃止）
function openProject() {
  openMLC();
}

function newProject() {
  openCanvasSizeModal({ mode: 'new' });
}

function _createNewProject(w, h) {
  shapes.length = 0; selected = null; multiSelected = []; currentProjectId = null;
  undoStack.length = 0; redoStack.length = 0;
  layers.length = 0;
  layers.push({ id: 'layer-1', name: 'Layer 1', visible: true, locked: false, opacity: 1, blendMode: 'source-over' });
  activeLayerId = 'layer-1';
  docW = w; docH = h;
  localStorage.setItem('mpDocW', String(docW));
  localStorage.setItem('mpDocH', String(docH));
  document.getElementById('proj-name').textContent = '無題.mlc';
  if (typeof resizeCanvas === 'function') resizeCanvas();
  if (typeof mpFitToWrap === 'function') mpFitToWrap({ silent: true });
  syncAll();
  toast('ti-file-plus', '新規プロジェクト');
}

// ── キャンバスサイズ選択モーダル ──────────────────────────────
// mode: 'new'(新規プロジェクト作成前のサイズ選択) | 'resize'(現在のプロジェクトのサイズ変更)
function openCanvasSizeModal(opts = {}) {
  const isNew = opts.mode === 'new';
  document.getElementById('canvas-size-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'canvas-size-modal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:900;display:flex;align-items:center;justify-content:center';
  const presets = [
    [1280, 720, '1280×720'],
    [1920, 1080, '1920×1080'],
    [1080, 1080, '1080×1080'],
    [800, 600, '800×600'],
    [375, 667, '375×667']
  ];
  wrap.innerHTML = `
    <div style="background:#1f1f1f;border:1px solid #333;border-radius:10px;padding:20px 24px;width:300px;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:14px;font-weight:600;color:#e8e6df">${isNew ? '新規プロジェクトのサイズ' : 'キャンバスサイズを変更'}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="cs-width" min="16" max="8000" step="1" value="${docW}"
          style="width:80px;padding:5px 6px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#eee;font-size:12px">
        <span style="color:#888">×</span>
        <input type="number" id="cs-height" min="16" max="8000" step="1" value="${docH}"
          style="width:80px;padding:5px 6px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#eee;font-size:12px">
        <span style="color:#888;font-size:12px">px</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${presets.map(([w, h, label]) => `<button onclick="document.getElementById('cs-width').value=${w};document.getElementById('cs-height').value=${h}"
          style="padding:4px 8px;border-radius:5px;border:1px solid #3a3a3a;background:#262626;color:#aaa;font-size:11px;cursor:pointer">${label}</button>`).join('')}
      </div>
      ${!isNew ? '<div style="font-size:11px;color:#888;line-height:1.5">既存の図形の座標はそのままです。キャンバスの外側にある図形は表示されなくなります。</div>' : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="document.getElementById('canvas-size-modal').remove()"
          style="padding:6px 14px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#aaa;font-size:12px;cursor:pointer">
          キャンセル
        </button>
        <button onclick="_confirmCanvasSize(${isNew})"
          style="padding:6px 14px;border-radius:6px;border:none;background:#3B8AE6;color:#fff;font-size:12px;cursor:pointer">
          ${isNew ? '作成' : 'OK'}
        </button>
      </div>
    </div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.body.appendChild(wrap);
}

function _confirmCanvasSize(isNew) {
  const wInput = document.getElementById('cs-width');
  const hInput = document.getElementById('cs-height');
  const w = Math.max(16, Math.min(8000, Math.round(Number(wInput.value) || docW)));
  const h = Math.max(16, Math.min(8000, Math.round(Number(hInput.value) || docH)));
  document.getElementById('canvas-size-modal')?.remove();
  closeFileMenu();
  if (isNew) {
    _createNewProject(w, h);
  } else {
    docW = w; docH = h;
    localStorage.setItem('mpDocW', String(docW));
    localStorage.setItem('mpDocH', String(docH));
    if (typeof resizeCanvas === 'function') resizeCanvas();
    if (typeof mpFitToWrap === 'function') mpFitToWrap();
    toast('ti-dimensions', `キャンバスサイズ: ${docW}×${docH}`);
  }
}

function exportPNG() {
  document.getElementById('png-export-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'png-export-modal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:900;display:flex;align-items:center;justify-content:center';
  wrap.innerHTML = `
    <div style="background:#1f1f1f;border:1px solid #333;border-radius:10px;padding:20px 24px;width:260px;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:14px;font-weight:600;color:#e8e6df">PNG書き出し</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ccc;cursor:pointer">
        <input type="checkbox" id="png-transparent" style="width:14px;height:14px">
        透明背景
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button onclick="document.getElementById('png-export-modal').remove()"
          style="padding:6px 14px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#aaa;font-size:12px;cursor:pointer">
          キャンセル
        </button>
        <button onclick="_doExportPNG(document.getElementById('png-transparent').checked)"
          style="padding:6px 14px;border-radius:6px;border:none;background:#3B8AE6;color:#fff;font-size:12px;cursor:pointer">
          書き出し
        </button>
      </div>
    </div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
  document.body.appendChild(wrap);
}

function _doExportPNG(transparent) {
  document.getElementById('png-export-modal')?.remove();
  closeFileMenu();

  const offscreen = document.createElement('canvas');
  offscreen.width = cv.width;
  offscreen.height = cv.height;
  const oc = offscreen.getContext('2d');

  if (!transparent) {
    oc.fillStyle = canvasBg || '#111111';
    oc.fillRect(0, 0, offscreen.width, offscreen.height);
  }

  const normalLayers = layers.filter(l => l.type !== 'folder');
  const layerIds = new Set(normalLayers.map(l => l.id));
  normalLayers.forEach(layer => {
    if (!layerIsVisible(layer)) return;
    shapes
      .filter(s => (s.layerId || 'layer-1') === layer.id && _is2d(s) && !s.hidden)
      .forEach(s => drawShape(s, oc));
  });
  shapes
    .filter(s => s.layerId && !layerIds.has(s.layerId) && _is2d(s) && !s.hidden)
    .forEach(s => drawShape(s, oc));

  const cvThree = document.getElementById('cv-three');
  const hasVisibleThreeJs = shapes.some(s => {
    if (_is2d(s) || s.hidden) return false;
    const layer = layers.find(l => l.id === (s.layerId || 'layer-1'));
    return layerIsVisible(layer);
  });
  if (cvThree && cvThree.width > 0 && cvThree.height > 0 && hasVisibleThreeJs) {
    oc.drawImage(cvThree, 0, 0, offscreen.width, offscreen.height);
  }

  offscreen.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = document.getElementById('proj-name')?.textContent?.replace('.mlc', '') || 'canvas';
    a.href = url;
    a.download = name + '.png';
    a.click();
    URL.revokeObjectURL(url);
    toast('ti-photo', 'PNG書き出し完了');
  }, 'image/png');
}
