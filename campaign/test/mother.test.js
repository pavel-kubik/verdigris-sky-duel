// The mother dragon (T05): lesson order and completion rules, where she leads, her demonstration, keeping out of
// danger zones (defender range), visits after the lessons (rarer for a Drake), region changes and the save.
'use strict';
const { ok, core } = require('./harness.js');
const S = core('state'), MO = core('mother'), LR = core('lair'), D = core('data'), T = core('terrain'), F = core('flight'), PR = core('prey'), SV = core('save');
const { mulberry } = core('math');
const dt = 1 / 30;
const ids = D.mother.lessons.map(l => l.id);

function hatched(seed, region) {
  const cs = S.create({ regionId: region || 'ash', rng: mulberry(seed || 5) });
  LR.hatch(cs);
  return cs;
}
function outside(seed) {
  const cs = hatched(seed);
  S.lairLeave(cs);
  return cs;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** Moves the pilot straight ahead at cruise (no flight physics, so tests control pitch and place). */
function glide(cs, secs, fn) {
  const p = cs.dragon.pilot, out = [];
  for (let t = 0; t < secs; t += dt) {
    p.pos[0] += Math.sin(p.yaw) * 30 * dt; p.pos[2] += Math.cos(p.yaw) * 30 * dt;
    p.pos[1] = Math.max(p.pos[1], T.surfaceAt(cs.region, p.pos[0], p.pos[2]) + 20);
    out.push(...MO.step(cs, fn ? fn(t) || [] : [], dt));
  }
  return out;
}

// 1. Lessons are data rows in the order of the spec; no mother = nothing happens
ok(ids.join() === 'fly,dive,grab,eat,roast,carry,rest', 'lessons: fly, dive, grab, eat, roast, carry, rest');
ok(D.mother.lessons.every(l => l.done && (l.done.event || l.done.follow || l.done.dive)), 'every lesson has a completion rule');
{
  const cs = S.create({ regionId: 'ash', rng: mulberry(1) });
  cs.dragon.pilot = F.newPilot([0, 120, 300], 0, 30);
  ok(MO.step(cs, [{ e: 'prey:grabbed' }], dt).length === 0 && !cs.mom && MO.lesson(cs) === null && MO.line(cs) === null, 'no mother (phase 1 save): no lessons, no caption');
}

// 2. Hatching: she is in the lair with the hatchling; leaving puts her beside it outside
{
  const cs = hatched();
  ok(cs.story.mother.at === 'lair' && MO.lesson(cs).id === 'fly' && MO.line(cs) === 'c.mother.lair' && !cs.mom, 'in the lair: lesson fly, "leave the lair" caption, not flying');
  const ev = S.lairLeave(cs);
  ok(ev.some(e => e.e === 'lair:leave') && cs.story.mother.at === 'air' && cs.mom, 'leaving the lair: she comes out too');
  ok(dist(cs.mom.pos, cs.dragon.pilot.pos) < 40, 'she starts beside the hatchling');
  ok(MO.line(cs) === 'c.mother.fly', 'outside: the fly lesson caption');
}

// 3. Fly: staying close to her for 6 s completes it; drifting far away does not
{
  const cs = outside();
  const ev = glide(cs, 8);
  const l = ev.find(e => e.e === 'mother:lesson');
  ok(l && l.id === 'fly' && l.next === 'dive' && MO.lesson(cs).id === 'dive', 'following her for 6 s completes fly');
  ok(cs.mom.phase === 'praise' && MO.line(cs) === 'c.mother.good.fly', 'she praises (wing to wing)');
  const far = outside(6); far.mom.pos = [far.mom.pos[0] + 300, far.mom.pos[1], far.mom.pos[2]];
  far.dragon.pilot.yaw += Math.PI;                          // flies away from her
  let got = false;
  for (let t = 0; t < 4; t += dt) { far.dragon.pilot.pos[2] -= 60 * dt; if (MO.step(far, [], dt).length) got = true; }
  ok(!got && MO.lesson(far).id === 'fly', 'flying away from her does not count');
}

// 4. Event lessons complete only on their own event, in order
{
  const cs = outside();
  cs.story.mother.lesson = ids.indexOf('grab');
  ok(MO.step(cs, [{ e: 'lair:rest' }, { e: 'prey:eaten' }], dt).length === 0 && MO.lesson(cs).id === 'grab', 'other events do not complete the grab lesson');
  const ev = MO.step(cs, [{ e: 'prey:grabbed', type: 'goat' }], dt);
  ok(ev.length === 1 && ev[0].id === 'grab' && MO.lesson(cs).id === 'eat', 'prey:grabbed completes grab -> eat');
  MO.step(cs, [{ e: 'prey:eaten' }], dt);
  ok(MO.lesson(cs).id === 'roast', 'eating completes eat -> roast');
  MO.step(cs, [{ e: 'prey:grabbed' }], dt);
  ok(MO.lesson(cs).id === 'roast', 'a later grab does not skip roast');
  MO.step(cs, [{ e: 'prey:roasted', chunks: 3 }], dt);
  MO.step(cs, [{ e: 'lair:enter' }, { e: 'lair:stored', type: 'goat' }], dt);
  ok(MO.lesson(cs).id === 'rest' && cs.story.mother.at === 'lair', 'carrying a prey into the larder completes carry; she is in the lair too');
  ok(MO.line(cs) === 'c.mother.rest', 'in the lair: the rest caption');
  const done = S.lairRest(cs);
  ok(done.some(e => e.e === 'mother:lesson' && e.id === 'rest') && done.some(e => e.e === 'mother:done'), 'Rest in the lair completes the last lesson');
  ok(cs.story.mother.at === 'done' && MO.lesson(cs) === null, 'all lessons done');
  ok(done.findIndex(e => e.e === 'mother:done') < done.findIndex(e => e.e === 'save'), 'the autosave after rest includes the finished lessons');
}

// 5. Dive: pitched down for 0.8 s
{
  const cs = outside();
  cs.story.mother.lesson = ids.indexOf('dive');
  cs.dragon.pilot.pitch = -0.1;
  ok(glide(cs, 2).length === 0, 'level flight is not a dive');
  cs.dragon.pilot.pitch = -0.5;
  const ev = glide(cs, 1);
  ok(ev.some(e => e.id === 'dive') && MO.lesson(cs).id === 'grab', 'a steep dive completes dive');
}

// 6. Goals: liftable herd, heavy prey (route to the Wildwood when the region has none), the lair (route home)
{
  const cs = outside(7);
  cs.story.mother.lesson = ids.indexOf('grab');
  const g = MO.goal(cs);
  ok(g && g.kind === 'herd' && D.prey[PR.byId(cs.field, g.prey).type].size <= D.stages[0].carry, 'grab: she leads to prey the hatchling can lift');
  cs.story.mother.lesson = ids.indexOf('roast');
  const r = MO.goal(cs);
  ok(r && r.kind === 'route' && r.route === 'wild', 'roast in the Ash Wastes (goats only): she leads to the Wildwood exit');
  ok(core('region').arcAt('ash', r.pos), 'the route point lies inside the exit arc');
  const w = S.create({ regionId: 'wild', rng: mulberry(8) });
  w.story.mother = { lesson: ids.indexOf('roast'), at: 'air' };
  w.dragon.pilot = F.newPilot([0, 80, 0], 0, 30);
  const h = MO.goal(w);
  ok(h && h.kind === 'heavy' && D.prey[PR.byId(w.field, h.prey).type].size > D.stages[0].carry, 'roast in the Wildwood: she leads to a heavy prey (boar)');
  w.story.mother.lesson = ids.indexOf('rest');
  const home = MO.goal(w);
  ok(home.kind === 'route' && home.route === 'ash', 'rest in the Wildwood: she leads home to the Ash Wastes');
  cs.story.mother.lesson = ids.indexOf('rest');
  ok(MO.goal(cs).kind === 'lair' && dist(MO.goal(cs).pos, LR.mouthPos('ash')) < 1e-6, 'rest in the Ash Wastes: she leads to the cave mouth');
  cs.story.mother.lesson = ids.indexOf('carry');
  ok(MO.goal(cs).kind === 'herd' && MO.line(cs) === 'c.mother.carry', 'carry with empty claws: first to a herd');
  cs.story.mother.lesson = ids.indexOf('fly');
  ok(MO.goal(cs) === null, 'fly: no goal, she flies ahead');
}

// 7. She leads ahead toward the goal, demonstrates near it (low over the prey), then circles and waits
{
  const cs = outside(9);
  cs.story.mother.lesson = ids.indexOf('grab');
  const g = MO.goal(cs), p = cs.dragon.pilot;
  // the hatchling arrives 90 out from the prey, heading at it
  const a = Math.atan2(p.pos[0] - g.pos[0], p.pos[2] - g.pos[2]);
  p.pos = [g.pos[0] + Math.sin(a) * 90, g.pos[1] + 30, g.pos[2] + Math.cos(a) * 90]; p.yaw = a + Math.PI;
  MO.placeBeside(cs, 'lead');
  let minAbove = Infinity, phases = new Set();
  const prey = PR.byId(cs.field, g.prey);
  for (let t = 0; t < 8; t += dt) {
    MO.step(cs, [], dt); phases.add(cs.mom.phase);
    if (cs.mom.phase === 'show') minAbove = Math.min(minAbove, dist(cs.mom.pos, prey.pos));
  }
  ok(phases.has('show') && cs.mom.phase === 'wait', 'near the herd she demonstrates, then waits');
  ok(minAbove < 25, 'the demonstration dives close over the prey (' + minAbove.toFixed(1) + ')');
  ok(cs.mom.shown, 'shown once');
  cs.story.mother.lesson = ids.indexOf('roast');
}

// 8. Danger zones (defender range, T15 on): she never flies into one and never leads to prey inside one
{
  const cs = outside(10);
  cs.story.mother.lesson = ids.indexOf('grab');
  const g0 = MO.goal(cs);
  const zone = { x: g0.pos[0], z: g0.pos[2], r: 120 };
  const ctx = { danger: [zone] };
  const g1 = MO.goal(cs, ctx);
  ok(!g1 || g1.kind !== 'herd' || dist2(g1.pos, [zone.x, 0, zone.z]) > zone.r, 'she does not lead to prey inside a danger zone');
  // the hatchling flies right through the zone; she stays out
  const p = cs.dragon.pilot;
  p.pos = [zone.x - 400, 60, zone.z]; p.yaw = Math.PI / 2;
  MO.placeBeside(cs, 'lead');
  let inside = 0;
  for (let t = 0; t < 40; t += dt) {
    p.pos[0] += 25 * dt; p.pos[1] = T.surfaceAt(cs.region, p.pos[0], p.pos[2]) + 30;
    MO.step(cs, [], dt, ctx);
    if (Math.hypot(cs.mom.pos[0] - zone.x, cs.mom.pos[2] - zone.z) < zone.r) inside++;
  }
  ok(inside === 0, 'she never enters the danger zone while the hatchling crosses it');
  ok(MO.dangerZones(cs, ctx).length === 1, 'data zones + ctx zones');
}

// 9. Region change: she travels along and appears beside the dragon
{
  const cs = outside(11);
  glide(cs, 1);
  const ev = core('region').enter(cs, 'wild', 'ash');
  MO.step(cs, ev, dt);
  ok(cs.mom && dist(cs.mom.pos, cs.dragon.pilot.pos) < 60, 'after travel she is beside the dragon in the new region');
}

// 10. Death: she waits in the lair; floor and teleport keep her near and above ground
{
  const cs = outside(12);
  cs.dragon.hp = 0;
  const ev = S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(ev.some(e => e.e === 'dragon:died') && cs.story.mother.at === 'lair' && !cs.mom, 'after death she is with the hatchling in the lair');
  S.lairLeave(cs);
  let below = 0;
  for (let i = 0; i < 600; i++) { S.step(cs, { sx: 0.4, sy: -0.2 }, dt); if (cs.mom && cs.mom.pos[1] < T.surfaceAt(cs.region, cs.mom.pos[0], cs.mom.pos[2]) + D.mother.minAlt - 1e-6) below++; }
  ok(below === 0, 'she never flies under the floor');
  ok(cs.mom && dist2(cs.mom.pos, cs.dragon.pilot.pos) < D.mother.teleport, 'she stays with the hatchling (real flight through state.step)');
  cs.mom.pos = [cs.mom.pos[0] + 2000, cs.mom.pos[1], cs.mom.pos[2]];
  S.step(cs, { sx: 0, sy: 0 }, dt);
  ok(dist2(cs.mom.pos, cs.dragon.pilot.pos) < 100, 'too far away (debug jump): she catches up at once');
}

// 11. After the lessons she leaves and visits; a Drake is left alone longer between visits
ok(D.mother.visit[1].away > D.mother.visit[0].away && D.mother.visit[1].stay < D.mother.visit[0].stay, 'Drake: visits rarer and shorter');
function visitCycle(stage) {
  const cs = outside(13);
  cs.dragon.stage = stage;
  cs.story.mother = { lesson: ids.length, at: 'done' };
  cs.mom = null;
  let firstVisit = null, hiddenAt = null;
  for (let t = 0; t < 900 && firstVisit == null; t += 0.1) {
    glide(cs, 0.1);
    if (cs.mom.hidden && hiddenAt == null) hiddenAt = t;
    if (cs.mom.phase === 'visit') firstVisit = t;
  }
  return { cs, firstVisit, hiddenAt };
}
{
  const h = visitCycle(0), dk = visitCycle(1);
  ok(h.hiddenAt != null && h.hiddenAt < 1, 'a finished run starts with her away (hidden)');
  ok(Math.abs(h.firstVisit - D.mother.visit[0].away) < 2, 'hatchling: first visit after visit[0].away (' + h.firstVisit.toFixed(1) + ' s)');
  ok(Math.abs(dk.firstVisit - D.mother.visit[1].away) < 2, 'drake: first visit after visit[1].away (' + dk.firstVisit.toFixed(1) + ' s)');
  ok(MO.line(h.cs) === 'c.mother.visit' && dist(h.cs.mom.pos, h.cs.dragon.pilot.pos) < 50, 'on a visit she flies beside and speaks');
  glide(h.cs, D.mother.visit[0].stay + 1);
  ok(h.cs.mom.phase === 'away', 'and leaves again after visit[0].stay');
}
{   // a Drake still in lessons: she leaves for drakeGap after each praise
  const cs = outside(14);
  cs.dragon.stage = 1;
  cs.story.mother.lesson = ids.indexOf('grab');
  MO.step(cs, [{ e: 'prey:grabbed' }], dt);
  glide(cs, D.mother.praiseTime + 0.5);
  ok(cs.mom.phase === 'away', 'Drake: after a lesson she leaves it alone for a while');
  glide(cs, D.mother.drakeGap + 1);
  ok(cs.mom.phase !== 'away' && !cs.mom.hidden, 'and comes back after drakeGap');
}

// 12. Save: lesson and place survive, a finished teacher stays finished
{
  const cs = outside(15);
  cs.story.mother.lesson = 3;
  const back = SV.deserialise(SV.migrate(JSON.parse(JSON.stringify(SV.serialise(cs)))), mulberry(2));
  ok(back.story.mother.lesson === 3 && back.story.mother.at === 'air', 'lesson 3 outside survives a reload');
  cs.story.mother = { lesson: ids.length, at: 'done' };
  const b2 = SV.deserialise(SV.migrate(JSON.parse(JSON.stringify(SV.serialise(cs)))), mulberry(2));
  ok(b2.story.mother.at === 'done' && MO.lesson(b2) === null, 'finished lessons stay finished');
}

// 13. Debug skip completes the current lesson
{
  const cs = hatched();
  const ev = MO.skip(cs);
  ok(ev[0].id === 'fly' && MO.lesson(cs).id === 'dive', 'skip: fly -> dive');
}
