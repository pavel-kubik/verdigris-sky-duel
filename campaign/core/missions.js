/*
 * Verdigris campaign - missions: catalogue, states, timer, objectives, success / fail (Phase 3 T10, 003_task_missions.md 4.5, 5.5).
 *   def(id) -> mission data | null            from data.missions
 *   list(cs) -> [{ id, def, ok, why }]        the board: why 'stage' (dragon too small), 'done' (completed), 'retry'
 *                                             (failed, needs a rest first), 'busy' (another mission is on), null = can accept
 *   accept(cs, id, opts?) -> events[]         'mission:accepted' or 'mission:refused' { why }; opts.force (debug) skips the stage lock
 *                                             only. cs.mission = { id, state: 'accepted', t, left, viaAerie }
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
 *   target(cs) -> null | { id, region, x, z, kind, r }   r: the world ring radius (building r + mission.ring.pad, at least ring.min)   T11: where the objective is (the compass and map gold marker) while
 *                                             the mission is accepted or running; null once done (fly home) or for an
 *                                             intercept before the caravan exists (T15 sets cs.caravan... { pos })
 *   objective(cs) -> null | { key, p }        T11: i18n key of the HUD objective line ('c.mission.obj.<type>' while
 *                                             accepted / running, 'c.mission.obj.home' once done; T13: 'c.mission.obj.homeAerie'
 *                                             { region } once done while the aerie of the current region is found - the escape)
 *                                             accepted / running, 'c.mission.obj.home' once done)
 *   holds(cs, region, id) -> bool            T14: the active destroy mission holds its target as a ruin (state.js skips
 *                                             fire.rebuild for it until the mission succeeds or fails); accept() of a destroy
 *                                             mission whose target is already a ruin rebuilds it first ('building:rebuilt' { mission })
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
    if (w && !(w === 'stage' && opts && opts.force)) return [{ e: 'mission:refused', id, why: w }];
    cs.mission = { id, state: 'accepted', t: m.time, left: m.time, viaAerie: !!cs.inAerie, stopped: false };
    const ev = [{ e: 'mission:accepted', id, time: m.time }];
    if (m.type === 'destroy') for (const e of restore(cs, m)) ev.push(e);
    return ev;
  }

  /* ---------- T14: the destroy target ---------- */
  /** A destroy target that is already a ruin (or charred) when the mission is accepted: the Order has rebuilt it, so the
   *  mission can be met ('building:rebuilt' { mission }). Clears it from the region's ruins and from the loaded town. */
  function restore(cs, m) {
    const ev = [], rs = cs.regionStates && cs.regionStates[m.region];
    let was = false;
    if (rs && rs.ruins && rs.ruins.some(r => r.id === m.target)) { rs.ruins = rs.ruins.filter(r => r.id !== m.target); was = true; }
    const town = cs.town && cs.town.region === m.region ? cs.town : null;
    const b = town && town.buildings.find(q => q.id === m.target);
    if (b && (b.ruin || b.char || b.fire > 0)) {
      const B = D.buildings[b.type] || {};
      b.ruin = false; b.ruinAt = null; b.char = false; b.charAt = null; b.fire = 0; b.heat = 0;
      b.hp = B.stone && B.woodHp > 0 ? B.woodHp : B.hp;
      was = true;
    }
    if (was) ev.push({ e: 'building:rebuilt', id: m.target, region: m.region, mission: m.id });
    return ev;
  }
  /** Is building `id` of `region` held as a ruin by the active destroy mission? (no fire.rebuild until it is over) */
  function holds(cs, region, id) {
    const a = active(cs), m = a && def(a.id);
    return !!(m && m.type === 'destroy' && m.region === region && m.target === id);
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
    for (const e of AL.add(rs, 'mission', cs.stats.played, MS().alertOnFail)) ev.push(Object.assign(e, { region: reg }));
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

  /* ---------- T11: target marker and objective line ---------- */
  const towns = {};                                       // region -> settlement.build (positions are seeded, so cached)
  function buildingPos(cs, region, id) {
    const SE = M.need('settlement');
    const town = cs.town && cs.town.region === region ? cs.town : (towns[region] = towns[region] || SE.build(region));
    const b = town.buildings.find(x => x.id === id);
    return b ? [b.pos[0], b.pos[2], b.r] : null;
  }
  function target(cs) {
    const a = active(cs);
    if (!a || a.state === 'done') return null;
    const m = def(a.id);
    if (!m) return null;
    if (m.type === 'intercept') {                          // T15: the moving wagon
      const cv = cs.caravans && cs.caravans[m.caravan];
      return cv && cv.pos ? { id: a.id, region: cv.region || m.region, x: cv.pos[0], z: cv.pos[2], kind: m.type, r: MS().ring.min } : null;
    }
    const q = m.target && buildingPos(cs, m.region, m.target);
    return q ? { id: a.id, region: m.region, x: q[0], z: q[1], kind: m.type, r: Math.max(MS().ring.min, (q[2] || 0) + MS().ring.pad) } : null;
  }
  function objective(cs) {
    const a = active(cs);
    if (!a) return null;
    const m = def(a.id);
    if (!m) return null;
    if (a.state === 'done') {                             // T13: the escape - a found aerie of this region is the near way out
      const AE = M.need('aerie');
      const s = !cs.inLair && !cs.inAerie && AE.site(cs.region);
      return s && AE.found(cs, cs.region) ? { key: 'c.mission.obj.homeAerie', p: { region: 'c.region.' + cs.region } } : { key: 'c.mission.obj.home' };
    }
    return { key: 'c.mission.obj.' + m.type, p: { region: 'c.region.' + m.region } };
  }

  M.define('missions', { def, list, accept, cancel, step, fail, finish, reward, timerState, active, target, objective, holds });
})(typeof self !== 'undefined' ? self : this);
