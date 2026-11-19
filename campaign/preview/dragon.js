/*
 * Verdigris - dragon stages preview (phase 4 T04): the shared dragon (shared/dragon.js) with the stage looks of
 * campaign data stageLook - hatchling, drake, wyrm and the elder (preview only) - side by side at true scale, or one
 * at a time up close. Pose buttons (fly / stand / walk), spin, palette (the hero, the mother, the duel rival), orbit
 * camera (drag, pinch / wheel) and a draw call / triangle readout per stage.
 * URL: ?stage=all|hatchling|drake|wyrm|elder&pose=fly|stand|walk&spin=0|1&pal=hero|mother|crimson
 * window.__vdragon = { set(opts), info() } for the headless check.
 */
(function () {
  'use strict';
  const THREE = window.THREE, VD = window.VDragon, TX = window.VTex, D = window.VCamp.need('data');
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
  scene.fog = new THREE.Fog(0x9db7c9, 90, 220);
  const cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xe4ecf4, 0x5a4c3c, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0d8, 0.95); sun.position.set(6, 12, 8); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xaecbff, 0.35); rim.position.set(-6, 5, -8); scene.add(rim);
  {
    const g = new THREE.CircleGeometry(120, 48).rotateX(-Math.PI / 2);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6f7a4e })));
  }

  const IDS = ['hatchling', 'drake', 'wyrm', 'elder'];
  const LABEL = { hatchling: 'Hatchling', drake: 'Drake', wyrm: 'Wyrm', elder: 'Elder' };
  /* true scale: the stage's grown size (scaleTo of data.stages; the spec values for stages not in the data yet) */
  const SPEC_SCALE = { hatchling: 1.5, drake: 2.4, wyrm: 3.4, elder: 4.4 };
  const scaleOf = id => { const s = D.stages.find(q => q.id === id); return s ? s.scaleTo : SPEC_SCALE[id]; };
  const PAL = {
    hero: VD.GREEN,
    mother: { body: 0x2c6450, dark: 0x173a30, belly: 0xb09c66, wing: 0x346e5a, horn: 0xd8c9a8, eye: 0xffb43a },
    crimson: VD.CRIMSON,
  };
  const pick = (k, list, def) => (list.includes(params.get(k)) ? params.get(k) : def);
  const state = {
    stage: pick('stage', ['all'].concat(IDS), 'all'),
    pose: pick('pose', ['fly', 'stand', 'walk'], 'stand'),
    spin: params.get('spin') !== '0',
    pal: pick('pal', Object.keys(PAL), 'hero'),
  };

  const figs = [];
  const portrait = () => innerWidth / innerHeight < 1;
  function count(d) { let t = 0, m = 0; d.root.traverse(o => { if (o.isMesh) { m++; t += o.geometry.index.count / 3; } }); return { tris: t, meshes: m }; }
  function build() {
    figs.forEach(f => f.d.dispose());
    figs.length = 0;
    IDS.forEach(id => {
      const d = VD.makeDragon(PAL[state.pal], { stage: Object.assign({ id }, D.stageLook[id]) });
      scene.add(d.root);
      figs.push(Object.assign({ id, d, s: scaleOf(id), yaw: Math.PI / 2 }, count(d)));
    });
    place();
  }
  /* side by side in a 2 x 2 grid (small stages in front); one at a time: the others hidden */
  function place() {
    const GRID = [[-9, 18], [10, 18], [-14, -16], [17, -16]];     // portrait: small stages in front, big ones behind
    figs.forEach((f, i) => {
      f.x = GRID[i][0]; f.z = GRID[i][1];
      f.d.root.scale.setScalar(f.s);
      f.d.root.visible = state.stage === 'all' || state.stage === f.id;
      if (state.stage !== 'all') f.x = f.z = 0;
    });
  }
  build();

  const orb = { th: 0.5, ph: 1.25, r: 40, target: new THREE.Vector3(0, 3, 0) };
  function frame() {
    if (state.stage === 'all') {
      const p = portrait();
      orb.target.set(p ? 5 : 3, 5 + (state.pose === 'fly' ? 6 : 0), 0); orb.r = p ? 135 : 78; orb.ph = 1.1; orb.th = 0.2;
    } else {
      const f = figs.find(q => q.id === state.stage);
      orb.target.set(f.s * 2.4, f.s * (state.pose === 'fly' ? 2.6 : 1.9), 0); orb.r = f.s * (portrait() ? 13 : 8); orb.ph = 1.3; orb.th = 0.9;
    }
  }
  function placeCam() {
    orb.ph = Math.max(0.15, Math.min(1.6, orb.ph)); orb.r = Math.max(2, Math.min(200, orb.r));
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
  buttons('rStage', [['all', 'All']].concat(IDS.map(k => [k, LABEL[k]])), v => state.stage === v, v => { state.stage = v; place(); frame(); });
  buttons('rPose', [['fly', 'Fly'], ['stand', 'Stand'], ['walk', 'Walk']], v => state.pose === v, v => { state.pose = v; frame(); });
  buttons('rOpt', [['spin', 'Spin'], ['hero', 'Hero'], ['mother', 'Mother'], ['crimson', 'Rival']],
    v => (v === 'spin' ? state.spin : state.pal === v),
    v => { if (v === 'spin') state.spin = !state.spin; else { state.pal = v; build(); } });
  refresh();

  const clock = new THREE.Clock();
  let t = 0, fps = 60, frameInfo = { calls: 0, tris: 0 };
  function info() {
    return {
      calls: frameInfo.calls, tris: frameInfo.tris, fps: Math.round(fps), stage: state.stage, pose: state.pose, pal: state.pal,
      stages: figs.map(f => ({ id: f.id, tris: f.tris, meshes: f.meshes, scale: f.s, visible: f.d.root.visible })),
    };
  }
  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    t += dt; fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.05;
    if (TX && TX.tick) TX.tick(t);
    const fly = state.pose === 'fly', walk = state.pose === 'walk';
    figs.forEach(f => {
      if (state.spin) f.yaw += dt * 0.35;
      const r = f.d.root;
      r.rotation.set(0, f.yaw, fly ? Math.sin(t * 0.7) * 0.15 : 0, 'YXZ');
      r.position.set(f.x, f.s * (fly ? 2.6 + Math.sin(t * 1.1) * 0.15 : VD.STAND), f.z);
      f.d.anim(t, dt, { phase: t * 5, amp: fly ? 1 : 0.2, mouth: false, turn: 0, look: 0, ground: fly ? 0 : 1, gait: walk ? t * 5 : 0, stride: walk ? 0.8 : 0 });
    });
    placeCam();
    renderer.render(scene, cam);
    frameInfo = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    const i = info();
    document.getElementById('stats').textContent =
      'draw calls ' + i.calls + '   triangles ' + i.tris + '   ' + i.fps + ' fps\n' +
      i.stages.map(s => LABEL[s.id] + ' ' + s.tris + ' / ' + s.meshes).join('  ') + '\n(tris / meshes per dragon; Elder: preview only)' +
      (touch ? '' : '\ndrag to orbit, wheel to zoom');
    requestAnimationFrame(tick);
  }
  window.addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); place(); frame(); });
  cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  window.__vdragon = {
    set(opts) {
      opts = opts || {};
      const rebuild = opts.pal && opts.pal !== state.pal;
      Object.assign(state, opts);
      if (rebuild) build();
      if ('stage' in opts || 'pose' in opts) { place(); frame(); }
      if (opts.cam) Object.assign(orb, opts.cam);
      refresh();
    },
    info, orb,
  };
  tick();
})();
