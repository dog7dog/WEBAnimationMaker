// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: CSS生成エンジン
//   InteractionRule[] (state.js の `interactions`) → CSSテキスト。
//   DOM/グローバル状態に依存しない純粋関数のみを置く
//
//   CSS-first判定（詳細はプラン参照）:
//     load + once  → @keyframes + animation forwards（JS不要）
//     hover + hold → :hover + transition（JS不要）
//     click/inview/key + toggle → 状態クラス + transition
//       （クラスの付け外し自体はJS側 codegen-js.js が担当）
//
//   対応アクション: scale / rotate / move / slide / fade / show / hide。
//   出現演出のように開始状態が要るものは params.from に持たせる。
//   複数ステップ（steps[1]以降）の連続再生は未対応。
//
//   ── 同じ図形に複数のアクションがかかるときの合成 ──
//   アクションはブロック1個につき1ルールになるので、1つの図形に
//   「拡大」と「回転」が同時にかかることがある。どちらも transform に
//   書いてしまうと、詳細度が同じルール同士で後に書いた方だけが勝ち、
//   先のアクションが消える。
//   そこでアクションの種類ごとに別々のCSS変数へ書き込み、図形側の
//   transform で1つに合成する。変数は @property で型を登録してあるので、
//   種類ごとに違う秒数で transition させられる。
// ══════════════════════════════════════════════════════════════

// 図形idからCSSクラス名として安全な文字列を作る。
// editor.js の safeCssIdent と同じ規則（この2箇所は将来 geometry.js 的な
// 共通ファイルへ統合してよいが、Slice 1時点では小さく複製にとどめる）。
function _interactionCssIdent(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^([^a-zA-Z_-])/, '_$1');
}

// transformを組み立てるCSS変数 [変数名, 型, 初期値]
const INTERACTION_TRANSFORM_VARS = [
  ['--mlc-tx', '<length>', '0px'],
  ['--mlc-ty', '<length>', '0px'],
  ['--mlc-rot', '<angle>', '0deg'],
  ['--mlc-scale', '<number>', '1']
];

const INTERACTION_TRANSFORM_VALUE =
  'translate(var(--mlc-tx), var(--mlc-ty)) rotate(var(--mlc-rot)) scale(var(--mlc-scale))';

function _interactionIsTransformVar(prop) {
  return INTERACTION_TRANSFORM_VARS.some(v => v[0] === prop);
}

// CSS変数を transition/keyframes で補間できるようにする型登録。
// 未対応のブラウザではこの@ruleごと無視され、変化が瞬間的になるだけ。
function _interactionPropertyAtRules() {
  return INTERACTION_TRANSFORM_VARS
    .map(([name, syntax, initial]) => '@property ' + name
      + ' { syntax: "' + syntax + '"; inherits: false; initial-value: ' + initial + '; }')
    .join('\n');
}

// useFrom=true のときは params.from を重ねて読む。
//   例: fade  → { to: 1, from: { to: 0 } }
//       slide → { dx: 0, dy: 0, from: { dx: 0, dy: 40 } }
// 出現演出のように開始状態と終了状態の両方が要るケースで使う。
// 戻り値は { CSSプロパティ名: 値 }（宣言の順番は挿入順）。
function _interactionActionsToProps(actions, useFrom) {
  const props = {};

  (actions || []).forEach(action => {
    const a = useFrom && action && action.params && action.params.from
      ? { type: action.type, params: { ...action.params, ...action.params.from } }
      : action;
    switch (a.type) {
      case 'scale':
        props['--mlc-scale'] = String(Number(a.params?.to ?? 1));
        break;
      case 'rotate':
        props['--mlc-rot'] = Number(a.params?.deg ?? 0) + 'deg';
        break;
      case 'move':
      case 'slide':
        props['--mlc-tx'] = Number(a.params?.dx ?? 0) + 'px';
        props['--mlc-ty'] = Number(a.params?.dy ?? 0) + 'px';
        break;
      case 'fade':
        props.opacity = String(Number(a.params?.to ?? 1));
        break;
      case 'show':
        props.opacity = '1';
        // 非表示中はクリックを拾わないようにしているので、表示時は戻す
        props['pointer-events'] = 'auto';
        break;
      case 'hide':
        props.opacity = '0';
        // 透明なだけだとクリックを拾ってしまうので無効化する
        props['pointer-events'] = 'none';
        break;
      default:
        break;
    }
  });

  return props;
}

function _interactionPropsToText(props, sep) {
  return Object.entries(props || {})
    .map(([k, v]) => k + ': ' + v + ';')
    .join(sep || ' ');
}

// このルールが開始状態(from)を持っているか
function _interactionHasFrom(step) {
  return (step?.actions || []).some(a => a && a.params && a.params.from);
}

// 対象id → CSSセレクタ。'grp:<groupId>' はグループ全体を指す
// （グループはミラー上で1つの要素として組み立てられている）。
function _interactionSelector(targetId) {
  const raw = String(targetId || '');
  return raw.startsWith('grp:')
    ? '.grp-' + _interactionCssIdent(raw.slice(4))
    : '.el-' + _interactionCssIdent(raw);
}

// 状態クラス名（クリック/inview/キー等の toggle 系で使う）
function interactionActiveClass(rule) {
  return 'mlc-active-' + _interactionCssIdent(rule.id);
}

// @keyframes 名（load 等の once 系で使う）
function interactionKeyframesName(rule) {
  return 'mlc-kf-' + _interactionCssIdent(rule.id);
}

// 図形1つ分の集計。ベースルールは図形ごとに1つだけ出す
// （ルールごとに出すと transition の秒数が後勝ちで壊れるため）。
function _interactionTargetEntry(map, sel) {
  if (!map.has(sel)) {
    map.set(sel, { sel, base: {}, transitions: [], transitioned: new Set(), animations: [], usesTransform: false });
  }
  return map.get(sel);
}

function _interactionAddTransition(entry, prop, timing) {
  // 同じプロパティを2つのルールが別の秒数で動かすことはできないので、
  // 先に登録された方を優先する
  if (entry.transitioned.has(prop)) return;
  entry.transitioned.add(prop);
  entry.transitions.push(prop + ' ' + timing);
}

function generateInteractionCSS(rules) {
  const targets = new Map();
  const keyframeBlocks = [];
  const stateBlocks = [];

  (rules || []).forEach(rule => {
    const step = rule.steps && rule.steps[0];
    if (!step) return;

    const props = _interactionActionsToProps(step.actions);
    if (!Object.keys(props).length) return;

    const sel = _interactionSelector(rule.targetId || rule.triggerElementId);
    const entry = _interactionTargetEntry(targets, sel);
    if (Object.keys(props).some(_interactionIsTransformVar)) entry.usesTransform = true;

    const timing = (Number(step.duration) || 0.3) + 's '
      + (step.easing || 'ease') + ' '
      + (Number(step.delay) || 0) + 's';

    if (rule.toggleMode === 'once') {
      // load等: 初回発火で再生し完了状態を維持する。
      // @keyframes + animation forwards（JS不要、loadは常時発火扱い）。
      const kfName = interactionKeyframesName(rule);
      const fromProps = _interactionHasFrom(step)
        ? _interactionActionsToProps(step.actions, true)
        : null;
      keyframeBlocks.push(fromProps
        ? '@keyframes ' + kfName + ' { from { ' + _interactionPropsToText(fromProps)
          + ' } to { ' + _interactionPropsToText(props) + ' } }'
        : '@keyframes ' + kfName + ' { to { ' + _interactionPropsToText(props) + ' } }');
      entry.animations.push(kfName + ' ' + timing + ' forwards');
      return;
    }

    // 出現演出(フェードイン/スライドイン)は開始状態を図形そのものに置く。
    // ここを出さないと「最初から見えている」ままになり、何も起きない。
    if (_interactionHasFrom(step)) {
      Object.assign(entry.base, _interactionActionsToProps(step.actions, true));
    }

    Object.keys(props).forEach(prop => {
      if (prop === 'pointer-events') return; // 補間しない
      _interactionAddTransition(entry, prop, timing);
    });

    if (rule.trigger?.type === 'hover' && rule.toggleMode === 'hold') {
      // 純CSSの :hover。JS不要、離すと自動で戻る。
      stateBlocks.push(sel + ':hover { ' + _interactionPropsToText(props) + ' }');
      return;
    }

    if (rule.toggleMode === 'toggle') {
      // click/inview/key 共通: 状態クラスの有無で transition が効く。
      // クラスの付け外し自体は codegen-js.js が担当。
      stateBlocks.push(sel + '.' + interactionActiveClass(rule)
        + ' { ' + _interactionPropsToText(props) + ' }');
    }
  });

  if (!targets.size) return '';

  const baseBlocks = [];
  let anyTransform = false;

  targets.forEach(entry => {
    // 変数の初期値 → 開始状態(from)で上書き、の順に畳んでから宣言にする
    const values = {};
    if (entry.usesTransform) {
      INTERACTION_TRANSFORM_VARS.forEach(([name, , initial]) => { values[name] = initial; });
    }
    Object.assign(values, entry.base);

    const decls = Object.entries(values).map(([k, v]) => k + ': ' + v + ';');
    if (entry.usesTransform) {
      anyTransform = true;
      decls.push('transform: ' + INTERACTION_TRANSFORM_VALUE + ';');
    }
    if (entry.transitions.length) decls.push('transition: ' + entry.transitions.join(', ') + ';');
    if (entry.animations.length) decls.push('animation: ' + entry.animations.join(', ') + ';');
    // SVGの<g>要素はデフォルトでtransform-originがSVGビューポート原点基準になり、
    // 自分自身の見た目の中心を基準にscale/rotateしない（HTML要素とは異なる挙動）。
    // fill-box指定で自分の描画領域を基準にする。HTML要素側では
    // fill-boxは無視されborder-box相当になるだけなので害はない。
    decls.push('transform-box: fill-box;');
    decls.push('transform-origin: center;');

    baseBlocks.push(entry.sel + ' {\n  ' + decls.join('\n  ') + '\n}');
  });

  const out = [];
  if (anyTransform) out.push(_interactionPropertyAtRules());
  if (keyframeBlocks.length) out.push(keyframeBlocks.join('\n'));
  out.push(baseBlocks.join('\n'));
  if (stateBlocks.length) out.push(stateBlocks.join('\n'));
  return out.join('\n\n');
}
