/*
 * Verdigris campaign - aeries: small cliff caves outside the Ash Wastes (Phase 3 T08, 003_task_missions.md 4.4, 5.4).
 *   site(regionId) -> null | { id, region, x, z, facing, ground, mouth: [x, y, z], dir: [dx, dz] }
 *                                             the aerie of a region (id '<region>.aerie'), mouth on a ledge `above` the ground
 *   found(cs, regionId?) -> bool              discovered for good (cs.discovered['<region>.aerie'], saved with the settlements)
 *   discover(cs) -> events[]                  within aeries.discover and in line of sight (nav.seesPlace): 'aerie:found'
 *   distToMouth(cs) -> units                  from the dragon to the mouth of this region's aerie (Infinity without one)
 *   near(cs) / canEnter(cs) / inMouth(cs)     heading toward a found mouth within nearRange / enterRange (the Move slot's
 *                                             "Enter aerie") / inside the mouth sphere (mouthR x scale: flying in enters)
 *   enter(cs) -> events[]                     cs.inAerie = region; carried loot is banked ('hoard:banked' from 'aerie');
 *                                             the dragon rests on the ledge, the world outside is paused (state.step)
 *   rest(cs) -> events[]                      HP and stamina to max, no stage-up (that stays at the nest): 'aerie:rest' (autosave)
 *   leave(cs) -> events[]                     back in the air in front of the mouth, facing out: 'aerie:leave'
 * Finding an aerie also counts before entering (it is a place on the compass and the map).
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), F = M.need('flight'), LT = M.need('loot'), NV = M.need('nav');

  const A = () => D.aeries;
  const cache = {};

  function site(regionId) {
    if (regionId in cache) return cache[regionId];
    const s = A()[regionId];
    if (!s || typeof s !== 'object' || s.x == null || !D.regions[regionId]) return (cache[regionId] = null);
    const ground = T.surfaceAt(regionId, s.x, s.z);
    return (cache[regionId] = { id: regionId + '.aerie', region: regionId, x: s.x, z: s.z, facing: s.facing || 0, ground,
                                mouth: [s.x, ground + A().above, s.z], dir: [Math.sin(s.facing || 0), Math.cos(s.facing || 0)] });
  }

  const found = (cs, regionId) => { const s = site(regionId || cs.region); return !!(s && cs.discovered && cs.discovered[s.id]); };
  const scaleOf = cs => cs.debugScale || G.scaleOf(cs.dragon.foodXp, cs.dragon.stage);

  function discover(cs) {
    const s = site(cs.region), p = cs.dragon.pilot;
    if (!s || !p || cs.inLair || cs.inAerie || found(cs)) return [];
    if (Math.hypot(p.pos[0] - s.x, p.pos[2] - s.z) > A().discover) return [];
    if (!NV.seesPlace(cs.region, p.pos, { x: s.x, z: s.z, y: s.ground })) return [];
    if (!cs.discovered) cs.discovered = {};
    cs.discovered[s.id] = true;
    return [{ e: 'aerie:found', id: s.id, region: cs.region }];
  }

  function distToMouth(cs) {
    const s = site(cs.region), p = cs.dragon.pilot;
    if (!s || !p) return Infinity;
    return Math.hypot(p.pos[0] - s.mouth[0], p.pos[1] - s.mouth[1], p.pos[2] - s.mouth[2]);
  }

  /** Close to a found mouth and heading roughly toward it (leaving does not show the prompt). */
  function near(cs) {
    if (cs.inLair || cs.inAerie || !found(cs) || !(distToMouth(cs) < A().nearRange)) return false;
    const s = site(cs.region), p = cs.dragon.pilot;
    return Math.cos(Math.atan2(s.mouth[0] - p.pos[0], s.mouth[2] - p.pos[2]) - p.yaw) > 0.3;
  }
  const canEnter = cs => near(cs) && distToMouth(cs) < A().enterRange;
  const inMouth = cs => !cs.inLair && !cs.inAerie && found(cs) && distToMouth(cs) < A().mouthR * Math.max(1, scaleOf(cs) * 0.8);

  function enter(cs) {
    const s = site(cs.region), d = cs.dragon, p = d.pilot;
    if (!s || !p) return [];
    const ev = [{ e: 'aerie:enter', id: s.id, region: cs.region }];
    for (const e of LT.bank(cs)) ev.push(Object.assign(e, { at: 'aerie' }));
    cs.inAerie = cs.region;
    cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null; cs.fireMem = null; cs.hint = null;
    cs.exit = null; cs.exitT = 0;
    d.eatT = 0;
    p.breathing = false; p.boosting = false;
    p.pos[0] = s.mouth[0] - s.dir[0] * 4; p.pos[1] = s.mouth[1]; p.pos[2] = s.mouth[2] - s.dir[1] * 4;   // on the ledge inside the mouth
    p.yaw = s.facing;
    return ev;
  }

  function rest(cs) {
    if (!cs.inAerie) return [];
    const d = cs.dragon;
    d.hp = G.statsOf(d.stage).hpMax;
    if (d.pilot) d.pilot.st = 100;
    cs.flags.rested = (cs.flags.rested || 0) + 1;                 // missions: retry after a rest (T10)
    return [{ e: 'aerie:rest', region: cs.inAerie }];
  }

  function leave(cs) {
    const s = site(cs.inAerie || cs.region), d = cs.dragon;
    if (!cs.inAerie || !s) { cs.inAerie = null; return []; }
    const x = s.mouth[0] + s.dir[0] * A().out, z = s.mouth[2] + s.dir[1] * A().out;
    const y = Math.max(s.mouth[1] + A().outY, T.surfaceAt(s.region, x, z) + 30);
    const st = d.pilot ? d.pilot.st : 100;
    const np = F.newPilot([x, y, z], s.facing, G.statsOf(d.stage).cruise);
    np.st = st;
    if (d.pilot) Object.assign(d.pilot, np); else d.pilot = np;    // same object: the renderer keeps its reference
    cs.inAerie = null;
    return [{ e: 'aerie:leave', id: s.id, region: s.region }];
  }

  M.define('aerie', { site, found, discover, distToMouth, near, canEnter, inMouth, enter, rest, leave });
})(typeof self !== 'undefined' ? self : this);
