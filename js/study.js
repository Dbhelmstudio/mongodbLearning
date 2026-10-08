/* =====================================================================
   study.js — spaced-repetition review, mock interviews, certification
   track with practice exams, incident scenarios, guides hub and about.
   Loaded before app.js; app.js exposes MM.ui and mounts MM.pageModules.
   ===================================================================== */
(function () {
  'use strict';
  const MM = window.MM;
  const DAY = 86400000, MIN = 60000;
  /* Leitner boxes: days until the next review after a successful recall. */
  const INTERVALS = [0, 1, 3, 7, 16, 35];
  const GRADES = [
    { id: 'again', label: 'Again', hint: 'did not know it' },
    { id: 'hard', label: 'Hard', hint: 'partial answer' },
    { id: 'good', label: 'Good', hint: 'answered it' },
    { id: 'easy', label: 'Easy', hint: 'could teach it' }
  ];
  const ui = () => MM.ui;
  const esc = s => MM.ui.esc(s);

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function clock(ms) { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function span(ms) { return ms < 60 * MIN ? Math.max(1, Math.round(ms / MIN)) + ' min' : ms < DAY ? Math.round(ms / (60 * MIN)) + ' h' : Math.round(ms / DAY) + ' d'; }
  function when(t) { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  /* Intervals outlive the page that started them, so they stop once their element leaves the DOM. */
  function ticker(el, fn, ms) { const id = setInterval(() => { if (!document.body.contains(el)) { clearInterval(id); return; } fn(); }, ms); return id; }
  function bar(frac, color) { return `<div class="progressbar"><i style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%${color ? ';background:' + color : ''}"></i></div>`; }
  function pct(a, t) { return t ? Math.round(a / t * 100) + '%' : '–'; }

  /* ---------------- spaced repetition ---------------- */
  function deck() { const P = ui().P; return P.srs || (P.srs = {}); }
  function nextState(it, grade, now) {
    const n = Object.assign({ box: 0, reps: 0, lapses: 0 }, it);
    if (grade === 'again') { n.box = 0; n.lapses++; n.due = now + 10 * MIN; }
    else {
      n.box = grade === 'hard' ? Math.max(1, n.box) : Math.min(INTERVALS.length - 1, n.box + (grade === 'easy' ? 2 : 1));
      n.due = now + INTERVALS[n.box] * DAY * (grade === 'hard' ? 0.5 : 1);
    }
    n.reps++; n.last = now;
    return n;
  }
  function grade(key, g) { const D = deck(); D[key] = nextState(D[key], g, Date.now()); ui().saveP(); updateBadge(); }
  function addToDeck(key) {
    const D = deck();
    if (D[key]) return false;
    D[key] = { box: 0, reps: 0, lapses: 0, due: Date.now() };
    ui().saveP(); updateBadge();
    return true;
  }
  function removeFromDeck(key) { delete deck()[key]; ui().saveP(); updateBadge(); }
  function resolve(key) {
    const p = key.split(':');
    if (p[0] === 'quiz') { const L = ui().LESSON_BY_ID[p[1]], q = L && L.quiz && L.quiz[+p[2]]; return q ? { kind: 'quiz', key, lesson: L, q } : null; }
    if (p[0] === 'iq') { const c = (MM.INTERVIEW.categories || []).find(x => x.id === p[1]), it = c && c.items[+p[2]]; return it ? { kind: 'iq', key, cat: c, item: it } : null; }
    return null;
  }
  function dueKeys() { const D = deck(), now = Date.now(); return Object.keys(D).filter(k => D[k].due <= now && resolve(k)).sort((a, b) => D[a].due - D[b].due); }
  function updateBadge() { const b = document.getElementById('reviewBadge'); if (!b) return; const n = dueKeys().length; b.textContent = n; b.hidden = !n; }

  MM.study = { addToDeck, removeFromDeck, inDeck: k => !!deck()[k], updateBadge, dueKeys, nextState };
  MM.onQuizAnswer = function (lessonId, qi, ok) {
    const key = 'quiz:' + lessonId + ':' + qi;
    if (!ok) { if (!addToDeck(key)) { const D = deck(); D[key] = Object.assign(nextState(D[key], 'again', Date.now()), { due: Date.now() }); ui().saveP(); updateBadge(); } }
    else if (deck()[key]) grade(key, 'good');
  };

  function quizHtml(q, name) {
    return `<div class="quiz-q"><b>${q.q}</b><div class="opts">${q.options.map((o, oi) => `<label><input type="radio" name="${name}" value="${oi}"> <span>${o}</span></label>`).join('')}</div><div class="explain hidden"></div></div>`;
  }
  function markQuiz(box, q, pick) {
    box.querySelectorAll('label').forEach((lab, li) => { lab.classList.remove('right', 'wrong'); if (li === q.answer) lab.classList.add('right'); else if (li === pick) lab.classList.add('wrong'); });
    box.querySelectorAll('input').forEach(i => { i.disabled = true; });
    const ex = box.querySelector('.explain');
    ex.classList.remove('hidden');
    ex.innerHTML = (pick === q.answer ? '<b style="color:var(--green)">Correct.</b> ' : '<b style="color:var(--red)">Not quite.</b> ') + (q.explain || '');
  }

  /* ---------------- review queue ---------------- */
  let reviewKeysBound = false;
  function reviewPage() {
    const U = ui(), D = deck(), cats = MM.INTERVIEW.categories || [];
    const queue = dueKeys();
    let done = 0;
    const total = Object.keys(D).length;
    const learned = Object.values(D).filter(x => x.box >= 4).length;
    const upcoming = Object.values(D).filter(x => x.due > Date.now() && x.due < Date.now() + 7 * DAY).length;
    U.mount(`<div class="wrap"><h1>Review</h1>
      <p class="muted">Spaced repetition for quiz questions you missed in lessons and interview questions you add. Each correct recall pushes the next review further out (1, 3, 7, 16, then 35 days); a miss brings it back in ten minutes.</p>
      <div class="stats">
        <div class="stat"><b id="rvDue">${queue.length}</b><span>due now</span></div>
        <div class="stat"><b>${upcoming}</b><span>due in the next 7 days</span></div>
        <div class="stat"><b>${total}</b><span>items in your deck</span></div>
        <div class="stat"><b>${learned}</b><span>well learned (16+ day interval)</span></div>
      </div>
      <div id="rvCard"></div>
      <h2>Add interview questions to your deck</h2>
      <div class="filters">
        <select id="rvCat">${cats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select>
        <select id="rvLvl"><option value="">Any level</option><option>junior</option><option>mid</option><option>senior</option></select>
        <select id="rvN"><option>5</option><option selected>10</option><option>20</option></select>
        <button class="btn" id="rvAdd">Add questions</button>
        <a class="btn" href="#/mock">Take a mock interview</a>
      </div>
      <p class="faint">Questions already in your deck are skipped. You can also add single questions from the <a href="#/interview">interview bank</a>.</p></div>`, 'review');
    const card = document.getElementById('rvCard');
    function next() {
      document.getElementById('rvDue').textContent = queue.length;
      if (!queue.length) {
        card.innerHTML = `<div class="card"><h3>${done ? 'Session complete' : 'Nothing due right now'}</h3><p class="muted">${done ? 'You reviewed ' + done + ' item(s). Come back when the next ones are due.' : 'Wrong answers in lesson quizzes land here automatically. Add interview questions below to start a deck.'}</p></div>`;
        return;
      }
      const key = queue[0], r = resolve(key), st = D[key] || {};
      const head = `<div class="row"><span class="pill">${r.kind === 'quiz' ? 'Quiz' : esc(r.cat.title)}</span>${r.kind === 'quiz' ? `<a class="faint" href="#/learn/${r.lesson.id}">${esc(r.lesson.title)}</a>` : `<span class="pill">${esc(r.item.level || '')}</span>`}<span class="spacer"></span><span class="faint">${queue.length} left · reviewed ${st.reps || 0}x</span><button class="btn small" id="rvDrop" title="Remove from deck">Remove</button></div>`;
      if (r.kind === 'quiz') {
        card.innerHTML = `<div class="card srs-card">${head}${quizHtml(r.q, 'rvq')}<div class="row hidden" id="rvNextRow"><button class="btn primary" id="rvNext">Next <kbd>Enter</kbd></button></div></div>`;
        const box = card.querySelector('.quiz-q');
        box.querySelectorAll('input').forEach(inp => inp.onchange = () => {
          const pick = +inp.value, ok = pick === r.q.answer;
          markQuiz(box, r.q, pick);
          grade(key, ok ? 'good' : 'again');
          if (!ok) queue.push(key);
          document.getElementById('rvNextRow').classList.remove('hidden');
          document.getElementById('rvNext').focus();
        });
        document.getElementById('rvNext').onclick = () => { queue.shift(); done++; next(); };
      } else {
        const now = Date.now();
        card.innerHTML = `<div class="card srs-card">${head}<h3 class="mock-q">${esc(r.item.q)}</h3>
          <div class="row" id="rvRevealRow"><button class="btn primary" id="rvReveal">Show answer <kbd>Space</kbd></button><span class="faint">Answer it in your head or out loud first.</span></div>
          <div class="hidden" id="rvAns"><div class="ans">${r.item.a}</div>
          <div class="grade-row">${GRADES.map((g, gi) => `<button class="btn grade-${g.id}" data-g="${g.id}"><b>${gi + 1}. ${g.label}</b><small>${g.hint} · next in ${span(nextState(st, g.id, now).due - now)}</small></button>`).join('')}</div></div></div>`;
        U.hydrate(card);
        document.getElementById('rvReveal').onclick = () => { document.getElementById('rvAns').classList.remove('hidden'); document.getElementById('rvRevealRow').classList.add('hidden'); };
        card.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
          grade(key, b.dataset.g);
          queue.shift();
          if (b.dataset.g === 'again') queue.push(key);
          done++; next();
        });
      }
      document.getElementById('rvDrop').onclick = () => { removeFromDeck(key); queue.shift(); next(); U.toast('Removed from deck'); };
    }
    next();
    if (!reviewKeysBound) {
      reviewKeysBound = true;
      document.addEventListener('keydown', e => {
        if (!document.getElementById('rvCard') || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
        const reveal = document.getElementById('rvReveal'), ans = document.getElementById('rvAns');
        if (e.key === ' ' && reveal && ans && ans.classList.contains('hidden')) { e.preventDefault(); reveal.click(); }
        else if (/^[1-4]$/.test(e.key) && ans && !ans.classList.contains('hidden')) { const b = document.querySelector(`[data-g="${GRADES[+e.key - 1].id}"]`); if (b) b.click(); }
        else if (e.key === 'Enter') { const n = document.getElementById('rvNext'); if (n && !n.closest('.hidden')) n.click(); }
      });
    }
    document.getElementById('rvAdd').onclick = () => {
      const cid = document.getElementById('rvCat').value, lvl = document.getElementById('rvLvl').value, n = +document.getElementById('rvN').value;
      const c = cats.find(x => x.id === cid);
      const fresh = shuffle(c.items.map((it, i) => ({ it, key: 'iq:' + cid + ':' + i })).filter(x => (!lvl || x.it.level === lvl) && !D[x.key])).slice(0, n);
      fresh.forEach(x => addToDeck(x.key));
      U.toast(fresh.length ? fresh.length + ' question(s) added' : 'Every matching question is already in your deck');
      if (fresh.length) reviewPage();
    };
  }

  /* ---------------- mock interview ---------------- */
  function mockPage() {
    const U = ui(), P = U.P, cats = MM.INTERVIEW.categories || [];
    P.mock = P.mock || [];
    U.mount(`<div class="wrap"><h1>Mock interview</h1>
      <p class="muted">Questions are drawn at random from the interview bank and timed. Answer out loud as you would to an interviewer, then reveal the model answer and grade yourself honestly. Anything you grade Again or Hard joins your <a href="#/review">review deck</a>.</p>
      <div class="card"><div class="filters" style="margin:0">
        <label class="muted">Track <select id="mkTrack"><option value="mixed">Mixed</option>${cats.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label>
        <label class="muted">Level <select id="mkLvl"><option value="">Any</option><option>junior</option><option>mid</option><option selected>senior</option></select></label>
        <label class="muted">Questions <select id="mkN"><option>5</option><option selected>8</option><option>12</option></select></label>
        <label class="muted">Minutes each <select id="mkMin"><option>2</option><option selected>3</option><option>5</option></select></label>
        <button class="btn primary" id="mkStart">Start interview</button>
      </div></div>
      <div id="mkBody"></div>
      <div id="mkHist">${P.mock.length ? `<h2>Previous sessions</h2><div class="card" style="padding:0">${P.mock.slice(0, 10).map(m => `<div class="ex-row"><span class="t">${when(m.at)} · ${esc(m.trackTitle || m.track)}${m.level ? ' · ' + esc(m.level) : ''}</span><span class="pill">${m.n} questions</span><span class="pill" style="color:${m.score >= 70 ? 'var(--green)' : m.score >= 45 ? 'var(--orange)' : 'var(--red)'}">${m.score}%</span></div>`).join('')}</div>` : ''}</div></div>`, 'interview');
    const body = document.getElementById('mkBody');
    document.getElementById('mkStart').onclick = () => {
      const val = id => document.getElementById(id).value;
      const track = val('mkTrack'), lvl = val('mkLvl'), n = +val('mkN'), limit = +val('mkMin') * MIN;
      const pool = [];
      cats.forEach(c => { if (track !== 'mixed' && c.id !== track) return; c.items.forEach((it, i) => { if (!lvl || it.level === lvl) pool.push({ key: 'iq:' + c.id + ':' + i, cat: c, item: it }); }); });
      if (!pool.length) { U.toast('No questions match that track and level'); return; }
      const qs = shuffle(pool).slice(0, n), results = [];
      document.getElementById('mkHist').innerHTML = '';
      let idx = 0;
      const show = () => {
        if (idx >= qs.length) return summary();
        const q = qs[idx], t0 = Date.now();
        body.innerHTML = `<div class="card mock-card"><div class="row"><b>Question ${idx + 1} of ${qs.length}</b><span class="pill">${esc(q.cat.title)}</span><span class="pill">${esc(q.item.level || '')}</span><span class="spacer"></span><span class="timer" id="mkTimer">${clock(limit)}</span></div>
          <h3 class="mock-q">${esc(q.item.q)}</h3>
          <textarea id="mkNotes" class="notes" placeholder="Optional: jot the key points you would make. Structure beats length: definition, how it works, trade-offs, a production example."></textarea>
          <div class="row"><button class="btn primary" id="mkReveal">Reveal model answer</button><button class="btn" id="mkSkip">Skip</button><span class="spacer"></span><button class="btn danger small" id="mkEnd">End interview</button></div>
          <div id="mkAns"></div></div>`;
        body.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const timer = document.getElementById('mkTimer');
        const tid = ticker(timer, () => { const left = limit - (Date.now() - t0); timer.textContent = left > 0 ? clock(left) : 'time is up'; timer.classList.toggle('over', left <= 0); }, 500);
        const finish = g => { clearInterval(tid); results.push({ q, g, secs: Math.round((Date.now() - t0) / 1000) }); idx++; show(); };
        document.getElementById('mkSkip').onclick = () => finish('skip');
        document.getElementById('mkEnd').onclick = () => { clearInterval(tid); summary(); };
        document.getElementById('mkReveal').onclick = () => {
          clearInterval(tid);
          timer.textContent = clock(Date.now() - t0) + ' used';
          document.getElementById('mkReveal').disabled = true;
          const ans = document.getElementById('mkAns');
          ans.innerHTML = `<div class="ans">${q.item.a}</div><p class="muted" style="margin-top:12px">How close was your answer?</p>
            <div class="grade-row">${[['again', 'Missed it'], ['hard', 'Partial'], ['good', 'Mostly there'], ['easy', 'Nailed it']].map(([g, l]) => `<button class="btn grade-${g}" data-g="${g}"><b>${l}</b></button>`).join('')}</div>`;
          U.hydrate(ans);
          ans.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
            const g = b.dataset.g;
            if (g === 'again' || g === 'hard') { addToDeck(q.key); grade(q.key, g); }
            else if (deck()[q.key]) grade(q.key, g);
            finish(g);
          });
        };
      };
      const summary = () => {
        const pts = { again: 0, hard: 1, good: 2, easy: 3, skip: 0 };
        if (!results.length) { mockPage(); return; }
        const score = Math.round(results.reduce((a, r) => a + pts[r.g], 0) / (3 * results.length) * 100);
        const trackTitle = track === 'mixed' ? 'Mixed' : cats.find(c => c.id === track).title;
        P.mock.unshift({ at: Date.now(), track, trackTitle, level: lvl, n: results.length, score });
        P.mock = P.mock.slice(0, 30);
        U.saveP();
        const label = { again: 'Missed', hard: 'Partial', good: 'Mostly', easy: 'Nailed', skip: 'Skipped' };
        body.innerHTML = `<div class="card"><h2 style="margin-top:0">Score: ${score}%</h2>
          <p class="muted">${score >= 70 ? 'Strong session. Repeat at a harder level or another track.' : score >= 45 ? 'Solid base with gaps. Review the partial answers, then try again in a few days.' : 'Plenty to work on. The questions you missed are now in your review deck.'}</p>
          ${results.map(r => `<details class="qa"><summary><span>${esc(r.q.item.q)}</span><span class="qa-tags"><span class="pill grade-pill-${r.g}">${label[r.g]}</span><span class="pill">${r.secs}s</span></span></summary><div class="ans">${r.q.item.a}</div></details>`).join('')}
          <div class="row" style="margin-top:14px"><button class="btn primary" id="mkAgain">New interview</button><a class="btn" href="#/review">Open review deck</a></div></div>`;
        U.hydrate(body);
        document.getElementById('mkAgain').onclick = () => mockPage();
      };
      show();
    };
  }

  /* ---------------- certification track ---------------- */
  function objLessons(objId) { return MM.LESSONS.filter(l => (l.exam || []).includes(objId)); }
  function quizStats(lessons) {
    let a = 0, t = 0;
    lessons.forEach(l => { const m = ui().P.quiz[l.id] || {}; Object.keys(m).forEach(k => { t++; if (m[k]) a++; }); });
    return { a, t };
  }
  function certPage() {
    const U = ui(), P = U.P;
    P.exams = P.exams || {};
    U.mount(`<div class="wrap"><h1>Certification track</h1>
      <p class="muted">The lessons mapped to the objectives of MongoDB's two associate certifications, with your progress per objective and timed practice exams built from the lesson quizzes.</p>
      <div class="callout warn"><b>Not an official exam guide</b>Objective titles paraphrase MongoDB's public exam guides; question counts, weights, passing scores and the exact domains change between exam versions. Read the current official guide before you book. Practice questions here are written for this course, not taken from the exam.</div>
      ${MM.EXAMS.map(ex => {
        const all = [...new Set(ex.objectives.flatMap(o => objLessons(o.id)))];
        const doneN = all.filter(l => P.lessons[l.id]).length, qs = quizStats(all);
        const last = (P.exams[ex.id] || [])[0];
        return `<section class="card exam-card"><div class="row"><h2 style="margin:0">${esc(ex.title)}</h2><span class="spacer"></span><a class="btn primary" href="#/certification/practice/${ex.id}">Practice exam</a><a class="btn" href="${esc(ex.url)}" target="_blank" rel="noopener">Official program</a></div>
          <p class="muted">${esc(ex.desc)}</p>
          <div class="stats" style="margin:14px 0">
            <div class="stat"><b>${doneN}/${all.length}</b><span>mapped lessons completed</span></div>
            <div class="stat"><b>${pct(qs.a, qs.t)}</b><span>lesson quiz accuracy (${qs.a}/${qs.t})</span></div>
            <div class="stat"><b>${last ? last.score + '%' : '–'}</b><span>last practice exam${last ? ' · ' + when(last.at) : ''}</span></div>
            <div class="stat"><b>${(P.exams[ex.id] || []).length}</b><span>practice attempts</span></div>
          </div>
          <div class="obj-list">${ex.objectives.map(o => {
            const ls = objLessons(o.id), d = ls.filter(l => P.lessons[l.id]).length, s = quizStats(ls);
            const pr = last && last.per && last.per[o.id];
            return `<details class="qa obj"><summary><span>${esc(o.title)}</span><span class="qa-tags"><span class="pill">${d}/${ls.length} lessons</span><span class="pill">quiz ${pct(s.a, s.t)}</span>${pr ? `<span class="pill">practice ${pct(pr[0], pr[1])}</span>` : ''}</span></summary>
              <div class="ans">${bar(ls.length ? d / ls.length : 0)}<div class="obj-lessons">${ls.map(l => `<a class="lesson-link" href="#/learn/${l.id}"><span class="check ${P.lessons[l.id] ? 'done' : ''}">${P.lessons[l.id] ? '&#10003;' : ''}</span>${esc(l.title)}${l.since ? ' ' + U.verPill(l.since) : ''}</a>`).join('')}</div></div></details>`;
          }).join('')}</div></section>`;
      }).join('')}</div>`, 'certification');
  }

  function practicePage(examId) {
    const U = ui(), P = U.P, ex = MM.EXAMS.find(e => e.id === examId);
    if (!ex) return U.notFound();
    const seen = {}, pool = [];
    ex.objectives.forEach(o => objLessons(o.id).forEach(l => (l.quiz || []).forEach((q, qi) => {
      const key = 'quiz:' + l.id + ':' + qi;
      if (seen[key]) return;
      seen[key] = 1;
      pool.push({ key, q, lesson: l, obj: o });
    })));
    const N = Math.min(30, pool.length), perQ = 90 * 1000;
    U.mount(`<div class="wrap"><div class="crumbs faint"><a href="#/certification">Certification track</a> / Practice exam</div>
      <h1>${esc(ex.title)}: practice exam</h1>
      <div id="pxBody"><div class="card"><p>${N} questions drawn across all ${ex.objectives.length} objectives from a pool of ${pool.length}, with ${clock(N * perQ)} on the clock (90 seconds per question). You can move between questions and flag them; the exam submits itself when time runs out.</p>
      <p class="muted">Your score is broken down per objective at the end, and every question you miss goes into your review deck. As a rule of thumb, aim for a steady 80% or more here before booking the real exam; that is our suggestion, not the official passing score.</p>
      <button class="btn primary" id="pxStart">Start the exam</button></div></div></div>`, 'certification');
    document.getElementById('pxStart').onclick = () => {
      const byObj = ex.objectives.map(o => shuffle(pool.filter(p => p.obj === o)));
      const picked = [];
      while (picked.length < N) {
        let added = false;
        byObj.forEach(list => { if (picked.length < N && list.length) { picked.push(list.shift()); added = true; } });
        if (!added) break;
      }
      const qs = shuffle(picked), answers = qs.map(() => null), flags = new Set(), limit = qs.length * perQ, t0 = Date.now();
      let cur = 0, over = false;
      const body = document.getElementById('pxBody');
      body.innerHTML = `<div class="px-head card"><div class="row"><b id="pxCount"></b><span class="spacer"></span><span class="timer" id="pxTimer">${clock(qs.length * perQ)}</span><button class="btn primary small" id="pxSubmit">Submit exam</button></div><div class="px-nav" id="pxNav"></div></div><div id="pxQ"></div>
        <div class="row"><button class="btn" id="pxPrev">&larr; Previous</button><button class="btn" id="pxFlag">Flag for review</button><span class="spacer"></span><button class="btn primary" id="pxNext">Next &rarr;</button></div>`;
      const timer = document.getElementById('pxTimer');
      const tid = ticker(timer, () => { const left = limit - (Date.now() - t0); timer.textContent = clock(left); timer.classList.toggle('over', left < 60000); if (left <= 0 && !over) submit(); }, 500);
      const nav = () => {
        document.getElementById('pxCount').textContent = `Question ${cur + 1} of ${qs.length} · ${answers.filter(a => a !== null).length} answered`;
        document.getElementById('pxNav').innerHTML = qs.map((_, i) => `<button class="${i === cur ? 'cur' : ''} ${answers[i] !== null ? 'done' : ''} ${flags.has(i) ? 'flag' : ''}" data-i="${i}">${i + 1}</button>`).join('');
        document.querySelectorAll('#pxNav [data-i]').forEach(b => b.onclick = () => { cur = +b.dataset.i; render(); });
        document.getElementById('pxFlag').textContent = flags.has(cur) ? 'Unflag' : 'Flag for review';
      };
      const render = () => {
        const it = qs[cur], el = document.getElementById('pxQ');
        el.innerHTML = `<p class="faint">${esc(it.obj.title)}</p>` + quizHtml(it.q, 'pxq');
        if (answers[cur] !== null) el.querySelector(`input[value="${answers[cur]}"]`).checked = true;
        el.querySelectorAll('input').forEach(inp => inp.onchange = () => { answers[cur] = +inp.value; nav(); });
        nav();
      };
      document.getElementById('pxPrev').onclick = () => { if (cur > 0) { cur--; render(); } };
      document.getElementById('pxNext').onclick = () => { if (cur < qs.length - 1) { cur++; render(); } };
      document.getElementById('pxFlag').onclick = () => { if (flags.has(cur)) flags.delete(cur); else flags.add(cur); nav(); };
      document.getElementById('pxSubmit').onclick = () => {
        const left = answers.filter(a => a === null).length;
        if (left && !confirm(left + ' question(s) unanswered. Submit anyway?')) return;
        submit();
      };
      function submit() {
        over = true;
        clearInterval(tid);
        const per = {};
        let right = 0;
        qs.forEach((it, i) => {
          const ok = answers[i] === it.q.answer;
          per[it.obj.id] = per[it.obj.id] || [0, 0];
          per[it.obj.id][1]++;
          if (ok) { right++; per[it.obj.id][0]++; }
          else { if (!addToDeck(it.key)) grade(it.key, 'again'); }
        });
        const score = Math.round(right / qs.length * 100), secs = Math.round((Date.now() - t0) / 1000);
        P.exams[ex.id] = [{ at: Date.now(), score, n: qs.length, secs, per }].concat(P.exams[ex.id] || []).slice(0, 20);
        U.saveP();
        const wrong = qs.map((it, i) => ({ it, pick: answers[i] })).filter(x => x.pick !== x.it.q.answer);
        body.innerHTML = `<div class="card"><h2 style="margin-top:0">Score: ${score}% <small class="faint">(${right}/${qs.length} in ${clock(secs * 1000)})</small></h2>
          <div class="result-banner ${score >= 80 ? 'ok' : 'no'}">${score >= 80 ? 'At or above the 80% practice target.' : 'Below the 80% practice target. Study the weakest objectives below, then try again.'}</div>
          <h3>By objective</h3>
          ${ex.objectives.filter(o => per[o.id]).map(o => { const p = per[o.id]; return `<div style="margin:8px 0"><div class="row"><span>${esc(o.title)}</span><span class="spacer"></span><span class="muted">${p[0]}/${p[1]}</span></div>${bar(p[0] / p[1], p[0] / p[1] >= 0.8 ? '' : 'var(--orange)')}</div>`; }).join('')}
          ${wrong.length ? `<h3>Questions to revisit <small class="faint">(added to your review deck)</small></h3>` + wrong.map(x => `<div class="quiz-q"><b>${x.it.q.q}</b><div class="opts">${x.it.q.options.map((o, oi) => `<label class="${oi === x.it.q.answer ? 'right' : oi === x.pick ? 'wrong' : ''}"><span>${o}</span></label>`).join('')}</div><div class="explain">${x.it.q.explain || ''} <a href="#/learn/${x.it.lesson.id}">Lesson: ${esc(x.it.lesson.title)}</a></div></div>`).join('') : ''}
          <div class="row" style="margin-top:14px"><a class="btn primary" href="#/certification">Back to the track</a><button class="btn" id="pxRetry">New practice exam</button></div></div>`;
        document.getElementById('pxRetry').onclick = () => practicePage(examId);
        window.scrollTo(0, 0);
      }
      render();
    };
  }

  /* ---------------- incident scenarios ---------------- */
  function scenariosPage() {
    const U = ui(), P = U.P, list = MM.SCENARIOS || [];
    P.scenarios = P.scenarios || {};
    const solved = list.filter(s => P.scenarios[s.id]).length;
    U.mount(`<div class="wrap"><h1>Production scenarios</h1>
      <p class="muted">Each scenario drops you into an incident on a private copy of the shop database: an alert, a brief and a shell. Investigate, apply a fix, then run the health check. Nothing you do here touches your playground data. Solved: ${solved}/${list.length}.</p>
      <div class="grid g2">${list.map(s => `<a class="card link sc-card" href="#/scenarios/${s.id}">
        <div class="row"><span class="check ${P.scenarios[s.id] ? 'done' : ''}">${P.scenarios[s.id] ? '&#10003;' : ''}</span><h3 style="margin:0">${esc(s.title)}</h3></div>
        <p class="sc-alert">${esc(s.alert)}</p>
        <div class="row"><span class="pill">${esc(s.level)}</span><span class="pill">${s.minutes} min</span>${(s.tags || []).map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div></a>`).join('')}</div></div>`, 'scenarios');
  }

  function scenarioPage(id) {
    const U = ui(), P = U.P, list = MM.SCENARIOS || [], sc = list.find(s => s.id === id);
    if (!sc) return U.notFound();
    P.scenarios = P.scenarios || {};
    const next = list[list.indexOf(sc) + 1];
    U.mount(`<div class="wrap wide"><div class="crumbs faint"><a href="#/scenarios">Scenarios</a> / ${esc(sc.title)}</div>
      <h1 style="font-size:1.7rem">${esc(sc.title)}</h1>
      <div class="row"><span class="pill">${esc(sc.level)}</span><span class="pill">${sc.minutes} min</span>${(sc.tags || []).map(t => `<span class="pill">${esc(t)}</span>`).join('')}<span id="scSolved">${P.scenarios[id] ? '<span class="pill" style="color:var(--green)">solved</span>' : ''}</span></div>
      <div class="sc-layout">
        <div>
          <div class="callout danger"><b>Alert</b>${esc(sc.alert)}</div>
          <div class="sec">${sc.brief}</div>
          <h3>Investigate</h3>
          <div class="row">${(sc.investigate || []).map((s, i) => `<button class="btn small" data-inv="${i}">${esc(s.title)}</button>`).join('')}</div>
          <h3>Stuck?</h3>
          <div class="row">${(sc.hints || []).map((h, i) => `<button class="btn small" data-hint="${i}">Hint ${i + 1}</button>`).join('')}<button class="btn small" id="scShowFix">Show reference fix</button></div>
          <div id="scHints"></div>
          <div id="scDebrief"></div>
        </div>
        <div class="sc-console">
          <div class="row"><b>Incident shell</b><span class="faint" id="scState">preparing the incident…</span><span class="spacer"></span><button class="btn small" id="scReset">Reset scenario</button></div>
          <div class="ex-editor"><textarea id="scCode" spellcheck="false" placeholder="// Write mongosh here. Ctrl+Enter runs it against this scenario's private database."></textarea></div>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="scRun">Run <kbd>Ctrl Enter</kbd></button><button class="btn" id="scCheck">Run health check</button></div>
          <div id="scCheckOut"></div>
          <div id="scOut"></div>
        </div>
      </div></div>`, 'scenarios');
    U.hydrate(document.querySelector('.sc-layout'));
    const state = document.getElementById('scState'), out = document.getElementById('scOut'), checkOut = document.getElementById('scCheckOut'), ta = document.getElementById('scCode');
    let eng, sh, ready;
    const prepare = () => {
      state.textContent = 'preparing the incident…';
      eng = new MM.Engine({ persist: false });
      sh = new MM.Shell(eng);
      eng.currentDb = 'shop';
      ready = sh.run(sc.setup, { noSave: true }).then(r => { state.textContent = r.error ? 'setup failed: ' + (r.error.message || r.error) : 'private copy of shop · resets when you leave'; });
    };
    prepare();
    const showDebrief = () => {
      document.getElementById('scDebrief').innerHTML = `<div class="callout tip"><b>Debrief</b>${sc.debrief}</div>${next ? `<p><a class="btn" href="#/scenarios/${next.id}">Next scenario: ${esc(next.title)} &rarr;</a></p>` : '<p><a class="btn" href="#/scenarios">All scenarios</a></p>'}`;
    };
    if (P.scenarios[id]) showDebrief();
    async function run(code) {
      await ready;
      out.innerHTML = '<div class="console"><div class="o info">running…</div></div>';
      const r = await sh.run(code, { noSave: true });
      out.innerHTML = U.renderConsole(r.outputs, r.ms) + (r.explain ? `<div class="panel" style="padding:12px">${MM.renderExplain(r.explain)}</div>` : '');
    }
    async function check() {
      await ready;
      eng.currentDb = 'shop';
      checkOut.innerHTML = '<p class="muted">running the health check…</p>';
      const r = await sh.run(sc.check, { collect: true, noSave: true });
      const v = r.values[r.values.length - 1];
      if (r.error || !v || !Array.isArray(v.checks)) { checkOut.innerHTML = '<div class="result-banner no">The health check could not run. Did something drop a collection it needs? Reset the scenario if so.</div>'; return; }
      checkOut.innerHTML = `<div class="result-banner ${v.ok ? 'ok' : 'no'}">${v.ok ? 'Healthy. Incident resolved.' : 'Still unhealthy.'}</div>
        <ul class="checklist">${v.checks.map(c => `<li class="${c.ok ? 'ok' : 'no'}"><span class="mark">${c.ok ? '&#10003;' : '&#10007;'}</span>${esc(c.label)}${c.detail ? ` <small class="faint">(${esc(c.detail)})</small>` : ''}</li>`).join('')}</ul>`;
      if (v.ok) {
        if (!P.scenarios[id]) { P.scenarios[id] = Date.now(); U.saveP(); U.toast('Scenario solved'); }
        document.getElementById('scSolved').innerHTML = '<span class="pill" style="color:var(--green)">solved</span>';
        showDebrief();
      }
    }
    document.getElementById('scRun').onclick = () => run(ta.value);
    document.getElementById('scCheck').onclick = check;
    document.getElementById('scReset').onclick = () => { prepare(); checkOut.innerHTML = ''; out.innerHTML = ''; U.toast('Scenario reset'); };
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(ta.value); }
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 2; }
    });
    document.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => { ta.value = sc.investigate[+b.dataset.inv].code; run(ta.value); });
    document.querySelectorAll('[data-hint]').forEach(b => b.onclick = () => { document.getElementById('scHints').innerHTML += `<div class="callout tip"><b>Hint ${+b.dataset.hint + 1}</b>${esc(sc.hints[+b.dataset.hint])}</div>`; b.disabled = true; });
    document.getElementById('scShowFix').onclick = e => {
      e.target.disabled = true;
      document.getElementById('scHints').innerHTML += `<div class="code"><div class="code-head"><span class="title">Reference fix</span><button class="code-btn" id="scLoadFix">Load into the incident shell</button></div><pre>${U.highlight(sc.fix)}</pre></div>`;
      document.getElementById('scLoadFix').onclick = () => { ta.value = sc.fix; ta.focus(); };
    };
  }

  /* ---------------- guides hub and about ---------------- */
  function guidesPage() {
    const U = ui();
    const cards = [
      ['#/architecture', 'Architecture', 'Replica sets, elections, sharding, the storage engine and the write path, with simulators.'],
      ['#/performance', 'Performance', 'explain() plans, the ESR rule, covered queries, profiling and the tuning loop.'],
      ['#/internals', 'Internals', 'WiredTiger cache and checkpoints, the oplog, journaling, locks and concurrency.'],
      ['#/versions', 'Versions', 'Release timeline from 3.6 to 8.2 and the interview answers that changed between versions.'],
      ['#/labs', 'Labs', 'Docker Compose replica set and sharded cluster with failover, rollback, oplog and PBM restore drills.'],
      ['#/cheatsheet', 'Cheat sheet', 'Shell commands, operators, aggregation stages and admin commands on one page.']
    ];
    U.mount(`<div class="wrap"><h1>Guides</h1><p class="muted">Deep-dive reference pages that sit alongside the lessons.</p>
      <div class="grid g3">${cards.map(c => `<a class="card link" href="${c[0]}"><h3>${c[1]}</h3><p class="muted">${c[2]}</p></a>`).join('')}</div></div>`, 'guides');
  }

  function aboutPage() {
    const U = ui();
    const nQ = (MM.INTERVIEW.categories || []).reduce((a, c) => a + c.items.length, 0);
    U.mount(`<div class="wrap"><h1>About MongoDB Mastery</h1>
      <p class="lead">A free, hands-on course for developers, DBAs and architects who want to understand MongoDB well enough to run it in production and explain it in an interview.</p>
      <h2>What is inside</h2>
      <ul>
        <li>${MM.LESSONS.length} lessons across ${MM.MODULES.length} modules and seven levels, from the document model to sharding, Kubernetes operators and vector search.</li>
        <li>${MM.PROBLEMS.length} auto-checked exercises and ${(MM.SCENARIOS || []).length} production incident scenarios.</li>
        <li>${nQ} interview questions with model answers, mock interviews and a spaced-repetition review deck.</li>
        <li>A certification track mapped to the Associate Developer and Associate DBA exam objectives, with timed practice exams.</li>
        <li>Docker labs for a real replica set and sharded cluster.</li>
      </ul>
      <h2>How the in-browser database works</h2>
      <p>Queries run in a JavaScript engine built on <a href="https://github.com/kofrasa/mingo" target="_blank" rel="noopener">mingo</a> (MIT) with <a href="https://github.com/acornjs/acorn" target="_blank" rel="noopener">acorn</a> (MIT) for parsing shell code. On top of that the course adds a modelled query planner and <code>explain()</code>, unique and TTL indexes, schema validation, transactions, change streams, an oplog, geospatial queries and collation.</p>
      <div class="callout warn"><b>It is a simulator</b>Query results follow MongoDB semantics, but timings, plan choices and server statistics are modelled, not measured. Replication and sharding are taught with interactive simulators. Use the Labs for real <code>mongod</code> behaviour and always confirm production decisions against the official documentation for your version.</div>
      <h2>Your data</h2>
      <p>There is no account and no server. Progress, your review deck and the playground database live in this browser's local storage. Clearing site data resets everything; the Progress page has reset buttons too.</p>
      <h2>Source and labs</h2>
      <p>The course, its tests and the Docker labs are on GitHub: <a href="https://github.com/Dbhelmstudio/mongodbLearning" target="_blank" rel="noopener">github.com/Dbhelmstudio/mongodbLearning</a>. Corrections and suggestions are welcome as issues.</p>
      <h2>Credits</h2>
      <p>Inspired by the format of <a href="https://rizwi0786.github.io/postgresLearning/" target="_blank" rel="noopener">PostgreSQL Learning</a>. MongoDB is a trademark of MongoDB, Inc. Percona is a trademark of Percona LLC. This project is independent and not endorsed by either company.</p></div>`, 'about');
  }

  MM.pageModules = [
    [/^#\/review$/, reviewPage],
    [/^#\/mock$/, mockPage],
    [/^#\/certification$/, certPage],
    [/^#\/certification\/practice\/([\w-]+)$/, practicePage],
    [/^#\/scenarios$/, scenariosPage],
    [/^#\/scenarios\/([\w-]+)$/, scenarioPage],
    [/^#\/guides$/, guidesPage],
    [/^#\/about$/, aboutPage]
  ];
})();
