// Messages (Pavel's request 2026-11-04): a queue instead of replacing, reading time by length, tap to close, the log.
'use strict';
const { ok, near, core } = require('./harness.js');
const ML = core('msglog'), D = core('data');
const P = D.messages;
const run = (ml, secs, dt) => { const seen = []; for (let t = 0; t < secs - 1e-9; t += dt || 0.1) { const c = ML.step(ml, dt || 0.1); if (c && seen[seen.length - 1] !== c.title) seen.push(c.title); } return seen; };

// 1. reading time: by length, clamped to min .. max, never under the caller's secs
{
  near(ML.dur('Hi', ''), P.min, 1e-9, 'short: at least min');
  near(ML.dur('x'.repeat(500), ''), P.max, 1e-9, 'long: at most max');
  near(ML.dur('x'.repeat(48), 'y'.repeat(24)), 72 / P.perChar, 1e-9, '72 chars: chars / perChar');
  near(ML.dur('Hi', '', 7), 7, 1e-9, 'a longer secs from the caller wins');
  ok(P.min >= 4 && P.max <= 10, 'between 4 and 10 s');
}

// 2. queue: the second message waits for the first instead of replacing it
{
  const ml = ML.create();
  ML.push(ml, { title: 'You took the Ember Chalice', sub: 'Slower and no fire' });
  ML.push(ml, { title: 'Ballista bolt', sub: 'Turn away' });
  ok(ML.step(ml, 0.1).title === 'You took the Ember Chalice', 'first message on screen');
  const seen = run(ml, 3);
  ok(seen.length === 1, 'the second waits at least min s: ' + seen.join(' / '));
  const later = run(ml, 20);
  ok(later.indexOf('Ballista bolt') >= 0, 'then the second comes up');
  ok(ML.step(ml, 30) === null || ML.step(ml, 30) === null, 'and the queue empties');
}

// 3. waiting messages cut the current one to its share, never below min
{
  const ml = ML.create();
  ML.push(ml, { title: 'x'.repeat(100) });                     // 9 s alone
  ML.push(ml, { title: 'next' });
  ML.step(ml, 0);
  let t = 0;
  while (ML.step(ml, 0.05).title !== 'next') t += 0.05;
  ok(t >= P.min - 0.06 && t <= P.max * P.waitCut + 0.1, 'cut to its share with one waiting: ' + t.toFixed(2) + ' s');
  const solo = ML.create();
  ML.push(solo, { title: 'x'.repeat(100) });
  ML.step(solo, 0);
  let u = 0;
  while (ML.step(solo, 0.05)) u += 0.05;
  near(u, ML.dur('x'.repeat(100)), 0.11, 'alone it stays its full time');
}

// 4. tap closes it: the next comes up at once
{
  const ml = ML.create();
  ML.push(ml, { title: 'a' }); ML.push(ml, { title: 'b' });
  ML.step(ml, 0.1);
  ok(ML.dismiss(ml).title === 'b', 'tap: the next one');
  ok(ML.dismiss(ml) === null && ML.step(ml, 0.1) === null, 'tap the last: nothing on screen');
}

// 5. duplicates are not queued twice; the log counts them
{
  const ml = ML.create();
  ML.push(ml, { title: 'The bell rings', sub: 'Hamlet' });
  ML.step(ml, 0.1);
  ML.push(ml, { title: 'The bell rings', sub: 'Hamlet' });
  ok(ml.queue.length === 0, 'same as on screen: not queued again');
  ok(ML.entries(ml).length === 1 && ML.entries(ml)[0].n === 2, 'log: one entry, x2');
}

// 6. queue cap: the oldest plain message goes first, mission messages stay
{
  const ml = ML.create();
  ML.push(ml, { title: 'mission', kind: 'mission' });
  for (let i = 0; i < 10; i++) ML.push(ml, { title: 'info ' + i });
  ok(ml.queue.length === P.queueMax, 'at most queueMax waiting');
  ok(ml.queue.some(q => q.kind === 'mission'), 'the mission message is kept');
  ok(ml.queue[ml.queue.length - 1].title === 'info 9', 'the newest is kept');
}

// 7. the log: newest first, stamped, log-only entries, capped, by kind; clear keeps it
{
  const ml = ML.create();
  ML.push(ml, { title: 'one' }, { t: 0.3, played: 10 });
  ML.push(ml, { title: 'Fly with me', kind: 'mother', show: false }, { t: 0.31, played: 12 });
  ML.push(ml, { title: 'Mission failed', kind: 'mission' }, { t: 0.32, played: 20 });
  const e = ML.entries(ml);
  ok(e.map(x => x.title).join('|') === 'Mission failed|Fly with me|one', 'newest first');
  ok(e[2].t === 0.3 && e[2].played === 10, 'stamped with the clock and play time');
  ok(!ml.queue.concat(ml.cur ? [ml.cur] : []).some(q => q.title === 'Fly with me'), 'log only: never on screen');
  ok(ML.entries(ml, 'mission').length === 1, 'filter by kind');
  ML.clear(ml);
  ok(ML.step(ml, 0.1) === null && ML.entries(ml).length === 3, 'clear empties the screen, keeps the log');
  for (let i = 0; i < P.logMax + 10; i++) ML.push(ml, { title: 'n' + i, show: false });
  ok(ML.entries(ml).length === P.logMax, 'log capped at logMax');
}
