/*
 * Verdigris campaign - map: exploration grid and the map model (Phase 3 T07, 003_task_missions.md 4.3 and 5.3).
 *   grid(regionId) -> { n, cell, r }        n x n cells of data.map.cell over the region square [-r, r]
 *   cellOf(regionId, x, z) -> index | -1    -1 outside the square
 *   revealRange(cs) -> units                map.reveal x stage spot ^ 0.5, x revealAlt above ceiling x highAlt
 *   reveal(cs, regionId, x, z, range) -> count of newly explored cells (cells whose centre is within range)
 *   step(cs, dt) -> events[]                every map.every s (4 Hz) marks cells around the dragon explored;
 *                                           nothing in the lair; 'map:explored' { region, cells } when new cells open
 *   explored(cs, regionId, x, z) -> bool    is that point's cell explored
 *   bits(cs, regionId) -> number[]          the region's bitset (32 cells per word), created on first use
 *   fraction(cs, regionId) -> 0..1          share of explored cells inside the region circle
 *   model(cs, regionId?) -> { regions, places, dragon, target, region }
 *       regions: [{ id, nameKey, col, row, known, here, visited, locked: null | { stage }, alert, playable }]
 *         known = visited, or a playable neighbour of a visited region (the exits), or a later region linked to one;
 *         locked = { stage, later } the stage needed (an exit's minStage, or data.map.later) when the dragon is below it;
 *         a region of a later phase is always locked (later: true once the dragon has the stage)
 *       places of regionId (default the current region): only discovered ones, plus the lair (always known):
 *         [{ id, kind: 'lair' | 'settlement' | 'castle' | 'aerie' (T08), type, x, z, key, discovered: true, alert, freed }]
 *       dragon: { x, z, yaw } when the dragon is in regionId (and not in the cave), else null; target: null (T11)
 * cs.explored = { regionId: number[] } (bitset words). Not saved yet: save v3 (T18) adds it.
 * Map axes: +Z = north (bearing 0), +X = west (the yaw convention: facing +Z, +X is on the left).
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), G = M.need('growth'), SE = M.need('settlement'), AL = M.need('alert'), AE = M.need('aerie');

  const P = () => D.map;
  const grids = {};

  function grid(regionId) {
    if (grids[regionId]) return grids[regionId];
    const r = T.region(regionId).radius, cell = P().cell;
    return (grids[regionId] = { n: Math.ceil((2 * r) / cell), cell, r });
  }

  function cellOf(regionId, x, z) {
    const g = grid(regionId), i = Math.floor((x + g.r) / g.cell), j = Math.floor((z + g.r) / g.cell);
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) return -1;
    return j * g.n + i;
  }

  function bits(cs, regionId) {
    if (!cs.explored) cs.explored = {};
    let b = cs.explored[regionId];
    const words = Math.ceil((grid(regionId).n * grid(regionId).n) / 32);
    if (!b || b.length !== words) { b = cs.explored[regionId] = new Array(words).fill(0); }
    return b;
  }

  const has = (b, k) => (b[k >> 5] >>> (k & 31)) & 1;

  function revealRange(cs) {
    const st = G.statsOf(cs.dragon.stage), p = cs.dragon.pilot, R = T.region(cs.region);
    let r = P().reveal * Math.sqrt(st.spot || 1);
    if (p && p.pos[1] > R.ceiling * P().highAlt) r *= P().revealAlt;
    return r;
  }

  function reveal(cs, regionId, x, z, range) {
    const g = grid(regionId), b = bits(cs, regionId);
    const i0 = Math.max(0, Math.floor((x - range + g.r) / g.cell)), i1 = Math.min(g.n - 1, Math.floor((x + range + g.r) / g.cell));
    const j0 = Math.max(0, Math.floor((z - range + g.r) / g.cell)), j1 = Math.min(g.n - 1, Math.floor((z + range + g.r) / g.cell));
    let added = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = -g.r + (i + 0.5) * g.cell, cz = -g.r + (j + 0.5) * g.cell;
      if (Math.hypot(cx - x, cz - z) > range) continue;
      const k = j * g.n + i;
      if (has(b, k)) continue;
      b[k >> 5] = (b[k >> 5] | (1 << (k & 31))) >>> 0;
      added++;
    }
    return added;
  }

  function explored(cs, regionId, x, z) {
    const k = cellOf(regionId, x, z);
    if (k < 0 || !cs.explored || !cs.explored[regionId]) return false;
    return !!has(cs.explored[regionId], k);
  }

  function fraction(cs, regionId) {
    const g = grid(regionId), b = (cs.explored && cs.explored[regionId]) || [];
    let all = 0, on = 0;
    for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
      const cx = -g.r + (i + 0.5) * g.cell, cz = -g.r + (j + 0.5) * g.cell;
      if (Math.hypot(cx, cz) > g.r) continue;
      all++;
      const k = j * g.n + i;
      if (b.length && has(b, k)) on++;
    }
    return all ? on / all : 0;
  }

  function step(cs, dt) {
    if (cs.inLair || !cs.dragon.pilot || !D.regions[cs.region]) return [];
    cs.mapT = (cs.mapT || 0) - dt;
    if (cs.mapT > 0) return [];
    cs.mapT = P().every;
    const p = cs.dragon.pilot.pos, n = reveal(cs, cs.region, p[0], p[2], revealRange(cs));
    return n ? [{ e: 'map:explored', region: cs.region, cells: n }] : [];
  }

  const lairRegion = () => Object.keys(D.regions).find(id => D.regions[id].lair) || null;
  const visitedOf = cs => id => id === cs.region || !!(cs.explored && cs.explored[id] && cs.explored[id].some(w => w)) ||
                                !!(cs.regionStates && cs.regionStates[id]) || id === lairRegion();

  /** The stage a dragon needs to reach region `id` from the lair: over the exits, the path whose highest minStage is
      lowest (a later region: data.map.later). */
  let needs = null;
  function stageFor(id) {
    if (!D.regions[id]) return (P().later[id] && P().later[id].stage) || 0;
    if (!needs) {
      needs = {}; const home = lairRegion() || D.startRegion;
      needs[home] = 0;
      for (let pass = 0, changed = true; changed && pass < 50; pass++) {
        changed = false;
        for (const from of Object.keys(needs)) for (const e of D.regions[from].exits || []) {
          if (!D.regions[e.to]) continue;
          const v = Math.max(needs[from], e.minStage || 0);
          if (needs[e.to] == null || v < needs[e.to]) { needs[e.to] = v; changed = true; }
        }
      }
    }
    return needs[id] != null ? needs[id] : 0;
  }

  const placeCache = {};
  function placesOf(regionId) {
    if (!placeCache[regionId]) placeCache[regionId] = (D.regions[regionId].settlements ? SE.layout(regionId).places : []).map(p => ({ id: p.id, type: p.type, x: p.x, z: p.z, name: p.name || null, castle: !!p.castle || p.type === 'castle' }));
    return placeCache[regionId];
  }

  function model(cs, regionId) {
    const rid = regionId || cs.region, visited = visitedOf(cs), stage = cs.dragon.stage;
    const W = P().world, regions = [];
    const vis = {};
    for (const id of Object.keys(W)) vis[id] = D.regions[id] ? visited(id) : false;
    const known = {};
    for (const id of Object.keys(W)) if (vis[id]) {
      known[id] = true;
      if (D.regions[id]) for (const e of D.regions[id].exits || []) known[e.to] = true;
    }
    for (const [a, b] of P().links) { if (vis[a] || vis[b]) known[a] = known[b] = true; }
    for (const id of Object.keys(W)) {
      const need = stageFor(id), rs = cs.regionStates && cs.regionStates[id];
      regions.push({ id, nameKey: 'c.region.' + id, col: W[id][0], row: W[id][1], known: !!known[id], visited: vis[id], here: id === cs.region,
                     playable: !!D.regions[id], locked: (!D.regions[id] || stage < need) ? { stage: need, later: !D.regions[id] && stage >= need } : null, alert: rs ? AL.level(rs) : 0 });
    }
    const places = [];
    if (D.regions[rid]) {
      const rs = cs.regionStates && cs.regionStates[rid], alert = rs ? AL.level(rs) : 0;
      if (D.regions[rid].lair) { const m = T.lairPos(rid); places.push({ id: 'lair', kind: 'lair', type: 'lair', x: m[0], z: m[2], key: 'c.nav.lair', discovered: true, alert: 0, freed: false }); }
      for (const pl of placesOf(rid)) {
        if (!(cs.discovered && cs.discovered[pl.id])) continue;
        places.push({ id: pl.id, kind: pl.castle ? 'castle' : 'settlement', type: pl.type, x: pl.x, z: pl.z,
                      key: pl.name ? 'c.placeName.' + pl.name : 'c.place.' + pl.type, discovered: true, alert, freed: false });
      }
      const ae = AE.site(rid);                                    // T08: the region's aerie once found
      if (ae && AE.found(cs, rid)) places.push({ id: ae.id, kind: 'aerie', type: 'aerie', x: ae.x, z: ae.z, key: 'c.place.aerie', discovered: true, alert: 0, freed: false });
    }
    const p = cs.dragon.pilot;
    const dragon = p && rid === cs.region && !cs.inLair ? { x: p.pos[0], z: p.pos[2], yaw: p.yaw } : null;
    return { region: rid, regions, places, dragon, target: null };
  }

  M.define('map', { grid, cellOf, bits, revealRange, reveal, explored, fraction, step, stageFor, model });
})(typeof self !== 'undefined' ? self : this);
