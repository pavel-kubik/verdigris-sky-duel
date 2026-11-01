/*
 * Verdigris campaign - the save: serialise / deserialise / migrate, and a storage adapter.
 * See 001_task_survival.md 5.9 (v1) and 002_task_kingdom.md 5.9 (v2, T22).
 * v2 adds to world: mode ('air' | 'ground'; landing saves as ground, takeoff as air), location 'field' | 'cave'
 * (v1 wrote 'lair'), clock (time of day 0..1) and now (= stats.played, the stamp for ruins, loot and heat).
 * A ground save restores standing on the ground (on a roof when it stood on one); a cave save restores on the nest.
 *   serialise(cs) -> object              durable fields only (no prey field, pilot reduced to pos + yaw)
 *   migrate(obj) -> obj                  version chain up to data.version; throws 'newer' / 'corrupt'
 *   apply(cs, obj)                       writes a (migrated, checked) save INTO an existing cs (keeps object identity:
 *                                        the renderer holds cs and cs.dragon); a save without a position leaves
 *                                        cs.dragon.pilot null (the client places the dragon at the spawn)
 *   deserialise(obj, rng) -> cs          migrate + check + apply on a new CampaignState
 *   blank() -> obj                       the save of a new hatchling (no position)
 *   load(storage) -> { status, data?, raw? }   status 'none' | 'ok' | 'corrupt' | 'newer'; data is migrated and checked
 *   store(storage, cs) -> boolean        JSON under data.saveKey; false when storage throws (private mode, quota)
 *   clear(storage)
 * storage = window.localStorage or any { getItem, setItem, removeItem } stub (tests).
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), F = M.need('flight'), PR = M.need('prey'), S = M.need('state'), LR = M.need('lair'), CV = M.need('cave'), CK = M.need('clock'), WK = M.need('walk');

  const num = v => typeof v === 'number' && Number.isFinite(v);
  const round = (v, k) => Math.round(v * k) / k;
  function fail(code, why) { const e = new Error(code + (why ? ': ' + why : '')); e.code = code; throw e; }

  /** The story part of the save: the act and the mother's lesson state (null = no teacher, e.g. a phase 1 run). */
  function storyOf(st) {
    const m = st && st.mother;
    return { act: (st && st.act) || 1, mother: m ? { lesson: m.lesson | 0, at: m.at || 'lair' } : null };
  }

  function serialise(cs) {
    const d = cs.dragon, p = d.pilot;
    return {
      version: D.version,
      dragon: {
        growth: round(G.growthValue(d.foodXp), 1e4), stage: d.stage, foodXp: round(d.foodXp, 100),
        hp: round(d.hp, 100), hunger: round(d.hunger, 100), deaths: d.deaths || 0, upgrades: (cs.upgrades || []).filter(id => D.upgrades[id]),   // T20
        loot: cs.carriedLoot ? { id: cs.carriedLoot.id, kind: cs.carriedLoot.kind, region: cs.carriedLoot.region } : null,   // T19: in the claws
      },
      hoard: { gold: Math.max(0, Math.floor((cs.hoard && cs.hoard.gold) || 0)), relics: [] },   // T19
      larder: cs.larder.map(it => ({ prey: it.type, food: round(it.food, 100) })),
      renown: 0,
      regions: Object.keys(D.regions).reduce((o, id) => {              // T12: discovered settlements (the rest of v2 in T22)
        o[id] = {};
        const seen = Object.keys(cs.discovered || {}).filter(k => cs.discovered[k] && k.indexOf(id + '.') === 0).sort();
        if (seen.length) o[id].discovered = seen;
        const ruins = ((cs.regionStates && cs.regionStates[id] && cs.regionStates[id].ruins) || []).filter(r => r && typeof r.id === 'string');
        if (ruins.length) o[id].ruins = ruins.map(r => r.char ? { id: r.id, at: round(r.at || 0, 10), char: true } : { id: r.id, at: round(r.at || 0, 10) });   // T13 (v2 shape, 5.9); T06: char = a charred castle stone piece
        const corn = ((cs.regionStates && cs.regionStates[id] && cs.regionStates[id].corn) || []).filter(r => r && typeof r.id === 'string');
        if (corn.length) o[id].corn = corn.map(r => ({ id: r.id, at: round(r.at || 0, 10) }));       // burned corn fields
        const rs = cs.regionStates && cs.regionStates[id];
        const taken = ((rs && rs.lootTaken) || []).filter(r => r && typeof r.id === 'string');
        if (taken.length) o[id].lootTaken = taken.map(r => ({ id: r.id, at: round(r.at || 0, 10) }));   // T19 (v2 shape, 5.9)
        if (rs && rs.heat > 0) {                                     // T17: alert heat with its play-time stamps (5.9)
          o[id].heat = round(rs.heat, 1000);
          if (typeof rs.lastIncident === 'number') o[id].lastIncident = round(rs.lastIncident, 10);
          if (typeof rs.at === 'number') o[id].at = round(rs.at, 10);
        }
        return o;
      }, {}),
      missions: { completed: [], active: null },
      story: storyOf(cs.story),
      world: {
        region: cs.region,
        pos: p ? (cs.inLair && LR.mouthPos(cs.region) || p.pos).map(v => round(v, 100)) : null,   // inside: the mouth (cave coordinates are local)
        yaw: p ? round(p.yaw, 1e4) : 0,
        st: p ? round(p.st, 10) : 100,
        location: cs.inLair ? 'cave' : 'field',
        mode: p && !cs.inLair && (p.mode === 'ground' || p.mode === 'landing') ? 'ground' : 'air',   // T22: a landing ends on the ground
        clock: round(cs.clock ? cs.clock.t : CK.create().t, 1e5),          // T22: time of day
        now: round(cs.stats.played, 10),                                   // T22: the stamp of ruins, loot and heat (= stats.played)
      },
      flags: { introSeen: !!cs.flags.introSeen, rested: cs.flags.rested || 0, tips: (cs.flags.tips || []).filter(id => D.tips.order.indexOf(id) >= 0) },   // T23: seen tips
      stats: { played: round(cs.stats.played, 10), eaten: cs.stats.eaten, food: round(cs.stats.food, 100),
               civilBurned: cs.stats.civilBurned || 0, orderBurned: cs.stats.orderBurned || 0, livestockTaken: cs.stats.livestockTaken || 0,
               lootBanked: cs.stats.lootBanked || 0 },
    };
  }

  /** v0 -> v1, v1 -> v2, ... each step takes the previous shape. v0 is the flat pre-release shape. */
  const MIGRATIONS = {
    0: o => ({
      version: 1,
      dragon: { stage: o.stage | 0, foodXp: o.xp, hp: o.hp, hunger: o.hunger, deaths: 0, upgrades: [] },
      hoard: { gold: 0, relics: [] },
      larder: (o.larder || []).map(it => ({ prey: it.type, food: it.food })),
      renown: 0, regions: {}, missions: { completed: [], active: null }, story: { act: 1 },
      world: { region: o.region, pos: o.pos || null, yaw: o.yaw || 0, location: 'field' },
      flags: { introSeen: true }, stats: { played: 0, eaten: 0, food: 0 },
    }),
    /* v1 -> v2 (T22): the cave is 'cave', a v1 run restores in the air in the morning; everything else is already in the
       v2 shape (T12 - T20 wrote discovered, ruins, lootTaken, heat, hoard, upgrades and the carried loot into v1) */
    1: o => {
      const w = Object.assign({}, o.world || {});
      w.location = w.location === 'lair' ? 'cave' : 'field';
      w.mode = 'air';
      w.clock = CK.create().t;
      w.now = num(o.stats && o.stats.played) ? o.stats.played : 0;
      const d = Object.assign({ upgrades: [] }, o.dragon || {});
      const h = o.hoard && typeof o.hoard === 'object' ? o.hoard : { gold: 0, relics: [] };
      return Object.assign({}, o, { version: 2, dragon: d, hoard: h, regions: o.regions && typeof o.regions === 'object' ? o.regions : {}, world: w });
    },
  };

  function migrate(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('corrupt', 'not an object');
    let o = obj;
    let v = o.version == null ? 0 : o.version;
    if (!Number.isInteger(v) || v < 0) fail('corrupt', 'bad version');
    if (v > D.version) fail('newer', 'version ' + v);
    while (v < D.version) {
      if (!MIGRATIONS[v]) fail('corrupt', 'no migration from v' + v);
      o = MIGRATIONS[v](o);
      v = o.version;
    }
    return check(o);
  }

  /** Throws 'corrupt' when a field the game needs is missing or not a finite number; fills optional ones. */
  function check(o) {
    const d = o.dragon;
    if (!d || typeof d !== 'object') fail('corrupt', 'no dragon');
    for (const k of ['stage', 'foodXp', 'hp', 'hunger']) if (!num(d[k])) fail('corrupt', 'dragon.' + k);
    if (!Number.isInteger(d.stage) || d.stage < 0 || d.stage >= D.stages.length) fail('corrupt', 'dragon.stage');
    if (!Array.isArray(o.larder || [])) fail('corrupt', 'larder');
    const w = o.world || {};
    if (w.pos != null && !(Array.isArray(w.pos) && w.pos.length === 3 && w.pos.every(num))) fail('corrupt', 'world.pos');
    if (o.version >= 2) {                                        // T22: the v2 world fields, written by every v2 save
      if (w.mode !== 'air' && w.mode !== 'ground') fail('corrupt', 'world.mode');
      if (w.location !== 'field' && w.location !== 'cave') fail('corrupt', 'world.location');
      if (!num(w.clock) || w.clock < 0 || w.clock > 1) fail('corrupt', 'world.clock');
      if (w.now != null && !num(w.now)) fail('corrupt', 'world.now');
      if (o.hoard != null && (typeof o.hoard !== 'object' || (o.hoard.gold != null && !num(o.hoard.gold)))) fail('corrupt', 'hoard');
      if (o.regions != null && (typeof o.regions !== 'object' || Array.isArray(o.regions))) fail('corrupt', 'regions');
    }
    return o;
  }

  function apply(cs, o) {
    const d = cs.dragon, w = o.world || {};
    const region = D.regions[w.region] ? w.region : D.startRegion;
    const st = D.stages[o.dragon.stage];
    const hpMax = G.statsOf(o.dragon.stage).hpMax;
    Object.assign(d, {
      stage: o.dragon.stage,
      foodXp: Math.max(0, Math.min(D.growthCap.food, o.dragon.foodXp)),
      hp: Math.max(1, Math.min(hpMax, o.dragon.hp)),             // a save at 0 HP wakes the dragon instead of killing it again
      hunger: Math.max(0, Math.min(D.hunger.max, o.dragon.hunger)),
      deaths: num(o.dragon.deaths) ? o.dragon.deaths : 0,
      carried: null, eatT: 0,
    });
    cs.larder = (o.larder || []).filter(it => it && D.prey[it.prey] && num(it.food) && it.food > 0)
      .slice(0, D.lair.larderSize).map(it => ({ type: it.prey, food: it.food }));
    const f = o.flags || {};
    cs.flags = { introSeen: !!f.introSeen, heavyT: 0, rested: f.rested | 0,
                 tips: Array.isArray(f.tips) ? f.tips.filter((id, i) => typeof id === 'string' && D.tips.order.indexOf(id) >= 0 && f.tips.indexOf(id) === i) : [] };   // T23
    const s = o.stats || {};
    cs.stats = { played: num(s.played) ? s.played : 0, eaten: num(s.eaten) ? s.eaten : 0, food: num(s.food) ? s.food : 0,
                 civilBurned: num(s.civilBurned) ? s.civilBurned : 0, orderBurned: num(s.orderBurned) ? s.orderBurned : 0,
                 livestockTaken: num(s.livestockTaken) ? s.livestockTaken : 0, lootBanked: num(s.lootBanked) ? s.lootBanked : 0 };
    const h = o.hoard || {};                                     // T19: banked gold, never negative
    cs.hoard = { gold: num(h.gold) ? Math.max(0, Math.floor(h.gold)) : 0, relics: Array.isArray(h.relics) ? h.relics.slice() : [] };
    const dl = o.dragon.loot;                                    // T19: loot in the claws
    cs.carriedLoot = dl && typeof dl.id === 'string' && D.loot[dl.kind] && D.regions[dl.region]
      ? { id: dl.id, kind: dl.kind, gold: D.loot[dl.kind].gold, size: D.loot[dl.kind].size, region: dl.region } : null;
    cs.lootTarget = null;
    const ups = Array.isArray(o.dragon.upgrades) ? o.dragon.upgrades : [];   // T20: owned upgrades, known ids once each
    cs.upgrades = ups.filter((id, i) => typeof id === 'string' && D.upgrades[id] && ups.indexOf(id) === i);
    cs.story = storyOf(o.story);
    cs.discovered = {}; cs.regionStates = {};
    for (const id of Object.keys(o.regions || {})) {
      const r = o.regions[id];
      if (D.regions[id] && r && Array.isArray(r.discovered)) for (const k of r.discovered) if (typeof k === 'string' && k.indexOf(id + '.') === 0) cs.discovered[k] = true;
      if (D.regions[id] && r && Array.isArray(r.ruins)) {          // T13: burned buildings, rebuilt fire.rebuild s after `at`
        const ruins = r.ruins.filter(q => q && typeof q.id === 'string' && q.id.indexOf(id + '.') === 0 && num(q.at)).map(q => q.char === true ? { id: q.id, at: q.at, char: true } : { id: q.id, at: q.at });
        if (ruins.length) cs.regionStates[id] = { ruins };
      }
      if (D.regions[id] && r && Array.isArray(r.corn)) {           // burned corn fields, grow back corn.regrow s after `at`
        const corn = r.corn.filter(q => q && typeof q.id === 'string' && q.id.indexOf(id + '.') === 0 && num(q.at)).map(q => ({ id: q.id, at: q.at }));
        if (corn.length) (cs.regionStates[id] = cs.regionStates[id] || {}).corn = corn;
      }
      if (D.regions[id] && r && Array.isArray(r.lootTaken)) {      // T19: taken loot, back fire.rebuild s after `at`
        const taken = r.lootTaken.filter(q => q && typeof q.id === 'string' && q.id.indexOf(id + '.') === 0 && num(q.at)).map(q => ({ id: q.id, at: q.at }));
        if (taken.length) (cs.regionStates[id] = cs.regionStates[id] || {}).lootTaken = taken;
      }
      if (D.regions[id] && r && num(r.heat) && r.heat > 0) {        // T17: alert heat; decays from `at` on region load
        const q = cs.regionStates[id] = cs.regionStates[id] || {};
        q.heat = Math.min(D.alert.maxHeat, r.heat);
        if (num(r.lastIncident)) q.lastIncident = r.lastIncident;
        if (num(r.at)) q.at = r.at;
      }
    }
    cs.town = null; cs.crops = null;                             // rebuilt with the loaded ruins (state.ensureTown)
    cs.hint = null; cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null; cs.fireMem = null; cs.exit = null; cs.exitT = 0; cs.exitSmall = null; cs.exitSmallT = 0; cs.saveT = 0; cs.station = null;

    const pos = region === w.region && w.pos ? T.clampToRegion(region, w.pos.slice(), D.flight.minAlt) : null;
    cs.region = region;
    cs.field = PR.spawnRegion(region, cs.rng, pos);              // fresh prey field (prey is never saved), herds away from the dragon
    cs.inLair = !!pos && (w.location === 'cave' || w.location === 'lair') && !!T.region(region).lair;
    cs.clock = CK.create(num(w.clock) ? w.clock : null);         // T22: time of day (a v1 save starts in the morning)
    cs.light = CK.sight(cs.clock.t);
    if (pos) {
      const np = F.newPilot(pos, num(w.yaw) ? w.yaw : 0, st.cruise);
      if (num(w.st)) np.st = Math.max(0, Math.min(100, w.st));
      if (d.pilot) Object.assign(d.pilot, np); else d.pilot = np;   // same object: the renderer keeps its reference
      if (cs.inLair) CV.place(cs, 'nest');                       // T10: a save inside the lair restores in the cave, on the nest
      else if (w.mode === 'ground') standOn(cs, d.pilot);        // T22: a landed dragon wakes standing where it was
    } else d.pilot = null;
    return cs;
  }

  /** T22: put a restored pilot on the ground (terrain or a roof under it); over water it stays in the air. */
  function standOn(cs, p) {
    if (T.liquidAt(cs.region, p.pos[0], p.pos[2])) return false;
    const scale = S.scaleOf(cs), sol = S.solids(cs, scale);     // builds cs.town with the loaded ruins (and the alert catch-up)
    const ctx = { regionId: cs.region, solidAt: sol.solidAt, solidHit: sol.solidHit };
    Object.assign(p, { mode: 'ground', tr: null, speed: 0, vel: [0, 0, 0], pitch: 0, roll: 0, rollX: 0, sx: 0, boosting: false, breathing: false });
    p.pos[1] = WK.standY(ctx, p.pos[0], p.pos[2], scale);
    return true;
  }

  function deserialise(obj, rng) {
    const o = migrate(obj);
    return apply(S.create({ regionId: D.startRegion, rng }), o);
  }

  function blank() {
    const cs = { dragon: { pilot: null, stage: 0, foodXp: 0, hp: D.stages[0].hp, hunger: D.hunger.start, deaths: 0 },
      larder: [], region: D.startRegion, inLair: false, flags: {}, stats: { played: 0, eaten: 0, food: 0 }, story: null };
    return serialise(cs);
  }

  function load(storage) {
    let raw = null;
    try { raw = storage.getItem(D.saveKey); } catch (_) { return { status: 'none' }; }
    if (raw == null || raw === '') return { status: 'none' };
    let obj;
    try { obj = JSON.parse(raw); } catch (_) { return { status: 'corrupt', raw }; }
    try { return { status: 'ok', data: migrate(obj), raw }; } catch (e) { return { status: e.code === 'newer' ? 'newer' : 'corrupt', raw }; }
  }

  function store(storage, cs) {
    try { storage.setItem(D.saveKey, JSON.stringify(serialise(cs))); return true; } catch (_) { return false; }
  }

  function clear(storage) { try { storage.removeItem(D.saveKey); } catch (_) { /* nothing to clear */ } }

  M.define('save', { serialise, migrate, apply, deserialise, blank, load, store, clear });
})(typeof self !== 'undefined' ? self : this);
