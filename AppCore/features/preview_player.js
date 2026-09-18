// ══════════════════════════════════════════════════════════════
// プレビューの再生バー
//   キャンバスタブで動いているアニメーションを、最初から再生したり、
//   途中で止めたり、つまみで好きな位置まで進めたりする。
//
//   動きはすべてCSSアニメーションなので、ブラウザが持っている
//   Animation（getAnimations）をそのまま操作している。
//   自前の再生処理を作らないので、書き出したページと同じものを見られる。
//
//   スクロールで進むもの（スクロール連動）は、時間ではなくスクロール位置で
//   決まるため、ここでは触らない。
// ══════════════════════════════════════════════════════════════

let _previewPaused = false;

// ステージの中で動いているアニメーション。
// scrollTimeline のものはスクロールが決めるので外す。
function previewAnimations() {
  const stage = document.getElementById('mlc-stage');
  if (!stage || typeof stage.getAnimations !== 'function') return [];
  return stage.getAnimations({ subtree: true }).filter(a => {
    const name = a.timeline && a.timeline.constructor && a.timeline.constructor.name;
    return name !== 'ScrollTimeline' && name !== 'ViewTimeline';
  });
}

// 1周にかかる時間（ミリ秒）。無限に繰り返すものは1周ぶんを使う。
function _previewCycleMs(anim) {
  try {
    const t = anim.effect.getComputedTiming();
    const d = Number(t.duration);
    const delay = Number(t.delay) || 0;
    return (Number.isFinite(d) ? d : 1000) + delay;
  } catch (e) {
    return 1000;
  }
}

// いちばん長いものに合わせてバーの目盛りを決める
function previewTotalMs() {
  return previewAnimations().reduce((max, a) => Math.max(max, _previewCycleMs(a)), 0) || 1000;
}

function previewSeek(ratio) {
  const p = Math.max(0, Math.min(1, Number(ratio) || 0));
  const total = previewTotalMs();
  previewAnimations().forEach(a => {
    try {
      const ms = Math.min(p * total, _previewCycleMs(a));
      a.currentTime = ms;
      a.pause();
    } catch (e) { /* 触れないものは飛ばす */ }
  });
  _previewPaused = true;
  _syncPlayerUi(p);
}

function previewTogglePlay() {
  _previewPaused = !_previewPaused;
  previewAnimations().forEach(a => {
    try { if (_previewPaused) a.pause(); else a.play(); } catch (e) { /* noop */ }
  });
  _syncPlayerUi();
}

// 最初から流し直す。状態クラスで動くもの（クリックで動く演出）は
// ミラーを作り直してから流すと、確実に最初の状態へ戻る。
function previewReplay() {
  if (typeof applyInteractions === 'function') applyInteractions();
  setTimeout(() => {
    previewAnimations().forEach(a => {
      try { a.cancel(); a.play(); } catch (e) { /* noop */ }
    });
    _previewPaused = false;
    _syncPlayerUi(0);
  }, 30);
}

function _syncPlayerUi(ratio) {
  const btn = document.getElementById('mp-play-btn');
  if (btn) {
    btn.innerHTML = '<i class="ti ' + (_previewPaused ? 'ti-player-play' : 'ti-player-pause') + '"></i>';
    btn.title = _previewPaused ? '再生' : '一時停止';
  }
  const range = document.getElementById('mp-play-range');
  const label = document.getElementById('mp-play-val');
  if (ratio != null && range) range.value = Math.round(ratio * 100);
  if (label && range) label.textContent = range.value + '%';
}

// 再生中は、つまみを動きに合わせて進める
function _previewTick() {
  if (!_previewPaused) {
    const range = document.getElementById('mp-play-range');
    const panel = document.getElementById('canvas-preview-panel');
    if (range && panel && panel.classList.contains('active')) {
      const list = previewAnimations();
      if (list.length) {
        const total = previewTotalMs();
        const now = list.reduce((max, a) => {
          const t = Number(a.currentTime) || 0;
          return Math.max(max, t % (_previewCycleMs(a) || 1));
        }, 0);
        range.value = Math.round(Math.min(1, now / total) * 100);
        const label = document.getElementById('mp-play-val');
        if (label) label.textContent = range.value + '%';
      }
    }
  }
  requestAnimationFrame(_previewTick);
}

function initPreviewPlayer() {
  const actions = document.querySelector('#canvas-preview-header .cp-actions');
  if (!actions || document.getElementById('mp-play-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'mp-play-bar';
  bar.innerHTML = '<button id="mp-replay-btn" title="最初から再生"><i class="ti ti-player-track-prev"></i></button>'
    + '<button id="mp-play-btn" title="一時停止"><i class="ti ti-player-pause"></i></button>'
    + '<input type="range" id="mp-play-range" min="0" max="100" step="1" value="0" title="動きの途中まで進める">'
    + '<span id="mp-play-val">0%</span>';
  actions.insertBefore(bar, actions.firstChild);

  bar.querySelector('#mp-replay-btn').onclick = previewReplay;
  bar.querySelector('#mp-play-btn').onclick = previewTogglePlay;
  bar.querySelector('#mp-play-range').addEventListener('input', e => previewSeek(e.target.value / 100));

  requestAnimationFrame(_previewTick);
}

window.previewReplay = previewReplay;
window.previewTogglePlay = previewTogglePlay;
window.previewSeek = previewSeek;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPreviewPlayer);
} else {
  initPreviewPlayer();
}
