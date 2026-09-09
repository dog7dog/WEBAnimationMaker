// ══════════════════════════════════════════════════════════════
// AI Framework v2: ai_panel.js
// AIチャットパネル
//  プロバイダー/キー管理 / Vision添付 / クイックアクション /
//  シーンコンテキスト送信 / 会話履歴 / 使用統計 / temperature /
//  再生成 / Markdown書き出し / パネルリサイズ
// ══════════════════════════════════════════════════════════════
let aiHistory = [];             // [{ role, content, images? }]
let aiProviders = [];
let aiCurrentProvider = localStorage.getItem('mpAiProvider') || 'openai';
let aiBusy = false;
let aiConversationId = null;    // 現在の会話ID（localStorageの会話履歴用）
let aiTemperature = parseFloat(localStorage.getItem('mpAiTemp') || '0.7');
let aiPendingImages = [];       // 送信予定の添付画像 dataURL

// クイックアクション（プリセット指示）
const AI_QUICK_ACTIONS = [
  { icon: 'ti-stars', label: '星空', prompt: 'キャンバス全体に、ゆっくり瞬く星空を描くアニメーションコードを作って。' },
  { icon: 'ti-sparkles', label: '花火', prompt: '打ち上げ花火が上がって開くアニメーションを作って。複数の花火が時間差で開くようにして。' },
  { icon: 'ti-snowflake', label: '雪', prompt: '雪がゆっくり降るアニメーションを作って。雪片の大きさと速度にばらつきをつけて。' },
  { icon: 'ti-flame', label: '炎', prompt: '揺らめく炎のパーティクルアニメーションを作って。下から上に向かって色が変化するように。' },
  { icon: 'ti-wave-sine', label: '波', prompt: '滑らかに動く正弦波を複数重ねた波アニメーションを作って。' },
  { icon: 'ti-circles', label: 'パーティクル', prompt: '中心から広がるカラフルなパーティクルアニメーションを作って。' },
  { icon: 'ti-grid-dots', label: 'ドット網', prompt: 'マウス不要で、うねうね動くドットグリッドのアニメーションを作って。' },
  { icon: 'ti-3d-cube-sphere', label: '3D', prompt: 'api.addObject を使って Three.js の回転するキューブを追加するコードを作って。' },
];

// ── パネル生成 ────────────────────────────────────────────────
function aiBuildPanel() {
  if (document.getElementById('ai-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'ai-panel';
  panel.innerHTML = `
    <div id="ai-resize-handle" title="ドラッグで幅を調整"></div>

    <div id="ai-head">
      <span id="ai-title"><i class="ti ti-sparkles"></i> AI アシスタント</span>
      <select id="ai-provider-select" title="AIプロバイダー"></select>
      <button class="ai-icon-btn" id="ai-history-btn" title="会話履歴"><i class="ti ti-history"></i></button>
      <button class="ai-icon-btn" id="ai-stats-btn" title="使用統計"><i class="ti ti-chart-bar"></i></button>
      <button class="ai-icon-btn" id="ai-settings-btn" title="設定"><i class="ti ti-settings"></i></button>
      <button class="ai-icon-btn" id="ai-close-btn" title="閉じる"><i class="ti ti-x"></i></button>
    </div>

    <div id="ai-settings" style="display:none">
      <div class="ai-set-row">
        <span class="ai-set-label">APIキー</span>
        <span id="ai-key-masked" class="ai-key-masked">未登録</span>
        <span id="ai-vision-badge" class="ai-vision-badge" style="display:none"><i class="ti ti-photo"></i> Vision</span>
      </div>
      <div class="ai-set-row">
        <input type="password" id="ai-key-input" placeholder="APIキーを入力" autocomplete="off">
      </div>
      <div class="ai-set-row">
        <span class="ai-set-label">モデル</span>
        <select id="ai-model-select"></select>
      </div>
      <div class="ai-set-row">
        <input type="text" id="ai-model-custom" placeholder="またはモデル名を直接入力（任意）" autocomplete="off">
      </div>
      <div class="ai-set-row">
        <span class="ai-set-label" title="0=厳密 / 高いほど創造的">温度</span>
        <input type="range" id="ai-temp" min="0" max="1.5" step="0.1" value="${aiTemperature}" style="flex:1">
        <span id="ai-temp-val" class="ai-key-masked">${aiTemperature.toFixed(1)}</span>
      </div>
      <div class="ai-set-row" style="justify-content:flex-end;gap:6px">
        <button class="ai-btn" id="ai-key-test"><i class="ti ti-plug"></i> 接続テスト</button>
        <button class="ai-btn danger" id="ai-key-delete"><i class="ti ti-trash"></i> 削除</button>
        <button class="ai-btn accent" id="ai-key-save"><i class="ti ti-device-floppy"></i> 保存</button>
      </div>
      <div class="ai-set-note">
        キーはこのブラウザ（localStorage）に保存され、表示は常にマスクされます。<br>
        ⚠ サーバーを介さずAPIへ直接送るため、同じブラウザを使える人と
        このページで動くコード（インストールしたMODを含む）からは読めてしまいます。
        共有端末では使わないでください。
      </div>
    </div>

    <div id="ai-history-view" style="display:none"></div>
    <div id="ai-stats-view" style="display:none"></div>

    <div id="ai-quick"></div>

    <div id="ai-log"></div>

    <div id="ai-attach-bar" style="display:none"></div>

    <div id="ai-input-area">
      <div id="ai-input-tools">
        <button class="ai-tool-btn" id="ai-attach-canvas" title="キャンバスを添付（Vision）"><i class="ti ti-camera"></i></button>
        <button class="ai-tool-btn" id="ai-attach-file" title="画像ファイルを添付"><i class="ti ti-paperclip"></i></button>
        <button class="ai-tool-btn" id="ai-attach-scene" title="シーン情報を添付"><i class="ti ti-3d-cube-sphere"></i></button>
        <button class="ai-tool-btn" id="ai-attach-selected" title="選択中の図形を添付"><i class="ti ti-click"></i></button>
        <button class="ai-tool-btn" id="ai-export-chat" title="会話をMarkdownで保存"><i class="ti ti-download"></i></button>
        <button class="ai-tool-btn" id="ai-new-chat" title="新しい会話"><i class="ti ti-message-plus"></i></button>
        <input type="file" id="ai-file-input" accept="image/*" style="display:none">
      </div>
      <div id="ai-input-row">
        <textarea id="ai-input" rows="2"
          placeholder="指示を入力（例: 星空を描くアニメを作って） Ctrl+Enterで送信"></textarea>
        <button class="ai-btn accent" id="ai-send-btn" title="送信 Ctrl+Enter"><i class="ti ti-send"></i></button>
      </div>
    </div>`;
  document.body.appendChild(panel);

  aiWireEvents();
  aiRenderQuick();
  aiLogSystem('AIアシスタントです。描きたいもの・作りたい動きを日本語で指示してください。📷でキャンバスを見せて添削してもらうこともできます。');
  aiRefreshProviders();
  aiInitResize();
}

function aiWireEvents() {
  const $ = id => document.getElementById(id);
  $('ai-close-btn').onclick = () => aiTogglePanel(false);
  $('ai-settings-btn').onclick = () => aiToggleView('ai-settings');
  $('ai-history-btn').onclick = () => { aiToggleView('ai-history-view'); aiLoadHistory(); };
  $('ai-stats-btn').onclick = () => { aiToggleView('ai-stats-view'); aiLoadStats(); };

  $('ai-provider-select').onchange = e => {
    aiCurrentProvider = e.target.value;
    localStorage.setItem('mpAiProvider', aiCurrentProvider);
    aiRenderSettings();
  };
  $('ai-model-select').onchange = async e => {
    const p = aiGetProviderInfo();
    if (!p || !p.has_key) return;
    try { await AIClient.saveModel(aiCurrentProvider, e.target.value); }
    catch (err) { toast('ti-alert-triangle', err.message); }
  };
  $('ai-temp').oninput = e => {
    aiTemperature = parseFloat(e.target.value);
    $('ai-temp-val').textContent = aiTemperature.toFixed(1);
    localStorage.setItem('mpAiTemp', String(aiTemperature));
  };
  $('ai-key-save').onclick = aiSaveKey;
  $('ai-key-delete').onclick = aiDeleteKey;
  $('ai-key-test').onclick = aiTestConnection;

  $('ai-send-btn').onclick = aiSend;
  $('ai-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aiSend(); }
  });

  $('ai-attach-canvas').onclick = aiAttachCanvas;
  $('ai-attach-file').onclick = () => $('ai-file-input').click();
  $('ai-file-input').onchange = aiAttachFile;
  $('ai-attach-scene').onclick = aiAttachScene;
  $('ai-attach-selected').onclick = aiAttachSelected;
  $('ai-export-chat').onclick = aiExportChat;
  $('ai-new-chat').onclick = aiNewChat;
}

function aiToggleView(id) {
  ['ai-settings', 'ai-history-view', 'ai-stats-view'].forEach(v => {
    const el = document.getElementById(v);
    if (!el) return;
    el.style.display = (v === id && el.style.display === 'none') ? 'block' : 'none';
  });
}

// ── プロバイダー ─────────────────────────────────────────────
function aiGetProviderInfo() {
  return aiProviders.find(p => p.provider === aiCurrentProvider) || null;
}

async function aiRefreshProviders() {
  try { aiProviders = await AIClient.listKeys(); }
  catch (e) { aiLogSystem('⚠ 設定を読み込めません: ' + e.message); return; }

  const sel = document.getElementById('ai-provider-select');
  sel.innerHTML = '';
  aiProviders.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.provider;
    opt.textContent = p.label + (p.has_key ? '' : '（未登録）');
    sel.appendChild(opt);
  });
  if (!aiProviders.some(p => p.provider === aiCurrentProvider)) {
    aiCurrentProvider = aiProviders[0] ? aiProviders[0].provider : 'openai';
  }
  sel.value = aiCurrentProvider;
  aiRenderSettings();
}

function aiRenderSettings() {
  const p = aiGetProviderInfo();
  if (!p) return;
  document.getElementById('ai-key-masked').textContent = p.has_key ? p.masked_key : '未登録';
  document.getElementById('ai-key-input').value = '';
  document.getElementById('ai-model-custom').value = '';
  document.getElementById('ai-vision-badge').style.display = p.vision ? 'inline-flex' : 'none';

  const msel = document.getElementById('ai-model-select');
  msel.innerHTML = '';
  (p.models || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    msel.appendChild(opt);
  });
  msel.value = p.model || p.default_model;

  // Vision非対応なら画像添付ボタンを無効化
  const visionBtns = ['ai-attach-canvas', 'ai-attach-file'];
  visionBtns.forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = !p.vision; b.title = p.vision ? b.title : 'このプロバイダーは画像非対応'; }
  });

  if (!p.has_key) document.getElementById('ai-settings').style.display = 'block';
}

function aiActiveModel() {
  const custom = document.getElementById('ai-model-custom');
  if (custom && custom.value.trim()) return custom.value.trim();
  const msel = document.getElementById('ai-model-select');
  return msel ? msel.value : null;
}

async function aiSaveKey() {
  const input = document.getElementById('ai-key-input');
  const key = input.value.trim();
  if (!key) { toast('ti-alert-triangle', 'APIキーを入力してください'); return; }
  try {
    await AIClient.saveKey(aiCurrentProvider, key, aiActiveModel());
    input.value = '';
    toast('ti-check', 'APIキーを保存しました');
    await aiRefreshProviders();
  } catch (e) { toast('ti-alert-triangle', e.message); }
}

async function aiDeleteKey() {
  const p = aiGetProviderInfo();
  if (!p || !p.has_key) { toast('ti-info-circle', '登録済みのキーがありません'); return; }
  if (!confirm(p.label + ' のAPIキーを削除しますか？')) return;
  try {
    await AIClient.deleteKey(aiCurrentProvider);
    toast('ti-check', 'APIキーを削除しました');
    await aiRefreshProviders();
  } catch (e) { toast('ti-alert-triangle', e.message); }
}

async function aiTestConnection() {
  const p = aiGetProviderInfo();
  if (!p || !p.has_key) { toast('ti-alert-triangle', '先にAPIキーを保存してください'); return; }
  const btn = document.getElementById('ai-key-test');
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.innerHTML = '<i class="ti ti-loader-2 ai-spin"></i> テスト中';
  try {
    const r = await AIClient.testConnection(aiCurrentProvider, aiActiveModel());
    toast('ti-check', `接続OK (${r.duration_ms}ms)`);
  } catch (e) {
    toast('ti-alert-triangle', '接続失敗: ' + e.message);
  } finally { btn.disabled = false; btn.innerHTML = old; }
}

// ── クイックアクション ───────────────────────────────────────
function aiRenderQuick() {
  const box = document.getElementById('ai-quick');
  box.innerHTML = '';
  AI_QUICK_ACTIONS.forEach(a => {
    const chip = document.createElement('button');
    chip.className = 'ai-quick-chip';
    chip.innerHTML = `<i class="ti ${a.icon}"></i> ${a.label}`;
    chip.title = a.prompt;
    chip.onclick = () => {
      const input = document.getElementById('ai-input');
      input.value = a.prompt;
      input.focus();
    };
    box.appendChild(chip);
  });
}

// ── 添付 ─────────────────────────────────────────────────────
function aiRenderAttachBar() {
  const bar = document.getElementById('ai-attach-bar');
  bar.innerHTML = '';
  if (!aiPendingImages.length && !aiPendingContext) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  aiPendingImages.forEach((img, i) => {
    const chip = document.createElement('div');
    chip.className = 'ai-attach-chip';
    chip.innerHTML = `<img src="${img}" alt="添付"><button title="削除"><i class="ti ti-x"></i></button>`;
    chip.querySelector('button').onclick = () => {
      aiPendingImages.splice(i, 1);
      aiRenderAttachBar();
    };
    bar.appendChild(chip);
  });

  if (aiPendingContext) {
    const chip = document.createElement('div');
    chip.className = 'ai-attach-chip text';
    chip.innerHTML = `<span><i class="ti ti-code"></i> ${aiPendingContextLabel}</span><button title="削除"><i class="ti ti-x"></i></button>`;
    chip.querySelector('button').onclick = () => {
      aiPendingContext = null; aiPendingContextLabel = '';
      aiRenderAttachBar();
    };
    bar.appendChild(chip);
  }
}

let aiPendingContext = null;
let aiPendingContextLabel = '';

function aiAttachCanvas() {
  const p = aiGetProviderInfo();
  if (p && !p.vision) { toast('ti-alert-triangle', 'このプロバイダーは画像非対応です'); return; }
  const url = AIClient.captureCanvas(1024);
  if (!url) { toast('ti-alert-triangle', 'キャンバスを取得できませんでした'); return; }
  if (aiPendingImages.length >= 3) { toast('ti-info-circle', '画像は最大3枚までです'); return; }
  aiPendingImages.push(url);
  aiRenderAttachBar();
  toast('ti-camera', 'キャンバスを添付しました');
}

function aiAttachFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('ti-alert-triangle', '画像ファイルを選んでください'); return; }
  if (file.size > 4 * 1024 * 1024) { toast('ti-alert-triangle', '4MB以下の画像にしてください'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    if (aiPendingImages.length >= 3) { toast('ti-info-circle', '画像は最大3枚までです'); return; }
    aiPendingImages.push(reader.result);
    aiRenderAttachBar();
    toast('ti-paperclip', '画像を添付しました');
  };
  reader.readAsDataURL(file);
}

function aiAttachScene() {
  const api = window.AnimationApp;
  if (!api || !api.getSceneSnapshot) { toast('ti-alert-triangle', 'シーン情報を取得できません'); return; }
  const snap = api.getSceneSnapshot();
  // 大きすぎる場合は要約
  const summary = {
    width: snap.width, height: snap.height, bg: snap.bg,
    shapeCount: snap.shapes.length,
    shapes: snap.shapes.slice(0, 40).map(s => {
      const o = { type: s.type, name: s.name };
      ['x', 'y', 'w', 'h', 'cx', 'cy', 'rx', 'ry', 'r', 'color', 'sides', 'rot'].forEach(k => {
        if (s[k] !== undefined) o[k] = s[k];
      });
      return o;
    })
  };
  aiPendingContext = 'シーン情報:\n' + JSON.stringify(summary);
  aiPendingContextLabel = `シーン (${snap.shapes.length}図形)`;
  aiRenderAttachBar();
  toast('ti-3d-cube-sphere', 'シーン情報を添付しました');
}

function aiAttachSelected() {
  const api = window.AnimationApp;
  const sel = api && api.getSelected ? api.getSelected() : null;
  if (!sel) { toast('ti-info-circle', '図形が選択されていません'); return; }
  const clean = JSON.parse(JSON.stringify(sel, (k, v) => {
    if (k === 'snap' || k === '_orig' || k === '_fn' || typeof v === 'function') return undefined;
    return v;
  }));
  aiPendingContext = '選択中の図形:\n' + JSON.stringify(clean);
  aiPendingContextLabel = `選択図形 (${sel.type})`;
  aiRenderAttachBar();
  toast('ti-click', '選択図形を添付しました');
}

// ── ログ描画 ─────────────────────────────────────────────────
function aiLogSystem(text) {
  const log = document.getElementById('ai-log');
  const el = document.createElement('div');
  el.className = 'ai-msg system';
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function aiLogUser(text, images) {
  const log = document.getElementById('ai-log');
  const el = document.createElement('div');
  el.className = 'ai-msg user';
  if (images && images.length) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'ai-msg-imgs';
    images.forEach(src => {
      const im = document.createElement('img');
      im.src = src;
      imgWrap.appendChild(im);
    });
    el.appendChild(imgWrap);
  }
  const t = document.createElement('div');
  t.textContent = text;
  el.appendChild(t);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function aiLogAssistant(content, meta, canRegenerate) {
  const log = document.getElementById('ai-log');
  const el = document.createElement('div');
  el.className = 'ai-msg assistant';

  const parsed = AIClient.parseResponse(content);
  if (parsed.text) {
    const txt = document.createElement('div');
    txt.className = 'ai-msg-text';
    txt.textContent = parsed.text;
    el.appendChild(txt);
  }
  parsed.blocks.forEach(block => el.appendChild(aiBuildCodeBlock(block)));

  const foot = document.createElement('div');
  foot.className = 'ai-msg-foot';
  if (meta) {
    const m = document.createElement('span');
    m.className = 'ai-msg-meta';
    m.textContent = meta;
    foot.appendChild(m);
  }
  if (canRegenerate) {
    const rb = document.createElement('button');
    rb.className = 'ai-mini-link';
    rb.innerHTML = '<i class="ti ti-refresh"></i> 再生成';
    rb.onclick = aiRegenerate;
    foot.appendChild(rb);
  }
  el.appendChild(foot);

  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function aiBuildCodeBlock(block) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-code-block';

  const danger = aiCheckDangerWords(block.code);
  const isMod = /registerMod\s*\(|registerBrush\s*\(|registerTool\s*\(|registerShapeType\s*\(/.test(block.code);

  const head = document.createElement('div');
  head.className = 'ai-code-head';
  head.innerHTML =
    `<span class="ai-code-lang">${block.lang}${isMod ? ' · MOD' : ''}</span>` +
    (danger.length
      ? `<span class="ai-code-danger" title="${danger.join(', ')}"><i class="ti ti-alert-triangle"></i> 注意ワード</span>`
      : '');
  wrap.appendChild(head);

  const pre = document.createElement('pre');
  pre.className = 'ai-code-pre';
  pre.textContent = block.code;
  wrap.appendChild(pre);

  const btns = document.createElement('div');
  btns.className = 'ai-code-btns';
  const mk = (icon, label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'ai-btn ' + (cls || '');
    b.innerHTML = `<i class="ti ${icon}"></i> ${label}`;
    b.onclick = fn;
    return b;
  };

  btns.appendChild(mk('ti-eye', 'プレビュー', '', () => aiPreviewCode(block.code)));
  btns.appendChild(mk('ti-check', '適用', 'accent', () => aiApplyCode(block.code)));
  if (isMod) btns.appendChild(mk('ti-puzzle', 'MOD化', '', () => aiInstallAsMod(block.code)));
  btns.appendChild(mk('ti-file-code', 'エディタへ', '', () => aiSendToEditor(block.code)));
  btns.appendChild(mk('ti-copy', 'コピー', '', () => {
    navigator.clipboard?.writeText(block.code)
      .then(() => toast('ti-check', 'コピーしました'))
      .catch(() => toast('ti-alert-triangle', 'コピーに失敗しました'));
  }));
  wrap.appendChild(btns);
  return wrap;
}

// ── 送信 ─────────────────────────────────────────────────────
async function aiSend() {
  if (aiBusy) return;
  const input = document.getElementById('ai-input');
  let text = input.value.trim();

  const p = aiGetProviderInfo();
  if (!p) { aiLogSystem('⚠ プロバイダー情報を取得できません'); return; }
  if (!p.has_key) {
    aiLogSystem(`⚠ ${p.label} のAPIキーが未登録です。⚙設定から登録してください。`);
    document.getElementById('ai-settings').style.display = 'block';
    return;
  }

  const images = aiPendingImages.slice();
  // コンテキストを本文に付加
  let fullText = text;
  if (aiPendingContext) {
    fullText = (text ? text + '\n\n' : '') + aiPendingContext;
  }
  if (!fullText.trim() && !images.length) return;
  if (!text && images.length) text = '(画像を添付)';

  input.value = '';
  aiPendingImages = [];
  const ctxLabel = aiPendingContextLabel;
  aiPendingContext = null; aiPendingContextLabel = '';
  aiRenderAttachBar();

  aiLogUser(text + (ctxLabel ? `　[${ctxLabel}]` : ''), images);
  const userMsg = { role: 'user', content: fullText };
  if (images.length) userMsg.images = images;
  aiHistory.push(userMsg);

  await aiRunRequest(p);
}

async function aiRegenerate() {
  if (aiBusy) return;
  // 直近のassistant応答を履歴から外して再送
  for (let i = aiHistory.length - 1; i >= 0; i--) {
    if (aiHistory[i].role === 'assistant') { aiHistory.splice(i, 1); break; }
  }
  const p = aiGetProviderInfo();
  if (!p) return;
  aiLogSystem('↻ 再生成します...');
  await aiRunRequest(p);
}

async function aiRunRequest(p) {
  aiBusy = true;
  const sendBtn = document.getElementById('ai-send-btn');
  sendBtn.disabled = true;
  const log = document.getElementById('ai-log');
  const thinking = document.createElement('div');
  thinking.className = 'ai-msg system ai-thinking';
  thinking.innerHTML = `<i class="ti ti-loader-2 ai-spin"></i> ${p.label} が生成中...`;
  log.appendChild(thinking);
  log.scrollTop = log.scrollHeight;

  try {
    const res = await AIClient.chat(aiCurrentProvider, aiHistory.slice(-12), {
      model: aiActiveModel(),
      temperature: aiTemperature,
      conversationId: aiConversationId
    });
    thinking.remove();
    if (res.conversation_id) aiConversationId = res.conversation_id;
    aiHistory.push({ role: 'assistant', content: res.content });
    aiLogAssistant(res.content, `${p.label} / ${res.model} · ${res.duration_ms}ms`, true);
  } catch (e) {
    thinking.remove();
    aiLogSystem('⚠ エラー: ' + e.message);
    if (e.needKey) document.getElementById('ai-settings').style.display = 'block';
  } finally {
    aiBusy = false;
    sendBtn.disabled = false;
  }
}

// ── 新しい会話 ────────────────────────────────────────────────
function aiNewChat() {
  aiHistory = [];
  aiConversationId = null;
  aiPendingImages = [];
  aiPendingContext = null; aiPendingContextLabel = '';
  aiRenderAttachBar();
  document.getElementById('ai-log').innerHTML = '';
  aiLogSystem('新しい会話を開始しました。');
}

// ── 会話履歴 ─────────────────────────────────────────────────
async function aiLoadHistory() {
  const view = document.getElementById('ai-history-view');
  view.innerHTML = '<div class="ai-msg system">読み込み中...</div>';
  let list;
  try { list = await AIClient.listConversations(); }
  catch (e) { view.innerHTML = `<div class="ai-msg system">⚠ ${e.message}</div>`; return; }

  view.innerHTML = '<div class="ai-view-title"><i class="ti ti-history"></i> 会話履歴</div>';
  if (!list.length) {
    view.innerHTML += '<div class="ai-msg system">まだ保存された会話はありません</div>';
    return;
  }
  list.forEach(c => {
    const row = document.createElement('div');
    row.className = 'ai-hist-row';
    row.innerHTML = `
      <div class="ai-hist-main">
        <div class="ai-hist-title">${aiEscape(c.title)}</div>
        <div class="ai-hist-sub">${c.provider || ''} · ${c.message_count}件 · ${c.updated_at || ''}</div>
      </div>
      <div class="ai-hist-btns">
        <button title="読み込む"><i class="ti ti-folder-open"></i></button>
        <button title="名前変更"><i class="ti ti-edit"></i></button>
        <button class="danger" title="削除"><i class="ti ti-trash"></i></button>
      </div>`;
    const [openBtn, renBtn, delBtn] = row.querySelectorAll('button');
    openBtn.onclick = () => aiOpenConversation(c.id);
    renBtn.onclick = async () => {
      const t = prompt('新しいタイトル', c.title);
      if (!t) return;
      try { await AIClient.renameConversation(c.id, t); aiLoadHistory(); }
      catch (e) { toast('ti-alert-triangle', e.message); }
    };
    delBtn.onclick = async () => {
      if (!confirm('この会話を削除しますか？')) return;
      try { await AIClient.deleteConversation(c.id); aiLoadHistory(); }
      catch (e) { toast('ti-alert-triangle', e.message); }
    };
    view.appendChild(row);
  });
}

async function aiOpenConversation(id) {
  try {
    const conv = await AIClient.getConversation(id);
    aiHistory = conv.messages.map(m => {
      const o = { role: m.role, content: m.content };
      if (m.images && m.images.length) o.images = m.images;
      return o;
    });
    aiConversationId = conv.id;
    if (conv.provider) {
      aiCurrentProvider = conv.provider;
      document.getElementById('ai-provider-select').value = conv.provider;
      aiRenderSettings();
    }
    // ログ再描画
    const log = document.getElementById('ai-log');
    log.innerHTML = '';
    conv.messages.forEach(m => {
      if (m.role === 'user') aiLogUser(m.content, m.images);
      else aiLogAssistant(m.content, null, false);
    });
    aiToggleView('ai-history-view'); // 閉じる
    toast('ti-check', '会話を読み込みました');
  } catch (e) { toast('ti-alert-triangle', e.message); }
}

// ── 統計 ─────────────────────────────────────────────────────
async function aiLoadStats() {
  const view = document.getElementById('ai-stats-view');
  view.innerHTML = '<div class="ai-msg system">読み込み中...</div>';
  let rows;
  try { rows = await AIClient.stats(); }
  catch (e) { view.innerHTML = `<div class="ai-msg system">⚠ ${e.message}</div>`; return; }

  view.innerHTML = '<div class="ai-view-title"><i class="ti ti-chart-bar"></i> 使用統計（過去30日）</div>';
  if (!rows.length) {
    view.innerHTML += '<div class="ai-msg system">まだ利用履歴がありません</div>';
    return;
  }
  let totalCalls = 0, totalResp = 0;
  rows.forEach(r => {
    totalCalls += Number(r.calls || 0);
    totalResp += Number(r.response_chars || 0);
    const card = document.createElement('div');
    card.className = 'ai-stat-card';
    const label = (aiProviders.find(p => p.provider === r.provider) || {}).label || r.provider;
    card.innerHTML = `
      <div class="ai-stat-name">${label}</div>
      <div class="ai-stat-grid">
        <div><span>${r.calls}</span>回</div>
        <div><span>${r.success || 0}</span>成功</div>
        <div><span>${r.images || 0}</span>画像</div>
        <div><span>${r.avg_ms || 0}</span>ms平均</div>
        <div><span>${aiNum(r.prompt_chars)}</span>送信字</div>
        <div><span>${aiNum(r.response_chars)}</span>受信字</div>
      </div>`;
    view.appendChild(card);
  });
  const sum = document.createElement('div');
  sum.className = 'ai-msg system';
  sum.textContent = `合計 ${totalCalls}回 / 生成 ${aiNum(totalResp)}文字`;
  view.appendChild(sum);
}

// ── Markdown書き出し ─────────────────────────────────────────
function aiExportChat() {
  if (!aiHistory.length) { toast('ti-info-circle', '書き出す会話がありません'); return; }
  let md = '# Magic Paint AI 会話ログ\n\n';
  md += `- 日時: ${new Date().toLocaleString()}\n`;
  md += `- プロバイダー: ${(aiGetProviderInfo() || {}).label || aiCurrentProvider}\n\n---\n\n`;
  aiHistory.forEach(m => {
    md += m.role === 'user' ? '## 🙋 ユーザー\n\n' : '## 🤖 AI\n\n';
    md += m.content + '\n\n';
    if (m.images && m.images.length) md += `（画像 ${m.images.length}枚を添付）\n\n`;
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `magicpaint-ai-${Date.now()}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('ti-download', 'Markdownを書き出しました');
}

// ── リサイズ ─────────────────────────────────────────────────
function aiInitResize() {
  const handle = document.getElementById('ai-resize-handle');
  const panel = document.getElementById('ai-panel');
  if (!handle) return;
  const saved = parseInt(localStorage.getItem('mpAiPanelW') || '0', 10);
  if (saved >= 320) panel.style.width = saved + 'px';

  let dragging = false;
  handle.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); document.body.style.userSelect = 'none'; });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    let w = window.innerWidth - e.clientX;
    w = Math.max(320, Math.min(w, Math.round(window.innerWidth * 0.9)));
    panel.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    localStorage.setItem('mpAiPanelW', String(panel.offsetWidth));
  });
}

// ── ヘルパー ─────────────────────────────────────────────────
function aiEscape(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function aiNum(n) {
  n = Number(n || 0);
  return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

// ── パネル開閉 ────────────────────────────────────────────────
function aiTogglePanel(force) {
  aiBuildPanel();
  const panel = document.getElementById('ai-panel');
  const show = force !== undefined ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', show);
  if (show) {
    aiRefreshProviders();
    setTimeout(() => document.getElementById('ai-input')?.focus(), 150);
  }
}
window.aiTogglePanel = aiTogglePanel;

// ── 起動フック ────────────────────────────────────────────────
function aiBindTrigger() {
  document.getElementById('ai-btn')?.addEventListener('click', () => aiTogglePanel());
  // Ctrl+/ でトグル
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      aiTogglePanel();
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', aiBindTrigger);
} else {
  aiBindTrigger();
}
