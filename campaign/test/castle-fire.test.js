// Castle fire and char (Phase 3 T06, 003 spec 7): wooden roofs, hoardings, the workshop and the stables burn; the
// wooden buildings become ruins, stone pieces lose their roof part and turn charred but stay solid; archers on a
// burned-out tower die; char state is saved with the ruins; rebuild after fire.rebuild restores colour and roof.
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), SE = core('settlement'), DF = core('defenders'), S = core('state'), SV = core('save'), F = core('flight'), AL = core('alert');
const { mulberry } = core('math');

const burnOut = (town, b, now) => {          // burn b to the end with the breath off (fire.burn only), returns the events
  const ev = [];
  b.fire = 1e-3;
  for (let i = 0; i < 20000 && b.fire > 0; i++) for (const e of SE.burn(town, null, 0.1, { now, rng: () => 1 })) ev.push(e);
  return ev;
};

/* data: which castle pieces burn */
for (const [type, B] of Object.entries(D.buildings)) {
  if (!B.stone) continue;
  if (B.woodHp > 0) ok(B.woodHp < B.hp, type + ': wooden parts burn before the stone would');
}
ok(!(D.buildings.wall.woodHp > 0) && !(D.buildings.bastion.woodHp > 0), 'walls and bastions have no wood: they never burn');
['ctower', 'gatehouse', 'keep', 'chapel', 'rotunda'].forEach(t => ok(D.buildings[t].woodHp > 0, t + ' has wooden parts'));

/* a stone piece never becomes a non-solid ruin */
{
  const town = SE.build('bend'), pl = town.places.find(p => p.castle);
  const own = town.buildings.filter(b => b.place === pl.id);
  for (const b of own) {
    const B = D.buildings[b.type];
    if (B.stone) near(b.hp, B.woodHp > 0 ? B.woodHp : B.hp, 0, b.type + ' starts with its wood hp');
    if (!SE.burnable(b)) { ok(B.stone && !(B.woodHp > 0) || B.hp === 0, b.type + ' cannot burn'); continue; }
    const top = SE.topOf(b), probe = b.seg ? [(b.seg[0] + b.seg[2]) / 2, (b.seg[1] + b.seg[3]) / 2] : [b.pos[0], b.pos[2]];
    const ev = burnOut(town, b, 100);
    ok(!b.fire, b.type + ' fire is out');
    if (B.stone) {
      ok(b.char && !b.ruin && b.charAt === 100, b.type + ' is charred, not a ruin');
      ok(ev.some(e => e.e === 'building:charred' && e.id === b.id) && !ev.some(e => e.e === 'building:ruined' && e.id === b.id), b.type + ': charred event, no ruined event');
      ok(SE.solidAt(town, probe[0], probe[1]) >= top - 1e-6, b.type + ' is still a solid');
      ok(!SE.burnable(b) && SE.burnedOut(b), b.type + ' charred: burns no more, burned out');
      b.fire = 1e-3; SE.burn(town, null, 1, { now: 101 }); ok(b.char && !b.ruin, b.type + ' a charred shell never turns into a ruin');
      b.fire = 0;
    } else {
      ok(b.ruin && ev.some(e => e.e === 'building:ruined' && e.id === b.id), b.type + ' (wood) burns to a ruin');
    }
  }
  ok(own.filter(b => D.buildings[b.type].stone).every(b => !b.ruin), 'no stone castle piece is a ruin after the whole castle burned');
  ok(own.filter(b => b.type === 'wall' || b.type === 'bastion').every(b => !b.char && !b.fire), 'walls and bastions untouched');
  // fire spreads from a burning stable to its wooden or roofed neighbours, never to a wall
  const t2 = SE.build('bend'), st = t2.buildings.find(b => b.place === pl.id && b.type === 'stables');
  st.fire = 1e-3;
  const lit = new Set();
  for (let i = 0; i < 400; i++) for (const e of SE.burn(t2, null, 0.1, { rng: () => 0, now: 0 })) if (e.e === 'building:burning') lit.add(e.type);
  ok(!lit.has('wall') && !lit.has('bastion'), 'fire never spreads to a wall or a bastion: ' + [...lit].join(','));

  /* rebuild restores colour and roof (the char flag and the wood hp) */
  const R = D.fire.rebuild;
  const charred = own.filter(b => b.char);
  ok(SE.rebuild(town, 100 + R - 1).filter(e => e.char).length === 0, 'nothing comes back before fire.rebuild');
  const back = SE.rebuild(town, 100 + R + 1, () => true);   // the dragon in the footprint blocks ruins, not charred shells
  ok(back.filter(e => e.char).length === charred.length, 'charred pieces rebuilt: ' + back.length);
  ok(charred.every(b => !b.char && b.charAt == null && b.hp === D.buildings[b.type].woodHp && SE.burnable(b)), 'roof back: full wood hp, burnable again');
  ok(own.some(b => b.ruin), 'a blocked wooden ruin waits');
}

/* archers on a burned-out tower die; they come back with the roof */
{
  const town = SE.build('bend'), pl = town.places.find(p => p.castle);
  const tower = town.buildings.find(b => b.place === pl.id && b.type === 'ctower');
  const cs = S.create({ regionId: 'bend', rng: mulberry(5) });
  cs.dragon.stage = 1; cs.dragon.hp = 99999;
  cs.dragon.pilot = F.newPilot([pl.x, 400, pl.z - 900], 0, 30);
  S.step(cs, {}, 0.016);
  const tw = cs.town.buildings.find(b => b.id === tower.id);
  const on = () => cs.squad.list.filter(d => d.building === tw.id);
  ok(on().length > 0 && on().every(d => d.alive), 'archers on the round tower');
  let ev = [];
  tw.fire = 1e-3; tw.hp = 0.01;
  for (let i = 0; i < 4; i++) ev = ev.concat(S.step(cs, {}, 0.05));
  ok(tw.char && !tw.ruin, 'the tower burned out (charred) in game');
  ok(on().every(d => !d.alive), 'its archers fell');
  ok(ev.some(e => e.e === 'defender:killed' && on().some(d => d.id === e.id)), 'defender:killed for them');
  ok(ev.some(e => e.e === 'building:charred' && e.id === tw.id), 'building:charred event');
  ok(AL.towerDown(cs.town), 'a charred round tower counts as a watchtower down');
  const rs = cs.regionStates.bend;
  ok(rs.ruins.some(r => r.id === tw.id && r.char === true && typeof r.at === 'number'), 'char saved in the region ruins');
  ok(AL.towerDown(rs), 'towerDown from the region state too');

  /* char state saved with ruins, survives a save round trip */
  const mem = () => ({ m: {}, getItem(k) { return k in this.m ? this.m[k] : null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } });
  const st = mem();
  ok(SV.store(st, cs), 'stored');
  const raw = JSON.parse(st.m[D.saveKey]);
  ok(raw.regions.bend.ruins.some(r => r.id === tw.id && r.char === true), 'char in the saved ruins');
  const r = SV.load(st); ok(r.status === 'ok', 'loads');
  const back = SV.deserialise(r.data, mulberry(9));
  ok(back.regionStates.bend.ruins.some(q => q.id === tw.id && q.char === true), 'char back in the region state');
  const t3 = SE.build('bend', back.regionStates.bend), b3 = t3.buildings.find(b => b.id === tw.id);
  ok(b3.char && !b3.ruin && SE.solidAt(t3, b3.pos[0], b3.pos[2]) != null, 'rebuilt town: the tower is charred and solid');
  const sq3 = DF.spawn(t3, mulberry(3));
  ok(sq3.list.filter(d => d.building === tw.id).every(d => !d.alive), 'no archers spawn on a charred tower');
  // a charred id on a non-stone building (corrupt or old data) is not trusted as a char
  const t4 = SE.build('bend', { ruins: [{ id: t3.buildings.find(b => b.type === 'hall').id, at: 1, char: true }] });
  ok(t4.buildings.every(b => !b.char), 'char flag ignored on a wooden building');

  /* rebuild in game: the roof comes back and new archers stand on it */
  tw.charAt = cs.stats.played - D.fire.rebuild - 1;
  ev = [];
  for (let i = 0; i < 4; i++) ev = ev.concat(S.step(cs, {}, 0.05));
  ok(!tw.char && ev.some(e => e.e === 'building:rebuilt' && e.id === tw.id), 'tower rebuilt in game');
  ok(!rs.ruins.some(q => q.id === tw.id), 'gone from the saved ruins');
  ok(on().every(d => d.alive), 'archers back on the rebuilt tower');
}
