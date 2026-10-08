'use strict';
/* Runs mongosh code from a file or argv against a fresh seeded engine and prints every value.
   Usage: node tests/probe.js file.js   or   node tests/probe.js -e 'db.orders.findOne()' */
const fs = require('fs');
const { load, newShell } = require('./harness');

const args = process.argv.slice(2);
const code = args[0] === '-e' ? args.slice(1).join(' ') : fs.readFileSync(args[0], 'utf8');
const ctx = load();
const { eng, sh } = newShell(ctx.MM);
eng.currentDb = 'shop';
sh.run(code, { collect: true }).then(r => {
  r.outputs.forEach(o => console.log(`[${o.type}] ${o.text}`));
  if (r.error) { console.error('ERROR', r.error.message || r.error); process.exitCode = 1; }
});
