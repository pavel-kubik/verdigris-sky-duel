/*
 * Verdigris campaign - day and night look (Phase 2 T21, 002_task_kingdom.md 6). Needs THREE and core/clock.js.
 *   VRender.sky.build({ hemi, sun, rim, fog, sunDir }) -> {
 *     mesh,                      the sky dome (gradient, sun / moon disc, stars at night); add it to the scene
 *     setRegion(region),         the day palette of the region (region.sky top / mid / bot, region.fog)
 *     update(t, camPos?),        lerps sky colours, fog colour, hemisphere colours and intensity, the sun / moon light
 *                                (direction, colour, intensity) and the rim light for clock time t; cheap, every frame
 *     state                      { t, light, phase } of the last update (debug panel)
 *   }
 * Only colours and intensities change (no shader recompile); the cave hides the dome and zeroes the lights itself.
 * Night keeps the hemisphere at look.hemiNight of the day intensity and a cool moon light, so the terrain and the
 * stick area stay readable on a phone; dusk and dawn tint the horizon and the fog toward look.dusk.
 */
(function (root) {
  'use strict';
  const VR = root.VRender = root.VRender || {};

  function build(o) {
    const CK = root.VCamp.need('clock'), D = root.VCamp.need('data'), K = D.clock.look, N = K.night;
    const C = c => new THREE.Color(c);
    const day = { top: C(0x15202a), mid: C(0x4a4a48), bot: C(0xc07a4a), fog: C(0x7d6a58) };
    const night = { top: C(N.top), mid: C(N.mid), bot: C(N.bot), fog: C(N.fog), hemiSky: C(N.hemiSky), hemiGround: C(N.hemiGround) };
    const duskC = C(K.dusk), moonC = C(K.moon.color);
    const base = {                                                // the scene's day lights as built in game.js
      hemi: o.hemi.intensity, hemiSky: o.hemi.color.clone(), hemiGround: o.hemi.groundColor.clone(),
      sun: o.sun.intensity, sunColor: o.sun.color.clone(), rim: o.rim.intensity,
    };
    const az0 = Math.atan2(o.sunDir.x, o.sunDir.z);               // the old fixed sun: azimuth at noon-ish
    const moonDir = new THREE.Vector3(0.45, 0.62, 0.55).normalize();
    const sunDir = o.sunDir.clone(), discDir = sunDir.clone(), lightDir = new THREE.Vector3();
    const uni = {
      top: { value: day.top.clone() }, mid: { value: day.mid.clone() }, bot: { value: day.bot.clone() },
      sun: { value: discDir }, sunCol: { value: new THREE.Vector3(1, 0.82, 0.55) }, stars: { value: 0 },
    };
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: uni,
      vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 top,mid,bot,sun,sunCol;uniform float stars;varying vec3 vP;' +
        'void main(){float h=vP.y;vec3 c=h>0.?mix(mix(bot,mid,smoothstep(0.,.2,h)),top,smoothstep(.2,.75,h)):mix(bot,mid*.55,smoothstep(0.,-.25,h));' +
        'float s=max(dot(vP,sun),0.);c+=sunCol*(pow(s,600.)*2.5+pow(s,10.)*.28);' +
        'if(stars>0.&&h>.04){vec3 q=floor(vP*230.);float n=fract(sin(dot(q,vec3(12.9898,78.233,45.164)))*43758.5453);' +
        'c+=vec3(.85,.9,1.)*step(.9965,n)*stars*smoothstep(.04,.3,h)*(.55+.45*fract(n*91.7));}' +
        'gl_FragColor=vec4(c,1.);}',
    }));
    mesh.renderOrder = -1;
    const state = { t: 0, light: 1, phase: 'day' };
    const tmp = new THREE.Color();
    const lerp3 = (out, a, b, k) => out.copy(a).lerp(b, k);

    function setRegion(region) {
      if (!region) return;
      day.top.set(region.sky.top); day.mid.set(region.sky.mid); day.bot.set(region.sky.bot); day.fog.set(region.fog);
    }

    /** The sun's direction at time t: rises in the east of the old fixed sun, highest at noon, sets at nightFrom. */
    function sunAt(t) {
      const E = CK.edges(), span = E.nightFrom - E.nightTo;
      const k = Math.min(1, Math.max(0, (t - E.nightTo) / span));
      const elev = K.sunElev[0] + (K.sunElev[1] - K.sunElev[0]) * Math.sin(Math.PI * k);
      const az = az0 + (k - 0.5) * 2.2;
      sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
      return sunDir;
    }

    function update(t) {
      const L = CK.light(t), dk = 4 * L * (1 - L);                // dk: 1 at the middle of dusk / dawn
      state.t = t; state.light = L; state.phase = CK.phase(t);
      lerp3(uni.top.value, night.top, day.top, L);
      lerp3(uni.mid.value, night.mid, day.mid, L).lerp(duskC, 0.18 * dk);
      lerp3(uni.bot.value, night.bot, day.bot, L).lerp(duskC, 0.5 * dk);
      if (o.fog) lerp3(o.fog.color, night.fog, day.fog, L).lerp(duskC, 0.22 * dk);
      // hemisphere: dimmer and moon blue at night, never dark
      o.hemi.intensity = base.hemi * (K.hemiNight + (1 - K.hemiNight) * L);
      lerp3(o.hemi.color, night.hemiSky, base.hemiSky, L);
      lerp3(o.hemi.groundColor, night.hemiGround, base.hemiGround, L);
      // one directional light: the sun by day (warm, redder at dusk), the moon by night; direction blends between them
      sunAt(t);
      lightDir.copy(moonDir).lerp(sunDir, L).normalize();
      o.sun.position.copy(lightDir).multiplyScalar(300);
      o.sun.intensity = base.sun * L + K.moon.intensity * (1 - L);
      lerp3(o.sun.color, moonC, base.sunColor, L).lerp(duskC, 0.35 * dk);
      o.rim.intensity = base.rim * (K.rimNight + (1 - K.rimNight) * L);
      // the disc in the dome: the sun while there is light, the moon (pale, smaller glow) once it is dark
      if (L > 0.02) { discDir.copy(sunDir); tmp.setRGB(1, 0.82, 0.55).lerp(duskC, 0.4 * dk); const g = Math.min(1, L * 3); uni.sunCol.value.set(tmp.r * g, tmp.g * g, tmp.b * g); }
      else { discDir.copy(moonDir); const g = 0.5 * (1 - L / 0.02); uni.sunCol.value.set(0.75 * g, 0.82 * g, 1.0 * g); }
      uni.stars.value = K.stars * Math.max(0, 1 - L * 2.5);
      return state;
    }

    return { mesh, setRegion, update, state };
  }

  VR.sky = { build };
})(typeof self !== 'undefined' ? self : this);
