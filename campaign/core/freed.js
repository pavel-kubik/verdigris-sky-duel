/*
 * Verdigris campaign - freed villages and tribute (Phase 3 T16, 003_task_missions.md 5.7).
 * A settlement listed in data.freed.places (the Farmlands village) is freed when every Order building of it (tax house,
 * tower, the alert-3 ballista platform when it stands) is burned out and none of its archers or ballista crews is
 * alive at the same time. Freed for good: saved in cs.regionStates[region].freed ([place ids]); settlement.build marks
 * the place (pl.freed), its Order buildings are not rebuilt and the alert-3 platform is not built there, no archers
 * spawn there and its peasants stay calm (no bell), the Order flag falls (render/settlement-view.js).
 *   freeable(placeId) -> bool          the place can be freed (data.freed.places)
 *   isFreed(cs, placeId) -> bool       saved as freed
 *   freedAll(cs) -> [place ids]        every freed place of every region
 *   orderOf(town, placeId) -> [buildings]   its Order buildings
 *   ready(town, squad, placeId) -> bool     the freeing rule (squad = the town's defenders; null = none spawned yet)
 *   step(cs) -> events[]               the current town: a freeable place that meets the rule is freed now
 *                                      ('settlement:freed' { place, region, pos })
 *   tribute(cs, dt) -> events[]        while any place is freed: every tribute.every s of play a carcass
 *                                      ({ type: tribute.prey, food: tribute.food, tribute: true }) goes into the larder,
 *                                      at most tribute.max tribute carcasses waiting and never past the larder size;
 *                                      cs.tributeT counts the s ('tribute:arrived' { food, place })
 *   freeDebug(cs) -> events[]          debug: the freeable place of this region - its Order buildings become ruins, its
 *                                      archers fall, then step() frees it
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), SE = M.need('settlement');

  const freeable = id => ((D.freed && D.freed.places) || []).indexOf(id) >= 0;
  const regionOf = id => String(id).split('.')[0];
  const rsOf = (cs, rid) => (cs.regionStates && cs.regionStates[rid]) || null;
  function isFreed(cs, id) {
    const rs = rsOf(cs, regionOf(id));
    return !!(rs && Array.isArray(rs.freed) && rs.freed.indexOf(id) >= 0);
  }
  function freedAll(cs) {
    const out = [];
    for (const rid in cs.regionStates || {}) for (const id of (cs.regionStates[rid] && cs.regionStates[rid].freed) || []) out.push(id);
    return out;
  }
  const orderOf = (town, id) => ((town && town.buildings) || []).filter(b => b.place === id && D.buildings[b.type] && D.buildings[b.type].order);

  function ready(town, squad, id) {
    const own = orderOf(town, id);
    if (!own.length || !own.every(SE.burnedOut)) return false;
    if (!squad || squad.town !== town) return false;           // the defenders of this town are not out yet
    return !squad.list.some(d => d.place === id && d.kind !== 'peasant' && !d.patrol && d.alive);
  }

  function step(cs) {
    const ev = [], town = cs.town;
    if (!town || town.region !== cs.region) return ev;
    for (const pl of town.places) {
      if (pl.freed || !freeable(pl.id)) continue;
      if (isFreed(cs, pl.id)) { pl.freed = true; continue; }
      if (!ready(town, cs.squad, pl.id)) continue;
      const rs = cs.regionStates[cs.region] = cs.regionStates[cs.region] || {};
      rs.freed = (rs.freed || []).concat([pl.id]);
      pl.freed = true;
      ev.push({ e: 'settlement:freed', place: pl.id, type: pl.type, region: cs.region, pos: [pl.x, pl.y || 0, pl.z] });
    }
    return ev;
  }

  function tribute(cs, dt) {
    const ev = [], R = D.tribute, all = freedAll(cs);
    if (!all.length) { cs.tributeT = 0; return ev; }
    cs.tributeT = (cs.tributeT || 0) + dt;
    if (cs.tributeT < R.every) return ev;
    const waiting = cs.larder.filter(it => it.tribute).length;
    if (waiting >= R.max || cs.larder.length >= D.lair.larderSize) { cs.tributeT = R.every; return ev; }   // waits for room
    cs.tributeT -= R.every;
    cs.larder.push({ type: R.prey, food: R.food, tribute: true });
    ev.push({ e: 'tribute:arrived', food: R.food, type: R.prey, place: all[0] });
    return ev;
  }

  function freeDebug(cs) {
    const town = cs.town;
    const pl = town && town.places.find(q => freeable(q.id) && !q.freed);
    if (!pl) return [{ e: 'freed:none', region: cs.region }];
    const rs = cs.regionStates[cs.region] = cs.regionStates[cs.region] || {}, now = cs.stats.played;
    for (const b of orderOf(town, pl.id)) {
      if (SE.burnedOut(b)) continue;
      b.hp = 0; b.fire = 0; b.heat = 0; b.ruin = true; b.ruinAt = now;
      rs.ruins = (rs.ruins || []).filter(q => q.id !== b.id).concat([{ id: b.id, at: now }]);
    }
    for (const d of (cs.squad && cs.squad.town === town ? cs.squad.list : [])) {
      if (d.place === pl.id && d.kind !== 'peasant' && !d.patrol) { d.alive = false; d.down = true; }
    }
    return step(cs);
  }

  M.define('freed', { freeable, isFreed, freedAll, orderOf, ready, step, tribute, freeDebug });
})(typeof self !== 'undefined' ? self : this);
