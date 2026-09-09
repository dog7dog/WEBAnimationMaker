// ==========================================
// 0. Cannon.js の動的読み込み処理
// ==========================================
if (typeof CANNON === 'undefined') {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/cannon@0.6.2/build/cannon.min.js';
  script.onload = () => {
    initGame();
  };
  document.head.appendChild(script);
} else {
  initGame();
}

let rafId;
let hud;

function initGame() {
  const oldHud = document.getElementById('race-hud');
  if (oldHud) oldHud.remove();

  // Three.js設定
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa0a0a0);
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(width, height, false);

  // 物理世界（CANNON）の作成
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  world.broadphase = new CANNON.NaiveBroadphase();

  // ライト
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);
  scene.add(new THREE.AmbientLight(0x505050));

  let lap = 0;
  let passedCheckpoint = false;

  // スピードメーター（UI）
  hud = document.createElement('div');
  hud.id = 'race-hud';
  hud.style.position = 'absolute';
  hud.style.top = '20px';
  hud.style.left = '20px';
  hud.style.color = '#fff';
  hud.style.fontFamily = 'monospace';
  hud.style.fontSize = '20px';
  hud.style.background = 'rgba(0,0,0,0.5)';
  hud.style.padding = '10px';
  hud.style.borderRadius = '5px';
  hud.style.pointerEvents = 'none';
  hud.innerHTML = 'SPEED: 0 km/h<br>LAP: 0/1<br>STATUS: READY';
  document.body.appendChild(hud);

  // コース設定
  const trackRadiusX = 150;
  const trackRadiusZ = 250;
  const roadWidth = 20;

  // 物理地面（CANNON）
  const groundMaterial = new CANNON.Material();
  const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(groundBody);

  // 車と地面の摩擦をゼロにする（平らな面同士の摩擦は接地面全体に効いて
  // ほぼロックしてしまうため。減速はlinearDamping/angularDampingで表現する）
  const carMaterial = new CANNON.Material();
  world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial, carMaterial, { friction: 0, restitution: 0 }));

  // 見た目地面（Three.js）
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ color: 0x33aa33 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // 楕円形状の道路
  // ExtrudeGeometryのextrudePathは3Dカーブが必要（EllipseCurveは2Dのみで法線計算がNaNになる）ため、
  // 同じ楕円軌道をVector3点列からCatmullRomCurve3として作る
  const trackPoints = [];
  for (let i = 0; i <= 100; i++) {
    const t = (i / 100) * Math.PI * 2;
    trackPoints.push(new THREE.Vector3(Math.cos(t) * trackRadiusX, Math.sin(t) * trackRadiusZ, 0));
  }
  const trackPath = new THREE.CatmullRomCurve3(trackPoints, true);
  const extrudeSettings = { steps: 100, bevelEnabled: false, extrudePath: trackPath };
  const roadShape = new THREE.Shape();
  roadShape.moveTo(-roadWidth / 2, 0);
  roadShape.lineTo(roadWidth / 2, 0);
  const roadExtrudeGeo = new THREE.ExtrudeGeometry(roadShape, extrudeSettings);
  const road = new THREE.Mesh(roadExtrudeGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  scene.add(road);

  // ゲート
  const gateGroup = new THREE.Group();
  const line = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.02;
  gateGroup.add(line);
  const archGeo = new THREE.BoxGeometry(1, 10, 1);
  const archLeft = new THREE.Mesh(archGeo, new THREE.MeshLambertMaterial({ color: 0x555555 }));
  archLeft.position.set(-roadWidth / 2 - 1, 5, 0);
  const archRight = archLeft.clone();
  archRight.position.x = roadWidth / 2 + 1;
  const archTop = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 3, 1, 1), new THREE.MeshLambertMaterial({ color: 0xcc1111 }));
  archTop.position.set(0, 10, 0);
  gateGroup.add(archLeft, archRight, archTop);
  gateGroup.position.set(trackRadiusX, 0, 0);
  scene.add(gateGroup);

  // 4. 物理障害物（赤ドラム缶）
  const obstacles = [];
  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2 + (Math.random() * 0.1);
    if (angle < 0.2 || angle > Math.PI * 2 - 0.2) continue;

    const ox = Math.cos(angle) * trackRadiusX + (Math.random() - 0.5) * (roadWidth - 4);
    const oz = Math.sin(angle) * trackRadiusZ + (Math.random() - 0.5) * (roadWidth - 4);

    // 古いCANNONの引数指定（上面半径, 下面半径, 高さ, 分割数）
    const obsShape = new CANNON.Cylinder(1, 1, 3, 8);
    const obsBody = new CANNON.Body({ mass: 15 });
    obsBody.addShape(obsShape);
    obsBody.position.set(ox, 1.5, -oz);
    world.addBody(obsBody);

    const obsMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 8), new THREE.MeshLambertMaterial({ color: 0xff3333 }));
    scene.add(obsMesh);

    obstacles.push({ body: obsBody, mesh: obsMesh });
  }

  // 5. 車を作る関数
  function createPhysicsCar(color, startX, startZ, mass) {
    // 古いCANNONのBoxサイズ指定（Vec3の代わりにCANNON.Vec3、サイズは半分の値を指定）
    const carShape = new CANNON.Box(new CANNON.Vec3(1, 0.3, 2));
    const carBody = new CANNON.Body({ mass: mass, material: carMaterial });
    carBody.addShape(carShape);
    carBody.position.set(startX, 1, startZ);
    carBody.linearDamping = 0.1;
    carBody.angularDamping = 0.5;
    world.addBody(carBody);

    const carGroup = new THREE.Group();
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 4), new THREE.MeshLambertMaterial({ color: color }));
    bodyMesh.position.y = 0.3;
    carGroup.add(bodyMesh);

    const wGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 12);
    const wMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const wPos = [[-1.1, 0.2, 1.2], [1.1, 0.2, 1.2], [-1.1, 0.2, -1.2], [1.1, 0.2, -1.2]];
    wPos.forEach(([x, y, z]) => {
      const w = new THREE.Mesh(wGeo, wMat);
      w.position.set(x, y, z);
      w.rotation.z = Math.PI / 2;
      carGroup.add(w);
    });
    scene.add(carGroup);

    return { body: carBody, mesh: carGroup };
  }

  const playerCar = createPhysicsCar(0x1177ff, trackRadiusX, 0, 800);
  const enemyCar = createPhysicsCar(0xffaa00, trackRadiusX - 4, -20, 900);

  let enemyProgress = 0.02;
  const enemyBaseSpeed = 0.0004;

  // キー操作
  const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
  const onKeyDown = (e) => { if (e.key in keys) { keys[e.key] = true; e.preventDefault(); } };
  const onKeyUp = (e) => { if (e.key in keys) { keys[e.key] = false; e.preventDefault(); } };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function handleReset(msg) {
    playerCar.body.position.set(trackRadiusX, 1, 0);
    playerCar.body.velocity.set(0, 0, 0);
    playerCar.body.angularVelocity.set(0, 0, 0);
    playerCar.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), 0);

    if (hud) hud.innerHTML = `SPEED: 0 km/h<br>LAP: ${lap}/1<br>STATUS: ${msg}`;
  }

  const fixedTimeStep = 1.0 / 60.0;
  let flipTimer = 0;

  function animate() {
    rafId = requestAnimationFrame(animate);

    world.step(fixedTimeStep);

    const carQuat = playerCar.body.quaternion;
    const forward = new CANNON.Vec3(0, 0, 1);
    const forwardVector = carQuat.vmult(forward);
    const currentSpeed = playerCar.body.velocity.dot(forwardVector);

    if (keys.ArrowUp) {
      if (currentSpeed < 45) {
        const force = forwardVector.scale(15000);
        playerCar.body.applyForce(force, playerCar.body.position);
      }
    } else if (keys.ArrowDown) {
      if (currentSpeed > -15) {
        const force = forwardVector.scale(-8000);
        playerCar.body.applyForce(force, playerCar.body.position);
      }
    }

    if (Math.abs(currentSpeed) > 1) {
      const turnSign = currentSpeed > 0 ? 1 : -1;
      if (keys.ArrowLeft) {
        playerCar.body.angularVelocity.y = 2.0 * turnSign;
      } else if (keys.ArrowRight) {
        playerCar.body.angularVelocity.y = -2.0 * turnSign;
      } else {
        playerCar.body.angularVelocity.y *= 0.9;
      }
    }

    enemyProgress += enemyBaseSpeed;
    if (enemyProgress > 1) enemyProgress -= 1;
    const enemyAngle = enemyProgress * Math.PI * 2;
    const ex = Math.cos(enemyAngle) * trackRadiusX;
    const ez = -Math.sin(enemyAngle) * trackRadiusZ;

    enemyCar.body.position.set(ex, 0.5, ez);
    const nextEnemyAngle = (enemyProgress + 0.001) * Math.PI * 2;
    const nex = Math.cos(nextEnemyAngle) * trackRadiusX;
    const nez = -Math.sin(nextEnemyAngle) * trackRadiusZ;
    enemyCar.mesh.lookAt(new THREE.Vector3(nex, 0.5, nez));

    playerCar.mesh.position.copy(playerCar.body.position);
    playerCar.mesh.quaternion.copy(playerCar.body.quaternion);
    enemyCar.mesh.position.copy(enemyCar.body.position);

    obstacles.forEach(obs => {
      obs.mesh.position.copy(obs.body.position);
      obs.mesh.quaternion.copy(obs.body.quaternion);
    });

    const pPos = playerCar.body.position;
    if (pPos.z < -trackRadiusZ + 30) passedCheckpoint = true;

    if (passedCheckpoint && Math.abs(pPos.z) < 5 && pPos.x > trackRadiusX - 15) {
      lap++;
      passedCheckpoint = false;
      if (lap >= 1) {
        if (hud) hud.innerHTML = `SPEED: 0 km/h<br>LAP: ${lap}/1<br>STATUS: GOAL!!`;
        setTimeout(() => { lap = 0; handleReset('RESTART'); }, 3000);
      }
    }

    if (Math.abs(playerCar.mesh.rotation.x) > 1.5 || Math.abs(playerCar.mesh.rotation.z) > 1.5) {
      flipTimer++;
      if (flipTimer > 120) {
        handleReset('RECOVERED!');
        flipTimer = 0;
      }
    } else {
      flipTimer = 0;
    }

    const displaySpeed = Math.round(Math.abs(currentSpeed) * 3.6);
    if (lap < 1 && hud) {
      hud.innerHTML = `SPEED: ${displaySpeed} km/h<br>LAP: ${lap}/1<br>STATUS: RUNNING`;
    }

    const targetCamPos = playerCar.mesh.position.clone().add(new THREE.Vector3(0, 5, -12).applyQuaternion(playerCar.mesh.quaternion));
    camera.position.lerp(targetCamPos, 0.1);
    camera.lookAt(playerCar.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)));

    renderer.render(scene, camera);
  }
  animate();

  // 後片付け関数
  window.__threeCleanup = () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    world.clearForces();
    while (world.bodies.length > 0) { world.removeBody(world.bodies[0]); }
    renderer.dispose();
  };
}
