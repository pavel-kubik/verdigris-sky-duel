/*
 * Verdigris - immersive VR (WebXR) support, written for Meta Quest and Three.js r128. Used by the solo duel; nothing here is
 * specific to it, so other modes can attach later. Runs in the browser (window.VXR); mapPads also runs in Node for tests.
 *   VXR.mapPads(left, right, prev) -> { sx, sy, breath, boost, ball, pause, roll, prev }   pure; left / right are Gamepads or null
 *   VXR.attach({ renderer, scene, camera, button, onStart, onEnd, onError }) -> xr
 *     button: stays hidden unless the device supports immersive VR, a click enters VR
 *     xr.rig: parent of the camera; the headset pose is relative to it, so in VR a game moves the rig and never the camera
 *     xr.follow(pos, yaw, dt): moves the rig; the yaw is smoothed and there is never pitch or roll, so the horizon stays level
 *     xr.pad(): mapPads for this frame's controllers, or null outside VR
 *     xr.pointScale(): the eye-buffer equivalent of height / (2 tan(fov / 2)) for point sprites, or 0 before the first VR frame
 */
(function (root) {
  'use strict';
  const DEAD = 0.15, FLICK_ON = 0.7, FLICK_OFF = 0.3, YAW_RATE = 6;
  // xr-standard layout (WebXR Gamepads Module)
  const TRIGGER = 0, FACE_LOW = 4, FACE_HIGH = 5, STICK_X = 2, STICK_Y = 3;

  const axis = (gp, i) => (gp && gp.axes && +gp.axes[i]) || 0;
  const held = (gp, i) => { const b = gp && gp.buttons && gp.buttons[i]; return !!b && (!!b.pressed || b.value > 0.5); };

  /**
   * Left stick steers (up = positive sy), right trigger breathes, left trigger boosts, A is the fireball, B pauses and a flick of
   * the right stick rolls. ball, pause and roll are one-frame edges; pass the returned prev back in on the next frame.
   */
  function mapPads(left, right, prev) {
    const p = prev || { a: false, b: false, flick: 0 };
    let sx = axis(left, STICK_X), sy = -axis(left, STICK_Y);
    const m = Math.hypot(sx, sy);
    if (m < DEAD) sx = sy = 0;
    else { const k = (Math.min(1, m) - DEAD) / (1 - DEAD) / m; sx *= k; sy *= k; }
    const a = held(right, FACE_LOW), b = held(right, FACE_HIGH), rx = axis(right, STICK_X);
    let flick = p.flick, roll = 0;
    if (!flick && Math.abs(rx) > FLICK_ON) roll = flick = rx > 0 ? 1 : -1;
    else if (flick && Math.abs(rx) < FLICK_OFF) flick = 0;
    return { sx, sy, breath: held(right, TRIGGER), boost: held(left, TRIGGER), ball: a && !p.a, pause: b && !p.b, roll, prev: { a, b, flick } };
  }

  function attach(o) {
    const { renderer, scene, camera, button } = o;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');                 // origin at the seated head
    const rig = new THREE.Group();
    scene.add(rig); rig.add(camera);
    let prev = null, snap = true, scale = 0, busy = false;

    renderer.xr.addEventListener('sessionstart', () => {
      prev = null; snap = true; scale = 0;
      const layer = renderer.xr.getSession().renderState.baseLayer;
      if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = 1;   // r128 has no setFoveation; the outer view costs less
      if (o.onStart) o.onStart();
    });
    renderer.xr.addEventListener('sessionend', () => {
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
      if (o.onEnd) o.onEnd();
    });

    async function enter() {
      if (busy) return;
      busy = true;
      try { await renderer.xr.setSession(await navigator.xr.requestSession('immersive-vr')); }
      catch (e) { console.warn('VR not started', e); if (o.onError) o.onError(e); }
      busy = false;
    }
    if (button && navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then(ok => { button.hidden = !ok; }).catch(() => {});
      button.addEventListener('click', enter);
    }

    return {
      rig,
      follow(pos, yaw, dt) {
        rig.position.copy(pos);
        if (snap) { rig.rotation.y = yaw; snap = false; return; }
        const d = Math.atan2(Math.sin(yaw - rig.rotation.y), Math.cos(yaw - rig.rotation.y));
        rig.rotation.y += d * (1 - Math.exp(-dt * YAW_RATE));
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
      pointScale() {
        if (!scale && renderer.xr.isPresenting) {
          const eye = renderer.xr.getCamera(camera).cameras[0];
          if (eye) scale = eye.viewport.height * eye.projectionMatrix.elements[5] / 2;
        }
        return scale;
      },
    };
  }

  const api = { mapPads, attach };
  root.VXR = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
