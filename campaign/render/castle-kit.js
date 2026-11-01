/*
 * Verdigris campaign - castle kit (Phase 3 T01).
 * Low-poly castle pieces from primitives with vertex colours (limestone walls with a weathered, mossy base, slate
 * and lead roofs, timber hoardings, green-grey spires, Order red banners with a gold lance, dark arrow slits).
 * One geometry per piece type, drawn as one InstancedMesh per type; roofs and timber parts are a separate
 * instanced mesh per type (hidden when burned, T06), so stone pieces can turn charred and roofless.
 *   VRender.castleKit.build(layout, { tier }) -> kit
 *     layout = VCamp castle.layout() (corners, wall segments, inner buildings), local frame, ground at y = 0
 *     kit.group                 add to the scene (holds the full model and the silhouette)
 *     kit.setLod(mode, dist)    mode 'auto' | 'full' | 'sil'; auto: full inside data.castle.lod.near, silhouette beyond
 *     kit.setNight(k)           0 day .. 1 night: lit windows and torches fade in
 *     kit.update(dt, time)      banner wave, torch flicker
 *     kit.info()                { lod, calls, tris } of the shown model (draw calls of the castle alone)
 *     kit.dispose()
 *   VRender.castleKit.models(tier) -> { type: { stone, roof, win, flag } } (geometries, for tests and castle-view)
 * Pieces stand on their origin; local +Z = the piece's yaw direction (corners: outward; wall modules: along the
 * wall, local +X = the outer face).
 */
(function (root) {
  'use strict';
  const THREE = root.THREE, C = root.VCamp;
  if (!THREE || !C) return;
  const VR = root.VRender = root.VRender || {};
  const D = C.need('data');

  const COL = {
    lime: 0xcfc6b2, lime2: 0xbdb39d, plinth: 0x8e877a, moss: 0x5f6b4a, slate: 0x46505e, lead: 0x6c7880,
    timber: 0x6a4a2c, darkWood: 0x3b2a1b, spire: 0x4c6a60, order: 0x86202a, gold: 0xd2a84a, slit: 0x1b1918,
    iron: 0x2e2e30, shingle: 0x7a5636, thatch: 0x8f6c3a, win: 0x2a2420,
  };
  const SEGS = { low: 6, mid: 10, high: 14 };

  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x || 0, (y || 0) + h / 2, z || 0);
  const cyl = (r0, r1, h, n, x, y, z) => new THREE.CylinderGeometry(r0, r1, h, n).translate(x || 0, (y || 0) + h / 2, z || 0);
  const cone = (r, h, n, x, y, z) => new THREE.ConeGeometry(r, h, n).translate(x || 0, (y || 0) + h / 2, z || 0);
  const pyr = (r, h, y, x, z) => new THREE.ConeGeometry(r, h, 4).rotateY(Math.PI / 4).translate(x || 0, y + h / 2, z || 0);
  const gable = (w, h, d, y, x, z) => {                     // ridge roof: a triangular prism along Z
    const g = new THREE.CylinderGeometry(1, 1, d, 3, 1);
    g.rotateX(-Math.PI / 2);                               // the +Z edge becomes the ridge
    g.scale(w / 1.732, h / 1.5, 1);
    return g.translate(x || 0, y + h / 3, z || 0);
  };

  /** Merges [geometry, colour, weather?] parts into one non-indexed geometry with colours. weather: stone gets darker
   *  toward the ground and mossy in the lowest metre (a vertex-colour gradient). */
  function merge(parts) {
    const pos = [], nor = [], col = [], c = new THREE.Color(), moss = new THREE.Color(COL.moss);
    for (const [g0, hex, weather] of parts) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) {
        c.setHex(hex);
        if (weather) {
          const y = p[i + 1], k = 0.74 + 0.26 * Math.min(1, Math.max(0, y / 9));
          c.multiplyScalar(k);
          if (y < 1.2) c.lerp(moss, 0.45 * (1 - y / 1.2));
        }
        pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(c.r, c.g, c.b);
      }
      g.dispose(); if (g !== g0) g0.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
  /** Concatenates already merged (non-indexed, coloured) geometries. */
  function mergeGeos(list) {
    const out = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'color']) {
      const arr = new Float32Array(list.reduce((n, g) => n + g.attributes[a].array.length, 0));
      let o = 0; for (const g of list) { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }
      out.setAttribute(a, new THREE.BufferAttribute(arr, 3));
    }
    for (const g of list) g.dispose();
    out.computeBoundingSphere();
    return out;
  }
  const S = (g, hex) => [g, hex || COL.lime, true];         // weathered stone part
  /** A window quad on a face: (x, y, z) centre, facing along +X (fx) or +Z. Returned as a thin box. */
  const winX = (x, y, z, w, h) => box(0.12, h || 1.6, w || 0.8, x, y, z);
  const winZ = (x, y, z, w, h) => box(w || 0.8, h || 1.6, 0.12, x, y, z);

  /** Merlons along a straight edge from (x0, z0) to (x1, z1) at height y. */
  function merlons(parts, x0, z0, x1, z1, y, step, hex) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / step)), yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      parts.push(S(box(0.7, 1.1, step * 0.5, 0, 0, 0).rotateY(yaw).translate(x0 + (x1 - x0) * k, y, z0 + (z1 - z0) * k), hex));
    }
  }
  /** Merlons around a circle (round towers). */
  function ringMerlons(parts, r, y, n, hex) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      parts.push(S(box(0.7, 1.1, 2 * Math.PI * r / n * 0.5).rotateY(a + Math.PI / 2).translate(Math.cos(a) * r, y, Math.sin(a) * r), hex));
    }
  }

  function models(tier) {
    const n = SEGS[tier] || SEGS.mid, low = tier === 'low';
    const K = D.castle, T = K.wallThick, B = D.buildings;
    const out = {};

    /* wall module: 4 units along Z (instanced along each wall run, scaled to fit), walk top at walkTop, the outer
       parapet with merlons on +X, a low inner lip, a darker battered plinth and an arrow slit */
    {
      const wt = B.wall.walkTop, st = [];
      st.push(S(box(T, wt, 4)), S(box(T + 1, 2.2, 4.02, 0.2), COL.plinth));
      st.push(S(box(0.6, 1.4, 4, T / 2 - 0.3, wt)), S(box(0.35, 0.6, 4, -T / 2 + 0.18, wt), COL.lime2));
      st.push(S(box(0.62, 1.1, 1.3, T / 2 - 0.3, wt + 1.4, -1)), S(box(0.62, 1.1, 1.3, T / 2 - 0.3, wt + 1.4, 1)));
      st.push([box(0.08, 1.5, 0.35, T / 2 + 0.02, 5, 0), COL.slit]);
      out.wall = { stone: merge(st), roof: null, win: null };
    }
    /* gate: the arch over the gap (lintel with a walk top and merlons) + the portcullis (iron grid, T03 drops it) */
    {
      const w = K.gate.w, wt = B.wall.walkTop, st = [];
      st.push(S(box(T + 0.6, 3.2, w + 1, 0, wt - 3.2)), S(box(0.6, 1.4, w + 1, T / 2, wt)));
      for (let z = -w / 2 + 1; z <= w / 2 - 1; z += 2.2) st.push(S(box(0.62, 1.1, 1.2, T / 2, wt + 1.4, z)));
      const pc = [];
      for (let z = -w / 2 + 0.6; z <= w / 2 - 0.5; z += 1.1) pc.push([box(0.18, wt - 3.2, 0.18, T / 2 - 0.4, 0, z), COL.iron]);
      for (let y = 1; y < wt - 3.4; y += 1.3) pc.push([box(0.16, 0.16, w, T / 2 - 0.4, y, 0), COL.iron]);
      out.gate = { stone: merge(st), roof: null, grate: merge(pc), win: null };   // grate = the portcullis (T03 moves it)
    }
    /* bastion: pointed (a diamond pointing outward along +Z), battered base, merlons on the top edges, ballista top */
    {
      const r = B.bastion.r, h = B.bastion.h, st = [];
      const body = new THREE.CylinderGeometry(r * 0.95, r * 1.12, h, 4).scale(0.82, 1, 1.12).translate(0, h / 2, 0);
      st.push(S(body), S(new THREE.CylinderGeometry(r * 1.12, r * 1.2, 2, 4).scale(0.84, 1, 1.12).translate(0, 1, 0), COL.plinth));
      const P = [[0, r * 1.06], [r * 0.78, 0], [0, -r * 1.06], [-r * 0.78, 0]];
      for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; merlons(st, a[0] * 0.93, a[1] * 0.93, b[0] * 0.93, b[1] * 0.93, h, 2.2); }
      st.push([box(0.1, 1.4, 0.35, 0, 5, r * 1.02), COL.slit]);
      out.bastion = { stone: merge(st), roof: null, win: null };
    }
    /* round tower: corbelled parapet, merlons, a tall slate cone, slits, two windows, flag */
    {
      const r = B.ctower.r, h = B.ctower.h, st = [], rf = [], wn = [];
      st.push(S(cyl(r * 0.92, r * 1.05, h, n)), S(cyl(r * 1.08, r * 1.12, 2, n), COL.plinth));
      st.push(S(cyl(r * 1.12, r * 0.92, 1.2, n, 0, h), COL.lime2), S(cyl(r * 1.12, r * 1.12, 0.6, n, 0, h + 1.2)));
      if (!low) ringMerlons(st, r * 1.05, h + 1.8, 10);
      for (const a of [0, 2.1, 4.2]) st.push([box(0.35, 1.5, 0.1, 0, 6, 0).translate(0, 0, r * 0.96).rotateY(a), COL.slit]);
      rf.push([cone(r * 1.3, 9, n, 0, h + 1.8), COL.slate], [box(0.25, 4, 0.25, 0, h + 10.4), COL.darkWood]);
      wn.push(winZ(0, h - 6, r * 0.97, 0.9, 1.7), winX(r * 0.97, h - 10, 0, 0.9, 1.7));
      out.ctower = { stone: merge(st), roof: merge(rf), win: wn, flag: [[0.15, h + 13.6, 0, 1]] };
    }
    /* gatehouse: square tower with a timber hoarding gallery and a hipped slate roof, a passage arch on its inner
       side, windows, flag */
    {
      const s = B.gatehouse.r * 1.6, h = B.gatehouse.h, st = [], rf = [], wn = [];
      st.push(S(box(s, h, s)), S(box(s + 1, 2.4, s + 1), COL.plinth), [box(4.2, 6.5, 0.2, 0, 0, s / 2 + 0.02), COL.slit]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.push(S(box(1.6, h + 1, 1.6, sx * s / 2, 0, sz * s / 2), COL.lime2));
      rf.push([box(s + 1.4, 2.4, s + 1.4, 0, h), COL.timber]);
      for (let i = -2; i <= 2; i++) rf.push([box(0.3, 0.9, 0.3, i * s / 5, h - 0.9, s / 2 + 0.6), COL.darkWood], [box(0.3, 0.9, 0.3, s / 2 + 0.6, h - 0.9, i * s / 5), COL.darkWood]);
      rf.push([pyr(s * 0.86, 6, h + 2.4), COL.slate], [box(0.25, 4, 0.25, 0, h + 8.2), COL.darkWood]);
      wn.push(winZ(-2.5, h - 4, s / 2 + 0.03), winZ(2.5, h - 4, s / 2 + 0.03), winX(s / 2 + 0.03, h - 4, 0), winX(-s / 2 - 0.03, h - 4, 0));
      out.gatehouse = { stone: merge(st), roof: merge(rf), win: wn, flag: [[0.15, h + 11.4, 0, 1]] };
    }
    /* keep: tall square tower with corner turrets, merlons, a steep lead roof, many windows, the big flag */
    {
      const s = B.keep.r * 1.6, h = B.keep.h, st = [], rf = [], wn = [];
      st.push(S(box(s, h, s)), S(box(s + 1.2, 3, s + 1.2), COL.plinth), S(box(s + 0.6, 1, s + 0.6, 0, h - 1), COL.lime2));
      const c = s / 2;
      for (const [x0, z0, x1, z1] of [[-c, c, c, c], [c, c, c, -c], [c, -c, -c, -c], [-c, -c, -c, c]]) merlons(st, x0, z0, x1, z1, h, 2.4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        st.push(S(cyl(1.7, 1.5, 5, low ? 6 : 8, sx * c, h - 2, sz * c), COL.lime2));
        rf.push([cone(2.2, 4.2, low ? 6 : 8, sx * c, h + 3, sz * c), COL.lead]);
      }
      rf.push([pyr(s * 0.62, 11, h), COL.lead], [box(0.3, 7, 0.3, 0, h + 10.5), COL.darkWood]);
      for (const y of [h * 0.45, h * 0.72]) for (const k of [-1, 1]) {
        wn.push(winZ(k * 3.5, y, c + 0.03, 1, 2), winZ(k * 3.5, y, -c - 0.03, 1, 2), winX(c + 0.03, y, k * 3.5, 1, 2), winX(-c - 0.03, y, k * 3.5, 1, 2));
      }
      st.push([box(2.6, 4, 0.2, 0, 0, c + 0.02), COL.iron]);
      out.keep = { stone: merge(st), roof: merge(rf), win: wn, flag: [[0.2, h + 16, 0, 1.7]] };
    }
    /* chapel: nave with a gable roof, a twin-spired front on +Z (spires up to spireH), an apse on -Z, a rose window
       and lancet windows */
    {
      const h = B.chapel.h, sh = B.chapel.spireH, st = [], rf = [], wn = [];
      st.push(S(box(9, h - 3, 15, 0, 0, -1)), S(box(10, 1.6, 16, 0, 0, -1), COL.plinth));
      rf.push([gable(10.4, 5, 15.6, h - 3, 0, -1), COL.slate]);
      st.push(S(cyl(4.4, 4.6, h - 5, n, 0, 0, -8.5)));
      rf.push([cone(5, 4.5, n, 0, h - 5, -8.5), COL.slate]);
      const tw = 3.8, th = sh - 15;
      for (const k of [-1, 1]) {
        st.push(S(box(tw, th, tw, k * 3.4, 0, 7.6)), S(box(tw + 0.5, 0.6, tw + 0.5, k * 3.4, th - 0.6, 7.6), COL.lime2));
        rf.push([new THREE.ConeGeometry(2.7, 15, low ? 6 : 8).rotateY(Math.PI / 8).translate(k * 3.4, th + 7.5, 7.6), COL.spire],
                [box(0.2, 1.6, 0.2, k * 3.4, sh, 7.6), COL.gold], [box(0.9, 0.2, 0.2, k * 3.4, sh + 1, 7.6), COL.gold]);
        wn.push(winZ(k * 3.4, th - 4, 9.53, 0.8, 2.4));
      }
      st.push(S(box(3, h - 3, 1.2, 0, 0, 8.6)), [box(2, 3.6, 0.2, 0, 0, 9.3), COL.darkWood]);
      wn.push(new THREE.CylinderGeometry(1.3, 1.3, 0.12, low ? 6 : 10).rotateX(Math.PI / 2).translate(0, h - 3, 9.3));
      for (const z of [-6, -2, 2]) wn.push(winX(4.53, h / 2 - 1, z, 0.8, 2.6), winX(-4.53, h / 2 - 1, z, 0.8, 2.6));
      out.chapel = { stone: merge(st), roof: merge(rf), win: wn };
    }
    /* rotunda: small round chapel with an apse and a cone roof with a lantern */
    {
      const r = B.rotunda.r, st = [], rf = [], wn = [];
      st.push(S(cyl(r, r * 1.04, 6.5, n)), S(cyl(1.8, 1.9, 4.6, low ? 6 : 8, 0, 0, -r)));
      rf.push([cone(r * 1.2, 3.2, n, 0, 6.5), COL.slate], [cyl(0.8, 0.8, 1.2, 6, 0, 9.4), COL.lime2], [cone(1, 1.4, 6, 0, 10.6), COL.slate],
              [cone(2.2, 1.6, low ? 6 : 8, 0, 4.6, -r), COL.slate]);
      wn.push(winZ(0, 3.5, r + 0.02, 0.6, 1.3), winX(r + 0.02, 3.5, 0, 0.6, 1.3));
      out.rotunda = { stone: merge(st), roof: merge(rf), win: wn };
    }
    /* great hall: long stone hall, slate gable roof, a chimney stack, a row of tall windows */
    {
      const h = B.hall.h, st = [], rf = [], wn = [];
      st.push(S(box(10, h - 3, 16)), S(box(10.6, 1.4, 16.6), COL.plinth), S(box(1.6, h + 3, 1.6, 2.6, 0, -6), COL.lime2));
      rf.push([gable(11, 4.4, 16.8, h - 3), COL.slate]);
      for (const z of [-5, -1.6, 1.8, 5.2]) wn.push(winX(5.03, h / 2 - 1.2, z, 1, 2.4), winX(-5.03, h / 2 - 1.2, z, 1, 2.4));
      st.push([box(2, 3, 0.2, 0, 0, 8.03), COL.darkWood]);
      out.hall = { stone: merge(st), roof: merge(rf), win: wn, smoke: [2.6, h + 3.2, -6] };
    }
    /* siege workshop: stone lower walls, timber upper floor and shingle roof, a crane beam, a half-built ram outside */
    {
      const st = [], rf = [];
      st.push(S(box(13, 3.2, 10)), S(box(13.4, 1, 10.4), COL.plinth));
      rf.push([box(13, 2.2, 10, 0, 3.2), COL.timber], [gable(14, 3.4, 11, 5.4), COL.shingle],
              [box(0.4, 6.5, 0.4, 0, 0, 7.4), COL.darkWood], [box(0.35, 0.35, 5, 0, 6.3, 5.6), COL.darkWood],
              [box(2.4, 1.4, 6, -4, 0, 8.2), COL.timber], [box(0.6, 0.6, 7, -4, 1.6, 8.2), COL.darkWood]);
      st.push([box(4, 3, 0.2, 2, 0, 5.03), COL.darkWood]);
      out.workshop = { stone: merge(st), roof: merge(rf), win: [winX(6.53, 1.8, -2, 1, 1.2)] };
    }
    /* stables: low timber building on a stone footing, thatched roof */
    {
      const st = [], rf = [];
      st.push(S(box(11.4, 1, 6.4), COL.plinth));
      rf.push([box(11, 3.2, 6, 0, 1), COL.timber], [gable(12.2, 2.6, 7, 4.2), COL.thatch]);
      for (const x of [-3.6, 0, 3.6]) rf.push([box(2.2, 2.4, 0.15, x, 1, 3.03), COL.darkWood]);
      out.stables = { stone: merge(st), roof: merge(rf), win: null };
    }
    /* well: stone ring with a small timber roof */
    {
      const st = [], rf = [];
      st.push(S(cyl(1.6, 1.7, 1.1, low ? 6 : 10)), [cyl(1.1, 1.1, 0.05, low ? 6 : 10, 0, 1.06), 0x23303a]);
      rf.push([box(0.25, 2.8, 0.25, -1.4, 1), COL.darkWood], [box(0.25, 2.8, 0.25, 1.4, 1), COL.darkWood], [gable(3.6, 1.2, 2.6, 3.6), COL.shingle]);
      out.well = { stone: merge(st), roof: merge(rf), win: null };
    }
    return out;
  }

  /** Banner: a cloth hanging from its pole on +X (local), red with a gold lance; attribute `wave` 0 at the pole, 1 at
   *  the free end. One InstancedMesh for all banners; the vertex shader waves it (one time uniform). */
  function bannerGeo() {
    const g = new THREE.PlaneGeometry(2.6, 1.7, 6, 2).translate(1.3, -0.85, 0).toNonIndexed();
    const p = g.attributes.position.array, col = [], wave = [], c = new THREE.Color(), r = new THREE.Color(COL.order), au = new THREE.Color(COL.gold);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      wave.push(x / 2.6);
      c.copy(Math.abs(x - 1.1) < 0.24 ? au : r); col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('wave', new THREE.Float32BufferAttribute(wave, 1));
    g.computeVertexNormals();
    return g;
  }

  /** Silhouette for the far LOD: one merged mesh (wall runs as prisms, towers as low cylinders, the keep, the twin
   *  spires), well under 2k triangles. */
  function silhouette(L) {
    const B = D.buildings, parts = [];
    const put = (g, hex, x, z, yaw) => parts.push([g.rotateY(yaw || 0).translate(x, 0, z), hex]);
    for (const s of L.segments) put(box(D.castle.wallThick, B.wall.h, s.len + 2), COL.lime2, (s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, s.yaw);
    for (const c of L.corners) {
      const P = B[c.type];
      if (c.type === 'ctower') { put(cyl(P.r, P.r, P.h + 2, 6), COL.lime, c.x, c.z); put(cone(P.r * 1.3, 9, 6, 0, P.h + 1.8), COL.slate, c.x, c.z); }
      else if (c.type === 'gatehouse') { put(box(P.r * 1.6, P.h + 2, P.r * 1.6), COL.lime, c.x, c.z); put(pyr(P.r * 1.4, 6, P.h + 2.4), COL.slate, c.x, c.z); }
      else put(new THREE.CylinderGeometry(P.r, P.r * 1.1, P.h, 4).scale(0.82, 1, 1.12).translate(0, P.h / 2, 0), COL.lime, c.x, c.z, c.yaw);
    }
    for (const b of L.buildings) {
      const P = B[b.type];
      if (b.type === 'keep') { put(box(P.r * 1.6, P.h, P.r * 1.6), COL.lime, b.x, b.z, b.yaw); put(pyr(P.r * 1.0, 11, P.h), COL.lead, b.x, b.z, b.yaw); }
      else if (b.type === 'chapel') {
        put(box(9, P.h, 15), COL.lime, b.x, b.z, b.yaw);
        for (const k of [-1, 1]) {
          const dx = Math.sin(b.yaw) * 7.6 + Math.cos(b.yaw) * k * 3.4, dz = Math.cos(b.yaw) * 7.6 - Math.sin(b.yaw) * k * 3.4;
          put(box(3.8, P.spireH - 15, 3.8), COL.lime, b.x + dx, b.z + dz); put(cone(2.7, 15, 6, 0, P.spireH - 15), COL.spire, b.x + dx, b.z + dz);
        }
      } else if (b.type === 'hall') { put(box(10, P.h, 16), COL.lime, b.x, b.z, b.yaw); }
    }
    return merge(parts);
  }

  const glow = (() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,235,180,1)'); gr.addColorStop(0.35, 'rgba(255,160,60,0.7)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  function build(L, opts) {
    opts = opts || {};
    const tier = opts.tier || 'mid', K = D.castle;
    const group = new THREE.Group(), full = new THREE.Group(), sil = new THREE.Group();
    group.add(full, sil);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const geos = models(tier), meshes = [], disposables = [mat];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();

    /* instances per piece type: [x, z, yaw, scaleZ] */
    const inst = {};
    const add = (type, x, z, yaw, sz) => (inst[type] = inst[type] || []).push([x, z, yaw, sz || 1]);
    for (const s of L.segments) {
      const dx = Math.sin(s.yaw), dz = Math.cos(s.yaw);
      const runs = [];
      if (s.gate) {
        const half = K.gate.w / 2, mid = s.len / 2, stub = Math.max(0, mid - half);
        if (stub > 0.2) runs.push([0, stub], [mid + half, s.len]);
        add('gate', s.a[0] + dx * mid, s.a[1] + dz * mid, s.yaw);
      } else runs.push([0, s.len]);
      for (const [t0, t1] of runs) {
        const len = t1 - t0, n = Math.max(1, Math.round(len / 4)), step = len / n;
        for (let i = 0; i < n; i++) { const t = t0 + (i + 0.5) * step; add('wall', s.a[0] + dx * t, s.a[1] + dz * t, s.yaw, step / 4); }
      }
    }
    for (const c of L.corners) add(c.type, c.x, c.z, c.yaw);
    for (const b of L.buildings) add(b.type, b.x, b.z, b.yaw);

    const winParts = [], flags = [];
    for (const type of Object.keys(inst)) {
      const G = geos[type], list = inst[type];
      if (!G) continue;
      const mk = (geo) => {
        const m = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([x, z, yaw, sz], i) => {
          q.setFromAxisAngle(up, yaw); v.set(x, 0, z); sc.set(1, 1, sz);
          m4.compose(v, q, sc); m.setMatrixAt(i, m4);
        });
        m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere && m.computeBoundingSphere();
        m.frustumCulled = false; full.add(m); meshes.push(m); disposables.push(geo);
        return m;
      };
      // only stone pieces keep a separate roof mesh (they lose the roof and stay standing when burned, T06); the
      // other pieces burn to a ruin as a whole, so their roof is merged into one geometry (fewer draw calls)
      if (G.roof && !D.buildings[type].stone) { G.stone = mergeGeos([G.stone, G.roof]); G.roof = null; }
      G.stoneMesh = mk(G.stone);
      if (G.roof) G.roofMesh = mk(G.roof);
      if (G.grate) G.grateMesh = mk(G.grate);
      for (const [x, z, yaw] of list) {
        q.setFromAxisAngle(up, yaw); v.set(x, 0, z); m4.compose(v, q, sc.set(1, 1, 1));
        for (const w of G.win || []) winParts.push(w.clone().applyMatrix4(m4));
        for (const f of G.flag || []) {
          const p = new THREE.Vector3(f[0], f[1], f[2]).applyMatrix4(m4);
          flags.push([p, yaw + 0.6 * (flags.length % 3 - 1), f[3]]);
        }
      }
      for (const w of G.win || []) w.dispose();
    }

    /* windows: one static mesh; dark by day, warm glow at dusk and night (basic material, no lights) */
    const winMat = new THREE.MeshBasicMaterial({ color: COL.win });
    const wg = winParts.length ? merge(winParts.map(g => [g, 0xffffff])) : new THREE.BufferGeometry();
    const winMesh = new THREE.Mesh(wg, winMat); full.add(winMesh); disposables.push(wg, winMat);

    /* banners: one InstancedMesh, waved in the vertex shader */
    const time = { value: 0 };
    const banMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    banMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = 'attribute float wave; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n float ph = uTime * 3.2 + position.x * 1.9 + instanceMatrix[3].x * 0.31;\n' +
        ' transformed.z += sin(ph) * 0.42 * wave; transformed.y -= 0.18 * wave * wave + 0.08 * sin(ph * 0.7) * wave;');
    };
    const bg = bannerGeo(), ban = new THREE.InstancedMesh(bg, banMat, Math.max(1, flags.length));
    flags.forEach(([p, yaw, s], i) => { q.setFromAxisAngle(up, yaw); sc.set(s, s, s); m4.compose(p, q, sc); ban.setMatrixAt(i, m4); });
    ban.count = flags.length; ban.frustumCulled = false; full.add(ban); disposables.push(bg, banMat);

    /* torches: additive points along the wall tops and at the gate, flickering, only at dusk and night */
    const nT = K.lights.torches, tp = new Float32Array(nT * 3), segs = L.segments.filter(s => !s.gate), gate = L.segments.find(s => s.gate);
    const BW = D.buildings.wall.walkTop;
    for (let i = 0; i < nT; i++) {
      let x, z, y = BW + 2.2;
      if (gate && i < 2) {                                // two at the gate, outside
        const t = gate.len / 2 + (i ? 1 : -1) * (K.gate.w / 2 + 0.8), dx = Math.sin(gate.yaw), dz = Math.cos(gate.yaw);
        x = gate.a[0] + dx * t + dz * 2.2; z = gate.a[1] + dz * t - dx * 2.2; y = 6;
      } else {
        const s = segs[(i - 2) % segs.length], t = s.len * (0.3 + 0.4 * (Math.floor((i - 2) / segs.length) % 2)), dx = Math.sin(s.yaw), dz = Math.cos(s.yaw);
        x = s.a[0] + dx * t - dz * 0.4; z = s.a[1] + dz * t + dx * 0.4;
      }
      tp[i * 3] = x; tp[i * 3 + 1] = y; tp[i * 3 + 2] = z;
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    const tMat = new THREE.PointsMaterial({ map: glow, size: 5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const torches = new THREE.Points(tg, tMat); torches.frustumCulled = false; full.add(torches); disposables.push(tg, tMat);

    /* far LOD */
    const sg = silhouette(L), silMesh = new THREE.Mesh(sg, mat); sil.add(silMesh); disposables.push(sg);
    const silWinMat = new THREE.PointsMaterial({ map: glow, size: 9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: true });
    const silTorch = new THREE.Points(tg, silWinMat); silTorch.frustumCulled = false; sil.add(silTorch); disposables.push(silWinMat);

    let lod = 'full', night = 0;
    const dayWin = new THREE.Color(COL.win), nightWin = new THREE.Color(0xffc062);
    function setNight(k) {
      night = Math.max(0, Math.min(1, k));
      winMat.color.copy(dayWin).lerp(nightWin, night);
      tMat.opacity = night; torches.visible = night > 0.02;
      silWinMat.opacity = night * 0.9; silTorch.visible = night > 0.02;
    }
    function setLod(mode, dist) {
      lod = mode === 'full' || mode === 'sil' ? mode : (dist == null || dist < K.lod.near ? 'full' : 'sil');
      full.visible = lod === 'full'; sil.visible = lod === 'sil';
      return lod;
    }
    /* T05: portcullis 0 = up (squeezed under the lintel) .. 1 = down (full grate in the gap) */
    const gateMesh = geos.gate && geos.gate.grateMesh, gateTop = D.buildings.wall.walkTop - 3.2;
    function setGate(k) {
      if (!gateMesh) return;
      const sy = 0.08 + 0.92 * Math.max(0, Math.min(1, k));
      gateMesh.scale.y = sy; gateMesh.position.y = gateTop * (1 - sy);
    }
    function update(dt, t) {
      time.value = t;
      if (torches.visible) tMat.size = 5 * (0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3));
    }
    function info() {
      let calls = 0, tris = 0;
      const g = lod === 'full' ? full : sil;
      g.traverse(o => {
        if (!o.visible || !o.geometry || !g.visible) return;
        if (o.isPoints) { calls++; return; }
        const n = o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0;
        if (o.isInstancedMesh) { if (o.count) { calls++; tris += n * o.count; } }
        else if (n) { calls++; tris += n; }
      });
      return { lod, calls, tris: Math.round(tris) };
    }
    function dispose() { group.parent && group.parent.remove(group); for (const d of disposables) d.dispose(); }
    setNight(0); setLod('full'); setGate(opts.gate || 0);
    return { group, full, sil, meshes, setLod, setNight, setGate, update, info, dispose, geos, flags: flags.length, torches: nT, smoke: geos.hall && geos.hall.smoke };
  }

  VR.castleKit = { build, models, silhouette, COL };
})(typeof window !== 'undefined' ? window : globalThis);
