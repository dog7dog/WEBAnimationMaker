// ══════════════════════════════════════════════════════════════
// AI Framework v2: ai_apply.js
// 生成コードの 危険ワードチェック → プレビュー → 適用 / MOD化 / エディタ送り
//
// 適用は type:'ai-code' のカスタム図形として shapes に追加され、
// 毎フレーム (ctx, canvas, width, height, api, t) 付きで実行される。
// ══════════════════════════════════════════════════════════════

// ── 危険ワード簡易チェック ────────────────────────────────────
const AI_DANGER_WORDS = [
  'fetch', 'XMLHttpRequest', 'localStorage', 'sessionStorage',
  'document.cookie', 'eval(', 'new Function', 'importScripts',
  'import(', 'WebSocket', 'indexedDB', 'navigator.sendBeacon'
];

function aiCheckDangerWords(code) {
  const found = [];
  for (const w of AI_DANGER_WORDS) {
    if (code.includes(w)) found.push(w.replace('(', ''));
  }
  return found;
}

function aiConfirmDanger(code) {
  const found = aiCheckDangerWords(code);
  if (!found.length) return true;
  return confirm(
    '⚠ 生成コードに注意が必要なワードが含まれています:\n\n' +
    '  ' + found.join(', ') + '\n\n' +
    '外部通信やデータ保存を行う可能性があります。\n' +
    '内容を確認済みの場合のみ実行してください。実行しますか？'
  );
}

function aiCompile(code) {
  return new Function('ctx', 'canvas', 'width', 'height', 'api', 't', '"use strict";\n' + code);
}

// ── ai-code カスタム図形の登録 ────────────────────────────────
(function registerAiCodeShape() {
  const api = window.AnimationApp;
  if (!api || typeof api.registerShapeType !== 'function') {
    console.warn('[AI] AnimationApp が見つかりません（読み込み順を確認）');
    return;
  }
  api.registerShapeType('ai-code', {
    draw(ctx2, s) {
      if (s.hidden) return;
      if (!s._fn) {
        try { s._fn = aiCompile(s.code || ''); }
        catch (e) { s._fn = null; s._err = e.message; return; }
      }
      ctx2.save();
      try {
        ctx2.translate(s.x || 0, s.y || 0);
        ctx2.globalAlpha = (s.opa == null ? 100 : s.opa) / 100;
        // タイムライン(animT)は廃止したので、ページ表示からの経過秒数で動かす
        const t = (typeof mpElapsedSeconds === 'function') ? mpElapsedSeconds() : 0;
        s._fn(ctx2, cv, cv.width, cv.height, window.AnimationApp, t);
      } catch (e) {
        if (!s._err) {
          s._err = e.message;
          console.error('[AI code error]', e);
          toast('ti-alert-triangle', 'AIコード実行エラー: ' + e.message);
        }
        s._fn = null;
      }
      ctx2.restore();
    },
    getBounds(s) {
      return {
        x: s.x || 0, y: s.y || 0,
        w: s.w || (typeof cv !== 'undefined' ? cv.width : 300),
        h: s.h || (typeof cv !== 'undefined' ? cv.height : 300)
      };
    }
  });
})();

// ── ai-code の継続的な再描画 ──────────────────────────────────
//   デザインタブは編集操作をきっかけに redraw() する「イベント駆動」で、
//   タイムライン廃止に伴い常時のアニメーションループを持たない。
//   ai-codeは t（経過秒数）を使って動く前提（AIのシステムプロンプトでも
//   そう案内している）なので、これが無いと生成した動きが完全に静止して
//   見えてしまう。
//
//   ai-code図形が追加された瞬間だけでなく、.mlc読み込みや⌘Z/⌘⇧Zで
//   後から現れることもあるため、個別のタイミングを狙って起こすのではなく、
//   ずっと動かしておいて毎フレーム「今どうか」を見るだけにする
//   （無い間の判定はshapes配列を舐めるだけなので、ほぼ無視できるコスト）。
function _aiAnimTick() {
  const hasAnimated = Array.isArray(shapes) && shapes.some(s => s && s.type === 'ai-code' && !s.hidden);
  if (hasAnimated) {
    const workspace = document.getElementById('workspace');
    // デザインタブを表示している間だけ描き直す（他のタブでの無駄な再描画を避ける）
    if (workspace && workspace.style.display !== 'none' && typeof redraw === 'function') {
      redraw();
    }
  }
  requestAnimationFrame(_aiAnimTick);
}
requestAnimationFrame(_aiAnimTick);

// ── ai-code をキャンバスタブ（DOM/CSSミラー）でも動かす ─────────
//   ミラーはCSS/SVGだけで組み立てているが、ai-codeは任意のCanvas 2D
//   描画コードなのでSVGへ変換できない。dom-mirror.js側で図形ごとに
//   専用の<canvas class="mlc-ai-canvas">を差し込んであるので、ここから
//   継続的に描き直す（書き出したページ側は site_export.js が同じ仕組みを
//   自己完結した形で埋め込む）。
function _aiRunOnMirrorCanvas(canvasEl, s, api, t) {
  if (!s._fn) {
    try { s._fn = aiCompile(s.code || ''); }
    catch (e) { s._fn = null; return; }
  }
  const ctx2 = canvasEl.getContext('2d');
  ctx2.save();
  try {
    s._fn(ctx2, canvasEl, canvasEl.width, canvasEl.height, api, t);
  } catch (e) {
    s._fn = null;
  }
  ctx2.restore();
}

function _aiMirrorTick() {
  if (typeof isInteractionPreviewActive === 'function' && isInteractionPreviewActive()) {
    const canvases = document.querySelectorAll('#mlc-stage .mlc-ai-canvas');
    if (canvases.length && Array.isArray(shapes)) {
      const t = (typeof mpElapsedSeconds === 'function') ? mpElapsedSeconds() : 0;
      const api = window.AnimationApp;
      canvases.forEach(canvasEl => {
        const id = canvasEl.dataset.aiShapeId;
        const s = shapes.find(sh => sh && !sh.hidden && safeCssIdent(sh.id || '') === id);
        if (s) _aiRunOnMirrorCanvas(canvasEl, s, api, t);
      });
    }
  }
  requestAnimationFrame(_aiMirrorTick);
}
requestAnimationFrame(_aiMirrorTick);

// ── プレビュー（コード編集可能） ──────────────────────────────
let _aiPreviewRAF = null;

function aiPreviewCode(code) {
  if (!aiConfirmDanger(code)) return;
  aiClosePreview();

  const w = (typeof cv !== 'undefined' && cv.width) ? cv.width : 640;
  const h = (typeof cv !== 'undefined' && cv.height) ? cv.height : 400;

  const overlay = document.createElement('div');
  overlay.id = 'ai-preview-overlay';
  overlay.innerHTML = `
    <div id="ai-preview-box">
      <div id="ai-preview-head">
        <span><i class="ti ti-eye"></i> AIコード プレビュー</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="ai-btn" id="ai-preview-edit"><i class="ti ti-edit"></i> 編集</button>
          <button class="ai-btn" id="ai-preview-restart"><i class="ti ti-refresh"></i> 再生</button>
          <button id="ai-preview-close" title="閉じる"><i class="ti ti-x"></i></button>
        </div>
      </div>
      <div id="ai-preview-body">
        <canvas id="ai-preview-cv" width="${w}" height="${h}"></canvas>
        <textarea id="ai-preview-editor" spellcheck="false" style="display:none"></textarea>
      </div>
      <div id="ai-preview-err"></div>
      <div id="ai-preview-foot">
        <button class="ai-btn danger" id="ai-preview-discard"><i class="ti ti-x"></i> 破棄</button>
        <button class="ai-btn accent" id="ai-preview-apply"><i class="ti ti-check"></i> 適用</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const pcv = overlay.querySelector('#ai-preview-cv');
  const pctx = pcv.getContext('2d');
  const errEl = overlay.querySelector('#ai-preview-err');
  const editor = overlay.querySelector('#ai-preview-editor');
  editor.value = code;

  let currentCode = code;
  let fn = null;
  const bg = (typeof canvasBg !== 'undefined') ? canvasBg : '#111111';
  let start = performance.now();

  function recompile() {
    try { fn = aiCompile(currentCode); errEl.textContent = ''; start = performance.now(); }
    catch (e) { fn = null; errEl.textContent = '構文エラー: ' + e.message; }
  }
  recompile();

  function frame() {
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.fillStyle = bg;
    pctx.fillRect(0, 0, pcv.width, pcv.height);
    if (fn) {
      pctx.save();
      try {
        const t = (performance.now() - start) / 1000;
        fn(pctx, pcv, pcv.width, pcv.height, window.AnimationApp, t);
      } catch (e) {
        errEl.textContent = '実行時エラー: ' + e.message;
        fn = null;
      }
      pctx.restore();
    }
    _aiPreviewRAF = requestAnimationFrame(frame);
  }
  frame();

  overlay.querySelector('#ai-preview-edit').onclick = () => {
    const editing = editor.style.display !== 'none';
    if (editing) {
      currentCode = editor.value;
      editor.style.display = 'none';
      pcv.style.display = 'block';
      recompile();
    } else {
      editor.style.display = 'block';
      pcv.style.display = 'none';
    }
  };
  overlay.querySelector('#ai-preview-restart').onclick = () => {
    if (editor.style.display !== 'none') currentCode = editor.value;
    recompile();
  };
  overlay.querySelector('#ai-preview-close').onclick = aiClosePreview;
  overlay.querySelector('#ai-preview-discard').onclick = aiClosePreview;
  overlay.querySelector('#ai-preview-apply').onclick = () => {
    if (editor.style.display !== 'none') currentCode = editor.value;
    aiClosePreview();
    aiApplyCode(currentCode, { skipConfirm: true });
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) aiClosePreview(); });
}

function aiClosePreview() {
  if (_aiPreviewRAF) { cancelAnimationFrame(_aiPreviewRAF); _aiPreviewRAF = null; }
  const el = document.getElementById('ai-preview-overlay');
  if (el) el.remove();
}

// ── 適用 ─────────────────────────────────────────────────────
function aiApplyCode(code, opts) {
  opts = opts || {};
  if (!opts.skipConfirm && !aiConfirmDanger(code)) return;

  const api = window.AnimationApp;
  const usesApi = /\bapi\s*\.\s*(addShape|addObject|createLayer|setSelectedPatch|removeObject|updateObject|registerShapeType|registerBrush|registerTool|registerUI)\b/.test(code);
  const usesCtx = /\bctx\s*\./.test(code);

  if (usesApi && !usesCtx) {
    try {
      const fn = aiCompile(code);
      fn(ctx, cv, cv.width, cv.height, api, 0);
      redraw();
      toast('ti-sparkles', 'AIコードを実行しました');
      setStatus('AIコード実行');
    } catch (e) {
      toast('ti-alert-triangle', '実行エラー: ' + e.message);
    }
    return;
  }

  try { aiCompile(code); }
  catch (e) { toast('ti-alert-triangle', '構文エラー: ' + e.message); return; }

  saveState();
  shapes.push({
    type: 'ai-code', name: 'AIコード', code,
    x: 0, y: 0, w: cv.width, h: cv.height,
    color, sw, opa: 100, dash: '0', fill: false,
    keyframes: [], hidden: false,
    layerId: getDrawableActiveLayerId()
  });
  selected = shapes[shapes.length - 1];
  syncAll();
  toast('ti-sparkles', 'AIコードをレイヤーに追加しました');
  setStatus('AIコード適用');
}

// ── JSエディタへコードを送る ──────────────────────────────────
function aiSendToEditor(code, suggestedName) {
  if (typeof window.__jeUserFiles === 'undefined') {
    toast('ti-alert-triangle', 'エディタが初期化されていません。テキストエディタタブを一度開いてください');
    return;
  }
  let name = suggestedName || ('ai-' + Date.now().toString(36) + '.js');
  let i = 1;
  while (window.__jeUserFiles[name] !== undefined) {
    name = (suggestedName || 'ai').replace(/\.js$/, '') + '-' + (i++) + '.js';
  }
  window.__jeUserFiles[name] = code;
  if (typeof persistJeUserFiles === 'function') persistJeUserFiles();
  // エディタタブへ切替
  document.getElementById('tab-editor')?.click();
  setTimeout(() => {
    if (typeof openCustomFile === 'function') openCustomFile(name);
  }, 120);
  toast('ti-check', `エディタに ${name} を追加しました`);
}

// ── AI生成コードをMODとしてインストール ───────────────────────
async function aiInstallAsMod(code) {
  if (!aiConfirmDanger(code)) return;

  // registerMod の id を推測
  let guessId = '';
  const m = code.match(/registerMod\s*\(\s*\{[\s\S]*?id\s*:\s*["']([a-zA-Z0-9_]+)["']/);
  if (m) guessId = m[1].toLowerCase();

  let modId = prompt('インストールするMODのID（英小文字・数字・_のみ）', guessId || 'ai_mod');
  if (!modId) return;
  modId = modId.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(modId)) {
    toast('ti-alert-triangle', 'IDは英小文字・数字・アンダースコアのみ使用できます');
    return;
  }

  // registerMod呼び出しが無ければ雛形で包む
  let mainJs = code;
  if (!/registerMod\s*\(/.test(mainJs)) {
    mainJs =
      `const api = window.AnimationApp;\n` +
      `api.registerMod({ id: "${modId}", name: "${modId}", version: "1.0.0", description: "AI生成MOD" });\n\n` +
      mainJs;
  }

  try {
    const res = await AIClient.installMod({
      mod_id: modId, name: modId, description: 'AIが生成したMOD',
      main_js: mainJs, overwrite: false
    });
    toast('ti-check', `MOD「${res.name}」をインストールしました`);
    // 再読み込みして即反映
    if (typeof loadMods === 'function') { await loadMods(); }
    setStatus('AI MODインストール完了: ' + res.id);
  } catch (e) {
    if (e.exists) {
      if (confirm(`MOD「${modId}」は既に存在します。上書きしますか？`)) {
        try {
          const res = await AIClient.installMod({
            mod_id: modId, name: modId, description: 'AIが生成したMOD',
            main_js: mainJs, overwrite: true
          });
          toast('ti-check', `MOD「${res.name}」を上書きしました`);
          if (typeof loadMods === 'function') { await loadMods(); }
        } catch (e2) { toast('ti-alert-triangle', e2.message); }
      }
    } else {
      toast('ti-alert-triangle', e.message);
    }
  }
}

window.aiPreviewCode = aiPreviewCode;
window.aiApplyCode = aiApplyCode;
window.aiCheckDangerWords = aiCheckDangerWords;
window.aiSendToEditor = aiSendToEditor;
window.aiInstallAsMod = aiInstallAsMod;
