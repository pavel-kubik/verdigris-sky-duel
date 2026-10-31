/*
 * Verdigris campaign - perception: sight cones, range factors, line of sight, hearing, awareness (Phase 2 T14,
 * 002_task_kingdom.md 4.4 and 5.3). The defenders of T15 / T16 use it; until then the posts of a town watch.
 *   lightMult(light) -> 0..1                 light: a number, or 'day' | 'dusk' | 'night' (default day)
 *   altFactor(alt) -> min..1                 high flight is harder to see (perception.altitude)
 *   range(viewer, ctx) -> units              viewer.sight x ctx.spot x light x altitude factor (ctx.alt)
 *   los(regionId, from, to, town?, skip?) -> bool   no terrain and no building roof (other than building id `skip`)
 *                                            above the line from -> to
 *   seen(viewer, dragon, ctx) -> 0..1        viewer { pos, yaw, sight, fov, building? }, dragon { pos, alt? },
 *                                            ctx { regionId, spot, light, scale, town }: in the cone (fov = full angle,
 *                                            >= 2 PI all round) x in range (linear fade over the last `fade`) x LOS
 *                                            (to the centre or losTop x scale above it)
 *   noise(kind, pos, scale) -> { kind, pos, r }   r = perception.hearing[kind] x scale
 *   noisesOf(pilot, events, scale) -> noises[]    this frame's noises: boost (air), run (ground, Boost), breath,
 *                                            land (dragon:landing / dragon:landed), takeoff (dragon:takeoff)
 *   heard(viewer, noises) -> noise | null    the loudest noise whose radius reaches the viewer (truthy = heard)
 *   stepAwareness(def, seen, heard, dt) -> 'idle' | 'suspicious' | 'alert'   def.aware 0..alert, def.state
 *   watchers(town) -> watcher[]              one per post of a standing building: { id, kind, building, pos (eye),
 *                                            base, yaw, sight, fov, aware, state, focus, seen, heard }
 *   step(cs, ev, dt, { scale, spot }) -> ev[]  cs.watch = { town, list }: the posts sweep, turn to what they noticed,
 *                                            see and hear the dragon; 'aware:state' { id, kind, state, from } on change.
 *                                            In the cave nobody sees the dragon (awareness falls).
 * Pure: no DOM, no THREE. The same seen() can later replace the prey flee check.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), SE = M.need('settlement');
  const { wrap, clamp } = M.need('math');
  const TAU = Math.PI * 2;

  function lightMult(light) {
    if (typeof light === 'number') return clamp(light, 0, 1);
    const P = D.perception;
    return light === 'night' ? P.night : light === 'dusk' ? P.dusk : 1;
  }

  function altFactor(alt) {
    const A = D.perception.altitude;
    if (!(alt > A.from)) return 1;
    return 1 - (1 - A.min) * clamp((alt - A.from) / (A.to - A.from), 0, 1);
  }

  function range(viewer, ctx) {
    ctx = ctx || {};
    return viewer.sight * (ctx.spot || 1) * lightMult(ctx.light) * altFactor(ctx.alt || 0);
  }

  function los(regionId, a, b, town, skip) {
    const P = D.perception, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const n = Math.max(P.losSteps, Math.ceil(Math.hypot(dx, dz) / P.losSpacing));
    for (let i = 1; i < n; i++) {
      const k = i / n, x = a[0] + dx * k, z = a[2] + dz * k, y = a[1] + dy * k;
      if (T.surfaceAt(regionId, x, z) > y) return false;
      if (town) {
        const hb = SE.hit(town, x, z, 0);
        if (hb && hb.b.id !== skip && hb.roof > y) return false;
      }
    }
    return true;
  }

  function seen(viewer, dragon, ctx) {
    ctx = ctx || {};
    const P = D.perception, v = viewer.pos, q = dragon.pos;
    const dx = q[0] - v[0], dz = q[2] - v[2], dh = Math.hypot(dx, dz);
    if (viewer.fov < TAU && dh > 1e-6 && Math.abs(wrap(Math.atan2(dx, dz) - viewer.yaw)) > viewer.fov / 2) return 0;
    const alt = dragon.alt != null ? dragon.alt : (ctx.regionId ? q[1] - T.surfaceAt(ctx.regionId, q[0], q[2]) : 0);
    const r = range(viewer, Object.assign({}, ctx, { alt })), d = Math.hypot(dh, q[1] - v[1]);
    if (d >= r) return 0;
    const k = clamp((r - d) / Math.max(1e-6, r * P.fade), 0, 1);
    if (!ctx.regionId) return k;
    const top = [q[0], q[1] + P.losTop * (ctx.scale || 1), q[2]];
    return los(ctx.regionId, v, q, ctx.town, viewer.building) || los(ctx.regionId, v, top, ctx.town, viewer.building) ? k : 0;
  }

  function noise(kind, pos, scale) {
    return { kind, pos: pos.slice(), r: (D.perception.hearing[kind] || 0) * (scale || 1) };
  }

  const EV_NOISE = { 'dragon:landing': 'land', 'dragon:landed': 'land', 'dragon:takeoff': 'takeoff' };
  function noisesOf(p, ev, scale) {
    const out = [];
    if (!p) return out;
    const ground = p.mode === 'ground';
    if (p.boosting) out.push(noise(ground ? 'run' : 'boost', p.pos, scale));
    if (p.breathing) out.push(noise('breath', p.pos, scale));
    const once = {};
    for (const e of ev || []) {
      const k = EV_NOISE[e.e];
      if (k && !once[k]) { once[k] = true; out.push(noise(k, e.pos || p.pos, scale)); }
    }
    return out;
  }

  function heard(viewer, noises) {
    let best = null;
    for (const n of noises || []) {
      const d = Math.hypot(n.pos[0] - viewer.pos[0], n.pos[1] - viewer.pos[1], n.pos[2] - viewer.pos[2]);
      if (d <= n.r && (!best || n.r > best.r)) best = n;
    }
    return best;
  }

  function stepAwareness(def, s, h, dt) {
    const P = D.perception;
    let a = def.aware || 0;
    if (s > 0) a += P.awareRise * s * dt;
    else if (!h) a -= P.awareFall * dt;
    if (h) a = Math.max(a, P.suspicious + 0.01);
    a = clamp(a, 0, P.alert);
    def.aware = a;
    const was = def.state || 'idle';
    def.state = a >= P.alert ? 'alert' : was === 'alert' && a >= P.suspicious ? 'alert' : a >= P.suspicious ? 'suspicious' : 'idle';
    return def.state;
  }

  function watchers(town) {
    const W = D.perception.watch, out = [];
    if (!town) return out;
    for (const post of town.posts || []) {
      const b = town.buildings.find(x => x.id === post.building);
      if (!b || b.ruin) continue;
      const pl = town.places.find(x => x.id === b.place);
      const dx = b.pos[0] - (pl ? pl.x : b.pos[0]), dz = b.pos[2] - (pl ? pl.z : b.pos[2]);
      const base = Math.hypot(dx, dz) > 2 ? Math.atan2(dx, dz) : (pl ? pl.yaw : 0);
      const V = D.defenders[post.kind] || D.defenders.archer;
      out.push({ id: b.id, kind: post.kind, building: b.id, pos: [post.pos[0], post.pos[1] + W.eye, post.pos[2]],
                 base, yaw: base, sight: V.sight, fov: V.fov, aware: 0, state: 'idle', focus: null, seen: 0, heard: null,
                 phase: (b.pos[0] * 0.013 + b.pos[2] * 0.007) % TAU });
    }
    return out;
  }

  function step(cs, ev, dt, o) {
    const out = [], town = cs.town, W = D.perception.watch;
    if (!cs.watch || cs.watch.town !== town) cs.watch = { town, list: watchers(town), t: 0 };
    const w = cs.watch, p = cs.dragon.pilot;
    w.t += dt;
    const scale = (o && o.scale) || 1, inside = cs.inLair || !p;
    const noises = inside ? [] : noisesOf(p, ev, scale);
    const ctx = { regionId: cs.region, spot: (o && o.spot) || 1, light: cs.light == null ? 'day' : cs.light, scale, town };
    for (const v of w.list) {
      const b = town && town.buildings.find(x => x.id === v.building);
      if (b && b.ruin) { v.seen = 0; v.heard = null; v.aware = 0; if (v.state !== 'idle') { out.push({ e: 'aware:state', id: v.id, kind: v.kind, state: 'idle', from: v.state }); v.state = 'idle'; } continue; }
      // look: sweep around the base direction, or turn toward the last thing noticed
      const want = v.focus && v.state !== 'idle' ? Math.atan2(v.focus[0] - v.pos[0], v.focus[2] - v.pos[2])
        : v.base + W.sweep * Math.sin(w.t * W.sweepRate + v.phase);
      const dy = wrap(want - v.yaw), mx = W.turn * dt;
      v.yaw = wrap(v.yaw + clamp(dy, -mx, mx));
      v.seen = inside ? 0 : seen(v, { pos: p.pos }, ctx);
      v.heard = heard(v, noises);
      if (v.seen > 0) v.focus = p.pos.slice();
      else if (v.heard) v.focus = v.heard.pos.slice();
      const was = v.state, now = stepAwareness(v, v.seen, v.heard, dt);
      if (now === 'idle') v.focus = null;
      if (now !== was) out.push({ e: 'aware:state', id: v.id, kind: v.kind, state: now, from: was });
    }
    return out;
  }

  M.define('perception', { lightMult, altFactor, range, los, seen, noise, noisesOf, heard, stepAwareness, watchers, step });
})(typeof self !== 'undefined' ? self : this);
