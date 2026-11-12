/*
 * Verdigris campaign - the intercept mission's wagon (Phase 3 T15, core/caravan.js; 003_task_missions.md section 6).
 * A covered tithe wagon (wood box, white canvas hoops, the Order's red pennant on a pole), pulled by two oxen, drawn
 * larger than life (VIS) like the prey and the loot. The wheels turn and the oxen bob while it drives; under the breath
 * it flickers orange with small flames on the canvas; a stopped wagon is charred and leans on a broken wheel (its chest
 * is drawn by render/loot-view.js, its escort by render/defender-view.js). An hp bar floats over it while it is hurt.
 *   VRender.caravan.build() -> { group, update(cs, time, camera, dt), info: { shown }, dispose() }
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');
  const VIS = 1.5;

  function mat(color, o) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.9 }, o || {}));
    return root.VTex && !(o && o.metalness) ? root.VTex.detail(m, { map: 'wood', scale: 2.5, strength: 0.55, bump: 1, local: true }) : m;
  }

  function wagon() {
    const g = new THREE.Group();
    const wood = mat(0x7a5230), dark = mat(0x4a3220), canvas = mat(0xe8dfc8, { side: THREE.DoubleSide }), red = mat(0xa01c1c, { side: THREE.DoubleSide }), iron = mat(0x3a3d42, { metalness: 0.5, roughness: 0.6 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.2), wood); bed.position.y = 1.25; g.add(bed);
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 3.8, 10, 1, true, -Math.PI / 2, Math.PI), canvas);
    cover.rotation.x = -Math.PI / 2; cover.position.y = 1.6; g.add(cover);   // the open half cylinder arches up over the bed
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 3.2), dark); shaft.position.set(0, 0.9, 3.4); g.add(shaft);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), dark); pole.position.set(0.9, 3.1, -1.6); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), red); flag.position.set(0.9, 3.95, -2.1); flag.rotation.y = Math.PI / 2; g.add(flag);
    const wheels = [];
    const wg = new THREE.CylinderGeometry(0.75, 0.75, 0.2, 10);
    for (const [x, z] of [[-1.2, 1.3], [1.2, 1.3], [-1.2, -1.3], [1.2, -1.3]]) {
      const w = new THREE.Group(); w.position.set(x, 0.75, z);
      const rim = new THREE.Mesh(wg, iron); rim.rotation.z = Math.PI / 2; w.add(rim);
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.3, 0.12), wood); w.add(spoke);
      const spoke2 = spoke.clone(); spoke2.rotation.x = Math.PI / 2; w.add(spoke2);
      g.add(w); wheels.push(w);
    }
    const oxen = [];
    for (const x of [-0.75, 0.75]) {
      const o = new THREE.Group(); o.position.set(x, 0, 5.2);
      const hide = mat(0x6b4a33), horn = mat(0xe6dcc0);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 2.1), hide); body.position.y = 1.3; o.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.7), hide); head.position.set(0, 1.45, 1.3); o.add(head);
      const horns = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), horn); horns.position.set(0, 1.8, 1.25); o.add(horns);
      for (const [lx, lz] of [[-0.35, 0.75], [0.35, 0.75], [-0.35, -0.75], [0.35, -0.75]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.22), hide); l.position.set(lx, 0.42, lz); o.add(l); }
      g.add(o); oxen.push(o);
    }
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.14), dark); yoke.position.set(0, 1.95, 6.0); g.add(yoke);
    const flames = new THREE.Group(); flames.visible = false;
    const fm = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, depthWrite: false });
    for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.3, 5), fm); f.position.set((i % 2 ? 0.5 : -0.5), 2.7, -1.5 + i * 0.75); flames.add(f); }
    g.add(flames);
    g.scale.setScalar(VIS);
    return { g, wheels, oxen, flames, canvas, wood };
  }

  function build() {
    const group = new THREE.Group(); group.name = 'caravans';
    const shown = new Map();                                     // caravan id -> parts
    const barBg = new THREE.MeshBasicMaterial({ color: 0x1a0d08, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
    const barFg = new THREE.MeshBasicMaterial({ color: 0xff9447, depthWrite: false, fog: false });
    const info = { shown: 0 };

    function make(cv) {
      const w = wagon();
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.5), barBg); bar.add(bg);
      const fg = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.32), barFg); fg.position.z = 0.01; bar.add(fg);
      bar.position.y = 7.5; bar.renderOrder = 5;
      w.g.add(bar); w.bar = bar; w.fg = fg; w.roll = 0;
      group.add(w.g);
      return w;
    }

    function update(cs, time, camera, dt) {
      const list = cs.caravans || {}, here = new Set();
      for (const id in list) {
        const cv = list[id];
        if (cv.region !== cs.region || cs.inLair) continue;
        here.add(id);
        let w = shown.get(id);
        if (!w) { w = make(cv); shown.set(id, w); }
        w.g.position.set(cv.pos[0], cv.pos[1], cv.pos[2]);
        w.g.rotation.set(0, cv.yaw, 0);
        const moving = cv.state === 'moving';
        if (moving) w.roll += (cv.speed / (0.75 * VIS)) * (dt || 1 / 60);
        for (const wh of w.wheels) wh.rotation.x = w.roll;
        w.oxen.forEach((o, i) => { o.position.y = moving ? Math.abs(Math.sin(time * 4 + i * 1.7)) * 0.08 : 0; });
        const burning = cv.burnT > 0, dead = cv.state === 'stopped';
        w.flames.visible = burning;
        if (w.flames.visible) w.flames.children.forEach((f, i) => { f.scale.y = 0.7 + 0.5 * Math.abs(Math.sin(time * 9 + i)); });
        w.canvas.color.setHex(dead ? 0x2a2420 : 0xe8dfc8);
        w.wood.color.setHex(dead ? 0x2b1d14 : 0x7a5230);
        w.canvas.emissive.setHex(burning ? (((time * 12) | 0) % 2 ? 0x8a3000 : 0x4a1800) : 0x000000);
        w.g.rotation.z = dead ? 0.12 : 0;                         // leans on a broken wheel
        const k = Math.max(0, cv.hp / cv.hpMax);
        w.bar.visible = k < 1 && k > 0;
        w.fg.scale.x = Math.max(0.001, k); w.fg.position.x = -2 * (1 - k);
        if (camera) { w.bar.quaternion.copy(w.g.quaternion).invert().multiply(camera.quaternion); }
      }
      for (const [id, w] of shown) if (!here.has(id)) { group.remove(w.g); w.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); shown.delete(id); }
      info.shown = shown.size;
    }

    function dispose() {
      for (const [, w] of shown) w.g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      shown.clear();
    }
    return { group, update, info, dispose };
  }

  VR.caravan = { build };
})(typeof self !== 'undefined' ? self : this);
