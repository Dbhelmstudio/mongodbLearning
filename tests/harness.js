'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = ['vendor/mingo.min.js', 'vendor/acorn.js', 'js/data.js', 'js/seed.js', 'js/engine.js', 'js/shell.js'];

function contentFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="(js\/content\/[^"]+)"><\/script>/g)].map(m => m[1]);
}

/* Loads the browser scripts into a fresh VM context with just enough globals for the engine (no DOM). */
function load(extra) {
  const store = {};
  const ctx = {
    console, performance, TextEncoder, setTimeout, clearTimeout,
    btoa: s => Buffer.from(s).toString('base64'),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of [...CORE, ...(extra === undefined ? contentFiles() : extra)]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

function newShell(MM) {
  const eng = new MM.Engine({ persist: false });
  return { eng, sh: new MM.Shell(eng) };
}

function readSource(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* Diagram and widget registries live in visualizers.js, which needs a DOM, so read their keys from source. */
function visualizerKeys() {
  const src = readSource('js/visualizers.js');
  const diagBlock = src.slice(src.indexOf('MM.diagrams = {'));
  const diagrams = [...diagBlock.slice(0, diagBlock.indexOf('\n  };')).matchAll(/^\s{4}'([a-z0-9-]+)':/gm)].map(m => m[1]);
  const widgetLine = (src.match(/MM\.widgets = \{([^}]*)\}/) || [])[1] || '';
  const widgets = [...widgetLine.matchAll(/'([a-z0-9-]+)'\s*:/g)].map(m => m[1]);
  return { diagrams, widgets };
}

module.exports = { ROOT, load, newShell, readSource, visualizerKeys, contentFiles };
