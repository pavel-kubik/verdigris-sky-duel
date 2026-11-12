/*
 * Verdigris Sky Duel - the living forest: trees a dragon can knock down and set on fire. One set of rules for the
 * campaign, the co-op and the deathmatch (and the solo duel). Pure: no DOM, no THREE; runs in the browser
 * (window.VForest) and in Node (tests). The renderer is shared/forest-view.js.
 *
 *   create(trees, opts) -> F      trees: [{ x, y, z, r, h, kind }] (y = ground, r = crown radius, h = height;
 *                                 yaw, sc, sy, tint: how the renderer draws it)
 *   hit(F, pos, rad, vel)         a dragon's body at pos [x, y, z]: fells every standing tree it touches
 *   heat(F, from, dir, range, cosHalf, dt)   fire breath: trees in the cone heat up and catch fire
 *   blast(F, pos, radius)         a fireball bursting: every tree within radius catches fire
 *   step(F, dt)                   fires burn, spread (RULES.spread hops, the same in every browser), burn out; felled
 *                                 and burnt trees grow back after RULES.regrow s
 *   apply(F, ev)                  a 'fell' / 'ignite' event from another browser (or a late joiner's snapshot)
 *   snapshot(F) / restore(F, s)   compact state for a player who joins later
 *   reset(F)                      every tree standing again
 *   scatter(opts, H)              seeded tree places on a height field (the duel world: DUEL)
 * hit / heat / blast / step return events [{ e: 'fell', i, dx, dz } | { e: 'ignite', i, g } | { e: 'burnt', i } |
 * { e: 'regrow', i }]; 'fell' and 'ignite' with g = 0 are the ones to send to the other players.
 * Tree state: st 0 standing, 1 felled; fire 0 none, 1 burning, 2 burnt (a charred snag or log).
 * RULES.jolt: what flying into a tree does to the dragon, the same in every mode: it keeps `slow` of its speed and
 * takes `dmg` damage (the tree breaks, the dragon does not fall).
 */
(function (root) {
  'use strict';
  const RULES = {
    cell: 24,
    crownK: 0.72,                 // a crown is solid within r x crownK of the trunk, from the ground to the top
    jolt: { slow: 0.55, dmg: 4, cool: 0.35 },
    igniteHeat: 0.3,              // s of breath on a tree before it catches fire
    cool: 0.6,                    // heat lost per s when not breathed on
    burn: [9, 15],                // s a tree burns (per tree, seeded)
    spread: { hops: 2, gap: 5, delay: [2.5, 6], chance: 0.6 },
    regrow: 150,                  // s until a felled or burnt tree stands again (0 = never)
    growTime: 4,
  };
  const hash = (a, b) => {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function create(trees, opts) {
    const R = Object.assign({}, RULES, opts || {});
    const F = { rules: R, list: [], cells: new Map(), burning: new Set(), down: new Set(), changed: [], t: 0 };
    (trees || []).forEach((s, i) => {
      const t = { i, x: s.x, y: s.y, z: s.z, r: s.r, h: s.h, kind: s.kind || 0, yaw: s.yaw || 0, sc: s.sc || 1, sy: s.sy || 1, tint: s.tint || 0, st: 0, fire: 0, heat: 0, ft: 0, bt: 0, dt: 0, g: 0, dx: 0, dz: 1, at: 0,
        burnFor: R.burn[0] + (R.burn[1] - R.burn[0]) * hash(i, 7) };
      F.list.push(t);
      const k = Math.floor(t.x / R.cell) + ',' + Math.floor(t.z / R.cell);
      if (!F.cells.has(k)) F.cells.set(k, []);
      F.cells.get(k).push(t);
    });
    return F;
  }
  /** Calls fn(tree) for trees whose cell is within rad of (x, z). */
  function near(F, x, z, rad, fn) {
    const c = F.rules.cell, i0 = Math.floor((x - rad) / c), i1 = Math.floor((x + rad) / c), j0 = Math.floor((z - rad) / c), j1 = Math.floor((z + rad) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = F.cells.get(i + ',' + j);
      if (list) for (const t of list) fn(t);
    }
  }
  function mark(F, t) { F.changed.push(t.i); }
  function fell(F, t, dx, dz, ev) {
    if (t.st !== 0) return false;
    const l = Math.hypot(dx, dz);
    t.st = 1; t.ft = 0; t.dt = 0; t.dx = l > 1e-6 ? dx / l : 0; t.dz = l > 1e-6 ? dz / l : 1; t.at = F.t;
    F.down.add(t.i); mark(F, t);
    if (ev) ev.push({ e: 'fell', i: t.i, dx: Math.round(t.dx * 100) / 100, dz: Math.round(t.dz * 100) / 100 });
    return true;
  }
  function ignite(F, t, g, ev) {
    if (t.fire !== 0) return false;
    t.fire = 1; t.bt = 0; t.g = g || 0; t.heat = 0; t.spread = false;
    F.burning.add(t.i); F.down.add(t.i); mark(F, t);
    if (ev) ev.push({ e: 'ignite', i: t.i, g: t.g });
    return true;
  }

  /** The dragon's body (a sphere of radius rad at pos, moving with vel) against the standing trees. */
  function hit(F, pos, rad, vel) {
    const ev = [], K = F.rules.crownK;
    near(F, pos[0], pos[2], rad + 12, t => {
      if (t.st !== 0) return;
      const dx = pos[0] - t.x, dz = pos[2] - t.z, d = Math.hypot(dx, dz);
      const reach = (t.fire === 2 ? Math.min(t.r, 1.2) : t.r * K) + rad * 0.5;      // a burnt snag is only its trunk
      if (d >= reach || pos[1] > t.y + t.h + rad * 0.3 || pos[1] < t.y - rad) return;
      const sp = vel ? Math.hypot(vel[0], vel[2]) : 0;
      if (sp > 0.5) fell(F, t, vel[0], vel[2], ev);
      else fell(F, t, -dx, -dz, ev);
    });
    return ev;
  }
  /** Fire breath: from [x, y, z] along the unit dir, `range` long, cosHalf = cos of the cone's half angle. */
  function heat(F, from, dir, range, cosHalf, dt) {
    const ev = [], mx = from[0] + dir[0] * range * 0.5, mz = from[2] + dir[2] * range * 0.5;
    near(F, mx, mz, range * 0.5 + 12, t => {
      if (t.fire !== 0) return;
      const cy = t.st === 0 ? t.y + t.h * 0.6 : t.y + 1;
      const vx = t.x - from[0], vy = cy - from[1], vz = t.z - from[2], d = Math.hypot(vx, vy, vz);
      if (d > range + t.r) return;
      const along = vx * dir[0] + vy * dir[1] + vz * dir[2];
      if (along < -t.r) return;
      const perp = Math.sqrt(Math.max(0, d * d - along * along));
      if (d > t.r && along / d < cosHalf && perp > t.r * 0.9 + (t.st === 0 ? t.h * 0.25 : 0)) return;
      t.heat += dt * (1 + F.rules.cool); F.down.add(t.i);          // in the active set, so step() cools it off again
      if (t.heat >= F.rules.igniteHeat) ignite(F, t, 0, ev);
    });
    return ev;
  }
  function blast(F, pos, radius) {
    const ev = [];
    near(F, pos[0], pos[2], radius + 12, t => {
      if (t.fire !== 0) return;
      const d = Math.hypot(t.x - pos[0], t.z - pos[2]);
      if (d < radius + t.r * 0.6 && pos[1] < t.y + t.h + radius && pos[1] > t.y - radius) ignite(F, t, 0, ev);
    });
    return ev;
  }
  function step(F, dt) {
    const ev = [], R = F.rules, S = R.spread;
    F.t += dt;
    for (const i of Array.from(F.down)) {
      const t = F.list[i];
      if (t.heat > 0 && t.fire === 0) t.heat = Math.max(0, t.heat - dt * R.cool);
      if (t.st === 1) t.ft += dt;
      if (t.fire === 1) {
        t.bt += dt;
        if (!t.spread && t.g < S.hops && t.bt >= S.delay[0] + (S.delay[1] - S.delay[0]) * hash(i, 3)) {
          t.spread = true;                                       // the same neighbours in every browser (seeded by the pair)
          near(F, t.x, t.z, t.r + S.gap + 12, n => {
            if (n.i === i || n.fire !== 0) return;
            if (Math.hypot(n.x - t.x, n.z - t.z) > t.r + n.r + S.gap) return;
            if (hash(Math.min(i, n.i) * 7919 + Math.max(i, n.i), 11) < S.chance) ignite(F, n, t.g + 1, ev);
          });
        }
        if (t.bt >= t.burnFor) { t.fire = 2; t.dt = 0; F.burning.delete(i); mark(F, t); ev.push({ e: 'burnt', i }); }
      }
      if (t.fire !== 1 && (t.st === 1 || t.fire === 2)) {
        t.dt += dt;
        if (R.regrow > 0 && t.dt >= R.regrow) {
          t.st = 0; t.fire = 0; t.heat = 0; t.ft = 0; t.bt = 0; t.dt = 0; t.g = 0; t.at = F.t; t.grown = F.t;
          F.down.delete(i); mark(F, t); ev.push({ e: 'regrow', i });
        }
      } else if (t.st === 0 && t.fire === 0 && t.heat <= 0) F.down.delete(i);
    }
    return ev;
  }
  /** An event from another browser. Returns true when it changed a tree. */
  function apply(F, ev) {
    const t = ev && F.list[ev.i];
    if (!t) return false;
    if (ev.e === 'fell') return fell(F, t, +ev.dx || 0, +ev.dz || 0, null);
    if (ev.e === 'ignite') return ignite(F, t, Math.max(0, Math.min(9, ev.g | 0)), null);
    return false;
  }
  /** [[i, st, fire, dx, dz]] of every tree that is not standing unburnt. */
  function snapshot(F) {
    const out = [];
    for (const t of F.list) if (t.st !== 0 || t.fire !== 0) out.push([t.i, t.st, t.fire, Math.round(t.dx * 100) / 100, Math.round(t.dz * 100) / 100]);
    return out;
  }
  function restore(F, snap) {
    reset(F);
    for (const row of Array.isArray(snap) ? snap : []) {
      const t = F.list[row[0]];
      if (!t) continue;
      if (row[1] === 1) { fell(F, t, +row[3] || 0, +row[4] || 0, null); t.ft = 99; }
      if (row[2] === 1) ignite(F, t, F.rules.spread.hops, null);          // already burning: it does not spread again
      else if (row[2] === 2) { t.fire = 2; F.down.add(t.i); mark(F, t); }
    }
  }
  function reset(F) {
    for (const t of F.list) {
      if (t.st !== 0 || t.fire !== 0) mark(F, t);
      t.st = 0; t.fire = 0; t.heat = 0; t.ft = 0; t.bt = 0; t.dt = 0; t.g = 0; t.grown = 0;
    }
    F.burning.clear(); F.down.clear();
  }
  /**
   * Seeded places for a forest on a height field: o = { n, seed, rMax, kinds: [[name, share]] }, H(x, z) -> ground.
   * Dry (above o.low, default 3), below the peaks (o.high, default 46), gentle ground. The same list in every browser.
   * -> [{ x, y, z, kind (name), sc, sy, yaw, tint }]
   */
  function scatter(o, H) {
    let a = o.seed | 0;
    const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const out = [], low = o.low == null ? 3 : o.low, high = o.high == null ? 46 : o.high;
    for (let tries = 0; out.length < o.n && tries < o.n * 40; tries++) {
      const an = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * o.rMax, x = Math.cos(an) * r, z = Math.sin(an) * r, y = H(x, z);
      const k = rnd(), sc = 0.8 + rnd() * 0.7, sy = 0.9 + rnd() * 0.25, yaw = rnd() * Math.PI * 2, tint = rnd();
      if (y < low || y > high || Math.abs(H(x + 3, z) - H(x - 3, z)) + Math.abs(H(x, z + 3) - H(x, z - 3)) > 3.6) continue;
      let acc = 0, kind = o.kinds[0][0];
      for (const kk of o.kinds) { acc += kk[1]; if (k < acc) { kind = kk[0]; break; } }
      out.push({ x, y, z, kind, sc, sy, yaw, tint });
    }
    return out;
  }
  /** The duel world's forest (solo and co-op share the terrain): scatter options, the dragon's body radius, breath [range, half angle in degrees]. */
  const DUEL = { n: 460, seed: 4242, rMax: 720, kinds: [['conifer', 0.45], ['broadleaf', 0.25], ['pine', 0.18], ['birch', 0.12]], body: 2.3, breath: [44, 16], blast: 9 };

  /** Standing trees as [[x, z, r]] (what a pilot can still crash into). */
  function standing(F) { return F.list.filter(t => t.st === 0).map(t => [t.x, t.z, t.r]); }

  const api = { RULES, create, near, hit, heat, blast, step, apply, snapshot, restore, reset, standing, scatter, DUEL, hash };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VForest = api;
})(typeof self !== 'undefined' ? self : this);
