/*
 * Verdigris campaign - dragon flight.
 * Ported from mp/sim.js stepPilot (same feel at hatchling stats), with:
 *   - region bounds, ceiling and ground from core/terrain (the drawn surface);
 *   - turn rate, cruise and boost speed from the growth stage (ctx.stats);
 *   - hunger effects (ctx.effects): speed multiplier, stamina regen, breath allowed;
 *   - a speed cap while eating (ctx.eating);
 *   - a lower minimum altitude than the duel, so low passes over prey are possible;
 *   - no "down" spiral: death is handled by core/state.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain');
  const { clamp, wrap, fwd } = M.need('math');

  const ROLL_TIME = 0.6, ROLL_SHIFT = 34, ROLL_COST = 10, ROLL_INV = 0.65;
  const SOFT_EDGE = 120;                       // start steering back this far inside the radius
  const NO_EFFECTS = { speedMult: 1, stRegenMult: 1, canBreath: true };

  function newPilot(pos, yaw, speed) {
    return {
      pos: pos ? pos.slice() : [0, 100, 0], vel: [0, 0, 0],
      yaw: yaw || 0, pitch: 0, roll: 0, rollX: 0, sx: 0,
      speed: speed || 30, st: 100, rollT: 0, rollDir: 1, inv: 0,
      boosting: false, breathing: false,
    };
  }

  /** Height above the drawn surface. */
  function altitude(p, regionId) {
    return p.pos[1] - T.surfaceAt(regionId, p.pos[0], p.pos[2]);
  }

  /**
   * One flight step.
   * input: { sx, sy, breath, boost } with sx / sy in -1..1
   * ctx:   { regionId, stats: { turn, cruise, boost }, effects?, eating?, minAlt?, softEdge? }
   *        softEdge: width of the steer-back band inside the radius (narrower in front of a region exit)
   */
  function step(p, inp, dt, ctx) {
    const R = T.region(ctx.regionId), st = ctx.stats, eff = ctx.effects || NO_EFFECTS;
    const minAlt = ctx.minAlt == null ? D.flight.minAlt : ctx.minAlt;
    p.inv = Math.max(0, p.inv - dt);

    const sx = clamp(inp.sx || 0, -1, 1), sy = clamp(inp.sy || 0, -1, 1);
    p.sx = sx;
    p.boosting = !!inp.boost && p.st > 2 && !ctx.eating;
    p.breathing = !!inp.breath && eff.canBreath && !ctx.eating && p.st > (p.breathing ? 0.5 : 8);
    p.yaw = wrap(p.yaw - sx * D.flight.baseTurn * st.turn * dt);

    let tp = sy * 0.75;
    const alt = altitude(p, ctx.regionId);
    if (alt < minAlt + 1.5) tp = Math.max(tp, 0.2);          // skim, don't plough: gentle pull-up at the floor
    if (p.pos[1] > R.ceiling - 10) tp = Math.min(tp, -0.1);
    p.pitch += (tp - p.pitch) * Math.min(1, dt * 3);

    const r = Math.hypot(p.pos[0], p.pos[2]), soft = ctx.softEdge == null ? SOFT_EDGE : ctx.softEdge;
    if (r > R.radius - soft) {                                // soft boundary: steer back toward the centre
      const d = wrap(Math.atan2(-p.pos[0], -p.pos[2]) - p.yaw);
      p.yaw = wrap(p.yaw + d * Math.min(1, dt * 1.2 * (r - (R.radius - soft)) / 30));
    }

    let target = (p.boosting ? st.boost : st.cruise) * eff.speedMult - p.pitch * 8;
    if (ctx.eating) target = Math.min(target, D.eat.speedCap);
    p.speed += (target - p.speed) * Math.min(1, dt * 2.2);

    if (p.boosting) p.st -= 20 * dt;
    if (p.breathing) p.st -= 32 * dt;
    if (!p.boosting && !p.breathing) p.st += 17 * eff.stRegenMult * dt;
    p.st = clamp(p.st, 0, 100);

    const f = fwd(p.yaw, p.pitch);
    for (let k = 0; k < 3; k++) { p.vel[k] = f[k] * p.speed; p.pos[k] += p.vel[k] * dt; }
    p.rollX = 0;
    if (p.rollT > 0) {
      const k = 1 - p.rollT / ROLL_TIME;
      p.rollT = Math.max(0, p.rollT - dt);
      p.rollX = p.rollDir * Math.PI * 2 * (k * k * (3 - 2 * k));
      p.pos[0] += -Math.cos(p.yaw) * p.rollDir * ROLL_SHIFT * dt;
      p.pos[2] += Math.sin(p.yaw) * p.rollDir * ROLL_SHIFT * dt;
    }
    T.clampToRegion(ctx.regionId, p.pos, minAlt);
    p.roll += (sx * 0.65 - p.roll) * Math.min(1, dt * 4);
    return p;
  }

  function tryRoll(p, dir) {
    if (p.rollT > 0 || p.st < ROLL_COST) return false;
    p.st -= ROLL_COST; p.rollT = ROLL_TIME; p.rollDir = dir < 0 ? -1 : 1; p.inv = ROLL_INV;
    return true;
  }

  M.define('flight', { newPilot, step, tryRoll, altitude, ROLL_TIME, SOFT_EDGE });
})(typeof self !== 'undefined' ? self : this);
