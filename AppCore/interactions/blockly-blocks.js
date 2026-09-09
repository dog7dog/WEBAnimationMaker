// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: Blocklyのブロック定義と変換
//   ブロックの組み方は「トリガー(帽子) → その下にアクションを繋ぐ」。
//
//     [ボタン▾ をクリックしたとき]
//       └ [まる▾ を 1.5 倍にする  0.4秒 ease-out▾]
//
//   ワークスペース → InteractionRule[] の変換は、Blockly標準のコード生成器で
//   テキストを作って読み直すのではなく、ブロックのフィールド値を直接読む
//   （構造化データ→構造化データ。テキストを介さないぶん壊れにくい）。
//
//   ブロックはSPECテーブル駆動。parts に「文字列(ラベル)」か
//   「フィールド定義」を並べるだけで1種類増やせる。
//     { el: 'NAME' }                      … 図形のドロップダウン
//     { num: 'NAME', def, min, max, step } … 数値入力
//     { menu: 'NAME', options: [[表示, 値]] } … 選択
// ══════════════════════════════════════════════════════════════

// 制御構造の中でだけ意味を持つブロック（CSSでは表現できないのでJS生成側で扱う）
const MLC_FLOW_BLOCKS = {
  mlc_wait: { parts: [{ num: 'SEC', def: 0.5, min: 0, max: 600, step: 0.05 }, '秒待つ'] },
  mlc_reset: { parts: [{ el: 'TARGET_EL' }, 'を元に戻す'] }
};

const MLC_EASING_OPTIONS = [
  ['なめらか(出だし速め)', 'ease-out'],
  ['なめらか', 'ease'],
  ['ゆっくり始まる', 'ease-in'],
  ['ゆっくり始まり終わる', 'ease-in-out'],
  ['一定速度', 'linear']
];

// 「どの向きから出てくるか」→ 開始位置のオフセット
const MLC_SLIDE_FROM = {
  bottom: { dx: 0, dy: 40 },
  top: { dx: 0, dy: -40 },
  left: { dx: -40, dy: 0 },
  right: { dx: 40, dy: 0 }
};

// ── トリガー ─────────────────────────────────────────────────
//   noElement: トリガー元の図形を持たないもの（ページ表示・キー入力）。
//   この場合は繋がれたアクションの対象図形をトリガー元として扱う。
const MLC_TRIGGER_BLOCKS = {
  mlc_when_click: {
    trigger: 'click', toggleMode: 'toggle',
    parts: [{ el: 'TRIGGER_EL' }, 'をクリックしたとき']
  },
  mlc_when_hover: {
    trigger: 'hover', toggleMode: 'hold',
    parts: [{ el: 'TRIGGER_EL' }, 'にマウスを乗せている間']
  },
  mlc_when_inview: {
    trigger: 'inview', toggleMode: 'toggle',
    parts: [{ el: 'TRIGGER_EL' }, 'が画面に入ったとき']
  },
  mlc_when_load: {
    trigger: 'load', toggleMode: 'once', noElement: true,
    parts: ['ページが表示されたとき']
  },
  mlc_when_key: {
    trigger: 'key', toggleMode: 'toggle', noElement: true,
    parts: [{ menu: 'KEY', options: [['Enter', 'Enter'], ['スペース', ' '], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['←', 'ArrowLeft'], ['→', 'ArrowRight']] }, 'キーが押されたとき'],
    toTriggerParams: b => ({ key: b.getFieldValue('KEY') })
  }
};

// ── アクション ───────────────────────────────────────────────
//   category: 'action'(通常) / 'entrance'(出現演出。開始状態fromを持つ)
const MLC_ACTION_BLOCKS = {
  mlc_action_scale: {
    action: 'scale', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を', { num: 'TO', def: 1.2, min: 0, max: 20, step: 0.1 }, '倍にする'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_action_fade: {
    action: 'fade', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'の濃さを', { num: 'TO', def: 0.3, min: 0, max: 1, step: 0.05 }, 'にする'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_action_move: {
    action: 'move', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を 横', { num: 'DX', def: 100, min: -2000, max: 2000, step: 1 },
      ' 縦', { num: 'DY', def: 0, min: -2000, max: 2000, step: 1 }, ' 動かす'],
    toParams: b => ({ dx: Number(b.getFieldValue('DX')), dy: Number(b.getFieldValue('DY')) })
  },
  mlc_action_rotate: {
    action: 'rotate', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を', { num: 'DEG', def: 45, min: -3600, max: 3600, step: 1 }, '度 回す'],
    toParams: b => ({ deg: Number(b.getFieldValue('DEG')) })
  },
  mlc_action_show: {
    action: 'show', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を表示する'],
    toParams: () => ({})
  },
  mlc_action_hide: {
    action: 'hide', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を隠す'],
    toParams: () => ({})
  },
  // 出現演出: 開始状態(from)を持つので、ページ表示や画面内進入と組み合わせる
  mlc_action_fade_in: {
    action: 'fade', category: 'entrance',
    parts: [{ el: 'TARGET_EL' }, 'をフェードインさせる'],
    toParams: () => ({ to: 1, from: { to: 0 } })
  },
  mlc_action_slide_in: {
    action: 'slide', category: 'entrance',
    parts: [{ el: 'TARGET_EL' }, 'を',
      { menu: 'DIR', options: [['下', 'bottom'], ['上', 'top'], ['左', 'left'], ['右', 'right']] }, 'から出す'],
    toParams: b => ({ dx: 0, dy: 0, from: MLC_SLIDE_FROM[b.getFieldValue('DIR')] || MLC_SLIDE_FROM.bottom })
  }
};

// 図形のドロップダウン候補。Blocklyは空配列を許さないのでフォールバックを返す。
function mlcShapeDropdownOptions() {
  if (typeof ensureShapeIds === 'function') ensureShapeIds();
  const list = (typeof shapes !== 'undefined' ? shapes : []) || [];
  const opts = [];

  // グループは1つのオブジェクトとして選べるようにする
  // （拡大・移動などがグループ全体にまとまって効く）
  const groupCounts = new Map();
  list.forEach(s => {
    if (!s.groupId || s.hidden) return;
    groupCounts.set(s.groupId, (groupCounts.get(s.groupId) || 0) + 1);
  });
  groupCounts.forEach((count, gid) => {
    opts.push(['グループ ' + count + '個 (' + String(gid).slice(-4) + ')', 'grp:' + gid]);
  });

  list.filter(s => !s.hidden).forEach(s => {
    const label = (s.name || s.type) + (s.groupId ? '（グループ内）' : '') + ' (' + String(s.id || '').slice(-4) + ')';
    opts.push([label, String(s.id)]);
  });

  return opts.length ? opts : [['(図形がありません)', '']];
}

// parts の並びをブロックの入力行に流し込む
function _mlcAppendParts(block, input, parts) {
  parts.forEach(part => {
    if (typeof part === 'string') { input.appendField(part); return; }
    if (part.el) { input.appendField(new Blockly.FieldDropdown(mlcShapeDropdownOptions), part.el); return; }
    if (part.num) { input.appendField(new Blockly.FieldNumber(part.def, part.min, part.max, part.step), part.num); return; }
    if (part.menu) { input.appendField(new Blockly.FieldDropdown(part.options), part.menu); return; }
  });
}

function defineMlcBlocks() {
  if (typeof Blockly === 'undefined') return;
  defineMlcFlowBlocks();

  Object.entries(MLC_TRIGGER_BLOCKS).forEach(([type, spec]) => {
    Blockly.Blocks[type] = {
      init: function () {
        _mlcAppendParts(this, this.appendDummyInput(), spec.parts);
        this.setNextStatement(true, null);
        this.setColour(45);
        this.setTooltip('この下につないだ動きが実行されます');
      }
    };
  });

  Object.entries(MLC_ACTION_BLOCKS).forEach(([type, spec]) => {
    Blockly.Blocks[type] = {
      init: function () {
        _mlcAppendParts(this, this.appendDummyInput(), spec.parts);
        this.appendDummyInput()
          .appendField('時間')
          .appendField(new Blockly.FieldNumber(0.4, 0, 60, 0.05), 'DURATION')
          .appendField('秒 遅れ')
          .appendField(new Blockly.FieldNumber(0, 0, 60, 0.05), 'DELAY')
          .appendField('秒')
          .appendField(new Blockly.FieldDropdown(MLC_EASING_OPTIONS), 'EASING');
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(spec.category === 'entrance' ? 160 : 210);
        this.setTooltip('動かす対象は、トリガーとは別の図形も選べます');
      }
    };
  });
}

function defineMlcFlowBlocks() {
  if (typeof Blockly === 'undefined') return;
  Object.entries(MLC_FLOW_BLOCKS).forEach(([type, spec]) => {
    Blockly.Blocks[type] = {
      init: function () {
        _mlcAppendParts(this, this.appendDummyInput(), spec.parts);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(20);
      }
    };
  });
}

function mlcToolboxJson() {
  const blocksIn = (table, pred) => Object.entries(table)
    .filter(([, spec]) => (pred ? pred(spec) : true))
    .map(([type]) => ({ kind: 'block', type }));
  const b = types => types.map(type => ({ kind: 'block', type }));

  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: 'トリガー', colour: '45', contents: blocksIn(MLC_TRIGGER_BLOCKS) },
      { kind: 'category', name: 'アクション', colour: '210', contents: blocksIn(MLC_ACTION_BLOCKS, s => s.category === 'action') },
      { kind: 'category', name: '出現', colour: '160', contents: blocksIn(MLC_ACTION_BLOCKS, s => s.category === 'entrance') },
      { kind: 'category', name: '時間', colour: '20', contents: blocksIn(MLC_FLOW_BLOCKS) },
      // ここから下はBlockly標準のブロック（分岐・繰り返し・計算・変数・関数）
      { kind: 'category', name: '分岐', colour: '210', contents: b(['controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean']) },
      { kind: 'category', name: '繰り返し', colour: '120', contents: [
        { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } } } },
        { kind: 'block', type: 'controls_whileUntil' },
        { kind: 'block', type: 'controls_for', inputs: {
            FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
            TO: { shadow: { type: 'math_number', fields: { NUM: 5 } } },
            BY: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
        { kind: 'block', type: 'controls_flow_statements' }
      ] },
      { kind: 'category', name: '計算', colour: '230', contents: [
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic' },
        { kind: 'block', type: 'math_random_int', inputs: {
            FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
            TO: { shadow: { type: 'math_number', fields: { NUM: 100 } } } } },
        { kind: 'block', type: 'text' }
      ] },
      { kind: 'category', name: '変数', colour: '330', custom: 'VARIABLE' },
      { kind: 'category', name: '関数', colour: '290', custom: 'PROCEDURE' }
    ]
  };
}

// ワークスペース → InteractionRule[]
//   ルールidはブロックidから決定的に作る。こうすると編集のたびに作り直しても
//   同じブロックには同じCSSクラス名が割り当てられ、再生成が冪等になる。
// トリガーの下に、アクション以外のブロック（分岐・繰り返し・変数・待つ等）が
// 含まれているか。含まれていれば、そのスタックはCSSだけでは表現できないので
// 命令的なJS（blockly-codegen.js）で駆動する。
function mlcStackIsImperative(top) {
  let b = top.getNextBlock();
  while (b) {
    if (!MLC_ACTION_BLOCKS[b.type]) return true;
    b = b.getNextBlock();
  }
  return false;
}

// アクションブロック → そのアクション用のCSSクラス名の元になるルールid
function mlcRuleIdForBlock(block) {
  return 'ir_' + String(block.id).replace(/[^a-zA-Z0-9_-]/g, '');
}

function blocklyWorkspaceToInteractions(ws) {
  const rules = [];
  if (!ws) return rules;

  ws.getTopBlocks(true).forEach(top => {
    const tSpec = MLC_TRIGGER_BLOCKS[top.type];
    if (!tSpec) return;

    // ページ表示・キー入力はトリガー元の図形を持たないので、
    // 動かす対象の図形をそのままトリガー元として扱う
    const triggerElementId = tSpec.noElement ? null : top.getFieldValue('TRIGGER_EL');
    if (!tSpec.noElement && !triggerElementId) return;
    const triggerParams = tSpec.toTriggerParams ? tSpec.toTriggerParams(top) : {};

    // 制御構造入りのスタックは、実行の順番や条件をJS側が決めるので
    // ここではリスナーを作らない。アクションのCSSは後段でまとめて用意する。
    if (mlcStackIsImperative(top)) return;

    let block = top.getNextBlock();
    while (block) {
      const aSpec = MLC_ACTION_BLOCKS[block.type];
      if (aSpec) {
        const targetId = block.getFieldValue('TARGET_EL');
        if (targetId) {
          rules.push(createInteractionRule({
            id: mlcRuleIdForBlock(block),
            triggerElementId: triggerElementId || targetId,
            targetId,
            triggerType: tSpec.trigger,
            triggerParams,
            toggleMode: tSpec.toggleMode,
            actionType: aSpec.action,
            actionParams: aSpec.toParams(block),
            duration: Number(block.getFieldValue('DURATION')),
            delay: Number(block.getFieldValue('DELAY')),
            easing: block.getFieldValue('EASING')
          }));
        }
      }
      block = block.getNextBlock();
    }
  });

  // 宣言的な経路で拾えなかったアクション（制御構造の中、関数定義の中など）にも
  // CSSルールだけは用意する。実行はJS側(blockly-codegen.js)が担当するので
  // リスナーは作らせない(jsDriven)。
  const covered = new Set(rules.map(r => r.id));
  ws.getAllBlocks(false).forEach(block => {
    const aSpec = MLC_ACTION_BLOCKS[block.type];
    if (!aSpec) return;
    const id = mlcRuleIdForBlock(block);
    if (covered.has(id)) return;
    const targetId = block.getFieldValue('TARGET_EL');
    if (!targetId) return;

    const rule = createInteractionRule({
      id,
      triggerElementId: targetId,
      targetId,
      triggerType: 'click',
      toggleMode: 'toggle',
      actionType: aSpec.action,
      actionParams: aSpec.toParams(block),
      duration: Number(block.getFieldValue('DURATION')),
      delay: Number(block.getFieldValue('DELAY')),
      easing: block.getFieldValue('EASING')
    });
    rule.jsDriven = true;
    rules.push(rule);
    covered.add(id);
  });

  return rules;
}
