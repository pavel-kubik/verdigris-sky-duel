// Phase 4 T02: the block preview's core (core/blocks.js) - every block of the catalog on every test ground: a scripted
// push from 8 directions never ends inside the solid (hero, dragon on foot, hovering dragon), a body stands on every
// walkable top and nowhere else on the block, the readouts equal the core queries, the preview regions stay hidden.
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), SE = core('settlement'), CI = core('city'), WK = core('walk'), HE = core('hero');
const B = core('blocks'), SH = core('shapes');

const cat = B.catalog();
const groups = new Set(cat.map(c => c.group));
for (const g of ['house', 'building', 'castle', 'bridge', 'tree', 'terrain']) ok(groups.has(g), 'catalog has ' + g + ' blocks');
ok(new Set(cat.map(c => c.id)).size === cat.length, 'every block id once (' + cat.length + ')');
for (const t of Object.keys(D.buildings)) ok(cat.some(c => c.type === t), 'every settlement / castle building type listed: ' + t);
for (const k of ['stone', 'wood']) ok(cat.some(c => c.id === 'bridge:' + k), 'bridge kind ' + k);
for (const k of ['plateau', 'cliff', 'cone']) ok(cat.some(c => c.id === 'terrain:' + k), 'terrain feature ' + k);
ok(B.catalog({ houses: { styles: ['a', 'b'], kinds: ['house', 'tower'] } }).filter(c => c.group === 'house').length === 3, 'house list from the kit: houses per style, landmarks once');

// pushes from 8 directions on every ground, for every body
let pushes = 0;
for (const c of cat) for (const g of B.GROUNDS) {
  const W = B.world(c.id, g);
  for (const k of B.BODIES) for (let d = 0; d < 8; d++) {
    const r = B.push(W, k, d);
    pushes++;
    if (r.inside > 0.05) ok(false, c.id + ' ' + g + ' ' + k + ' push from ' + d + ' ends ' + r.inside.toFixed(2) + ' inside the solid');
  }
}
ok(pushes === cat.length * 3 * 3 * 8, 'all pushes ran (' + pushes + ')');

// a push reaches the block: the walker stops at its side (not far away), the hover hops onto the roof
{
  const W = B.world('house:baroque:house', 'flat'), r = B.push(W, 'hero', 0);
  ok(CI.sd(W.lot, r.end[0], r.end[2]).d < 1.2 && CI.sd(W.lot, r.end[0], r.end[2]).d >= 0, 'hero pushed into a house ends at its wall');
  const rd = B.read(W, r.body);
  ok(rd.blocked, 'readout: blocked at the wall');
  const rin = B.read(W, B.body(W, 'hero', [W.lot.w / 2 + 0.3, 0, 0]));
  ok(rin.hit && rin.hit.depth > 0.3 && rin.hit.nx > 0.99, 'readout: push-out depth and normal inside the pad');
  const hv = B.push(W, 'hover', 0, { y: 9 });
  ok(hv.end[1] >= W.lot.top, 'a hovering dragon low over a house hops onto its roof');
  const ww = B.world('castle:wall', 'flat'), rw = B.push(ww, 'dragon', 2);
  ok(Math.abs(rw.end[0]) > 1.5 - 1e-6, 'a walking dragon stays outside a castle wall');
}

// standing: on every walk top, nowhere else on the block
for (const c of cat) {
  const W = B.world(c.id, 'flat'), S = W.solids(0);
  for (const s of W.shapes) {
    if (!s.solid || (s.kind !== 'lot' && s.kind !== 'building')) continue;
    const b = SH.bound(s), pts = [[b.x, b.z]];
    if (s.shape.type === 'capsule') pts.push([s.shape.seg[0] * 0.8, s.shape.seg[1] * 0.8], [s.shape.seg[2] * 0.8, s.shape.seg[3] * 0.8]);
    for (const [x, z] of pts) {
      if (SH.sd(s, x, z) > -0.2) continue;
      const hero = B.body(W, 'hero', [x, s.y1, z]);
      for (let i = 0; i < 30; i++) B.step(W, hero, {}, 1 / 30);
      const rd = B.read(W, hero);
      if (s.top != null) {
        near(hero.pos[1], s.top, 0.05, c.id + ': the hero stands on the walk top');
        ok(rd.onTop, c.id + ': readout says on the walk top');
        ok(WK.canLand({ mode: 'air', pos: [x, s.top + 2, z], speed: 0 }, W.regionId, S.solidAt, S.walkTop).ok, c.id + ': a dragon may land on the walk top');
      } else {
        ok(!rd.onTop && rd.walkTop == null, c.id + ': no walk top on a roof');
        const ld = WK.canLand({ mode: 'air', pos: [x, s.y1 + 2, z], speed: 0 }, W.regionId, S.solidAt, S.walkTop);
        ok(!ld.ok && ld.why === 'roof', c.id + ': landing on its roof refused with roof');
      }
    }
  }
}

// readouts equal the core queries at sampled points round each block
for (const id of ['house:gothic:house', 'castle:bastion', 'castle:wall', 'bridge:stone', 'terrain:cone', 'building:palisade']) for (const g of B.GROUNDS) {
  const W = B.world(id, g), S = W.solids(D.settlement.pad);
  for (let a = 0; a < 12; a++) for (const f of [0, 0.5, 1.1]) {
    const x = Math.sin(a * 0.52) * W.bound.r * f, z = Math.cos(a * 0.52) * W.bound.r * f;
    const dr = B.body(W, 'dragon', [x, null, z]), rd = B.read(W, dr);
    near(rd.ground, T.surfaceAt(W.regionId, x, z), 1e-9, id + ' ' + g + ': ground = terrain.surfaceAt');
    near(rd.groundY, WK.groundAt({ regionId: W.regionId, solidAt: S.solidAt }, x, z), 1e-9, id + ': stands at = walk.groundAt');
    const h = S.solidHit(x, z);
    ok((h == null) === (rd.hit == null) && (!h || Math.abs(h.depth - rd.hit.depth) < 1e-9), id + ': push-out = solidHit');
    const ld = WK.canLand({ mode: 'air', pos: [x, rd.y - D.walk.stand + 2, z], speed: 0 }, W.regionId, S.solidAt, S.walkTop);
    ok(ld.ok === rd.land.ok && (ld.why || null) === rd.land.why, id + ': landing = walk.canLand');
    const he = B.body(W, 'hero', [x, null, z]), rh = B.read(W, he);
    near(rh.groundY, HE.groundY({ regionId: W.regionId, walkTop: S.walkTop }, x, z), 1e-9, id + ': hero stands at = hero.groundY');
  }
}
{
  const W = B.world('castle:portcullis', 'flat');
  ok(W.town.gateClosed && SE.solidAt(W.town, 0, 0, 0) != null, 'the portcullis is a solid while closed');
}

// test grounds: slope and step as named; the preview regions are hidden from the region lists
{
  const sl = B.world('tree:pine', 'slope'), st = B.world('tree:pine', 'step');
  near(T.heightAt(sl.regionId, 10, 0) - T.heightAt(sl.regionId, 0, 0), 1.8, 1e-6, 'slope ground rises 0.18 per unit');
  ok(T.surfaceAt(st.regionId, 0, 0) - T.surfaceAt(st.regionId, -40, 0) > 0.9, 'step ground has a kerb');
  ok(Object.keys(D.regions).every(id => id.indexOf('_blocks') !== 0), 'preview regions are not in Object.keys(data.regions)');
  let seen = false; for (const id in D.regions) if (id.indexOf('_blocks') === 0) seen = true;
  ok(!seen, 'nor in for..in');
  ok(B.world('tree:pine', 'slope') === sl, 'worlds are cached');
}
