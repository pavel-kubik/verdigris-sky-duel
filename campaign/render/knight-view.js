/*
 * Verdigris campaign - knights view (Phase 4 T07, core/knights.js): mounted knights of the Order.
 *   VRender.knights.build() -> { group, update(kn, { time }), dispose(), info }
 * Three vertex-coloured InstancedMeshes for all knights (3 draw calls): the horse (body, neck, head, legs, a red
 * caparison), the rider (Order blue-grey mail, helmet, the red shield on the left arm) and the lance (couched forward,
 * raised while riding home). Gallop: a bob and a pitch rock by the rider's speed; a stunned knight stands with the lance
 * up; a carried one hangs tilted under the claws; one in the breath (burnT) glows orange.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const S = 1.3, CAP = 16;

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
  /** Hooves at y = 0, facing +Z. */
  function horse() {
    const coat = 0x5a3c26, dark = 0x2e2018, red = 0xa8241f;
    const parts = [
      part(new THREE.BoxGeometry(0.9, 0.9, 2.2).translate(0, 1.45, 0), coat),                     // body
      part(new THREE.BoxGeometry(1.0, 0.5, 2.3).translate(0, 1.15, 0), red),                      // caparison
      part(new THREE.BoxGeometry(0.4, 0.9, 0.5).rotateX(-0.6).translate(0, 2.1, 1.05), coat),     // neck
      part(new THREE.BoxGeometry(0.36, 0.36, 0.8).translate(0, 2.45, 1.45), coat),                // head
      part(new THREE.BoxGeometry(0.12, 0.6, 0.12).translate(0, 1.8, -1.15), dark),                // tail
    ];
    for (const [x, z] of [[-0.3, 0.8], [0.3, 0.8], [-0.3, -0.8], [0.3, -0.8]]) parts.push(part(new THREE.BoxGeometry(0.2, 1.05, 0.2).translate(x, 0.52, z), dark));
    return merge(parts);
  }
  function rider() {
    return merge([
      part(new THREE.CylinderGeometry(0.28, 0.34, 0.8, 6).translate(0, 2.4, -0.1), 0x4a5d7e),       // mail
      part(new THREE.BoxGeometry(1.0, 0.25, 0.5).translate(0, 2.0, -0.1), 0x2c3442),                 // legs astride
      part(new THREE.SphereGeometry(0.2, 6, 4).translate(0, 3.0, -0.1), 0xe0b48e),                  // head
      part(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 6).translate(0, 3.1, -0.1), 0x9aa3ad),     // helmet
      part(new THREE.BoxGeometry(0.08, 0.8, 0.6).translate(-0.42, 2.4, 0.05), 0xb8322a),            // shield (left arm)
      part(new THREE.BoxGeometry(0.1, 0.3, 0.14).translate(-0.47, 2.45, 0.05), 0xe8d8a0),           // the shield's pale cross
    ]);
  }
  /** Pivot at the rider's right hand; points +Z. */
  function lance() {
    return merge([
      part(new THREE.CylinderGeometry(0.05, 0.09, 4.2, 5).rotateX(Math.PI / 2).translate(0, 0, 1.6), 0x8a6a3e),
      part(new THREE.ConeGeometry(0.1, 0.4, 5).rotateX(Math.PI / 2).translate(0, 0, 3.9), 0xc8ccd2),
      part(new THREE.BoxGeometry(0.02, 0.3, 0.4).translate(0, 0.18, 3.0), 0xa8241f),                // pennant
    ]);
  }

  function build() {
    const group = new THREE.Group();
    group.name = 'knights';
    const info = { drawn: 0, calls: 3 };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const meshes = [new THREE.InstancedMesh(horse(), mat, CAP), new THREE.InstancedMesh(rider(), mat, CAP), new THREE.InstancedMesh(lance(), mat, CAP)];
    for (const m of meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < CAP; i++) m.setColorAt(i, new THREE.Color(1, 1, 1));
      m.count = 0; m.frustumCulled = false; group.add(m);
    }
    const [hm, rm, lm] = meshes;
    const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), loc = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
    const sc = new THREE.Vector3(S, S, S), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const white = new THREE.Color(1, 1, 1), hot = new THREE.Color(2.2, 0.9, 0.3), tmp = new THREE.Color();

    function update(kn, ctx) {
      const time = (ctx && ctx.time) || 0;
      let n = 0;
      for (const k of (kn && kn.list) || []) {
        if (!k.alive || n >= CAP) continue;
        const run = k.speed > 0.5 && k.state !== 'carried' && k.state !== 'fall' && k.state !== 'stun';
        const ph = time * (2 + k.speed * 0.28) + k.phase;
        const bob = run ? Math.abs(Math.sin(ph)) * 0.25 : 0, rock = run ? Math.sin(ph) * 0.08 : 0;
        const tilt = k.state === 'carried' ? 0.5 : k.state === 'fall' ? Math.min(1.4, (k.vy || 0) * -0.05) : 0;
        e.set(rock + tilt, k.yaw, k.state === 'carried' ? 0.3 : 0);
        q.setFromEuler(e);
        v.set(k.pos[0], k.pos[1] + bob, k.pos[2]);
        base.compose(v, q, sc);
        hm.setMatrixAt(n, base);
        rm.setMatrixAt(n, base);
        // the lance: couched in a charge, raised when riding home, stunned or carried
        const up = k.state === 'chase' || k.state === 'ride' ? -0.12 : -1.1;
        e.set(up, 0, 0); q.setFromEuler(e);
        loc.compose(v.set(0.42, 2.35, 0.1), q, one);
        m4.multiplyMatrices(base, loc);
        lm.setMatrixAt(n, m4);
        const col = k.burnT > 0 ? tmp.copy(white).lerp(hot, Math.min(1, k.burnT * 3)) : white;
        hm.setColorAt(n, col); rm.setColorAt(n, col); lm.setColorAt(n, col);
        n++;
      }
      for (const m of meshes) {
        m.count = n; m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      info.drawn = n;
    }

    function dispose() {
      for (const m of meshes) m.geometry.dispose();
      mat.dispose();
    }
    return { group, update, dispose, info };
  }

  VR.knights = { build };
})(typeof self !== 'undefined' ? self : this);
