// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: データモデル
//   InteractionRule の生成・検証・CRUD。実体は state.js の
//   `interactions` 配列（プロジェクト全体で1つ）。
//
//   ※ 編集可能な原本はコーディングタブのBlocklyワークスペースで、
//     この配列はそこから毎回作り直される導出データ。直接編集しない。
//
//   トリガー元(triggerElementId)と対象(targetId)を分けて持つのが要点。
//   「ハンバーガーをクリックしたら別のメニューを開く」のような
//   他要素を動かすケースを最初から表現できるようにしている。
// ══════════════════════════════════════════════════════════════

const INTERACTION_TRIGGER_TYPES = [
  'click', 'dblclick', 'hover', 'press', 'inview', 'load', 'key', 'scroll', 'scrollpage', 'timer'
];

// アクションの種類。
//   変形系   : scale / rotate / move / slide / skew / flip
//   ぼかし系 : blur / brightness / grayscale / saturate / hue / glow
//   濃さ     : fade / show / hide
//   ずっと動く: pulse / spin / float / shake / swing / blink / bounce
const INTERACTION_ACTION_TYPES = [
  'scale', 'fade', 'move', 'slide', 'rotate', 'show', 'hide',
  'skew', 'flip',
  'blur', 'brightness', 'grayscale', 'saturate', 'hue', 'glow',
  'pulse', 'spin', 'float', 'shake', 'swing', 'blink', 'bounce'
];

// ずっと繰り返すアクション。@keyframes + infinite で表現するので、
// 値を1つ決める通常のアクションとは生成のしかたが違う。
const INTERACTION_LOOP_ACTION_TYPES = ['pulse', 'spin', 'float', 'shake', 'swing', 'blink', 'bounce'];

const INTERACTION_TOGGLE_MODES = ['once', 'hold', 'toggle'];

// トリガー種別ごとの既定のtoggleMode（UIの初期値に使う）
//   once  : 初回発火で再生し完了状態を維持（ページ表示時の出現演出）
//   hold  : 条件が真の間だけ有効、外れたら自動で戻る（hover / 押している間）
//   toggle: 状態クラスをON/OFFする（クリックでの開閉）
const INTERACTION_DEFAULT_TOGGLE = {
  click: 'toggle', dblclick: 'toggle', hover: 'hold', press: 'hold',
  inview: 'toggle', load: 'once', key: 'toggle',
  scroll: 'toggle', scrollpage: 'toggle', timer: 'toggle'
};

// 各アクションが書き込む先。競合検出に使う。
// （実際の値の組み立ては codegen-css.js 側の責務。あちらは埋め込み用に
//   単体で完結させたいので、この対応表はあえて共有せず小さく重複させている）
//
// transform と filter は種類ごとに別々のCSS変数へ書いて合成する作りなので、
// 「同じ要素の拡大と回転」のように別の変数を触るものは衝突しない。
// 変数名まで見て突き合わせるため、値はプロパティ名の配列にしてある。
const INTERACTION_ACTION_PROPERTY = {
  // transform を組み立てる変数
  scale: ['--mlc-scale'],
  rotate: ['--mlc-rot'],
  move: ['--mlc-tx', '--mlc-ty'],
  slide: ['--mlc-tx', '--mlc-ty'],
  skew: ['--mlc-skx', '--mlc-sky'],
  flip: ['--mlc-flip-x', '--mlc-flip-y'],
  // filter を組み立てる変数
  blur: ['--mlc-blur'],
  brightness: ['--mlc-bright'],
  grayscale: ['--mlc-gray'],
  saturate: ['--mlc-sat'],
  hue: ['--mlc-hue'],
  glow: ['--mlc-glow'],
  // そのまま書くプロパティ
  fade: ['opacity'], show: ['opacity'], hide: ['opacity']
};

// ずっと動く系は animation プロパティを丸ごと使うので、2つ重ねると
// 後のものだけが残る（'animation' の枠で衝突させる）。
// あわせて「動かしている変数」も申告しておくと、
// 「ずっと回る」と「クリックで回す」のような食い合いも拾える。
const INTERACTION_LOOP_VARS = {
  pulse: ['--mlc-scale'], spin: ['--mlc-rot'], swing: ['--mlc-rot'], blink: ['opacity'],
  // 横・縦の両方を動かせるので、どちらの変数も申告する
  float: ['--mlc-tx', '--mlc-ty'], shake: ['--mlc-tx', '--mlc-ty'], bounce: ['--mlc-tx', '--mlc-ty']
};
INTERACTION_LOOP_ACTION_TYPES.forEach(type => {
  INTERACTION_ACTION_PROPERTY[type] = ['animation'].concat(INTERACTION_LOOP_VARS[type]);
});

// 競合の警告文で使う、変数名の言い換え
const INTERACTION_PROPERTY_LABEL = {
  '--mlc-scale': '大きさ', '--mlc-rot': '回転',
  '--mlc-tx': '横の位置', '--mlc-ty': '縦の位置',
  '--mlc-skx': '横の傾き', '--mlc-sky': '縦の傾き',
  '--mlc-flip-x': '左右の反転', '--mlc-flip-y': '上下の反転',
  '--mlc-blur': 'ぼかし', '--mlc-bright': '明るさ', '--mlc-gray': '白黒',
  '--mlc-sat': '鮮やかさ', '--mlc-hue': '色合い', '--mlc-glow': '影',
  opacity: '濃さ', animation: 'ずっと動く演出'
};

function isLoopInteractionAction(type) {
  return INTERACTION_LOOP_ACTION_TYPES.includes(type);
}

function makeInteractionId() {
  return 'ir_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function defaultActionParams(actionType) {
  switch (actionType) {
    case 'scale': return { to: 1.2 };
    case 'fade': return { to: 0.3 };
    case 'move':
    case 'slide': return { dx: 100, dy: 0 };
    case 'rotate': return { deg: 45 };
    case 'skew': return { dx: 10, dy: 0 };
    case 'flip': return { x: -1, y: 1 };
    case 'blur': return { to: 4 };
    case 'brightness': return { to: 1.4 };
    case 'grayscale': return { to: 1 };
    case 'saturate': return { to: 1.6 };
    case 'hue': return { deg: 90 };
    case 'glow': return { to: 12 };
    // ずっと動く系（振れ幅。周期は steps[0].duration）
    case 'pulse': return { to: 1.1 };
    case 'spin': return { deg: 360 };
    // 動く量は移動と同じ「横dx・縦dy」で持つ
    case 'float': return { dx: 0, dy: -12 };
    case 'shake': return { dx: 8, dy: 0 };
    case 'swing': return { deg: 8 };
    case 'blink': return { to: 0.2 };
    case 'bounce': return { dx: 0, dy: -20 };
    default: return {};
  }
}

// アクション1つ分 { type, params } を作る
function makeInteractionAction(type, params) {
  return { type, params: { ...defaultActionParams(type), ...(params || {}) } };
}

function createInteractionRule(opts = {}) {
  const triggerType = INTERACTION_TRIGGER_TYPES.includes(opts.triggerType) ? opts.triggerType : 'click';
  const actionType = INTERACTION_ACTION_TYPES.includes(opts.actionType) ? opts.actionType : 'scale';
  const triggerElementId = opts.triggerElementId || null;

  return {
    id: opts.id || makeInteractionId(),
    triggerElementId,
    targetId: opts.targetId || triggerElementId,
    trigger: { type: triggerType, params: { ...(opts.triggerParams || {}) } },
    toggleMode: INTERACTION_TOGGLE_MODES.includes(opts.toggleMode)
      ? opts.toggleMode
      : (INTERACTION_DEFAULT_TOGGLE[triggerType] || 'toggle'),
    steps: [{
      // 1つのブロックで複数の効果を同時にかけたいことがある
      // （「拡大しながらフェードイン」など）。opts.actions が来ていれば
      // そちらを使い、無ければ actionType 1つぶんを組み立てる。
      actions: Array.isArray(opts.actions) && opts.actions.length
        ? opts.actions.map(a => makeInteractionAction(a.type, a.params))
        : [makeInteractionAction(actionType, opts.actionParams)],
      duration: Number.isFinite(Number(opts.duration)) ? Number(opts.duration) : 0.4,
      delay: Number.isFinite(Number(opts.delay)) ? Number(opts.delay) : 0,
      easing: opts.easing || 'ease-out',
      repeat: 0,
      direction: 'normal'
    }]
  };
}

// 対象id('<shapeId>' または 'grp:<groupId>')が実在するか
function interactionTargetExists(targetId) {
  const raw = String(targetId || '');
  if (!raw) return false;
  if (typeof shapes === 'undefined' || !Array.isArray(shapes)) return true;
  if (raw.startsWith('grp:')) {
    const gid = raw.slice(4);
    return shapes.some(s => s.groupId === gid);
  }
  return shapes.some(s => s.id === raw);
}

function validateInteractionRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object') return { ok: false, errors: ['ルールがオブジェクトではありません'] };

  if (!rule.id) errors.push('id がありません');
  if (!rule.triggerElementId) errors.push('トリガー要素が指定されていません');

  const target = rule.targetId || rule.triggerElementId;
  if (!target) errors.push('対象要素が指定されていません');

  if (!INTERACTION_TRIGGER_TYPES.includes(rule.trigger?.type)) {
    errors.push('未対応のトリガー種別: ' + (rule.trigger?.type ?? '(なし)'));
  }
  if (!INTERACTION_TOGGLE_MODES.includes(rule.toggleMode)) {
    errors.push('未対応のtoggleMode: ' + (rule.toggleMode ?? '(なし)'));
  }

  const step = rule.steps && rule.steps[0];
  if (!step) {
    errors.push('steps がありません');
  } else {
    if (!Array.isArray(step.actions) || !step.actions.length) {
      errors.push('アクションが1つもありません');
    } else {
      step.actions.forEach(a => {
        if (!INTERACTION_ACTION_TYPES.includes(a?.type)) {
          errors.push('未対応のアクション: ' + (a?.type ?? '(なし)'));
        }
      });
    }
    if (!(Number(step.duration) >= 0)) errors.push('duration が不正です: ' + step.duration);
    if (!(Number(step.delay) >= 0)) errors.push('delay が不正です: ' + step.delay);
  }

  // 図形/グループの実在チェック（shapes が使える文脈でのみ）
  if (typeof shapes !== 'undefined' && Array.isArray(shapes)) {
    if (rule.triggerElementId && !interactionTargetExists(rule.triggerElementId)) {
      errors.push('トリガー要素が見つかりません: ' + rule.triggerElementId);
    }
    if (target && !interactionTargetExists(target)) {
      errors.push('対象要素が見つかりません: ' + target);
    }
  }

  return { ok: errors.length === 0, errors };
}

// 同じ要素の同じCSSプロパティを複数ルールが変更しようとしていないか調べる。
// 現在の生成方式では、状態クラスが同時に有効になったとき「後に書かれた
// ルールが丸ごと優先」され、値が合成されないため、事前に警告を出す。
function findInteractionConflicts(rules) {
  const list = rules || (typeof interactions !== 'undefined' ? interactions : []) || [];
  const seen = new Map();

  list.forEach(rule => {
    const target = rule.targetId || rule.triggerElementId;
    const step = rule.steps && rule.steps[0];
    (step?.actions || []).forEach(a => {
      const props = INTERACTION_ACTION_PROPERTY[a?.type];
      if (!props || !target) return;
      props.forEach(prop => {
        const key = target + '|' + prop;
        if (!seen.has(key)) seen.set(key, []);
        if (!seen.get(key).includes(rule.id)) seen.get(key).push(rule.id);
      });
    });
  });

  const warnings = [];
  seen.forEach((ruleIds, key) => {
    if (ruleIds.length < 2) return;
    const [target, property] = key.split('|');
    warnings.push({
      target, property, ruleIds,
      message: '同じ要素の「' + (INTERACTION_PROPERTY_LABEL[property] || property) + '」を '
        + ruleIds.length + '個のブロックが同時に変えようとしています。'
        + '両方が有効になると後のものだけが効きます。'
    });
  });
  return warnings;
}

// ── CRUD ─────────────────────────────────────────────────────
function getInteraction(id) {
  return (interactions || []).find(r => r.id === id) || null;
}

function addInteraction(rule) {
  const check = validateInteractionRule(rule);
  if (!check.ok) return { ok: false, errors: check.errors };
  interactions.push(rule);
  return { ok: true, rule, warnings: findInteractionConflicts() };
}

function updateInteraction(id, patch) {
  const rule = getInteraction(id);
  if (!rule) return { ok: false, errors: ['ルールが見つかりません: ' + id] };
  Object.assign(rule, patch || {});
  const check = validateInteractionRule(rule);
  if (!check.ok) return { ok: false, errors: check.errors };
  return { ok: true, rule, warnings: findInteractionConflicts() };
}

function removeInteraction(id) {
  const idx = (interactions || []).findIndex(r => r.id === id);
  if (idx < 0) return false;
  interactions.splice(idx, 1);
  return true;
}

function clearInteractions() {
  if (Array.isArray(interactions)) interactions.splice(0, interactions.length);
}

function interactionsForTrigger(elementId) {
  return (interactions || []).filter(r => r.triggerElementId === elementId);
}

function interactionsForTarget(elementId) {
  return (interactions || []).filter(r => (r.targetId || r.triggerElementId) === elementId);
}
