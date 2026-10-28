/*
 * Verdigris campaign - client: rendering, input, main loop, HUD and panels.
 * All game rules live in core/ (window.VCamp); this file only draws and wires input.
 * Built up task by task (T01 scaffold, T02 dragon, T04 terrain, ...); see ai_sdlc/001_campaign/001_task_survival.md.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const t = (k, p) => (window.I18N ? I18N.t(k, p) : k);
  if (!window.THREE || !window.VCamp || !window.VDragon) { $('#loading').textContent = t('c.engineFail'); return; }
  const C = window.VCamp, D = C.need('data');
  const V3 = THREE.Vector3;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* ---------- placeholder ground: replaced by chunked region terrain in T04 ---------- */
  const R = D.regions[D.startRegion].radius;
  (function placeholderGround() {
    const g = new THREE.CircleGeometry(R * 1.2, 96); g.rotateX(-Math.PI / 2);
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 })));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(260, 150, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a312b, flatShading: true, roughness: 1 }));
    cone.position.y = 75; scene.add(cone);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(38, 24), new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: false }));
    glow.rotateX(-Math.PI / 2); glow.position.y = 120; scene.add(glow);
    const lava = new THREE.PointLight(0xff6a20, 1.6, 400); lava.position.set(0, 150, 0); scene.add(lava);
  })();

  /* ---------- the hatchling (flight arrives in T05; for now it circles the volcano) ---------- */
  const hero = VDragon.makeDragon(VDragon.GREEN);
  scene.add(hero.root);
  let phase = 0;
  function idleDragon(dt) {
    phase += dt * 6.2;
    const a = -time * 0.12, r = 330, y = 190 + Math.sin(time * 0.7) * 6;
    hero.root.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    hero.root.rotation.set(0, a - Math.PI / 2, 0.35, 'YXZ');    // yaw falls = right turn, bank right (as in the duel)
    hero.anim(time, dt, { phase, amp: 1, mouth: Math.sin(time * 0.9) > 0.92, turn: 0.4, look: 0 });
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
  let state = 'intro';
  function setState(s) {
    state = s;
    $('#intro').hidden = s !== 'intro';
    $('#wip').hidden = s !== 'wip';
  }
  $('#startBtn').onclick = () => setState('wip');
  $('#menuBtn').onclick = () => setState('intro');
  addEventListener('keydown', e => { if (e.code === 'Escape' && state === 'wip') setState('intro'); });

  /* ---------- main loop ---------- */
  let last = performance.now(), time = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    time += reduceMotion ? dt * 0.3 : dt;
    idleDragon(dt);
    // camera trails just outside and behind the circling dragon, looking inward so the volcano
    // sits behind it (replaced by the chase cam in T05)
    const a = -time * 0.12, P = hero.root.position;
    const ox = Math.sin(a), oz = Math.cos(a), mx = -Math.cos(a), mz = Math.sin(a);   // outward, motion
    camera.position.set(P.x + ox * 34 - mx * 26, P.y + 9, P.z + oz * 34 - mz * 26);
    camera.lookAt(P.x * 0.82 + mx * 8, P.y - 14, P.z * 0.82 + mz * 8);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  }

  $('#loading').remove();
  setState('intro');
  requestAnimationFrame(frame);

  if (location.search.includes('debug')) window.__vcamp = { C, D, scene, camera, hero, setState };
})();
