/*
 * Verdigris campaign - castle in the region (Phase 3 T04).
 * Places the castle kit (render/castle-kit.js) at every castle site of the town and adds the life around it:
 *   VRender.castleView.build(town, { tier }) -> { group, list, update(dt, { cam, time, night }), info(), dispose() }
 *   - LOD: the full kit inside data.castle.lod.near of the camera, the merged silhouette out to lod.far, nothing beyond
 *     (fog). A hysteresis band (lod.band) keeps the swap from flickering when the camera sits on the line.
 *   - night (0..1, from the sky): torches on the walls, lit windows, the silhouette's lights far away.
 *   - banners wave (kit shader), chimney smoke from the great hall (one small Points pool per castle, normal blend).
 * The LOD rule is core/castle.js lodFor (tested in Node).
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');

  const lodFor = (d, cur) => C.need('castle').lodFor(d, cur);

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
      list.push({ place: pl, kit, smoke, lod: 'full' });
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
      }
      if (Math.abs(nt - night) > 0.01) night = nt;
    }
    function info() {
      let calls = 0, tris = 0;
      for (const c of list) if (c.kit.group.visible) { const i = c.kit.info(); calls += i.calls + (c.lod === 'full' && c.smoke ? 1 : 0); tris += i.tris; }
      return { castles: list.length, calls, tris, lod: list.map(c => c.lod).join(',') };
    }
    function dispose() {
      for (const c of list) { if (c.smoke) c.smoke.dispose(); c.kit.dispose(); }
      list.length = 0;
      group.parent && group.parent.remove(group);
    }
    return { group, list, update, info, dispose };
  }

  VR.castleView = { build, chimney };
})(typeof window !== 'undefined' ? window : globalThis);
