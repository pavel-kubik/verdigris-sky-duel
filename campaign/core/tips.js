/*
 * Verdigris campaign - one-time tips (Phase 2 T23, 002_task_kingdom.md section 7).
 * Each tip in data.tips.order shows once per save, when its condition holds, no mother lesson runs and at least
 * her caption is off, data.tips.gap s of play passed since the last tip (or the start). Seen ids live in cs.flags.tips (saved).
 *   due(cs) -> id | null           the first unseen tip whose condition holds now (ignores the gap)
 *   step(cs, ev, dt) -> events     'tip' { id } at most once per gap; marks it seen
 *   seen(cs, id) / mark(cs, id)    read / set one id; reset(cs) forgets all (debug)
 * Conditions (cs only):
 *   land     flying near the ground where landing works (the land prompt shows)
 *   compass  outside, hungry (hunger <= tips.hungry): the compass shows prey scent
 *   cave     in the cave (the stations are nest, larder, hoard, altar; the client hides it while a panel is open)
 *   raid     outside, a settlement was discovered
 *   alert    the current region is on alert (level 1+)
 *   night    outside at night
 *   altar    the hoard holds enough gold for an upgrade not yet owned
 *   farm     a Drake outside the Farmlands (the exit opens); the Farmlands themselves mark it seen
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), CK = M.need('clock'), AL = M.need('alert'), MO = M.need('mother');

  const list = cs => (cs.flags.tips = Array.isArray(cs.flags.tips) ? cs.flags.tips : []);
  const seen = (cs, id) => list(cs).indexOf(id) >= 0;
  function mark(cs, id) { if (!seen(cs, id)) list(cs).push(id); }
  function reset(cs) { cs.flags.tips = []; cs.tipT = 0; }

  /** The mother teaches (a lesson runs) or speaks (her caption shares the tip's place on a phone): no tip now. */
  function lessonOn(cs) {
    const m = cs.story && cs.story.mother;
    return (!!m && m.lesson < D.mother.lessons.length) || !!MO.line(cs);
  }
  const outside = cs => !cs.inLair && !!cs.dragon.pilot;
  function cheapest(cs) {
    const own = cs.upgrades || [];
    let c = Infinity;
    for (const id of Object.keys(D.upgrades)) if (own.indexOf(id) < 0) c = Math.min(c, D.upgrades[id].cost);
    return c;
  }

  const WHEN = {
    land: cs => outside(cs) && cs.hint === 'land',
    compass: cs => outside(cs) && cs.dragon.hunger <= D.tips.hungry,
    cave: cs => !!cs.inLair,
    raid: cs => outside(cs) && Object.keys(cs.discovered || {}).some(k => cs.discovered[k]),
    alert: cs => !!(cs.regionStates && cs.regionStates[cs.region]) && AL.level(cs.regionStates[cs.region]) >= 1,
    night: cs => outside(cs) && !!cs.clock && CK.phase(cs.clock.t) === 'night',
    altar: cs => !!cs.hoard && (cs.hoard.gold || 0) >= cheapest(cs),
    farm: cs => outside(cs) && cs.dragon.stage >= 1 && cs.region !== 'farm',
  };

  function due(cs) {
    if (lessonOn(cs)) return null;
    for (const id of D.tips.order) if (!seen(cs, id) && WHEN[id] && WHEN[id](cs)) return id;
    return null;
  }

  function step(cs, ev, dt) {
    if (cs.region === 'farm') mark(cs, 'farm');                 // found the Farmlands on its own
    if (lessonOn(cs)) { cs.tipT = 0; return []; }               // the mother teaches; the gap starts after her lessons
    cs.tipT = (cs.tipT || 0) + dt;
    if (cs.tipT < D.tips.gap) return [];
    const id = due(cs);
    if (!id) return [];
    mark(cs, id); cs.tipT = 0;
    return [{ e: 'tip', id }];
  }

  M.define('tips', { due, step, seen, mark, reset, conditions: Object.keys(WHEN) });
})(typeof self !== 'undefined' ? self : this);
