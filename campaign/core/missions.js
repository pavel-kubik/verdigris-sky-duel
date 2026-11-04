/*
 * Verdigris campaign - missions: catalogue, states, timer, objectives, success / fail (Phase 3 T10, 003_task_missions.md 4.5, 5.5).
 *   def(id) -> mission data | null            from data.missions
 *   list(cs) -> [{ id, def, ok, why }]        the board: why 'stage' (dragon too small), 'done' (completed), 'retry'
 *                                             (failed, needs a rest first), 'busy' (another mission is on), null = can accept
 *   accept(cs, id, opts?) -> events[]         'mission:accepted' or 'mission:refused' { why }; opts.force (debug) skips the rules
 *                                             except 'busy'. cs.mission = { id, state: 'accepted', t, left, viaAerie }
 *   cancel(cs) -> events[]                    only before the timer runs (state 'accepted'): 'mission:cancelled'
 *   step(cs, dt, ev) -> events[]              once per frame after the rest of state.step, with that frame's events ev:
 *     - accepted -> running when the dragon is outside and has left the lair region or an aerie ('mission:started')
 *     - the timer runs only outside: not in the lair, not in an aerie, not while cs.loading, not in a frame with region:enter
 *     - objective events: steal = 'loot:taken' of the relic (e.relic or e.kind === relic id); destroy = 'building:ruined' /
 *       'building:charred' of the target; intercept = 'caravan:stopped' then 'loot:taken' with e.mission = this id (T15)
 *       -> state 'done' ('mission:done'); mission loot lost or dropped again -> back to 'running'
 *     - done and inside the lair or an aerie -> success: gold x (1 + bonus x floor(left / bonusPer)) into the hoard,
 *       the relic into hoard.relics ('mission:success' { id, gold, base, bonus, left })
 *     - 'dragon:died' -> fail 'death'; timer at 0 -> fail 'timeout'
 *   fail(cs, why) -> events[]                 mission loot in the claws vanishes ('loot:vanished'), region heat + alertOnFail,
 *                                             retry after the next rest (failedAt[id] = cs.flags.rested): 'mission:failed' { id, why }
 *   finish(cs) -> events[]                    debug: the objective counts as met ('mission:done')
 *   timerState(cs) -> null | { left, level: 'ok' | 'warn' | 'danger', running }   for the HUD (T11)
 * cs.missions = { completed: [ids], failedAt: { id: rested count at the fail } } (saved).
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), AL = M.need('alert');
  const LR = () => M.need('lair');

  const MS = () => D.mission;
  const def = id => (D.missions || []).find(m => m.id === id) || null;
  const book = cs => (cs.missions = cs.missions || { completed: [], failedAt: {} });
  const ON = { accepted: true, running: true, done: true };
  const active = cs => (cs.mission && ON[cs.mission.state] ? cs.mission : null);
  const rested = cs => (cs.flags && cs.flags.rested) || 0;

  function why(cs, m) {
    const b = book(cs);
    if (active(cs)) return 'busy';
    if (b.completed.indexOf(m.id) >= 0) return 'done';
    if ((cs.dragon.stage || 0) < (m.minStage || 0)) return 'stage';
    if (m.id in b.failedAt && rested(cs) <= b.failedAt[m.id]) return 'retry';
    return null;
  }

  function list(cs) {
    return (D.missions || []).map(m => { const w = why(cs, m); return { id: m.id, def: m, ok: !w, why: w }; });
  }

  function accept(cs, id, opts) {
    const m = def(id);
    if (!m) return [{ e: 'mission:refused', id, why: 'unknown' }];
    const w = why(cs, m);
    if (w && (w === 'busy' || !(opts && opts.force))) return [{ e: 'mission:refused', id, why: w }];
    cs.mission = { id, state: 'accepted', t: m.time, left: m.time, viaAerie: !!cs.inAerie, stopped: false };
    return [{ e: 'mission:accepted', id, time: m.time }];
  }

  function cancel(cs) {
    const a = active(cs);
    if (!a || a.state !== 'accepted') return [];
    cs.mission = null;
    return [{ e: 'mission:cancelled', id: a.id }];
  }

  const isMissionLoot = (cs, l) => !!(l && (l.mission || l.kind === 'relic'));

  function fail(cs, reason) {
    const a = active(cs);
    if (!a) return [];
    const m = def(a.id), ev = [];
    if (isMissionLoot(cs, cs.carriedLoot)) { ev.push({ e: 'loot:vanished', kind: cs.carriedLoot.kind, id: cs.carriedLoot.id }); cs.carriedLoot = null; }
    const reg = (m && m.region) || cs.region;
    const rs = cs.regionStates[reg] = cs.regionStates[reg] || {};
    ev.push(...AL.add(rs, 'mission', cs.stats.played, MS().alertOnFail));
    book(cs).failedAt[a.id] = rested(cs);
    cs.mission = null;
    ev.push({ e: 'mission:failed', id: a.id, why: reason || 'timeout', left: Math.max(0, a.left) });
    return ev;
  }

  function reward(m, left) {
    const base = (m.reward && m.reward.gold) || 0, steps = Math.floor(Math.max(0, left) / MS().bonusPer);
    const gold = Math.round(base * (1 + MS().bonus * steps));
    return { base, gold, bonus: gold - base };
  }

  function succeed(cs) {
    const a = active(cs), m = def(a.id), r = reward(m, a.left);
    cs.hoard = cs.hoard || { gold: 0, relics: [] };
    cs.hoard.gold += r.gold;
    if (m.relic && cs.hoard.relics.indexOf(m.relic) < 0) cs.hoard.relics.push(m.relic);
    const b = book(cs);
    if (b.completed.indexOf(a.id) < 0) b.completed.push(a.id);
    delete b.failedAt[a.id];
    cs.mission = null;
    return [{ e: 'mission:success', id: a.id, gold: r.gold, base: r.base, bonus: r.bonus, left: a.left, total: cs.hoard.gold }];
  }

  function finish(cs) {
    const a = active(cs);
    if (!a || a.state === 'done') return [];
    if (a.state === 'accepted') a.state = 'running';
    a.state = 'done';
    return [{ e: 'mission:done', id: a.id, debug: true }];
  }

  /** Does this event meet the objective of mission m? (intercept needs the caravan stopped first) */
  function meets(a, m, e) {
    if (m.type === 'steal') return e.e === 'loot:taken' && (e.relic === m.relic || e.kind === m.relic);
    if (m.type === 'destroy') return (e.e === 'building:ruined' || e.e === 'building:charred') && e.id === m.target;
    if (m.type === 'intercept') {
      if (e.e === 'caravan:stopped' && (!e.caravan || e.caravan === m.caravan)) a.stopped = true;
      return a.stopped && e.e === 'loot:taken' && e.mission === m.id;
    }
    return false;
  }
  const undoes = (m, e) => m.type !== 'destroy' && (e.e === 'loot:lost' || e.e === 'loot:dropped');

  const inside = cs => !!(cs.inLair || cs.inAerie);

  function step(cs, dt, ev) {
    const a = active(cs);
    if (!a) return [];
    const m = def(a.id);
    if (!m) { cs.mission = null; return []; }
    ev = ev || [];
    const out = [];
    if (ev.some(e => e.e === 'dragon:died')) return fail(cs, 'death');
    if (a.state === 'accepted') {
      if (cs.inAerie) a.viaAerie = true;
      if (!inside(cs) && (a.viaAerie || cs.region !== LR().home())) { a.state = 'running'; out.push({ e: 'mission:started', id: a.id, time: a.left }); }
    }
    if (a.state === 'running' || a.state === 'done') {
      for (const e of ev) {
        if (a.state === 'running' && meets(a, m, e)) { a.state = 'done'; out.push({ e: 'mission:done', id: a.id }); }
        else if (a.state === 'done' && undoes(m, e)) { a.state = 'running'; out.push({ e: 'mission:undone', id: a.id }); }
      }
      if (a.state === 'done' && inside(cs)) return out.concat(succeed(cs));
      const paused = inside(cs) || cs.loading || ev.some(e => e.e === 'region:enter');
      if (!paused && dt > 0) {
        a.left -= dt;
        if (a.left <= 0) { a.left = 0; return out.concat(fail(cs, 'timeout')); }
      }
    }
    return out;
  }

  function timerState(cs) {
    const a = active(cs);
    if (!a) return null;
    const lv = a.left <= MS().danger ? 'danger' : a.left <= MS().warn ? 'warn' : 'ok';
    return { id: a.id, left: a.left, level: lv, running: a.state !== 'accepted' && !inside(cs), state: a.state };
  }

  M.define('missions', { def, list, accept, cancel, step, fail, finish, reward, timerState, active });
})(typeof self !== 'undefined' ? self : this);
