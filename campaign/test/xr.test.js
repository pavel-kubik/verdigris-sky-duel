// VR support (shared/xr.js): the Quest controller mapping is pure and tested here; the page wiring gets static checks.
'use strict';
const fs = require('fs');
const path = require('path');
const { ok } = require('./harness.js');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { mapPads, menuNav, wrapText, SLOW, comfort } = require('../../shared/xr.js');

const near = (a, b) => Math.abs(a - b) < 1e-9;
/** xr-standard pad: buttons by index (true = pressed, number = analog value), axes [0, 0, stickX, stickY]. */
const pad = (buttons, x, y) => ({ axes: [0, 0, x || 0, y || 0], buttons: [0, 1, 2, 3, 4, 5].map(i => { const v = (buttons || {})[i]; return { pressed: v === true, value: v === true ? 1 : v || 0 }; }) });

/* ---------- no controllers ---------- */
{
  const m = mapPads(null, null, null);
  ok(m.sx === 0 && m.sy === 0 && !m.breath && !m.boost && !m.ball && !m.pause && m.roll === 0, 'no controllers: no input');
}

/* ---------- left stick: deadzone, full range, forward climbs ---------- */
ok(mapPads(pad({}, 0.1, 0.1), null).sx === 0, 'stick inside the deadzone is ignored');
ok(near(mapPads(pad({}, 1, 0), null).sx, 1), 'full right is sx 1');
ok(near(mapPads(pad({}, 0, -1), null).sy, 1), 'stick forward (negative axis) is sy +1, the same as W');
ok(near(mapPads(pad({}, 0, 1), null).sy, -1), 'stick back is sy -1');
ok(mapPads(pad({}, 0.2, 0), null).sx < 0.2, 'output is rescaled from the deadzone edge');

/* ---------- triggers ---------- */
ok(mapPads(null, pad({ 0: true })).breath, 'right trigger breathes');
ok(mapPads(pad({ 0: true }), null).boost, 'left trigger boosts');
ok(mapPads(null, pad({ 0: 0.8 })).breath, 'an analog trigger past half counts');
ok(!mapPads(null, pad({ 0: 0.3 })).breath, 'a light trigger touch does not');
ok(!mapPads(pad({ 0: true }), null).breath && !mapPads(null, pad({ 0: true })).boost, 'each trigger only does its own action');

/* ---------- A and B are one-frame edges ---------- */
{
  let m = mapPads(null, pad({ 4: true }), null);
  ok(m.ball && !m.pause, 'A fires a ball on press');
  m = mapPads(null, pad({ 4: true }), m.prev);
  ok(!m.ball, 'holding A does not repeat');
  m = mapPads(null, pad({}), m.prev);
  m = mapPads(null, pad({ 4: true }), m.prev);
  ok(m.ball, 'A fires again after a release');
  m = mapPads(null, pad({ 5: true }), null);
  ok(m.pause && !m.ball, 'B pauses on press');
  ok(!mapPads(null, pad({ 5: true }), m.prev).pause, 'holding B does not toggle again');
}

/* ---------- right stick flick rolls once until it returns to the centre ---------- */
{
  let m = mapPads(null, pad({}, 0.9, 0), null);
  ok(m.roll === 1, 'flick right rolls right (E)');
  m = mapPads(null, pad({}, 0.9, 0), m.prev);
  ok(m.roll === 0, 'holding the flick does not repeat');
  m = mapPads(null, pad({}, 0.5, 0), m.prev);
  ok(m.roll === 0 && m.prev.flick === 1, 'not re-armed before the stick is back near the centre');
  m = mapPads(null, pad({}, 0.1, 0), m.prev);
  ok(m.prev.flick === 0, 're-armed at the centre');
  m = mapPads(null, pad({}, -0.9, 0), m.prev);
  ok(m.roll === -1, 'flick left rolls left (Q)');
  ok(mapPads(null, pad({}, 0.5, 0), null).roll === 0, 'a small push does not roll');
}

/* ---------- left controller: X, Y edges; grips held ---------- */
{
  let m = mapPads(pad({ 4: true }), null, null);
  ok(m.x && !m.y && !m.ball, 'X (left lower face button) is its own edge, not the fireball');
  ok(!mapPads(pad({ 4: true }), null, m.prev).x, 'holding X does not repeat');
  m = mapPads(pad({ 5: true }), null, null);
  ok(m.y && !m.x && !m.pause, 'Y is its own edge, not pause');
  ok(mapPads(null, pad({ 1: true })).grip && !mapPads(null, pad({ 1: true })).gripL, 'the right grip is held');
  ok(mapPads(pad({ 1: true }), null).gripL && !mapPads(pad({ 1: true }), null).grip, 'the left grip is held');
  ok(mapPads(null, pad({ 1: true }), mapPads(null, pad({ 1: true })).prev).grip, 'a grip stays held (not an edge)');
}

/* ---------- stick clicks: one-frame edges (left: the debug overlay, right: the comfort menu) ---------- */
{
  let m = mapPads(pad({ 3: true }), null, null);
  ok(m.ls && !m.rs, 'a click of the left stick is ls');
  ok(!mapPads(pad({ 3: true }), null, m.prev).ls, 'holding the stick down does not repeat');
  m = mapPads(null, pad({ 3: true }), null);
  ok(m.rs && !m.ls && !m.ball && !m.pause, 'a click of the right stick is rs and nothing else');
}

/* ---------- menu: a stick flick up / down is one step, the right trigger confirms once ---------- */
{
  let m = mapPads(pad({}, 0, 0.9), null, null);
  ok(m.nav === 1, 'left stick back (down) moves the selection down');
  m = mapPads(pad({}, 0, 0.9), null, m.prev);
  ok(m.nav === 0, 'holding the stick does not repeat');
  m = mapPads(pad({}, 0, 0), null, m.prev);
  m = mapPads(null, pad({}, 0, -0.9), m.prev);
  ok(m.nav === -1, 'the right stick forward moves it up');
  ok(mapPads(pad({}, 0, 0.5), null, null).nav === 0, 'a small push does not move it');
  m = mapPads(null, pad({ 0: true }), null);
  ok(m.ok && m.breath, 'the right trigger confirms on press');
  ok(!mapPads(null, pad({ 0: true }), m.prev).ok, 'and only once while held');
  ok(menuNav(0, 3, 1) === 1 && menuNav(2, 3, 1) === 2 && menuNav(0, 3, -1) === 0, 'the selection is clamped to the rows');
  ok(menuNav(5, 2, 0) === 1 && menuNav(3, 0, 1) === 0, 'a shrunk or empty menu keeps a valid selection');
}

/* ---------- text wrapping for the panels ---------- */
{
  const w = s => s.length;                                       // one unit per character
  ok(wrapText('one two three', 7, w).join('|') === 'one two|three', 'wraps at the width');
  ok(wrapText('  spaced   out  ', 20, w).join('|') === 'spaced out', 'collapses white space');
  ok(wrapText('abcdefghijkl x', 5, w).join('|') === 'abcdefghijkl|x', 'a long word gets its own line');
  ok(wrapText('', 5, w).length === 0 && wrapText(null, 5, w).length === 0, 'no text, no lines');
  ok(SLOW > 0 && SLOW <= 1, 'the VR time scale slows the single-player modes, never speeds them up');
}

/* ---------- comfort settings: defaults, stored values, URL overrides ---------- */
{
  const C = comfort, store = v => ({ v, getItem() { return this.v; }, setItem(k, x) { this.k = k; this.v = x; } });
  const d = C.defaults();
  for (const k in C.OPTIONS) ok(d[k] === C.OPTIONS[k][0] || C.PRESETS.recommended[k] === d[k], 'default of ' + k + ' is its first option or the Recommended preset');
  ok(d.preset === 'recommended' && d.debug === false, 'a new player gets the Recommended preset, the debug overlay off');
  ok(JSON.stringify(C.load(null, '')) === JSON.stringify(d), 'no storage (private mode): the defaults');
  ok(JSON.stringify(C.load(store('{broken'), '')) === JSON.stringify(d), 'a broken stored value: the defaults');
  ok(JSON.stringify(C.load({ getItem() { throw new Error('denied'); } }, '')) === JSON.stringify(d), 'storage that throws: the defaults');
  ok(C.sanitize({ debug: 'yes', preset: 'nope', extra: 1 }).debug === false && C.sanitize({ extra: 1 }).extra === undefined, 'unknown values and keys are dropped');
  ok(C.load(store('{"debug":true}'), '').debug === true, 'a stored value is read');
  ok(C.load(store('{"debug":true}'), '?v=3&comfort=debug:false').debug === false, '?comfort=key:value overrides the stored value');
  const s = store(null);
  ok(C.save(s, C.set(C.defaults(), 'debug', true)) && s.k === C.KEY && JSON.parse(s.v).debug === true, 'save writes JSON under the comfort key');
  ok(C.save({ setItem() { throw new Error('full'); } }, d) === false, 'a failed save is reported, not thrown');
}

/* ---------- page wiring ---------- */
{
  const html = read('index.html');
  const at = s => html.indexOf(s);
  ok(at('three.min.js') > 0 && at('three.min.js') < at('src="shared/xr.js"') && at('src="shared/xr.js"') < at('VXR.attach'), 'index.html loads shared/xr.js after Three.js and before using VXR');
  ok(/id="vrBtn" hidden/.test(html), 'the Enter VR button starts hidden, so flat devices never see it');
  ok(!/requestAnimationFrame\(frame\)/.test(html) && /renderer\.setAnimationLoop\(frame\)/.test(html), 'the frame loop runs through setAnimationLoop (window rAF stops in VR)');
  ok(read('sw.js').includes("'shared/xr.js'"), 'sw.js precaches shared/xr.js');
  const i18n = read('i18n.js');
  for (const k of ['intro.vr', 'vr.resume', 'vr.again', 'vr.failed']) ok((i18n.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length === 2, k + ' exists in EN and CS');
  for (const k of ['vr.short', 'vr.menuHint', 'vr.hud.grip', 'vr.k.turn', 'vr.k.fwd', 'vr.k.back', 'vr.k.pitch', 'vr.k.stick', 'vr.k.boost', 'vr.k.breath', 'vr.k.ball', 'vr.k.rollL', 'vr.k.rollR', 'vr.k.roll',
                   'l.find.textVr', 'l.boost.textVr', 'l.roll.textVr', 'l.hunt.textVr']) ok((i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length === 2, k + ' exists in EN and CS');
  // every VR key name used by a tutorial lesson has a label
  const keysMap = /const VR_KEYS=\{([^}]*)\}/.exec(html)[1];
  for (const m of html.matchAll(/desk:\[(.*?)\],touch:/g)) for (const r of m[1].matchAll(/\['([^']+)','/g)) ok(keysMap.includes("'" + r[1] + "':"), 'tutorial keys "' + r[1] + '" have a VR label');
}

/* ---------- every mode: the page loads shared/xr.js, has Enter VR buttons and runs its loop through setAnimationLoop ---------- */
for (const [page, js, src] of [['mp/index.html', 'mp/game.js', '../shared/xr.js'], ['campaign/index.html', 'campaign/game.js', '../shared/xr.js'], ['campaign/dm/index.html', 'campaign/dm/game.js', '../../shared/xr.js']]) {
  const html = read(page), code = read(js);
  ok(html.includes(src) && html.indexOf('three.min.js') < html.indexOf(src) && html.indexOf(src) < html.lastIndexOf('game.js'), page + ' loads shared/xr.js after Three.js and before the game');
  ok(/id="vrBtn" hidden/.test(html) && /id="vrBtn2" hidden/.test(html), page + ' has hidden Enter VR buttons (start screen and in the game)');
  ok(/VXR\.attach\(/.test(code) && /xr\.frame\(now,/.test(code) && /xr\.drawHud\(now,/.test(code), js + ' attaches VR, reads the controllers and draws the VR panel');
  ok(!/requestAnimationFrame\(frame\)/.test(code) && /renderer\.setAnimationLoop\(frame\)/.test(code), js + ' runs its frame loop through setAnimationLoop (window rAF stops in VR)');
  ok(/if \(renderer\.xr\.isPresenting\) return;/.test(code), js + ' leaves the canvas size alone while presenting');
}
