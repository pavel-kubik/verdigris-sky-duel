/*
 * Verdigris campaign - touch action layout (000_spec.md section 1, 002_task_kingdom.md T01).
 * The right thumb has 3 fixed buttons (Breath, Boost, Roll) and 2 context slots that show the action that
 * applies right now and hide when nothing applies:
 *   Action (hold): Grab / swoop while a prey is in reach or targeted, Eat while carrying one.
 *   Move (tap):    Fly to <region> at an exit, Enter cave close to the lair mouth, Land where landing is allowed
 *                  (cs.landOk), Fly (take off) on the ground (T06).
 *
 *   slots(cs) -> { action: 'grab' | 'eat' | null, move: { kind: 'travel', to } | { kind: 'cave' } | { kind: 'land' } | { kind: 'fly' } | null,
 *                  roll: boolean }   roll only in the air
 *   input(kind, held) -> partial state.step input for a held Action press ({ grab } or { eat })
 *   moveInput(move) -> partial state.step input for a Move tap ({ confirm }, { enter } or { land })
 * Pure: reads cs (after state.step set cs.hint and cs.exit) and lair.canEnter.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const LR = M.need('lair');

  const GRAB_HINTS = { grab: 1, swoop: 1 };

  function slots(cs) {
    const out = { action: null, move: null, roll: true };
    if (!cs || cs.inLair || !cs.dragon || !cs.dragon.pilot) return out;
    const mode = cs.dragon.pilot.mode || 'air';
    out.roll = mode === 'air';
    if (cs.dragon.carried != null) out.action = 'eat';
    else if (GRAB_HINTS[cs.hint]) out.action = 'grab';
    if (cs.exit) out.move = { kind: 'travel', to: cs.exit.to };
    else if (LR.canEnter(cs)) out.move = { kind: 'cave' };
    else if (mode === 'ground') out.move = { kind: 'fly' };
    else if (mode === 'air' && cs.landOk) out.move = { kind: 'land' };
    return out;
  }

  /** The Action press is latched at pointerdown: a grab hold that catches a prey does not start eating it. */
  function input(kind, held) {
    return { grab: !!held && kind === 'grab', eat: !!held && kind === 'eat' };
  }

  function moveInput(move) {
    const k = move && move.kind;
    return { confirm: k === 'travel', enter: k === 'cave', land: k === 'land' || k === 'fly' };
  }

  M.define('controls', { slots, input, moveInput });
})(typeof self !== 'undefined' ? self : this);
