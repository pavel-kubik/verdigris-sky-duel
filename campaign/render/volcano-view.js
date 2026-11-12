/*
 * Verdigris campaign - the volcano of a region with a crater (the Ash Wastes).
 * A lake of flowing lava in the crater, lava streams running down the flanks along core terrain.lavaFlows (the same
 * streams the rules treat as lava), a fountain of glowing lava thrown out of the crater in ballistic arcs with a
 * bigger burst every few seconds, and a column of ash and smoke drifting downwind. The crater light flares with
 * every burst.
 *   VRender.volcano.build(regionId, { particles }) -> { group, light, update(dt, time, camera, viewH), dispose() }
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const T = C.need('terrain');
  const VR = root.VRender = root.VRender || {};
  const TAU = Math.PI * 2;

  /** One ribbon mesh for every stream: it hugs the ground, uv.x across, uv.y downstream. */
  function streams(id) {
    const pos = [], uv = [], idx = [], COLS = 4, STEP = 4;
    for (const s of T.lavaFlows(id)) {
      const c = s.cone;
      let prev = null, dist = 0, row0 = -1;
      for (let r = s.r0; r <= s.r1 + 0.01; r += STEP) {
        const a = T.flowAngle(s, r), x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
        const a2 = T.flowAngle(s, r + 1), tx = c.x + Math.sin(a2) * (r + 1) - x, tz = c.z + Math.cos(a2) * (r + 1) - z, tl = Math.hypot(tx, tz) || 1;
        const px = tz / tl, pz = -tx / tl, w = Math.max(0.6, T.flowWidth(s, Math.min(r, s.r1 - 0.01)) * 1.25);
        if (prev) dist += Math.hypot(x - prev[0], z - prev[1]);
        prev = [x, z];
        const row = pos.length / 3;
        for (let k = 0; k <= COLS; k++) {
          const u = k / COLS, vx = x + px * w * (u - 0.5), vz = z + pz * w * (u - 0.5);
          pos.push(vx, T.surfaceAt(id, vx, vz) + 0.5 - Math.abs(u - 0.5) * 0.5, vz); uv.push(u, dist / 16);
        }
        if (row0 >= 0) for (let k = 0; k < COLS; k++) { const A = row0 + k, B = row + k; idx.push(A, B, A + 1, A + 1, B, B + 1); }
        row0 = row;
      }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    return g;
  }

  function build(id, opts) {
    opts = opts || {};
    const f = T.region(id).terrain.features.find(ff => ff.type === 'cone' && ff.crater);
    const group = new THREE.Group(); group.name = 'volcano';
    const y = T.lavaLevel(id), TX = root.VTex, FV = root.VForestView;
    const mats = [];
    const lakeM = TX ? TX.lava({ flow: 0.012, scale: 3.4, heat: 1.15 }).material : new THREE.MeshBasicMaterial({ color: 0xff6a1e });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(f.crater.r * 0.9, 40), lakeM);
    lake.rotation.x = -Math.PI / 2; lake.position.set(f.x, y, f.z); group.add(lake); mats.push(lakeM);
    const sg = streams(id);
    if (sg) {
      const sm = TX ? TX.lava({ flow: 0.085, scale: 1.6, edge: 0.2 }).material : new THREE.MeshBasicMaterial({ color: 0xff5a14 });
      const mesh = new THREE.Mesh(sg, sm); mesh.name = 'lava-streams'; mesh.renderOrder = 1; group.add(mesh); mats.push(sm);
    }
    const light = new THREE.PointLight(0xff6a20, 2.2, 480, 1.6); light.position.set(f.x, y + 34, f.z); group.add(light);

    const fxK = opts.particles == null ? 1 : opts.particles;
    const fire = FV ? FV.pool(Math.round(900 * Math.max(0.35, fxK)), true) : null, smoke = FV ? FV.pool(Math.round(220 * Math.max(0.35, fxK)), false) : null;
    if (smoke) { smoke.points.renderOrder = 2; group.add(smoke.points); }
    if (fire) { fire.points.renderOrder = 3; group.add(fire.points); }
    const rimY = T.heightAt(id, f.x + f.crater.r, f.z);
    let acc = 0, sAcc = 0, nextBurst = 4, flare = 0;
    function blob(power) {
      const a = Math.random() * TAU, r = Math.random() * f.crater.r * 0.45, out = 4 + Math.random() * 15 * power, up = (34 + Math.random() * 34) * power;
      fire.spawn(f.x + Math.cos(a) * r, y + 1, f.z + Math.sin(a) * r, Math.cos(a) * out, up, Math.sin(a) * out, 2.8 + Math.random() * 2.8, 5 + Math.random() * 6, 4);
    }
    function puff(big) {
      const a = Math.random() * TAU, r = Math.random() * f.crater.r * 0.5, hot = Math.random() < 0.35, g = 0.13 + Math.random() * 0.12;
      smoke.spawn(f.x + Math.cos(a) * r, rimY - 6 + Math.random() * 8, f.z + Math.sin(a) * r, (Math.random() - 0.5) * 3, (big ? 20 : 13) + Math.random() * 8, (Math.random() - 0.5) * 3,
        hot ? 3.5 : 11 + Math.random() * 7, hot ? 24 : 34 + Math.random() * 18, 2, hot ? 0.5 : g, hot ? 0.2 : g * 0.92, hot ? 0.08 : g * 0.88);
    }
    function update(dt, time, camera, viewH) {
      dt = dt || 0;
      flare = Math.max(0, flare - dt * 0.9);
      light.intensity = 2.2 * (0.85 + Math.sin(time * 1.7) * 0.1 + Math.sin(time * 4.3) * 0.05) + flare * 2.6;
      if (!fire || !dt) return;
      if (camera) { const k = viewH ? viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) : 500; fire.mat.uniforms.uScale.value = smoke.mat.uniforms.uScale.value = k; }
      acc += dt * 26 * fxK; sAcc += dt * 4.5 * fxK; nextBurst -= dt;
      while (acc >= 1) { acc--; blob(1); }
      while (sAcc >= 1) { sAcc--; puff(false); }
      if (nextBurst <= 0) {                                      // an eruption pulse
        nextBurst = 7 + Math.random() * 9; flare = 1;
        for (let k = 0; k < 110 * fxK; k++) blob(1.25 + Math.random() * 0.5);
        for (let k = 0; k < 9 * fxK; k++) puff(true);
      }
      fire.step(dt); smoke.step(dt);
    }
    function dispose() {
      lake.geometry.dispose(); if (sg) sg.dispose(); mats.forEach(m => m.dispose());
      [fire, smoke].forEach(P => { if (P) { P.geo.dispose(); P.mat.dispose(); } });
    }
    return { group, lake, light, y, update, dispose };
  }

  VR.volcano = { build };
})(typeof self !== 'undefined' ? self : this);
