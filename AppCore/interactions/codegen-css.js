// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: CSS生成エンジン
//   InteractionRule[] (state.js の `interactions`) → CSSテキスト。
//   DOM/グローバル状態に依存しない純粋関数のみを置く
//
//   CSS-first判定（詳細はプラン参照）:
//     load + once        → @keyframes + animation forwards（JS不要）
//     hover/press + hold → :hover / :active + transition（JS不要）
//     click等 + toggle   → 状態クラス + transition
//       （クラスの付け外し自体はJS側 codegen-js.js が担当）
//
//   対応アクション:
//     変形   scale / rotate / move / slide / skew / flip
//     見た目 blur / brightness / grayscale / saturate / hue / glow
//     濃さ   fade / show / hide
//     反復   pulse / spin / float / shake / swing / blink / bounce
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
//   filter（ぼかし・明るさ・白黒…）も同じ作りで合成する。
//
//   ── ずっと動く演出 ──
//   pulse等も同じCSS変数へ書き込む @keyframes として出すので、
//   「ゆらゆら浮かせながらホバーで拡大」のように他のアクションと共存できる。
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
  ['--mlc-skx', '<angle>', '0deg'],
  ['--mlc-sky', '<angle>', '0deg'],
  ['--mlc-scale', '<number>', '1'],
  ['--mlc-flip-x', '<number>', '1'],
  ['--mlc-flip-y', '<number>', '1'],
  // 縦横を別々に伸ばす（「変形」で使う）。拡大(--mlc-scale)とは別に持って
  // おくと、「変形」と「拡大」を重ねてもお互いを消さずに済む。
  ['--mlc-sx', '<number>', '1'],
  ['--mlc-sy', '<number>', '1']
];

const INTERACTION_TRANSFORM_VALUE =
  'translate(var(--mlc-tx), var(--mlc-ty)) rotate(var(--mlc-rot))'
  + ' skew(var(--mlc-skx), var(--mlc-sky))'
  + ' scale(var(--mlc-scale)) scale(var(--mlc-flip-x), var(--mlc-flip-y))'
  + ' scale(var(--mlc-sx), var(--mlc-sy))';

// filterを組み立てるCSS変数。transformと同じ考え方で、
// ぼかし・明るさ・白黒…を種類ごとに別の変数へ書いて1つのfilterに合成する。
// 初期値はどれも「何もしない」値なので、filterを常に出しても見た目は変わらない。
const INTERACTION_FILTER_VARS = [
  ['--mlc-blur', '<length>', '0px'],
  ['--mlc-bright', '<number>', '1'],
  ['--mlc-gray', '<number>', '0'],
  ['--mlc-sat', '<number>', '1'],
  ['--mlc-hue', '<angle>', '0deg'],
  ['--mlc-glow', '<length>', '0px']
];

const INTERACTION_FILTER_VALUE =
  'blur(var(--mlc-blur)) brightness(var(--mlc-bright)) grayscale(var(--mlc-gray))'
  + ' saturate(var(--mlc-sat)) hue-rotate(var(--mlc-hue))'
  + ' drop-shadow(0 0 var(--mlc-glow) rgba(0, 0, 0, 0.55))';

function _interactionIsTransformVar(prop) {
  return INTERACTION_TRANSFORM_VARS.some(v => v[0] === prop);
}

function _interactionIsFilterVar(prop) {
  return INTERACTION_FILTER_VARS.some(v => v[0] === prop);
}

// hold（押している/乗せている間だけ）を純CSSで表せるトリガーと、その擬似クラス
const INTERACTION_HOLD_PSEUDO = { hover: ':hover', press: ':active' };

// CSS変数を transition/keyframes で補間できるようにする型登録。
// 未対応のブラウザではこの@ruleごと無視され、変化が瞬間的になるだけ。
function _interactionPropertyAtRules(varList) {
  return (varList || [])
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
      case 'skew':
        props['--mlc-skx'] = Number(a.params?.dx ?? 0) + 'deg';
        props['--mlc-sky'] = Number(a.params?.dy ?? 0) + 'deg';
        break;
      case 'flip':
        props['--mlc-flip-x'] = String(Number(a.params?.x ?? 1));
        props['--mlc-flip-y'] = String(Number(a.params?.y ?? 1));
        break;
      case 'stretch':
        props['--mlc-sx'] = String(Number(a.params?.sx ?? 1));
        props['--mlc-sy'] = String(Number(a.params?.sy ?? 1));
        break;
      case 'blur':
        props['--mlc-blur'] = Number(a.params?.to ?? 0) + 'px';
        break;
      case 'brightness':
        props['--mlc-bright'] = String(Number(a.params?.to ?? 1));
        break;
      case 'grayscale':
        props['--mlc-gray'] = String(Number(a.params?.to ?? 0));
        break;
      case 'saturate':
        props['--mlc-sat'] = String(Number(a.params?.to ?? 1));
        break;
      case 'hue':
        props['--mlc-hue'] = Number(a.params?.deg ?? 0) + 'deg';
        break;
      case 'glow':
        props['--mlc-glow'] = Number(a.params?.to ?? 0) + 'px';
        break;
      default:
        // ずっと動く系(pulse等)はここでは値を1つに決められないので何も出さない。
        // @keyframes の組み立ては _interactionLoopFrames が担当する。
        break;
    }
  });

  return props;
}

// ずっと繰り返す演出の中身。[パーセント, { プロパティ: 値 }] の並びを返す。
// 中身はどれもCSS変数なので、transform/filterの合成（他のアクションとの共存）が
// そのまま効く。1周期の長さは steps[0].duration が決める。
function _interactionOffset(params, defDx, defDy) {
  const dx = Number(params?.dx);
  const dy = Number(params?.dy);
  return {
    dx: Number.isFinite(dx) ? dx : defDx,
    dy: Number.isFinite(dy) ? dy : defDy
  };
}

// 位置ずらしの1コマ分。横・縦をいつも組で出すので、
// 斜めに動かしても片方だけ前のコマの値が残るということがない。
function _interactionShift(dx, dy) {
  return { '--mlc-tx': Math.round(dx * 100) / 100 + 'px', '--mlc-ty': Math.round(dy * 100) / 100 + 'px' };
}

const INTERACTION_LOOP_FRAMES = {
  pulse: p => {
    const to = Number(p?.to ?? 1.1);
    return [[0, { '--mlc-scale': '1' }], [50, { '--mlc-scale': String(to) }], [100, { '--mlc-scale': '1' }]];
  },
  spin: p => {
    const deg = Number(p?.deg ?? 360);
    return [[0, { '--mlc-rot': '0deg' }], [100, { '--mlc-rot': deg + 'deg' }]];
  },
  // 横dx・縦dy ぶんだけ動いて戻る
  float: p => {
    const { dx, dy } = _interactionOffset(p, 0, -12);
    return [[0, _interactionShift(0, 0)], [50, _interactionShift(dx, dy)], [100, _interactionShift(0, 0)]];
  },
  // 指定した向きに往復する
  shake: p => {
    const { dx, dy } = _interactionOffset(p, 8, 0);
    return [
      [0, _interactionShift(0, 0)], [25, _interactionShift(-dx, -dy)],
      [75, _interactionShift(dx, dy)], [100, _interactionShift(0, 0)]
    ];
  },
  swing: p => {
    const deg = Number(p?.deg ?? 8);
    return [
      [0, { '--mlc-rot': '0deg' }], [25, { '--mlc-rot': deg + 'deg' }],
      [75, { '--mlc-rot': (-deg) + 'deg' }], [100, { '--mlc-rot': '0deg' }]
    ];
  },
  blink: p => {
    const to = Number(p?.to ?? 0.2);
    return [[0, { opacity: '1' }], [50, { opacity: String(to) }], [100, { opacity: '1' }]];
  },
  // 指定した所まで跳んで、小さくもう一度跳ねる
  bounce: p => {
    const { dx, dy } = _interactionOffset(p, 0, -20);
    return [
      [0, _interactionShift(0, 0)], [30, _interactionShift(dx, dy)],
      [50, _interactionShift(0, 0)], [70, _interactionShift(dx * 0.4, dy * 0.4)],
      [100, _interactionShift(0, 0)]
    ];
  }
};

// このステップが「ずっと動く」アクションなら、そのアクションを返す
function _interactionLoopAction(step) {
  return (step?.actions || []).find(a => a && INTERACTION_LOOP_FRAMES[a.type]) || null;
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
    map.set(sel, {
      sel, base: {}, transitions: [], transitioned: new Set(), animations: [],
      usesTransform: false, usesFilter: false
    });
  }
  return map.get(sel);
}

// この宣言の集まりが transform / filter のどちらの合成を必要とするか記録する
function _interactionNoteVarUse(entry, props) {
  const keys = Object.keys(props || {});
  if (keys.some(_interactionIsTransformVar)) entry.usesTransform = true;
  if (keys.some(_interactionIsFilterVar)) entry.usesFilter = true;
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

    const sel = _interactionSelector(rule.targetId || rule.triggerElementId);
    const timing = (Number(step.duration) || 0.3) + 's '
      + (step.easing || 'ease') + ' '
      + (Number(step.delay) || 0) + 's';

    // ── ずっと繰り返す演出 ──
    //   @keyframes + infinite。どこに animation を置くかはトリガー次第で、
    //   「ページ表示なら最初からずっと」「マウスを乗せている間だけ」
    //   「クリックで開始/停止」を同じ仕組みで書き分ける。
    const loopAction = _interactionLoopAction(step);
    if (loopAction) {
      const entry = _interactionTargetEntry(targets, sel);
      const frames = INTERACTION_LOOP_FRAMES[loopAction.type](loopAction.params || {});
      frames.forEach(([, fprops]) => _interactionNoteVarUse(entry, fprops));

      const kfName = interactionKeyframesName(rule);
      keyframeBlocks.push('@keyframes ' + kfName + ' {\n'
        + frames.map(([pct, fprops]) => '  ' + pct + '% { ' + _interactionPropsToText(fprops) + ' }').join('\n')
        + '\n}');

      const animation = kfName + ' ' + timing + ' infinite';
      const holdPseudo = INTERACTION_HOLD_PSEUDO[rule.trigger?.type];
      if (rule.toggleMode === 'hold' && holdPseudo) {
        stateBlocks.push(sel + holdPseudo + ' { animation: ' + animation + '; }');
      } else if (rule.toggleMode === 'toggle') {
        stateBlocks.push(sel + '.' + interactionActiveClass(rule) + ' { animation: ' + animation + '; }');
      } else {
        entry.animations.push(animation);
      }
      return;
    }

    const props = _interactionActionsToProps(step.actions);
    if (!Object.keys(props).length) return;

    const entry = _interactionTargetEntry(targets, sel);
    _interactionNoteVarUse(entry, props);

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
      const fromProps = _interactionActionsToProps(step.actions, true);
      _interactionNoteVarUse(entry, fromProps);
      Object.assign(entry.base, fromProps);
    }

    Object.keys(props).forEach(prop => {
      if (prop === 'pointer-events') return; // 補間しない
      _interactionAddTransition(entry, prop, timing);
    });

    const holdPseudo = INTERACTION_HOLD_PSEUDO[rule.trigger?.type];
    if (rule.toggleMode === 'hold' && holdPseudo) {
      // 純CSSの :hover / :active。JS不要、離すと自動で戻る。
      stateBlocks.push(sel + holdPseudo + ' { ' + _interactionPropsToText(props) + ' }');
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
  let anyFilter = false;

  targets.forEach(entry => {
    // 変数の初期値 → 開始状態(from)で上書き、の順に畳んでから宣言にする
    const values = {};
    if (entry.usesTransform) {
      INTERACTION_TRANSFORM_VARS.forEach(([name, , initial]) => { values[name] = initial; });
    }
    if (entry.usesFilter) {
      INTERACTION_FILTER_VARS.forEach(([name, , initial]) => { values[name] = initial; });
    }
    Object.assign(values, entry.base);

    const decls = Object.entries(values).map(([k, v]) => k + ': ' + v + ';');
    if (entry.usesTransform) {
      anyTransform = true;
      decls.push('transform: ' + INTERACTION_TRANSFORM_VALUE + ';');
    }
    if (entry.usesFilter) {
      anyFilter = true;
      decls.push('filter: ' + INTERACTION_FILTER_VALUE + ';');
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
  const usedVars = []
    .concat(anyTransform ? INTERACTION_TRANSFORM_VARS : [])
    .concat(anyFilter ? INTERACTION_FILTER_VARS : []);
  if (usedVars.length) out.push(_interactionPropertyAtRules(usedVars));
  if (keyframeBlocks.length) out.push(keyframeBlocks.join('\n'));
  out.push(baseBlocks.join('\n'));
  if (stateBlocks.length) out.push(stateBlocks.join('\n'));
  return out.join('\n\n');
}
