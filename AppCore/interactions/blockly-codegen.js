// ══════════════════════════════════════════════════════════════
// Blockly → 命令的JSの生成
//   分岐・繰り返し・変数・関数が入ったスタックは、CSSルールだけでは
//   表現できない（「いつ・何回・どの条件で」を書く必要がある）。
//   そこでBlockly標準のJavaScript生成器を使って手続きコードを出す。
//
//   ただし「どう動くか」は引き続きCSS側に置く:
//     アクションブロックは対応するCSSクラスを付けるだけのコードになり、
//     transition/@keyframes による実際のアニメーションはCSSが担当する。
//   これは実際のWeb制作と同じ分担で、書き出したコードもそのまま読める。
//
//   アクションだけの単純なスタックは従来どおり宣言的な経路
//   (codegen-css.js / codegen-js.js)のままで、こちらは通らない。
// ══════════════════════════════════════════════════════════════

// 生成コードが使う小さなヘルパー。命令的なコードを出すときだけ添える。
const MLC_JS_RUNTIME = [
  '// ランタイム（クラスの付け外しとページ操作の小さな補助）',
  'function mlcQ(sel) { return document.querySelector(sel); }',
  'function mlcSet(sel, cls, on) {',
  '  var el = mlcQ(sel);',
  '  if (el) el.classList.toggle(cls, on !== false);',
  '}',
  'function mlcReset(sel) {',
  '  var el = mlcQ(sel);',
  '  if (!el) return;',
  '  Array.prototype.slice.call(el.classList).forEach(function (c) {',
  '    if (c.indexOf("mlc-active-") === 0) el.classList.remove(c);',
  '  });',
  '}',
  'function mlcWait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }',
  'function mlcScrollTo(sel) {',
  '  var el = mlcQ(sel);',
  '  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });',
  '}',
  'function mlcScrollTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }',
  'function mlcOpen(url) { if (url) window.open(url, "_blank", "noopener"); }'
].join('\n');

function _mlcJsGen() {
  return (typeof Blockly !== 'undefined' && Blockly.JavaScript) ? Blockly.JavaScript : null;
}

// 自前ブロックのJS生成を登録する
function registerMlcJsGenerators() {
  const gen = _mlcJsGen();
  if (!gen) return;
  const put = (type, fn) => {
    if (gen.forBlock) gen.forBlock[type] = fn;
    else gen[type] = fn;
  };

  // アクション: 対応するCSSクラスを付ける（見た目の変化はCSSが担当）
  Object.keys(MLC_ACTION_BLOCKS).forEach(type => {
    put(type, function (block) {
      const targetId = block.getFieldValue('TARGET_EL');
      if (!targetId) return '';
      const sel = interactionTargetSelector(targetId);
      const cls = 'mlc-active-' + mlcRuleIdForBlock(block);
      return 'mlcSet(' + JSON.stringify(sel) + ', ' + JSON.stringify(cls) + ', true);\n';
    });
  });

  put('mlc_wait', function (block) {
    const sec = Number(block.getFieldValue('SEC')) || 0;
    return 'await mlcWait(' + Math.round(sec * 1000) + ');\n';
  });

  put('mlc_reset', function (block) {
    const targetId = block.getFieldValue('TARGET_EL');
    if (!targetId) return '';
    return 'mlcReset(' + JSON.stringify(interactionTargetSelector(targetId)) + ');\n';
  });

  put('mlc_scroll_to', function (block) {
    const targetId = block.getFieldValue('TARGET_EL');
    if (!targetId) return '';
    return 'mlcScrollTo(' + JSON.stringify(interactionTargetSelector(targetId)) + ');\n';
  });

  put('mlc_scroll_top', function () {
    return 'mlcScrollTop();\n';
  });

  put('mlc_open_url', function (block) {
    return 'mlcOpen(' + JSON.stringify(block.getFieldValue('URL') || '') + ');\n';
  });

  // トリガー(帽子)ブロック本体はここでは何も出さない。
  // 下に繋がった処理をイベントリスナーで包む形は
  // generateBlocklyProgramJs() 側が組み立てる。
  Object.keys(MLC_TRIGGER_BLOCKS).forEach(type => put(type, () => ''));

  _mlcPatchProcedureCalls(gen, put);
}

// 「◯秒待つ」が await を使うため、ユーザー定義関数の呼び出しも await する。
// 定義側を async にするのは生成後のコード整形(_mlcPolish)で行う
// （Blocklyのバンドルは圧縮済みで、定義の格納経路には手を入れにくいため）。
let _mlcCallPatched = false;
function _mlcPatchProcedureCalls(gen, put) {
  if (_mlcCallPatched) return;
  ['procedures_callnoreturn', 'procedures_callreturn'].forEach(type => {
    const orig = gen.forBlock ? gen.forBlock[type] : gen[type];
    if (!orig) return;
    put(type, function (block, generator) {
      const out = orig.call(this, block, generator || gen);
      if (Array.isArray(out)) return ['await ' + out[0], out[1]];
      return String(out).replace(/^(\s*)/, '$1await ');
    });
  });
  _mlcCallPatched = true;
}

// ワークスペース上の関数名 → 生成コード中の名前 の対応表。
// Blocklyは日本語などを _E5_85_89… のように潰すが、JSの識別子は日本語も使えるので
// 書き出したコードが読めるように戻す。
function _mlcProcedureNameMap(ws) {
  const map = new Map();
  if (typeof Blockly === 'undefined' || !Blockly.Procedures || !Blockly.JavaScript) return map;
  const gen = Blockly.JavaScript;
  const used = new Set();

  const all = Blockly.Procedures.allProcedures(ws);
  [].concat(all[0] || [], all[1] || []).forEach(tuple => {
    const display = tuple && tuple[0];
    if (!display) return;
    let generated;
    try {
      generated = gen.getProcedureName ? gen.getProcedureName(display)
        : (gen.nameDB_ ? gen.nameDB_.getName(display, 'PROCEDURE') : null);
    } catch (e) { return; }
    if (!generated || generated === display) return;

    let readable = String(display).replace(/[^\p{L}\p{N}_$]/gu, '_');
    if (/^\p{N}/u.test(readable)) readable = '_' + readable;
    if (!readable || used.has(readable)) return;
    used.add(readable);
    map.set(generated, readable);
  });
  return map;
}

// 生成コードの仕上げ
function _mlcPolish(code, ws) {
  let out = String(code || '');
  // ユーザー定義関数は await を含みうるので async にする
  out = out.replace(/(^|\n)([ \t]*)function ([A-Za-z_$][\w$]*)\s*\(/g, '$1$2async function $3(');
  // 呼び出し側のパッチと重なった場合の保険
  out = out.replace(/await\s+await\s+/g, 'await ');
  // 潰れた関数名を読める名前に戻す
  _mlcProcedureNameMap(ws).forEach((readable, generated) => {
    out = out.replace(new RegExp('\\b' + generated + '\\b', 'g'), readable);
  });
  return out;
}

function _mlcIndent(code, pad) {
  return String(code || '')
    .split('\n')
    .map(line => (line.trim() ? pad + line : line))
    .join('\n');
}

// 図形に直接付けられるトリガーと、対応するDOMイベント
const MLC_TRIGGER_DOM_EVENT = {
  click: 'click', dblclick: 'dblclick', hover: 'mouseenter', press: 'mousedown'
};

// トリガーの種類ごとに、処理をどう起動するかを組み立てる
function _mlcWrapTrigger(spec, top, body) {
  const inner = _mlcIndent(body, '    ');

  if (spec.noElement && spec.trigger === 'load') {
    return 'document.addEventListener("DOMContentLoaded", async function () {\n'
      + _mlcIndent(body, '  ') + '});\n';
  }

  if (spec.noElement && spec.trigger === 'key') {
    const key = (spec.toTriggerParams ? spec.toTriggerParams(top).key : 'Enter') || 'Enter';
    return 'document.addEventListener("keydown", async function (e) {\n'
      + '  if (e.key !== ' + JSON.stringify(key) + ') return;\n'
      + _mlcIndent(body, '  ') + '});\n';
  }

  const params = spec.toTriggerParams ? spec.toTriggerParams(top) : {};

  if (spec.noElement && spec.trigger === 'scroll') {
    // 通り過ぎるたびに何度も走らないよう、一度発火したら
    // 指定位置より上へ戻るまで止めておく。
    const px = Number(params.px ?? 200);
    return '(function () {\n'
      + '  var fired = false;\n'
      + '  function check() {\n'
      + '    if (window.scrollY < ' + px + ') { fired = false; return; }\n'
      + '    if (fired) return;\n'
      + '    fired = true;\n'
      + '    (async function () {\n'
      + _mlcIndent(body, '      ')
      + '    })();\n'
      + '  }\n'
      + '  window.addEventListener("scroll", check, { passive: true });\n'
      + '  check();\n'
      + '})();\n';
  }

  if (spec.noElement && spec.trigger === 'timer') {
    const sec = Math.max(0.05, Number(params.sec ?? 2));
    return 'setInterval(async function () {\n'
      + _mlcIndent(body, '  ') + '}, ' + Math.round(sec * 1000) + ');\n';
  }

  const sel = interactionTargetSelector(top.getFieldValue('TRIGGER_EL'));
  const selJson = JSON.stringify(sel);

  if (spec.trigger === 'inview') {
    return '(function () {\n'
      + '  var el = mlcQ(' + selJson + ');\n'
      + '  if (!el || typeof IntersectionObserver === "undefined") return;\n'
      + '  var io = new IntersectionObserver(async function (entries) {\n'
      + '    if (!entries.some(function (en) { return en.isIntersecting; })) return;\n'
      + _mlcIndent(body, '    ')
      + '  }, { threshold: 0.3 });\n'
      + '  io.observe(el);\n'
      + '})();\n';
  }

  const domEvent = MLC_TRIGGER_DOM_EVENT[spec.trigger] || 'click';
  return 'document.querySelectorAll(' + selJson + ').forEach(function (el) {\n'
    + '  el.addEventListener(' + JSON.stringify(domEvent) + ', async function () {\n'
    + inner
    + '  });\n'
    + '});\n';
}

// ワークスペース全体から命令的JSを組み立てる。
// 制御構造を含まないスタックは宣言的な経路が担当するので、ここでは飛ばす。
function generateBlocklyProgramJs(ws) {
  const gen = _mlcJsGen();
  const workspace = ws || (typeof mlcBlocklyWorkspace !== 'undefined' ? mlcBlocklyWorkspace : null);
  if (!gen || !workspace) return '';

  registerMlcJsGenerators();
  gen.init(workspace);

  let out = '';
  let hasImperative = false;

  workspace.getTopBlocks(true).forEach(top => {
    const spec = MLC_TRIGGER_BLOCKS[top.type];

    if (!spec) {
      // 関数定義などトリガー以外の最上位ブロック。
      // 生成器を通すことで関数定義が gen の定義一覧に登録される。
      out += gen.blockToCode(top) || '';
      return;
    }

    if (!mlcStackIsImperative(top)) return; // 宣言的な経路が担当する

    const first = top.getNextBlock();
    const body = first ? gen.blockToCode(first) : '';
    if (!String(body).trim()) return;

    hasImperative = true;
    out += _mlcWrapTrigger(spec, top, body) + '\n';
  });

  // 変数宣言と関数定義を先頭に付けてから、仕上げ（async化・名前の復元）をする
  const code = _mlcPolish(gen.finish(out), workspace).trim();
  if (!code) return '';

  return (hasImperative ? MLC_JS_RUNTIME + '\n\n' : '') + code + '\n';
}
