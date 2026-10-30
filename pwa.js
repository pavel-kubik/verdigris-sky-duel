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
     two-finger touchmove) and double-tap zoom are blocked here. Panels still scroll with one finger. */
  document.documentElement.style.touchAction = 'manipulation';
  const stop = e => { if (e.cancelable) e.preventDefault(); };
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) stop(e); }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', e => {                      // double tap outside buttons and inputs
    const now = Date.now();
    if (now - lastTap < 300 && e.cancelable && !e.target.closest('button, input, select, a, label')) e.preventDefault();
    lastTap = now;
  }, { passive: false });

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
