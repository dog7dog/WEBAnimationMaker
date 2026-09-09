// ══════════════════════════════════════════════════════════════
// Feature Pack: ツールバー統合UI
//   トップバーに ビュー制御 / 整列 / 書き出し / コマンド ボタンを注入
//   （index.html を編集せず、既存 mods-btn の前に差し込む）
// ══════════════════════════════════════════════════════════════

function mpBuildToolbar() {
  const anchor = document.getElementById('mods-btn');
  if (!anchor || document.getElementById('mp-feature-tools')) return;

  const wrap = document.createElement('span');
  wrap.id = 'mp-feature-tools';
  wrap.innerHTML = `
    <span class="tb-sep"></span>

    <div class="mp-menu-wrap" id="mp-tools-wrap">
      <button class="tb-btn" id="mp-tools-btn" title="ツール"><i class="ti ti-tool"></i> ツール</button>
      <div class="mp-menu" id="mp-tools-menu">
        <div class="mp-menu-label">表示</div>
        <div class="fm-item" id="mp-grid-btn"><i class="ti ti-grid-4x4"></i>グリッド表示<span class="fm-kbd">G</span></div>
        <div class="fm-item" id="mp-snap-btn"><i class="ti ti-magnet"></i>スナップ</div>
        <div class="fm-item" id="mp-onion-btn"><i class="ti ti-ghost"></i>オニオンスキン</div>

        <div class="fm-sep"></div>
        <div class="mp-menu-label">整列</div>
        <div class="mp-align-grid">
          <button data-a="left" title="左揃え"><i class="ti ti-layout-align-left"></i></button>
          <button data-a="cx" title="水平中央"><i class="ti ti-layout-align-center"></i></button>
          <button data-a="right" title="右揃え"><i class="ti ti-layout-align-right"></i></button>
          <button data-a="top" title="上揃え"><i class="ti ti-layout-align-top"></i></button>
          <button data-a="cy" title="垂直中央"><i class="ti ti-layout-align-middle"></i></button>
          <button data-a="bottom" title="下揃え"><i class="ti ti-layout-align-bottom"></i></button>
        </div>
        <div class="mp-menu-label">分布</div>
        <div class="mp-menu-row">
          <button data-d="h"><i class="ti ti-arrows-horizontal"></i> 水平均等</button>
          <button data-d="v"><i class="ti ti-arrows-vertical"></i> 垂直均等</button>
        </div>
        <div class="mp-menu-label">変形・順序</div>
        <div class="mp-menu-row">
          <button data-cmd="mpFlipH"><i class="ti ti-flip-horizontal"></i> 左右反転</button>
          <button data-cmd="mpFlipV"><i class="ti ti-flip-vertical"></i> 上下反転</button>
        </div>
        <div class="mp-menu-row">
          <button data-cmd="mpDuplicateSelected"><i class="ti ti-copy"></i> 複製</button>
          <button data-cmd="mpBringToFront"><i class="ti ti-arrow-up"></i> 最前面</button>
          <button data-cmd="mpSendToBack"><i class="ti ti-arrow-down"></i> 最背面</button>
        </div>

        <div class="fm-sep"></div>
        <div class="fm-item" id="mp-eyedropper-btn"><i class="ti ti-color-picker"></i>スポイト<span class="fm-kbd">I</span></div>
        <div class="fm-item" id="mp-export-btn"><i class="ti ti-movie"></i>メディア書き出し</div>

        <div class="fm-sep"></div>
        <div class="fm-item" id="mp-cmd-btn"><i class="ti ti-command"></i>コマンドパレット<span class="fm-kbd">⌘K</span></div>

        <div class="fm-sep"></div>
        <div class="fm-item" id="mp-help-btn"><i class="ti ti-help-circle"></i>ヘルプ</div>
      </div>
    </div>
  `;
  anchor.parentNode.insertBefore(wrap, anchor);

  // イベント
  const call = fn => () => { if (typeof window[fn] === 'function') window[fn](); };
  const toolsMenu = document.getElementById('mp-tools-menu');
  const closeToolsMenu = () => toolsMenu.classList.remove('open');

  document.getElementById('mp-grid-btn').onclick = () => { call('mpToggleGrid')(); };
  document.getElementById('mp-snap-btn').onclick = () => { call('mpToggleSnap')(); };
  document.getElementById('mp-onion-btn').onclick = () => { call('mpToggleOnion')(); };
  document.getElementById('mp-eyedropper-btn').onclick = () => { call('mpStartEyedropper')(); closeToolsMenu(); };
  document.getElementById('mp-export-btn').onclick = () => { call('mpOpenExportDialog')(); closeToolsMenu(); };
  document.getElementById('mp-cmd-btn').onclick = () => { call('mpOpenPalette')(); closeToolsMenu(); };
  document.getElementById('mp-help-btn').onclick = () => {
    window.open('https://lovesick-gray-hyuga-9557.ssl-lolipop.jp/public_html/docs/overview.html', '_blank', 'noopener');
    closeToolsMenu();
  };

  // ツールメニュー開閉
  const toolsBtn = document.getElementById('mp-tools-btn');
  toolsBtn.onclick = e => { e.stopPropagation(); toolsMenu.classList.toggle('open'); };
  toolsMenu.onclick = e => e.stopPropagation();
  document.addEventListener('click', e => {
    if (!document.getElementById('mp-tools-wrap')?.contains(e.target)) closeToolsMenu();
  });
  toolsMenu.querySelectorAll('[data-a]').forEach(b => {
    b.onclick = () => { window.mpAlign && window.mpAlign(b.dataset.a); closeToolsMenu(); };
  });
  toolsMenu.querySelectorAll('[data-d]').forEach(b => {
    b.onclick = () => { window.mpDistribute && window.mpDistribute(b.dataset.d === 'h'); closeToolsMenu(); };
  });
  toolsMenu.querySelectorAll('[data-cmd]').forEach(b => {
    b.onclick = () => { const fn = window[b.dataset.cmd]; if (fn) fn(); closeToolsMenu(); };
  });

  // ビュー状態を反映
  if (typeof mpSyncViewButtons === 'function') mpSyncViewButtons();

  // 自動保存トグルを File メニューに追加
  mpAddAutosaveMenuItem();
}

function mpAddAutosaveMenuItem() {
  const menu = document.getElementById('file-menu');
  if (!menu || document.getElementById('mp-autosave-item')) return;
  const sep = document.createElement('div');
  sep.className = 'fm-sep';
  const item = document.createElement('div');
  item.className = 'fm-item';
  item.id = 'mp-autosave-item';
  const on = localStorage.getItem('mpAutosaveEnabled') !== '0';
  item.innerHTML = `<i class="ti ti-cloud"></i>自動保存 <span class="fm-kbd" id="mp-autosave-state">${on ? 'ON' : 'OFF'}</span>`;
  item.onclick = e => {
    e.stopPropagation();
    const nowOn = window.mpToggleAutosave ? window.mpToggleAutosave() : false;
    document.getElementById('mp-autosave-state').textContent = nowOn ? 'ON' : 'OFF';
  };
  menu.appendChild(sep);
  menu.appendChild(item);

  // メディア書き出しも File メニューに
  const exp = document.createElement('div');
  exp.className = 'fm-item';
  exp.innerHTML = '<i class="ti ti-movie"></i>動画/連番書き出し';
  exp.onclick = () => { if (window.mpOpenExportDialog) window.mpOpenExportDialog(); };
  menu.appendChild(exp);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(mpBuildToolbar, 150));
} else {
  setTimeout(mpBuildToolbar, 150);
}
