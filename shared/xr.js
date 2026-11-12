/*
 * Verdigris - immersive VR (WebXR) support, written for Meta Quest and Three.js r128. Shared by every mode: the solo duel and
 * the tutorial, the co-op, the deathmatch and the campaign. Runs in the browser (window.VXR); the pure parts (mapPads, menuNav,
 * wrapText) also run in Node for tests.
 *   VXR.SLOW                         time scale of the single-player modes in VR (the headset needs more time to read and aim)
 *   VXR.mapPads(left, right, prev) -> { sx, sy, breath, boost, ball, pause, roll, x, y, grip, gripL, nav, ok, prev }
 *     pure; left / right are Gamepads or null; pass the returned prev back in on the next frame
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
 */
(function (root) {
  'use strict';
  const DEAD = 0.15, FLICK_ON = 0.7, FLICK_OFF = 0.3, YAW_RATE = 6, SLOW = 0.5;
  // xr-standard layout (WebXR Gamepads Module)
  const TRIGGER = 0, GRIP = 1, FACE_LOW = 4, FACE_HIGH = 5, STICK_X = 2, STICK_Y = 3;
  const FONT = '"Barlow Semi Condensed",sans-serif';

  const axis = (gp, i) => (gp && gp.axes && +gp.axes[i]) || 0;
  const held = (gp, i) => { const b = gp && gp.buttons && gp.buttons[i]; return !!b && (!!b.pressed || b.value > 0.5); };

  /**
   * Left stick steers (up = positive sy), right trigger breathes, left trigger boosts, A is the fireball, B pauses and a flick of
   * the right stick rolls. X and Y (left controller) and the grips are for the mode to use. nav is a flick of either stick up
   * (-1) or down (+1) and ok a press of the right trigger: the VR menu uses them. ball, pause, roll, x, y, nav and ok are
   * one-frame edges.
   */
  function mapPads(left, right, prev) {
    const p = prev || { a: false, b: false, x: false, y: false, t: false, flick: 0, navF: 0 };
    let sx = axis(left, STICK_X), sy = -axis(left, STICK_Y);
    const m = Math.hypot(sx, sy);
    if (m < DEAD) sx = sy = 0;
    else { const k = (Math.min(1, m) - DEAD) / (1 - DEAD) / m; sx *= k; sy *= k; }
    const a = held(right, FACE_LOW), b = held(right, FACE_HIGH), x = held(left, FACE_LOW), y = held(left, FACE_HIGH), rx = axis(right, STICK_X);
    const breath = held(right, TRIGGER);
    let flick = p.flick, roll = 0;
    if (!flick && Math.abs(rx) > FLICK_ON) roll = flick = rx > 0 ? 1 : -1;
    else if (flick && Math.abs(rx) < FLICK_OFF) flick = 0;
    const ly = axis(left, STICK_Y), ry = axis(right, STICK_Y), ny = Math.abs(ly) > Math.abs(ry) ? ly : ry;
    let navF = p.navF || 0, nav = 0;
    if (!navF && Math.abs(ny) > FLICK_ON) nav = navF = ny > 0 ? 1 : -1;
    else if (navF && Math.abs(ny) < FLICK_OFF) navF = 0;
    return { sx, sy, breath, boost: held(left, TRIGGER), ball: a && !p.a, pause: b && !p.b, roll,
             x: x && !p.x, y: y && !p.y, grip: held(right, GRIP), gripL: held(left, GRIP), nav, ok: breath && !p.t,
             prev: { a, b, x, y, t: breath, flick, navF } };
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

    /* panels: canvases on planes fixed to the rig (they turn with the dragon, not with the head) */
    function panel(cw, ch, w, h, x, y, z, tilt, order) {
      const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
      const tex = new THREE.CanvasTexture(canvas);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      mesh.renderOrder = order; mesh.frustumCulled = false; mesh.visible = false; mesh.position.set(x, y, z); mesh.rotation.x = tilt;
      rig.add(mesh);
      return { canvas, g: canvas.getContext('2d'), tex, mesh };
    }
    const hud = panel(640, 320, 1.2, 0.6, 0, -1.15, -2, -0.52, 999);   // about 30 deg below the eye line (the dragon is at 18), tilted to the player
    const menuP = panel(1024, 768, 2, 1.5, 0, 0.12, -2.4, 0, 1001);
    let hudAt = -Infinity;
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
      hud.mesh.visible = true;
      const layer = renderer.xr.getSession().renderState.baseLayer;
      if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = 1;   // r128 has no setFoveation; the outer view costs less
      if (o.onStart) o.onStart();
    });
    renderer.xr.addEventListener('sessionend', () => {
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      hud.mesh.visible = menuP.mesh.visible = false; menu = null;
      bars([]);
      if (o.onEnd) o.onEnd();
    });

    async function enter() {
      if (busy || renderer.xr.isPresenting) return;
      busy = true;
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
      rig, eye: rig.position, bars,
      follow(pos, yaw, dt) {
        rig.position.copy(pos);
        if (snap || dt == null) { rig.rotation.y = yaw; snap = false; return; }
        const d = Math.atan2(Math.sin(yaw - rig.rotation.y), Math.cos(yaw - rig.rotation.y));
        rig.rotation.y += d * (1 - Math.exp(-dt * YAW_RATE));
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
      drawHud(now, fn) {
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

  const api = { SLOW, FONT, mapPads, menuNav, wrapText, attach, hudBar, hudText, textOf };
  root.VXR = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
