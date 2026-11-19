// Knights (Phase 4 T07, 004 spec 4.4 / 5.3): the stables call rule and timing, the alert-2 call, the cap, a burned stable
// sends none, the lance only on a landed or low dragon, arrow-proof but fire hurts, the grab needs carry 3, a drop from
// dropKill or higher kills, lower stuns, they ride home after returnAfter unseen; in game a Drake landed near Vyshgard
// during an alarm is charged by knights (and no knight stands inside a solid).
'use strict';
const { ok, near, core } = require('./harness.js');
const D = core('data'), KN = core('knights'), SE = core('settlement'), T = core('terrain'), S = core('state'), F = core('flight');
const { mulberry } = core('math');
const V = D.defenders.knight;

ok(D.buildings.stables.knights === 3, 'Vyshgard stables hold 3 knights');
ok(D.alert.responses[2].knights === true, 'alert 2 calls the stables at once');

const town = SE.build('bend');
const pl = town.places.find(p => p.castle);
const stable = town.buildings.find(b => b.type === 'stables' && b.place === pl.id);
ok(!!stable, 'the castle has stables');
ok(KN.stables(town).length >= 1, 'stables listed');

/** A stub campaign state for knights alone: one alarmed castle defender, the dragon at pos. */
function stub(pos, opts) {
  opts = opts || {};
  const p = F.newPilot(pos, 0, 0); p.mode = opts.mode || 'air';
  return { region: 'bend', town, squad: { list: [{ alive: true, state: opts.calm ? 'idle' : 'alert', place: pl.id }] },
           regionStates: { bend: { heat: opts.heat || 0 } }, dragon: { pilot: p, stage: 1 }, light: 'day' };
}
const far = [stable.pos[0] + 900, 600, stable.pos[2]];

/* call: nearest stable, its riders, the cap, a ruin sends none */
{
  const cs = stub(far, { calm: true });
  const ev = KN.call(cs, [pl.x, pl.z], 'test');
  ok(ev.length === 1 && ev[0].e === 'knights:called' && ev[0].n === 3, 'the stable sends its 3 knights');
  ok(cs.knights.list.length === 3 && cs.knights.list.every(k => k.state === 'ride'), 'three riders out');
  ok(KN.left(cs, stable) === 0, 'none left in the stable');
  const others = KN.stables(town).filter(b => b !== stable).reduce((n, b) => n + KN.left(cs, b), 0);
  ok(KN.call(cs, [pl.x, pl.z], 'again').length === (others ? 1 : 0), 'an empty stable sends nobody');
  for (const k of cs.knights.list) ok(!SE.hit(town, k.pos[0], k.pos[2], 0), 'a knight spawns outside the solids');
}
{
  const keep = V.max; V.max = 2;
  const cs = stub(far, { calm: true });
  const ev = KN.call(cs, [pl.x, pl.z], 'test');
  ok(ev[0].n === 2 && cs.knights.list.length === 2, 'at most max live riders per region');
  V.max = keep;
}
{
  const cs = stub(far, { calm: true });
  for (const b of KN.stables(town)) b.ruin = true;
  ok(KN.call(cs, [pl.x, pl.z], 'test').length === 0, 'a burned stable sends no knights');
  for (const b of town.buildings) if (b.type === 'stables') b.ruin = false;
}

/* call rule: an alarm lasting callAfter s; alert level 2 at once */
{
  const cs = stub(far);
  let ev = [];
  for (let t = 0; t < V.callAfter - 1; t += 0.5) ev.push(...KN.step(cs, 0.5, {}));
  ok(!ev.some(e => e.e === 'knights:called'), 'no call before callAfter s of alarm');
  for (let t = 0; t < 2; t += 0.5) ev.push(...KN.step(cs, 0.5, {}));
  ok(ev.filter(e => e.e === 'knights:called').length === 1, 'one call once the alarm lasted callAfter s');
  ev = [];
  for (let t = 0; t < 30; t += 0.5) ev.push(...KN.step(cs, 0.5, {}));
  ok(!ev.some(e => e.e === 'knights:called'), 'one call per alarm');
}
{
  const cs = stub(far);
  KN.step(cs, 0.1, {});
  for (let t = 0; t < 20; t += 0.5) KN.step(cs, 0.5, { callMult: 0.5 });
  ok(cs.knights.list.length === 0, 'callMult 0.5: still waiting at 20 s');
  for (let t = 0; t < 12; t += 0.5) KN.step(cs, 0.5, { callMult: 0.5 });
  ok(cs.knights.list.length === 3, 'callMult 0.5: called after 30 s');
}
{
  const cs = stub(far, { heat: 2.2 });
  const ev = KN.step(cs, 0.1, {});
  ok(ev.some(e => e.e === 'knights:called' && e.why === 'level'), 'alert level 2: an alarm calls at once');
}

/* the lance: landed or low only */
function oneKnight(dragonPos, mode) {
  const cs = stub(dragonPos, { calm: true, mode });
  KN.call(cs, [dragonPos[0], dragonPos[2]], 'test');
  const k = cs.knights.list[0];
  cs.knights.list = [k];
  return { cs, k };
}
{
  const gx = stable.pos[0] + 40, gz = stable.pos[2] + 10, g = T.surfaceAt('bend', gx, gz);
  const { cs, k } = oneKnight([gx, g + D.walk.stand, gz], 'ground');
  k.pos = [gx - 5, T.surfaceAt('bend', gx - 5, gz), gz]; k.state = 'chase'; k.yaw = Math.PI / 2;
  const ev = KN.step(cs, 0.1, {});
  const hit = ev.find(e => e.e === 'knight:lance');
  ok(!!hit && hit.damage === V.lance.damage, 'a landed dragon in reach takes the lance');
  ok(!KN.step(cs, 0.1, {}).some(e => e.e === 'knight:lance'), 'lance cooldown');
  ok(KN.low(cs, cs.dragon.pilot, 1), 'landed counts as low');
  const p = cs.dragon.pilot; p.mode = 'air';
  p.pos[1] = g + D.walk.stand + V.lance.maxAlt + 4;
  ok(!KN.low(cs, p, 1), 'above maxAlt is out of lance reach');
  k.cool = 0;
  ok(!KN.step(cs, 0.1, {}).some(e => e.e === 'knight:lance'), 'no lance on a dragon flying higher than maxAlt');
  p.pos[1] = g + D.walk.stand + V.lance.maxAlt - 3;
  k.cool = 0; k.pos = [gx - 5, T.surfaceAt('bend', gx - 5, gz), gz];
  ok(KN.step(cs, 0.1, {}).some(e => e.e === 'knight:lance'), 'a dragon flying lower than maxAlt takes the lance');
}

/* arrows do not hurt, fire does (x fireDamage); the breath burns them down */
{
  const { cs, k } = oneKnight(far, 'air');
  ok(KN.hurt(k, 5, 'arrow') === 0 && k.hp === V.hp, 'arrows do not hurt a knight');
  near(KN.hurt(k, 10, 'fire'), 10 * V.fireDamage, 1e-9, 'fire hurts x fireDamage');
  k.state = 'stun'; k.stunT = 100;                      // stands still in the fire
  const o = [k.pos[0] - 10, k.pos[1] + 3, k.pos[2]];
  cs.breath = { origin: o, dir: [1, 0, 0], range: 30, cone: 0.4 };
  let ev = [];
  for (let i = 0; i < 200 && k.alive; i++) ev.push(...KN.step(cs, 0.1, {}));
  ok(ev.some(e => e.e === 'knight:killed' && e.cause === 'fire'), 'the breath burns a knight down');
  ok(cs.knights.list.length === 0, 'a dead knight leaves the field');
  ok(KN.left(cs, stable) === 2, 'a killed knight is lost to its stable for this visit');
}

/* grab needs carry 3; a drop from dropKill or higher kills, lower stuns */
{
  const gx = stable.pos[0] + 60, gz = stable.pos[2], g = T.surfaceAt('bend', gx, gz);
  const { cs, k } = oneKnight([gx, g + 9, gz], 'air');
  k.pos = [gx, T.surfaceAt('bend', gx, gz), gz]; k.state = 'chase';
  const p = cs.dragon.pilot;
  const r2 = KN.reach(cs, p, 2, 1), r3 = KN.reach(cs, p, 3, 1);
  ok(!r2.best && r2.heavy === k, 'a Drake (carry 2) cannot lift a knight');
  ok(r3.best === k, 'a Wyrm (carry 3) can');
  ok(KN.grab(cs, k)[0].e === 'knight:grabbed' && cs.knights.carried === k.id, 'grabbed');
  p.pos[1] = g + 30;
  KN.step(cs, 0.05, { scale: 1 });
  ok(k.pos[1] > g + 20, 'a carried knight hangs under the claws');
  const dr = KN.drop(cs, p);
  ok(dr[0].e === 'knight:dropped' && dr[0].h >= V.dropKill, 'dropped from high: ' + dr[0].h.toFixed(1));
  let ev = [];
  for (let i = 0; i < 100 && k.alive; i++) ev.push(...KN.step(cs, 0.05, {}));
  ok(ev.some(e => e.e === 'knight:killed' && e.cause === 'fall'), 'a drop from dropKill or higher kills');
}
{
  const gx = stable.pos[0] + 60, gz = stable.pos[2], g = T.surfaceAt('bend', gx, gz);
  const { cs, k } = oneKnight([gx, g + 9, gz], 'air');
  KN.grab(cs, k);
  const p = cs.dragon.pilot; p.pos[1] = g + D.grab.clawDrop + KN.EYE + 5;
  KN.step(cs, 0.05, { scale: 1 });
  const dr = KN.drop(cs, p);
  ok(dr[0].h < V.dropKill, 'a low drop: ' + dr[0].h.toFixed(1));
  let ev = [];
  for (let i = 0; i < 40; i++) ev.push(...KN.step(cs, 0.05, {}));
  ok(k.alive && ev.some(e => e.e === 'knight:stunned'), 'a low drop only stuns');
}
{
  // landing with a knight in the claws lets it go
  const gx = stable.pos[0] + 60, gz = stable.pos[2], g = T.surfaceAt('bend', gx, gz);
  const { cs, k } = oneKnight([gx, g + 9, gz], 'air');
  KN.grab(cs, k);
  cs.dragon.pilot.mode = 'ground';
  const ev = KN.step(cs, 0.05, {});
  ok(ev.some(e => e.e === 'knight:dropped') && cs.knights.carried == null, 'landing lets the knight go');
}

/* they ride home after returnAfter s without sight */
{
  const cs = stub(far, { calm: true });
  KN.call(cs, [stable.pos[0] + 120, stable.pos[2] + 40], 'test');
  let ev = [];
  for (let t = 0; t < V.returnAfter - 2; t += 0.25) ev.push(...KN.step(cs, 0.25, {}));
  ok(cs.knights.list.length === 3 && cs.knights.list.every(k => k.state === 'ride'), 'still riding before returnAfter');
  for (let t = 0; t < 4; t += 0.25) ev.push(...KN.step(cs, 0.25, {}));
  ok(cs.knights.list.every(k => k.state === 'return'), 'riding home after returnAfter unseen');
  for (let t = 0; t < 120 && cs.knights.list.length; t += 0.25) ev.push(...KN.step(cs, 0.25, {}));
  ok(cs.knights.list.length === 0 && ev.filter(e => e.e === 'knight:home').length === 3, 'all back in the stable');
  ok(KN.left(cs, stable) === 3, 'the stable can send them again');
}

/* in game: a Drake landed near Vyshgard during an alarm is charged by knights */
{
  const cs = S.create({ regionId: 'bend', rng: mulberry(7) });
  cs.dragon.stage = 1; cs.dragon.hp = 99999;
  const st = cs.town.buildings.find(b => b.type === 'stables');
  const c = cs.town.places.find(p => p.castle);
  // outside the gate side, 60 out of the castle centre toward the stables' side
  const a = Math.atan2(st.pos[0] - c.x, st.pos[2] - c.z), x = c.x + Math.sin(a) * 110, z = c.z + Math.cos(a) * 110;
  const g = T.surfaceAt('bend', x, z);
  cs.dragon.pilot = F.newPilot([x, g + D.walk.stand, z], a + Math.PI, 0);
  cs.dragon.pilot.mode = 'ground';
  cs.regionStates.bend = { heat: 2.3 };
  const ev = [];
  let inSolid = 0;
  for (let i = 0; i < 1200; i++) {
    const p = cs.dragon.pilot; p.pos = [x, g + D.walk.stand, z]; p.mode = 'ground'; p.speed = 0; p.vel = [0, 0, 0];
    for (const e of S.step(cs, {}, 0.05)) ev.push(e);
    for (const k of (cs.knights && cs.knights.list) || []) { const h = SE.hit(cs.town, k.pos[0], k.pos[2], 0); if (h && h.b.type !== 'portcullis') { inSolid++; if (inSolid === 1) console.log('     in solid', h.b.type, h.depth); } }   // the gate is raised for its own riders
    if (ev.some(e => e.e === 'knight:lance')) break;
  }
  ok(ev.some(e => e.e === 'knights:called'), 'the alarm calls the knights');
  ok(ev.some(e => e.e === 'knight:lance'), 'the knights charge and lance the landed Drake');
  ok(inSolid === 0, 'no knight inside a solid');
  ok(cs.dragon.hp < 99999, 'the lance costs HP');
}
