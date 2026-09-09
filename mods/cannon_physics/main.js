(function () {
  const api = window.AnimationApp;
  if (!api) return;

  api.registerMod({
    id: 'cannon_physics',
    name: '物理演算 (Cannon.js) MOD',
    level: 2,
    description: 'cannon-es による2D物理シミュレーション。四角形・円を剛体/床としてタグ付けし再生できます。'
  });

  const CANNON_CDN = 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm';
  const GRAVITY_DEFAULT = 800;
  const RESTITUTION_DEFAULT = 0.4;

  let CANNON = null;
  let world = null;
  let bodies = [];      // [{ shape, body }]
  let running = false;
  let rafId = null;
  let lastTs = 0;
  let snapshot = null;  // 再生開始前の状態（リセット用）
  let gravityVal = GRAVITY_DEFAULT;
  let eulerScratch = null;

  function isPhysicsSupported(s) {
    return s && !s.hidden && (s.type === 'rect' || s.type === 'circle');
  }

  async function loadCannon() {
    if (CANNON) return CANNON;
    api.setStatus('cannon-es を読み込み中...');
    CANNON = await import(CANNON_CDN);
    return CANNON;
  }

  // ── 図形へのタグ付け ─────────────────────────────────────────
  function tagShape(kind) {
    const s = api.getSelected();
    if (!s) { api.toast('ti-alert-triangle', '図形を選択してください'); return; }
    if (!isPhysicsSupported(s)) { api.toast('ti-alert-triangle', '四角形・円のみ対応しています'); return; }
    s.physicsBody = (s.physicsBody === kind) ? null : kind;
    api.redraw();
    refreshTagButtons();
    api.toast('ti-atom', s.physicsBody
      ? `「${s.name || s.type}」を${kind === 'static' ? '床' : '剛体'}にしました`
      : 'タグを解除しました');
  }

  function refreshTagButtons() {
    const s = api.getSelected();
    const rbBtn = document.getElementById('cn-tag-rb');
    const floorBtn = document.getElementById('cn-tag-floor');
    if (rbBtn) rbBtn.classList.toggle('cn-tag-active-rb', !!s && s.physicsBody === 'dynamic');
    if (floorBtn) floorBtn.classList.toggle('cn-tag-active-floor', !!s && s.physicsBody === 'static');
  }

  // ── Cannonボディの構築 ───────────────────────────────────────
  function buildBody(s, restitutionVal) {
    let shape;
    if (s.type === 'rect') {
      shape = new CANNON.Box(new CANNON.Vec3(Math.max(1, s.w / 2), Math.max(1, s.h / 2), 10));
    } else {
      const r = Math.max(1, ((s.rx || 10) + (s.ry || 10)) / 2);
      shape = new CANNON.Sphere(r);
    }

    const isStatic = s.physicsBody === 'static';
    const center = api.getCenter(s);
    const body = new CANNON.Body({
      mass: isStatic ? 0 : 1,
      shape,
      position: new CANNON.Vec3(center.x, center.y, 0),
      material: new CANNON.Material({ friction: 0.3, restitution: restitutionVal }),
      quaternion: new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), (s.rot || 0) * Math.PI / 180)
    });
    // Z軸方向の並進・X/Y軸周りの回転を封じ、2D的な挙動にする
    body.linearFactor.set(1, 1, 0);
    body.angularFactor.set(0, 0, 1);
    return body;
  }

  function takeSnapshot(targets) {
    snapshot = targets.map(s => ({ s, x: s.x, y: s.y, cx: s.cx, cy: s.cy, rot: s.rot }));
  }

  function restoreSnapshot() {
    if (!snapshot) return;
    snapshot.forEach(({ s, x, y, cx, cy, rot }) => {
      if (x !== undefined) s.x = x;
      if (y !== undefined) s.y = y;
      if (cx !== undefined) s.cx = cx;
      if (cy !== undefined) s.cy = cy;
      s.rot = rot;
    });
    api.redraw();
  }

  // ── 再生 / 停止 / リセット ───────────────────────────────────
  async function startPhysicsSim() {
    if (running) return;
    await loadCannon();

    const targets = shapes.filter(s => isPhysicsSupported(s) && s.physicsBody);
    if (!targets.length) {
      api.toast('ti-alert-triangle', '「剛体」または「床」のタグが付いた図形がありません');
      return;
    }

    takeSnapshot(targets);

    const restitutionInput = document.getElementById('cn-restitution');
    const restitutionVal = restitutionInput ? Number(restitutionInput.value) / 100 : RESTITUTION_DEFAULT;

    world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravityVal, 0) });
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    eulerScratch = new CANNON.Vec3();

    bodies = targets.map(s => {
      const body = buildBody(s, restitutionVal);
      world.addBody(body);
      return { shape: s, body };
    });

    running = true;
    physicsRunning = true;
    lastTs = 0;
    rafId = requestAnimationFrame(stepPhysics);
    api.setStatus('物理演算を再生中... (' + targets.length + '個)');
  }

  function stepPhysics(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    world.step(1 / 60, dt, 5);

    bodies.forEach(({ shape: s, body }) => {
      body.quaternion.toEuler(eulerScratch);
      const rotDeg = eulerScratch.z * 180 / Math.PI;

      if (s.type === 'rect') {
        s.x = body.position.x - s.w / 2;
        s.y = body.position.y - s.h / 2;
        s.rot = rotDeg;
      } else if (s.type === 'circle') {
        s.cx = body.position.x;
        s.cy = body.position.y;
        s.rot = rotDeg;
      }
    });

    redraw();
    rafId = requestAnimationFrame(stepPhysics);
  }

  function stopPhysicsSim() {
    if (!running) return;
    running = false;
    physicsRunning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    api.setStatus('物理演算を停止しました');
  }

  function resetPhysicsSim() {
    stopPhysicsSim();
    restoreSnapshot();
    api.setStatus('物理演算をリセットしました');
  }

  // ── ツールバーUI ─────────────────────────────────────────────
  api.registerUI({
    id: 'cannon-toolbar',
    position: 'top',
    html: `
      <div class="tb-sep"></div>
      <button class="tb-btn" id="cn-tag-rb" title="選択した図形を剛体にする（四角形・円のみ）">
        <i class="ti ti-circle-dot"></i> 剛体
      </button>
      <button class="tb-btn" id="cn-tag-floor" title="選択した図形を床（静止）にする">
        <i class="ti ti-line"></i> 床
      </button>
      <button class="tb-btn accent" id="cn-play" title="物理演算を再生">
        <i class="ti ti-player-play"></i>
      </button>
      <button class="tb-btn" id="cn-stop" title="停止"><i class="ti ti-player-pause"></i></button>
      <button class="tb-btn" id="cn-reset" title="位置をリセット"><i class="ti ti-refresh"></i></button>
      <span class="cn-field" title="重力 (px/s²)">
        <i class="ti ti-arrow-down"></i>
        <input type="number" id="cn-gravity" value="${GRAVITY_DEFAULT}" min="0" max="3000" step="50">
      </span>
      <span class="cn-field" title="反発係数 (%)">
        <i class="ti ti-bounce-right"></i>
        <input type="number" id="cn-restitution" value="${Math.round(RESTITUTION_DEFAULT * 100)}" min="0" max="100" step="5">
      </span>
    `,
    onMount(el) {
      el.querySelector('#cn-tag-rb').addEventListener('click', () => tagShape('dynamic'));
      el.querySelector('#cn-tag-floor').addEventListener('click', () => tagShape('static'));
      el.querySelector('#cn-play').addEventListener('click', startPhysicsSim);
      el.querySelector('#cn-stop').addEventListener('click', stopPhysicsSim);
      el.querySelector('#cn-reset').addEventListener('click', resetPhysicsSim);
      el.querySelector('#cn-gravity').addEventListener('change', e => {
        gravityVal = Number(e.target.value) || 0;
        if (world) world.gravity.set(0, gravityVal, 0);
      });
    }
  });

  // 選択が変わるたびにタグボタンのハイライトを更新
  const cv = document.getElementById('cv');
  cv?.addEventListener('mouseup', () => setTimeout(refreshTagButtons, 0));
  document.addEventListener('keyup', () => setTimeout(refreshTagButtons, 0));
})();
