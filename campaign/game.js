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
  const C = window.VCamp, D = C.need('data'), F = C.need('flight'), TR = C.need('terrain'), G = C.need('growth'), HN = C.need('hunger');
  const V3 = THREE.Vector3;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { return null; } };

  /* ---------- renderer / scene (same look as the duel) ---------- */
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const FOG = { near: 400, far: 950 };
  scene.fog = new THREE.Fog(0x7d6a58, FOG.near, FOG.far);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  const sunDir = new V3(-0.55, 0.16, -0.82).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x15202a) }, mid: { value: new THREE.Color(0x4a4a48) }, bot: { value: new THREE.Color(0xc07a4a) }, sun: { value: sunDir } },
    vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top,mid,bot,sun;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.?mix(mix(bot,mid,smoothstep(0.,.2,h)),top,smoothstep(.2,.75,h)):mix(bot,mid*.55,smoothstep(0.,-.25,h));float s=max(dot(vP,sun),0.);c+=vec3(1.,.82,.55)*(pow(s,600.)*2.5+pow(s,10.)*.28);gl_FragColor=vec4(c,1.);}',
  }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight(0xa6cbc4, 0x3b2a1a, 0.85));
  const sunLight = new THREE.DirectionalLight(0xffc68c, 1.3); sunLight.position.copy(sunDir).multiplyScalar(300); scene.add(sunLight);
  const rim = new THREE.DirectionalLight(0x7fb7ff, 0.35); rim.position.set(200, 120, 250); scene.add(rim);

  /* ---------- region: chunked terrain, flora, lava, lair mouth (rebuilt on region change in T11) ---------- */
  let region = null, regionId = null;
  function loadRegion(id) {
    if (region) region.dispose();
    regionId = id;
    region = VRender.terrain.build(id, { isTouch, far: FOG.far });
    scene.add(region.group);
    scene.fog.color.set(region.fog);
    const u = sky.material.uniforms;
    u.top.value.set(region.sky.top); u.mid.value.set(region.sky.mid); u.bot.value.set(region.sky.bot);
    $('#regionText').textContent = t(TR.region(id).nameKey);
  }
  loadRegion(D.regions[params.get('region')] ? params.get('region') : D.startRegion);

  /* ---------- the hatchling ---------- */
  const hero = VDragon.makeDragon(VDragon.GREEN);
  scene.add(hero.root);
  // Dragon progress (moves into core/state with the save in T12-T14)
  const dragon = { stage: 0, foodXp: 0, hp: D.stages[0].hp, hunger: D.hunger.start };
  let stats = G.statsOf(0), heroScale = 1;
  let pilot = null, phase = 0;
  function refreshStage() {
    stats = G.statsOf(dragon.stage);
    heroScale = G.scaleOf(dragon.foodXp, dragon.stage);
    hero.root.scale.setScalar(heroScale);
    $('#stageText').textContent = t('c.stage.' + D.stages[dragon.stage].id);
  }

  // Fire breath: a flickering additive cone at the mouth (real particles and cooking come with T10)
  const flame = new THREE.Group();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flameCore = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  // cones with the tip at the origin, widening along +Z (Object3D.lookAt points +Z at the target)
  const fg = new THREE.ConeGeometry(3.2, 26, 10, 1, true); fg.translate(0, -13, 0); fg.rotateX(-Math.PI / 2);
  const fc = new THREE.ConeGeometry(1.2, 14, 8, 1, true); fc.translate(0, -7, 0); fc.rotateX(-Math.PI / 2);
  flame.add(new THREE.Mesh(fg, flameMat), new THREE.Mesh(fc, flameCore));
  flame.visible = false; scene.add(flame);
  const mouthW = new V3(), fwdV = new V3();

  /* ---------- input ---------- */
  const keys = {}, touch = { x: 0, y: 0, breath: false, boost: false };
  let mouseBreath = false, invert = store('vsd-invert') === '1';
  $('#invertBox').checked = invert;
  $('#invertBox').onchange = e => { invert = e.target.checked; store('vsd-invert', invert ? '1' : '0'); };
  addEventListener('keydown', e => {
    if (e.code === 'Escape') { if (state === 'play') setState('paused'); else if (state === 'paused') setState('play'); return; }
    if (e.repeat && (e.code === 'KeyQ' || e.code === 'KeyE')) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (state !== 'play') return;
    if (e.code === 'KeyQ') F.tryRoll(pilot, -1);
    if (e.code === 'KeyE') F.tryRoll(pilot, 1);
    if (debug) debugKey(e.code);
  });
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
  const clamp1 = v => Math.max(-1, Math.min(1, v));
  function readInput() {
    if (state !== 'play') return { sx: 0, sy: 0, breath: false, boost: false };
    const sy = clamp1(((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) + touch.y);
    return {
      sx: clamp1(((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) + touch.x),
      sy: invert ? -sy : sy,
      breath: !!(keys.Space || mouseBreath || touch.breath),
      boost: !!(keys.ShiftLeft || keys.ShiftRight || touch.boost),
    };
  }

  /* ---------- resize ---------- */
  let W = 1, Hh = 1;
  function resize() {
    W = innerWidth; Hh = innerHeight;
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  /* ---------- state ---------- */
  let state = 'intro', hintT = 0;
  function spawnPilot() {
    refreshStage();
    const s = TR.region(regionId).spawn || { x: 0, z: 0, y: 120, yaw: 0 };
    pilot = F.newPilot([s.x, Math.max(s.y, TR.surfaceAt(regionId, s.x, s.z) + 40), s.z], s.yaw, stats.cruise);
    snapCam();
  }
  function setState(s) {
    const prev = state; state = s;
    const inGame = s === 'play' || s === 'paused';
    $('#intro').hidden = s !== 'intro';
    $('#pause').hidden = s !== 'paused';
    $('#hudTop').hidden = !inGame;
    $('#legend').hidden = !(s === 'play' && !isTouch);
    $('#touch').hidden = !(s === 'play' && isTouch);
    if (s === 'play' && prev === 'intro') { spawnPilot(); hintT = 8; }
    $('#hint').hidden = !(s === 'play' && hintT > 0);
    if (s === 'intro') { pilot = null; hero.root.scale.setScalar(1); }
    mouseBreath = false; touch.breath = touch.boost = false;
    document.querySelectorAll('#btns .on').forEach(b => b.classList.remove('on'));
  }
  $('#startBtn').onclick = () => setState('play');
  $('#resumeBtn').onclick = () => setState('play');
  $('#menuBtn').onclick = () => setState('intro');
  $('#pauseBtn').onclick = () => { if (state === 'play') setState('paused'); else if (state === 'paused') setState('play'); };
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setState('paused'); });

  /* ---------- dragon pose + chase camera (same rig as the duel) ---------- */
  const camPos = new V3(), camLook = new V3(), tmpV = new V3();
  function camDesired(out) {
    const p = pilot.pos, bx = Math.sin(pilot.yaw), bz = Math.cos(pilot.yaw);
    const k = Math.pow(heroScale, 0.75), back = 22 * k;        // a bigger dragon needs the camera further back
    out.set(p[0] - bx * back, p[1] + (7 - pilot.pitch * 6) * k, p[2] - bz * back);
    out.y = Math.max(out.y, TR.surfaceAt(regionId, out.x, out.z) + 3);
    return out;
  }
  function snapCam() { camDesired(camPos); }

  function poseHero(dt) {
    const p = pilot;
    hero.root.position.set(p.pos[0], p.pos[1], p.pos[2]);
    hero.root.rotation.set(-p.pitch, p.yaw, p.roll + p.rollX, 'YXZ');
    const glide = p.pitch < -0.25 && !p.boosting;
    phase += dt * (p.boosting ? 9 : glide ? 3 : 6.2);
    hero.anim(time, dt, { phase, amp: glide ? 0.35 : p.boosting ? 1.1 : 1, mouth: p.breathing, turn: -p.sx, look: 0 });
    hero.root.updateMatrixWorld(true);
    flame.visible = p.breathing;
    if (p.breathing) {
      hero.mouth.getWorldPosition(mouthW);
      flame.position.copy(mouthW);
      fwdV.set(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch));
      flame.lookAt(mouthW.x + fwdV.x, mouthW.y + fwdV.y, mouthW.z + fwdV.z);
      const f = (0.85 + Math.random() * 0.3) * heroScale;
      flame.scale.set(f, f, (0.9 + Math.random() * 0.25) * heroScale);
    }
  }

  function idleHero(dt) {
    phase += dt * 6.2;
    const a = -time * 0.12, r = 330, y = (regionId === 'ash' ? 190 : 95) + Math.sin(time * 0.7) * 6;
    hero.root.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    hero.root.rotation.set(0, a - Math.PI / 2, 0.35, 'YXZ');    // yaw falls = right turn, bank right (as in the duel)
    hero.anim(time, dt, { phase, amp: 1, mouth: false, turn: 0.4, look: 0 });
    flame.visible = false;
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
    vig.style.opacity = hs === 'starving' && state === 'play' ? 0.3 + Math.sin(time * 4) * 0.12 : 0;
    if (hintT > 0 && state === 'play') { hintT -= dt; if (hintT <= 0) $('#hint').hidden = true; }
    if (toastT > 0) { toastT -= dt || 0.016; if (toastT <= 0) toastEl.style.opacity = 0; }
  }
  const toastEl = $('#toast'); let toastT = 0;
  function toast(title, sub, secs) {
    toastEl.innerHTML = '';
    toastEl.append(title);
    if (sub) { const sm = document.createElement('small'); sm.textContent = sub; toastEl.append(sm); }
    toastEl.style.opacity = 1; toastT = secs || 3;
  }
  const stageName = i => t('c.stage.' + D.stages[i].id);

  /* ---------- survival tick: hunger, its effects, growth moments ---------- */
  function survive(dt) {
    const changed = HN.step(dragon, dt, { boosting: pilot.boosting, breathing: pilot.breathing });
    if (changed === 'hungry') toast(t('c.toast.hungry'), t('c.toast.hungrySub'));
    if (changed === 'starving') toast(t('c.toast.starving'), t('c.toast.starvingSub'));
    // the dragon keeps growing visibly within its stage as it eats
    const sc = G.scaleOf(dragon.foodXp, dragon.stage);
    if (Math.abs(sc - heroScale) > 1e-4) { heroScale += (sc - heroScale) * Math.min(1, dt * 2); hero.root.scale.setScalar(heroScale); }
  }
  function feed(food) {
    if (HN.feed(dragon, food)) toast(t('c.toast.ready'), t('c.toast.readySub', { stage: stageName(dragon.stage + 1) }), 4);
  }
  /** Stand-in for lair.rest (T12): heal, refill fire and grow if ready. */
  function rest() {
    const r = G.growUp(dragon);
    stats = G.statsOf(dragon.stage);
    dragon.hp = stats.hpMax; pilot.st = 100;
    $('#stageText').textContent = stageName(dragon.stage);
    if (r.grew) toast(t('c.toast.grew', { stage: stageName(r.to) }), t('c.toast.grewSub'), 4);
  }
  function debugKey(code) {
    if (state !== 'play') return;
    if (code === 'KeyN') feed(100);
    if (code === 'KeyH') dragon.hunger = Math.max(0, dragon.hunger - 25);
    if (code === 'KeyL') rest();
  }

  /* ---------- main loop ---------- */
  let last = performance.now(), time = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === 'paused') dt = 0;
    time += reduceMotion ? dt * 0.3 : dt;

    if (state === 'intro' || !pilot) {
      idleHero(dt);
    } else {
      if (state === 'play') {
        F.step(pilot, readInput(), dt, { regionId, stats, effects: HN.effects(dragon.hunger) });
        survive(dt);
      }
      poseHero(dt);
      camDesired(tmpV);
      if (dt > 0) camPos.lerp(tmpV, 1 - Math.exp(-dt * 4.5));
      fwdV.set(Math.sin(pilot.yaw) * Math.cos(pilot.pitch), Math.sin(pilot.pitch), Math.cos(pilot.yaw) * Math.cos(pilot.pitch));
      camLook.set(pilot.pos[0], pilot.pos[1] + 2, pilot.pos[2]).addScaledVector(fwdV, 12);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      const fovT = pilot.boosting && state === 'play' ? 72 : 60;
      if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
      hud(dt);
    }
    sky.position.copy(camera.position);
    region.update(camera.position, time);
    renderer.render(scene, camera);
    if (debug) debugHud(dt);
  }

  /* ---------- ?debug: frame rate, draw calls, chunks (performance budget checks) ---------- */
  let dbgEl = null, dbgT = 0, dbgN = 0, dbgLast = performance.now();
  function debugHud() {
    if (!dbgEl) {
      dbgEl = document.createElement('div');
      dbgEl.style.cssText = 'position:fixed;right:8px;top:60px;font:12px/1.35 monospace;color:#ebe3cd;background:rgba(0,0,0,.55);padding:6px 8px;border-radius:4px;pointer-events:none;white-space:pre;z-index:5';
      document.body.appendChild(dbgEl);
    }
    dbgN++;
    const now = performance.now();
    dbgT = (now - dbgLast) / 1000;
    if (dbgT < 0.5) return;
    const i = region.info, r = renderer.info.render;
    let s = regionId + '  ' + Math.round(dbgN / dbgT) + ' fps\ndraw calls ' + r.calls + '  tris ' + Math.round(r.triangles / 1000) + 'k\nchunks ' + i.visible + '/' + i.chunks + '  trees ' + i.trees + '  rocks ' + i.rocks;
    if (pilot) s += '\nalt ' + F.altitude(pilot, regionId).toFixed(1) + '  speed ' + pilot.speed.toFixed(1) + '  r ' + Math.round(Math.hypot(pilot.pos[0], pilot.pos[2]));
    dbgEl.textContent = s;
    dbgN = 0; dbgLast = now;
  }

  $('#loading').remove();
  setState('intro');
  requestAnimationFrame(frame);
  if (window.I18N) I18N.onChange(() => { $('#regionText').textContent = t(TR.region(regionId).nameKey); $('#stageText').textContent = stageName(dragon.stage); });
  if (debug) { const h = $('#hint'); h.removeAttribute('data-i18n'); h.textContent = t('c.debug.keys'); }

  if (debug) window.__vcamp = { C, D, scene, camera, renderer, hero, setState, loadRegion, keys, get region() { return region; }, get pilot() { return pilot; }, get state() { return state; }, dragon, feed, rest };
})();
