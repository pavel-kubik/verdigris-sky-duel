/*
 * Verdigris Sky Duel - installable app support, shared by the solo and co-op pages.
 * Registers the service worker (sw.js next to this file) and drives the
 * "Install app" buttons (.installBtn) and hint text (.installHint).
 * Chrome/Edge/Android: uses the browser's install prompt.
 * iOS/iPadOS: there is no prompt, so the button explains Share > Add to Home Screen.
 * Also blocks pinch and double-tap page zoom on phones (all pages load this file).
 */
(function () {
  'use strict';
  const here = document.currentScript && document.currentScript.src;
  const t = k => (window.I18N ? window.I18N.t(k) : k);

  if ('serviceWorker' in navigator && here && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => {
      navigator.serviceWorker.register(new URL('sw.js', here)).catch(err => console.warn('Service worker not registered', err));
    });
  }

  /* No page zoom on phones (games need every touch): iOS Safari ignores user-scalable=no, so pinch (gesture* events,
     two-finger touches) and double-tap zoom are blocked here. Panels still scroll with one finger.
     Game controls (#touch: stick and round buttons, the canvas) use pointer events, so cancelling their touch events
     only stops the browser's zoom, never a control. If the page is zoomed anyway, pinching out is allowed again
     until it is back at 1x (otherwise there would be no way back). */
  document.documentElement.style.touchAction = 'manipulation';
  const vv = window.visualViewport;
  const zoomed = () => !!vv && vv.scale > 1.01;
  const stop = e => { if (e.cancelable && !zoomed()) e.preventDefault(); };
  const inGame = t => !!(t && t.closest && t.closest('#touch, canvas, #c, #hud'));
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
  document.addEventListener('touchstart', e => { if (e.touches.length > 1 && inGame(e.target)) stop(e); }, { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) stop(e); }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', e => {                      // double tap: game controls always, elsewhere outside buttons and inputs
    const now = Date.now();
    if (now - lastTap < 350 && (inGame(e.target) || !e.target.closest('button, input, select, a, label'))) stop(e);
    lastTap = now;
  }, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  // zoomed in anyway (older iOS, an accessibility setting): re-applying the viewport tag snaps Safari back to 1x
  if (vv) vv.addEventListener('resize', () => {
    if (!zoomed()) return;
    const m = document.querySelector('meta[name=viewport]');
    if (!m) return;
    const c = m.getAttribute('content');
    m.setAttribute('content', c.replace(/,?\s*maximum-scale=[^,]*/, '').replace(/,?\s*user-scalable=[^,]*/, '') + ',maximum-scale=1.0001');
    setTimeout(() => m.setAttribute('content', c), 60);
  });

  const installed = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;

  const buttons = () => document.querySelectorAll('.installBtn');
  const hints = () => document.querySelectorAll('.installHint');
  function showButtons(on) { buttons().forEach(b => { b.hidden = !on; }); }
  function showHint(key) { hints().forEach(h => { h.dataset.key = key; h.textContent = t(key); h.hidden = false; }); }

  async function install() {
    if (deferred) {
      const e = deferred; deferred = null;
      e.prompt();
      try { await e.userChoice; } catch (_) { }
      showButtons(false);
    } else if (isIOS) showHint('install.ios');
  }

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (!installed()) showButtons(true); });
  addEventListener('appinstalled', () => { deferred = null; showButtons(false); showHint('install.done'); });

  function init() {
    buttons().forEach(b => b.addEventListener('click', install));
    if (isIOS && !installed()) showButtons(true);
    if (window.I18N) window.I18N.onChange(() => hints().forEach(h => { if (h.dataset.key) h.textContent = t(h.dataset.key); }));
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);

  window.VSD_PWA = { install, get canPrompt() { return !!deferred; }, installed };
})();
