// Mission bot (Phase 3 T13; T19 adds the destroy and intercept missions): accepts a mission at the board in the cave,
// then flies it with the raid bot (test/raid-bot.js) - out to the mission's region, the objective, home to the lair or
// into a found aerie (escape 'aerie': the aerie of the region it is in when that is nearer than the exit home).
// Steal: lands by the relic at the target's door (inside the castle walls), takes it on foot, escapes, banks it.
// Uses only CampaignState input (S.missionAct, S.step, S.lairLeave), never edits the state.
'use strict';
const R = require('./raid-bot.js');
const M = require('../core/umd.js');
const S = M.need('state'), MS = M.need('missions');

/**
 * Fly mission `id` from the cave. Returns the raid result plus { accepted, success, failed, used (mission s on the
 * timer), landed: [x, z] where the dragon first set down in the mission region, walkFrom (the same, for the pickup) }.
 */
function fly(cs, id, opts) {
  const m = MS.def(id), o = Object.assign({ escape: 'lair', maxMin: 15 }, opts);
  const acc = S.missionAct(cs, 'accept', id);
  const accepted = acc.some(e => e.e === 'mission:accepted');
  let landed = null;
  const check = (c, ev) => {
    const p = c.dragon.pilot;
    if (!landed && c.region === m.region && p && p.mode === 'ground' && !c.inLair) landed = [p.pos[0], p.pos[2]];
    if (o.check) o.check(c, ev);
  };
  const kind = m.type === 'steal' ? 'relic' : null;
  const r = R.raid(cs, Object.assign({}, o, { dest: m.region, kind, check }));
  const success = r.stats.success || null, failed = r.stats.failed || null;
  return Object.assign(r, { accepted, success, failed, landed, used: success ? m.time - success.left : null });
}

module.exports = { fly };
