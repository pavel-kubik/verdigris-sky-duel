/*
 * Verdigris Sky Duel - procedural textures, shared by every page (solo, co-op, campaign, deathmatch).
 * No image files: every texture is painted once into a canvas from tileable noise and cached. Needs THREE (r128).
 * Exposes window.VTex:
 *   get(name)                -> THREE.CanvasTexture (repeat-wrapped, mip-mapped) or null without a DOM (Node tests)
 *       names: scales, plates, membrane, horn, eye, stone, cobble, roof, shingle, wood, thatch, rock, ground, ash,
 *              bark, leaves, needles, fur, wool, hide, feathers, soot
 *   albedo(name, lo)         -> the same relief lifted into lo..1, for material.map (keeps the material colour)
 *   normal(name, strength)   -> a tangent-space normal map made from the luminance of get(name)
 *   detail(material, opts)   -> material: adds a triplanar detail texture to any lit material without UVs
 *       opts: { map (texture or name), scale (world units per tile), strength (0..1 albedo), bump (0 = off),
 *               local (object space, for things that move: animals, falling trees),
 *               top (texture or name for upward faces), topScale }
 *       The detail texture is authored around mid grey, so vertex colours and instance colours keep their palette.
 *       Bump needs a per-pixel lit material (MeshStandardMaterial / MeshPhongMaterial); on MeshLambertMaterial only
 *       the albedo is textured.
 *   lava(opts)               -> ShaderMaterial of flowing lava (u time): { material, update(time) }
 *   wind(material, opts)     -> material: sways the upper part of an (instanced) tree; VTex.tick(time) moves it
 *   tick(time)               -> advance the shared time uniform (wind, lava) - call once per frame
 *   quality(q)               -> 0 low (no bump, 128 px), 1 default
 */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  if (!THREE) return;
  const hasDom = typeof document !== 'undefined' && !!document.createElement;
  const cache = new Map();
  const uTime = { value: 0 };
  let Q = 1;

  /* ---------- tileable noise ---------- */
  function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const sm = t => t * t * (3 - 2 * t);
  /** Value noise, period p (integer lattice cells per tile). x, y in lattice units. */
  function vnoise(x, y, p, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  /** Fractal noise over the unit tile: u, v in 0..1, p = base period, o = octaves. Returns 0..1. */
  function fbm(u, v, p, o, s) {
    let a = 0.5, sum = 0, n = 0;
    for (let i = 0; i < o; i++) { sum += vnoise(u * p, v * p, p, s + i * 17) * a; n += a; a *= 0.5; p *= 2; }
    return sum / n;
  }
  /** Tileable cellular noise: [distance to the nearest point, to the second, cell id 0..1]. n = cells per tile. */
  function cell(u, v, n, s, jitter) {
    const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y), J = jitter == null ? 0.8 : jitter;
    let d1 = 9, d2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
      const px = cx + 0.5 + (hash(wx, wy, s) - 0.5) * J, py = cy + 0.5 + (hash(wx, wy, s + 5) - 0.5) * J;
      const d = Math.hypot(px - x, py - y);
      if (d < d1) { d2 = d1; d1 = d; id = hash(wx, wy, s + 9); } else if (d < d2) d2 = d;
    }
    return [d1, d2, id];
  }
  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
  const mix = (a, b, k) => a + (b - a) * k;
  const step = (e0, e1, x) => sm(clamp01((x - e0) / (e1 - e0)));

  /* ---------- painters: (u, v) -> grey 0..1 or [r, g, b]; all tile over the unit square ---------- */
  const PAINT = {
    /* dragon hide: overlapping rounded scales in offset rows (v = along the body, tip toward v+) */
    scales: { w: 256, h: 256, fn(u, v) {
      const N = 8, M = 8;
      let best = 0, tone = 0;
      for (let k = 0; k < 2; k++) {                              // this row and the one overlapping it from behind
        const row = Math.floor(v * M) - k, off = (((row % 2) + 2) % 2) * 0.5;
        const cu = (Math.floor(u * N - off) + 0.5 + off) / N, cv = (row + 0.5) / M;
        const dx = (u - cu) * N, dy = (v - cv) * M - 0.25;        // the scale's body, longer toward the tip
        const r = Math.hypot(dx * 1.05, dy * (dy > 0 ? 0.62 : 1.25));
        const hgt = clamp01(1.08 - r * 1.9) * (0.62 + 0.38 * clamp01(dy + 0.6));
        if (hgt > best) { best = hgt; tone = hash(((Math.round(cu * N * 2) % (N * 2)) + N * 2) % (N * 2), ((row % M) + M) % M, 3); }
      }
      const g = fbm(u, v, 24, 3, 7);
      return clamp01(0.2 + Math.pow(best, 0.6) * 0.62 + (tone - 0.5) * 0.16 + (g - 0.5) * 0.12);
    } },
    /* belly scutes: wide plates across (u), stacked along v, each with a rounded leading edge */
    plates: { w: 128, h: 256, fn(u, v) {
      const M = 6, f = v * M - Math.floor(v * M), row = Math.floor(v * M);
      const bow = Math.cos((u - 0.5) * Math.PI) * 0.1;
      const k = clamp01(((f + bow) % 1 + 1) % 1);
      const edge = step(0, 0.14, k) * (1 - step(0.86, 1, k) * 0.75);
      const g = fbm(u, v, 12, 3, 11), streak = fbm(u * 3, v * 0.5, 16, 2, 5);
      return clamp01(0.22 + edge * 0.5 + (1 - k) * 0.14 + (g - 0.5) * 0.14 + (streak - 0.5) * 0.08 + (hash(row % M, 0, 2) - 0.5) * 0.05);
    } },
    /* wing membrane: thin veins fanning from the wrist (u = across the fingers, v = toward the trailing edge) */
    membrane: { w: 256, h: 256, fn(u, v) {
      const warp = fbm(u, v, 6, 3, 21) - 0.5;
      const a = cell(u + warp * 0.08, v + warp * 0.08, 7, 4, 0.9), vein = step(0.0, 0.09, a[1] - a[0]);
      const b = cell(u, v, 18, 9, 0.9), fine = step(0.0, 0.1, b[1] - b[0]);
      const g = fbm(u, v, 20, 3, 2);
      return clamp01(0.3 + vein * 0.3 + fine * 0.1 + (g - 0.5) * 0.2 + a[2] * 0.06);
    } },
    /* horn and claws: growth rings across, fine fibres along (v = base to tip) */
    horn: { w: 64, h: 128, fn(u, v) {
      const ring = Math.sin(v * Math.PI * 2 * 9 + fbm(u, v, 6, 2, 3) * 5) * 0.5 + 0.5;
      const fib = fbm(u * 4, v * 0.4, 24, 2, 8);
      return clamp01(0.36 + ring * 0.2 + (fib - 0.5) * 0.26);
    } },
    /* ashlar: coursed limestone blocks in a running bond, recessed mortar, weathering */
    stone: { w: 256, h: 256, fn(u, v) {
      const rows = 6, row = Math.floor(v * rows), fv = v * rows - row;
      const n = 3 + (hash(row, 1, 4) > 0.5 ? 1 : 0), off = hash(row, 2, 4);
      const x = ((u + off) % 1) * n, col = Math.floor(x), fu = x - col;
      const mort = Math.min(step(0, 0.045 * n / 3, Math.min(fu, 1 - fu)), step(0, 0.07, Math.min(fv, 1 - fv)));
      const tone = hash(col, row, 6), g = fbm(u, v, 16, 4, 12), pit = fbm(u, v, 48, 2, 14);
      const bevel = Math.min(1, Math.min(fu, 1 - fu) * 9 * 3 / n, Math.min(fv, 1 - fv) * 6);
      return clamp01(0.16 + mort * (0.36 + bevel * 0.08 + (tone - 0.5) * 0.2 + (g - 0.5) * 0.24 - (pit > 0.72 ? 0.1 : 0)));
    } },
    /* cobbles / rubble masonry: rounded field stones in dark joints */
    cobble: { w: 256, h: 256, fn(u, v) {
      const c = cell(u, v, 7, 31, 0.85), k = step(0.02, 0.2, c[1] - c[0]);
      const g = fbm(u, v, 24, 3, 3);
      return clamp01(0.16 + k * (0.34 + c[2] * 0.2 + (1 - c[0]) * 0.06) + (g - 0.5) * 0.16);
    } },
    /* slate roof: overlapping rows of square-cut slates, a shadow under each upper row */
    roof: { w: 256, h: 256, fn(u, v) {
      const rows = 8, row = Math.floor(v * rows), fv = v * rows - row;
      const n = 8, x = ((u + (row % 2) * 0.5 / n + hash(row, 0, 2) * 0.01) % 1) * n, col = Math.floor(x), fu = x - col;
      const gap = step(0, 0.06, Math.min(fu, 1 - fu));
      const tone = hash(col, row, 13), g = fbm(u, v, 32, 3, 5);
      return clamp01(0.2 + gap * (0.2 + fv * 0.28 + (tone - 0.5) * 0.2) + (g - 0.5) * 0.12 - step(0.9, 1, fv) * 0.1);
    } },
    /* wooden shingles: narrower, rounded lower edges */
    shingle: { w: 256, h: 256, fn(u, v) {
      const rows = 7, row = Math.floor(v * rows), fv = v * rows - row;
      const n = 9, x = ((u + (row % 2) * 0.5 / n) % 1) * n, col = Math.floor(x), fu = x - col;
      const round = Math.sqrt(Math.max(0, 1 - Math.pow((fu - 0.5) * 2, 4))) * 0.22;
      const body = fv > 0.22 - round ? 1 : 0.35;
      const grain = fbm(u * 6, v * 0.5, 32, 2, 4), tone = hash(col, row, 5);
      return clamp01(0.18 + body * (0.24 + fv * 0.2 + (tone - 0.5) * 0.22) + (grain - 0.5) * 0.2) * step(0, 0.08, Math.min(fu, 1 - fu)) * 0.9 + 0.06;
    } },
    /* sawn planks: grain along v, plank joints, a few knots */
    wood: { w: 256, h: 256, fn(u, v) {
      const n = 5, x = u * n, col = Math.floor(x), fu = x - col;
      const joint = step(0, 0.05, Math.min(fu, 1 - fu));
      const ph = hash(col, 0, 7), warp = fbm(u, v, 4, 2, 9 + col) * 0.6;
      const grain = Math.sin((fu * 9 + warp * 6 + fbm(u, v * 0.25, 16, 3, 2 + col) * 4) * Math.PI) * 0.5 + 0.5;
      const kn = cell(u, v, 3, 40 + col, 1)[0], knot = 1 - step(0.02, 0.1, kn);
      const fine = fbm(u * 8, v, 32, 2, 3);
      return clamp01(0.14 + joint * (0.34 + (ph - 0.5) * 0.16 + (grain - 0.5) * 0.16 + (fine - 0.5) * 0.14 - knot * 0.22));
    } },
    thatch: { w: 256, h: 256, fn(u, v) {
      const a = fbm(u * 10, v * 0.6, 40, 3, 3), b = fbm(u * 3, v * 0.3, 12, 2, 8), band = Math.sin(v * Math.PI * 2 * 5) * 0.5 + 0.5;
      return clamp01(0.3 + (a - 0.5) * 0.5 + (b - 0.5) * 0.2 + band * 0.08);
    } },
    /* bare rock: broad strata, ridged cracks, fine grain */
    rock: { w: 256, h: 256, fn(u, v) {
      const g = fbm(u, v, 5, 5, 41), r = 1 - Math.abs(fbm(u, v, 7, 4, 43) * 2 - 1), c = cell(u, v, 5, 47, 1);
      const crack = step(0, 0.05, c[1] - c[0]);
      return clamp01(0.2 + g * 0.42 + Math.pow(r, 3) * 0.16 - (1 - crack) * 0.16 + (fbm(u, v, 64, 2, 49) - 0.5) * 0.1);
    } },
    /* turf and soil: clumps, blades and pebbles */
    ground: { w: 256, h: 256, fn(u, v) {
      const g = fbm(u, v, 6, 4, 51), f = fbm(u, v, 48, 3, 53), c = cell(u, v, 22, 55, 1);
      return clamp01(0.3 + (g - 0.5) * 0.34 + (f - 0.5) * 0.34 + (c[0] < 0.22 ? (0.22 - c[0]) * 0.7 * (c[2] - 0.4) : 0));
    } },
    /* volcanic ash and cinder: fine grain, shrinkage cracks, scattered clinker */
    ash: { w: 256, h: 256, fn(u, v) {
      const g = fbm(u, v, 5, 4, 61), f = fbm(u, v, 56, 3, 63), c = cell(u, v, 6, 65, 1), d = cell(u, v, 26, 67, 1);
      const crack = step(0, 0.035, c[1] - c[0]);
      return clamp01(0.34 + (g - 0.5) * 0.3 + (f - 0.5) * 0.26 - (1 - crack) * 0.07 + (d[0] < 0.2 ? (0.2 - d[0]) * 0.9 * (d[2] - 0.5) : 0));
    } },
    /* bark: deep vertical furrows (v = up the trunk) */
    bark: { w: 128, h: 256, fn(u, v) {
      const w = fbm(u, v, 4, 2, 71) * 0.14;
      const c = cell(u * 1 + w, v * 0.32, 9, 73, 0.9), ridge = step(0, 0.22, c[1] - c[0]);
      const f = fbm(u * 3, v, 24, 3, 75);
      return clamp01(0.14 + ridge * 0.44 + (f - 0.5) * 0.24 + c[2] * 0.06);
    } },
    /* broadleaf canopy: leaf clusters catching light, dark gaps between */
    leaves: { w: 256, h: 256, fn(u, v) {
      const a = cell(u, v, 9, 81, 1), b = cell(u, v, 22, 83, 1), g = fbm(u, v, 6, 3, 85);
      const clump = 1 - step(0.1, 0.62, a[0]), leaf = 1 - step(0.08, 0.5, b[0]);
      return clamp01(0.14 + clump * 0.34 + leaf * 0.26 + (g - 0.5) * 0.22 + b[2] * 0.08);
    } },
    /* conifer boughs: drooping needle sprays (v = up) */
    needles: { w: 256, h: 256, fn(u, v) {
      const rows = 7, row = Math.floor(v * rows), fv = v * rows - row;
      const n = 10, x = ((u + hash(row, 3, 9) * 0.3) % 1) * n, col = Math.floor(x), fu = x - col;
      const droop = clamp01(1.15 - Math.abs(fu - 0.5) * 2.2 - (1 - fv) * 0.9);
      const f = fbm(u * 6, v * 2, 48, 3, 91), tone = hash(col, row, 93);
      return clamp01(0.14 + droop * 0.42 + (f - 0.5) * 0.3 + (tone - 0.5) * 0.14 + fv * 0.08);
    } },
    /* short fur: fine strands along v */
    fur: { w: 128, h: 128, fn(u, v) {
      const a = fbm(u * 8, v * 0.7, 48, 3, 101), b = fbm(u, v, 6, 3, 103);
      return clamp01(0.5 + (a - 0.5) * 0.5 + (b - 0.5) * 0.2);
    } },
    /* fleece: tight curls */
    wool: { w: 128, h: 128, fn(u, v) {
      const c = cell(u, v, 10, 111, 1), d = cell(u, v, 24, 113, 1);
      return clamp01(0.36 + (1 - c[0]) * 0.24 + (1 - d[0] * 1.6) * 0.14 - (1 - step(0, 0.1, c[1] - c[0])) * 0.14);
    } },
    /* cattle hide: smooth, soft mottling */
    hide: { w: 128, h: 128, fn(u, v) {
      const a = fbm(u, v, 5, 4, 121), b = fbm(u * 6, v, 40, 2, 123);
      return clamp01(0.5 + (a - 0.5) * 0.26 + (b - 0.5) * 0.16);
    } },
    feathers: { w: 128, h: 128, fn(u, v) {
      const rows = 8, row = Math.floor(v * rows), fv = v * rows - row, n = 7, x = ((u + (row % 2) * 0.5 / n) % 1) * n, fu = x - Math.floor(x);
      const r = Math.hypot((fu - 0.5) * 1.5, fv - 0.25), barb = Math.sin((fu + fv * 0.6) * 40) * 0.04;
      return clamp01(0.3 + clamp01(1 - r * 1.2) * 0.4 + barb + Math.abs(fu - 0.5) * -0.1);
    } },
    /* soot and char: for burned wood */
    soot: { w: 128, h: 128, fn(u, v) {
      const c = cell(u, v, 7, 131, 1), crack = step(0, 0.1, c[1] - c[0]), g = fbm(u, v, 20, 3, 133);
      return clamp01(0.2 + crack * 0.34 + (g - 0.5) * 0.26 + c[2] * 0.14);
    } },
  };

  function paint(name) {
    const P = PAINT[name];
    const k = Q ? 1 : 0.5, w = Math.max(32, P.w * k) | 0, h = Math.max(32, P.h * k) | 0;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = P.fn((x + 0.5) / w, (y + 0.5) / h), o = (y * w + x) * 4;
      if (typeof c === 'number') { d[o] = d[o + 1] = d[o + 2] = c * 255; }
      else { d[o] = c[0] * 255; d[o + 1] = c[1] * 255; d[o + 2] = c[2] * 255; }
      d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
  function wrapTex(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  /** A slit-pupilled reptile eye (not tiled): the iris takes the palette's eye colour through material.color. */
  function eyeCanvas() {
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#d8d8d8'); gr.addColorStop(0.85, '#8a8a8a'); gr.addColorStop(1, '#2a2a2a');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1;
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * 6, s / 2 + Math.sin(a) * 6); g.lineTo(s / 2 + Math.cos(a) * 30, s / 2 + Math.sin(a) * 30); g.stroke(); }
    g.fillStyle = '#050505'; g.beginPath(); g.ellipse(s / 2, s / 2, 5.5, 22, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(s * 0.36, s * 0.34, 4, 0, Math.PI * 2); g.fill();
    return cv;
  }

  function get(name) {
    if (!hasDom) return null;
    if (name && name.isTexture) return name;
    let t = cache.get(name);
    if (t) return t;
    if (name === 'eye') { t = new THREE.CanvasTexture(eyeCanvas()); cache.set(name, t); return t; }
    if (!PAINT[name]) return null;
    t = wrapTex(paint(name));
    cache.set(name, t);
    return t;
  }
  /** The texture as an albedo map: its relief lifted into lo..1 (default 0.6), so material.color keeps its tone. */
  function albedo(name, lo) {
    if (!hasDom || !PAINT[name]) return null;
    const L = lo == null ? 0.6 : lo, key = name + ':a:' + L;
    let t = cache.get(key);
    if (t) return t;
    const src = get(name).image, w = src.width, h = src.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    let lo0 = 255, hi0 = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < lo0) lo0 = d[i]; if (d[i] > hi0) hi0 = d[i]; }
    const k = (1 - L) * 255 / Math.max(1, hi0 - lo0);
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = L * 255 + (d[i + c] - lo0) * k;
    g.putImageData(img, 0, 0);
    t = wrapTex(cv);
    cache.set(key, t);
    return t;
  }
  /** Normal map from a painted texture's luminance (Sobel, wrapped). */
  function normal(name, strength) {
    if (!hasDom || !PAINT[name]) return null;
    const key = name + ':n:' + (strength || 2);
    let t = cache.get(key);
    if (t) return t;
    const src = get(name).image, w = src.width, h = src.height;
    const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data, S = strength || 2;
    const H = (x, y) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * S;
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * S;
      const l = 1 / Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
      d[o] = (-dx * l * 0.5 + 0.5) * 255; d[o + 1] = (dy * l * 0.5 + 0.5) * 255; d[o + 2] = (l * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    t = wrapTex(cv);
    cache.set(key, t);
    return t;
  }

  /* ---------- triplanar detail for materials without UVs ---------- */
  const VERT_PARS = 'varying vec3 vtPos;\nvarying vec3 vtNrm;\n';
  const VERT_MAIN = [
    '#ifdef VT_LOCAL',
    '  vtPos = position; vtNrm = normal;',
    '#else',
    '  vec4 vtW = vec4( transformed, 1.0 ); vec3 vtN = objectNormal;',
    '  #ifdef USE_INSTANCING',
    '    vtW = instanceMatrix * vtW; vtN = mat3( instanceMatrix ) * vtN;',
    '  #endif',
    '  vtPos = ( modelMatrix * vtW ).xyz; vtNrm = mat3( modelMatrix ) * vtN;',
    '#endif',
  ].join('\n');
  const FRAG_PARS = [
    'uniform sampler2D vtMap;', 'uniform vec4 vtP;', 'varying vec3 vtPos;', 'varying vec3 vtNrm;',
    '#ifdef VT_TOP', 'uniform sampler2D vtTop;', '#endif',
    'vec3 vtTri( sampler2D m, vec3 q, vec3 b ) { return texture2D( m, q.zy ).rgb * b.x + texture2D( m, q.xz ).rgb * b.y + texture2D( m, q.xy ).rgb * b.z; }',
  ].join('\n');
  const FRAG_COL = [
    '{',
    '  vec3 vtN = normalize( vtNrm ); vec3 vtB = max( abs( vtN ) - 0.18, 0.0 ); vtB /= ( vtB.x + vtB.y + vtB.z + 1e-4 );',
    '  vec3 vtC = vtTri( vtMap, vtPos * vtP.x, vtB );',
    '  #ifdef VT_TOP',
    '    vtC = mix( vtC, texture2D( vtTop, vtPos.xz * vtP.w ).rgb, smoothstep( 0.62, 0.86, vtN.y ) );',
    '  #endif',
    '  diffuseColor.rgb *= mix( vec3( 1.0 ), vtC * 2.0, vtP.y );',
    '}',
  ].join('\n');
  /* Bump from the dominant projection plane, by finite differences one pixel along x and y (as three's bumpMap does),
     so the relief is per pixel and fades with the mip level in the distance. */
  const FRAG_BUMP = [
    '#ifdef VT_BUMP',
    '{',
    '  vec3 vtQ = vtPos * vtP.x, vtQx = dFdx( vtQ ), vtQy = dFdy( vtQ ), vtA = abs( normalize( vtNrm ) );',
    '  vec2 vtU, vtUx, vtUy;',
    '  if ( vtA.x > vtA.y && vtA.x > vtA.z ) { vtU = vtQ.zy; vtUx = vtQx.zy; vtUy = vtQy.zy; }',
    '  else if ( vtA.y > vtA.z ) { vtU = vtQ.xz; vtUx = vtQx.xz; vtUy = vtQy.xz; }',
    '  else { vtU = vtQ.xy; vtUx = vtQx.xy; vtUy = vtQy.xy; }',
    '  float vtH0 = texture2D( vtMap, vtU ).g;',
    '  vec2 vtD = vec2( texture2D( vtMap, vtU + vtUx ).g - vtH0, texture2D( vtMap, vtU + vtUy ).g - vtH0 ) * vtP.z;',
    '  vec3 vtSx = dFdx( -vViewPosition ), vtSy = dFdy( -vViewPosition );',
    '  vec3 vtR1 = cross( vtSy, normal ), vtR2 = cross( normal, vtSx );',
    '  float vtDet = dot( vtSx, vtR1 );',
    '  normal = normalize( abs( vtDet ) * normal - sign( vtDet ) * ( vtD.x * vtR1 + vtD.y * vtR2 ) );',
    '}',
    '#endif',
  ].join('\n');

  function detail(mat, opts) {
    opts = opts || {};
    const map = get(opts.map || 'rock');
    if (!map || !mat) return mat;
    const top = opts.top ? get(opts.top) : null;
    const lit = !!(mat.isMeshStandardMaterial || mat.isMeshPhongMaterial);
    const bump = lit && Q > 0 ? (opts.bump == null ? 1 : opts.bump) : 0;
    const U = { vtMap: { value: map }, vtP: { value: new THREE.Vector4(1 / (opts.scale || 8), opts.strength == null ? 0.6 : opts.strength, bump * 1.6, 1 / (opts.topScale || opts.scale || 8)) } };
    if (top) U.vtTop = { value: top };
    mat.defines = Object.assign({}, mat.defines || {});
    if (opts.local) mat.defines.VT_LOCAL = '';
    if (bump > 0) mat.defines.VT_BUMP = '';
    if (top) mat.defines.VT_TOP = '';
    mat.extensions = Object.assign({}, mat.extensions || {}, { derivatives: true });
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = VERT_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
      let f = FRAG_PARS + '\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COL);
      if (f.indexOf('#include <normal_fragment_maps>') >= 0) f = f.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_BUMP);
      sh.fragmentShader = f;
    };
    mat.customProgramCacheKey = () => prevKey + '|vt';
    mat.userData.vt = U;
    mat.needsUpdate = true;
    return mat;
  }

  /* ---------- wind: the upper part of a tree sways (works on InstancedMesh; phase from the instance position) ---------- */
  function wind(mat, opts) {
    if (!mat || !hasDom) return mat;
    opts = opts || {};
    const U = { vtTime: uTime, vtWind: { value: new THREE.Vector3(opts.amp == null ? 0.035 : opts.amp, opts.speed || 1.3, opts.from || 0) } };
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'uniform float vtTime;\nuniform vec3 vtWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '{',
        '  float vtPh = 0.0;',
        '  #ifdef USE_INSTANCING',
        '    vtPh = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;',
        '  #endif',
        '  float vtK = max( transformed.y - vtWind.z, 0.0 );',
        '  float vtS = sin( vtTime * vtWind.y + vtPh ) + 0.45 * sin( vtTime * vtWind.y * 2.7 + vtPh * 1.9 + transformed.x * 0.4 );',
        '  transformed.x += vtS * vtK * vtWind.x; transformed.z += cos( vtTime * vtWind.y * 0.8 + vtPh ) * vtK * vtWind.x * 0.6;',
        '}',
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => prevKey + '|wind';
    mat.needsUpdate = true;
    return mat;
  }

  /* ---------- lava: flowing molten rock with a cooling crust (fragment noise; uv.y = downstream) ---------- */
  function lava(opts) {
    opts = opts || {};
    const U = {
      uTime, uFlow: { value: opts.flow == null ? 0.06 : opts.flow }, uScale: { value: opts.scale || 4 }, uHeat: { value: opts.heat == null ? 1 : opts.heat },
      uEdge: { value: opts.edge == null ? 0 : opts.edge },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: U, fog: false, transparent: !!opts.edge, depthWrite: !opts.edge,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: 'varying vec2 vUv;varying float vFog;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vFog=-mv.z;gl_Position=projectionMatrix*mv;}',
      fragmentShader: [
        'uniform float uTime,uFlow,uScale,uHeat,uEdge;varying vec2 vUv;varying float vFog;',
        'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}',
        'float fb(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=n(p)*a;p=p*2.03+7.1;a*=.5;}return s;}',
        'void main(){',
        '  vec2 p=vUv*uScale;p.y-=uTime*uFlow*uScale;',
        '  float w=fb(p*.7+vec2(0.,uTime*.03));',
        '  float c=fb(p*1.6+w*1.4+vec2(uTime*.02,0.));',                 // crust plates
        '  float crack=1.-smoothstep(.0,.16,abs(c-.5));',
        '  float glow=clamp(crack*1.25+smoothstep(.56,.8,w)*.8,0.,1.)*uHeat;',
        '  vec3 crust=vec3(.10,.035,.02)+vec3(.16,.05,.02)*c;',
        '  vec3 hot=mix(vec3(1.,.22,.02),vec3(1.,.86,.36),smoothstep(.45,1.,glow));',
        '  vec3 col=mix(crust,hot,smoothstep(.12,.7,glow))+hot*glow*.35;',
        '  float a=1.;',
        '  if(uEdge>0.){float e=min(vUv.x,1.-vUv.x);a=smoothstep(0.,uEdge,e+(c-.5)*uEdge*1.6);col=mix(crust*.6,col,smoothstep(0.,uEdge*2.2,e));}',
        '  col=mix(col,col*.55+vec3(.2,.08,.04),clamp(vFog/2600.,0.,.6));',
        '  gl_FragColor=vec4(col,a);',
        '}',
      ].join('\n'),
    });
    return { material, uniforms: U };
  }

  root.VTex = {
    get, albedo, normal, detail, wind, lava, names: Object.keys(PAINT).concat('eye'),
    tick(time) { uTime.value = time; }, time: uTime,
    quality(q) { Q = q ? 1 : 0; },
    noise: { fbm, cell, vnoise, hash },
  };
})(typeof self !== 'undefined' ? self : this);
