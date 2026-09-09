// ══════════════════════════════════════════════════════════════
// 外部ライブラリ管理: window.AnimationApp.libraries
//   mod.json / manifest.json（宣言）または MOD の main.js（手続き）から
//   登録され、ここが唯一の「外部ライブラリを読み込む経路」になる。
//   テキストエディタ/AI生成コードは get()/has()/list() だけを使う想定。
//   未登録のライブラリをエディタ側が勝手にCDNから取りに行くことはしない。
// ══════════════════════════════════════════════════════════════
const _libRegistry = {}; // id -> { id, name, description, globalName, source, load, _promise }

// opts.load が渡されていればそれをそのまま使う（cannon.jsのUMD読み込みのような
// カスタム処理向け）。無ければ opts.type/url から汎用ローダーを組み立てる。
function _makeLibLoader(id, opts) {
  if (typeof opts.load === 'function') return opts.load;

  const { type, url, globalName } = opts;
  if (!url) {
    return () => Promise.reject(new Error('load関数もurlも指定されていません: ' + id));
  }

  // ES Module は import() で動的ロード（通常のスクリプト環境からでも使える）
  if (type === 'module') {
    return () => import(/* webpackIgnore: true */ url);
  }

  // 既定: 従来型 <script> タグ読み込み（UMDグローバルビルド向け）
  return () => new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mp-lib="' + id + '"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.dataset.mpLib = id;
    s.onload = () => resolve(globalName ? window[globalName] : true);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// 登録のみ行う（読み込みはしない）。mod.json宣言・MOD初期化時の
// 「使えるようにしておく」用途はこちらを使う。
function _registerLib(id, opts = {}, source = 'mod') {
  if (!id) return;
  _libRegistry[id] = {
    id,
    name: opts.name || id,
    description: opts.description || '',
    globalName: opts.globalName || null,
    source, // 'mod.json' | 'mod'（デバッグ・将来のUI表示用）
    load: _makeLibLoader(id, opts),
    _promise: null
  };
}

// ══════════════════════════════════════════════════════════════
// MOD API: window.AnimationApp
// ══════════════════════════════════════════════════════════════
window.AnimationApp = {
  version: '0.1-mod-prototype',

  customRenderers: {},
  customBrushes: {},

  customUIPanels: {
    top: null,
    right: null,
    bottom: null,
    left: null
  },

  libraries: {
    // MOD側の入口: 宣言 + 即読み込み。
    // 例: const CANNON = await api.libraries.load({ name:'cannon', type:'module', url:'...' });
    load(opts) {
      if (!opts || !(opts.id || opts.name)) {
        return Promise.reject(new Error('id または name は必須です'));
      }
      const id = opts.id || opts.name;
      if (!_libRegistry[id]) _registerLib(id, opts, 'mod');
      return this.get(id);
    },

    // MOD側の入口その2: 「使えるようにだけしておく」宣言のみの登録（即読み込みしない）。
    // mod.json / manifest.json の libraries 宣言も内部的にこれを使う。
    // 既に同じidが登録済みでも黙って無視せず、新しい宣言内容で上書きする
    // （MODを更新して再インストールした時、旧globalName等が残り続けるのを防ぐため）。
    declare(id, opts = {}) {
      if (!id) return;
      const existing = _libRegistry[id];
      if (!existing) {
        _registerLib(id, opts, opts.source || 'mod');
        return;
      }
      existing.name = opts.name || existing.name || id;
      existing.description = opts.description || existing.description || '';
      existing.globalName = opts.globalName || existing.globalName || null;
      existing.source = opts.source || existing.source || 'mod';
      // URL/typeなどが変わっている可能性があるのでローダーも作り直す
      existing.load = _makeLibLoader(id, { ...opts, globalName: existing.globalName });
      // 次回get()で新しい定義から読み込み直す
      existing._promise = null;
    },

    // 登録済みライブラリを取得する（未読み込みなら初回だけ読み込み、以降はキャッシュを返す）。
    // テキストエディタ/AI生成コードはこれだけを使う想定。
    get(id) {
      const entry = _libRegistry[id];
      if (!entry) return Promise.reject(new Error('未登録のライブラリです: ' + id));
      if (!entry._promise) entry._promise = Promise.resolve(entry.load());
      return entry._promise;
    },

    has(id) {
      return Boolean(_libRegistry[id]);
    },

    list() {
      return Object.values(_libRegistry).map(({ id, name, description, source, globalName }) => ({ id, name, description, source, globalName }));
    }
  },

  registerMod(mod) {
    if (!mod || !mod.id) return;
    // ZIPインストール型MODの main.js もこの同じ registerMod() を呼ぶため、
    // ZIP実行中(loader.js が __mpZipModExecuting を立てている間)は
    // LoadedMods(サーバーフォルダ型MOD一覧)に混ぜない。
    // 混ざるとMOD一覧でZIP MODが「サーバー型」と誤認識され、
    // ON/OFFトグル(存在しないエンドポイントを叩いて失敗する)だけが表示され、
    // 本来出るべきアンインストールボタンが出せなくなる。
    if (!window.__mpZipModExecuting && !LoadedMods.some(m => m.id === mod.id)) {
      LoadedMods.push(mod);
    }
    console.log('[MOD loaded]', mod.id, mod.name || '');
    setStatus(`MOD読み込み: ${mod.name || mod.id}`);
  },

  registerTool(tool) {
    if (!tool || !tool.id || !tool.name) return;

    const panel = document.getElementById('right-panel');
    if (!panel) return;

    const btn = document.createElement('button');
    btn.className = 'rp-btn';
    btn.dataset.modTool = tool.id;
    btn.title = tool.name;
    btn.innerHTML = tool.icon || '★';

    btn.addEventListener('click', () => {
      document.querySelectorAll('.rp-btn[data-mod-tool]').forEach(b => {
        b.classList.remove('active');
      });

      btn.classList.add('active');

      window.AnimationApp.activeModTool = tool;
      setTool('select');
      setStatus(`MODツール: ${tool.name}`);
    });

    panel.appendChild(btn);
  },

  addShape(shape) {
    if (!shape) return;

    saveState();

    shapes.push({
      color,
      sw,
      opa,
      dash,
      fill: doFill,
      keyframes: [],
      hidden: false,
      name: shape.name || 'MOD図形',
      modId: shape.modId || shape.type || null,
      layerId: getDrawableActiveLayerId(),
      ...shape
    });

    selected = shapes[shapes.length - 1];
    syncAll();
  },

  getSelected() {
    return selected;
  },

  setSelectedPatch(patch) {
    if (!selected || !patch) return;
    Object.assign(selected, patch);
    syncAll();
  },

  registerShapeType(type, renderer) {
    this.customRenderers[type] = renderer;
  },

  registerBrush(brush) {
    this.customBrushes[brush.id] = brush;

    const panel =
      document.getElementById("right-panel") ||
      document.querySelector(".right-panel") ||
      document.querySelector("#tools-panel") ||
      document.querySelector(".tools-panel") ||
      document.querySelector("aside");

    if (!panel) {
      console.warn("MODブラシボタンの追加先が見つかりません");
      return;
    }

    const btn = document.createElement("button");
    btn.className = "rp-btn";
    btn.dataset.modBrush = brush.id;
    btn.title = brush.name;
    btn.innerHTML = brush.icon || "🖌";

    btn.addEventListener("click", () => {
      document.querySelectorAll(".rp-btn[data-mod-tool], .rp-btn[data-mod-brush]").forEach(b => {
        b.classList.remove("active");
      });

      btn.classList.add("active");

      this.activeModBrush = brush;
      this.activeModTool = null;

      setTool("mod-brush");
      setStatus(`MODブラシ: ${brush.name}`);
    });

    panel.appendChild(btn);
  },

  registerUI(ui) {
    if (!ui || !ui.id || !ui.position) return;

    const allowed = ['top', 'right', 'bottom', 'left', 'editor-top'];
    if (!allowed.includes(ui.position)) {
      console.warn('Invalid UI position:', ui.position);
      return;
    }

    const target = this.getUIArea(ui.position);
    if (!target) {
      console.warn('UI追加先が見つかりません:', ui.position);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'mod-ui-block';
    wrap.dataset.modUi = ui.id;

    if (ui.title) {
      const title = document.createElement('div');
      title.className = 'mod-ui-title';
      title.textContent = ui.title;
      wrap.appendChild(title);
    }

    if (ui.html) {
      const body = document.createElement('div');
      body.className = 'mod-ui-body';
      body.innerHTML = ui.html;
      wrap.appendChild(body);
    }

    if (typeof ui.render === 'function') {
      ui.render(wrap, this);
    }

    target.appendChild(wrap);

    if (typeof ui.onMount === 'function') {
      ui.onMount(wrap, this);
    }

    return wrap;
  },

  registerFileMenuItem(item) {
    if (!item || !item.id || !item.label) return;
    const menu = document.getElementById('file-menu');
    if (!menu) return;
    if (menu.querySelector(`[data-file-menu-item="${item.id}"]`)) return;

    if (menu.dataset.modSepAdded !== '1') {
      const sep = document.createElement('div');
      sep.className = 'fm-sep';
      menu.appendChild(sep);
      menu.dataset.modSepAdded = '1';
    }

    const el = document.createElement('div');
    el.className = 'fm-item';
    el.dataset.fileMenuItem = item.id;

    if (item.icon) {
      const icon = document.createElement('i');
      icon.className = 'ti ' + item.icon;
      el.appendChild(icon);
    }

    const label = document.createElement('span');
    label.textContent = item.label;
    el.appendChild(label);

    el.addEventListener('click', () => {
      closeFileMenu();
      try { item.onClick?.(this); } catch (e) { console.error(e); }
    });

    menu.appendChild(el);
    return el;
  },

  getUIArea(position) {
    switch (position) {
      case 'top':
        return document.getElementById('topbar');

      case 'editor-top':
        return document.getElementById('editor-mod-ui-area');

      case 'right':
        return document.getElementById('right-panel');

      case 'bottom':
        return document.getElementById('timeline');

      case 'left':
        return document.getElementById('left-panel');

      default:
        return null;
    }
  },

  getSceneSnapshot() {
    const cleanShapes = JSON.parse(JSON.stringify(shapes, (key, value) => {
      if (key === 'snap' || key === '_orig') return undefined;
      if (typeof value === 'function') return undefined;
      return value;
    }));

    return {
      width: cv.width,
      height: cv.height,
      bg: canvasBg || '#111111',
      fps: (typeof FPS !== 'undefined' ? FPS : 24),
      shapes: cleanShapes
    };
  },

  // ── Three.js / エンジン統合 API ──────────────────────────────
  _threeRenderers: [],

  registerThreeRenderer(callbacks) {
    if (callbacks && typeof callbacks === 'object') this._threeRenderers.push(callbacks);
  },

  addObject(obj) {
    if (!obj || !obj.type) return null;
    const newObj = {
      id: obj.id || ('obj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
      engine: obj.engine || 'threejs',
      layerId: obj.layerId || getDrawableActiveLayerId(),
      keyframes: [],
      hidden: false,
      name: obj.name || obj.type,
      ...obj
    };
    saveState();
    shapes.push(newObj);
    syncLayers();
    return newObj;
  },

  removeObject(id) {
    const idx = shapes.findIndex(s => s.id === id);
    if (idx === -1) return;
    saveState();
    shapes.splice(idx, 1);
    if (selected && selected.id === id) { selected = null; multiSelected = []; }
    syncAll();
  },

  updateObject(id, patch) {
    const obj = shapes.find(s => s.id === id);
    if (!obj || !patch) return;
    Object.assign(obj, patch);
    syncLayers();
  },

  getObjectsByLayer(layerId) {
    return shapes.filter(s => (s.layerId || 'layer-1') === layerId);
  },

  getObjectsByEngine(engine) {
    return shapes.filter(s => s.engine === engine);
  },

  getLayers() { return layers; },

  createLayer(options = {}) {
    const layer = {
      id: options.id || `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: options.name || 'New Layer',
      type: options.type === 'folder' ? 'folder' : 'normal',
      parentId: options.parentId || null,
      color: options.color || null,
      visible: options.visible !== false,
      locked: options.locked === true,
      opacity: options.opacity ?? 1,
      blendMode: options.blendMode || 'source-over',
      collapsed: false
    };
    saveState();
    layers.push(layer);
    activeLayerId = layer.id;
    syncAll();
    return layer;
  },

  isLayerVisible(layerId) {
    const layer = layers.find(l => l.id === layerId);
    return layer ? layerIsVisible(layer) : true;
  },

  isLayerLocked(layerId) {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return false;
    if (layer.locked) return true;
    if (layer.parentId) {
      const parent = layers.find(l => l.id === layer.parentId);
      if (parent && parent.locked) return true;
    }
    return false;
  },

  // ZIP MODアセットの Blob URL を取得する
  // modId: manifest.json の id, path: 'assets/icon.png' などの相対パス
  // ※ MOD実行コード内では __assets['path'] で直接アクセスするほうが簡単
  getAsset(modId, path) {
    return _zipBlobUrls?.[modId]?.[path] ?? null;
  },

  redraw,
  toast,
  setStatus,
  getBounds,
  getCenter
};
