/*
 * Verdigris campaign - story (Phase 3 T17, 003_task_missions.md 5.8): act cards, mission briefings, outcome lines and the
 * mother's first castle raid. Texts are i18n keys (data.story), the client draws them (render/story-card.js).
 *
 *   act(cs) -> 1 | 2                    Act 1 until Drake, Act 2 from Drake (Act 3 starts in Phase 4)
 *   seen(cs, id) -> bool                a card or line already shown ('act1', 'act2', 'brief.<mission id>', 'raid', 'kingCity')
 *   mark(cs, id)                        remembers it (cs.story.seen, saved)
 *   pendingCard(cs) -> card | null      the act card to show now: { id, act, title, lines: [keys], scene }; the lowest unseen
 *                                       act card up to the current act (a Drake that never saw Act 1 sees it first)
 *   brief(cs, id) -> card | null        the story briefing of a mission the first time it is accepted: { id: 'brief.<id>',
 *                                       title, lines: [keys] } (marks it seen); null when seen or the mission has none
 *   outcome(id, ok) -> i18n key | null  the one-line story outcome of a mission (success or fail)
 *   step(cs, dt) -> events[]            once per frame (state.js): act change ('story:act' { act }), the mother's first
 *                                       castle raid ('story:raid' { id } when the first mission in a castle region is
 *                                       accepted, 'story:raidEnd' when it is over), her lines ('story:say' { key }):
 *                                       data.story.raidLine when the raid starts outside, kingCityLine on the first entry
 *                                       into the Bend with the raid on. cs.story.say = { key, t } is her caption for sayTime s.
 *   raid(cs) -> mission id | null       the mission the mother flies along on (core/mother.js 'escort' phase)
 *
 * cs.story = { act, mother, seen: [ids], raid: id | null, say: { key, t } | null }; act, seen and raid are saved.
 * Pure: no DOM, no THREE.
 */
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./umd.js') : root.VCamp;
  const D = M.need('data');
  const S = () => D.story;
  const MS = () => M.need('missions');

  const book = cs => {
    cs.story = cs.story || { act: 1, mother: null };
    if (!Array.isArray(cs.story.seen)) cs.story.seen = [];
    return cs.story;
  };
  const act = cs => ((cs.dragon && cs.dragon.stage) >= 1 ? 2 : 1);
  const seen = (cs, id) => book(cs).seen.indexOf(id) >= 0;
  function mark(cs, id) { const b = book(cs); if (b.seen.indexOf(id) < 0) b.seen.push(id); }

  function card(id) {
    const c = S().cards[id];
    return c ? { id, act: c.act, scene: c.scene, title: 'c.story.' + id + '.title', lines: c.lines.map(n => 'c.story.' + id + '.' + n) } : null;
  }
  function pendingCard(cs) {
    const a = act(cs);
    for (const id of Object.keys(S().cards)) if (S().cards[id].act <= a && !seen(cs, id)) return card(id);
    return null;
  }

  function brief(cs, id) {
    const n = S().briefs[id], key = 'brief.' + id;
    if (!n || seen(cs, key)) return null;
    mark(cs, key);
    const lines = [];
    for (let i = 1; i <= n; i++) lines.push('c.story.brief.' + id + '.' + i);
    return { id: key, title: 'c.mission.' + id, lines };
  }
  const outcome = (id, ok) => (S().briefs[id] ? 'c.story.out.' + id + '.' + (ok ? 'ok' : 'fail') : null);

  const castleMission = m => !!(m && D.regions[m.region] && S().raidRegions.indexOf(m.region) >= 0);
  const raid = cs => (cs.story && cs.story.raid) || null;

  function say(cs, key, out) {
    book(cs).say = { key, t: S().sayTime };
    out.push({ e: 'story:say', key });
  }

  function step(cs, dt) {
    const b = book(cs), out = [];
    const a = act(cs);
    if (a > (b.act || 1)) { b.act = a; out.push({ e: 'story:act', act: a }); }
    if (b.say && (b.say.t -= dt) <= 0) b.say = null;
    const m = MS().active(cs), def = m ? MS().def(m.id) : null;
    // the mother joins the first mission into a castle region (S().firstRaidMother), once
    if (S().firstRaidMother && !b.raid && def && castleMission(def) && !seen(cs, 'raid') && cs.story.mother) {
      b.raid = def.id;
      mark(cs, 'raid');
      out.push({ e: 'story:raid', id: def.id });
    }
    if (b.raid) {
      if (!m || m.id !== b.raid) { b.raid = null; b.say = null; out.push({ e: 'story:raidEnd' }); return out; }
      if (!b.raidSaid && !cs.inLair && !cs.inAerie) { b.raidSaid = true; say(cs, S().raidLine, out); }
      if (cs.region === S().kingCityRegion && !cs.inLair && !seen(cs, 'kingCity')) { mark(cs, 'kingCity'); say(cs, S().kingCityLine, out); }
    }
    return out;
  }

  /** The saved part (save.js storyOf): known ids only. */
  function saved(st) {
    const ok = id => typeof id === 'string' && /^[a-zA-Z0-9_.]{1,40}$/.test(id);
    return { seen: Array.isArray(st && st.seen) ? st.seen.filter((id, i, l) => ok(id) && l.indexOf(id) === i).slice(0, 64) : [],
             raid: st && typeof st.raid === 'string' && D.missions.some(m => m.id === st.raid) ? st.raid : null };
  }

  M.define('story', { act, seen, mark, pendingCard, brief, outcome, step, raid, saved });
})(typeof self !== 'undefined' ? self : this);
