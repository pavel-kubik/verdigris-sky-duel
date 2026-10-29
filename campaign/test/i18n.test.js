// Texts (T15): every string the campaign shows comes from i18n.js and exists in EN and CS.
// Keys are collected from campaign/index.html (data-i18n, data-i18n-attr), every t('...') literal in campaign/game.js,
// the region name keys in data.js and the keys game.js builds from data (stages, prey, travel prompts and buttons).
'use strict';
const fs = require('fs');
const path = require('path');
const { ok, core } = require('./harness.js');
const D = core('data');

const root = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
const enAt = src.indexOf('\n    en: {'), csAt = src.indexOf('\n    cs: {');
ok(enAt > 0 && csAt > enAt, 'i18n.js has en and cs dictionaries');
const keysIn = text => new Set([...text.matchAll(/'([a-zA-Z0-9_.]+)':/g)].map(m => m[1]));
const EN = keysIn(src.slice(enAt, csAt)), CS = keysIn(src.slice(csAt));

const html = fs.readFileSync(path.join(root, 'campaign', 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(root, 'campaign', 'game.js'), 'utf8');
const used = new Set();
for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1].trim());
for (const m of game.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);   // 'c.stage.' + id: added from data below
for (const m of game.matchAll(/'(c\.[a-zA-Z0-9_.]*[a-zA-Z0-9])'/g)) used.add(m[1]);   // keys passed around as values (ternaries, dataset)
for (const id in D.regions) {
  used.add(D.regions[id].nameKey);
  for (const ex of D.regions[id].exits || []) { used.add('c.prompt.travel.' + ex.to); used.add('c.btn.travel.' + ex.to); }
}
for (const st of D.stages) used.add('c.stage.' + st.id);
for (const type in D.prey) used.add('c.prey.' + type);
used.add('c.prey.roast');
const hatchSrc = fs.readFileSync(path.join(root, 'campaign', 'render', 'hatch-scene.js'), 'utf8');   // scene captions: LINES [['p1', ...]] -> c.hatch.p1
for (const m of hatchSrc.matchAll(/\['(p\d)'/g)) used.add('c.hatch.' + m[1]);
ok(used.has('c.hatch.p4'), 'hatching scene captions collected');

ok(used.size > 100, 'collected ' + used.size + ' keys');
const missingEn = [...used].filter(k => !EN.has(k)), missingCs = [...used].filter(k => !CS.has(k));
ok(missingEn.length === 0, 'keys missing in EN: ' + missingEn.join(', '));
ok(missingCs.length === 0, 'keys missing in CS: ' + missingCs.join(', '));
const onlyEn = [...EN].filter(k => k.startsWith('c.') && !CS.has(k)), onlyCs = [...CS].filter(k => k.startsWith('c.') && !EN.has(k));
ok(onlyEn.length === 0 && onlyCs.length === 0, 'c.* keys in one language only: ' + onlyEn.concat(onlyCs).join(', '));

// short hyphens only in campaign texts
const longDash = /[–—]/;
const dashed = [...src.matchAll(/'(c\.[a-zA-Z0-9_.]+)':\s*'([^']*)'/g)].filter(m => longDash.test(m[2])).map(m => m[1]);
ok(dashed.length === 0, 'long dashes in: ' + dashed.join(', '));

// the touch layout: the hint names buttons, not keys
const tip = [...src.slice(enAt, csAt).matchAll(/'c\.tip\.huntTouch':\s*'([^']*)'/g)][0][1];
ok(!/\b(G|X|Space)\b/.test(tip), 'touch tip names buttons: ' + tip);
