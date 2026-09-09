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

const INTERACTION_TRIGGER_TYPES = ['click', 'hover', 'inview', 'load', 'key'];
const INTERACTION_ACTION_TYPES = ['scale', 'fade', 'move', 'slide', 'rotate', 'show', 'hide'];
const INTERACTION_TOGGLE_MODES = ['once', 'hold', 'toggle'];

// トリガー種別ごとの既定のtoggleMode（UIの初期値に使う）
//   once  : 初回発火で再生し完了状態を維持（ページ表示時の出現演出）
//   hold  : 条件が真の間だけ有効、外れたら自動で戻る（hover）
//   toggle: 状態クラスをON/OFFする（クリックでの開閉）
const INTERACTION_DEFAULT_TOGGLE = {
  click: 'toggle', hover: 'hold', inview: 'toggle', load: 'once', key: 'toggle'
};

// 各アクションが変更するCSSプロパティ。競合検出に使う。
// （実際の値の組み立ては codegen-css.js 側の責務。あちらは埋め込み用に
//   単体で完結させたいので、この対応表はあえて共有せず小さく重複させている）
const INTERACTION_ACTION_PROPERTY = {
  scale: 'transform', move: 'transform', slide: 'transform', rotate: 'transform',
  fade: 'opacity', show: 'opacity', hide: 'opacity'
};

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
    default: return {};
  }
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
      actions: [{
        type: actionType,
        params: { ...defaultActionParams(actionType), ...(opts.actionParams || {}) }
      }],
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
      const prop = INTERACTION_ACTION_PROPERTY[a?.type];
      if (!prop || !target) return;
      const key = target + '|' + prop;
      if (!seen.has(key)) seen.set(key, []);
      if (!seen.get(key).includes(rule.id)) seen.get(key).push(rule.id);
    });
  });

  const warnings = [];
  seen.forEach((ruleIds, key) => {
    if (ruleIds.length < 2) return;
    const [target, property] = key.split('|');
    warnings.push({
      target, property, ruleIds,
      message: '同じ要素(' + target + ')の ' + property + ' を '
        + ruleIds.length + '個のルールが変更しようとしています。'
        + '同時に有効になると後のルールが優先され、値は合成されません。'
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
