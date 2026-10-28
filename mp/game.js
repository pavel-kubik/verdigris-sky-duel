/*
 * Verdigris co-op - client: rendering, input, lobby and peer-to-peer networking.
 * The host's browser runs VSim's world (wyverns, fireballs, damage) and broadcasts
 * snapshots + events at 20 Hz. Every browser flies its own dragon and reports its pose.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const t = (k, p) => (window.I18N ? I18N.t(k, p) : k);
  const S = window.VSim;
  if (!window.THREE || !S) { $('#loading').textContent = t('mp.engineFail'); return; }
  const V3 = THREE.Vector3;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
  const NET_DT = 1 / 20, PREFIX = 'vsd-', CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  const PALETTES = [
    { body: 0x2f7f50, dark: 0x1f5c3c, belly: 0xc9bf7c, wing: 0x3f936a, horn: 0xe7dcc1, eye: 0xffd23a, ui: '#62c48a', name: 'Verdigris' },
    { body: 0x2e6f8f, dark: 0x1d4a63, belly: 0xd4e4e6, wing: 0x4a9cc0, horn: 0xeef4f5, eye: 0x9ff3ff, ui: '#5fb3dd', name: 'Frost' },
    { body: 0x9a6a2a, dark: 0x6b4517, belly: 0xe6cf95, wing: 0xb7853f, horn: 0x3a2a18, eye: 0xfff0a0, ui: '#d9a24f', name: 'Bronze' },
    { body: 0x26302c, dark: 0x161c19, belly: 0x5fbf8f, wing: 0x2f5a4a, horn: 0xb9f5d0, eye: 0x6dffb0, ui: '#8fe0b0', name: 'Jade' },
    { body: 0x5b3d8c, dark: 0x3a2660, belly: 0xd8c7ef, wing: 0x7d5bb5, horn: 0xf0e6ff, eye: 0xffd1ff, ui: '#a98be0', name: 'Amethyst' },
    { body: 0xcfc6ad, dark: 0x9c937a, belly: 0xf1ead6, wing: 0xe2d9bf, horn: 0x4a4436, eye: 0xff9d3a, ui: '#e8e0c8', name: 'Ivory' },
  ];
  const CRIMSON = { body: 0x8c2026, dark: 0x5a1218, belly: 0x3d1717, wing: 0x6d1a28, horn: 0x2a2121, eye: 0x8ff7ff };

  /* ---------- renderer / scene ---------- */
  const canvas = $('#c'), hud = $('#hud'), hx = hud.getContext('2d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8f7a60, 160, 700);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  const sunDir = new V3(-0.55, 0.16, -0.82).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0d2230) }, mid: { value: new THREE.Color(0x38555a) }, bot: { value: new THREE.Color(0xc8885a) }, sun: { value: sunDir } },
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top,mid,bot,sun;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.?mix(mix(bot,mid,smoothstep(0.,.2,h)),top,smoothstep(.2,.75,h)):mix(bot,mid*.55,smoothstep(0.,-.25,h));float s=max(dot(vP,sun),0.);c+=vec3(1.,.82,.55)*(pow(s,600.)*2.5+pow(s,10.)*.28);gl_FragColor=vec4(c,1.);}',
  }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xa6cbc4, 0x3b2a1a, 0.85));
  const sunLight = new THREE.DirectionalLight(0xffc68c, 1.3); sunLight.position.copy(sunDir).multiplyScalar(300); scene.add(sunLight);
  const rim = new THREE.DirectionalLight(0x7fb7ff, 0.35); rim.position.set(200, 120, 250); scene.add(rim);

  /* ---------- terrain (deterministic so every peer sees the same world) ---------- */
  function seeded(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const wr = seeded(2026);
  (function buildWorld() {
    const g = new THREE.PlaneGeometry(2600, 2600, 170, 170); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = [], c = new THREE.Color();
    const sand = new THREE.Color(0xb39f74), moss = new THREE.Color(0x46683a), moss2 = new THREE.Color(0x2f4f33), rock = new THREE.Color(0x6e6556), snow = new THREE.Color(0xdcd8cc);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = S.H(x, z); p.setY(i, h);
      if (h < 2) c.copy(sand); else if (h < 18) c.copy(moss).lerp(moss2, (Math.sin(x * .05) * Math.cos(z * .04) + 1) / 2); else if (h < 48) c.copy(moss2).lerp(rock, Math.min(1, (h - 18) / 18)); else c.copy(rock).lerp(snow, Math.min(1, (h - 48) / 30));
      const n = 0.92 + wr() * 0.12; col.push(c.r * n, c.g * n, c.b * n);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshStandardMaterial({ color: 0x2c5c63, roughness: .25, metalness: .2, transparent: true, opacity: .88 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.6; scene.add(water);
    const rockM = new THREE.MeshStandardMaterial({ color: 0x6a5f50, flatShading: true, roughness: 1 }), grassM = new THREE.MeshStandardMaterial({ color: 0x4d7a40, flatShading: true, roughness: 1 });
    for (let i = 0; i < 46; i++) {
      const a = wr() * Math.PI * 2, r = 60 + wr() * 320, x = Math.cos(a) * r, z = Math.sin(a) * r, hgt = 25 + wr() * 55, rad = 3 + wr() * 5;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.55, rad, hgt, 6, 3), rockM); m.position.set(x, S.H(x, z) + hgt / 2 - 2, z); m.rotation.y = wr() * 3; scene.add(m);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.7, rad * 0.55, 2, 6), grassM); cap.position.set(x, m.position.y + hgt / 2 + 0.5, z); scene.add(cap);
    }
    for (let i = 0; i < 12; i++) {
      const a = wr() * Math.PI * 2, r = 80 + wr() * 260, s = 6 + wr() * 10, y = 75 + wr() * 70;
      const g2 = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(s, s * 2.2, 7), rockM); base.rotation.x = Math.PI; base.position.y = -s * 1.1; g2.add(base);
      g2.add(new THREE.Mesh(new THREE.CylinderGeometry(s * 1.02, s, 1.6, 7), grassM));
      g2.position.set(Math.cos(a) * r, y, Math.sin(a) * r); scene.add(g2);
    }
  })();
  const clouds = [];
  (function () {
    const m = new THREE.MeshStandardMaterial({ color: 0xf3e6d6, flatShading: true, roughness: 1, transparent: true, opacity: .82, emissive: 0x3a2a20 });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 34; i++) {
      const g = new THREE.Group(), n = 3 + Math.floor(wr() * 4);
      for (let k = 0; k < n; k++) { const s = new THREE.Mesh(geo, m); const sc = 6 + wr() * 9; s.scale.set(sc * 1.4, sc * 0.7, sc); s.position.set((wr() - .5) * 26, (wr() - .5) * 4, (wr() - .5) * 16); g.add(s); }
      const a = wr() * Math.PI * 2, r = wr() * 520; g.position.set(Math.cos(a) * r, 120 + wr() * 70, Math.sin(a) * r);
      scene.add(g); clouds.push(g);
    }
  })();

  /* ---------- dragon builder ---------- */
  const segGeo = new THREE.IcosahedronGeometry(1, 1);
  function bone(a, b, r0, r1, mat) {
    const d = new V3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 5); g.translate(0, len / 2, 0);
    const m = new THREE.Mesh(g, mat); m.position.copy(a); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); return m;
  }
  function membrane(tris, mat) {
    const arr = []; tris.forEach(t => t.forEach(p => arr.push(p.x, p.y, p.z)));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
  function spike(parent, x, y, z, s, mat) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(s * 0.45, s, 4), mat); m.position.set(x, y, z); m.rotation.x = -0.55; parent.add(m); return m;
  }
  function makeDragon(c) {
    const M = (col, o) => new THREE.MeshStandardMaterial(Object.assign({ color: col, flatShading: true, roughness: .55, metalness: .12 }, o || {}));
    const mBody = M(c.body), mDark = M(c.dark), mBelly = M(c.belly, { roughness: .8 }), mWing = M(c.wing, { side: THREE.DoubleSide, roughness: .85, metalness: 0 }), mHorn = M(c.horn, { roughness: .35 }), mEye = new THREE.MeshBasicMaterial({ color: c.eye });
    const mats = [mBody, mDark, mBelly, mWing, mHorn];
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const torso = new THREE.Mesh(segGeo, mBody); torso.scale.set(1.15, 1, 2.05); body.add(torso);
    const belly = new THREE.Mesh(segGeo, mBelly); belly.scale.set(0.92, 0.72, 1.85); belly.position.set(0, -0.36, 0.05); body.add(belly);
    for (let i = 0; i < 6; i++) spike(body, 0, 0.92 - Math.abs(i - 2.5) * 0.04, 1.3 - i * 0.52, 0.55, mHorn);
    const neck = []; let j = new THREE.Group(); j.position.set(0, 0.35, 1.65); j.rotation.x = j.userData.bx = -0.32; body.add(j);
    for (let i = 0; i < 6; i++) {
      const r = 0.7 - i * 0.055; const s = new THREE.Mesh(segGeo, i % 2 ? mDark : mBody); s.scale.set(r, r * 0.95, r * 1.15); s.position.z = 0.27; j.add(s);
      const sb = new THREE.Mesh(segGeo, mBelly); sb.scale.set(r * 0.75, r * 0.6, r); sb.position.set(0, -r * 0.35, 0.27); j.add(sb);
      spike(j, 0, r * 0.92, 0.2, 0.4 - i * 0.03, mHorn);
      neck.push(j); const n = new THREE.Group(); n.position.z = 0.55; n.rotation.x = n.userData.bx = -0.13; j.add(n); j = n;
    }
    const head = new THREE.Group(); head.rotation.x = 0.85; j.add(head);
    const skull = new THREE.Mesh(segGeo, mBody); skull.scale.set(0.56, 0.46, 0.72); skull.position.set(0, 0.12, 0.2); head.add(skull);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.38, 1.05, 6), mBody); snout.rotation.x = Math.PI / 2; snout.position.set(0, 0.05, 0.95); head.add(snout);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.35), mDark); brow.position.set(0, 0.36, 0.5); brow.rotation.x = 0.25; head.add(brow);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.14, 0.3); head.add(jaw);
    const jm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 0.95, 6), mBelly); jm.rotation.x = Math.PI / 2; jm.position.set(0, -0.08, 0.5); jaw.add(jm);
    const toothM = M(0xf2ead8, { roughness: .3 });
    [[-0.17, 0.85], [0.17, 0.85], [-0.22, 0.55], [0.22, 0.55]].forEach(t => { const tt = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), toothM); tt.position.set(t[0], 0.02, t[1]); jaw.add(tt); });
    [[-0.15, 1.25], [0.15, 1.25], [-0.25, 0.95], [0.25, 0.95]].forEach(t => { const tt = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), toothM); tt.rotation.x = Math.PI; tt.position.set(t[0], -0.12, t[1]); head.add(tt); });
    [-1, 1].forEach(s => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mEye); e.position.set(s * 0.3, 0.27, 0.55); e.scale.set(1, 0.7, 1.3); head.add(e);
      const h1 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.15, 5), mHorn); h1.position.set(s * 0.26, 0.42, -0.15); h1.rotation.set(-1.05, 0, -s * 0.22); head.add(h1);
      const h2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 5), mHorn); h2.position.set(s * 0.42, 0.18, -0.2); h2.rotation.set(-1.25, 0, -s * 0.6); head.add(h2);
      const frill = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 4), mDark); frill.position.set(s * 0.42, -0.05, 0.05); frill.rotation.set(-1.4, 0, -s * 0.9); head.add(frill);
    });
    const mouth = new THREE.Object3D(); mouth.position.set(0, -0.05, 1.55); head.add(mouth);
    const tail = []; let t = new THREE.Group(); t.position.set(0, 0.1, -1.75); body.add(t); t.userData.bx = 0;
    for (let i = 0; i < 12; i++) {
      const r = 0.68 * (1 - i / 13) + 0.07; const s = new THREE.Mesh(segGeo, i % 2 ? mDark : mBody); s.scale.set(r, r * 0.9, 0.5); s.position.z = -0.3; t.add(s);
      if (i < 10) spike(t, 0, r * 0.9, -0.3, 0.42 - i * 0.03, mHorn);
      tail.push(t); const n = new THREE.Group(); n.position.z = -0.6; n.rotation.x = n.userData.bx = (i < 4 ? 0.02 : -0.035); t.add(n); t = n;
    }
    const spade = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), mHorn); spade.scale.set(0.95, 0.12, 1.2); spade.position.z = -0.45; t.add(spade);
    [-1, 1].forEach(s => {
      const thigh = new THREE.Mesh(segGeo, mBody); thigh.scale.set(0.42, 0.58, 0.62); thigh.position.set(s * 0.72, -0.38, -0.95); body.add(thigh);
      body.add(bone(new V3(s * 0.82, -0.75, -1.05), new V3(s * 0.78, -1.15, -1.75), 0.17, 0.12, mDark));
      body.add(bone(new V3(s * 0.78, -1.15, -1.75), new V3(s * 0.75, -1.05, -2.25), 0.11, 0.08, mDark));
      body.add(bone(new V3(s * 0.6, -0.45, 1.15), new V3(s * 0.7, -0.98, 1.3), 0.13, 0.09, mBody));
      body.add(bone(new V3(s * 0.7, -0.98, 1.3), new V3(s * 0.66, -1.05, 0.85), 0.09, 0.07, mDark));
    });
    const wings = [];
    [-1, 1].forEach(s => {
      const wr2 = new THREE.Group(); wr2.position.set(s * 0.72, 0.62, 0.65); body.add(wr2);
      const w = new THREE.Group(); w.scale.x = s; wr2.add(w);
      const arm = new THREE.Group(); w.add(arm);
      const E = new V3(3, 0, 0);
      arm.add(bone(new V3(0, 0, 0), E, 0.2, 0.13, mBody));
      const sh = new THREE.Mesh(segGeo, mBody); sh.scale.setScalar(0.3); arm.add(sh);
      arm.add(membrane([[new V3(0, 0, 0), new V3(3, 0, 0), new V3(3, 0, -2.4)], [new V3(0, 0, 0), new V3(3, 0, -2.4), new V3(1.5, 0, -1.85)], [new V3(0, 0, 0), new V3(1.5, 0, -1.85), new V3(-0.6, 0, -2.1)]], mWing));
      const fore = new THREE.Group(); fore.position.copy(E); arm.add(fore);
      const W = new V3(2.6, 0.45, 0.4), F1 = new V3(5.5, 0.35, -0.25), F2 = new V3(4.7, 0.05, -2.5), F3 = new V3(3.0, -0.05, -3.5), B = new V3(0, 0, -2.4);
      const el = new THREE.Mesh(segGeo, mBody); el.scale.setScalar(0.17); fore.add(el);
      fore.add(bone(new V3(), W, 0.13, 0.1, mBody));
      fore.add(bone(W, F1, 0.08, 0.03, mDark)); fore.add(bone(W, F2, 0.07, 0.03, mDark)); fore.add(bone(W, F3, 0.06, 0.03, mDark));
      const notch = (a, b, k) => a.clone().add(b).multiplyScalar(0.5).lerp(W, k);
      const m12 = notch(F1, F2, 0.28), m23 = notch(F2, F3, 0.25), m3B = notch(F3, B, 0.2);
      fore.add(membrane([[W, F1, m12], [W, m12, F2], [W, F2, m23], [W, m23, F3], [W, F3, m3B], [W, m3B, B], [W, B, new V3()]], mWing));
      wings.push({ wr: wr2, arm, fore, s });
    });
    const d = { root, body, neck, tail, jaw, head, mouth, wings, mats, flash: 0 };
    d.anim = function (time, dt, o) {
      const ph = o.phase, a = Math.sin(ph), amp = o.amp;
      wings.forEach(w => { w.arm.rotation.z = a * 0.8 * amp + 0.12; w.fore.rotation.z = Math.sin(ph - 0.9) * 0.5 * amp - 0.06 + (1 - amp) * 0.1; w.wr.rotation.y = -w.s * (0.08 + Math.cos(ph) * 0.08 * amp); });
      body.position.y = -a * 0.2 * amp;
      neck.forEach((jj, i) => { jj.rotation.x = jj.userData.bx + Math.sin(ph - i * 0.4) * 0.03 * amp + (o.look || 0) * 0.04; jj.rotation.y = Math.sin(time * 0.9 - i * 0.3) * 0.05; });
      tail.forEach((jj, i) => { jj.rotation.y = Math.sin(time * 1.8 - i * 0.45) * 0.09 + (o.turn || 0) * 0.05; jj.rotation.x = jj.userData.bx + Math.sin(ph - i * 0.5) * 0.035; });
      jaw.rotation.x += ((o.mouth ? 0.65 : 0.04) - jaw.rotation.x) * Math.min(1, dt * 12);
      if (d.flash > 0) d.flash = Math.max(0, d.flash - dt * 4);
      const f = d.flash; mats.forEach(m => m.emissive.setRGB(f * 0.9, f * 0.45, f * 0.15));
    };
    d.dispose = function () { scene.remove(root); root.traverse(o => { if (o.isMesh && o.geometry !== segGeo) o.geometry.dispose(); }); mats.forEach(m => m.dispose()); };
    return d;
  }

  /* ---------- particles (visual only; damage lives in VSim) ---------- */
  const PMAX = 3000;
  const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pA = new Float32Array(PMAX), pS = new Float32Array(PMAX);
  const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX), pS0 = new Float32Array(PMAX), pGrow = new Float32Array(PMAX), pKind = new Uint8Array(PMAX), pDrag = new Float32Array(PMAX);
  let pN = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('pcolor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('alpha', new THREE.BufferAttribute(pA, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('size', new THREE.BufferAttribute(pS, 1).setUsage(THREE.DynamicDrawUsage));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 500 } },
    vertexShader: 'attribute vec3 pcolor;attribute float alpha;attribute float size;uniform float uScale;varying vec3 vC;varying float vA;void main(){vC=pcolor;vA=alpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*uScale/max(-mv.z,.1);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,.05,d)*vA;gl_FragColor=vec4(vC*a,a);}',
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  // kinds: 0 fire, 1 violet (wyvern fire), 2 spark
  function spawnP(x, y, z, vx, vy, vz, life, size, grow, kind, drag) {
    if (pN >= PMAX) return; const i = pN++, k = i * 3;
    pPos[k] = x; pPos[k + 1] = y; pPos[k + 2] = z; pVel[k] = vx; pVel[k + 1] = vy; pVel[k + 2] = vz;
    pLife[i] = pMax[i] = life; pS0[i] = size; pGrow[i] = grow; pKind[i] = kind; pDrag[i] = drag || 0;
  }
  function killP(i) {
    const l = --pN; if (i === l) return; const k = i * 3, m = l * 3;
    for (let q = 0; q < 3; q++) { pPos[k + q] = pPos[m + q]; pVel[k + q] = pVel[m + q]; }
    pLife[i] = pLife[l]; pMax[i] = pMax[l]; pS0[i] = pS0[l]; pGrow[i] = pGrow[l]; pKind[i] = pKind[l]; pDrag[i] = pDrag[l];
  }
  function burst(p, n, kind, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const v = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      spawnP(p[0], p[1], p[2], v.x, v.y, v.z, life * (0.5 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), 1.5, kind, 1.6);
    }
  }
  function breathFx(from, f, vel, dt) {
    const n = Math.ceil(dt * 70);
    for (let i = 0; i < n; i++) {
      const sp = 0.12, s = 62 + Math.random() * 12;
      spawnP(from.x, from.y, from.z, (f[0] + (Math.random() - .5) * sp) * s + vel[0] * 0.9, (f[1] + (Math.random() - .5) * sp) * s + vel[1] * 0.9, (f[2] + (Math.random() - .5) * sp) * s + vel[2] * 0.9, 0.55 + Math.random() * 0.2, 1.1, 4.5, 0, 1.1);
    }
  }
  function updateParticles(dt) {
    for (let i = 0; i < pN; i++) {
      pLife[i] -= dt;
      if (pLife[i] <= 0) { killP(i); i--; continue; }
      const k = i * 3, dr = Math.max(0, 1 - pDrag[i] * dt);
      pVel[k] *= dr; pVel[k + 1] *= dr; pVel[k + 2] *= dr;
      pPos[k] += pVel[k] * dt; pPos[k + 1] += pVel[k + 1] * dt; pPos[k + 2] += pVel[k + 2] * dt;
      const t = pLife[i] / pMax[i], kind = pKind[i];
      pS[i] = pS0[i] * (1 + pGrow[i] * (1 - t));
      pA[i] = Math.min(1, t * 1.6) * (kind === 2 ? 1 : 0.85);
      if (kind === 0) { pCol[k] = 1; pCol[k + 1] = 0.18 + 0.75 * t * t; pCol[k + 2] = 0.05 + 0.45 * t * t * t; }
      else if (kind === 1) { pCol[k] = 0.55 + 0.4 * t; pCol[k + 1] = 0.25 + 0.5 * t * t; pCol[k + 2] = 1; }
      else { pCol[k] = 1; pCol[k + 1] = 0.9 * t + 0.4 * (1 - t); pCol[k + 2] = 0.5 * t; }
    }
    pGeo.setDrawRange(0, pN);
    ['position', 'pcolor', 'alpha', 'size'].forEach(n => { pGeo.attributes[n].needsUpdate = true; });
  }

  /* ---------- view state (what this browser draws) ---------- */
  const fbGeo = new THREE.IcosahedronGeometry(1, 1);
  const fbMatP = new THREE.MeshBasicMaterial({ color: 0xffd27a }), fbMatE = new THREE.MeshBasicMaterial({ color: 0xe9c6ff });
  const ballViews = new Map();
  const view = { players: new Map(), foes: new Map(), myId: 0, myColor: 0, wave: 0, score: 0, cd: 0, over: false, hp: 100, myDown: false, rows: [], names: {} };
  let mode = 'lobby', role = null, world = null, pilot = S.newPilot([0, 90, 0]), hero = makeDragon(PALETTES[0]);
  scene.add(hero.root);
  let peer = null, hostConn = null, roomCode = '', nextId = 2, outbox = [], netT = 0, menuOpen = false, lastSnapAt = 0;
  const PEER_TIMEOUT = 15000;
  const guests = new Map();
  let time = 0, shake = 0, hurt = 0, bannerT = 0;

  function remoteView(map, id, palette, scale) {
    let e = map.get(id);
    if (!e) {
      const d = makeDragon(palette); d.root.scale.setScalar(scale); scene.add(d.root);
      e = { d, pos: new V3(), tp: new V3(), vel: new V3(), yaw: 0, pitch: 0, roll: 0, ty: 0, tpi: 0, tr: 0, t: 0, age: 0, init: false, phase: Math.random() * 6 };
      map.set(id, e);
    }
    return e;
  }
  function setTarget(e, x, y, z, yaw, pitch, roll, t) {
    if (!e.init) { e.pos.set(x, y, z); e.tp.set(x, y, z); e.yaw = yaw; e.pitch = pitch; e.roll = roll; e.init = true; }
    else { const dts = t - e.t; if (dts > 0.001) e.vel.set((x - e.tp.x) / dts, (y - e.tp.y) / dts, (z - e.tp.z) / dts); e.tp.set(x, y, z); }
    e.t = t; e.age = 0; e.ty = yaw; e.tpi = pitch; e.tr = roll;
  }
  const lerpAngle = (a, b, k) => a + S.wrap(b - a) * k;
  function smooth(e, dt) {
    e.age += dt;
    const k = 1 - Math.exp(-dt * 14), lead = Math.min(e.age, 0.25);
    e.pos.lerp(tmpV.copy(e.tp).addScaledVector(e.vel, lead), k);
    e.yaw = lerpAngle(e.yaw, e.ty, k); e.pitch += (e.tpi - e.pitch) * k; e.roll = lerpAngle(e.roll, e.tr, k);
    e.d.root.position.copy(e.pos); e.d.root.rotation.set(-e.pitch, e.yaw, e.roll, 'YXZ');
  }
  const tmpV = new V3(), mouthW = new V3(), fwdV = new V3();

  function applySnapshot(s) {
    view.wave = s.w; view.score = s.s; view.cd = s.cd; view.rows = s.P;
    const seenP = new Set();
    s.P.forEach(r => {
      const [id, x, y, z, yaw, pitch, roll, rx, br, hp, down, color, name, sx] = r;
      view.names[id] = name;
      if (id === view.myId) { view.hp = hp; view.myDown = !!down; return; }
      seenP.add(id);
      const e = remoteView(view.players, id, PALETTES[color % PALETTES.length], 1);
      setTarget(e, x, y, z, yaw, pitch, roll + rx, s.t);
      e.br = !!br; e.hp = hp; e.down = !!down; e.name = name; e.color = color; e.sx = sx;
    });
    view.players.forEach((e, id) => { if (!seenP.has(id)) { e.d.dispose(); view.players.delete(id); } });
    const seenF = new Set();
    s.F.forEach(r => {
      const [id, x, y, z, yaw, pitch, roll, hp, max, dead, mouth] = r;
      seenF.add(id);
      const e = remoteView(view.foes, id, CRIMSON, 0.72);
      setTarget(e, x, y, z, yaw, pitch, roll, s.t);
      e.hp = hp; e.max = max; e.dead = !!dead; e.mouth = !!mouth;
    });
    view.foes.forEach((e, id) => { if (!seenF.has(id)) { e.d.dispose(); view.foes.delete(id); } });
  }
  const nameOf = id => (id === view.myId ? t('mp.you') : (view.names[id] || t('mp.aDragon')));
  function applyEvents(evs) {
    evs.forEach(ev => {
      switch (ev.e) {
        case 'ball': {
          const m = new THREE.Mesh(fbGeo, ev.o === 0 ? fbMatE : fbMatP); m.scale.setScalar(ev.o === 0 ? 0.75 : 0.9);
          m.position.set(ev.p[0], ev.p[1], ev.p[2]); scene.add(m);
          ballViews.set(ev.id, { m, v: new V3(ev.v[0], ev.v[1], ev.v[2]), o: ev.o, life: 5 });
          if (ev.o === 0) burst(ev.p, 8, 1, 6, 1.2, 0.3);
          break;
        }
        case 'pop': {
          const b = ballViews.get(ev.id); if (b) { scene.remove(b.m); ballViews.delete(ev.id); }
          burst(ev.p, ev.h ? 40 : 12, ev.o === 0 ? 1 : 0, ev.h ? 20 : 8, 2.2, 0.6);
          break;
        }
        case 'hit': { const f = view.foes.get(ev.f); if (f) f.d.flash = 1; break; }
        case 'die':
          burst(ev.p, 30, 0, 18, 2, 0.7);
          feed(ev.by === view.myId ? t('mp.feed.youKill', { p: ev.pts }) : t('mp.feed.kill', { name: nameOf(ev.by), p: ev.pts }), ev.by === view.myId);
          break;
        case 'boom':
          burst(ev.p, 60, 0, 26, 2.8, 1.0); burst(ev.p, 25, 2, 18, 1.4, 0.8);
          if (pilot && Math.hypot(ev.p[0] - pilot.pos[0], ev.p[1] - pilot.pos[1], ev.p[2] - pilot.pos[2]) < 80) shake = Math.max(shake, 0.15);
          break;
        case 'hurt':
          if (ev.pl === view.myId) { hurt = 1; shake = Math.max(shake, 0.5); hero.flash = 1; }
          else { const p = view.players.get(ev.pl); if (p) p.d.flash = 1; }
          break;
        case 'down':
          if (ev.pl === view.myId) { pilot.down = true; showBanner(t('mp.youDown'), t('mp.backIn', { t: ev.t })); }
          else feed(t('mp.feed.down', { name: ev.name }));
          break;
        case 'spawn':
          if (ev.pl === view.myId) {
            const st = pilot.st; pilot = S.newPilot(ev.p); pilot.st = st; pilot.inv = 2;
            camPos.set(ev.p[0], ev.p[1] + 8, ev.p[2] - 22);
          }
          break;
        case 'join': if (ev.pl !== view.myId) feed(t('mp.feed.join', { name: ev.name })); break;
        case 'left': feed(t('mp.feed.left', { name: ev.name })); break;
        case 'wave': showBanner(t('banner.wave', { n: ev.n }), t('banner.waveFoes', { n: ev.count })); break;
        case 'clear': showBanner(t('banner.cleared', { n: ev.n }), t('banner.vit30')); break;
        case 'over':
          view.over = true;
          $('#overText').textContent = t('mp.over.text', { s: ev.score, w: ev.wave });
          $('#againBtn').hidden = role !== 'host';
          $('#overText').textContent += role === 'host' ? '' : t('mp.over.wait');
          $('#over').hidden = false;
          break;
        case 'restart':
          view.over = false; $('#over').hidden = true;
          ballViews.forEach(b => scene.remove(b.m)); ballViews.clear();
          showBanner(t('btn.again'), t('mp.wave1in'));
          break;
      }
    });
  }

  /* ---------- HUD helpers ---------- */
  const banner = $('#banner'), feedEl = $('#feed');
  function showBanner(a, b) { banner.textContent = a; if (b) { const s = document.createElement('small'); s.textContent = b; banner.appendChild(s); } banner.style.opacity = 1; bannerT = 2.4; }
  function feed(text, mine) {
    const d = document.createElement('div'); d.textContent = text; if (mine) d.style.color = 'var(--ember)';
    feedEl.prepend(d);
    while (feedEl.children.length > 4) feedEl.lastChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 3800);
  }
  function renderTeam() {
    const el = $('#team'); el.textContent = '';
    view.rows.forEach(r => {
      const [id, , , , , , , , , hp, down, color, name] = r;
      const row = document.createElement('div'); if (down) row.className = 'down';
      const dot = document.createElement('i'); dot.style.background = PALETTES[color % PALETTES.length].ui;
      const b = document.createElement('b'); b.textContent = name + (id === view.myId ? t('mp.youTag') : '');
      const em = document.createElement('em'); em.textContent = down ? t('mp.downTag') : t('mp.hp', { n: hp });
      row.append(dot, b, em); el.appendChild(row);
    });
  }

  /* ---------- input ---------- */
  const keys = {}, touch = { x: 0, y: 0, breath: false, boost: false };
  let mouseBreath = false;
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  addEventListener('keydown', e => {
    if (typing()) { if (e.code === 'Enter' && document.activeElement === $('#codeIn')) $('#joinBtn').click(); return; }
    if (mode !== 'game') return;
    if (e.code === 'Escape') { toggleMenu(); return; }
    if (e.repeat && (e.code === 'KeyF' || e.code === 'KeyQ' || e.code === 'KeyE')) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (menuOpen) return;
    if (e.code === 'KeyF') fireBall();
    if (e.code === 'KeyQ') S.tryRoll(pilot, -1);
    if (e.code === 'KeyE') S.tryRoll(pilot, 1);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseBreath = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'game' || menuOpen || e.pointerType !== 'mouse') return;
    if (e.button === 0) mouseBreath = true;
    if (e.button === 2) fireBall();
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseBreath = false; });
  const stick = $('#stick'), nub = $('#nub'); let stickId = null;
  function stickMove(e) { const r = stick.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const R = r.width / 2 - 10, l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; touch.x = dx / R; touch.y = -dy / R; }
  stick.addEventListener('pointerdown', e => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; touch.x = touch.y = 0; nub.style.transform = ''; };
  stick.addEventListener('pointerup', stickEnd); stick.addEventListener('pointercancel', stickEnd);
  function holdBtn(id, prop) {
    const b = $(id);
    const on = e => { e.preventDefault(); touch[prop] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) { } };
    const off = () => { touch[prop] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  }
  holdBtn('#bBreath', 'breath'); holdBtn('#bBoost', 'boost');
  $('#bBall').addEventListener('pointerdown', e => { e.preventDefault(); fireBall(); });
  $('#bRoll').addEventListener('pointerdown', e => { e.preventDefault(); S.tryRoll(pilot, touch.x < -0.2 ? -1 : 1); });
  function readInput() {
    if (menuOpen || view.over) return { sx: 0, sy: 0, breath: false, boost: false };
    return {
      sx: S.clamp(((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + touch.x, -1, 1),
      sy: S.clamp(((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) + touch.y, -1, 1),
      breath: !!(keys.Space || mouseBreath || touch.breath),
      boost: !!(keys.ShiftLeft || keys.ShiftRight || touch.boost),
    };
  }
  function fireBall() {
    if (mode !== 'game' || menuOpen || !S.tryBall(pilot)) return;
    const f = S.fwd(pilot.yaw, pilot.pitch); fwdV.set(f[0], f[1], f[2]);
    let best = null, bestA = 0.38;
    view.foes.forEach(e => {
      if (e.dead) return;
      tmpV.subVectors(e.pos, mouthW); const d = tmpV.length(); if (d > 220) return;
      const a = tmpV.normalize().angleTo(fwdV); if (a < bestA) { bestA = a; best = e; }
    });
    const dir = fwdV.clone();
    if (best) { const t = best.pos.distanceTo(mouthW) / S.BALL_SPEED.player; dir.copy(best.pos).addScaledVector(best.vel, t).sub(mouthW).normalize(); }
    const from = [mouthW.x, mouthW.y, mouthW.z], d = [dir.x, dir.y, dir.z];
    if (role === 'host') S.shoot(world, view.myId, from, d);
    else if (hostConn && hostConn.open) hostConn.send({ k: 'b', f: from.map(v => Math.round(v * 100) / 100), d: d.map(v => Math.round(v * 1000) / 1000) });
    burst(from, 14, 0, 8, 1.6, 0.35);
    hero.jaw.rotation.x = 0.7;
  }

  /* ---------- networking ---------- */
  const status = $('#status');
  function setStatus(t, ok) { status.textContent = t; status.className = ok ? 'ok' : ''; }
  function setBusy(b) { $('#hostBtn').disabled = b; $('#joinBtn').disabled = b; }
  function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
  function myName() {
    const n = ($('#nameIn').value || '').trim().slice(0, 16) || PALETTES[0].name;
    try { localStorage.setItem('vsd-name', n); } catch (_) { }
    return n;
  }
  function inviteLink() { return location.origin + location.pathname + (roomCode ? '#' + roomCode : ''); }

  function hostGame() {
    const name = myName();
    setBusy(true);
    if (!window.Peer) { startHost(name, false); return; }
    setStatus(t('mp.opening'), true);
    let tries = 0;
    const attempt = () => {
      const code = makeCode();
      let opened = false;
      const p = new window.Peer(PREFIX + code, { debug: 1 });
      const timer = setTimeout(() => { if (!opened) { try { p.destroy(); } catch (_) { } startHost(name, false); } }, 10000);
      p.on('open', () => { opened = true; clearTimeout(timer); peer = p; roomCode = code; startHost(name, true); });
      p.on('connection', onGuestConn);
      p.on('disconnected', () => { if (peer === p) { try { p.reconnect(); } catch (_) { } } });
      p.on('error', err => {
        if (opened) { console.warn('peer error', err && err.type); return; }
        clearTimeout(timer);
        try { p.destroy(); } catch (_) { }
        if (err && err.type === 'unavailable-id' && tries++ < 3) attempt();
        else startHost(name, false);
      });
    };
    attempt();
  }
  function startHost(name, online) {
    role = 'host';
    world = S.newWorld();
    view.myId = 1; nextId = 2;
    const me = S.addPlayer(world, 1, name, 0);
    startGame(me.color, me.pos);
    if (online) showBanner(t('mp.roomBanner', { c: roomCode }), t('mp.sendLink'));
    else { roomCode = ''; showBanner(t('mp.soloFlight'), t('mp.noServerHost')); }
  }
  function onGuestConn(conn) {
    conn.on('data', m => onGuestMsg(conn, m));
    conn.on('close', () => dropGuest(conn));
    conn.on('error', () => dropGuest(conn));
  }
  function onGuestMsg(conn, m) {
    if (!m || typeof m !== 'object' || !world) return;
    const g = guests.get(conn.peer);
    if (g) g.last = performance.now();
    if (m.k === 'hi') {
      if (g) return;
      if (S.playerList(world).length >= S.MAX_PLAYERS) { conn.send({ k: 'full' }); setTimeout(() => conn.close(), 500); return; }
      const id = nextId++;
      const pl = S.addPlayer(world, id, String(m.name || 'Dragon'));
      guests.set(conn.peer, { conn, id, last: performance.now() });
      conn.send({ k: 'w', id, color: pl.color, p: pl.pos, code: roomCode });
    } else if (m.k === 'p' && g) S.setPose(world, g.id, m);
    else if (m.k === 'b' && g) S.shoot(world, g.id, m.f, m.d);
  }
  function dropGuest(conn) {
    const g = guests.get(conn.peer);
    if (!g) return;
    guests.delete(conn.peer);
    if (world) S.removePlayer(world, g.id);
  }

  function joinGame() {
    const code = ($('#codeIn').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) { setStatus(t('mp.badCode')); return; }
    if (!window.Peer) { setStatus(t('mp.noLib')); return; }
    const name = myName();
    setBusy(true); setStatus(t('mp.connecting', { c: code }), true);
    let welcomed = false, failed = false;
    const p = new window.Peer({ debug: 1 }); peer = p;
    const fail = msg => {
      if (failed || welcomed) return; failed = true; clearTimeout(timer);
      setStatus(msg); setBusy(false);
      try { p.destroy(); } catch (_) { }
    };
    const timer = setTimeout(() => fail(t('mp.unreachable', { c: code })), 15000);
    p.on('open', () => {
      const c = p.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      hostConn = c;
      c.on('open', () => c.send({ k: 'hi', name }));
      c.on('data', m => {
        if (!m || typeof m !== 'object') return;
        if (m.k === 'w') {
          if (welcomed) return;
          welcomed = true; clearTimeout(timer);
          role = 'guest'; roomCode = code; view.myId = m.id; lastSnapAt = performance.now();
          startGame(m.color, m.p);
          showBanner(t('mp.joined', { c: code }), t('mp.flyTeam'));
        } else if (m.k === 's') {
          lastSnapAt = performance.now();
          if (mode === 'game') { applyEvents(m.e || []); applySnapshot(m.s); }
        } else if (m.k === 'full') fail(t('mp.full', { c: code }));
      });
      c.on('close', () => { if (welcomed) showNotice(t('mp.hostLeft'), t('mp.hostLeftText')); else fail(t('mp.hostClosed')); });
    });
    p.on('disconnected', () => { if (welcomed) { try { p.reconnect(); } catch (_) { } } });
    p.on('error', err => {
      const et = err && err.type;
      if (welcomed) { console.warn('peer error', et); return; }
      if (et === 'peer-unavailable') fail(t('mp.noRoom', { c: code }));
      else if (et === 'network' || et === 'server-error' || et === 'socket-error') fail(t('mp.noServer'));
      else fail(t('mp.failed', { t: et || t('mp.unknown') }));
    });
  }

  function startGame(color, pos) {
    mode = 'game';
    view.myColor = color;
    hero.dispose();
    hero = makeDragon(PALETTES[color % PALETTES.length]); scene.add(hero.root);
    pilot = S.newPilot(pos);
    pilot.inv = 2;
    camPos.set(pos[0], pos[1] + 8, pos[2] - 22);
    camera.clearViewOffset();
    if (roomCode) history.replaceState(null, '', location.pathname + '#' + roomCode);
    $('#roomCode').textContent = roomCode || t('mp.solo'); $('#menuCode').textContent = roomCode || t('mp.solo');
    $('#roomChip').hidden = !roomCode;
    $('#lobby').hidden = true; $('#hudTop').hidden = false;
    $('#legend').hidden = isTouch; $('#touch').hidden = !isTouch;
    setStatus('');
  }
  function leave() {
    try { if (peer) peer.destroy(); } catch (_) { }
    history.replaceState(null, '', location.pathname);
    location.reload();
  }
  function showNotice(title, text) {
    $('#noticeTitle').textContent = title; $('#noticeText').textContent = text;
    $('#notice').hidden = false; $('#menu').hidden = true; $('#over').hidden = true; menuOpen = true;
  }
  function toggleMenu(force) {
    menuOpen = force == null ? !menuOpen : force;
    $('#menu').hidden = !menuOpen;
    $('#linkOut').value = roomCode ? inviteLink() : t('mp.soloLink');
    $('#copyBtn').disabled = !roomCode;
    if (menuOpen) mouseBreath = false;
  }
  function copyLink() {
    const link = inviteLink(), box = $('#linkOut');
    box.value = link;
    const fallback = () => { box.focus(); box.select(); feed(t('mp.feed.copyManual')); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(() => feed(t('mp.feed.copied')), fallback);
    else fallback();
  }

  $('#hostBtn').onclick = hostGame;
  $('#joinBtn').onclick = joinGame;
  $('#menuBtn').onclick = () => toggleMenu();
  $('#resumeBtn').onclick = () => toggleMenu(false);
  $('#roomChip').onclick = () => { toggleMenu(true); copyLink(); };
  $('#copyBtn').onclick = copyLink;
  $('#leaveBtn').onclick = leave; $('#leave2Btn').onclick = leave; $('#backBtn').onclick = leave;
  addEventListener('pagehide', () => { try { if (peer) peer.destroy(); } catch (_) { } });
  $('#againBtn').onclick = () => { if (role === 'host' && world) S.restart(world); };

  /* ---------- resize ---------- */
  let W = 1, Hh = 1, dpr = 1;
  function updateScale() { pMat.uniforms.uScale.value = (Hh * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); }
  function resize() {
    W = innerWidth; Hh = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.updateProjectionMatrix();
    hud.width = W * dpr; hud.height = Hh * dpr; updateScale();
  }
  addEventListener('resize', resize); resize();

  /* ---------- 2D HUD ---------- */
  const proj = new V3();
  function drawHud() {
    hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, W, Hh);
    if (mode !== 'game') return;
    const f = S.fwd(pilot.yaw, pilot.pitch);
    if (!pilot.down) {
      proj.set(pilot.pos[0] + f[0] * 60, pilot.pos[1] + f[1] * 60, pilot.pos[2] + f[2] * 60).project(camera);
      const cx = (proj.x + 1) / 2 * W, cy = (1 - proj.y) / 2 * Hh;
      hx.strokeStyle = 'rgba(235,227,205,.75)'; hx.lineWidth = 1.5; hx.beginPath(); hx.arc(cx, cy, 9, 0, Math.PI * 2); hx.moveTo(cx - 16, cy); hx.lineTo(cx - 11, cy); hx.moveTo(cx + 11, cy); hx.lineTo(cx + 16, cy); hx.stroke();
    }
    hx.font = '600 12px "Barlow Semi Condensed",sans-serif'; hx.textAlign = 'center';
    view.players.forEach(e => {
      proj.copy(e.pos).add(tmpV.set(0, 3.5, 0)).project(camera);
      if (proj.z > 1) return;
      const x = (proj.x + 1) / 2 * W, y = (1 - proj.y) / 2 * Hh;
      if (x < 0 || x > W || y < 0 || y > Hh) return;
      hx.fillStyle = 'rgba(12,19,16,.6)'; const tw = hx.measureText(e.name || '').width + 10; hx.fillRect(x - tw / 2, y - 15, tw, 16);
      hx.fillStyle = e.down ? '#e5484f' : PALETTES[e.color % PALETTES.length].ui; hx.fillText(e.name || '', x, y - 3);
    });
    view.foes.forEach(e => {
      if (e.dead) return;
      proj.copy(e.pos).project(camera);
      const behind = proj.z > 1; let x = (proj.x + 1) / 2 * W, y = (1 - proj.y) / 2 * Hh;
      if (!behind && x > 0 && x < W && y > 0 && y < Hh) {
        const d = e.pos.distanceTo(camera.position), s = Math.max(14, Math.min(46, 900 / d)), c = s * 0.35;
        hx.strokeStyle = 'rgba(229,72,79,.9)'; hx.lineWidth = 1.5; hx.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { hx.moveTo(x + a * s, y + b * s - b * c); hx.lineTo(x + a * s, y + b * s); hx.lineTo(x + a * s - a * c, y + b * s); });
        hx.stroke();
        hx.fillStyle = 'rgba(0,0,0,.45)'; hx.fillRect(x - s, y - s - 9, s * 2, 4);
        hx.fillStyle = '#e5484f'; hx.fillRect(x - s, y - s - 9, s * 2 * Math.max(0, e.hp / e.max), 4);
      } else {
        if (behind) { x = W - x; y = Hh - y; }
        const ang = Math.atan2(y - Hh / 2, x - W / 2), m = 36;
        const px = Math.max(m, Math.min(W - m, W / 2 + Math.cos(ang) * (W / 2 - m))), py = Math.max(m + 60, Math.min(Hh - m - (isTouch ? 150 : 40), Hh / 2 + Math.sin(ang) * (Hh / 2 - m)));
        hx.save(); hx.translate(px, py); hx.rotate(ang); hx.fillStyle = 'rgba(229,72,79,.85)'; hx.beginPath(); hx.moveTo(10, 0); hx.lineTo(-6, -7); hx.lineTo(-6, 7); hx.closePath(); hx.fill(); hx.restore();
      }
    });
    // radar: forward is up, 250 m range
    const R = 52, rx = isTouch ? W - R - 18 : W - R - 20, ry = isTouch ? 170 + R : Hh - R - 20;
    hx.fillStyle = 'rgba(12,19,16,.6)'; hx.strokeStyle = 'rgba(235,227,205,.18)'; hx.lineWidth = 1;
    hx.beginPath(); hx.arc(rx, ry, R, 0, Math.PI * 2); hx.fill(); hx.stroke();
    hx.beginPath(); hx.arc(rx, ry, R / 2, 0, Math.PI * 2); hx.stroke();
    hx.fillStyle = PALETTES[view.myColor % PALETTES.length].ui; hx.beginPath(); hx.moveTo(rx, ry - 6); hx.lineTo(rx - 4, ry + 4); hx.lineTo(rx + 4, ry + 4); hx.closePath(); hx.fill();
    const cs = Math.cos(pilot.yaw), sn = Math.sin(pilot.yaw);
    const dot = (pos, color, r) => {
      const dx = pos.x - pilot.pos[0], dz = pos.z - pilot.pos[2];
      const lf = dx * sn + dz * cs, lr = -(dx * cs - dz * sn);
      let px = lr / 250 * R, py = -lf / 250 * R; const l = Math.hypot(px, py); if (l > R - 4) { px *= (R - 4) / l; py *= (R - 4) / l; }
      hx.fillStyle = color; hx.beginPath(); hx.arc(rx + px, ry + py, r, 0, Math.PI * 2); hx.fill();
    };
    view.foes.forEach(e => { if (!e.dead) dot(e.pos, '#e5484f', 3.2); });
    view.players.forEach(e => dot(e.pos, PALETTES[e.color % PALETTES.length].ui, 3.6));
    hx.fillStyle = 'rgba(235,227,205,.5)'; hx.font = '600 10px "Barlow Semi Condensed",sans-serif'; hx.fillText('250 m', rx, ry + R - 6);
  }

  /* ---------- simulation tick (host keeps ticking in background tabs) ---------- */
  function hostTick(dt) {
    S.setPose(world, view.myId, S.poseOf(pilot));
    S.stepWorld(world, dt);
    const ev = world.ev.splice(0);
    applyEvents(ev);
    for (const e of ev) outbox.push(e);
    netT += dt;
    if (netT >= NET_DT) {
      netT = 0;
      const now = performance.now();
      guests.forEach(g => { if (now - g.last > PEER_TIMEOUT) { try { g.conn.close(); } catch (_) { } dropGuest(g.conn); } });
      const msg = { k: 's', s: S.snapshot(world), e: outbox }; outbox = [];
      guests.forEach(g => { if (g.conn.open) { try { g.conn.send(msg); } catch (_) { } } });
    }
  }
  let bgLast = 0;
  setInterval(() => {
    // requestAnimationFrame stops in hidden tabs; keep the host's world (and everyone's game) running
    if (!document.hidden || mode !== 'game') { bgLast = 0; return; }
    const now = performance.now();
    let el = bgLast ? Math.min(1, (now - bgLast) / 1000) : NET_DT; bgLast = now;
    while (el > 0) { const d = Math.min(0.05, el); el -= d; S.stepPilot(pilot, { sx: 0, sy: 0 }, d); if (role === 'host') hostTick(d); }
    if (role === 'guest' && hostConn && hostConn.open) { try { hostConn.send(Object.assign({ k: 'p' }, S.poseOf(pilot))); } catch (_) { } }
  }, 50);

  /* ---------- main loop ---------- */
  const camPos = new V3(0, 100, -30), camLook = new V3();
  let last = performance.now(), lastHp = -1, lastSt = -1, teamT = 0, lobbyTh = 0.9;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    time += dt;
    clouds.forEach((c, i) => { c.position.x += dt * (1.5 + i % 3); if (c.position.x > 560) c.position.x = -560; });

    if (mode === 'lobby') {
      pilot.phase = (pilot.phase || 0) + dt * 3.4;
      hero.root.position.set(0, 90, 0); hero.root.rotation.set(0, 0, 0);
      const breathe = Math.sin(time * 0.7) > 0.86;
      hero.anim(time, dt, { phase: pilot.phase, amp: 1, mouth: breathe, look: Math.sin(time * 0.5) });
      hero.root.updateMatrixWorld(true); hero.mouth.getWorldPosition(mouthW);
      if (breathe) for (let i = 0; i < 2; i++) spawnP(mouthW.x, mouthW.y, mouthW.z, (Math.random() - .5) * 4, -3 + (Math.random() - .5) * 4, 30, 0.6, 0.7, 4, 0, 1.2);
      lobbyTh += dt * 0.22;
      const tgt = new V3(0, 90.2, 0.3);
      camera.position.set(tgt.x + Math.sin(lobbyTh) * Math.cos(0.25) * 28, tgt.y + Math.sin(0.25) * 28, tgt.z + Math.cos(lobbyTh) * Math.cos(0.25) * 28);
      camera.lookAt(tgt);
      if (W > 720) camera.setViewOffset(W, Hh, -185, 0, W, Hh); else camera.setViewOffset(W, Hh, 0, Hh * 0.24, W, Hh);
    } else {
      // my dragon
      if (view.myDown && !pilot.down) pilot.down = true;
      S.stepPilot(pilot, readInput(), dt);
      hero.root.position.set(pilot.pos[0], pilot.pos[1], pilot.pos[2]);
      hero.root.rotation.set(-pilot.pitch, pilot.yaw, pilot.roll + pilot.rollX, 'YXZ');
      const glide = pilot.pitch < -0.25 && !pilot.boosting;
      pilot.phase = (pilot.phase || 0) + dt * (pilot.down ? 2 : pilot.boosting ? 9 : glide ? 3 : 6.2);
      hero.anim(time, dt, { phase: pilot.phase, amp: pilot.down ? 0.3 : glide ? 0.35 : pilot.boosting ? 1.1 : 1, mouth: pilot.breathing, turn: -pilot.sx });
      hero.root.visible = !(pilot.inv > 0 && !pilot.down && pilot.rollT <= 0 && Math.floor(time * 12) % 2 === 0);
      hero.root.updateMatrixWorld(true); hero.mouth.getWorldPosition(mouthW);
      if (pilot.breathing) breathFx(mouthW, S.fwd(pilot.yaw, pilot.pitch), pilot.vel, dt);

      if (role === 'host') { hostTick(dt); applySnapshot(S.snapshot(world)); }
      else {
        if (lastSnapAt && performance.now() - lastSnapAt > PEER_TIMEOUT && $('#notice').hidden) showNotice(t('mp.lost'), t('mp.lostText'));
        netT += dt;
        if (netT >= NET_DT) { netT = 0; if (hostConn && hostConn.open) { try { hostConn.send(Object.assign({ k: 'p' }, S.poseOf(pilot))); } catch (_) { } } }
      }

      // teammates and wyverns
      view.players.forEach(e => {
        smooth(e, dt);
        e.phase += dt * (e.down ? 2 : 6.2);
        e.d.anim(time, dt, { phase: e.phase, amp: e.down ? 0.3 : e.tpi < -0.25 ? 0.4 : 1, mouth: e.br, turn: -(e.sx || 0) });
        if (e.br && !e.down) { e.d.root.updateMatrixWorld(true); e.d.mouth.getWorldPosition(tmpV); breathFx(tmpV.clone(), S.fwd(e.yaw, e.pitch), [e.vel.x, e.vel.y, e.vel.z], dt); }
      });
      view.foes.forEach(e => {
        smooth(e, dt);
        e.phase += dt * (e.dead ? 2 : 7);
        e.d.anim(time, dt, { phase: e.phase, amp: e.dead ? 0.3 : 1, mouth: e.mouth, turn: -e.roll });
        if (e.dead && Math.random() < 0.6) spawnP(e.pos.x, e.pos.y, e.pos.z, (Math.random() - .5) * 3, 4, (Math.random() - .5) * 3, 0.9, 2.2, 2, 0, 0.5);
      });
      ballViews.forEach((b, id) => {
        b.m.position.addScaledVector(b.v, dt); b.life -= dt;
        const p = b.m.position;
        for (let k = 0; k < 3; k++) spawnP(p.x + (Math.random() - .5) * .6, p.y + (Math.random() - .5) * .6, p.z + (Math.random() - .5) * .6, b.v.x * 0.05, b.v.y * 0.05 + 1, b.v.z * 0.05, 0.45, b.o === 0 ? 2 : 2.4, 1.2, b.o === 0 ? 1 : 0, 1);
        if (b.life <= 0) { scene.remove(b.m); ballViews.delete(id); }
      });

      // chase camera
      const back = new V3(Math.sin(pilot.yaw), 0, Math.cos(pilot.yaw));
      const desired = new V3(pilot.pos[0], pilot.pos[1], pilot.pos[2]).addScaledVector(back, -22).add(new V3(0, 7 - pilot.pitch * 6, 0));
      desired.y = Math.max(desired.y, S.H(desired.x, desired.z) + 3);
      camPos.lerp(desired, 1 - Math.exp(-dt * 4.5));
      const f = S.fwd(pilot.yaw, pilot.pitch);
      camLook.set(pilot.pos[0] + f[0] * 12, pilot.pos[1] + f[1] * 12 + 2, pilot.pos[2] + f[2] * 12);
      camera.position.copy(camPos);
      if (shake > 0 && !reduceMotion) { camera.position.x += (Math.random() - .5) * shake * 2; camera.position.y += (Math.random() - .5) * shake * 2; }
      shake = Math.max(0, shake - dt * 1.5);
      camera.lookAt(camLook);
      const fovT = pilot.boosting ? 72 : 60;
      if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); updateScale(); }

      // DOM HUD
      const hp = Math.round(view.hp), st = Math.round(pilot.st);
      if (hp !== lastHp) { $('#hpFill').style.transform = 'scaleX(' + hp / 100 + ')'; lastHp = hp; }
      if (st !== lastSt) { $('#stFill').style.transform = 'scaleX(' + st / 100 + ')'; lastSt = st; }
      $('#wave').textContent = view.wave || '-';
      $('#score').textContent = view.score;
      let alive = 0; view.foes.forEach(e => { if (!e.dead) alive++; });
      $('#foes').textContent = view.wave === 0 ? (view.cd > 0 ? t('mp.startsIn', { n: view.cd }) : t('mp.getReady')) : t('hud.foes', { n: alive });
      teamT -= dt; if (teamT <= 0) { teamT = 0.3; renderTeam(); }
      hurt = Math.max(0, hurt - dt * 1.8);
      $('#vignette').style.opacity = Math.max(hurt, view.hp < 30 && !pilot.down ? 0.35 + Math.sin(time * 5) * 0.15 : 0);
    }
    updateParticles(dt);
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) banner.style.opacity = 0; }
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    drawHud();
  }

  /* ---------- boot ---------- */
  if (/[?&]debug\b/.test(location.search)) window.__vsd = { get world() { return world; }, get pilot() { return pilot; }, view, S };
  try { const n = localStorage.getItem('vsd-name'); if (n) $('#nameIn').value = n; } catch (_) { }
  const invited = location.hash.slice(1).toUpperCase();
  const lobbyStatus = () => {
    if (/^[A-Z0-9]{5}$/.test(invited)) setStatus(t('mp.invited', { c: invited }), true);
    if (!window.Peer) setStatus(t('mp.noLibSolo'));
  };
  if (/^[A-Z0-9]{5}$/.test(invited)) $('#codeIn').value = invited;
  lobbyStatus();
  // The language switch lives in the lobby; refresh the one message that may be showing there.
  if (window.I18N) I18N.onChange(() => { if (mode === 'lobby') { setStatus(''); lobbyStatus(); } });
  $('#loading').remove();
  $('#lobby').hidden = false;
  requestAnimationFrame(frame);
})();
