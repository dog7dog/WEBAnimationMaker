// ══════════════════════════════════════════════════════════════
// AI Framework v2: ai_client.js
//   静的サイト版。Flaskバックエンド(ai_api.py)を経由せず、
//   ブラウザから各社のAPIへ直接リクエストする。
//   APIキー・会話履歴・使用統計は localStorage に保持する。
//
//   ai_panel.js / ai_apply.js から見えるメソッドと戻り値の形は
//   バックエンド版と同じにしてあるので、呼び出し側の変更は不要。
//
//   ⚠ APIキーはこのブラウザの localStorage に平文で入る。
//     同じブラウザを使える人と、このページで動くコード
//     （インストールしたMODを含む）からは読めてしまう。
//     共有端末では使わず、使い終わったらキーを削除すること。
// ══════════════════════════════════════════════════════════════

const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    default_model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    vision: true,
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  gemini: {
    label: 'Gemini',
    default_model: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    vision: true
  },
  claude: {
    label: 'Claude',
    default_model: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    vision: true,
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  grok: {
    label: 'Grok',
    default_model: 'grok-3-mini',
    models: ['grok-3-mini', 'grok-3', 'grok-2-vision'],
    vision: true,
    endpoint: 'https://api.x.ai/v1/chat/completions'
  }
};

const AI_MAX_TOKENS = 4096;
const AI_TIMEOUT_MS = 90000;
const AI_MAX_LOGS = 500;
const AI_MOD_ID_RE = /^[a-z0-9_]{1,40}$/;

// ── AIへ渡すシステムプロンプト ────────────────────────────────
const AI_SYSTEM_PROMPT = `あなたは「Magic Paint」というブラウザ製2D/3Dアニメーションツールに組み込まれたAIアシスタントです。
ユーザーの指示に従い、Canvas API / Three.js / Magic Paint内部API のコードを生成します。
ユーザーがキャンバスの画像を添付した場合は、その内容を分析して感想・改善案・コードを提案してください。

## 実行環境
生成した JavaScript は以下の引数を持つ関数の中身として実行されます。
  ctx    : CanvasRenderingContext2D（メインキャンバスの2Dコンテキスト）
  canvas : HTMLCanvasElement
  width  : キャンバス幅(px)
  height : キャンバス高さ(px)
  api    : window.AnimationApp（Magic Paint MOD API）
  t      : アニメーション時刻(秒)。コードは毎フレーム呼ばれるので t を使うと動きが作れる

## Magic Paint API（api = window.AnimationApp）
- api.addShape(shape)         図形を追加 { type:'rect', x,y,w,h } / { type:'circle', cx,cy,rx,ry } など
- api.addObject(obj)          Three.js等のオブジェクト追加 { type, engine:'threejs', ... }
- api.createLayer({name})     レイヤー追加
- api.getSelected()           選択中図形を取得
- api.setSelectedPatch(patch) 選択中図形を変更
- api.getSceneSnapshot()      シーン全体 { width, height, bg, fps, shapes } を取得
- api.registerShapeType(type, {draw(ctx,s), getBounds(s)})  カスタム図形登録
- api.registerBrush({id,name,icon,onStart,onMove,onEnd})    カスタムブラシ登録
- api.registerTool({id,name,icon}) / api.registerUI({id,position,title,html,onMount})
- api.redraw() / api.toast(icon,msg) / api.setStatus(msg)

## 図形フォーマット例
rect:     { type:'rect', x, y, w, h, color:'#3B8AE6', sw:2, fill:true, opa:100 }
circle:   { type:'circle', cx, cy, rx, ry, color, sw, fill }
triangle: { type:'triangle', cx, cy, r, rot:0 }
polygon:  { type:'polygon', cx, cy, r, sides:6 }
line:     { type:'line', x1, y1, x2, y2 }
pen:      { type:'pen', pts:[{x,y},...], closed:false }

## MOD生成を頼まれた場合
main.js のコードを1つのコードブロックで出力してください。先頭で必ず
  const api = window.AnimationApp;
  api.registerMod({ id:"...", name:"...", version:"1.0.0", description:"..." });
を呼び、その後に registerBrush / registerTool / registerShapeType 等を書きます。

## 回答ルール
1. 回答は日本語で簡潔に。
2. コードは必ず \`\`\`javascript フェンスで囲んだ1つのコードブロックにまとめる。
3. 描画コードは ctx に直接描く（毎フレーム呼ばれる前提。requestAnimationFrame や無限ループは書かない）。
4. fetch / XMLHttpRequest / localStorage / sessionStorage / document.cookie / eval / import は使用しない。
5. DOM操作は避け、描画は ctx / api 経由で行う（MOD生成時のUI登録は除く）。
6. ユーザーから「シーン情報」「選択図形」のJSONが渡された場合は、それを踏まえて座標や色を決める。
`;

// ══════════════════════════════════════════════════════════════
// localStorage（キー / 会話 / ログ）
// ══════════════════════════════════════════════════════════════
const AI_LS_KEYS = 'mpAiKeys';
const AI_LS_CONVS = 'mpAiConversations';
const AI_LS_LOGS = 'mpAiLogs';

function _aiLoad(name, fallback) {
  try {
    const raw = localStorage.getItem(name);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function _aiSave(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch (e) {
    throw new Error('ブラウザに保存できませんでした（容量不足かプライベートモードの可能性）');
  }
}

function _aiNowStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// ══════════════════════════════════════════════════════════════
// ユーティリティ
// ══════════════════════════════════════════════════════════════
function _aiMaskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 8) return '*'.repeat(k.length);
  return k.slice(0, 4) + '*'.repeat(Math.min(k.length - 8, 20)) + k.slice(-4);
}

// エラーメッセージにキーが混ざって画面やログに出ないようにする
function _aiSanitizeError(text, apiKey) {
  let s = String(text == null ? '' : text);
  if (apiKey) s = s.split(apiKey).join('***');
  return s.slice(0, 500);
}

// dataURL → { mime, b64 }
function _aiParseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return {};
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return {};
  const head = dataUrl.slice(5, comma);
  if (!head.endsWith(';base64')) return {};
  return { mime: head.slice(0, -7) || 'image/png', b64: dataUrl.slice(comma + 1) };
}

// fetchでJSONをPOSTし { status, data } を返す。
// ブラウザから直接叩くのでCORSで弾かれることがあり、その場合は
// fetch自体が TypeError になって status も本文も取れない。
async function _aiPostJson(url, payload, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('タイムアウトしました（90秒）');
    throw new Error(
      'APIに接続できませんでした。ブラウザから直接呼び出しているため、'
      + 'ネットワーク遮断のほかCORSで拒否された可能性があります'
      + '（file:// で開いている場合はローカルサーバー経由で開いてください）'
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function _aiExtractError(parsed) {
  if (!parsed || typeof parsed !== 'object') return 'APIエラー';
  const e = parsed.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return e.message || e.type || 'APIエラー';
  return parsed.message || 'APIエラー';
}

// ══════════════════════════════════════════════════════════════
// プロバイダー別の呼び出し（ai_api.py の call_* と同じ組み立て）
// ══════════════════════════════════════════════════════════════
function _aiOpenAiMessages(messages) {
  const out = [{ role: 'system', content: AI_SYSTEM_PROMPT }];
  (messages || []).forEach(m => {
    const images = m.images || [];
    if (images.length && m.role === 'user') {
      const parts = [{ type: 'text', text: m.content }];
      images.forEach(img => {
        const { mime, b64 } = _aiParseDataUrl(img);
        if (mime) parts.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } });
      });
      out.push({ role: 'user', content: parts });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  });
  return out;
}

async function _aiCallOpenAiCompat(endpoint, apiKey, model, messages, temperature) {
  const payload = {
    model,
    max_tokens: AI_MAX_TOKENS,
    messages: _aiOpenAiMessages(messages)
  };
  if (temperature != null) payload.temperature = temperature;

  const { status, data } = await _aiPostJson(endpoint, payload, { Authorization: 'Bearer ' + apiKey });
  if (status !== 200) return { error: _aiExtractError(data) };
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return { error: 'レスポンス解析に失敗しました' };
  return { text };
}

async function _aiCallGemini(apiKey, model, messages, temperature) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + encodeURIComponent(model) + ':generateContent';

  const contents = (messages || []).map(m => {
    const parts = [{ text: m.content || '' }];
    (m.images || []).forEach(img => {
      const { mime, b64 } = _aiParseDataUrl(img);
      if (mime) parts.push({ inline_data: { mime_type: mime, data: b64 } });
    });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });

  const generationConfig = { maxOutputTokens: AI_MAX_TOKENS };
  if (temperature != null) generationConfig.temperature = temperature;

  // キーはURLに載せず、ヘッダで送る（履歴やRefererに残らないように）
  const { status, data } = await _aiPostJson(url, {
    system_instruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
    contents,
    generationConfig
  }, { 'x-goog-api-key': apiKey });

  if (status !== 200) return { error: _aiExtractError(data) };
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return { error: 'レスポンス解析に失敗しました' };
  return { text: parts.map(p => p.text || '').join('') };
}

async function _aiCallClaude(apiKey, model, messages, temperature) {
  const msgs = (messages || []).map(m => {
    const images = m.images || [];
    if (images.length && m.role === 'user') {
      const parts = [];
      images.forEach(img => {
        const { mime, b64 } = _aiParseDataUrl(img);
        if (mime) parts.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } });
      });
      parts.push({ type: 'text', text: m.content });
      return { role: 'user', content: parts };
    }
    return { role: m.role, content: m.content };
  });

  const payload = { model, max_tokens: AI_MAX_TOKENS, system: AI_SYSTEM_PROMPT, messages: msgs };
  if (temperature != null) payload.temperature = Math.min(Math.max(temperature, 0), 1);

  const { status, data } = await _aiPostJson(AI_PROVIDERS.claude.endpoint, payload, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // ブラウザから直接呼ぶことを許可するヘッダ（サーバー経由なら不要）
    'anthropic-dangerous-direct-browser-access': 'true'
  });

  if (status !== 200) return { error: _aiExtractError(data) };
  const blocks = data?.content;
  if (!Array.isArray(blocks)) return { error: 'レスポンス解析に失敗しました' };
  return { text: blocks.filter(b => b.type === 'text').map(b => b.text || '').join('') };
}

// { text } か { error } を返す
async function _aiCallProvider(provider, apiKey, model, messages, temperature) {
  try {
    if (provider === 'openai' || provider === 'grok') {
      return await _aiCallOpenAiCompat(AI_PROVIDERS[provider].endpoint, apiKey, model, messages, temperature);
    }
    if (provider === 'gemini') return await _aiCallGemini(apiKey, model, messages, temperature);
    if (provider === 'claude') return await _aiCallClaude(apiKey, model, messages, temperature);
    return { error: '未対応のプロバイダーです' };
  } catch (e) {
    return { error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════
// AIClient（バックエンド版と同じ呼び出し口）
// ══════════════════════════════════════════════════════════════
const AIClient = {

  // ── キー ──
  async listKeys() {
    const store = _aiLoad(AI_LS_KEYS, {});
    return Object.keys(AI_PROVIDERS).map(pid => {
      const info = AI_PROVIDERS[pid];
      const row = store[pid];
      return {
        provider: pid,
        label: info.label,
        models: info.models,
        default_model: info.default_model,
        vision: !!info.vision,
        has_key: !!(row && row.api_key),
        masked_key: row && row.api_key ? _aiMaskKey(row.api_key) : '',
        model: (row && row.model) || info.default_model
      };
    });
  },

  async saveKey(provider, apiKey, model) {
    const key = String(apiKey || '').trim();
    if (!AI_PROVIDERS[provider]) throw new Error('不明なプロバイダーです');
    if (!key) throw new Error('APIキーが空です');
    if (key.length > 512) throw new Error('APIキーが長すぎます');

    const store = _aiLoad(AI_LS_KEYS, {});
    store[provider] = {
      api_key: key,
      model: (model || '').trim() || null,
      updated_at: _aiNowStr()
    };
    _aiSave(AI_LS_KEYS, store);
    return { ok: true, provider, masked_key: _aiMaskKey(key) };
  },

  async saveModel(provider, model) {
    const m = String(model || '').trim();
    if (!AI_PROVIDERS[provider] || !m || m.length > 128) throw new Error('パラメータが不正です');
    const store = _aiLoad(AI_LS_KEYS, {});
    if (!store[provider]) throw new Error('APIキーが未登録です');
    store[provider].model = m;
    _aiSave(AI_LS_KEYS, store);
    return { ok: true };
  },

  async deleteKey(provider) {
    const store = _aiLoad(AI_LS_KEYS, {});
    delete store[provider];
    _aiSave(AI_LS_KEYS, store);
    return { ok: true };
  },

  async testConnection(provider, model) {
    const info = AI_PROVIDERS[provider];
    if (!info) throw new Error('不明なプロバイダーです');
    const row = _aiLoad(AI_LS_KEYS, {})[provider];
    if (!row || !row.api_key) throw new Error('APIキーが未登録です');

    const useModel = (model || '').trim() || row.model || info.default_model;
    const start = Date.now();
    const res = await _aiCallProvider(provider, row.api_key, useModel,
      [{ role: 'user', content: '接続テストです。「OK」とだけ返してください。' }], null);
    const ms = Date.now() - start;

    if (res.error) {
      const err = new Error(_aiSanitizeError(res.error, row.api_key));
      err.duration_ms = ms;
      throw err;
    }
    return { ok: true, model: useModel, duration_ms: ms, reply: (res.text || '').slice(0, 100) };
  },

  // ── チャット ──
  // messages: [{ role, content, images?:[dataURL] }]
  // opts: { model, temperature, conversationId, save }
  async chat(provider, messages, opts) {
    opts = opts || {};
    const info = AI_PROVIDERS[provider];
    if (!info) throw new Error('不明なプロバイダーです');

    const row = _aiLoad(AI_LS_KEYS, {})[provider];
    if (!row || !row.api_key) {
      const err = new Error(info.label + ' のAPIキーが登録されていません');
      err.needKey = true;
      throw err;
    }

    const clean = (messages || [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content, images: m.images || [] }));
    if (!clean.length) throw new Error('メッセージが空です');

    const model = (opts.model || '').trim() || row.model || info.default_model;
    let temperature = opts.temperature;
    temperature = (temperature == null || isNaN(temperature))
      ? null : Math.min(Math.max(Number(temperature), 0), 2);

    let lastUser = null;
    for (let i = clean.length - 1; i >= 0; i--) {
      if (clean[i].role === 'user') { lastUser = clean[i]; break; }
    }

    const start = Date.now();
    const res = await _aiCallProvider(provider, row.api_key, model, clean, temperature);
    const ms = Date.now() - start;

    // 使用ログ（キーは記録しない）
    this._log({
      provider, model,
      prompt_chars: clean.reduce((n, m) => n + m.content.length, 0),
      response_chars: (res.text || '').length,
      image_count: lastUser ? lastUser.images.length : 0,
      duration_ms: ms,
      ok: res.error ? 0 : 1,
      created_at: Date.now()
    });

    if (res.error) throw new Error(_aiSanitizeError(res.error, row.api_key));

    let convId = opts.conversationId || null;
    if (opts.save !== false) {
      convId = this._appendConversation(convId, provider, lastUser, res.text || '');
    }

    return {
      ok: true, provider, model,
      content: res.text || '',
      conversation_id: convId,
      duration_ms: ms
    };
  },

  // ── 会話履歴 ──
  async listConversations() {
    return _aiLoad(AI_LS_CONVS, [])
      .slice()
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 100)
      .map(c => ({
        id: c.id,
        title: c.title,
        provider: c.provider,
        updated_at: c.updated_at,
        message_count: (c.messages || []).length
      }));
  },

  async getConversation(id) {
    const conv = _aiLoad(AI_LS_CONVS, []).find(c => String(c.id) === String(id));
    if (!conv) throw new Error('会話が見つかりません');
    return {
      id: conv.id, title: conv.title, provider: conv.provider,
      messages: (conv.messages || []).map(m => ({ ...m, images: m.images || [] }))
    };
  },

  async renameConversation(id, title) {
    const t = String(title || '').trim().slice(0, 255);
    if (!t) throw new Error('タイトルが空です');
    const list = _aiLoad(AI_LS_CONVS, []);
    const conv = list.find(c => String(c.id) === String(id));
    if (!conv) throw new Error('会話が見つかりません');
    conv.title = t;
    conv.updated_at = _aiNowStr();
    _aiSave(AI_LS_CONVS, list);
    return { ok: true };
  },

  async deleteConversation(id) {
    const list = _aiLoad(AI_LS_CONVS, []).filter(c => String(c.id) !== String(id));
    _aiSave(AI_LS_CONVS, list);
    return { ok: true };
  },

  // 会話へ1往復ぶん追記する。conversation_id を返す
  _appendConversation(convId, provider, lastUser, answer) {
    try {
      const list = _aiLoad(AI_LS_CONVS, []);
      let conv = convId ? list.find(c => String(c.id) === String(convId)) : null;
      if (!conv) {
        const title = ((lastUser && lastUser.content) || '新しい会話')
          .trim().replace(/\n/g, ' ').slice(0, 60) || '新しい会話';
        conv = { id: Date.now(), title, provider, created_at: _aiNowStr(), updated_at: _aiNowStr(), messages: [] };
        list.push(conv);
      } else {
        conv.provider = provider;
        conv.updated_at = _aiNowStr();
      }
      if (lastUser) {
        conv.messages.push({
          role: 'user', content: lastUser.content,
          images: lastUser.images || [], created_at: _aiNowStr()
        });
      }
      conv.messages.push({ role: 'assistant', content: answer, images: [], created_at: _aiNowStr() });
      _aiSave(AI_LS_CONVS, list);
      return conv.id;
    } catch (e) {
      // 保存に失敗しても回答は返したいので、会話IDだけ諦める
      console.warn('[AI] 会話の保存に失敗', e);
      return null;
    }
  },

  // ── 統計 ──
  _log(entry) {
    try {
      const logs = _aiLoad(AI_LS_LOGS, []);
      logs.push(entry);
      _aiSave(AI_LS_LOGS, logs.slice(-AI_MAX_LOGS));
    } catch (e) { /* 統計は無くても困らない */ }
  },

  async stats() {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const byProvider = new Map();
    _aiLoad(AI_LS_LOGS, []).forEach(l => {
      if (!l || Number(l.created_at) < since) return;
      if (!byProvider.has(l.provider)) {
        byProvider.set(l.provider, {
          provider: l.provider, calls: 0, success: 0,
          prompt_chars: 0, response_chars: 0, images: 0, _ms: 0
        });
      }
      const r = byProvider.get(l.provider);
      r.calls += 1;
      r.success += l.ok ? 1 : 0;
      r.prompt_chars += Number(l.prompt_chars || 0);
      r.response_chars += Number(l.response_chars || 0);
      r.images += Number(l.image_count || 0);
      r._ms += Number(l.duration_ms || 0);
    });
    return [...byProvider.values()].map(r => {
      const avg_ms = r.calls ? Math.round(r._ms / r.calls) : 0;
      delete r._ms;
      return { ...r, avg_ms };
    });
  },

  // ── MODインストール ──
  // サーバーの mods/ へ書き出す代わりに、ZIP MODと同じ
  // ブラウザ内ストア(IndexedDB)へ入れて即実行する。
  async installMod(mod) {
    const modId = String(mod?.mod_id || '').trim().toLowerCase();
    const mainJs = mod?.main_js || '';
    const styleCss = mod?.style_css || '';

    if (!AI_MOD_ID_RE.test(modId)) {
      throw new Error('MOD IDは英小文字・数字・アンダースコア(40文字以内)にしてください');
    }
    if (!mainJs.trim()) throw new Error('main.js が空です');
    if (typeof installGeneratedMod !== 'function') {
      throw new Error('MODローダーが読み込まれていません');
    }

    const exists = typeof LoadedZipMods !== 'undefined'
      && LoadedZipMods.some(m => m.id === modId);
    if (exists && !mod.overwrite) {
      const err = new Error('同名のMODが既に存在します');
      err.exists = true;
      throw err;
    }

    return installGeneratedMod({
      id: modId,
      name: String(mod?.name || modId).trim().slice(0, 80),
      description: String(mod?.description || 'AIが生成したMOD').trim().slice(0, 300),
      author: 'Magic Paint AI',
      mainJs,
      styleCss
    });
  },

  // ── 応答パース: ```コード``` を抽出 ──
  // 戻り値: { text, blocks:[{ lang, code }] }
  parseResponse(content) {
    const blocks = [];
    const text = (content || '').replace(
      /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
      (m, lang, code) => {
        blocks.push({ lang: (lang || 'javascript').toLowerCase(), code: code.trim() });
        return `\n〔コード ${blocks.length}〕\n`;
      }
    );
    return { text: text.trim(), blocks };
  },

  // ── キャンバスのスクリーンショットを dataURL で取得 ──
  captureCanvas(maxW) {
    maxW = maxW || 1024;
    try {
      const src = (typeof cv !== 'undefined' && cv) ? cv : document.getElementById('cv');
      if (!src) return null;
      const scale = Math.min(1, maxW / src.width);
      const w = Math.max(1, Math.round(src.width * scale));
      const h = Math.max(1, Math.round(src.height * scale));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      octx.fillStyle = (typeof canvasBg !== 'undefined' && canvasBg) ? canvasBg : '#111111';
      octx.fillRect(0, 0, w, h);
      octx.drawImage(src, 0, 0, w, h);
      const three = document.getElementById('cv-three');
      if (three && three.width) {
        try { octx.drawImage(three, 0, 0, w, h); } catch (e) {}
      }
      return off.toDataURL('image/png');
    } catch (e) {
      console.warn('[AI] captureCanvas失敗', e);
      return null;
    }
  }
};

window.AIClient = AIClient;
