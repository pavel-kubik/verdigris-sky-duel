// Story (Phase 3 T17): act by stage, act cards once, story briefings once, outcome keys, the mother's first castle
// raid (joins, keeps out of the danger zones, leaves when the mission ends), her lines, EN + CS texts, save keeps seen.
'use strict';
const { ok, core } = require('./harness.js');
const SY = core('story'), F = core('flight'), S = core('state'), D = core('data'), MS = core('missions'), MO = core('mother'), SV = core('save');
const { mulberry } = core('math');
const fs = require('fs'), path = require('path');

function makeCs(regionId, stage) {
  const cs = S.create({ regionId: regionId || 'bend', rng: mulberry(3) });
  cs.dragon.stage = stage == null ? 1 : stage;
  cs.dragon.hp = 100;
  cs.story.mother = { lesson: D.mother.lessons.length, at: 'done' };
  cs.dragon.pilot = F.newPilot([0, 140, 0], Math.PI / 2, 30);
  return cs;
}
const ofType = (ev, name) => ev.filter(e => e.e === name);

// 1. acts and act cards
{
  const cs = makeCs('ash', 0);
  ok(SY.act(cs) === 1, 'hatchling: Act 1');
  let c = SY.pendingCard(cs);
  ok(c && c.id === 'act1' && c.lines.length === 3 && c.title === 'c.story.act1.title', 'Act 1 card pending');
  SY.mark(cs, 'act1');
  ok(SY.pendingCard(cs) === null, 'Act 1 card shows once');
  cs.dragon.stage = 1;
  ok(SY.act(cs) === 2, 'Drake: Act 2');
  ok(ofType(SY.step(cs, 0.1), 'story:act')[0].act === 2 && cs.story.act === 2, 'story:act on the stage up');
  ok(ofType(SY.step(cs, 0.1), 'story:act').length === 0, 'story:act once');
  c = SY.pendingCard(cs);
  ok(c && c.id === 'act2' && c.scene === 'castle', 'Act 2 card pending');
  SY.mark(cs, 'act2'); SY.mark(cs, 'act2');
  ok(SY.pendingCard(cs) === null && cs.story.seen.filter(x => x === 'act2').length === 1, 'Act 2 card once, marked once');
  const fresh = makeCs('ash', 1);
  ok(SY.pendingCard(fresh).id === 'act1', 'a Drake that never saw Act 1 sees it first');
}

// 2. briefings and outcomes
{
  const cs = makeCs('ash', 1);
  for (const m of D.missions) {
    const b = SY.brief(cs, m.id);
    ok(b && b.lines.length >= 2 && b.lines.length <= 4 && b.title === 'c.mission.' + m.id, 'story briefing of 2-4 lines: ' + m.id);
    ok(SY.brief(cs, m.id) === null, 'briefing once: ' + m.id);
    ok(SY.outcome(m.id, true) === 'c.story.out.' + m.id + '.ok' && SY.outcome(m.id, false) === 'c.story.out.' + m.id + '.fail', 'outcome keys: ' + m.id);
  }
  ok(SY.outcome('nope', true) === null && SY.brief(cs, 'nope') === null, 'unknown mission: no story');
}

// 3. the mother joins the first castle mission, keeps out of the danger zones and leaves when it ends
{
  const cs = makeCs('bend', 1);
  cs.inLair = false;
  ok(ofType(SY.step(cs, 0.1), 'story:raid').length === 0 && !SY.raid(cs), 'no raid without a mission');
  MS.accept(cs, 'a2_chalice');
  const ev = SY.step(cs, 0.1);
  ok(ofType(ev, 'story:raid')[0].id === 'a2_chalice' && SY.raid(cs) === 'a2_chalice', 'she joins the first castle mission');
  ok(ev.some(e => e.e === 'story:say' && e.key === D.story.raidLine), 'her raid line outside');
  ok(!ev.some(e => e.e === 'story:say' && e.key === D.story.kingCityLine), 'one line at a time');
  let ev2 = [];
  for (let i = 0; i < 80; i++) ev2 = ev2.concat(SY.step(cs, 0.1));
  ok(ev2.some(e => e.e === 'story:say' && e.key === D.story.kingCityLine) && SY.seen(cs, 'kingCity'), 'the burned city line in the Bend after the raid line');
  const p = cs.dragon.pilot;
  const zone = { x: p.pos[0] + 150, z: p.pos[2], r: 120 };
  let worst = Infinity, near = 0, line = null;
  p.yaw = Math.PI / 2; p.mode = 'air';
  for (let i = 0; i < 600; i++) {                          // the Drake flies straight through the zone (+X), 30 s
    p.pos[0] += 10 * 0.05;
    for (const e of SY.step(cs, 0.05)) void e;
    MO.step(cs, [], 0.05, { danger: [zone] });
    const m = cs.mom;
    worst = Math.min(worst, Math.hypot(m.pos[0] - zone.x, m.pos[2] - zone.z) - zone.r);
    if (Math.hypot(m.pos[0] - p.pos[0], m.pos[2] - p.pos[2]) < 200) near++;
    if (i === 5) line = MO.line(cs);
  }
  ok(cs.mom.phase === 'escort' && !cs.mom.hidden, 'she flies in the escort phase');
  ok(worst >= D.mother.dangerPad - 1e-6, 'she never enters a danger zone (min clearance ' + worst.toFixed(1) + ')');
  ok(near > 300, 'she stays near the Drake outside the zone');
  ok(line === D.story.kingCityLine, 'her caption is the story line');
  ok(MO.line(cs) === null, 'no lesson captions during the raid once the line is over');
  MS.fail(cs, 'debug');
  ok(ofType(SY.step(cs, 0.1), 'story:raidEnd').length === 1 && SY.raid(cs) === null, 'the raid ends with the mission');
  MO.step(cs, [], 0.05, null);
  ok(cs.mom.phase === 'away', 'she leaves');
  cs.missions.failedAt = {};
  MS.accept(cs, 'a2_workshop');
  ok(ofType(SY.step(cs, 0.1), 'story:raid').length === 0 && !SY.raid(cs), 'only the first castle mission');
  const nomom = makeCs('bend', 1); nomom.story.mother = null;
  MS.accept(nomom, 'a2_caravan');
  ok(ofType(SY.step(nomom, 0.1), 'story:raid').length === 0, 'no mother (phase 1 run): no raid');
}

// 4. save keeps seen and the raid; garbage is dropped
{
  const cs = makeCs('ash', 1);
  SY.mark(cs, 'act1'); SY.mark(cs, 'brief.a2_chalice');
  cs.story.raid = 'a2_chalice';
  const back = SV.deserialise(JSON.parse(JSON.stringify(SV.serialise(cs))));
  const st = back.story || back.cs && back.cs.story;
  ok(st && st.seen.indexOf('act1') >= 0 && st.seen.indexOf('brief.a2_chalice') >= 0 && st.raid === 'a2_chalice', 'seen and raid survive a save');
  const bad = SV.deserialise(Object.assign(JSON.parse(JSON.stringify(SV.serialise(cs))), { story: { act: 2, seen: ['ok', 5, '<x>', 'ok'], raid: 'nope' } }));
  const bs = bad.story || bad.cs && bad.cs.story;
  ok(bs.seen.length === 1 && bs.seen[0] === 'ok' && bs.raid === null, 'bad ids dropped');
}

// 5. every story text in EN and CS
{
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n.js'), 'utf8');
  const enAt = src.indexOf('\n    en: {'), csAt = src.indexOf('\n    cs: {');
  const keys = [D.story.raidLine, D.story.kingCityLine, 'c.story.continue', 'c.story.skip', 'c.story.act'];
  for (const id of Object.keys(D.story.cards)) { const c = SY.pendingCard({ dragon: { stage: 1 }, story: { seen: Object.keys(D.story.cards).filter(x => x !== id) } }); keys.push(c.title, ...c.lines); }
  for (const id of Object.keys(D.story.briefs)) {
    for (let i = 1; i <= D.story.briefs[id]; i++) keys.push('c.story.brief.' + id + '.' + i);
    keys.push(SY.outcome(id, true), SY.outcome(id, false));
  }
  for (const k of keys) ok(src.slice(enAt, csAt).indexOf("'" + k + "':") >= 0 && src.slice(csAt).indexOf("'" + k + "':") >= 0, 'EN + CS: ' + k);
  const story = src.split('\n').filter(l => l.indexOf("'c.story.") >= 0 || l.indexOf('c.mother.raid') >= 0).join('\n');
  ok(!/[–—]/.test(story), 'short hyphens only');
}
