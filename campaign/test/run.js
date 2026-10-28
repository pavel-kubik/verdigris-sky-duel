// Runs every campaign test file: node campaign/test/run.js
'use strict';
const fs = require('fs');
const path = require('path');
const { counter } = require('./harness.js');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const before = counter.checks;
  try {
    require(path.join(__dirname, f));
    console.log('ok   ' + f + ' (' + (counter.checks - before) + ' checks)');
  } catch (e) {
    failed++;
    console.log('FAIL ' + f);
    console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
  }
}
console.log((failed ? failed + ' of ' + files.length + ' files failed' : 'all ' + files.length + ' files passed') + ', ' + counter.checks + ' checks');
process.exitCode = failed ? 1 : 0;
