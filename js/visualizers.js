/* =====================================================================
   visualizers.js — explain trees, pipeline stepper, SVG diagrams and
   interactive simulators (replica set, sharding, write path, ESR lab,
   sizing and oplog calculators).
   ===================================================================== */
(function () {
  'use strict';
  const MM = window.MM;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------
     Explain renderer
     ------------------------------------------------------------------ */
  const STAGE_COLOR = { COLLSCAN: '#f87171', IXSCAN: '#00ed64', FETCH: '#38bdf8', SORT: '#f59e0b', LIMIT: '#a78bfa', SKIP: '#a78bfa', PROJECTION_COVERED: '#c084fc', PROJECTION_SIMPLE: '#94a3b8', PROJECTION_DEFAULT: '#94a3b8', OR: '#fbbf24', SUBPLAN: '#fbbf24', TEXT_MATCH: '#f472b6', TEXT_OR: '#f472b6', COUNT_SCAN: '#00ed64' };
  function stageBox(st) {
    const kv = [];
    if (st.indexName) kv.push('index: ' + st.indexName + ' ' + MM.util.fmtInline(st.keyPattern, 0));
    if (st.indexBounds && Object.keys(st.indexBounds).length) kv.push('bounds: ' + Object.keys(st.indexBounds).map(k => k + ' ' + st.indexBounds[k].join(' U ')).join(' · '));
    if (st.isMultiKey) kv.push('multikey index');
    if (st.direction && st.stage === 'IXSCAN' && st.direction === 'backward') kv.push('scans backward');
    if (st.filter) kv.push('filter: ' + MM.util.fmtInline(st.filter, 0));
    if (st.sortPattern) kv.push('sort: ' + MM.util.fmtInline(st.sortPattern, 0) + (st.limitAmount ? ' (top-' + st.limitAmount + ')' : '') + ' — blocking, in memory');
    if (st.limitAmount && st.stage === 'LIMIT') kv.push('limit ' + st.limitAmount);
    if (st.skipAmount) kv.push('skip ' + st.skipAmount);
    if (st.transformBy) kv.push('projection: ' + MM.util.fmtInline(st.transformBy, 0));
    const nums = [];
    if (st.nReturned !== undefined) nums.push('nReturned ' + st.nReturned);
    if (st.keysExamined !== undefined) nums.push('keysExamined ' + st.keysExamined);
    if (st.docsExamined !== undefined) nums.push('docsExamined ' + st.docsExamined);
    if (st.works !== undefined) nums.push('works ' + st.works);
    const kids = st.inputStage ? [st.inputStage] : (st.inputStages || []);
    return `<div class="stage" style="--c:${STAGE_COLOR[st.stage] || '#38bdf8'}"><div class="name">${esc(st.stage)}</div>${kv.map(k => `<div class="kv">${esc(k)}</div>`).join('')}${nums.length ? `<div class="kv" style="color:var(--text)">${esc(nums.join(' · '))}</div>` : ''}</div>${kids.length ? `<div class="stage-children">${kids.map(stageBox).join('')}</div>` : ''}`;
  }
  function collectStages(st, acc) {
    if (!st) return acc;
    acc.push(st);
    if (st.inputStage) collectStages(st.inputStage, acc);
    (st.inputStages || []).forEach(s => collectStages(s, acc));
    return acc;
  }
  MM.renderExplain = function (ex) {
    if (!ex) return '';
    let qp, es, extra = '';
    if (ex.stages) {
      const c = ex.stages[0].$cursor || {};
      qp = c.queryPlanner; es = c.executionStats;
      extra = `<h4>Pipeline after the $cursor stage</h4><div class="pipe">${ex.stages.slice(1).map(s => { const k = Object.keys(s).find(x => x.startsWith('$')); return `<div class="pipe-stage"><div class="h"><code>${esc(k)}</code><span class="muted">${esc(MM.util.fmtInline(s[k], 0)).slice(0, 140)}</span><span class="spacer"></span>${s.nReturned !== undefined ? `<span class="pill">nReturned ${s.nReturned}</span>` : ''}</div></div>`; }).join('') || '<p class="muted">All work was pushed into the query layer.</p>'}</div>`;
    } else { qp = ex.queryPlanner; es = ex.executionStats; }
    if (!qp) return `<pre>${esc(MM.fmt(ex))}</pre>`;
    const root = es ? es.executionStages : qp.winningPlan;
    const stages = collectStages(root, []);
    const names = stages.map(s => s.stage);
    const verdicts = [];
    if (names.includes('COLLSCAN')) verdicts.push(['bad', 'COLLSCAN: the whole collection is read. Create an index whose leading fields match the equality predicates.']);
    if (names.includes('SORT')) verdicts.push(['warn', 'Blocking SORT stage: results are sorted in memory (100 MB limit before spilling). An index that also provides the sort order removes it (Equality, Sort, Range).']);
    if (names.includes('PROJECTION_COVERED')) verdicts.push(['good', 'Covered query: answered from the index alone, no documents fetched.']);
    if (names.includes('OR')) verdicts.push(['good', '$or branches each use an index and results are merged (OR stage).']);
    const ix = stages.find(s => s.stage === 'IXSCAN');
    if (ix && !names.includes('SORT') && !names.includes('COLLSCAN')) verdicts.push(['good', 'Index scan on ' + ix.indexName + ' with no blocking sort.']);
    const fetch = stages.find(s => s.stage === 'FETCH' && s.filter);
    if (fetch && ix) verdicts.push(['warn', 'FETCH applies a residual filter ' + MM.util.fmtInline(fetch.filter, 0) + ' after reading documents; those fields are not bounded by the index.']);
    let metrics = '';
    if (es) {
      const n = es.nReturned, k = es.totalKeysExamined, d = es.totalDocsExamined;
      const ratio = n ? d / n : d;
      if (n && ratio > 10) verdicts.push(['bad', 'Examined ' + ratio.toFixed(1) + ' documents per document returned. Aim for close to 1.']);
      else if (n && ratio <= 1.5 && d) verdicts.push(['good', 'Selective plan: about ' + ratio.toFixed(1) + ' document examined per result.']);
      if (n && k / n > 10 && k > 50) verdicts.push(['warn', 'Examined ' + (k / n).toFixed(1) + ' index keys per result. Check key order: equality fields first, then the sort, then ranges.']);
      const cls = (v, good) => v === 0 && good ? 'good' : '';
      metrics = `<div class="plan-summary">
        <div class="metric"><b>${n}</b><span>nReturned</span></div>
        <div class="metric ${k > 0 ? 'good' : ''}"><b>${k}</b><span>keys examined</span></div>
        <div class="metric ${d > n * 10 ? 'bad' : (d === 0 ? 'good' : '')}"><b>${d}</b><span>docs examined</span></div>
        <div class="metric ${names.includes('SORT') ? 'warn' : 'good'}"><b>${names.includes('SORT') ? 'yes' : 'no'}</b><span>in-memory sort</span></div>
        <div class="metric ${cls(0, false)}"><b>${es.executionTimeMillis} ms</b><span>modelled time</span></div></div>`;
    } else verdicts.push(['warn', 'queryPlanner verbosity shows the chosen plan only. Use explain("executionStats") to see keys and documents examined.']);
    const rej = (qp.rejectedPlans || []).length;
    return `${metrics}
      <ul class="verdicts">${verdicts.map(v => `<li class="${v[0]}">${esc(v[1])}</li>`).join('')}${rej ? `<li>${rej} rejected plan${rej > 1 ? 's' : ''} competed with the winner (see queryPlanner.rejectedPlans).</li>` : ''}</ul>
      <h4>${es ? 'Execution stages' : 'Winning plan'} <small class="faint">(read bottom-up: leaves produce, parents consume)</small></h4>
      <div class="plan-tree">${stageBox(root)}</div>${extra}
      <p class="faint" style="font-size:.78rem;margin-top:10px">Counters come from the in-browser planner model. Plan shapes follow MongoDB's classic engine.</p>`;
  };

  MM.renderPipeline = function (steps) {
    const max = Math.max(1, ...steps.map(s => s.count || 0));
    return `<div class="pipe">${steps.map((s, i) => `${i ? '<div class="pipe-arrow">&#9660;</div>' : ''}<div class="pipe-stage">
      <div class="h"><code>${esc(s.label)}</code>${s.stage ? `<span class="muted" style="font-family:var(--mono);font-size:.78rem">${esc(MM.util.fmtInline(s.stage[s.label], 0)).slice(0, 160)}</span>` : ''}<span class="spacer"></span>${s.error ? '' : `<span class="pill">${s.count} doc${s.count === 1 ? '' : 's'}</span>`}</div>
      ${s.error ? `<div style="color:var(--red);font-size:.85rem">${esc(s.error)}</div>` : `<div class="bar"><i style="width:${(s.count || 0) / max * 100}%"></i></div>`}
      ${s.note ? `<div class="faint" style="font-size:.8rem">${esc(s.note)}</div>` : ''}
      ${s.sample && s.sample.length ? `<details><summary class="faint" style="cursor:pointer;font-size:.8rem">first ${s.sample.length} output document${s.sample.length > 1 ? 's' : ''}</summary><pre>${esc(MM.fmt(s.sample))}</pre></details>` : ''}
    </div>`).join('')}</div>`;
  };

  /* ------------------------------------------------------------------
     SVG diagrams
     ------------------------------------------------------------------ */
  const C = { panel: 'var(--panel)', border: 'var(--border)', text: 'var(--text)', muted: 'var(--muted)', green: '#00ed64', blue: '#38bdf8', orange: '#f59e0b', purple: '#a78bfa', red: '#f87171', pink: '#f472b6' };
  function svg(w, h, body, cap) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" style="font-family:var(--sans)"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--muted)"/></marker></defs>${body}</svg>${cap ? `<div class="cap">${cap}</div>` : ''}`;
  }
  function box(x, y, w, h, label, sub, color, id) {
    return `<g ${id ? `id="${id}" class="box-hl"` : ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" style="fill:${C.panel};stroke:${color || C.border};stroke-width:2"/><text x="${x + w / 2}" y="${y + (sub ? h / 2 - 4 : h / 2 + 5)}" text-anchor="middle" style="fill:${C.text};font-size:13px;font-weight:700">${esc(label)}</text>${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" style="fill:${C.muted};font-size:11px">${esc(sub)}</text>` : ''}</g>`;
  }
  function arrow(x1, y1, x2, y2, label, dashed, id) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<g ${id ? `id="${id}" class="box-hl"` : ''}><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:var(--muted);stroke-width:1.6;${dashed ? 'stroke-dasharray:5 4;' : ''}" marker-end="url(#ah)"/>${label ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" style="fill:${C.muted};font-size:11px">${esc(label)}</text>` : ''}</g>`;
  }
  function text(x, y, t, size, color, anchor) { return `<text x="${x}" y="${y}" text-anchor="${anchor || 'middle'}" style="fill:${color || C.muted};font-size:${size || 12}px">${esc(t)}</text>`; }

  MM.diagrams = {
    'document-model': () => svg(760, 250,
      text(170, 20, 'Relational: 3 tables + joins', 13, C.text) +
      box(20, 35, 140, 70, 'customers', 'id, name, email', C.blue) + box(190, 35, 140, 70, 'orders', 'id, customer_id, total', C.blue) + box(105, 150, 140, 70, 'order_items', 'order_id, product, qty', C.blue) +
      arrow(160, 70, 188, 70) + arrow(260, 105, 210, 148) +
      text(560, 20, 'Document: one order, read in one round trip', 13, C.text) +
      `<rect x="420" y="35" width="320" height="185" rx="10" style="fill:var(--code-bg);stroke:${C.green};stroke-width:2"/>` +
      ['{', '  _id: ObjectId("66f1..."),', '  customer: { id: 42, name: "Diya" },', '  status: "paid",', '  items: [', '    { sku: "P012", qty: 2, price: 19.5 },', '    { sku: "P077", qty: 1, price: 210 }', '  ],', '  total: 249', '}'].map((l, i) => `<text x="436" y="${58 + i * 16}" style="fill:#d6e6ec;font-family:var(--mono);font-size:12px">${esc(l)}</text>`).join(''),
      'Data that is read together is stored together. Joins become embedded sub-documents or arrays.'),

    'replica-set': () => svg(760, 300,
      box(300, 15, 160, 50, 'Application', 'driver: replica set URI', C.purple) +
      box(280, 110, 200, 60, 'PRIMARY', 'accepts writes · oplog', C.green) +
      box(40, 220, 200, 60, 'SECONDARY', 'replicates oplog', C.blue) + box(520, 220, 200, 60, 'SECONDARY', 'replicates oplog', C.blue) +
      arrow(380, 65, 380, 108, 'writes + reads') + arrow(330, 170, 200, 218, 'oplog fetch (pull)', true) + arrow(430, 170, 560, 218, 'oplog fetch (pull)', true) +
      `<line x1="240" y1="250" x2="518" y2="250" style="stroke:${C.orange};stroke-width:1.4;stroke-dasharray:3 4"/>` + text(380, 244, 'heartbeats every 2s · election after 10s without primary', 11, C.orange),
      'Secondaries pull from the primary (or another secondary when chaining is on). A majority of voting members must agree to elect a primary.'),

    'sharded-cluster': () => svg(800, 330,
      box(310, 10, 180, 46, 'Application', 'driver', C.purple) +
      box(180, 90, 170, 50, 'mongos', 'router', C.green) + box(450, 90, 170, 50, 'mongos', 'router', C.green) +
      box(640, 170, 150, 60, 'Config servers', 'CSRS · chunk map', C.orange) +
      box(20, 250, 180, 60, 'shard-a', 'replica set', C.blue) + box(230, 250, 180, 60, 'shard-b', 'replica set', C.blue) + box(440, 250, 180, 60, 'shard-c', 'replica set', C.blue) +
      arrow(370, 56, 280, 88) + arrow(430, 56, 520, 88) + arrow(265, 140, 120, 248) + arrow(265, 140, 320, 248) + arrow(535, 140, 530, 248) + arrow(620, 130, 680, 168, 'routing table', true),
      'mongos routes each operation using the cached routing table. Queries with the shard key are targeted; others scatter to every shard.'),

    'wiredtiger': () => svg(800, 340,
      box(20, 20, 180, 50, 'mongod write', 'insert / update', C.purple) +
      `<rect x="240" y="10" width="330" height="190" rx="12" style="fill:none;stroke:${C.green};stroke-width:2;stroke-dasharray:6 4"/>` + text(405, 30, 'WiredTiger cache (default 50% of RAM - 1 GB)', 12, C.green) +
      box(260, 45, 140, 60, 'B-tree pages', 'uncompressed', C.blue) + box(415, 45, 140, 60, 'update chains', 'MVCC versions', C.blue) +
      box(260, 125, 295, 55, 'eviction threads', 'dirty > 5% / used > 80%: evict pages', C.orange) +
      box(620, 20, 160, 50, 'journal (WAL)', 'flush ~100 ms / j:true', C.pink) +
      box(620, 130, 160, 60, 'checkpoint', 'every 60s: consistent snapshot', C.orange) +
      box(240, 255, 330, 60, 'data files (.wt)', 'compressed: snappy / zstd / zlib', C.border) +
      arrow(200, 45, 258, 70) + arrow(570, 40, 618, 42, 'log record') + arrow(555, 150, 618, 158) + arrow(700, 190, 560, 253, 'write dirty pages') + arrow(405, 180, 405, 253, 'reconcile + write'),
      'Writes update in-memory pages and the journal. Checkpoints persist a consistent snapshot; after a crash the last checkpoint plus the journal recover the data.'),

    'btree': () => svg(760, 260,
      box(300, 15, 160, 46, 'root', '[ "gold" | "silver" ]', C.green) +
      box(40, 105, 200, 46, 'internal', '[ "bronze" | "gold" ]', C.blue) + box(290, 105, 180, 46, 'internal', '[ "platinum" ]', C.blue) + box(520, 105, 200, 46, 'internal', '[ "silver" ]', C.blue) +
      box(20, 195, 160, 46, 'leaf: bronze', 'RecordId 4, 9, 17 ...', C.border) + box(200, 195, 160, 46, 'leaf: gold', 'RecordId 2, 31 ...', C.border) + box(380, 195, 160, 46, 'leaf: platinum', 'RecordId 8, 44 ...', C.border) + box(560, 195, 180, 46, 'leaf: silver', 'RecordId 1, 3, 12 ...', C.border) +
      arrow(340, 61, 160, 103) + arrow(380, 61, 380, 103) + arrow(420, 61, 600, 103) + arrow(140, 151, 100, 193) + arrow(200, 151, 280, 193) + arrow(380, 151, 460, 193) + arrow(620, 151, 650, 193),
      'An index on { tier: 1 }: keys are sorted, leaves point to RecordIds. Equality and range lookups walk root-to-leaf, then scan leaves in order.'),

    'esr': () => svg(780, 200,
      text(390, 22, 'db.orders.find({ status: "delivered", total: { $gt: 500 } }).sort({ createdAt: -1 })', 13, C.text) +
      box(40, 50, 210, 60, 'E: status', 'equality: jump to one key range', C.green) + box(285, 50, 210, 60, 'S: createdAt', 'already ordered: no SORT', C.blue) + box(530, 50, 210, 60, 'R: total', 'filtered while scanning keys', C.orange) +
      arrow(250, 80, 283, 80) + arrow(495, 80, 528, 80) +
      text(390, 145, 'Index { status: 1, createdAt: -1, total: 1 }', 14, C.green) +
      text(390, 170, 'Putting the range before the sort ({ status, total, createdAt }) forces an in-memory SORT.', 12, C.muted),
      'Equality fields first, then the sort, then ranges.'),

    'oplog': () => svg(780, 230,
      `<rect x="30" y="60" width="720" height="60" rx="10" style="fill:var(--panel);stroke:var(--border);stroke-width:2"/>` +
      Array.from({ length: 18 }, (_, i) => `<rect x="${40 + i * 39}" y="72" width="33" height="36" rx="4" style="fill:${i < 3 ? 'var(--panel2)' : (i > 14 ? C.green : C.blue)};opacity:${i < 3 ? .6 : .85}"/>`).join('') +
      text(110, 50, 'oldest entries are truncated', 11, C.muted) + text(660, 50, 'newest: applied on primary', 11, C.green) +
      arrow(390, 150, 390, 122, 'secondary fetches from its last applied optime') +
      text(390, 190, 'oplog window = time between the first and last entry. A secondary offline longer than the window must re-sync from scratch.', 12, C.text),
      'local.oplog.rs is a capped collection of idempotent operations.'),

    'change-stream': () => svg(780, 200,
      box(20, 70, 150, 56, 'writes', 'insert/update/delete', C.purple) + box(220, 70, 150, 56, 'oplog', 'majority-committed', C.blue) +
      box(420, 70, 170, 56, 'change stream', '$match / $project', C.green) + box(630, 70, 140, 56, 'consumer', 'stores resume token', C.orange) +
      arrow(170, 98, 218, 98) + arrow(370, 98, 418, 98) + arrow(590, 98, 628, 98) +
      `<path d="M700,126 C700,180 500,180 500,128" style="fill:none;stroke:${C.orange};stroke-width:1.5;stroke-dasharray:5 4" marker-end="url(#ah)"/>` + text(600, 192, 'restart with resumeAfter / startAfter', 11, C.orange),
      'Change streams only return majority-committed events, so they never show data that could be rolled back.'),

    'rag': () => svg(800, 220,
      box(10, 30, 150, 50, 'documents', 'product text, FAQs', C.purple) + box(200, 30, 150, 50, 'embedding model', 'text -> vector', C.pink) +
      box(390, 30, 170, 50, 'MongoDB', 'doc + embedding field', C.green) + box(600, 30, 180, 50, 'vector index', 'HNSW (approximate)', C.blue) +
      box(10, 140, 150, 50, 'user question', '', C.purple) + box(200, 140, 150, 50, 'embed question', '', C.pink) +
      box(390, 140, 170, 50, '$vectorSearch', '+ metadata filter', C.green) + box(600, 140, 180, 50, 'LLM', 'answer with context', C.orange) +
      arrow(160, 55, 198, 55) + arrow(350, 55, 388, 55) + arrow(560, 55, 598, 55) + arrow(160, 165, 198, 165) + arrow(350, 165, 388, 165) + arrow(560, 165, 598, 165, 'top-k chunks') + arrow(690, 80, 520, 138, '', true),
      'Retrieval-augmented generation: the database stores both the source text and its embedding; the vector index finds the nearest chunks.'),

    'pitr': () => svg(780, 200,
      `<line x1="40" y1="100" x2="740" y2="100" style="stroke:var(--border);stroke-width:4"/>` +
      [80, 330, 580].map((x, i) => `<rect x="${x - 8}" y="82" width="16" height="36" rx="3" style="fill:${C.blue}"/>` + text(x, 140, 'snapshot ' + (i + 1), 11, C.blue)).join('') +
      `<rect x="80" y="94" width="660" height="12" style="fill:${C.green};opacity:.35"/>` + text(410, 72, 'continuous oplog backup', 12, C.green) +
      `<line x1="470" y1="60" x2="470" y2="130" style="stroke:${C.red};stroke-width:2"/>` + text(470, 50, 'bad deploy 14:02:11', 12, C.red) +
      text(410, 180, 'Restore snapshot 2, replay the oplog up to 14:02:10, stop before the bad operation.', 12, C.text),
      'Point-in-time recovery = base snapshot + oplog replay to a timestamp.'),

    'k8s-operator': () => svg(800, 250,
      box(20, 20, 200, 56, 'Custom Resource', 'kind: PerconaServerMongoDB', C.purple) + box(300, 20, 200, 56, 'Operator', 'reconcile loop', C.green) +
      box(580, 20, 200, 56, 'Secrets / TLS', 'users, keyfile, certs', C.orange) +
      box(160, 140, 200, 56, 'StatefulSet', 'rs0-0, rs0-1, rs0-2', C.blue) + box(440, 140, 200, 56, 'PVCs', 'one volume per pod', C.blue) +
      arrow(220, 48, 298, 48, 'desired state') + arrow(500, 48, 578, 48) + arrow(380, 76, 270, 138) + arrow(420, 76, 520, 138) + arrow(360, 168, 438, 168),
      'The operator turns a declarative spec into pods, volumes and replica-set configuration, and keeps reconciling.')
  };

  /* ------------------------------------------------------------------
     Replica set simulator
     ------------------------------------------------------------------ */
  function rsSim(el) {
    let S;
    function fresh(n) {
      S = { term: 1, nextOp: 1, log: [], acks: [], electionIn: 0, nodes: [] };
      for (let i = 0; i < n; i++) S.nodes.push({ id: i, name: 'mongo-' + i, role: i === 0 ? 'PRIMARY' : 'SECONDARY', up: true, part: false, prio: i === 0 ? 2 : 1, ops: [], slow: false, rolled: [] });
      log('Replica set rs0 initiated with ' + n + ' members; mongo-0 is PRIMARY (term 1).');
    }
    function log(m) { S.log.unshift({ t: new Date().toLocaleTimeString(), m }); S.log = S.log.slice(0, 60); }
    const voters = () => S.nodes.filter(n => n.role !== 'REMOVED');
    const majority = () => Math.floor(voters().length / 2) + 1;
    const primary = () => S.nodes.find(n => n.role === 'PRIMARY' && n.up);
    const reach = n => n.up && !n.part;
    function commitPoint() {
      const p = primary();
      if (!p) return S.lastCommit || 0;
      const lens = S.nodes.filter(n => n.up && (n === p || (!n.part && !p.part)) && n.role !== 'ARBITER').map(n => n.ops.length).sort((a, b) => b - a);
      const arbiters = S.nodes.filter(n => n.role === 'ARBITER' && n.up).length;
      const need = majority() - arbiters;
      const cp = lens.length >= Math.max(1, need) ? lens[Math.max(1, need) - 1] : 0;
      const pts = p.ops.slice(0, cp);
      S.lastCommit = pts.length ? pts[pts.length - 1].n : (S.lastCommit || 0);
      return S.lastCommit;
    }
    function write(w) {
      const p = primary();
      if (!p) { log('Write rejected: NotWritablePrimary (no primary). Drivers retry once with retryable writes.'); return draw(); }
      const op = { n: S.nextOp++, w, term: S.term };
      p.ops.push(op);
      if (w === 1) log('Insert #' + op.n + ' (w:1) acknowledged by ' + p.name + ' immediately.');
      else { S.acks.push({ n: op.n, at: Date.now(), status: 'waiting' }); log('Insert #' + op.n + ' (w:"majority") waiting for a majority to replicate it.'); }
      draw();
    }
    function tick() {
      if (!el.isConnected) { clearInterval(timer); return; }
      const p = primary();
      if (p && p.part) {
        const visible = S.nodes.filter(n => n !== p && reach(n)).length;
        if (visible + 1 < majority()) { p.role = 'SECONDARY'; log(p.name + ' cannot see a majority and steps down to SECONDARY.'); S.electionIn = 2; }
      }
      const pr = primary();
      if (pr && !pr.part) {
        S.nodes.forEach(n => {
          if (n === pr || !reach(n) || n.role === 'ARBITER') return;
          let common = 0;
          while (common < n.ops.length && common < pr.ops.length && n.ops[common].n === pr.ops[common].n) common++;
          if (common < n.ops.length) {
            const lost = n.ops.slice(common);
            n.ops = n.ops.slice(0, common);
            n.rolled = n.rolled.concat(lost);
            log('ROLLBACK on ' + n.name + ': ' + lost.length + ' op(s) #' + lost.map(o => o.n).join(', #') + ' were never majority-committed; written to the rollback/ directory.');
            lost.forEach(o => { const a = S.acks.find(x => x.n === o.n); if (a) a.status = 'rolled back'; });
          }
          const step = n.slow ? (Math.random() < .3 ? 1 : 0) : 2;
          for (let i = 0; i < step && n.ops.length < pr.ops.length; i++) n.ops.push(pr.ops[n.ops.length]);
        });
      }
      const cp = commitPoint();
      S.acks.forEach(a => { if (a.status === 'waiting' && a.n <= cp && primary() && primary().ops.some(o => o.n === a.n)) { a.status = 'acknowledged'; log('Insert #' + a.n + ' majority-committed: client receives the acknowledgement.'); } });
      S.acks.forEach(a => { if (a.status === 'waiting' && Date.now() - a.at > 8000) { a.status = 'wtimeout'; log('Insert #' + a.n + ': wtimeout. The write is NOT rolled back automatically; it may still commit or be rolled back later.'); } });
      if (!primary()) {
        if (S.electionIn > 0) S.electionIn--;
        else {
          const visibleUp = S.nodes.filter(reach);
          if (visibleUp.length < majority()) { if (!S.noMaj) log('No majority reachable (' + visibleUp.length + '/' + S.nodes.length + '): no primary can be elected. The set is read-only.'); S.noMaj = true; }
          else {
            S.noMaj = false;
            const cands = visibleUp.filter(n => n.role !== 'ARBITER' && n.prio > 0).sort((a, b) => (b.ops.length - a.ops.length) || (b.prio - a.prio));
            if (cands.length) {
              const w = cands[0];
              S.term++;
              w.role = 'PRIMARY';
              log('Election (term ' + S.term + '): ' + w.name + ' wins with ' + visibleUp.length + ' votes; it has the most recent oplog (op #' + (w.ops.length ? w.ops[w.ops.length - 1].n : 0) + ').');
            }
          }
        }
      }
      draw();
    }
    function act(i, what) {
      const n = S.nodes[i];
      if (what === 'kill') { n.up = false; if (n.role === 'PRIMARY') { n.role = 'SECONDARY'; S.electionIn = 3; log(n.name + ' (PRIMARY) crashed. Secondaries miss heartbeats; election starts after electionTimeoutMillis (10s, sped up here).'); } else log(n.name + ' is down.'); }
      if (what === 'start') { n.up = true; log(n.name + ' restarted and rejoins as SECONDARY; it will roll back anything the new primary does not have.'); }
      if (what === 'part') { n.part = !n.part; log(n.name + (n.part ? ' is network-partitioned from the others.' : ' rejoined the network.')); }
      if (what === 'slow') { n.slow = !n.slow; log(n.name + (n.slow ? ' is now lagging (slow disk / busy).' : ' is caught up to normal speed.')); }
      if (what === 'stepdown' && n.role === 'PRIMARY') { n.role = 'SECONDARY'; S.electionIn = 1; log('rs.stepDown() on ' + n.name + ': it steps down and an election follows.'); }
      if (what === 'prio') { n.prio = n.prio === 0 ? 1 : (n.prio === 1 ? 2 : 0); log(n.name + ' priority set to ' + n.prio + (n.prio === 0 ? ' (can never become primary)' : '')); }
      draw();
    }
    function draw() {
      const cp = commitPoint();
      el.querySelector('.nodes').innerHTML = S.nodes.map((n, i) => {
        const cls = !n.up ? 'down' : (n.role === 'PRIMARY' ? 'primary' : (n.role === 'ARBITER' ? 'arbiter' : 'secondary'));
        return `<div class="node ${cls}"><div class="row"><b>${n.name}</b><span class="spacer"></span><span class="role" style="color:${n.role === 'PRIMARY' ? '#00ed64' : '#38bdf8'}">${n.up ? n.role : 'DOWN'}</span></div>
          <div class="faint" style="font-size:.75rem">priority ${n.prio}${n.part ? ' · partitioned' : ''}${n.slow ? ' · lagging' : ''} · ops ${n.ops.length}</div>
          <div class="oplog">${n.ops.slice(-24).map(o => `<span class="op ${o.n > cp ? 'w1' : ''}" title="op #${o.n}">${o.n}</span>`).join('')}${n.rolled.slice(-6).map(o => `<span class="op rolled" title="rolled back #${o.n}">${o.n}</span>`).join('')}</div>
          <div class="btns">${n.up ? `<button class="code-btn" data-a="kill" data-i="${i}">Kill</button>` : `<button class="code-btn run" data-a="start" data-i="${i}">Restart</button>`}<button class="code-btn" data-a="part" data-i="${i}">${n.part ? 'Heal' : 'Partition'}</button><button class="code-btn" data-a="slow" data-i="${i}">${n.slow ? 'Unlag' : 'Lag'}</button>${n.role === 'PRIMARY' && n.up ? `<button class="code-btn" data-a="stepdown" data-i="${i}">Step down</button>` : ''}<button class="code-btn" data-a="prio" data-i="${i}">Priority</button></div></div>`;
      }).join('');
      el.querySelector('.rs-status').innerHTML = `term <b>${S.term}</b> · majority = <b>${majority()}</b> of ${S.nodes.length} · majority commit point: op <b>#${cp}</b> · ${primary() ? 'primary: <b>' + primary().name + '</b>' : '<b style="color:var(--red)">no primary</b>'}`;
      el.querySelector('.acks').innerHTML = S.acks.slice(-8).reverse().map(a => `<span class="pill" style="color:${a.status === 'acknowledged' ? 'var(--green)' : (a.status === 'waiting' ? 'var(--orange)' : 'var(--red)')}">#${a.n} ${a.status}</span>`).join(' ') || '<span class="faint">no w:"majority" writes yet</span>';
      el.querySelector('.log').innerHTML = S.log.map(l => `<div><span class="t">${l.t}</span> ${esc(l.m)}</div>`).join('');
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(+b.dataset.i, b.dataset.a));
    }
    el.innerHTML = `<div class="sim"><h3>Replica set simulator</h3>
      <p class="muted">Green op chips are majority-committed; orange ones exist on fewer than a majority of members and can be rolled back. Try: write w:1 a few times, kill the primary before they replicate (or lag the secondaries first), then restart the old primary.</p>
      <div class="sim-controls"><button class="btn small primary" data-w="1">Insert (w:1)</button><button class="btn small primary" data-w="m">Insert (w:"majority")</button><button class="btn small" data-w="b">Burst 5 x w:1</button><select class="members"><option value="3">3 members</option><option value="5">5 members</option></select><button class="btn small" data-w="reset">Reset</button></div>
      <div class="rs-status muted"></div><div class="nodes"></div>
      <div style="margin:6px 0"><b style="font-size:.85rem">Client acknowledgements:</b> <span class="acks"></span></div>
      <div class="log"></div></div>`;
    fresh(3);
    el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
      const w = b.dataset.w;
      if (w === '1') write(1); else if (w === 'm') write('majority'); else if (w === 'b') { for (let i = 0; i < 5; i++) write(1); } else { fresh(+el.querySelector('.members').value); draw(); }
    });
    el.querySelector('.members').onchange = e => { fresh(+e.target.value); draw(); };
    draw();
    const timer = setInterval(tick, 900);
  }

  /* ------------------------------------------------------------------
     Shard key simulator
     ------------------------------------------------------------------ */
  function hash32(s) { let h = 0x811c9dc5; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  const KEYS = {
    'id_ranged': { label: '{ _id: 1 } (ObjectId, ranged)', fields: ['_id'], hashed: false },
    'id_hashed': { label: '{ _id: "hashed" }', fields: ['_id'], hashed: true },
    'created': { label: '{ createdAt: 1 }', fields: ['createdAt'], hashed: false },
    'customer': { label: '{ customerId: 1 }', fields: ['customerId'], hashed: false },
    'customer_hashed': { label: '{ customerId: "hashed" }', fields: ['customerId'], hashed: true },
    'region': { label: '{ region: 1 }', fields: ['region'], hashed: false },
    'region_customer': { label: '{ region: 1, customerId: 1 }', fields: ['region', 'customerId'], hashed: false }
  };
  const VERDICT = {
    id_ranged: 'Monotonically increasing ObjectIds: every insert lands in the chunk holding MaxKey, so one shard takes all writes (hot shard) while the balancer keeps moving old chunks away.',
    id_hashed: 'Even write distribution, but every query that is not an exact _id lookup is scatter-gather, and range queries on _id hit all shards.',
    created: 'Same hotspot as ranged ObjectId: time-ordered keys always write to the last chunk. Range queries by time are targeted, which is the only upside.',
    customer: 'Good cardinality and writes spread across chunks. Queries by customerId are targeted. Watch for very large customers (high frequency) creating hot or jumbo chunks.',
    customer_hashed: 'Very even writes and targeted equality lookups by customerId, but range queries on customerId become scatter-gather.',
    region: 'Low cardinality (4 values): at most 4 chunks can ever exist, chunks become jumbo and cannot be split or balanced. One region (EU, 55%) dominates a single shard.',
    region_customer: 'Compound key: region prefix enables zone sharding (data residency) and targeted region queries, customerId adds cardinality so chunks can split. A common production pattern.'
  };
  function shardSim(el) {
    const SH = ['shard-a', 'shard-b', 'shard-c'];
    const SPLIT = 60;
    let st, keyId = 'id_ranged', seq = 0;
    function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    const R = rng(7);
    function makeDoc(i) {
      const r = R();
      return { _id: 1e6 + i, createdAt: i, customerId: Math.floor(Math.pow(R(), 1.3) * 4000) + 1, region: r < .55 ? 'EU' : (r < .85 ? 'US' : (r < .95 ? 'APAC' : 'LATAM')) };
    }
    function keyOf(doc) {
      const K = KEYS[keyId];
      if (K.hashed) return [hash32(doc[K.fields[0]])];
      return K.fields.map(f => doc[f]);
    }
    function cmpKey(a, b) {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        if (a[i] === undefined || a[i] === -Infinity || b[i] === Infinity) return -1;
        if (b[i] === undefined || b[i] === -Infinity || a[i] === Infinity) return 1;
        return a[i] < b[i] ? -1 : 1;
      }
      return 0;
    }
    function reset() {
      const K = KEYS[keyId];
      st = { chunks: [], recent: [], migrations: 0, docs: 0 };
      const MIN = K.fields.map(() => -Infinity), MAX = K.fields.map(() => Infinity);
      if (K.hashed) {
        for (let i = 0; i < 6; i++) st.chunks.push({ min: i === 0 ? MIN : [Math.floor(i * 4294967296 / 6)], max: i === 5 ? MAX : [Math.floor((i + 1) * 4294967296 / 6)], shard: SH[i % 3], keys: [], jumbo: false });
      } else st.chunks.push({ min: MIN, max: MAX, shard: SH[0], keys: [], jumbo: false });
      seq = 0;
    }
    function findChunk(k) { return st.chunks.find(c => cmpKey(k, c.min) >= 0 && cmpKey(k, c.max) < 0); }
    function insert(n) {
      for (let i = 0; i < n; i++) {
        const d = makeDoc(seq++), k = keyOf(d), c = findChunk(k);
        c.keys.push(k);
        st.docs++;
        st.recent.push(c.shard);
        if (st.recent.length > 300) st.recent.shift();
        if (c.keys.length > SPLIT) split(c);
        if (seq % 150 === 0) balance();
      }
      balance();
      draw();
    }
    function split(c) {
      const sorted = c.keys.slice().sort(cmpKey);
      const mid = sorted[Math.floor(sorted.length / 2)];
      if (cmpKey(mid, sorted[0]) === 0 && cmpKey(mid, sorted[sorted.length - 1]) === 0) { c.jumbo = true; return; }
      let at = mid;
      if (cmpKey(at, sorted[0]) === 0) at = sorted.find(x => cmpKey(x, sorted[0]) > 0);
      const left = { min: c.min, max: at, shard: c.shard, keys: c.keys.filter(k => cmpKey(k, at) < 0), jumbo: false };
      const right = { min: at, max: c.max, shard: c.shard, keys: c.keys.filter(k => cmpKey(k, at) >= 0), jumbo: false };
      st.chunks.splice(st.chunks.indexOf(c), 1, left, right);
    }
    function balance() {
      for (let guard = 0; guard < 50; guard++) {
        const per = SH.map(s => st.chunks.filter(c => c.shard === s).reduce((a, c) => a + c.keys.length, 0));
        const hi = per.indexOf(Math.max(...per)), lo = per.indexOf(Math.min(...per));
        if (per[hi] - per[lo] < SPLIT * 1.5) return;
        const movable = st.chunks.filter(c => c.shard === SH[hi] && !c.jumbo && c.keys.length).sort((a, b) => a.keys.length - b.keys.length)[0];
        if (!movable) return;
        movable.shard = SH[lo];
        st.migrations++;
      }
    }
    function targets(q) {
      const K = KEYS[keyId], f0 = K.fields[0];
      const all = new Set(st.chunks.map(c => c.shard));
      if (!(f0 in q)) return { shards: [...all], how: 'scatter-gather (filter has no shard key prefix)' };
      const v = q[f0];
      if (K.hashed) {
        if (typeof v === 'object') return { shards: [...all], how: 'scatter-gather (range on a hashed key)' };
        const c = findChunk([hash32(v)]);
        return { shards: [c.shard], how: 'targeted (equality on hashed key)' };
      }
      let lo, hi;
      if (typeof v === 'object') { lo = [v.$gte]; hi = [v.$lt]; } else { lo = [v]; hi = [v]; }
      const sh = new Set();
      st.chunks.forEach(c => {
        const overlap = cmpKey([c.max[0]], lo) > 0 && cmpKey([c.min[0]], hi) <= 0;
        if (overlap || (typeof v !== 'object' && c.min[0] === v)) sh.add(c.shard);
      });
      return { shards: sh.size ? [...sh] : [findChunk(K.fields.map((f, i) => i === 0 ? v : -Infinity)).shard], how: sh.size > 1 ? 'targeted to ' + sh.size + ' shards' : 'targeted (single shard)' };
    }
    function draw() {
      const per = SH.map(s => st.chunks.filter(c => c.shard === s));
      const counts = per.map(cs => cs.reduce((a, c) => a + c.keys.length, 0));
      const hot = SH.map(s => st.recent.filter(x => x === s).length);
      const maxC = Math.max(1, ...counts);
      const jumbo = st.chunks.filter(c => c.jumbo).length;
      el.querySelector('.shards').innerHTML = SH.map((s, i) => `<div class="shard"><div class="row"><b>${s}</b><span class="spacer"></span><span class="pill">${per[i].length} chunks</span></div>
        <div class="chunks">${per[i].map(c => `<span class="chunk ${c.jumbo ? 'jumbo' : ''}" title="${esc(JSON.stringify(c.min))} .. ${esc(JSON.stringify(c.max))}">${c.keys.length}</span>`).join('')}</div>
        <div class="faint" style="font-size:.78rem">${counts[i]} docs</div><div class="hbar"><i style="width:${counts[i] / maxC * 100}%"></i></div>
        <div class="faint" style="font-size:.78rem;margin-top:6px">share of last ${st.recent.length} inserts: <b style="color:${hot[i] / Math.max(1, st.recent.length) > .6 ? 'var(--red)' : 'var(--text)'}">${st.recent.length ? Math.round(hot[i] / st.recent.length * 100) : 0}%</b></div></div>`).join('');
      el.querySelector('.sk-metrics').innerHTML = `${st.docs} docs · ${st.chunks.length} chunks · ${st.migrations} chunk migrations · ${jumbo ? `<b style="color:var(--pink)">${jumbo} jumbo chunk${jumbo > 1 ? 's' : ''}</b>` : '0 jumbo chunks'}`;
      el.querySelector('.sk-verdict').textContent = VERDICT[keyId];
      const lastId = 1e6 + Math.max(0, seq - 1);
      const qs = [
        ['find({ customerId: 42 })', { customerId: 42 }],
        ['find({ region: "APAC" })', { region: 'APAC' }],
        ['find({ createdAt: { $gte: last 10% } })', { createdAt: { $gte: Math.floor(seq * .9), $lt: seq + 1 } }],
        ['find({ _id: <latest> })', { _id: lastId }],
        ['find({ status: "paid" })', { status: 'paid' }]
      ];
      el.querySelector('.sk-queries').innerHTML = st.docs ? qs.map(([label, q]) => { const t = targets(q); return `<tr><td><code>${esc(label)}</code></td><td>${esc(t.how)}</td><td>${t.shards.join(', ')}</td></tr>`; }).join('') : '<tr><td colspan="3" class="muted">Insert data first.</td></tr>';
    }
    el.innerHTML = `<div class="sim"><h3>Shard key simulator</h3>
      <p class="muted">3 shards, chunk split at ${SPLIT} docs (scaled down), a balancer that moves chunks when shards differ by about 1.5 chunks of data. The workload is an orders stream: time-ordered ids, skewed customers, and a region field where EU is 55% of traffic.</p>
      <div class="sim-controls"><label class="muted">Shard key</label><select class="sk">${Object.keys(KEYS).map(k => `<option value="${k}">${esc(KEYS[k].label)}</option>`).join('')}</select>
        <button class="btn small primary" data-n="300">Insert 300</button><button class="btn small" data-n="1500">Insert 1500</button><button class="btn small" data-n="0">Reset</button></div>
      <div class="sk-metrics muted"></div>
      <div class="shards"></div>
      <div class="callout info"><b>Assessment</b><span class="sk-verdict"></span></div>
      <table><thead><tr><th>Query</th><th>Routing</th><th>Shards hit</th></tr></thead><tbody class="sk-queries"></tbody></table></div>`;
    el.querySelector('.sk').onchange = e => { keyId = e.target.value; reset(); draw(); };
    el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { const n = +b.dataset.n; if (!n) { reset(); draw(); } else insert(n); });
    reset(); draw();
  }

  /* ------------------------------------------------------------------
     Write path stepper
     ------------------------------------------------------------------ */
  function writePath(el) {
    const W = [
      ['client', 'Driver sends insert with writeConcern { w: "majority", j: true }. With retryable writes it carries a txnNumber so a retry after a network error is not applied twice.'],
      ['router', 'mongod parses the command, checks auth, and takes intent locks (IX on db and collection). Storage engine tickets cap concurrent operations.'],
      ['cache', 'WiredTiger applies the change to the in-memory B-tree page as a new version on the update chain (MVCC). Index entries are inserted in the same storage transaction.'],
      ['oplog', 'In the same transaction an idempotent oplog entry is written to local.oplog.rs. Data and oplog commit atomically.'],
      ['journal', 'The commit writes a log record to the journal. j:true waits for the journal to be flushed to disk (group commit, at most ~100 ms).'],
      ['secondary', 'Secondaries pull the oplog entry, apply it in parallel batches, write their own journal, and report their applied and durable optimes.'],
      ['ack', 'When a majority has the entry durable, the majority commit point advances and the primary acknowledges the client.'],
      ['checkpoint', 'Later, a checkpoint (every 60 s) writes a consistent snapshot of dirty pages to the compressed .wt files; eviction may write pages earlier under cache pressure.']
    ];
    const RP = [
      ['client', 'Driver chooses a member from readPreference (primary by default) and sends find with readConcern.'],
      ['router', 'The query planner looks up the plan cache by query shape; on a miss it races candidate plans and caches the winner.'],
      ['cache', 'Index and document pages are read from the WiredTiger cache; a miss reads the compressed page from disk (often the OS page cache) and decompresses it.'],
      ['oplog', 'readConcern "majority" reads from the snapshot at the majority commit point, so the result can never be rolled back.'],
      ['ack', 'Results are returned in batches (101 docs or 16 MB first batch); getMore fetches the rest while the cursor stays open.']
    ];
    let mode = 'write', i = 0;
    const diagram = svg(780, 260,
      box(20, 20, 150, 50, 'Client / driver', 'writeConcern', '#a78bfa', 'wp-client') +
      box(220, 20, 160, 50, 'mongod (primary)', 'parse · locks · plan', '#00ed64', 'wp-router') +
      box(220, 110, 160, 56, 'WiredTiger cache', 'B-tree + MVCC', '#38bdf8', 'wp-cache') +
      box(430, 110, 150, 56, 'local.oplog.rs', 'same txn', '#38bdf8', 'wp-oplog') +
      box(430, 20, 150, 50, 'journal (WAL)', 'group commit', '#f472b6', 'wp-journal') +
      box(620, 110, 150, 56, 'secondaries', 'pull + apply', '#38bdf8', 'wp-secondary') +
      box(20, 110, 150, 56, 'acknowledgement', 'w / j satisfied', '#00ed64', 'wp-ack') +
      box(220, 200, 360, 46, 'checkpoint -> compressed .wt data files', '', '#f59e0b', 'wp-checkpoint') +
      arrow(170, 45, 218, 45) + arrow(300, 70, 300, 108) + arrow(380, 138, 428, 138) + arrow(505, 108, 505, 72) + arrow(580, 138, 618, 138) + arrow(218, 138, 172, 138) + arrow(300, 166, 300, 198));
    el.innerHTML = `<div class="sim"><h3>Follow an operation through mongod</h3>
      <div class="sim-controls"><button class="btn small" data-m="write">Write path</button><button class="btn small" data-m="read">Read path</button><span class="spacer"></span><button class="btn small" data-s="-1">Previous</button><button class="btn small primary" data-s="1">Next step</button></div>
      <div class="steps"><ol class="wp-list"></ol><div><div class="diagram" style="margin:0">${diagram}</div><div class="callout info wp-text" style="margin-top:10px"></div></div></div></div>`;
    function draw() {
      const L = mode === 'write' ? W : RP;
      i = Math.max(0, Math.min(L.length - 1, i));
      el.querySelector('.wp-list').innerHTML = L.map((s, k) => `<li class="${k === i ? 'on' : ''}" data-k="${k}">${esc(s[1].split('.')[0])}</li>`).join('');
      el.querySelector('.wp-text').innerHTML = `<b>Step ${i + 1} of ${L.length}</b>${esc(L[i][1])}`;
      el.querySelectorAll('.box-hl rect').forEach(r => { r.style.strokeWidth = 2; r.style.filter = ''; r.style.opacity = .55; });
      const g = el.querySelector('#wp-' + L[i][0] + ' rect');
      if (g) { g.style.strokeWidth = 4; g.style.opacity = 1; g.style.filter = 'drop-shadow(0 0 6px rgba(0,237,100,.6))'; }
      el.querySelectorAll('[data-k]').forEach(li => li.onclick = () => { i = +li.dataset.k; draw(); });
    }
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { i += +b.dataset.s; draw(); });
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; i = 0; draw(); });
    draw();
  }

  /* ------------------------------------------------------------------
     ESR lab (runs the real engine on an isolated copy)
     ------------------------------------------------------------------ */
  function esrLab(el) {
    const Q = 'db.orders.find({ status: "delivered", total: { $gt: 500 } }).sort({ createdAt: -1 }).limit(20)';
    const OPTS = [
      ['none', 'No index (only _id)', null],
      ['e', '{ status: 1 }', { status: 1 }],
      ['ers', '{ status: 1, total: 1, createdAt: -1 }  (E, R, S)', { status: 1, total: 1, createdAt: -1 }],
      ['esr', '{ status: 1, createdAt: -1, total: 1 }  (E, S, R)', { status: 1, createdAt: -1, total: 1 }],
      ['se', '{ createdAt: -1, status: 1 }  (S, E)', { createdAt: -1, status: 1 }],
      ['r', '{ total: 1 }', { total: 1 }]
    ];
    let eng = null;
    el.innerHTML = `<div class="sim"><h3>ESR lab: same query, different indexes</h3>
      <p class="muted">Runs on a private copy of the shop database so your playground is untouched.</p>
      <pre style="background:var(--code-bg);color:#d6e6ec;padding:10px;border-radius:8px;font-size:.82rem;overflow:auto">${MM.highlight ? MM.highlight(Q) : esc(Q)}</pre>
      <div class="sim-controls">${OPTS.map(o => `<button class="btn small" data-o="${o[0]}">${esc(o[1])}</button>`).join('')}<button class="btn small primary" data-o="all">Compare all</button></div>
      <div class="esr-out"></div></div>`;
    async function runOne(o) {
      if (!eng) eng = new MM.Engine({ persist: false });
      const coll = new MM.Collection(eng, 'shop', 'orders', null);
      coll.dropIndexes();
      if (o[2]) coll.createIndex(o[2]);
      return coll.find({ status: 'delivered', total: { $gt: 500 } }).sort({ createdAt: -1 }).limit(20).explain('executionStats');
    }
    el.querySelectorAll('[data-o]').forEach(b => b.onclick = async () => {
      const out = el.querySelector('.esr-out');
      out.innerHTML = '<p class="muted">running…</p>';
      if (b.dataset.o === 'all') {
        const rows = [];
        for (const o of OPTS) {
          const ex = await runOne(o), es = ex.executionStats;
          const names = JSON.stringify(es.executionStages);
          rows.push(`<tr><td><code>${esc(o[1])}</code></td><td>${es.totalKeysExamined}</td><td>${es.totalDocsExamined}</td><td>${es.nReturned}</td><td>${names.includes('"SORT"') ? '<b style="color:var(--orange)">yes</b>' : 'no'}</td><td>${names.includes('COLLSCAN') ? '<b style="color:var(--red)">COLLSCAN</b>' : esc(ex.queryPlanner.winningPlan.inputStage ? 'IXSCAN' : '')}</td></tr>`);
        }
        out.innerHTML = `<table><thead><tr><th>Index</th><th>keys examined</th><th>docs examined</th><th>returned</th><th>in-memory sort</th><th>scan</th></tr></thead><tbody>${rows.join('')}</tbody></table><p class="muted">The E-S-R index returns 20 documents while reading roughly that many keys and documents, with no SORT stage. E-R-S must read every matching key and then sort.</p>`;
      } else {
        const ex = await runOne(OPTS.find(o => o[0] === b.dataset.o));
        out.innerHTML = MM.renderExplain(ex);
      }
    });
  }

  /* ------------------------------------------------------------------
     Calculators
     ------------------------------------------------------------------ */
  function sizing(el) {
    el.innerHTML = `<div class="sim"><h3>Working set and cache sizing</h3>
      <div class="grid g3">
        <label>Documents (millions)<br><input type="number" data-k="docs" value="200" min="0" step="10"></label>
        <label>Average document size (bytes)<br><input type="number" data-k="size" value="1200" min="10"></label>
        <label>Hot data (% read regularly)<br><input type="number" data-k="hot" value="20" min="1" max="100"></label>
        <label>Secondary indexes<br><input type="number" data-k="idx" value="5" min="0"></label>
        <label>Average index entry (bytes)<br><input type="number" data-k="ie" value="40" min="8"></label>
        <label>RAM per node (GB)<br><input type="number" data-k="ram" value="64" min="2"></label>
      </div><div class="sz-out" style="margin-top:12px"></div></div>`;
    el.querySelectorAll('input').forEach(i => { i.style.width = '100%'; i.className = ''; i.style.cssText = 'width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:6px 8px'; i.oninput = calc; });
    function calc() {
      const v = {};
      el.querySelectorAll('input').forEach(i => v[i.dataset.k] = +i.value || 0);
      const GB = 1024 ** 3;
      const data = v.docs * 1e6 * v.size / GB;
      const disk = data / 2.5;
      const index = v.docs * 1e6 * (v.idx + 1) * v.ie / GB;
      const cache = Math.max(0.25, 0.5 * (v.ram - 1));
      const ws = data * v.hot / 100 + index;
      const fits = ws <= cache * 0.8;
      el.querySelector('.sz-out').innerHTML = `<div class="kpi-row">
        <div class="metric"><b>${data.toFixed(1)} GB</b><span>logical data</span></div>
        <div class="metric"><b>${disk.toFixed(1)} GB</b><span>on disk (snappy ~2.5x)</span></div>
        <div class="metric"><b>${index.toFixed(1)} GB</b><span>indexes (prefix-compressed est.)</span></div>
        <div class="metric"><b>${cache.toFixed(1)} GB</b><span>WiredTiger cache</span></div>
        <div class="metric ${fits ? 'good' : 'bad'}"><b>${ws.toFixed(1)} GB</b><span>working set</span></div></div>
        <div class="callout ${fits ? 'tip' : 'warn'}"><b>${fits ? 'Working set fits in cache' : 'Working set exceeds ~80% of the cache'}</b>${fits ? 'Indexes plus hot documents fit, so reads should mostly be served from memory. Re-check as data grows.' : 'Expect cache eviction pressure, application threads doing eviction, and read latency driven by disk. Options: more RAM, fewer or smaller indexes, archive cold data, or shard to spread the working set.'} The WiredTiger cache holds uncompressed pages; the rest of RAM serves the OS page cache of compressed files, connections and aggregation memory.</div>`;
    }
    calc();
  }
  function oplogCalc(el) {
    el.innerHTML = `<div class="sim"><h3>Oplog window calculator</h3>
      <div class="grid g3">
        <label>Oplog size (GB)<br><input type="number" data-k="size" value="50"></label>
        <label>Oplog generated per hour at peak (GB)<br><input type="number" data-k="rate" value="2.5" step="0.1"></label>
        <label>Longest outage or maintenance you must survive (hours)<br><input type="number" data-k="need" value="24"></label>
      </div><div class="op-out" style="margin-top:12px"></div></div>`;
    el.querySelectorAll('input').forEach(i => { i.style.cssText = 'width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:6px 8px'; i.oninput = calc; });
    function calc() {
      const v = {};
      el.querySelectorAll('input').forEach(i => v[i.dataset.k] = +i.value || 0);
      const win = v.rate > 0 ? v.size / v.rate : Infinity;
      const ok = win >= v.need * 1.5;
      const rec = Math.ceil(v.rate * v.need * 1.5);
      el.querySelector('.op-out').innerHTML = `<div class="kpi-row"><div class="metric ${ok ? 'good' : 'bad'}"><b>${isFinite(win) ? win.toFixed(1) + ' h' : 'unbounded'}</b><span>window at peak rate</span></div><div class="metric"><b>${rec} GB</b><span>size for 1.5x your target</span></div></div>
        <div class="callout ${ok ? 'tip' : 'warn'}"><b>${ok ? 'Comfortable margin' : 'Window is too short'}</b>A secondary (or a backup tool tailing the oplog) that falls behind by more than the window becomes stale and needs a full initial sync. Resize online with <code>db.adminCommand({ replSetResizeOplog: 1, size: ${rec * 1024} })</code> (MB) on each member, or set <code>minRetentionHours</code> so the oplog keeps at least that many hours regardless of size.</div>`;
    }
    calc();
  }

  MM.widgets = { 'rs-sim': rsSim, 'shard-sim': shardSim, 'write-path': writePath, 'esr-lab': esrLab, 'sizing': sizing, 'oplog-calc': oplogCalc };
})();
