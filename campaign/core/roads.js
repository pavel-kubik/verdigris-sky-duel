/*
 * Verdigris campaign - the road network of the one world: every village has roads to its neighbours.
 *   network() -> { nodes: [{ id, zone, x, z, r }], roads: [{ a, b, pts: [[X, Z], ...] }] }   (world coordinates)
 * Nodes are the villages (region.city.villages) and the Order's settlements of every zone, plus data.world.roads.nodes
 * (gates of Prahold). Two nodes are neighbours when no third node lies inside the circle over them (a Gabriel graph)
 * and they are at most roads.maxLen apart; a minimum spanning tree over the rest keeps the network in one piece.
 * Each road is the cheapest way over a grid of roads.cell units (A*): climbing costs more than flat ground, rivers are
 * crossed only on bridges (the zones' bridge features), Prahold's districts, the crater and the castle rock are avoided,
 * and ground an earlier road already took is cheaper (roads join and share their way out of a village; points within
 * roads.snap of an earlier road move onto it, so a shared stretch has one centre line). The path is
 * simplified and smoothed; it ends on a village's green (roads.green x its radius from the centre: the chapel stands
 * there) and at a settlement's gate (roads.gate from its centre). Built once, deterministic, from the terrain without
 * roads (terrain.worldGround), so terrain.heightAt can level the ground under the roads it gets from here.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');

  let net = null;

  function nodesOf(T) {
    const out = [];
    for (const zid of T.zones()) {
      const R = D.regions[zid], [ox, oz] = R.origin;
      for (const v of (R.city && R.city.villages) || []) out.push({ id: v.id, zone: zid, x: v.x + ox, z: v.z + oz, r: v.r, kind: 'village' });
      (R.settlements || []).forEach((s, i) => {
        if (s.type === 'castle') return;                            // the castle has its own roads (the Bend's features)
        out.push({ id: zid + '.' + s.type + i, zone: zid, x: s.x + ox, z: s.z + oz, r: 30, kind: 'settlement' });
      });
    }
    for (const n of D.world.roads.nodes || []) out.push({ id: n.id, zone: T.zoneAt(n.x, n.z), x: n.x, z: n.z, r: 10, kind: 'gate' });
    return out;
  }

  function edgesOf(nodes) {
    const P = D.world.roads, E = [], d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], ab = d(a, b);
      if (ab > P.maxLen) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      let free = true;
      for (let k = 0; k < nodes.length && free; k++) if (k !== i && k !== j && Math.hypot(nodes[k].x - mx, nodes[k].z - mz) < ab / 2 * P.gabriel) free = false;
      if (free) E.push([i, j, ab]);
    }
    // keep the network in one piece: a minimum spanning tree over all pairs (Kruskal) adds what the graph lacks
    const all = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) all.push([i, j, d(nodes[i], nodes[j])]);
    all.sort((p, q) => p[2] - q[2]);
    const par = nodes.map((_, i) => i), find = i => (par[i] === i ? i : (par[i] = find(par[i])));
    for (const [i, j] of E) par[find(i)] = find(j);
    for (const [i, j, l] of all) if (find(i) !== find(j)) { par[find(i)] = find(j); E.push([i, j, l]); }
    return E.sort((p, q) => p[2] - q[2]);
  }

  /** Min-heap of [cost, index] for A*. */
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (k, v) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= K[i]) break; [K[p], K[i]] = [K[i], K[p]]; [V[p], V[i]] = [V[i], V[p]]; i = p; }
  };
  Heap.prototype.pop = function () {
    const K = this.k, V = this.v, v = V[0], lk = K.pop(), lv = V.pop();
    if (K.length) {
      K[0] = lk; V[0] = lv; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < K.length && K[l] < K[m]) m = l;
        if (r < K.length && K[r] < K[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m;
      }
    }
    return v;
  };

  function grid(T) {
    const P = D.world.roads, C = P.cell, r = T.worldRect(), m = P.margin;
    const x0 = r.x0 + m, z0 = r.z0 + m, nx = Math.floor((r.x1 - m - x0) / C) + 1, nz = Math.floor((r.z1 - m - z0) / C) + 1;
    const h = new Float32Array(nx * nz), pen = new Float32Array(nx * nz), X = i => x0 + i * C, Z = j => z0 + j * C;
    const bridges = [];
    for (const zid of T.zones()) {
      const R = D.regions[zid], [ox, oz] = R.origin;
      for (const f of R.terrain.features) if (f.type === 'bridge') bridges.push({ x: f.x + ox, z: f.z + oz, yaw: f.yaw, len: f.len, w: f.width });
    }
    const onBridge = (x, z) => bridges.some(b => {
      const dx = x - b.x, dz = z - b.z, s = Math.sin(b.yaw), c = Math.cos(b.yaw);
      return Math.abs(dx * s + dz * c) < b.len / 2 + C && Math.abs(dx * c - dz * s) < C * 0.75;
    });
    const rv = T.worldRiver();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = X(i), z = Z(j), k = j * nx + i, zid = T.zoneAt(x, z);
      h[k] = T.worldGround(x, z);
      let p = 0;
      let wet = false;
      for (const mz of T.zones()) {
        const R = D.regions[mz];
        if (R.terrain.water !== 'mask') continue;
        const [lx, lz] = T.toLocal(mz, x, z);
        if (Math.max(Math.abs(lx), Math.abs(lz)) >= R.radius) continue;
        for (const [ex, ez] of [[0, 0], [C / 2, 0], [-C / 2, 0], [0, C / 2], [0, -C / 2]]) if (T.maskAt(mz, lx + ex, lz + ez) > 0.25) wet = true;
      }
      if (rv && T.riverWeight(x, z) > 0.5) { const q = T.worldRiverNear(x, z); if (q && q.d < rv.out + C * 0.75) wet = true; }
      if (wet && !onBridge(x, z)) p = Infinity;
      if (zid) {
        const R = D.regions[zid], [lx, lz] = T.toLocal(zid, x, z);
        for (const f of R.terrain.features) {
          if (f.type === 'cone' && Math.hypot(lx - f.x, lz - f.z) < f.r * 0.55) p = Infinity;
          if (f.type === 'ruins' && Math.hypot(lx - f.x, lz - f.z) < f.r) p += P.cityCost;
        }
        for (const s of R.settlements || []) if (s.type === 'castle' && Math.hypot(lx - s.x, lz - s.z) < 140) p = Infinity;
        for (const d of (R.city && R.city.districts) || []) if (Math.hypot(lx - d.x, lz - d.z) < d.r) p += P.cityCost;
        if (R.lair && Math.hypot(lx - R.lair.x, lz - R.lair.z) < 60) p = Infinity;
        const ae = D.aeries && D.aeries[zid];
        if (ae && Math.hypot(lx - ae.x, lz - ae.z) < 50) p = Infinity;
        if (T.lavaAt(zid, lx, lz) > 0) p = Infinity;
      }
      pen[k] = p;
    }
    return { C, x0, z0, nx, nz, h, pen, used: new Uint8Array(nx * nz), bridges };
  }

  function route(g, a, b) {
    const P = D.world.roads, C = g.C, nx = g.nx, nz = g.nz;
    const cellOf = (x, z) => [Math.max(0, Math.min(nx - 1, Math.round((x - g.x0) / C))), Math.max(0, Math.min(nz - 1, Math.round((z - g.z0) / C)))];
    const [si, sj] = cellOf(a.x, a.z), [gi, gj] = cellOf(b.x, b.z), s = sj * nx + si, goal = gj * nx + gi;
    const free = k => { const i = k % nx, j = (k / nx) | 0; return Math.hypot(g.x0 + i * C - a.x, g.z0 + j * C - a.z) < a.r * 0.8 || Math.hypot(g.x0 + i * C - b.x, g.z0 + j * C - b.z) < b.r * 0.8; };
    const dist = new Float32Array(nx * nz).fill(Infinity), prev = new Int32Array(nx * nz).fill(-1), done = new Uint8Array(nx * nz);
    const hx = k => Math.hypot((k % nx) - gi, ((k / nx) | 0) - gj) * C * P.reuse;
    const heap = new Heap();
    dist[s] = 0; heap.push(hx(s), s);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2]];
    let n = 0;
    while (heap.k.length) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === goal || ++n > nx * nz) break;
      const ui = u % nx, uj = (u / nx) | 0;
      for (const [di, dj] of DIRS) {
        const vi = ui + di, vj = uj + dj;
        if (vi < 0 || vj < 0 || vi >= nx || vj >= nz) continue;
        const v = vj * nx + vi;
        if (done[v]) continue;
        let pen = g.pen[v];
        if (pen === Infinity && free(v)) pen = 0;
        if (pen === Infinity) continue;
        if (Math.abs(di) + Math.abs(dj) === 3) {                 // knight's move: the cells it cuts across must be passable too
          const mi = ui + Math.round(di / 2), mj = uj + Math.round(dj / 2);
          if (g.pen[mj * nx + mi] === Infinity && !free(mj * nx + mi)) continue;
        }
        const len = Math.hypot(di, dj) * C, slope = Math.abs(g.h[v] - g.h[u]) / len;
        const step = len * (1 + P.climb * slope * slope + pen) * (g.used[v] ? P.reuse : 1);
        const nd = dist[u] + step;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd + hx(v), v); }
      }
    }
    if (!done[goal]) return null;
    const cells = [];
    for (let k = goal; k >= 0; k = prev[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map(k => [g.x0 + (k % nx) * C, g.z0 + ((k / nx) | 0) * C]);
    pts[0] = [a.x, a.z]; pts[pts.length - 1] = [b.x, b.z];
    return { pts, cost: dist[goal], cells };
  }

  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let bi = 0, bd = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (pts[i][1] - a[1]) - (b[1] - a[1]) * (pts[i][0] - a[0])) / L;
      if (d > bd) { bd = d; bi = i; }
    }
    if (bd <= eps) return [a, b];
    return rdp(pts.slice(0, bi + 1), eps).slice(0, -1).concat(rdp(pts.slice(bi), eps));
  }
  /** Chaikin corner cutting, the ends kept. */
  function chaikin(pts, n) {
    for (let k = 0; k < n; k++) {
      if (pts.length < 3) return pts;
      const out = [pts[0]];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        if (i + 2 < pts.length) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  /** Where a path passes a bridge, its points near the deck give way to the deck's two ends (in the path's order). */
  function onBridges(pts, bridges) {
    for (const br of bridges) {
      const s = Math.sin(br.yaw), c = Math.cos(br.yaw), half = br.len / 2;
      const v = p => (p[0] - br.x) * s + (p[1] - br.z) * c, u = p => (p[0] - br.x) * c - (p[1] - br.z) * s;
      const near = pts.map(p => Math.abs(v(p)) < half + 22 && Math.abs(u(p)) < 34);
      const i0 = near.indexOf(true), i1 = near.lastIndexOf(true);
      if (i0 < 0) continue;
      const before = pts[Math.max(0, i0 - 1)], after = pts[Math.min(pts.length - 1, i1 + 1)];
      if (Math.sign(v(before)) === Math.sign(v(after))) continue;            // it does not cross here
      const end = k => [br.x + s * k * (half + 8), br.z + c * k * (half + 8)], dir = Math.sign(v(after)) || 1;
      pts = pts.slice(0, i0).concat([end(-dir), end(dir)], pts.slice(i1 + 1));
    }
    return pts;
  }

  /** A point within `d` of an earlier road moves onto it, so roads that share their way share one centre line. */
  function snap(roads, p, d) {
    let best = null, bd = d;
    for (const r of roads) for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const k = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
      const x = a[0] + dx * k, z = a[1] + dz * k, e = Math.hypot(p[0] - x, p[1] - z);
      if (e < bd) { bd = e; best = [x, z]; }
    }
    return best || p;
  }

  /** Cuts the start of a path off inside its node's keep-out (the chapel on a village green, a settlement's houses). */
  function trim(pts, n) {
    const k = n.kind === 'village' ? n.r * D.world.roads.green : n.kind === 'settlement' ? D.world.roads.gate : 0;
    if (!k) return pts;
    let i = 0;
    while (i + 1 < pts.length && Math.hypot(pts[i + 1][0] - n.x, pts[i + 1][1] - n.z) < k) i++;
    if (i + 1 >= pts.length) return [];
    const a = pts[i], b = pts[i + 1], da = Math.hypot(a[0] - n.x, a[1] - n.z), db = Math.hypot(b[0] - n.x, b[1] - n.z);
    const t = da >= k ? 0 : (k - da) / Math.max(1e-6, db - da);
    return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]].concat(pts.slice(i + 1));
  }

  function network() {
    if (net) return net;
    const T = M.need('terrain'), P = D.world.roads;
    net = { nodes: [], roads: [] };                                // while building (terrain may ask for roads): none
    const nodes = nodesOf(T), g = grid(T), roads = [];
    const par = nodes.map((_, i) => i), find = i => (par[i] === i ? i : (par[i] = find(par[i])));
    const add = (i, j, r) => {
      const a = nodes[i], b = nodes[j];
      let pts = chaikin(rdp(r.pts, P.simplify), 2);
      pts = trim(trim(pts, a).reverse(), b).reverse();                    // a road ends on the village green, at the gate
      pts = onBridges(pts, g.bridges);                                    // over the river straight along a deck
      if (pts.length < 2) return;
      pts = pts.map(p => snap(roads, p, P.snap)).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      for (const k of r.cells) g.used[k] = 1;
      roads.push({ a: a.id, b: b.id, pts });
      par[find(i)] = find(j);
    };
    const later = [];
    for (const [i, j, l] of edgesOf(nodes)) {
      const r = route(g, nodes[i], nodes[j]);
      if (!r) continue;
      let len = 0;
      for (let k = 1; k < r.pts.length; k++) len += Math.hypot(r.pts[k][0] - r.pts[k - 1][0], r.pts[k][1] - r.pts[k - 1][1]);
      if (len > l * P.detour) { later.push([i, j, len]); continue; }      // a long way round (to a bridge): only if nothing else links them
      add(i, j, r);
    }
    for (const [i, j] of later.sort((p, q) => p[2] - q[2])) if (find(i) !== find(j)) { const r = route(g, nodes[i], nodes[j]); if (r) add(i, j, r); }
    net = { nodes, roads };
    return net;
  }

  M.define('roads', { network });
})(typeof self !== 'undefined' ? self : this);
