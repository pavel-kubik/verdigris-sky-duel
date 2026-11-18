/*
 * Verdigris campaign - map screen (Phase 3 T07, 003_task_missions.md 6 "Map screen"). A 2D canvas over the game, no THREE
 * scene (the terrain colours come from render/terrain.js colourFn).
 *   VRender.mapView.build(el, { t, stageName }) -> { open(cs, view?), close(), isOpen, redraw(), setView('region' | 'world', id?),
 *                                                    zoomBy(f), imageMs(), info, setPad(px) }
 *   setPad(px): keep px free at the bottom (T09: the travel strip of the map stone); 0 = the whole screen
 *   el: the #map section with canvas#mapCanvas, #mapTitle, #mapTag, buttons #mapWorldBtn, #mapRegionBtn, #mapZoomIn,
 *       #mapZoomOut, #mapClose (game.js wires Close).
 * One map of the one world (core/terrain.js zones): Mount Rip in the north, the Wildwood, the River Farmlands and the
 * Veltava Bend with Prahold in the south, drawn from the real terrain (worldImage: heights + each region's palette,
 * toned to parchment, hill shaded, water from the terrain, cached), with the Vltava, the roads (core/roads.js and the
 * Bend's own) and the crop fields drawn on top as lines and shapes, so they stay sharp when zoomed in. Fog = dark
 * parchment over the cells the dragon has not explored (core/map.js bits, one grid per region); villages, Prahold and
 * the discovered places (the compass icons: lair, settlements, castle, aeries) are named once explored, the regions
 * carry their names and, while the dragon is too small for them, the stage they need. The mission target rings gold,
 * the dragon is an arrow. Drag to pan, pinch (or the wheel, or + / -) to zoom within data.map.zoom; tap an icon for its
 * name. "World" fits the whole map, "Region" centres on the dragon's region.
 * Map axes: north (+Z) up, east (-X) right: screen x = -world x.
 */
(function (root) {
  'use strict';
  const C = root.VCamp, VR = root.VRender = root.VRender || {};
  if (!C) return;
  const D = C.need('data'), T = C.need('terrain'), MP = C.need('map');
  const TAU = Math.PI * 2;
  const PARCH = [0.80, 0.72, 0.55], INK = '#2b2116';
  const ALERT = ['#62c48a', '#e0b040', '#e07a3a', '#e5484f'];
  const CROP = ['#c2a64e', '#86a845', '#7a6040', '#ad9d55', '#6f7a3a'];
  const STEP = 20;                                          // world units per image pixel

  let image = null, imageTime = 0;

  /** terrain.liquidAt with the height already known (no surfaceAt: fewer height samples per pixel). */
  function wetAt(id, R, x, z, h) {
    for (const f of R.terrain.features) if (f.type === 'cone' && f.crater && Math.hypot(x - f.x, z - f.z) < f.crater.r && h < T.lavaLevel(id)) return 'lava';
    const rv = T.riverAt(id, x, z);
    if (rv && (!rv.world || h < rv.level + 0.5)) return 'water';
    return null;
  }

  /** The world image: heights every STEP units over the world rectangle, the palette of the region each pixel lies in,
      toned toward parchment, hill shaded, water blue. One canvas pixel per STEP units, drawn scaled. */
  function worldImage() {
    if (image) return image;
    const t0 = (root.performance || Date).now();
    const r = T.worldRect(), nx = Math.round((r.x1 - r.x0) / STEP), nz = Math.round((r.z1 - r.z0) / STEP);
    const VT = VR.terrain, cols = {}, wat = {};
    for (const id of T.zones()) {
      const pal = VT && VT.PALETTES[T.region(id).palette];
      cols[id] = VT && pal ? VT.colourFn(id, pal) : null;
      wat[id] = pal && pal.water != null ? [((pal.water >> 16) & 255) / 255, ((pal.water >> 8) & 255) / 255, (pal.water & 255) / 255] : [0.25, 0.42, 0.5];
    }
    // pixel (i, j): i grows east (-X), j grows south (-Z); a one pixel border for the shading
    const X = i => r.x1 - (i + 0.5) * STEP, Z = j => r.z1 - (j + 0.5) * STEP, W2 = nx + 2;
    const hs = new Float32Array(W2 * (nz + 2)), zid = new Array(W2 * (nz + 2));
    for (let j = -1; j <= nz; j++) for (let i = -1; i <= nx; i++) {
      const x = X(i), z = Z(j), id = T.zoneAt(x, z) || T.zoneAt(Math.max(r.x0, Math.min(r.x1 - 1, x)), Math.max(r.z0, Math.min(r.z1 - 1, z)));
      const k = (j + 1) * W2 + i + 1, [lx, lz] = T.toLocal(id, x, z);
      hs[k] = T.heightAt(id, lx, lz); zid[k] = id;
    }
    const cv = document.createElement('canvas'); cv.width = nx; cv.height = nz;
    const g = cv.getContext('2d'), img = g.createImageData(nx, nz), px = img.data;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = (j + 1) * W2 + i + 1, id = zid[k], R = T.region(id), [x, z] = T.toLocal(id, X(i), Z(j)), h = hs[k];
      const dx = (hs[k - 1] - hs[k + 1]) / (2 * STEP), dz = (hs[k - W2] - hs[k + W2]) / (2 * STEP);   // dx: west - east, dz: north - south
      let c = cols[id] ? cols[id](x, z, h, Math.hypot(dx, dz), 1) : [0.5, 0.5, 0.4];
      const wet = wetAt(id, R, x, z, h);
      if (wet === 'water') c = wat[id];
      else if (wet === 'lava') c = [0.85, 0.32, 0.1];
      const shade = wet ? 1 : Math.max(0.55, Math.min(1.35, 1 - (dx + dz) * 1.4));   // light from the north-west (top left)
      const o = (j * nx + i) * 4;
      for (let q = 0; q < 3; q++) px[o + q] = Math.max(0, Math.min(255, (c[q] * 0.6 + PARCH[q] * 0.4) * shade * 255));
      px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    imageTime = (root.performance || Date).now() - t0;
    return (image = cv);
  }

  /** Fog of one region: one pixel per map cell, opaque where unexplored (drawn scaled up with smoothing: soft edges). */
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
    let cs = null, view = 'region', regionId = null, models = {}, open = false, W = 0, H = 0, dpr = 1;
    const cam = { zoom: 1, cx: 0, cz: 0 }, fogCache = {};
    let hits = [], tagT = 0, padB = 0;                                  // padB: px kept free at the bottom (T09 travel strip)

    function size() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      W = cv.clientWidth || root.innerWidth; H = cv.clientHeight || root.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    const rect = () => T.worldRect();
    /** px per world unit at zoom 1: the whole world fits the screen */
    const base = () => { const r = rect(); return Math.min((W - 16) / (r.x1 - r.x0), (H - 120 - padB) / (r.z1 - r.z0)); };
    const cy = () => (H + 40 - padB) / 2;
    const toScreen = (X, Z) => { const s = base() * cam.zoom; return [W / 2 - (X - cam.cx) * s, cy() - (Z - cam.cz) * s]; };
    function clampCam() {
      const [z0, z1] = D.map.zoom, r = rect(), s = base() * cam.zoom;
      cam.zoom = Math.max(z0, Math.min(z1, cam.zoom));
      const hx = Math.max(0, (r.x1 - r.x0) / 2 - W / 2 / s), hz = Math.max(0, (r.z1 - r.z0) / 2 - (H - 120 - padB) / 2 / s);
      const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
      cam.cx = Math.max(mx - hx, Math.min(mx + hx, cam.cx)); cam.cz = Math.max(mz - hz, Math.min(mz + hz, cam.cz));
    }
    const wpt = (id, x, z) => T.toWorld(id, x, z);

    function line(pts, width, colour) {
      if (pts.length < 2) return;
      g.strokeStyle = colour; g.lineWidth = width; g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      pts.forEach((p, i) => { const [sx, sy] = toScreen(p[0], p[1]); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
      g.stroke();
    }

    function drawMap() {
      const r = rect(), s = base() * cam.zoom, [x0, y0] = toScreen(r.x1, r.z1);
      g.imageSmoothingEnabled = true;
      g.save(); g.beginPath(); g.rect(x0, y0, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); g.clip();   // lines end at the world's edge
      g.drawImage(worldImage(), x0, y0, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
      // the crop fields, the river and the roads, sharp at any zoom
      if (s * 40 > 3) {
        for (const id of T.zones()) for (const f of T.fields(id)) {
          const sn = Math.sin(f.yaw), cn = Math.cos(f.yaw);
          g.fillStyle = CROP[f.crop % CROP.length]; g.globalAlpha = 0.8; g.beginPath();
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => {
            const a = u * f.w / 2, b = v * f.l / 2, [X, Z] = wpt(id, f.x + a * cn + b * sn, f.z - a * sn + b * cn), [sx, sy] = toScreen(X, Z);
            k ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
          });
          g.closePath(); g.fill(); g.globalAlpha = 1;
        }
      }
      const rv = T.worldRiver();
      if (rv) line(rv.pts, Math.max(2.5, rv.width * s), '#4b7d9c');
      const bend = T.zones().find(id => T.region(id).terrain.water === 'mask');
      if (bend) { const gr = T.demGrid(bend); if (gr.line.length) line(gr.line.map(p => wpt(bend, p[0], p[1])), Math.max(2.5, 36 * s), '#4b7d9c'); }
      const roadW = Math.max(1.3, D.world.roads.width * s);
      for (const rd of T.worldRoads().list) line(rd.pts, roadW + 1.5, 'rgba(60,45,25,.55)');
      for (const id of T.zones()) for (const f of T.region(id).terrain.features) if (f.type === 'road') line(f.points.map(p => wpt(id, p[0], p[1])), roadW + 1.5, 'rgba(60,45,25,.55)');
      for (const rd of T.worldRoads().list) line(rd.pts, roadW, '#c9ad7a');
      for (const id of T.zones()) for (const f of T.region(id).terrain.features) if (f.type === 'road') line(f.points.map(p => wpt(id, p[0], p[1])), roadW, '#c9ad7a');
      // villages and Prahold's districts: roofs-coloured spots
      for (const id of T.zones()) {
        const Cc = T.region(id).city;
        if (!Cc) continue;
        for (const v of (Cc.districts || []).concat(Cc.villages || [])) {
          const [sx, sy] = toScreen(...wpt(id, v.x, v.z));
          g.fillStyle = 'rgba(150,72,52,.55)'; g.beginPath(); g.arc(sx, sy, Math.max(3, v.r * s * 0.9), 0, TAU); g.fill();
        }
      }
      // fog over the unexplored cells of each region
      for (const id of T.zones()) {
        const gr = MP.grid(id), side = gr.n * gr.cell * s, [cx0, cy0] = toScreen(...wpt(id, gr.n * gr.cell / 2, gr.n * gr.cell / 2));
        g.drawImage(fogImage(cs, id, fogCache[id] || (fogCache[id] = {})), cx0, cy0, side, side);
      }
      g.restore();
      // region names and seams; a region the dragon is too small for says what it needs
      hits = [];
      const rm = {};
      for (const q of (models[regionId] || models[T.zones()[0]]).regions) rm[q.id] = q;
      g.setLineDash([6, 6]); g.strokeStyle = 'rgba(233,225,204,.35)'; g.lineWidth = 1.5;
      for (const id of T.zones()) {
        const R = T.region(id), [ax, ay] = toScreen(R.origin[0] + R.radius, R.origin[1] + R.radius), [bx, by] = toScreen(R.origin[0] - R.radius, R.origin[1] - R.radius);
        g.strokeRect(ax, ay, bx - ax, by - ay);
      }
      g.setLineDash([]);
      for (const id of T.zones()) {
        const R = T.region(id), q = rm[id] || {}, [sx, sy] = toScreen(R.origin[0], R.origin[1] + R.radius * 0.82);
        if (sy < 64 || sy > H - 70) continue;                            // off screen: no label pinned to the edge
        let name = t(R.nameKey);
        if (q.locked) name += ' - ' + (q.locked.later ? t('c.map.later') : t('c.map.needs', { stage: stageName(q.locked.stage) }));
        label(name, sx, sy, q.locked ? '#e0b040' : q.here ? '#ffd9b3' : '#ebe3cd', q.alert ? ALERT[Math.min(3, q.alert)] : null);
        if (q.mission) { g.strokeStyle = '#ffd34d'; g.lineWidth = 2; g.setLineDash([5, 4]); const [ax, ay] = toScreen(R.origin[0] + R.radius - 20, R.origin[1] + R.radius - 20), [bx, by] = toScreen(R.origin[0] - R.radius + 20, R.origin[1] - R.radius + 20); g.strokeRect(ax, ay, bx - ax, by - ay); g.setLineDash([]); }
      }
      // explored villages and Prahold: their names once zoomed in
      if (s * 400 > 60) for (const id of T.zones()) {
        const Cc = T.region(id).city;
        if (!Cc) continue;
        const ds = Cc.districts || [], mid = k => ds.reduce((a, d) => a + d[k], 0) / ds.length;   // Prahold: named over the middle of its districts
        const named = (ds.length ? [{ x: mid('x'), z: mid('z'), nameKey: 'c.placeName.prahold', big: true }] : []).concat(Cc.villages || []);
        for (const v of named) {
          if (!MP.explored(cs, id, v.x, v.z)) continue;
          const [sx, sy] = toScreen(...wpt(id, v.x, v.z));
          if (sx < -40 || sx > W + 40 || sy < 40 || sy > H) continue;
          small(t(v.nameKey), sx, sy + (v.big ? 0 : Math.max(8, (v.r || 30) * s) + 8), v.big);
          hits.push({ x: sx, y: sy, name: t(v.nameKey) });
        }
      }
      // places: lair + discovered settlements / castles / aeries (T08) of every region
      for (const id of T.zones()) for (const p of (models[id] ? models[id].places : [])) {
        const [sx, sy] = toScreen(...wpt(id, p.x, p.z));
        g.fillStyle = 'rgba(12,19,16,.7)'; g.beginPath(); g.arc(sx, sy, 13, 0, TAU); g.fill();
        g.strokeStyle = p.freed ? '#62c48a' : p.alert ? ALERT[Math.min(3, p.alert)] : 'rgba(233,225,204,.6)'; g.lineWidth = p.freed ? 3 : 1.5; g.stroke();   // Phase 3 T16: a freed village has a green rim
        if (p.freed) small(t('c.map.freed'), sx, sy + 22, false, '#62c48a');
        const col = p.kind === 'lair' ? COL.lair : p.kind === 'castle' ? COL.castle : p.kind === 'aerie' ? COL.aerie : COL.settlement;
        if (icon) icon(g, p.kind, sx, sy, 8, col || '#fff', 1);
        hits.push({ x: sx, y: sy, name: t(p.key) });
      }
      // T11: the mission target - a pulsing gold ring
      for (const id of T.zones()) {
        const tg = models[id] && models[id].target;
        if (!tg) continue;
        const [sx, sy] = toScreen(...wpt(id, tg.x, tg.z)), pr = 18 + 3 * Math.sin(Date.now() / 250);
        g.strokeStyle = '#ffd34d'; g.lineWidth = 3; g.beginPath(); g.arc(sx, sy, pr, 0, TAU); g.stroke();
        g.lineWidth = 1.5; g.beginPath(); g.arc(sx, sy, pr + 6, 0, TAU); g.stroke();
        const name = t('c.map.target', { m: t('c.mission.' + tg.id) });
        label(name, sx, sy + pr + 16, '#ffd34d');
        hits.push({ x: sx, y: sy, name });
      }
      // the dragon: an arrow along its heading (world direction (sin yaw, cos yaw) -> screen (-sin, -cos))
      const me = models[cs.region] && models[cs.region].dragon;
      if (me) {
        const [sx, sy] = toScreen(...wpt(cs.region, me.x, me.z));
        g.save(); g.translate(sx, sy); g.rotate(-me.yaw);                  // the arrow points up (north) at yaw 0; +X (west) is left
        g.fillStyle = '#ff9447'; g.strokeStyle = INK; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.stroke(); g.fill();
        g.restore();
        hits.push({ x: sx, y: sy, name: t('c.map.you') });
      }
      // compass rose: N up
      g.fillStyle = '#ebe3cd'; g.font = '700 13px sans-serif'; g.textAlign = 'center';
      g.fillText(t('c.nav.n'), W - 28, 92); g.beginPath(); g.moveTo(W - 28, 96); g.lineTo(W - 33, 110); g.lineTo(W - 23, 110); g.closePath(); g.fill();
    }

    function label(txt, x, y, col, rim) {
      g.font = '600 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(txt).width + 10;
      const lx = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x)), ly = Math.max(70, Math.min(H - 76, y));   // clear of the bar and the help line
      g.fillStyle = 'rgba(12,19,16,.72)'; g.fillRect(lx - w / 2, ly - 9, w, 18);
      if (rim) { g.strokeStyle = rim; g.lineWidth = 2; g.strokeRect(lx - w / 2, ly - 9, w, 18); }
      g.fillStyle = col; g.fillText(txt, lx, ly);
    }
    function small(txt, x, y, big, col) {
      g.font = (big ? '700 13px' : '600 10px') + ' sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,14,8,.85)'; g.strokeText(txt, x, y);
      g.fillStyle = col || (big ? '#ffe9c8' : '#f3ead4'); g.fillText(txt, x, y);
    }

    function draw() {
      if (!open) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#1d1810'; g.fillRect(0, 0, W, H);
      drawMap();
      const help = el.querySelector('#mapHelp'); if (help) help.textContent = opts.help || '';
      titleEl.textContent = view === 'world' ? t('c.map.world') : t('c.region.' + regionId);
      el.querySelector('#mapWorldBtn').classList.toggle('on', view === 'world');
      el.querySelector('#mapRegionBtn').classList.toggle('on', view === 'region');
      el.querySelector('#mapZoomIn').hidden = el.querySelector('#mapZoomOut').hidden = false;
    }

    function refresh() {
      models = {};
      for (const id of T.zones()) models[id] = MP.model(cs, id);
      draw();
    }

    /** 'world': the whole map; 'region': centred on the region (the dragon's by default, on the dragon itself when in it). */
    function setView(v, id) {
      view = v;
      if (v === 'world') { const r = rect(); cam.zoom = 1; cam.cx = (r.x0 + r.x1) / 2; cam.cz = (r.z0 + r.z1) / 2; }
      else {
        regionId = id || (cs && cs.region) || regionId;
        const R = T.region(regionId), r = rect(), p = cs && cs.dragon.pilot;
        cam.zoom = Math.max(D.map.zoom[0], Math.min(D.map.zoom[1], (r.z1 - r.z0) / (2 * R.radius) * 0.9));
        const at = p && regionId === cs.region && !cs.inLair ? T.toWorld(regionId, p.pos[0], p.pos[2]) : R.origin;
        cam.cx = at[0]; cam.cz = at[1];
      }
      clampCam();
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
      show(best.name, best.x, best.y);
    }

    // pointers: one = pan, two = pinch zoom; a short still press = tap
    const ptrs = new Map();
    let pinch = null, downAt = null;
    cv.addEventListener('pointerdown', e => {
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or already released pointer */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) downAt = { x: e.clientX, y: e.clientY, t: Date.now(), moved: 0 };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom }; if (downAt) downAt.moved = 99; }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (downAt) downAt.moved += Math.hypot(dx, dy);
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
    cv.addEventListener('wheel', e => { zoomBy(e.deltaY < 0 ? 1.25 : 0.8); e.preventDefault(); }, { passive: false });

    function zoomBy(f) { cam.zoom *= f; clampCam(); draw(); }
    el.querySelector('#mapZoomIn').onclick = () => zoomBy(1.4);
    el.querySelector('#mapZoomOut').onclick = () => zoomBy(1 / 1.4);
    el.querySelector('#mapWorldBtn').onclick = () => setView('world');
    el.querySelector('#mapRegionBtn').onclick = () => setView('region', cs.region);

    function openMap(state, v) {
      cs = state; open = true; el.hidden = false;
      size();
      regionId = cs.region;
      setView(v || 'region', cs.region);
    }
    function close() { open = false; el.hidden = true; tagEl.hidden = true; ptrs.clear(); pinch = null; }
    function tick(dt) { if (open && tagT > 0 && (tagT -= dt) <= 0) tagEl.hidden = true; }
    root.addEventListener('resize', () => { if (open) { size(); clampCam(); draw(); } });

    return {
      open: openMap, close, tick, setPad: px => { padB = Math.max(0, px || 0); if (open) { clampCam(); draw(); } }, redraw: () => open && refresh(), setView, zoomBy, tap,
      get isOpen() { return open; }, get view() { return view; }, get region() { return regionId; }, get cam() { return cam; },
      get hits() { return hits.slice(); }, imageMs: () => imageTime, get info() { return { image: !!image, imageMs: imageTime }; },
    };
  }

  VR.mapView = { build, worldImage };
})(typeof self !== 'undefined' ? self : this);
