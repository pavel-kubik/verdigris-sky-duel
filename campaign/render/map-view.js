/*
 * Verdigris campaign - map screen (Phase 3 T07, 003_task_missions.md 6 "Map screen"). A 2D canvas over the game, no THREE
 * scene (the terrain colours come from render/terrain.js colourFn).
 *   VRender.mapView.build(el, { t, stageName }) -> { open(cs, view?), close(), isOpen, redraw(), setView('region' | 'world'),
 *                                                    zoomBy(f), imageMs(regionId), info }
 *   el: the #map section with canvas#mapCanvas, #mapTitle, #mapTag, buttons #mapWorldBtn, #mapRegionBtn, #mapZoomIn,
 *       #mapZoomOut, #mapClose (game.js wires Close).
 * Region view: the terrain image (data.map.image px, from heights + the region palette, toned to parchment, hill shaded,
 *   water from the terrain), drawn once per region and cached; fog = dark parchment over unexplored cells (core/map.js
 *   bits); icons for the lair and discovered places (the compass icons); the region exits on the rim; the dragon arrow.
 *   Drag to pan, pinch (or the wheel, or + / -) to zoom within data.map.zoom; tap an icon for its name.
 * World view: the regions around the volcano at data.map.world; unknown regions are a fogged "?", locked ones show
 *   the stage they need, the alert level colours the rim, the dragon's region has a marker; tap a known region to
 *   open its region view.
 * Map axes: north (+Z) up, east (-X) right: screen x = -world x.
 */
(function (root) {
  'use strict';
  const C = root.VCamp, VR = root.VRender = root.VRender || {};
  if (!C) return;
  const D = C.need('data'), T = C.need('terrain'), MP = C.need('map'), RG = C.need('region');
  const TAU = Math.PI * 2;
  const PARCH = [0.80, 0.72, 0.55], INK = '#2b2116', FOG = 'rgba(38,30,20,0.94)';
  const ALERT = ['#62c48a', '#e0b040', '#e07a3a', '#e5484f'];

  const images = {}, imageMs = {};

  /** The region image: heights on an N x N grid, palette colour, toned toward parchment, hill shaded, water blue. */
  function regionImage(id) {
    if (images[id]) return images[id];
    const t0 = (root.performance || Date).now();
    const N = D.map.image, R = T.region(id), r = R.radius, step = (2 * r) / N;
    const VT = VR.terrain, pal = VT && VT.PALETTES[R.palette];
    const colour = VT && pal ? VT.colourFn(id, pal) : null;
    const hs = new Float32Array((N + 2) * (N + 2));
    const X = i => r - (i - 0.5) * step, Z = j => r - (j - 0.5) * step;    // index 1..N = pixel centres, 0 and N+1 = border
    for (let j = 0; j < N + 2; j++) for (let i = 0; i < N + 2; i++) hs[j * (N + 2) + i] = T.heightAt(id, X(i), Z(j));
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N), px = img.data;
    const water = pal && pal.water != null ? [((pal.water >> 16) & 255) / 255, ((pal.water >> 8) & 255) / 255, (pal.water & 255) / 255] : [0.25, 0.42, 0.5];
    for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
      const k = j * (N + 2) + i, x = X(i), z = Z(j), h = hs[k];
      const dx = (hs[k - 1] - hs[k + 1]) / (2 * step), dz = (hs[k - (N + 2)] - hs[k + (N + 2)]) / (2 * step);   // dx: west - east
      const slope = Math.hypot(dx, dz);
      let c = colour ? colour(x, z, h, slope, 1) : [0.5, 0.5, 0.4];
      const wet = T.liquidAt(id, x, z);
      if (wet === 'water') c = water;
      else if (wet === 'lava') c = [0.85, 0.32, 0.1];
      // light from the north-west (top left): dx = west - east, dz = north - south; ground falling toward the light is brighter
      const shade = wet ? 1 : Math.max(0.55, Math.min(1.35, 1 - (dx + dz) * 1.4));
      const o = ((j - 1) * N + (i - 1)) * 4;
      for (let q = 0; q < 3; q++) px[o + q] = Math.max(0, Math.min(255, (c[q] * 0.6 + PARCH[q] * 0.4) * shade * 255));
      px[o + 3] = Math.hypot(x, z) <= r ? 255 : 0;
    }
    g.putImageData(img, 0, 0);
    imageMs[id] = (root.performance || Date).now() - t0;
    return (images[id] = cv);
  }

  /** Fog: one pixel per map cell, opaque where unexplored (drawn scaled up with smoothing: soft edges). */
  function fogImage(cs, id, cache) {
    const gr = MP.grid(id), b = MP.bits(cs, id);
    let cv = cache.cv;
    if (!cv || cv.width !== gr.n) { cv = cache.cv = document.createElement('canvas'); cv.width = cv.height = gr.n; }
    const g = cv.getContext('2d'), img = g.createImageData(gr.n, gr.n), px = img.data;
    for (let j = 0; j < gr.n; j++) for (let i = 0; i < gr.n; i++) {
      const k = j * gr.n + i, on = (b[k >> 5] >>> (k & 31)) & 1;
      const o = ((gr.n - 1 - j) * gr.n + (gr.n - 1 - i)) * 4;          // cell (i, j) = world (x, z) grows west / north: flip both
      px[o] = 38; px[o + 1] = 30; px[o + 2] = 20; px[o + 3] = on ? 0 : 240;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  function build(el, opts) {
    const t = opts.t, stageName = opts.stageName || (s => String(s));
    const cv = el.querySelector('#mapCanvas'), g = cv.getContext('2d');
    const titleEl = el.querySelector('#mapTitle'), tagEl = el.querySelector('#mapTag');
    const icon = VR.compass && VR.compass.icon, COL = (VR.compass && VR.compass.COL) || {};
    let cs = null, view = 'region', regionId = null, model = null, open = false, W = 0, H = 0, dpr = 1;
    const cam = { zoom: 1, cx: 0, cz: 0 }, fogCache = {};
    let hits = [], tagT = 0;

    function size() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      W = cv.clientWidth || root.innerWidth; H = cv.clientHeight || root.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    const base = () => (Math.min(W, H - 120) * 0.94) / (2 * T.region(regionId).radius);
    const toScreen = (x, z) => { const s = base() * cam.zoom; return [W / 2 - (x - cam.cx) * s, (H + 40) / 2 - (z - cam.cz) * s]; };
    function clampCam() {
      const [z0, z1] = D.map.zoom, r = T.region(regionId).radius;
      cam.zoom = Math.max(z0, Math.min(z1, cam.zoom));
      const lim = r * (1 - 1 / cam.zoom);
      const l = Math.hypot(cam.cx, cam.cz);
      if (l > lim) { cam.cx *= lim / Math.max(1e-6, l); cam.cz *= lim / Math.max(1e-6, l); }
    }

    function drawRegion() {
      const R = T.region(regionId), r = R.radius, s = base() * cam.zoom;
      const [ox, oy] = toScreen(0, 0);
      g.save();
      g.beginPath(); g.arc(ox, oy, r * s, 0, TAU); g.clip();
      g.imageSmoothingEnabled = true;
      g.drawImage(regionImage(regionId), ox - r * s, oy - r * s, 2 * r * s, 2 * r * s);
      const gr = MP.grid(regionId), side = gr.n * gr.cell * s;
      g.drawImage(fogImage(cs, regionId, fogCache[regionId] || (fogCache[regionId] = {})), ox - (gr.n * gr.cell / 2) * s, oy - (gr.n * gr.cell / 2) * s, side, side);
      g.restore();
      g.strokeStyle = 'rgba(233,225,204,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(ox, oy, r * s, 0, TAU); g.stroke();
      hits = [];
      // exits on the rim: an arrow outward with the region name (greyed while locked)
      const rm = {}; for (const q of model.regions) rm[q.id] = q;
      for (const e of R.exits || []) {
        const a = RG.arcMid(e), q = rm[e.to], [sx, sy] = toScreen(Math.sin(a) * r, Math.cos(a) * r);
        const dx = sx - ox, dy = sy - oy, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        const locked = q && q.locked;
        g.save(); g.translate(sx, sy); g.rotate(Math.atan2(uy, ux));
        g.fillStyle = locked ? '#7d8278' : '#62c48a'; g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.closePath(); g.fill();
        g.restore();
        const name = t('c.region.' + e.to) + (locked ? ' - ' + t('c.map.needs', { stage: stageName(locked.stage) }) : '');
        label(name, sx - ux * 22, sy - uy * 22, locked ? '#a9ae9b' : '#ebe3cd');
        hits.push({ x: sx, y: sy, name });
      }
      // places: lair + discovered settlements / castles
      for (const p of model.places) {
        const [sx, sy] = toScreen(p.x, p.z);
        g.fillStyle = 'rgba(12,19,16,.7)'; g.beginPath(); g.arc(sx, sy, 15, 0, TAU); g.fill();
        g.strokeStyle = p.alert ? ALERT[Math.min(3, p.alert)] : 'rgba(233,225,204,.6)'; g.lineWidth = 1.5; g.stroke();
        const col = p.kind === 'lair' ? COL.lair : p.kind === 'castle' ? COL.castle : COL.settlement;
        if (icon) icon(g, p.kind, sx, sy, 9, col || '#fff', 1);
        hits.push({ x: sx, y: sy, name: t(p.key) });
      }
      // the dragon: an arrow along its heading (world direction (sin yaw, cos yaw) -> screen (-sin, -cos))
      if (model.dragon) {
        const [sx, sy] = toScreen(model.dragon.x, model.dragon.z), y = model.dragon.yaw;
        g.save(); g.translate(sx, sy); g.rotate(-y);                        // the arrow points up (north) at yaw 0; +X (west) is left
        g.fillStyle = '#ff9447'; g.strokeStyle = INK; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.stroke(); g.fill();
        g.restore();
        hits.push({ x: sx, y: sy, name: t('c.map.you') });
      }
      // compass rose: N up
      g.fillStyle = '#ebe3cd'; g.font = '700 13px sans-serif'; g.textAlign = 'center';
      g.fillText(t('c.nav.n'), W - 28, 92); g.beginPath(); g.moveTo(W - 28, 96); g.lineTo(W - 33, 110); g.lineTo(W - 23, 110); g.closePath(); g.fill();
    }

    function label(txt, x, y, col) {
      g.font = '600 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(txt).width + 10;
      const lx = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x)), ly = Math.max(70, Math.min(H - 14, y));
      g.fillStyle = 'rgba(12,19,16,.72)'; g.fillRect(lx - w / 2, ly - 9, w, 18);
      g.fillStyle = col; g.fillText(txt, lx, ly);
    }

    function drawWorld() {
      const ids = model.regions, S = Math.min(W / 3.4, (H - 120) / 5.6), cy = (H + 40) / 2;
      const pos = q => [W / 2 + q.col * S, cy - (q.row - 2.2) * S];
      const by = {}; for (const q of ids) by[q.id] = q;
      g.strokeStyle = 'rgba(233,225,204,.35)'; g.lineWidth = 3; g.setLineDash([6, 6]);
      const pairs = [];
      for (const id of Object.keys(D.regions)) for (const e of D.regions[id].exits || []) pairs.push([id, e.to]);
      for (const p of D.map.links) pairs.push(p);
      for (const [a, b] of pairs) {
        if (!by[a] || !by[b] || !by[a].known || !by[b].known) continue;
        const [x0, y0] = pos(by[a]), [x1, y1] = pos(by[b]);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      g.setLineDash([]);
      hits = [];
      const VT = VR.terrain;
      for (const q of ids) {
        const [x, y] = pos(q), rr = S * 0.4;
        if (!q.known) {                                                    // never show an undiscovered place: a fogged blob
          g.fillStyle = FOG; g.beginPath(); g.arc(x, y, rr * 0.8, 0, TAU); g.fill();
          g.fillStyle = '#7d7462'; g.font = '700 20px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', x, y);
          continue;
        }
        const R = q.playable ? T.region(q.id) : null, pal = R && VT ? VT.PALETTES[R.palette] : null;
        const c = pal ? pal.mid : 0x5a5a50;
        g.fillStyle = q.playable ? '#' + c.toString(16).padStart(6, '0') : 'rgba(90,86,74,.85)';
        g.beginPath(); for (let k = 0; k <= 12; k++) { const a = (k / 12) * TAU, w = rr * (0.88 + 0.12 * Math.sin(k * 2.7 + q.col * 3 + q.row)); k ? g.lineTo(x + Math.cos(a) * w, y + Math.sin(a) * w) : g.moveTo(x + Math.cos(a) * w, y + Math.sin(a) * w); } g.closePath(); g.fill();
        g.strokeStyle = q.alert ? ALERT[Math.min(3, q.alert)] : 'rgba(233,225,204,.5)'; g.lineWidth = q.alert ? 3 : 1.5; g.stroke();
        if (q.id === 'ash') { g.fillStyle = '#3a2a22'; g.beginPath(); g.moveTo(x - rr * 0.35, y + rr * 0.2); g.lineTo(x, y - rr * 0.35); g.lineTo(x + rr * 0.35, y + rr * 0.2); g.closePath(); g.fill(); g.fillStyle = '#e06a2a'; g.beginPath(); g.arc(x, y - rr * 0.3, rr * 0.08, 0, TAU); g.fill(); }
        if (q.here) { g.fillStyle = '#ff9447'; g.beginPath(); g.arc(x + rr * 0.55, y - rr * 0.55, 7, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke(); }
        let name = t(q.nameKey);
        label(name, x, y + rr * 0.62, '#ebe3cd');
        if (q.locked) { lock(x, y - 2); label(t('c.map.needs', { stage: stageName(q.locked.stage) }), x, y + rr * 0.62 + 20, '#e0b040'); name += ' - ' + t('c.map.needs', { stage: stageName(q.locked.stage) }); }
        hits.push({ x, y, r: Math.max(rr, D.map.tapPx / 2), name, region: q.playable && q.visited ? q.id : null });
      }
    }
    function lock(x, y) {
      g.strokeStyle = '#e0b040'; g.fillStyle = '#e0b040'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y - 6, 6, Math.PI, 0); g.stroke(); g.fillRect(x - 8, y - 6, 16, 12);
    }

    function draw() {
      if (!open) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#1d1810'; g.fillRect(0, 0, W, H);
      if (view === 'world') drawWorld(); else drawRegion();
      const help = el.querySelector('#mapHelp'); if (help) help.textContent = view === 'world' ? t('c.map.helpWorld') : (opts.help || '');
      titleEl.textContent = view === 'world' ? t('c.map.world') : t('c.region.' + regionId);
      el.querySelector('#mapWorldBtn').classList.toggle('on', view === 'world');
      el.querySelector('#mapRegionBtn').classList.toggle('on', view === 'region');
      el.querySelector('#mapZoomIn').hidden = el.querySelector('#mapZoomOut').hidden = view === 'world';
    }

    function refresh() { model = MP.model(cs, regionId); draw(); }

    function setView(v, id) {
      view = v;
      if (id && id !== regionId) { regionId = id; cam.zoom = 1; cam.cx = cam.cz = 0; }
      tagEl.hidden = true;
      refresh();
    }

    function show(txt, x, y) {
      tagEl.textContent = txt; tagEl.hidden = false;
      tagEl.style.left = Math.max(60, Math.min(W - 60, x)) + 'px'; tagEl.style.top = Math.max(70, y - 44) + 'px';
      tagT = 2.5;
    }

    function tap(x, y) {
      let best = null, bd = Infinity;
      for (const h of hits) {
        const d = Math.hypot(h.x - x, h.y - y), rr = h.r || D.map.tapPx / 2 + 4;
        if (d <= rr && d < bd) { best = h; bd = d; }
      }
      if (!best) { tagEl.hidden = true; return; }
      if (view === 'world' && best.region) { setView('region', best.region); return; }
      show(best.name, best.x, best.y);
    }

    // pointers: one = pan (region view), two = pinch zoom; a short still press = tap
    const ptrs = new Map();
    let pinch = null, downAt = null;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) downAt = { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0 };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom }; if (downAt) downAt.moved = 99; }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (downAt) downAt.moved += Math.hypot(dx, dy);
      if (view !== 'region') return;
      if (ptrs.size >= 2 && pinch) {
        const [a, b] = [...ptrs.values()];
        cam.zoom = pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d);
      } else if (ptrs.size === 1) {
        const s = base() * cam.zoom; cam.cx += dx / s; cam.cz += dy / s;            // drag right = view moves east (-X)
      }
      clampCam(); draw();
      e.preventDefault();
    });
    const up = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 0 && downAt) { if (downAt.moved < 10 && Date.now() - downAt.t < 600) tap(e.clientX, e.clientY); downAt = null; }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { if (view !== 'region') return; zoomBy(e.deltaY < 0 ? 1.25 : 0.8); e.preventDefault(); }, { passive: false });

    function zoomBy(f) { if (view !== 'region') return; cam.zoom *= f; clampCam(); draw(); }
    el.querySelector('#mapZoomIn').onclick = () => zoomBy(1.4);
    el.querySelector('#mapZoomOut').onclick = () => zoomBy(1 / 1.4);
    el.querySelector('#mapWorldBtn').onclick = () => setView('world');
    el.querySelector('#mapRegionBtn').onclick = () => setView('region', cs.region);

    function openMap(state, v) {
      cs = state; open = true; el.hidden = false;
      size();
      if (regionId !== cs.region) { regionId = cs.region; cam.zoom = 1; cam.cx = cam.cz = 0; }
      if (cs.inLair && D.regions[cs.region].lair) cam.cx = cam.cz = 0;
      setView(v || (D.regions[cs.region] ? 'region' : 'world'));
    }
    function close() { open = false; el.hidden = true; tagEl.hidden = true; ptrs.clear(); pinch = null; }
    function tick(dt) { if (open && tagT > 0 && (tagT -= dt) <= 0) tagEl.hidden = true; }
    root.addEventListener('resize', () => { if (open) { size(); draw(); } });

    return {
      open: openMap, close, tick, redraw: () => open && refresh(), setView, zoomBy, tap,
      get isOpen() { return open; }, get view() { return view; }, get region() { return regionId; }, get cam() { return cam; },
      get hits() { return hits.slice(); }, imageMs: id => imageMs[id], get info() { return { images: Object.keys(images), imageMs: Object.assign({}, imageMs) }; },
    };
  }

  VR.mapView = { build, regionImage };
})(typeof self !== 'undefined' ? self : this);
