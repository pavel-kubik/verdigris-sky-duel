/*
 * Verdigris Sky Duel - procedural people for medieval Prague: the court wizard, the princess, the prince, the green
 * dragon in human form, town guards and townsfolk. Needs THREE (r128); shared/textures.js (VTex) adds a cloth relief to
 * the heroes when present. Like shared/dragon.js the geometry is built from code (plain arrays, so it also builds
 * against the tiny THREE stub of the Node tests), built once per kind / variant / detail and shared by every figure.
 *
 * A figure is a bone-free rig of groups: fig (scale) > hips > thighs > shins, hips > chest > head / shoulders >
 * forearms (> hand props), chest > cape, hips > tail. Every part is one mesh with vertex colours and ONE material per
 * figure: vertex colours are either baked (leather, steel, gold, wood) or a shade of one of four palette slots
 * (1 main cloth, 2 trim, 3 hair / horn, 4 skin) that the material tints in the vertex shader, so seeds and palette
 * overrides never need new geometry. Skirts, robes and tabards carry a per-vertex weight that the same shader uses to
 * swing them with the legs and let them trail when walking (uniform hvL).
 *
 * Exposes window.VHuman:
 *   KINDS = ['wizard','princess','prince','dragonkin','guard','citizen']
 *   make(kind, opts) -> h      opts: { seed (uint32), palette: { main, trim, hair, skin } (hex), detail: 'low'|'high' }
 *     h.root            THREE.Group: stands on y = 0, faces +Z; the game sets position / rotation.y
 *     h.anim(dt, o)     o: { speed (units/s), run, air 0..1, cast 0..1, attack 0..1 (swing phase), talk }
 *     h.glow            Object3D of the magic glow (staff crystal for the wizard, right hand otherwise; a second glow in
 *                       the left hand follows it while casting). h.setGlow(k 0..1, colorHex): k = 0 hides it.
 *                       anim() lights it by itself while casting (and on the wizard's / dragonkin's attack).
 *     h.height          standing height (top of the head or hat) in units at the figure's scale
 *     h.kind, h.seed, h.meshes (draw calls), h.tris (triangles), h.palette (resolved slot colours)
 *     h.dispose()       removes root from its parent, frees the figure's materials (the geometry stays cached)
 *   crowd(n, opts) -> { group, set(i, x, y, z, yaw, speed), update(dt), dispose(), count, kinds, drawCalls, tris }
 *     opts: { kinds: ['citizen'] | ['guard'] | ['citizen','guard'], seed, guardShare (0..1, default 0.15) }
 *     A crowd is a handful of InstancedMeshes (one per body template - at most 6 citizen templates + 1 guard - plus
 *     one each for upper arms, forearms, thighs, shins and halberds): about 12 draw calls for any n. Each member runs
 *     the same walk cycle as a hero (pose() below) on plain transform records; update() writes the instance matrices
 *     and per-instance colours / skirt swing. set() places a member in the group's space; speed 0 = idle.
 *   shimmer(scene) -> { root, play(pos, colourHex), update(dt), dispose() }: a sparkle swirl (one Points draw call)
 *     for the dragon <-> human shapeshift.
 *   pose(rig, state, o, dt, cfg) is exported for tests.
 */
(function (root) {
'use strict';
if (!root.THREE) return;
const THREE = root.THREE, HOST = root, TAU = Math.PI * 2;
const KINDS = ['wizard', 'princess', 'prince', 'dragonkin', 'guard', 'citizen'];

/* ---------- rig dimensions (model units at scale 1) ---------- */
const D = {
  HIP: 0.93,            // hips pivot above the ground
  LEGX: 0.088, LEGY: -0.03, TH: 0.41, SH: 0.41, FOOT: 0.08,
  CHEST: 0.12,          // chest pivot above the hips pivot (the waist)
  NECK: 0.46,           // head pivot above the chest pivot
  SHX: 0.185, SHY: 0.38, UP: 0.27, GRIP: [0, -0.295, 0.012],
};

/* ---------- small helpers ---------- */
function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rgb = (hex, k) => { k = k == null ? 1 : k; return [((hex >> 16) & 255) / 255 * k, ((hex >> 8) & 255) / 255 * k, (hex & 255) / 255 * k]; };
const F = (hex, k) => ({ c: rgb(hex, k), s: 0 });            // baked colour
const S = (slot, k) => { k = k == null ? 1 : k; return { c: [k, k, k], s: slot }; };   // shade of a palette slot
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const XF = {
  T: (x, y, z) => p => [p[0] + x, p[1] + y, p[2] + z],
  RX: a => { const c = Math.cos(a), s = Math.sin(a); return p => [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; },
  RY: a => { const c = Math.cos(a), s = Math.sin(a); return p => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; },
  RZ: a => { const c = Math.cos(a), s = Math.sin(a); return p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; },
  chain: (...fs) => p => fs.reduce((q, f) => f(q), p),
};
const skirtW = (y0, y1, pw) => y => { const w = clamp01((y0 - y) / (y0 - y1)); return pw ? Math.pow(w, pw) : w; };

/* ---------- geometry builder ---------- */
/* Vertices carry position, colour (baked rgb or a shade for a slot) and hv = (slot, skirt weight). Normals are made at
   build() from the faces, welded by position inside one smoothing group (every primitive starts a new group). */
function Bld() { this.p = []; this.c = []; this.h = []; this.g = []; this.i = []; this.gid = 0; this.col = [1, 1, 1]; this.slot = 0; }
Bld.prototype = {
  set(cs) { if (cs) { this.col = cs.c; this.slot = cs.s; } return this; },
  grp() { return ++this.gid; },
  v(x, y, z, sk) { this.p.push(x, y, z); this.c.push(this.col[0], this.col[1], this.col[2]); this.h.push(this.slot, sk || 0); this.g.push(this.gid); return this.p.length / 3 - 1; },
  quad(a, b, c, d) { this.i.push(a, b, c, b, d, c); },
  /** Surface of revolution about the y axis. prof [[r, y, flag, colour]] bottom to top (outer surfaces go up, a top
      goes inward, an underside outward). flag 'b' = colour break (duplicate row), 'c' = crease (also a new smoothing
      group). o: { x, y, z, sx, sz, a0, a1 (arc; 0 = +Z front), gap(y) (open front half-angle), sk(y), xf(p), col,
      keep (same smoothing group as before), sub(colour) }. Angle a: x = sin(a) r, z = cos(a) r. */
  lathe(prof, n, o) {
    o = o || {};
    const sx = o.sx || 1, sz = o.sz || 1, cx = o.x || 0, cy = o.y || 0, cz = o.z || 0;
    if (!o.keep) this.grp();
    const sub = o.sub || (c => c);
    if (o.col) this.set(sub(o.col));
    const rows = [];
    const emit = P => {
      let a0 = 0, a1 = TAU;
      if (o.gap) { const g = o.gap(P[1]); a0 = g; a1 = TAU - g; } else if (o.a0 != null) { a0 = o.a0; a1 = o.a1; }
      const row = [];
      for (let k = 0; k <= n; k++) {
        const a = a0 + (a1 - a0) * k / n;
        let q = [Math.sin(a) * P[0] * sx + cx, P[1] + cy, Math.cos(a) * P[0] * sz + cz];
        if (o.xf) q = o.xf(q, a);
        row.push(this.v(q[0], q[1], q[2], o.sk ? o.sk(q[1]) : 0));
      }
      return row;
    };
    for (let j = 0; j < prof.length; j++) {
      const P = prof[j];
      if (j > 0 && (P[2] === 'b' || P[2] === 'c')) { rows.push(emit(P), null); if (P[2] === 'c') this.grp(); }
      if (P[3]) this.set(sub(P[3]));
      rows.push(emit(P));
    }
    for (let j = 0; j + 1 < rows.length; j++) {
      if (!rows[j] || !rows[j + 1]) continue;
      for (let k = 0; k < n; k++) this.quad(rows[j][k], rows[j][k + 1], rows[j + 1][k], rows[j + 1][k + 1]);
    }
    return this;
  },
  /** Ellipsoid (part of one between ph0 and ph1, fractions from the top pole) at c with radii r. o: { nu, nv, rx (tilt
      about x through c), xf, col, sk } */
  ball(c, r, o) {
    o = o || {};
    this.grp(); if (o.col) this.set(o.col);
    const nu = o.nu || 8, nv = o.nv || 6, p0 = (o.ph0 || 0) * Math.PI, p1 = (o.ph1 == null ? 1 : o.ph1) * Math.PI, rows = [];
    const tilt = o.rx ? XF.RX(o.rx) : null;
    for (let j = 0; j <= nv; j++) {
      const ph = p0 + (p1 - p0) * j / nv, sy = Math.cos(ph), sr = Math.sin(ph), row = [];
      for (let i = 0; i <= nu; i++) {
        const th = i / nu * TAU;
        let q = [Math.cos(th) * sr * r[0], sy * r[1], Math.sin(th) * sr * r[2]];
        if (tilt) q = tilt(q);
        q = [q[0] + c[0], q[1] + c[1], q[2] + c[2]];
        if (o.xf) q = o.xf(q);
        row.push(this.v(q[0], q[1], q[2], o.sk ? o.sk(q[1]) : 0));
      }
      rows.push(row);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) this.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i], rows[j + 1][i + 1]);
    return this;
  },
  /** Tapered tube along a polyline pts with radii [r] or [[ru, rv]] (ru across `ref` x tangent). o: { ref, cap0, cap1,
      col, cols [colour per point], sk, xf } */
  tube(pts, radii, n, o) {
    o = o || {};
    this.grp(); if (o.col) this.set(o.col);
    const ref = o.ref || [0, 1, 0], rows = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let rx = ref[0], ry = ref[1], rz = ref[2];
      if (Math.abs(tx * rx + ty * ry + tz * rz) > 0.95) { rx = 1; ry = 0; rz = 0; if (Math.abs(tx) > 0.95) { rx = 0; rz = 1; } }
      let ux = ry * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - ry * tx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      const R = radii[i], ru = R.length ? R[0] : R, rv = R.length ? R[1] : R, row = [];
      if (o.cols && o.cols[i]) this.set(o.cols[i]);
      for (let j = 0; j <= n; j++) {
        const an = j / n * TAU, ca = Math.cos(an), sa = Math.sin(an);
        let q = [pts[i][0] + ux * ca * ru + vx * sa * rv, pts[i][1] + uy * ca * ru + vy * sa * rv, pts[i][2] + uz * ca * ru + vz * sa * rv];
        if (o.xf) q = o.xf(q);
        row.push(this.v(q[0], q[1], q[2], o.sk ? o.sk(q[1]) : 0));
      }
      rows.push({ row, p: pts[i] });
    }
    for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < n; j++) this.quad(rows[i].row[j], rows[i].row[j + 1], rows[i + 1].row[j], rows[i + 1].row[j + 1]);
    const cap = (k, dir) => {
      const r = rows[k]; let q = r.p.slice(); if (o.xf) q = o.xf(q);
      const c = this.v(q[0], q[1], q[2], o.sk ? o.sk(q[1]) : 0);
      for (let j = 0; j < n; j++) { if (dir > 0) this.i.push(r.row[j], r.row[j + 1], c); else this.i.push(r.row[j + 1], r.row[j], c); }
    };
    if (o.cap0) cap(0, -1);
    if (o.cap1) cap(rows.length - 1, 1);
    return this;
  },
  /** Box at c with size s (hard edges). o: { xf, col, sk } */
  box(c, s, o) {
    o = o || {};
    if (o.col) this.set(o.col);
    const h = [s[0] / 2, s[1] / 2, s[2] / 2];
    const F6 = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    for (const [N, T1, T2] of F6) {
      this.grp();
      const ids = [];
      for (const [u, w] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        let q = [0, 1, 2].map(k => c[k] + (N[k] + T1[k] * u + T2[k] * w) * h[k]);
        if (o.xf) q = o.xf(q);
        ids.push(this.v(q[0], q[1], q[2], o.sk ? o.sk(q[1]) : 0));
      }
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    return this;
  },
  /** Extruded convex-ish outline [[x, y]] (counter-clockwise seen from +z), thickness d along z. o: { xf, col, side (colour of the rim) } */
  ext(outline, d, o) {
    o = o || {};
    if (o.col) this.set(o.col);
    const face = col => o.face ? o.face : col;
    const tr = q => (o.xf ? o.xf(q) : q);
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
    for (const z of [d / 2, -d / 2]) {
      this.grp();
      let q = tr([cx, cy, z]); const c = this.v(q[0], q[1], q[2]);
      const ring = outline.map(p => { const qq = tr([p[0], p[1], z]); return this.v(qq[0], qq[1], qq[2]); });
      for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; if (z > 0) this.i.push(c, a, b); else this.i.push(c, b, a); }
    }
    void face;
    this.grp(); if (o.side) this.set(o.side);
    for (let k = 0; k < outline.length; k++) {
      const p = outline[k], q = outline[(k + 1) % outline.length];
      const ids = [[p, -d / 2], [q, -d / 2], [p, d / 2], [q, d / 2]].map(([pp, z]) => { const t = tr([pp[0], pp[1], z]); return this.v(t[0], t[1], t[2]); });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
    return this;
  },
  /** Flat polygon decal (star, scale) at c facing n (outward), shape [[u, v]] ccw, size s. */
  decal(c, n, s, shape, o) {
    o = o || {};
    this.grp(); if (o.col) this.set(o.col);
    const nl = Math.hypot(n[0], n[1], n[2]) || 1, N = [n[0] / nl, n[1] / nl, n[2] / nl];
    let U = [0, 1, 0]; const dd = U[0] * N[0] + U[1] * N[1] + U[2] * N[2]; U = [U[0] - N[0] * dd, U[1] - N[1] * dd, U[2] - N[2] * dd];
    const ul = Math.hypot(U[0], U[1], U[2]) || 1; U = [U[0] / ul, U[1] / ul, U[2] / ul];
    const R = [U[1] * N[2] - U[2] * N[1], U[2] * N[0] - U[0] * N[2], U[0] * N[1] - U[1] * N[0]];
    const P = (u, v) => [c[0] + (R[0] * u + U[0] * v) * s, c[1] + (R[1] * u + U[1] * v) * s, c[2] + (R[2] * u + U[2] * v) * s];
    const sk = q => (o.sk ? o.sk(q[1]) : 0);
    const q0 = P(0, 0), ctr = this.v(q0[0], q0[1], q0[2], sk(q0));
    const ring = shape.map(([u, v]) => { const q = P(u, v); return this.v(q[0], q[1], q[2], sk(q)); });
    for (let k = 0; k < ring.length; k++) this.i.push(ctr, ring[k], ring[(k + 1) % ring.length]);
    return this;
  },
  /** Append another builder's vertices through xf (rigid transform). */
  add(src, xf) {
    const off = this.p.length / 3, g0 = this.gid + 1;
    for (let k = 0; k < src.p.length; k += 3) {
      const q = xf ? xf([src.p[k], src.p[k + 1], src.p[k + 2]]) : [src.p[k], src.p[k + 1], src.p[k + 2]];
      this.p.push(q[0], q[1], q[2]);
    }
    this.c.push(...src.c); this.h.push(...src.h);
    for (const g of src.g) this.g.push(g0 + g);
    for (const i of src.i) this.i.push(i + off);
    this.gid = g0 + src.gid + 1;
    return this;
  },
  tris() { return this.i.length / 3; },
  maxY() { let m = -Infinity; for (let k = 1; k < this.p.length; k += 3) m = Math.max(m, this.p[k]); return m; },
  normals() {
    const np = this.p.length / 3, key = new Array(np), sums = new Map(), P = this.p;
    for (let v = 0; v < np; v++) key[v] = this.g[v] + '|' + Math.round(P[3 * v] * 2e4) + ',' + Math.round(P[3 * v + 1] * 2e4) + ',' + Math.round(P[3 * v + 2] * 2e4);
    for (let t = 0; t < this.i.length; t += 3) {
      const a = this.i[t] * 3, b = this.i[t + 1] * 3, c = this.i[t + 2] * 3;
      const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2], fx = P[c] - P[a], fy = P[c + 1] - P[a + 1], fz = P[c + 2] - P[a + 2];
      const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      for (const v of [this.i[t], this.i[t + 1], this.i[t + 2]]) {
        let s = sums.get(key[v]); if (!s) { s = [0, 0, 0]; sums.set(key[v], s); }
        s[0] += nx; s[1] += ny; s[2] += nz;
      }
    }
    const n = new Array(np * 3);
    for (let v = 0; v < np; v++) {
      const s = sums.get(key[v]) || [0, 1, 0], l = Math.hypot(s[0], s[1], s[2]);
      if (l > 1e-12) { n[3 * v] = s[0] / l; n[3 * v + 1] = s[1] / l; n[3 * v + 2] = s[2] / l; } else { n[3 * v] = 0; n[3 * v + 1] = 1; n[3 * v + 2] = 0; }
    }
    return n;
  },
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals(), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('hv', new THREE.Float32BufferAttribute(this.h, 2));
    g.setIndex(this.i);
    if (g.computeBoundingSphere) g.computeBoundingSphere();
    return g;
  },
};

/* ---------- body part makers (all in their joint's local frame) ---------- */
const SKIN = S(4), HAIR = S(3), MAIN = S(1), TRIM = S(2);
const LEATHER = F(0x5b3b22), DARKLEATHER = F(0x3a2616), GOLD = F(0xe0b44a), STEEL = F(0xa4abb3), MAIL = F(0x7c838c), WOOD = F(0x6e4a2a);
const STAR = [[0, 1], [-0.28, 0.28], [-1, 0], [-0.28, -0.28], [0, -1], [0.28, -0.28], [1, 0], [0.28, 0.28]];
const SCALE = [[0, 0.55], [-0.5, 0.2], [-0.42, -0.25], [0, -0.6], [0.42, -0.25], [0.5, 0.2]];

/** Thigh (from the hip joint down) and shin (knee down, with the shoe). o: { hose, boot, bootY (shin-local y where the
    boot starts), k (girth), shoe: 'curl' | 'pointy' | 'boot' } */
function legs(n, o) {
  const k = o.k || 1, th = new Bld(), sh = new Bld();
  th.tube([[0, 0.03, 0], [0, -0.18, 0.006], [0, -D.TH, 0]], [0.072 * k, 0.062 * k, 0.047 * k], n, { col: o.hose });
  const bootY = o.bootY == null ? -0.3 : o.bootY, boot = o.boot || o.hose;
  const lo = n <= 5;
  if (!lo) sh.ball([0, 0, 0.004], [0.049 * k, 0.05, 0.05 * k], { nu: n, nv: 3, col: o.hose });
  const base = lo ? [[0.03, 0, 0.047], [-0.15, -0.012, 0.045], [-D.SH + 0.01, 0, 0.035]] : [[0, 0, 0.047], [-0.13, -0.012, 0.046], [-0.27, -0.006, 0.039], [-D.SH + 0.01, 0, 0.035]];
  const pts = [], rad = [], cols = [];
  let done = bootY >= 0 || bootY <= -D.SH;
  for (let j = 0; j < base.length; j++) {
    const [y, z, r] = base[j];
    if (!done && y < bootY) {
      const [y0, z0, r0] = base[j - 1], f = (bootY - y0) / (y - y0), rr = lerp(r0, r, f) * k, zz = lerp(z0, z, f);
      pts.push([0, bootY + 0.004, zz], [0, bootY, zz]); rad.push(rr, rr * 1.16); cols.push(o.hose, boot);
      done = true;
    }
    pts.push([0, y, z]); rad.push(r * k * (y < bootY ? 1.1 : 1)); cols.push(y < bootY ? boot : o.hose);
  }
  sh.tube(pts, rad, n, { cols });
  const sy = -D.SH - D.FOOT + 0.04;
  const len = o.shoe === 'curl' ? 0.115 : 0.1;
  sh.ball([0, sy, 0.032], [0.044 * k, 0.042, len], { nu: n, nv: lo ? 3 : 4, col: boot, xf: q => [q[0], Math.max(q[1], -D.SH - D.FOOT + 0.002), q[2]] });
  if (o.shoe === 'curl') sh.tube([[0, sy + 0.01, 0.12], [0, sy + 0.03, 0.16], [0, sy + 0.06, 0.155]], [0.022, 0.012, 0.003], 5, { col: boot });
  return { thigh: th, shin: sh };
}

/** Upper arm (shoulder down) and forearm with the hand. o: { up, fore, skin, puff, bell, cuff, gauntlet, k } */
function arms(n, o) {
  const k = o.k || 1, up = new Bld(), fo = new Bld(), lo = n <= 5;
  up.ball([0, 0.0, 0], [0.062 * k, 0.062, 0.062 * k], { nu: n, nv: lo ? 3 : 4, col: o.up });
  up.tube(lo ? [[0, -0.02, 0], [0, -D.UP, 0]] : [[0, -0.02, 0], [0, -0.14, 0.004], [0, -D.UP, 0]], lo ? [0.054 * k, 0.044 * k] : [0.054 * k, 0.05 * k, 0.043 * k], n, { col: o.up });
  if (o.puff) up.ball([0, -0.035, 0], [0.085, 0.075, 0.08], { nu: n, nv: 4, col: o.puff });
  if (!lo) fo.ball([0, 0, 0], [0.042 * k, 0.042, 0.042 * k], { nu: Math.max(5, n - 2), nv: 3, col: o.fore });
  fo.tube(lo ? [[0, 0.02, 0], [0, -0.235, 0.01]] : [[0, 0, 0], [0, -0.12, 0.008], [0, -0.235, 0.01]], lo ? [0.043 * k, 0.032 * k] : [0.042 * k, 0.039 * k, 0.031 * k], n, { col: o.fore });
  if (o.bell) fo.lathe([[0.115, -0.25, 0, o.cuff || o.bell], [0.105, -0.215, 'b', o.bell], [0.07, -0.11], [0.05, 0.02]], n + 2, { z: 0.01 });
  else if (o.cuff) fo.lathe([[0.042, -0.235], [0.046, -0.2], [0.04, -0.17]], n, { col: o.cuff, z: 0.01 });
  if (o.gauntlet) fo.lathe([[0.046, -0.245], [0.05, -0.2], [0.042, -0.08]], n, { col: o.gauntlet, z: 0.01 });
  const hs = o.hand || SKIN;
  fo.ball([0, -0.285, 0.014], [0.028, 0.048, 0.04], { nu: lo ? 5 : 6, nv: lo ? 3 : 4, col: hs });
  if (n >= 8) fo.ball([0, -0.268, 0.048], [0.012, 0.024, 0.012], { nu: 4, nv: 2, col: hs, rx: 0.5 });
  return { upper: up, fore: fo };
}
const limbN = n => (n >= 10 ? 8 : n >= 8 ? 7 : n === 7 ? 6 : 5);

/** Torso in the chest frame (waist at 0, shoulders at 0.38). o: { w, d, col, neckline (y where skin starts), collar, sub } */
function torso(B, n, o) {
  const w = o.w || 1, d = o.d || 0.66, col = o.col;
  const prof = n <= 6 ? [[0.14 * w, -0.08, 0, col], [0.15 * w, 0.1], [0.174 * w, 0.27], [0.155 * w, 0.36], [0.065, 0.44]]
    : [[0.14 * w, -0.08, 0, col], [0.142 * w, 0.06], [0.166 * w, 0.19], [0.174 * w, 0.28], [0.16 * w, 0.35], [0.118 * w, 0.405], [0.065, 0.44]];
  if (o.waist) { prof[0][0] *= o.waist; prof[1][0] *= o.waist; }
  if (o.neckline != null) {
    for (let j = 0; j < prof.length; j++) if (prof[j][1] > o.neckline) { prof.splice(j, 0, [lerp(prof[j - 1][0], prof[j][0], (o.neckline - prof[j - 1][1]) / (prof[j][1] - prof[j - 1][1])), o.neckline, 'b', SKIN]); break; }
  }
  if (o.collar) prof.push([0.07, 0.445, 'b', o.collar], [0.06, 0.48]);
  const xf = o.bust ? q => { const b = Math.exp(-Math.pow((q[1] - 0.25) / 0.06, 2)) * (q[2] > 0 ? o.bust : 0) * Math.pow(Math.max(0, Math.cos(Math.atan2(q[0], q[2]))), 2); return [q[0], q[1], q[2] + b]; } : null;
  if (o.split) {
    const h = Math.ceil(n / 2);
    B.lathe(prof, h, { sz: d, a0: Math.PI, a1: TAU, xf });
    B.lathe(prof, h, { sz: d, a0: 0, a1: Math.PI, xf, keep: true, sub: o.split });
  } else B.lathe(prof, n, { sz: d, xf });
  return { prof, w, d };
  B.tube([[0, 0.39, 0.0], [0, 0.5, 0.008]], [0.047, 0.044], Math.max(6, n - 2), { col: SKIN });
}
/** Pelvis in the hips frame. */
function pelvis(B, n, col, k) {
  k = k || 1;
  B.lathe(n <= 6 ? [[0.02, -0.11], [0.13 * k, -0.08], [0.152 * k, 0.04], [0.142 * k, 0.17]] : [[0.02, -0.11], [0.11 * k, -0.095], [0.148 * k, -0.035], [0.152 * k, 0.06], [0.142 * k, 0.17]], n, { sz: 0.72, col });
}
/** Head in the head frame (pivot at the neck base, head centre at y 0.13). o: { hair, hairStyle, nose, eyes, brows, mouth, ears, chin } */
function head(n, o) {
  const lo = n <= 6, B = new Bld(), nn = lo ? n + 1 : n + 2;
  /* one ellipsoid, narrowed into a jaw and chin below the cheekbones (a separate jaw ball shows seams like stubble) */
  const jw = o.chin === 'sharp' ? 0.36 : o.chin === 'soft' ? 0.2 : 0.24;
  B.ball([0, 0.13, 0.012], [0.088, 0.112, 0.1], { nu: nn, nv: lo ? 4 : 8, col: o.skin || SKIN, xf: q => {
    const k = clamp01((0.125 - q[1]) / 0.1), f = q[2] > 0.012 ? 1 : 0;
    return [q[0] * (1 - jw * k * k), q[1] + f * k * 0.006, q[2] + (f ? k * 0.014 : -k * 0.025)];
  } });
  const nz = o.nose === 'long' ? [0.019, 0.036, 0.03] : o.nose === 'small' ? [0.012, 0.02, 0.016] : [0.015, 0.024, 0.02];
  B.ball([0, o.nose === 'long' ? 0.112 : 0.117, 0.108], nz, { nu: lo ? 4 : 6, nv: lo ? 2 : 3, rx: o.nose === 'long' ? 0.35 : 0.2 });
  if (o.ears !== false && !lo) for (const s of [-1, 1]) B.ball([s * 0.087, 0.128, 0.0], [0.014, 0.028, 0.02], { nu: 5, nv: 3 });
  if (o.eyes !== false) {
    for (const s of [-1, 1]) {
      if (o.whites !== false && !lo) B.ball([s * 0.034, 0.141, 0.094], [0.018, 0.012, 0.012], { nu: 6, nv: 2, col: F(0xf2eee6) });
      B.ball([s * 0.034, 0.141, lo ? 0.098 : 0.101], lo ? [0.012, 0.012, 0.01] : [0.01, 0.0105, 0.008], { nu: lo ? 4 : 5, nv: 2, col: F(o.iris || 0x2a2018) });
    }
  }
  if (o.brows) for (const s of [-1, 1]) B.tube([[s * 0.016, 0.163, 0.106], [s * 0.035, 0.168, 0.105], [s * 0.056, 0.161, 0.096]], [0.008, 0.01, 0.006].map(r => r * (o.brows === 'bushy' ? 1.7 : 1)), 4, { col: o.browCol || HAIR });
  if (o.mouth !== false) B.ball([0, 0.073, 0.101], [0.022, 0.006, 0.008], { nu: 6, nv: 3, col: F(0x8a3b36) });
  const hs = o.hairStyle;
  if (hs && hs !== 'none') {
    B.ball([0, 0.153, -0.008], [0.096, 0.106, 0.106], { nu: nn, nv: lo ? 2 : 4, ph1: hs === 'crop' ? 0.5 : 0.62, rx: -0.42, col: o.hair || HAIR });
    if (hs === 'long') {
      B.tube([[0, 0.2, -0.03], [0, 0.11, -0.095], [0, -0.02, -0.13], [0, -0.17, -0.155], [0, -0.3, -0.16], [0, -0.39, -0.15]],
        [[0.085, 0.07], [0.102, 0.06], [0.11, 0.05], [0.1, 0.04], [0.085, 0.03], [0.05, 0.012]], n, { ref: [0, 0, 1], col: o.hair || HAIR });
      for (const s of [-1, 1]) B.tube([[s * 0.075, 0.18, 0.035], [s * 0.095, 0.1, 0.045], [s * 0.1, 0.02, 0.035], [s * 0.098, -0.04, 0.02]], [0.025, 0.026, 0.022, 0.008], 6, { col: o.hair || HAIR });
    } else if (hs === 'bun') {
      B.ball([0, 0.2, -0.1], [0.05, 0.046, 0.045], { nu: n, nv: 4, col: o.hair || HAIR });
    } else if (hs === 'braid') {
      for (let k = 0; k < 6; k++) B.ball([0, 0.1 - k * 0.075, -0.115 - Math.min(k, 3) * 0.012], [0.036 - k * 0.003, 0.045, 0.034 - k * 0.002], { nu: 6, nv: 4, col: o.hair || HAIR });
    }
  }
  return B;
}
/** Wide skirt / robe / tabard below the waist, in the hips frame; prof bottom to top. */
function skirt(B, n, prof, o) {
  o = o || {};
  const y0 = o.y0 == null ? 0.06 : o.y0, y1 = prof[0][1];
  B.lathe(prof, n, Object.assign({ sz: 0.9, sk: skirtW(y0, y1, 1.15) }, o));
  return skirtW(y0, y1, 1.15);
}
/** Radius of a lathe profile at height y (for decals). */
function profR(prof, y) {
  for (let j = 0; j + 1 < prof.length; j++) {
    const a = prof[j], b = prof[j + 1];
    if ((y >= a[1] && y <= b[1]) || (y <= a[1] && y >= b[1])) return lerp(a[0], b[0], (y - a[1]) / ((b[1] - a[1]) || 1));
  }
  return prof[prof.length - 1][0];
}
/** A ring of decals (stars, scales) on a lathe surface: count around, at height y, offset out. */
function decalRing(B, prof, sz, y, count, size, shape, o) {
  const r = profR(prof, y) + 0.004, a0 = o.a0 || 0, a1 = o.a1 == null ? TAU : o.a1, full = o.a1 == null;
  for (let k = 0; k < count; k++) {
    const a = a0 + (a1 - a0) * (k + (o.phase || 0)) / (full ? count : Math.max(1, count - 1));
    const c = [Math.sin(a) * r, y, Math.cos(a) * r * sz];
    B.decal(c, [Math.sin(a) * sz, (o.tiltUp || 0), Math.cos(a)], (o.vary ? o.vary(k) : 1) * size, shape, { col: o.col, sk: o.sk });
  }
}

/* ---------- the kinds ---------- */
/* Each returns { parts: { name: Bld }, cfg } ; parts: hips, thigh, shin, chest, head, upper, fore (+ cape, tail, prop,
   sword, shield, em (emissive, head frame), emC (emissive, chest frame)). */
function wizard(n) {
  const P = {};
  Object.assign(P, legs(limbN(n), { hose: F(0x2a2833), boot: F(0x4e3220), bootY: -0.3, shoe: 'curl', k: 0.92 }));
  const h = new Bld(); pelvis(h, n, S(1, 0.6));
  const prof = [[0.37, -0.905, 0, TRIM], [0.365, -0.855, 'b', MAIN], [0.31, -0.6], [0.24, -0.3], [0.19, -0.06], [0.165, 0.08], [0.158, 0.16]];
  const sk = skirt(h, n + 4, prof, { sz: 0.92 });
  decalRing(h, prof, 0.92, -0.71, 9, 0.032, STAR, { col: TRIM, sk, phase: 0.2 });
  decalRing(h, prof, 0.92, -0.42, 7, 0.026, STAR, { col: S(2, 1.05), sk, phase: 0.65, vary: k => 0.8 + 0.4 * ((k * 7) % 3) / 2 });
  h.lathe([[0.172, 0.02], [0.176, 0.07], [0.168, 0.125]], n + 4, { col: S(2, 0.82), sz: 0.9 });      // sash
  for (const [a, l] of [[0.32, 0.36], [0.55, 0.28]]) {
    const ys = [0.04, 0.04 - l * 0.5, 0.04 - l];
    h.tube(ys.map(y => { const rr = Math.max(0.178, profR(prof, y) + 0.01); return [Math.sin(a) * rr, y, Math.cos(a) * rr * 0.92]; }), [[0.024, 0.004], [0.026, 0.004], [0.028, 0.004]], 4, { col: S(2, 0.75), ref: [-Math.cos(a), 0, Math.sin(a)], sk });
  }
  P.hips = h;
  const c = new Bld(); torso(c, n, { col: MAIN, w: 0.98, d: 0.7, collar: TRIM });
  for (const s of [-1, 1]) c.tube([[s * 0.06, 0.43, 0.075], [s * 0.035, 0.25, 0.115], [s * 0.012, 0.0, 0.11]], [[0.018, 0.006], [0.016, 0.006], [0.014, 0.006]], 4, { col: TRIM, ref: [0, 0, 1] });   // front trim of the robe
  P.chest = c;
  const hd = head(n, { nose: 'long', brows: 'bushy', browCol: S(3, 1.05), hairStyle: 'crop', mouth: false, iris: 0x3a5a8a });
  // beard and moustache
  hd.tube([[0, 0.1, 0.075], [0, 0.04, 0.1], [0, -0.05, 0.125], [0, -0.15, 0.142], [0, -0.25, 0.14], [0, -0.33, 0.13]],
    [[0.072, 0.04], [0.082, 0.048], [0.074, 0.045], [0.058, 0.036], [0.036, 0.024], [0.005, 0.005]], n, { ref: [0, 0, 1], col: HAIR });
  hd.tube([[-0.065, 0.065, 0.088], [-0.03, 0.088, 0.112], [0, 0.092, 0.116], [0.03, 0.088, 0.112], [0.065, 0.065, 0.088]], [0.01, 0.018, 0.02, 0.018, 0.01], 5, { col: S(3, 1.08) });
  // hat: drooping brim, crooked cone, star band
  hd.lathe([[0.085, 0.208], [0.2, 0.198], [0.295, 0.168, 'c'], [0.29, 0.181, 'c'], [0.2, 0.212], [0.085, 0.228]], n + 6, { col: S(1, 0.9), x: 0, z: -0.012, xf: q => [q[0], q[1] - Math.max(0, q[2] - 0.12) * 0.12, q[2]] });
  const hp = [[0, 0.2, -0.012], [0, 0.32, -0.025], [0, 0.44, -0.055], [0, 0.54, -0.11], [0, 0.6, -0.19], [0, 0.6, -0.25]];
  hd.tube(hp, [0.106, 0.08, 0.055, 0.034, 0.018, 0.004], n + 2, { col: S(1, 0.9), cap0: true });
  hd.lathe([[0.108, 0.205], [0.103, 0.245]], n + 2, { col: TRIM, z: -0.012 });
  for (let k = 0; k < 5; k++) { const a = -0.9 + k * 0.45, y = 0.3 + (k % 2) * 0.09, r = 0.085 - (y - 0.2) * 0.22; hd.decal([Math.sin(a) * r, y, Math.cos(a) * r - 0.03], [Math.sin(a), 0.25, Math.cos(a)], 0.022, STAR, { col: TRIM }); }
  P.head = hd;
  Object.assign(P, arms(limbN(n), { up: MAIN, fore: MAIN, bell: MAIN, cuff: TRIM }));
  // staff: gnarled shaft, claw and crystal (crystal is a lit baked colour, the glow overlays it)
  const st = new Bld();
  st.tube([[0, -0.86, 0], [0.006, -0.4, 0.004], [-0.004, 0.1, -0.003], [0.008, 0.6, 0.004], [0, 0.84, 0]], [0.017, 0.02, 0.021, 0.022, 0.026], 6, { col: WOOD, cap0: true });
  for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; st.tube([[0, 0.83, 0], [Math.sin(a) * 0.05, 0.9, Math.cos(a) * 0.05], [Math.sin(a) * 0.03, 0.98, Math.cos(a) * 0.03]], [0.014, 0.01, 0.003], 4, { col: WOOD }); }
  st.lathe([[0, 0.855], [0.045, 0.93], [0.03, 0.99], [0, 1.05]], 6, { col: F(0x9fe6ff) });
  P.prop = st;
  return { parts: P, cfg: { scale: 1, stride: 0.82, arm: 0.8, abd: 0.13, prop: 'staff', atk: 'staff', glowAt: [0, 0.94, 0], glowCol: 0x8fdcff, propArm: 0.3 } };
}

function princess(n, desc) {
  const P = {};
  Object.assign(P, legs(limbN(n), { hose: SKIN, boot: S(1, 0.7), bootY: -0.36, k: 0.86 }));
  const h = new Bld(); pelvis(h, n, MAIN, 0.9);
  const prof = [[0.45, -0.915, 0, TRIM], [0.445, -0.875, 'b', MAIN], [0.4, -0.65], [0.31, -0.36], [0.22, -0.12], [0.16, 0.04], [0.128, 0.16]];
  skirt(h, n + 6, prof, { sz: 0.92 });
  h.lathe([[0.135, 0.12], [0.14, 0.15], [0.132, 0.18]], n + 2, { col: TRIM, sz: 0.85 });          // girdle
  h.tube([[0, 0.13, 0.125], [0.0, 0.0, 0.16], [0, -0.22, 0.24]], [0.01, 0.009, 0.007], 4, { col: GOLD, sk: skirtW(0.06, -0.915, 1.15) });
  P.hips = h;
  const c = new Bld(); torso(c, n, { col: MAIN, w: 0.9, d: 0.68, waist: 0.82, neckline: 0.33, bust: 0.022 });
  c.lathe([[0.152, 0.315], [0.156, 0.335], [0.14, 0.35]], n + 2, { col: TRIM, sz: 0.7 });   // neckline trim
  c.lathe([[0.056, 0.455], [0.06, 0.47], [0.05, 0.475]], 8, { col: GOLD, z: 0.004 });         // necklace
  c.ball([0, 0.415, 0.06], [0.012, 0.016, 0.008], { nu: 5, nv: 3, col: F(0x2fd07a) });
  if (desc.cape) P.cape = cape(n, 1.25, S(1, 0.62), TRIM);
  P.chest = c;
  const hd = head(n, { hairStyle: desc.hair, brows: true, iris: 0x2e5a3a, chin: 'soft', nose: 'small' });
  // tiara
  hd.lathe([[0.098, 0.2], [0.1, 0.214], [0.094, 0.222]], n + 2, { col: GOLD, z: 0.0, xf: q => [q[0], q[1] + q[2] * 0.25, q[2]] });
  for (const [x, hgt] of [[0, 0.06], [-0.045, 0.035], [0.045, 0.035]]) {
    const z = Math.sqrt(Math.max(0, 0.098 * 0.098 - x * x)) * 1.0, y = 0.215 + z * 0.25;
    hd.tube([[x, y, z], [x * 1.02, y + hgt, z - 0.008]], [0.011, 0.002], 4, { col: GOLD });
    if (x === 0) hd.ball([0, y + 0.012, z + 0.006], [0.01, 0.013, 0.008], { nu: 5, nv: 3, col: F(0x2fd07a) });
  }
  P.head = hd;
  Object.assign(P, arms(limbN(n), { up: MAIN, fore: MAIN, puff: S(1, 1.08), cuff: TRIM, k: 0.88 }));
  return { parts: P, cfg: { scale: 0.96, stride: 0.75, arm: 0.6, abd: 0.15, atk: 'push', glowCol: 0xfff0a8 } };
}

/** Cape hanging from the chest frame's neck (local origin at the cape pivot), length l. */
function cape(n, l, col, trim) {
  const B = new Bld();
  const prof = [[0.33, -l, 0, trim || col], [0.325, -l + 0.04, 'b', col], [0.28, -l * 0.55], [0.23, -0.2], [0.2, -0.04], [0.12, 0.03]];
  B.lathe(prof, n + 2, { a0: Math.PI - 1.35, a1: Math.PI + 1.35, sz: 0.8, z: 0.03, xf: q => [q[0], q[1], Math.min(q[2], -0.07 - Math.max(0, -q[1] - 0.25) * 0.05)] });
  return B;
}

function prince(n, desc) {
  const P = {};
  const swap = c => (c.s === 1 ? { c: c.c, s: 2 } : c.s === 2 ? { c: c.c, s: 1 } : c);
  Object.assign(P, legs(limbN(n), { hose: F(0x3a2e2a), boot: F(0x5a3a20), bootY: -0.04, shoe: 'boot' }));
  const h = new Bld(); pelvis(h, n, F(0x3a2e2a));
  const prof = [[0.215, -0.34, 0, S(1, 0.9)], [0.2, -0.2], [0.172, 0.0], [0.158, 0.12]];
  const sk = skirt(h, n + 2, prof, { sz: 0.85, a0: Math.PI, a1: TAU });
  skirt(h, n + 2, prof, { sz: 0.85, a0: 0, a1: Math.PI, sub: swap, keep: true });
  void sk;
  h.lathe([[0.166, 0.03], [0.17, 0.07], [0.164, 0.11]], n + 2, { col: LEATHER, sz: 0.86 });   // belt
  h.box([0, 0.07, 0.148], [0.05, 0.045, 0.014], { col: GOLD });
  // scabbard on the left hip
  const sd = XF.chain(XF.RX(Math.PI / 2 + 0.3), XF.T(0.19, 0.04, 0.05));
  h.tube([[0, 0, 0.07], [0, 0, 0.8], [0, 0, 0.86]], [[0.016, 0.034], [0.012, 0.028], [0.004, 0.01]], 6, { col: DARKLEATHER, xf: sd, ref: [0, 1, 0] });
  h.tube([[0, 0, 0.07], [0, 0, 0.12]], [[0.019, 0.037], [0.019, 0.037]], 6, { col: GOLD, xf: sd, ref: [0, 1, 0] });
  P.hips = h;
  const c = new Bld(); torso(c, n, { col: MAIN, w: 1.06, d: 0.66, collar: GOLD, split: swap });
  c.lathe([[0.17, 0.33], [0.165, 0.37], [0.12, 0.415], [0.07, 0.44]], n + 2, { col: MAIL, sz: 0.68 });   // mail shoulders
  P.cape = cape(n, 1.12, S(1, 0.6), TRIM);
  P.chest = c;
  const hd = head(n, { hairStyle: 'short', brows: true, iris: 0x3a5a7a });
  hd.lathe([[0.103, 0.198], [0.106, 0.214], [0.1, 0.226]], n + 2, { col: GOLD, z: -0.006, xf: q => [q[0], q[1] + q[2] * 0.15, q[2]] });
  hd.ball([0, 0.218, 0.103], [0.01, 0.012, 0.008], { nu: 5, nv: 3, col: F(0xd0203a) });
  P.head = hd;
  Object.assign(P, arms(limbN(n), { up: MAIL, fore: MAIL, gauntlet: LEATHER, k: 1.05 }));
  P.sword = sword();
  if (desc.shield) {
    const sh = new Bld(), out = [[0.14, 0.16], [-0.14, 0.16], [-0.14, 0.0], [-0.1, -0.13], [0, -0.21], [0.1, -0.13], [0.14, 0.0]].reverse();
    sh.ext(out, 0.025, { col: S(1, 1), side: GOLD });
    sh.box([0, 0.0, 0.015], [0.04, 0.33, 0.008], { col: TRIM });
    sh.box([0, 0.06, 0.015], [0.26, 0.04, 0.008], { col: TRIM });
    P.shield = sh;
  }
  return { parts: P, cfg: { scale: 1, stride: 1, arm: 1, abd: 0.1, atk: 'sword', glowCol: 0xffe9a0, sword: true } };
}
function sword() {
  const B = new Bld();
  B.ball([0, 0, -0.085], [0.02, 0.02, 0.02], { nu: 6, nv: 4, col: GOLD });
  B.tube([[0, 0, -0.07], [0, 0, 0.045]], [0.015, 0.015], 6, { col: DARKLEATHER, ref: [0, 1, 0] });
  B.box([0, 0, 0.055], [0.02, 0.17, 0.022], { col: GOLD });
  B.tube([[0, 0, 0.06], [0, 0, 0.6], [0, 0, 0.8], [0, 0, 0.86]], [[0.007, 0.024], [0.006, 0.02], [0.005, 0.014], [0.001, 0.002]], 4, { col: F(0xd8dee6), ref: [0, 1, 0] });
  return B;
}

function dragonkin(n) {
  const P = {};
  const SCALEG = F(0x2f7f50);
  Object.assign(P, legs(limbN(n), { hose: F(0x16261c), boot: F(0x2a2018), bootY: -0.1, shoe: 'pointy', k: 0.9 }));
  const h = new Bld(); pelvis(h, n, F(0x16261c), 0.92);
  // dark inner tunic, the long coat open at the front, scale trim along the hem and the front edges
  const inner = [[0.25, -0.88, 0, F(0x14241a)], [0.21, -0.5], [0.16, -0.1], [0.145, 0.12]];
  skirt(h, n, inner, { sz: 0.85 });
  const prof = [[0.34, -0.9, 0, MAIN], [0.3, -0.6], [0.23, -0.28], [0.175, -0.04], [0.158, 0.1], [0.152, 0.16]];
  const gap = y => 0.12 + clamp01(-y / 0.9) * 0.42;
  const sk = skirt(h, n + 4, prof, { sz: 0.9, gap });
  for (let row = 0; row < 1; row++) {
    const y = -0.86 + row * 0.055, r = profR(prof, y) + 0.006, cnt = 20;
    for (let k = 0; k < cnt; k++) {
      const a = gap(y) + (TAU - 2 * gap(y)) * (k + 0.5 * row + 0.25) / cnt;
      h.decal([Math.sin(a) * r, y, Math.cos(a) * r * 0.9], [Math.sin(a) * 0.9, 0.0, Math.cos(a)], 0.045, SCALE, { col: TRIM, sk });
    }
  }
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {          // scales up the front edges
    const y = -0.78 + k * 0.14, a = s > 0 ? gap(y) + 0.06 : TAU - gap(y) - 0.06, r = profR(prof, y) + 0.006;
    h.decal([Math.sin(a) * r, y, Math.cos(a) * r * 0.9], [Math.sin(a) * 0.9, 0, Math.cos(a)], 0.036, SCALE, { col: TRIM, sk });
  }
  h.lathe([[0.16, 0.04], [0.165, 0.08], [0.158, 0.12]], n + 2, { col: F(0x2a1c12), sz: 0.85 });   // belt
  P.hips = h;
  // tail: comes out under the coat and sweeps behind
  const tl = new Bld();
  tl.tube([[0, 0, 0], [0, -0.28, -0.08], [0, -0.58, -0.2], [0, -0.78, -0.38], [0, -0.85, -0.62], [0, -0.86, -0.86]], [0.06, 0.062, 0.05, 0.036, 0.022, 0.003], n, { col: SCALEG, ref: [1, 0, 0] });
  for (let k = 0; k < 5; k++) { const t = 0.35 + k * 0.13, y = lerp(-0.58, -0.85, t), z = lerp(-0.2, -0.86, t); tl.tube([[0, y + 0.02, z], [0, y + 0.06 - k * 0.007, z - 0.03]], [[0.004, 0.014 - k * 0.002], [0.001, 0.002]], 4, { col: TRIM, ref: [1, 0, 0] }); }
  P.tail = tl;
  const c = new Bld(), T = torso(c, n, { col: MAIN, w: 0.92, d: 0.64, collar: MAIN });
  void T;
  c.lathe([[0.034, 0.385], [0.036, 0.4], [0.026, 0.41]], 6, { col: GOLD, xf: q => [q[0], 0.4 + (q[2]), 0.083 + (q[1] - 0.4)] });
  P.chest = c;
  P.cape = cape(n, 1.36, S(1, 0.85), TRIM);
  for (let k = 0; k < 14; k++) {                                    // scale trim on the cape hem
    const a = Math.PI - 1.25 + 2.5 * k / 13, l = 1.36, r = 0.335;
    P.cape.decal([Math.sin(a) * r, -l + 0.03, Math.min(Math.cos(a) * r * 0.8 + 0.03, -0.07 - (l - 0.25) * 0.05) - 0.006], [Math.sin(a), 0, Math.cos(a)], 0.042, SCALE, { col: TRIM });
  }
  const hd = head(n, { brows: false, mouth: false, eyes: false, chin: 'sharp', skin: S(4, 0.95), hairStyle: 'crop', hair: F(0x101a14) });
  // hood: a shell over the head, open at the face, with a peak at the back and scale trim round the opening
  const hgap = y => (y < 0.0 ? 0.75 : y > 0.24 ? 0.25 : 0.85 - 0.35 * sstep(0.12, 0.26, y));
  const hprof = [[0.16, -0.02], [0.135, 0.04], [0.118, 0.1], [0.122, 0.16], [0.112, 0.22], [0.085, 0.27], [0.045, 0.3], [0.0, 0.31]];
  hd.lathe(hprof, n + 4, { col: MAIN, z: -0.012, gap: hgap, xf: q => [q[0], q[1], q[2] - Math.max(0, q[1] - 0.2) * 0.45] });
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    const y = 0.02 + k * 0.05, g = hgap(y) + 0.02, r = profR(hprof, y) + 0.004, a = s > 0 ? g : TAU - g;
    hd.decal([Math.sin(a) * r, y, Math.cos(a) * r - 0.012 - Math.max(0, y - 0.2) * 0.45], [Math.sin(a), 0, Math.cos(a)], 0.03, SCALE, { col: TRIM });
  }
  for (const s of [-1, 1]) {                                        // horns through the hood
    hd.tube([[s * 0.062, 0.215, 0.03], [s * 0.1, 0.285, 0.01], [s * 0.128, 0.335, -0.045], [s * 0.13, 0.36, -0.11], [s * 0.12, 0.365, -0.15]], [0.03, 0.022, 0.014, 0.007, 0.002], 6, { col: HAIR });
  }
  P.head = hd;
  // emissive: amber slit eyes (head) and the emerald clasp (chest)
  const em = new Bld();
  for (const s of [-1, 1]) em.ball([s * 0.034, 0.142, 0.1], [0.019, 0.008, 0.008], { nu: 6, nv: 3, col: F(0xffb21e), rx: 0, xf: q => [q[0], q[1] + (q[0] * s - 0.034) * 0.25 * 1, q[2]] });
  P.em = em;
  const emc = new Bld(); emc.ball([0, 0.4, 0.094], [0.024, 0.03, 0.014], { nu: 4, nv: 2, col: F(0x26f08a) });
  P.emC = emc;
  Object.assign(P, arms(limbN(n), { up: MAIN, fore: MAIN, cuff: TRIM, k: 0.9, hand: S(4, 0.9) }));
  for (let k = 0; k < 4; k++) P.fore.tube([[(k - 1.5) * 0.013, -0.32, 0.03], [(k - 1.5) * 0.015, -0.345, 0.04]], [0.006, 0.001], 3, { col: F(0x1a1a14) });   // claws
  return { parts: P, cfg: { scale: 1.06, stride: 0.95, arm: 0.75, abd: 0.12, atk: 'push', glowCol: 0xffa030, capeLen: 1.35 } };
}

function guard(n, desc) {
  const P = {};
  Object.assign(P, legs(limbN(n), { hose: F(0x3b3a40), boot: F(0x4a3420), bootY: -0.12, shoe: 'boot' }));
  const h = new Bld(); pelvis(h, n, MAIL);
  const prof = [[0.21, -0.36, 0, MAIN], [0.19, -0.2], [0.165, 0.0], [0.155, 0.12]];
  skirt(h, n, prof, { sz: 0.82 });
  h.lathe([[0.164, 0.03], [0.168, 0.07], [0.162, 0.11]], n, { col: LEATHER, sz: 0.84 });
  P.hips = h;
  const c = new Bld(); torso(c, n, { col: MAIN, w: 1.04, d: 0.66, collar: MAIL });
  c.box([0, 0.2, 0.118], [0.04, 0.24, 0.012], { col: TRIM });
  c.box([0, 0.25, 0.118], [0.17, 0.04, 0.012], { col: TRIM });
  P.chest = c;
  const hd = head(n, { hairStyle: 'crop', brows: n >= 8, whites: n >= 8, mouth: false, ears: n >= 8 });
  hd.lathe([[0.096, 0.17], [0.205, 0.15], [0.12, 0.19, 'c'], [0.106, 0.25, 'c'], [0.07, 0.29], [0, 0.305]], n + 1, { col: STEEL, z: -0.005 });
  P.head = hd;
  Object.assign(P, arms(limbN(n), { up: MAIL, fore: MAIL }));
  const hb = new Bld();
  hb.tube([[0, -0.86, 0], [0, 1.22, 0]], [0.016, 0.015], 5, { col: WOOD });
  if (desc.weapon === 'spear') {
    hb.lathe([[0.02, 1.2], [0.032, 1.3], [0, 1.46]], 4, { col: STEEL, sx: 1, sz: 0.4 });
  } else {
    hb.lathe([[0.016, 1.2], [0.018, 1.28], [0, 1.44]], 4, { col: STEEL });
    const blade = [[0.01, 1.0], [0.11, 0.97], [0.17, 1.04], [0.18, 1.14], [0.12, 1.24], [0.01, 1.22]];
    hb.ext(blade, 0.01, { col: STEEL, xf: XF.RY(-Math.PI / 2) });
    hb.ext([[-0.01, 1.1], [-0.01, 1.19], [-0.11, 1.08]], 0.01, { col: STEEL, xf: XF.RY(-Math.PI / 2) });
  }
  P.prop = hb;
  return { parts: P, cfg: { scale: 1.02, stride: 1, arm: 0.9, abd: 0.1, prop: 'halberd', atk: 'halberd', glowCol: 0xffffff, propArm: 0.3 } };
}

/* townsfolk: desc { f (woman), hat: 'none'|'hat'|'hood'|'cap'|'kerchief', apron, basket } */
function citizen(n, desc) {
  const P = {}, f = desc.f;
  Object.assign(P, legs(limbN(n), { hose: TRIM, boot: F(0x4a3422), bootY: -0.3, k: f ? 0.88 : 1 }));
  const h = new Bld(); pelvis(h, n, MAIN, f ? 0.95 : 1);
  const prof = f ? [[0.36, -0.9, 0, S(1, 0.85)], [0.29, -0.55], [0.2, -0.2], [0.15, 0.05], [0.135, 0.15]]
    : [[0.205, -0.33, 0, S(1, 0.9)], [0.19, -0.18], [0.165, 0.0], [0.155, 0.12]];
  const sk = skirt(h, n, prof, { sz: f ? 0.9 : 0.84 });
  h.lathe([[0.156, 0.035], [0.162, 0.075], [0.152, 0.11]], n, { col: LEATHER, sz: 0.84 });
  if (desc.apron) {
    const ys = f ? [-0.8, -0.4, 0.0, 0.07] : [-0.28, -0.12, 0.0, 0.07];
    h.lathe(ys.map(y => [y > 0.03 ? 0.165 : profR(prof, y) + 0.018, y]), 4, { col: F(0xd9d1bb), sz: f ? 0.9 : 0.84, a0: -0.85, a1: 0.85, sk });
  }
  P.hips = h;
  const c = new Bld(); torso(c, n, { col: MAIN, w: f ? 0.92 : 1, d: 0.68, waist: f ? 0.9 : 1, neckline: f ? 0.36 : null, collar: f ? null : S(1, 0.85) });
  if (desc.hat === 'hood') c.lathe([[0.215, 0.27], [0.2, 0.34], [0.13, 0.41], [0.07, 0.47]], n, { col: TRIM, sz: 0.75 });   // hood cowl over the shoulders
  P.chest = c;
  const hair = desc.hat === 'none' ? (f ? 'bun' : 'short') : desc.hat === 'kerchief' || desc.hat === 'hood' ? 'none' : 'crop';
  const hd = head(n, { hairStyle: hair, whites: false, mouth: false, ears: n >= 7, brows: false });
  if (desc.hat === 'hat') {
    hd.lathe([[0.09, 0.19], [0.17, 0.18], [0.172, 0.19, 'c'], [0.105, 0.215, 'c'], [0.1, 0.28], [0.0, 0.3]], n, { col: TRIM, z: -0.01 });
  } else if (desc.hat === 'cap') {
    hd.ball([0, 0.16, -0.01], [0.1, 0.105, 0.11], { nu: n + 1, nv: 4, ph1: 0.55, rx: -0.5, col: TRIM });
  } else if (desc.hat === 'kerchief' || desc.hat === 'hood') {
    const hp = [[0.12, 0.02], [0.112, 0.1], [0.115, 0.17], [0.098, 0.23], [0.06, 0.27], [0, 0.285]];
    hd.lathe(hp, n + 1, { col: TRIM, z: -0.014, gap: y => (y < 0.06 ? 0.95 : y > 0.22 ? 0.2 : 0.95 - 0.6 * sstep(0.1, 0.22, y)), xf: desc.hat === 'hood' ? q => [q[0], q[1], q[2] - Math.max(0, q[1] - 0.18) * 0.4] : null });
  }
  P.head = hd;
  Object.assign(P, arms(limbN(n), { up: MAIN, fore: MAIN, k: f ? 0.88 : 1 }));
  if (desc.basket) {
    const b = new Bld();
    b.lathe([[0.0, -0.1], [0.08, -0.095], [0.1, -0.02], [0.085, -0.03]], 6, { col: F(0x9a7642), sz: 0.8 });
    b.tube([[-0.09, -0.02, 0], [-0.05, 0.08, 0], [0.05, 0.08, 0], [0.09, -0.02, 0]], [0.008, 0.008, 0.008, 0.008], 3, { col: F(0x7a5a32) });
    P.basket = b;
  }
  return { parts: P, cfg: { scale: f ? 0.95 : 1, stride: f ? 0.8 : 1, arm: 0.85, abd: f ? 0.14 : 0.1, atk: 'push', glowCol: 0xffffff } };
}

const BUILDERS = { wizard, princess, prince, dragonkin, guard, citizen };

/* ---------- palettes (slots 1 main, 2 trim, 3 hair / horn, 4 skin) ---------- */
const SKINS = [0xf0cdb2, 0xe3b898, 0xcd9e7c, 0xa97a58, 0xf4dac4];
const HAIRS = [0x2a1a10, 0x4a3020, 0x6a4a2a, 0x9a7040, 0xc9a66a, 0x8c8a86];
const CLOTH = [0x7a5a3a, 0x5d6b3a, 0x8a3a2a, 0x3d4d6e, 0x6a6a5c, 0x9a7a48, 0x4e3a5e, 0x2f5a4a, 0xa08860, 0x6e2e3a];
const CLOTH2 = [0xd8ccb0, 0x8a7a5a, 0x5a3a2a, 0xb0a080, 0x3a3a3a, 0x9a4a3a, 0x6a7a8a, 0x40523a];
function palette(kind, seed, over) {
  const r = rng((seed >>> 0) ^ 0x5bd1e995), z = !seed;
  let p;
  switch (kind) {
    case 'wizard': p = { main: z ? 0x2a3592 : pick(r, [0x2a3592, 0x4a2a80, 0x23306e, 0x3a2470]), trim: 0xe6bd4e, hair: 0xd6d6d0, skin: 0xe8c0a6 }; break;
    case 'princess': {
      const opts = [[0x1d7a4c, 0xe3bd4f, 0xe0be6a], [0xc94f73, 0xe8c45a, 0x8a4a25], [0xc94f73, 0xe8c45a, 0x3b2617], [0x1d7a4c, 0xe3bd4f, 0x3b2617]];
      const o = z ? opts[0] : pick(r, opts); p = { main: o[0], trim: o[1], hair: o[2], skin: 0xf2cfb6 }; break;
    }
    case 'prince': {
      const opts = [[0x1d3f8f, 0xe8c24a], [0xa82626, 0xece6d8], [0x1e6a3e, 0xe8c24a], [0x1d3f8f, 0xece6d8]];
      const o = z ? opts[0] : pick(r, opts); p = { main: o[0], trim: o[1], hair: z ? 0x6b4325 : pick(r, [0x6b4325, 0x3a2414, 0xb08a4a]), skin: 0xe8bfa2 }; break;
    }
    case 'dragonkin': p = { main: 0x1e4a32, trim: z ? 0x5fb070 : pick(r, [0x5fb070, 0x6fbf62, 0xb79a3c]), hair: 0xe7dcc1, skin: 0xc2c9a6 }; break;
    case 'guard': p = { main: 0xa82424, trim: 0xece4cc, hair: pick(r, HAIRS), skin: pick(r, SKINS) }; break;
    default: p = { main: pick(r, CLOTH), trim: pick(r, CLOTH2), hair: pick(r, HAIRS), skin: pick(r, SKINS) };
  }
  if (over) for (const k of ['main', 'trim', 'hair', 'skin']) if (over[k] != null) p[k] = over[k];
  return p;
}
function variant(kind, seed) {
  const r = rng((seed >>> 0) ^ 0x27d4eb2f), z = !seed;
  switch (kind) {
    case 'princess': return { hair: z ? 'long' : pick(r, ['long', 'long', 'braid']), cape: z ? false : r() < 0.4 };
    case 'prince': return { shield: z ? true : r() < 0.7 };
    case 'guard': return { weapon: r() < 0.7 ? 'halberd' : 'spear' };
    case 'citizen': {
      const f = r() < 0.5;
      return { f, hat: pick(r, f ? ['none', 'kerchief', 'kerchief', 'hood'] : ['none', 'hat', 'hood', 'cap']), apron: r() < 0.35, basket: r() < (f ? 0.4 : 0.15) };
    }
    default: return {};
  }
}
const descKey = d => Object.keys(d).sort().map(k => k + '=' + d[k]).join(',');

/* raw part builders cached per kind / variant / detail; built geometries cached separately */
const bldCache = new Map(), geoCache = new Map();
function kindData(kind, desc, detail) {
  const key = kind + '|' + descKey(desc) + '|' + detail;
  let K = bldCache.get(key);
  if (!K) {
    const cheap = kind === 'citizen' || kind === 'guard';
    const n = cheap ? 6 : (detail === 'low' ? 7 : 10);       // townsfolk and guards are crowd figures: always cheap
    K = BUILDERS[kind](n, desc);
    K.key = key;
    const tl = K.parts;
    K.top = Math.max(tl.head.maxY() + D.HIP + D.CHEST + D.NECK, tl.chest.maxY() + D.HIP + D.CHEST);
    bldCache.set(key, K);
  }
  return K;
}
function geo(K, part) {
  const k = K.key + '|' + part;
  let g = geoCache.get(k);
  if (!g) { g = K.parts[part].build(); geoCache.set(k, g); }
  return g;
}

/* ---------- material: palette slots and skirt swing in the vertex shader ---------- */
const VPARS = [
  'attribute vec2 hv;',
  '#ifdef HV_INST',
  'attribute vec3 hvIA; attribute vec3 hvIB; attribute vec3 hvIC; attribute vec3 hvID; attribute vec4 hvIL;',
  '#define HVA hvIA', '#define HVB hvIB', '#define HVC hvIC', '#define HVD hvID', '#define HVL hvIL',
  '#else',
  'uniform vec3 hvA; uniform vec3 hvB; uniform vec3 hvC; uniform vec3 hvD; uniform vec4 hvL;',
  '#define HVA hvA', '#define HVB hvB', '#define HVC hvC', '#define HVD hvD', '#define HVL hvL',
  '#endif', '',
].join('\n');
const VCOL = [
  '#include <color_vertex>',
  '{ vec3 hvT = hv.x < 0.5 ? vec3( 1.0 ) : hv.x < 1.5 ? HVA : hv.x < 2.5 ? HVB : hv.x < 3.5 ? HVC : HVD; vColor.rgb *= hvT; }',
].join('\n');
const VPOS = [
  '#include <begin_vertex>',
  'if ( hv.y > 0.0 ) {',
  '  float hvS = smoothstep( -0.07, 0.07, transformed.x );',
  '  float hvF = mix( HVL.x, HVL.y, hvS ) * hv.y * max( 0.0, -transformed.y ) * 0.85;',
  '  transformed.z += hvF + hv.y * hv.y * HVL.w;',
  '  transformed.x += hv.y * hv.y * HVL.z;',
  '  transformed.y += abs( hvF ) * 0.18 + hv.y * hv.y * abs( HVL.w ) * 0.25;',
  '}',
].join('\n');
function hvMaterial(lit, inst, o) {
  o = o || {};
  const Ctor = lit ? THREE.MeshStandardMaterial : (THREE.MeshLambertMaterial || THREE.MeshStandardMaterial);
  const p = { vertexColors: true, side: THREE.DoubleSide };
  if (lit) { p.roughness = 0.82; p.metalness = 0.04; }
  const m = new Ctor(p);
  const U = inst ? null : { hvA: { value: { x: 1, y: 1, z: 1 } }, hvB: { value: { x: 1, y: 1, z: 1 } }, hvC: { value: { x: 1, y: 1, z: 1 } }, hvD: { value: { x: 1, y: 1, z: 1 } }, hvL: { value: { x: 0, y: 0, z: 0, w: 0 } } };
  m.defines = Object.assign({}, m.defines || {}, inst ? { HV_INST: '' } : {});
  m.onBeforeCompile = function (sh) {
    if (U) Object.assign(sh.uniforms, U);
    sh.vertexShader = VPARS + sh.vertexShader.replace('#include <color_vertex>', VCOL).replace('#include <begin_vertex>', VPOS);
  };
  m.customProgramCacheKey = () => (inst ? 'hvI' : 'hv');
  m.userData.hv = U;
  const TX = HOST.VTex;
  if (o.cloth && TX && TX.detail && typeof document !== 'undefined') TX.detail(m, { map: 'wool', local: true, scale: 0.9, strength: 0.06, bump: 0 });   // a whisper of weave; stronger reads as noise at this size
  return m;
}
const setV3 = (u, hex) => { const c = rgb(hex); u.x = c[0]; u.y = c[1]; u.z = c[2]; };

/* ---------- pose: the walk / run / idle / cast / attack / talk cycle on any rig of {position, rotation} records ---------- */
/* rig: { hips, chest, head, sh:[L,R], el:[L,R], leg:[L,R], kn:[L,R], cape?, tail?, prop?, hand?:[L,R] } (L = +x side)
   state: { t, v, r, ph, talk, draw } ; returns the skirt swing vector [x, y, z, w] for hvL. */
function newState() { return { t: 0, v: 0, r: 0, ph: 0, talk: 0, draw: 0, L: [0, 0, 0, 0] }; }
function pose(R, St, o, dt, K) {
  o = o || {};
  dt = Math.max(0, Math.min(+dt || 0, 0.1));
  St.t += dt;
  const sp = Math.max(0, +o.speed || 0) / (K.scale || 1);
  St.v += (sp - St.v) * Math.min(1, dt * 8);
  St.r += ((o.run || sp > 2.8 ? 1 : 0) - St.r) * Math.min(1, dt * 5);
  St.talk += ((o.talk ? 1 : 0) - St.talk) * Math.min(1, dt * 4);
  const v = St.v, r = St.r * clamp01(v / 0.8), a = Math.min(1, v / 1.1), t = St.t, idle = 1 - a;
  const air = clamp01(+o.air || 0), cast = clamp01(+o.cast || 0), atk = clamp01(+o.attack || 0), talk = St.talk;
  const cyc = (1.45 + 1.3 * r) * Math.max(0.5, a);
  St.ph = (St.ph + v / cyc * TAU * dt) % TAU;
  const ph = St.ph, sn = Math.sin(ph), cs = Math.cos(ph), str = K.stride || 1;
  /* legs */
  const thA = a * (0.38 + 0.42 * r) * str, fw = -0.16 * r * a;
  let thL = -sn * thA + fw, thR = sn * thA + fw;
  const kb = a * (0.05 + 0.25 * r), ks = a * (0.5 + 0.95 * r) * str;
  let knL = kb + ks * Math.max(0, cs), knR = kb + ks * Math.max(0, -cs);
  thL = lerp(thL, -0.8, air); knL = lerp(knL, 1.35, air); thR = lerp(thR, -0.2, air); knR = lerp(knR, 0.55, air);
  const ext = (th, kn) => D.TH * Math.cos(th) + D.SH * Math.cos(th + kn);
  const drop = (D.TH + D.SH) - Math.max(ext(thL, knL), ext(thR, knR));
  R.leg[0].rotation.x = thL; R.leg[1].rotation.x = thR; R.kn[0].rotation.x = knL; R.kn[1].rotation.x = knR;
  R.leg[0].rotation.z = 0.02; R.leg[1].rotation.z = -0.02;
  R.hips.position.y = D.HIP - drop * (1 - air) + r * a * 0.035 * Math.max(0, Math.sin(2 * ph - 0.6)) + air * 0.02;
  R.hips.rotation.y = -sn * 0.11 * a;
  R.hips.rotation.z = -sn * 0.03 * a + Math.sin(t * 0.55) * 0.014 * idle;
  /* body */
  let lean = 0.03 * a + 0.2 * r + Math.sin(t * 1.7) * 0.012 * idle + air * 0.08;
  let twist = sn * 0.2 * a;
  const sw = atk > 0 ? attackCurve(K.atk, atk) : null;
  if (cast > 0) lean = lerp(lean, -0.06, cast);
  if (sw) { lean += sw.lean; twist += sw.twist; }
  R.chest.rotation.x = K.rigid ? 0 : lean;
  R.chest.rotation.y = K.rigid ? 0 : twist + Math.sin(t * 1.3) * 0.06 * talk;
  R.chest.rotation.z = K.rigid ? 0 : -R.hips.rotation.z * 0.6;
  if (R.head) {
    R.head.rotation.x = -lean * 0.7 + talk * Math.sin(t * 3.1) * 0.06 - cast * 0.08;
    R.head.rotation.y = idle * (Math.sin(t * 0.31) * 0.24 + Math.sin(t * 0.83) * 0.05) * (1 - cast) - twist * 0.7 + talk * Math.sin(t * 0.9) * 0.15;
  }
  /* arms: counter-swing, elbows bend more when running */
  const armA = a * (0.32 + 0.55 * r) * (K.arm || 1);
  const pa = K.propArm || 1;
  let sL = sn * armA, sR = -sn * armA * pa;
  let eL = -(0.1 + 0.18 * a + 1.05 * r) - 0.25 * a * Math.max(0, -sn), eR = -(0.1 + 0.18 * a + 1.05 * r) - 0.25 * a * Math.max(0, sn);
  if (K.prop) eR = lerp(-0.42, eR, r);
  let zL = (K.abd || 0.1) + Math.sin(t * 1.7) * 0.015 * idle + air * 0.55, zR = -(K.abd || 0.1) - Math.sin(t * 1.7) * 0.015 * idle - air * 0.55;
  sL -= air * 0.4; sR -= air * 0.4;
  if (talk > 0) {
    sR += talk * (-0.5 - 0.22 * Math.sin(t * 2.1)); eR += talk * (-0.75 - 0.4 * Math.sin(t * 3.3 + 1)); zR += talk * 0.12;
    eL += talk * (-0.35 - 0.25 * Math.sin(t * 2.7)); sL += talk * (-0.12 - 0.1 * Math.sin(t * 1.9 + 2));
  }
  if (cast > 0) {
    const raiseR = K.prop === 'staff' ? -2.1 : -1.35;
    sL = lerp(sL, -1.35, cast); sR = lerp(sR, raiseR, cast);
    zL = lerp(zL, -0.12, cast); zR = lerp(zR, 0.12, cast);
    eL = lerp(eL, -0.3 - Math.sin(t * 9) * 0.04, cast); eR = lerp(eR, K.prop === 'staff' ? -0.15 : -0.3 - Math.sin(t * 9 + 1) * 0.04, cast);
  }
  let tilt = 0;
  if (sw) {
    const k = sw.k;
    if (sw.both) { sL = lerp(sL, sw.sx, k); eL = lerp(eL, sw.ex, k); zL = lerp(zL, -sw.sz, k); }
    sR = lerp(sR, sw.sx, k); eR = lerp(eR, sw.ex, k); zR = lerp(zR, sw.sz, k);
    tilt = sw.tilt || 0;
    if (R.hand && K.sword && sw.wrist != null) R.hand[1].rotation.x = sw.wrist;
  } else if (R.hand && K.sword) R.hand[1].rotation.x = 0.25;
  R.sh[0].rotation.x = sL; R.sh[1].rotation.x = sR; R.sh[0].rotation.z = zL; R.sh[1].rotation.z = zR;
  R.el[0].rotation.x = eL; R.el[1].rotation.x = eR;
  R.sh[1].rotation.y = sw && sw.sy ? sw.sy * sw.k : 0;
  /* the staff / halberd stays upright (walking stick), tilts forward to thrust */
  if (R.prop) {
    R.prop.rotation.x = -(R.chest.rotation.x + sR + eR) + tilt;
    R.prop.rotation.z = -zR * 0.9;
    R.prop.position.z = (sw ? sw.push || 0 : 0);
  }
  /* cape trails, tail sways, skirts follow the legs */
  if (R.cape) R.cape.rotation.x = lean + Math.min(0.62, 0.05 + 0.16 * a + 0.3 * r + Math.sin(2 * ph) * 0.04 * a + Math.sin(t * 1.3) * 0.02 + air * 0.45) / (K.capeLen || 1);
  if (R.tail) { R.tail.rotation.y = Math.sin(ph) * 0.3 * a + Math.sin(t * 0.9) * 0.16 * idle; R.tail.rotation.x = -0.1 * r + Math.sin(t * 1.4) * 0.03; }
  const L = St.L;
  L[0] = -Math.sin(thR) * 0.95; L[1] = -Math.sin(thL) * 0.95;
  L[2] = -sn * 0.02 * a;
  L[3] = -(0.05 * a + 0.16 * r) - air * 0.14 + Math.sin(t * 1.1) * 0.008 + Math.sin(2 * ph) * 0.015 * a;
  return L;
}
/* attack swing: k (blend), shoulder x / z / y, elbow, chest twist / lean, prop tilt, wrist */
function attackCurve(type, p) {
  const k = sstep(0, 0.12, p) * (1 - sstep(0.85, 1, p));
  if (type === 'sword') {
    const up = sstep(0, 0.35, p), down = sstep(0.35, 0.62, p);
    return { k, sx: lerp(lerp(-0.3, -2.75, up), -0.55, down), sz: lerp(lerp(-0.1, -0.55, up), 0.35, down), sy: 0, ex: lerp(-0.6, -0.12, down),
      twist: lerp(lerp(0, -0.4, up), 0.42, down) * k, lean: lerp(-0.05, 0.14, down) * k, wrist: lerp(lerp(0.25, -0.3, up), 0.55, down) };
  }
  const w = sstep(0, 0.35, p) * (1 - sstep(0.35, 0.55, p)), e = sstep(0.35, 0.55, p) * (1 - sstep(0.8, 1, p));
  if (type === 'staff' || type === 'halberd') {
    return { k, sx: lerp(-0.35, -0.75, e) - w * 0.2, sz: 0.1, ex: lerp(-0.7, -0.15, e), twist: lerp(-0.2 * w, 0.15, e) * k, lean: (0.15 * e - 0.05 * w) * k,
      tilt: (type === 'staff' ? 1.45 : 1.4) * sstep(0.1, 0.45, p) * (1 - sstep(0.8, 1, p)), push: 0.12 * e };
  }
  return { k, both: true, sx: -0.5 * w - 1.42 * e, sz: 0.1 - 0.15 * e, ex: -1.9 * w - 0.1 * e, twist: 0, lean: (0.16 * e - 0.06 * w) * k };
}

/* ---------- a single figure ---------- */
function make(kind, opts) {
  opts = opts || {};
  if (KINDS.indexOf(kind) < 0) kind = 'citizen';
  const seed = (opts.seed >>> 0) || 0, detail = opts.detail === 'low' ? 'low' : 'high';
  const desc = Object.assign(variant(kind, seed), opts.variant || {});
  const K = kindData(kind, desc, detail), cfg = Object.assign({}, K.cfg);
  if (kind === 'citizen' || kind === 'guard') cfg.scale *= 0.96 + rng(seed ^ 0x1234567)() * 0.08;
  const pal = palette(kind, seed, opts.palette);
  const hero = kind !== 'citizen' && kind !== 'guard';
  const mat = hvMaterial(hero, false, { cloth: hero && detail === 'high' });
  const U = mat.userData.hv;
  setV3(U.hvA.value, pal.main); setV3(U.hvB.value, pal.trim); setV3(U.hvC.value, pal.hair); setV3(U.hvD.value, pal.skin);
  const mats = [mat];
  const node = () => new THREE.Group();
  const mesh = (parent, part, m) => { if (!K.parts[part]) return null; const me = new THREE.Mesh(geo(K, part), m || mat); parent.add(me); return me; };

  const rootG = node(), fig = node(); rootG.add(fig); fig.scale.set(cfg.scale, cfg.scale, cfg.scale);
  const hips = node(); hips.position.y = D.HIP; fig.add(hips); mesh(hips, 'hips');
  const leg = [], kn = [];
  for (const s of [1, -1]) {
    const l = node(); l.position.set(s * D.LEGX, D.LEGY, 0); hips.add(l); mesh(l, 'thigh');
    const k = node(); k.position.y = -D.TH; l.add(k); mesh(k, 'shin');
    leg.push(l); kn.push(k);
  }
  const chest = node(); chest.position.y = D.CHEST; hips.add(chest); mesh(chest, 'chest');
  const headG = node(); headG.position.y = D.NECK; chest.add(headG); mesh(headG, 'head');
  const sh = [], el = [], hand = [];
  for (const s of [1, -1]) {
    const a = node(); a.position.set(s * D.SHX, D.SHY, 0); chest.add(a); mesh(a, 'upper');
    const e = node(); e.position.y = -D.UP; a.add(e); mesh(e, 'fore');
    const hnd = node(); hnd.position.set(D.GRIP[0], D.GRIP[1], D.GRIP[2]); e.add(hnd);
    sh.push(a); el.push(e); hand.push(hnd);
  }
  const rig = { hips, chest, head: headG, sh, el, leg, kn, hand };
  if (K.parts.cape) { const c = node(); c.position.set(0, 0.42, -0.02); chest.add(c); mesh(c, 'cape'); rig.cape = c; }
  if (K.parts.tail) { const t = node(); t.position.set(0, -0.12, -0.1); hips.add(t); mesh(t, 'tail'); rig.tail = t; }
  if (K.parts.prop) { const p = node(); hand[1].add(p); mesh(p, 'prop'); rig.prop = p; }
  if (K.parts.basket) { const b = node(); b.position.set(0, -0.1, 0.0); hand[0].add(b); mesh(b, 'basket'); }
  let swordHip = null, swordHand = null;
  if (K.parts.sword) {
    swordHip = node(); swordHip.position.set(0.19, 0.04, 0.05); swordHip.rotation.x = Math.PI / 2 + 0.3; hips.add(swordHip); mesh(swordHip, 'sword');
    swordHand = node(); swordHand.rotation.x = 0.0; hand[1].add(swordHand); mesh(swordHand, 'sword'); swordHand.visible = false;
  }
  if (K.parts.shield) { const s = node(); s.position.set(0.075, -0.15, 0.0); s.rotation.set(0, Math.PI / 2, 0); el[0].add(s); mesh(s, 'shield'); }
  if (K.parts.em || K.parts.emC) {
    const em = new THREE.MeshBasicMaterial({ vertexColors: true });
    mats.push(em);
    mesh(headG, 'em', em); mesh(chest, 'emC', em);
  }
  /* glow: additive core + halo at the staff crystal or in the right hand; a twin in the left hand while casting */
  const glowCol = cfg.glowCol || 0xffffff;
  const gCore = new THREE.MeshBasicMaterial({ color: glowCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const soft = THREE.Sprite && THREE.SpriteMaterial ? dot(true) : null;   // soft sprite halo in the browser, a mesh in Node
  const gHalo = soft ? new THREE.SpriteMaterial({ map: soft, color: glowCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    : new THREE.MeshBasicMaterial({ color: glowCol, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.push(gCore, gHalo);
  const glowGeo = (key, r, nu, nv) => {
    let g = geoCache.get(key);
    if (!g) { const B = new Bld(); B.set(F(0xffffff)).ball([0, 0, 0], [r, r, r], { nu, nv }); g = B.build(); geoCache.set(key, g); }
    return g;
  };
  const mkGlow = parent => {
    const gg = node();
    const c = new THREE.Mesh(glowGeo('glow:core', 0.04, 6, 4), gCore), hl = soft ? new THREE.Sprite(gHalo) : new THREE.Mesh(glowGeo('glow:halo', 0.15, 8, 5), gHalo);
    if (soft) hl.scale.set(0.42, 0.42, 0.42);
    c.renderOrder = hl.renderOrder = 5; c.userData.glow = hl.userData.glow = true;
    gg.add(c, hl); gg.visible = false; parent.add(gg);
    return gg;
  };
  const glow = mkGlow(rig.prop && cfg.glowAt ? rig.prop : hand[1]);
  if (rig.prop && cfg.glowAt) glow.position.set(cfg.glowAt[0], cfg.glowAt[1], cfg.glowAt[2]); else glow.position.set(0, -0.02, 0.03);
  const glowL = rig.prop && cfg.glowAt ? null : mkGlow(hand[0]);
  if (glowL) glowL.position.set(0, -0.02, 0.03);

  let meshes = 0, tris = 0;
  rootG.traverse(o => { if (o.isMesh && o.material !== gCore && o.material !== gHalo) { meshes++; tris += o.geometry.index ? (o.geometry.index.count || o.geometry.index.length) / 3 : 0; } });
  const St = newState();
  let gK = 0, gC = glowCol;
  const h = {
    root: rootG, kind, seed, glow, height: K.top * cfg.scale, meshes, tris, palette: pal, rig, state: St, materials: mats,
    setGlow(k, col) { gK = clamp01(+k || 0); if (col != null) gC = col; apply(gK, 0); },
    anim(dt, o) {
      o = o || {};
      const L = pose(rig, St, o, dt, cfg);
      const u = U.hvL.value; u.x = L[0]; u.y = L[1]; u.z = L[2]; u.w = L[3];
      if (swordHand) {
        if ((+o.attack || 0) > 0) St.draw = 1.4; else St.draw = Math.max(0, St.draw - (dt || 0));
        swordHand.visible = St.draw > 0; swordHip.visible = !swordHand.visible;
      }
      const atkGlow = (kind === 'wizard' || kind === 'dragonkin') ? Math.sin(Math.PI * clamp01(+o.attack || 0)) : 0;
      apply(Math.max(gK, clamp01(+o.cast || 0), atkGlow), clamp01(+o.cast || 0));
    },
    dispose() {
      if (rootG.parent) rootG.parent.remove(rootG);
      mats.forEach(m => m.dispose());
    },
  };
  function apply(k, castK) {
    const on = k > 0.01;
    glow.visible = on;
    if (glowL) glowL.visible = on && castK > 0.05;
    if (!on) return;
    const fl = 1 + Math.sin(St.t * 23) * 0.06 + Math.sin(St.t * 37) * 0.04;
    if (gCore.color && gCore.color.setHex) { gCore.color.setHex(gC); gHalo.color.setHex(gC); }
    gCore.opacity = Math.min(1, 0.45 + k * 0.7); gHalo.opacity = 0.25 + 0.4 * k;
    const s = (0.55 + 0.7 * k) * fl;
    glow.scale.set(s, s, s);
    if (glowL) glowL.scale.set(s * 0.85, s * 0.85, s * 0.85);
  }
  return h;
}

/* ---------- crowds: one InstancedMesh per body template and per limb ---------- */
/* column-major 4x4 helpers (same layout as THREE.Matrix4.elements) */
function m4(out, px, py, pz, rx, ry, rz, s) {
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  out[0] = c * e * s; out[4] = -c * f * s; out[8] = d * s;
  out[1] = (af + be * d) * s; out[5] = (ae - bf * d) * s; out[9] = -b * c * s;
  out[2] = (bf - ae * d) * s; out[6] = (be + af * d) * s; out[10] = a * c * s;
  out[3] = 0; out[7] = 0; out[11] = 0; out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
  return out;
}
function mmul(out, A, B) {
  const t = mmul.t;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) t[j * 4 + i] = A[i] * B[j * 4] + A[4 + i] * B[j * 4 + 1] + A[8 + i] * B[j * 4 + 2] + A[12 + i] * B[j * 4 + 3];
  for (let k = 0; k < 16; k++) out[k] = t[k];
  return out;
}
mmul.t = new Float64Array(16);
const rec = (x, y, z) => ({ position: { x: x || 0, y: y || 0, z: z || 0 }, rotation: { x: 0, y: 0, z: 0 } });
const local = (out, o) => m4(out, o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, 1);

const CROWD_TEMPLATES = [
  { f: false, hat: 'hat', apron: false, basket: false }, { f: false, hat: 'hood', apron: true, basket: false },
  { f: false, hat: 'none', apron: false, basket: false }, { f: false, hat: 'cap', apron: true, basket: false },
  { f: true, hat: 'kerchief', apron: true, basket: false }, { f: true, hat: 'none', apron: false, basket: true },
  { f: true, hat: 'hood', apron: false, basket: false }, { f: true, hat: 'kerchief', apron: false, basket: true },
];
function crowdBody(K, kind) {
  const P = K.parts, B = new Bld();
  B.add(P.hips);
  B.add(P.chest, XF.T(0, D.CHEST, 0));
  B.add(P.head, XF.T(0, D.CHEST + D.NECK, 0));
  if (P.basket) B.add(P.basket, XF.T(0.25, -0.02, 0.03));
  void kind;
  return B;
}
function crowd(n, opts) {
  opts = opts || {};
  n = Math.max(0, n | 0);
  const kinds = (opts.kinds && opts.kinds.length ? opts.kinds : ['citizen']).filter(k => k === 'citizen' || k === 'guard');
  if (!kinds.length) kinds.push('citizen');
  const seed = (opts.seed >>> 0) || 1, r = rng(seed), share = opts.guardShare == null ? 0.15 : opts.guardShare;
  const detail = 'low';
  // body templates: up to 6 citizen templates chosen by the seed, plus the guard
  const order = CROWD_TEMPLATES.map((t, i) => [r(), i]).sort((a, b) => a[0] - b[0]).slice(0, 6).map(x => CROWD_TEMPLATES[x[1]]);
  const members = [];
  for (let i = 0; i < n; i++) {
    const g = kinds.indexOf('citizen') < 0 || (kinds.indexOf('guard') >= 0 && r() < share);
    const ms = (r() * 4294967296) >>> 0;
    const tpl = g ? -1 : Math.floor(r() * order.length);
    const desc = g ? { weapon: 'halberd' } : order[tpl];
    const K = kindData(g ? 'guard' : 'citizen', desc, detail);
    const pal = palette(g ? 'guard' : 'citizen', ms);
    const cfg = Object.assign({}, K.cfg, { rigid: true });
    cfg.scale *= 0.95 + rng(ms ^ 0x1234567)() * 0.09;
    members.push({ g, tpl, K, pal, cfg, st: newState(), x: 0, y: 0, z: 0, yaw: 0, speed: 0, rig: null, mats: {} });
    members[i].st.ph = r() * TAU; members[i].st.t = r() * 10;
  }
  const mat = hvMaterial(false, true);
  const group = new THREE.Group();
  const ims = [];
  const IMA = (count, itemSize) => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * itemSize), itemSize);
  function mkIM(bld, count) {
    const g = bld.build();
    for (const nm of ['hvIA', 'hvIB', 'hvIC', 'hvID']) g.setAttribute(nm, IMA(count, 3));
    g.setAttribute('hvIL', IMA(count, 4));
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, count));
    im.count = count;
    im.frustumCulled = false;
    if (im.instanceMatrix && im.instanceMatrix.setUsage && THREE.DynamicDrawUsage) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(im); ims.push(im);
    return im;
  }
  const bodies = new Map();
  members.forEach(m => { const key = m.K.key; if (!bodies.has(key)) bodies.set(key, { K: m.K, list: [] }); m.bi = bodies.get(key).list.length; bodies.get(key).list.push(m); });
  for (const b of bodies.values()) { b.im = mkIM(crowdBody(b.K), b.list.length); b.list.forEach(m => { m.body = b.im; }); }
  const anyC = members.find(m => !m.g), anyG = members.find(m => m.g), ref = (anyC || anyG || { K: kindData('citizen', CROWD_TEMPLATES[0], detail) }).K;
  // limbs: citizen limb geometry for everyone (guards share it: mail-grey colours come through the palette slots)
  const upIM = mkIM(ref.parts.upper, 2 * n), foIM = mkIM(ref.parts.fore, 2 * n), thIM = mkIM(ref.parts.thigh, 2 * n), shIM = mkIM(ref.parts.shin, 2 * n);
  const guards = members.filter(m => m.g);
  const hbIM = guards.length ? mkIM(kindData('guard', { weapon: 'halberd' }, detail).parts.prop, guards.length) : null;
  guards.forEach((m, i) => { m.hb = i; });
  // per-instance colours (guards: red tabard body, mail-grey sleeves and dark hose)
  const put3 = (im, i, hex) => { const at = im.geometry.attributes; return (nm, h) => { const c = rgb(h), a = at[nm].array; a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; at[nm].needsUpdate = true; }; };
  const colour = (im, i, A, Bc, C, Dk) => { const p = put3(im, i); p('hvIA', A); p('hvIB', Bc); p('hvIC', C); p('hvID', Dk); };
  members.forEach((m, i) => {
    const p = m.pal;
    colour(m.body, m.bi, p.main, p.trim, p.hair, p.skin);
    for (const s of [0, 1]) {
      colour(upIM, 2 * i + s, m.g ? 0x7c838c : p.main, p.trim, p.hair, p.skin);
      colour(foIM, 2 * i + s, m.g ? 0x7c838c : p.main, p.trim, p.hair, p.skin);
      colour(thIM, 2 * i + s, p.main, m.g ? 0x3b3a40 : p.trim, p.hair, p.skin);
      colour(shIM, 2 * i + s, p.main, m.g ? 0x3b3a40 : p.trim, p.hair, p.skin);
    }
    if (m.g) colour(hbIM, m.hb, p.main, p.trim, p.hair, p.skin);
    m.rig = { hips: rec(0, D.HIP, 0), chest: rec(0, D.CHEST, 0), head: null, sh: [rec(D.SHX, D.SHY, 0), rec(-D.SHX, D.SHY, 0)], el: [rec(0, -D.UP, 0), rec(0, -D.UP, 0)],
      leg: [rec(D.LEGX, D.LEGY, 0), rec(-D.LEGX, D.LEGY, 0)], kn: [rec(0, -D.TH, 0), rec(0, -D.TH, 0)], prop: m.g ? rec(D.GRIP[0], D.GRIP[1], D.GRIP[2]) : null };
    if (m.g) { m.cfg.prop = 'halberd'; m.cfg.propArm = 0.3; }
  });
  const M = { root: new Float64Array(16), hips: new Float64Array(16), chest: new Float64Array(16), a: new Float64Array(16), b: new Float64Array(16), l: new Float64Array(16) };
  const write = (im, i, src) => { const arr = im.instanceMatrix.array; for (let k = 0; k < 16; k++) arr[i * 16 + k] = src[k]; };
  function update(dt) {
    for (let i = 0; i < n; i++) {
      const m = members[i], R = m.rig;
      const L = pose(R, m.st, { speed: m.speed }, dt, m.cfg);
      const la = m.body.geometry.attributes.hvIL.array; la[m.bi * 4] = L[0]; la[m.bi * 4 + 1] = L[1]; la[m.bi * 4 + 2] = L[2]; la[m.bi * 4 + 3] = L[3];
      m4(M.root, m.x, m.y, m.z, 0, m.yaw, 0, m.cfg.scale);
      mmul(M.hips, M.root, local(M.l, R.hips));
      write(m.body, m.bi, M.hips);
      mmul(M.chest, M.hips, local(M.l, R.chest));
      for (let s = 0; s < 2; s++) {
        mmul(M.a, M.chest, local(M.l, R.sh[s])); write(upIM, 2 * i + s, M.a);
        mmul(M.b, M.a, local(M.l, R.el[s])); write(foIM, 2 * i + s, M.b);
        if (s === 1 && m.g) { mmul(M.a, M.b, local(M.l, R.prop)); write(hbIM, m.hb, M.a); }
        mmul(M.a, M.hips, local(M.l, R.leg[s])); write(thIM, 2 * i + s, M.a);
        mmul(M.b, M.a, local(M.l, R.kn[s])); write(shIM, 2 * i + s, M.b);
      }
    }
    for (const im of ims) { im.instanceMatrix.needsUpdate = true; if (im.geometry.attributes.hvIL) im.geometry.attributes.hvIL.needsUpdate = true; }
  }
  let tris = 0;
  for (const im of ims) tris += (im.geometry.index.count || im.geometry.index.length) / 3 * im.count;
  update(0);
  return {
    group, count: n, drawCalls: ims.length, tris, kinds: members.map(m => (m.g ? 'guard' : 'citizen')),
    set(i, x, y, z, yaw, speed) { const m = members[i]; if (!m) return; m.x = +x || 0; m.y = +y || 0; m.z = +z || 0; m.yaw = +yaw || 0; m.speed = Math.max(0, +speed || 0); },
    update,
    dispose() {
      if (group.parent) group.parent.remove(group);
      for (const im of ims) { im.geometry.dispose(); if (im.dispose) im.dispose(); }
      mat.dispose();
    },
  };
}

/* ---------- shapeshift shimmer: a swirl of sparkles (one Points draw call) ---------- */
const dotTex = {};
function dot(soft) {
  const k = soft ? 's' : 'd';
  if (dotTex[k] || typeof document === 'undefined' || !document.createElement || !THREE.CanvasTexture) return dotTex[k] || null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(soft ? 0.12 : 0.25, soft ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.8)'); g.addColorStop(soft ? 0.45 : 1, soft ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  if (!soft) { x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(30, 4, 4, 56); x.fillRect(4, 30, 56, 4); }
  dotTex[k] = new THREE.CanvasTexture(c);
  return dotTex[k];
}
function shimmer(scene) {
  const N = 220, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const P = [];
  for (let i = 0; i < N; i++) P.push({ age: 1, life: 1, a: 0, r: 0, y: 0, w: 0, vr: 0, vy: 0, c: [1, 1, 1], d: 0 });
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 3);
  if (pa.setUsage && THREE.DynamicDrawUsage) { pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage); }
  g.setAttribute('position', pa); g.setAttribute('color', ca);
  const mat = new THREE.PointsMaterial({ size: 0.14, map: dot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 6;
  if (scene) scene.add(pts);
  let alive = 0, rr = rng(0xabcdef);
  return {
    root: pts,
    play(p, hex) {
      if (p) pts.position.set(p.x || 0, p.y || 0, p.z || 0);
      const base = rgb(hex == null ? 0x7dffb0 : hex);
      for (const q of P) {
        q.age = 0; q.d = rr() * 0.3; q.life = 0.7 + rr() * 0.8;
        q.a = rr() * TAU; q.r = 0.25 + rr() * 0.75; q.y = rr() * 2.1; q.w = (3 + rr() * 5) * (rr() < 0.85 ? 1 : -1);
        q.vr = -0.25 + rr() * 0.9; q.vy = 0.3 + rr() * 1.2;
        const wk = rr() * 0.6; q.c = [lerp(base[0], 1, wk), lerp(base[1], 1, wk), lerp(base[2], 1, wk)];
      }
      alive = 1; pts.visible = true;
    },
    update(dt) {
      if (!alive) return;
      dt = Math.max(0, Math.min(+dt || 0, 0.1));
      let any = false;
      for (let i = 0; i < N; i++) {
        const q = P[i];
        q.age += dt;
        const t = q.age - q.d;
        let k = 0;
        if (t > 0 && t < q.life) {
          any = true;
          q.a += q.w * dt; q.r = Math.max(0.03, q.r + q.vr * dt * (t < q.life * 0.5 ? 1 : -1.6)); q.y += q.vy * dt;
          const u = t / q.life; k = Math.sin(Math.PI * u) * (0.7 + 0.3 * Math.sin(t * 40 + i));
        } else if (t <= 0) any = true;
        pos[i * 3] = Math.cos(q.a) * q.r; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = Math.sin(q.a) * q.r;
        col[i * 3] = q.c[0] * k; col[i * 3 + 1] = q.c[1] * k; col[i * 3 + 2] = q.c[2] * k;
      }
      pa.needsUpdate = true; ca.needsUpdate = true;
      if (!any) { alive = 0; pts.visible = false; }
    },
    dispose() { if (pts.parent) pts.parent.remove(pts); g.dispose(); mat.dispose(); },
  };
}

root.VHuman = { KINDS, make, crowd, shimmer, pose, palette, variant, D, _cache: { bld: bldCache, geo: geoCache } };
})(typeof self !== 'undefined' ? self : this);
