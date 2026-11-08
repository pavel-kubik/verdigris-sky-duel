/*
 * Verdigris campaign - castle layout (Phase 3 T01) and castle solids (T03, 003 spec 5.2).
 * Pure: no DOM, no THREE.
 *   castle.layout(def?) -> { corners, segments, buildings, centre, radius, gate }
 *     def = data.settlements.castle (default). Local frame: +X = east, +Z = north, origin = the castle centre.
 *     corners[i]  = { type, x, z, yaw, r }        the piece at walls[i]; yaw points outward (away from the centroid)
 *     segments[i] = { a: [x, z], b: [x, z], len, yaw, gate, from, to }   wall runs between the corner pieces,
 *                   shortened by each corner's radius; yaw = direction a -> b (atan2(dx, dz)); gate = the gate gap
 *                   (between two gatehouses) - a gate segment is the portcullis gap of data.castle.gate.w plus wall
 *                   stubs on each side
 *     buildings[] = { type, x, z, yaw, r, h }     inner buildings, facing the gate side (+X)
 *     segments also carry h and walkTop (data.buildings.wall); gate = { a, b, w, seg } the portcullis gap (local frame)
 *   castle.pieces(def?) -> [{ type, x, z, r, h, seg?, gate?, inner? }]   T03: the solids of the castle in its local frame:
 *     corner pieces and inner buildings (cylinders), wall runs (seg [x0, z0, x1, z1], capsules of wallThick / 2;
 *     the gate run becomes two stubs and a 'portcullis' piece with gate: true, solid only while the gate is closed)
 *   castle.closeGate(town) / openGate(town)    T03: town.gateClosed (the portcullis is a solid while it is set)
 *   castle.gateOpen(town) -> bool
 *   T05: castle.posts(town, place) -> archer posts (towers, gatehouses, wall walks) in fill order;
 *   castle.step(squad, { pos, pad, inside }, dt) -> events   alarm -> gate drops (never on a dragon in the gap), search
 *   over -> gate opens, the keep's horn alerts every defender of the region once per horn.cool, town.signal (signal fire);
 *   castle.inGap(town, pos, pad), castle.blowHorn(squad, o) (debug).
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');

  function layout(def) {
    def = def || D.settlements.castle;
    const W = def.walls, n = W.length;
    let cx = 0, cz = 0;
    for (const [x, z] of W) { cx += x / n; cz += z / n; }
    const corners = W.map(([x, z], i) => {
      const type = def.corners[i], B = D.buildings[type];
      return { type, x, z, yaw: Math.atan2(x - cx, z - cz), r: B.r };
    });
    const segments = [];
    for (let i = 0; i < n; i++) {
      const c0 = corners[i], c1 = corners[(i + 1) % n];
      const dx = c1.x - c0.x, dz = c1.z - c0.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      const a = [c0.x + ux * c0.r * 0.8, c0.z + uz * c0.r * 0.8], b = [c1.x - ux * c1.r * 0.8, c1.z - uz * c1.r * 0.8];
      const gate = !!(D.buildings[c0.type].gate && D.buildings[c1.type].gate);
      segments.push({ a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), yaw: Math.atan2(ux, uz), gate, from: i, to: (i + 1) % n,
                      h: D.buildings.wall.h, walkTop: D.buildings.wall.walkTop });
    }
    let gateGap = null;
    segments.forEach((s, i) => {
      if (!s.gate) return;
      const w = Math.min(D.castle.gate.w, s.len), mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
      const ux = (s.b[0] - s.a[0]) / s.len, uz = (s.b[1] - s.a[1]) / s.len;
      gateGap = { a: [mx - ux * w / 2, mz - uz * w / 2], b: [mx + ux * w / 2, mz + uz * w / 2], w, seg: i };
    });
    const buildings = def.buildings.map(([type, x, z]) => {
      const B = D.buildings[type];
      return { type, x, z, yaw: Math.PI / 2, r: B.r, h: B.h };
    });
    let radius = 0;
    for (const c of corners) radius = Math.max(radius, Math.hypot(c.x - cx, c.z - cz) + c.r);
    return { corners, segments, buildings, centre: [cx, cz], radius, gate: gateGap };
  }

  /** T03: solid pieces in the local frame (see the header). */
  function pieces(def) {
    const L = layout(def), out = [], C = D.castle, wr = C.wallThick / 2, Wb = D.buildings.wall;
    for (const c of L.corners) out.push({ type: c.type, x: c.x, z: c.z, r: c.r, h: D.buildings[c.type].h });
    const run = (type, a, b, extra) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) return;
      out.push(Object.assign({ type, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, r: wr, h: D.buildings[type].h,
                               seg: [a[0], a[1], b[0], b[1]], len }, extra || {}));
    };
    L.segments.forEach((s, i) => {
      if (L.gate && L.gate.seg === i) {
        run('wall', s.a, L.gate.a);
        run('portcullis', L.gate.a, L.gate.b, { gate: true });
        run('wall', L.gate.b, s.b);
      } else run('wall', s.a, s.b);
    });
    for (const b of L.buildings) out.push({ type: b.type, x: b.x, z: b.z, r: b.r, h: b.h, inner: true });
    return out;
  }

  function closeGate(town) { if (town) { town.gateClosed = true; town.gateK = 1; town.gateHold = true; } return town; }
  function openGate(town) { if (town) { town.gateClosed = false; town.gateK = 0; town.gateHold = true; } return town; }
  const gateOpen = town => !(town && town.gateClosed);

  /** Inside test for the wall polygon (local frame). */
  function inside(def, x, z) {
    const W = (def || D.settlements.castle).walls;
    let inn = false;
    for (let i = 0, j = W.length - 1; i < W.length; j = i++) {
      const [xi, zi] = W[i], [xj, zj] = W[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inn = !inn;
    }
    return inn;
  }

  /** T04: castle LOD for a camera distance: 'full' (the kit) | 'sil' (merged silhouette) | 'off' (beyond the fog),
   *  with a +-lod.band hysteresis around the current level so the swap does not flicker on the line. */
  function lodFor(dist, cur) {
    const L = D.castle.lod, band = L.band || 0;
    const nearIn = cur === 'full' ? L.near + band : L.near - band;
    const farIn = cur === 'off' ? L.far - band : L.far + band;
    if (dist < nearIn) return 'full';
    if (dist < farIn) return 'sil';
    return 'off';
  }

  /* ---- T05: defenders' posts, the gate on alarm, the keep's horn ---- */

  /** Outward unit vector of a wall run b (world seg) for a castle place: away from the place centre. */
  function outward(b, pl) {
    const [x0, z0, x1, z1] = b.seg, vx = x1 - x0, vz = z1 - z0, l = Math.hypot(vx, vz) || 1;
    let nx = vz / l, nz = -vx / l;
    const mx = (x0 + x1) / 2 - pl.x, mz = (z0 + z1) / 2 - pl.z;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  }

  /** Archer posts of a castle place (T05), in fill order: the round towers, the gatehouses (posts.gatehouse each),
   *  then the wall walks (one slot every posts.wallEvery units of a run, runs shorter than posts.wallMin get none),
   *  the wall slots dealt round robin over the runs so a few archers spread over the whole wall.
   *  -> [{ building, x, y, z, yaw }]   (x, z) where the archer stands, y = its eye, yaw = outward. */
  function posts(town, pl) {
    const P = D.castle.posts, eye = D.perception.watch.eye, out = [];
    if (!town || !pl) return out;
    const own = town.buildings.filter(b => b.place === pl.id);
    const yawOut = (x, z) => Math.atan2(x - pl.x, z - pl.z);
    for (const b of own) {
      if (b.type !== 'ctower') continue;
      const a = yawOut(b.pos[0], b.pos[2]), r = b.r + P.towerOut;     // on the parapet, under the eaves of the cone
      out.push({ building: b.id, x: b.pos[0] + Math.sin(a) * r, y: b.pos[1] + b.h + P.towerUp + eye, z: b.pos[2] + Math.cos(a) * r, yaw: a });
    }
    for (const b of own) {
      if (b.type !== 'gatehouse') continue;
      const a = yawOut(b.pos[0], b.pos[2]), r = b.r * 0.8 + P.gateOut, n = P.gatehouse;
      for (let k = 0; k < n; k++) {
        const s = (k - (n - 1) / 2) * P.gateSpacing;
        out.push({ building: b.id, x: b.pos[0] + Math.sin(a) * r + Math.cos(a) * s, y: b.pos[1] + b.h + P.gateUp + eye,
                   z: b.pos[2] + Math.cos(a) * r - Math.sin(a) * s, yaw: a });
      }
    }
    const runs = own.filter(b => b.type === 'wall' && b.seg && b.len >= P.wallMin)
      .sort((a, b) => yawOut(a.pos[0], a.pos[2]) - yawOut(b.pos[0], b.pos[2]))
      .map(b => {
        const n = Math.max(1, Math.floor(b.len / P.wallEvery)), [nx, nz] = outward(b, pl), [x0, z0, x1, z1] = b.seg, slots = [];
        for (let i = 0; i < n; i++) {
          const k = (i + 0.5) / n, x = x0 + (x1 - x0) * k + nx * P.wallOut, z = z0 + (z1 - z0) * k + nz * P.wallOut;
          slots.push({ building: b.id, x, y: b.pos[1] + D.buildings.wall.walkTop + eye, z, yaw: Math.atan2(nx, nz) });
        }
        // the middle slot first, then outward from it (one archer stands mid-wall)
        const mid = Math.floor((n - 1) / 2), order = [];
        for (let d = 0; order.length < n; d++) { if (mid + d < n) order.push(slots[mid + d]); if (d && mid - d >= 0) order.push(slots[mid - d]); }
        return order;
      });
    for (let i = 0, more = true; more; i++) {
      more = false;
      for (const r of runs) if (i < r.length) { out.push(r[i]); more = true; }
    }
    return out;
  }

  /** The dragon is in the portcullis gap (under the lintel) - the gate must not drop on it. */
  function inGap(town, pos, pad) {
    if (!town || !pos) return false;
    const g = town.buildings.find(b => b.gate && b.type === 'portcullis');
    if (!g) return false;
    const [x0, z0, x1, z1] = g.seg, vx = x1 - x0, vz = z1 - z0, l2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((pos[0] - x0) * vx + (pos[2] - z0) * vz) / l2));
    const d = Math.hypot(pos[0] - (x0 + vx * k), pos[2] - (z0 + vz * k));
    return d <= D.castle.wallThick / 2 + (pad || 0) + D.castle.gate.margin && pos[1] - g.pos[1] < D.buildings.portcullis.h + (pad || 0);
  }

  /** T05: castle alarm, gate and horn, once per frame from defenders.step.
   *  sq = the squad (sq.list defenders, sq.horn { place: cool s }), o = { pos (dragon or null), pad, inside }.
   *  Per castle place: alarmed = a live defender of it is 'alert' or 'search'. The gate (town.gateK 0 open .. 1 shut)
   *  drops over gate.close s while alarmed, waits while the dragon is in the gap, and is a solid (town.gateClosed) once
   *  down; when the search is over it opens (no longer a solid at once, the grate rises over gate.close s).
   *  The keep's horn (a standing building with horn) sounds when a castle defender is 'alert' and its cooldown is over:
   *  every live defender of the region turns alert toward the dragon; then horn.cool s until it can sound again.
   *  town.signal = the red signal fire on the keep (while alarmed). town.gateHold (debug toggle) pauses the gate until
   *  the alarm changes. Events: 'gate:closing' | 'gate:closed' | 'gate:open' { place }, 'horn:blow' { place, pos }. */
  function step(sq, o, dt) {
    const out = [], town = sq && sq.town;
    if (!town) return out;
    const G = D.castle.gate, H = D.castle.horn, PC = D.perception;
    sq.horn = sq.horn || {};
    for (const k in sq.horn) sq.horn[k] = Math.max(0, sq.horn[k] - dt);
    for (const pl of town.places) {
      if (!pl.castle) continue;
      let alarmed = false, alert = false;
      for (const d of sq.list) if (d.alive && d.place === pl.id) {
        if (d.state === 'alert') alert = alarmed = true;
        else if (d.state === 'search') alarmed = true;
      }
      const keep = town.buildings.find(b => b.place === pl.id && D.buildings[b.type].horn && !b.ruin);
      if (alert && keep && !(sq.horn[pl.id] > 0)) {
        sq.horn[pl.id] = H.cool;
        const at = [keep.pos[0], keep.pos[1] + keep.h, keep.pos[2]];
        out.push({ e: 'horn:blow', place: pl.id, pos: at });
        for (const d of sq.list) {
          if (!d.alive || d.hidden) continue;
          d.aware = PC.alert; d.search = 0;
          if (o && o.pos && !o.inside) d.focus = o.pos.slice();
          if (d.state !== 'alert') { out.push({ e: 'aware:state', id: d.id, kind: d.kind, place: d.place, state: 'alert', from: d.state, horn: true }); d.state = 'alert'; }
        }
        alarmed = true;
      }
      town.signal = alarmed;
      if (town.gateAlarm !== alarmed) { if (town.gateAlarm != null) town.gateHold = false; town.gateAlarm = alarmed; }
      if (town.gateHold) continue;
      const k0 = town.gateK || 0;
      if (alarmed) {
        if (town.gateClosed) { town.gateK = 1; continue; }
        if (o && o.pos && inGap(town, o.pos, o.pad)) continue;            // never on a dragon in the gap: wait
        if (k0 === 0) out.push({ e: 'gate:closing', place: pl.id });
        town.gateK = Math.min(1, k0 + dt / G.close);
        if (town.gateK >= 1) { town.gateClosed = true; out.push({ e: 'gate:closed', place: pl.id }); }
      } else if (k0 > 0 || town.gateClosed) {
        if (town.gateClosed) { town.gateClosed = false; out.push({ e: 'gate:open', place: pl.id }); }
        town.gateK = Math.max(0, k0 - dt / G.close);
      }
    }
    return out;
  }

  /** Debug / scripted: sound the horn of the town's castle now (cooldown ignored). */
  function blowHorn(sq, o) {
    if (sq) sq.horn = {};
    const pl = sq && sq.town && sq.town.places.find(p => p.castle);
    if (!pl) return [];
    for (const d of sq.list) if (d.alive && d.place === pl.id && !d.hidden) { d.state = 'alert'; d.aware = D.perception.alert; if (o && o.pos) d.focus = o.pos.slice(); }
    return step(sq, o, 0);
  }

  M.define('castle', { lodFor, layout, inside, pieces, closeGate, openGate, gateOpen, posts, inGap, step, blowHorn, outward });
})(typeof window !== 'undefined' ? window : globalThis);
