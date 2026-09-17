// ══════════════════════════════════════════════════════════════
// Trigger→Animation/Action: Blocklyのブロック定義と変換
//   ブロックの組み方は「トリガー(帽子) → その下にアクションを繋ぐ」。
//
//   アクションは4分類:
//     action   … 状態を1つ変える（拡大・ぼかし・傾け…）
//     entrance … 出現演出。開始状態を params.from に持つ
//     exit     … 退場演出。消えた状態で止まる
//     loop     … ずっと繰り返す演出。時間の欄は1周の秒数になる
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
//     { text: 'NAME', def }                … 文字入力（URLなど）
// ══════════════════════════════════════════════════════════════

// 制御構造の中でだけ意味を持つブロック（CSSでは表現できないのでJS生成側で扱う）
//   group: ツールボックスでの置き場所（'time' = 時間、'page' = ページ操作）
const MLC_FLOW_BLOCKS = {
  mlc_wait: { group: 'time', parts: [{ num: 'SEC', def: 0.5, min: 0, max: 600, step: 0.05 }, '秒待つ'] },
  mlc_reset: { group: 'time', parts: [{ el: 'TARGET_EL' }, 'を元に戻す'] },
  mlc_scroll_to: { group: 'page', parts: [{ el: 'TARGET_EL' }, 'までスクロールする'] },
  mlc_scroll_top: { group: 'page', parts: ['ページの先頭へ戻る'] },
  mlc_open_url: {
    group: 'page',
    parts: ['リンク', { text: 'URL', def: 'https://example.com' }, ' を開く']
  }
};

const MLC_FLOW_COLOUR = { time: 20, page: 260 };

// アクションの分類ごとのブロックの色
const MLC_CATEGORY_COLOUR = { action: 210, entrance: 160, exit: 340, loop: 120 };

const MLC_EASING_OPTIONS = [
  ['なめらか(出だし速め)', 'ease-out'],
  ['なめらか', 'ease'],
  ['ゆっくり始まる', 'ease-in'],
  ['ゆっくり始まり終わる', 'ease-in-out'],
  ['一定速度', 'linear']
];

// 動きの指定は「横◯px 縦◯px」に統一する。
//   横: 右が＋ / 左が−
//   縦: 下が＋ / 上が−
// 動かす向きと量を1か所で読めるようにするため、方向メニューは使わない。
function _mlcMoveParts(label, defDx, defDy, tail) {
  return [{ el: 'TARGET_EL' }, label,
    ' 横', { num: 'DX', def: defDx, min: -4000, max: 4000, step: 1 }, 'px',
    ' 縦', { num: 'DY', def: defDy, min: -4000, max: 4000, step: 1 }, 'px', tail];
}

function _mlcMoveValues(b) {
  return { dx: Number(b.getFieldValue('DX')), dy: Number(b.getFieldValue('DY')) };
}

// ── 変形（パワポのモーフのように、別の図形の形へ寄せる）──────────
// 対象idから、位置・大きさ・角度を取り出す。グループにも対応する。
function _mlcShapeGeometry(targetId) {
  const raw = String(targetId || '');
  if (!raw || typeof shapes === 'undefined') return null;

  if (raw.startsWith('grp:')) {
    const gid = raw.slice(4);
    const b = typeof getGroupBounds === 'function' ? getGroupBounds(gid) : null;
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h, rot: 0 } : null;
  }
  const s = shapes.find(sh => sh.id === raw);
  if (!s || typeof getBounds !== 'function') return null;
  const b = getBounds(s);
  return { x: b.x, y: b.y, w: b.w, h: b.h, rot: Number(s.rot) || 0 };
}

// 「AをBの位置・大きさに」の差分を、移動・回転・伸ばしの3つに分けて返す。
// 行き先が見つからないときは、何も動かない値を返す（ブロックを置いた直後や、
// 目印の図形を消したあとでも、生成が壊れないように）。
function _mlcMorphActions(block) {
  const from = _mlcShapeGeometry(block.getFieldValue('TARGET_EL'));
  const to = _mlcShapeGeometry(block.getFieldValue('TO_EL'));
  const round = (v, d) => Math.round(v * d) / d;

  let dx = 0, dy = 0, sx = 1, sy = 1, deg = 0;
  const missingRef = !(from && to && from.w > 0 && from.h > 0);
  if (!missingRef) {
    dx = round((to.x + to.w / 2) - (from.x + from.w / 2), 1);
    dy = round((to.y + to.h / 2) - (from.y + from.h / 2), 1);
    sx = round(to.w / from.w, 1000);
    sy = round(to.h / from.h, 1000);
    deg = round(to.rot - from.rot, 10);
  }
  return [
    // 行き先が見つからないときは印を付けて、コーディングタブで知らせる
    { type: 'move', params: missingRef ? { dx, dy, missingRef } : { dx, dy } },
    { type: 'stretch', params: { sx, sy } },
    { type: 'rotate', params: { deg } }
  ];
}

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
  },
  mlc_when_dblclick: {
    trigger: 'dblclick', toggleMode: 'toggle',
    parts: [{ el: 'TRIGGER_EL' }, 'をダブルクリックしたとき']
  },
  // 押している間だけ（CSSの :active）。指を離すと自動で戻る。
  mlc_when_press: {
    trigger: 'press', toggleMode: 'hold',
    parts: [{ el: 'TRIGGER_EL' }, 'を押している間']
  },
  mlc_when_scroll: {
    trigger: 'scroll', toggleMode: 'toggle', noElement: true,
    parts: ['ページを', { num: 'PX', def: 200, min: 0, max: 20000, step: 10 }, 'px スクロールしたとき'],
    toTriggerParams: b => ({ px: Number(b.getFieldValue('PX')) })
  },
  // 画面1つ分を「1ページ」として、その倍数を通過するたびに切り替わる
  mlc_when_scroll_page: {
    trigger: 'scrollpage', toggleMode: 'toggle', noElement: true,
    parts: [{ num: 'PAGES', def: 1, min: 0.1, max: 50, step: 0.1 }, 'ページごとにスクロールしたとき'],
    toTriggerParams: b => ({ pages: Number(b.getFieldValue('PAGES')) })
  },
  // スクロールに合わせて、動きの途中が進む（止めると途中で止まる）
  mlc_when_scroll_view: {
    trigger: 'scrollview', toggleMode: 'scrub',
    parts: [{ el: 'TRIGGER_EL' }, 'が画面を通り過ぎるのに合わせて'],
    tooltip: 'その図形が画面に入ってから出ていくまでの進み具合で、下の動きが進みます。'
      + '時間ではなくスクロール量で進むので、止めれば途中で止まります。'
  },
  mlc_when_scroll_progress: {
    trigger: 'scrollprogress', toggleMode: 'scrub', noElement: true,
    parts: ['ページのスクロールに合わせて'],
    tooltip: 'ページ全体のスクロール量（先頭で0%、最後で100%）で下の動きが進みます。'
  },
  mlc_when_timer: {
    trigger: 'timer', toggleMode: 'toggle', noElement: true,
    parts: [{ num: 'SEC', def: 2, min: 0.1, max: 600, step: 0.1 }, '秒ごとに'],
    toTriggerParams: b => ({ sec: Number(b.getFieldValue('SEC')) })
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
    parts: _mlcMoveParts('を', 100, 0, ' 動かす'),
    toParams: _mlcMoveValues
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
  // パワポの「変形」に近いもの。行き先の図形を目印にして、
  // 位置・大きさ・角度をまとめて合わせにいく。
  // 目印はレイヤーパネルで非表示にしておける（位置だけ使われる）。
  mlc_action_morph: {
    action: 'move', category: 'action', duration: 0.8, easing: 'ease-in-out',
    parts: [{ el: 'TARGET_EL' }, 'を', { el: 'TO_EL', includeHidden: true }, 'の位置・大きさに変形する'],
    tooltip: '行き先の図形を目印にして、位置・大きさ・角度をまとめて合わせます。'
      + '目印はレイヤーパネルで非表示にしておけます。',
    toActions: _mlcMorphActions
  },
  mlc_action_skew: {
    action: 'skew', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を 横', { num: 'DX', def: 10, min: -80, max: 80, step: 1 },
      ' 縦', { num: 'DY', def: 0, min: -80, max: 80, step: 1 }, ' 度 傾ける'],
    toParams: b => ({ dx: Number(b.getFieldValue('DX')), dy: Number(b.getFieldValue('DY')) })
  },
  mlc_action_flip: {
    action: 'flip', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を', { menu: 'AXIS', options: [['左右', 'x'], ['上下', 'y']] }, 'に反転する'],
    toParams: b => (b.getFieldValue('AXIS') === 'y' ? { x: 1, y: -1 } : { x: -1, y: 1 })
  },
  mlc_action_blur: {
    action: 'blur', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を', { num: 'TO', def: 4, min: 0, max: 50, step: 0.5 }, 'px ぼかす'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_action_brightness: {
    action: 'brightness', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'の明るさを', { num: 'TO', def: 1.4, min: 0, max: 5, step: 0.1 }, '倍にする'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_action_grayscale: {
    action: 'grayscale', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'を白黒にする 強さ', { num: 'TO', def: 1, min: 0, max: 1, step: 0.05 }],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_action_saturate: {
    action: 'saturate', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'の鮮やかさを', { num: 'TO', def: 1.6, min: 0, max: 5, step: 0.1 }, '倍にする'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_action_hue: {
    action: 'hue', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'の色合いを', { num: 'DEG', def: 90, min: -360, max: 360, step: 5 }, '度 ずらす'],
    toParams: b => ({ deg: Number(b.getFieldValue('DEG')) })
  },
  mlc_action_glow: {
    action: 'glow', category: 'action',
    parts: [{ el: 'TARGET_EL' }, 'に', { num: 'TO', def: 12, min: 0, max: 100, step: 1 }, 'px の影をつける'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  // 出現演出: 開始状態(from)を持つので、ページ表示や画面内進入と組み合わせる
  mlc_action_fade_in: {
    action: 'fade', category: 'entrance',
    parts: [{ el: 'TARGET_EL' }, 'をフェードインさせる'],
    toParams: () => ({ to: 1, from: { to: 0 } })
  },
  // ずれた位置から元の位置へ滑り込ませる（既定は40px下から）
  mlc_action_slide_in: {
    action: 'slide', category: 'entrance',
    parts: _mlcMoveParts('を', 0, 40, ' の所から出す'),
    toParams: b => ({ dx: 0, dy: 0, from: _mlcMoveValues(b) })
  },
  mlc_action_zoom_in: {
    action: 'scale', category: 'entrance',
    parts: [{ el: 'TARGET_EL' }, 'を大きくしながら出す'],
    toActions: () => ([
      { type: 'scale', params: { to: 1, from: { to: 0.6 } } },
      { type: 'fade', params: { to: 1, from: { to: 0 } } }
    ])
  },
  mlc_action_pop_in: {
    action: 'scale', category: 'entrance', duration: 0.5,
    parts: [{ el: 'TARGET_EL' }, 'をポンと出す'],
    toActions: () => ([{ type: 'scale', params: { to: 1, from: { to: 0 } } }])
  },
  mlc_action_rotate_in: {
    action: 'rotate', category: 'entrance', duration: 0.6,
    parts: [{ el: 'TARGET_EL' }, 'を回しながら出す'],
    toActions: () => ([
      { type: 'rotate', params: { deg: 0, from: { deg: -180 } } },
      { type: 'fade', params: { to: 1, from: { to: 0 } } }
    ])
  },
  mlc_action_flip_in: {
    action: 'flip', category: 'entrance', duration: 0.6,
    parts: [{ el: 'TARGET_EL' }, 'をめくって出す'],
    toActions: () => ([{ type: 'flip', params: { x: 1, y: 1, from: { x: -1, y: 1 } } }])
  },
  mlc_action_blur_in: {
    action: 'blur', category: 'entrance', duration: 0.7,
    parts: [{ el: 'TARGET_EL' }, 'をぼやけから出す'],
    toActions: () => ([
      { type: 'blur', params: { to: 0, from: { to: 12 } } },
      { type: 'fade', params: { to: 1, from: { to: 0 } } }
    ])
  },

  // 退場演出: 出現の逆。終わった状態（消えた状態）を保つ。
  mlc_action_fade_out: {
    action: 'fade', category: 'exit',
    parts: [{ el: 'TARGET_EL' }, 'をフェードアウトさせる'],
    toParams: () => ({ to: 0 })
  },
  mlc_action_zoom_out: {
    action: 'scale', category: 'exit',
    parts: [{ el: 'TARGET_EL' }, 'を縮めて消す'],
    toActions: () => ([
      { type: 'scale', params: { to: 0.6 } },
      { type: 'fade', params: { to: 0 } }
    ])
  },
  mlc_action_slide_out: {
    action: 'slide', category: 'exit',
    parts: _mlcMoveParts('を', 0, 80, ' 動かして消す'),
    toActions: b => ([
      { type: 'slide', params: _mlcMoveValues(b) },
      { type: 'fade', params: { to: 0 } }
    ])
  },

  // ずっと繰り返す演出。時間の欄は「1周にかかる秒数」になる。
  mlc_loop_pulse: {
    action: 'pulse', category: 'loop', duration: 1.2, easing: 'ease-in-out',
    parts: [{ el: 'TARGET_EL' }, 'をふわふわ拡大縮小させる 最大',
      { num: 'TO', def: 1.1, min: 0.1, max: 5, step: 0.05 }, '倍'],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  mlc_loop_spin: {
    action: 'spin', category: 'loop', duration: 2, easing: 'linear',
    parts: [{ el: 'TARGET_EL' }, 'をくるくる回し続ける 1周',
      { num: 'DEG', def: 360, min: -3600, max: 3600, step: 10 }, '度'],
    toParams: b => ({ deg: Number(b.getFieldValue('DEG')) })
  },
  mlc_loop_float: {
    action: 'float', category: 'loop', duration: 2.4, easing: 'ease-in-out',
    parts: _mlcMoveParts('を', 0, -12, ' まで ゆらゆら動かす'),
    toParams: _mlcMoveValues
  },
  mlc_loop_shake: {
    action: 'shake', category: 'loop', duration: 0.5, easing: 'ease-in-out',
    parts: _mlcMoveParts('を', 8, 0, ' の幅で 揺らし続ける'),
    toParams: _mlcMoveValues
  },
  mlc_loop_swing: {
    action: 'swing', category: 'loop', duration: 1.6, easing: 'ease-in-out',
    parts: [{ el: 'TARGET_EL' }, 'を振り子のように揺らす',
      { num: 'DEG', def: 8, min: 1, max: 180, step: 1 }, '度'],
    toParams: b => ({ deg: Number(b.getFieldValue('DEG')) })
  },
  mlc_loop_blink: {
    action: 'blink', category: 'loop', duration: 1, easing: 'ease-in-out',
    parts: [{ el: 'TARGET_EL' }, 'を点滅させる いちばん薄いとき',
      { num: 'TO', def: 0.2, min: 0, max: 1, step: 0.05 }],
    toParams: b => ({ to: Number(b.getFieldValue('TO')) })
  },
  // 線に沿って動かす。ペンや直線で描いた線を軌道として使う。
  // 線はレイヤーパネルで非表示にしておける（形だけが使われる）。
  mlc_loop_path: {
    action: 'path', category: 'loop', duration: 3, easing: 'linear',
    parts: [{ el: 'TARGET_EL' }, 'を', { line: 'PATH_EL' }, 'に沿って動かす'],
    tooltip: 'ペンや直線で描いた線を軌道にします。線はレイヤーパネルで非表示にしておけます。'
      + '「くり返し 1回」にすれば、一度だけ通ります。',
    toActions: _mlcPathActions
  },
  mlc_loop_bounce: {
    action: 'bounce', category: 'loop', duration: 1, easing: 'ease-out',
    parts: _mlcMoveParts('を', 0, -20, ' まで 跳ねさせる'),
    toParams: _mlcMoveValues
  }
};

// 図形のドロップダウン候補。Blocklyは空配列を許さないのでフォールバックを返す。
//   includeHidden: 非表示の図形も候補に入れる。
//     「変形」の行き先のように、見た目ではなく位置だけを使う欄で必要になる
//     （目印を非表示にしておきたいことが多いため）。
function mlcShapeDropdownOptions(includeHidden) {
  if (typeof ensureShapeIds === 'function') ensureShapeIds();
  const list = (typeof shapes !== 'undefined' ? shapes : []) || [];
  const opts = [];

  // グループは1つのオブジェクトとして選べるようにする
  // （拡大・移動などがグループ全体にまとまって効く）
  const groupCounts = new Map();
  list.forEach(s => {
    if (!s.groupId || (s.hidden && !includeHidden)) return;
    groupCounts.set(s.groupId, (groupCounts.get(s.groupId) || 0) + 1);
  });
  groupCounts.forEach((count, gid) => {
    opts.push(['グループ ' + count + '個 (' + String(gid).slice(-4) + ')', 'grp:' + gid]);
  });

  list.filter(s => includeHidden || !s.hidden).forEach(s => {
    const label = (s.name || s.type)
      + (s.groupId ? '（グループ内）' : '')
      + (s.hidden ? '（非表示）' : '')
      + ' (' + String(s.id || '').slice(-4) + ')';
    opts.push([label, String(s.id)]);
  });

  return opts.length ? opts : [['(図形がありません)', '']];
}

// ── 軌道（線に沿って動かす）────────────────────────────────
// 軌道に使えるのは線として描いたもの。目印にすることが多いので非表示も出す。
const MLC_PATH_SHAPE_TYPES = ['pen', 'line', 'brush'];
const MLC_PATH_MAX_POINTS = 36; // CSSに書くコマ数の上限（多すぎても見た目は変わらない）

function mlcLineDropdownOptions() {
  const list = (typeof shapes !== 'undefined' ? shapes : []) || [];
  const opts = list
    .filter(s => MLC_PATH_SHAPE_TYPES.includes(s.type))
    .map(s => [(s.name || s.type) + (s.hidden ? '（非表示）' : '') + ' (' + String(s.id || '').slice(-4) + ')', String(s.id)]);
  return opts.length ? opts : [['(線がありません)', '']];
}

// 線の形から、通る点を取り出す（多すぎるときは間引く）
function _mlcLinePoints(shape) {
  if (!shape) return [];
  if (shape.type === 'line') {
    return [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }];
  }
  const pts = Array.isArray(shape.pts) ? shape.pts : [];
  if (pts.length <= MLC_PATH_MAX_POINTS) return pts.slice();
  const out = [];
  for (let i = 0; i < MLC_PATH_MAX_POINTS; i++) {
    out.push(pts[Math.round((i / (MLC_PATH_MAX_POINTS - 1)) * (pts.length - 1))]);
  }
  return out;
}

// 「AをBの線に沿って動かす」。線の上の点を、Aの中心からのずれに直して持つ。
// ずれで持つので、あとから図形を動かしても軌道の形は崩れない。
function _mlcPathActions(block) {
  const from = _mlcShapeGeometry(block.getFieldValue('TARGET_EL'));
  const lineId = block.getFieldValue('PATH_EL');
  const line = (typeof shapes !== 'undefined' ? shapes : []).find(s => s.id === lineId);
  const pts = _mlcLinePoints(line);
  // 線が見つからない（消された・まだ選んでいない）ときは印を付ける
  if (!from || pts.length < 2) return [{ type: 'path', params: { points: [], missingRef: true } }];

  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const points = pts.map(p => [Math.round(p.x - cx), Math.round(p.y - cy)]);
  return [{ type: 'path', params: { points } }];
}

// 非表示の図形も含めた候補（Blocklyへは関数のまま渡すので、別名で用意する）
function mlcShapeDropdownOptionsAll() {
  return mlcShapeDropdownOptions(true);
}

// parts の並びをブロックの入力行に流し込む
function _mlcAppendParts(block, input, parts) {
  parts.forEach(part => {
    if (typeof part === 'string') { input.appendField(part); return; }
    if (part.line) { input.appendField(new Blockly.FieldDropdown(mlcLineDropdownOptions), part.line); return; }
    if (part.el) {
      const options = part.includeHidden ? mlcShapeDropdownOptionsAll : mlcShapeDropdownOptions;
      input.appendField(new Blockly.FieldDropdown(options), part.el);
      return;
    }
    if (part.num) { input.appendField(new Blockly.FieldNumber(part.def, part.min, part.max, part.step), part.num); return; }
    if (part.menu) { input.appendField(new Blockly.FieldDropdown(part.options), part.menu); return; }
    if (part.text) { input.appendField(new Blockly.FieldTextInput(part.def || ''), part.text); return; }
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
        // ずっと動く系にとっての「時間」は1周にかかる秒数なので、そう見せる
        this.appendDummyInput()
          .appendField(spec.category === 'loop' ? '1周' : '時間')
          .appendField(new Blockly.FieldNumber(spec.duration ?? 0.4, 0, 60, 0.05), 'DURATION')
          .appendField('秒 遅れ')
          .appendField(new Blockly.FieldNumber(0, 0, 60, 0.05), 'DELAY')
          .appendField('秒')
          .appendField(new Blockly.FieldDropdown(MLC_EASING_OPTIONS), 'EASING');
        if (spec.easing) this.setFieldValue(spec.easing, 'EASING');
        // ずっと動く系だけ、くり返し方を選べるようにする
        if (spec.category === 'loop') {
          this.appendDummyInput()
            .appendField('くり返し')
            .appendField(new Blockly.FieldNumber(0, 0, 9999, 1), 'REPEAT')
            .appendField('回（0でずっと）')
            .appendField(new Blockly.FieldDropdown([['片道', 'normal'], ['往復', 'alternate']]), 'DIRECTION');
        }
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour(MLC_CATEGORY_COLOUR[spec.category] ?? MLC_CATEGORY_COLOUR.action);
        this.setTooltip(spec.tooltip || (spec.category === 'loop'
          ? 'トリガーがクリックなら「動き出す/止まる」の切り替えになります'
          : '動かす対象は、トリガーとは別の図形も選べます'));
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
        this.setColour(MLC_FLOW_COLOUR[spec.group] ?? 20);
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
      { kind: 'category', name: 'アクション', colour: String(MLC_CATEGORY_COLOUR.action), contents: blocksIn(MLC_ACTION_BLOCKS, s => s.category === 'action') },
      { kind: 'category', name: '出現', colour: String(MLC_CATEGORY_COLOUR.entrance), contents: blocksIn(MLC_ACTION_BLOCKS, s => s.category === 'entrance') },
      { kind: 'category', name: '退場', colour: String(MLC_CATEGORY_COLOUR.exit), contents: blocksIn(MLC_ACTION_BLOCKS, s => s.category === 'exit') },
      { kind: 'category', name: 'ずっと動く', colour: String(MLC_CATEGORY_COLOUR.loop), contents: blocksIn(MLC_ACTION_BLOCKS, s => s.category === 'loop') },
      { kind: 'category', name: '時間', colour: String(MLC_FLOW_COLOUR.time), contents: blocksIn(MLC_FLOW_BLOCKS, s => s.group === 'time') },
      { kind: 'category', name: 'ページ', colour: String(MLC_FLOW_COLOUR.page), contents: blocksIn(MLC_FLOW_BLOCKS, s => s.group === 'page') },
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
            actionParams: aSpec.toParams ? aSpec.toParams(block) : {},
            actions: aSpec.toActions ? aSpec.toActions(block) : null,
            duration: Number(block.getFieldValue('DURATION')),
            delay: Number(block.getFieldValue('DELAY')),
            easing: block.getFieldValue('EASING'),
            repeat: Number(block.getFieldValue('REPEAT')) || 0,
            direction: block.getFieldValue('DIRECTION') || 'normal'
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
      actionParams: aSpec.toParams ? aSpec.toParams(block) : {},
      actions: aSpec.toActions ? aSpec.toActions(block) : null,
      duration: Number(block.getFieldValue('DURATION')),
      delay: Number(block.getFieldValue('DELAY')),
      easing: block.getFieldValue('EASING'),
      repeat: Number(block.getFieldValue('REPEAT')) || 0,
      direction: block.getFieldValue('DIRECTION') || 'normal'
    });
    rule.jsDriven = true;
    rules.push(rule);
    covered.add(id);
  });

  return rules;
}
