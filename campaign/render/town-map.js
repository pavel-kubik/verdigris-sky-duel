/*
 * Verdigris - the map of Prahold for Tales of Prahold (campaign/hero/): opened by tapping the radar (or M / Tab).
 *   VRender.townMap.build(el, { t, region }) -> { open(scene), close(), isOpen, setView('all' | 'here'), zoomBy(f), redraw(), info }
 *   el: section with canvas#tmapCanvas, buttons #tmapAll, #tmapHere, #tmapIn, #tmapOut, #tmapClose (the page wires Close).
 *   scene (on open and redraw): { me: { x, z, yaw }, goal: [x, y, z] | null, npcs, guards, targets, items, follower }
 *     each list item: { x, z, kind?, need?, charmed?, yaw?, cone?, range? }
 * The whole region (the Veltava Bend): the ground from the terrain (heights, hill shading, the river) as one cached image,
 * and on top, as shapes that stay sharp at any zoom, the roads, the bridges, Prahold's streets, squares and every house
 * (core/city.js lots), the settlements' buildings, the names of the districts, villages and settlements, and what the
 * telling needs: the goal (gold), people to talk to, the stranger who follows, the gift's targets, things to pick up and
 * the guards with their sight. North (+Z) up, east (-X) right: screen x = -world x. Drag to pan, pinch / wheel / + - to
 * zoom; "Whole map" fits the region, "Here" centres on the hero.
 */
(function (root) {
  'use strict';
  const C = root.VCamp, VR = root.VRender = root.VRender || {};
  if (!C) return;
  const D = C.need('data'), T = C.need('terrain'), CI = C.need('city'), SE = C.need('settlement');
  const TAU = Math.PI * 2, STEP = 6, ZOOM = [1, 24];
  const PARCH = [0.80, 0.72, 0.55];
  const images = {};

  /** The ground of a region: heights every STEP units, the region's palette toned toward parchment, shaded, water blue. */
  function groundImage(id) {
    if (images[id]) return images[id];
    const R = T.region(id), r = R.radius, n = Math.round(2 * r / STEP);
    const VT = VR.terrain, pal = VT && VT.PALETTES[R.palette], col = VT && pal ? VT.colourFn(id, pal) : null;
    const wat = pal && pal.water != null ? [((pal.water >> 16) & 255) / 255, ((pal.water >> 8) & 255) / 255, (pal.water & 255) / 255] : [0.25, 0.42, 0.5];
    const X = i => r - (i + 0.5) * STEP, Z = j => r - (j + 0.5) * STEP, W2 = n + 2;   // i grows east (-X), j grows south (-Z)
    const hs = new Float32Array(W2 * W2);
    for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) hs[(j + 1) * W2 + i + 1] = T.heightAt(id, X(i), Z(j));
    const cv = document.createElement('canvas'); cv.width = cv.height = n;
    const g = cv.getContext('2d'), img = g.createImageData(n, n), px = img.data;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j + 1) * W2 + i + 1, x = X(i), z = Z(j), h = hs[k];
      const dx = (hs[k - 1] - hs[k + 1]) / (2 * STEP), dz = (hs[k - W2] - hs[k + W2]) / (2 * STEP);
      let c = col ? col(x, z, h, Math.hypot(dx, dz), 1) : [0.5, 0.5, 0.4];
      const wet = T.liquidAt(id, x, z);
      if (wet === 'water') c = wat; else if (wet === 'lava') c = [0.85, 0.32, 0.1];
      const shade = wet ? 1 : Math.max(0.6, Math.min(1.3, 1 - (dx + dz) * 1.4));
      const o = (j * n + i) * 4;
      for (let q = 0; q < 3; q++) px[o + q] = Math.max(0, Math.min(255, (c[q] * 0.55 + PARCH[q] * 0.45) * shade * 255));
      px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (images[id] = cv);
  }

  function build(el, opts) {
    const t = opts.t, id = opts.region;
    const cv = el.querySelector('#tmapCanvas'), g = cv.getContext('2d');
    const R = T.region(id), RAD = R.radius;
    let open = false, W = 0, H = 0, dpr = 1, sc = null, town = null, city = null, roads = null, buildMs = 0;
    const cam = { zoom: 1, cx: 0, cz: 0 };

    function size() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      W = cv.clientWidth || root.innerWidth; H = cv.clientHeight || root.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      top = bar ? bar.getBoundingClientRect().bottom + 8 : 64;
    }
    let top = 64;
    const bottom = 34, bar = el.querySelector('#tmapBar');
    const base = () => Math.min((W - 16) / (2 * RAD), (H - top - bottom - 8) / (2 * RAD));
    const cy = () => top + (H - top - bottom) / 2;
    const toScreen = (x, z) => { const s = base() * cam.zoom; return [W / 2 - (x - cam.cx) * s, cy() - (z - cam.cz) * s]; };
    function clampCam() {
      cam.zoom = Math.max(ZOOM[0], Math.min(ZOOM[1], cam.zoom));
      const s = base() * cam.zoom, hx = Math.max(0, RAD - W / 2 / s), hz = Math.max(0, RAD - (H - top - bottom) / 2 / s);
      cam.cx = Math.max(-hx, Math.min(hx, cam.cx)); cam.cz = Math.max(-hz, Math.min(hz, cam.cz));
    }

    /** What the map draws besides the ground, gathered once. */
    function gather() {
      if (roads) return;
      const t0 = (root.performance || Date).now();
      groundImage(id);
      town = SE.build(id); city = CI.build(id);
      roads = R.terrain.features.filter(f => f.type === 'road').map(f => ({ pts: f.points, w: f.width || 7 }));
      if (R.origin && T.worldRoads) for (const rd of T.worldRoads().list) {
        const pts = rd.pts.map(p => T.toLocal(id, p[0], p[1]));
        if (pts.some(p => Math.abs(p[0]) < RAD + 50 && Math.abs(p[1]) < RAD + 50)) roads.push({ pts, w: D.world.roads.width || 6 });
      }
      buildMs = (root.performance || Date).now() - t0;
    }

    function poly(pts, width, colour) {
      if (pts.length < 2) return;
      g.strokeStyle = colour; g.lineWidth = width; g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      pts.forEach((p, i) => { const [sx, sy] = toScreen(p[0], p[1]); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
      g.stroke();
    }
    /** A rectangle w (local X) by d (local Z) turned by yaw (front = +Z turned: (sin yaw, cos yaw)). */
    function box(x, z, yaw, w, d) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      g.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => {
        const a = u * w / 2, b = v * d / 2, [sx, sy] = toScreen(x + a * c + b * s, z - a * s + b * c);
        k ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
      });
      g.closePath();
    }
    const visible = (x, z, r) => { const [sx, sy] = toScreen(x, z), rr = r * base() * cam.zoom + 4; return sx > -rr && sx < W + rr && sy > -rr && sy < H + rr; };

    function draw() {
      if (!open) return;
      gather();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#1d1810'; g.fillRect(0, 0, W, H);
      const s = base() * cam.zoom, [x0, y0] = toScreen(RAD, RAD);
      g.save(); g.beginPath(); g.rect(x0, y0, 2 * RAD * s, 2 * RAD * s); g.clip();
      g.imageSmoothingEnabled = true;
      g.drawImage(groundImage(id), x0, y0, 2 * RAD * s, 2 * RAD * s);
      // roads, then the town's streets and squares, then the bridges, then the houses
      for (const rd of roads) poly(rd.pts, Math.max(1.4, rd.w * s) + 1.5, 'rgba(60,45,25,.55)');
      for (const rd of roads) poly(rd.pts, Math.max(1.4, rd.w * s), '#c9ad7a');
      if (city) {
        g.fillStyle = '#d8c7a2';
        for (const sq of city.squares) {
          if (!visible(sq.x, sq.z, sq.r || sq.len || 40)) continue;
          g.fillStyle = sq.green ? '#9fb07a' : '#d8c7a2';
          if (sq.kind === 'circle') { const [sx, sy] = toScreen(sq.x, sq.z); g.beginPath(); g.arc(sx, sy, sq.r * s, 0, TAU); g.fill(); }
          else { box(sq.x, sq.z, sq.yaw, sq.wid, sq.len); g.fill(); }
        }
        if (s > 0.25) for (const st of city.streets) poly(st.pts, Math.max(1, st.w * s), st.bridge ? '#e3cf9f' : '#d8c7a2');
      }
      for (const f of R.terrain.features) if (f.type === 'bridge') {
        box(f.x, f.z, f.yaw, f.width, f.len);
        g.fillStyle = f.kind === 'wood' ? '#8a6a44' : '#b8ab92'; g.fill();
        g.strokeStyle = 'rgba(30,22,12,.85)'; g.lineWidth = Math.max(1, 0.8 * s); g.stroke();
      }
      if (city) {
        const lotCol = { church: '#7d5a4a', cathedral: '#6c4c40', domechurch: '#6c5a40', townhall: '#7a4e3c', tower: '#5d4a3c', gatetower: '#5d4a3c', palace: '#806a58' };
        if (s > 0.3) {
          for (const l of city.lots) {
            if (!visible(l.x, l.z, 30)) continue;
            box(l.x, l.z, l.yaw, l.w, l.d);
            g.fillStyle = lotCol[l.kind] || (l.style === 'barn' || l.style === 'farm' || l.style === 'log' || l.style === 'cottage' ? '#8c6c4c' : '#a0574a');
            g.fill();
          }
        } else {
          for (const d of city.districts.concat(city.villages)) {
            const [sx, sy] = toScreen(d.x, d.z);
            g.fillStyle = 'rgba(150,72,52,.55)'; g.beginPath(); g.arc(sx, sy, Math.max(3, d.r * s * 0.9), 0, TAU); g.fill();
          }
        }
      }
      for (const b of (town && town.buildings) || []) {
        if (!b.pos || !visible(b.pos[0], b.pos[2], 20)) continue;
        const [sx, sy] = toScreen(b.pos[0], b.pos[2]);
        g.fillStyle = b.hp != null && b.hp <= 0 ? '#3b302a' : '#7c6d5c';
        g.beginPath(); g.arc(sx, sy, Math.max(1.2, (b.r || 4) * s), 0, TAU); g.fill();
      }
      g.restore();
      names(s);
      marks(s);
      // compass: N up
      g.fillStyle = '#ebe3cd'; g.font = '700 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillText(t('c.nav.n'), W - 26, top + 22); g.beginPath(); g.moveTo(W - 26, top + 26); g.lineTo(W - 31, top + 40); g.lineTo(W - 21, top + 40); g.closePath(); g.fill();
    }

    function label(txt, x, y, big, col) {
      g.font = (big ? '700 14px' : '600 11px') + ' sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,14,8,.85)'; g.strokeText(txt, x, y);
      g.fillStyle = col || (big ? '#ffe9c8' : '#f3ead4'); g.fillText(txt, x, y);
    }
    function names(s) {
      if (!city) return;
      if (s < 0.5) {                                           // far out: Prahold over the middle of its districts
        const ds = city.districts;
        if (ds.length) { const mx = ds.reduce((a, d) => a + d.x, 0) / ds.length, mz = ds.reduce((a, d) => a + d.z, 0) / ds.length; label(t('c.placeName.prahold'), ...toScreen(mx, mz), true); }
      } else for (const d of city.districts) if (visible(d.x, d.z, d.r)) label(t(d.nameKey), ...toScreen(d.x, d.z), s > 1.2);
      for (const v of city.villages) if (visible(v.x, v.z, v.r)) { const [sx, sy] = toScreen(v.x, v.z); label(t(v.nameKey), sx, sy + Math.max(10, v.r * s * 0.6)); }
      for (const p of (town && town.places) || []) {
        if (!p.name || !visible(p.x, p.z, 60)) continue;
        const [sx, sy] = toScreen(p.x, p.z);
        label(t('c.placeName.' + p.name), sx, sy - Math.max(12, (p.r || 40) * s * 0.7), false, '#e9d6a6');
      }
    }
    function dot(x, z, col, r, rim) {
      let [sx, sy] = toScreen(x, z);
      const out = sx < 10 || sx > W - 10 || sy < top + 10 || sy > H - bottom - 6;
      if (out && !rim) return;
      if (out) { sx = Math.max(10, Math.min(W - 10, sx)); sy = Math.max(top + 10, Math.min(H - bottom - 6, sy)); }
      g.fillStyle = col; g.beginPath(); g.arc(sx, sy, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1.2; g.stroke();
    }
    function marks(s) {
      if (!sc) return;
      for (const q of sc.guards || []) {                         // sight wedges under the dots
        const [sx, sy] = toScreen(q.x, q.z), rr = (q.range || 0) * s, a = Math.atan2(-Math.cos(q.yaw || 0), -Math.sin(q.yaw || 0));
        if (rr < 2) continue;
        g.fillStyle = q.charmed ? 'rgba(106,160,255,.25)' : 'rgba(229,72,79,.3)';
        g.beginPath(); g.moveTo(sx, sy); g.arc(sx, sy, rr, a - (q.cone || 0.6), a + (q.cone || 0.6)); g.closePath(); g.fill();
      }
      for (const it of sc.items || []) dot(it.x, it.z, '#ffd34d', 4);
      for (const q of sc.targets || []) dot(q.x, q.z, q.kind === 'thug' ? '#ff7a4a' : '#ff9447', 4.5);
      for (const n of sc.npcs || []) dot(n.x, n.z, n.follower ? '#62c48a' : n.need ? '#f3ead4' : 'rgba(200,192,170,.7)', n.need || n.follower ? 4.5 : 3, n.follower);
      for (const q of sc.guards || []) dot(q.x, q.z, q.charmed ? '#6aa0ff' : '#e5484f', 4);
      if (sc.goal) {
        let [sx, sy] = toScreen(sc.goal[0], sc.goal[2]);
        sx = Math.max(12, Math.min(W - 12, sx)); sy = Math.max(top + 12, Math.min(H - bottom - 8, sy));
        const r = 8 + Math.sin(Date.now() / 220);
        g.fillStyle = '#ffd34d'; g.strokeStyle = '#2a2010'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(sx, sy - r); g.lineTo(sx + r, sy); g.lineTo(sx, sy + r); g.lineTo(sx - r, sy); g.closePath(); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(255,211,77,.6)'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r + 7 + 3 * Math.sin(Date.now() / 250), 0, TAU); g.stroke();
      }
      if (sc.me) {                                              // the hero: an arrow along the heading (+X west is left)
        const [sx, sy] = toScreen(sc.me.x, sc.me.z);
        g.save(); g.translate(sx, sy); g.rotate(-(sc.me.yaw || 0));
        g.fillStyle = '#ebe3cd'; g.strokeStyle = '#1a140c'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 9); g.lineTo(0, 4); g.lineTo(-9, 9); g.closePath(); g.stroke(); g.fill();
        g.restore();
      }
    }

    function setView(v) {
      if (v === 'here' && sc && sc.me) { cam.zoom = 2 * RAD / 320; cam.cx = sc.me.x; cam.cz = sc.me.z; }
      else { cam.zoom = 1; cam.cx = 0; cam.cz = 0; }
      clampCam(); draw();
      el.querySelector('#tmapAll').classList.toggle('on', v !== 'here');
      el.querySelector('#tmapHere').classList.toggle('on', v === 'here');
    }
    function zoomBy(f, ax, ay) {
      const z0 = cam.zoom;
      cam.zoom = Math.max(ZOOM[0], Math.min(ZOOM[1], cam.zoom * f));
      if (ax != null) {                                          // keep the point under the pointer still
        const s0 = base() * z0, s1 = base() * cam.zoom;
        const wx = cam.cx - (ax - W / 2) / s0, wz = cam.cz - (ay - cy()) / s0;
        cam.cx = wx + (ax - W / 2) / s1; cam.cz = wz + (ay - cy()) / s1;
      }
      clampCam(); draw();
    }

    // pointers: one = pan, two = pinch zoom
    const ptrs = new Map();
    let pinch = null;
    cv.addEventListener('pointerdown', e => {
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* already released */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom }; }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2 && pinch) { const [a, b] = [...ptrs.values()]; cam.zoom = pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d); }
      else if (ptrs.size === 1) { const s = base() * cam.zoom; cam.cx += dx / s; cam.cz += dy / s; }
      clampCam(); draw(); e.preventDefault();
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); e.preventDefault(); }, { passive: false });
    el.querySelector('#tmapIn').onclick = () => zoomBy(1.5);
    el.querySelector('#tmapOut').onclick = () => zoomBy(1 / 1.5);
    el.querySelector('#tmapAll').onclick = () => setView('all');
    el.querySelector('#tmapHere').onclick = () => setView('here');
    root.addEventListener('resize', () => { if (open) { size(); clampCam(); draw(); } });

    let raf = 0;
    const pulse = () => { raf = 0; if (!open) return; draw(); raf = root.requestAnimationFrame(pulse); };   // the goal pulses
    return {
      open(scene, view) { sc = scene; open = true; el.hidden = false; size(); setView(view || 'all'); if (!raf) raf = root.requestAnimationFrame(pulse); },
      close() { open = false; el.hidden = true; ptrs.clear(); pinch = null; },
      redraw(scene) { if (scene) sc = scene; draw(); },
      setView, zoomBy,
      get isOpen() { return open; }, get cam() { return cam; }, get info() { return { buildMs, image: !!images[id] }; },
    };
  }

  VR.townMap = { build, groundImage };
})(typeof self !== 'undefined' ? self : this);
