// ══════════════════════════════════════════════════════════════
// JSエディタ
// ══════════════════════════════════════════════════════════════
// 'blockly'(コーディングタブの生成コード) | 'canvas'(手書きJS) |
// MODが足すモード('threejs' | 'html' | 'css' など)
let jeMode = 'blockly';

function initViewTabs() {
  const tabDesign = document.getElementById('tab-design');
  const tabCoding = document.getElementById('tab-coding');
  const tabCanvas = document.getElementById('tab-canvas');
  const tabEditor = document.getElementById('tab-editor');
  const workspace   = document.getElementById('workspace');
  const editorPanel = document.getElementById('js-editor-panel');
  const layersPanel = document.getElementById('layers-panel');
  const canvasPanel = document.getElementById('canvas-preview-panel');
  const codingPanel = document.getElementById('coding-panel');
  const topbar      = document.getElementById('topbar');
  if (!tabDesign) return;

  // デザイン / コーディング / キャンバス の3画面。
  // レイヤーとJSエディタは、タブではなくボタンで開くオーバーレイにしている。
  function showView(view) {
    const isCoding = view === 'coding';
    const isCanvas = view === 'canvas';
    const isEditor = view === 'editor';
    const isDesign = !isCoding && !isCanvas && !isEditor;

    tabDesign?.classList.toggle('active', isDesign);
    tabCoding?.classList.toggle('active', isCoding);
    tabCanvas?.classList.toggle('active', isCanvas);
    tabEditor?.classList.toggle('active', isEditor);

    workspace.style.display = isDesign ? 'flex' : 'none';
    topbar.style.display    = isDesign ? 'flex' : 'none';
    if (canvasPanel) canvasPanel.classList.toggle('active', isCanvas);
    if (codingPanel) codingPanel.classList.toggle('active', isCoding);
    if (editorPanel) editorPanel.classList.toggle('active', isEditor);
    // 画面を移ったらレイヤーのオーバーレイは閉じる
    if (layersPanel) layersPanel.classList.remove('active');

    // キャンバスタブを表示している間だけ、生成CSS/JSを実DOMへ注入する
    // （他の画面に戻ったら外し、デザイン面の編集に影響を残さない）
    if (typeof setInteractionPreviewActive === 'function') {
      setInteractionPreviewActive(isCanvas);
    }

    if (isEditor) {
      initMonacoEditor();
      if (typeof syncGeneratedCodeToEditor === 'function') syncGeneratedCodeToEditor();
      renderJeFiles();
      setTimeout(() => monacoEditor?.layout(), 30);
    } else if (isCanvas) {
      // パネルのサイズが確定してから縮小率を計算する
      setTimeout(() => { if (typeof syncDomMirror === 'function') syncDomMirror(); }, 30);
    } else if (isCoding) {
      // 初回表示時にBlocklyを読み込む（表示サイズが決まってから注入する）
      setTimeout(() => { if (typeof initCodingTab === 'function') initCodingTab(); }, 30);
    } else {
      setTimeout(() => {
        resizeCanvas();
        if (typeof drawRulers === 'function') drawRulers();
      }, 30);
    }
  }

  tabDesign?.addEventListener('click', () => showView('design'));
  tabCoding?.addEventListener('click', () => showView('coding'));
  tabCanvas?.addEventListener('click', () => showView('canvas'));
  tabEditor?.addEventListener('click', () => showView('editor'));

  // レイヤー（デザイン画面のオーバーレイ）
  document.getElementById('layers-btn')?.addEventListener('click', () => {
    layersPanel?.classList.add('active');
    syncLayers();
  });
  document.getElementById('btn-close-layers')?.addEventListener('click', () => {
    layersPanel?.classList.remove('active');
  });

  document.getElementById('btn-coding-preview')?.addEventListener('click', () => showView('canvas'));
  document.getElementById('btn-canvas-refresh')?.addEventListener('click', () => {
    if (typeof applyInteractions === 'function') applyInteractions();
  });
  document.getElementById('btn-site-export')?.addEventListener('click', () => {
    if (typeof exportSiteHtml === 'function') exportSiteHtml();
  });
  document.getElementById('btn-site-open')?.addEventListener('click', () => {
    if (typeof openSitePreview === 'function') openSitePreview();
  });

  window.mpShowView = showView;
}

// ══════════════════════════════════════════════════════════════
// Monaco Editor（テキストエディタ用）
// ══════════════════════════════════════════════════════════════
let monacoEditor = null;
let monacoLoading = null;
let monacoSyncing = false;

function monacoLangForMode(mode) {
  if (mode === 'blocklycss') return 'css';
  if (mode === 'html') return 'html';
  if (mode === 'css') return 'css';
  return 'javascript';
}

// "@latest" は jsdelivr のエイリアス解決が不安定で、'javascript' などの
// 言語コントリビューションが登録されないまま editor.main が resolve されることがあり
// (シンタックスハイライトが一切効かず全トークンが plaintext 扱いになる)、
// 実バージョンを明示的に固定することで解消する。
const MONACO_VERSION = '0.52.2';

function loadMonaco() {
  if (window.monaco) return Promise.resolve();
  if (monacoLoading) return monacoLoading;
  monacoLoading = new Promise((resolve, reject) => {
    const loader = document.createElement('script');
    loader.src = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs/loader.js`;
    loader.onload = () => {
      window.require.config({ paths: { vs: `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs` } });
      window.require(['vs/editor/editor.main'], resolve, reject);
    };
    loader.onerror = reject;
    document.head.appendChild(loader);
  });
  return monacoLoading;
}

function initMonacoEditor() {
  const codeEl = document.getElementById('je-code');
  const container = document.getElementById('je-monaco');
  if (!codeEl || !container || monacoEditor || codeEl.dataset.monacoBound === '1') return;
  codeEl.dataset.monacoBound = '1';

  // je-code の value を Monaco と同期する共有プロパティに置き換える
  let _val = codeEl.value;
  Object.defineProperty(codeEl, 'value', {
    get() { return _val; },
    set(v) {
      _val = v;
      if (monacoEditor && !monacoSyncing && monacoEditor.getValue() !== v) {
        monacoSyncing = true;
        monacoEditor.setValue(v);
        monacoSyncing = false;
      }
    }
  });

  loadMonaco().then(() => {
    monacoEditor = monaco.editor.create(container, {
      value: _val,
      language: monacoLangForMode(jeMode),
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      tabSize: 2,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });

    monacoEditor.onDidChangeModelContent(() => {
      if (monacoSyncing) return;
      _val = monacoEditor.getValue();
      codeEl.dispatchEvent(new Event('input'));
    });

    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runEditorCode();
    });
  }).catch(err => {
    console.warn('Monaco Editorの読み込みに失敗しました', err);
    monacoLoading = null;
  });
}

// ══════════════════════════════════════════════════════════════
// ファイルマネージャ（テキストエディタ右パネル）
// ══════════════════════════════════════════════════════════════
window.__jeUserFiles = window.__jeUserFiles || {};
window.__jeActiveCustomFile = window.__jeActiveCustomFile || null;

function modeFileName(mode) {
  if (mode === 'blockly') return 'blockly.js';
  if (mode === 'blocklycss') return 'blockly.css';
  if (mode === 'threejs') return 'threejs.js';
  if (mode === 'html') return 'index.html';
  if (mode === 'css') return 'style.css';
  if (mode === 'canvas') return 'canvas.js';
  return mode + '.js';
}

function modeFileIcon(mode) {
  if (mode === 'blockly') return 'ti-puzzle-2';
  if (mode === 'blocklycss') return 'ti-brand-css3';
  if (mode === 'threejs') return 'ti-cube';
  if (mode === 'html') return 'ti-brand-html5';
  if (mode === 'css') return 'ti-brand-css3';
  return 'ti-brand-javascript';
}

function monacoLangForFile(name) {
  if (/\.html?$/i.test(name)) return 'html';
  if (/\.css$/i.test(name)) return 'css';
  return 'javascript';
}

// ── コーディングタブ(Blockly)との同期 ────────────────────────
// ブロックで組んだプログラムを、そのままテキストエディタに映す。
// 逆方向（テキスト→ブロック）は一般には復元できないので、
// 手で書き換えたら同期を止め、「取り込む」で明示的に上書きできるようにする。
// コーディングタブが生成する2つのファイル。どちらもブロックに追従する。
//   blockly.js  … 実行されるJS
//   blockly.css … 一緒に書き出されるCSS（見た目の変化はこちらが担当）
const MLC_GENERATED_MODES = {
  blockly:    { file: 'blockly.js',  lang: 'javascript', manualKey: '__blocklyManual' },
  blocklycss: { file: 'blockly.css', lang: 'css',        manualKey: '__blocklyCssManual' }
};

function isGeneratedMode(mode) {
  return Object.prototype.hasOwnProperty.call(MLC_GENERATED_MODES, mode);
}

function generatedBlocklyCode() {
  if (typeof generateInteractionCode !== 'function') return '';
  const { js } = generateInteractionCode();
  const head = [
    '// ── コーディングタブで組み立てたプログラム ──────────────',
    '// ブロックを編集すると、ここは自動で更新されます。',
    '// 直接書き換えると同期は止まります（「取り込む」で戻せます）。',
    '// 見た目の変化はCSSが担当します → blockly.css'
  ].join('\n');
  return head + '\n\n' + (js.trim() || '// (まだブロックがありません)') + '\n';
}

function generatedBlocklyCss() {
  if (typeof generateInteractionCode !== 'function') return '';
  const { css } = generateInteractionCode();
  const head = [
    '/* ── コーディングタブで組み立てたプログラム（CSS） ────────',
    '   見た目の変化はこちらが担当します（動きの制御は blockly.js）。',
    '   ブロックを編集すると、ここは自動で更新されます。',
    '   直接書き換えると同期は止まります（「取り込む」で戻せます）。',
    '   図形そのものの位置やサイズのCSSは、デザインタブの内容から',
    '   書き出し時に別途生成されます。',
    '*/'
  ].join('\n');
  return head + '\n\n' + (css.trim() || '/* (まだブロックがありません) */') + '\n';
}

function generatedContentFor(mode) {
  return mode === 'blocklycss' ? generatedBlocklyCss() : generatedBlocklyCode();
}

// コーディングタブの内容が変わったときに呼ばれる。
// 表示中のファイルは書き換え、表示していない方はキャッシュだけ更新する。
function syncGeneratedCodeToEditor(force) {
  const codeEl = document.getElementById('je-code');
  if (!codeEl) return;
  window.__jeCodeCache = window.__jeCodeCache || {};

  Object.entries(MLC_GENERATED_MODES).forEach(([mode, spec]) => {
    const content = generatedContentFor(mode);
    const isShown = !window.__jeActiveCustomFile && jeMode === mode;

    if (!isShown) {
      // 手で書き換えたものはキャッシュを保持する（「取り込む」なら上書き）
      if (force || window.__jeCodeCache[spec.manualKey] !== true) {
        window.__jeCodeCache[mode] = content;
        if (force) window.__jeCodeCache[spec.manualKey] = false;
      }
      return;
    }

    if (!force && codeEl.dataset.manual === '1') return;

    codeEl.value = content;
    codeEl.dataset.manual = '0';
    window.__jeCodeCache[mode] = content;
    window.__jeCodeCache[spec.manualKey] = false;
    updateEditorRunButtonVisibility();
  });
}

function persistJeUserFiles() {
  try {
    localStorage.setItem('mlcEditorUserFiles', JSON.stringify(window.__jeUserFiles));
  } catch (e) { /* noop */ }
}

function loadJeUserFiles() {
  try {
    window.__jeUserFiles = JSON.parse(localStorage.getItem('mlcEditorUserFiles') || '{}');
  } catch (e) {
    window.__jeUserFiles = {};
  }
}

// 現在のモード（ファイル）を切り替える。ビルトインファイル一覧からのクリックと
// je-mode-select の change の両方からこの一本の経路を通す。
function switchToModeFile(mode) {
  const codeEl = document.getElementById('je-code');
  const modeSelect = document.getElementById('je-mode-select');
  const genBtn = document.getElementById('je-gen-btn');
  const runBtn = document.getElementById('je-run-btn');
  if (!codeEl || !modeSelect) return;

  // 現在のバッファ内容を保存
  if (window.__jeActiveCustomFile) {
    window.__jeUserFiles[window.__jeActiveCustomFile] = codeEl.value;
    persistJeUserFiles();
  } else {
    window.__jeCodeCache = window.__jeCodeCache || {};
    window.__jeCodeCache[jeMode] = codeEl.value;
  }
  window.__jeActiveCustomFile = null;

  jeMode = mode;
  modeSelect.value = mode;
  stopJeAnim();
  modeSelect.className = modeSelect.className.split(' ').filter(c => !c.endsWith('-mode')).join(' ');
  if (monacoEditor) monaco.editor.setModelLanguage(monacoEditor.getModel(), monacoLangForMode(jeMode));

  if (window.__jeModeHandlers?.[jeMode]) {
    window.__jeModeHandlers[jeMode].activate?.(modeSelect, genBtn, runBtn, codeEl);
  } else {
    genBtn.classList.remove('hidden');
    runBtn.innerHTML = '<i class="ti ti-player-play"></i> JS実行';
    codeEl.placeholder = '// GSAPコードをここに書いてください';
    window.__jeCodeCache = window.__jeCodeCache || {};
    if (isGeneratedMode(jeMode)) {
      // コーディングタブの生成物。手で書き換えていない限り最新に追従する
      const spec = MLC_GENERATED_MODES[jeMode];
      const cached = window.__jeCodeCache[jeMode];
      const manual = window.__jeCodeCache[spec.manualKey] === true;
      codeEl.value = manual && cached !== undefined ? cached : generatedContentFor(jeMode);
      codeEl.dataset.manual = manual ? '1' : '0';
      codeEl.placeholder = '';
    } else {
      const cached = window.__jeCodeCache[jeMode];
      if (cached !== undefined) {
        codeEl.value = cached;
        codeEl.dataset.manual = cached.trim() ? '1' : '0';
      } else {
        codeEl.value = '';
        codeEl.dataset.manual = '0';
      }
    }
  }
  updateEditorRunButtonVisibility();
  renderJeFiles();
}

function openCustomFile(name) {
  const codeEl = document.getElementById('je-code');
  if (!codeEl || window.__jeUserFiles[name] === undefined) return;

  // 現在のバッファ内容を保存
  if (window.__jeActiveCustomFile) {
    window.__jeUserFiles[window.__jeActiveCustomFile] = codeEl.value;
  } else {
    window.__jeCodeCache = window.__jeCodeCache || {};
    window.__jeCodeCache[jeMode] = codeEl.value;
  }
  persistJeUserFiles();

  window.__jeActiveCustomFile = name;
  stopJeAnim();
  codeEl.value = window.__jeUserFiles[name] || '';
  codeEl.dataset.manual = '1';
  if (monacoEditor) monaco.editor.setModelLanguage(monacoEditor.getModel(), monacoLangForFile(name));
  updateEditorRunButtonVisibility();
  renderJeFiles();
}

function createNewJeFile() {
  let name = prompt('新しいファイル名を入力してください（例: utils.js）', 'new-file.js');
  if (!name) return;
  name = name.trim();
  if (!name) return;
  if (window.__jeUserFiles[name] !== undefined) {
    window.toast?.('ti-alert-triangle', '同名のファイルが既に存在します');
    return;
  }
  window.__jeUserFiles[name] = '';
  persistJeUserFiles();
  openCustomFile(name);
}

function renameCustomFile(oldName) {
  const newName = prompt('新しいファイル名を入力してください', oldName);
  if (!newName || newName.trim() === '' || newName === oldName) return;
  if (window.__jeUserFiles[newName] !== undefined) {
    window.toast?.('ti-alert-triangle', '同名のファイルが既に存在します');
    return;
  }
  window.__jeUserFiles[newName] = window.__jeUserFiles[oldName];
  delete window.__jeUserFiles[oldName];
  if (window.__jeActiveCustomFile === oldName) window.__jeActiveCustomFile = newName;
  persistJeUserFiles();
  renderJeFiles();
}

function deleteCustomFile(name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  delete window.__jeUserFiles[name];
  persistJeUserFiles();
  if (window.__jeActiveCustomFile === name) {
    window.__jeActiveCustomFile = null;
    switchToModeFile(jeMode);
    return;
  }
  renderJeFiles();
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getModeFileContent(mode) {
  const codeEl = document.getElementById('je-code');
  if (!window.__jeActiveCustomFile && jeMode === mode) return codeEl.value;
  window.__jeCodeCache = window.__jeCodeCache || {};
  if (window.__jeCodeCache[mode] !== undefined) return window.__jeCodeCache[mode];
  return '';
}

function getCustomFileContent(name) {
  const codeEl = document.getElementById('je-code');
  if (window.__jeActiveCustomFile === name) return codeEl.value;
  return window.__jeUserFiles[name] || '';
}

function renderJeFiles() {
  const list = document.getElementById('je-files-list');
  const modeSelect = document.getElementById('je-mode-select');
  if (!list || !modeSelect) return;
  list.innerHTML = '';

  Array.from(modeSelect.options).forEach(opt => {
    const mode = opt.value;
    const name = modeFileName(mode);
    const item = document.createElement('div');
    item.className = 'je-file-item' + (!window.__jeActiveCustomFile && jeMode === mode ? ' active' : '');
    item.title = opt.textContent.trim();
    const icon = document.createElement('i');
    icon.className = 'ti ' + modeFileIcon(mode);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'je-file-name';
    nameSpan.textContent = name;
    const actions = document.createElement('span');
    actions.className = 'je-file-actions';
    const dlBtn = document.createElement('button');
    dlBtn.title = 'ダウンロード';
    dlBtn.innerHTML = '<i class="ti ti-download"></i>';
    dlBtn.addEventListener('click', e => { e.stopPropagation(); downloadFile(name, getModeFileContent(mode)); });
    actions.appendChild(dlBtn);
    item.appendChild(icon);
    item.appendChild(nameSpan);
    item.appendChild(actions);
    item.addEventListener('click', () => switchToModeFile(mode));
    list.appendChild(item);
  });

  Object.keys(window.__jeUserFiles).sort().forEach(name => {
    const item = document.createElement('div');
    item.className = 'je-file-item' + (window.__jeActiveCustomFile === name ? ' active' : '');
    const icon = document.createElement('i');
    icon.className = 'ti ti-file-text';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'je-file-name';
    nameSpan.textContent = name;
    const actions = document.createElement('span');
    actions.className = 'je-file-actions';
    const dlBtn = document.createElement('button');
    dlBtn.title = 'ダウンロード';
    dlBtn.innerHTML = '<i class="ti ti-download"></i>';
    dlBtn.addEventListener('click', e => { e.stopPropagation(); downloadFile(name, getCustomFileContent(name)); });
    const renameBtn = document.createElement('button');
    renameBtn.title = '名前変更';
    renameBtn.innerHTML = '<i class="ti ti-pencil"></i>';
    renameBtn.addEventListener('click', e => { e.stopPropagation(); renameCustomFile(name); });
    const delBtn = document.createElement('button');
    delBtn.title = '削除';
    delBtn.innerHTML = '<i class="ti ti-trash"></i>';
    delBtn.addEventListener('click', e => { e.stopPropagation(); deleteCustomFile(name); });
    actions.appendChild(dlBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    item.appendChild(icon);
    item.appendChild(nameSpan);
    item.appendChild(actions);
    item.addEventListener('click', () => openCustomFile(name));
    list.appendChild(item);
  });
}

function uniqueJeFileName(name) {
  const m = name.match(/^(.*?)(\.[^.]*)?$/);
  const base = m[1], ext = m[2] || '';
  let i = 2;
  let candidate = base + ' (' + i + ')' + ext;
  while (window.__jeUserFiles[candidate] !== undefined) {
    i++;
    candidate = base + ' (' + i + ')' + ext;
  }
  return candidate;
}

// PCから選んだファイルを読み込み、ファイル一覧に追加して開く
function importLocalFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      let name = file.name;
      if (window.__jeUserFiles[name] !== undefined &&
          !confirm(`「${name}」は既に存在します。上書きしますか？`)) {
        name = uniqueJeFileName(name);
      }
      window.__jeUserFiles[name] = reader.result;
      persistJeUserFiles();
      resolve(name);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function importLocalFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let lastName = null;
  for (const file of files) {
    try {
      lastName = await importLocalFile(file);
    } catch (e) {
      window.toast?.('ti-alert-triangle', `「${file.name}」の読み込みに失敗しました`);
    }
  }
  if (lastName) {
    openCustomFile(lastName);
    window.toast?.('ti-file-check', `${files.length}件のファイルを読み込みました`);
  }
}

function initJeFileManager() {
  loadJeUserFiles();
  const addBtn = document.getElementById('je-file-add-btn');
  addBtn?.addEventListener('click', createNewJeFile);

  const importBtn = document.getElementById('je-file-import-btn');
  const importInput = document.getElementById('je-file-import-input');
  importBtn?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', async e => {
    await importLocalFiles(e.target.files);
    e.target.value = '';
  });

  renderJeFiles();
}

function updateEditorRunButtonVisibility() {
  const codeEl = document.getElementById('je-code');
  const runBtn = document.getElementById('je-run-btn');
  if (!runBtn) return;
  // CSSファイルはJSとして実行できないのでボタンを出さない
  const isCss = monacoLangForMode(jeMode) === 'css'
    || (window.__jeActiveCustomFile && monacoLangForFile(window.__jeActiveCustomFile) === 'css');
  const manual = codeEl?.dataset.manual === '1';
  runBtn.classList.toggle('hidden', isCss || !manual);
  runBtn.title = manual ? '手書きJSを実行 Ctrl+Enter' : 'JSを書き換えると実行できます';
}

function initJSEditor() {
  const genBtn = document.getElementById('je-gen-btn');
  const runBtn = document.getElementById('je-run-btn');
  const codeEl = document.getElementById('je-code');
  const consoleEl = document.getElementById('je-console');

  // コーディングタブの生成コードを取り込み直す
  genBtn?.addEventListener('click', () => {
    if (typeof mlcBlocklyWorkspace !== 'undefined' && !mlcBlocklyWorkspace) {
      jeLog('コーディングタブを一度開いてください', 'warn');
      return;
    }
    if (!isGeneratedMode(jeMode) || window.__jeActiveCustomFile) switchToModeFile('blockly');
    syncGeneratedCodeToEditor(true);
    jeLog(modeFileName(jeMode) + ' をコーディングタブから取り込みました', 'ok');
  });

  // 実行（Ctrl+Enter / Cmd+Enter）
  runBtn.title = '手書きJSを実行 Ctrl+Enter';
  runBtn.addEventListener('click', runEditorCode);
  codeEl.addEventListener('input', () => {
    codeEl.dataset.manual = '1';
    if (isGeneratedMode(jeMode) && !window.__jeActiveCustomFile) {
      window.__jeCodeCache = window.__jeCodeCache || {};
      window.__jeCodeCache[MLC_GENERATED_MODES[jeMode].manualKey] = true;
    }
    updateEditorRunButtonVisibility();
  });

  codeEl.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runEditorCode();
    }
    // Tab キーでインデント
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = codeEl.selectionStart;
      const v = codeEl.value;
      codeEl.value = v.slice(0, s) + '  ' + v.slice(s);
      codeEl.selectionStart = codeEl.selectionEnd = s + 2;
    }
  });

  // モード切替
  const modeSelect = document.getElementById('je-mode-select');
  modeSelect?.addEventListener('change', () => {
    switchToModeFile(modeSelect.value);
  });

  codeEl.value = generatedBlocklyCode();
  codeEl.dataset.manual = '0';
  updateEditorRunButtonVisibility();
}

function safeCssIdent(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^([^a-zA-Z_-])/, '_$1');
}

function runEditorCode() {
  if (jeMode !== 'canvas' && window.__jeModeHandlers?.[jeMode]) {
    const code = document.getElementById('je-code')?.value.trim();
    if (!code) return;
    window.__jeModeHandlers[jeMode].run?.(code);
    return;
  }

  const code = document.getElementById('je-code')?.value.trim();
  if (!code) return;

  jeLog('実行中...', 'warn');
  try {
    if (typeof gsap === 'undefined') {
      jeLog('GSAPを読み込み中...', 'warn');
      loadGSAP(() => executeCode(code));
    } else {
      executeCode(code);
    }
  } catch (e) {
    jeLog('✗ ' + e.message, 'error');
  }
}

// new Function() では非同期関数を作れないため、AsyncFunction コンストラクタを
// 経由する（標準的な回避策）。これで手書きコードのトップレベルで
// await api.libraries.get('cannon') のような書き方ができる。
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// コード中に THREE / CANNON のような「素の識別子」が出てきたら、それを
// globalName として宣言しているMOD登録済みライブラリを自動で読み込み、
// 同名の引数として実行関数に注入する。
// あくまで「MODが api.libraries に登録済み(=許可済み)のものだけ」が対象。
// ここにCDN URLを書いて未登録のものを取りに行く、ということはしない
// （テキストエディタの実行エンジン自身が勝手にCDNを読みに行かない設計）。
async function resolveLibraryParams(code) {
  const libs = window.AnimationApp?.libraries;
  const names = [];
  const values = [];
  if (!libs?.list) return { names, values };

  const candidates = libs.list().filter(
    entry => entry.globalName && new RegExp('\\b' + entry.globalName + '\\b').test(code)
  );
  for (const entry of candidates) {
    try {
      const mod = await libs.get(entry.id);
      names.push(entry.globalName);
      values.push(mod);
    } catch (e) {
      throw new Error(
        entry.globalName + ' を読み込めませんでした。「' + entry.name + '」を提供するMODが有効になっているか確認してください。(' + e.message + ')'
      );
    }
  }
  return { names, values };
}

async function executeCode(code) {
  try {
    if (typeof gsap !== 'undefined') {
      gsap.globalTimeline.resume();
      gsap.globalTimeline.paused(false);
    }
    // MOD API v2: window.AnimationApp を api として渡す（api.libraries.get('id') で明示取得も可）。
    // それに加えて、コードが THREE/CANNON 等の素の識別子を使っていれば
    // MOD登録済みのものだけを自動検出して同名の引数として渡す。
    const { names, values } = await resolveLibraryParams(code);
    const fn = new AsyncFunction('gsap', 'MotionPathPlugin', 'api', ...names, code);
    await fn(gsap, typeof MotionPathPlugin !== 'undefined' ? MotionPathPlugin : null, window.AnimationApp, ...values);
    jeLog('✓ 実行完了', 'ok');
  } catch (e) {
    jeLog('✗ ' + e.message, 'error');
    console.error(e);
  }
}

function loadGSAP(callback) {
  const s1 = document.createElement('script');
  s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js';
  s1.onload = () => {
    const s2 = document.createElement('script');
    s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/MotionPathPlugin.min.js';
    s2.onload = () => {
      gsap.registerPlugin(MotionPathPlugin);
      jeLog('✓ GSAP 読み込み完了', 'ok');
      callback();
    };
    document.head.appendChild(s2);
  };
  document.head.appendChild(s1);
}

function stopJeAnim() {
  if (typeof gsap !== 'undefined') {
    try {
      gsap.globalTimeline.clear();
      gsap.globalTimeline.resume();
      gsap.globalTimeline.paused(false);
    } catch (e) { }
  }
  if (window.__jeModeHandlers) {
    Object.values(window.__jeModeHandlers).forEach(h => { try { h.stop?.(); } catch (_) {} });
  }
  redraw();
}


function buildShapeSVGElement(s, i, origin = { x: 0, y: 0 }, opts = {}) {
  if (s.hidden) return '';

  // 配列インデックスではなく安定id基準のクラス名にする
  // （並び替え/削除でCSS/生成コードの対象がずれないように）。
  // i はフォールバック用に残す。
  // opts.className を渡すとクラス名を差し替えられる（DOMミラーでは
  // 外側のdivが .el-<id> を持つため、内側のSVGには付けない）
  const cls = opts.className !== undefined
    ? opts.className
    : 'el-' + safeCssIdent(s.id || ('s' + i));
  const c = s.color, sc = shapeStrokeColor(s), sw2 = s.sw || 2, op = (s.opa ?? 100) / 100;
  const fi = s.fill ? c : 'none';
  const dd = s.dash && s.dash !== '0' ? 'stroke-dasharray="' + s.dash + '"' : '';
  const ctr = getCenter(s);
  const cx = Math.round(ctr.x), cy = Math.round(ctr.y);

  if (s.type === 'brush' && s.snap) {
    try {
      const dataUrl = s.snap.toDataURL('image/png');
      return '<image class="' + cls + '" href="' + dataUrl + '" x="' + (-Math.round(origin.x)) + '" y="' + (-Math.round(origin.y)) + '" width="' + s.snap.width + '" height="' + s.snap.height + '" opacity="' + op + '"/>';
    } catch { return ''; }
  }

  let inner = '';

  if (s.type === 'rect') {
    const hw = s.w / 2, hh = s.h / 2;
    inner = '<rect x="' + Math.round(-hw) + '" y="' + Math.round(-hh) + '" width="' + Math.round(s.w) + '" height="' + Math.round(s.h) + '" rx="' + (s.rr || 0) + '" fill="' + fi + '" stroke="' + sc + '" stroke-width="' + sw2 + '" ' + dd + '/>';
  } else if (s.type === 'circle') {
    inner = '<ellipse cx="0" cy="0" rx="' + Math.round(s.rx) + '" ry="' + Math.round(s.ry) + '" fill="' + fi + '" stroke="' + sc + '" stroke-width="' + sw2 + '"/>';
  } else if (s.type === 'triangle' || s.type === 'polygon') {
    const n = s.type === 'triangle' ? 3 : (s.sides || 6);
    const sx2 = s.scaleX || 1, sy2 = s.scaleY || 1;
    const a0 = s.type === 'triangle'
      ? ((s.rot || 0) - 90) * Math.PI / 180 : (s.rot || 0) * Math.PI / 180;
    const pts = Array.from({ length: n }, (_, k) => {
      const a = a0 + k * 2 * Math.PI / n;
      return Math.round(s.r * Math.cos(a) * sx2) + ',' + Math.round(s.r * Math.sin(a) * sy2);
    }).join(' ');
    inner = '<polygon points="' + pts + '" fill="' + fi + '" stroke="' + sc + '" stroke-width="' + sw2 + '" ' + dd + '/>';
  } else if (s.type === 'line') {
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    inner = '<line x1="' + Math.round(s.x1 - mx) + '" y1="' + Math.round(s.y1 - my) + '" x2="' + Math.round(s.x2 - mx) + '" y2="' + Math.round(s.y2 - my) + '" stroke="' + sc + '" stroke-width="' + sw2 + '" ' + dd + '/>';
  } else if (s.type === 'pen' && s.pts && s.pts.length > 1) {
    const d = s.pts.map((p, j) => (j === 0 ? 'M' : 'L') + Math.round(p.x - cx) + ',' + Math.round(p.y - cy)).join(' ');
    inner = '<path d="' + d + '" fill="none" stroke="' + sc + '" stroke-width="' + sw2 + '" stroke-linecap="round" ' + dd + '/>';
  } else if (s.type === 'text') {
    const fam = s.fontFamily || 'sans-serif';
    const svgFam = (fam !== 'sans-serif' && fam !== 'serif')
      ? `'${fam}', sans-serif`
      : fam;
    const fs = s.fontSize || 24;
    const lh = Math.round(fs * 1.3);
    const pad = 4;
    const hw = s.w / 2, hh = s.h / 2;
    const lines = wrapTextLines(s.text || '', fam, fs, s.w - pad * 2);
    const tspans = lines.map((line, idx) =>
      '<tspan x="' + Math.round(-hw + pad) + '" y="' + Math.round(-hh + pad + fs + idx * lh) + '">' + escapeHtml(line) + '</tspan>'
    ).join('');
    inner = '<text font-family="' + svgFam + '" font-size="' + fs + '" fill="' + c + '">' + tspans + '</text>';
  } else if (s.type === 'image') {
    const hw = s.w / 2, hh = s.h / 2;
    inner = '<image href="' + s.src + '" x="' + Math.round(-hw) + '" y="' + Math.round(-hh)
      + '" width="' + Math.round(s.w) + '" height="' + Math.round(s.h)
      + '" transform="rotate(' + (s.rot || 0) + ')" preserveAspectRatio="none"/>';
  } else if (s.type === 'mod-brush') {
    const brush = window.AnimationApp?.customBrushes?.[s.brushId];
    if (brush?.toSVG) inner = brush.toSVG(s);
  } else {
    const renderer = window.AnimationApp?.customRenderers?.[s.type];
    if (renderer?.toSVG) inner = renderer.toSVG(s);
  }

  if (!inner) return '';

  // 位置決め用の外側<g>（SVG属性transformのみ）と、CSSトランスフォーム対象の
  // 内側<g>（クラスのみ、属性transformは持たない）を分ける。
  // 同じ要素にSVG属性transformとCSSのtransformプロパティを両方付けると、
  // ブラウザがtransform-origin(fill-box指定でも)をSVGルート原点基準で
  // 解決してしまい、Trigger/ActionのCSS transform(scale/rotate等)が
  // 中心からではなく原点からのズレとして適用される不具合があるため。
  return '<g transform="translate(' + Math.round(cx - origin.x) + ',' + Math.round(cy - origin.y) + ')" opacity="' + op + '">'
    + '<g class="' + cls + '">' + inner + '</g>'
    + '</g>';
}


function jeLog(msg, type = 'log') {
  const el = document.getElementById('je-console');
  if (!el) return;
  const line = document.createElement('div');
  line.className = `je-log ${type}`;
  const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${time}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// shapes が変わったらコードを自動更新
const _origSyncAll = syncAll;
// syncAll は既に定義済みなので、上書きせずに initJSEditor で処理
