// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: JS生成エンジン
//   InteractionRule[] → 最小限のJSテキスト。
//   CSSだけでは実現できない「検知」の部分だけを担当する
//   （クリック検知、画面内進入検知、キー入力検知、状態クラスの付け外し）。
//   hover(:hover)やload(@keyframes)は純CSSで完結するため、
//   ここでは何も出力しない（codegen-css.js が担当）。
// ══════════════════════════════════════════════════════════════

function _interactionCssIdent2(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^([^a-zA-Z_-])/, '_$1');
}

// 対象id → CSSセレクタ。'grp:<groupId>' はグループ全体を指す
function _interactionSelector2(targetId) {
  const raw = String(targetId || '');
  return raw.startsWith('grp:')
    ? '.grp-' + _interactionCssIdent2(raw.slice(4))
    : '.el-' + _interactionCssIdent2(raw);
}

function generateInteractionJS(rules) {
  const lines = [];

  (rules || []).forEach(rule => {
    // 制御構造の中から呼ばれるアクションは、実行の順番や条件をJS側
    // (blockly-codegen.js)が決めるので、ここではリスナーを作らない
    if (rule.jsDriven) return;
    if (rule.toggleMode !== 'toggle') return; // hover/load はJS不要

    const activeCls = typeof interactionActiveClass === 'function'
      ? interactionActiveClass(rule)
      : 'mlc-active-' + _interactionCssIdent2(rule.id);
    const triggerSel = _interactionSelector2(rule.triggerElementId);
    const targetSel = _interactionSelector2(rule.targetId || rule.triggerElementId);

    if (rule.trigger?.type === 'click') {
      lines.push(
        'document.querySelectorAll(' + JSON.stringify(triggerSel) + ').forEach(function (el) {\n' +
        '  el.addEventListener("click", function () {\n' +
        '    var t = document.querySelector(' + JSON.stringify(targetSel) + ');\n' +
        '    if (t) t.classList.toggle(' + JSON.stringify(activeCls) + ');\n' +
        '  });\n' +
        '});'
      );
      return;
    }

    if (rule.trigger?.type === 'key') {
      const key = rule.trigger?.params?.key || 'Enter';
      lines.push(
        'document.addEventListener("keydown", function (e) {\n' +
        '  if (e.key !== ' + JSON.stringify(key) + ') return;\n' +
        '  var t = document.querySelector(' + JSON.stringify(targetSel) + ');\n' +
        '  if (t) t.classList.toggle(' + JSON.stringify(activeCls) + ');\n' +
        '});'
      );
      return;
    }

    if (rule.trigger?.type === 'inview') {
      const threshold = Number(rule.trigger?.params?.threshold ?? 0.3);
      lines.push(
        '(function () {\n' +
        '  var el = document.querySelector(' + JSON.stringify(triggerSel) + ');\n' +
        '  var t = document.querySelector(' + JSON.stringify(targetSel) + ');\n' +
        '  if (!el || !t || typeof IntersectionObserver === "undefined") return;\n' +
        '  var io = new IntersectionObserver(function (entries) {\n' +
        '    entries.forEach(function (entry) {\n' +
        '      if (entry.isIntersecting) t.classList.add(' + JSON.stringify(activeCls) + ');\n' +
        '    });\n' +
        '  }, { threshold: ' + threshold + ' });\n' +
        '  io.observe(el);\n' +
        '})();'
      );
      return;
    }
  });

  return lines.join('\n\n');
}
