/*
 * Loads every route in headless Chrome and fails on page errors, missing diagrams/widgets or empty pages.
 * Needs the site served locally (npm run serve) and Playwright installed.
 *   BASE=http://127.0.0.1:8765/ node tests/browser-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror ${page.url()}: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`console ${page.url()}: ${m.text()}`); });

await page.goto(BASE);
await page.waitForFunction(() => window.MM && MM.LESSONS && MM.LESSONS.length > 0);
const ids = await page.evaluate(() => ({
  lessons: MM.LESSONS.map(l => l.id),
  problems: MM.PROBLEMS.map(p => p.id),
  scenarios: (MM.SCENARIOS || []).map(s => s.id)
}));
const routes = ['#/', '#/learn', '#/playground', '#/exercises', '#/scenarios', '#/certification', '#/certification/practice/dev', '#/certification/practice/dba',
  '#/review', '#/mock', '#/about', '#/guides', '#/versions', '#/labs',
  '#/architecture', '#/performance', '#/internals', '#/interview', '#/cheatsheet', '#/progress',
  ...ids.lessons.map(id => '#/learn/' + id), ...ids.problems.map(id => '#/exercises/' + id), ...ids.scenarios.map(id => '#/scenarios/' + id)];

const problems = [];
for (const r of routes) {
  await page.goto(BASE + r);
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const t = document.getElementById('app').innerText;
    return { len: t.length, missing: t.match(/(diagram|widget) missing: [\w-]+/g) || [], notFound: /page not found/i.test(t.slice(0, 300)) };
  });
  if (info.len < 150 || info.missing.length || info.notFound) problems.push(`${r} ${JSON.stringify(info)}`);
}

await page.goto(BASE + '#/learn/aggregation-basics');
await page.waitForTimeout(300);
const block = page.locator('.code:has(button[data-act="run"])').first();
await block.locator('button[data-act="run"]').click();
await page.waitForTimeout(1500);
if (!(await block.locator('.out').innerText()).trim()) problems.push('inline Run produced no output');

const pid = ids.problems[0];
await page.goto(BASE + '#/exercises/' + pid);
await page.waitForTimeout(300);
await page.fill('#exCode', await page.evaluate(id => MM.PROBLEMS.find(p => p.id === id).solution, pid));
await page.click('#exCheck');
await page.waitForSelector('.result-banner', { timeout: 10000 });
if (!/Correct/.test(await page.locator('.result-banner').innerText())) problems.push('reference solution not accepted by the checker');

page.on('dialog', d => d.accept());
const text = sel => page.locator(sel).first().innerText();

await page.evaluate(() => localStorage.removeItem('mm-progress-v1'));
await page.goto(BASE + '#/scenarios/slow-customer-orders');
await page.reload();
await page.waitForFunction(() => /private copy/.test(document.getElementById('scState').textContent), null, { timeout: 15000 });
await page.click('#scCheck');
await page.waitForSelector('#scCheckOut .result-banner');
if (!/Still unhealthy/.test(await text('#scCheckOut .result-banner'))) problems.push('scenario health check passed before the fix');
await page.fill('#scCode', await page.evaluate(() => MM.SCENARIOS[0].fix));
await page.click('#scRun');
await page.waitForTimeout(800);
await page.click('#scCheck');
await page.waitForFunction(() => /Healthy/.test((document.querySelector('#scCheckOut .result-banner') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => problems.push('scenario not healthy after the reference fix'));
if (!(await page.locator('#scDebrief .callout').count())) problems.push('scenario debrief not shown after solving');

const quizLesson = await page.evaluate(() => MM.LESSONS.find(l => l.quiz && l.quiz.length).id);
await page.goto(BASE + '#/learn/' + quizLesson);
await page.waitForTimeout(200);
const wrongIdx = await page.evaluate(id => { const q = MM.LESSONS.find(l => l.id === id).quiz[0]; return q.answer === 0 ? 1 : 0; }, quizLesson);
await page.locator(`.quiz-q[data-qi="0"] input[value="${wrongIdx}"]`).check();
await page.waitForTimeout(200);
if ((await text('#reviewBadge')).trim() !== '1') problems.push('wrong quiz answer did not reach the review badge');
await page.goto(BASE + '#/review');
await page.waitForTimeout(200);
if (!(await page.locator('#rvCard .quiz-q').count())) problems.push('review page did not show the missed quiz question');

await page.goto(BASE + '#/mock');
await page.waitForTimeout(200);
await page.selectOption('#mkLvl', '');
await page.selectOption('#mkN', '5');
await page.click('#mkStart');
await page.click('#mkReveal');
await page.click('#mkAns [data-g="hard"]');
if (!/Question 2 of 5/.test(await text('#mkBody'))) problems.push('mock interview did not advance after grading');
await page.click('#mkEnd');
if (!/Score:/.test(await text('#mkBody'))) problems.push('mock interview summary missing');

await page.goto(BASE + '#/certification/practice/dba');
await page.waitForTimeout(200);
await page.click('#pxStart');
await page.locator('#pxQ input').first().check();
await page.click('#pxSubmit');
await page.waitForTimeout(300);
if (!/Score:/.test(await text('#pxBody'))) problems.push('practice exam did not produce a score');
await page.goto(BASE + '#/certification');
await page.waitForTimeout(200);
if (!/practice attempts/.test(await text('#app'))) problems.push('certification page missing practice stats');
await page.evaluate(() => localStorage.removeItem('mm-progress-v1'));

console.log(`${routes.length} routes`);
problems.forEach(p => console.log('PROBLEM ' + p));
errors.forEach(e => console.log('ERROR ' + e));
await browser.close();
const bad = problems.length + errors.length;
console.log(bad ? `FAILED: ${bad} issue(s)` : 'OK');
process.exit(bad ? 1 : 0);
