/*
 * Verdigris campaign - upgrades bought with hoard gold at the cave altar (Phase 2 T20, 002_task_kingdom.md 4.6 and 5.6).
 * cs.upgrades = owned upgrade ids (data.upgrades order, saved). Each upgrade is bought once.
 *   list() -> ids                       the catalogue in altar order
 *   has(cs, id) -> bool
 *   canBuy(cs, id) -> { ok, why? }      why: 'unknown' | 'owned' | 'gold'
 *   buy(cs, id) -> { ok, why?, events } gold out of cs.hoard (never below 0): 'upgrade:bought' { id, cost, gold }
 *   affordable(cs) -> ids               not owned and within the gold (the altar runes glow)
 *   effects(cs | ids) -> eff            the owned effects merged on NONE: numbers multiply, flags OR
 *   apply(eff, up) -> eff               hunger / carry effects x the stamina upgrades (stRegenMult, boostSt, takeoffSt)
 * Readers: flight / walk (stamina via apply), prey.cook (cookRate), settlement.burn (burnRate), state.defend
 * (arrowDamage, boltDamage), nav (smellRange, smellType), the renderer (preyHighlight, showCones).
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');

  const NONE = Object.freeze({ smellRange: 1, smellType: false, preyHighlight: false, arrowDamage: 1, boltDamage: 1,
    stRegen: 1, boostSt: 1, takeoffSt: 1, cookRate: 1, burnRate: 1, showCones: false });

  const list = () => Object.keys(D.upgrades);
  const owned = x => (Array.isArray(x) ? x : (x && x.upgrades) || []);
  const has = (cs, id) => owned(cs).indexOf(id) >= 0;
  const gold = cs => Math.max(0, (cs.hoard && cs.hoard.gold) || 0);

  function canBuy(cs, id) {
    const U = D.upgrades[id];
    if (!U) return { ok: false, why: 'unknown' };
    if (has(cs, id)) return { ok: false, why: 'owned' };
    if (gold(cs) < U.cost) return { ok: false, why: 'gold' };
    return { ok: true };
  }

  function buy(cs, id) {
    const c = canBuy(cs, id);
    if (!c.ok) return { ok: false, why: c.why, events: [] };
    const U = D.upgrades[id];
    cs.hoard = cs.hoard || { gold: 0, relics: [] };
    cs.hoard.gold = Math.max(0, gold(cs) - U.cost);
    cs.upgrades = owned(cs).concat([id]);
    return { ok: true, events: [{ e: 'upgrade:bought', id, cost: U.cost, gold: cs.hoard.gold }] };
  }

  const affordable = cs => list().filter(id => canBuy(cs, id).ok);

  function effects(x) {
    const out = Object.assign({}, NONE);
    for (const id of owned(x)) {
      const U = D.upgrades[id];
      if (!U) continue;
      for (const k in U.effect) {
        const v = U.effect[k];
        if (typeof v === 'boolean') out[k] = out[k] || v;
        else out[k] = (typeof out[k] === 'number' ? out[k] : 1) * v;
      }
    }
    return out;
  }

  function apply(eff, up) {
    if (!up) return eff;
    return Object.assign({}, eff, { stRegenMult: (eff.stRegenMult == null ? 1 : eff.stRegenMult) * up.stRegen,
      boostSt: (eff.boostSt || 1) * up.boostSt, takeoffSt: (eff.takeoffSt || 1) * up.takeoffSt });
  }

  M.define('upgrades', { NONE, list, has, canBuy, buy, affordable, effects, apply });
})(typeof self !== 'undefined' ? self : this);
