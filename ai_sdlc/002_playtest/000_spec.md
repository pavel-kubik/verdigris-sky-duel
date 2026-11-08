# Verdigris Sky Duel - automated playtesting without an LLM

Status: draft, 2026-11-08. Owner: Pavel. Base branch: `campaign-phase-3` (the mission bots live there).

## 1. Goal

Test gameplay with local, seeded, probabilistic bots instead of an LLM playing the game. Runs cost no tokens, take
minutes, give the same result for the same seed and run hundreds of times per night. An LLM agent still writes and
maintains the bots and reads the reports. It does not play.

What this covers and what it does not:

| Area | Covered here | Still needs a person |
| --- | --- | --- |
| Crashes, NaN, softlocks, unwinnable missions | yes - monkey bot + invariants (T02, T03) | - |
| Balance (success rate, time, HP left, deaths, hunger) | yes - many seeds, distributions (T04, T05) | - |
| Regressions between PRs | yes - baseline compare in CI (T05, T07) | - |
| Phone layout (overlaps, tap targets, page errors) | yes - Playwright at 390 x 844 (T06) | - |
| Frame time on a mid-range phone | no (CI has a software renderer only) | Pavel's phone |
| Feel, visual form, "reads as Prague" | no | Pavel's checkpoints (Phase 3 T01, T02, T06) |

Exit criteria:
- `node campaign/playtest/run.js` runs every bot over a seed range and writes a JSON report and a Markdown summary.
- Two runs with the same seed give the same event-stream hash.
- The monkey bot runs 15 simulated minutes per seed on the main regions without an invariant failure; every failure
  prints a one-line repro command.
- GitHub Actions runs unit tests, a quick playtest and the phone layout check on every PR, and a long playtest nightly.
- The campaign agent puts the playtest summary in every PR body.

## 2. Current state (what already exists)

- `campaign/core` is pure and runs in Node; `state.step(cs, inp, dt)` advances one frame. A seeded RNG is
  `math.mulberry(seed)`, passed as `S.create({ rng })`.
- Scripted bots with probabilistic pilot profiles:
  - `test/bot.js` - hunting and growth to Drake; `novice` / `expert` (`001_task_survival.md` T16).
  - `test/raid-bot.js` - outpost raid; `careful` / `expert` (`002_task_kingdom.md` T24).
  - `test/mission-bot.js`, `test/destroy-bot.js` - Phase 3 missions (`003_task_missions.md` T13, T14, T19).
- Each bot test checks its own invariants inside a `check(cs, ev)` callback (sim, raid, mission.bot tests).
- Cost measured 2026-11-08 in the agent sandbox: about 1.2 s per seeded raid or mission run, full `run.js` 80 s.
- Gaps:
  - `Math.random` is the fallback RNG in `core/state.js` (create), `core/defenders.js` (3 places) and
    `core/settlement.js` (fire). A caller that forgets `rng` gets a run that cannot be repeated.
  - Invariants are copied between test files instead of shared.
  - Seed counts are fixed and small (6-16) and live inside the test files; results are pass / fail, not
    distributions.
  - No fuzzing: bots follow one good route, so states off that route are never visited.
  - The phone layout check is manual, done by the agent with screenshots; there is no CI at all
    (no `.github/workflows`).

## 3. Scope

### In scope
1. Determinism guard (T01).
2. Shared invariants module (T02).
3. Monkey bot: random inputs from a Markov chain over touch actions, softlock detection (T03).
4. Bot registry and playtest runner with parallel seeds, JSON + Markdown reports (T04).
5. Baselines and regression compare (T05).
6. Phone layout check in headless Chromium (T06).
7. GitHub Actions: PR and nightly workflows (T07).
8. Agent prompt and owner task page wiring (T08).

### Out of scope
- Reinforcement learning (PPO and similar). Revisit only if the monkey bot stops finding bugs and exploits are
  suspected (open question 3).
- A small local LLM (Ollama and similar): it adds nothing a seeded bot cannot do here, and it is weak at judging visuals.
- Real-device frame time measurements.
- Co-op / `mp/` bots (`mp/sim.test.js` stays as it is).

## 4. File structure

```
campaign/
  playtest/
    run.js            CLI runner: bots x profiles x seeds, worker pool, reports
    registry.js       bot list: { id, scenario(seed) -> cs, play(cs, opts) -> result, metrics(result) }
    invariants.js     shared per-step checks (moved out of the test files)
    monkey.js         Markov-chain input bot + softlock detector
    hash.js           event-stream hash (FNV-1a over e.e + rounded numbers)
    layout.mjs        Playwright phone layout check (T06), run outside the agent sandbox too
    baseline.json     expected metric bands per bot x profile (T05), committed
  test/
    determinism.test.js   same seed -> same hash; no Math.random reachable in core
    monkey.test.js        a few short monkey seeds inside the normal test run
.github/workflows/
  ci.yml              on pull_request: unit tests, quick playtest, layout
  nightly.yml         schedule: long playtest, report artifact
```

Existing bots stay in `campaign/test/` and are wrapped by `registry.js`, not moved, so current tests keep working.

## 5. Interfaces

### 5.1 Registry entry

```js
{
  id: 'raid',                                  // CLI name
  profiles: ['careful', 'expert'],
  scenario: (seed, profile) => cs,             // S.create({ rng: mulberry(seed), ... }) + setup (stage, region, hunger)
  play: (cs, { seed, profile, check, maxMin }) => result,   // calls the existing bot, check() runs every step
  metrics: result => ({ success: bool, minutes, hpLeft, deaths, hungerMin, gold, ... })
}
```

Initial entries: `growth` (bot.js), `raid` (raid-bot.js), `steal`, `destroy`, `intercept` (mission-bot.js /
destroy-bot.js), `monkey` (monkey.js).

### 5.2 Invariants

`invariants.js` exports `check(cs, ev, ctx) -> string[]` (empty when all hold), built from the checks already in
sim, raid and mission.bot tests:
- every number in `cs.dragon` finite; hunger 0-100; HP above 0 unless a `dragon:died` event this frame;
- prey count and projectile count bounded (`data.js` caps);
- gold never negative; heat in `0..maxHeat` per region;
- dragon never inside a solid (settlement, castle);
- mission timer never negative; mission loot never banked after `mission:failed`;
- region id and station id always known to `data.js`.
Bot tests switch to this module; their own extra checks stay local.

### 5.3 Monkey bot

- Input alphabet = what a phone player can do: stick direction (8 sectors + centre), Breath, Boost, Roll, Action slot
  (hold / tap), Move slot (tap), station taps in the cave, mission board accept. Taken from `controls.slots(cs)`, so
  only buttons that are visible on screen are pressed - this also checks that every action is reachable by touch.
- A Markov chain picks the next input from the current one (sticky: keep the stick 0.5-3 s, buttons in short bursts);
  weights in `monkey.js`, a `wild` profile with flat weights and a `player` profile biased towards flying forward and
  pressing the context slots.
- Start states: seeds rotate through scenarios (fresh hatchling, Drake in the Farmlands, Drake in the Veltava Bend,
  in the cave with a mission accepted, at night at alert 3).
- Softlock: no progress event (`region:enter`, `prey:*`, `dragon:landed`, `lair:enter`, `mission:*`, position change
  over 20 units) for 120 simulated s while the dragon is not resting = failure. A dragon stuck in a solid or under the
  terrain = failure.
- On failure: report seed, profile, scenario, frame number, last 50 inputs and events, and the repro command
  `node campaign/playtest/run.js --bot monkey --seed 4711 --profile wild --trace`.

### 5.4 Runner CLI

```
node campaign/playtest/run.js [--bot raid,steal|all] [--profile careful] [--seeds 1-200] [--jobs 4]
                              [--quick|--nightly] [--baseline check|update] [--trace] [--out playtest-out/]
```

- `--quick` = 20 seeds per bot x profile and 20 monkey seeds of 5 min; `--nightly` = 200 seeds and 300 monkey seeds
  of 15 min.
- Seeds run in `worker_threads`, `--jobs` defaults to the CPU count.
- Output `playtest-out/report.json` (every run) and `playtest-out/summary.md`:

| bot | profile | runs | success | min p10 / p50 / p90 | HP left p50 | deaths | invariant fails | vs baseline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- Exit code 1 on any invariant failure, softlock or baseline breach.
- `playtest-out/` is in `.gitignore`.

### 5.5 Baseline

`baseline.json` holds bands per bot x profile, e.g. `raid.careful: { success: [0.95, 1], p50Min: [4.5, 7], hpLeftP50: [0.3, 0.8] }`.
The first bands come from the acceptance criteria in the phase task files (growth 25-35 min novice mean, raid and
missions 5-10 min with 20% HP left). `--baseline update` rewrites it from the last nightly; that is a deliberate
commit with the reason in the PR, done only together with a `data.js` balancing change.

### 5.6 Phone layout check

`layout.mjs` (Playwright, Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`, service workers blocked):
- Viewports: 390 x 844 portrait and 844 x 390 landscape with `hasTouch` and `isMobile`, then 1280 x 800 desktop.
- Screens: intro, field HUD in flight, ground (walking), cave with a station panel, mission board, map, debug panel
  (`?debug`, via the DBG button). States are reached through `window.__vcamp` in `page.evaluate`, not by playing.
- Checks: zero page errors and console errors; every visible button at least 36 x 36 px; HUD, prompts, toasts and
  panels do not overlap the stick zone or the right-thumb buttons (bounding boxes); no text overflows its box; texts
  on touch name buttons, not keys (no `Enter`, `Space`, `Shift`, single-letter key hints in visible text).
- Screenshots go to `playtest-out/layout/` and the CI artifact, never into the repo.
- Three.js r128: CI downloads it once and caches it; the agent sandbox keeps its current local-file route.

## 6. Task breakdown

Sizes: S < 2 h, M 2-5 h, L 5-10 h of AI-assisted work. Each task ends with `node campaign/test/run.js` and
`node mp/sim.test.js` passing.

| Task | What | Depends | Size | Acceptance |
| --- | --- | --- | --- | --- |
| T01 | Determinism guard: core falls back to `cs.rng` instead of `Math.random` (`state.js`, `defenders.js`, `settlement.js`); `S.create` without `rng` uses `mulberry(1)` and warns once; `hash.js`; `test/determinism.test.js` | - | S | Same seed -> same hash over a 5 min raid and a 5 min mission run; a test fails if `Math.random` appears in `campaign/core/*.js`; existing bot numbers unchanged (or the task file note updated if a run changes) |
| T02 | `playtest/invariants.js` from the sim, raid and mission.bot checks; those tests use it | T01 | S | Same check counts or more; one invariant list documented in the file header |
| T03 | `playtest/monkey.js` + `test/monkey.test.js` (5 seeds x 2 min inside `run.js`) | T02 | M | 300 seeds x 15 min on the five start states run with no failure, or each failure found is fixed in the same branch or filed in the PR with its repro command; a planted bug (dragon pushed under the terrain) is caught |
| T04 | `playtest/registry.js` + `playtest/run.js` (worker pool, report.json, summary.md, `--trace`) | T02 | M | `--quick` for all bots finishes in under 3 min on 4 cores; the summary table matches the format above; `--trace` prints the event log of one seed |
| T05 | `playtest/baseline.json` + `--baseline check|update` | T04 | S | A planted change (archer damage x2 in `data.js`) breaks the raid band and fails the run; reverting passes |
| T06 | `playtest/layout.mjs` | - | M | Runs locally and in CI; all listed screens at both phone sizes pass, or each finding is fixed or filed; a planted overlap (toast moved over the stick) fails |
| T07 | `.github/workflows/ci.yml` (PR: unit tests, `--quick`, layout) + `nightly.yml` (02:17 Prague: `--nightly`, upload `playtest-out/` as an artifact, open or update one issue "Nightly playtest failed" on failure) | T04, T05, T06 | S | Both workflows green on `campaign-phase-3`; a PR with a planted failure shows a red check with the summary in the job summary |
| T08 | `agent_prompt.md`: run `--quick` before every push and paste `summary.md` into the PR body; balancing tasks run `--nightly` locally for the touched bots; owner task page gets the last nightly result line. README tests paragraph updated | T07 | S | The next agent PR carries the summary; README lists the playtest commands |

Order: T01 -> T02 -> (T03, T04) -> T05; T06 in parallel; then T07, T08.

## 7. Performance budget

| Run | Budget |
| --- | --- |
| `test/run.js` (unit tests incl. monkey.test.js) | +15 s at most over today's 80 s |
| `run.js --quick` | < 3 min on a 4-core GitHub runner |
| `layout.mjs` | < 4 min (software renderer, states set through `__vcamp`) |
| `run.js --nightly` | < 40 min on a 4-core runner |

A seeded run must not render: bots use core only. If a run gets slower than 2 s per simulated 5 min, profile
`state.step` before adding seeds.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Removing the `Math.random` fallbacks shifts existing bot results | T01 compares numbers before / after; any change is noted in the task file like a balancing pass |
| Monkey bot floods the PR with known, low-value failures | Known-issue list in `monkey.js` with a link per entry, nightly only reports new signatures (invariant + scenario) |
| Bands too tight -> flaky CI | Bands from 200 seeds, p50 not mean; seeds fixed, so no randomness between runs of the same commit |
| Bots tuned to the bot, not to people | Profiles keep human error rates (botched swoops, hesitant landings); Pavel's phone checkpoints stay the feel gate |
| Layout check in CI differs from a real phone | Same viewport and touch flags as the agent check; real phone stays the final check |
| GitHub Actions minutes | Public repo: free standard runners |

## 9. Open design questions (recommended defaults)

1. Base branch: put this on `campaign-phase-3` and merge to `main` with Phase 3, or a separate branch from `main`
   now? Default: `campaign-phase-3`, the mission bots are only there.
2. Nightly failures: a GitHub issue, a line on the owner task page, or both? Default: both.
3. Reinforcement learning to search for exploits (for example endless gold loops): later or never? Default: later,
   after Phase 4, only if the monkey bot stops finding bugs.
4. Should a failing `--quick` block merging (branch protection) or only show red? Default: show red only, until the
   bands have been stable for two weeks.
