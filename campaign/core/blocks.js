/*
 * Verdigris campaign - one basic block on a test ground (Phase 4 T02, campaign/preview/blocks.html).
 *
 * The block preview puts ONE block (a house of the house kit, a settlement or castle piece, a bridge, a tree, a terrain
 * feature) on a test ground (flat, slope, step) and lets a body (the hero walker, a dragon walking or hovering) push
 * against it. Everything runs through the game's own core queries: every block + ground pair is a small region of its
 * own in data.regions (not enumerable, so the region lists and their tests never see it; terrain.fn is its ground), the
 * block is a settlement building (settlement.sd / solidAt / hit / surfaceAt), a city lot (city.sd) or a terrain
 * feature (bridge deck, plateau, cliff, cone) as in a real region, and the bodies use hero.step, walk.step and
 * flight.step with the same solids context as core/state.js.
 *
 *   catalog(opts?) -> [{ id, group, label, ... }]     every block; opts.houses = { styles, kinds } (render/house-kit.js
 *                                                      lists) - without it a built-in list of the city styles is used
 *   GROUNDS = ['flat', 'slope', 'step'], BODIES = ['hero', 'dragon', 'hover']
 *   world(blockId, ground) -> W                       W: { regionId, block, town, lot, feature, shapes (core/shapes.js
 *                                                      entries), bound: { r, top }, solids(pad) -> { solidAt, solidHit,
 *                                                      walkTop }, surface(x, z) }
 *   body(W, kind, pos?, yaw?) -> b                     b: { kind, pos, yaw, h (hero) | p (pilot), pad }
 *   step(W, b, inp, dt) -> events                      inp: { sx, sy, run, jump } (hover: sy = forward speed, jump = up)
 *   push(W, kind, dir, opts?) -> { trace, inside, end } a scripted push from one of 8 directions (dir 0..7) towards the
 *                                                      centre: inside = the worst depth inside a solid (0 = never)
 *   read(W, b) -> readout                              ground, groundY, hit { depth, nx, nz } | null, onTop, blocked,
 *                                                      land { ok, why }, inSolid (depth below a solid's top, 0 = out)
 *   lines(r) -> text lines of a readout
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = (typeof module === 'object' && module.exports) ? require('./umd.js') : root.VCamp;
  const D = M.need('data'), T = M.need('terrain'), SE = M.need('settlement'), CI = M.need('city'), CA = M.need('castle');
  const WK = M.need('walk'), H = M.need('hero'), F = M.need('flight'), G = M.need('growth'), SH = M.need('shapes');
  const { wrap } = M.need('math');

  const GROUNDS = ['flat', 'slope', 'step'], BODIES = ['hero', 'dragon', 'hover'];
  const SLOPE = 0.18, STEP_H = 1.0, RADIUS = 600;
  const HOUSE_STYLES = ['baroque', 'gothic', 'classic', 'renaissance', 'timber', 'cottage', 'log', 'farm'];
  const HOUSE_KINDS = ['house', 'cottage', 'barn', 'shed', 'chapel', 'church', 'tower', 'gatetower', 'townhall', 'domechurch'];
  const CASTLE = ['wall', 'bastion', 'ctower', 'gatehouse', 'portcullis', 'keep', 'chapel'];
  const TREES = ['conifer', 'broadleaf', 'pine', 'birch', 'poplar'];

  /* ---------- the catalog ---------- */
  function catalog(opts) {
    const hs = (opts && opts.houses) || {}, out = [];
    for (const kind of hs.kinds || HOUSE_KINDS) for (const style of hs.styles || HOUSE_STYLES) {
      if (kind !== 'house' && style !== (hs.styles || HOUSE_STYLES)[0]) continue;   // landmarks once, houses in every style
      out.push({ id: 'house:' + style + ':' + kind, group: 'house', label: kind === 'house' ? style + ' house' : kind, style, kind });
    }
    for (const type of Object.keys(D.buildings)) {
      if (CASTLE.indexOf(type) >= 0 && type !== 'chapel') continue;
      out.push({ id: 'building:' + type, group: 'building', label: type, type });
    }
    for (const type of CASTLE) out.push({ id: 'castle:' + type, group: 'castle', label: type, type, castle: true });
    for (const kind of ['stone', 'wood']) out.push({ id: 'bridge:' + kind, group: 'bridge', label: kind + ' bridge', kind });
    for (const kind of TREES) out.push({ id: 'tree:' + kind, group: 'tree', label: kind, kind });
    for (const kind of ['plateau', 'cliff', 'cone']) out.push({ id: 'terrain:' + kind, group: 'terrain', label: kind, kind });
    return out;
  }
  function entry(id) {
    const e = catalog().find(c => c.id === id);
    if (e) return e;
    const [group, a, b] = String(id).split(':');                                  // a house in a style outside the built-in list
    if (group === 'house' && a && b) return { id, group, label: b === 'house' ? a + ' house' : b, style: a, kind: b };
    throw new Error('VCamp blocks: unknown block "' + id + '"');
  }

  /* ---------- the test ground ---------- */
  function groundFn(ground, r) {
    if (ground === 'slope') return (x) => x * SLOPE;
    if (ground === 'step') { const sx = -(r + 6); return (x) => (x > sx ? STEP_H : 0); }   // a kerb west of the block
    return () => 0;
  }

  /** The block's footprint radius before the region exists (for the step's place). */
  function radiusOf(e) {
    if (e.group === 'house') { const s = CI.KIND_SIZE[e.kind] || [9, 11]; return Math.hypot(s[0], s[1]) / 2; }
    if (e.group === 'bridge') return e.kind === 'stone' ? 30 : 20;
    if (e.group === 'terrain') return e.kind === 'cone' ? 60 : e.kind === 'cliff' ? 50 : 22;
    if (e.group === 'tree') return 2;
    if (e.type === 'wall' || e.type === 'palisade' || e.type === 'portcullis') return e.type === 'wall' ? 16 : 6;
    return (D.buildings[e.type] && D.buildings[e.type].r) || 4;
  }

  const worlds = new Map();
  function world(blockId, ground) {
    ground = GROUNDS.indexOf(ground) >= 0 ? ground : 'flat';
    const key = blockId + '|' + ground;
    if (worlds.has(key)) return worlds.get(key);
    const e = entry(blockId), r0 = radiusOf(e), fn = groundFn(ground, r0);
    const regionId = '_blocks:' + key, features = [];
    let feature = null;
    if (e.group === 'bridge') {
      // a gully under the bridge so the deck spans something (the deck lies at the higher bank + DECK_UP)
      const len = e.kind === 'stone' ? 60 : 40, base = fn;
      const gully = (x, z) => base(x, z) - 6 * Math.max(0, 1 - Math.abs(z) / (len * 0.4));
      feature = { type: 'bridge', x: 0, z: 0, yaw: 0, len, width: e.kind === 'stone' ? 9 : 6, kind: e.kind };
      features.push(feature);
      Object.defineProperty(D.regions, regionId, { value: region(regionId, gully, features), enumerable: false, configurable: true });
    } else {
      if (e.group === 'terrain') {
        feature = e.kind === 'plateau' ? { type: 'plateau', x: 0, z: 0, r: 22, y: 5 }
          : e.kind === 'cliff' ? { type: 'cliff', x: 0, z: 0, r: 30, face: Math.PI / 2, drop: 12, width: 40 }
          : { type: 'cone', x: 0, z: 0, r: 60, h: 26 };
        features.push(feature);
      }
      let gfn = fn;
      if (e.group === 'terrain' && e.kind === 'cone') gfn = (x, z) => fn(x, z) + coneH(feature, Math.hypot(x, z));
      Object.defineProperty(D.regions, regionId, { value: region(regionId, gfn, features), enumerable: false, configurable: true });
    }
    const W = { regionId, block: e, ground, feature, town: null, lot: null };
    W.surface = (x, z) => T.surfaceAt(regionId, x, z);
    if (e.group === 'house') W.lot = makeLot(regionId, e);
    if (e.group === 'building' || e.group === 'castle') W.town = makeTown(regionId, e);
    W.shapes = SH.list(regionId, W.town);
    if (W.lot) W.shapes.push({ kind: 'lot', id: 'lot0', src: 'house kit ' + e.style + ' ' + e.kind + ' (core/city.js lot)', place: null,
      name: e.kind, solid: true, ref: W.lot, shape: { type: 'box', x: 0, z: 0, w: W.lot.w, d: W.lot.d, yaw: 0 }, y0: W.lot.y, y1: W.lot.top, top: null });
    let br = r0, top = 0;
    for (const s of W.shapes) { const b = SH.bound(s); br = Math.max(br, Math.hypot(b.x, b.z) + b.r); top = Math.max(top, s.y1); }
    W.bound = { r: br, top };
    W.solids = pad => solids(W, pad);
    worlds.set(key, W);
    return W;
  }

  function coneH(f, d) { return d >= f.r ? 0 : f.h * Math.pow(1 - d / f.r, 1.6); }

  function region(id, fn, features) {
    return { id, name: 'block preview', seed: 1, radius: RADIUS, test: true, palette: 'farm',
      terrain: { fn, amp: 0, base: 0, features } };
  }

  function makeLot(regionId, e) {
    const s = CI.KIND_SIZE[e.kind] || [9, 11, 2], w = s[0], d = s[1], floors = s[2] || 2;
    let lo = Infinity, hi = -Infinity;
    for (let u = -0.5; u <= 0.5; u += 0.25) for (let v = -0.5; v <= 0.5; v += 0.25) {
      const g = T.surfaceAt(regionId, u * w, v * d); lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    const rise = hi - lo, h = floors * CI.STOREY + rise + 0.4;
    return { id: 0, x: 0, z: 0, y: lo, rise, yaw: 0, w, d, floors, style: e.style, kind: e.kind, seed: 7, corner: false, arcade: false,
      district: null, h, top: lo + h + CI.roofOf(e.kind, w, d, floors) };
  }

  function makeTown(regionId, e) {
    const B = D.buildings[e.type], place = { id: 'blk', type: 'block', x: 0, z: 0, yaw: 0, y: T.surfaceAt(regionId, 0, 0), r: 0 };
    const b = { id: 'blk.' + e.type + '1', place: 'blk', type: e.type, pos: [0, T.surfaceAt(regionId, 0, 0), 0], yaw: 0, r: B.r, h: B.h,
      hp: B.stone && B.woodHp > 0 ? B.woodHp : B.hp, heat: 0, fire: 0, ruin: false, ruinAt: null, char: false, charAt: null, nb: [] };
    if (e.type === 'wall' || e.type === 'portcullis' || e.type === 'palisade') {
      const len = e.type === 'wall' ? 30 : e.type === 'portcullis' ? D.castle.gate.w : D.palisade.piece;
      b.seg = [0, -len / 2, 0, len / 2];                   // along z, the outer face towards +x
      b.r = e.type === 'palisade' ? D.palisade.radius : D.castle.wallThick / 2;
      b.len = len;
      if (e.type === 'portcullis') b.gate = true;
    } else if (e.castle) {
      const pc = CA.pieces(D.settlements.castle).find(p => p.type === e.type && !p.seg);
      if (pc) b.r = pc.r;
    }
    place.r = (b.seg ? b.len / 2 : 0) + Math.max(b.r, 1) + 2;
    return { region: regionId, alert3: false, places: [place], buildings: [b], posts: [], pens: [], gateClosed: true };
  }

  /** The solids context of core/state.js solids(): settlement pieces, the house lot, walk tops. */
  function solids(W, pad) {
    const town = W.town, lot = W.lot;
    const lotTop = (x, z) => (lot && CI.sd(lot, x, z).d <= pad ? lot.top : null);
    const lotHit = (x, z) => {
      if (!lot) return null;
      const s = CI.sd(lot, x, z), depth = pad - s.d;
      return depth >= 0 ? { lot, roof: lot.top, nx: s.nx, nz: s.nz, depth } : null;
    };
    return {
      solidAt: (x, z) => { const a = town ? SE.solidAt(town, x, z, pad) : null, b = lotTop(x, z); return a == null ? b : b == null ? a : Math.max(a, b); },
      solidHit: (x, z) => { const a = town ? SE.hit(town, x, z, pad) : null, b = lotHit(x, z); return !a ? b : !b ? a : (b.depth > a.depth ? b : a); },
      walkTop: (x, z) => (town ? SE.surfaceAt(town, x, z) : null),
    };
  }

  /* ---------- bodies ---------- */
  function padOf(kind) { return D.settlement.pad * (kind === 'hero' ? 0.5 : 1); }

  function body(W, kind, pos, yaw) {
    kind = BODIES.indexOf(kind) >= 0 ? kind : 'hero';
    const r = W.bound.r + 10, at = pos || [-r * 0.0 - 0, 0, -r];
    const y = pos && pos[1] != null ? pos[1] : null;
    const b = { kind, pad: padOf(kind), yaw: yaw != null ? yaw : 0 };
    const S = W.solids(b.pad);
    if (kind === 'hero') {
      b.h = H.create('wizard', [at[0], 0, at[2]], b.yaw);
      b.h.pos[1] = y != null ? y : H.groundY({ regionId: W.regionId, walkTop: S.walkTop }, at[0], at[2]);
      b.pos = b.h.pos;
    } else {
      const ground = WK.groundAt({ regionId: W.regionId, solidAt: S.solidAt }, at[0], at[2]);
      b.p = F.newPilot([at[0], 0, at[2]], b.yaw, kind === 'hover' ? 0 : 0);
      if (kind === 'dragon') { b.p.mode = 'ground'; b.p.pos[1] = y != null ? y : ground + D.walk.stand; }
      else { b.p.pos[1] = y != null ? y : Math.max(ground, S.solidAt(at[0], at[2]) || -Infinity) + 6; b.p.speed = 0; }
      b.pos = b.p.pos;
    }
    return b;
  }

  /** One frame. hover is a scripted slow flight: sy = forward speed share, jump / run = up / down, the flight collide. */
  function step(W, b, inp, dt) {
    const S = W.solids(b.pad), ctx = { regionId: W.regionId, solidAt: S.solidAt, solidHit: S.solidHit, walkTop: S.walkTop };
    inp = inp || {};
    let ev = [];
    if (b.kind === 'hero') ev = H.step(b.h, inp, dt, ctx);
    else if (b.kind === 'dragon') {
      const st = G.statsOf(1);
      WK.step(b.p, { sx: inp.sx || 0, sy: inp.sy || 0, boost: !!inp.run }, dt, Object.assign(ctx, { scale: 1, stats: st }));
    } else {
      const p = b.p, v = 10 * (inp.sy || 0);
      p.yaw = wrap(p.yaw - (inp.sx || 0) * 1.6 * dt);
      p.speed = Math.abs(v);
      p.vel = [Math.sin(p.yaw) * v, 0, Math.cos(p.yaw) * v];
      p.pos[0] += p.vel[0] * dt; p.pos[2] += p.vel[2] * dt;
      p.pos[1] += ((inp.jump ? 6 : 0) - (inp.run ? 6 : 0)) * dt;
      const floor = WK.groundAt(ctx, p.pos[0], p.pos[2]) + D.flight.minAlt * 0.4;
      if (p.pos[1] < floor) p.pos[1] = floor;
      collide(p, S);
    }
    b.pos = b.h ? b.h.pos : b.p.pos;
    return ev;
  }

  /** flight.js collide (not exported there): hop onto a roof just above, else push out along the normal. */
  function collide(p, S) {
    const h = S.solidHit(p.pos[0], p.pos[2]);
    if (!h || p.pos[1] >= h.roof + 0.5) return;
    if (h.roof - p.pos[1] <= 3) { p.pos[1] = h.roof + 0.5; return; }
    p.pos[0] += h.nx * h.depth; p.pos[2] += h.nz * h.depth;
  }

  /** How deep the body's centre is inside a solid footprint below its top (0 = not inside). */
  function inSolid(W, x, y, z) {
    let worst = 0;
    for (const s of W.shapes) {
      if (!s.solid || (s.kind !== 'lot' && s.kind !== 'building')) continue;
      const d = SH.sd(s, x, z);
      if (d < 0 && y < s.y1 - 0.05) worst = Math.max(worst, -d);
    }
    return worst;
  }

  /** A scripted push from direction dir (0..7, 0 = from -z) towards the block's centre. */
  function push(W, kind, dir, opts) {
    opts = opts || {};
    const a = (dir || 0) / 8 * Math.PI * 2, r = W.bound.r + 8;
    const x = -Math.sin(a) * r, z = -Math.cos(a) * r, yaw = a;
    const b = body(W, kind, [x, opts.y != null ? opts.y : null, z], yaw);
    const dt = 1 / 30, n = Math.round((opts.time || (r * 2 + 10) / 3) / dt), trace = [];
    let worst = 0;
    for (let i = 0; i < n; i++) {
      // keep heading at the centre (the walkers turn by sx): aim the yaw directly, as a player holding the stick would
      if (kind === 'hero') b.h.yaw = Math.atan2(-b.pos[0], -b.pos[2]);
      else b.p.yaw = Math.atan2(-b.pos[0], -b.pos[2]);
      step(W, b, { sy: 1, run: opts.run }, dt);
      if (Math.hypot(b.pos[0], b.pos[2]) < 0.5) break;
      const ins = inSolid(W, b.pos[0], b.pos[1] - (kind === 'hero' ? 0 : D.walk.stand) * (kind === 'dragon' ? 1 : 0), b.pos[2]);
      worst = Math.max(worst, ins);
      if (i % 10 === 0) trace.push(b.pos.slice());
    }
    return { trace, inside: worst, end: b.pos.slice(), body: b };
  }

  /* ---------- readouts ---------- */
  function read(W, b) {
    const S = W.solids(b.pad), x = b.pos[0], y = b.pos[1], z = b.pos[2];
    const ctx = { regionId: W.regionId, solidAt: S.solidAt, walkTop: S.walkTop };
    const ground = T.surfaceAt(W.regionId, x, z);
    const groundY = b.kind === 'hero' ? H.groundY(ctx, x, z) : WK.groundAt(ctx, x, z);
    const hit = S.solidHit(x, z), top = S.walkTop(x, z), roof = S.solidAt(x, z);
    const touch = hit || W.solids(b.pad + 0.05).solidHit(x, z);            // resting against a wall (held at pad + 1e-3)
    const feet = b.kind === 'dragon' ? y - D.walk.stand : y;
    const onTop = top != null && Math.abs(feet - top) < 0.15;
    const pl = { mode: 'air', pos: [x, b.kind === 'dragon' ? feet + 2 : y, z], speed: 0 };
    const land = WK.canLand(pl, W.regionId, S.solidAt, S.walkTop);
    return { x, y, z, ground, groundY, roof, walkTop: top, hit: hit ? { depth: hit.depth, nx: hit.nx, nz: hit.nz, roof: hit.roof } : null,
      onTop, blocked: !!touch && !onTop && feet < touch.roof - 0.05, land: { ok: land.ok, why: land.why || null },
      slope: T.surfaceSlope(W.regionId, x, z), inSolid: inSolid(W, x, feet, z) };
  }

  function lines(r) {
    const f = v => (v == null ? '-' : v.toFixed(2));
    return ['pos ' + f(r.x) + ' ' + f(r.y) + ' ' + f(r.z) + '   ground ' + f(r.ground) + '  stands at ' + f(r.groundY) + '  slope ' + f(r.slope),
      'push-out ' + (r.hit ? f(r.hit.depth) + '  normal ' + f(r.hit.nx) + ' ' + f(r.hit.nz) : '-') + '   roof ' + f(r.roof) + '  walk top ' + f(r.walkTop),
      (r.onTop ? 'ON WALK TOP' : r.blocked ? 'BLOCKED' : 'free') + (r.inSolid > 0 ? '  INSIDE ' + f(r.inSolid) : '') +
      '   landing ' + (r.land.ok ? 'allowed' : 'refused: ' + r.land.why)];
  }

  M.define('blocks', { catalog, entry, world, body, step, push, read, lines, inSolid, GROUNDS, BODIES });
})(typeof self !== 'undefined' ? self : this);
