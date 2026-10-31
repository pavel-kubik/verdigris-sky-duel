/*
 * Verdigris campaign - landing, walking and takeoff (Phase 2 T06, 002_task_kingdom.md 4.1 and 5.1).
 *
 * pilot.mode: 'air' (core/flight.js) | 'landing' | 'ground' | 'takeoff'.
 *   canLand(p, regionId, solids?) -> { ok, why? }     why: 'busy' | 'high' | 'fast' | 'water' | 'lava' | 'roof' | 'steep'
 *   startLanding(p)                                   air -> landing (land.time s, then ground)
 *   startTakeoff(p, stats?, eff?) -> { ok, why? }     ground -> takeoff (takeoff.time s, then air); why: 'busy' | 'tired'
 *   step(p, input, dt, ctx) -> p                      ground: tank steering, run, slope limit, solids, stays on the surface
 *   blend(p, dt, ctx) -> 'landed' | 'airborne' | null scripted landing / takeoff (position eases to / from the surface)
 *   inFront(p, scale, items) -> item | null           nearest item within ground.reach x scale inside reachCone (T08 pick up)
 *   groundAt(ctx, x, z) -> height                     surface, or a building roof (solids) when higher
 *   standY(ctx, x, z, scale) -> body height over (x, z) for a standing dragon
 *   pose(a, p, dt, scale) -> a                        render pose (T07) for shared/dragon.js anim: a = { ground, fold,
 *                                                     gait, stride, flare } advanced from the pilot mode and ground speed
 *
 * ctx: { regionId, scale, stats?, effects?, eating?, surface?(x, z), solidAt?(x, z) -> roof height | null,
 *        solidHit?(x, z) -> { nx, nz, depth } | null }
 * surface defaults to terrain.surfaceAt of the region, so the same code walks in the cave (T10) with another floor.
 * Buildings (T12, core/settlement.js): solidAt is a roof the dragon cannot climb (over walk.stepUp x scale), solidHit
 * the wall it slides along (the move's component along the wall is kept).
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const { clamp, wrap, lerp } = M.need('math');

  const NO_EFFECTS = { speedMult: 1, stRegenMult: 1, canBreath: true };
  const ease = k => k * k * (3 - 2 * k);

  const surfaceFn = ctx => ctx.surface || ((x, z) => T.surfaceAt(ctx.regionId, x, z));
  function groundAt(ctx, x, z) {
    const g = surfaceFn(ctx)(x, z), roof = ctx.solidAt ? ctx.solidAt(x, z) : null;
    return roof != null && roof > g ? roof : g;
  }
  const standY = (ctx, x, z, scale) => groundAt(ctx, x, z) + D.walk.stand * (scale || 1);

  /** Is landing allowed here and now? Checked in the order of the reasons a player can fix most easily. */
  function canLand(p, regionId, solids) {
    const L = D.land;
    if ((p.mode || 'air') !== 'air') return { ok: false, why: 'busy' };
    const x = p.pos[0], z = p.pos[2], surf = T.surfaceAt(regionId, x, z);
    if (p.pos[1] - surf > L.maxAlt) return { ok: false, why: 'high' };
    if (p.speed > L.maxSpeed) return { ok: false, why: 'fast' };
    const liquid = T.liquidAt(regionId, x, z);
    if (liquid) return { ok: false, why: liquid };
    if (solids && solids(x, z) != null) return { ok: false, why: 'roof' };
    if (T.surfaceSlope(regionId, x, z) > L.maxSlope) return { ok: false, why: 'steep' };
    return { ok: true };
  }

  function clearAir(p) {
    p.boosting = false; p.breathing = false; p.rollT = 0; p.rollX = 0;
  }

  function startLanding(p) {
    p.mode = 'landing';
    p.tr = { t: 0, dur: D.land.time, y0: p.pos[1], v0: p.speed, pitch0: p.pitch, roll0: p.roll };
    clearAir(p);
    return p;
  }

  function startTakeoff(p, stats, eff) {
    if ((p.mode || 'air') !== 'ground') return { ok: false, why: 'busy' };
    const cost = D.takeoff.st * ((eff && eff.takeoffSt) || 1);   // T20 wing muscles: takeoffSt
    if (p.st < cost) return { ok: false, why: 'tired' };
    p.st -= cost;
    p.mode = 'takeoff';
    p.tr = { t: 0, dur: D.takeoff.time, v0: Math.max(0, p.speed), cruise: (stats ? stats.cruise : 30) * ((eff || NO_EFFECTS).speedMult || 1) };
    clearAir(p);
    return { ok: true };
  }

  /** Slope pitch along the heading (nose up when walking uphill). */
  function slopePitch(ctx, x, z, yaw) {
    const e = 2, sx = Math.sin(yaw) * e, sz = Math.cos(yaw) * e;
    return Math.atan2(groundAt(ctx, x + sx, z + sz) - groundAt(ctx, x - sx, z - sz), 2 * e);
  }

  /** Can a standing dragon move from (x0, z0) to (x1, z1)? */
  function passable(ctx, x0, z0, x1, z1, scale) {
    const R = T.region(ctx.regionId), run = Math.hypot(x1 - x0, z1 - z0);
    if (run < 1e-9) return true;
    if (!ctx.surface && Math.hypot(x1, z1) > R.radius) return false;
    if (!ctx.surface && T.liquidAt(ctx.regionId, x1, z1) && !T.liquidAt(ctx.regionId, x0, z0)) return false;   // no wading into water or lava
    const s1 = surfaceFn(ctx)(x1, z1), roof = ctx.solidAt ? ctx.solidAt(x1, z1) : null;
    const g0 = groundAt(ctx, x0, z0), g1 = roof != null && roof > s1 ? roof : s1;
    let limit = D.land.maxSlope * run;
    if (roof != null && roof > s1) limit = Math.max(limit, D.walk.stepUp * scale);     // a low ledge can be stepped onto
    return g1 - g0 <= limit + 1e-9;
  }

  /** Moves by (dx, dz); a blocked move slides along the contour of the slope, else stops. Returns the share moved. */
  function tryMove(p, dx, dz, ctx, scale) {
    const x0 = p.pos[0], z0 = p.pos[2];
    if (Math.hypot(dx, dz) < 1e-6) return 1;                             // a standstill creep (passable() lets a zero run through)
    if (passable(ctx, x0, z0, x0 + dx, z0 + dz, scale)) { p.pos[0] += dx; p.pos[2] += dz; return 1; }
    const wall = ctx.solidHit ? ctx.solidHit(x0 + dx, z0 + dz) : null;
    if (wall) {                                                          // a building: slide along its wall (T12)
      const k = wall.depth + 1e-3, sx = dx + wall.nx * k, sz = dz + wall.nz * k;   // the move, pushed back out of the wall
      const along = sx * dx + sz * dz;
      if (along > 1e-9 && passable(ctx, x0, z0, x0 + sx, z0 + sz, scale)) {
        p.pos[0] += sx; p.pos[2] += sz;
        return Math.min(1, Math.hypot(sx, sz) / (Math.hypot(dx, dz) || 1));
      }
      return 0;
    }
    const f = surfaceFn(ctx), e = 1;
    let gx = f(x0 + e, z0) - f(x0 - e, z0), gz = f(x0, z0 + e) - f(x0, z0 - e);
    const gl = Math.hypot(gx, gz);
    if (gl > 1e-9) {
      const tx = -gz / gl, tz = gx / gl, d = dx * tx + dz * tz;          // the move's component along the contour line
      const sx = tx * d, sz = tz * d;
      if (Math.abs(d) > 1e-6 && passable(ctx, x0, z0, x0 + sx, z0 + sz, scale)) {
        p.pos[0] += sx; p.pos[2] += sz;
        return Math.abs(d) / (Math.hypot(dx, dz) || 1);
      }
    }
    return 0;
  }

  /**
   * One step on the ground. input: { sx, sy, boost, breath } as in flight (sy > 0 = forward).
   * Tank steering: sides turn on the spot, up walks forward (Boost = run), down backs off slowly.
   */
  function step(p, inp, dt, ctx) {
    const W = D.walk, eff = ctx.effects || NO_EFFECTS, scale = ctx.scale || 1;
    const sizeK = 1 + W.sizeSpeed * (scale - 1);
    p.inv = Math.max(0, (p.inv || 0) - dt);
    const sx = clamp(inp.sx || 0, -1, 1), sy = clamp(inp.sy || 0, -1, 1);
    p.sx = sx;
    p.boosting = !!inp.boost && sy > 0.1 && p.st > 2 && !ctx.eating;
    p.breathing = !!inp.breath && eff.canBreath && !ctx.eating && p.st > (p.breathing ? 0.5 : 8);
    p.yaw = wrap(p.yaw - sx * W.turn * dt);

    let want = sy > 0 ? sy * (p.boosting ? W.run : W.speed) : sy * W.back;
    want *= sizeK * (eff.speedMult || 1);
    if (ctx.eating) want = 0;
    p.speed += (want - p.speed) * Math.min(1, dt * W.accel);

    if (p.boosting) p.st -= W.runSt * (eff.boostSt || 1) * dt;   // T20 wing muscles: boostSt
    if (p.breathing) p.st -= 32 * dt;
    if (!p.boosting && !p.breathing) p.st += 17 * (eff.stRegenMult || 1) * dt;
    p.st = clamp(p.st, 0, 100);

    const y0 = p.pos[1];
    const dx = Math.sin(p.yaw) * p.speed * dt, dz = Math.cos(p.yaw) * p.speed * dt;
    const moved = tryMove(p, dx, dz, ctx, scale);
    if (moved < 1) p.speed *= moved > 0 ? Math.max(0.5, moved) : 0.5;        // pushing into a slope bleeds speed
    p.pos[1] = standY(ctx, p.pos[0], p.pos[2], scale);
    const inv = dt > 0 ? 1 / dt : 0;
    p.vel = [dx * moved * inv, (p.pos[1] - y0) * inv, dz * moved * inv];
    p.pitch += (slopePitch(ctx, p.pos[0], p.pos[2], p.yaw) - p.pitch) * Math.min(1, dt * 6);
    p.roll += (0 - p.roll) * Math.min(1, dt * 6);
    p.rollX = 0;
    return p;
  }

  /** Scripted landing / takeoff. Returns 'landed' or 'airborne' on the frame the transition ends. */
  function blend(p, dt, ctx) {
    const tr = p.tr, scale = ctx.scale || 1;
    if (!tr || (p.mode !== 'landing' && p.mode !== 'takeoff')) return null;
    p.inv = Math.max(0, (p.inv || 0) - dt);
    tr.t += dt;
    const k = clamp(tr.t / tr.dur, 0, 1), e = ease(k);
    p.boosting = false; p.breathing = false; p.sx = 0;
    if (p.mode === 'landing') {
      p.speed = tr.v0 * (1 - e);                                    // brake to a stand
      move(p, dt, ctx);
      p.pos[1] = lerp(tr.y0, standY(ctx, p.pos[0], p.pos[2], scale), e);
      p.pitch = lerp(tr.pitch0, slopePitch(ctx, p.pos[0], p.pos[2], p.yaw), e);
      p.roll = lerp(tr.roll0 || 0, 0, e);
      if (k >= 1) { p.mode = 'ground'; p.tr = null; p.speed = 0; p.pos[1] = standY(ctx, p.pos[0], p.pos[2], scale); return 'landed'; }
      return null;
    }
    const minAlt = ctx.minAlt == null ? D.flight.minAlt : ctx.minAlt;
    p.speed = lerp(tr.v0, tr.cruise * 0.8, e);
    move(p, dt, ctx);
    const g = groundAt(ctx, p.pos[0], p.pos[2]);
    p.pos[1] = g + lerp(D.walk.stand * scale, minAlt + D.takeoff.climb, e);
    p.pitch = 0.45 * Math.sin(Math.PI * k) + 0.15 * k;               // nose up through the jump, level-ish at the end
    p.roll += (0 - p.roll) * Math.min(1, dt * 6);
    if (k >= 1) { p.mode = 'air'; p.tr = null; p.pitch = 0.15; return 'airborne'; }
    return null;
  }

  /** Horizontal move along the heading during a transition (no slope limit, but region bounds and no liquid). */
  function move(p, dt, ctx) {
    const dx = Math.sin(p.yaw) * p.speed * dt, dz = Math.cos(p.yaw) * p.speed * dt;
    const x1 = p.pos[0] + dx, z1 = p.pos[2] + dz;
    if (!ctx.surface) {
      const R = T.region(ctx.regionId);
      if (Math.hypot(x1, z1) > R.radius) return;
      if (p.mode === 'landing' && T.liquidAt(ctx.regionId, x1, z1)) { p.speed = 0; return; }
    }
    if (p.mode === 'landing' && ctx.solidHit && ctx.solidHit(x1, z1)) { p.speed = 0; return; }   // no sliding into a building (T12)
    p.pos[0] = x1; p.pos[2] = z1;
    p.vel = [dx / (dt || 1), 0, dz / (dt || 1)];
  }

  /** Nearest item (with pos) in front of the dragon: within ground.reach x scale and reachCone radians of the heading. */
  function inFront(p, scale, items) {
    const G = D.ground, reach = G.reach * (scale || 1);
    let best = null, bd = Infinity;
    for (const it of items || []) {
      if (!it || !it.pos) continue;
      const dx = it.pos[0] - p.pos[0], dz = it.pos[2] - p.pos[2], d = Math.hypot(dx, dz);
      if (d > reach + (it.r || 0) || d >= bd) continue;
      if (d > 1e-6 && Math.abs(wrap(Math.atan2(dx, dz) - p.yaw)) > G.reachCone) continue;
      best = it; bd = d;
    }
    return best;
  }

  /**
   * Render pose (T07), advanced each frame from the pilot: how far the legs stand (ground 0..1), the wing fold
   * (fold 0..1), the walk cycle phase (gait, rad) and step size (stride 0..1), and the landing flare (flare 0..1:
   * wings spread wide and beat slowly while braking). Pure, so the walk cycle is testable without Three.js.
   */
  function pose(a, p, dt, scale) {
    const P = D.pose, W = D.walk, mode = (p && p.mode) || 'air', sc = scale || 1;
    a = a || {};
    if (a.gait == null) Object.assign(a, { ground: 0, fold: 0, gait: 0, stride: 0, flare: 0 });
    const k = p && p.tr ? clamp(p.tr.t / p.tr.dur, 0, 1) : 0, rate = Math.min(1, dt * P.legRate);
    let g, f, fl = 0;
    if (mode === 'ground') { g = 1; f = 1; }
    else if (mode === 'landing') {
      g = ease(clamp((k - P.legsAt) / (1 - P.legsAt), 0, 1));
      f = ease(clamp((k - P.foldAt) / (1 - P.foldAt), 0, 1));
      fl = Math.sin(Math.PI * Math.min(1, k / P.foldAt)) * (1 - f);
    } else if (mode === 'takeoff') { g = 1 - ease(clamp(k / P.tuckAt, 0, 1)); f = 0; }
    else { g = 0; f = 0; }
    if (mode === 'ground' || mode === 'air') { a.ground += (g - a.ground) * rate; a.fold += (f - a.fold) * rate; }
    else { a.ground = g; a.fold = f; }
    a.flare = fl;
    const v = mode === 'ground' ? (p.speed || 0) : 0, turning = mode === 'ground' ? Math.abs(p.sx || 0) : 0;
    const sizeK = 1 + W.sizeSpeed * (sc - 1);
    const want = mode === 'ground' ? clamp(Math.max(Math.abs(v) / (W.speed * sizeK) * 0.8, turning * 0.45), 0, 1) : 0;
    a.stride += (want - a.stride) * Math.min(1, dt * 8);
    const cyc = Math.abs(v) / (P.gaitLen * sc) + turning * P.turnGait;   // walk cycles per second
    if (a.stride > 0.01) a.gait = wrap(a.gait + (v < -0.05 ? -1 : 1) * cyc * 2 * Math.PI * dt);
    return a;
  }

  M.define('walk', { canLand, startLanding, startTakeoff, step, blend, inFront, groundAt, standY, passable, pose });
})(typeof self !== 'undefined' ? self : this);
