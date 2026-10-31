/*
 * Verdigris campaign - the save: serialise / deserialise / migrate, and a storage adapter.
 * See 001_task_survival.md 5.9.
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
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), F = M.need('flight'), PR = M.need('prey'), S = M.need('state'), LR = M.need('lair'), CV = M.need('cave');

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
        hp: round(d.hp, 100), hunger: round(d.hunger, 100), deaths: d.deaths || 0, upgrades: [],
      },
      hoard: { gold: 0, relics: [] },
      larder: cs.larder.map(it => ({ prey: it.type, food: round(it.food, 100) })),
      renown: 0,
      regions: Object.keys(D.regions).reduce((o, id) => { o[id] = {}; return o; }, {}),
      missions: { completed: [], active: null },
      story: storyOf(cs.story),
      world: {
        region: cs.region,
        pos: p ? (cs.inLair && LR.mouthPos(cs.region) || p.pos).map(v => round(v, 100)) : null,   // inside: the mouth (cave coordinates are local)
        yaw: p ? round(p.yaw, 1e4) : 0,
        st: p ? round(p.st, 10) : 100,
        location: cs.inLair ? 'lair' : 'field',
      },
      flags: { introSeen: !!cs.flags.introSeen, rested: cs.flags.rested || 0 },
      stats: { played: round(cs.stats.played, 10), eaten: cs.stats.eaten, food: round(cs.stats.food, 100) },
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
    cs.flags = { introSeen: !!f.introSeen, heavyT: 0, rested: f.rested | 0 };
    const s = o.stats || {};
    cs.stats = { played: num(s.played) ? s.played : 0, eaten: num(s.eaten) ? s.eaten : 0, food: num(s.food) ? s.food : 0 };
    cs.story = storyOf(o.story);
    cs.hint = null; cs.swoop = null; cs.target = null; cs.breath = null; cs.fire = null; cs.fireMem = null; cs.exit = null; cs.exitT = 0; cs.saveT = 0; cs.station = null;

    const pos = region === w.region && w.pos ? T.clampToRegion(region, w.pos.slice(), D.flight.minAlt) : null;
    cs.region = region;
    cs.field = PR.spawnRegion(region, cs.rng, pos);              // fresh prey field (prey is never saved), herds away from the dragon
    cs.inLair = !!pos && w.location === 'lair' && !!T.region(region).lair;
    if (pos) {
      const np = F.newPilot(pos, num(w.yaw) ? w.yaw : 0, st.cruise);
      if (num(w.st)) np.st = Math.max(0, Math.min(100, w.st));
      if (d.pilot) Object.assign(d.pilot, np); else d.pilot = np;   // same object: the renderer keeps its reference
      if (cs.inLair) CV.place(cs, 'nest');                       // T10: a save inside the lair restores in the cave, on the nest
    } else d.pilot = null;
    return cs;
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
