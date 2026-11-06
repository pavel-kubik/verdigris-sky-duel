// Build guard (added after the phase 3 base broke, 2026-11-06): every shipped script parses, the page loader and the
// service worker list every core / render file exactly once, and there is exactly one BUILD label per client script.
// The T14-T16 rebases had stacked BUILD lines, a second core import line in state.js and a second loader list in
// index.html - the unit tests never load game.js, so nothing failed until the page was opened.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ok } = require('./harness.js');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const parses = (f, src) => {
  try { new vm.Script(src, { filename: f }); return true; } catch (e) { return e.message; }
};
const files = dir => fs.readdirSync(path.join(root, 'campaign', dir)).filter(f => f.endsWith('.js')).map(f => 'campaign/' + dir + '/' + f);

const scripts = ['campaign/game.js', 'campaign/dm/game.js', 'campaign/preview/castle.js', 'i18n.js', 'sw.js', 'shared/dragon.js', 'shared/qr.js']
  .concat(files('core'), files('render'))
  .filter(f => fs.existsSync(path.join(root, f)));
for (const f of scripts) {
  const r = parses(f, read(f));
  ok(r === true, f + ' parses' + (r === true ? '' : ': ' + r));
}

for (const f of ['campaign/game.js', 'campaign/dm/game.js', 'campaign/preview/castle.js']) {
  const n = (read(f).match(/^\s*const BUILD = /gm) || []).length;
  ok(n === 1, f + ' has one BUILD label (found ' + n + ')');
}

// the page loader: one array literal that parses, every core / render file once
const html = read('campaign/index.html');
const a = html.indexOf("['../i18n.js'"), b = html.indexOf('].forEach', a);
ok(a > 0 && b > a, 'index.html has the script loader list');
let list = null;
try { list = vm.runInNewContext(html.slice(a, b + 1)); } catch (e) { ok(false, 'index.html loader list parses: ' + e.message); }
if (list) {
  const dup = list.filter((f, i) => list.indexOf(f) !== i);
  ok(!dup.length, 'index.html loads every script once' + (dup.length ? ' (twice: ' + dup.join(', ') + ')' : ''));
  for (const f of files('core').concat(files('render'))) ok(list.indexOf(f.slice('campaign/'.length)) >= 0, 'index.html loads ' + f);
  ok(list[list.length - 1] === 'game.js', 'index.html loads game.js last');
}

// the service worker precache: no duplicates (cache.addAll rejects them), every core / render file listed
const sw = read('sw.js');
const shell = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
const entries = [...shell.matchAll(/'([^']+)'/g)].map(m => m[1]);
const swDup = entries.filter((f, i) => entries.indexOf(f) !== i);
ok(!swDup.length, 'sw.js SHELL lists every file once' + (swDup.length ? ' (twice: ' + swDup.join(', ') + ')' : ''));
for (const f of files('core').concat(files('render'))) ok(entries.indexOf(f) >= 0, 'sw.js precaches ' + f);

// the deathmatch page (campaign/dm/): its loader lists files that exist, once, with core modules before the ones that
// need them and game.js last; the service worker precaches the page
{
  const dm = read('campaign/dm/index.html');
  const a2 = dm.indexOf("['../../i18n.js'"), b2 = dm.indexOf('].forEach', a2);
  ok(a2 > 0 && b2 > a2, 'dm/index.html has the script loader list');
  const dl = vm.runInNewContext(dm.slice(a2, b2 + 1));
  ok(dl.filter((f, i) => dl.indexOf(f) !== i).length === 0, 'dm/index.html loads every script once');
  for (const f of dl) ok(fs.existsSync(path.join(root, 'campaign', 'dm', f)), 'dm/index.html loads an existing file: ' + f);
  ok(dl[dl.length - 1] === 'game.js', 'dm/index.html loads game.js last');
  const at = f => dl.indexOf('../core/' + f + '.js');
  for (const [mod, deps] of [['dm', ['data', 'terrain', 'settlement', 'flight', 'math']], ['settlement', ['castle', 'terrain']], ['flight', ['terrain']], ['walk', ['terrain']]]) {
    for (const d of deps) ok(at(d) >= 0 && at(d) < at(mod), 'dm/index.html loads core/' + d + ' before core/' + mod);
  }
  for (const f of ['campaign/dm/', 'campaign/dm/index.html', 'campaign/dm/game.js', 'shared/qr.js']) ok(entries.indexOf(f) >= 0, 'sw.js precaches ' + f);
}
