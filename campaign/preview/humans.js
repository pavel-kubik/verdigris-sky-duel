/*
 * Verdigris - people preview (shared/human.js): the six kinds on turntables, pose buttons (idle / walk / run / cast /
 * attack / talk / jump), close-ups per kind, a crowd of 40 townsfolk and guards wandering the square, the shapeshift
 * shimmer, orbit camera (drag, pinch / wheel) and a draw call / triangle readout.
 * URL: ?mode=idle|walk|run|cast|attack|talk|jump&focus=all|wizard|...&crowd=0|1&spin=0|1&seed=N&detail=high|low
 * window.__vh = { set(opts), info() } for the headless check.
 */
(function () {
  'use strict';
  const THREE = window.THREE, VH = window.VHuman, TX = window.VTex;
  const params = new URLSearchParams(location.search);
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const errEl = document.getElementById('err');
  window.addEventListener('error', e => { errEl.textContent = String(e.message); });

  const renderer = new THREE.WebGLRenderer({ antialias: !touch });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db7c9);
  scene.fog = new THREE.Fog(0x9db7c9, 30, 70);
  const cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xe4ecf4, 0x5a4c3c, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0d8, 0.95); sun.position.set(4, 9, 6); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xaecbff, 0.35); rim.position.set(-5, 4, -6); scene.add(rim);

  /* the square: cobbles and a ring of stone discs for the turntables */
  {
    const g = new THREE.CircleGeometry(26, 48).rotateX(-Math.PI / 2);
    const col = new Float32Array(g.attributes.position.count * 3), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)), k = 0.5 - Math.min(0.16, r * 0.007); col[i * 3] = k * 1.02; col[i * 3 + 1] = k * 0.96; col[i * 3 + 2] = k * 0.88; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (TX && TX.detail) TX.detail(m, { map: 'cobble', scale: 1.6, strength: 0.45 });
    scene.add(new THREE.Mesh(g, m));
  }
  /* blob shadows */
  const shTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const shGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });

  const KINDS = VH.KINDS, LABEL = { wizard: 'Wizard', princess: 'Princess', prince: 'Prince', dragonkin: 'Dragon', guard: 'Guard', citizen: 'Citizen' };
  const pick = (k, list, def) => (list.includes(params.get(k)) ? params.get(k) : def);
  const state = {
    mode: pick('mode', ['idle', 'walk', 'run', 'cast', 'attack', 'talk', 'jump'], 'walk'),
    focus: pick('focus', ['all'].concat(KINDS), 'all'),
    crowd: params.get('crowd') !== '0', spin: params.get('spin') !== '0', glow: false,
    seed: (+params.get('seed') >>> 0) || 0, detail: params.get('detail') === 'low' ? 'low' : 'high',
  };

  /* lineup: one row on wide screens, two rows of three on narrow ones */
  const figs = [];
  const portrait = () => innerWidth / innerHeight < 1;
  function slot(i) {
    if (!portrait()) return [(i - 2.5) * 1.45, 0];
    return [((i % 3) - 1) * 1.35, i < 3 ? -1.1 : 1.1];
  }
  function build() {
    figs.forEach(f => { f.h.dispose(); scene.remove(f.disc, f.shadow); });
    figs.length = 0;
    KINDS.forEach((k, i) => {
      const h = VH.make(k, { seed: state.seed + (k === 'citizen' ? 3 : 0), detail: state.detail });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.06, 28), new THREE.MeshLambertMaterial({ color: 0x5d564c }));
      const shadow = new THREE.Mesh(shGeo, shMat); shadow.scale.set(0.9, 1, 0.9);
      scene.add(h.root, disc, shadow);
      figs.push({ kind: k, h, disc, shadow, yaw: 0 });
    });
    place();
  }
  function place() {
    figs.forEach((f, i) => {
      const [x, z] = slot(i);
      f.x = x; f.z = z;
      f.h.root.position.set(x, 0.06, z); f.disc.position.set(x, 0.03, z); f.shadow.position.set(x, 0.065, z);
    });
  }
  build();

  /* the crowd: 40 people wandering between random points of the square, around the lineup */
  let crowd = null, people = [];
  const crowdShadow = new THREE.InstancedMesh(shGeo, shMat, 40); crowdShadow.frustumCulled = false; scene.add(crowdShadow);
  function makeCrowd() {
    if (crowd) crowd.dispose();
    crowd = VH.crowd(40, { seed: 77 + state.seed, kinds: ['citizen', 'guard'], guardShare: 0.15 });
    scene.add(crowd.group);
    let s = 1234567;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const point = () => { const a = rnd() * Math.PI * 2, r = 5 + rnd() * 9; return [Math.cos(a) * r, Math.sin(a) * r]; };
    people = [];
    for (let i = 0; i < 40; i++) {
      const [x, z] = point(), [tx, tz] = point();
      people.push({ x, z, tx, tz, yaw: 0, sp: 0, want: 0.9 + rnd() * 0.6, wait: rnd() * 3, rnd });
    }
    crowd.group.visible = crowdShadow.visible = state.crowd;
  }
  makeCrowd();
  const dummy = new THREE.Object3D();
  function stepCrowd(dt) {
    if (!state.crowd) return;
    people.forEach((p, i) => {
      if (p.wait > 0) { p.wait -= dt; p.sp = Math.max(0, p.sp - dt * 3); }
      else {
        const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
        if (d < 0.4) { p.wait = 0.5 + p.rnd() * 4; const a = p.rnd() * Math.PI * 2, r = 5 + p.rnd() * 9; p.tx = Math.cos(a) * r; p.tz = Math.sin(a) * r; }
        else {
          const want = Math.atan2(dx, dz); let dy = want - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          p.yaw += dy * Math.min(1, dt * 4);
          p.sp += (p.want * Math.max(0, Math.cos(dy)) - p.sp) * Math.min(1, dt * 3);
          p.x += Math.sin(p.yaw) * p.sp * dt; p.z += Math.cos(p.yaw) * p.sp * dt;
        }
      }
      crowd.set(i, p.x, 0, p.z, p.yaw, p.sp);
      dummy.position.set(p.x, 0.01, p.z); dummy.scale.set(0.8, 1, 0.8); dummy.updateMatrix(); crowdShadow.setMatrixAt(i, dummy.matrix);
    });
    crowdShadow.instanceMatrix.needsUpdate = true;
    crowd.update(dt);
  }

  const shimmer = VH.shimmer(scene);

  /* orbit camera */
  const orb = { th: 0.0, ph: 1.2, r: 10, target: new THREE.Vector3(0, 1, 0) };
  function frame() {
    if (state.focus === 'all') {
      const p = portrait();
      orb.target.set(0, p ? 0.95 : 1.0, 0);
      orb.r = p ? 10.5 : 8.6; orb.ph = p ? 1.28 : 1.36;
    } else {
      const f = figs.find(q => q.kind === state.focus);
      orb.target.set(f.x, f.h.height * 0.55 + 0.05, f.z);
      orb.r = f.h.height * (portrait() ? 2.1 : 1.55); orb.ph = 1.42;
    }
    orb.th = 0.25;
  }
  function placeCam() {
    orb.ph = Math.max(0.2, Math.min(1.62, orb.ph)); orb.r = Math.max(1.2, Math.min(45, orb.r));
    const s = Math.sin(orb.ph);
    cam.position.set(orb.target.x + orb.r * s * Math.sin(orb.th), orb.target.y + orb.r * Math.cos(orb.ph), orb.target.z + orb.r * s * Math.cos(orb.th));
    cam.lookAt(orb.target);
  }
  frame();
  const ptrs = new Map(); let pinch0 = 0, r0 = 0;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); r0 = orb.r; } });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) { orb.th -= (e.clientX - p[0]) * 0.007; orb.ph -= (e.clientY - p[1]) * 0.005; }
    p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) orb.r = r0 * pinch0 / Math.max(10, d); }
  });
  const up = e => { ptrs.delete(e.pointerId); pinch0 = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); orb.r *= Math.exp(e.deltaY * 0.001); }, { passive: false });

  /* UI */
  const rows = {};
  function buttons(rowId, list, isOn, onClick) {
    const row = document.getElementById(rowId), btns = [];
    for (const [val, label] of list) {
      const b = document.createElement('button'); b.textContent = label;
      b.addEventListener('click', () => { onClick(val); refresh(); });
      row.appendChild(b); btns.push([b, val]);
    }
    rows[rowId] = () => btns.forEach(([b, v]) => b.classList.toggle('on', !!isOn(v)));
  }
  function refresh() { Object.values(rows).forEach(f => f()); }
  buttons('rMode', [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run'], ['cast', 'Cast'], ['attack', 'Attack'], ['talk', 'Talk'], ['jump', 'Jump']], v => state.mode === v, v => { state.mode = v; });
  buttons('rFocus', [['all', 'All']].concat(KINDS.map(k => [k, LABEL[k]])), v => state.focus === v, v => { state.focus = v; frame(); });
  buttons('rOpt', [['spin', 'Spin'], ['crowd', 'Crowd'], ['glow', 'Glow'], ['shimmer', 'Shift'], ['seed', 'Seed+']],
    v => (v === 'spin' ? state.spin : v === 'crowd' ? state.crowd : v === 'glow' ? state.glow : false),
    v => {
      if (v === 'spin') state.spin = !state.spin;
      else if (v === 'crowd') { state.crowd = !state.crowd; crowd.group.visible = crowdShadow.visible = state.crowd; }
      else if (v === 'glow') state.glow = !state.glow;
      else if (v === 'shimmer') playShimmer();
      else if (v === 'seed') { state.seed = (state.seed + 1) >>> 0; build(); makeCrowd(); }
    });
  refresh();
  function playShimmer() {
    const f = figs.find(q => q.kind === 'dragonkin');
    shimmer.play(f.h.root.position, 0x5dffa0);
    f.hideT = 0.45;
  }

  /* loop */
  const clock = new THREE.Clock();
  let t = 0, fps = 60, frameInfo = { calls: 0, tris: 0 };
  function poseFor(dt) {
    const m = state.mode, o = { speed: 0 };
    if (m === 'walk') o.speed = 1.3;
    else if (m === 'run') { o.speed = 4.2; o.run = true; }
    else if (m === 'cast') o.cast = Math.min(1, (t % 3) / 0.5) * (t % 3 < 2.5 ? 1 : Math.max(0, 1 - (t % 3 - 2.5) / 0.5));
    else if (m === 'attack') { const c = t % 1.6; o.attack = c < 1.0 ? c / 1.0 : 0; }
    else if (m === 'talk') o.talk = true;
    else if (m === 'jump') o.air = Math.max(0, Math.sin(t * 2.4));
    void dt;
    return o;
  }
  function info() {
    return {
      calls: frameInfo.calls, tris: frameInfo.tris, fps: Math.round(fps), mode: state.mode, focus: state.focus,
      kinds: figs.map(f => ({ kind: f.kind, tris: f.h.tris, meshes: f.h.meshes, height: +f.h.height.toFixed(2) })),
      crowd: crowd ? { n: crowd.count, drawCalls: crowd.drawCalls, tris: crowd.tris } : null,
    };
  }
  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    t += dt; fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.05;
    if (TX && TX.tick) TX.tick(t);
    const o = poseFor(dt);
    figs.forEach(f => {
      if (state.spin && state.focus === 'all') f.yaw += dt * 0.5; else if (state.focus !== 'all') f.yaw += (0 - f.yaw) * Math.min(1, dt * 3) * (state.spin ? 0 : 1);
      if (state.spin && state.focus !== 'all') f.yaw += dt * 0.35;
      f.h.root.rotation.y = f.yaw;
      f.h.root.position.y = 0.06 + (o.air || 0) * 0.35;
      f.h.setGlow(state.glow ? 0.8 : 0);                 // the user glow; anim() adds the cast / attack glow on top
      f.h.anim(dt, o);
      if (f.hideT != null) { f.hideT -= dt; f.h.root.visible = Math.floor(t * 30) % 2 === 0 || f.hideT < -0.3; if (f.hideT < -0.3) f.hideT = null; }
    });
    shimmer.update(dt);
    stepCrowd(dt);
    placeCam();
    renderer.render(scene, cam);
    frameInfo = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    const i = info();
    document.getElementById('stats').textContent =
      'draw calls ' + i.calls + '   triangles ' + i.tris + '   ' + i.fps + ' fps\n' +
      i.kinds.map(k => LABEL[k.kind] + ' ' + k.tris).join('  ') + (i.crowd && state.crowd ? '\ncrowd ' + i.crowd.n + ': ' + i.crowd.drawCalls + ' calls, ' + i.crowd.tris + ' tris' : '') +
      (touch ? '' : '\ndrag to orbit, wheel to zoom');
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); place(); frame(); });
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  window.__vh = {
    set(opts) {
      Object.assign(state, opts || {});
      if (opts && 'crowd' in opts) crowd.group.visible = crowdShadow.visible = state.crowd;
      if (opts && ('focus' in opts)) frame();
      if (opts && opts.cam) Object.assign(orb, opts.cam);
      refresh();
    },
    info, shimmer: playShimmer, orb,
  };
  tick();
})();
