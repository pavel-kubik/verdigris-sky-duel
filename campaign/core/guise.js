/*
 * Verdigris campaign - the Guise: the dragon takes human form by magic (the court wizard's gift, see the wizard's
 * tale) and walks among people. A Drake learns it (data.guise.minStage; cs.flags.guise once the card was shown).
 *   learned(cs) -> bool
 *   can(cs) -> { ok, why? }      why: 'locked' | 'air' (land first) | 'busy' (prey or loot in the claws) | 'tired'
 *                                | 'cramped' (to dragon: not enough room around for the big body) | 'cave'
 *   toggle(cs, solids) -> events[]   'guise:human' / 'guise:dragon' (with pos) or 'guise:blocked' { why }
 *   step(cs, inp, dt, solids) -> events[]   one frame in human form: walks cs.hero (core/hero.js, kind 'dragonkin'),
 *                                the dragon's pilot follows it (camera, compass, map and missions read the pilot)
 * In human form guards neither see nor hear the dragon (core/defenders.js), it cannot fly, breathe fire or grab;
 * hunger drains at data.guise.hunger of the usual rate. F jumps, Space throws a few warm sparks (the ember gift).
 * cs.form = 'dragon' | 'human'; cs.guiseT counts down the shimmer of the change (the renderer's sparkle).
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), H = M.need('hero'), HN = M.need('hunger'), G = M.need('growth');

  function learned(cs) { return !!(cs.flags && cs.flags.guise) || cs.dragon.stage >= D.guise.minStage; }

  function can(cs, sol) {
    const d = cs.dragon, p = d.pilot, human = cs.form === 'human';
    if (!learned(cs)) return { ok: false, why: 'locked' };
    if (cs.inLair || cs.inAerie) return { ok: false, why: 'cave' };
    if (!p || (!human && p.mode !== 'ground')) return { ok: false, why: 'air' };
    if (!human && (d.carried != null || cs.carriedLoot)) return { ok: false, why: 'busy' };
    if ((human ? cs.hero.st : p.st) < D.guise.st) return { ok: false, why: 'tired' };
    if (human && sol) {
      const pos = cs.hero.pos, r = D.guise.clear * G.scaleOf(d.foodXp, d.stage);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        if (sol.solidAt(pos[0] + Math.sin(a) * r, pos[2] + Math.cos(a) * r) != null) return { ok: false, why: 'cramped' };
      }
    }
    return { ok: true };
  }

  function toggle(cs, sol) {
    const c = can(cs, sol);
    if (!c.ok) return [{ e: 'guise:blocked', why: c.why }];
    const p = cs.dragon.pilot;
    cs.guiseT = D.guise.time;
    if (cs.form !== 'human') {
      p.st -= D.guise.st;
      cs.form = 'human';
      cs.hero = H.create('dragonkin', p.pos, p.yaw);
      cs.hero.st = p.st;
      cs.breath = null; cs.fire = null; cs.swoop = null; cs.target = null;
      if (cs.flags) cs.flags.guise = true;
      return [{ e: 'guise:human', pos: p.pos.slice() }];
    }
    const h = cs.hero;
    cs.form = 'dragon';
    p.pos = h.pos.slice(); p.yaw = h.yaw; p.mode = 'ground'; p.speed = 0; p.vel = [0, 0, 0]; p.pitch = 0; p.roll = 0;
    p.st = Math.max(0, h.st - D.guise.st);
    cs.hero = null;
    return [{ e: 'guise:dragon', pos: p.pos.slice() }];
  }

  /** A frame in human form. inp: the campaign input (sx, sy walk, boost runs, land jumps, breath = the ember). */
  function step(cs, inp, dt, sol) {
    const h = cs.hero, p = cs.dragon.pilot;
    cs.guiseT = Math.max(0, (cs.guiseT || 0) - dt);
    const ev = H.step(h, { sx: inp.sx, sy: inp.sy, run: inp.boost, jump: inp.land || inp.jump, act: inp.breath && !cs.emberHeld }, dt,
      { regionId: cs.region, solidAt: sol.solidAt, solidHit: sol.solidHit, walkTop: sol.walkTop });
    cs.emberHeld = !!inp.breath;
    p.pos = h.pos.slice(); p.yaw = h.yaw; p.mode = 'ground'; p.speed = h.speed; p.vel = h.vel.slice(); p.st = h.st;
    p.boosting = false; p.breathing = false;
    const hs = HN.step(cs.dragon, dt * D.guise.hunger, { boosting: false, breathing: false });
    if (hs) ev.push({ e: 'hunger:state', state: hs });
    return ev;
  }

  M.define('guise', { learned, can, toggle, step });
})(typeof self !== 'undefined' ? self : this);
