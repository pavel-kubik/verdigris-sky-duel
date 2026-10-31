/*
 * Verdigris campaign - defenders view (Phase 2 T15, core/defenders.js): peasants, archers, arrows.
 *   VRender.defenders.build() -> { group, update(squad, { time }), dispose(), info }
 * Figures: one vertex-coloured InstancedMesh per kind (peasant: tunic, head, straw hat; archer: Order blue-grey coat,
 * helmet, bow), turned to their yaw, a walk bob while moving; dead and hidden ones are not drawn; a defender in the
 * breath (burnT) glows orange. The ballista crew comes with T16. Arrows: one InstancedMesh of thin shafts (pool size
 * projectiles.max) along their velocity, stuck ones keep their last direction. Awareness marks are render/watch-view.js.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');
  const S = 1.35;                                  // figures a bit larger than life, so they read on a phone

  function part(geo, col) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const n = g.attributes.position.count, c = new Float32Array(n * 3), k = new THREE.Color(col);
    for (let i = 0; i < n; i++) { c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  function merge(list) {
    const pos = [], nor = [], col = [];
    for (const g of list) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); col.push(...g.attributes.color.array); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  /** Feet at y = 0, eye at about defense.eye / S. */
  function figure(kind) {
    const parts = [
      part(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 6).translate(0, 0.4, 0), kind === 'archer' ? 0x2c3442 : 0x5a4630),   // legs
      part(new THREE.CylinderGeometry(0.3, 0.36, 0.7, 6).translate(0, 1.1, 0), kind === 'archer' ? 0x4a5d7e : 0x9a6a3a),   // body
      part(new THREE.SphereGeometry(0.2, 6, 4).translate(0, 1.6, 0), 0xe0b48e),                                            // head
    ];
    if (kind === 'archer') {
      parts.push(part(new THREE.ConeGeometry(0.24, 0.3, 6).translate(0, 1.82, 0), 0x9aa3ad));                               // helmet
      parts.push(part(new THREE.TorusGeometry(0.5, 0.04, 3, 8, Math.PI).rotateZ(-Math.PI / 2).translate(0, 1.15, 0.38), 0x6b4a26));  // bow
      parts.push(part(new THREE.BoxGeometry(0.5, 0.36, 0.06).translate(0, 1.15, -0.3), 0xb8322a));                           // Order tabard back
    } else {
      parts.push(part(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 8).translate(0, 1.76, 0), 0xd9c27a));                    // straw hat
      parts.push(part(new THREE.ConeGeometry(0.2, 0.18, 6).translate(0, 1.88, 0), 0xd9c27a));
    }
    return merge(parts);
  }

  function build() {
    const group = new THREE.Group();
    group.name = 'defenders';
    const info = { drawn: 0, arrows: 0 };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const kinds = {};
    const cap = { peasant: 64, archer: 48 };
    for (const k of ['peasant', 'archer']) {
      const m = new THREE.InstancedMesh(figure(k), mat, cap[k]);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap[k]; i++) m.setColorAt(i, new THREE.Color(1, 1, 1));   // before count = 0: setColorAt sizes the buffer by count
      m.count = 0; m.frustumCulled = false;
      group.add(m); kinds[k] = m;
    }
    const arrowGeo = new THREE.BoxGeometry(0.1, 0.1, 2.0);
    const arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xf1e2b8 }), D.projectiles.max);
    arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    arrows.count = 0; arrows.frustumCulled = false;
    group.add(arrows);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(S, S, S), e = new THREE.Euler();
    const fwd = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const white = new THREE.Color(1, 1, 1), hot = new THREE.Color(2.2, 0.9, 0.3), tmp = new THREE.Color();

    function update(sq, ctx) {
      const time = (ctx && ctx.time) || 0, n = { peasant: 0, archer: 0 };
      info.drawn = 0;
      for (const d of (sq && sq.list) || []) {
        const m = kinds[d.kind];
        if (!m || !d.alive || d.hidden || n[d.kind] >= cap[d.kind]) continue;
        const bob = d.walk > 0 ? Math.abs(Math.sin(time * d.walk * 1.6 + d.phase)) * 0.18 : 0;
        v.set(d.pos[0], d.pos[1] - D.defense.eye + bob, d.pos[2]);
        if (d.kind === 'archer') v.y = d.pos[1] - D.perception.watch.eye;
        e.set(0, d.yaw, d.walk > 0 ? Math.sin(time * d.walk * 1.6 + d.phase) * 0.08 : 0);
        q.setFromEuler(e);
        m4.compose(v, q, sc);
        const i = n[d.kind]++;
        m.setMatrixAt(i, m4);
        m.setColorAt(i, d.burnT > 0 ? tmp.copy(white).lerp(hot, Math.min(1, d.burnT * 3)) : white);
      }
      for (const k in kinds) {
        kinds[k].count = n[k]; kinds[k].instanceMatrix.needsUpdate = true;
        if (kinds[k].instanceColor) kinds[k].instanceColor.needsUpdate = true;
        info.drawn += n[k];
      }
      let a = 0;
      for (const r of (sq && sq.arrows) || []) {
        if (a >= D.projectiles.max) break;
        if (r.stuck > 0 && r.dir) dir.set(r.dir[0], r.dir[1], r.dir[2]);
        else dir.set(r.vel[0], r.vel[1], r.vel[2]).normalize();
        q.setFromUnitVectors(fwd, dir);
        v.set(r.pos[0], r.pos[1], r.pos[2]);
        m4.compose(v, q, one);
        arrows.setMatrixAt(a++, m4);
      }
      arrows.count = a; arrows.instanceMatrix.needsUpdate = true;
      info.arrows = a;
    }

    function dispose() { for (const k in kinds) kinds[k].geometry.dispose(); mat.dispose(); arrowGeo.dispose(); arrows.material.dispose(); }

    return { group, update, dispose, info };
  }

  VR.defenders = { build };
})(typeof self !== 'undefined' ? self : this);
