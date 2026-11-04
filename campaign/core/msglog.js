/*
 * Verdigris campaign - message queue and message log (Pavel's request 2026-11-04, after T12).
 * Messages (the big toast lines) no longer replace each other: they wait in a queue and each one stays long enough
 * to read (by its length, data.messages), a tap dismisses it early. Every message also goes into a log (newest first)
 * that the log panel shows together with the current mission.
 *   create() -> ml                         { queue, cur, left, log, seq }
 *   dur(title, sub, secs?) -> s            reading time: chars / perChar, at least max(min, secs), at most max
 *   push(ml, msg, stamp?) -> entry         msg { title, sub, kind ('info' | 'mission' | 'mother' | 'warn'), secs, show }
 *                                          stamp { t: clock 0..1, played }; show false = log only (mother lines, prompts).
 *                                          The same title + sub as the one on screen or the last queued is not queued twice
 *                                          (the log counts it: entry.n). The queue keeps at most queueMax, dropping the
 *                                          oldest 'info' first.
 *   step(ml, dt) -> cur | null             the message on screen; with others waiting it is cut to its share
 *                                          (at least min while waiting), then the next one comes up
 *   dismiss(ml) -> next | null             tap: the next one comes up at once
 *   clear(ml)                              empties the queue and the screen (death card, new run); the log stays
 *   entries(ml, kind?) -> [entry]          the log, newest first; entry { id, title, sub, kind, t, played, n }
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  const P = () => D.messages;

  const create = () => ({ queue: [], cur: null, left: 0, log: [], seq: 0 });

  function dur(title, sub, secs) {
    const n = String(title || '').length + String(sub || '').length;
    return Math.min(P().max, Math.max(P().min, secs || 0, n / P().perChar));
  }

  const same = (a, b) => !!(a && b && a.title === b.title && (a.sub || '') === (b.sub || ''));

  function push(ml, msg, stamp) {
    const kind = msg.kind || 'info', st = stamp || {};
    const top = ml.log[0];
    let entry;
    if (top && same(top, msg) && top.kind === kind) { top.n++; top.t = st.t; top.played = st.played; entry = top; }
    else {
      entry = { id: ++ml.seq, title: String(msg.title || ''), sub: msg.sub ? String(msg.sub) : '', kind, t: st.t, played: st.played, n: 1 };
      ml.log.unshift(entry);
      if (ml.log.length > P().logMax) ml.log.length = P().logMax;
    }
    if (msg.show === false) return entry;
    const last = ml.queue.length ? ml.queue[ml.queue.length - 1] : ml.cur;
    if (same(last, msg)) { if (last === ml.cur) ml.left = Math.max(ml.left, P().min); return entry; }   // shown again: stays a bit
    const item = { title: entry.title, sub: entry.sub, kind, secs: dur(entry.title, entry.sub, msg.secs), id: entry.id };
    ml.queue.push(item);
    while (ml.queue.length > P().queueMax) {
      const i = ml.queue.findIndex(q => q.kind === 'info');
      ml.queue.splice(i >= 0 ? i : 0, 1);
    }
    return entry;
  }

  function next(ml) {
    ml.cur = ml.queue.shift() || null;
    ml.left = ml.cur ? ml.cur.secs : 0;
    ml.shown = 0;
    return ml.cur;
  }

  function step(ml, dt) {
    if (!ml.cur) return next(ml);
    ml.left -= dt; ml.shown = (ml.shown || 0) + dt;
    if (ml.queue.length && ml.shown >= P().min) ml.left = Math.min(ml.left, P().waitCut * ml.cur.secs - ml.shown);   // others wait: its share
    if (ml.left <= 0) return next(ml);
    return ml.cur;
  }

  const dismiss = ml => next(ml);
  function clear(ml) { ml.queue.length = 0; ml.cur = null; ml.left = 0; }
  const entries = (ml, kind) => (kind ? ml.log.filter(e => e.kind === kind) : ml.log.slice());

  M.define('msglog', { create, dur, push, step, dismiss, clear, entries });
})(typeof self !== 'undefined' ? self : this);
