// portal#2440 — the question card (#2234) mounted in real Chromium with compiled CSS.
// The behaviours were unit-pinned only and never seen in a browser; this is the browser layer:
//  - the eight `shots/question-card-<state>-<width>-<scheme>.png` screenshots (pending and
//    answered at 390/1280, light/dark) the manual pass asked for (HADRON_LAYOUT_SHOTS=<dir>),
//  - the checks its receipts left undone: Undo/Withdraw hidden while impersonating, the
//    Authorizes-work badge, the typed refusal texts (stale revision and forbidden) in the alert
//    region, "Your answer" only on the viewer's own answer, a viewer who is neither decider nor
//    asker, and the keyboard/screen-reader pass (the status/alert regions announce, Tab order
//    across the option forms, Enter submits the focused option form).
// The refusal texts and the result shape are the REAL modules' output (questionRefusal maps the
// server's code, questionResultOf is what the page passes as the card's result prop); only the
// POST itself is inert — the $app/forms stand-in never navigates. This proves what the card
// renders, focuses and announces, not the server's authority: the private-stack QA seat owns the
// authenticated round trip (same boundary as the findings-dispositions fixture).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const fixture = `
import '/src/app.css';
import { mount, unmount, tick } from 'svelte';
import QuestionCard from '/src/lib/components/questions/QuestionCard.svelte';
import { questionRefusal, refusalNeedsReload } from '/src/lib/questions/refusal.ts';
import { questionResultOf } from '/src/lib/questions/action-kinds.ts';

let component;
const person = (n) => ({ id: \`id-\${n}\`, handle: n, name: n.toUpperCase() });
const DECIDERS = [person('priya'), person('quinn')];
const OPTIONS = [
  { key: 'A', label: 'Timer: sweep every 60 seconds', whyChoose: 'Simple; no new plumbing on the relay.', whyNot: null, risks: null },
  { key: 'B', label: 'Event: sweep on disconnect notifications', whyChoose: 'No idle cost; the relay already emits the event.', whyNot: 'One dropped notification loses one sweep.', risks: null },
  { key: 'C', label: 'Heartbeat: sweep when a session misses two beats', whyChoose: null, whyNot: null, risks: 'Two clocks must agree on what a missed beat is.' },
];
const ANSWERED_A_BY_PRIYA = { kind: 'ANSWER', key: 'A', text: null, reason: null, at: '2026-11-21T09:30:00Z', via: 'PORTAL', by: person('priya') };
const RETRACTED_B_BY_QUINN = { kind: 'ANSWER', key: 'B', text: null, reason: null, at: '2026-11-20T16:00:00Z', via: 'PORTAL', by: person('quinn') };
const RETRACTION_BY_QUINN = { kind: 'RETRACTION', key: null, text: null, reason: 'answered the wrong question', at: '2026-11-20T16:05:00Z', via: 'PORTAL', by: person('quinn') };
// What loadQuestion returns for the same viewer, minus what each scenario varies.
const base = {
  id: 'q-1', urn: 'hrn:node:example.com:m:schedule:q-1', portalUrl: null,
  code: 'SCHEDULE-7', title: 'What cadence owns the expired-session sweep?',
  background: 'Expired sessions are swept by a cron job today. The sweep moves to the relay with the question log, and it needs a cadence.',
  whyNow: 'The cron job retires when the relay ships; the sweep must not pause with it.',
  priority: 'NORMAL', tier: 'ANSWERED', authorizes: false, state: 'OPEN', answered: false, revSeq: 7,
  viewerIsDecider: true, viewerMayAnswer: true,
  neededBy: '2026-11-24T17:00:00Z', defaultAction: 'pick the cheapest option',
  askedAt: '2026-11-20T15:00:00Z', answeredAt: null, options: OPTIONS,
  recommendation: { key: 'B', reason: 'B is the cheapest to operate and the relay already emits the event it needs.', by: { user: null, worker: person('rowan'), app: null } },
  noRecommendationReason: null, answer: null, answers: [],
  blocks: [], sources: [], specsTouched: [{ ref: null, node: 'hrn:node:example.com:specs:cor:schedule:010:02', spec: null }], specsMustChange: [],
  viewerId: 'id-priya', impersonating: false, deciders: DECIDERS, assignee: null, effectiveAssignee: null,
  askedBy: { user: null, worker: person('rowan'), app: null }, withdrawn: null,
};
// The result prop exactly as the page builds it after an action answered: the server's code
// through the known-codes-only map (src/lib/server/questions.ts), then questionResultOf(form) —
// including the reload flag the card's guarded() handler acts on (refusalNeedsReload: the stale
// revision refusal reloads, the forbidden one does not).
const actionResult = (payload) => {
  if (payload.code) {
    const mapped = questionRefusal(payload.code);
    if (!mapped) throw new Error(\`questionRefusal does not know \${payload.code}\`);
    return questionResultOf({ kind: payload.kind, ok: false, error: mapped.text, reload: refusalNeedsReload(payload.code) });
  }
  return questionResultOf(payload);
};
const scenarios = {
  // The two shot scenarios: a decider facing a pending question, and the same question answered.
  pending: { props: {} },
  answered: { props: { state: 'DECIDED', answered: true, answeredAt: '2026-11-21T09:30:00Z', answer: ANSWERED_A_BY_PRIYA, answers: [RETRACTED_B_BY_QUINN, RETRACTION_BY_QUINN, ANSWERED_A_BY_PRIYA] } },
  // #2440 Ask 2: an impersonated session is offered no decider act at all
  // (hrn:node:hadronmemory.com:specs:cor:dmo:140:05: the
  // server refuses every write under impersonation; the card hides Undo and Withdraw, and
  // viewerMayAnswer is false so no answer form renders either). Two mounts: an open question
  // (the not-allowed note renders only there) and an answered one (the direct Undo check).
  impersonated: { props: { viewerMayAnswer: false, impersonating: true }, canAct: false },
  impersonatedAnswered: { props: { state: 'DECIDED', answered: true, answer: ANSWERED_A_BY_PRIYA, answers: [ANSWERED_A_BY_PRIYA], viewerMayAnswer: false, impersonating: true }, canAct: false },
  // #2440 Ask 2: the "Authorizes work" badge on a question that authorizes work.
  authorizes: { props: { authorizes: true } },
  // #2440 Ask 2: the typed refusal texts, as the alert region announces them.
  conflict: { props: {}, result: { code: 'NODE_WRITE_CONFLICT', kind: 'answerQuestion' } },
  forbidden: { props: {}, result: { code: 'QUESTION_FORBIDDEN', kind: 'answerQuestion' } },
  // #2440 Ask 3: a success announces in the polite status region, not the alert.
  success: { props: {}, result: { kind: 'answerQuestion', ok: true, message: 'Answered A' } },
  // #2440 Ask 2: another decider's answer is marked "Answered", never "Your answer".
  theirs: { props: { state: 'DECIDED', answered: true, answer: { ...ANSWERED_A_BY_PRIYA, by: person('quinn') }, answers: [{ ...ANSWERED_A_BY_PRIYA, by: person('quinn') }] } },
  // #2440 Ask 2: a viewer who is neither decider nor asker can act on nothing (hrn:node:hadronmemory.com:specs:cor:dmo:140:05).
  stranger: { props: { viewerIsDecider: false, viewerMayAnswer: false, viewerId: 'id-zoe' }, canAct: false },
};
window.scenario = async (name) => {
  if (component) await unmount(component);
  const s = scenarios[name];
  if (!s) throw new Error(\`unknown scenario \${name}\`);
  component = mount(QuestionCard, { target: document.querySelector('main'), props: {
    question: { ...base, ...s.props },
    canAct: s.canAct ?? true,
    result: s.result ? actionResult(s.result) : null,
  } });
  await tick();
  await new Promise(r => requestAnimationFrame(r));
  return name;
};
window.submitted = [];
document.addEventListener('submit', (e) => { e.preventDefault(); window.submitted.push(Object.fromEntries(new FormData(e.target).entries())); }, { capture: true });
await window.scenario('pending');
window.fixtureReady = true;
`;
const aliases = Object.fromEntries(['navigation', 'environment', 'stores', 'state', 'forms'].map(name => [`$app/${name}`, resolve(`src/lib/test/stubs/app-${name}.ts`)]));
const server = await createServer({
  configFile: false, plugins: [tailwindcss(), svelte(), {
    name: 'question-card-fixture',
    resolveId(id) { if (id === '/__question-entry.ts') return '\0question-entry'; },
    load(id) { if (id === '\0question-entry') return fixture; },
    configureServer(s) { s.middlewares.use('/__question', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__question', '<html><body class="bg-white dark:bg-zinc-950"><main class="text-zinc-900 dark:text-zinc-100" style="margin:16px;min-width:0"></main><script type="module" src="/__question-entry.ts"></script></body></html>'));
    }); },
  }], resolve: { alias: { $lib: resolve('src/lib'), ...aliases, '$env/dynamic/public': resolve('src/lib/test/stubs/env-dynamic-public.ts') } },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(new URL('/__question', server.resolvedUrls.local[0]).href);
  await page.waitForFunction(() => window.fixtureReady);
  const card = page.locator('[data-testid=question-card]');
  const shot = async (state, width, dark) => {
    if (!process.env.HADRON_LAYOUT_SHOTS) return;
    await mkdir(process.env.HADRON_LAYOUT_SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(process.env.HADRON_LAYOUT_SHOTS, `question-card-${state}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  };

  let lightBodyPaint = '';
  for (const width of [390, 1280]) for (const dark of [false, true]) {
    const ctx = `${width}px ${dark ? 'dark' : 'light'}`;
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(d => { document.documentElement.classList.toggle('dark', d); }, dark);
    // The scheme must actually paint differently, or every dark assertion below is the light one
    // again and the dark shots are light in disguise (a broken `dark:` variant would pass silently).
    const paint = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (!dark) lightBodyPaint = paint;
    else assert.notEqual(paint, lightBodyPaint, `the dark scheme paints differently (${ctx})`);

    // Ask 1: the pending shot — state chip says Pending, the decider's forms are offered.
    await page.evaluate(() => window.scenario('pending'));
    await card.waitFor();
    assert.equal((await page.locator('[data-testid=question-state]').textContent()).trim(), 'Pending', `state chip (${ctx})`);
    assert.equal(await page.getByRole('region', { name: 'Question SCHEDULE-7' }).count(), 1, `the card is a named region (${ctx})`);
    assert.equal(await card.locator('[data-testid=question-option] button:not([disabled])').count(), 3, `three answer buttons offered (${ctx})`);
    assert.ok(await card.getByText('Recommended').first().isVisible(), `recommendation chip (${ctx})`);
    assert.equal(await card.getByText('Authorizes work').count(), 0, `no authorizes badge without authorizes (${ctx})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow (${ctx})`);
    await shot('pending', width, dark);

    // Ask 1: the answered shot — Decided, the viewer's own answer marked, undo offered.
    await page.evaluate(() => window.scenario('answered'));
    assert.equal((await page.locator('[data-testid=question-state]').textContent()).trim(), 'Decided', `state chip (${ctx})`);
    assert.ok((await card.locator('[data-testid=question-option][data-key=A]').textContent()).includes('Your answer'), `own answer marked (${ctx})`);
    assert.equal(await card.locator('[data-testid=question-undo-form]').count(), 1, `undo offered to the decider (${ctx})`);
    assert.ok((await card.locator('[data-testid=question-earlier]').textContent()).includes('Earlier entries (2)'), `earlier entries listed (${ctx})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow answered (${ctx})`);
    await shot('answered', width, dark);
  }

  // Ask 2: while impersonating, the card offers no decider act at all — no answer form, no Undo,
  // no Withdraw — and says why in general terms (hrn:node:hadronmemory.com:specs:cor:dmo:140:05:
  // nothing is ever done as a decider under impersonation).
  await page.setViewportSize({ width: 390, height: 1100 });
  await page.evaluate(() => { document.documentElement.classList.remove('dark'); });
  await page.evaluate(() => window.scenario('impersonated'));
  assert.equal(await card.locator('form').count(), 0, 'impersonated: no form at all');
  assert.equal(await card.locator('[data-testid=question-withdraw]').count(), 0, 'impersonated: no Withdraw');
  assert.ok((await card.locator('[data-testid=question-not-allowed]').textContent()).includes('this session cannot answer'), 'impersonated: the session is told why in general terms');
  await page.evaluate(() => window.scenario('impersonatedAnswered'));
  assert.equal(await card.locator('form').count(), 0, 'impersonated, answered: no form at all');
  assert.equal(await card.locator('[data-testid=question-undo-form]').count(), 0, 'impersonated, answered: no Undo');
  assert.equal(await card.locator('[data-testid=question-withdraw]').count(), 0, 'impersonated, answered: no Withdraw');
  await page.evaluate(() => window.scenario('answered'));
  assert.equal(await card.locator('[data-testid=question-undo-form]').count(), 1, 'control: the same decider not impersonating is offered Undo');
  assert.equal(await card.locator('[data-testid=question-withdraw]').count(), 1, 'control: the same decider not impersonating is offered Withdraw');

  // Ask 2: the "Authorizes work" badge.
  await page.evaluate(() => window.scenario('authorizes'));
  const badge = card.getByText('Authorizes work');
  await badge.waitFor();
  assert.ok(await badge.isVisible(), 'authorizes: the badge shows');
  await page.evaluate(() => window.scenario('pending'));
  assert.equal(await card.getByText('Authorizes work').count(), 0, 'control: no badge without authorizes');

  // Ask 2: the refusal texts. The assertive alert region announces the exact prose the
  // known-codes map returns; the polite status region stays empty (hrn:node:hadronmemory.com:specs:cor:dmo:140:09:
  // a refusal is typed, and the portal's words are its own).
  await page.evaluate(() => window.scenario('conflict'));
  assert.equal((await page.getByRole('alert').textContent()).trim(), 'This question changed since you opened it. It has been reloaded: check it and answer again.', 'stale revision: the alert announces the mapped text');
  assert.equal((await page.getByRole('status').textContent()).trim(), '', 'stale revision: the status region stays empty');
  await page.evaluate(() => window.scenario('forbidden'));
  assert.equal((await page.getByRole('alert').textContent()).trim(), 'You cannot do that on this question.', 'forbidden: the alert announces the mapped text');
  assert.equal((await page.getByRole('status').textContent()).trim(), '', 'forbidden: the status region stays empty');
  await page.evaluate(() => window.scenario('pending'));
  assert.equal((await page.getByRole('alert').textContent()).trim(), '', 'control: no refusal, no alert text');

  // Ask 3: a success announces in the polite region; the alert stays quiet.
  await page.evaluate(() => window.scenario('success'));
  assert.equal((await page.getByRole('status').textContent()).trim(), 'Answered A', 'success: the status region announces the message');
  assert.equal((await page.getByRole('alert').textContent()).trim(), '', 'success: the alert region stays empty');

  // Ask 2: another decider's answer says "Answered", never "Your answer" — and a decider may
  // still take a fellow decider's answer back (Undo follows the decider, not the answerer).
  await page.evaluate(() => window.scenario('theirs'));
  const theirs = card.locator('[data-testid=question-option][data-key=A]');
  assert.ok((await theirs.textContent()).includes('Answered'), "another decider's answer: marked Answered");
  assert.ok(!(await theirs.textContent()).includes('Your answer'), "another decider's answer: never Your answer");
  assert.equal(await card.locator('[data-testid=question-undo-form]').count(), 1, "another decider's answer: the viewer, a decider, is still offered Undo");

  // Ask 2: a viewer who is neither decider nor asker — no form, no Withdraw, and the deciders
  // are named (hrn:node:hadronmemory.com:specs:cor:dmo:140:05: such a viewer can act on nothing).
  await page.evaluate(() => window.scenario('stranger'));
  assert.equal(await card.locator('form').count(), 0, 'stranger: no form at all');
  assert.equal(await card.locator('[data-testid=question-withdraw]').count(), 0, 'stranger: no Withdraw');
  assert.ok((await card.locator('[data-testid=question-not-allowed]').textContent()).includes('PRIYA (@priya), QUINN (@quinn)'), 'stranger: the deciders are named');

  // Ask 3: the keyboard and screen-reader pass. Tab order across the option forms is the DOM
  // order (answer A, B, C, then the free-text form), and Enter submits the FOCUSED option form
  // with its hidden revision — the values the unit pins could only assert exist.
  await page.evaluate(() => window.scenario('pending'));
  const focusStop = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return '';
    return el.closest('[data-testid=question-option]')?.dataset.key ?? (el.id || el.name || el.textContent.trim());
  });
  const order = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); order.push(await focusStop()); }
  assert.deepEqual(order, ['A', 'B', 'C', 'question-text', 'question-text-option', 'Send answer'], `Tab order across the option forms: ${JSON.stringify(order)}`);
  // Enter on the focused answer button submits that option's form with its hidden values.
  const answerA = card.locator('[data-testid=question-option][data-key=A] button');
  await answerA.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.submitted.at(-1)), { optionKey: 'A', revision: '7' }, 'Enter submits the focused option form with its hidden values');
  // Keyboard-operable Withdraw: Enter on the summary opens the form; its reason field is required.
  const summary = card.locator('[data-testid=question-withdraw] > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  const reason = card.locator('#question-withdraw-reason');
  await reason.waitFor();
  assert.equal(await reason.getAttribute('required'), '', 'the withdraw reason field is required');
  // The empty required reason blocks the submit itself, then a filled one goes through with the
  // hidden revision — the two halves the attribute alone cannot prove.
  const withdrawSubmit = card.locator('[data-testid=question-withdraw] button[type=submit]');
  await withdrawSubmit.focus();
  const before = await page.evaluate(() => window.submitted.length);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.submitted.length), before, 'the empty required reason blocks the withdraw submit');
  await reason.fill('moot after the relay ships');
  await withdrawSubmit.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.submitted.at(-1)), { revision: '7', reason: 'moot after the relay ships' }, 'a filled withdraw submits with its hidden revision');
  // Exactly one polite and one assertive live region, both exposed under their roles.
  assert.equal(await page.getByRole('status').count(), 1, 'exactly one status region');
  assert.equal(await page.getByRole('alert').count(), 1, 'exactly one alert region');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS: question card in real Chromium: the eight shots (pending/answered × 390/1280 × light/dark), impersonation hides every decider act, the authorizes badge, both typed refusal texts announced, another decider\'s answer never says Your answer, the stranger viewer, and the keyboard/screen-reader pass.');
} finally { await browser?.close(); await server.close(); }
