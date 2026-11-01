/*
 * Verdigris campaign - castle preview page (Phase 3 T01): Vyshgard Castle from data.settlements.castle on a
 * stand-in rock with a cliff over a river. Orbit camera (drag, pinch / wheel), day / dusk / night, quality tier,
 * LOD switch, draw call and triangle readout. URL: ?time=day|dusk|night&tier=low|mid|high&lod=auto|full|sil&view=...
 * window.__vpreview = { set(opts), info() } for the headless check.
 */
(function () {
  'use strict';
  const BUILD = 't203.1 2026-11-01 castle solids, wall walks, gate';
  const THREE = window.THREE, C = window.VCamp, VR = window.VRender, I = window.I18N;
  const t = (k, p) => (I ? I.t(k, p) : k);
  const params = new URLSearchParams(location.search);
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const errEl = document.getElementById('err');
  window.addEventListener('error', e => { errEl.textContent = String(e.message); });

  const renderer = new THREE.WebGLRenderer({ antialias: !touch });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 4000);
  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x5a5040, 0.75), sun = new THREE.DirectionalLight(0xfff1d8, 1);
  scene.add(hemi, sun);
  scene.fog = new THREE.Fog(0x9cc4e4, 600, 2200);

  /* stand-in rock: flat top for the castle, a cliff on the west (local -X) down to the river, gentle slope east */
  const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function height(x, z) {
    const e = Math.hypot(x / 98, z / 72), out = Math.max(0, e - 1) * 85, cliffK = smooth(10, -60, x);
    const y = (1 - cliffK) * -34 * smooth(0, 220, out) + cliffK * -62 * smooth(0, 20, out);
    const rough = out > 0 ? (Math.sin(x * 0.07) * Math.cos(z * 0.05) * 2 + Math.sin(z * 0.21 + x * 0.13)) * smooth(0, 30, out) : 0;
    const far = x < -300 ? (-300 - x) * 0.35 : 0;
    return x < -150 && x > -300 ? -66 : y + rough + far;            // the river bed between -150 and -300
  }
  const RIVER_Y = -62.5;
  {
    const N = 110, S = 900, g = new THREE.PlaneGeometry(S, S, N, N).rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), steep = 1 - nr.getY(i);
      if (steep > 0.28) c.setHex(0xa59f90).multiplyScalar(0.8 + 0.2 * Math.sin(y * 1.4) * Math.sin(y * 0.37 + 1));   // limestone with strata
      else if (y > -2) c.setHex(0x6d7a48);
      else if (y < -60) c.setHex(0x6a6650);
      else c.setHex(0x5e7040).lerp(new THREE.Color(0x8a8270), steep * 2);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const w = new THREE.Mesh(new THREE.PlaneGeometry(160, S).rotateX(-Math.PI / 2).translate(-225, RIVER_Y, 0),
      new THREE.MeshLambertMaterial({ color: 0x3d6a78, transparent: true, opacity: 0.9 }));
    scene.add(w);
  }

  /* the castle */
  const L = C.need('castle').layout();
  const pick = (k, list, def) => (list.includes(params.get(k)) ? params.get(k) : def);
  const st = {
    time: pick('time', ['day', 'dusk', 'night'], 'day'),
    tier: pick('tier', ['low', 'mid', 'high'], touch ? 'mid' : 'high'),
    lod: pick('lod', ['auto', 'full', 'sil'], 'auto'),
    view: pick('view', ['river', 'gate', 'high', 'yard'], 'high'),
  };
  let kit = null;
  function rebuild() {
    if (kit) kit.dispose();
    kit = VR.castleKit.build(L, { tier: st.tier });
    kit.group.position.set(-L.centre[0], 0, -L.centre[1]);
    scene.add(kit.group);
    applyTime();
  }

  const TIMES = {
    day:   { sky: 0x9cc4e4, hemi: [0xdfe8f0, 0x5a5040, 0.78], sun: [0xfff1d8, 1.0, 200, 300, 120], night: 0 },
    dusk:  { sky: 0xc98a6a, hemi: [0xf0b080, 0x403040, 0.5], sun: [0xffa060, 0.75, -300, 70, -120], night: 0.65 },
    night: { sky: 0x0b1322, hemi: [0x4a5a86, 0x0e1216, 0.32], sun: [0x8fa8d8, 0.3, -150, 260, 200], night: 1 },
  };
  function applyTime() {
    const T = TIMES[st.time];
    renderer.setClearColor(T.sky); scene.fog.color.setHex(T.sky);
    hemi.color.setHex(T.hemi[0]); hemi.groundColor.setHex(T.hemi[1]); hemi.intensity = T.hemi[2];
    sun.color.setHex(T.sun[0]); sun.intensity = T.sun[1]; sun.position.set(T.sun[2], T.sun[3], T.sun[4]);
    if (kit) kit.setNight(T.night);
  }

  /* orbit camera */
  const VIEWS = {
    river: [[-270, -35, 60], [0, 14, 0]],
    gate:  [[170, 12, 26], [66, 10, 0]],
    high:  [[150, 120, 170], [0, 0, 0]],
    yard:  [[34, 9, 2], [-30, 10, -4]],
  };
  const orb = { target: new THREE.Vector3(), r: 300, th: 0.8, ph: 1.0 };
  function setView(name) {
    const [p, tg] = VIEWS[name];
    orb.target.set(tg[0], tg[1], tg[2]);
    const d = new THREE.Vector3(p[0], p[1], p[2]).sub(orb.target);
    orb.r = d.length(); orb.th = Math.atan2(d.x, d.z); orb.ph = Math.acos(d.y / orb.r);
  }
  function placeCam() {
    orb.ph = Math.max(0.15, Math.min(2.2, orb.ph)); orb.r = Math.max(8, Math.min(1400, orb.r));
    const s = Math.sin(orb.ph);
    cam.position.set(orb.target.x + orb.r * s * Math.sin(orb.th), orb.target.y + orb.r * Math.cos(orb.ph), orb.target.z + orb.r * s * Math.cos(orb.th));
    cam.lookAt(orb.target);
  }
  const ptrs = new Map(); let pinch0 = 0, r0 = 0;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); r0 = orb.r; } });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) { orb.th -= (e.clientX - p[0]) * 0.006; orb.ph -= (e.clientY - p[1]) * 0.005; }
    p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) orb.r = r0 * pinch0 / Math.max(10, d); }
  });
  const up = e => { ptrs.delete(e.pointerId); pinch0 = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); orb.r *= Math.exp(e.deltaY * 0.001); }, { passive: false });

  /* UI */
  function buttons(rowId, key, list) {
    const row = document.getElementById(rowId);
    for (const [val, label] of list) {
      const b = document.createElement('button');
      b.textContent = t(label); b.dataset.val = val;
      b.onclick = () => set({ [key]: val });
      row.appendChild(b);
    }
  }
  buttons('rTime', 'time', [['day', 'c.pv.day'], ['dusk', 'c.pv.dusk'], ['night', 'c.pv.night']]);
  buttons('rView', 'view', [['river', 'c.pv.vRiver'], ['gate', 'c.pv.vGate'], ['high', 'c.pv.vHigh'], ['yard', 'c.pv.vYard']]);
  buttons('rTier', 'tier', [['low', 'c.pv.low'], ['mid', 'c.pv.mid'], ['high', 'c.pv.high']]);
  buttons('rLod', 'lod', [['auto', 'c.pv.auto'], ['full', 'c.pv.full'], ['sil', 'c.pv.sil']]);
  if (I && I.apply) I.apply();
  function mark() {
    for (const [rowId, key] of [['rTime', 'time'], ['rView', 'view'], ['rTier', 'tier'], ['rLod', 'lod']])
      for (const b of document.getElementById(rowId).querySelectorAll('button')) b.classList.toggle('on', b.dataset.val === st[key]);
  }
  function set(o) {
    const tierChanged = o.tier && o.tier !== st.tier;
    Object.assign(st, o);
    if (o.view) setView(st.view);
    if (tierChanged) rebuild(); else if (o.time) applyTime();
    mark();
  }

  const stats = document.getElementById('stats');
  let fps = 0, frames = 0, acc = 0, last = performance.now(), clock = 0, frameInfo = { calls: 0, tris: 0 };
  function info() {
    const k = kit.info();
    return { build: BUILD, tier: st.tier, time: st.time, view: st.view, lod: k.lod, calls: k.calls, tris: k.tris,
             frameCalls: frameInfo.calls, frameTris: frameInfo.tris, fps: Math.round(fps), dist: Math.round(cam.position.length()) };
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    frames++; acc += dt; if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
    placeCam();
    kit.setLod(st.lod, cam.position.length());
    kit.update(dt, clock);
    renderer.render(scene, cam);
    frameInfo = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    const i = info();
    stats.textContent = 'build ' + BUILD + (params.get('v') ? '  (v=' + params.get('v') + ')' : '') + '\n' +
      t('c.pv.lod') + ': ' + i.lod + ' - ' + t('c.pv.stats', { calls: i.calls, tris: i.tris }) + '  |  ' + i.fps + ' fps\n' +
      t(touch ? 'c.pv.hint' : 'c.pv.hintMouse');
    requestAnimationFrame(frame);
  }
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });

  rebuild(); setView(st.view); mark();
  requestAnimationFrame(frame);
  window.__vpreview = { set, info, kit: () => kit, layout: L, BUILD };
})();
