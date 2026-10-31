// One-time tips (Phase 2 T23): conditions, order, the gap, no tips during the mother's lessons, once per save,
// saved and loaded with the run; every tip has EN + CS text and touch variants name buttons, not keys.
'use strict';
const { ok } = require('./harness.js');
const TP = core => require('./harness.js').core(core);
const D = TP('data'), S = TP('state'), F = TP('flight'), T = TP('terrain'), TIPS = TP('tips'), SV = TP('save'), LR = TP('lair'), AL = TP('alert'), CK = TP('clock');
const { mulberry } = TP('math');
const fs = require('fs');
const path = require('path');

function run(region) {
  const cs = S.create({ regionId: region || 'wild', rng: mulberry(7) });
  cs.dragon.pilot = F.newPilot([0, T.surfaceAt(region || 'wild', 0, 0) + 150, 0], 0, 30);
  CK.setPhase(cs, 'day');
  return cs;
}
const tipsOf = ev => ev.filter(e => e.e === 'tip').map(e => e.id);

// 1. Data and conditions
{
  ok(D.tips.gap > 0 && D.tips.show > 0, 'gap and show time in data.tips');
  ok(D.tips.order.every(id => TIPS.conditions.indexOf(id) >= 0), 'every tip in the order has a condition');
  ok(TIPS.conditions.every(id => D.tips.order.indexOf(id) >= 0), 'every condition is in the order');
  const cs = run();
  ok(TIPS.due(cs) === null, 'high, fed, by day, nothing found: no tip');
  cs.hint = 'land'; ok(TIPS.due(cs) === 'land', 'the land prompt: the landing tip');
  cs.hint = null; cs.dragon.hunger = D.tips.hungry; ok(TIPS.due(cs) === 'compass', 'hungry: the compass and smell tip');
  cs.dragon.hunger = 100;
  cs.discovered = { 'wild.outpost': true }; ok(TIPS.due(cs) === 'raid', 'a settlement found: the raid tip');
  cs.discovered = {};
  cs.regionStates.wild = cs.regionStates.wild || {}; AL.add(cs.regionStates.wild, 'debug', 0, 1.2);
  ok(TIPS.due(cs) === 'alert', 'the region on alert: the alert tip');
  cs.regionStates.wild.heat = 0;
  CK.setPhase(cs, 'night'); ok(TIPS.due(cs) === 'night', 'night outside: the night tip');
  CK.setPhase(cs, 'day');
  cs.hoard = { gold: 119 }; ok(TIPS.due(cs) === null, '119 gold buys nothing');
  cs.hoard.gold = 120; ok(TIPS.due(cs) === 'altar', '120 gold buys prey sense: the altar tip');
  cs.upgrades = Object.keys(D.upgrades); ok(TIPS.due(cs) === null, 'everything owned: no altar tip');
  cs.upgrades = []; cs.hoard.gold = 0;
  cs.dragon.stage = 1; ok(TIPS.due(cs) === 'farm', 'a Drake outside the Farmlands: the Farmlands tip');
  cs.dragon.stage = 0;
  LR.enter(cs); cs.station = null; ok(TIPS.due(cs) === 'cave', 'in the cave: the stations tip');
  cs.station = 'nest'; ok(TIPS.due(cs) === 'cave', 'also next to a station (its prompt is at the bottom, the tip at the top)');
  TIPS.mark(cs, 'cave'); cs.dragon.stage = 1; ok(TIPS.due(cs) === null, 'the Farmlands tip waits until outside');
}

// 2. Order: the first fitting tip in data.tips.order wins
{
  const cs = run();
  cs.hint = 'land'; cs.dragon.hunger = 10; cs.discovered = { 'wild.outpost': true };
  ok(TIPS.due(cs) === 'land', 'landing before compass and raid');
  TIPS.mark(cs, 'land'); ok(TIPS.due(cs) === 'compass', 'then the compass');
  TIPS.mark(cs, 'compass'); ok(TIPS.due(cs) === 'raid', 'then the raid');
}

// 3. In state.step: the gap, once each, none while the mother teaches
{
  const cs = run();
  cs.dragon.hunger = 100;
  cs.discovered = { 'wild.outpost': true };
  let got = [];
  for (let i = 0; i < D.tips.gap - 2; i++) got = got.concat(tipsOf(S.step(cs, {}, 1)));
  ok(got.length === 0, 'no tip in the first ' + D.tips.gap + ' s');
  for (let i = 0; i < 4; i++) got = got.concat(tipsOf(S.step(cs, {}, 1)));
  ok(got.join() === 'raid', 'the raid tip after the gap: ' + got.join());
  ok(TIPS.seen(cs, 'raid') && cs.flags.tips.indexOf('raid') >= 0, 'marked as seen');
  for (let i = 0; i < 3 * D.tips.gap; i++) got = got.concat(tipsOf(S.step(cs, {}, 1)));
  ok(got.join() === 'raid', 'shown once only: ' + got.join());
  // two tips due at once: the second waits a full gap
  cs.hoard = { gold: 500 }; CK.setPhase(cs, 'night');
  const times = [];
  for (let i = 0; i < 3 * D.tips.gap; i++) for (const id of tipsOf(S.step(cs, {}, 1))) times.push([id, i]);
  ok(times.length >= 2 && times[0][0] === 'night' && times[1][0] === 'altar', 'night, then altar: ' + JSON.stringify(times));
  ok(times.length >= 2 && times[1][1] - times[0][1] >= D.tips.gap - 1, 'a gap between two tips');
  // the mother's lessons hold the tips back
  const cm = run();
  cm.story.mother = { lesson: 1, at: 'field' };
  cm.discovered = { 'wild.outpost': true };
  cm.tipT = D.tips.gap;
  ok(TIPS.due(cm) === null, 'no tip while a lesson runs');
  let g2 = [];
  for (let i = 0; i < 2 * D.tips.gap; i++) g2 = g2.concat(tipsOf(S.step(cm, {}, 1)));
  ok(g2.length === 0, 'none in 2 gaps of a lesson');
  cm.story.mother.lesson = D.mother.lessons.length;
  ok(TIPS.due(cm) === 'raid', 'lessons done: the tip is due');
  cm.story.mother.at = 'done'; const mom0 = cm.mom; cm.mom = { phase: 'visit', hidden: false };
  ok(TIPS.due(cm) === null, 'her visit caption shows: the tip waits (same place on a phone)');
  cm.mom = mom0;
  // the Farmlands mark their tip seen
  const cf = run('farm');
  S.step(cf, {}, 0.1);
  ok(TIPS.seen(cf, 'farm'), 'in the Farmlands: no Farmlands tip later');
  // debug reset
  TIPS.reset(cs); ok(cs.flags.tips.length === 0 && cs.tipT === 0, 'reset forgets the seen tips');
}

// 4. Saved with the run, unknown and repeated ids dropped on load
{
  const cs = run();
  TIPS.mark(cs, 'land'); TIPS.mark(cs, 'raid');
  const o = SV.serialise(cs);
  ok(JSON.stringify(o.flags.tips) === '["land","raid"]', 'tips in the save: ' + JSON.stringify(o.flags.tips));
  o.flags.tips.push('nope', 'land', 3);
  const back = SV.deserialise(JSON.parse(JSON.stringify(o)), mulberry(3));
  ok(JSON.stringify(back.flags.tips) === '["land","raid"]', 'loaded, unknown and repeated ids dropped: ' + JSON.stringify(back.flags.tips));
  delete o.flags.tips;
  ok(Array.isArray(SV.deserialise(o, mulberry(3)).flags.tips), 'an older save without tips loads with none seen');
}

// 5. Texts: EN + CS for every tip, touch variants name buttons, not keys; short hyphens only
{
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n.js'), 'utf8');
  const enAt = src.indexOf('\n    en: {'), csAt = src.indexOf('\n    cs: {');
  const dictOf = text => { const o = {}; for (const m of text.matchAll(/'([a-zA-Z0-9_.]+)': '((?:[^'\\]|\\.)*)'/g)) o[m[1]] = m[2]; return o; };
  const langs = { en: dictOf(src.slice(enAt, csAt)), cs: dictOf(src.slice(csAt)) };
  for (const lang of Object.keys(langs)) {
    const L = langs[lang];
    for (const k of D.tips.order.map(id => 'c.tip.' + id).concat(['c.intro.new', 'c.dbg.tips'])) {
      ok(typeof L[k] === 'string' && L[k].length > 10, lang + ' has ' + k);
      ok(!/[–—]/.test(L[k] || ''), lang + ' ' + k + ': short hyphens only');
    }
    for (const id of D.tips.order) {
      const v = L['c.tip.' + id + 'Touch'] || L['c.tip.' + id] || '';
      ok(!/\b(press|stiskni|klávesou|Space|mezerník|Shift)\b|\b[WASDGXEF]\b/.test(v), lang + ' touch text of ' + id + ' names no keys: ' + v);
      const desk = L['c.tip.' + id] || '';
      ok(!/\b(tap|klepni)\b/i.test(desk), lang + ' desktop text of ' + id + ' does not say tap');
    }
  }
}
