/*
 * Verdigris campaign - relics and the trophy wall (Phase 3 T12, 003_task_missions.md 4.5, 5.5).
 * A relic is a mission prize: loot kind 'relic' (data.loot.relic) lying at the door of its mission's target building
 * (core/loot.js place: item.relic, item.mission). It is only there while that mission is on (accepted, running or done)
 * and the relic is not in the hoard; carrying it slows the dragon (carry.speedMult) and blocks the breath (loot.effects).
 * Death loses it (loot.lose), a mission timeout makes it vanish (missions.fail); both put it back at the door.
 * Banked in the lair or an aerie it goes into hoard.relics and onto the trophy wall (cave station 'trophy').
 *   def(id) -> data.relics[id] | null
 *   ids() -> [relic ids]                   catalogue order
 *   owned(cs) -> [relic ids]               hoard.relics
 *   has(cs, id) -> bool
 *   missionOf(id) -> mission data | null   the mission whose prize it is
 *   wanted(cs, id) -> bool                 its mission is on and it is not owned: the relic lies at its door
 *   carrying(cs) -> relic id | null        the relic in the claws
 *   carry(cs) -> { speedMult, breath } | null   the carry rules while a relic is in the claws (data.loot.relic.carry)
 *   sync(cs) -> items                      sets item.hidden on the relic items of cs.town (not wanted, or in the claws)
 *   wall(cs) -> [{ niche, id, has, color }] the trophy wall: one entry per niche (data.trophy.niches), id null if empty
 *   giveDebug(cs) -> events                debug: the first not owned relic into the claws (its mission accepted, forced)
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  const MS = () => M.need('missions');                     // lazy: missions.js loads after relics.js

  const def = id => (D.relics && D.relics[id]) || null;
  const ids = () => Object.keys(D.relics || {});
  const owned = cs => (cs.hoard && cs.hoard.relics) || [];
  const has = (cs, id) => owned(cs).indexOf(id) >= 0;
  const missionOf = id => (D.missions || []).find(m => m.relic === id) || null;

  function wanted(cs, id) {
    if (has(cs, id)) return false;
    const m = missionOf(id), a = MS().active(cs);
    return !!(m && a && a.id === m.id);
  }
  const carrying = cs => (cs.carriedLoot && cs.carriedLoot.relic) || null;
  const carry = cs => (carrying(cs) ? Object.assign({}, D.loot.relic.carry) : null);

  function sync(cs) {
    const items = (cs.town && cs.town.items) || [], held = cs.carriedLoot && cs.carriedLoot.id;
    for (const it of items) if (it.relic) it.hidden = !wanted(cs, it.relic) || it.id === held;
    return items;
  }

  function wall(cs) {
    const n = (D.trophy && D.trophy.niches) || 0, out = [];
    for (let i = 0; i < n; i++) {
      const id = ids().find(r => def(r).niche === i) || null;
      out.push({ niche: i, id, has: !!(id && has(cs, id)), color: id ? def(id).color : null });
    }
    return out;
  }

  function giveDebug(cs) {
    const id = ids().find(r => !has(cs, r));
    if (!id || cs.carriedLoot || cs.inLair) return [];
    const m = missionOf(id), ev = [];
    const a = MS().active(cs);
    if (m && !(a && a.id === m.id)) { if (a) return []; ev.push(...MS().accept(cs, m.id, { force: true })); }
    cs.carriedLoot = { id: (m && m.target ? m.target : 'debug') + '.relic', kind: 'relic', gold: 0, size: D.loot.relic.size, region: cs.region, relic: id, mission: m ? m.id : null };
    ev.push({ e: 'loot:taken', id: cs.carriedLoot.id, kind: 'relic', relic: id, gold: 0, debug: true });
    return ev;
  }

  M.define('relics', { def, ids, owned, has, missionOf, wanted, carrying, carry, sync, wall, giveDebug });
})(typeof self !== 'undefined' ? self : this);
