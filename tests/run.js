#!/usr/bin/env node
'use strict';
/*
 * Full content + engine test suite. Usage:
 *   node tests/run.js            all suites
 *   node tests/run.js --quick    skip the isolated and run-twice lesson passes
 *   node tests/run.js --only=lessons,problems
 *   node tests/run.js -v         print every lesson example result
 */
const { load, newShell, readSource, visualizerKeys, contentFiles } = require('./harness');

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const VERBOSE = args.includes('-v');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

let failures = 0;
const fail = (suite, msg) => { failures++; console.log(`  FAIL [${suite}] ${msg}`); };
const errText = r => ((r.outputs || []).find(o => o.type === 'error') || {}).text || r.error || '';

const ctx = load();
const MM = ctx.MM;
const U = MM.util;

function normalizeForCompare(v, p) {
  if (v && v._isCursor) v = v.toArray();
  const strip = x => {
    if (Array.isArray(x)) return x.map(strip);
    if (U.isDate(x)) return x;
    if (x && typeof x === 'object') { const o = {}; Object.keys(x).sort().forEach(k => { if (!(p.ignoreId && k === '_id')) o[k] = strip(x[k]); }); return o; }
    if (typeof x === 'number' && !Number.isInteger(x)) return Math.round(x * 1e4) / 1e4;
    return x;
  };
  v = strip(v);
  if (p.compare === 'unordered' && Array.isArray(v)) v = v.slice().sort((a, b) => U.cmp(U.keyOf(a), U.keyOf(b)));
  return v;
}
const problemCode = (p, c) => (p.setup ? p.setup + '\n;\n' : '') + c + (p.verify ? '\n;\n' + p.verify : '');

function planStages(plan) { const s = []; (function w(n) { if (!n) return; s.push(n.stage); w(n.inputStage); (n.inputStages || []).forEach(w); })(plan); return s; }

/* Pictographs are banned from UI copy; arrows, dashes and the middle dot are typography, not emoji. */
const EMOJI = /[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}]/u;

function tagBalance(html) {
  const issues = [];
  for (const tag of ['div', 'pre', 'ul', 'ol', 'table', 'details', 'section']) {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) issues.push(`<${tag}> ${open} open / ${close} close`);
  }
  return issues;
}

const GUIDE_PAGES = ['architecture', 'performance', 'internals', 'versions', 'labs'];

const suites = {
  async integrity() {
    const S = 'integrity';
    const { diagrams, widgets } = visualizerKeys();
    if (diagrams.length < 5 || widgets.length < 3) fail(S, `could not read visualizer registry (${diagrams.length} diagrams, ${widgets.length} widgets)`);
    const refCheck = (where, html) => {
      for (const m of String(html).matchAll(/data-diagram="([^"]+)"/g)) if (!diagrams.includes(m[1])) fail(S, `${where}: unknown diagram ${m[1]}`);
      for (const m of String(html).matchAll(/data-widget="([^"]+)"/g)) if (!widgets.includes(m[1])) fail(S, `${where}: unknown widget ${m[1]}`);
      for (const i of tagBalance(String(html))) fail(S, `${where}: unbalanced ${i}`);
    };
    const ids = new Set();
    for (const L of MM.LESSONS) {
      const w = `lesson ${L.id}`;
      if (ids.has(L.id)) fail(S, `${w}: duplicate id`); ids.add(L.id);
      if (!MM.MODULE_BY_ID[L.module]) fail(S, `${w}: unknown module ${L.module}`);
      for (const f of ['title', 'summary']) if (!L[f]) fail(S, `${w}: missing ${f}`);
      if (!L.sections || !L.sections.concept) fail(S, `${w}: missing sections.concept`);
      Object.entries(L.sections || {}).forEach(([k, html]) => refCheck(`${w}/${k}`, html));
      (L.quiz || []).forEach((q, i) => { if (!(q.answer >= 0 && q.answer < q.options.length)) fail(S, `${w}: quiz ${i} answer out of range`); });
      if (!(L.examples || []).length) fail(S, `${w}: no examples`);
      if (L.since && !/^\d+\.\d+$/.test(L.since)) fail(S, `${w}: bad since "${L.since}"`);
      (L.examples || []).forEach((ex, i) => { if (ex.since && !/^\d+\.\d+$/.test(ex.since)) fail(S, `${w}: example ${i} bad since`); });
      (L.exam || []).forEach(e => { if (!MM.EXAMS || !MM.EXAM_OBJECTIVE_BY_ID || !MM.EXAM_OBJECTIVE_BY_ID[e]) fail(S, `${w}: unknown exam objective ${e}`); });
    }
    for (const m of MM.MODULES) if (!MM.LESSONS.some(l => l.module === m.id)) fail(S, `module ${m.id} has no lessons`);
    const pids = new Set();
    for (const p of MM.PROBLEMS) {
      const w = `problem ${p.id}`;
      if (pids.has(p.id)) fail(S, `${w}: duplicate id`); pids.add(p.id);
      if (!['easy', 'medium', 'hard'].includes(p.difficulty)) fail(S, `${w}: bad difficulty`);
      if (!(p.level >= 1 && p.level <= 7)) fail(S, `${w}: bad level`);
      if (!p.solution || !p.prompt) fail(S, `${w}: missing solution or prompt`);
      refCheck(w, p.prompt);
    }
    for (const c of MM.INTERVIEW.categories || []) for (const it of c.items) {
      if (!['junior', 'mid', 'senior'].includes(it.level)) fail(S, `interview "${it.q.slice(0, 40)}": bad level`);
      if (!it.a || it.a.length < 80) fail(S, `interview "${it.q.slice(0, 40)}": answer too short`);
      if (it.since && !/^\d+\.\d+$/.test(it.since)) fail(S, `interview "${it.q.slice(0, 40)}": bad since`);
      refCheck(`interview ${c.id}`, it.a);
    }
    for (const k of GUIDE_PAGES) for (const s of MM.PAGES[k].sections) refCheck(`page ${k}/${s.id}`, s.html);
    /* A line starting with ( or [ joins the previous line under automatic semicolon insertion. */
    const asi = (where, code) => {
      const lines = String(code || '').split('\n');
      for (let i = 1; i < lines.length; i++) {
        if (!/^\s*[([]/.test(lines[i])) continue;
        let j = i - 1; while (j >= 0 && !lines[j].trim()) j--;
        if (j >= 0 && !/[;{},([]\s*$/.test(lines[j]) && !/^\s*\/\//.test(lines[j])) fail(S, `${where}: line ${i + 1} starts with "${lines[i].trim()[0]}" after an unterminated line`);
      }
    };
    MM.LESSONS.forEach(L => (L.examples || []).forEach(ex => { if (ex.runnable !== false) asi(`lesson ${L.id} "${ex.title}"`, ex.code); }));
    MM.PROBLEMS.forEach(p => ['setup', 'solution', 'starter'].forEach(f => asi(`problem ${p.id}.${f}`, p[f])));
    (MM.PAGES.snippets || []).forEach(sn => asi(`snippet ${sn.title}`, sn.code));
    (MM.SCENARIOS || []).forEach(sc => ['setup', 'check', 'fix'].forEach(f => asi(`scenario ${sc.id}.${f}`, sc[f])));
    for (const sc of MM.SCENARIOS || []) refCheck(`scenario ${sc.id}`, (sc.brief || '') + (sc.debrief || ''));
    for (const f of ['index.html', 'css/styles.css', 'js/app.js', 'js/data.js', 'js/visualizers.js', ...contentFiles()]) {
      readSource(f).split('\n').forEach((line, i) => { if (EMOJI.test(line)) fail(S, `${f}:${i + 1} contains a pictograph`); });
    }
    console.log(`  ${MM.LESSONS.length} lessons, ${MM.PROBLEMS.length} problems, ${(MM.INTERVIEW.categories || []).reduce((a, c) => a + c.items.length, 0)} interview items checked`);
  },

  async engine() {
    const S = 'engine';
    const { sh } = newShell(MM);
    const counts = await sh.run('({ o: db.orders.countDocuments(), c: db.customers.countDocuments(), p: db.products.countDocuments(), r: db.reviews.countDocuments(), e: db.events.countDocuments(), m: db.employees.countDocuments() })', { collect: true });
    const c = counts.values[0];
    if (!c || c.o !== 5000 || c.c !== 500 || c.p !== 120 || c.r !== 2000 || c.e !== 3000 || c.m !== 40) fail(S, 'seed counts changed: ' + JSON.stringify(c));
    const expectErr = async (code, re, what) => { const r = await sh.run(code); const t = errText(r); if (!re.test(t)) fail(S, `${what}: expected ${re}, got "${t.slice(0, 120)}"`); };
    await expectErr('db.t_u.drop()\ndb.t_u.createIndex({ e: 1 }, { unique: true })\ndb.t_u.insertOne({ e: 1 })\ndb.t_u.insertOne({ e: 1 })', /E11000|duplicate key/, 'unique index');
    await expectErr('db.t_v.drop()\ndb.createCollection("t_v", { validator: { $jsonSchema: { bsonType: "object", required: ["a"] } } })\ndb.t_v.insertOne({ b: 1 })', /validation/i, 'schema validation');
    await expectErr('db.orders.updateOne({}, { status: "x" })', /atomic operators|update operator/i, 'update without operators');
    const tx = await sh.run('db.t_tx.drop()\ndb.t_tx.insertOne({ _id: 1, n: 0 })\nconst s = db.getMongo().startSession(); s.startTransaction()\ns.getDatabase("shop").t_tx.updateOne({ _id: 1 }, { $inc: { n: 5 } })\nconst before = db.t_tx.findOne({ _id: 1 }).n\ns.commitTransaction();\n({ before, after: db.t_tx.findOne({ _id: 1 }).n })', { collect: true });
    const txv = tx.values[tx.values.length - 1];
    if (!txv || txv.before !== 0 || txv.after !== 5) fail(S, 'transaction isolation: ' + JSON.stringify(txv) + ' ' + errText(tx));
    const cs = await sh.run('const cs = db.orders.watch()\ndb.orders.updateOne({ orderNo: "ORD-100003" }, { $set: { status: "paid" } })\ndb.orders.updateOne({ orderNo: "ORD-100003" }, { $set: { status: "shipped" } })\nconst ev = cs.tryNext();\n({ type: ev && ev.operationType, hasToken: !!(ev && ev._id) })', { collect: true });
    const csv = cs.values[cs.values.length - 1];
    if (!csv || csv.type !== 'update' || !csv.hasToken) fail(S, 'change stream: ' + JSON.stringify(csv) + ' ' + errText(cs));
    const op = await sh.run('db.t_op.drop()\ndb.t_op.insertOne({ _id: 7, n: 1 })\ndb.t_op.updateOne({ _id: 7 }, { $inc: { n: 1 } })\ndb.getSiblingDB("local").oplog.rs.find({ ns: "shop.t_op" }).sort({ $natural: -1 }).limit(1).toArray()[0]', { collect: true });
    const opv = op.values[op.values.length - 1];
    if (!opv || opv.op !== 'u' || !opv.o || !opv.o.diff) fail(S, 'oplog update entry: ' + JSON.stringify(opv));
    const ts = await sh.run('db.t_ts.drop()\ndb.t_ts.insertMany([{ _id: 1, ts: Timestamp({ t: 5, i: 5 }) }, { _id: 2, ts: Timestamp({ t: 5, i: 40 }) }, { _id: 3, ts: Timestamp({ t: 6, i: 1 }) }]);\n({ gt: db.t_ts.find({ ts: { $gt: Timestamp({ t: 5, i: 10 }) } }).toArray().map(d => d._id), sorted: db.t_ts.find().sort({ ts: -1 }).toArray().map(d => d._id), kept: db.t_ts.findOne({ _id: 2 }).ts instanceof Timestamp })', { collect: true });
    const tsv = ts.values[ts.values.length - 1];
    if (!tsv || tsv.gt.join() !== '2,3' || tsv.sorted.join() !== '3,2,1' || !tsv.kept) fail(S, 'Timestamp storage and ordering: ' + JSON.stringify(tsv) + ' ' + errText(ts));
    const js = await sh.run('db.t_js.drop()\ndb.t_js.insertMany([{ a: 1 }, { email: "x@y" }, { email: 5 }]);\nconst rule = { $jsonSchema: { bsonType: "object", required: ["email"], properties: { email: { bsonType: "string" } } } };\n({ bad: db.t_js.countDocuments({ $nor: [rule] }), good: db.t_js.aggregate([{ $match: rule }]).toArray().length })', { collect: true });
    const jsv = js.values[js.values.length - 1];
    if (!jsv || jsv.bad !== 2 || jsv.good !== 1) fail(S, '$jsonSchema as a query operator: ' + JSON.stringify(jsv) + ' ' + errText(js));

    const q = 'db.orders.find({ status: "paid", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(20)';
    const ex = async ix => { const r = await sh.run(`db.orders.createIndex(${ix})\n${q}.hint(${ix}).explain("executionStats")`, { collect: true }); return r.values[1]; };
    const ers = await ex('{ status: 1, total: 1, createdAt: -1 }');
    const esr = await ex('{ status: 1, createdAt: -1, total: 1 }');
    if (!planStages(ers.queryPlanner.winningPlan).includes('SORT')) fail(S, 'E-R-S index should need a blocking SORT');
    if (planStages(esr.queryPlanner.winningPlan).includes('SORT')) fail(S, 'E-S-R index should not need a SORT');
    if (!(esr.executionStats.totalKeysExamined < ers.executionStats.totalKeysExamined)) fail(S, 'E-S-R should examine fewer keys than E-R-S');
    const cov = await sh.run('db.customers.createIndex({ tier: 1, "address.country": 1, name: 1 })\ndb.customers.find({ tier: "gold", "address.country": "India" }, { _id: 0, name: 1 }).explain("executionStats")', { collect: true });
    const covE = cov.values[1];
    if (covE.executionStats.totalDocsExamined !== 0 || !planStages(covE.queryPlanner.winningPlan).includes('PROJECTION_COVERED')) fail(S, 'covered query should examine 0 documents');
    console.log(`  engine assertions done (ESR keys ${ers.executionStats.totalKeysExamined} vs ${esr.executionStats.totalKeysExamined})`);
  },

  async lessons() {
    const lessons = MM.LESSONS.slice().sort((a, b) => MM.MODULE_BY_ID[a.module].num - MM.MODULE_BY_ID[b.module].num);
    const modes = QUICK ? ['sequential'] : ['sequential', 'isolated', 'twice'];
    for (const mode of modes) {
      let { eng, sh } = newShell(MM);
      let n = 0, before = failures;
      for (const L of lessons) {
        if (mode === 'isolated') ({ eng, sh } = newShell(MM));
        for (const ex of L.examples || []) {
          if (ex.runnable === false) continue;
          n++;
          eng.currentDb = 'shop';
          if (mode === 'twice') { await sh.run(ex.code); eng.currentDb = 'shop'; }
          const r = await sh.run(ex.code);
          const err = errText(r);
          if (ex.expectError && !err) fail('lessons/' + mode, `${L.id} "${ex.title}": expected an error`);
          if (!ex.expectError && err) fail('lessons/' + mode, `${L.id} "${ex.title}": ${err.split('\n')[0]}`);
          if (VERBOSE) console.log(`    [${L.id}] ${ex.title}\n      ${r.outputs.map(o => o.text.split('\n')[0]).join('\n      ').slice(0, 400)}`);
        }
      }
      console.log(`  ${mode}: ${n} examples, ${failures - before} failures`);
    }
  },

  async problems() {
    const S = 'problems';
    for (const p of MM.PROBLEMS) {
      const r1 = await MM.evaluate(problemCode(p, p.solution));
      const r2 = await MM.evaluate(problemCode(p, p.solution));
      const rs = await MM.evaluate(problemCode(p, p.starter || ''));
      if (r1.error) { fail(S, `${p.id}: solution error ${errText(r1)}`); continue; }
      if (!r1.values.length) { fail(S, `${p.id}: solution produced no value`); continue; }
      const k1 = U.keyOf(normalizeForCompare(r1.value, p)), k2 = U.keyOf(normalizeForCompare(r2.value, p));
      if (k1 !== k2) fail(S, `${p.id}: nondeterministic result`);
      if (rs.values.length && U.keyOf(normalizeForCompare(rs.value, p)) === k1) fail(S, `${p.id}: starter code already passes`);
    }
    console.log(`  ${MM.PROBLEMS.length} problems checked`);
  },

  async pages() {
    const S = 'pages';
    const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const blocks = [];
    const collect = (where, html) => { for (const m of String(html).matchAll(/<pre class="run"[^>]*?(?:data-title="([^"]*)")?[^>]*>([\s\S]*?)<\/pre>/g)) blocks.push({ where: `${where}: ${m[1] || ''}`, code: dec(m[2]) }); };
    for (const k of GUIDE_PAGES) MM.PAGES[k].sections.forEach(s => collect(`${k}/${s.id}`, s.html));
    (MM.INTERVIEW.categories || []).forEach(c => c.items.forEach(it => collect(`interview/${c.id}`, it.a)));
    (MM.PAGES.snippets || []).forEach(s => blocks.push({ where: 'snippet: ' + s.title, code: s.code }));
    for (const pass of [1, 2]) {
      const { eng, sh } = newShell(MM);
      for (const b of blocks) {
        eng.currentDb = 'shop';
        const r = await sh.run(b.code);
        const err = errText(r);
        if (err) fail(S, `pass ${pass} ${b.where}: ${err.split('\n')[0]}`);
      }
    }
    console.log(`  ${blocks.length} runnable blocks checked twice`);
  },

  async scenarios() {
    const S = 'scenarios';
    for (const sc of MM.SCENARIOS || []) {
      const { eng, sh } = newShell(MM);
      eng.currentDb = 'shop';
      const setup = await sh.run(sc.setup || '');
      if (errText(setup)) { fail(S, `${sc.id}: setup error ${errText(setup)}`); continue; }
      for (const step of sc.investigate || []) {
        eng.currentDb = 'shop';
        const r = await sh.run(step.code);
        if (errText(r)) fail(S, `${sc.id}: investigate "${step.title}" error ${errText(r).split('\n')[0]}`);
      }
      const runCheck = async label => {
        eng.currentDb = 'shop';
        const r = await sh.run(sc.check, { collect: true });
        if (errText(r)) { fail(S, `${sc.id}: check error (${label}) ${errText(r)}`); return null; }
        return r.values[r.values.length - 1];
      };
      const pre = await runCheck('before fix');
      if (pre && pre.ok) fail(S, `${sc.id}: check passes before the fix`);
      eng.currentDb = 'shop';
      const fx = await sh.run(sc.fix);
      if (errText(fx)) { fail(S, `${sc.id}: fix error ${errText(fx)}`); continue; }
      const post = await runCheck('after fix');
      if (!post || !post.ok) fail(S, `${sc.id}: check does not pass after the reference fix: ${JSON.stringify(post)}`);
    }
    console.log(`  ${(MM.SCENARIOS || []).length} scenarios checked`);
  }
};

(async () => {
  const t0 = Date.now();
  for (const [name, fn] of Object.entries(suites)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    console.log(name);
    try { await fn(); } catch (e) { fail(name, 'suite crashed: ' + (e.stack || e)); }
  }
  console.log(`\n${failures ? 'FAILED' : 'OK'}: ${failures} failure(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failures ? 1 : 0);
})();
