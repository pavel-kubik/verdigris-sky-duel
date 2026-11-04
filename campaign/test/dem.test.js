// Baked real terrain (tools/terrain, Phase 3 plan): campaign/core/dem-bend.js decodes to the grid it declares and still
// matches real Prague (heights of known places, the river at Karlsbridge, the Vltava's turn east and back west, which
// bank each landmark is on). Game axes: +X = west, +Z = north.
'use strict';
require('../core/dem-bend.js');
const { ok, core } = require('./harness.js');
const B = core('demBend');

const h = Buffer.from(B.h, 'base64'), w = Buffer.from(B.water, 'base64');
const idx = (x, z) => Math.round((z + B.radius) / B.cell) * B.size + Math.round((x + B.radius) / B.cell);
const height = (x, z) => h[idx(x, z)] + B.base;
const wet = (x, z) => { const i = idx(x, z); return (w[i >> 3] >> (7 - (i & 7))) & 1; };

ok(B.size === 2 * B.radius / B.cell + 1, 'size matches radius and cell');
ok(h.length === B.size * B.size, 'one height per grid point');
ok(w.length === Math.ceil(B.size * B.size / 8), 'one water bit per grid point');
ok(Math.abs(height(200, -830) - 236) <= 2, 'Vyshgard rock about 236 m: ' + height(200, -830));
ok(Math.abs(height(745, -230) - 326) <= 3, 'Petrovel about 326 m: ' + height(745, -230));
ok(wet(410, -125) === 1, 'the river flows under Karlsbridge');
ok(wet(230, -200) === 0 && wet(200, -830) === 0, 'Staromark and the castle rock are dry');
const xs = B.river.map(p => p[0]);
const east = Math.min(...xs), iEast = xs.indexOf(east);                     // game axes: +X = west, east is -X
ok(east < -400 && iEast > 0 && iEast < B.river.length - 1, 'the river turns east around the Holeshwick loop and comes back');
// real Prague: Vysehrad on the east bank, Petrin and Hradcany on the west bank, so the river runs between them
const riverX = z => { let best = null, bd = Infinity; for (const p of B.river) { const d = Math.abs(p[1] - z); if (d < bd) { bd = d; best = p[0]; } } return best; };
ok(200 < riverX(-830), 'Vyshgard (Vysehrad) is east of the river (smaller x): river x ' + riverX(-830));
ok(745 > riverX(-230) && 645 > riverX(0), 'Petrovel (Petrin) and Hradchan (Hradcany) are west of the river (larger x)');
ok(B.river[0][1] < -1000 && B.river[B.river.length - 1][1] > 800, 'it enters in the south and leaves in the north');
