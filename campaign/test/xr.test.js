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
  for (const k in C.OPTIONS) ok(C.OPTIONS[k].includes(d[k]), 'the default of ' + k + ' is one of its options');
  ok(Object.keys(d).length === Object.keys(C.OPTIONS).length, 'every setting has options');
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

/* ---------- stable horizon: game logic only ever yaws the rig; camera effects are off unless asked for ---------- */
{
  const C = comfort, src = read('shared/xr.js');
  ok(C.defaults().effects === false && C.PRESETS.comfortable.effects === false, 'camera effects are off by default and in the Comfortable preset');
  ok(!/rig\.rotation\.(x|z)\s*[+\-*]?=/.test(src) && !/rig\.(quaternion|lookAt|rotateX|rotateZ)/.test(src), 'shared/xr.js never pitches or rolls the rig');
  for (const f of ['index.html', 'mp/game.js', 'campaign/game.js', 'campaign/dm/game.js']) {
    const code = read(f);
    ok(!/xr\.rig\.(rotation|quaternion|lookAt)/.test(code), f + ' leaves the rig rotation to xr.follow');
    ok(/xr\.follow\([^;]*shake\)/.test(code) && /shake ?= ?xr\.cf\.effects ?\?/.test(code), f + ' shakes the view in VR only with the camera effects setting');
  }
}

/* ---------- turning: snap by default, smooth with a cap; eased speed; shaped stick ---------- */
{
  const C = comfort, d = C.defaults(), DEG = Math.PI / 180, step = 30 * DEG;
  ok(d.turn === 'snap' && d.snapAngle === 30 && d.ease === true && d.boost === true, 'defaults: snap turn in 30 degree steps, eased speed, boost allowed');
  ok(C.PRESETS.comfortable.boost === false && C.PRESETS.comfortable.assist === 'gentle' && C.PRESETS.advanced.assist === 'free' && C.PRESETS.advanced.turn === 'smooth', 'Comfortable caps the speed and steers gently; Advanced leaves everything free');
  ok(C.snapStep(29 * DEG, step) === 0 && C.snapStep(-29 * DEG, step) === 0, 'no snap while the heading is less than a step away');
  ok(near(C.snapStep(30 * DEG, step), step) && near(C.snapStep(-31 * DEG, step), -step), 'one step once it is a step away, either way');
  ok(near(C.snapStep(100 * DEG, step), 3 * step), 'a big change of heading (a respawn) is taken in one snap of whole steps');
  ok(Math.abs(C.smoothStep(2, 1 / 90, 45 * DEG)) <= 45 * DEG / 90 + 1e-12, 'a smooth turn never exceeds the cap');
  ok(C.smoothStep(2, 1 / 90, 0) > 45 * DEG / 90, 'cap 0 means no cap');
  ok(Math.abs(C.smoothStep(0.001, 1 / 90, 45 * DEG)) < 0.001, 'a smooth turn eases in on the heading and does not overshoot');
  ok(C.FADE * 2 <= 0.12, 'the snap fade takes about 100 ms');
  // boost: the dragon jumps from 30 to 54 m/s; the view takes its time
  const e = { s: 30, lag: 0 }; let maxAcc = 0, maxLag = 0, t = 0;
  for (; t < 0.5; t += 1 / 90) { const s0 = e.s; C.easeStep(e, 54, 1 / 90); maxAcc = Math.max(maxAcc, (e.s - s0) * 90); maxLag = Math.max(maxLag, e.lag); }
  ok(e.s < 30 + 24 * 0.66 && e.s > 30 + 24 * 0.6, 'after half a second the view has taken up about 63 % of a speed change: ' + e.s.toFixed(1));
  ok(maxAcc <= 24 / C.EASE.t + 0.5, 'the acceleration of the view is bounded: ' + maxAcc.toFixed(0) + ' m/s2 for a 24 m/s step');
  for (; t < 8; t += 1 / 90) { C.easeStep(e, 54, 1 / 90); maxLag = Math.max(maxLag, e.lag); }
  ok(near(Math.round(e.s), 54) && Math.abs(e.lag) < 0.2, 'then it flies at the dragon\'s speed again, at the usual distance');
  ok(maxLag > 2 && maxLag <= C.EASE.max, 'in between the dragon pulls ahead, within a limit: ' + maxLag.toFixed(1) + ' m');
  for (let i = 0; i < 900; i++) C.easeStep(e, -200, 1 / 90);
  ok(e.lag >= C.EASE.min, 'the view never closes in on the dragon by more than ' + -C.EASE.min + ' m');
  // stick shaping
  let k = { x: 0, y: 0 };
  C.shapeStick(k, 1, -1, 1 / 90, 'free');
  ok(k.x === 1 && k.y === -1, 'free: the stick as it is');
  k = { x: 0, y: 0 }; for (let i = 0; i < 90; i++) C.shapeStick(k, 1, -1, 1 / 90, 'gentle');
  ok(near(k.x, C.ASSIST.gentle.turn) && near(k.y, -C.ASSIST.gentle.pitch), 'gentle: a full stick turns and dives at a share of the rate (no steep dives)');
  let n = 0; while (k.x > -C.ASSIST.gentle.turn + 1e-6 && n < 900) { C.shapeStick(k, -1, 0, 1 / 90, 'gentle'); n++; }
  ok(n / 90 > 0.4 && n / 90 < 0.6, 'gentle: a full reversal takes about half a second: ' + (n / 90).toFixed(2) + ' s');
  k = { x: 0, y: 0 }; C.shapeStick(k, 0, 1, 1 / 90, 'gentle', true);
  ok(k.y === 1, 'on the ground the stick walks at full speed at once');
  const solo = read('index.html'), camp = read('campaign/game.js');
  ok(/keepBoost=mode==='tut'/.test(solo), 'the tutorial keeps the boost for its boost lesson');
  ok(/xrOpts\.ground = /.test(camp) && /cs\.inLair \|\| cs\.inAerie \? null : pilot\.pos/.test(camp), 'the campaign tells VR when the dragon walks, and keeps the cave camera where the cave puts it');
}

/* ---------- comfort vignette: closes with turn rate and acceleration, opens in steady flight ---------- */
{
  const C = comfort, V = C.VIG, src = read('shared/xr.js');
  ok(C.defaults().vignette === 'medium' && C.PRESETS.comfortable.vignette === 'high' && C.PRESETS.advanced.vignette === 'off', 'vignette: Medium by default, High in Comfortable, off in Advanced');
  ok(C.vignetteTarget(0, 0) === 0, 'steady flight (no turn, no acceleration): open');
  ok(C.vignetteTarget(V.turn / 2, 0) === 0.5 && C.vignetteTarget(0, V.accel / 2) === 0.5, 'it closes in proportion to the turn rate and to the linear acceleration');
  ok(C.vignetteTarget(500, 500) === 1, 'and never past the strength');
  ok(V.low > V.medium && V.medium > V.high && V.open > V.low, 'Low, Medium, High: each narrows the view further');
  ok(C.vignetteAngle('medium', 0) === V.open && C.vignetteAngle('medium', 1) === V.medium && C.vignetteAngle('off', 1) === V.open, 'the clear half angle runs from open to the strength; off stays open');
  let m = 0, t = 0;
  for (; t < 0.3; t += 1 / 90) m = C.vignetteStep(m, 1, 1 / 90);
  ok(m > 0.85, 'it closes within about a third of a second: ' + m.toFixed(2));
  for (t = 0; t < 1; t += 1 / 90) m = C.vignetteStep(m, 0, 1 / 90);
  ok(m > 0.1 && m < 0.3, 'and opens more slowly, so it does not flicker: ' + m.toFixed(2) + ' after a second');
  ok(!/EffectComposer|WebGLRenderTarget|ShaderPass/.test(src), 'no post-processing pass: the vignette is a mesh');
}

/* ---------- rest frame: low-poly, in the lower view, fixed to the seat ---------- */
{
  const C = comfort;
  ok(C.restFrame('off') === null && C.restFrame() === null, 'rest frame off: no geometry');
  ok(C.defaults().rest === 'subtle' && C.PRESETS.comfortable.rest === 'strong' && C.PRESETS.advanced.rest === 'off', 'rest frame: Subtle by default, Strong in Comfortable, off in Advanced');
  for (const level of ['subtle', 'strong']) {
    const f = C.restFrame(level), n = f.position.length / 3;
    ok(f.index.length / 3 < 800 && f.index.every(i => i >= 0 && i < n) && f.color.length === f.position.length, level + ' rest frame is low-poly and well formed: ' + f.index.length / 3 + ' triangles');
    let top = -Infinity, near = Infinity, ahead = true;
    for (let i = 0; i < n; i++) { const x = f.position[i * 3], y = f.position[i * 3 + 1], z = f.position[i * 3 + 2]; top = Math.max(top, y); near = Math.min(near, Math.hypot(x, y, z)); if (Math.abs(x) < 0.5 && z > 0) ahead = false; }
    ok(near > 0.6, level + ' rest frame keeps clear of the head: nearest point ' + near.toFixed(2) + ' m');
    ok(level === 'subtle' ? top < -0.2 : top < 0.1 && top > -0.1, level + ' rest frame: the horns end ' + (level === 'subtle' ? 'well under' : 'at') + ' the eye line (' + top.toFixed(2) + ' m)');
    ok(ahead, level + ' rest frame is in front of the player');
  }
  ok(C.restFrame('strong').index.length > C.restFrame('subtle').index.length, 'Strong has more to hold on to than Subtle');
}

/* ---------- performance: render scale 1.0 and medium foveation to start with, adaptive fallback ---------- */
{
  const C = comfort, d = C.defaults(), B = 1000 / 90;
  ok(d.scale === 1 && d.foveation === 0.66 && d.adaptive === true && d.compact === true, 'defaults: render scale 1.0, foveation 0.66, adaptive quality and compact dragons on');
  const run = (a, ms, seconds, max) => { let out = 0; for (let t = 0; t < seconds * 1000; t += ms) out += C.adaptStep(a, ms, B, max) || 0; return out; };
  let a = C.adaptState();
  ok(run(a, B, 30, 5) === 0 && a.level === 0, '90 Hz on the budget: the quality stays');
  a = C.adaptState();
  ok(run(a, 14, 2.5, 5) === 0 && a.level === 0, 'slow frames while the session warms up do not count');
  run(a, 14, 0.8, 5);
  ok(a.level === 1, 'a second over the budget lowers the quality one level');
  run(a, 14, 60, 5);
  ok(a.level === 5, 'it keeps stepping down while frames stay slow, and never below the last level: ' + a.level);
  run(a, B, C.ADAPT.wait - 2, 5);
  ok(a.level === 5, 'a few good seconds do not raise it yet');
  run(a, B, 4, 5);
  ok(a.level === 4, 'a run of good seconds raises it one level');
  const wait = a.wait;
  run(a, 14, 2.2, 5);
  ok(a.level === 5 && a.wait === wait * 2, 'a raise that fails at once doubles the wait (no pumping)');
  a = C.adaptState(); run(a, B, 5, 5);
  ok(C.adaptStep(a, 400, B, 5) === 0 && a.acc < 1000, 'one long hitch (a pause, a loading spike) is ignored');
  ok(C.adaptLevels(d) === 5, 'from scale 1.0 and foveation 0.66 there are 5 levels: foveation, then 0.9 0.8 0.7 0.6');
  ok(C.adaptQuality(0, d).scale === 1 && C.adaptQuality(0, d).foveation === 0.66, 'level 0 is what the player set');
  ok(C.adaptQuality(1, d).scale === 1 && C.adaptQuality(1, d).foveation === 1, 'level 1 only raises the foveation');
  ok(C.adaptQuality(2, d).scale === 0.9 && C.adaptQuality(5, d).scale === 0.6, 'then the render scale goes down a step a level');
  ok(C.adaptQuality(99, d).scale === C.ADAPT.floor, 'the render scale never goes below the floor');
  ok(C.adaptQuality(3, Object.assign({}, d, { scale: 0.7, foveation: 1 })).scale === 0.6 && C.adaptLevels(Object.assign({}, d, { scale: 0.7, foveation: 1 })) === 1, 'a low setting has fewer levels left');
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
