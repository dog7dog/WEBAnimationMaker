// ══════════════════════════════════════════════════════════════
// コーディングタブ（Blocklyビジュアルプログラミング）
//   Blockly本体はCDNから遅延ロードする（タブを初めて開いたとき）。
//   GSAP/Monacoと同じ方針で、起動時には読み込まない。
//
//   データの流れ:
//     Blocklyワークスペース（編集可能な原本）
//        ↓ 変更のたびに150msデバウンスで再生成
//     interactions（導出データ）
//        ↓ codegen-css / codegen-js
//     CSS + JS  →  キャンバスタブの実DOMへ
//
//   interactions を手で編集しないのが要点。原本は常にワークスペース側にあり、
//   .mlc にもワークスペースのJSONを保存して読み込み時に再生成する。
// ══════════════════════════════════════════════════════════════

const BLOCKLY_VERSION = '11.2.1';

let mlcBlocklyWorkspace = null;
let _blocklyLoading = null;
let _blocklyRegenTimer = null;
// 読み込み直後などに「まだワークスペースが無い状態」で上書き保存されないよう、
// 復元待ちのデータをここに退避しておく
let _pendingBlocklyState = null;

function loadBlockly() {
  if (typeof Blockly !== 'undefined') return Promise.resolve();
  if (_blocklyLoading) return _blocklyLoading;

  // BlocklyのバンドルはUMD。AMDローダー(define.amd)が居るとそちらを優先し
  // window.Blockly を作らないため、テキストエディタのMonaco(AMDローダー)と衝突する。
  // scriptタグで読むとタイミング次第で（ダウンロード中にMonacoが載ると）すり抜けるので、
  // ソースを取得して define/module/exports を伏せた状態で実行し、
  // 必ずグローバルに載る経路を通す。
  const url = 'https://cdn.jsdelivr.net/npm/blockly@' + BLOCKLY_VERSION + '/blockly.min.js';
  _blocklyLoading = fetch(url)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(code => {
      new Function('define', 'module', 'exports', code)(undefined, undefined, undefined);
      if (typeof Blockly === 'undefined') throw new Error('Blocklyを読み込めませんでした');
      return loadBlocklyJapanese();
    })
    .catch(err => {
      _blocklyLoading = null;
      throw err;
    });

  return _blocklyLoading;
}

// 標準ブロック（分岐・繰り返し・変数・関数）の表示を日本語にする。
// 失敗しても英語のまま動くので、読み込めなければ黙って諦める。
function loadBlocklyJapanese() {
  const url = 'https://cdn.jsdelivr.net/npm/blockly@' + BLOCKLY_VERSION + '/msg/ja.js';
  return fetch(url)
    .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(code => {
      // 言語ファイルもUMD。exports があるとCommonJS経路(require)に入って落ちるので、
      // コア本体と同じく伏せてグローバル経路（Blockly.Msg へ直接書き込む）を通す。
      new Function('define', 'module', 'exports', code)(undefined, undefined, undefined);
    })
    .catch(err => console.warn('Blocklyの日本語表示を読み込めませんでした', err));
}

// ワークスペースの内容から interactions を作り直し、
// キャンバスタブを見ているならその場で反映する
function regenerateInteractionsFromBlockly() {
  if (!mlcBlocklyWorkspace) return;

  const rules = blocklyWorkspaceToInteractions(mlcBlocklyWorkspace);
  interactions.splice(0, interactions.length, ...rules);

  const warnings = []
    .concat(typeof findInteractionConflicts === 'function' ? findInteractionConflicts() : [])
    .concat(typeof findMissingInteractionTargets === 'function' ? findMissingInteractionTargets() : []);
  renderCodingPreview(warnings);

  if (typeof isInteractionPreviewActive === 'function' && isInteractionPreviewActive()) {
    applyInteractions();
  }

  // テキストエディタにも同じプログラムを映す
  if (typeof syncGeneratedCodeToEditor === 'function') syncGeneratedCodeToEditor();
}

// ブロックからルールだけを作り直す（画面まわりの更新はしない）。
// 「変形」「軌道」は図形の今の位置から差分を出しているので、
// 書き出す直前など、最新の配置を反映したいときに使う。
function refreshInteractionsFromBlockly() {
  if (!mlcBlocklyWorkspace) return false;
  interactions.splice(0, interactions.length, ...blocklyWorkspaceToInteractions(mlcBlocklyWorkspace));
  return true;
}

function scheduleBlocklyRegen() {
  clearTimeout(_blocklyRegenTimer);
  // ブロックをドラッグしている間ずっと再生成しないよう、少し待ってからまとめて処理する
  _blocklyRegenTimer = setTimeout(regenerateInteractionsFromBlockly, 150);
}

// 生成されたCSS/JSと警告をコーディングタブ右側に表示する
function renderCodingPreview(warnings) {
  const codeEl = document.getElementById('coding-generated');
  if (codeEl && typeof generateInteractionCode === 'function') {
    const { css, js } = generateInteractionCode();
    codeEl.textContent =
      '/* ── CSS ── */\n' + (css || '(まだありません)') +
      '\n\n/* ── JS ── */\n' + (js || '(不要 / まだありません)');
  }

  const warnEl = document.getElementById('coding-warnings');
  if (warnEl) {
    const list = warnings || [];
    warnEl.innerHTML = list.length
      ? list.map(w => '<div>⚠ ' + w.message + '</div>').join('')
      : '';
  }

  const countEl = document.getElementById('coding-rule-count');
  if (countEl) countEl.textContent = (interactions || []).length + ' 件のルール';
}

function initCodingTab() {
  const area = document.getElementById('blockly-area');
  if (!area || mlcBlocklyWorkspace) {
    if (mlcBlocklyWorkspace && typeof Blockly !== 'undefined') {
      // タブ表示のたびにサイズを取り直す（非表示中は0pxのため）
      Blockly.svgResize(mlcBlocklyWorkspace);
      // 図形が増減しているかもしれないのでドロップダウンを作り直させる
      mlcBlocklyWorkspace.getAllBlocks(false).forEach(b => b.render && b.render());
    }
    return;
  }

  loadBlockly().then(() => {
    defineMlcBlocks();

    mlcBlocklyWorkspace = Blockly.inject(area, {
      toolbox: mlcToolboxJson(),
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
      grid: { spacing: 24, length: 3, colour: '#333', snap: true },
      renderer: 'zelos'
    });

    if (_pendingBlocklyState) {
      restoreBlocklyState(_pendingBlocklyState);
      _pendingBlocklyState = null;
    }

    mlcBlocklyWorkspace.addChangeListener(e => {
      // UIイベント（選択・スクロール等）では作り直さない
      if (e && e.isUiEvent) return;
      scheduleBlocklyRegen();
    });

    Blockly.svgResize(mlcBlocklyWorkspace);
    regenerateInteractionsFromBlockly();
  }).catch(err => {
    console.error(err);
    area.innerHTML = '<div style="padding:16px;color:var(--fg3)">Blocklyの読み込みに失敗しました。'
      + 'ネットワーク接続を確認してください。</div>';
  });
}

// ── .mlc への保存/復元 ────────────────────────────────────────
function serializeBlocklyState() {
  if (!mlcBlocklyWorkspace || typeof Blockly === 'undefined') {
    // まだ開いていない場合は、読み込んだ内容をそのまま保持して書き戻す
    return _pendingBlocklyState || null;
  }
  try {
    return Blockly.serialization.workspaces.save(mlcBlocklyWorkspace);
  } catch (e) {
    console.warn('Blocklyワークスペースの保存に失敗しました', e);
    return null;
  }
}

function restoreBlocklyState(state) {
  if (!state) return;
  if (!mlcBlocklyWorkspace || typeof Blockly === 'undefined') {
    // タブを開いたときに復元する
    _pendingBlocklyState = state;
    return;
  }
  try {
    Blockly.serialization.workspaces.load(state, mlcBlocklyWorkspace);
    regenerateInteractionsFromBlockly();
  } catch (e) {
    console.warn('Blocklyワークスペースの復元に失敗しました', e);
  }
}
