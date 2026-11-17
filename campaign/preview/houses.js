/*
 * Verdigris campaign - house kit preview: (a) a gallery of every style and kind, (b) a generated demo town (blocks of
 * row houses along streets, a square with arcades, a church and a town hall, a palace, a dome church, a cathedral on
 * the hill, gate towers, a village with cottages, farms and barns) on gently rolling ground.
 * Orbit camera (drag, pinch / wheel), day / dusk / night, quality tier, views, draw call and triangle readout.
 * URL: ?time=day|dusk|night&tier=low|mid|high&view=gallery|square|street|city|village|top&blocks=7x5
 * window.__hpreview = { set(opts), info(), kit() } for the headless check.
 */
(function () {
  'use strict';
  const THREE = window.THREE, VR = window.VRender;
  const params = new URLSearchParams(location.search);
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const errEl = document.getElementById('err');
  window.addEventListener('error', e => { errEl.textContent = String(e.message); });
  const HK = VR.houseKit, rng = HK.rng;

  const renderer = new THREE.WebGLRenderer({ antialias: !touch });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 5000);
  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x5a5040, 0.75), sun = new THREE.DirectionalLight(0xfff1d8, 1);
  scene.add(hemi, sun);
  scene.fog = new THREE.Fog(0x9cc4e4, 900, 3200);

  /* ground: rolling, a hill in the west (the cathedral), cobbles in town */
  const GALLERY_Z = -560;
  function height(x, z) {
    if (z < GALLERY_Z + 120) return 0;
    let y = 5 * Math.sin(x * 0.006 + 1) * Math.cos(z * 0.005) + 3 * Math.sin(z * 0.011 + x * 0.004);
    if (x < -330) y += Math.min(30, (-330 - x) * 0.28);
    return y;
  }
  const blocksArg = (params.get('blocks') || '7x5').split('x').map(Number);
  const BX = Math.max(2, blocksArg[0] || 7), BZ = Math.max(2, blocksArg[1] || 5);
  const BW = 66, BD = 54, ST = 11;                        // block size and street width
  const cityW = BX * (BW + ST), cityD = BZ * (BD + ST);
  {
    const S = 2600, N = 180, g = new THREE.PlaneGeometry(S, S, N, N).rotateX(-Math.PI / 2).translate(80, 0, -100);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, height(x, z) - 0.05);
      const town = Math.abs(x) < cityW / 2 + 8 && Math.abs(z) < cityD / 2 + 8;
      if (z < GALLERY_Z + 100 && z > GALLERY_Z - 100) c.setHex(0x8a8274);
      else if (town) c.setHex(0x8d857a);
      else c.setHex(0x6d7a48).lerp(new THREE.Color(0x87884e), 0.5 + 0.5 * Math.sin(x * 0.02) * Math.cos(z * 0.017));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (window.VTex) window.VTex.detail(m, { map: 'cobble', scale: 4, strength: 0.4 });
    scene.add(new THREE.Mesh(g, m));
  }

  /* ---------- lots ---------- */
  const lots = [];
  let seedN = 1;
  const R = rng(12345);
  function addLot(o) {
    const yaw = o.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), hw = o.w / 2, hd = o.d / 2;
    let lo = 1e9, hi = -1e9;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, 0]]) {
      const y = height(o.x + lx * c + lz * s, o.z - lx * s + lz * c);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const lot = Object.assign({ kind: 'house', floors: 3, seed: (seedN++ * 2654435761) >>> 0 }, o, { y: lo, rise: hi - lo, yaw });
    lots.push(lot);
    return lot;
  }
  /* (a) gallery: every style, then every kind */
  const gallery = [];
  {
    let x = -300;
    const styles = [['gothic', 4, 7], ['gothic', 5, 8, { arcade: true, corner: true }], ['renaissance', 4, 10], ['renaissance', 3, 9], ['baroque', 4, 9], ['baroque', 3, 12, { corner: true }],
      ['classic', 4, 12], ['timber', 3, 8], ['timber', 3, 7], ['cottage', 1, 8, {}, 11], ['log', 1, 8, {}, 10], ['farm', 1, 22, {}, 24], ['barn', 1, 12, {}, 8]];
    for (const [style, floors, w, extra, d] of styles) {
      x += w / 2 + 3;
      gallery.push(addLot(Object.assign({ x, z: GALLERY_Z + 40, w, d: d || 13, floors, style }, extra || {})));
      x += w / 2 + 3;
    }
    x = -300;
    const kinds = [['church', 15, 32, 'gothic'], ['church', 15, 30, 'baroque'], ['cathedral', 32, 70, 'gothic'], ['domechurch', 26, 42, 'baroque'], ['townhall', 24, 16, 'gothic'],
      ['tower', 11, 11, 'gothic'], ['gatetower', 11, 13, 'gothic'], ['palace', 46, 15, 'baroque'], ['palace', 40, 14, 'renaissance'], ['chapel', 8, 13, 'baroque'],
      ['cottage', 8, 11, 'cottage'], ['barn', 13, 9, 'barn'], ['shed', 5, 4, 'barn']];
    for (const [kind, w, d, style] of kinds) {
      x += w / 2 + 6;
      gallery.push(addLot({ x, z: GALLERY_Z - 30, w, d, floors: 3, style, kind }));
      x += w / 2 + 6;
    }
  }
  /* (b) the demo town */
  const sqI = Math.floor(BX / 2), sqJ = Math.floor(BZ / 2);
  const bx0 = -cityW / 2 + ST / 2, bz0 = -cityD / 2 + ST / 2;
  const blockRect = (i, j) => [bx0 + i * (BW + ST), bz0 + j * (BD + ST), BW, BD];
  function styleAt(x, z) {
    const d = Math.hypot(x - blockRect(sqI, sqJ)[0] - BW / 2, z - blockRect(sqI, sqJ)[1] - BD / 2), k = R();
    if (d < 130) return k < 0.32 ? 'gothic' : k < 0.55 ? 'renaissance' : k < 0.9 ? 'baroque' : 'timber';
    if (d < 260) return k < 0.12 ? 'gothic' : k < 0.22 ? 'renaissance' : k < 0.6 ? 'baroque' : k < 0.82 ? 'classic' : 'timber';
    return k < 0.3 ? 'classic' : k < 0.6 ? 'baroque' : 'timber';
  }
  /** One side of a block: lots along from (ax, az) in direction (dx, dz), fronts facing (nx, nz). */
  function row(ax, az, dx, dz, nx, nz, len, depth, opt) {
    let t = 0;
    const yaw = Math.atan2(nx, nz);
    while (len - t > 4.5) {
      let w = 6 + R() * 4.5;
      if (len - t - w < 5.5) w = len - t;
      const cx = ax + dx * (t + w / 2) - nx * depth / 2, cz = az + dz * (t + w / 2) - nz * depth / 2;
      const style = opt.style || styleAt(cx, cz);
      const center = Math.hypot(cx, cz) < 200;
      addLot({ x: cx, z: cz, yaw, w, d: depth, style, floors: opt.floors || (center ? 2 + Math.floor(R() * 3.2) : 2 + Math.floor(R() * 2.4)),
        corner: opt.corners && (t === 0 || len - t - w < 0.5), arcade: !!opt.arcade && style !== 'timber' && style !== 'classic' });
      t += w;
    }
  }
  for (let i = 0; i < BX; i++) for (let j = 0; j < BZ; j++) {
    if (i === sqI && j === sqJ) continue;                    // the square
    if (i === sqI + 1 && j === sqJ) continue;
    const [x0, z0, w, d] = blockRect(i, j), x1 = x0 + w, z1 = z0 + d;
    const dep = 12 + Math.floor(R() * 4);
    const faceSq = (side) => (side === 'n' && i >= sqI && i <= sqI + 1 && j === sqJ + 1) || (side === 's' && i >= sqI && i <= sqI + 1 && j === sqJ - 1) || (side === 'e' && i === sqI - 1 && j === sqJ) || (side === 'w' && i === sqI + 2 && j === sqJ);
    if (i === 1 && j === BZ - 1) {                            // the dome church takes a block
      addLot({ x: x0 + w / 2, z: z0 + d / 2, w: 30, d: 46, kind: 'domechurch', style: 'baroque', yaw: Math.PI / 2 });
      continue;
    }
    // palace along the south side of one block
    if (i === BX - 2 && j === 0) addLot({ x: x0 + w / 2, z: z0 + 8, w: w - 6, d: 15, kind: 'palace', style: 'baroque', floors: 3, yaw: Math.PI });
    else row(x1, z0, -1, 0, 0, -1, w, dep, { corners: true, arcade: faceSq('s') });                       // south side, facing -z
    row(x0, z1, 1, 0, 0, 1, w, dep, { corners: true, arcade: faceSq('n') });                             // north side, facing +z
    row(x0, z0 + dep, 0, 1, -1, 0, d - 2 * dep, dep, { arcade: faceSq('w') });                          // west side, facing -x
    row(x1, z1 - dep, 0, -1, 1, 0, d - 2 * dep, dep, { arcade: faceSq('e') });                           // east side, facing +x
  }
  {
    const [x0, z0] = blockRect(sqI, sqJ), sw = 2 * BW + ST, cx = x0 + sw / 2, cz = z0 + BD / 2;
    addLot({ x: cx + 10, z: cz + 2, w: 15, d: 33, kind: 'church', style: 'gothic', yaw: -Math.PI / 2 });
    addLot({ x: x0 + 16, z: z0 + 12, w: 22, d: 15, kind: 'townhall', style: 'gothic', yaw: Math.PI / 2, floors: 3, arcade: true });
    const [hx0, hz0] = blockRect(0, 0);
    addLot({ x: hx0 - 120, z: hz0 + 60, w: 34, d: 74, kind: 'cathedral', style: 'gothic', yaw: Math.PI / 2 });
    addLot({ x: hx0 - 110, z: hz0 + 125, w: 40, d: 15, kind: 'palace', style: 'renaissance', floors: 3, yaw: Math.PI / 2 });
    addLot({ x: hx0 - 70, z: hz0 - 10, w: 11, d: 11, kind: 'tower', style: 'gothic' });
    const zMain = bz0 + sqJ * (BD + ST) - ST / 2;
    addLot({ x: -cityW / 2 - 4, z: zMain, w: 11, d: 13, kind: 'gatetower', yaw: -Math.PI / 2 });
    addLot({ x: cityW / 2 + 4, z: zMain, w: 11, d: 13, kind: 'gatetower', yaw: Math.PI / 2 });
  }
  /* village east of the town along a road */
  const villageX = cityW / 2 + 140;
  {
    for (let k = 0; k < 26; k++) for (const side of [1, -1]) {
      const x = villageX + k * 17 + R() * 4, z = side * (13 + R() * 4) - 40;
      const t = R();
      if (t < 0.18) addLot({ x, z: z + side * 6, w: 20 + R() * 4, d: 22 + R() * 3, style: 'farm', floors: 1, yaw: side > 0 ? Math.PI : 0 });
      else if (t < 0.28) addLot({ x, z: z + side * 6, w: 11, d: 8, kind: 'barn', style: 'barn', yaw: side > 0 ? Math.PI : 0 });
      else addLot({ x, z, w: 7 + R() * 2, d: 9 + R() * 3, style: R() < 0.3 ? 'log' : 'cottage', floors: R() < 0.12 ? 2 : 1, kind: 'cottage', yaw: side > 0 ? Math.PI : 0 });
      if (R() < 0.35) addLot({ x: x + 4, z: z + side * 14, w: 4.5, d: 4, kind: 'shed', style: 'barn', yaw: side > 0 ? Math.PI : 0 });
    }
    addLot({ x: villageX + 13 * 17, z: -40, w: 8, d: 13, kind: 'chapel', style: 'baroque', yaw: Math.PI / 2 });
  }

  /* ---------- state ---------- */
  const pick = (k, list, def) => (list.includes(params.get(k)) ? params.get(k) : def);
  const st = {
    time: pick('time', ['day', 'dusk', 'night'], 'day'),
    tier: pick('tier', ['low', 'mid', 'high'], touch ? 'mid' : 'high'),
    view: pick('view', ['gallery', 'kinds', 'square', 'street', 'city', 'village', 'top'], 'city'),
  };
  let kit = null;
  function rebuild() {
    if (kit) kit.dispose();
    const t0 = performance.now();
    kit = HK.build(lots, { tier: st.tier, eager: params.get('eager') === '1' });
    kit.buildMs = Math.round(performance.now() - t0);
    scene.add(kit.group);
    applyTime();
  }
  const TIMES = {
    day:   { sky: 0x9cc4e4, hemi: [0xdfe8f0, 0x5a5040, 0.8], sun: [0xfff1d8, 0.95, 300, 400, 160], night: 0 },
    dusk:  { sky: 0xc98a6a, hemi: [0xf0b080, 0x403040, 0.5], sun: [0xffa060, 0.7, -300, 90, -120], night: 0.6 },
    night: { sky: 0x0b1322, hemi: [0x4a5a86, 0x0e1216, 0.32], sun: [0x8fa8d8, 0.22, -150, 260, 200], night: 1 },
  };
  function applyTime() {
    const T = TIMES[st.time];
    renderer.setClearColor(T.sky); scene.fog.color.setHex(T.sky);
    hemi.color.setHex(T.hemi[0]); hemi.groundColor.setHex(T.hemi[1]); hemi.intensity = T.hemi[2];
    sun.color.setHex(T.sun[0]); sun.intensity = T.sun[1]; sun.position.set(T.sun[2], T.sun[3], T.sun[4]);
    if (kit) kit.setNight(T.night);
  }

  /* orbit camera */
  const sq = blockRect(sqI, sqJ), sqC = [sq[0] + BW + ST / 2, sq[1] + BD / 2];
  const VIEWS = {
    gallery: [[-120, 45, GALLERY_Z + 140], [-150, 10, GALLERY_Z + 40]],
    kinds:   [[-40, 90, GALLERY_Z + 170], [-60, 14, GALLERY_Z - 30]],
    square:  [[sqC[0] + 70, 40, sqC[1] + 75], [sqC[0] - 10, 8, sqC[1]]],
    street:  [[sqC[0] - 130, 9, sqC[1] - 34], [sqC[0] - 40, 9, sqC[1] - 40]],
    city:    [[260, 260, 380], [0, 0, 0]],
    village: [[villageX + 120, 70, 60], [villageX + 200, 0, -40]],
    top:     [[0, 1100, 260], [0, 0, 0]],
  };
  const orb = { target: new THREE.Vector3(), r: 300, th: 0.8, ph: 1.0 };
  function setView(name) {
    const [p, tg] = VIEWS[name];
    orb.target.set(tg[0], tg[1], tg[2]);
    const d = new THREE.Vector3(p[0], p[1], p[2]).sub(orb.target);
    orb.r = d.length(); orb.th = Math.atan2(d.x, d.z); orb.ph = Math.acos(d.y / orb.r);
  }
  function placeCam() {
    orb.ph = Math.max(0.05, Math.min(1.62, orb.ph)); orb.r = Math.max(8, Math.min(2200, orb.r));
    const s = Math.sin(orb.ph);
    cam.position.set(orb.target.x + orb.r * s * Math.sin(orb.th), orb.target.y + orb.r * Math.cos(orb.ph), orb.target.z + orb.r * s * Math.cos(orb.th));
    cam.lookAt(orb.target);
  }
  const ptrs = new Map(); let pinch0 = 0, r0 = 0;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); r0 = orb.r; } });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) {
      if (e.shiftKey || e.buttons === 2) {                  // pan
        const k = orb.r * 0.0016, fx = Math.cos(orb.th), fz = -Math.sin(orb.th);
        orb.target.x -= (e.clientX - p[0]) * k * fx + (e.clientY - p[1]) * k * Math.sin(orb.th);
        orb.target.z -= (e.clientX - p[0]) * k * fz + (e.clientY - p[1]) * k * Math.cos(orb.th);
      } else { orb.th -= (e.clientX - p[0]) * 0.006; orb.ph -= (e.clientY - p[1]) * 0.005; }
    }
    p[0] = e.clientX; p[1] = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0 > 0) orb.r = r0 * pinch0 / Math.max(10, d); }
  });
  const up = e => { ptrs.delete(e.pointerId); pinch0 = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); orb.r *= Math.exp(e.deltaY * 0.001); }, { passive: false });

  /* UI */
  function buttons(rowId, key, list) {
    const rowEl = document.getElementById(rowId);
    for (const [val, label] of list) {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.val = val;
      b.onclick = () => set({ [key]: val });
      rowEl.appendChild(b);
    }
  }
  buttons('rTime', 'time', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']]);
  buttons('rView', 'view', [['gallery', 'Styles'], ['kinds', 'Kinds'], ['square', 'Square'], ['street', 'Street'], ['city', 'City'], ['village', 'Village'], ['top', 'Top']]);
  buttons('rTier', 'tier', [['low', 'Low'], ['mid', 'Mid'], ['high', 'High']]);
  function mark() {
    for (const [rowId, key] of [['rTime', 'time'], ['rView', 'view'], ['rTier', 'tier']])
      for (const b of document.getElementById(rowId).querySelectorAll('button')) b.classList.toggle('on', b.dataset.val === st[key]);
  }
  function set(o) {
    const tierChanged = o.tier && o.tier !== st.tier;
    Object.assign(st, o);
    if (o.view) setView(st.view);
    if (tierChanged) rebuild(); else if (o.time) applyTime();
    if (o.cam) { orb.target.set(o.cam[3], o.cam[4], o.cam[5]); const d = new THREE.Vector3(o.cam[0] - o.cam[3], o.cam[1] - o.cam[4], o.cam[2] - o.cam[5]); orb.r = d.length(); orb.th = Math.atan2(d.x, d.z); orb.ph = Math.acos(d.y / orb.r); }
    mark();
  }

  const stats = document.getElementById('stats');
  let fps = 0, frames = 0, acc = 0, last = performance.now(), frameInfo = { calls: 0, tris: 0 };
  function info() {
    const k = kit.info();
    return { tier: st.tier, time: st.time, view: st.view, buildings: k.buildings, chunks: k.chunks, calls: k.calls, tris: k.tris,
             nearBuilt: kit.chunks.filter(c => c.near).length, buildMs: kit.buildMs, frameCalls: frameInfo.calls, frameTris: frameInfo.tris, fps: Math.round(fps) };
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    frames++; acc += dt; if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }
    placeCam();
    kit.update(cam.position);
    renderer.render(scene, cam);
    frameInfo = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    const i = info();
    stats.textContent = i.buildings + ' buildings, ' + i.chunks + ' chunks (' + i.nearBuilt + ' detailed) - kit: ' + i.calls + ' calls, ' + i.tris + ' tris\n' +
      'frame: ' + i.frameCalls + ' calls, ' + i.frameTris + ' tris | ' + i.fps + ' fps | tier ' + i.tier + '\n' +
      (touch ? 'drag: orbit, pinch: zoom' : 'drag: orbit, shift-drag: pan, wheel: zoom');
    requestAnimationFrame(frame);
  }
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });

  rebuild(); setView(st.view); mark();
  requestAnimationFrame(frame);
  window.__hpreview = { set, info, kit: () => kit, lots, update: () => { placeCam(); kit.update(cam.position); renderer.render(scene, cam); } };
})();
