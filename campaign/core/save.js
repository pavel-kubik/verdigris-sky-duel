/*
 * Verdigris campaign - the save: serialise / deserialise / migrate, and a storage adapter.
 * See 001_task_survival.md 5.9 (v1), 002_task_kingdom.md 5.9 (v2, T22) and 003_task_missions.md 5.9 (v3, Phase 3 T18).
 * v3 adds: missions.active (the running mission with its mission loot in the claws and its caravan), regions.<id>.explored
 * (base64 bitset of map cells), regions.<id>.aerieFound (out of `discovered`), regions.<id>.gate ('open' | 'closed', the
 * castle portcullis of the loaded town), story.act. v2 -> v3: no active mission, explored = the cells around the
 * discovered places (seedExplored, done in apply), story.act from the stage.
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
  /* ---------- T18: explored cells as base64 (bitset words, 32 cells each, little-endian bytes) ---------- */
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function wordsTo64(words) {
    const by = [];
    for (const w of words) for (let k = 0; k < 4; k++) by.push((w >>> (8 * k)) & 255);
    let out = '';
    for (let i = 0; i < by.length; i += 3) {
      const n = (by[i] << 16) | ((by[i + 1] || 0) << 8) | (by[i + 2] || 0), left = by.length - i;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (left > 1 ? B64[(n >> 6) & 63] : '=') + (left > 2 ? B64[n & 63] : '=');
    }
    return out;
  }
  /** -> number[] of `count` words, or null when the text is not base64 of that length. */
  function wordsFrom64(text, count) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) return null;
    const by = [];
    for (let i = 0; i < text.length; i += 4) {
      const c = [0, 1, 2, 3].map(k => (text[i + k] === '=' ? 0 : B64.indexOf(text[i + k])));
      const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
      by.push((n >> 16) & 255);
      if (text[i + 2] !== '=') by.push((n >> 8) & 255);
      if (text[i + 3] !== '=') by.push(n & 255);
    }
    if (by.length !== count * 4) return null;
    const words = [];
    for (let i = 0; i < count; i++) words.push((by[4 * i] | (by[4 * i + 1] << 8) | (by[4 * i + 2] << 16) | (by[4 * i + 3] << 24)) >>> 0);
    return words;
  }
  const MP = () => M.need('map'), MS = () => M.need('missions');

  /** T18: the running mission as saved: { id, state, left, viaAerie, stopped, caravan? }; null when none is on. */
  function activeOf(cs) {
    const a = cs.mission, m = a && MS().def(a.id);
    if (!m || !(a.state === 'accepted' || a.state === 'running' || a.state === 'done')) return null;
    const o = { id: a.id, state: a.state, left: round(Math.max(0, a.left), 10), viaAerie: !!a.viaAerie, stopped: !!a.stopped };
    const cv = m.caravan && cs.caravans && cs.caravans[m.caravan];
    if (cv && cv.state !== 'arrived') o.caravan = { s: round(cv.s, 10), hp: round(cv.hp, 100), state: cv.state, chestTaken: !!(cv.chest && cv.chest.taken) };
    return o;
  }
  /** T18: loot in the claws as saved; mission loot (a relic, the caravan chest) only together with its running mission. */
  function lootOf(cs) {
    const l = cs.carriedLoot, K = l && D.loot[l.kind];
    if (!l || !K) return null;
    const mine = !!(K.mission || l.mission);
    if (!mine) return { id: l.id, kind: l.kind, region: l.region };
    const a = activeOf(cs);
    if (!a || (l.mission && l.mission !== a.id)) return null;
    const o = { id: l.id, kind: l.kind, region: l.region, mission: a.id };
    if (l.relic) o.relic = l.relic;
    return o;
  }

  function fail(code, why) { const e = new Error(code + (why ? ': ' + why : '')); e.code = code; throw e; }

  /** The story part of the save: the act and the mother's lesson state (null = no teacher, e.g. a phase 1 run). */
  function storyOf(st) {
    const m = st && st.mother, SY = M.need('story').saved(st);   // Phase 3 T17: seen cards / lines and the mother's raid
    return { act: st && (st.act === 1 || st.act === 2 || st.act === 3) ? st.act : 1, mother: m ? { lesson: m.lesson | 0, at: m.at || 'lair' } : null, seen: SY.seen, raid: SY.raid };
  }

  function serialise(cs) {
    const d = cs.dragon, p = d.pilot;
    return {
      version: D.version,
      dragon: {
        growth: round(G.growthValue(d.foodXp), 1e4), stage: d.stage, foodXp: round(d.foodXp, 100),
        hp: round(d.hp, 100), hunger: round(d.hunger, 100), deaths: d.deaths || 0, upgrades: (cs.upgrades || []).filter(id => D.upgrades[id]),   // T20
        // T19: in the claws. Phase 3 T12: not mission loot (a relic) - the running mission is only saved with v3 (T18),
        // so a reload puts the relic back at its door with the mission
        // v3 (T18): mission loot is saved together with the running mission (missions.active)
        loot: lootOf(cs),
      },
      hoard: { gold: Math.max(0, Math.floor((cs.hoard && cs.hoard.gold) || 0)), relics: ((cs.hoard && cs.hoard.relics) || []).filter(id => D.relics && D.relics[id]) },   // T19, relics: Phase 3 T12
      larder: cs.larder.map(it => it.tribute ? { prey: it.type, food: round(it.food, 100), tribute: true } : { prey: it.type, food: round(it.food, 100) }),   // Phase 3 T16: tribute carcasses keep their mark
      renown: 0,
      regions: Object.keys(D.regions).reduce((o, id) => {              // T12: discovered settlements (the rest of v2 in T22)
        o[id] = {};
        const seen = Object.keys(cs.discovered || {}).filter(k => cs.discovered[k] && k.indexOf(id + '.') === 0 && k !== id + '.aerie').sort();
        if (seen.length) o[id].discovered = seen;
        if (cs.discovered && cs.discovered[id + '.aerie']) o[id].aerieFound = true;   // v3 (T18)
        const ex = cs.explored && cs.explored[id];                   // v3 (T18): explored map cells
        if (ex && ex.some(w => w)) o[id].explored = wordsTo64(ex);
        const town = cs.town && cs.town.region === id ? cs.town : null;   // v3 (T18): the castle gate of the loaded town
        if (town && town.buildings && town.buildings.some(b => b.gate)) o[id].gate = town.gateClosed ? 'closed' : 'open';
        const ruins = ((cs.regionStates && cs.regionStates[id] && cs.regionStates[id].ruins) || []).filter(r => r && typeof r.id === 'string');
        if (ruins.length) o[id].ruins = ruins.map(r => r.char ? { id: r.id, at: round(r.at || 0, 10), char: true } : { id: r.id, at: round(r.at || 0, 10) });   // T13 (v2 shape, 5.9); T06: char = a charred castle stone piece
        const corn = ((cs.regionStates && cs.regionStates[id] && cs.regionStates[id].corn) || []).filter(r => r && typeof r.id === 'string');
        if (corn.length) o[id].corn = corn.map(r => ({ id: r.id, at: round(r.at || 0, 10) }));       // burned corn fields
        const rs = cs.regionStates && cs.regionStates[id];
        const taken = ((rs && rs.lootTaken) || []).filter(r => r && typeof r.id === 'string');
        if (taken.length) o[id].lootTaken = taken.map(r => ({ id: r.id, at: round(r.at || 0, 10) }));   // T19 (v2 shape, 5.9)
        const freed = ((rs && rs.freed) || []).filter(k => typeof k === 'string');
        if (freed.length) o[id].freed = freed.slice();               // Phase 3 T16: freed villages (5.9)
        if (rs && rs.heat > 0) {                                     // T17: alert heat with its play-time stamps (5.9)
          o[id].heat = round(rs.heat, 1000);
          if (typeof rs.lastIncident === 'number') o[id].lastIncident = round(rs.lastIncident, 10);
          if (typeof rs.at === 'number') o[id].at = round(rs.at, 10);
        }
        return o;
      }, {}),
      missions: { completed: ((cs.missions && cs.missions.completed) || []).slice(), active: activeOf(cs), failedAt: Object.assign({}, cs.missions && cs.missions.failedAt) },   // T10, active: T18
      story: Object.assign(storyOf(cs.story), { act: M.need('story').act(cs) }),   // T18: the act from the stage
      world: {
        region: cs.region,
        pos: p ? (cs.inLair && LR.mouthPos(cs.region) || p.pos).map(v => round(v, 100)) : null,   // inside: the mouth (cave coordinates are local)
        yaw: p ? round(p.yaw, 1e4) : 0,
        st: p ? round(p.st, 10) : 100,
        location: cs.inLair ? 'cave' : 'field',
        mode: p && !cs.inLair && (p.mode === 'ground' || p.mode === 'landing') ? 'ground' : 'air',   // T22: a landing ends on the ground
        clock: round(cs.clock ? cs.clock.t : CK.create().t, 1e5),          // T22: time of day
        now: round(cs.stats.played, 10),                                   // T22: the stamp of ruins, loot and heat (= stats.played)
        tribute: round(cs.tributeT || 0, 10),                              // Phase 3 T16: s towards the next tribute carcass
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
    /* v2 -> v3 (Phase 3 T18): no running mission (a v2 save never had one), the found aeries move from `discovered` to
       aerieFound, explored cells are seeded around the discovered places in apply (seedExplored), story.act from the stage */
    2: o => {
      const regions = {};
      const src = o.regions && typeof o.regions === 'object' && !Array.isArray(o.regions) ? o.regions : {};
      for (const id of Object.keys(src)) {
        const r = src[id];
        if (!r || typeof r !== 'object') { regions[id] = r; continue; }
        const q = Object.assign({}, r);
        if (Array.isArray(r.discovered) && r.discovered.indexOf(id + '.aerie') >= 0) {
          q.discovered = r.discovered.filter(k => k !== id + '.aerie');
          q.aerieFound = true;
        }
        delete q.explored; delete q.gate;
        regions[id] = q;
      }
      const mo = o.missions && typeof o.missions === 'object' ? o.missions : {};
      const st = Object.assign({}, o.story && typeof o.story === 'object' ? o.story : {});
      st.act = o.dragon && o.dragon.stage >= 1 ? 2 : 1;
      const d = Object.assign({}, o.dragon);
      if (d.loot && D.loot[d.loot.kind] && D.loot[d.loot.kind].mission) d.loot = null;
      return Object.assign({}, o, { version: 3, dragon: d, regions, story: st, seedExplored: true,
        missions: { completed: Array.isArray(mo.completed) ? mo.completed : [], active: null, failedAt: mo.failedAt && typeof mo.failedAt === 'object' ? mo.failedAt : {} } });
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
    if (o.version >= 3) {                                        // T18: the v3 blocks
      const mo = o.missions;
      if (!mo || typeof mo !== 'object' || Array.isArray(mo)) fail('corrupt', 'missions');
      if (mo.active != null && (typeof mo.active !== 'object' || typeof mo.active.id !== 'string' || !num(mo.active.left))) fail('corrupt', 'missions.active');
      if (!o.story || typeof o.story !== 'object') fail('corrupt', 'story');
      for (const id of Object.keys(o.regions || {})) {
        const r = o.regions[id];
        if (r && r.explored != null && typeof r.explored !== 'string') fail('corrupt', 'regions.' + id + '.explored');
      }
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
      .slice(0, D.lair.larderSize).map(it => (it.tribute === true ? { type: it.prey, food: it.food, tribute: true } : { type: it.prey, food: it.food }));
    cs.tributeT = num(w.tribute) ? Math.max(0, Math.min(D.tribute.every, w.tribute)) : 0;   // Phase 3 T16
    const f = o.flags || {};
    cs.flags = { introSeen: !!f.introSeen, heavyT: 0, rested: f.rested | 0,
                 tips: Array.isArray(f.tips) ? f.tips.filter((id, i) => typeof id === 'string' && D.tips.order.indexOf(id) >= 0 && f.tips.indexOf(id) === i) : [] };   // T23
    const s = o.stats || {};
    cs.stats = { played: num(s.played) ? s.played : 0, eaten: num(s.eaten) ? s.eaten : 0, food: num(s.food) ? s.food : 0,
                 civilBurned: num(s.civilBurned) ? s.civilBurned : 0, orderBurned: num(s.orderBurned) ? s.orderBurned : 0,
                 livestockTaken: num(s.livestockTaken) ? s.livestockTaken : 0, lootBanked: num(s.lootBanked) ? s.lootBanked : 0 };
    const h = o.hoard || {};                                     // T19: banked gold, never negative
    cs.hoard = { gold: num(h.gold) ? Math.max(0, Math.floor(h.gold)) : 0, relics: Array.isArray(h.relics) ? h.relics.filter(id => typeof id === 'string' && D.relics && D.relics[id]) : [] };   // T12: known relics
    const dl = o.dragon.loot;                                    // T19: loot in the claws
    cs.carriedLoot = dl && typeof dl.id === 'string' && D.loot[dl.kind] && !D.loot[dl.kind].mission && !dl.mission && D.regions[dl.region]
      ? { id: dl.id, kind: dl.kind, gold: D.loot[dl.kind].gold, size: D.loot[dl.kind].size, region: dl.region } : null;
    cs.lootTarget = null;
    const ups = Array.isArray(o.dragon.upgrades) ? o.dragon.upgrades : [];   // T20: owned upgrades, known ids once each
    cs.upgrades = ups.filter((id, i) => typeof id === 'string' && D.upgrades[id] && ups.indexOf(id) === i);
    const mo = o.missions || {}, known = id => typeof id === 'string' && D.missions.some(m => m.id === id);   // T10
    cs.missions = { completed: Array.isArray(mo.completed) ? mo.completed.filter((id, i) => known(id) && mo.completed.indexOf(id) === i) : [], failedAt: {} };
    for (const id of Object.keys(mo.failedAt || {})) if (known(id) && num(mo.failedAt[id])) cs.missions.failedAt[id] = mo.failedAt[id] | 0;
    cs.mission = null; cs.caravans = {}; cs.caravanSaved = null;
    restoreMission(cs, mo.active, dl);                           // v3 (T18): the running mission, its loot and caravan
    cs.story = storyOf(o.story);
    cs.discovered = {}; cs.regionStates = {}; cs.explored = {};
    for (const id of Object.keys(o.regions || {})) {
      const r = o.regions[id];
      if (D.regions[id] && r && Array.isArray(r.discovered)) for (const k of r.discovered) if (typeof k === 'string' && k.indexOf(id + '.') === 0) cs.discovered[k] = true;
      if (D.regions[id] && r && r.aerieFound === true) cs.discovered[id + '.aerie'] = true;   // v3 (T18)
      if (D.regions[id] && r && typeof r.explored === 'string') {  // v3 (T18): the bitset; a wrong length starts unexplored
        const words = wordsFrom64(r.explored, MP().bits({ explored: {} }, id).length);
        if (words) cs.explored[id] = words;
      }
      if (D.regions[id] && r && (r.gate === 'open' || r.gate === 'closed')) (cs.regionStates[id] = cs.regionStates[id] || {}).gate = r.gate;   // v3 (T18)
      if (D.regions[id] && r && Array.isArray(r.ruins)) {          // T13: burned buildings, rebuilt fire.rebuild s after `at`
        const ruins = r.ruins.filter(q => q && typeof q.id === 'string' && q.id.indexOf(id + '.') === 0 && num(q.at)).map(q => q.char === true ? { id: q.id, at: q.at, char: true } : { id: q.id, at: q.at });
        if (ruins.length) (cs.regionStates[id] = cs.regionStates[id] || {}).ruins = ruins;
      }
      if (D.regions[id] && r && Array.isArray(r.corn)) {           // burned corn fields, grow back corn.regrow s after `at`
        const corn = r.corn.filter(q => q && typeof q.id === 'string' && q.id.indexOf(id + '.') === 0 && num(q.at)).map(q => ({ id: q.id, at: q.at }));
        if (corn.length) (cs.regionStates[id] = cs.regionStates[id] || {}).corn = corn;
      }
      if (D.regions[id] && r && Array.isArray(r.lootTaken)) {      // T19: taken loot, back fire.rebuild s after `at`
        const taken = r.lootTaken.filter(q => q && typeof q.id === 'string' && q.id.indexOf(id + '.') === 0 && num(q.at)).map(q => ({ id: q.id, at: q.at }));
        if (taken.length) (cs.regionStates[id] = cs.regionStates[id] || {}).lootTaken = taken;
      }
      if (D.regions[id] && r && Array.isArray(r.freed)) {         // Phase 3 T16: freed villages (only the freeable ones)
        const freed = r.freed.filter((k, i) => typeof k === 'string' && k.indexOf(id + '.') === 0 && D.freed.places.indexOf(k) >= 0 && r.freed.indexOf(k) === i);
        if (freed.length) (cs.regionStates[id] = cs.regionStates[id] || {}).freed = freed;
      }
      if (D.regions[id] && r && num(r.heat) && r.heat > 0) {        // T17: alert heat; decays from `at` on region load
        const q = cs.regionStates[id] = cs.regionStates[id] || {};
        q.heat = Math.min(D.alert.maxHeat, r.heat);
        if (num(r.lastIncident)) q.lastIncident = r.lastIncident;
        if (num(r.at)) q.at = r.at;
      }
    }
    if (o.seedExplored) seedExplored(cs);                        // v2 -> v3: the cells around the discovered places
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

  /** T18: cs.mission (and the mission loot in the claws, and the caravan to restore when it spawns) from missions.active. */
  function restoreMission(cs, a, dl) {
    const m = a && typeof a.id === 'string' ? MS().def(a.id) : null;
    if (!m || cs.missions.completed.indexOf(m.id) >= 0 || !(a.state === 'accepted' || a.state === 'running' || a.state === 'done')) return;
    cs.mission = { id: m.id, state: a.state, t: m.time, left: Math.max(0, Math.min(m.time, a.left)), viaAerie: !!a.viaAerie, stopped: !!a.stopped };
    const K = dl && D.loot[dl.kind];
    if (K && dl.mission === m.id && typeof dl.id === 'string' && D.regions[dl.region]) {
      cs.carriedLoot = { id: dl.id, kind: dl.kind, gold: K.gold, size: K.size, region: dl.region, mission: m.id };
      if (typeof dl.relic === 'string' && D.relics && D.relics[dl.relic]) cs.carriedLoot.relic = dl.relic;
      else if (dl.kind === 'relic') cs.carriedLoot = null;       // a relic without a known id
      if (cs.carriedLoot && m.caravan) cs.carriedLoot.gold = (D.loot[(D.caravan[m.caravan] || {}).chest] || K).gold;
    }
    const c = a.caravan;
    if (m.caravan && c && num(c.s) && num(c.hp) && (c.state === 'waiting' || c.state === 'moving' || c.state === 'stopped'))
      cs.caravanSaved = { [m.caravan]: { s: c.s, hp: c.hp, state: c.state, chestTaken: !!c.chestTaken } };
  }

  /** v2 -> v3: explore the cells around every discovered place (and the lair), as if the dragon had flown there. */
  function seedExplored(cs) {
    const keep = cs.region;
    for (const id of Object.keys(D.regions)) {
      let places = [];
      try { places = MP().model(cs, id).places; } catch (_) { places = []; }
      for (const pl of places) MP().reveal(cs, id, pl.x, pl.z, D.map.reveal);
    }
    cs.region = keep;
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
