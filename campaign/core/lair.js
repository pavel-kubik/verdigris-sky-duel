/*
 * Verdigris campaign - the volcano lair: enter, store prey in the larder, rest (heal, stage-up), eat from
 * the larder, leave, and larder spoilage. See 001_task_survival.md 5.7.
 *   mouthPos(regionId) -> [x, y, z] | null    centre of the cave mouth (only regions with a lair)
 *   inMouth(cs) -> boolean                    dragon inside the mouth sphere (radius grows a little with scale)
 *   near(cs) -> boolean                       dragon close to the mouth (for the "fly into the cave" prompt)
 *   canEnter(cs) -> boolean                   near() and within enterRange: the Move slot offers "Enter cave"
 *   enter(cs) -> events[]                     stores a carried prey if there is room, cs.inLair = true
 *   rest(cs) -> { grew, from, to, events }    HP and fire to max, stage-up if food XP is ready
 *   eatFromLarder(cs, index) -> events[]      feeds the stored item's current food
 *   leave(cs) -> events[]                     dragon back in the air at the region spawn, cs.inLair = false
 *   spoil(cs, dt) -> events[]                 larder items lose 1 food per spoilEvery s, removed at 0
 *   home() -> regionId                        the region with the lair (where a dead dragon wakes)
 *   respawn(cs, cause) -> events[]            after death: carried prey lost, back in the lair region, HP respawnHp x max,
 *                                             hunger at least respawnHunger, cs.inLair = true (the panel opens)
 *   hatch(cs) -> events[]                     new hatchling: wakes inside the lair of home() (intro card -> lair panel);
 *                                             the hatching scene hands over to the mother: cs.story.mother = { lesson: 0, at: 'lair' }
 *                                             and a mother:handover event (her lessons are driven by core/mother.js, T05)
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

  /** Close to the mouth and heading roughly toward it (so leaving the cave does not show the prompt). */
  function near(cs) {
    if (cs.inLair || !(distToMouth(cs) < L.nearRange)) return false;
    const m = mouthPos(cs.region), p = cs.dragon.pilot;
    return Math.cos(Math.atan2(m[0] - p.pos[0], m[2] - p.pos[2]) - p.yaw) > 0.3;
  }

  /** Close enough for the Move slot's "Enter cave" (a shortcut for the last few seconds of the approach). */
  function canEnter(cs) {
    return near(cs) && distToMouth(cs) < L.enterRange;
  }

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
    cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null; cs.fireMem = null; cs.hint = null;
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
    const np = F.newPilot([s.x, y, s.z], s.yaw, G.statsOf(d.stage).cruise);
    np.st = st;
    if (d.pilot) Object.assign(d.pilot, np); else d.pilot = np;   // same object: the renderer keeps its reference
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

  /** The region that has the lair (the start region when it has one). */
  function home() {
    if (T.region(D.startRegion).lair) return D.startRegion;
    for (const id in D.regions) if (D.regions[id].lair) return id;
    return D.startRegion;
  }

  /**
   * Death: the carried prey is lost, the dragon wakes inside the lair (switching back to the lair region if it
   * died elsewhere) with respawnHp of its max HP and hunger at least respawnHunger. Stage, food XP and the larder stay.
   * Events: dragon:died, then region:enter (only when the region changed, respawn: true), then lair:enter (respawn: true).
   */
  function respawn(cs, cause) {
    const d = cs.dragon, ev = [];
    const carried = d.carried == null || !cs.field ? null : PR.byId(cs.field, d.carried);
    if (carried) PR.remove(cs.field, carried.id);
    ev.push({ e: 'dragon:died', cause: cause || 'wounds', region: cs.region, lost: carried ? carried.type : null });
    d.carried = null; d.eatT = 0; d.deaths = (d.deaths || 0) + 1;
    const st = G.statsOf(d.stage);
    d.hp = Math.round(L.respawnHp * st.hpMax);
    d.hunger = Math.max(d.hunger, L.respawnHunger);
    return wake(cs, ev, { respawn: true });
  }

  /**
   * Puts the dragon inside the lair of home(): switches region when needed (region:enter with the given tag),
   * a pilot at the cave mouth (the same object if there is one), then enter(). Shared by respawn and hatch.
   */
  function wake(cs, ev, tag) {
    const d = cs.dragon, from = cs.region, to = home(), st = G.statsOf(d.stage);
    const R = T.region(to), s = R.spawn || { x: 0, z: 0, y: 100, yaw: 0 };
    const m = mouthPos(to) || [s.x, Math.max(s.y, T.surfaceAt(to, s.x, s.z) + 40), s.z];
    if (to !== from || !cs.field) {
      cs.region = to;
      cs.field = PR.spawnRegion(to, cs.rng, m);
      ev.push(Object.assign({ e: 'region:enter', region: to, from }, tag));
    }
    const stamina = d.pilot ? d.pilot.st : 100;
    const np = F.newPilot(m.slice(), s.yaw || 0, st.cruise);
    np.st = stamina;
    if (d.pilot) Object.assign(d.pilot, np); else d.pilot = np;      // same object: the renderer keeps its reference
    cs.exit = null; cs.exitT = 0;
    ev.push(...enter(cs).map(e => (e.e === 'lair:enter' ? Object.assign(e, tag) : e)));
    return ev;
  }

  /**
   * New hatchling (first start): the egg breaks inside the lair, the panel opens, and the mother is there with it.
   * Events: [region:enter,] lair:enter (hatch: true), mother:handover (lesson 0, at 'lair').
   */
  function hatch(cs) {
    cs.dragon.carried = null; cs.dragon.eatT = 0;
    const ev = wake(cs, [], { hatch: true });
    cs.story = cs.story || { act: 1 };
    cs.story.mother = { lesson: 0, at: 'lair' };
    ev.push({ e: 'mother:handover', lesson: 0, at: 'lair' });
    return ev;
  }

  M.define('lair', { mouthPos, distToMouth, inMouth, near, canEnter, enter, rest, eatFromLarder, leave, spoil, home, respawn, hatch });
})(typeof self !== 'undefined' ? self : this);
