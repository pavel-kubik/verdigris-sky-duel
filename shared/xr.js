/*
 * Verdigris - immersive VR (WebXR) support, written for Meta Quest and Three.js r128. Shared by every mode: the solo duel and
 * the tutorial, the co-op, the deathmatch and the campaign. Runs in the browser (window.VXR); the pure parts (mapPads, menuNav,
 * wrapText) also run in Node for tests.
 *   VXR.SLOW                         time scale of the single-player modes in VR (the headset needs more time to read and aim)
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
 *     xr.follow(pos, yaw, dt): moves the rig; the yaw is smoothed (dt null: snapped) and there is never pitch or roll, so the
 *       horizon stays level
 *     xr.eye: the rig position in the world (use it where the flat game uses camera.position)
 *     xr.view(): a stand-in for the camera in VR for code that needs { position, quaternion, fov } and a view height in pixels
 *       (xr.view().viewH) to size point sprites
 *     xr.pad(): mapPads for this frame's controllers, or null outside VR
 *     xr.frame(now, menuRoot, opts): xr.pad() plus the VR menu. menuRoot is the DOM panel that is open on the flat page (or
 *       null; a list shows several as one menu): its texts and buttons are mirrored on a panel in front of the player, the sticks move the selection, A or the
 *       right trigger presses the selected button. While a menu is open the returned pad has menu = true and no flight input.
 *       opts.image: a canvas drawn beside the menu (the campaign map, a QR code).
 *     xr.drawHud(now, fn): redraws the status panel below the eye line 10 times a second; fn(g, w, h) paints on it
 *     xr.bars(list): floating bars in the world, [{ id, x, y, z, w, rows: [[value 0..1, colour], ...] }]; [] removes them
 *     xr.pointScale(): the eye-buffer equivalent of height / (2 tan(fov / 2)) for point sprites, or 0 before the first VR frame
 *     xr.cf: the comfort settings in use; xr.setComfort(key, value) changes one (and stores it)
 *   Debug overlay (head-locked, small): click the LEFT stick in VR. Frame time, fps, CPU time per frame, draw calls,
 *     triangles, speed and turn rate of the view.
 */
(function (root) {
  'use strict';
  const DEAD = 0.15, FLICK_ON = 0.7, FLICK_OFF = 0.3, YAW_RATE = 6, SLOW = 0.5;
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
    preset: ['comfortable', 'recommended', 'advanced', 'custom'],
    scale: [0.7, 0.8, 0.9, 1, 1.1, 1.2],   // render scale (the eye buffer; 1 = what the headset recommends)
    foveation: [0, 0.33, 0.66, 1],    // fixed foveation: the edge of the view is drawn coarser
    adaptive: [true, false],          // lower the quality a step while frames run over the budget
    compact: [true, false],           // dragons as skinned meshes (far fewer draw calls)
    debug: [false, true],             // the head-locked debug overlay
  };
  /** Device settings: not part of a preset. */
  const DEVICE = { scale: 1, foveation: 0.66, adaptive: true, compact: true, debug: false };
  /** The settings a preset owns; the rest (render scale, debug ...) are about the device, not about comfort. */
  const PRESETS = { comfortable: {}, recommended: {}, advanced: {} };
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
  const comfort = { KEY: CF_KEY, OPTIONS, PRESETS, ADAPT, adaptState, adaptLevels, adaptQuality, adaptStep, defaults, sanitize, preset, set: setOption, load: loadComfort, save: saveComfort };

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
    /* the motion of the view and the cost of a frame, on the real clock (the modes pass a slowed game dt to follow) */
    const st = { now: 0, dt: 0, t0: 0, speed: 0, turn: 0, acc: 0, accMax: 0, accCpu: 0, n: 0, calls: 0, tris: 0, at: -Infinity, have: false, yaw: 0 };
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
      const q = adaptQuality(cf.adaptive ? adapt.level : 0, cf), layer = session.renderState.baseLayer;
      if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = q.foveation;   // r128 has no setFoveation
      vpWant = Math.min(1, q.scale / fbScale);
      if (vpWant !== vpScale && !vpBusy) { vpBusy = true; session.requestAnimationFrame(viewportFrame); }
    }
    function applyComfort() {
      if (!renderer.xr.isPresenting) return;
      dbg.mesh.visible = cf.debug;
      if (root.VDragon && root.VDragon.compact) root.VDragon.compact(cf.compact);
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
    const dbg = panel(448, 224, 0.26, 0.13, -0.4, 0.3, -1, 0, 1003, camera);   // head-locked: a child of the camera, up and left of the centre
    let hudAt = -Infinity;

    /* debug overlay: 4 times a second; the numbers are averages over that quarter second */
    function drawDebug(now) {
      const n = Math.max(1, st.n), ms = st.acc / n, g = dbg.g, session = renderer.xr.getSession(), layer = session && session.renderState.baseLayer;
      g.clearRect(0, 0, 448, 224); g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(0, 0, 448, 224);
      g.font = '600 30px monospace'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = ms > 1000 / ((session && session.frameRate) || 90) * 1.08 ? '#ff7a6b' : '#8dffb0';
      g.fillText(ms.toFixed(1) + ' ms  max ' + st.accMax.toFixed(0) + '  ' + (ms > 0 ? 1000 / ms : 0).toFixed(0) + ' fps', 12, 38);
      g.fillStyle = '#ebe3cd';
      g.fillText('cpu ' + (st.accCpu / n).toFixed(1) + ' ms   ' + ((session && session.frameRate) || '?') + ' Hz', 12, 80);
      g.fillText('calls ' + st.calls + '  tris ' + (st.tris / 1000).toFixed(0) + 'k', 12, 122);
      g.fillText('speed ' + st.speed.toFixed(0) + ' m/s  turn ' + st.turn.toFixed(0) + ' d/s', 12, 164);
      g.fillText(debugLine(layer), 12, 206);
      dbg.tex.needsUpdate = true;
      st.acc = st.accMax = st.accCpu = st.n = 0; st.at = now;
    }
    const debugLine = layer => 'fov ' + (layer && layer.fixedFoveation != null ? (+layer.fixedFoveation).toFixed(2) : '-') + ' x' + (fbScale * vpScale).toFixed(2) + (vpOk ? '' : '!') + ' L' + (cf.adaptive ? adapt.level : '-');
    /* the speed and the turn rate of the view (the rig), smoothed over about 0.1 s */
    function measure() {
      if (st.dt && st.have) {
        const k = 1 - Math.exp(-st.dt * 8);
        st.speed += (rig.position.distanceTo(lastPos) / st.dt - st.speed) * k;
        st.turn += (Math.abs(wrap(rig.rotation.y - st.yaw)) / st.dt * 180 / Math.PI - st.turn) * k;
      }
      lastPos.copy(rig.position); st.yaw = rig.rotation.y; st.have = true;
    }
    function setComfort(key, value) {
      setOption(cf, key, value); saveComfort(storage, cf);
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
      st.now = 0; st.have = false; st.speed = st.turn = 0; st.at = -Infinity;
      hud.mesh.visible = true;
      const session = renderer.xr.getSession();
      try {                                                       // Quest: 90 Hz when the browser offers it
        const rates = session.supportedFrameRates;
        if (session.updateTargetFrameRate && rates && Array.prototype.indexOf.call(rates, 90) >= 0) session.updateTargetFrameRate(90).catch(() => {});
      } catch (_) { }
      Object.assign(adapt, adaptState()); vpScale = 1; vpBusy = false;
      applyComfort();
      if (o.onStart) o.onStart();
    });
    renderer.xr.addEventListener('sessionend', () => {
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      hud.mesh.visible = menuP.mesh.visible = dbg.mesh.visible = false; menu = null;
      if (root.VDragon && root.VDragon.compact) root.VDragon.compact(false);   // the flat screen draws the dragons as it always did
      bars([]);
      if (o.onEnd) o.onEnd();
    });

    async function enter() {
      if (busy || renderer.xr.isPresenting) return;
      busy = true;
      fbScale = cf.scale; renderer.xr.setFramebufferScaleFactor(fbScale);
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
      rig, eye: rig.position, bars, cf, setComfort,
      follow(pos, yaw, dt) {
        rig.position.copy(pos);
        if (snap || dt == null) { rig.rotation.y = yaw; snap = false; st.have = false; measure(); return; }
        const d = Math.atan2(Math.sin(yaw - rig.rotation.y), Math.cos(yaw - rig.rotation.y));
        rig.rotation.y += d * (1 - Math.exp(-dt * YAW_RATE));
        measure();
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
        if (cf.adaptive && adaptStep(adapt, d, 1000 / (renderer.xr.getSession().frameRate || 90), adaptLevels(cf))) applyQuality();
        const roots = [].concat(menuRoot || []).filter(Boolean);
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

  const api = { SLOW, FONT, mapPads, menuNav, wrapText, comfort, attach, hudBar, hudText, textOf };
  root.VXR = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
