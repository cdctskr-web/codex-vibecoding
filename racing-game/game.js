/* global THREE */
(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const ui = {
    mount: $('#game-canvas'), start: $('#start-screen'), finish: $('#finish-screen'),
    startButton: $('#start-button'), restart: $('#restart-button'), countdown: $('#countdown'),
    speed: $('#speed'), position: $('#position'), lap: $('#lap'), time: $('#time'),
    boostFill: $('#boost-fill'), boostValue: $('#boost-value'), leaderboard: $('#leaderboard'),
    rankSummary: $('#rank-summary'), toast: $('#event-toast'), finishTitle: $('#finish-title'),
    finishMessage: $('#finish-message'), finishTime: $('#finish-time'), sound: $('#sound-button'),
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x061126);
  scene.fog = new THREE.FogExp2(0x071328, 0.012);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  ui.mount.appendChild(renderer.domElement);
  const clock = new THREE.Clock();

  const trackPoints = [
    new THREE.Vector3(-4, 0, 52), new THREE.Vector3(36, 0, 56), new THREE.Vector3(72, 0, 27),
    new THREE.Vector3(68, 0, -21), new THREE.Vector3(38, 0, -51), new THREE.Vector3(-9, 0, -58),
    new THREE.Vector3(-57, 0, -43), new THREE.Vector3(-75, 0, -5), new THREE.Vector3(-57, 0, 34),
    new THREE.Vector3(-30, 0, 49),
  ];
  const curve = new THREE.CatmullRomCurve3(trackPoints, true, 'catmullrom', .22);
  const samples = 260;
  const roadWidth = 13;
  const trackLength = curve.getLength();
  const raceStartT = .017;
  const keys = new Set();
  const cars = [];
  let state = 'intro';
  let elapsed = 0;
  let toastTimer = 0;
  let lastRank = 1;
  let countdownTimer = null;

  const player = { name: 'YOU', color: 0x48e9ff, t: raceStartT, raceProgress: 0, lap: 0, lane: 0, speed: 0, boost: 100, finishedAt: null, group: null };
  const rivals = [
    { name: 'KIRA', color: 0xff4e71, t: .997, raceProgress: -.02, lap: 0, lane: -2.4, pace: 52, speed: 0, wobble: .46, finishedAt: null },
    { name: 'VOLT', color: 0xffc94a, t: .972, raceProgress: -.045, lap: 0, lane: 2.1, pace: 50, speed: 0, wobble: 1.7, finishedAt: null },
    { name: 'NOVA', color: 0x9b7dff, t: .946, raceProgress: -.07, lap: 0, lane: -.2, pace: 48, speed: 0, wobble: 2.9, finishedAt: null },
  ];

  function makeRoad() {
    const positions = [], uvs = [], indices = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
      const left = point.clone().addScaledVector(normal, roadWidth / 2);
      const right = point.clone().addScaledVector(normal, -roadWidth / 2);
      positions.push(left.x, .02, left.z, right.x, .02, right.z);
      uvs.push(0, i / 6, 1, i / 6);
    }
    for (let i = 0; i < samples; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x17223a, roughness: .78, metalness: .28, side: THREE.DoubleSide })));

    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x9db4db, transparent: true, opacity: .44 });
    for (let i = 0; i < samples; i += 4) {
      const a = curve.getPointAt(i / samples);
      const b = curve.getPointAt((i + 2) / samples);
      const tangent = curve.getTangentAt(i / samples).normalize();
      const marker = new THREE.Mesh(new THREE.BoxGeometry(.23, .026, a.distanceTo(b) * .62), markerMaterial);
      marker.position.copy(a).lerp(b, .5);
      marker.position.y = .055;
      marker.rotation.y = Math.atan2(tangent.x, tangent.z);
      scene.add(marker);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < samples; i += 2) {
        const t = i / samples;
        const point = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t).normalize();
        const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
        const red = (i / 2) % 2;
        const curb = new THREE.Mesh(
          new THREE.BoxGeometry(1.15, .17, trackLength / samples * 2.15),
          new THREE.MeshStandardMaterial({ color: red ? 0xff496c : 0xf1f4ff, emissive: red ? 0x32030a : 0x121827, emissiveIntensity: .25, roughness: .6 }),
        );
        curb.position.copy(point).addScaledVector(normal, side * (roadWidth / 2 + .5));
        curb.position.y = .1;
        curb.rotation.y = Math.atan2(tangent.x, tangent.z);
        scene.add(curb);
      }
    }
  }

  function addGate() {
    const p = curve.getPointAt(.006);
    const tangent = curve.getTangentAt(.006).normalize();
    const group = new THREE.Group();
    group.position.copy(p);
    group.rotation.y = Math.atan2(tangent.x, tangent.z);
    const metal = new THREE.MeshStandardMaterial({ color: 0x12182a, emissive: 0x143c54, emissiveIntensity: .75, metalness: .7 });
    for (const x of [-roadWidth / 2 - 1, roadWidth / 2 + 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.65, 6, .65), metal);
      post.position.set(x, 3, 0);
      group.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 3, .65, .75), metal);
    top.position.y = 5.8;
    group.add(top);
    for (let i = -5; i <= 5; i++) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(.75, .17, .1), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff4569 : 0x5aeaff }));
      light.position.set(i * 1.5, 5.8, .42);
      group.add(light);
    }
    scene.add(group);
  }

  function addEnvironment() {
    scene.add(new THREE.HemisphereLight(0x7199df, 0x08101e, 1.65));
    const moon = new THREE.DirectionalLight(0x9bc5ff, 1.6);
    moon.position.set(-70, 85, 30);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    scene.add(moon);
    const pink = new THREE.PointLight(0xff3767, 4, 95); pink.position.set(20, 15, -22); scene.add(pink);
    const cyan = new THREE.PointLight(0x20c9ff, 3, 75); cyan.position.set(-30, 9, 48); scene.add(cyan);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ color: 0x091b2a, roughness: .98 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(350, 35, 0x14314a, 0x0c2537);
    grid.position.y = .01;
    grid.material.opacity = .23;
    grid.material.transparent = true;
    scene.add(grid);
    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x0a172c, roughness: 1 });
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      const radius = 116 + (i % 3) * 12;
      const height = 12 + (i % 5) * 7;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(10 + (i % 4) * 5, height, 5), mountainMaterial);
      rock.position.set(Math.cos(angle) * radius, height / 2 - .2, Math.sin(angle) * radius);
      rock.rotation.y = angle;
      scene.add(rock);
    }
    for (let i = 0; i < 42; i++) {
      const angle = i / 42 * Math.PI * 2 + .11;
      const radius = 92 + ((i * 17) % 17);
      const height = 6 + (i * 11) % 27;
      const width = 3 + (i % 3) * 2;
      const material = new THREE.MeshStandardMaterial({ color: 0x101d35, emissive: i % 3 ? 0x071429 : 0x20112d, emissiveIntensity: .6, roughness: .75 });
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, width), material);
      building.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
      scene.add(building);
    }
    const stars = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < 430; i++) {
      const radius = 160 + Math.random() * 160;
      const angle = Math.random() * Math.PI * 2;
      starPositions.push(Math.cos(angle) * radius, 22 + Math.random() * 100, Math.sin(angle) * radius);
    }
    stars.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xb8d9ff, size: .65, sizeAttenuation: true })));
    addGate();
  }

  function makeCar(color, isPlayer) {
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, metalness: .76, roughness: .26, emissive: color, emissiveIntensity: .13 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x071019, metalness: .8, roughness: .22 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, .53, 4.2), paint);
    body.position.y = .66;
    body.castShadow = true;
    group.add(body);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.88, .18, 1.4), paint);
    hood.position.set(0, .97, .85);
    hood.rotation.x = -.12;
    group.add(hood);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.63, .65, 1.65), dark);
    cabin.position.set(0, 1.11, -.38);
    cabin.rotation.x = -.12;
    group.add(cabin);
    const under = new THREE.Mesh(new THREE.BoxGeometry(2.32, .14, 4.35), new THREE.MeshBasicMaterial({ color: 0x02050c }));
    under.position.y = .31;
    group.add(under);
    for (const x of [-1.13, 1.13]) for (const z of [-1.34, 1.34]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .32, 12), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, .42, z);
      group.add(wheel);
    }
    const tailLight = new THREE.Mesh(new THREE.BoxGeometry(1.65, .13, .12), new THREE.MeshBasicMaterial({ color }));
    tailLight.position.set(0, .67, -2.11);
    group.add(tailLight);
    if (isPlayer) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(.3, .06, 3.7), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stripe.position.set(0, .96, 0);
      group.add(stripe);
    }
    const glow = new THREE.PointLight(color, isPlayer ? 2.3 : 1.1, isPlayer ? 11 : 7);
    glow.position.set(0, .65, -2.5);
    group.add(glow);
    scene.add(group);
    return group;
  }

  function getTrackPoint(car) {
    const t = (car.t + 1) % 1;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const normal = new THREE.Vector3(tangent.z, 0, -tangent.x);
    point.addScaledVector(normal, car.lane);
    return { point, tangent, normal };
  }

  function updateCarTransform(car) {
    const { point, tangent } = getTrackPoint(car);
    car.group.position.copy(point);
    car.group.position.y = .13;
    car.group.rotation.y = Math.atan2(tangent.x, tangent.z);
    car.group.rotation.z = car.lane * -.012;
  }

  // raceProgress is measured from the starting grid, not from curve point 0.
  // This keeps cars positioned just before the line from being treated as almost a lap ahead.
  function setRaceProgress(car, value) {
    car.raceProgress = value;
    car.t = ((raceStartT + value) % 1 + 1) % 1;
    car.lap = Math.max(0, Math.floor(value));
  }

  function buildScene() {
    makeRoad();
    addEnvironment();
    player.group = makeCar(player.color, true);
    cars.push(player);
    rivals.forEach(rival => { rival.group = makeCar(rival.color, false); cars.push(rival); });
    cars.forEach(updateCarTransform);
  }

  function ordinal(number) { return number === 1 ? 'ST' : number === 2 ? 'ND' : number === 3 ? 'RD' : 'TH'; }
  function rankings() {
    return [...cars].sort((a, b) => {
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return b.raceProgress - a.raceProgress;
    });
  }
  function formatTime(seconds) {
    const minute = Math.floor(seconds / 60);
    const second = Math.floor(seconds % 60);
    const millisecond = Math.floor((seconds % 1) * 1000);
    return `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(millisecond).padStart(3, '0')}`;
  }
  function showToast(text, type = '') {
    if (ui.toast.textContent !== text || ui.toast.style.opacity !== '1') ui.toast.textContent = text;
    ui.toast.className = type;
    ui.toast.style.opacity = 1;
    toastTimer = 1.45;
  }

  function recordFinish(car, previousProgress, dt) {
    if (car.finishedAt !== null || previousProgress >= 3 || car.raceProgress < 3) return;
    const completedFraction = (3 - previousProgress) / (car.raceProgress - previousProgress);
    car.finishedAt = elapsed - dt + dt * completedFraction;
    setRaceProgress(car, 3);
  }

  function renderHUD(boosting, offroad) {
    const orderedCars = rankings();
    const rank = orderedCars.indexOf(player) + 1;
    ui.speed.textContent = String(Math.round(player.speed * 3.35)).padStart(3, '0');
    ui.position.innerHTML = `${rank}<span>${ordinal(rank)}</span>`;
    ui.lap.textContent = Math.min(3, player.lap + 1);
    ui.time.textContent = formatTime(elapsed);
    ui.boostFill.style.width = `${player.boost}%`;
    ui.boostValue.textContent = `${Math.round(player.boost)}%`;
    ui.rankSummary.textContent = `${rank} / 4`;
    ui.leaderboard.innerHTML = orderedCars.map((car, index) => {
      const color = `#${car.color.toString(16).padStart(6, '0')}`;
      const carTime = formatTime(car.finishedAt === null ? elapsed : car.finishedAt);
      const carSpeed = Math.round(car.speed * 3.35);
      return `<li class="${car === player ? 'player' : ''}" style="--car-color:${color}"><span class="rank">${index + 1}</span><span class="dot"></span><span class="car-name">${car.name}</span><span class="car-speed">${String(carSpeed).padStart(3, '0')}<small>KM/H</small></span><time>${carTime}</time></li>`;
    }).join('');
    document.querySelectorAll('.speed-lines i').forEach((line, index) => line.classList.toggle('active', index < Math.ceil(player.speed / 13)));
    if (boosting) showToast('TURBO ACTIVE', 'turbo');
    else if (offroad) showToast('GET BACK ON TRACK', 'warning');
    else if (rank < lastRank) showToast(`POSITION UP — ${rank}${ordinal(rank)}`, 'turbo');
    lastRank = rank;
  }

  function updateRace(dt) {
    elapsed += dt;
    const accelerating = keys.has('KeyW') || keys.has('ArrowUp');
    const braking = keys.has('KeyS') || keys.has('ArrowDown');
    const boosting = keys.has('Space') && player.boost > 0 && player.speed > 32;
    const targetSpeed = braking ? 12 : accelerating ? (boosting ? 83 : 63) : 34;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * (accelerating || braking ? 2.15 : .75));
    player.boost = boosting ? Math.max(0, player.boost - dt * 27) : Math.min(100, player.boost + dt * 5.8);
    const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    player.lane += steer * dt * (4.1 + player.speed * .04);
    player.lane *= 1 - dt * .42;
    const offroad = Math.abs(player.lane) > roadWidth / 2 - .8;
    if (offroad) {
      player.speed = Math.min(player.speed, 25);
      player.lane = THREE.MathUtils.clamp(player.lane, -roadWidth / 2 - 1.5, roadWidth / 2 + 1.5);
    }
    const oldPlayerProgress = player.raceProgress;
    setRaceProgress(player, player.raceProgress + player.speed * dt / trackLength);
    recordFinish(player, oldPlayerProgress, dt);
    rivals.forEach(rival => {
      if (rival.finishedAt !== null) return;
      rival.speed = rival.pace * (1 + Math.sin(elapsed * .53 + rival.wobble) * .045);
      const oldRivalProgress = rival.raceProgress;
      setRaceProgress(rival, rival.raceProgress + rival.speed * dt / trackLength);
      recordFinish(rival, oldRivalProgress, dt);
      rival.lane += (Math.sin(elapsed * .75 + rival.wobble) * .55 - rival.lane) * dt * .25;
      updateCarTransform(rival);
    });
    updateCarTransform(player);
    rivals.forEach(rival => {
      if (player.group.position.distanceTo(rival.group.position) < 2.05) {
        player.speed *= .965;
        player.lane += player.lane <= rival.lane ? -.045 : .045;
      }
    });
    renderHUD(boosting, offroad);
    if (player.finishedAt !== null) finishRace();
  }

  function finishRace() {
    state = 'finished';
    const rank = rankings().indexOf(player) + 1;
    ui.finishTitle.innerHTML = `${rank}<sup>${ordinal(rank)}</sup>`;
    ui.finishMessage.textContent = rank === 1 ? '완벽한 질주입니다. 미드나이트 서킷의 챔피언이 되었습니다.' : '결승선 통과! 다시 도전해서 라이벌들을 제치세요.';
    ui.finishTime.textContent = formatTime(elapsed);
    ui.finish.classList.remove('hidden');
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    state = 'countdown';
    let count = 3;
    ui.countdown.style.display = 'block';
    ui.countdown.textContent = count;
    countdownTimer = setInterval(() => {
      count--;
      ui.countdown.textContent = count > 0 ? count : 'GO!';
      if (count < 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        ui.countdown.style.display = 'none';
        state = 'racing';
        showToast('RACE ON!', 'turbo');
      }
    }, 850);
  }

  function resetRace() {
    setRaceProgress(player, 0);
    player.lane = 0;
    player.speed = 0;
    player.boost = 100;
    player.finishedAt = null;
    const startingPositions = [-.02, -.045, -.07];
    rivals.forEach((rival, index) => {
      setRaceProgress(rival, startingPositions[index]);
      rival.lane = [-2.4, 2.1, -.2][index];
      rival.speed = 0;
      rival.finishedAt = null;
      updateCarTransform(rival);
    });
    updateCarTransform(player);
    elapsed = 0;
    lastRank = 1;
    ui.finish.classList.add('hidden');
    startCountdown();
  }

  function startRace() {
    ui.start.classList.add('hidden');
    resetRace();
  }

  const cameraTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), .05);
    if (state === 'racing') updateRace(dt);
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) ui.toast.style.opacity = 0;
    }
    const { point, tangent, normal } = getTrackPoint(player);
    cameraTarget.copy(point).addScaledVector(tangent, -10.5).addScaledVector(normal, player.lane * .24);
    cameraTarget.y = 5.2 + player.speed * .015;
    camera.position.lerp(cameraTarget, 1 - Math.exp(-dt * 5));
    lookTarget.copy(point).addScaledVector(tangent, 13);
    lookTarget.y = 1.1;
    camera.lookAt(lookTarget);
    renderer.render(scene, camera);
  }

  addEventListener('keydown', event => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
  });
  addEventListener('keyup', event => keys.delete(event.code));
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  ui.startButton.addEventListener('click', startRace);
  ui.restart.addEventListener('click', resetRace);
  ui.sound.addEventListener('click', () => { ui.sound.textContent = ui.sound.textContent === '♪' ? '×' : '♪'; });

  buildScene();
  animate();
})();
