/*
 * Verdigris - immersive VR (WebXR) support, written for Meta Quest and Three.js r128. Shared by every mode: the solo duel and
 * the tutorial, the co-op, the deathmatch and the campaign. Runs in the browser (window.VXR); the pure parts (mapPads, menuNav,
 * wrapText) also run in Node for tests.
 *   VXR.SLOW                         time scale of the single-player modes in VR (the 'speed' comfort setting: 0.5, 0.75 or 1)
 *   VXR.mapPads(left, right, prev) -> { sx, sy, breath, boost, ball, pause, roll, x, y, grip, gripL, nav, ok, ls, rs, prev }
 *     pure; left / right are Gamepads or null; pass the returned prev back in on the next frame
 *   VXR.comfort                      the VR comfort settings (pure): OPTIONS, PRESETS, defaults(), sanitize(), preset(), set(),
 *     load(storage, search), save(storage, s). Stored in localStorage 'vsd-comfort'; ?comfort=key:value,key:value overrides
 *     for one page load (test links). Nothing here runs outside an immersive session.
 *   VXR.menuNav(sel, n, nav) -> the new selected row (clamped)
 *   VXR.attach({ renderer, scene, camera, button, skip, onStart, onEnd, onError }) -> xr
 *     button: an element or a list of them; they stay hidden unless the device supports immersive VR, a click enters VR
 *     skip: selector of controls the VR menu leaves out (links are always left out: following one would end the session)
 *     xr.rig: parent of the camera; the headset pose is relative to it, so in VR a game moves the rig and never the camera
 *     xr.follow(pos, yaw, dt, at, shake): moves the rig (dt null: placed at once) and there is never pitch or roll, so the
 *       horizon stays level: game logic never turns the headset camera, only the rig about the vertical axis.
 *       Turning (setting 'turn'): 'snap' turns the view in steps of 'snapAngle' behind a 100 ms fade once the dragon's
 *       heading is a step away; 'smooth' follows it, never faster than 'smoothSpeed' deg/s. Either way the view stays
 *       behind the dragon as the view (not the dragon) faces, so between turns the world only slides, it does not swing.
 *       'ease': speed changes of the dragon (boost, a jolt) reach the view over half a second; the dragon pulls ahead.
 *       at: the dragon the view follows ([x, y, z] or a Vector3; null: pos is used as it is). shake: the mode's camera shake; it moves the rig (never
 *       turns it) and only with the "camera effects" setting, which is off unless the player turns it on.
 *     xr.eye: the rig position in the world (use it where the flat game uses camera.position)
 *     xr.view(): a stand-in for the camera in VR for code that needs { position, quaternion, fov } and a view height in pixels
 *       (xr.view().viewH) to size point sprites
 *     xr.pad(): mapPads for this frame's controllers, or null outside VR
 *     xr.frame(now, menuRoot, opts): xr.pad() plus the VR menu. menuRoot is the DOM panel that is open on the flat page (or
 *       null; a list shows several as one menu): its texts and buttons are mirrored on a panel in front of the player, the sticks move the selection, A or the
 *       right trigger presses the selected button. While a menu is open the returned pad has menu = true and no flight input.
 *       opts.image: a canvas drawn beside the menu (the campaign map, a QR code). opts.ground: the stick walks (it is
 *       not eased as a flight stick). opts.keepBoost: the boost works whatever the 'boost' setting says (a boost lesson).
 *       The returned stick is shaped by the 'assist' setting: gentler turns and dives, no instant reversals.
 *     xr.drawHud(now, fn): redraws the status panel below the eye line 10 times a second; fn(g, w, h) paints on it
 *     xr.bars(list): floating bars in the world, [{ id, x, y, z, w, rows: [[value 0..1, colour], ...] }]; [] removes them
 *     xr.pointScale(): the eye-buffer equivalent of height / (2 tan(fov / 2)) for point sprites, or 0 before the first VR frame
 *     xr.cf: the comfort settings in use; xr.setComfort(key, value) changes one (and stores it)
 *   Comfort vignette (setting 'vignette'): a soft black ring that narrows the view while the view turns or changes its
 *     velocity, and opens again in steady flight. One ring mesh in view space (no post-processing pass), hidden while open.
 *   Rest frame (setting 'rest'): a saddle bow and two horns fixed to the rig, in the lower view. They never move against
 *     the player's seat, whatever the dragon and the world do, which gives the eyes something that agrees with the body.
 *     Strong adds taller horns, side rails and a speed / height line on the status panel.
 *   Comfort menu: click the RIGHT stick in VR (B closes it). Presets Comfortable / Recommended / Advanced and every
 *     setting on its own; a mode that can pause is paused while it is open. The first time a player enters VR a short
 *     note recommends Comfortable and a break at the first symptom ('vsd-comfort-seen').
 *   Debug strip (under the status panel): click the LEFT stick in VR, or the first row of the comfort menu. fps, frame
 *     time, CPU time per frame, draw calls, triangles, speed / turn rate / acceleration of the view, quality.
 *   'enabled' off: VR exactly as it was before the comfort work (comfort.ORIGINAL), to compare; every feature also has
 *     its own row in the menu.
 */
(function (root) {
  'use strict';
  const DEAD = 0.15, FLICK_ON = 0.7, FLICK_OFF = 0.3, YAW_RATE = 6;
  let slowNow = 0.5;                                            // VXR.SLOW: the 'speed' setting in effect
  // xr-standard layout (WebXR Gamepads Module)
  const TRIGGER = 0, GRIP = 1, STICK = 3, FACE_LOW = 4, FACE_HIGH = 5, STICK_X = 2, STICK_Y = 3;
  const FONT = '"Barlow Semi Condensed",sans-serif';

  const axis = (gp, i) => (gp && gp.axes && +gp.axes[i]) || 0;
  const held = (gp, i) => { const b = gp && gp.buttons && gp.buttons[i]; return !!b && (!!b.pressed || b.value > 0.5); };

  /**
   * Left stick steers (up = positive sy), right trigger breathes, left trigger boosts, A is the fireball, B pauses and a flick of
   * the right stick rolls. X and Y (left controller) and the grips are for the mode to use. nav is a flick of either stick up
   * (-1) or down (+1) and ok a press of the right trigger: the VR menu uses them. ls and rs are clicks of the left and the right
   * stick (the debug overlay and the comfort menu). ball, pause, roll, x, y, nav, ok, ls and rs are one-frame edges.
   */
  function mapPads(left, right, prev) {
    const p = prev || { a: false, b: false, x: false, y: false, t: false, ls: false, rs: false, flick: 0, navF: 0 };
    let sx = axis(left, STICK_X), sy = -axis(left, STICK_Y);
    const m = Math.hypot(sx, sy);
    if (m < DEAD) sx = sy = 0;
    else { const k = (Math.min(1, m) - DEAD) / (1 - DEAD) / m; sx *= k; sy *= k; }
    const a = held(right, FACE_LOW), b = held(right, FACE_HIGH), x = held(left, FACE_LOW), y = held(left, FACE_HIGH), rx = axis(right, STICK_X);
    const breath = held(right, TRIGGER), ls = held(left, STICK), rs = held(right, STICK);
    let flick = p.flick, roll = 0;
    if (!flick && Math.abs(rx) > FLICK_ON) roll = flick = rx > 0 ? 1 : -1;
    else if (flick && Math.abs(rx) < FLICK_OFF) flick = 0;
    const ly = axis(left, STICK_Y), ry = axis(right, STICK_Y), ny = Math.abs(ly) > Math.abs(ry) ? ly : ry;
    let navF = p.navF || 0, nav = 0;
    if (!navF && Math.abs(ny) > FLICK_ON) nav = navF = ny > 0 ? 1 : -1;
    else if (navF && Math.abs(ny) < FLICK_OFF) navF = 0;
    return { sx, sy, breath, boost: held(left, TRIGGER), ball: a && !p.a, pause: b && !p.b, roll,
             x: x && !p.x, y: y && !p.y, grip: held(right, GRIP), gripL: held(left, GRIP), nav, ok: breath && !p.t,
             ls: ls && !p.ls, rs: rs && !p.rs, prev: { a, b, x, y, t: breath, ls, rs, flick, navF } };
  }

  /** The selected row after a stick flick: clamped, so holding a direction never wraps past the ends. */
  function menuNav(sel, n, nav) { return n > 0 ? Math.max(0, Math.min(n - 1, (sel | 0) + (nav | 0))) : 0; }

  /** Splits text into lines no wider than maxW; measure(s) returns the width of s. A single long word gets its own line. */
  function wrapText(text, maxW, measure) {
    const out = [];
    let line = '';
    for (const w of String(text == null ? '' : text).split(/\s+/)) {
      if (!w) continue;
      const tryLine = line ? line + ' ' + w : w;
      if (line && measure(tryLine) > maxW) { out.push(line); line = w; } else line = tryLine;
    }
    if (line) out.push(line);
    return out;
  }

  /* ---------- comfort settings (pure): one object, stored as JSON; every comfort feature reads its switch here ---------- */
  const CF_KEY = 'vsd-comfort';
  /** Every setting and the values it can take. */
  const OPTIONS = {
    enabled: [true, false],           // the master switch: off = VR exactly as it was before the comfort work
    preset: ['comfortable', 'recommended', 'advanced', 'custom'],
    speed: [0.5, 0.75, 1],            // time scale of the single-player modes in VR (it was always 0.5)
    scale: [0.7, 0.8, 0.9, 1, 1.1, 1.2],   // render scale (the eye buffer; 1 = what the headset recommends)
    foveation: [0, 0.33, 0.66, 1],    // fixed foveation: the edge of the view is drawn coarser
    turn: ['snap', 'smooth'],         // how the view follows the dragon's turns
    snapAngle: [15, 30, 45],          // deg a snap turn
    smoothSpeed: [30, 45, 60, 90, 0],   // deg/s cap of a smooth turn; 0 = none
    ease: [true, false],              // speed changes reach the view over half a second
    boost: [true, false],             // the boost works in VR
    assist: ['gentle', 'normal', 'free'],   // stick shaping: turn and dive limits, no instant reversals
    vignette: ['off', 'low', 'medium', 'high'],   // comfort vignette: narrows the view while it turns or accelerates
    rest: ['off', 'subtle', 'strong'],   // rest frame: saddle bow and horns fixed to the seat
    effects: [false, true],           // camera effects in VR (the hit shake); off: the view is never shaken
    adaptive: [true, false],          // lower the quality a step while frames run over the budget
    compact: [true, false],           // dragons as skinned meshes (far fewer draw calls)
    debug: [false, true],             // the head-locked debug overlay
  };
  /** Device settings: not part of a preset. */
  const DEVICE = { enabled: true, scale: 1, foveation: 0.66, adaptive: true, compact: true, debug: false };
  /** The settings a preset owns; the rest (render scale, debug ...) are about the device, not about comfort. */
  const PRESETS = {
    comfortable: { speed: 0.5, turn: 'snap', snapAngle: 30, smoothSpeed: 30, ease: true, boost: false, assist: 'gentle', vignette: 'low', rest: 'strong', effects: false },
    recommended: { speed: 0.75, turn: 'snap', snapAngle: 30, smoothSpeed: 45, ease: true, boost: true, assist: 'normal', vignette: 'off', rest: 'subtle', effects: false },
    advanced: { speed: 1, turn: 'smooth', snapAngle: 30, smoothSpeed: 0, ease: false, boost: true, assist: 'free', vignette: 'off', rest: 'off', effects: true },
  };
  /** VR as it was before the comfort work: what is in effect while 'enabled' is off. */
  const ORIGINAL = { speed: 0.5, turn: 'smooth', smoothSpeed: 0, ease: false, boost: true, assist: 'free', vignette: 'off', rest: 'off', effects: false, scale: 1, foveation: 1, adaptive: false, compact: false };
  function effective(out, s) { return Object.assign(out, s, s.enabled ? null : ORIGINAL); }
  function defaults() { return Object.assign({ preset: 'recommended' }, DEVICE, PRESETS.recommended); }

  /* ---------- adaptive quality (pure): frames over the budget for a second lower the quality one level ---------- */
  const ADAPT = { over: 1.08, good: 1.03, window: 1000, warm: 3000, wait: 15, maxWait: 120, step: 0.1, floor: 0.6 };
  function adaptState() { return { acc: 0, n: 0, t: 0, level: 0, good: 0, wait: ADAPT.wait, upAt: -1e9 }; }
  /** Levels below the player's settings: first full foveation, then the render scale 10 % a level down to the floor. */
  function adaptLevels(s) { return (s.foveation < 1 ? 1 : 0) + Math.max(0, Math.round((s.scale - ADAPT.floor) / ADAPT.step)); }
  function adaptQuality(level, s) {
    const fov = s.foveation < 1 ? 1 : 0, k = Math.max(0, Math.min(level, adaptLevels(s)) - fov);
    return { foveation: level >= 1 && fov ? 1 : s.foveation, scale: Math.max(Math.min(ADAPT.floor, s.scale), Math.round((s.scale - k * ADAPT.step) * 100) / 100) };
  }
  /**
   * Feed the time of every frame (ms); budget is the frame time of the display (11.1 ms at 90 Hz). Returns -1 when the
   * quality has to go a level down (a.level is already raised), +1 when it may come back up, else 0. A second whose
   * average is over the budget lowers it; `wait` good seconds in a row raise it, and a raise that fails within 5 s
   * doubles the wait, so the picture does not pump.
   */
  function adaptStep(a, ms, budget, maxLevel) {
    if (!(ms > 0) || ms > 250) return 0;                          // a hitch or a pause is not load
    a.t += ms; a.acc += ms; a.n++;
    if (a.acc < ADAPT.window) return 0;
    const avg = a.acc / a.n;
    a.acc = 0; a.n = 0;
    if (a.t < ADAPT.warm) return 0;                               // shaders compile in the first seconds
    if (avg > budget * ADAPT.over) {
      a.good = 0;
      if (a.level >= maxLevel) return 0;
      if (a.t - a.upAt < 5000) a.wait = Math.min(ADAPT.maxWait, a.wait * 2);
      a.level++;
      return -1;
    }
    if (avg > budget * ADAPT.good) { a.good = 0; return 0; }
    if (a.level > 0 && ++a.good >= a.wait) { a.good = 0; a.level--; a.upAt = a.t; return 1; }
    return 0;
  }
  /** The option of `key` that `v` names (a stored value, or text from the URL), or undefined. */
  function optionOf(key, v) { const o = OPTIONS[key]; return o ? o.find(x => x === v || String(x) === String(v)) : undefined; }
  /** A full, valid settings object from anything (a parsed JSON blob, null ...). */
  function sanitize(raw) {
    const s = defaults();
    if (raw && typeof raw === 'object') for (const k in OPTIONS) { const v = optionOf(k, raw[k]); if (v !== undefined) s[k] = v; }
    return s;
  }
  /** `s` with the preset applied (in place). */
  function preset(s, name) { if (PRESETS[name]) Object.assign(s, PRESETS[name], { preset: name }); return s; }
  /** Sets one value (in place); changing a value a preset owns turns the preset into 'custom'. */
  function setOption(s, key, value) {
    const v = optionOf(key, value);
    if (v === undefined) return s;
    if (key === 'preset') return v === 'custom' ? Object.assign(s, { preset: v }) : preset(s, v);
    s[key] = v;
    if (key in PRESETS.recommended) s.preset = Object.keys(PRESETS).find(n => Object.keys(PRESETS[n]).every(k => PRESETS[n][k] === s[k])) || 'custom';
    return s;
  }
  /** Stored settings, then ?comfort=key:value,key:value from the page URL on top (not stored). storage may be null. */
  function loadComfort(storage, search) {
    let raw = null;
    try { raw = JSON.parse(storage.getItem(CF_KEY)); } catch (_) { }
    const s = sanitize(raw);
    const m = /[?&]comfort=([^&#]*)/.exec(search || '');
    if (m) for (const pair of decodeURIComponent(m[1]).split(',')) { const i = pair.indexOf(':'); if (i > 0) setOption(s, pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    return s;
  }
  function saveComfort(storage, s) { try { storage.setItem(CF_KEY, JSON.stringify(s)); return true; } catch (_) { return false; } }
  /* ---------- turning and acceleration (pure) ---------- */
  const DEG = Math.PI / 180, FADE = 0.05;                        // a snap turn: 50 ms to black, 50 ms back
  /** Snap turn: the yaw step (whole steps, rad) once the heading is a full step away from the view, else 0. */
  function snapStep(delta, step) { return Math.abs(delta) >= step - 1e-9 ? Math.trunc(delta / step + (delta > 0 ? 1e-9 : -1e-9)) * step : 0; }
  /** Smooth turn: this frame's yaw step, eased toward the heading and never faster than maxRate (rad/s; 0 = no cap). */
  function smoothStep(delta, dt, maxRate) {
    const s = delta * (1 - Math.exp(-dt * YAW_RATE)), m = maxRate * dt;
    return maxRate > 0 ? Math.max(-m, Math.min(m, s)) : s;
  }
  /**
   * Eased speed: e = { s: speed of the view along its heading (m/s), lag: how far the dragon has pulled ahead (m) }.
   * The view's speed follows the dragon's (sWant) with a time constant of EASE.t; the gap that opens closes again slowly.
   */
  const EASE = { t: 0.5, pull: 1.2, min: -8, max: 14 };
  function easeStep(e, sWant, dt) {
    e.s += (sWant - e.s) * (1 - Math.exp(-dt / EASE.t));
    e.lag = Math.max(EASE.min, Math.min(EASE.max, (e.lag + (sWant - e.s) * dt) * Math.exp(-dt * EASE.pull)));
    return e;
  }
  /** Stick shaping: the share of a full turn / pitch a level lets through, and how fast the stick may move (1/s). */
  const ASSIST = { gentle: { turn: 0.6, pitch: 0.6, slew: 2.5 }, normal: { turn: 0.85, pitch: 0.8, slew: 5 }, free: null };
  function shapeStick(k, sx, sy, dt, level, ground) {
    const a = ASSIST[level];
    if (!a) { k.x = sx; k.y = sy; return k; }
    const m = a.slew * dt, tx = sx * a.turn, ty = ground ? sy : sy * a.pitch;
    k.x += Math.max(-m, Math.min(m, tx - k.x));
    k.y = ground ? ty : k.y + Math.max(-m, Math.min(m, ty - k.y));
    return k;
  }

  /* ---------- comfort vignette (pure) ---------- */
  /**
   * open: half angle (deg) of the view when the ring is out of sight; low / medium / high: the half angle it closes to.
   * turn (deg/s) and accel (m/s2) each close it fully on their own; up / down: how fast it closes and opens (1/s).
   */
  const VIG = { open: 60, low: 50, medium: 44, high: 36, turn: 90, accel: 25, up: 4, down: 1.6, feather: 0.6, alpha: 0.7 };
  /** 0 (open) .. 1 (closed as far as the strength goes) from the turn rate and the linear acceleration of the view. */
  function vignetteTarget(turnDeg, accel) { return Math.max(0, Math.min(1, turnDeg / VIG.turn + accel / VIG.accel)); }
  function vignetteStep(cur, target, dt) { return cur + (target - cur) * (1 - Math.exp(-dt * (target > cur ? VIG.up : VIG.down))); }
  /** Half angle (deg) of the clear view for a strength and an amount 0..1. */
  function vignetteAngle(level, m) { const lo = VIG[level]; return lo ? VIG.open + (lo - VIG.open) * Math.max(0, Math.min(1, m)) : VIG.open; }

  /* ---------- rest frame (pure): tubes along polylines, as plain arrays ---------- */
  /**
   * The rest frame in rig space (origin = the seated head, -z ahead, metres): a saddle bow low in front, about 40 deg
   * under the eye line, and two horns rising from it left and right of the status panel. 'strong': the horns reach the
   * eye line and two side rails sit at the edge of the view. -> { position, color, index } arrays, or null for 'off'.
   */
  function restFrame(level) {
    if (level !== 'subtle' && level !== 'strong') return null;
    const P = [], C = [], I = [], SIDES = 5, strong = level === 'strong';
    function tube(pts, r0, r1, col) {
      const base = P.length / 3, n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], r = r0 + (r1 - r0) * i / (n - 1);
        let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const hl = Math.hypot(pts[i][0], pts[i][2]) || 1, ox = pts[i][0] / hl, oz = pts[i][2] / hl;   // outward from the seat: a steady reference
        let ux = ty * oz, uy = tz * ox - tx * oz, uz = -ty * ox;  // t x outward
        const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
        const vx = uy * tz - uz * ty, vy = uz * tx - ux * tz, vz = ux * ty - uy * tx;   // u x t
        for (let j = 0; j < SIDES; j++) {
          const an = j / SIDES * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an), k = 0.72 + 0.28 * (ca * uy + sa * vy);   // lit from above, baked
          P.push(pts[i][0] + (ux * ca + vx * sa) * r, pts[i][1] + (uy * ca + vy * sa) * r, pts[i][2] + (uz * ca + vz * sa) * r);
          C.push(col[0] * k, col[1] * k, col[2] * k);
        }
        if (i) for (let j = 0; j < SIDES; j++) {
          const p0 = base + (i - 1) * SIDES + j, p1 = base + (i - 1) * SIDES + (j + 1) % SIDES, q0 = p0 + SIDES, q1 = p1 + SIDES;
          I.push(p0, q0, p1, p1, q0, q1);
        }
      }
    }
    const R = 0.9, Y = -0.76, LEATHER = [0.2, 0.14, 0.09], HORN = [0.4, 0.37, 0.3];
    const on = (az, y, r) => [Math.sin(az) * (r || R), y, -Math.cos(az) * (r || R)];
    const bow = [];
    for (let i = -8; i <= 8; i++) { const az = i / 8 * 1.35; bow.push(on(az, Y - 0.1 * (az * az) / (1.35 * 1.35))); }   // sinks a little to the sides
    tube(bow, 0.045, 0.045, LEATHER);
    for (const s of [-1, 1]) {
      const horn = [], top = strong ? 0.02 : -0.3, az0 = s * 0.68;
      for (let i = 0; i <= 6; i++) { const t = i / 6; horn.push(on(az0 + s * 0.1 * t * t, Y + 0.02 + (top - Y) * t, R - 0.12 * t * (1 - t))); }
      tube(horn, 0.04, 0.008, HORN);
      if (strong) { const rail = []; for (let i = 0; i <= 5; i++) { const t = i / 5; rail.push(on(s * (1.25 + 0.2 * t), Y - 0.08 + 0.42 * t * t, R)); } tube(rail, 0.035, 0.01, HORN); }
    }
    return { position: P, color: C, index: I };
  }

  const comfort = { KEY: CF_KEY, ORIGINAL, effective, VIG, vignetteTarget, vignetteStep, vignetteAngle, restFrame, snapStep, smoothStep, easeStep, shapeStick, EASE, ASSIST, FADE, OPTIONS, PRESETS, ADAPT, adaptState, adaptLevels, adaptQuality, adaptStep, defaults, sanitize, preset, set: setOption, load: loadComfort, save: saveComfort };

  /* ---------- the VR menu: a mirror of the DOM panel that is open on the flat page ---------- */
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const shown = el => el.getClientRects().length > 0;
  const ITEMS = 'button,input[type=checkbox],select';
  const BLOCKS = 'h1,h2,h3,p,li,tr,dt,dd,label,div,section';

  /** Text of an element without the text of its controls. */
  function ownText(el) {
    let s = '';
    const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) s += c.nodeValue; else if (c.nodeType === 1 && !c.matches(ITEMS + ',a,script,style') && !c.hidden) walk(c); } };
    walk(el);
    return clean(s);
  }
  function labelOf(el) {
    if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex], l = el.closest('label'); return clean((l ? ownText(l) + ': ' : '') + (o ? o.textContent : '')); }
    if (el.tagName === 'INPUT') { const l = el.closest('label'); return (el.checked ? '[x] ' : '[  ] ') + (l ? ownText(l) : ''); }
    const own = clean(el.textContent) || clean(el.getAttribute('aria-label')), li = el.closest('li');
    const row = li ? ownText(li) : '';
    return row ? row + ' - ' + own : own;
  }
  /** -> { lines: [{ text, kind: 'h' | 'e' | 'p' }], items: [{ el, label }] } for the panel root, as it shows right now. */
  function scanMenu(roots, skip) {
    const out = { roots, lines: [], items: [] };
    const skipped = el => !!(skip && el.closest(skip));
    for (const rootEl of roots) {
      for (const el of rootEl.querySelectorAll(ITEMS)) {
        if (el.disabled || !shown(el) || skipped(el)) continue;
        const label = labelOf(el);
        if (label) out.items.push({ el, label, main: el.matches('.cta,.go') });
      }
      const tw = document.createTreeWalker(rootEl, 4 /* SHOW_TEXT */);
      let lastBlock = null, n;
      while ((n = tw.nextNode())) {
        const text = clean(n.nodeValue), par = n.parentElement;
        if (!text || !par || par.closest(ITEMS + ',a,script,style,option') || !shown(par) || skipped(par)) continue;
        const block = par.closest(BLOCKS) || rootEl;
        if ((block.tagName === 'LABEL' || block.tagName === 'LI') && block.querySelector(ITEMS + ',input')) continue;   // a button row, or a text field (no typing in VR)
        if (block === lastBlock) { out.lines[out.lines.length - 1].text += ' ' + text; continue; }
        lastBlock = block;
        const tag = block.tagName;
        out.lines.push({ text, kind: /^H[123]$/.test(tag) ? 'h' : block.classList.contains('eyebrow') ? 'e' : tag === 'DT' ? 'dt' : tag === 'DD' ? 'dd' : 'p' });
      }
    }
    for (let i = out.lines.length - 2; i >= 0; i--) {             // key tables: "key: what it does" on one line
      if (out.lines[i].kind === 'dt' && out.lines[i + 1].kind === 'dd') out.lines.splice(i, 2, { text: out.lines[i].text + ': ' + out.lines[i + 1].text, kind: 'p' });
    }
    return out;
  }
  function pressItem(el) {
    if (el.tagName === 'SELECT') { el.selectedIndex = (el.selectedIndex + 1) % Math.max(1, el.options.length); el.dispatchEvent(new Event('change', { bubbles: true })); }
    else el.click();
  }
  const ROW = 58, MAX_ROWS = 7;
  function drawMenu(g, W, H, menu, sel, image) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,19,16,.9)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(235,227,205,.25)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3);
    const n = menu.items.length, rows = Math.min(n, MAX_ROWS), itemsH = rows * ROW + (rows ? 16 : 0);
    const first = Math.max(0, Math.min(n - rows, sel - (rows >> 1)));
    const bottom = H - 30 - itemsH;
    let tw = W - 80, y = 30;
    if (image && image.width && image.height) {
      try {
        if (image.width > image.height * 1.3) {                   // a wide picture (the map): across the top, the text under it
          const k = Math.min((W - 60) / image.width, Math.max(120, bottom - 50) / image.height), iw = image.width * k, ih = image.height * k;
          g.drawImage(image, (W - iw) / 2, 30, iw, ih); y = 40 + ih;
        } else {                                                  // a square one (a QR code): beside the text
          const k = Math.min(W * 0.5 / image.width, (H - 60) / image.height), iw = image.width * k, ih = image.height * k;
          g.drawImage(image, W - 30 - iw, (H - ih) / 2, iw, ih); tw = W - 110 - iw;
        }
      } catch (_) { }
    }
    g.textAlign = 'left'; g.textBaseline = 'top';
    outer: for (const ln of menu.lines) {
      const size = ln.kind === 'h' ? 46 : ln.kind === 'e' ? 22 : 28, lh = Math.round(size * 1.25);
      g.font = (ln.kind === 'p' ? '500 ' : '700 ') + size + 'px ' + FONT;
      g.fillStyle = ln.kind === 'e' ? '#62c48a' : ln.kind === 'h' ? '#ebe3cd' : 'rgba(235,227,205,.85)';
      const text = ln.kind === 'e' ? ln.text.toUpperCase() : ln.text;
      for (const part of wrapText(text, tw, s => g.measureText(s).width)) {
        if (y + lh > bottom) { g.fillText('...', 40, Math.min(y, bottom - lh)); break outer; }
        g.fillText(part, 40, y); y += lh;
      }
      y += 8;
    }
    y = H - 30 - itemsH + 16;
    g.font = '700 30px ' + FONT; g.textBaseline = 'middle';
    for (let i = first; i < first + rows; i++) {
      const it = menu.items[i], on = i === sel;
      g.fillStyle = on ? 'rgba(98,196,138,.3)' : 'rgba(235,227,205,.07)'; g.fillRect(40, y, tw, ROW - 10);
      if (on) { g.strokeStyle = '#62c48a'; g.lineWidth = 3; g.strokeRect(40, y, tw, ROW - 10); }
      g.fillStyle = on ? '#ffffff' : 'rgba(235,227,205,.8)';
      let label = it.label;
      while (label.length > 4 && g.measureText(label).width > tw - 70) label = label.slice(0, -2);
      g.fillText((label === it.label ? label : label + '...'), 60, y + (ROW - 10) / 2 + 1);
      if (on) { g.textAlign = 'right'; g.fillStyle = '#62c48a'; g.fillText('A', 40 + tw - 16, y + (ROW - 10) / 2 + 1); g.textAlign = 'left'; }
      y += ROW;
    }
    if (n > rows) { g.fillStyle = 'rgba(235,227,205,.5)'; g.font = '600 20px ' + FONT; g.textAlign = 'right'; g.fillText((sel + 1) + ' / ' + n, 40 + tw, H - 18); g.textAlign = 'left'; }
    g.textBaseline = 'alphabetic';
  }

  function attach(o) {
    const { renderer, scene, camera } = o;
    const buttons = [].concat(o.button || []).filter(Boolean);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');                 // origin at the seated head
    const rig = new THREE.Group();
    scene.add(rig); rig.add(camera);
    let prev = null, snap = true, scale = 0, busy = false;
    let storage = null;
    try { storage = root.localStorage; } catch (_) { }
    const cf = loadComfort(storage, root.location ? root.location.search : '');
    const ef = effective({}, cf);                                 // what is in effect: cf, or the original VR while 'enabled' is off
    slowNow = ef.speed;
    /* the motion of the view and the cost of a frame, on the real clock (the modes pass a slowed game dt to follow) */
    const st = { now: 0, dt: 0, t0: 0, speed: 0, turn: 0, accel: 0, vx: 0, vy: 0, vz: 0, haveV: false, acc: 0, accMax: 0, accCpu: 0, n: 0, calls: 0, tris: 0, at: -Infinity, have: false, yaw: 0 };
    const lastPos = new THREE.Vector3();
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

    /* render quality: the eye buffer is allocated at cf.scale when the session starts; below that the views are scaled
       (XRView.requestViewportScale: no reallocation, takes effect on the next frame), which is also what the adaptive
       fallback uses. One callback on a change, nothing per frame. */
    let fbScale = 1, vpScale = 1, vpWant = 1, vpBusy = false, vpOk = true;
    const adapt = adaptState();
    function viewportFrame(time, frame) {
      vpBusy = false;
      const session = renderer.xr.getSession(), pose = session && frame.getViewerPose(renderer.xr.getReferenceSpace());
      if (!session) return;
      if (!pose) { vpBusy = true; session.requestAnimationFrame(viewportFrame); return; }
      vpOk = false;
      for (const v of pose.views) if (v.requestViewportScale) { v.requestViewportScale(vpWant); vpOk = true; }
      vpScale = vpWant; scale = 0;                                // the point sprites follow the new eye viewport
    }
    function applyQuality() {
      const session = renderer.xr.getSession();
      if (!session) return;
      const q = adaptQuality(ef.adaptive ? adapt.level : 0, ef), layer = session.renderState.baseLayer;
      if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = q.foveation;   // r128 has no setFoveation
      vpWant = Math.min(1, q.scale / fbScale);
      if (vpWant !== vpScale && !vpBusy) { vpBusy = true; session.requestAnimationFrame(viewportFrame); }
    }
    /* rest frame: one unlit mesh fixed to the rig, built when a level is first shown */
    const restMeshes = {};
    function showRest(level) {
      for (const k in restMeshes) restMeshes[k].visible = false;
      const f = level && !restMeshes[level] ? restFrame(level) : null;
      if (f) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(f.position, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(f.color, 3)); g.setIndex(f.index);
        const m = restMeshes[level] = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
        m.frustumCulled = false; rig.add(m);
      }
      if (level && restMeshes[level]) restMeshes[level].visible = true;
    }
    const pivot = new THREE.Vector3(); let havePivot = false;      // the dragon the view follows
    /* the snap turn fade: a quad over each eye, drawn only during the 100 ms of a turn */
    const fadeMat = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide, uniforms: { uA: { value: 0 } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}', fragmentShader: 'uniform float uA;void main(){gl_FragColor=vec4(0.,0.,0.,uA);}' });
    const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat);
    fadeMesh.frustumCulled = false; fadeMesh.renderOrder = 1004; fadeMesh.visible = false; rig.add(fadeMesh);
    let fadePhase = 0, fadeT = 0, pendingYaw = 0;                  // 1: going dark, 2: coming back
    /* the comfort vignette: a ring in view space (the same in each eye, so it has no depth), clear inside uIn, black
       outside uIn * (1 + feather). x, y of a vertex: its direction; z: 0 inner edge, 1 end of the feather, 2 far out. */
    const vigMesh = (function () {
      const N = 48, pos = [], idx = [];
      for (let r = 0; r < 3; r++) for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pos.push(Math.cos(a), Math.sin(a), r); }
      for (let r = 0; r < 2; r++) for (let i = 0; i < N; i++) { const a = r * N + i, b = r * N + (i + 1) % N; idx.push(a, a + N, b, b, a + N, b + N); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
        uniforms: { uIn: { value: 1.6 }, uFeather: { value: VIG.feather }, uAlpha: { value: VIG.alpha } },
        vertexShader: 'uniform float uIn,uFeather;varying float vA;void main(){float r=position.z<.5?uIn:position.z<1.5?uIn*(1.+uFeather):12.;vA=position.z<.5?0.:1.;gl_Position=projectionMatrix*vec4(position.xy*r,-1.,1.);}',
        fragmentShader: 'uniform float uAlpha;varying float vA;void main(){gl_FragColor=vec4(0.,0.,0.,vA*vA*(3.-2.*vA)*uAlpha);}' }));
      m.frustumCulled = false; m.renderOrder = 996; m.visible = false; rig.add(m);
      return m;
    })();
    let vig = 0;
    function updateVignette(dt) {
      vig = ef.vignette === 'off' ? 0 : vignetteStep(vig, vignetteTarget(st.turn, st.accel), dt);
      vigMesh.visible = vig > 0.02;
      if (vigMesh.visible) vigMesh.material.uniforms.uIn.value = Math.tan(vignetteAngle(ef.vignette, vig) * DEG);
    }
    const want = new THREE.Vector3(), lastWant = new THREE.Vector3(), easeS = { s: 0, lag: 0 }, stick = { x: 0, y: 0 };
    let easeOn = 0;                                               // 0: no last position yet, 1: no speed yet, 2: running
    function place(pos, yaw) {                                    // at once: a seat, a respawn, the first frame
      rig.position.copy(pos); rig.rotation.y = yaw;
      fadePhase = 0; fadeMesh.visible = false; easeOn = 0; easeS.lag = 0; st.have = false; measure();
      st.accel = st.turn = 0; vig = 0; vigMesh.visible = false;
    }
    function applyComfort() {
      if (!renderer.xr.isPresenting) return;
      dbg.mesh.visible = cf.debug;
      showRest(ef.rest === 'off' ? null : ef.rest);
      if (root.VDragon && root.VDragon.compact) root.VDragon.compact(ef.compact);
      applyQuality();
    }

    /* panels: canvases on planes fixed to the rig (they turn with the dragon, not with the head) */
    function panel(cw, ch, w, h, x, y, z, tilt, order, parent) {
      const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
      const tex = new THREE.CanvasTexture(canvas);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      mesh.renderOrder = order; mesh.frustumCulled = false; mesh.visible = false; mesh.position.set(x, y, z); mesh.rotation.x = tilt;
      (parent || rig).add(mesh);
      return { canvas, g: canvas.getContext('2d'), tex, mesh };
    }
    const hud = panel(640, 320, 1.2, 0.6, 0, -1.15, -2, -0.52, 999);   // about 30 deg below the eye line (the dragon is at 18), tilted to the player
    const menuP = panel(1024, 768, 2, 1.5, 0, 0.12, -2.4, 0, 1001);
    const dbg = panel(960, 96, 1.2, 0.12, 0, -1.15 - 0.37 * Math.cos(0.52), -2 + 0.37 * Math.sin(0.52), -0.52, 1000);   // a strip under the status panel, in its plane
    let hudAt = -Infinity;

    /* debug overlay: 4 times a second; the numbers are averages over that quarter second */
    function drawDebug(now) {
      const n = Math.max(1, st.n), ms = st.acc / n, g = dbg.g, session = renderer.xr.getSession(), layer = session && session.renderState.baseLayer;
      g.clearRect(0, 0, 960, 96); g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(0, 0, 960, 96);
      g.font = '600 30px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const hz = (session && session.frameRate) || 0;
      g.fillStyle = ms > 1000 / (hz || 90) * 1.08 ? '#ff7a6b' : '#8dffb0';
      g.fillText((ms > 0 ? 1000 / ms : 0).toFixed(0) + ' fps  ' + ms.toFixed(1) + ' ms  max ' + st.accMax.toFixed(0) + '  cpu ' + (st.accCpu / n).toFixed(1) + (hz ? '  ' + hz + ' Hz' : ''), 12, 38);
      g.fillStyle = '#ebe3cd';
      g.fillText('calls ' + st.calls + ' tris ' + (st.tris / 1000).toFixed(0) + 'k  v' + st.speed.toFixed(0) + ' w' + st.turn.toFixed(0) + ' a' + st.accel.toFixed(0) + '  ' + debugLine(layer), 12, 80);
      dbg.tex.needsUpdate = true;
      st.acc = st.accMax = st.accCpu = st.n = 0; st.at = now;
    }
    const debugLine = layer => 'f' + (layer && layer.fixedFoveation != null ? (+layer.fixedFoveation).toFixed(2) : '-') + ' x' + (fbScale * vpScale).toFixed(2) + (vpOk ? '' : '!') + ' L' + (ef.adaptive ? adapt.level : '-') + (ef.enabled ? '' : ' OFF');
    /* the speed and the turn rate of the view (the rig), smoothed over about 0.1 s */
    function measure() {
      if (st.dt && st.have) {
        const k = 1 - Math.exp(-st.dt * 8);
        const vx = (rig.position.x - lastPos.x) / st.dt, vy = (rig.position.y - lastPos.y) / st.dt, vz = (rig.position.z - lastPos.z) / st.dt;
        if (st.haveV) st.accel += (Math.hypot(vx - st.vx, vy - st.vy, vz - st.vz) / st.dt - st.accel) * (1 - Math.exp(-st.dt * 6));   // linear acceleration, turns of the path included
        st.vx = vx; st.vy = vy; st.vz = vz; st.haveV = true;
        st.speed += (rig.position.distanceTo(lastPos) / st.dt - st.speed) * k;
        st.turn += (Math.abs(wrap(rig.rotation.y - st.yaw)) / st.dt * 180 / Math.PI - st.turn) * k;
      }
      else if (!st.have) st.haveV = false;
      lastPos.copy(rig.position); st.yaw = rig.rotation.y; st.have = true;
    }
    /* ---------- the comfort menu: a DOM panel that exists only during a session, kept off screen and shown through the
       same mirror as every other menu. A click of the RIGHT stick opens and closes it; B closes it. ---------- */
    const T = k => (root.I18N ? root.I18N.t(k) : k);
    const SEEN_KEY = 'vsd-comfort-seen';
    const MENU_ROWS = [['debug', 'box'], ['enabled', 'box'], ['preset', 'sel'], ['speed', 'sel'], ['turn', 'sel'], ['snapAngle', 'sel'], ['smoothSpeed', 'sel'], ['vignette', 'sel'], ['rest', 'sel'], ['effects', 'box'],
                       ['scale', 'sel'], ['assist', 'sel'], ['ease', 'box'], ['boost', 'box'], ['foveation', 'sel'], ['adaptive', 'box'], ['compact', 'box']];
    const optText = (k, v) => (k === 'snapAngle' ? v + '°' : k === 'smoothSpeed' ? (v ? v + ' °/s' : T('cf.o.nolimit')) : k === 'scale' ? v.toFixed(1) : k === 'foveation' ? v.toFixed(2) : k === 'speed' ? v * 100 + ' %' : T('cf.o.' + v));
    let cmEl = null, cmOpen = false, cmFirst = false;
    function syncComfortMenu() {
      if (!cmEl) return;
      for (const c of cmEl.querySelectorAll('[data-k]')) { if (c.type === 'checkbox') c.checked = !!cf[c.dataset.k]; else c.value = String(cf[c.dataset.k]); }
    }
    function closeComfortMenu() {
      cmOpen = false;
      if (cmFirst) { cmFirst = false; try { storage.setItem(SEEN_KEY, '1'); } catch (_) { } }
      if (cmEl) { cmEl.remove(); cmEl = null; }
    }
    function openComfortMenu(first) {
      if (cmEl) cmEl.remove();
      cmFirst = !!first; cmOpen = true;
      const el = cmEl = document.createElement('section'), add = (tag, text, parent) => { const n = document.createElement(tag); if (text) n.textContent = text; (parent || el).appendChild(n); return n; };
      el.id = 'vxrComfort'; el.style.cssText = 'position:fixed;left:-9999px;top:0;width:420px';
      add('h2', T('cf.title'));
      add('p', T(first ? 'cf.first' : 'cf.note'));
      if (first) {
        const yes = add('button', T('cf.first.yes')); yes.className = 'cta';
        yes.onclick = () => { setComfort('preset', 'comfortable'); closeComfortMenu(); };
        add('button', T('cf.first.no')).onclick = () => { closeComfortMenu(); };
      } else {
        for (const [k, kind] of MENU_ROWS) {
          const label = add('label', T('cf.' + k) + ' ');
          if (kind === 'box') { const c = add('input', '', label); c.type = 'checkbox'; c.dataset.k = k; c.onchange = () => { setComfort(k, c.checked); syncComfortMenu(); }; }
          else {
            const c = add('select', '', label); c.dataset.k = k;
            for (const v of OPTIONS[k]) { const o = add('option', optText(k, v), c); o.value = String(v); }
            c.onchange = () => { setComfort(k, c.value); syncComfortMenu(); };
          }
        }
        add('button', T('cf.close')).onclick = closeComfortMenu;   // not the main button: the menu opens on Preset
      }
      document.body.appendChild(el);
      syncComfortMenu();
    }
    function setComfort(key, value) {
      setOption(cf, key, value); saveComfort(storage, cf);
      effective(ef, cf); slowNow = ef.speed;
      applyComfort();
    }
    let menu = null, menuSel = 0, menuScanAt = -Infinity, menuDrawn = '', menuSince = 0;

    /* floating bars */
    const barGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), barMap = new Map(), eyeW = new THREE.Vector3();
    function barMesh(col, op, order) {
      const m = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false, depthWrite: false, fog: false }));
      m.renderOrder = order; m.frustumCulled = false; return m;
    }
    function bars(list) {
      const seen = new Set();
      camera.getWorldPosition(eyeW);
      for (const it of list) {
        seen.add(it.id);
        let b = barMap.get(it.id);
        if (!b || b.n !== it.rows.length) {
          if (b) scene.remove(b.root);
          b = { root: new THREE.Group(), n: it.rows.length, fills: [] };
          const w = it.w || 8, h = it.h || w * 0.1;
          it.rows.forEach((r, i) => {
            const back = barMesh(0x0c1310, 0.6, 997), fill = barMesh(r[1], 1, 998);
            back.scale.set(w + h * 0.4, h * 1.4, 1); back.position.set(-w / 2 - h * 0.2, -i * h * 1.7, -0.01); fill.position.set(-w / 2, -i * h * 1.7, 0);
            b.root.add(back, fill); b.fills.push({ fill, w, h });
          });
          b.root.frustumCulled = false; scene.add(b.root); barMap.set(it.id, b);
        }
        it.rows.forEach((r, i) => { const f = b.fills[i]; f.fill.material.color.set(r[1]); f.fill.scale.set(Math.max(0.001, f.w * Math.max(0, Math.min(1, r[0]))), f.h, 1); });
        b.root.position.set(it.x, it.y, it.z);
        b.root.lookAt(eyeW);
      }
      barMap.forEach((b, id) => { if (!seen.has(id)) { scene.remove(b.root); barMap.delete(id); } });
    }

    renderer.xr.addEventListener('sessionstart', () => {
      prev = null; snap = true; scale = 0; hudAt = -Infinity; menu = null; menuDrawn = '';
      st.now = 0; st.have = false; st.speed = st.turn = 0; st.at = -Infinity; stick.x = stick.y = 0;
      hud.mesh.visible = true;
      const session = renderer.xr.getSession();
      try {                                                       // Quest: 90 Hz when the browser offers it
        const rates = session.supportedFrameRates;
        if (session.updateTargetFrameRate && rates && Array.prototype.indexOf.call(rates, 90) >= 0) session.updateTargetFrameRate(90).catch(() => {});
      } catch (_) { }
      Object.assign(adapt, adaptState()); vpScale = 1; vpBusy = false;
      applyComfort();
      let seen = '1';
      try { seen = storage.getItem(SEEN_KEY); } catch (_) { }
      if (!seen) openComfortMenu(true);
      if (o.onStart) o.onStart();
    });
    renderer.xr.addEventListener('sessionend', () => {
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      hud.mesh.visible = menuP.mesh.visible = dbg.mesh.visible = false; menu = null;
      closeComfortMenu();
      showRest(null); fadePhase = 0; fadeMesh.visible = false; vig = 0; vigMesh.visible = false;
      if (root.VDragon && root.VDragon.compact) root.VDragon.compact(false);   // the flat screen draws the dragons as it always did
      bars([]);
      if (o.onEnd) o.onEnd();
    });

    async function enter() {
      if (busy || renderer.xr.isPresenting) return;
      busy = true;
      fbScale = ef.scale; renderer.xr.setFramebufferScaleFactor(fbScale);
      try { await renderer.xr.setSession(await navigator.xr.requestSession('immersive-vr')); }
      catch (e) { console.warn('VR not started', e); if (o.onError) o.onError(e); }
      busy = false;
    }
    if (buttons.length && navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then(ok => { buttons.forEach(b => { b.hidden = !ok; }); }).catch(() => {});
      buttons.forEach(b => b.addEventListener('click', enter));
    }

    const viewProxy = { position: rig.position, quaternion: new THREE.Quaternion(), fov: 90, viewH: 1000 };
    const api = {
      rig, eye: rig.position, bars, cf: ef, setComfort,
      follow(pos, yaw, dt, at, shake) {
        havePivot = !!at && ef.enabled;                          // off: the chase position as the mode gives it, as before
        if (at) { if (at.isVector3) pivot.copy(at); else pivot.set(at[0], at[1], at[2]); }
        if (snap || dt == null || rig.position.distanceToSquared(pos) > 3600) { snap = false; place(pos, yaw); return; }   // 60 m in a frame is a jump, not flight
        const rd = st.dt;                                         // the real clock: what the player feels
        let turned = false;
        if (ef.turn === 'snap') {
          if (!fadePhase) { pendingYaw = snapStep(wrap(yaw - rig.rotation.y), ef.snapAngle * DEG); if (pendingYaw) { fadePhase = 1; fadeT = 0; fadeMesh.visible = true; } }
        } else if (!fadePhase) rig.rotation.y += smoothStep(wrap(yaw - rig.rotation.y), ef.enabled ? rd : dt, ef.smoothSpeed * DEG);   // off: on the game clock, as before
        if (fadePhase) {
          fadeT += rd || FADE;
          if (fadePhase === 1 && fadeT >= FADE) { rig.rotation.y = wrap(rig.rotation.y + pendingYaw); fadePhase = 2; fadeT = 0; turned = true; }
          else if (fadePhase === 2 && fadeT >= FADE) { fadePhase = 0; fadeMesh.visible = false; }
          fadeMat.uniforms.uA.value = fadePhase === 1 ? Math.min(1, fadeT / FADE) : fadePhase === 2 ? 1 - fadeT / FADE : 0;
        }
        /* behind the dragon as the view faces: the mode's chase position, turned about the dragon by the angle the view is off */
        want.copy(pos);
        const ry = rig.rotation.y;
        if (havePivot) {
          const a = wrap(ry - yaw), c = Math.cos(a), s = Math.sin(a), ox = pos.x - pivot.x, oz = pos.z - pivot.z;
          want.x = pivot.x + ox * c + oz * s; want.z = pivot.z - ox * s + oz * c;
        }
        if (ef.ease && havePivot) {
          const fx = -Math.sin(ry), fz = -Math.cos(ry);
          if (dt > 0 && rd > 0 && !turned) {                      // not while paused, not across a snap
            if (easeOn) {
              const sWant = ((want.x - lastWant.x) * fx + (want.z - lastWant.z) * fz) / rd;
              if (easeOn === 1) { easeS.s = sWant; easeOn = 2; }
              easeStep(easeS, sWant, rd);
            } else easeOn = 1;
          }
          lastWant.copy(want);
          want.x -= fx * easeS.lag; want.z -= fz * easeS.lag;
        } else { easeOn = 0; easeS.lag = 0; }
        rig.position.copy(want);
        if (turned) st.have = false;                              // a snap is not a turn rate
        measure();
        updateVignette(rd);
        if (shake > 0 && ef.effects) { rig.position.x += (Math.random() - 0.5) * shake * 2; rig.position.y += (Math.random() - 0.5) * shake * 2; }
      },
      view() {
        camera.getWorldQuaternion(viewProxy.quaternion);
        viewProxy.viewH = 2 * (api.pointScale() || 500);         // fov 90: viewH / (2 tan 45) is the point scale
        return viewProxy;
      },
      pad() {
        const session = renderer.xr.isPresenting && renderer.xr.getSession();
        if (!session) return null;
        let left = null, right = null;
        for (const s of session.inputSources) {
          if (s.handedness === 'left') left = s.gamepad || null;
          else if (s.handedness === 'right') right = s.gamepad || null;
        }
        const out = mapPads(left, right, prev);
        prev = out.prev;
        return out;
      },
      frame(now, menuRoot, opts) {
        const p = api.pad();
        if (!p) return null;
        st.t0 = performance.now();
        const d = st.now ? now - st.now : 0;
        st.now = now; st.dt = d > 0 && d < 250 ? d / 1000 : 0;
        if (d > 0) { st.acc += d; st.n++; if (d > st.accMax) st.accMax = d; }
        if (p.ls) setComfort('debug', !cf.debug);
        shapeStick(stick, p.sx, p.sy, st.dt, ef.assist, !!(opts && opts.ground));
        p.sx = stick.x; p.sy = stick.y;
        if (!ef.boost && !(opts && opts.keepBoost)) p.boost = false;
        if (ef.adaptive && adaptStep(adapt, d, 1000 / (renderer.xr.getSession().frameRate || 90), adaptLevels(ef))) applyQuality();
        let roots = [].concat(menuRoot || []).filter(Boolean);
        if (cmOpen && (p.pause || (p.rs && !cmFirst))) { closeComfortMenu(); p.pause = false; }   // B (or the stick again) closes it and does nothing else
        else if (p.rs && !cmOpen) { openComfortMenu(false); p.pause = !roots.length; }            // a mode that is flying gets a pause press
        if (cmOpen) roots = [cmEl];
        if (!roots.length) {
          if (menu) { menu = null; menuP.mesh.visible = false; menuDrawn = ''; }
          p.menu = false;
          return p;
        }
        const fresh = !menu || menu.roots[0] !== roots[0];
        if (fresh || now - menuScanAt > 150) {
          const keep = !fresh && menu.items[menuSel] ? menu.items[menuSel].el : null;
          menu = scanMenu(roots, o.skip); menuScanAt = now;
          if (fresh) { menuSince = now; menuSel = Math.max(0, menu.items.findIndex(it => it.main)); }
          else { const i = menu.items.findIndex(it => it.el === keep); menuSel = i >= 0 ? i : menuNav(menuSel, menu.items.length, 0); }
        }
        if (p.nav) menuSel = menuNav(menuSel, menu.items.length, p.nav);
        const image = opts && opts.image || null;
        const sig = menuSel + '|' + menu.lines.map(l => l.text).join('|') + '|' + menu.items.map(i => i.label).join('|');
        if (sig !== menuDrawn || image) { menuDrawn = sig; drawMenu(menuP.g, 1024, 768, menu, menuSel, image); menuP.tex.needsUpdate = true; }
        menuP.mesh.visible = true;
        if ((p.ball || p.ok) && menu.items[menuSel] && now - menuSince > 500) {   // the pause keeps a mashed A from pressing a button unread
          pressItem(menu.items[menuSel].el); menuScanAt = -Infinity;
        }
        return Object.assign(p, { menu: true, sx: 0, sy: 0, breath: false, boost: false, ball: false, roll: 0, grip: false, gripL: false, x: false, y: false });
      },
      drawHud(now, fn) {                                          // every mode calls this right after it has rendered the frame
        st.accCpu += performance.now() - st.t0; st.calls = renderer.info.render.calls; st.tris = renderer.info.render.triangles;
        if (cf.debug && now - st.at >= 250) drawDebug(now);
        if (now - hudAt < 100) return;
        hudAt = now;
        const g = hud.g;
        g.clearRect(0, 0, 640, 320); g.fillStyle = 'rgba(12,19,16,.55)'; g.fillRect(0, 0, 640, 320);
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        fn(g, 640, 320);
        if (ef.rest === 'strong' && havePivot) {                  // a steady readout: speed of the view and the dragon's height
          g.font = '600 20px ' + FONT; g.textAlign = 'right'; g.fillStyle = 'rgba(235,227,205,.7)';
          g.fillText(Math.round(st.speed) + ' m/s   ' + Math.round(pivot.y) + ' m', 628, 308);
          g.textAlign = 'left';
        }
        hud.tex.needsUpdate = true;
      },
      pointScale() {
        if (!scale && renderer.xr.isPresenting) {
          const eye = renderer.xr.getCamera(camera).cameras[0];
          if (eye) scale = eye.viewport.height * eye.projectionMatrix.elements[5] / 2;
        }
        return scale;
      },
    };
    return api;
  }

  /** HUD helpers: a labelled bar and wrapped text, in the look of the flat HUD. */
  function hudBar(g, label, v, col, x, y, w) {
    g.fillStyle = '#ebe3cd'; g.font = '600 24px ' + FONT; g.fillText(label, x, y);
    g.fillStyle = 'rgba(235,227,205,.18)'; g.fillRect(x, y + 8, w, 16);
    g.fillStyle = col; g.fillRect(x, y + 8, w * Math.max(0, Math.min(1, v)), 16);
  }
  function hudText(g, text, x, y, maxW, size, col, maxLines) {
    g.font = '600 ' + size + 'px ' + FONT; g.fillStyle = col || '#ebe3cd';
    const lines = wrapText(text, maxW, s => g.measureText(s).width).slice(0, maxLines || 2);
    lines.forEach((l, i) => g.fillText(l, x, y + i * Math.round(size * 1.15)));
    return y + lines.length * Math.round(size * 1.15);
  }

  /** Text of an element with its child nodes joined by ' - ' (a banner: title and small print). */
  const textOf = el => (el ? [].map.call(el.childNodes, n => clean(n.textContent)).filter(Boolean).join(' - ') : '');

  const api = { get SLOW() { return slowNow; }, FONT, mapPads, menuNav, wrapText, comfort, attach, hudBar, hudText, textOf };
  root.VXR = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
