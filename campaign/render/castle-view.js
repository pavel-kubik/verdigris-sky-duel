/*
 * Verdigris campaign - castle in the region (Phase 3 T04).
 * Places the castle kit (render/castle-kit.js) at every castle site of the town and adds the life around it:
 *   VRender.castleView.build(town, { tier }) -> { group, list, update(dt, { cam, time, night }), info(), dispose() }
 *   - LOD: the full kit inside data.castle.lod.near of the camera, the merged silhouette out to lod.far, nothing beyond
 *     (fog). A hysteresis band (lod.band) keeps the swap from flickering when the camera sits on the line.
 *   - night (0..1, from the sky): torches on the walls, lit windows, the silhouette's lights far away.
 *   - banners wave (kit shader), chimney smoke from the great hall (one small Points pool per castle, normal blend).
 *   - T05: the portcullis follows town.gateK (kit.setGate), a red signal fire on the keep top while town.signal
 *     (update's o.town, else the town it was built from).
 *   - T06: burned pieces follow the town (kit.setBurn): charred stone pieces dark and roofless, ruined wooden ones
 *     (hall, workshop, stables) hidden (settlement-view draws their rubble); the hall's smoke stops while it is a ruin.
 *     burnOf(town, place, type, x, z) maps a kit instance (local frame) to its town building's state (core-free, tested).
 * The LOD rule is core/castle.js lodFor (tested in Node).
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');

  const lodFor = (d, cur) => C.need('castle').lodFor(d, cur);

  /** T06: the town building drawn by kit instance (type, x, z) of place pl: wall modules by the wall run they sit on,
   *  other pieces by type and position; the gate module (portcullis and arch) never burns. -> building | null */
  function pieceOf(town, pl, type, x, z) {
    if (type === 'gate') return null;
    const SE = C.need('settlement'), c = Math.cos(pl.yaw || 0), s = Math.sin(pl.yaw || 0);
    const wx = pl.x + x * c + z * s, wz = pl.z - x * s + z * c;
    let best = null, bd = type === 'wall' ? 1.5 : 2;
    for (const b of town.buildings) {
      if (b.place !== pl.id || b.type !== type) continue;
      const d = type === 'wall' ? Math.max(0, SE.sd(b, wx, wz).d) : Math.hypot(b.pos[0] - wx, b.pos[2] - wz);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  const burnOf = b => (!b ? 0 : b.ruin ? 2 : b.char ? 1 : 0);

  const smokeTex = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  /** Chimney smoke: N puffs cycling up from `at` (local to the kit group), drifting with a slow wind. */
  function smokePool(at, n) {
    const pos = new Float32Array(n * 3), alpha = new Float32Array(n), size = new Float32Array(n), age = new Float32Array(n);
    for (let i = 0; i < n; i++) age[i] = i / n;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: smokeTex }, scale: { value: 400 }, tint: { value: new THREE.Color(0x8a8780) } },
      vertexShader: 'attribute float alpha; attribute float size; varying float vA; uniform float scale;' +
        'void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; uniform vec3 tint; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(tint, t.a * vA); }',
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    const S = D.castle.smoke;
    function update(dt, night) {
      for (let i = 0; i < n; i++) {
        age[i] = (age[i] + dt / S.life) % 1;
        const a = age[i], k = i * 2.39;
        pos[i * 3] = at[0] + a * S.drift + Math.sin(k + a * 4) * 0.8;
        pos[i * 3 + 1] = at[1] + a * S.rise;
        pos[i * 3 + 2] = at[2] + a * S.drift * 0.4 + Math.cos(k) * 0.6;
        alpha[i] = Math.sin(Math.PI * a) * S.alpha * (1 - 0.5 * night);
        size[i] = S.size * (0.5 + a);
      }
      geo.attributes.position.needsUpdate = geo.attributes.alpha.needsUpdate = geo.attributes.size.needsUpdate = true;
      mat.uniforms.tint.value.setHex(night > 0.5 ? 0x45454c : 0x8a8780);
    }
    return { pts, update, dispose() { geo.dispose(); mat.dispose(); } };
  }

  /** T05: the red signal fire on the keep top while the castle is alarmed (one additive Points, visible far out). */
  function signalFire(at) {
    const tex = (() => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.3, 'rgba(255,80,30,0.85)'); gr.addColorStop(1, 'rgba(200,20,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })();
    const n = 5, pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: tex, size: 9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff5a2a });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.visible = false;
    let k = 0;
    function update(dt, t, on) {
      k = Math.max(0, Math.min(1, k + (on ? dt : -dt) * 0.8));
      pts.visible = k > 0.01;
      if (!pts.visible) return;
      for (let i = 0; i < n; i++) {
        const a = (t * 1.7 + i / n) % 1;
        pos[i * 3] = at[0] + Math.sin(i * 2.4 + t * 3) * 0.7; pos[i * 3 + 1] = at[1] + a * 5; pos[i * 3 + 2] = at[2] + Math.cos(i * 1.7 + t * 2.3) * 0.7;
      }
      geo.attributes.position.needsUpdate = true;
      mat.size = 9 * k * (0.85 + 0.15 * Math.sin(t * 11)); mat.opacity = k;
    }
    return { pts, update, dispose() { geo.dispose(); mat.dispose(); if (tex) tex.dispose(); } };
  }

  /** The hall's chimney top (kit model frame) in the castle's local frame. */
  function chimney(hall, at) {
    const c = Math.cos(hall.yaw || 0), s = Math.sin(hall.yaw || 0);
    return [hall.x + at[0] * c + at[2] * s, at[1], hall.z - at[0] * s + at[2] * c];
  }

  function build(town, opts) {
    opts = opts || {};
    const group = new THREE.Group(); group.name = 'castles';
    const list = [], CA = C.need('castle'), KIT = VR.castleKit;
    for (const pl of (town && town.places) || []) {
      if (!pl.castle || !KIT) continue;
      const L = CA.layout(D.settlements[pl.type]), kit = KIT.build(L, { tier: opts.tier });
      kit.group.position.set(pl.x, pl.y, pl.z);
      kit.group.rotation.y = pl.yaw || 0;
      group.add(kit.group);
      const hall = L.buildings.find(b => b.type === 'hall');
      const smoke = kit.smoke && hall ? smokePool(chimney(hall, kit.smoke), D.castle.smoke.puffs) : null;
      if (smoke) kit.full.add(smoke.pts);
      const keep = L.buildings.find(b => b.type === 'keep');
      const signal = keep ? signalFire([keep.x, keep.h + 12, keep.z]) : null;   // over the keep's lead roof (apex h + 11)
      if (signal) kit.group.add(signal.pts);                                 // both LODs: the alarm shows far out
      list.push({ place: pl, kit, smoke, signal, lod: 'full', gate: 0 });
    }
    let night = -1;
    function update(dt, o) {
      o = o || {};
      const cam = o.cam, nt = Math.max(0, Math.min(1, o.night || 0));
      for (const c of list) {
        if (cam) {
          const d = Math.hypot(cam.x - c.place.x, cam.z - c.place.z);
          c.lod = lodFor(d, c.lod);
          c.kit.group.visible = c.lod !== 'off';
          if (c.lod !== 'off') c.kit.setLod(c.lod);
        }
        if (Math.abs(nt - night) > 0.01) c.kit.setNight(nt);
        if (c.lod === 'full') { c.kit.update(dt, o.time || 0); if (c.smoke) c.smoke.update(dt, nt); }
        const tw = o.town || town;                                           // T05: gate and signal fire follow the town
        const gk = tw && tw.gateK || 0;
        if (Math.abs(gk - c.gate) > 1e-3) { c.gate = gk; c.kit.setGate(gk); }
        if (c.signal) c.signal.update(dt, o.time || 0, !!(tw && tw.signal) && c.lod !== 'off');
        if (tw) {                                                            // T06: charred and ruined pieces
          if (c.burnTown !== tw) {                                         // map kit instances to the town's buildings once per town
            c.burnTown = tw; c.burnMap = new Map(); c.burnSig = null;
            const own = tw.places.find(p => p.id === c.place.id) || c.place;
            c.hallB = tw.buildings.find(b => b.place === own.id && b.type === 'hall') || null;
            c.kit.setBurn((type, x, z) => { c.burnMap.set(type + ':' + x + ':' + z, pieceOf(tw, own, type, x, z)); return 0; });
          }
          let sig = '';
          for (const b of c.burnMap.values()) sig += b ? burnOf(b) : 0;
          if (sig !== c.burnSig) {
            c.burnSig = sig;
            c.kit.setBurn((type, x, z) => burnOf(c.burnMap.get(type + ':' + x + ':' + z)));
          }
          if (c.smoke) c.smoke.pts.visible = !(c.hallB && c.hallB.ruin);
        }
      }
      if (Math.abs(nt - night) > 0.01) night = nt;
    }
    function info() {
      let calls = 0, tris = 0;
      for (const c of list) if (c.kit.group.visible) { const i = c.kit.info(); calls += i.calls + (c.lod === 'full' && c.smoke ? 1 : 0) + (c.signal && c.signal.pts.visible ? 1 : 0); tris += i.tris; }
      return { castles: list.length, calls, tris, lod: list.map(c => c.lod).join(',') };
    }
    function dispose() {
      for (const c of list) { if (c.smoke) c.smoke.dispose(); if (c.signal) c.signal.dispose(); c.kit.dispose(); }
      list.length = 0;
      group.parent && group.parent.remove(group);
    }
    return { group, list, update, info, dispose };
  }

  VR.castleView = { build, chimney, pieceOf, burnOf };
})(typeof window !== 'undefined' ? window : globalThis);
