// ══════════════════════════════════════════════════════════════
// MOD Loader — サーバーフォルダMOD + ZIPインストールMOD
// ══════════════════════════════════════════════════════════════

const LoadedMods    = []; // registerMod() で登録されたMOD（ZIP以外の経路用。現在は基本的に空）
const LoadedZipMods = []; // ZIPインストール済みMOD

// ── IndexedDB helpers ─────────────────────────────────────────

const _ZIP_DB_NAME    = 'magic_paint_zip_mods';
const _ZIP_DB_VERSION = 1;
const _ZIP_STORE      = 'mods';

function _openZipDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_ZIP_DB_NAME, _ZIP_DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_ZIP_STORE, { keyPath: 'id' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function _idbGetAll() {
  const db = await _openZipDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_ZIP_STORE, 'readonly');
    const req = tx.objectStore(_ZIP_STORE).getAll();
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror   = ()  => { reject(req.error);  db.close(); };
  });
}

async function _idbPut(record) {
  const db = await _openZipDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_ZIP_STORE, 'readwrite');
    tx.objectStore(_ZIP_STORE).put(record);
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror    = ()  => { reject(tx.error); db.close(); };
  });
}

async function _idbDelete(id) {
  const db = await _openZipDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_ZIP_STORE, 'readwrite');
    tx.objectStore(_ZIP_STORE).delete(id);
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror    = ()  => { reject(tx.error); db.close(); };
  });
}

// ── Asset helpers ─────────────────────────────────────────────

// アクティブな Blob URL { [modId]: { [path]: blobUrl } }
const _zipBlobUrls = {};

const _MIME_MAP = {
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
  svg:'image/svg+xml', webp:'image/webp', ico:'image/x-icon', bmp:'image/bmp',
  mp3:'audio/mpeg', ogg:'audio/ogg', wav:'audio/wav',
  mp4:'video/mp4', webm:'video/webm',
  wasm:'application/wasm', ttf:'font/ttf', woff:'font/woff', woff2:'font/woff2',
  json:'application/json', js:'text/javascript', css:'text/css',
  txt:'text/plain', md:'text/markdown', html:'text/html',
};
const _BIN_EXTS = new Set([
  'png','jpg','jpeg','gif','webp','ico','bmp','mp3','ogg','wav',
  'mp4','webm','wasm','ttf','woff','woff2','otf',
]);

function _mimeOf(ext) { return _MIME_MAP[ext.toLowerCase()] || 'application/octet-stream'; }
function _isBinExt(ext) { return _BIN_EXTS.has(ext.toLowerCase()); }

function _buildBlobUrls(modId, files) {
  _zipBlobUrls[modId] = {};
  for (const [path, content] of Object.entries(files)) {
    if (path === 'manifest.json') continue;
    const ext  = (path.split('.').pop() || '').toLowerCase();
    const mime = _mimeOf(ext);
    let blob;
    if (typeof content === 'string' && content.startsWith('data:')) {
      const b64 = content.split(',')[1];
      const raw = atob(b64);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      blob = new Blob([arr], { type: mime });
    } else {
      blob = new Blob([content], { type: mime });
    }
    _zipBlobUrls[modId][path] = URL.createObjectURL(blob);
  }
  return _zipBlobUrls[modId];
}

function _revokeBlobUrls(modId) {
  if (!_zipBlobUrls[modId]) return;
  for (const url of Object.values(_zipBlobUrls[modId])) URL.revokeObjectURL(url);
  delete _zipBlobUrls[modId];
  document.querySelectorAll(`link[data-zip-mod="${modId}"]`).forEach(l => l.remove());
}

// ── ZIP MOD execution ─────────────────────────────────────────

function _injectZipModStyles(manifest, files, assetMap) {
  for (const stylePath of manifest.styles || []) {
    const css = files[stylePath];
    if (!css || typeof css !== 'string') continue;
    let processed = css;
    for (const [p, url] of Object.entries(assetMap)) processed = processed.split(p).join(url);
    const blob    = new Blob([processed], { type: 'text/css' });
    const blobUrl = URL.createObjectURL(blob);
    _zipBlobUrls[manifest.id]['__style__' + stylePath] = blobUrl;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = blobUrl;
    link.dataset.zipMod = manifest.id;
    document.head.appendChild(link);
  }
}

function _executeZipMod(manifest, files, assetMap) {
  // manifest.json で宣言された外部ライブラリを Library Manager に登録（登録のみ、遅延読み込み）
  if (window.AnimationApp?.libraries && Array.isArray(manifest.libraries)) {
    for (const lib of manifest.libraries) {
      if (!lib) continue;
      // id を省略して name だけで書かれた宣言も許容する
      const libId = lib.id || lib.name;
      if (!libId) continue;
      window.AnimationApp.libraries.declare(libId, { ...lib, source: 'mod.json' });
    }
  }

  const scriptPaths = (manifest.scripts && manifest.scripts.length)
    ? manifest.scripts
    : ['main.js'];

  const srcs = scriptPaths.map(p => {
    const src = files[p];
    if (!src) { console.warn('[ZIP MOD] スクリプトなし:', p, '(' + manifest.id + ')'); return ''; }
    return src;
  }).filter(Boolean);

  if (!srcs.length) throw new Error('実行可能なスクリプトが見つかりません');

  // アセットパスの文字列リテラルを Blob URL に自動置換
  let combined = srcs.join('\n;\n');
  for (const [path, url] of Object.entries(assetMap)) {
    if (path.startsWith('__style__')) continue;
    const esc = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    combined = combined
      .replace(new RegExp(`'${esc}'`, 'g'), `'${url}'`)
      .replace(new RegExp(`"${esc}"`, 'g'), `"${url}"`);
  }

  // __assets と __modId をスコープ変数として注入
  // ZIP実行中は registerMod() が LoadedMods へ混ざらないよう目印を立てる
  // （api.js 側で参照。ZIP MODは LoadedZipMods で管理する）
  window.__mpZipModExecuting = true;
  try {
    // eslint-disable-next-line no-new-func
    new Function('__assets', '__modId', combined)(assetMap, manifest.id);
  } finally {
    window.__mpZipModExecuting = false;
  }
}

// ── セキュリティ警告ダイアログ ────────────────────────────────

function _showZipSecurityWarning(filename, onConfirm, onCancel) {
  document.getElementById('zip-sec-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'zip-sec-modal';
  modal.innerHTML = `
    <div id="zip-sec-card">
      <div class="zip-sec-title">⚠ セキュリティ警告</div>
      <p class="zip-sec-body">このMODは信頼できる作者のものだけインストールしてください。</p>
      <p class="zip-sec-sub">MODはJavaScriptコードを実行します。悪意あるMODはブラウザデータに影響する可能性があります。</p>
      <p class="zip-sec-file"><span>ファイル:</span> ${escapeHtml(filename)}</p>
      <div class="zip-sec-btns">
        <button id="zip-sec-cancel">キャンセル</button>
        <button id="zip-sec-ok">インストール</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#zip-sec-ok').addEventListener('click',     () => { modal.remove(); onConfirm(); });
  modal.querySelector('#zip-sec-cancel').addEventListener('click', () => { modal.remove(); onCancel?.(); });
  modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); onCancel?.(); } });
}

// ── ZIPインストール処理 ───────────────────────────────────────

async function _doInstallZipMod(file) {
  setStatus('MODをインストール中...');
  try {
    if (typeof JSZip === 'undefined') throw new Error('JSZip が読み込まれていません');

    const buffer = await file.arrayBuffer();
    const zip    = await JSZip.loadAsync(buffer);

    // マニフェストを探す（ルート優先、サブディレクトリ対応）。
    // ファイル名は mod.json / manifest.json のどちらでもよい
    // （MODフォルダ形式で配布されていたものをそのままZIPにできるように）。
    const MANIFEST_NAMES = ['mod.json', 'manifest.json'];
    const isJunk = path => path.startsWith('__MACOSX/') || path.split('/').pop().startsWith('.');

    let manifestEntry = null;
    let rootPrefix    = '';
    for (const name of MANIFEST_NAMES) {
      const rootFile = zip.file(name);
      if (rootFile) { manifestEntry = rootFile; break; }
      const found = Object.keys(zip.files).find(k =>
        k.endsWith('/' + name) && !zip.files[k].dir && !isJunk(k)
      );
      if (found) {
        manifestEntry = zip.file(found);
        rootPrefix    = found.slice(0, found.lastIndexOf('/') + 1);
        break;
      }
    }

    if (!manifestEntry) {
      alert('このMODは無効です。mod.json（または manifest.json）が見つかりません。');
      setStatus('MODインストール失敗');
      return;
    }

    let manifest;
    try { manifest = JSON.parse(await manifestEntry.async('text')); }
    catch (e) { alert('mod.json の解析に失敗しました: ' + e.message); return; }

    if (!manifest.id) { alert('mod.json に id が指定されていません。'); return; }

    // 全ファイルを展開（rootPrefix を除いた相対パスに正規化）
    const files   = {};
    const pending = [];
    zip.forEach((relPath, entry) => {
      if (entry.dir) return;
      // macOSでZIP化すると付いてくる __MACOSX/ や .DS_Store は取り込まない
      if (isJunk(relPath)) return;
      const normPath = rootPrefix ? relPath.replace(rootPrefix, '') : relPath;
      if (!normPath) return;
      const ext  = (normPath.split('.').pop() || '').toLowerCase();
      const type = _isBinExt(ext) ? 'base64' : 'text';
      pending.push(
        entry.async(type).then(content => {
          files[normPath] = type === 'base64'
            ? `data:${_mimeOf(ext)};base64,${content}`
            : content;
        })
      );
    });
    await Promise.all(pending);

    // 同IDの既存MODを上書き
    if (LoadedZipMods.some(m => m.id === manifest.id)) {
      await _idbDelete(manifest.id);
      _revokeBlobUrls(manifest.id);
      const idx = LoadedZipMods.findIndex(m => m.id === manifest.id);
      if (idx !== -1) LoadedZipMods.splice(idx, 1);
    }

    await _idbPut({ id: manifest.id, manifest, files });
    const assetMap = _buildBlobUrls(manifest.id, files);
    _injectZipModStyles(manifest, files, assetMap);
    _executeZipMod(manifest, files, assetMap);

    LoadedZipMods.push({ ...manifest, _isZip: true, enabled: true });
    setStatus(`MOD「${manifest.name || manifest.id}」をインストールしました`);

    if (document.getElementById('mod-modal')) showModsModal();

  } catch (e) {
    console.error('[ZIP MOD install]', e);
    alert('インストールに失敗しました: ' + e.message);
    setStatus('MODインストール失敗');
  }
}

function installZipMod(file) {
  if (!file || !file.name.toLowerCase().endsWith('.zip')) {
    setStatus('ZIPファイルを選択してください');
    return;
  }
  _showZipSecurityWarning(file.name, () => _doInstallZipMod(file));
}

// ZIPを介さずに、その場で組み立てたMODを入れる（AI生成MOD用）。
// 保存先も実行経路もZIP MODと同じにして、扱いを1本化する。
async function installGeneratedMod({ id, name, description, author, mainJs, styleCss }) {
  const manifest = {
    id,
    name: name || id,
    version: '1.0.0',
    description: description || '',
    author: author || '',
    enabled: true,
    scripts: ['main.js']
  };
  const files = { 'main.js': mainJs };
  if (styleCss && styleCss.trim()) {
    manifest.styles = ['style.css'];
    files['style.css'] = styleCss;
  }
  files['mod.json'] = JSON.stringify(manifest, null, 2);

  // 同IDが入っていれば差し替える
  if (LoadedZipMods.some(m => m.id === id)) {
    await _idbDelete(id);
    _revokeBlobUrls(id);
    const idx = LoadedZipMods.findIndex(m => m.id === id);
    if (idx !== -1) LoadedZipMods.splice(idx, 1);
  }

  await _idbPut({ id, manifest, files });
  const assetMap = _buildBlobUrls(id, files);
  _injectZipModStyles(manifest, files, assetMap);
  _executeZipMod(manifest, files, assetMap);
  LoadedZipMods.push({ ...manifest, _isZip: true, enabled: true });

  if (document.getElementById('mod-modal')) showModsModal();
  return { ok: true, id, name: manifest.name };
}

async function uninstallZipMod(id) {
  try {
    _revokeBlobUrls(id);
    const idx = LoadedZipMods.findIndex(m => m.id === id);
    if (idx !== -1) LoadedZipMods.splice(idx, 1);
    await _idbDelete(id);
    setStatus(`MOD「${id}」をアンインストールしました。再読み込みします…`);
    if (document.getElementById('mod-modal')) showModsModal();

    // MODが足したブロック(registerTriggerBlock/registerActionBlock)・図形・
    // ツール・ブラシ・UIパネルなどは、都度きれいに取り消す仕組みを持たない
    // （DOMへの直接追加やBlockly側のグローバルテーブルへの登録が入り混じっており、
    // 逆再生が難しいため）。中途半端に残らないよう、ページごと再読み込みして
    // まっさらな状態からやり直す。IndexedDBからは既に削除済みなので、
    // 再読み込み後にこのMODが再度読み込まれることはない。
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    console.error('[ZIP MOD uninstall]', e);
    setStatus('アンインストール失敗: ' + e.message);
  }
}

// ── IndexedDB から起動時に ZIP MOD を復元 ─────────────────────

async function loadZipMods() {
  let records;
  try { records = await _idbGetAll(); }
  catch (e) { console.warn('[ZIP MOD] IndexedDB 読み込み失敗:', e); return; }

  for (const { manifest, files } of records) {
    if (LoadedZipMods.some(m => m.id === manifest.id)) continue;
    try {
      const assetMap = _buildBlobUrls(manifest.id, files);
      _injectZipModStyles(manifest, files, assetMap);
      _executeZipMod(manifest, files, assetMap);
      LoadedZipMods.push({ ...manifest, _isZip: true, enabled: true });
    } catch (e) {
      console.error('[ZIP MOD] 起動時実行失敗:', manifest.id, e);
      LoadedZipMods.push({ ...manifest, _isZip: true, enabled: false, error: e.message });
    }
  }

  if (records.length) console.log(`[ZIP MOD] ${records.length} 件を復元`);
}

// ── MOD の読み込み ───────────────────────────────────────────
// 静的サイトとして動かすため、MODはローカルのZIPインストールのみ扱う。
// （以前はサーバーの mods/ フォルダを api/mods 経由で読んでいた）

async function loadMods() {
  await loadZipMods();
  const n = LoadedZipMods.length;
  setStatus(n ? `MOD ${n}件 読み込み完了` : '準備完了');
}

// ── MOD モーダル ──────────────────────────────────────────────

function showModsModal() {
  document.getElementById('mod-modal')?.remove();

  const allMods = [];
  for (const m of LoadedZipMods) { if (!allMods.some(x => x.id === m.id)) allMods.push({ ...m, _src: 'zip' }); }

  const items = allMods.length
    ? allMods.map(m => `
        <div class="mod-item">
          <div class="mod-item-title">
            <strong>${escapeHtml(m.name || m.id)}</strong>
            <span class="mod-level">LEVEL ${escapeHtml(String(m.level || 1))}</span>
            <span class="mod-zip-badge">ZIP</span>
            <button class="mod-uninstall-btn" data-zip-id="${escapeHtml(m.id)}">アンインストール</button>
          </div>
          <div class="mod-desc">${escapeHtml(m.description || '説明なし')}</div>
          ${m.author  ? `<div class="mod-meta">作者: ${escapeHtml(m.author)}</div>` : ''}
          ${m.version ? `<div class="mod-meta">ver ${escapeHtml(String(m.version))}</div>` : ''}
          ${m.error   ? `<div class="mod-error">ERROR: ${escapeHtml(m.error)}</div>` : ''}
        </div>
      `).join('')
    : '<div class="mod-desc">インストール済みのMODはありません。下のボタンからZIPを選んでインストールしてください。</div>';

  const modal = document.createElement('div');
  modal.id = 'mod-modal';
  modal.innerHTML = `
    <div id="mod-modal-card">
      <div class="mod-modal-head">
        <span><i class="ti ti-puzzle"></i> MOD一覧</span>
        <span class="mod-close" onclick="document.getElementById('mod-modal').remove()">✕</span>
      </div>
      <div class="mod-install-bar">
        <label class="mod-install-btn" title="ZIPファイルからMODをインストール">
          <i class="ti ti-file-zip"></i> MODをインストール
          <input type="file" accept=".zip" id="zip-mod-input" style="display:none">
        </label>
      </div>
      <div class="mod-modal-body">${items}</div>
    </div>
  `;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  modal.querySelector('#zip-mod-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) { modal.remove(); installZipMod(file); }
  });

  modal.querySelectorAll('.mod-uninstall-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.zipId;
      if (!id) return;
      if (!confirm(`MOD「${id}」をアンインストールしますか？\n（この操作の後、ページが再読み込みされます）`)) return;
      await uninstallZipMod(id);
    });
  });
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])
  );
}

document.getElementById('mods-btn')?.addEventListener('click', showModsModal);
