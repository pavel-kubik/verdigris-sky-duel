/*
 * Verdigris campaign - minimal event bus. Listener errors are logged, never thrown,
 * so a broken HUD handler cannot stop the simulation.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;

  function createBus() {
    const map = new Map();
    return {
      on(type, fn) {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type).add(fn);
        return () => map.get(type).delete(fn);
      },
      off(type, fn) {
        if (map.has(type)) map.get(type).delete(fn);
      },
      emit(type, payload) {
        const fns = map.get(type);
        if (fns) fns.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
        const any = map.get('*');
        if (any) any.forEach(fn => { try { fn(type, payload); } catch (e) { console.error(e); } });
      },
    };
  }

  M.define('events', { createBus });
})(typeof self !== 'undefined' ? self : this);
