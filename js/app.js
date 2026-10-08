/* =====================================================================
   app.js — router, pages, playground, exercises, search, progress.
   ===================================================================== */
(function () {
  'use strict';
  const MM = window.MM, U = MM.util;
  const app = document.getElementById('app');

  /* ---------------- storage ---------------- */
  function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage disabled */ } }
  const P = Object.assign({ lessons: {}, quiz: {}, exercises: {}, known: {}, path: 'all', srs: {}, scenarios: {}, mock: [], exams: {} }, load('mm-progress-v1', {}));
  function saveP() { store('mm-progress-v1', P); }

  /* ---------------- engine ---------------- */
  MM.engine = new MM.Engine({ persist: true });
  MM.shell = new MM.Shell(MM.engine);

  /* ---------------- lesson ordering ---------------- */
  MM.LESSONS.forEach((l, i) => { l._i = i; });
  MM.LESSONS.sort((a, b) => (MM.MODULE_BY_ID[a.module].num - MM.MODULE_BY_ID[b.module].num) || (a._i - b._i));
  const LESSON_BY_ID = {};
  MM.LESSONS.forEach(l => { LESSON_BY_ID[l.id] = l; l.level = l.level || MM.MODULE_BY_ID[l.module].level; });
  function lessonsOfModule(mid) { return MM.LESSONS.filter(l => l.module === mid); }
  function lessonsOfLevel(lv) { return MM.LESSONS.filter(l => l.level === lv); }

  /* ---------------- helpers ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  MM.esc = esc;
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  MM.toast = toast;
  function lvlPill(lv) { const L = MM.LEVELS[lv - 1]; return `<span class="pill lvl" style="background:${L.color}">${esc(L.name)}</span>`; }
  function verPill(v, note) { return `<a class="ver-pill" href="#/versions" title="${esc(note ? 'MongoDB ' + v + ' or later; ' + note : 'Needs MongoDB ' + v + ' or later')}">MongoDB ${esc(v)}+</a>`; }

  const HL = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\$\$?[A-Za-z_]\w*)|\b(const|let|var|function|return|if|else|for|while|of|in|new|true|false|null|undefined|await|async|try|catch|throw|typeof|break|continue)\b|\b(\d+(?:\.\d+)?)\b|\b(db|rs|sh|use|show|print|printjson|ObjectId|ISODate|NumberDecimal|NumberInt|NumberLong|UUID|it)\b|(\.[A-Za-z_]\w*(?=\())/g;
  function highlight(code) {
    let out = '', last = 0, m;
    HL.lastIndex = 0;
    while ((m = HL.exec(code))) {
      out += esc(code.slice(last, m.index));
      const t = m[0];
      const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'o' : m[4] ? 'k' : m[5] ? 'n' : m[6] ? 'b' : 'f';
      out += cls === 'f' ? '.<span class="tk-f">' + esc(t.slice(1)) + '</span>' : '<span class="tk-' + cls + '">' + esc(t) + '</span>';
      last = HL.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  MM.highlight = highlight;

  /* ---------------- code blocks ---------------- */
  const CODE = [];
  function codeBlock(code, opts) {
    opts = opts || {};
    const id = CODE.push(code.replace(/^\n+|\s+$/g, '')) - 1;
    const runnable = opts.runnable !== false;
    return `<div class="code" data-cid="${id}">
      <div class="code-head"><span class="title">${esc(opts.title || (runnable ? 'mongosh' : 'reference'))}</span>
        ${runnable ? `<button class="code-btn run" data-act="run">Run</button><button class="code-btn" data-act="open">Playground</button>` : ''}
        <button class="code-btn" data-act="copy">Copy</button></div>
      <pre>${highlight(CODE[id])}</pre>
      ${opts.note ? `<div class="note">${opts.note}</div>` : ''}
      <div class="out hidden"></div></div>`;
  }
  MM.codeBlock = codeBlock;

  function renderConsole(outputs, ms) {
    return `<div class="console">${outputs.map(o => `<div class="o ${o.type}">${esc(o.text)}</div>`).join('') || '<div class="o info">(no output)</div>'}${ms !== undefined ? `<div class="meta">ran in ${ms.toFixed(0)} ms (browser time)</div>` : ''}</div>`;
  }
  MM.renderConsole = renderConsole;

  async function runInline(block) {
    const code = CODE[+block.dataset.cid];
    const out = block.querySelector('.out');
    out.classList.remove('hidden');
    out.innerHTML = '<div class="console"><div class="o info">running…</div></div>';
    /* Lesson examples are written against shop; an earlier example that failed after "use lab" must not leak into this one. */
    MM.engine.currentDb = 'shop';
    const r = await MM.shell.run(code);
    let extra = '';
    if (r.explain) extra += `<div style="padding:12px;background:var(--panel)">${MM.renderExplain(r.explain)}</div>`;
    else if (r.pipeline && r.pipeline.pipeline.length > 1) extra += `<div style="padding:8px 12px;background:var(--panel)"><button class="btn small" data-act="stepper">Show stage-by-stage results</button><div class="stepper"></div></div>`;
    out.innerHTML = renderConsole(r.outputs, r.ms) + extra;
    out._pipeline = r.pipeline;
  }

  document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const block = btn.closest('.code');
    const act = btn.dataset.act;
    if (act === 'run' && block) { ev.preventDefault(); runInline(block); }
    else if (act === 'copy' && block) {
      try { await navigator.clipboard.writeText(CODE[+block.dataset.cid]); toast('Copied'); } catch (e) { toast('Copy failed'); }
    } else if (act === 'open' && block) {
      sessionStorage.setItem('mm-pg-inject', CODE[+block.dataset.cid]);
      location.hash = '#/playground';
    } else if (act === 'stepper' && block) {
      const out = block.querySelector('.out'), p = out._pipeline;
      if (p) out.querySelector('.stepper').innerHTML = MM.renderPipeline(MM.engine.stepPipeline(p.db, p.coll, p.pipeline));
      btn.remove();
    }
  });

  /* Turn <pre class="run"> / <pre class="static"> and data-* placeholders into live components. */
  function hydrate(root) {
    root.querySelectorAll('pre.run, pre.static').forEach(pre => {
      const wrap = document.createElement('div');
      wrap.innerHTML = codeBlock(pre.textContent, { runnable: pre.classList.contains('run'), title: pre.dataset.title, note: pre.dataset.note });
      pre.replaceWith(wrap.firstElementChild);
    });
    root.querySelectorAll('[data-diagram]').forEach(el => {
      const fn = MM.diagrams && MM.diagrams[el.dataset.diagram];
      el.classList.add('diagram');
      el.innerHTML = fn ? fn() : '<p class="muted">diagram missing: ' + esc(el.dataset.diagram) + '</p>';
    });
    root.querySelectorAll('[data-widget]').forEach(el => {
      const fn = MM.widgets && MM.widgets[el.dataset.widget];
      if (fn) fn(el); else el.innerHTML = '<p class="muted">widget missing: ' + esc(el.dataset.widget) + '</p>';
    });
  }
  MM.hydrate = hydrate;

  /* ---------------- pages ---------------- */
  const NAV_GROUP = { architecture: 'guides', performance: 'guides', internals: 'guides', versions: 'guides', labs: 'guides', cheatsheet: 'guides' };
  function setNav(r) {
    r = NAV_GROUP[r] || r;
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === r));
    document.getElementById('nav').classList.remove('open');
  }
  function mount(html, navKey) { app.innerHTML = html; setNav(navKey); hydrate(app); if (MM.study) MM.study.updateBadge(); }

  function home() {
    const nQ = MM.INTERVIEW.categories ? MM.INTERVIEW.categories.reduce((a, c) => a + c.items.length, 0) : 0;
    const done = Object.keys(P.lessons).length;
    mount(`<div class="wrap">
      <section class="hero">
        <div>
          <span class="pill">Interactive course · runs in your browser</span>
          <h1>Learn <span>MongoDB</span> from your first query to sharded clusters.</h1>
          <p class="lead">A complete path for developers, DBAs and architects: CRUD, aggregation, indexing and <code>explain()</code>, schema design, transactions, replica sets, sharding, WiredTiger internals, performance tuning and interview preparation. Every example runs against a seeded <code>shop</code> database right here.</p>
          <div class="row" style="margin-top:18px">
            <a class="btn primary" href="#/learn/${MM.LESSONS[0].id}">${done ? 'Continue learning' : 'Start lesson 1'}</a>
            <a class="btn" href="#/playground">Open the shell</a>
            <a class="btn" href="#/interview">Interview prep</a>
          </div>
        </div>
        <div class="hero-term"><div class="bar"><i></i><i></i><i></i></div>
<pre>${highlight(`shop> db.orders.find({ status: "paid" })
...      .sort({ createdAt: -1 }).limit(10)
...      .explain("executionStats")`)}
<span class="tk-c">// before: COLLSCAN · docsExamined 5000 · nReturned 10</span>
${highlight(`shop> db.orders.createIndex({ status: 1, createdAt: -1 })`)}
<span class="tk-c">// after:  IXSCAN { status: 1, createdAt: -1 }
//         keysExamined 10 · docsExamined 10 · no SORT</span></pre></div>
      </section>
      <div class="stats">
        <div class="stat"><b>${MM.LESSONS.length}</b><span>lessons in ${MM.MODULES.length} modules</span></div>
        <div class="stat"><b>${MM.PROBLEMS.length}</b><span>auto-checked exercises</span></div>
        <div class="stat"><b>${nQ}</b><span>interview questions</span></div>
        <div class="stat"><b>10.6k</b><span>documents in the sample <code>shop</code> db</span></div>
      </div>
      <h2>Seven levels</h2>
      <div class="level-strip">${MM.LEVELS.map(L => {
        const ls = lessonsOfLevel(L.id), d = ls.filter(l => P.lessons[l.id]).length;
        return `<a class="level-tile" style="--c:${L.color}" href="#/learn?level=${L.id}"><b>${L.id}. ${esc(L.name)}</b><small>${esc(L.blurb)}</small><div class="progressbar" style="margin-top:8px"><i style="width:${ls.length ? d / ls.length * 100 : 0}%;background:${L.color}"></i></div></a>`;
      }).join('')}</div>
      <h2>Pick a path</h2>
      <div class="grid g3">${MM.PATHS.map(p => `<a class="card link" href="#/learn?path=${p.id}"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.desc)}</p><small class="faint">${p.modules.length} modules</small></a>`).join('')}
        <a class="card link" href="#/interview"><h3>Interview Ready</h3><p class="muted">Developer, DBA, architect and scenario questions with model answers.</p><small class="faint">${nQ} questions</small></a></div>
      <h2>Practice like it is production</h2>
      <div class="grid g3">
        <a class="card link" href="#/scenarios"><h3>Incident scenarios</h3><p class="muted">Debug slow queries, failed unique index builds, TTL that never fires and a deleteMany that needs point-in-time recovery.</p><small class="faint">${(MM.SCENARIOS || []).length} scenarios</small></a>
        <a class="card link" href="#/certification"><h3>Certification track</h3><p class="muted">Lessons mapped to the Associate Developer and DBA exam objectives, with timed practice exams.</p><small class="faint">${MM.EXAMS.length} exams</small></a>
        <a class="card link" href="#/mock"><h3>Mock interviews</h3><p class="muted">Timed questions, model answers and self-grading that feeds a spaced-repetition review deck.</p><small class="faint">${nQ} questions</small></a>
      </div>
      <h2>What makes it different</h2>
      <div class="grid g2">
        <div class="card"><h3>A real query engine, not screenshots</h3><p class="muted">Queries, updates, aggregation pipelines, unique indexes, schema validation, transactions and change streams run in an in-browser engine. Your changes persist locally until you reset.</p></div>
        <div class="card"><h3>See what the planner does</h3><p class="muted"><code>explain()</code> output is drawn as a stage tree with keys/docs examined, blocking sorts and covered queries highlighted. Pipelines can be stepped stage by stage.</p></div>
        <div class="card"><h3>Distributed systems you can break</h3><p class="muted">Kill a primary and watch the election, see w:1 writes roll back, pick a bad shard key and watch a hotspot form, then fix it.</p></div>
        <div class="card"><h3>Production depth</h3><p class="muted">WiredTiger cache and checkpoints, oplog windows, backup and PITR, security, FTDC and monitoring, upgrades, sizing, Kubernetes operators and incident playbooks.</p></div>
      </div>
    </div>`, '');
  }

  function learn() {
    const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
    const path = qs.get('path') || P.path || 'all';
    const levelFocus = qs.get('level');
    const pathObj = MM.PATHS.find(p => p.id === path);
    const allowed = pathObj ? new Set(pathObj.modules) : null;
    const total = MM.LESSONS.length, done = MM.LESSONS.filter(l => P.lessons[l.id]).length;
    let html = `<div class="wrap"><h1>Curriculum</h1>
      <p class="muted">${total} lessons across ${MM.MODULES.length} modules and 7 levels. ${done} completed.</p>
      <div class="progressbar" style="max-width:420px"><i style="width:${done / total * 100}%"></i></div>
      <div class="path-tabs"><button data-path="all" class="${path === 'all' ? 'on' : ''}">All modules</button>${MM.PATHS.map(p => `<button data-path="${p.id}" class="${path === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>`;
    MM.LEVELS.forEach(L => {
      const mods = MM.MODULES.filter(m => m.level === L.id && (!allowed || allowed.has(m.id)));
      if (!mods.length) return;
      html += `<div class="level-block" id="level-${L.id}"><div class="level-head"><div class="level-num" style="background:${L.color}">${L.id}</div><div><h2>${esc(L.name)}</h2><div class="muted">${esc(L.blurb)}</div></div></div><div class="grid g3">`;
      mods.forEach(m => {
        const ls = lessonsOfModule(m.id);
        html += `<div class="module-card"><h4>${m.num}. ${esc(m.title)}</h4><p>${esc(m.desc)}</p>${ls.map(l => `<a class="lesson-link" href="#/learn/${l.id}"><span class="check ${P.lessons[l.id] ? 'done' : ''}">${P.lessons[l.id] ? '&#10003;' : ''}</span>${esc(l.title)}<span class="spacer"></span><small class="faint">${l.minutes || 15}m</small></a>`).join('') || '<div class="faint" style="font-size:.85rem">Covered in the deep-dive pages</div>'}</div>`;
      });
      html += '</div></div>';
    });
    html += '</div>';
    mount(html, 'learn');
    app.querySelectorAll('[data-path]').forEach(b => b.onclick = () => { P.path = b.dataset.path; saveP(); location.hash = '#/learn?path=' + b.dataset.path; });
    if (levelFocus) { const el = document.getElementById('level-' + levelFocus); if (el) el.scrollIntoView(); }
  }

  function lesson(id) {
    const L = LESSON_BY_ID[id];
    if (!L) return notFound();
    const mod = MM.MODULE_BY_ID[L.module], idx = MM.LESSONS.indexOf(L);
    const prev = MM.LESSONS[idx - 1], next = MM.LESSONS[idx + 1];
    let side = '';
    MM.LEVELS.forEach(Lv => {
      const ls = lessonsOfLevel(Lv.id);
      if (!ls.length) return;
      side += `<h5>${Lv.id}. ${esc(Lv.name)}</h5>` + ls.map(l => `<a href="#/learn/${l.id}" class="${l.id === id ? 'cur' : ''}"><span class="check ${P.lessons[l.id] ? 'done' : ''}">${P.lessons[l.id] ? '&#10003;' : ''}</span>${esc(l.title)}</a>`).join('');
    });
    const S = L.sections || {};
    const sec = (key, tag, title) => S[key] ? `<section class="sec"><h2><span class="tag ${tag}">${tag === 'use' ? 'Use case' : tag}</span>${esc(title)}</h2>${S[key]}</section>` : '';
    const deep = (L.deepDive || []).concat((MM.DEEP_DIVES[L.module] || []).map(d => ({ label: d[0], href: d[1] })));
    const seen = {};
    const deepUniq = deep.filter(d => !seen[d.href] && (seen[d.href] = 1));
    let html = `<div class="lesson-layout"><aside class="side-nav">${side}</aside><article class="lesson">
      <div class="crumbs"><a href="#/learn">Curriculum</a> / Module ${mod.num}: ${esc(mod.title)}</div>
      <h1>${esc(L.title)}</h1>
      <div class="meta">${lvlPill(L.level)}<span class="pill">${L.minutes || 15} min</span>${L.since ? verPill(L.since, L.sinceNote) : ''}${(L.exam || []).length ? `<a class="pill" href="#/certification" title="${esc(L.exam.map(o => MM.EXAM_OBJECTIVE_BY_ID[o] ? MM.EXAM_OBJECTIVE_BY_ID[o].title : o).join('; '))}">exam objective</a>` : ''}${P.lessons[id] ? '<span class="pill" style="color:var(--green)">completed</span>' : ''}</div>
      <p class="summary">${L.summary || ''}</p>
      ${L.objectives ? `<div class="objectives"><b>You will learn to</b><ul>${L.objectives.map(o => `<li>${o}</li>`).join('')}</ul></div>` : ''}
      ${sec('concept', 'concept', 'The concept')}
      ${sec('why', 'why', 'Why it matters')}
      ${sec('useCase', 'use', 'Real-world scenario')}
      ${L.examples && L.examples.length ? `<section class="sec"><h2><span class="tag examples">Try it</span>Examples</h2><p class="muted">Each block runs against the shared playground database. Press <b>Run</b>, then edit it in the Playground.</p>${L.examples.map(e => `${e.text ? `<p>${e.text}</p>` : ''}${codeBlock(e.code, { title: e.title, note: e.note, runnable: e.runnable !== false })}`).join('')}</section>` : ''}
      ${sec('internals', 'internals', 'Under the hood')}
      ${L.mistakes && L.mistakes.length ? `<section class="sec"><h2><span class="tag mistakes">Pitfalls</span>Common mistakes</h2><ul>${L.mistakes.map(m => `<li>${m}</li>`).join('')}</ul></section>` : ''}
      ${L.interview && L.interview.length ? `<section class="sec"><h2><span class="tag why">Interview</span>Questions you should be able to answer</h2>${L.interview.map(q => `<details class="qa"><summary>${esc(q.q)}</summary><div class="ans">${q.a}</div></details>`).join('')}</section>` : ''}
      ${L.quiz && L.quiz.length ? `<section class="sec"><h2><span class="tag concept">Quiz</span>Check your understanding</h2>${L.quiz.map((q, qi) => `<div class="quiz-q" data-qi="${qi}"><b>${qi + 1}. ${q.q}</b><div class="opts">${q.options.map((o, oi) => `<label><input type="radio" name="q${qi}" value="${oi}"> <span>${o}</span></label>`).join('')}</div><div class="explain hidden"></div></div>`).join('')}</section>` : ''}
      ${deepUniq.length ? `<section class="sec"><h2><span class="tag internals">Go deeper</span>Related deep-dive pages</h2><ul>${deepUniq.map(d => `<li><a href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.label)}</a></li>`).join('')}</ul></section>` : ''}
      <div class="complete-bar"><span class="check ${P.lessons[id] ? 'done' : ''}">${P.lessons[id] ? '&#10003;' : ''}</span><span>${P.lessons[id] ? 'You completed this lesson.' : 'Finished reading and running the examples?'}</span><span class="spacer"></span><button class="btn ${P.lessons[id] ? '' : 'primary'}" id="markDone">${P.lessons[id] ? 'Mark as not done' : 'Mark complete'}</button></div>
      <div class="lesson-nav">${prev ? `<a class="btn" href="#/learn/${prev.id}">&larr; ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn primary" href="#/learn/${next.id}">${esc(next.title)} &rarr;</a>` : '<a class="btn primary" href="#/interview">Interview prep &rarr;</a>'}</div>
    </article></div>`;
    mount(html, 'learn');
    document.getElementById('markDone').onclick = () => {
      if (P.lessons[id]) delete P.lessons[id]; else P.lessons[id] = Date.now();
      saveP(); lesson(id);
      if (P.lessons[id]) toast('Lesson completed');
    };
    app.querySelectorAll('.quiz-q').forEach(box => {
      const qi = +box.dataset.qi, q = L.quiz[qi];
      box.querySelectorAll('input').forEach(inp => inp.onchange = () => {
        const pick = +inp.value, ok = pick === q.answer;
        box.querySelectorAll('label').forEach((lab, li) => { lab.classList.remove('right', 'wrong'); if (li === q.answer) lab.classList.add('right'); else if (li === pick) lab.classList.add('wrong'); });
        const ex = box.querySelector('.explain');
        ex.classList.remove('hidden');
        ex.innerHTML = (ok ? '<b style="color:var(--green)">Correct.</b> ' : '<b style="color:var(--red)">Not quite.</b> ') + (q.explain || '');
        P.quiz[id] = P.quiz[id] || {};
        P.quiz[id][qi] = ok;
        saveP();
        if (MM.onQuizAnswer) MM.onQuizAnswer(id, qi, ok);
      });
    });
  }

  /* ---------------- playground ---------------- */
  const DEFAULT_PG = `// Welcome to the MongoDB Mastery shell. Ctrl+Enter runs, Ctrl+Shift+Enter explains.
// Every top-level expression prints its result, like typing it into mongosh.
use shop
show collections
db.orders.find({ status: "paid" }, { orderNo: 1, total: 1, createdAt: 1 })
  .sort({ total: -1 })
  .limit(5)
`;
  let pgState = { tab: 'output', last: null };
  function playground() {
    const inject = sessionStorage.getItem('mm-pg-inject');
    if (inject) sessionStorage.removeItem('mm-pg-inject');
    const code = inject || load('mm-pg-code', DEFAULT_PG);
    const snippets = (MM.PAGES.snippets || []);
    mount(`<div class="pg">
      <aside class="pg-side">
        <h5>Databases<span class="spacer"></span><button class="code-btn" id="pgRefresh" title="Refresh">&#8635;</button></h5>
        <div id="pgTree"></div>
        <h5>Snippets</h5>
        ${snippets.map((s, i) => `<button class="snip" data-snip="${i}">${esc(s.title)}</button>`).join('')}
        <h5>Database</h5>
        <button class="btn small danger" id="pgReset">Reset to seed data</button>
        <p class="faint" style="font-size:.78rem;margin-top:8px">Changes are saved in this browser. Reset restores the original shop database.</p>
      </aside>
      <section class="pg-main">
        <div class="pg-toolbar">
          <button class="btn primary small" id="pgRun">Run <kbd>Ctrl Enter</kbd></button>
          <button class="btn small" id="pgExplain" title="Appends .explain('executionStats') to the last statement">Explain last statement</button>
          <button class="btn small" id="pgClear">Clear output</button>
          <span class="spacer"></span>
          <span class="kbd-hint">Select text to run only the selection</span>
          <button class="btn small" id="pgHelp">Shell help</button>
        </div>
        <div class="editor-wrap"><div class="gutter" id="pgGutter"></div><textarea class="editor" id="pgEditor" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div>
        <div class="pg-tabs">
          <button data-tab="output" class="on">Output</button>
          <button data-tab="explain">Explain plan</button>
          <button data-tab="pipeline">Pipeline stages</button>
          <button data-tab="history">History</button>
          <span class="status" id="pgStatus">db: ${esc(MM.engine.currentDb)}</span>
        </div>
        <div class="pg-out" id="pgOut"><div class="console"><div class="o info">Run something. Try: db.orders.countDocuments({ status: "delivered" })</div></div></div>
      </section></div>`, 'playground');
    const ed = document.getElementById('pgEditor'), gut = document.getElementById('pgGutter'), out = document.getElementById('pgOut');
    ed.value = code;
    const syncGutter = () => {
      const n = ed.value.split('\n').length;
      gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
      gut.scrollTop = ed.scrollTop;
    };
    syncGutter();
    ed.addEventListener('input', () => { syncGutter(); store('mm-pg-code', ed.value); });
    ed.addEventListener('scroll', () => { gut.scrollTop = ed.scrollTop; });
    ed.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.shiftKey ? explainLast() : run(); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const s = ed.selectionStart, en = ed.selectionEnd;
        ed.value = ed.value.slice(0, s) + '  ' + ed.value.slice(en);
        ed.selectionStart = ed.selectionEnd = s + 2;
        syncGutter();
      }
    });
    function selectedOrAll() { const s = ed.selectionStart, e2 = ed.selectionEnd; return s !== e2 ? ed.value.slice(s, e2) : ed.value; }
    async function run(src) {
      const c = src || selectedOrAll();
      out.innerHTML = '<div class="console"><div class="o info">running…</div></div>';
      const r = await MM.shell.run(c);
      pgState.last = r;
      const hist = load('mm-pg-history', []);
      hist.unshift({ code: c, at: Date.now(), ok: !r.error });
      store('mm-pg-history', hist.slice(0, 60));
      document.getElementById('pgStatus').textContent = 'db: ' + MM.engine.currentDb + ' · ' + r.ms.toFixed(0) + ' ms';
      renderTree();
      const lastIsExplain = r.value && (r.value.explainVersion || (r.value._isCursor && r.value._explainMode));
      showTab(r.explain && lastIsExplain ? 'explain' : 'output');
    }
    function explainLast() {
      const src = selectedOrAll().replace(/[\s;]+$/, '');
      let ast;
      try { ast = window.acorn.parse(src.replace(/^\s*(use|show)\s+.*$/gm, m => ' '.repeat(m.length)).replace(/^\s*it\s*$/gm, '  '), { ecmaVersion: 'latest', allowAwaitOutsideFunction: true }); }
      catch (e) { return run(src); }
      const lastSt = ast.body.filter(s => s.type === 'ExpressionStatement').pop();
      if (!lastSt || !/\.(find|aggregate)\s*\(/.test(src.slice(lastSt.start, lastSt.end))) { toast('The last statement should be a find() or aggregate()'); return; }
      const expr = src.slice(lastSt.expression.start, lastSt.expression.end);
      if (/\.explain\s*\(/.test(expr)) return run(src);
      run(src.slice(0, lastSt.expression.start) + expr + '.explain("executionStats")' + src.slice(lastSt.expression.end));
    }
    function showTab(tab) {
      pgState.tab = tab;
      app.querySelectorAll('.pg-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
      const r = pgState.last;
      if (tab === 'output') out.innerHTML = r ? renderConsole(r.outputs, r.ms) : '<div class="console"><div class="o info">No output yet.</div></div>';
      if (tab === 'explain') out.innerHTML = `<div class="panel">${r && r.explain ? MM.renderExplain(r.explain) : '<p class="muted">Run a query with <code>.explain("executionStats")</code> or press <b>Explain last statement</b>.</p>'}</div>`;
      if (tab === 'pipeline') {
        if (r && r.pipeline) {
          let steps;
          try { steps = MM.engine.stepPipeline(r.pipeline.db, r.pipeline.coll, r.pipeline.pipeline); } catch (e) { steps = [{ label: 'error', error: e.message }]; }
          out.innerHTML = `<div class="panel"><p class="muted">Stage-by-stage view of the last <code>aggregate()</code> on <code>${esc(r.pipeline.db + '.' + r.pipeline.coll)}</code>.</p>${MM.renderPipeline(steps)}</div>`;
        } else out.innerHTML = '<div class="panel"><p class="muted">Run an <code>aggregate([...])</code> to see each stage\'s input and output.</p></div>';
      }
      if (tab === 'history') {
        const hist = load('mm-pg-history', []);
        out.innerHTML = `<div class="panel">${hist.length ? hist.map((h, i) => `<div class="code" style="cursor:pointer" data-h="${i}"><div class="code-head"><span class="title">${new Date(h.at).toLocaleString()} ${h.ok ? '' : '<span style="color:var(--red)">· error</span>'}</span><span class="faint">click to load</span></div><pre>${highlight(h.code.slice(0, 600))}</pre></div>`).join('') : '<p class="muted">No history yet.</p>'}</div>`;
        out.querySelectorAll('[data-h]').forEach(el => el.onclick = () => { ed.value = hist[+el.dataset.h].code; syncGutter(); store('mm-pg-code', ed.value); toast('Loaded into editor'); });
      }
    }
    function renderTree() {
      const eng = MM.engine, tree = document.getElementById('pgTree');
      if (!tree) return;
      tree.innerHTML = eng.dbNames().sort().map(dn => {
        const colls = Object.keys(eng.dbs[dn]).sort();
        return `<div class="tree-item" data-db="${esc(dn)}"><b>${esc(dn)}</b>${dn === eng.currentDb ? '<small style="color:var(--green)">current</small>' : `<small>${colls.length}</small>`}</div>
          <div class="tree-sub">${colls.map(cn => {
            const s = eng.dbs[dn][cn];
            const kind = s.options.viewOn ? 'view' : (s.options.timeseries ? 'ts' : s.docs.length);
            return `<div data-coll="${esc(dn)}|${esc(cn)}" title="${esc(s.indexes.map(i => i.name).join(', '))}">${esc(cn)} <span class="faint">${kind}${s.indexes.length > 1 ? ' · ' + (s.indexes.length) + ' idx' : ''}</span></div>`;
          }).join('')}</div>`;
      }).join('');
      tree.querySelectorAll('[data-coll]').forEach(el => el.onclick = () => {
        const [dn, cn] = el.dataset.coll.split('|');
        const acc = /^[A-Za-z_]\w*$/.test(cn) ? 'db.' + cn : `db.getCollection(${JSON.stringify(cn)})`;
        const prefix = dn !== MM.engine.currentDb ? `use ${dn}\n` : '';
        ed.value = `${prefix}${acc}.find().limit(5)\n${acc}.getIndexes()\n`;
        syncGutter(); store('mm-pg-code', ed.value); run();
      });
    }
    renderTree();
    document.getElementById('pgRun').onclick = () => run();
    document.getElementById('pgExplain').onclick = explainLast;
    document.getElementById('pgClear').onclick = () => { pgState.last = null; showTab('output'); };
    document.getElementById('pgRefresh').onclick = renderTree;
    document.getElementById('pgHelp').onclick = () => { out.innerHTML = renderConsole([{ type: 'result', text: MM.shellHelp }]); };
    document.getElementById('pgReset').onclick = () => {
      if (!confirm('Reset every database to the original seed data? Your collections, indexes and edits will be removed.')) return;
      MM.engine.reset(); renderTree(); toast('Database reset to seed data');
    };
    app.querySelectorAll('[data-snip]').forEach(b => b.onclick = () => { ed.value = snippets[+b.dataset.snip].code; syncGutter(); store('mm-pg-code', ed.value); ed.focus(); });
    app.querySelectorAll('.pg-tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    if (inject) run(inject);
  }

  /* ---------------- exercises ---------------- */
  function exercises() {
    const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
    const fl = qs.get('level') || '', ft = qs.get('topic') || '', fs = qs.get('status') || '';
    const topics = [...new Set(MM.PROBLEMS.map(p => p.topic))];
    const list = MM.PROBLEMS.filter(p => (!fl || String(p.level) === fl) && (!ft || p.topic === ft) && (!fs || (fs === 'done' ? P.exercises[p.id] : !P.exercises[p.id])));
    const solved = MM.PROBLEMS.filter(p => P.exercises[p.id]).length;
    mount(`<div class="wrap"><h1>Exercises</h1>
      <p class="muted">${MM.PROBLEMS.length} problems, checked by running your answer and the reference solution on a fresh copy of the shop database and comparing results. Solved: ${solved}.</p>
      <div class="filters">
        <select id="fLevel"><option value="">All levels</option>${MM.LEVELS.map(L => `<option value="${L.id}" ${fl == L.id ? 'selected' : ''}>${esc(L.name)}</option>`).join('')}</select>
        <select id="fTopic"><option value="">All topics</option>${topics.map(t => `<option ${ft === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <select id="fStatus"><option value="">Any status</option><option value="todo" ${fs === 'todo' ? 'selected' : ''}>Unsolved</option><option value="done" ${fs === 'done' ? 'selected' : ''}>Solved</option></select>
      </div>
      <div class="card" style="padding:0">${list.map(p => `<a class="ex-row" href="#/exercises/${p.id}"><span class="check ${P.exercises[p.id] ? 'done' : ''}">${P.exercises[p.id] ? '&#10003;' : ''}</span><span class="t">${esc(p.title)}</span><span class="pill">${esc(p.topic)}</span><span class="pill">${esc(p.difficulty)}</span>${lvlPill(p.level)}</a>`).join('') || '<p class="muted" style="padding:14px">No exercises match.</p>'}</div></div>`, 'exercises');
    const upd = () => { const q = new URLSearchParams(); ['fLevel', 'fTopic', 'fStatus'].forEach((k, i) => { const v = document.getElementById(k).value; if (v) q.set(['level', 'topic', 'status'][i], v); }); location.hash = '#/exercises' + (q.toString() ? '?' + q : ''); };
    ['fLevel', 'fTopic', 'fStatus'].forEach(k => document.getElementById(k).onchange = upd);
  }
  function normalizeForCompare(v, p) {
    if (v && v._isCursor) v = v.toArray();
    const strip = (x) => {
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
  function exercise(id) {
    const p = MM.PROBLEMS.find(x => x.id === id);
    if (!p) return notFound();
    const saved = load('mm-ex-' + id, null);
    const i = MM.PROBLEMS.indexOf(p), next = MM.PROBLEMS[i + 1];
    mount(`<div class="ex-layout">
      <div>
        <div class="crumbs faint"><a href="#/exercises">Exercises</a> / ${esc(p.topic)}</div>
        <h1 style="font-size:1.6rem">${esc(p.title)}</h1>
        <div class="row">${lvlPill(p.level)}<span class="pill">${esc(p.difficulty)}</span><span class="pill">${esc(p.topic)}</span>${P.exercises[id] ? '<span class="pill" style="color:var(--green)">solved</span>' : ''}</div>
        <div class="sec">${p.prompt}</div>
        ${p.setup ? `<div class="callout info"><b>Setup</b>This setup runs before your code on a fresh database:<pre style="margin:6px 0 0;white-space:pre-wrap;font-size:.8rem">${highlight(p.setup)}</pre></div>` : ''}
        ${p.compare === 'unordered' ? '<p class="faint">Order of results does not matter for this problem.</p>' : ''}
        <div class="row" style="margin-top:10px">${(p.hints || []).map((h, hi) => `<button class="btn small" data-hint="${hi}">Hint ${hi + 1}</button>`).join('')}<button class="btn small" id="showSol">Show solution</button></div>
        <div id="hintBox"></div>
        ${next ? `<p style="margin-top:24px"><a href="#/exercises/${next.id}">Next: ${esc(next.title)} &rarr;</a></p>` : ''}
      </div>
      <div>
        <div class="ex-editor"><div class="code-head" style="display:flex;gap:8px;padding:6px 10px;background:#0f1d24;color:#8fb0bd;font-size:.8rem"><span style="flex:1">your answer · the last expression is compared</span><button class="code-btn" id="exReset">Reset</button></div>
        <textarea id="exCode" spellcheck="false">${esc(saved || p.starter || '')}</textarea></div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="exCheck">Check answer <kbd>Ctrl Enter</kbd></button><button class="btn" id="exRun">Run only</button></div>
        <div class="ex-result" id="exResult"></div>
      </div></div>`, 'exercises');
    const ta = document.getElementById('exCode'), res = document.getElementById('exResult');
    ta.addEventListener('input', () => store('mm-ex-' + id, ta.value));
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); check(); }
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
    });
    app.querySelectorAll('[data-hint]').forEach(b => b.onclick = () => { document.getElementById('hintBox').innerHTML += `<div class="callout tip"><b>Hint ${+b.dataset.hint + 1}</b>${p.hints[+b.dataset.hint]}</div>`; b.disabled = true; });
    document.getElementById('showSol').onclick = () => { document.getElementById('hintBox').innerHTML += codeBlock(p.solution, { title: 'Reference solution', note: p.explain || '' }); };
    document.getElementById('exReset').onclick = () => { ta.value = p.starter || ''; store('mm-ex-' + id, ta.value); };
    /* The ';' lines stop automatic semicolon insertion from gluing a verify line that starts with '(' onto the user's last line. */
    const fullCode = c => (p.setup ? p.setup + '\n;\n' : '') + c + (p.verify ? '\n;\n' + p.verify : '');
    document.getElementById('exRun').onclick = async () => {
      res.innerHTML = '<p class="muted">running…</p>';
      const r = await MM.evaluate(fullCode(ta.value));
      res.innerHTML = renderConsole(r.outputs, r.ms);
    };
    async function check() {
      res.innerHTML = '<p class="muted">checking against the reference solution…</p>';
      const [ru, rr] = await Promise.all([MM.evaluate(fullCode(ta.value)), MM.evaluate(fullCode(p.solution))]);
      let ok = false, why = '';
      if (ru.error) why = 'Your code raised an error.';
      else if (!ru.values.length) why = 'Your code did not produce a value. End with an expression (no trailing variable declaration) so its result can be compared.';
      else {
        const a = normalizeForCompare(ru.value, p), b = normalizeForCompare(rr.value, p);
        ok = U.keyOf(a) === U.keyOf(b);
        if (!ok) {
          if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) why = `You returned ${a.length} item(s); the expected result has ${b.length}.`;
          else if (Array.isArray(a) && Array.isArray(b)) why = 'Same number of items, but different content or order' + (p.compare === 'unordered' ? '' : ' (order matters here)') + '.';
          else why = 'The result differs from the expected value.';
        }
      }
      if (ok && !P.exercises[id]) { P.exercises[id] = Date.now(); saveP(); }
      res.innerHTML = `<div class="result-banner ${ok ? 'ok' : 'no'}">${ok ? 'Correct. Your result matches the reference solution.' : 'Not yet. ' + esc(why)}</div>
        ${ok && p.explain ? `<div class="callout tip"><b>Why this works</b>${p.explain}</div>` : ''}
        <h4 style="margin:10px 0 4px">Your output</h4>${renderConsole(ru.outputs, ru.ms)}
        ${ok ? '' : `<details class="qa" style="margin-top:10px"><summary>Show expected result</summary><div class="ans">${renderConsole([{ type: 'result', text: MM.fmt(normalizeForCompare(rr.value, p)) }])}</div></details>`}`;
    }
    document.getElementById('exCheck').onclick = check;
  }

  /* ---------------- static pages ---------------- */
  function page(key) {
    const pg = MM.PAGES[key];
    if (!pg) return notFound();
    mount(`<div class="wrap"><h1>${esc(pg.title)}</h1><p class="muted" style="font-size:1.05rem">${pg.intro || ''}</p>
      ${pg.sections.length > 3 ? `<div class="card toc">${pg.sections.map(s => `<div><a href="#/${key}" data-jump="${s.id}">${esc(s.title)}</a></div>`).join('')}</div>` : ''}
      ${pg.sections.map(s => `<section class="sec" id="s-${s.id}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('')}</div>`, key);
    app.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById('s-' + a.dataset.jump).scrollIntoView({ behavior: 'smooth' }); });
  }

  function interview() {
    const cats = MM.INTERVIEW.categories || [];
    const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
    let cat = qs.get('cat') || '', lvl = qs.get('level') || '', q = qs.get('q') || '', hideKnown = qs.get('hide') === '1';
    const total = cats.reduce((a, c) => a + c.items.length, 0), known = Object.keys(P.known).length;
    mount(`<div class="wrap"><h1>Interview preparation</h1>
      <p class="muted">${total} questions with model answers, grouped by role. Mark the ones you can answer confidently; ${known} marked so far.</p>
      <div class="row" style="margin-bottom:14px"><a class="btn primary" href="#/mock">Start a timed mock interview</a><a class="btn" href="#/review">Review deck</a></div>
      <div class="grid g4" style="margin-bottom:10px">${cats.map(c => `<a class="card link" href="#/interview?cat=${c.id}"><b>${esc(c.title)}</b><div class="muted" style="font-size:.85rem">${esc(c.desc)}</div><small class="faint">${c.items.length} questions</small></a>`).join('')}</div>
      <div class="filters">
        <input id="iq" placeholder="Filter questions…" value="${esc(q)}">
        <select id="icat"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${cat === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
        <select id="ilvl"><option value="">All levels</option>${['junior', 'mid', 'senior'].map(l => `<option ${lvl === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="muted"><input type="checkbox" id="ihide" ${hideKnown ? 'checked' : ''}> hide known</label>
        <button class="btn small" id="iexpand">Expand all</button>
      </div><div id="ilist"></div></div>`, 'interview');
    const listEl = document.getElementById('ilist');
    function draw() {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      let html = '';
      cats.forEach(c => {
        if (cat && c.id !== cat) return;
        const items = c.items.map((it, i) => Object.assign({ key: c.id + ':' + i, srsKey: 'iq:' + c.id + ':' + i }, it)).filter(it => (!lvl || it.level === lvl) && (!hideKnown || !P.known[it.key]) && words.every(w => (it.q + ' ' + it.a + ' ' + (it.tags || []).join(' ')).toLowerCase().includes(w)));
        if (!items.length) return;
        html += `<h2>${esc(c.title)} <small class="faint">(${items.length})</small></h2>` + items.map(it => `<details class="qa"><summary><span>${esc(it.q)}</span><span class="qa-tags">${it.since ? verPill(it.since) : ''}<span class="pill">${esc(it.level || '')}</span></span></summary><div class="ans">${it.a}<div class="row" style="margin-top:8px"><label class="muted"><input type="checkbox" data-known="${it.key}" ${P.known[it.key] ? 'checked' : ''}> I can answer this</label><span class="spacer"></span><button class="btn small" data-srs="${it.srsKey}" ${MM.study && MM.study.inDeck(it.srsKey) ? 'disabled' : ''}>${MM.study && MM.study.inDeck(it.srsKey) ? 'In review deck' : 'Review later'}</button></div></div></details>`).join('');
      });
      listEl.innerHTML = html || '<p class="muted">No questions match the filters.</p>';
      hydrate(listEl);
      listEl.querySelectorAll('[data-known]').forEach(cb => cb.onchange = () => { if (cb.checked) P.known[cb.dataset.known] = 1; else delete P.known[cb.dataset.known]; saveP(); });
      listEl.querySelectorAll('[data-srs]').forEach(b => b.onclick = () => { MM.study.addToDeck(b.dataset.srs); b.disabled = true; b.textContent = 'In review deck'; toast('Added to your review deck'); });
    }
    draw();
    document.getElementById('iq').oninput = e => { q = e.target.value; draw(); };
    document.getElementById('icat').onchange = e => { cat = e.target.value; draw(); };
    document.getElementById('ilvl').onchange = e => { lvl = e.target.value; draw(); };
    document.getElementById('ihide').onchange = e => { hideKnown = e.target.checked; draw(); };
    document.getElementById('iexpand').onclick = () => listEl.querySelectorAll('details').forEach(d => d.open = true);
  }

  function cheatsheet() {
    const cs = MM.PAGES.cheatsheet;
    mount(`<div class="wrap wide"><h1>${esc(cs.title)}</h1><p class="muted">${cs.intro}</p>
      <div class="grid g3 cheat">${cs.cards.map(c => `<div class="card"><h3>${esc(c.title)}</h3><pre>${highlight(c.code)}</pre></div>`).join('')}</div></div>`, 'cheatsheet');
  }

  function progress() {
    const total = MM.LESSONS.length, done = MM.LESSONS.filter(l => P.lessons[l.id]).length;
    let qa = 0, qt = 0;
    Object.values(P.quiz).forEach(m => Object.values(m).forEach(v => { qt++; if (v) qa++; }));
    const ex = Object.keys(P.exercises).length, known = Object.keys(P.known).length;
    const nQ = (MM.INTERVIEW.categories || []).reduce((a, c) => a + c.items.length, 0);
    mount(`<div class="wrap"><h1>Your progress</h1><p class="muted">Stored only in this browser.</p>
      <div class="stats">
        <div class="stat"><b>${done}/${total}</b><span>lessons completed</span></div>
        <div class="stat"><b>${qt ? Math.round(qa / qt * 100) : 0}%</b><span>quiz accuracy (${qa}/${qt})</span></div>
        <div class="stat"><b>${ex}/${MM.PROBLEMS.length}</b><span>exercises solved</span></div>
        <div class="stat"><b>${known}/${nQ}</b><span>interview questions known</span></div>
      </div>
      <div class="stats" style="margin-top:0">
        <div class="stat"><b>${Object.keys(P.scenarios || {}).length}/${(MM.SCENARIOS || []).length}</b><span>scenarios solved</span></div>
        <div class="stat"><b>${Object.keys(P.srs || {}).length}</b><span>items in review deck</span></div>
        <div class="stat"><b>${(P.mock || []).length}</b><span>mock interviews</span></div>
        <div class="stat"><b>${Object.values(P.exams || {}).reduce((a, x) => a + x.length, 0)}</b><span>practice exams</span></div>
      </div>
      <h2>By level</h2>
      ${MM.LEVELS.map(L => { const ls = lessonsOfLevel(L.id), d = ls.filter(l => P.lessons[l.id]).length; return `<div style="margin:10px 0"><div class="row"><b>${L.id}. ${esc(L.name)}</b><span class="spacer"></span><span class="muted">${d}/${ls.length}</span></div><div class="progressbar"><i style="width:${ls.length ? d / ls.length * 100 : 0}%;background:${L.color}"></i></div></div>`; }).join('')}
      <h2>Next up</h2>
      <div class="grid g3">${MM.LESSONS.filter(l => !P.lessons[l.id]).slice(0, 6).map(l => `<a class="card link" href="#/learn/${l.id}"><b>${esc(l.title)}</b><div class="muted" style="font-size:.85rem">${esc(MM.MODULE_BY_ID[l.module].title)}</div></a>`).join('') || '<p>Everything is complete. Time for the interview bank.</p>'}</div>
      <h2>Reset</h2>
      <div class="row"><button class="btn danger" id="resetProg">Reset progress</button><button class="btn danger" id="resetDb">Reset database</button></div></div>`, 'progress');
    document.getElementById('resetProg').onclick = () => { if (confirm('Clear lesson, quiz, exercise, interview, scenario, review deck and exam progress?')) { ['lessons', 'quiz', 'exercises', 'known', 'srs', 'scenarios', 'exams'].forEach(k => P[k] = {}); P.mock = []; saveP(); progress(); } };
    document.getElementById('resetDb').onclick = () => { if (confirm('Reset the playground database to seed data?')) { MM.engine.reset(); toast('Database reset'); } };
  }

  function notFound() { mount('<div class="wrap"><h1>Not found</h1><p><a href="#/">Go home</a></p></div>', ''); }

  /* ---------------- search ---------------- */
  let INDEX = null;
  function strip(html) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' '); }
  function buildIndex() {
    INDEX = [];
    MM.LESSONS.forEach(l => INDEX.push({ kind: 'Lesson', title: l.title, sub: MM.MODULE_BY_ID[l.module].title, href: '#/learn/' + l.id, text: (l.title + ' ' + strip(l.summary) + ' ' + Object.values(l.sections || {}).map(strip).join(' ') + ' ' + (l.examples || []).map(e => e.code + ' ' + (e.title || '')).join(' ')).toLowerCase() }));
    (MM.INTERVIEW.categories || []).forEach(c => c.items.forEach(it => INDEX.push({ kind: 'Interview', title: it.q, sub: c.title, href: '#/interview?cat=' + c.id + '&q=' + encodeURIComponent(it.q.split(/\s+/).slice(0, 4).join(' ')), text: (it.q + ' ' + strip(it.a)).toLowerCase() })));
    MM.PROBLEMS.forEach(p => INDEX.push({ kind: 'Exercise', title: p.title, sub: p.topic, href: '#/exercises/' + p.id, text: (p.title + ' ' + strip(p.prompt) + ' ' + p.topic).toLowerCase() }));
    ['architecture', 'performance', 'internals', 'versions', 'labs'].forEach(k => { const pg = MM.PAGES[k]; if (pg) pg.sections.forEach(s => INDEX.push({ kind: k === 'labs' ? 'Lab' : k === 'versions' ? 'Versions' : pg.title, title: s.title, sub: pg.title, href: '#/' + k, text: (s.title + ' ' + strip(s.html)).toLowerCase() })); });
    (MM.SCENARIOS || []).forEach(sc => INDEX.push({ kind: 'Scenario', title: sc.title, sub: (sc.tags || []).join(', '), href: '#/scenarios/' + sc.id, text: (sc.title + ' ' + sc.alert + ' ' + strip(sc.brief) + ' ' + (sc.tags || []).join(' ')).toLowerCase() }));
    (MM.VERSION_TRAPS || []).forEach(t => INDEX.push({ kind: 'Versions', title: t.q, sub: 'Version-dependent answer', href: '#/versions', text: (t.q + ' ' + strip(t.a)).toLowerCase() }));
  }
  function search(q) {
    if (!INDEX) buildIndex();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return INDEX.map(it => {
      let sc = 0;
      for (const w of words) {
        const inT = it.title.toLowerCase().includes(w), inB = it.text.includes(w);
        if (!inT && !inB) return null;
        sc += inT ? 5 : 1;
      }
      if (it.kind === 'Lesson') sc += 1;
      return Object.assign({ sc }, it);
    }).filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 40);
  }
  function openSearch() {
    if (document.querySelector('.modal-bg')) return;
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal"><input placeholder="Search lessons, exercises, interview questions…" autofocus><div class="results"></div></div>';
    document.body.appendChild(bg);
    const inp = bg.querySelector('input'), resEl = bg.querySelector('.results');
    let sel = 0, items = [];
    const close = () => bg.remove();
    const draw = () => {
      items = search(inp.value);
      resEl.innerHTML = items.map((it, i) => `<a class="res ${i === sel ? 'sel' : ''}" href="${it.href}"><span class="pill kind">${esc(it.kind)}</span>${esc(it.title)}<small>${esc(it.sub)}</small></a>`).join('') || (inp.value ? '<div class="res muted">No matches</div>' : '<div class="res muted">Try: ESR, oplog window, $lookup, write concern, jumbo chunk</div>');
      resEl.querySelectorAll('a').forEach(a => a.onclick = close);
    };
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = e => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && items[sel]) { location.hash = items[sel].href; close(); }
    };
    bg.onclick = e => { if (e.target === bg) close(); };
    draw();
    setTimeout(() => inp.focus(), 10);
  }
  document.getElementById('searchBtn').onclick = openSearch;
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });
  document.getElementById('themeBtn').onclick = () => {
    const t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('mm-theme', t); } catch (e) { /* storage disabled */ }
  };
  document.getElementById('menuToggle').onclick = () => document.getElementById('nav').classList.toggle('open');

  /* ---------------- router ---------------- */
  const ROUTES = [
    [/^#?\/?$/, home],
    [/^#\/learn(\?.*)?$/, learn],
    [/^#\/learn\/([\w-]+)$/, lesson],
    [/^#\/playground$/, playground],
    [/^#\/exercises(\?.*)?$/, exercises],
    [/^#\/exercises\/([\w-]+)$/, exercise],
    [/^#\/(architecture|performance|internals|versions|labs)$/, page],
    [/^#\/interview(\?.*)?$/, interview],
    [/^#\/cheatsheet$/, cheatsheet],
    [/^#\/progress$/, progress]
  ];
  ROUTES.push(...(MM.pageModules || []));
  function route() {
    const h = location.hash || '#/';
    for (const [re, fn] of ROUTES) {
      const m = re.exec(h);
      if (m) {
        try { fn(m[1] && !m[1].startsWith('?') ? m[1] : undefined); }
        catch (e) { console.error(e); app.innerHTML = `<div class="wrap"><h1>Something broke</h1><pre>${esc(e.stack || e)}</pre></div>`; }
        if (!/^#\/(interview|learn)\?/.test(h)) window.scrollTo(0, 0);
        return;
      }
    }
    notFound();
  }
  MM.ui = { P, saveP, load, store, mount, hydrate, codeBlock, renderConsole, toast, lvlPill, verPill, esc, highlight, LESSON_BY_ID, notFound };
  window.addEventListener('hashchange', route);
  route();
})();
