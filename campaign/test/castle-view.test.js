// Castle and settlements in the Bend (Phase 3 T04, 003 spec section 6): castle LOD with hysteresis, named places of the
// Veltava Bend (Vyshgard, Lethna, Holeshwick, Troyvale, Petrovel) with EN + CS names, discovery event with the name,
// and the castle's own compass marker kind.
'use strict';
const fs = require('fs'), path = require('path');
const { ok, core } = require('./harness.js');
const D = core('data'), CA = core('castle'), SE = core('settlement'), S = core('state'), NV = core('nav'), F = core('flight'), T = core('terrain');
const { mulberry } = core('math');
const dt = 1 / 60;

/* LOD: full near, silhouette far, off beyond; hysteresis band around both lines */
const L = D.castle.lod;
ok(L.band > 0 && L.near + L.band < L.far - L.band, 'lod band fits between near and far');
ok(CA.lodFor(10, 'sil') === 'full' && CA.lodFor(L.near + L.band - 1, 'full') === 'full', 'full stays full inside near + band');
ok(CA.lodFor(L.near, 'sil') === 'sil', 'sil stays sil until near - band');
ok(CA.lodFor(L.near - L.band - 1, 'sil') === 'full', 'sil -> full inside near - band');
ok(CA.lodFor(L.near + L.band + 1, 'full') === 'sil', 'full -> sil past near + band');
ok(CA.lodFor(L.far, 'sil') === 'sil' && CA.lodFor(L.far + L.band + 1, 'sil') === 'off', 'sil -> off past far + band');
ok(CA.lodFor(L.far, 'off') === 'off' && CA.lodFor(L.far - L.band - 1, 'off') === 'sil', 'off -> sil inside far - band');
ok(L.far >= 600 + L.band, 'the castle silhouette shows from 600+ units');
let flips = 0, cur = 'full';
for (let i = 0; i < 400; i++) { const n = CA.lodFor(L.near + Math.sin(i) * (L.band - 1), cur); if (n !== cur) flips++; cur = n; }
ok(flips === 0, 'no LOD flicker while the camera wobbles on the near line');

/* named places of the Bend */
const town = SE.build('bend');
const want = { vyshgard: 'castle', lethna: 'outpost', holeshwick: 'village', troyvale: 'hamlet', petrovel: 'outpostS' };
for (const [name, type] of Object.entries(want)) {
  const pl = town.places.find(p => p.name === name);
  ok(pl && pl.type === type, 'the Bend has ' + name + ' (' + type + ')');
  ok(NV.placeKey(pl) === 'c.placeName.' + name, 'named key for ' + name);
}
ok(town.places.filter(p => p.castle).length === 1, 'one castle in the Bend');
ok(NV.placeKey(SE.build('farm').places[0]) === 'c.place.' + SE.build('farm').places[0].type, 'unnamed places keep their type name');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n.js'), 'utf8');
for (const name of Object.keys(want)) ok(src.split("'c.placeName." + name + "'").length === 3, 'EN and CS name for ' + name);

/* discovery of the castle: event with the name key, castle marker kind on the compass */
{
  const cs = S.create({ regionId: 'bend', rng: mulberry(9) });
  cs.field.list.length = 0; cs.field.herds.length = 0;
  cs.dragon.stage = 1; cs.dragon.hunger = 100;
  const pl = S.ensureTown(cs).places.find(p => p.castle);
  const x = pl.x + 150, z = pl.z + 150;
  cs.dragon.pilot = F.newPilot([x, T.surfaceAt('bend', x, z) + 80, z], 0, 0);
  Object.assign(cs.dragon.pilot, { mode: 'air', speed: 0 });
  let ev = [];
  for (let i = 0; i < 90; i++) { cs.dragon.pilot.pos = [x, T.surfaceAt('bend', x, z) + 80, z]; ev = ev.concat(S.step(cs, { sy: 0 }, dt)); }
  const d = ev.find(e => e.e === 'place:discovered' && e.id === pl.id);
  ok(d && d.castle && d.key === 'c.placeName.vyshgard', 'castle discovered with its name key');
  const m = NV.markers(cs).find(q => q.key === 'place:' + pl.id);
  ok(m && m.kind === 'castle' && m.label.key === 'c.placeName.vyshgard', 'castle marker on the compass with its name');
}
