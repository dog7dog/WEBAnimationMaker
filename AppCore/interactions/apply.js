// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: 生成コードのライブ適用
//   interactions → codegen-css / codegen-js → 実DOMへ注入する。
//   「Magic Paint内でだけ動く独自の再生処理」は作らず、
//   書き出すのと同じCSS/JSをそのまま実行するのが要点。
//
//   適用先は キャンバスタブのDOM/CSSミラー(#mlc-stage)。
//   タブを表示している間だけ有効にし、離れたら注入したCSSを外す
//   （デザイン面の編集や他タブの表示に影響を残さないため）。
//
//   注意: ミラーは syncDomMirror() で innerHTML ごと作り直すため、
//   要素に付けたリスナーは毎回失われる。作り直した直後に
//   reattachInteractionListeners() を呼んで貼り直している
//   （「作り直してから実行する」順序なのでリスナーの重複は起きない）。
// ══════════════════════════════════════════════════════════════

let _interactionPreviewActive = false;

function isInteractionPreviewActive() {
  return _interactionPreviewActive;
}

function generateInteractionCode(rules) {
  const list = rules || (typeof interactions !== 'undefined' ? interactions : []) || [];
  const declarativeJs = typeof generateInteractionJS === 'function' ? generateInteractionJS(list) : '';
  // 分岐・繰り返し・変数・関数を含むスタックは命令的なJSとして生成される
  const programJs = typeof generateBlocklyProgramJs === 'function' ? generateBlocklyProgramJs() : '';
  return {
    css: typeof generateInteractionCSS === 'function' ? generateInteractionCSS(list) : '',
    js: [declarativeJs, programJs].filter(s => s && s.trim()).join('\n\n')
  };
}

function _interactionStyleEl() {
  let el = document.getElementById('mlc-interactions-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'mlc-interactions-style';
    document.head.appendChild(el);
  }
  return el;
}

// 生成JSが document / window に付けたリスナーと、作ったIntersectionObserver、
// 動かし始めたタイマー。
// 要素に付けたリスナーはミラーの作り直しでノードごと消えるが、
// document や window に付けたもの(キー入力・スクロールなど)は消えずに
// 積み重なってしまうため、ここで控えておいて貼り直しの前に外す。
let _interactionDocListeners = [];
let _interactionObservers = [];
// window に付けたリスナー（スクロール検知）と setInterval（一定間隔のトリガー）。
// これらもノードの作り直しでは消えないので、同じように控えて外す。
let _interactionWinListeners = [];
let _interactionTimers = [];

function _teardownGeneratedJs() {
  _interactionDocListeners.forEach(([type, fn]) => document.removeEventListener(type, fn));
  _interactionDocListeners = [];
  _interactionObservers.forEach(io => { try { io.disconnect(); } catch (e) { /* noop */ } });
  _interactionObservers = [];
  _interactionWinListeners.forEach(([host, type, fn]) => host.removeEventListener(type, fn));
  _interactionWinListeners = [];
  _interactionTimers.forEach(id => clearInterval(id));
  _interactionTimers = [];
}

// プレビューでスクロールするのはページ全体ではなくステージの外枠なので、
// 生成コードの window.scrollY / window.addEventListener('scroll') は
// そちらへ向け直す。書き出したページではそのまま window に当たる。
function _interactionScrollHost() {
  return document.getElementById('mlc-stage-wrap') || window;
}

// 生成JSを実行する。
//   生成されるコード自体は「実サイトへそのまま貼れる自然な形」にしておきたいので
//   コードには手を入れず、実行時に document / window / IntersectionObserver /
//   setInterval だけ差し替えて、後片付けできるように登録を横取りする。
function _runGeneratedJs(js) {
  _teardownGeneratedJs();

  const documentShim = {
    addEventListener(type, fn, opts) {
      _interactionDocListeners.push([type, fn]);
      document.addEventListener(type, fn, opts);
    },
    querySelector: sel => document.querySelector(sel),
    querySelectorAll: sel => document.querySelectorAll(sel)
  };

  const ObserverShim = typeof IntersectionObserver !== 'undefined'
    ? function (cb, opts) {
        const io = new IntersectionObserver(cb, opts);
        _interactionObservers.push(io);
        return io;
      }
    : undefined;

  const windowShim = {
    addEventListener(type, fn, opts) {
      const host = type === 'scroll' ? _interactionScrollHost() : window;
      _interactionWinListeners.push([host, type, fn]);
      host.addEventListener(type, fn, opts);
    },
    get scrollY() {
      const host = _interactionScrollHost();
      return host === window ? window.scrollY : host.scrollTop;
    },
    get scrollX() {
      const host = _interactionScrollHost();
      return host === window ? window.scrollX : host.scrollLeft;
    },
    // 「1ページ＝画面1つ分」の高さも、プレビューではステージの外枠で測る
    get innerHeight() {
      const host = _interactionScrollHost();
      return host === window ? window.innerHeight : host.clientHeight;
    },
    get innerWidth() {
      const host = _interactionScrollHost();
      return host === window ? window.innerWidth : host.clientWidth;
    },
    // 「ページの先頭へ戻る」もステージの外枠に向ける
    scrollTo(...args) { _interactionScrollHost().scrollTo(...args); },
    // 「リンクを開く」はプレビューでも素直に新しいタブを開く
    open(...args) { return window.open(...args); }
  };

  const setIntervalShim = (fn, ms) => {
    const id = setInterval(fn, ms);
    _interactionTimers.push(id);
    return id;
  };

  new Function('document', 'IntersectionObserver', 'window', 'setInterval', js)(
    documentShim, ObserverShim, windowShim, setIntervalShim
  );
}

// ミラーを作り直した直後に呼ばれ、生成JSを実行してリスナーを貼り直す。
// 生成JS自体は「実サイトへコピーしても自然に読める形」を優先して
// 要素ごとの addEventListener にしてある。
function reattachInteractionListeners() {
  if (!_interactionPreviewActive) { _teardownGeneratedJs(); return; }
  const { js } = generateInteractionCode();
  if (!js.trim()) { _teardownGeneratedJs(); return; }
  try {
    _runGeneratedJs(js);
  } catch (e) {
    console.error('[interactions] 生成JSの実行に失敗しました', e);
    if (typeof setStatus === 'function') setStatus('インタラクション: JS実行エラー');
  }
}

function applyInteractions() {
  const { css, js } = generateInteractionCode();
  _interactionStyleEl().textContent = _interactionPreviewActive ? css : '';

  // ミラーを作り直す → 古いリスナーはノードごと破棄され、
  // syncDomMirror() の末尾から新しいノードへ貼り直される。
  if (_interactionPreviewActive && typeof syncDomMirror === 'function') syncDomMirror();

  return { css, js };
}

function setInteractionPreviewActive(on) {
  _interactionPreviewActive = !!on;

  if (!_interactionPreviewActive) {
    _interactionStyleEl().textContent = '';
    // 状態クラスはミラーの作り直しで消える
    if (typeof syncDomMirror === 'function') syncDomMirror();
    return { css: '', js: '' };
  }

  return applyInteractions();
}
