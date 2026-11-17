// Prahold and the villages (core/city.js): deterministic lots in every district, real landmarks at their places, no
// lot in the river, on a road or over another, the styles mixed so streets do not repeat; collisions for flight and
// walking; Mount Rip from the real terrain model; the world laid out north (Rip) to south (Prahold).
'use strict';
const { ok, core } = require('./harness.js');
const D = core('data'), T = core('terrain'), CI = core('city'), S = core('state'), F = core('flight'), RG = core('region');
const { mulberry } = core('math');

const bend = CI.build('bend');
ok(bend && bend === CI.build('bend'), 'the Bend has a town, cached');
ok(bend.lots.length > 1200, 'Prahold has over 1200 buildings: ' + bend.lots.length);
const per = {};
for (const l of bend.lots) per[l.district] = (per[l.district] || 0) + 1;
for (const d of D.regions.bend.city.districts) ok(per[d.id] >= 10, 'district ' + d.id + ' is built: ' + per[d.id]);
for (const name of ['vitus', 'townhall', 'tyn', 'powder', 'nicholas', 'clementinum', 'museum', 'karlov', 'oldnew'])
  ok(bend.lots.some(l => l.name === name), 'landmark ' + name);
const styles = new Set(bend.lots.map(l => l.style)), kinds = new Set(bend.lots.map(l => l.kind));
for (const s of ['gothic', 'renaissance', 'baroque', 'classic', 'timber', 'cottage']) ok(styles.has(s), 'style ' + s + ' in Prahold');
for (const k of ['house', 'church', 'cathedral', 'domechurch', 'townhall', 'gatetower', 'palace']) ok(kinds.has(k), 'kind ' + k + ' in Prahold');

// neighbours differ: along the Staromark rows, consecutive houses rarely share style, storeys and frontage
{
  const houses = bend.lots.filter(l => l.district === 'staromark' && l.kind === 'house');
  let same = 0;
  for (let i = 1; i < houses.length; i++) {
    const a = houses[i - 1], b = houses[i];
    if (a.style === b.style && a.floors === b.floors && Math.abs(a.w - b.w) < 0.3) same++;
  }
  ok(same / houses.length < 0.12, 'neighbouring houses differ: ' + same + ' of ' + houses.length + ' look alike');
  ok(new Set(houses.map(h => h.seed)).size === houses.length, 'every house has its own seed');
}

// placement: dry, off roads and bridges, inside the region, no overlap
{
  let bad = 0, over = 0;
  const box = l => { const c = Math.cos(l.yaw), s = Math.sin(l.yaw); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [l.x + u * l.w / 2 * c + v * l.d / 2 * s, l.z - u * l.w / 2 * s + v * l.d / 2 * c]); };
  for (const l of bend.lots) {
    if (l.name) continue;
    for (const [x, z] of box(l)) if (T.liquidAt('bend', x, z) || T.deckAt('bend', x, z) || T.lineDist('bend', 'road', x, z) < 4) { bad++; break; }
  }
  ok(bad === 0, 'no house in the river, on a bridge or a road: ' + bad);
  const plain = bend.lots.filter(l => !l.name);
  for (let i = 0; i < plain.length; i += 3) {
    const a = plain[i];
    for (const b of CI.lotsNear('bend', a.x, a.z, 30)) if (b !== a && !b.name && CI.sd(b, a.x, a.z).d < -0.5) over++;
  }
  ok(over === 0, 'houses do not stand inside each other: ' + over);
  ok(bend.lots.every(l => l.top > l.y + l.h && l.h > 2), 'every lot has walls and a roof above them');
}

// determinism: the same layout from a fresh module
{
  const key = bend.lots.slice(0, 50).map(l => [l.x.toFixed(3), l.z.toFixed(3), l.style, l.floors].join()).join(';');
  delete require.cache[require.resolve('../core/city.js')];
  const M = require('../core/umd.js');
  delete M.mods.city;
  require('../core/city.js');
  const again = M.need('city').build('bend');
  ok(again !== bend && again.lots.slice(0, 50).map(l => [l.x.toFixed(3), l.z.toFixed(3), l.style, l.floors].join()).join(';') === key, 'the same town every time');
  M.mods.city = CI;
}

// villages in every region, round greens with a chapel, cottages and barns
for (const id of ['ash', 'wild', 'farm', 'bend']) {
  const c = CI.build(id);
  for (const v of D.regions[id].city.villages) {
    const n = c.lots.filter(l => l.district === v.id).length;
    ok(n >= 8, id + ' village ' + v.id + ' has houses: ' + n);
    ok(T.cityAt(id, v.x, v.z) === v && CI.placeAt(id, v.x, v.z) === v, v.id + ' is a named place');
  }
  ok(c.lots.some(l => l.kind === 'chapel' || l.kind === 'church'), id + ': a chapel on a green');
  ok(c.lots.some(l => l.kind === 'barn' || l.kind === 'shed'), id + ': barns behind the cottages');
}
ok(T.fields('farm').every(f => !T.cityAt('farm', f.x, f.z)), 'crop fields keep out of the villages');

// collisions: solidAt / hit on a house, nothing in the street; the dragon's solids include the town
{
  const l = bend.lots.find(q => q.district === 'staromark' && q.kind === 'house');
  ok(CI.solidAt('bend', l.x, l.z) === l.top || CI.solidAt('bend', l.x, l.z) >= l.top, 'solid over a house');
  const h = CI.hit('bend', l.x, l.z, 0.5);
  ok(h && h.depth > 0 && Math.abs(Math.hypot(h.nx, h.nz) - 1) < 1e-6, 'hit pushes out of a house');
  const sq = bend.squares.find(q => q.name === 'oldsq');
  ok(CI.solidAt('bend', sq.x + 5, sq.z) == null && CI.pavedAt('bend', sq.x + 5, sq.z) === 2, 'the Staromark square is open, paved');
  const cs = S.create({ regionId: 'bend', rng: mulberry(3) });
  const sol = S.solids(cs, 1);
  ok(sol.solidAt(l.x, l.z) >= l.top - 1e-9 && sol.solidHit(l.x, l.z).depth > 0, 'the dragon\'s solids include the houses of Prahold');
  const p = F.newPilot([l.x, l.top + 6, l.z], l.yaw, 8);
  for (let i = 0; i < 30; i++) F.step(p, { sy: -1 }, 1 / 60, { regionId: 'bend', stats: { turn: 1, cruise: 8, boost: 12 }, solidAt: sol.solidAt, solidHit: sol.solidHit });
  ok(p.pos[1] > l.top, 'a dragon diving onto a roof stays above it: ' + p.pos[1].toFixed(1) + ' > ' + l.top.toFixed(1));
}

// Mount Rip: the real hill (baked), the crater in its summit, the cave on the south flank toward Prahold
{
  const R = D.regions.ash;
  ok(R.terrain.dem === 'demRip' && T.demGrid('ash').n === 221, 'Mount Rip comes from the real terrain model');
  const top = T.heightAt('ash', -40, 0), plain = T.heightAt('ash', 0, -700);
  ok(top - plain > 90, 'Rip rises from the plain: ' + (top - plain).toFixed(0));
  ok(R.lair.z < 0 && R.lair.facing === Math.PI && R.exits[0].to === 'wild' && Math.abs(Math.abs(RG.arcMid(R.exits[0])) - Math.PI) < 1e-9, 'the cave and the way out face south');
  const w = D.map.world;
  ok(w.bend[0] === 0 && w.bend[1] === 0 && w.ash[1] > w.wild[1] && w.wild[1] > w.farm[1] && w.farm[1] > w.bend[1], 'the world map: Prahold in the middle, Rip to the north');
}
