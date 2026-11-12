// VR support (shared/xr.js): the Quest controller mapping is pure and tested here; the page wiring gets static checks.
'use strict';
const fs = require('fs');
const path = require('path');
const { ok } = require('./harness.js');

const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { mapPads } = require('../../shared/xr.js');

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
}
