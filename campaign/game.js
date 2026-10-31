/*
 * Verdigris campaign - client: rendering, input, main loop, HUD and panels.
 * All game rules live in core/ (window.VCamp); this file only draws and wires input.
 * Built up task by task (T01 scaffold, T02 dragon, T04 terrain, T05 flight, ...);
 * see ai_sdlc/001_campaign/001_task_survival.md.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const t = (k, p) => (window.I18N ? I18N.t(k, p) : k);
  if (!window.THREE || !window.VCamp || !window.VDragon || !window.VRender) { $('#loading').textContent = t('c.engineFail'); return; }
  const C = window.VCamp, D = C.need('data'), F = C.need('flight'), TR = C.need('terrain'), G = C.need('growth'), HN = C.need('hunger'), PR = C.need('prey'), MT = C.need('math'), ST = C.need('state'), RG = C.need('region'), LR = C.need('lair'), SV = C.need('save'), CT = C.need('controls'), MO = C.need('mother'), WK = C.need('walk'), NV = C.need('nav'), CV = C.need('cave'), SE = C.need('settlement');
  const V3 = THREE.Vector3;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  /* Build label: bump on every push so a tester can see which build is running (debug panel + intro footer). */
  const BUILD = 't113.1 2026-10-31 building fire: ignite, burn, spread, ruins, rebuild';
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } };

  /* ---------- renderer / scene (same look as the duel) ---------- */
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const FOG = { near: 400, far: 950 };                         // high tier; quality.settings scales it per tier
  /* Quality tier (T102): ?q=low|mid|high|auto, else the stored choice, else touch measures fps in the first play seconds. */
  const QL = C.need('quality');
  const qPick = QL.pick({ param: params.get('q'), stored: store(D.quality.storeKey), isTouch });
  let qTier = qPick.tier, qSource = qPick.source, qSet = QL.settings(qTier, window.devicePixelRatio, FOG);
  let qSampler = qPick.auto ? QL.sampler() : null;
  renderer.setPixelRatio(qSet.pixelRatio);
  scene.fog = new THREE.Fog(0x7d6a58, qSet.fogNear, qSet.fogFar);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  const sunDir = new V3(-0.55, 0.16, -0.82).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x15202a) }, mid: { value: new THREE.Color(0x4a4a48) }, bot: { value: new THREE.Color(0xc07a4a) }, sun: { value: sunDir } },
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top,mid,bot,sun;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.?mix(mix(bot,mid,smoothstep(0.,.2,h)),top,smoothstep(.2,.75,h)):mix(bot,mid*.55,smoothstep(0.,-.25,h));float s=max(dot(vP,sun),0.);c+=vec3(1.,.82,.55)*(pow(s,600.)*2.5+pow(s,10.)*.28);gl_FragColor=vec4(c,1.);}',
  }));
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xa6cbc4, 0x3b2a1a, 0.85); scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xffc68c, 1.3); sunLight.position.copy(sunDir).multiplyScalar(300); scene.add(sunLight);
  const rim = new THREE.DirectionalLight(0x7fb7ff, 0.35); rim.position.set(200, 120, 250); scene.add(rim);

  /* ---------- region: chunked terrain, flora, lava, lair mouth (rebuilt when the dragon travels, T11) ---------- */
  let region = null, regionId = null, preyView = null, townView = null;   // townView: settlements (T12)
  const fireLights = [0, 1].map(() => { const L = new THREE.PointLight(0xff7a2a, 0, 70, 2); scene.add(L); return L; });   // T13: 2 flicker lights, always in the scene (no shader recompile)
  let caveOn = null;                                           // T10: the cave scene is shown (syncScene), null = re-apply
  const rng = MT.mulberry((Math.random() * 1e9) | 0);          // gameplay randomness (core stays deterministic in tests)
  const startId = D.regions[params.get('region')] ? params.get('region') : D.startRegion;

  /* ---------- save (core/save.js): load on start, autosave on core 'save' events, Continue / New on the intro ---------- */
  const NO_STORAGE = { getItem: () => null, setItem() { throw new Error('no storage'); }, removeItem() {} };
  const storage = (() => { try { return window.localStorage || NO_STORAGE; } catch (_) { return NO_STORAGE; } })();
  const boot = SV.load(storage);                               // { status: 'none' | 'ok' | 'corrupt' | 'newer', data }
  let saveBad = boot.status === 'corrupt' || boot.status === 'newer' ? boot.status : null;   // unread save: ask before touching it
  let saveOff = !!saveBad;                                     // never overwrite a save we could not read (until "Start new")
  let saved = boot.status === 'ok' ? boot.data : null;         // the run to continue (this session's last save, in memory)
  let lastSave = null;                                         // { why, ok, at } for the debug panel
  const bootRegion = saved && D.regions[saved.world && saved.world.region] ? saved.world.region : startId;
  const cs = ST.create({ regionId: bootRegion, rng });         // the whole run: dragon, prey field, flags, stats
  const dragon = cs.dragon;
  function loadRegion(id) {
    if (region) region.dispose();
    if (preyView) preyView.dispose();
    if (townView) townView.dispose();
    regionId = id;
    region = VRender.terrain.build(id, { isTouch, flora: qSet.flora, far: qSet.fogFar });
    scene.add(region.group);
    if (cs.region !== id || !cs.field) ST.enterRegion(cs, id);
    preyView = VRender.prey.build();
    scene.add(preyView.group);
    townView = VRender.settlements.build(ST.ensureTown(cs));         // T12: buildings and pens of the region
    scene.add(townView.group);
    scene.fog.color.set(region.fog); caveOn = null;
    const u = sky.material.uniforms;
    u.top.value.set(region.sky.top); u.mid.value.set(region.sky.mid); u.bot.value.set(region.sky.bot);
    $('#regionText').textContent = t(TR.region(id).nameKey);
  }
  loadRegion(bootRegion);
  /** After core moved cs to another region (region:enter): rebuild the scene behind a short fade. */
  function swapRegion(quiet) {
    const t0 = performance.now();
    fadeEl.classList.add('now');
    loadRegion(cs.region);
    region.update(new V3(pilot.pos[0], pilot.pos[1], pilot.pos[2]), time);
    snapCam();
    lastSwapMs = performance.now() - t0;
    requestAnimationFrame(() => fadeEl.classList.remove('now'));
    if (!quiet) toast(t(TR.region(cs.region).nameKey), t('c.toast.enterSub'), 2.5);
  }
  const fadeEl = $('#fade');
  let lastSwapMs = 0;

  /* ---------- quality tier changes (T102): auto tier after the touch fps sample, debug cycle ---------- */
  if (qSource === 'url') store(D.quality.storeKey, qTier);         // ?q=low|mid|high sticks for the next visits
  let qAutoFps = null;                                           // fps the auto tier was picked from (debug panel)
  /** Switches to `tier`, stores it and rebuilds the region (flora, view distance) behind a short fade. */
  function applyQuality(tier, src) {
    const old = qSet;
    qTier = tier; qSource = src; qSet = QL.settings(tier, window.devicePixelRatio, FOG);
    store(D.quality.storeKey, tier);
    renderer.setPixelRatio(qSet.pixelRatio); resize();
    scene.fog.near = qSet.fogNear; scene.fog.far = qSet.fogFar; caveOn = null;
    if (old.flora === qSet.flora && old.fogFar === qSet.fogFar) return;
    fadeEl.classList.add('now');
    loadRegion(regionId);
    region.update(camera.position, time);
    requestAnimationFrame(() => fadeEl.classList.remove('now'));
  }
  /** Touch auto tier: real frame times (not the clamped sim dt) during play only. */
  function sampleQuality(rawDt) {
    if (!qSampler || state !== 'play') return;
    const tier = QL.sample(qSampler, Math.min(rawDt, 0.5));
    if (!tier) return;
    qAutoFps = qSampler.fps;
    if (tier !== qTier) applyQuality(tier, 'auto'); else { qSource = 'auto'; store(D.quality.storeKey, tier); }
  }

  /* ---------- the hatchling ---------- */
  const hero = VDragon.makeDragon(VDragon.GREEN);
  scene.add(hero.root);
  /* the mother (T05, core/mother.js): same model, older bronze-green scales (as in the hatching scene), much bigger */
  const mom = VDragon.makeDragon({ body: 0x2c6450, dark: 0x173a30, belly: 0xb09c66, wing: 0x346e5a, horn: 0xd8c9a8, eye: 0xffb43a });
  mom.root.scale.setScalar(D.mother.scale); mom.root.visible = false; scene.add(mom.root);
  let momPhase = 0, momAcc = 0;
  /* the cave hall (T10, render/cave-view.js): shown instead of the region while cs.inLair; the region stays loaded */
  const caveView = VRender.cave.build();
  scene.add(caveView.group);
  const OUT_LIGHT = { hemi: hemi.intensity, sun: sunLight.intensity, rim: rim.intensity };
  /** Region <-> cave: visibility, outdoor lights (intensity only, so no shader recompile) and fog. Every frame, cheap. */
  function syncScene() {
    const inCave = !!pilot && cs.inLair && state !== 'intro';
    caveView.group.visible = inCave;
    if (region) region.group.visible = !inCave;
    if (preyView) preyView.group.visible = !inCave;
    if (townView) townView.group.visible = !inCave;
    sky.visible = !inCave;
    if (inCave === caveOn) return;
    caveOn = inCave;
    hemi.intensity = inCave ? 0 : OUT_LIGHT.hemi; sunLight.intensity = inCave ? 0 : OUT_LIGHT.sun; rim.intensity = inCave ? 0 : OUT_LIGHT.rim;
    if (inCave) { scene.fog.color.set(0x120a07); scene.fog.near = 40; scene.fog.far = 260; }
    else { if (region) scene.fog.color.set(region.fog); scene.fog.near = qSet.fogNear; scene.fog.far = qSet.fogFar; }
  }
  let stats = G.statsOf(0), heroScale = 1;
  let pilot = null, phase = 0;
  const heroPose = {};                                          // T07 legs / wings / walk cycle state (walk.pose)
  function refreshStage() {
    stats = G.statsOf(dragon.stage);
    heroScale = ST.scaleOf(cs);                                 // (debug B: Elder size in the cave)
    hero.root.scale.setScalar(heroScale);
    $('#stageText').textContent = t('c.stage.' + D.stages[dragon.stage].id);
  }

  /* ---------- fire particles: breath stream and roast embers (additive points, fixed pool) ---------- */
  const PN = 900;
  const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN);
  const pKind = new Uint8Array(PN);                               // 0 breath, 1 ember
  for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -9999;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const pMat = new THREE.PointsMaterial({ size: 3.4, map: pTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  let pNext = 0, pAcc = 0;
  function spawnP(x, y, z, vx, vy, vz, life, kind) {
    const i = pNext; pNext = (pNext + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pLife[i] = life; pMax[i] = life; pKind[i] = kind;
  }
  function breathParticles(dt, p) {
    if (!p.breathing) { pAcc = 0; return; }
    hero.mouth.getWorldPosition(mouthW);
    const c = Math.cos(p.pitch), aim = cs.breath && cs.breath.dir;       // follow the aimed cone from core
    const dx = aim ? aim[0] : Math.sin(p.yaw) * c, dy = aim ? aim[1] : Math.sin(p.pitch), dz = aim ? aim[2] : Math.cos(p.yaw) * c;
    const sp = 55 * Math.sqrt(heroScale), spread = 0.22;
    pAcc += dt * 190 * qSet.particles;
    while (pAcc >= 1) {
      pAcc--;
      const jx = (Math.random() - 0.5) * spread, jy = (Math.random() - 0.5) * spread, jz = (Math.random() - 0.5) * spread;
      const k = sp * (0.85 + Math.random() * 0.3);
      spawnP(mouthW.x, mouthW.y, mouthW.z, (dx + jx) * k + p.vel[0] * 0.85, (dy + jy) * k + p.vel[1] * 0.85, (dz + jz) * k + p.vel[2] * 0.85, 0.42 + Math.random() * 0.18, 0);
    }
  }
  /** The mother: pose from cs.mom (core/mother.js), wing beat from her speed, fire when she demonstrates roasting. */
  const momMouth = new V3();
  function poseMother(dt) {
    const m = cs.mom, on = !!(m && m.pos && !m.hidden && !cs.inLair && state !== 'intro' && pilot);
    mom.root.visible = on;
    if (!on) { momAcc = 0; return; }
    const sp = Math.hypot(m.vel[0], m.vel[1], m.vel[2]), turn = 0;
    mom.root.position.set(m.pos[0], m.pos[1], m.pos[2]);
    const bank = m.phase === 'wait' ? 0.35 : 0;
    mom.root.rotation.set(-m.pitch, m.yaw, bank, 'YXZ');
    const glide = m.pitch < -0.2 || m.phase === 'wait';
    momPhase += dt * (glide ? 2.4 : sp > 50 ? 5.5 : 4.2);
    mom.anim(time, dt, { phase: momPhase, amp: glide ? 0.4 : 0.9, mouth: m.breath, turn: turn - bank, look: 0 });
    mom.root.updateMatrixWorld(true);
    if (!m.breath || dt <= 0) { momAcc = 0; return; }
    mom.mouth.getWorldPosition(momMouth);
    const c = Math.cos(m.pitch - 0.25), dx = Math.sin(m.yaw) * c, dy = Math.sin(m.pitch - 0.25), dz = Math.cos(m.yaw) * c;
    momAcc += dt * 140 * qSet.particles;
    while (momAcc >= 1) {
      momAcc--;
      const k = 70 * (0.85 + Math.random() * 0.3), j = () => (Math.random() - 0.5) * 0.24;
      spawnP(momMouth.x, momMouth.y, momMouth.z, (dx + j()) * k, (dy + j()) * k, (dz + j()) * k, 0.45 + Math.random() * 0.2, 0);
    }
  }
  /** Her caption: the lesson line (touch variant when there is one), green while she praises. */
  const momEl = $('#mother'), momText = $('#motherText');
  let momShown = '';
  function motherHud() {
    const key = state === 'play' && !stationOpen ? MO.line(cs) : null;   // T10: a station panel replaces her caption while open
    const tk = key && isTouch && window.I18N && I18N.t(key + 'Touch') !== key + 'Touch' ? key + 'Touch' : key;
    if (tk === momShown) return;
    momShown = tk;
    momEl.hidden = !tk;
    if (tk) { momText.textContent = t(tk); momEl.classList.toggle('good', tk.indexOf('.good.') > 0 || tk === 'c.mother.visit'); }
    if (tk) $('#hint').hidden = true;                             // she replaces the old hunting tip
  }
  /** Arrow at the screen edge pointing to the mother while she is out of view (behind the camera too). */
  const momArrow = $('#momArrow'), projV = new V3();
  function motherArrow() {
    const m = cs.mom, on = state === 'play' && !!(m && m.pos && !m.hidden) && !cs.inLair && !!pilot;
    let show = false;
    if (on) {
      projV.set(m.pos[0], m.pos[1] + 2, m.pos[2]).project(camera);
      const behind = projV.z > 1, W = innerWidth, H = innerHeight;
      let x = behind ? -projV.x : projV.x, y = behind ? -projV.y : projV.y;
      if (behind || Math.abs(x) > 0.94 || Math.abs(y) > 0.92) {
        let px = x * W / 2, py = -y * H / 2;
        if (Math.hypot(px, py) < 1) py = 1;                      // straight behind: point down
        const land = isTouch && W > H && H < 560;               // keep clear of the HUD, the caption and the controls
        const top = land ? 150 : isTouch ? 204 : 150, bot = land ? 30 : isTouch ? 250 : 90, side = land ? 210 : 30;
        const minX = -W / 2 + side, maxX = W / 2 - side, minY = -H / 2 + top, maxY = H / 2 - bot;
        const kx = px > 0 ? maxX / px : px < 0 ? minX / px : Infinity, ky = py > 0 ? maxY / py : py < 0 ? minY / py : Infinity;
        const k = Math.min(kx, ky);
        momArrow.style.transform = 'translate(' + (W / 2 + px * k).toFixed(1) + 'px,' + (H / 2 + py * k).toFixed(1) + 'px) rotate(' + Math.atan2(py, px).toFixed(3) + 'rad)';
        show = true;
      }
    }
    if (momArrow.hidden === show) momArrow.hidden = !show;
  }
  /* ---------- compass strip (T109): markers from core/nav.js; tap a marker for its name and distance ---------- */
  const compassEl = $('#compass'), compassTag = $('#compassTag');
  const compass = VRender.compass.build(compassEl, { t, fov: D.nav.fov });
  let compassOn = false, tagT = 0, tagKey = null;
  function markerName(m) {
    const L = m.label || {}, p = {};
    for (const k in L.p || {}) p[k] = t(L.p[k]);
    return t(L.key, p);
  }
  function compassHud(dt) {
    const on = state === 'play' && !!pilot && !cs.inLair;
    if (on !== compassOn) { compassEl.hidden = !on; compassOn = on; if (!on) { compassTag.hidden = true; tagT = 0; } }
    if (!on) return;
    const list = NV.markers(cs);
    compass.update(list, pilot.yaw, dt);
    if (tagT > 0) {
      tagT -= dt;
      const m = list.find(q => q.key === tagKey);
      if (!m || tagT <= 0) { tagT = 0; compassTag.hidden = true; compass.select(null); }
      else { const txt = markerName(m) + ' - ' + t('c.nav.dist', { d: Math.round(m.dist / 10) * 10 }); if (compassTag.textContent !== txt) compassTag.textContent = txt; }
    }
  }
  compassEl.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const m = compass.tap(e.clientX);
    tagKey = m ? m.key : null; tagT = m ? D.nav.tagTime : 0; compassTag.hidden = !m;
  });
  function embers(pos, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 9;
      spawnP(pos[0], pos[1] + 1, pos[2], Math.cos(a) * s, 6 + Math.random() * 10, Math.sin(a) * s, 0.7 + Math.random() * 0.6, 1);
    }
  }
  function updateParticles(dt) {
    pMat.size = 3.4 * Math.sqrt(heroScale);
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      const j = i * 3;
      if (pLife[i] <= 0) { pPos[j + 1] = -9999; pCol[j] = pCol[j + 1] = pCol[j + 2] = 0; continue; }
      const drag = pKind[i] ? 0.6 : 2.2;
      pVel[j] *= 1 - drag * dt; pVel[j + 1] = pVel[j + 1] * (1 - drag * dt) + (pKind[i] ? -9 : 5) * dt; pVel[j + 2] *= 1 - drag * dt;
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      const age = 1 - pLife[i] / pMax[i], fade = Math.pow(1 - age, 1.4);
      // white-yellow at the mouth, orange, then deep red fading out
      pCol[j] = fade * 1.0; pCol[j + 1] = fade * (age < 0.25 ? 0.9 - age * 1.4 : 0.55 - Math.min(0.45, (age - 0.25) * 0.7)); pCol[j + 2] = fade * Math.max(0, 0.55 - age * 2.2);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }

  const mouthW = new V3(), fwdV = new V3();

  /* ---------- input ---------- */
  const keys = {}, touch = { x: 0, y: 0, breath: false, boost: false, grab: false, eat: false };
  let mouseBreath = false, invert = store('vsd-invert') === '1';
  $('#invertBox').checked = invert;
  $('#invertBox').onchange = e => { invert = e.target.checked; store('vsd-invert', invert ? '1' : '0'); };
  let confirmQ = false, enterQ = false, landQ = false;          // one-shots: Enter / Move slot (travel), Move slot (enter cave), F / Move slot (land, fly)
  addEventListener('keydown', e => {
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && state === 'play') confirmQ = true;
    if (e.code === D.controls.land && !e.repeat && state === 'play' && !cs.inLair) landQ = true;
    if (e.code === 'Escape' && state === 'hatch') { skipHatch(); return; }
    if (e.code === 'Escape' && state === 'play' && stationOpen) { closeStation(); return; }
    if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && state === 'play' && cs.inLair) { useStation(cs.station); return; }   // T10: E uses the station in reach
    if (e.code === 'Escape') { if (state === 'play') setState('paused'); else if (state === 'paused') setState('play'); return; }
    if (e.repeat && (e.code === 'KeyQ' || e.code === 'KeyE')) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (state !== 'play') return;
    if (e.code === 'KeyQ') F.tryRoll(pilot, -1);
    if (e.code === 'KeyE') F.tryRoll(pilot, 1);
    if (debug) debugKey(e.code);
  });
  if (debug) addEventListener('keydown', e => { if (e.code === 'Backquote' && state !== 'play') debugKey(e.code); });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseBreath = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => { if (state === 'play' && e.pointerType === 'mouse' && e.button === 0) mouseBreath = true; });
  addEventListener('mouseup', e => { if (e.button === 0) mouseBreath = false; });
  const stick = $('#stick'), nub = $('#nub'); let stickId = null;
  function stickMove(e) {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const R = r.width / 2 - 10, l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; touch.x = dx / R; touch.y = -dy / R;
  }
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
  $('#bRoll').addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'play') F.tryRoll(pilot, touch.x < -0.2 ? -1 : 1); });
  /* context slots (T101, core/controls.js): Action (hold) = Grab / Eat, Move (tap) = Fly to <region> / Enter cave.
     The Action kind is latched at the press, so a grab hold that catches a prey does not start eating it. */
  const bAction = $('#bAction'), bMove = $('#bMove'), bRoll = $('#bRoll'), bBreath = $('#bBreath');
  let breathDim = false;
  let slotNow = { action: null, move: null, roll: true }, actionKind = null;
  bAction.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state !== 'play' || !slotNow.action) return;
    if (CT.isStation(slotNow.action)) { useStation(slotNow.action); return; }   // T10: in the cave the Action slot is a tap on the station
    actionKind = slotNow.action; Object.assign(touch, CT.input(actionKind, true)); bAction.classList.add('on');
    try { bAction.setPointerCapture(e.pointerId); } catch (_) { }
  });
  const actionOff = () => { actionKind = null; touch.grab = touch.eat = false; bAction.classList.remove('on'); };
  bAction.addEventListener('pointerup', actionOff); bAction.addEventListener('pointercancel', actionOff); bAction.addEventListener('lostpointercapture', actionOff);
  bMove.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state !== 'play' || !slotNow.move) return;
    const mi = CT.moveInput(slotNow.move); if (mi.confirm) confirmQ = true; if (mi.enter) enterQ = true; if (mi.land) landQ = true;
  });
  const takeConfirm = () => { const c = confirmQ; confirmQ = false; return c; };
  const takeEnter = () => { const c = enterQ; enterQ = false; return c; };
  const takeLand = () => { const c = landQ; landQ = false; return c; };
  const clamp1 = v => Math.max(-1, Math.min(1, v));
  function readInput() {
    if (state !== 'play') return { sx: 0, sy: 0, breath: false, boost: false };
    const sy = clamp1(((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) + touch.y);
    return {
      sx: clamp1(((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + touch.x),
      sy: invert && !(pilot && pilot.mode && pilot.mode !== 'air') ? -sy : sy,   // invert is for flight pitch only: stick up always walks forward
      breath: !!(keys.Space || mouseBreath || touch.breath),
      boost: !!(keys.ShiftLeft || keys.ShiftRight || touch.boost),
      grab: !!(keys[D.controls.grab] || touch.grab),
      eat: !!(keys[D.controls.eat] || touch.eat),
      confirm: takeConfirm(),
      enter: takeEnter(),
      land: takeLand(),
    };
  }

  /* ---------- resize ---------- */
  let hatchScene = null, hatchCard = false, hatchLineShown = null;   // the hatching scene (see startHatchScene)
  let W = 1, Hh = 1;
  function resize() {
    W = innerWidth; Hh = innerHeight;
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh; camera.updateProjectionMatrix();
    if (hatchScene) hatchScene.resize(W, Hh);
  }
  addEventListener('resize', resize); resize();

  /* ---------- state ---------- */
  let state = 'intro', hintT = 0;
  function spawnPilot() {
    refreshStage();
    const s = TR.region(regionId).spawn || { x: 0, z: 0, y: 120, yaw: 0 };
    pilot = cs.dragon.pilot = F.newPilot([s.x, Math.max(s.y, TR.surfaceAt(regionId, s.x, s.z) + 40), s.z], s.yaw, stats.cruise);
    snapCam();
  }
  function setState(s) {
    const prev = state; state = s;
    const inGame = s === 'play' || s === 'paused';
    $('#intro').hidden = s !== 'intro';
    $('#hatch').hidden = !(s === 'hatch' && hatchCard);
    $('#hatchUi').hidden = !(s === 'hatch' && !hatchCard);
    $('#pause').hidden = s !== 'paused';
    $('#hudTop').hidden = !inGame;
    if (s === 'intro') { cs.inLair = false; stationOpen = null; }
    $('#lair').hidden = !(s === 'play' && stationOpen);
    $('#legend').hidden = !(s === 'play' && !isTouch);
    $('#touch').hidden = !(s === 'play' && isTouch);
    if (s === 'play' && (prev === 'intro' || prev === 'hatch')) {
      hintT = 0;
      if (!cs.dragon.pilot) spawnPilot();                        // a save without a position
      else { pilot = cs.dragon.pilot; refreshStage(); snapCam(); }   // continue a saved run, or the hatchling in the lair
    }
    $('#hint').hidden = !(s === 'play' && hintT > 0);
    if (s === 'intro' || s === 'hatch') { pilot = cs.dragon.pilot = null; hero.root.scale.setScalar(1); }
    if (s === 'intro') introUi();
    if (s !== 'hatch' && hatchScene) endHatchScene();
    mouseBreath = false; confirmQ = enterQ = landQ = false; actionKind = null; touch.breath = touch.boost = touch.grab = touch.eat = false;
    document.querySelectorAll('#btns .on').forEach(b => b.classList.remove('on'));
  }
  /** Writes the run to localStorage (unless saving is off) and keeps it in memory for Continue. Needs a dragon in the air or lair. */
  function saveNow(why) {
    if (!dragon.pilot || (state !== 'play' && state !== 'paused')) return false;
    saved = SV.serialise(cs);
    const okSave = saveOff ? false : SV.store(storage, cs);
    if (!saveOff && !okSave && (!lastSave || lastSave.ok)) toast(t('c.save.failed'), '', 3);   // say it once, not every minute
    lastSave = { why, ok: okSave, at: Math.round(cs.stats.played) };
    return okSave;
  }
  /**
   * Start / Continue: a saved run is applied into cs (same objects) and play resumes. A new run (Hatch, New hatchling)
   * first plays the hatching scene and its card; the card button wakes the hatchling inside the lair (lair.hatch) with
   * the panel open and hands over to the mother (cs.story.mother, her lessons come with core/mother.js in T05).
   */
  function startRun(fresh) {
    if (fresh || !saved) {
      SV.apply(cs, SV.migrate(SV.blank()));
      if (startId !== cs.region) cs.region = startId;
      if (!saveOff) SV.clear(storage);
      saved = null;
    } else SV.apply(cs, SV.migrate(JSON.parse(JSON.stringify(saved))));
    if (cs.region !== regionId || !region) loadRegion(cs.region);
    cs.field = PR.spawnRegion(cs.region, rng, cs.dragon.pilot ? cs.dragon.pilot.pos : null);
    if (!cs.dragon.pilot && !cs.flags.introSeen) { startHatchScene(); return; }
    cs.flags.introSeen = true;
    setState('play');
    saveNow('start');
  }
  /* ---------- hatching scene (render/hatch-scene.js): plays on a new run, then the hatching card ---------- */
  function startHatchScene() {
    if (hatchScene) endHatchScene();
    hatchScene = VRender.hatch.build();
    hatchScene.resize(W, Hh);
    hatchCard = false; hatchLineShown = null;
    $('#hatchLine').textContent = ''; $('#hatchLine').classList.remove('on');
    setState('hatch');
  }
  function endHatchScene() { if (!hatchScene) return; hatchScene.dispose(); hatchScene = null; $('#hatchUi').hidden = true; }
  function showHatchCard() {
    hatchCard = true;
    $('#hatchUi').hidden = true; $('#hatch').hidden = false;
    setTimeout(() => $('#hatchBtn').focus({ preventScroll: true }), 0);
  }
  function skipHatch() { if (state === 'hatch' && hatchScene && !hatchCard) hatchScene.skip(); }
  /** One frame of the scene: captions fade between lines, the card appears at the end. */
  function runHatch(dt) {
    const r = hatchScene.update(dt);
    if (r.line !== hatchLineShown) {
      const el = $('#hatchLine'), key = r.line;
      el.classList.remove('on');
      if (key) setTimeout(() => { if (hatchLineShown === key) { el.textContent = t(key); el.classList.add('on'); } }, hatchLineShown ? 300 : 0);
      hatchLineShown = key;
    }
    if (r.card && !hatchCard) showHatchCard();
    renderer.render(hatchScene.scene, hatchScene.camera);
  }
  $('#hatchSkip').addEventListener('click', e => { e.preventDefault(); skipHatch(); });
  /** Hatching card -> the hatchling wakes in the lair (panel open, a first hint), saved right away. */
  function hatchNow() {
    if (state !== 'hatch') return;
    cs.flags.introSeen = true;
    const ev = LR.hatch(cs);
    setState('play');
    onEvents(ev);
    flashPrompt(t(isTouch ? 'c.lair.hatchedTouch' : 'c.lair.hatched'), 10);
    saveNow('start');
  }
  $('#hatchBtn').onclick = hatchNow;
  let newArmed = false;
  /** Intro buttons: Hatch / Continue + New hatchling (tap twice), or the Start new / Keep choice for an unreadable save. */
  function introUi() {
    const bad = $('#saveBad'), note = $('#saveNote'), sb = $('#startBtn'), nb = $('#newBtn');
    bad.hidden = !saveBad; $('#startRow').hidden = !!saveBad;
    if (saveBad) $('#saveBadText').textContent = t(saveBad === 'newer' ? 'c.save.newer' : 'c.save.corrupt');
    sb.dataset.i18n = saved ? 'c.continue' : 'c.start'; sb.textContent = t(sb.dataset.i18n);
    nb.hidden = !saved; newArmed = false; nb.classList.remove('confirm');
    nb.dataset.i18n = 'c.save.new'; nb.textContent = t('c.save.new');
    const d = saved && saved.dragon, w = saved && saved.world;
    note.hidden = !(d || (saveOff && !saveBad));
    note.innerHTML = '';
    if (d) note.append(Object.assign(document.createElement('b'), { textContent: t('c.save.summary', {
      stage: stageName(d.stage), region: t(TR.region(D.regions[w.region] ? w.region : D.startRegion).nameKey), food: Math.floor(d.foodXp) }) }));
    if (saveOff && !saveBad) { if (d) note.append(document.createElement('br')); note.append(t('c.save.off')); }
  }
  $('#startBtn').onclick = () => { if (!saveBad) startRun(false); };
  $('#newBtn').onclick = () => {
    const nb = $('#newBtn');
    if (!newArmed) { newArmed = true; nb.classList.add('confirm'); nb.dataset.i18n = 'c.save.newConfirm'; nb.textContent = t('c.save.newConfirm'); return; }
    startRun(true);
  };
  $('#badNewBtn').onclick = () => { SV.clear(storage); saveBad = null; saveOff = false; saved = null; introUi(); };
  $('#badKeepBtn').onclick = () => { saveBad = null; saveOff = true; saved = null; introUi(); };
  $('#resumeBtn').onclick = () => setState('play');
  $('#menuBtn').onclick = () => { saveNow('menu'); setState('intro'); };
  $('#pauseBtn').onclick = () => { if (state === 'play') setState('paused'); else if (state === 'paused') setState('play'); };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    saveNow('hidden');
    if (state === 'play') setState('paused');
  });
  addEventListener('pagehide', () => saveNow('pagehide'));

  /* ---------- dragon pose + chase camera (same rig as the duel) ---------- */
  const camPos = new V3(), camLook = new V3(), tmpV = new V3();
  function camDesired(out) {
    if (cs.inLair) { const c = CV.camera(pilot.pos, pilot.yaw, heroScale); return out.set(c.pos[0], c.pos[1], c.pos[2]); }   // T10: inside the dome
    const p = pilot.pos, bx = Math.sin(pilot.yaw), bz = Math.cos(pilot.yaw);
    const k = Math.pow(heroScale, 0.75), gc = D.groundCam, gb = heroPose.ground || 0, lerp = MT.lerp;   // a bigger dragon needs the camera further back
    const back = lerp(22, gc.back, gb) * k, up = lerp(7 - pilot.pitch * 6, gc.height, gb) * k;   // T07: lower and closer on the ground
    out.set(p[0] - bx * back, p[1] + up, p[2] - bz * back);
    out.y = Math.max(out.y, TR.surfaceAt(regionId, out.x, out.z) + 3);
    return out;
  }
  function snapCam() { camDesired(camPos); }

  /* target ring: marks the prey a held G will swoop at (bright while swooping) */
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x62c48a, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.3, 28), ringMat);
  ringMesh.rotation.x = -Math.PI / 2; ringMesh.renderOrder = 5; ringMesh.visible = false; scene.add(ringMesh);
  function targetRing() {
    const id = state === 'play' && pilot ? (cs.swoop != null ? cs.swoop : cs.hint === 'swoop' || (cs.hint === 'grab' && pilot.mode === 'ground') ? cs.target : null) : null;   // T08: also what Grab picks up on the ground
    const q = id != null ? PR.byId(cs.field, id) : null;
    ringMesh.visible = !!q;
    if (!q) return;
    const k = VRender.prey.VIS * (q.size > 1 ? 1.3 : 1) * (cs.swoop != null ? 1 + 0.12 * Math.sin(time * 12) : 1);
    ringMesh.position.set(q.pos[0], q.pos[1] + 0.4, q.pos[2]);
    ringMesh.scale.setScalar(k);
    ringMat.opacity = cs.swoop != null ? 0.9 : 0.45;
  }
  /* fire ring: the prey the breath is aimed at (cs.fire): shown while breathing, while it is heating up, or when it is
     too heavy to lift (the natural fire target); bright and pulsing while the fire reaches it, dim when out of reach */
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const fireRing = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.7, 28), fireMat);
  fireRing.rotation.x = -Math.PI / 2; fireRing.renderOrder = 5; fireRing.visible = false; scene.add(fireRing);
  function fireTargetRing() {
    const f = state === 'play' && pilot && !cs.inLair ? cs.fire : null, q = f ? PR.byId(cs.field, f.id) : null;
    const heavy = q && q.size > Math.min(stats.carry, HN.effects(dragon.hunger).carryMax);
    const on = !!q && (pilot.breathing || f.cook > 0 || heavy) && !(ringMesh.visible && ringMesh.position.x === q.pos[0]);
    fireRing.visible = on;
    if (!on) return;
    const hot = pilot.breathing && f.inRange;
    fireRing.position.set(q.pos[0], q.pos[1] + 0.5, q.pos[2]);
    fireRing.scale.setScalar(VRender.prey.VIS * (q.size > 1 ? 1.3 : 1) * (hot ? 1 + 0.14 * Math.sin(time * 14) : 1));
    fireMat.opacity = hot ? 0.95 : f.inRange ? 0.6 : 0.3;
  }

  /** Where the carried prey hangs: at the claw anchor, facing with the dragon; on the ground in the jaws (T08). */
  const clawW = new V3();
  function carryPose() {
    const p = pilot && ST.carriedPrey(cs);
    if (!p) return null;
    const jaws = (heroPose.ground || 0) > 0.5;
    (jaws ? hero.mouth : hero.claws).getWorldPosition(clawW);
    return { id: p.id, pos: clawW, yaw: pilot.yaw, pitch: pilot.pitch, jaws };
  }

  function poseHero(dt) {
    const p = pilot;
    hero.root.position.set(p.pos[0], p.pos[1], p.pos[2]);
    hero.root.rotation.set(-p.pitch, p.yaw, p.roll + p.rollX, 'YXZ');
    const glide = p.pitch < -0.25 && !p.boosting, mode = p.mode || 'air';
    // T07: legs stand and walk (walk.pose), wings fold on the ground, flare wide while landing, beat hard on takeoff
    WK.pose(heroPose, p, dt, heroScale);
    const hp = heroPose, ground = mode === 'ground';
    phase += dt * (ground ? 1.5 : mode === 'landing' ? 3.2 : mode === 'takeoff' ? 10 : p.boosting ? 9 : glide ? 3 : 6.2);
    const amp = ground ? 0.12 : mode === 'landing' ? 0.5 + 0.9 * hp.flare : mode === 'takeoff' ? 1.25 : glide ? 0.35 : p.boosting ? 1.1 : 1;
    hero.anim(time, dt, { phase, amp, mouth: p.breathing, turn: -p.sx, look: 0, ground: hp.ground, fold: hp.fold, gait: hp.gait, stride: hp.stride });
    hero.root.updateMatrixWorld(true);
    if (dt > 0) breathParticles(dt, p);
  }

  function idleHero(dt) {
    phase += dt * 6.2;
    const a = -time * 0.12, r = 330, y = (regionId === 'ash' ? 190 : 95) + Math.sin(time * 0.7) * 6;
    hero.root.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    hero.root.rotation.set(0, a - Math.PI / 2, 0.35, 'YXZ');    // yaw falls = right turn, bank right (as in the duel)
    hero.anim(time, dt, { phase, amp: 1, mouth: false, turn: 0.4, look: 0 });
    // camera trails just outside and behind the circling dragon, looking inward at the volcano
    const P = hero.root.position, ox = Math.sin(a), oz = Math.cos(a), mx = -Math.cos(a), mz = Math.sin(a);
    camera.position.set(P.x + ox * 34 - mx * 26, P.y + 9, P.z + oz * 34 - mz * 26);
    camera.lookAt(P.x * 0.82 + mx * 8, P.y - 14, P.z * 0.82 + mz * 8);
  }

  /* ---------- HUD ---------- */
  const hpFill = $('#hpFill'), stFill = $('#stFill'), hgFill = $('#hgFill'), hgBar = $('#hgBar'), ring = $('#growRing'), vig = $('#vignette');
  const shown = { st: -1, hp: -1, hg: -1, ring: -1, hs: '' };
  function hud(dt) {
    const st = Math.round(pilot.st), hp = Math.round(100 * dragon.hp / stats.hpMax), hg = Math.round(dragon.hunger);
    if (st !== shown.st) { stFill.style.transform = 'scaleX(' + st / 100 + ')'; shown.st = st; }
    if (hp !== shown.hp) { hpFill.style.transform = 'scaleX(' + hp / 100 + ')'; shown.hp = hp; }
    if (hg !== shown.hg) { hgFill.style.transform = 'scaleX(' + hg / D.hunger.max + ')'; shown.hg = hg; }
    const hs = HN.stateOf(dragon.hunger);
    if (hs !== shown.hs) { hgBar.classList.toggle('hungry', hs === 'hungry'); hgBar.classList.toggle('starving', hs === 'starving'); shown.hs = hs; }
    const ready = G.readyStage(dragon.foodXp, dragon.stage) > dragon.stage;
    const pr = ready ? 1 : Math.round(G.progressIn(dragon.stage, dragon.foodXp) * 100) / 100;
    if (pr !== shown.ring) { ring.style.setProperty('--p', pr); ring.classList.toggle('ready', ready); shown.ring = pr; }
    hurt = Math.max(0, hurt - dt * 1.8);
    vig.style.opacity = Math.max(hurt, hs === 'starving' && state === 'play' ? 0.3 + Math.sin(time * 4) * 0.12 : 0);
    if (hintT > 0 && state === 'play') { hintT -= dt; if (hintT <= 0) $('#hint').hidden = true; }
    if (toastT > 0) { toastT -= dt || 0.016; if (toastT <= 0) toastEl.style.opacity = 0; }
    promptHud(dt);
    if (stationOpen && cs.station !== stationOpen) closeStation();   // walked away from the station
    if (stationOpen && (lairTick -= dt) <= 0) { lairTick = 0.5; renderLair(); }
    if (lairMsgT > 0 && (lairMsgT -= dt) <= 0) $('#lairMsg').textContent = '';
  }
  const toastEl = $('#toast'); let toastT = 0, hurt = 0, shake = 0, died = null;
  /** Reactions to core events: toasts, flashes, shakes. Rules already happened in core/state. */
  function onEvents(ev) {
    for (const e of ev) {
      if (e.e === 'boar:hit') { hero.flash = 0.6; hurt = 0.7; shake = Math.max(shake, 0.5); }
      else if (e.e === 'hunger:state' && e.state === 'hungry') toast(t('c.toast.hungry'), t('c.toast.hungrySub'));
      else if (e.e === 'hunger:state' && e.state === 'starving') toast(t('c.toast.starving'), t('c.toast.starvingSub'));
      else if (e.e === 'prey:grabbed') flashPrompt(null);
      else if (e.e === 'land:refused') flashPrompt(t('c.land.' + e.why), 1.8);
      else if (e.e === 'takeoff:refused') flashPrompt(t('c.takeoff.' + e.why), 1.8);
      else if (e.e === 'breath:blocked') flashPrompt(t('c.breath.' + e.why), 2.2);
      else if (e.e === 'dragon:landed') shake = Math.max(shake, 0.25 * heroScale);
      else if (e.e === 'prey:tooHeavy') flashPrompt(t('c.prompt.tooHeavy'), 2.2);
      else if (e.e === 'prey:dropped') toast(t('c.toast.dropped'), t('c.toast.droppedSub'), 2.5);
      else if (e.e === 'eat:cancel') flashPrompt(t('c.prompt.interrupted'), 1.5);
      else if (e.e === 'prey:roasted') { embers(e.pos, 46); toast(t('c.toast.roasted'), t('c.toast.roastedSub', { n: e.chunks }), 2); }
      else if (e.e === 'prey:eaten') { hero.jaw.rotation.x = 0.9; toast(t('c.toast.eaten', { food: e.food }), t('c.prey.' + e.type), 1.6); }
      else if (e.e === 'dragon:died') { died = e; hurt = 0; shake = 0; hero.flash = 0; fadeEl.classList.add('now'); requestAnimationFrame(() => fadeEl.classList.remove('now')); }
      else if (e.e === 'region:enter') swapRegion(e.respawn);
      else if (e.e === 'save') saveNow(e.why);
      else if (e.e === 'lair:enter') { enterCave(e.respawn ? died : null); died = null; }
      else if (e.e === 'lair:stored') lairMsg(t('c.lair.stored', { prey: t('c.prey.' + e.type) }));
      else if (e.e === 'lair:full') lairMsg(t('c.lair.full'));
      else if (e.e === 'lair:spoiled') { if (cs.inLair) lairMsg(t('c.lair.spoiled', { prey: t('c.prey.' + e.type) })); renderLair(); }
      else if (e.e === 'lair:leave') { leaveCave(); if (!cs.stats.eaten && !MO.lesson(cs)) showTip(12); }   // first hunt without a mother: how to grab and eat
      else if (e.e === 'building:ruined' && e.type !== 'palisade') toast(t('c.toast.burned', { b: t('c.building.' + e.type) }), t('c.toast.burnedSub'), 2.2);
      else if (e.e === 'place:discovered') toast(t('c.toast.discovered', { place: t('c.place.' + e.type) }), t('c.toast.discoveredSub'), 3);
      else if (e.e === 'mother:done') toast(t('c.mother.done'), t('c.mother.doneSub'), 4);
      else if (e.e === 'stage:up') { refreshStage(); lairMsg(t('c.lair.grew', { stage: stageName(e.to) })); if (!cs.inLair) toast(t('c.toast.grew', { stage: stageName(e.to) }), t('c.toast.grewSub'), 4); }
      else if (e.e === 'growth:ready' && !cs.inLair) toast(t('c.toast.ready'), t('c.toast.readySub', { stage: stageName(e.stage) }), 4);
    }
  }
  /* bottom prompt: what the claws can do right now (+ eat progress) */
  const promptEl = $('#prompt'), promptText = $('#promptText'), promptBar = $('#promptBar');
  let promptFlash = null, promptFlashT = 0, promptShown = '', actionShown = '', moveShown = '';
  const ICON = {   // small stroke icons for the context slots (currentColor)
    grab: '<path d="M6 4c0 7 2 11 6 14M12 3c0 7 1 11 2 15M18 4c0 7-2 11-6 14"/>',
    eat: '<path d="M4 12a8 8 0 0 0 16 0zM8 12l2-3 2 3 2-3 2 3"/>',
    travel: '<path d="M4 12h14M13 6l6 6-6 6"/>',
    cave: '<path d="M3 20c0-9 4-15 9-15s9 6 9 15M9 20c0-4 1.5-7 3-7s3 3 3 7"/>',
    land: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    fly: '<path d="M12 20V8M7 13l5-5 5 5M4 4h16"/>',
    nest: '<path d="M3 14c2 4 16 4 18 0M5 13c3-2 11-2 14 0M8 10l2 3M16 10l-2 3"/>',
    larder: '<path d="M4 9h16v10H4zM4 9l3-4h10l3 4M9 13h6"/>',
    exit: '<path d="M4 20c0-9 3-15 8-15s8 6 8 15M12 20v-6M9 17l3-3 3 3"/>',
  };
  const slotHtml = icon => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[icon] + '</svg><span></span>';
  function slotSet(b, icon, label) { b.innerHTML = slotHtml(icon); b.lastChild.textContent = label; b.setAttribute('aria-label', label); }
  /** Context slots follow core/controls.js; a held Action keeps its latched kind and stays visible until released. */
  function slotsHud() {
    slotNow = state === 'play' && isTouch ? CT.slots(cs) : { action: null, move: null, roll: true };
    const ak = actionKind || slotNow.action || '';
    if (ak !== actionShown) { if (ak) slotSet(bAction, ak, t('c.btn.' + ak)); bAction.classList.toggle('off', !ak); actionShown = ak; }
    const mv = slotNow.move, mk = mv ? (mv.kind === 'travel' ? 'c.btn.travel.' + mv.to : 'c.btn.' + mv.kind) : '';
    if (mk !== moveShown) {
      if (mk) { slotSet(bMove, mv.kind, t(mk)); bMove.classList.remove('new'); void bMove.offsetWidth; bMove.classList.add('new'); }
      bMove.classList.toggle('off', !mk); moveShown = mk;
    }
    bRoll.classList.toggle('off', !slotNow.roll);
    const noFire = !HN.effects(dragon.hunger).canBreath;            // starving: the Breath button dims (T08 feedback)
    if (noFire !== breathDim) { bBreath.classList.toggle('dim', noFire); breathDim = noFire; }
  }
  function flashPrompt(text, secs) { promptFlash = text; promptFlashT = text ? secs : 0; }
  function promptHud(dt) {
    promptFlashT = Math.max(0, promptFlashT - dt);
    slotsHud();
    let text = '', bar = -1;
    const ex = state === 'play' && cs.exit;
    if (promptFlashT > 0 && promptFlash) text = promptFlash;
    else if (ex && !isTouch) text = t('c.prompt.travel.' + ex.to);
    else if (state === 'play' && cs.exitSmall && !cs.inLair) text = t('c.prompt.tooSmall.' + cs.exitSmall.to);   // T11: gated exit, phone and desktop
    else if (cs.inLair) text = stationOpen ? '' : cs.station ? t('c.prompt.station.' + cs.station + (isTouch ? 'Touch' : '')) : t(isTouch ? 'c.prompt.caveTouch' : 'c.prompt.cave');
    else if (cs.hint === 'lair') text = t(isTouch && slotNow.move && slotNow.move.kind === 'cave' ? 'c.prompt.lairTouch' : 'c.prompt.lair');
    else if (cs.hint === 'lairStore') { text = t(!isTouch ? 'c.prompt.lairStore' : slotNow.move && slotNow.move.kind === 'cave' ? 'c.prompt.lairStoreEnterTouch' : 'c.prompt.lairStoreTouch'); if (dragon.eatT > 0) bar = dragon.eatT / ST.eatTime(cs); }
    else if (cs.hint === 'eat') { text = t(isTouch ? 'c.prompt.eatTouch' : 'c.prompt.eat'); bar = dragon.eatT / ST.eatTime(cs); }
    else if (cs.fire && dragon.carried == null && (pilot.breathing || cs.fire.cook > 0) && PR.byId(cs.field, cs.fire.id)) {   // roast progress
      const q = PR.byId(cs.field, cs.fire.id);
      text = cs.fire.kept ? t('c.prompt.turnBack', { prey: t('c.prey.' + q.type) }) : !cs.fire.inRange ? (cs.fire.cook > 0 ? t(isTouch ? 'c.prompt.keepFireTouch' : 'c.prompt.keepFire') : t('c.prompt.fireFar'))
        : pilot.breathing ? t('c.prompt.roasting', { prey: t('c.prey.' + q.type) }) : t(isTouch ? 'c.prompt.keepFireTouch' : 'c.prompt.keepFire');
      bar = cs.fire.cook;
    }
    else if (cs.hint === 'grab') text = pilot.mode === 'ground' ? t(isTouch ? 'c.prompt.pickupTouch' : 'c.prompt.pickup', { prey: t('c.prey.' + ((PR.byId(cs.field, cs.target) || {}).type || 'goat')) }) : t(isTouch ? 'c.prompt.grabTouch' : 'c.prompt.grab');
    else if (cs.hint === 'swoop') text = cs.swoop != null ? t('c.prompt.swooping') : t(isTouch ? 'c.prompt.swoopTouch' : 'c.prompt.swoop');
    else if (cs.hint === 'heavy') text = t(isTouch ? 'c.prompt.heavyTouch' : 'c.prompt.heavy');
    else if (cs.hint === 'near') text = t('c.prompt.near');
    else if (cs.hint === 'land') text = t(isTouch ? 'c.prompt.landTouch' : 'c.prompt.land');
    else if (cs.hint === 'walk') text = t(isTouch ? 'c.prompt.walkTouch' : 'c.prompt.walk');
    if (text !== promptShown) { promptText.textContent = text; promptEl.hidden = !text; promptShown = text; }
    promptBar.hidden = bar < 0;
    if (bar >= 0) promptBar.firstChild.style.transform = 'scaleX(' + Math.min(1, bar) + ')';
  }
  function toast(title, sub, secs) {
    toastEl.innerHTML = '';
    toastEl.append(title);
    if (sub) { const sm = document.createElement('small'); sm.textContent = sub; toastEl.append(sm); }
    toastEl.style.opacity = 1; toastT = secs || 3;
  }
  const stageName = i => t('c.stage.' + D.stages[i].id);

  /* ---------- survival tick: hunger, its effects, growth moments ---------- */
  function survive(dt) {
    // the dragon keeps growing visibly within its stage as it eats
    const sc = ST.scaleOf(cs);
    if (Math.abs(sc - heroScale) > 1e-4) { heroScale += (sc - heroScale) * Math.min(1, dt * 2); hero.root.scale.setScalar(heroScale); }
  }
  function feed(food) {
    if (HN.feed(dragon, food)) toast(t('c.toast.ready'), t('c.toast.readySub', { stage: stageName(dragon.stage + 1) }), 4);
  }
  /* ---------- cave station panels (T10; core/cave.js + lair.js do the rules, the panel shows cs and calls state.caveAct) ---------- */
  const lairEl = $('#lair'), larderList = $('#larderList');
  let lairMsgT = 0, lairTick = 0, lairShown = '', stationOpen = null;
  /** A lair message: in the open station panel, else as the bottom prompt for a few seconds. */
  function lairMsg(text, secs) {
    if (stationOpen || !text) { $('#lairMsg').textContent = text || ''; lairMsgT = text ? secs || 4 : 0; return; }
    flashPrompt(text, secs || 3);
  }
  /** The hunting tip under the HUD (touch names buttons, desktop names keys), hidden after secs. */
  function showTip(secs) { hintT = secs; $('#hint').hidden = !(state === 'play' && !cs.inLair); }
  function renderLair() {
    if (!cs.inLair || !stationOpen) return;
    const d = dragon, st = D.stages[d.stage], nx = D.stages[d.stage + 1], ready = G.readyStage(d.foodXp, d.stage) > d.stage;
    const stageEl = $('#lairStage');
    stageEl.textContent = ready ? t('c.lair.ready', { stage: stageName(G.readyStage(d.foodXp, d.stage)) })
      : nx ? t('c.lair.progress', { stage: stageName(d.stage), food: Math.floor(d.foodXp), next: nx.foodFrom, nextStage: stageName(d.stage + 1) })
      : t('c.lair.max', { stage: t('c.stage.' + st.id) });
    stageEl.classList.toggle('ready', ready);
    $('#lairVitals').textContent = t('c.lair.vitals', { hp: Math.round(100 * d.hp / G.statsOf(d.stage).hpMax), st: Math.round(pilot ? pilot.st : 100), hunger: Math.round(d.hunger) });
    $('#larderHead').textContent = t('c.lair.larder', { n: cs.larder.length, max: D.lair.larderSize });
    const key = cs.larder.map(it => it.type + ':' + Math.max(1, Math.round(it.food))).join(',');
    if (key !== lairShown) {
      lairShown = key;
      larderList.innerHTML = '';
      cs.larder.forEach((it, i) => {
        const li = document.createElement('li'), sp = document.createElement('span'), b = document.createElement('button');
        sp.textContent = t('c.lair.item', { prey: t('c.prey.' + it.type), food: Math.max(1, Math.round(it.food)) });
        b.className = 'ghost'; b.textContent = t('c.lair.eat'); b.dataset.i = i;
        li.append(sp, b); larderList.append(li);
      });
    }
    $('#larderEmpty').hidden = cs.larder.length > 0;
  }
  /** death: the "You fell" card on top of the lair panel (cleared when the dragon leaves) */
  function deathCard(e) {
    const el = $('#lairDeath');
    el.hidden = !e; el.innerHTML = '';
    if (!e) return;
    el.append(t('c.lair.died'));
    for (const line of [e.lost ? t('c.lair.diedLost', { prey: t('c.prey.' + e.lost) }) : null, t('c.lair.diedSub')]) {
      if (!line) continue;
      const sm = document.createElement('small'); sm.textContent = line; el.append(sm);
    }
  }
  /** Opens the panel of a cave station (nest: rest, stage, vitals; larder: stored prey). death: the "You fell" card. */
  function openStation(id, death) {
    stationOpen = id;
    lairEl.dataset.station = id;
    $('#lairTitle').dataset.i18n = 'c.cave.' + id; $('#lairTitle').textContent = t('c.cave.' + id);
    deathCard(death || null); if (death) { toastEl.style.opacity = 0; toastT = 0; }
    lairShown = ''; renderLair();
    lairEl.hidden = false;
    if (!isTouch) setTimeout(() => (id === 'nest' ? $('#restBtn') : larderList.querySelector('button') || $('#leaveBtn')).focus({ preventScroll: true }), 0);
  }
  function closeStation() {
    stationOpen = null;
    lairEl.hidden = true; $('#lairMsg').textContent = ''; lairMsgT = 0; deathCard(null);
    if (document.activeElement && lairEl.contains(document.activeElement)) document.activeElement.blur();
  }
  /** The Action slot / E: the exit leaves, the nest and the larder open (or close) their panel. */
  function useStation(id) {
    if (!id || !cs.inLair || state !== 'play') return;
    if (id === 'exit') { onEvents(ST.caveAct(cs, 'exit')); return; }
    if (stationOpen === id) closeStation(); else openStation(id);
  }
  /** lair:enter: the dragon stands in the cave (tunnel, or the nest after death / hatching); the camera cuts inside. */
  function enterCave(death) {
    closeStation();
    pilot = dragon.pilot; refreshStage(); syncScene(); snapCam();
    touch.breath = touch.boost = touch.grab = touch.eat = false; mouseBreath = false; actionKind = null; enterQ = confirmQ = landQ = false;
    document.querySelectorAll('#btns .on').forEach(b => b.classList.remove('on'));
    $('#hint').hidden = true; hintT = 0;
    if (death) openStation('nest', death);
  }
  function leaveCave() {
    closeStation();
    pilot = dragon.pilot; refreshStage(); syncScene(); snapCam();
  }
  $('#restBtn').onclick = () => {
    if (!cs.inLair || state !== 'play') return;
    const ev = ST.caveAct(cs, 'nest');
    if (!ev.some(e => e.e === 'stage:up')) lairMsg(t('c.lair.rested'));
    onEvents(ev); renderLair();
  };
  larderList.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !cs.inLair || state !== 'play') return;
    const it = cs.larder[+b.dataset.i];
    const ev = ST.caveAct(cs, 'larder', +b.dataset.i);
    if (it && ev.length) { hero.jaw.rotation.x = 0.9; lairMsg(t('c.lair.ate', { prey: t('c.prey.' + it.type), food: ev[0].food })); }
    onEvents(ev.filter(x => x.e !== 'prey:eaten')); renderLair();
  });
  $('#leaveBtn').onclick = () => closeStation();
  /** Debug: rest from anywhere (enters the lair first when in the Ash Wastes, else rests in place). */
  function rest() { onEvents(ST.lairRest(cs)); renderLair(); }
  /* ?debug actions: a hotkey on desktop, a button on touch (listed in the debug panel). [key, what, code, button] */
  const DEBUG_KEYS = [
    ['N', '+100 food (hunger + growth)', 'KeyN', '+100 food'], ['J', 'hunger +25 (no growth)', 'KeyJ', 'hunger +25'],
    ['H', 'hunger -25', 'KeyH', 'hunger -25'], ['K', 'damage 20 HP (0 HP = death)', 'KeyK', '-20 HP'],
    ['Z', 'die now (wake in the lair)', 'KeyZ', 'die'],
    ['L', 'fly into the lair (Ash Wastes)', 'KeyL', 'to lair'], ['R', 'reset to a new hatchling', 'KeyR', 'reset'],
    ['P', 'fly to the nearest herd', 'KeyP', 'to herd'], ['T', 'jump near a region exit (again: the next exit)', 'KeyT', 'to exit'],
    ['C', 'become a Drake now (Farmlands test)', 'KeyC', 'drake now'],
    ['O', 'smell test: 340 from the nearest herd, facing away', 'KeyO', 'smell test'],
    ['V', 'save now', 'KeyV', 'save'], ['U', 'wipe the save and reload', 'KeyU', 'wipe save'],
    ['Y', 'graphics quality low / mid / high (saved)', 'KeyY', 'quality'],
    ['I', 'put the nearest goat in front of the dragon', 'KeyI', 'goat here'],
    ['M', 'mother: complete the current lesson', 'KeyM', 'next lesson'],
    ['B', 'Elder size (scale 4) on / off: walls and camera test in the cave', 'KeyB', 'elder size'],
    ['1', 'fly to the next settlement of this region (low, 150 out, facing it)', 'Digit1', 'to town'],
    ['2', 'set the nearest building alight (fire test)', 'Digit2', 'fire here'],
    ['3', 'rebuild every ruin of this region now', 'Digit3', 'rebuild'],
    ['`', 'hide / show this panel', 'Backquote', null],
  ];
  let dbgExit = 0, dbgExitRegion = null, dbgTown = -1;           // dbgTown: settlement index of the last '1' press (T12)                         // T: which exit the next press jumps to
  function debugKey(code) {
    if (code === 'Backquote') { toggleDebug(); return; }
    if (code === 'KeyY') { qSampler = null; applyQuality(QL.next(qTier), 'debug'); flashPrompt(t('c.dbg.quality', { tier: qTier }), 1.5); return; }
    if (state !== 'play') return;
    if (code === 'KeyN') feed(100);
    if (code === 'KeyI') {                                        // T08: a grazing goat 4 m (x scale) in front, to test the ground pick up
      const g = cs.field.list.filter(q => q.type === 'goat' && q.state !== 'carried').sort((a, b) => Math.hypot(a.pos[0] - pilot.pos[0], a.pos[2] - pilot.pos[2]) - Math.hypot(b.pos[0] - pilot.pos[0], b.pos[2] - pilot.pos[2]))[0];
      if (g) {
        const f = 4 * heroScale, x = pilot.pos[0] + Math.sin(pilot.yaw) * f, z = pilot.pos[2] + Math.cos(pilot.yaw) * f;
        Object.assign(g, { pos: [x, TR.surfaceAt(regionId, x, z), z], state: 'graze', calm: 0, goal: null, pause: 3, speed: 0, cook: 0, held: 4 });   // held: stands still 4 s (as the mother holds prey)
      }
    }
    if (code === 'KeyM') { onEvents(MO.skip(cs)); const mo = cs.story && cs.story.mother; flashPrompt(t('c.dbg.mother', { n: mo ? mo.lesson : '-' }), 1.5); }
    if (code === 'KeyB') { cs.debugScale = cs.debugScale ? null : 4; refreshStage(); if (cs.inLair) { CV.clampPos(pilot.pos, ST.scaleOf(cs)); pilot.pos[1] = CV.standY(ST.scaleOf(cs)); } snapCam(); flashPrompt(t('c.dbg.scale', { s: ST.scaleOf(cs).toFixed(2) }), 1.5); }
    if (code === 'KeyC' && dragon.stage < 1) {                    // T11: skip to the Drake stage (the Farmlands need one)
      Object.assign(dragon, { stage: 1, foodXp: Math.max(dragon.foodXp, D.stages[1].foodFrom), hp: D.stages[1].hp });
      refreshStage(); flashPrompt(t('c.dbg.drake'), 1.5);
    }
    if (code === 'KeyJ') dragon.hunger = Math.min(D.hunger.max, dragon.hunger + 25);
    if (code === 'KeyH') dragon.hunger = Math.max(0, dragon.hunger - 25);
    if (code === 'KeyK' && !cs.inLair) { dragon.hp = Math.max(0, dragon.hp - 20); hero.flash = 0.6; }
    if (code === 'KeyZ' && !cs.inLair) dragon.hp = 0;               // core/state sees HP 0 on the next step: death
    if (code === 'KeyL' && !cs.inLair) {
      const m = LR.mouthPos(regionId);
      if (m) { const L0 = TR.region(regionId).lair; pilot.pos = [m[0], m[1], m[2] + L0.r * 0.5]; pilot.yaw = Math.PI; pilot.pitch = 0; snapCam(); }
      else rest();
    }
    if (code === 'KeyP' && cs.field.herds.length) {
      let best = null, bd = Infinity;
      for (const h of cs.field.herds) {
        if (!cs.field.list.some(q => q.herd === h.id)) continue;
        const d = Math.hypot(h.centre[0] - pilot.pos[0], h.centre[1] - pilot.pos[2]);
        if (d > 60 && d < bd) { bd = d; best = h; }
      }
      if (best) {                                                 // arrive 160 out, low, facing the herd
        const a = Math.atan2(pilot.pos[0] - best.centre[0], pilot.pos[2] - best.centre[1]);
        const x = best.centre[0] + Math.sin(a) * 160, z = best.centre[1] + Math.cos(a) * 160;
        pilot.pos = [x, TR.surfaceAt(regionId, x, z) + 30, z]; pilot.yaw = a + Math.PI; pilot.pitch = 0; snapCam();
      }
    }
    if (code === 'KeyO' && (pilot.mode || 'air') === 'air') {       // T09: the herd out of sight behind the dragon, the scent on the compass
      const src = NV.sources(cs.field);
      let best = null, bd = Infinity;
      for (const h of src) { const d = Math.hypot(h.x - pilot.pos[0], h.z - pilot.pos[2]); if (d < bd) { bd = d; best = h; } }
      if (best) {
        const a = Math.atan2(pilot.pos[0] - best.x, pilot.pos[2] - best.z);
        let x = best.x + Math.sin(a) * 340, z = best.z + Math.cos(a) * 340;
        const R = TR.region(regionId).radius - 150, r = Math.hypot(x, z);
        if (r > R) { x *= R / r; z *= R / r; }
        pilot.pos = [x, TR.surfaceAt(regionId, x, z) + 40, z]; pilot.yaw = Math.atan2(x - best.x, z - best.z); pilot.pitch = 0; snapCam();
        if (cs.nav) cs.nav.next = 0;
      }
    }
    if (code === 'KeyT') {                                        // 200 inside the edge, mid exit arc, heading out; again = the next exit
      const exs = TR.region(regionId).exits || [];
      dbgExit = dbgExitRegion === regionId ? (dbgExit + 1) % Math.max(1, exs.length) : 0; dbgExitRegion = regionId;
      const ex = exs[dbgExit];
      if (ex) {
        flashPrompt(t('c.dbg.exit', { region: t(TR.region(ex.to).nameKey) }), 1.5);
        const mid = RG.arcMid(ex);
        const r = TR.region(regionId).radius - 200, x = Math.sin(mid) * r, z = Math.cos(mid) * r;
        pilot.pos = [x, TR.surfaceAt(regionId, x, z) + 50, z]; pilot.yaw = mid; pilot.pitch = 0; snapCam();
      }
    }
    if (code === 'Digit1' && !cs.inLair && cs.town && cs.town.places.length) {   // T12: next settlement, approach from 150 out
      dbgTown = (dbgTown + 1) % cs.town.places.length;
      const pl = cs.town.places[dbgTown], a = Math.atan2(pilot.pos[0] - pl.x, pilot.pos[2] - pl.z) || 0;
      const x = pl.x + Math.sin(a) * 150, z = pl.z + Math.cos(a) * 150;
      Object.assign(pilot, { mode: 'air', tr: null, pos: [x, TR.surfaceAt(regionId, x, z) + 30, z], yaw: a + Math.PI, pitch: 0, speed: stats.cruise });
      snapCam(); flashPrompt(t('c.dbg.town', { place: t('c.place.' + pl.type) }), 1.5);
    }
    if (code === 'Digit2' && !cs.inLair && cs.town) {            // T13: fire test on the nearest standing building
      let best = null, bd = 400;
      for (const b of cs.town.buildings) { const d = Math.hypot(b.pos[0] - pilot.pos[0], b.pos[2] - pilot.pos[2]); if (!b.ruin && !(b.fire > 0) && d < bd) { bd = d; best = b; } }
      if (best) { best.fire = 1e-3; best.heat = 0; flashPrompt(t('c.dbg.ignite', { b: t('c.building.' + best.type) }), 1.5); } else flashPrompt(t('c.dbg.noBuilding'), 1.5);
    }
    if (code === 'Digit3' && cs.town) {                         // T13: ruins come back now (as if fire.rebuild s had passed)
      let n = 0;
      for (const b of cs.town.buildings) if (b.ruin) { b.ruinAt = cs.stats.played - D.fire.rebuild - 1; n++; }
      const rs = cs.regionStates && cs.regionStates[cs.region];
      if (rs && rs.ruins) for (const r of rs.ruins) r.at = cs.stats.played - D.fire.rebuild - 1;
      flashPrompt(t('c.dbg.rebuilt', { n }), 1.5);
    }
    if (code === 'KeyV') { const okS = saveNow('debug'); flashPrompt(t(okS ? 'c.dbg.saved' : saveOff ? 'c.dbg.saveOff' : 'c.dbg.notSaved'), 1.5); }
    if (code === 'KeyU') { saveOff = true; SV.clear(storage); location.reload(); return; }
    if (code === 'KeyR') {
      Object.assign(dragon, { stage: 0, foodXp: 0, hp: D.stages[0].hp, hunger: D.hunger.start });
      refreshStage(); pilot.st = 100;
    }
  }

  /* ---------- main loop ---------- */
  let last = performance.now(), time = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    let dt = Math.min(0.05, rawDt); last = now;
    if (state === 'paused') dt = 0;
    time += reduceMotion ? dt * 0.3 : dt;
    if (state === 'hatch' && hatchScene) { runHatch(dt); if (debug) debugHud(dt); return; }

    if (state === 'intro' || !pilot) {
      idleHero(dt);
      const h = hero.root.position;                               // herds graze under the intro flight
      PR.step(cs.field, { pos: [h.x, h.y + 400, h.z], inv: 0 }, dt, { stats, rng });
    } else {
      if (state === 'play') {
        onEvents(ST.step(cs, readInput(), dt));
        survive(dt);
      }
      poseHero(dt);
      poseMother(dt);
      camDesired(tmpV);
      if (dt > 0) camPos.lerp(tmpV, 1 - Math.exp(-dt * 4.5));
      fwdV.set(Math.sin(pilot.yaw) * Math.cos(pilot.pitch), Math.sin(pilot.pitch), Math.cos(pilot.yaw) * Math.cos(pilot.pitch));
      const gb = heroPose.ground || 0, kc = Math.pow(heroScale, 0.75);   // T07: on the ground look a little ahead of the head
      camLook.set(pilot.pos[0], pilot.pos[1] + MT.lerp(2, 1.5 * kc, gb), pilot.pos[2]).addScaledVector(fwdV, MT.lerp(12, D.groundCam.look * kc, gb));
      if (cs.inLair) { const cl = CV.camera(pilot.pos, pilot.yaw, heroScale).look; camLook.set(cl[0], cl[1], cl[2]); }
      camera.position.copy(camPos);
      if (shake > 0 && !reduceMotion) { camera.position.x += (Math.random() - 0.5) * shake * 2; camera.position.y += (Math.random() - 0.5) * shake * 2; }
      shake = Math.max(0, shake - dt * 1.5);
      camera.lookAt(camLook);
      const fovT = pilot.boosting && state === 'play' ? 72 : 60;
      if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
      hud(dt);
    }
    syncScene();
    caveView.update(cs, time);
    sky.position.copy(camera.position);
    region.update(camera.position, time);
    if (dt > 0) updateParticles(dt);
    if (state === 'intro' || !pilot) mom.root.visible = false;
    motherHud();
    motherArrow();
    compassHud(dt);
    preyView.update(cs.field, time, carryPose());
    townView.update(cs.town, dt, { cam: camera.position, particles: qSet.particles, pxScale: renderer.domElement.height * 0.5, lights: fireLights, time });
    targetRing();
    fireTargetRing();
    renderer.render(scene, camera);
    sampleQuality(rawDt);
    if (debug) debugHud(dt);
  }

  /* ---------- ?debug panel: performance, dragon parameters, hotkeys ---------- */
  let dbgEl = null, dbgBox = null, dbgN = 0, dbgLast = performance.now();
  let dbgShown = !isTouch;                                       // touch: starts hidden; the DBG button toggles it everywhere
  function toggleDebug() {
    dbgShown = !dbgShown;
    if (dbgBox) dbgBox.hidden = !dbgShown;
    const b = $('#dbgBtn'); if (b) b.classList.toggle('on', dbgShown);
  }
  /** A DBG button next to pause (all devices), and one button per debug hotkey above the panel. */
  function debugUi() {
    const tog = document.createElement('button');
    tog.id = 'dbgBtn'; tog.textContent = 'DBG'; tog.setAttribute('aria-label', t('c.dbg.panel'));
    tog.style.cssText = 'pointer-events:auto;background:var(--panel);border:1px solid var(--line);color:var(--bone);height:40px;padding:0 10px;border-radius:20px;font:700 12px/1 ui-monospace,Menlo,monospace;margin-right:8px';
    $('#pauseBtn').before(tog);
    tog.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleDebug(); });
    const bar = document.createElement('div');
    bar.id = 'debugBar';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;pointer-events:auto;margin-bottom:6px';
    for (const [, what, code, label] of DEBUG_KEYS) {
      if (!label) continue;
      const b = document.createElement('button');
      b.textContent = label; b.title = what;
      b.style.cssText = 'min-height:36px;padding:0 10px;border-radius:4px;border:1px solid rgba(233,225,204,.25);background:rgba(6,10,8,.8);color:#ebe3cd;font:600 12px/1 ui-monospace,Menlo,monospace;touch-action:manipulation';
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.style.background = 'rgba(255,148,71,.45)'; debugKey(code); });
      const up = () => { b.style.background = 'rgba(6,10,8,.8)'; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      bar.appendChild(b);
    }
    dbgBox.prepend(bar);
  }
  const f1 = v => v.toFixed(1), f2 = v => v.toFixed(2);
  function debugHud() {
    if (!dbgEl) {
      // a fixed box holds the (touch) action buttons and the read-only panel
      dbgBox = document.createElement('div');
      dbgBox.id = 'debugBox';
      dbgBox.style.cssText = 'position:fixed;right:8px;top:calc(60px + env(safe-area-inset-top,0px));z-index:5;max-width:calc(100vw - 16px);pointer-events:none';
      dbgEl = document.createElement('div');
      dbgEl.id = 'debugPanel';
      dbgEl.style.cssText = 'font:' + (isTouch ? '10px/1.35' : '11.5px/1.4') + ' ui-monospace,Menlo,Consolas,monospace;color:#ebe3cd;background:rgba(6,10,8,.72);border:1px solid rgba(233,225,204,.16);padding:8px 10px;border-radius:4px;pointer-events:none;white-space:pre;overflow:hidden;opacity:.92';
      dbgBox.appendChild(dbgEl);
      document.body.appendChild(dbgBox);
      dbgBox.hidden = !dbgShown;
      debugUi();
    }
    dbgN++;
    const now = performance.now(), secs = (now - dbgLast) / 1000;
    if (secs < 0.5) return;
    const i = region.info, r = renderer.info.render;
    const L = [];
    L.push('BUILD   ' + BUILD + (params.get('v') ? '  (v=' + params.get('v') + ')' : ''));
    const mo = cs.story && cs.story.mother;
    const ml = MO.lesson(cs), mm = cs.mom;
    L.push('STORY   act ' + ((cs.story && cs.story.act) || 1) + '  mother ' + (mo ? 'lesson ' + mo.lesson + (ml ? ' ' + ml.id : '') + ' (' + mo.at + ')' + (mm ? ' ' + mm.phase + (mm.hidden ? ' hidden' : '') + ' prog ' + mm.prog.toFixed(1) : '') : '-'));
    L.push('PERF    ' + regionId + '  ' + Math.round(dbgN / secs) + ' fps');
    L.push('        draw ' + r.calls + '  tris ' + Math.round(r.triangles / 1000) + 'k  chunks ' + i.visible + '/' + i.chunks);
    L.push('        trees ' + i.trees + '  rocks ' + i.rocks + '  geo ' + renderer.info.memory.geometries + '  tex ' + renderer.info.memory.textures + '  swap ' + Math.round(lastSwapMs) + ' ms');
    L.push('QUALITY ' + qTier + ' (' + qSource + (qAutoFps != null ? ' ' + Math.round(qAutoFps) + ' fps' : '') + (qSampler && !qSampler.done ? ', measuring ' + Math.round(qSampler.time) + '/' + D.quality.auto.sample + ' s' : '') + ')' +
      '  px ' + f2(renderer.getPixelRatio()) + '  flora x' + f2(qSet.flora) + '  fog ' + Math.round(qSet.fogFar));
    if (pilot) {
      const st = D.stages[dragon.stage], next = D.stages[dragon.stage + 1];
      const ready = G.readyStage(dragon.foodXp, dragon.stage), e = HN.effects(dragon.hunger);
      L.push('DRAGON  ' + st.id + (ready > dragon.stage ? '  READY: ' + D.stages[ready].id : ''));
      L.push('        food ' + Math.round(dragon.foodXp) + (next ? '/' + next.foodFrom : ' max') + '  growth ' + f2(G.growthValue(dragon.foodXp)) + '  scale ' + f2(heroScale));
      L.push('        hp ' + f1(dragon.hp) + '/' + stats.hpMax + '  fire ' + Math.round(pilot.st));
      L.push('        hunger ' + f1(dragon.hunger) + ' ' + e.state);
      L.push('        speed ' + f1(pilot.speed) + '  alt ' + f1(F.altitude(pilot, regionId)) + '  r ' + Math.round(Math.hypot(pilot.pos[0], pilot.pos[2])));
      const lc = (pilot.mode || 'air') === 'air' ? WK.canLand(pilot, regionId, ST.solids(cs, heroScale).solidAt) : null;
      L.push('MOVE    ' + (pilot.mode || 'air') + (lc ? '  land ' + (lc.ok ? 'ok' : 'no: ' + lc.why) : '') + '  slope ' + f2(TR.surfaceSlope(regionId, pilot.pos[0], pilot.pos[2])) + '  legs ' + f2(heroPose.ground || 0) + ' wings ' + f2(heroPose.fold || 0) + ' stride ' + f2(heroPose.stride || 0));
      L.push('STATS   turn ' + f2(stats.turn) + '  cruise ' + stats.cruise + '  boost ' + stats.boost);
      L.push('        spot ' + f1(stats.spot) + '  carry ' + stats.carry + '  hunger x' + f1(stats.hungerMult));
      const pc = PR.census(cs.field), cp = ST.carriedPrey(cs);
      L.push('PREY    ' + pc.total + ' total  graze ' + (pc.graze || 0) + '  flee ' + (pc.flee || 0) + '  charge ' + (pc.charge || 0));
      L.push('HUNT    hint ' + (cs.hint || '-') + '  target ' + (cs.target != null ? cs.target : '-') + (cs.swoop != null ? ' SWOOP' : '') + '  carrying ' + (cp ? cp.type + ' (' + cp.food + ')' : '-') + '  eat ' + f1(dragon.eatT) + '/' + ST.eatTime(cs));
      L.push('LAIR    ' + (cs.inLair ? 'INSIDE x ' + f1(pilot.pos[0]) + ' z ' + f1(pilot.pos[2]) + '  station ' + (cs.station || '-') + (stationOpen ? ' (panel)' : '') + (cs.debugScale ? '  DEBUG SCALE ' + cs.debugScale : '') : 'mouth ' + Math.round(LR.distToMouth(cs))) + '  deaths ' + (dragon.deaths || 0) + '  larder ' + (cs.larder.map(it => it.type + ' ' + f1(it.food)).join(', ') || '-'));
      { const nv = cs.nav || {}; L.push('SMELL   range ' + Math.round(NV.smellRange(cs)) + '  scents ' + ((nv.scents || []).map(q => q.type + ' x' + q.n + ' ' + Math.round(q.dist) + (Math.abs(q.off) > 0.005 ? ' ~' + f2(q.off) : '')).join(', ') || '-')); }
      { const ti = townView ? townView.info : null, near = cs.town ? SE.near(cs.town, pilot.pos[0], pilot.pos[2], 400) : null;
        L.push('FIRE    burning ' + (ti ? ti.burning : 0) + '  ruins ' + (ti ? ti.ruins : 0) + '  burned civil ' + (cs.stats.civilBurned || 0) + ' order ' + (cs.stats.orderBurned || 0) + '  lights ' + fireLights.filter(L => L.intensity > 0).length);
        L.push('TOWNS   ' + (ti ? ti.buildings + ' buildings' : '-') + '  near ' + (near ? near.id + ' ' + Math.round(Math.hypot(near.x - pilot.pos[0], near.z - pilot.pos[2])) : '-') + '  found ' + (Object.keys(cs.discovered || {}).join(', ') || '-')); }
      L.push('TRAVEL  exit ' + (cs.exit ? cs.exit.to + ' (' + f1(cs.exitT) + ' s)' : '-'));
      L.push('SAVE    ' + (saveOff ? 'OFF ' : '') + (lastSave ? lastSave.why + ' at ' + lastSave.at + 's ' + (lastSave.ok ? 'ok' : 'not stored') : 'none yet') + '  next timer ' + Math.max(0, Math.round(D.save.every - (cs.saveT || 0))) + 's');
      L.push('        eaten ' + cs.stats.eaten + '  food ' + cs.stats.food + '  played ' + Math.round(cs.stats.played) + 's');
      L.push('EFFECT  speed x' + f2(e.speedMult) + '  fire regen x' + f2(e.stRegenMult));
      L.push('        breath ' + (e.canBreath ? 'yes' : 'NO') + '  carry max ' + (e.carryMax === Infinity ? '-' : e.carryMax) + '  hp ' + (e.hpRegen ? '+' + e.hpRegen : e.hpDrain ? '-' + e.hpDrain : '0') + '/s');
    }
    if (!isTouch) L.push('KEYS    ' + DEBUG_KEYS.map(k => k[0] + '  ' + k[1]).join('\n        '));
    dbgEl.textContent = L.join('\n');
    dbgN = 0; dbgLast = now;
  }

  if (isTouch) { const h = $('#hint'); h.setAttribute('data-i18n', 'c.tip.huntTouch'); h.textContent = t('c.tip.huntTouch'); }   // touch texts name buttons, not keys
  if (debug) { const f = document.querySelector('#intro .foot'); if (f) f.prepend(Object.assign(document.createElement('code'), { textContent: 'build ' + BUILD + ' ', style: 'font-size:11px;opacity:.7;display:block' })); }
  $('#loading').remove();
  setState('intro');
  requestAnimationFrame(frame);
  if (window.I18N) I18N.onChange(() => { if (hatchLineShown) $('#hatchLine').textContent = t(hatchLineShown); actionShown = moveShown = ''; promptShown = ''; $('#regionText').textContent = t(TR.region(regionId).nameKey); $('#stageText').textContent = stageName(dragon.stage); if (state === 'intro') introUi(); });

  if (debug) window.__vcamp = { C, D, MO, mom, scene, camera, renderer, hero, setState, hatchNow, skipHatch, get hatchScene() { return hatchScene; }, loadRegion, keys, get region() { return region; }, get pilot() { return pilot; }, get state() { return state; }, cs, dragon, feed, rest, snapCam, saveNow, startRun, introUi, SV, storage, get saved() { return saved; }, get saveOff() { return saveOff; }, openStation, closeStation, useStation, renderLair, caveView, CV, swapRegion, get lastSwapMs() { return lastSwapMs; }, get field() { return cs.field; }, QL, applyQuality, get quality() { return { tier: qTier, source: qSource, set: qSet, autoFps: qAutoFps, sampler: qSampler }; } };
})();
