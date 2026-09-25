// ══════════════════════════════════════════════════════════════
// Feature Pack: コマンドパレット (Ctrl+K) & ショートカット一覧 (?)
// ══════════════════════════════════════════════════════════════

// コマンド定義（run は存在チェックしてから呼ぶ）
function mpCommands() {
  const call = (fn, ...args) => () => { if (typeof window[fn] === 'function') window[fn](...args); else toast('ti-alert-triangle', '未対応: ' + fn); };
  return [
    { icon: 'ti-file-plus', name: '新規プロジェクト', keys: '', run: call('newProject') },
    { icon: 'ti-device-floppy', name: '保存', keys: '⌘S', run: call('saveProject') },
    { icon: 'ti-folder-open', name: 'プロジェクトを開く', keys: '', run: call('openProject') },
    { icon: 'ti-photo', name: 'PNG書き出し', keys: '', run: call('exportPNG') },
    { icon: 'ti-external-link', name: 'プレビュー（別タブ）', keys: '⌘P', run: call('openSitePreview') },
    { icon: 'ti-file-export', name: 'HTML書き出し', keys: '', run: call('exportSiteHtml') },
    { icon: 'ti-sparkles', name: 'AIアシスタントを開く', keys: '⌘/', run: call('aiTogglePanel') },
    { icon: 'ti-puzzle', name: 'MOD一覧', keys: '', run: () => document.getElementById('mods-btn')?.click() },
    { icon: 'ti-arrow-back-up', name: '元に戻す', keys: '⌘Z', run: call('undo') },
    { icon: 'ti-arrow-forward-up', name: 'やり直す', keys: '⌘⇧Z', run: call('redo') },
    { icon: 'ti-copy', name: '選択をコピー', keys: '⌘C', run: call('copySelected') },
    { icon: 'ti-clipboard', name: '貼り付け', keys: '⌘V', run: call('paste') },
    { icon: 'ti-photo-plus', name: '画像を挿入（ファイルから）', keys: '', run: call('openImageFilePicker') },
    { icon: 'ti-copy', name: '画像をコピー（クリップボードへ）', keys: '⌘⇧C', run: call('copySelectedImageToClipboard') },
    { icon: 'ti-trash', name: '選択を削除', keys: 'Del', run: call('deleteSelected') },
    { icon: 'ti-copy', name: '複製', keys: '⌘D', run: call('mpDuplicateSelected') },
    { icon: 'ti-flip-horizontal', name: '左右反転', keys: '', run: call('mpFlipH') },
    { icon: 'ti-flip-vertical', name: '上下反転', keys: '', run: call('mpFlipV') },
    { icon: 'ti-arrow-up', name: '最前面へ', keys: '', run: call('mpBringToFront') },
    { icon: 'ti-arrow-down', name: '最背面へ', keys: '', run: call('mpSendToBack') },
    { icon: 'ti-layout-align-center', name: '左揃え', keys: '', run: call('mpAlign', 'left') },
    { icon: 'ti-layout-align-center', name: '右揃え', keys: '', run: call('mpAlign', 'right') },
    { icon: 'ti-layout-align-center', name: '上揃え', keys: '', run: call('mpAlign', 'top') },
    { icon: 'ti-layout-align-center', name: '下揃え', keys: '', run: call('mpAlign', 'bottom') },
    { icon: 'ti-layout-align-middle', name: '水平中央揃え', keys: '', run: call('mpAlign', 'cx') },
    { icon: 'ti-layout-align-middle', name: '垂直中央揃え', keys: '', run: call('mpAlign', 'cy') },
    { icon: 'ti-grid-4x4', name: 'グリッド表示切替', keys: '⌘G', run: call('mpToggleGrid') },
    { icon: 'ti-magnet', name: 'スナップ切替', keys: '', run: call('mpToggleSnap') },
    { icon: 'ti-zoom-in', name: 'ズームイン', keys: '⌘+', run: call('mpZoomIn') },
    { icon: 'ti-zoom-out', name: 'ズームアウト', keys: '⌘-', run: call('mpZoomOut') },
    { icon: 'ti-zoom-reset', name: 'ズームをリセット', keys: '⌘0', run: call('mpZoomReset') },
    { icon: 'ti-keyboard', name: 'ショートカット一覧', keys: '?', run: call('mpShowShortcuts') },
    { icon: 'ti-color-picker', name: 'スポイト（色を吸い取る）', keys: '⌘I', run: call('mpStartEyedropper') },
    { icon: 'ti-palette', name: 'パレットに現在色を追加', keys: '', run: call('mpAddSwatch') },
  ];
}

let _mpPalIndex = 0;
let _mpPalFiltered = [];

function mpOpenPalette() {
  if (document.getElementById('mp-palette')) { mpClosePalette(); return; }
  const el = document.createElement('div');
  el.id = 'mp-palette';
  el.className = 'mp-overlay top';
  el.innerHTML = `
    <div class="mp-pal-box">
      <div class="mp-pal-search">
        <i class="ti ti-search"></i>
        <input id="mp-pal-input" placeholder="コマンドを検索... (↑↓ で移動 / Enter で実行)" autocomplete="off">
      </div>
      <div class="mp-pal-list" id="mp-pal-list"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) mpClosePalette(); });

  const input = document.getElementById('mp-pal-input');
  input.addEventListener('input', () => mpRenderPalette(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _mpPalIndex = Math.min(_mpPalIndex + 1, _mpPalFiltered.length - 1); mpHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _mpPalIndex = Math.max(_mpPalIndex - 1, 0); mpHighlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); mpRunPalIndex(); }
    else if (e.key === 'Escape') { mpClosePalette(); }
  });
  mpRenderPalette('');
  setTimeout(() => input.focus(), 30);
}

function mpRenderPalette(query) {
  const list = document.getElementById('mp-pal-list');
  if (!list) return;
  const q = (query || '').toLowerCase().trim();
  const all = mpCommands();
  _mpPalFiltered = q ? all.filter(c => c.name.toLowerCase().includes(q)) : all;
  _mpPalIndex = 0;
  list.innerHTML = '';
  if (!_mpPalFiltered.length) {
    list.innerHTML = '<div class="mp-pal-empty">該当するコマンドがありません</div>';
    return;
  }
  _mpPalFiltered.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'mp-pal-item' + (i === 0 ? ' active' : '');
    row.innerHTML = `<i class="ti ${c.icon}"></i><span class="mp-pal-name">${c.name}</span>` +
      (c.keys ? `<span class="mp-pal-keys">${c.keys}</span>` : '');
    row.onmouseenter = () => { _mpPalIndex = i; mpHighlight(); };
    row.onclick = () => { _mpPalIndex = i; mpRunPalIndex(); };
    list.appendChild(row);
  });
}

function mpHighlight() {
  const items = document.querySelectorAll('#mp-pal-list .mp-pal-item');
  items.forEach((it, i) => it.classList.toggle('active', i === _mpPalIndex));
  const active = items[_mpPalIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function mpRunPalIndex() {
  const cmd = _mpPalFiltered[_mpPalIndex];
  mpClosePalette();
  if (cmd && cmd.run) setTimeout(cmd.run, 10);
}

function mpClosePalette() {
  const el = document.getElementById('mp-palette');
  if (el) el.remove();
}

// ── ショートカット一覧 ──
function mpShowShortcuts() {
  if (document.getElementById('mp-shortcuts')) return;
  const groups = [
    ['ツール', [
      ['V', '選択'], ['R', '四角形'], ['C', '円'], ['T', '三角形'],
      ['P', '多角形'], ['L', '線'], ['E', '消しゴム'], ['I', 'スポイト'],
    ]],
    ['編集', [
      ['⌘Z', '元に戻す'], ['⌘⇧Z', 'やり直す'], ['⌘C', 'コピー'], ['⌘V', '貼り付け'],
      ['⌘D', '複製'], ['Del', '削除'], ['⌘G', 'グループ化'], ['⌘U', 'グループ解除'],
      ['⌘]', '前面へ'], ['⌘[', '背面へ'],
    ]],
    ['画像', [
      ['⌘V', 'クリップボードの画像を貼り付け'],
      ['⌘⇧C', '選択中の画像をコピー'],
      ['ドラッグ&ドロップ', 'ファイル / ブラウザの画像を挿入'],
    ]],
    ['表示', [
      ['⌘+', 'ズームイン'], ['⌘-', 'ズームアウト'], ['⌘0', 'ズームリセット'],
      ['G', 'グリッド'], ['Space+ドラッグ', 'パン'],
    ]],
    ['ファイル / パネル', [
      ['⌘S', '保存'], ['⌘P', 'プレビュー'], ['⌘K', 'コマンドパレット'],
      ['⌘/', 'AIアシスタント'], ['?', 'このヘルプ'],
    ]],
  ];
  let html = '';
  groups.forEach(([title, rows]) => {
    html += `<div class="mp-sc-group"><div class="mp-sc-title">${title}</div>`;
    rows.forEach(([k, d]) => {
      html += `<div class="mp-sc-row"><span class="mp-sc-key">${k}</span><span>${d}</span></div>`;
    });
    html += '</div>';
  });
  const el = document.createElement('div');
  el.id = 'mp-shortcuts';
  el.className = 'mp-overlay';
  el.innerHTML = `
    <div class="mp-dialog wide">
      <div class="mp-dialog-head">
        <span><i class="ti ti-keyboard"></i> キーボードショートカット</span>
        <button class="mp-x"><i class="ti ti-x"></i></button>
      </div>
      <div class="mp-dialog-body"><div class="mp-sc-grid">${html}</div></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.mp-x').onclick = () => el.remove();
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
}

window.mpOpenPalette = mpOpenPalette;
window.mpShowShortcuts = mpShowShortcuts;

// ── ホットキー登録 ──
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  const inField = isTypingContext();
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); mpOpenPalette(); return; }
  if (!inField && e.key === '?') { e.preventDefault(); mpShowShortcuts(); return; }
  if (!inField && e.key === '/' && e.shiftKey) { e.preventDefault(); mpShowShortcuts(); }
});
