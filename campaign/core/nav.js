/*
 * Verdigris campaign - navigation: compass markers and the dragon's sense of smell (Phase 2 T09).
 *   smellRange(cs) -> units                 data.smell.range x stage spot ^ 0.5, x hungryMult when hungry, x starveMult more when starving
 *   step(cs, dt) -> events[]                smell update every data.smell.update s (cs.nav.scents); nothing in the lair;
 *                                           discovery (T12) every data.nav.discoverEvery s: 'place:discovered' { id, type, region }
 *   seesPlace(regionId, pos, place) -> bool within nav.discover and in line of sight over the terrain
 *   markers(cs) -> [{ kind, key, bearing, dist, label, via?, dim? }]
 *       kind: lair | exit | settlement (discovered ones, T12) | scent | scentLivestock
 *       bearing: world bearing from the dragon (0 = +Z, the yaw convention); the strip subtracts the heading
 *       label: i18n key (+ params) for the tap-to-name tag; via: region id when the lair is reached through an exit
 * Scents: strength = herd size x (1 - distance / range); the strongest data.smell.max herds get a marker.
 * Far out the marker is blurred by a slow drift (up to data.smell.blur rad at full range, 0 inside data.smell.sharp):
 * it moves a little between updates, never jumps (no rng, the drift is a smooth function of the nav clock and the herd).
 * Pure: no DOM, no THREE. See 002_task_kingdom.md 4.7 and 5.7.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), HN = M.need('hunger'), RG = M.need('region');
  const { wrap, clamp } = M.need('math');

  const GONE = { carried: 1, roast: 1, dead: 1 };

  function smellRange(cs) {
    const S = D.smell, st = G.statsOf(cs.dragon.stage), hs = HN.stateOf(cs.dragon.hunger);
    let r = S.range * Math.sqrt(st.spot || 1);
    if (hs !== 'fed') r *= S.hungryMult;
    if (hs === 'starving') r *= S.starveMult;
    return r;
  }

  /** Smooth drift in -1..1 for herd h at nav time t (two slow sines, phase by herd id). */
  function drift(h, t) {
    return 0.7 * Math.sin(t * 0.15 + h * 2.39) + 0.3 * Math.sin(t * 0.06 + h * 1.31 + 0.5);
  }

  /** Herds of the field as smell sources: centre of the members still loose, their count, livestock or not. */
  function sources(field) {
    const out = [];
    if (!field) return out;
    for (const h of field.herds) {
      let n = 0, x = 0, z = 0, type = h.type;
      for (const p of field.list) {
        if (p.herd !== h.id || GONE[p.state] || p.type === 'roast') continue;
        n++; x += p.pos[0]; z += p.pos[2]; type = p.type;
      }
      if (n) out.push({ herd: h.id, type, n, x: x / n, z: z / n, livestock: !!(D.prey[type] && D.prey[type].livestock) });
    }
    return out;
  }

  /** Recomputes cs.nav.scents from the dragon's position now. */
  function sniff(cs) {
    const S = D.smell, nav = cs.nav, p = cs.dragon.pilot, range = smellRange(cs);
    const list = [];
    for (const s of sources(cs.field)) {
      const d = Math.hypot(s.x - p.pos[0], s.z - p.pos[2]);
      if (d >= range) continue;
      const k = clamp((d - S.sharp) / Math.max(1, range - S.sharp), 0, 1);
      list.push({ herd: s.herd, type: s.type, livestock: s.livestock, x: s.x, z: s.z, n: s.n, dist: d,
                  strength: s.n * (1 - d / range), off: S.blur * k * drift(s.herd, nav.t) });
    }
    list.sort((a, b) => b.strength - a.strength);
    nav.scents = list.slice(0, S.max);
    nav.range = range;
  }

  /** A settlement is discovered when the dragon is within nav.discover of it and sees its centre over the terrain. */
  function seesPlace(regionId, pos, pl) {
    const N = D.nav, dx = pl.x - pos[0], dz = pl.z - pos[2];
    if (Math.hypot(dx, dz) > N.discover) return false;
    const ty = (pl.y != null ? pl.y : T.surfaceAt(regionId, pl.x, pl.z)) + N.losEye;
    for (let i = 1; i < N.losSteps; i++) {
      const k = i / N.losSteps, x = pos[0] + dx * k, z = pos[2] + dz * k;
      if (T.surfaceAt(regionId, x, z) > pos[1] + (ty - pos[1]) * k) return false;
    }
    return true;
  }

  function discover(cs) {
    const ev = [], town = cs.town, p = cs.dragon.pilot;
    if (!town || town.region !== cs.region) return ev;
    if (!cs.discovered) cs.discovered = {};
    for (const pl of town.places) {
      if (cs.discovered[pl.id] || !seesPlace(cs.region, p.pos, pl)) continue;
      cs.discovered[pl.id] = true;
      ev.push({ e: 'place:discovered', id: pl.id, type: pl.type, region: cs.region });
    }
    return ev;
  }

  function step(cs, dt) {
    if (!cs.nav) cs.nav = { t: 0, next: 0, scents: [], range: 0, field: null, seeT: 0 };
    const nav = cs.nav;
    if (cs.inLair || !cs.dragon.pilot) return [];
    nav.t += dt;
    nav.next -= dt;
    if (nav.next <= 0 || nav.field !== cs.field) { nav.next = D.smell.update; nav.field = cs.field; sniff(cs); }   // a new region (or prey field) is read at once
    nav.seeT = (nav.seeT || 0) - dt;
    if (nav.seeT > 0) return [];
    nav.seeT = D.nav.discoverEvery;
    return discover(cs);
  }

  /** The exit of `from` on the shortest path to region `to` (breadth first over the exits), or null. */
  function routeExit(from, to) {
    if (from === to) return null;
    const seen = { [from]: true }, queue = [[from, null]];
    while (queue.length) {
      const [id, first] = queue.shift();
      for (const e of T.region(id).exits || []) {
        if (seen[e.to] || !D.regions[e.to]) continue;
        const f = first || e;
        if (e.to === to) return f;
        seen[e.to] = true; queue.push([e.to, f]);
      }
    }
    return null;
  }

  /** Point on the region edge in the middle of an exit arc. */
  function exitPoint(regionId, e) {
    const a = RG.arcMid(e), r = T.region(regionId).radius;
    return [Math.sin(a) * r, Math.cos(a) * r];
  }

  const lairRegion = () => Object.keys(D.regions).find(id => D.regions[id].lair) || null;

  function markers(cs) {
    const p = cs.dragon.pilot, out = [];
    if (!p) return out;
    const x0 = p.pos[0], z0 = p.pos[2];
    const add = (kind, key, x, z, label, extra) => {
      out.push(Object.assign({ kind, key, bearing: Math.atan2(x - x0, z - z0), dist: Math.hypot(x - x0, z - z0), label }, extra || {}));
    };
    // the lair: straight to the mouth, or to the exit on the way home
    const home = lairRegion();
    let via = null;
    if (home === cs.region) { const m = T.lairPos(cs.region); add('lair', 'lair', m[0], m[2], { key: 'c.nav.lair' }); }
    else if (home) {
      via = routeExit(cs.region, home);
      if (via) { const q = exitPoint(cs.region, via); add('lair', 'lair', q[0], q[1], { key: 'c.nav.lairVia', p: { region: D.regions[via.to].nameKey } }, { via: via.to }); }
    }
    // region exits (greyed out while the dragon is too small); the exit on the way home is already the lair marker
    for (const e of T.region(cs.region).exits || []) {
      if (e === via) continue;
      const q = exitPoint(cs.region, e), dim = e.minStage != null && cs.dragon.stage < e.minStage;
      add('exit', 'exit:' + e.to, q[0], q[1], { key: dim ? 'c.nav.exitSmall' : 'c.nav.exit', p: { region: D.regions[e.to] ? D.regions[e.to].nameKey : e.to } }, dim ? { dim: true } : null);
    }
    // discovered settlements of this region (T12)
    if (cs.town && cs.town.region === cs.region && cs.discovered) {
      for (const pl of cs.town.places) if (cs.discovered[pl.id]) add('settlement', 'place:' + pl.id, pl.x, pl.z, { key: 'c.place.' + pl.type }, { type: pl.type });
    }
    // scents: toward the herd, blurred far out (a stored offset, so the marker drifts between updates, never jitters)
    for (const s of (cs.nav && cs.nav.scents) || []) {
      const b = Math.atan2(s.x - x0, s.z - z0) + s.off;
      out.push({ kind: s.livestock ? 'scentLivestock' : 'scent', key: 'scent:' + s.herd, bearing: wrap(b),
                 dist: Math.hypot(s.x - x0, s.z - z0), strength: s.strength,
                 label: { key: s.livestock ? 'c.nav.scentLivestock' : 'c.nav.scent' } });
    }
    return out.slice(0, D.nav.markers);
  }

  /** Heading-relative angle of a marker (-PI..PI, positive = to the right of the heading). */
  function relative(bearing, yaw) { return wrap(yaw - bearing); }   // yaw grows to the left (flight: stick right lowers yaw)

  M.define('nav', { smellRange, step, markers, seesPlace, discover, sources, routeExit, relative, drift });
})(typeof self !== 'undefined' ? self : this);
