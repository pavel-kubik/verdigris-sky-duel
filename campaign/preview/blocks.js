/*
 * Verdigris campaign - block preview page (Phase 4 T02): ONE basic block (core/blocks.js catalog: a house of the house
 * kit, a settlement or castle piece, a bridge, a tree, a terrain feature) on a test ground (flat, slope, step), its
 * collision shape and walkable top (T01's overlay, render/debug-shapes.js), and a test body (the hero walker, a dragon
 * walking or hovering) driven by the stick / keys or by a scripted push from 8 directions. Live readouts come from the
 * core queries (ground, push-out depth and normal, on a walk top or blocked, landing allowed and why not).
 * Pause, one frame, slow motion. URL: ?block=castle:wall&ground=slope&body=hero&push=3&pause=1&slow=1
 * window.__vblocks = { set(opts), info(), read(), push(dir), frames(n), world() } for the headless check.
 */
(function () {
  'use strict';
  const BUILD = 't302.1 2026-11-18 block preview: one block, test grounds, hero / dragon / hover bodies, pushes, readouts';
  const THREE = window.THREE, C = window.VCamp, VR = window.VRender, I = window.I18N;
  const BK = C.need('blocks'), T = C.need('terrain'), D = C.need('data'), SH = C.need('shapes');
  const t = (k, p) => (I ? I.t(k, p) : k);
  const params = new URLSearchParams(location.search);
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const errEl = document.getElementById('err');
  window.addEventListener('error', e => { errEl.textContent = String(e.message); });

  const renderer = new THREE.WebGLRenderer({ antialias: !touch });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x9cc4e4);
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 3000);
  const sun = new THREE.DirectionalLight(0xfff1d8, 1);
  sun.position.set(120, 200, 80);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x5a5040, 0.8), sun);
  scene.fog = new THREE.Fog(0x9cc4e4, 400, 1600);

  const houses = VR.houseKit ? { styles: VR.houseKit.styles, kinds: VR.houseKit.kinds } : null;
  const CAT = BK.catalog(houses ? { houses } : null);
  const pick = (k, list, def) => (list.indexOf(params.get(k)) >= 0 ? params.get(k) : def);
  const st = {
    block: CAT.some(c => c.id === params.get('block')) ? params.get('block') : 'castle:wall',
    ground: pick('ground', BK.GROUNDS, 'flat'), body: pick('body', BK.BODIES, 'hero'),
    paused: params.get('pause') === '1', slow: params.get('slow') === '1', shapes: params.get('shapes') !== '0',
  };
  let W = null, body = null, scripted = null, pushDir = -1, steps = 0;
  const blockGroup = new THREE.Group(); scene.add(blockGroup);
  const disposers = [];
  const overlay = VR.debugShapes.build(); scene.add(overlay.group);
  const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false }));
  trail.frustumCulled = false; trail.renderOrder = 11; scene.add(trail);

  /* ---------- the bodies' models ---------- */
  const heroFig = window.VHuman ? VHuman.make('wizard', { seed: 3 }) : null;
  const dragon = window.VDragon ? VDragon.makeDragon(VDragon.GREEN) : null;
  if (heroFig) scene.add(heroFig.root);
  if (dragon) scene.add(dragon.root);
  const marker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }));
  marker.renderOrder = 9; scene.add(marker);

  /* ---------- the block and the ground ---------- */
  const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  function clearBlock() {
    while (disposers.length) disposers.pop()();
    while (blockGroup.children.length) blockGroup.remove(blockGroup.children[0]);
  }
  function groundMesh() {
    const R = Math.max(70, W.bound.r * 2.2), N = Math.min(160, Math.round(R / 1.2)), g = new THREE.PlaneGeometry(R * 2, R * 2, N, N).rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) p.setY(i, T.meshAt(W.regionId, p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), chk = (Math.floor(x / 4) + Math.floor(z / 4)) & 1;
      c.setHex(nr.getY(i) < 0.75 ? 0x9a9384 : 0x6d7a48).multiplyScalar(chk ? 1 : 0.9);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, mat());
    disposers.push(() => { g.dispose(); m.material.dispose(); });
    return m;
  }
  function addGeos(geos, x, y, z, yaw, sz) {
    const mm = mat();
    for (const g of geos) {
      const m = new THREE.Mesh(g, mm); m.position.set(x, y, z); m.rotation.y = yaw || 0; if (sz) m.scale.z = sz;
      blockGroup.add(m); disposers.push(() => g.dispose());
    }
    disposers.push(() => mm.dispose());
  }
  function blockModel() {
    const e = W.block;
    if (e.group === 'house' && VR.houseKit) addGeos(VR.houseKit.model(W.lot, 'high'), 0, W.lot.y, 0, 0);
    else if (e.group === 'building' && VR.settlements) {
      const v = VR.settlements.build(W.town); blockGroup.add(v.group); disposers.push(() => v.dispose());
      v.update(W.town, 0, {});
    } else if (e.group === 'castle' && VR.castleKit) {
      const M = VR.castleKit.models('high')[e.type === 'chapel' ? 'chapel' : e.type] || {}, b = W.town.buildings[0];
      const parts = ['stone', 'roof', 'win', 'flag'].map(k => M[k]).filter(Boolean);
      if (b.seg) {                                                     // wall modules are 4 units along local Z
        const n = Math.max(1, Math.round(b.len / 4)), sz = b.len / n / 4;
        for (let i = 0; i < n; i++) addGeos(parts.map(g => g.clone()), 0, b.pos[1], -b.len / 2 + (i + 0.5) * b.len / n, Math.PI, sz);
        parts.forEach(g => g.dispose());
      } else addGeos(parts, 0, b.pos[1], 0, 0);
    } else if (e.group === 'bridge' && VR.bridges) {
      const v = VR.bridges.build(W.regionId); if (v) { blockGroup.add(v.group); disposers.push(() => v.dispose()); }
    } else if (e.group === 'tree' && window.VForest && window.VForestView) {
      const sz = VForestView.size(e.kind, 1, 1), y = T.surfaceAt(W.regionId, 0, 0);
      const F = VForest.create([{ x: 0, y, z: 0, r: sz.r, h: sz.h, kind: 0 }]);
      const v = VForestView.build(F, { kinds: [e.kind], groundAt: (x, z) => T.surfaceAt(W.regionId, x, z), particles: 0 });
      blockGroup.add(v.group); disposers.push(() => v.dispose());
    }
  }

  function load() {
    clearBlock();
    W = BK.world(st.block, st.ground);
    blockGroup.add(groundMesh());
    try { blockModel(); } catch (err) { errEl.textContent = 'model: ' + err.message; }
    overlay.update({ regionId: W.regionId, shapes: W.shapes, x: 0, z: 0, radius: W.bound.r + 40, raster: 0 });
    overlay.group.visible = st.shapes;
    resetBody();
    orb.r = Math.max(30, W.bound.r * 2.6); orb.target.set(0, W.bound.top * 0.4, 0);
  }

  function resetBody(dir) {
    scripted = null; trailPts.length = 0;
    const r = W.bound.r + 8, a = dir != null ? dir / 8 * Math.PI * 2 : 0;
    body = BK.body(W, st.body, [-Math.sin(a) * r, null, -Math.cos(a) * r], a);
  }

  /** A scripted push: the body heads at the block's centre from direction dir (played in real time). */
  function startPush(dir) {
    pushDir = ((dir % 8) + 8) % 8;
    resetBody(pushDir);
    scripted = { t: 0, dur: (W.bound.r * 2 + 18) / 3, worst: 0 };
  }

  /* ---------- input ---------- */
  const keys = {}, stick = { x: 0, y: 0 }, held = { run: false, jump: false, down: false };
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyP') set({ paused: !st.paused });
    if (e.code === 'KeyN') frames(1);
    if (e.code === 'KeyM') set({ slow: !st.slow });
    if (e.code === 'KeyR') resetBody();
    if (/^Digit[1-8]$/.test(e.code)) startPush(+e.code.slice(5) - 1);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  function input() {
    let sx = stick.x, sy = stick.y;
    if (keys.KeyA || keys.ArrowLeft) sx -= 1; if (keys.KeyD || keys.ArrowRight) sx += 1;
    if (keys.KeyW || keys.ArrowUp) sy += 1; if (keys.KeyS || keys.ArrowDown) sy -= 1;
    return { sx: Math.max(-1, Math.min(1, sx)), sy: Math.max(-1, Math.min(1, sy)), run: held.run || keys.ShiftLeft || keys.ShiftRight || (st.body === 'hover' && (held.down || keys.KeyC)),
             jump: held.jump || keys.Space };
  }
  const stickEl = document.getElementById('stick'), knob = document.getElementById('knob');
  let stickId = null;
  const stickMove = e => {
    const r = stickEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    stick.x = dx; stick.y = -dy; knob.style.transform = 'translate(' + dx * R * 0.6 + 'px,' + dy * R * 0.6 + 'px)';
  };
  stickEl.addEventListener('pointerdown', e => { stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); e.stopPropagation(); });
  stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
  const stickUp = e => { if (e.pointerId !== stickId) return; stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; };
  stickEl.addEventListener('pointerup', stickUp); stickEl.addEventListener('pointercancel', stickUp);
  const acts = document.getElementById('acts');
  for (const [k, label] of [['jump', 'c.bk.jump'], ['run', 'c.bk.run'], ['down', 'c.bk.down']]) {
    const b = document.createElement('button'); b.textContent = t(label); b.dataset.k = k;
    b.addEventListener('pointerdown', e => { held[k] = true; b.classList.add('on'); e.stopPropagation(); });
    const off = () => { held[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    acts.appendChild(b);
  }

  /* ---------- orbit camera (drag, pinch / wheel) ---------- */
  const orb = { target: new THREE.Vector3(), r: 60, th: 0.7, ph: 1.05 };
  function placeCam() {
    orb.ph = Math.max(0.12, Math.min(1.5, orb.ph)); orb.r = Math.max(4, Math.min(600, orb.r));
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

  /* ---------- UI ---------- */
  const sel = document.getElementById('sel');
  for (const c of CAT) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.group + ': ' + c.label; sel.appendChild(o); }
  sel.onchange = () => set({ block: sel.value });
  const cycle = k => { const i = CAT.findIndex(c => c.id === st.block); set({ block: CAT[(i + k + CAT.length) % CAT.length].id }); };
  document.getElementById('bPrev').onclick = () => cycle(-1);
  document.getElementById('bNext').onclick = () => cycle(1);
  function buttons(rowId, list) {
    const row = document.getElementById(rowId);
    for (const [val, label, fn] of list) { const b = document.createElement('button'); b.textContent = t(label); b.dataset.val = val; b.onclick = fn; row.appendChild(b); }
  }
  buttons('rGround', BK.GROUNDS.map(g => [g, 'c.bk.' + g, () => set({ ground: g })]));
  buttons('rBody', BK.BODIES.map(g => [g, 'c.bk.' + g, () => set({ body: g })]));
  buttons('rCtl', [['pause', 'c.bk.pause', () => set({ paused: !st.paused })], ['frame', 'c.bk.frame', () => frames(1)],
    ['slow', 'c.bk.slow', () => set({ slow: !st.slow })], ['push', 'c.bk.push', () => startPush(pushDir + 1)],
    ['shapes', 'c.bk.shapes', () => set({ shapes: !st.shapes })], ['reset', 'c.bk.reset', () => resetBody()]]);
  if (I && I.apply) I.apply();
  function mark() {
    sel.value = st.block;
    for (const b of document.querySelectorAll('#rGround button')) b.classList.toggle('on', b.dataset.val === st.ground);
    for (const b of document.querySelectorAll('#rBody button')) b.classList.toggle('on', b.dataset.val === st.body);
    for (const b of document.querySelectorAll('#rCtl button')) b.classList.toggle('on', (b.dataset.val === 'pause' && st.paused) || (b.dataset.val === 'slow' && st.slow) || (b.dataset.val === 'shapes' && st.shapes));
    const pb = document.querySelector('#rCtl button[data-val="pause"]'); if (pb) pb.textContent = t(st.paused ? 'c.bk.play' : 'c.bk.pause');
  }
  function set(o) {
    const reload = (o.block && o.block !== st.block) || (o.ground && o.ground !== st.ground);
    const rebody = o.body && o.body !== st.body;
    Object.assign(st, o);
    if (reload) load(); else if (rebody) resetBody();
    overlay.group.visible = st.shapes;
    mark();
  }

  /* ---------- simulation ---------- */
  const DT = 1 / 30, trailPts = [];
  let acc = 0;
  function tick() {
    let inp = input();
    if (scripted) {
      const yaw = Math.atan2(-body.pos[0], -body.pos[2]);
      if (body.h) body.h.yaw = yaw; else body.p.yaw = yaw;
      inp = { sy: 1 };
      scripted.t += DT;
      if (scripted.t > scripted.dur || Math.hypot(body.pos[0], body.pos[2]) < 0.5) scripted = null;
    }
    BK.step(W, body, inp, DT);
    steps++;
    if (steps % 3 === 0) { trailPts.push(body.pos[0], body.pos[1] + 0.2, body.pos[2]); if (trailPts.length > 900) trailPts.splice(0, 3); }
  }
  function frames(n) { for (let i = 0; i < n; i++) tick(); }

  function showBody() {
    const p = body.pos, yaw = body.h ? body.h.yaw : body.p.yaw;
    if (heroFig) { heroFig.root.visible = st.body === 'hero'; heroFig.root.position.set(p[0], p[1], p[2]); heroFig.root.rotation.y = yaw; }
    if (dragon) {
      dragon.root.visible = st.body !== 'hero';
      dragon.root.position.set(p[0], p[1] - (st.body === 'dragon' ? D.walk.stand : 0), p[2]); dragon.root.rotation.y = yaw;
      dragon.root.scale.setScalar(0.55);
    }
    marker.scale.set(body.pad, 1, body.pad);
    marker.position.set(p[0], p[1] - (st.body === 'dragon' ? D.walk.stand : 0) + 0.06, p[2]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(trailPts.slice(), 3));
    trail.geometry.dispose(); trail.geometry = g;
  }

  const stats = document.getElementById('stats');
  let fps = 0, fr = 0, facc = 0, last = performance.now();
  function info() {
    const r = BK.read(W, body);
    return { build: BUILD, block: st.block, ground: st.ground, body: st.body, paused: st.paused, slow: st.slow, push: pushDir, scripted: !!scripted,
      pos: body.pos.slice(), read: r, shapes: W.shapes.length, calls: renderer.info.render.calls, fps: Math.round(fps), steps };
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fr++; facc += dt; if (facc > 0.5) { fps = fr / facc; fr = 0; facc = 0; }
    if (!st.paused) { acc += dt * (st.slow ? 0.2 : 1); let n = 0; while (acc >= DT && n < 6) { tick(); acc -= DT; n++; } if (n === 6) acc = 0; }
    showBody();
    orb.target.lerp(new THREE.Vector3(body.pos[0] * 0.5, Math.max(body.pos[1], W.bound.top * 0.4), body.pos[2] * 0.5), Math.min(1, dt * 1.5));
    placeCam();
    renderer.render(scene, cam);
    const r = BK.read(W, body), e = W.block;
    stats.textContent = 'build ' + BUILD.split(' ')[0] + (params.get('v') ? ' (v=' + params.get('v') + ')' : '') + '  ' + e.group + ': ' + e.label + '  ' + Math.round(fps) + ' fps' +
      (st.paused ? '  PAUSED' : st.slow ? '  SLOW' : '') + (scripted ? '  push ' + (pushDir + 1) + '/8' : '') + '\n' + BK.lines(r).join('\n') + '\n' + t(touch ? 'c.bk.hint' : 'c.bk.hintMouse');
    const h = stats.offsetHeight + 16;
    stickEl.style.bottom = acts.style.bottom = h + 'px';
    requestAnimationFrame(frame);
  }
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });

  load(); mark();
  if (params.get('push') != null && /^[1-8]$/.test(params.get('push'))) startPush(+params.get('push') - 1);
  placeCam();
  requestAnimationFrame(frame);
  window.__vblocks = { set, info, read: () => BK.read(W, body), push: startPush, frames, world: () => W, body: () => body, catalog: CAT, BUILD,
    cam: (th, ph, r) => { orb.th = th; orb.ph = ph; orb.r = r; } };
})();
