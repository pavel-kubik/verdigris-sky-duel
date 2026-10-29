/*
 * Verdigris campaign - the volcano lair: enter, store prey in the larder, rest (heal, stage-up), eat from
 * the larder, leave, and larder spoilage. See 001_task_survival.md 5.7.
 *   mouthPos(regionId) -> [x, y, z] | null    centre of the cave mouth (only regions with a lair)
 *   inMouth(cs) -> boolean                    dragon inside the mouth sphere (radius grows a little with scale)
 *   near(cs) -> boolean                       dragon close to the mouth (for the "fly into the cave" prompt)
 *   enter(cs) -> events[]                     stores a carried prey if there is room, cs.inLair = true
 *   rest(cs) -> { grew, from, to, events }    HP and fire to max, stage-up if food XP is ready
 *   eatFromLarder(cs, index) -> events[]      feeds the stored item's current food
 *   leave(cs) -> events[]                     dragon back in the air at the region spawn, cs.inLair = false
 *   spoil(cs, dt) -> events[]                 larder items lose 1 food per spoilEvery s, removed at 0
 * While cs.inLair, state.step only runs spoil (hunger and prey are paused).
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), HN = M.need('hunger'), F = M.need('flight'), PR = M.need('prey');
  const L = D.lair;

  const mouthPos = regionId => T.lairPos(regionId);
  const scaleOf = cs => G.scaleOf(cs.dragon.foodXp, cs.dragon.stage);

  function distToMouth(cs) {
    const m = mouthPos(cs.region), p = cs.dragon.pilot;
    if (!m || !p) return Infinity;
    return Math.hypot(p.pos[0] - m[0], p.pos[1] - m[1], p.pos[2] - m[2]);
  }

  function inMouth(cs) {
    const R = T.region(cs.region).lair;
    return !!R && distToMouth(cs) < R.r * Math.max(1, scaleOf(cs) * 0.8);
  }

  const near = cs => !cs.inLair && distToMouth(cs) < L.nearRange;

  function enter(cs) {
    const d = cs.dragon, ev = [];
    const carried = d.carried == null ? null : PR.byId(cs.field, d.carried);
    if (carried) {
      if (cs.larder.length < L.larderSize) {
        cs.larder.push({ type: carried.type, food: carried.food });
        PR.remove(cs.field, carried.id);
        d.carried = null;
        ev.push({ e: 'lair:stored', type: carried.type, food: carried.food });
      } else ev.push({ e: 'lair:full', type: carried.type });
    }
    d.eatT = 0;
    cs.inLair = true;
    cs.swoop = null; cs.target = null; cs.breath = null; cs.hint = null;
    if (d.pilot) { d.pilot.breathing = false; d.pilot.boosting = false; }
    ev.unshift({ e: 'lair:enter' });
    return ev;
  }

  function rest(cs) {
    const d = cs.dragon, ev = [];
    const r = G.growUp(d);
    d.hp = G.statsOf(d.stage).hpMax;
    if (d.pilot) d.pilot.st = 100;
    ev.push({ e: 'lair:rest', grew: r.grew });
    if (r.grew) ev.push({ e: 'stage:up', from: r.from, to: r.to });
    cs.flags.rested = (cs.flags.rested || 0) + 1;
    return Object.assign(r, { events: ev });
  }

  function eatFromLarder(cs, index) {
    const it = cs.larder[index];
    if (!it) return [];
    const food = Math.max(1, Math.round(it.food));
    cs.larder.splice(index, 1);
    const ready = HN.feed(cs.dragon, food);
    cs.stats.eaten++; cs.stats.food += food;
    const ev = [{ e: 'prey:eaten', type: it.type, food, from: 'larder' }];
    if (ready) ev.push({ e: 'growth:ready', stage: G.readyStage(cs.dragon.foodXp, cs.dragon.stage) });
    return ev;
  }

  function leave(cs) {
    const R = T.region(cs.region), s = R.spawn, d = cs.dragon;
    if (!s) { cs.inLair = false; return [{ e: 'lair:leave' }]; }
    const y = Math.max(s.y, T.surfaceAt(cs.region, s.x, s.z) + 40);
    const st = d.pilot ? d.pilot.st : 100;
    d.pilot = F.newPilot([s.x, y, s.z], s.yaw, G.statsOf(d.stage).cruise);
    d.pilot.st = st;
    cs.inLair = false;
    return [{ e: 'lair:leave' }];
  }

  function spoil(cs, dt) {
    const ev = [];
    for (let i = cs.larder.length - 1; i >= 0; i--) {
      const it = cs.larder[i];
      it.food -= dt / L.spoilEvery;
      if (it.food <= 0) { cs.larder.splice(i, 1); ev.push({ e: 'lair:spoiled', type: it.type }); }
    }
    return ev;
  }

  M.define('lair', { mouthPos, distToMouth, inMouth, near, enter, rest, eatFromLarder, leave, spoil });
})(typeof self !== 'undefined' ? self : this);
