/*
 * Verdigris campaign - loot and the hoard (Phase 2 T19, 002_task_kingdom.md 4.6 and 5.6).
 * Order buildings with `loot` (data.buildings: taxhouse -> tithe chest, vault -> strongbox) keep one item each on the
 * ground in front of them. The dragon picks it up on the ground (Grab, the one claw slot shared with prey), carries it
 * home (slower, a strongbox blocks the fire) and banks its gold by entering the lair; dying loses it. A taken item is
 * back fire.rebuild s of play after it was taken (rs.lootTaken [{ id, at }], saved).
 *   place(town, rs, now) -> items        one item per loot kind of each building: { id, kind, building, place, size, gold,
 *                                        home, pos, taken }; id = '<building id>.<kind>'; taken while in rs.lootTaken
 *   doorPos(town, b) -> [x, y, z]        where a building's item lies (data.loot.door outside, data.loot.clear off solids)
 *   available(items) -> items            the ones lying on the ground
 *   inFront(items, pick, limit) -> { best, heavy }   pick = items -> item (walk.inFront); heavy = too big for `limit`
 *   take(cs, item, now) -> events        into the claws: cs.carriedLoot, rs.lootTaken (+ 'loot:taken')
 *   effects(eff, loot) -> eff            hunger effects x the carry penalty (speedMult, canBreath)
 *   blocksBreath(loot) -> bool
 *   bank(cs) -> events                   gold into cs.hoard ('hoard:banked' { kind, gold, total, tier, from })
 *   lose(cs) -> events                   death: the carried item is gone ('loot:lost'), it refills as taken
 *   drop(cs, pos) -> events              claws too weak (starving): the item lies at pos again, no longer taken
 *   refill(town, rs, now, carriedId?) -> events   taken items older than fire.rebuild come back ('loot:back'), not the carried one
 *   tier(gold) -> 0..   coins(gold) -> n the coin pile (data.cave.hoardTiers, maxCoins)
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), SE = M.need('settlement');
  const L = D.loot;

  function rot(x, z, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return [x * c + z * s, -x * s + z * c]; }

  /** The building's front (local +Z), else the clear side nearest its settlement centre (8 directions). */
  function doorPos(town, b) {
    const pl = town.places.find(p => p.id === b.place), d = b.r + L.door;
    const cand = [rot(0, 1, b.yaw)];
    const dirs = [];
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; dirs.push([Math.sin(a), Math.cos(a)]); }
    if (pl) dirs.sort((u, v) => Math.hypot(b.pos[0] + u[0] * d - pl.x, b.pos[2] + u[1] * d - pl.z) - Math.hypot(b.pos[0] + v[0] * d - pl.x, b.pos[2] + v[1] * d - pl.z));
    cand.push(...dirs);
    const ok = ([dx, dz]) => SE.solidAt(town, b.pos[0] + dx * d, b.pos[2] + dz * d, L.clear) == null;
    const [dx, dz] = cand.find(ok) || cand[0];
    const x = b.pos[0] + dx * d, z = b.pos[2] + dz * d;
    return [x, T.surfaceAt(town.region, x, z), z];
  }

  function takenMap(rs, now) {
    const m = {};
    for (const r of (rs && rs.lootTaken) || []) if (r && r.id && !(now - (r.at || 0) >= D.fire.rebuild)) m[r.id] = true;
    return m;
  }

  function place(town, rs, now) {
    const taken = takenMap(rs, now || 0), out = [];
    for (const b of town.buildings) {
      const B = D.buildings[b.type];
      if (!B || !B.loot) continue;
      for (const kind of B.loot) {
        const K = L[kind];
        if (!K) continue;
        const home = doorPos(town, b), id = b.id + '.' + kind;
        out.push({ id, kind, building: b.id, place: b.place, size: K.size, gold: K.gold, r: 1, home, pos: home.slice(), taken: !!taken[id] });
      }
    }
    return out;
  }

  const available = items => (items || []).filter(it => !it.taken);

  function inFront(items, pick, limit) {
    const can = available(items);
    const best = pick(can.filter(it => it.size <= limit));
    return { best, heavy: best ? null : pick(can.filter(it => it.size > limit)) };
  }

  function take(cs, item, now) {
    if (!item || item.taken || cs.carriedLoot) return [];
    item.taken = true;
    cs.carriedLoot = { id: item.id, kind: item.kind, gold: item.gold, size: item.size, region: cs.region };
    const rs = cs.regionStates[cs.region] = cs.regionStates[cs.region] || {};
    rs.lootTaken = (rs.lootTaken || []).filter(r => r.id !== item.id).concat([{ id: item.id, at: now }]);
    return [{ e: 'loot:taken', id: item.id, kind: item.kind, gold: item.gold, place: item.place }];
  }

  function effects(eff, loot) {
    const K = loot && L[loot.kind];
    if (!K) return eff;
    return Object.assign({}, eff, { speedMult: (eff.speedMult || 1) * K.carry.speedMult, canBreath: eff.canBreath && K.carry.breath });
  }
  const blocksBreath = loot => !!(loot && L[loot.kind] && !L[loot.kind].carry.breath);

  function tier(gold) {
    const t = D.cave.hoardTiers;
    let n = 0;
    for (let i = 1; i < t.length; i++) if (gold >= t[i]) n = i;
    return n;
  }
  const coins = gold => Math.max(0, Math.min(D.cave.maxCoins, Math.floor((gold || 0) / 2)));

  function bank(cs) {
    const it = cs.carriedLoot;
    if (!it) return [];
    cs.hoard = cs.hoard || { gold: 0, relics: [] };
    const from = tier(cs.hoard.gold);
    cs.hoard.gold += it.gold;
    cs.carriedLoot = null;
    cs.stats.lootBanked = (cs.stats.lootBanked || 0) + 1;
    return [{ e: 'hoard:banked', kind: it.kind, gold: it.gold, total: cs.hoard.gold, tier: tier(cs.hoard.gold), from }];
  }

  function lose(cs) {
    const it = cs.carriedLoot;
    if (!it) return [];
    cs.carriedLoot = null;
    return [{ e: 'loot:lost', kind: it.kind, gold: it.gold }];
  }

  function drop(cs, pos) {
    const it = cs.carriedLoot;
    if (!it) return [];
    cs.carriedLoot = null;
    const rs = cs.regionStates[it.region];
    if (rs && rs.lootTaken) rs.lootTaken = rs.lootTaken.filter(r => r.id !== it.id);
    const item = it.region === cs.region && cs.town && cs.town.items ? cs.town.items.find(q => q.id === it.id) : null;
    if (item) { item.taken = false; item.pos = [pos[0], T.surfaceAt(cs.region, pos[0], pos[2]), pos[2]]; }
    return [{ e: 'loot:dropped', kind: it.kind }];
  }

  function refill(town, rs, now, carriedId) {
    const ev = [];
    if (!town || !town.items) return ev;
    const taken = takenMap(rs, now);
    if (carriedId) taken[carriedId] = true;                     // still in the claws: it cannot be back yet
    for (const it of town.items) {
      if (!it.taken || taken[it.id]) continue;
      it.taken = false; it.pos = it.home.slice();
      ev.push({ e: 'loot:back', id: it.id, kind: it.kind });
    }
    if (rs && rs.lootTaken) rs.lootTaken = rs.lootTaken.filter(r => taken[r.id]);
    return ev;
  }

  M.define('loot', { place, doorPos, available, inFront, take, effects, blocksBreath, bank, lose, drop, refill, tier, coins });
})(typeof self !== 'undefined' ? self : this);
