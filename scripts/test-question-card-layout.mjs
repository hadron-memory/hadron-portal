// portal#2440 — the question card (#2234) mounted in real Chromium with compiled CSS.
// The behaviours were unit-pinned only and never seen in a browser; this is the browser layer:
//  - the eight `shots/question-card-<state>-<width>-<scheme>.png` screenshots (pending and
//    answered at 390/1280, light/dark) the manual pass asked for (HADRON_LAYOUT_SHOTS=<dir>),
//  - the checks its receipts left undone: Undo/Withdraw hidden while impersonating, the
//    Authorizes-work badge, the typed refusal texts (stale revision and forbidden) announced
//    IN PLACE by the same live-region elements, "Your answer" only on the viewer's own answer,
//    a viewer who is neither decider nor asker, the reload flag driven through the card's own
//    guarded() enhance handler, and the keyboard/screen-reader pass (the status/alert regions
//    announce, Tab order across the option forms to the Withdraw summary, Enter submits the
//    focused option form).
// The card is mounted ONCE for the whole run (scripts/question-card-host.svelte); scenarios
// swap props, so an assertion can hold an element across a change and prove the card announces
// in place — a {#key result} refactor recreates the region and fails that identity check.
// The refusal texts and the result shape are the REAL modules' output (questionRefusal maps the
// server's code, questionResultOf is what the page passes as the card's result prop); only the
// POST itself is inert — the $app/forms stand-in never navigates. This proves what the card
// renders, focuses and announces, not the server's authority: the private-stack QA seat owns the
// authenticated round trip (same boundary as the findings-dispositions fixture).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

// Resolve from this file, never the cwd: the script must behave the same from the repo root
// and from any other directory (repo root = two levels up from scripts/).
const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

const fixture = `
import '/src/app.css';
import { mount, tick } from 'svelte';
import QuestionCardHost from '/scripts/question-card-host.svelte';
import { questionRefusal, refusalNeedsReload } from '/src/lib/questions/refusal.ts';
import { questionResultOf } from '/src/lib/questions/action-kinds.ts';

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
// The result prop exactly as the page builds it after an action answered. The mapping and the
// reload flag are the REAL modules' output — the same questionRefusal and refusalNeedsReload
// src/lib/server/questions.ts's run() refusal arm composes; only the refuse() glue is mirrored
// here (the server module cannot load in a browser). Keep this shape in sync with
// refuse(kind, status, text, reload) in src/lib/server/questions.ts.
const actionResult = (payload) => {
  if (payload.code) {
    const mapped = questionRefusal(payload.code);
    if (!mapped) throw new Error(\`questionRefusal does not know \${payload.code}\`);
    return questionResultOf({ kind: payload.kind, ok: false, error: mapped.text, reload: refusalNeedsReload(payload.code) });
  }
  return questionResultOf(payload);
};
// The failure data the server's refuse() arm would answer, built by the REAL mapping — the
// reload pin below drives guarded() with these, so a changed refusalNeedsReload mapping moves
// the test's payloads with it instead of leaving hand-written reload flags behind.
window.failurePayload = (code) => actionResult({ code, kind: 'answerQuestion' });
const scenarios = {
  // The two shot scenarios: a decider facing a pending question, and the same question answered.
  pending: { props: {} },
  answered: { props: { state: 'DECIDED', answered: true, answeredAt: '2026-11-21T09:30:00Z', answer: ANSWERED_A_BY_PRIYA, answers: [RETRACTED_B_BY_QUINN, RETRACTION_BY_QUINN, ANSWERED_A_BY_PRIYA] } },
  // #2440 Ask 2: an impersonated session is offered no decider or asker act at all
  // (hrn:node:hadronmemory.com:specs:cor:dmo:140:05: the server refuses every write under
  // impersonation; the card hides Undo and Withdraw — Withdraw follows the asker OR a decider,
  // per the withdrawQuestion schema — and viewerMayAnswer is false so no answer form renders
  // either). Two scenarios on the one mount: an open question (the not-allowed note renders only there) and an
  // answered one (the direct Undo check).
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
const host = mount(QuestionCardHost, { target: document.querySelector('main') });
window.scenario = async (name) => {
  const s = scenarios[name];
  if (!s) throw new Error(\`unknown scenario \${name}\`);
  host.setProps({ ...base, ...s.props }, s.canAct ?? true, s.result ? actionResult(s.result) : null);
  await tick();
  await new Promise((r) => requestAnimationFrame(r));
  return name;
};
window.submitted = [];
document.addEventListener('submit', (e) => { e.preventDefault(); window.submitted.push(Object.fromEntries(new FormData(e.target).entries())); }, { capture: true });
// Module identity, pinned from INSIDE the vite pipeline (a bare '$app/forms' specifier only
// resolves through the alias config): the card reaches the stubs through the $app/* aliases,
// the test through their /src/lib URLs — one module each, or the recorded calls and the
// read-back array would be different objects and every navigation assert below would be
// reading a stranger's diary.
window.assertModuleIdentity = async () => {
  const formsViaAlias = await import('$app/forms');
  const formsViaPath = await import('/src/lib/test/stubs/app-forms.ts');
  if (formsViaAlias !== formsViaPath) throw new Error('$app/forms and /src/lib/test/stubs/app-forms.ts resolved to different module instances');
  const navViaAlias = await import('$app/navigation');
  const navViaPath = await import('/src/lib/test/stubs/app-navigation.ts');
  if (navViaAlias !== navViaPath) throw new Error('$app/navigation and /src/lib/test/stubs/app-navigation.ts resolved to different module instances');
};
await window.scenario('pending');
window.fixtureReady = true;
`;
const aliases = Object.fromEntries(['navigation', 'environment', 'stores', 'state', 'forms'].map((name) => [`$app/${name}`, resolve(repoRoot, `src/lib/test/stubs/app-${name}.ts`)]));
const server = await createServer({
  root: repoRoot,
  configFile: false, plugins: [tailwindcss(), svelte(), {
    name: 'question-card-fixture',
    resolveId(id) { if (id === '/__question-entry.ts') return '\0question-entry'; },
    load(id) { if (id === '\0question-entry') return fixture; },
    configureServer(s) { s.middlewares.use('/__question', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await s.transformIndexHtml('/__question', '<html><body class="bg-white dark:bg-zinc-950"><div id="before-card" tabindex="-1"></div><main class="text-zinc-900 dark:text-zinc-100" style="margin:16px;min-width:0"></main><div id="after-card" tabindex="0"></div><script type="module" src="/__question-entry.ts"></script></body></html>'));
    }); },
  }], resolve: { alias: { $lib: resolve(repoRoot, 'src/lib'), ...aliases, '$env/dynamic/public': resolve(repoRoot, 'src/lib/test/stubs/env-dynamic-public.ts') } },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // A fixture crash must fail FAST with its own error, not as an opaque ready-timeout: the first
  // pageerror races the ready signal. The crash promise RESOLVES (a rejecting one that fires
  // during goto, before the race attaches its handler, would surface as an unhandled rejection
  // and bypass the finally cleanup). Console errors are held for the final assert alongside
  // the pageerrors.
  const errors = [];
  const crashed = new Promise((resolve) => {
    page.on('pageerror', (e) => { errors.push(String(e)); resolve(new Error(`the fixture crashed before it was ready: ${e}`)); });
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  // Start the clock at a fixed instant between the fixture's dates (after the newest entry
  // 09:30Z on the 21st, before neededBy on the 24th). Fake time ADVANCES from that instant —
  // requestAnimationFrame keeps working — it does not stand still; the fixed starting point is
  // what keeps the shots and any timestamp-sensitive rendering deterministic. QuestionCard's
  // when() renders absolute UTC today, so nothing is time-relative yet.
  await page.clock.install({ time: new Date('2026-11-21T12:00:00Z') });
  const ready = page.waitForFunction(() => window.fixtureReady === true);
  await page.goto(new URL('/__question', server.resolvedUrls.local[0]).href);
  const firstSignal = await Promise.race([ready, crashed]);
  if (firstSignal instanceof Error) throw firstSignal;
  const card = page.locator('[data-testid=question-card]');
  const shot = async (state, width, dark) => {
    if (!process.env.HADRON_LAYOUT_SHOTS) return;
    await mkdir(process.env.HADRON_LAYOUT_SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(process.env.HADRON_LAYOUT_SHOTS, `question-card-${state}-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  };
  // Overflow is checked per element, not just on the document: the card, every option row and
  // the free-text controls must all keep their content inside their box at both widths.
  const assertNoOverflow = async (label, ctx) => {
    const overflowing = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=question-card]');
      return [c, ...c.querySelectorAll('[data-testid=question-option], #question-text, #question-text-option')]
        .filter((e) => e.scrollWidth > e.clientWidth)
        .map((e) => e.id || e.getAttribute('data-testid') || e.tagName.toLowerCase());
    });
    assert.deepEqual(overflowing, [], `${label}: no element overflows (${ctx})`);
  };

  let lightBodyPaint = '';
  let lightCardPaint = '';
  for (const width of [390, 1280]) for (const dark of [false, true]) {
    const ctx = `${width}px ${dark ? 'dark' : 'light'}`;
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate((d) => { document.documentElement.classList.toggle('dark', d); }, dark);
    // Both schemes must actually paint differently — the harness body AND the card's own dark
    // variants — or every dark assertion below is the light one again and the dark shots are
    // light in disguise (a broken \`dark:\` class on the card would pass a body-only guard).
    const paint = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const cardPaint = await card.evaluate((e) => getComputedStyle(e).borderColor);
    if (!dark) { lightBodyPaint = paint; lightCardPaint = cardPaint; }
    else {
      assert.notEqual(paint, lightBodyPaint, `the dark scheme paints differently (${ctx})`);
      assert.notEqual(cardPaint, lightCardPaint, `the card's own dark variants paint differently (${ctx})`);
    }

    // Ask 1: the pending shot — state chip says Pending, the decider's forms are offered.
    await page.evaluate(() => window.scenario('pending'));
    await card.waitFor();
    assert.equal((await page.locator('[data-testid=question-state]').textContent()).trim(), 'Pending', `state chip (${ctx})`);
    assert.equal(await page.getByRole('region', { name: 'Question SCHEDULE-7' }).count(), 1, `the card is a named region (${ctx})`);
    assert.equal(await card.locator('[data-testid=question-option] button:not([disabled])').count(), 3, `three answer buttons offered (${ctx})`);
    assert.ok(await card.getByText('Recommended').first().isVisible(), `recommendation chip (${ctx})`);
    assert.equal(await card.getByText('Authorizes work').count(), 0, `no authorizes badge without authorizes (${ctx})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow (${ctx})`);
    await assertNoOverflow('pending', ctx);
    await shot('pending', width, dark);

    // Ask 1: the answered shot — Decided, the viewer's own answer marked, undo offered.
    await page.evaluate(() => window.scenario('answered'));
    assert.equal((await page.locator('[data-testid=question-state]').textContent()).trim(), 'Decided', `state chip (${ctx})`);
    assert.ok((await card.locator('[data-testid=question-option][data-key=A]').textContent()).includes('Your answer'), `own answer marked (${ctx})`);
    assert.equal(await card.locator('[data-testid=question-undo-form]').count(), 1, `undo offered to the decider (${ctx})`);
    assert.ok((await card.locator('[data-testid=question-earlier]').textContent()).includes('Earlier entries (2)'), `earlier entries listed (${ctx})`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `document overflow answered (${ctx})`);
    await assertNoOverflow('answered', ctx);
    await shot('answered', width, dark);
  }

  // Ask 2: while impersonating, the card offers no decider or asker act at all — no answer form,
  // no Undo, no Withdraw — and says why in general terms (hrn:node:hadronmemory.com:specs:cor:dmo:140:05:
  // nothing is ever done as a decider under impersonation; Withdraw follows the asker or a
  // decider, so an impersonated one of either kind loses it too).
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
  // Control: the same viewer, a decider, not impersonating — Undo (a decider act) and Withdraw
  // (an asker-OR-decider act, per the withdrawQuestion schema; the viewer here is a decider,
  // which is intended) are both offered again.
  await page.evaluate(() => window.scenario('answered'));
  assert.equal(await card.locator('[data-testid=question-undo-form]').count(), 1, 'control: the same decider not impersonating is offered Undo');
  assert.equal(await card.locator('[data-testid=question-withdraw]').count(), 1, 'control: the same decider not impersonating is offered Withdraw (asker or decider)');

  // Ask 2: the "Authorizes work" badge.
  await page.evaluate(() => window.scenario('authorizes'));
  const badge = card.getByText('Authorizes work');
  await badge.waitFor();
  assert.ok(await badge.isVisible(), 'authorizes: the badge shows');
  await page.evaluate(() => window.scenario('pending'));
  assert.equal(await card.getByText('Authorizes work').count(), 0, 'control: no badge without authorizes');

  // Ask 2: the typed refusal texts — announced IN PLACE by the same elements. The card has been
  // mounted once since the start; the alert and status regions are captured as ELEMENTS while
  // the card is result-free, then the refusal results are swapped in and the SAME elements must
  // carry the new text (hrn:node:hadronmemory.com:specs:cor:dmo:140:09: a refusal is typed, and
  // the portal's words are its own — the exact prose is the pin).
  // A live region that has gone missing entirely fails HERE, by name, fast — not as an
  // anonymous 30 s walk-timeout somewhere later in the run.
  const regionEl = async (role, name) => {
    const handle = await page.getByRole(role).elementHandle({ timeout: 5000 }).catch(() => null);
    assert.ok(handle, `the ${name} live region is mounted before any refusal is driven`);
    return handle;
  };
  const alertEl = await regionEl('alert', 'assertive (role=alert)');
  const statusEl = await regionEl('status', 'polite (role=status)');
  assert.equal(await alertEl.evaluate((e) => e.textContent.trim()), '', 'before the refusal: the alert region is empty');
  await page.evaluate(() => window.scenario('conflict'));
  assert.equal(await alertEl.evaluate((e) => e.textContent.trim()), 'This question changed since you opened it. It has been reloaded: check it and answer again.', 'stale revision: the SAME alert element announces the mapped text');
  assert.equal(await statusEl.evaluate((e) => e.textContent.trim()), '', 'stale revision: the same status region stays empty');
  assert.ok(await (await page.getByRole('alert').elementHandle()).evaluate((a, b) => a === b, alertEl), 'the alert element survived the result change');
  await page.evaluate(() => window.scenario('forbidden'));
  assert.equal(await alertEl.evaluate((e) => e.textContent.trim()), 'You cannot do that on this question.', 'forbidden: the same alert element announces the mapped text');
  assert.equal(await statusEl.evaluate((e) => e.textContent.trim()), '', 'forbidden: the same status region stays empty');
  await page.evaluate(() => window.scenario('pending'));
  assert.equal(await alertEl.evaluate((e) => e.textContent.trim()), '', 'control: no refusal, no alert text');

  // Ask 3: a success announces in the polite region — the same element, after the change; the
  // alert stays quiet.
  await page.evaluate(() => window.scenario('success'));
  assert.equal(await statusEl.evaluate((e) => e.textContent.trim()), 'Answered A', 'success: the SAME status element announces the message');
  assert.equal(await alertEl.evaluate((e) => e.textContent.trim()), '', 'success: the alert region stays empty');
  assert.ok(await (await page.getByRole('status').elementHandle()).evaluate((a, b) => a === b, statusEl), 'the status element survived the result change');

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

  // The reload flag, driven through the card's own code this time: the $app/forms stand-in
  // RECORDS the guarded() enhance callback each form registers; beginEnhanced runs it the way
  // kit would on submit and hands its result handler the ActionResult the server answered.
  // The failure data comes from the REAL mapping (window.failurePayload composes
  // questionRefusal + refusalNeedsReload, exactly what refuse() in src/lib/server/questions.ts
  // answers) — a changed reload mapping moves these payloads with it rather than leaving a
  // hand-written `reload: true` behind. Module identity is pinned FIRST: the card reaches the
  // stubs through the $app/* aliases, the test through their /src/lib URLs; one module each,
  // or the recorded calls and the read-back array would be different objects. Each direction
  // is then asserted on its OWN read of a CLEARED navigationCalls — a total count over both
  // handlers could not tell an inverted rule (reload fired on the forbidden shape instead of
  // the stale one) from the real one. The alert PROSE is pinned above; this pins the re-read
  // behaviour the flag exists for, in both directions.
  await page.evaluate(() => window.scenario('pending'));
  await page.evaluate(() => window.assertModuleIdentity());
  await page.evaluate(async () => {
    const { resetNavigationCalls } = await import('/src/lib/test/stubs/app-navigation.ts');
    const { beginEnhanced } = await import('/src/lib/test/stubs/app-forms.ts');
    resetNavigationCalls();
    const conflict = await beginEnhanced(document.querySelector('[data-testid=question-option][data-key=A] form'));
    await conflict({ type: 'failure', status: 409, data: window.failurePayload('NODE_WRITE_CONFLICT') });
  });
  let navCalls = await page.evaluate(async () => (await import('/src/lib/test/stubs/app-navigation.ts')).navigationCalls.map((c) => c.fn));
  assert.deepEqual(navCalls, ['invalidateAll'], 'a reload-flagged failure (NODE_WRITE_CONFLICT) invalidates exactly once');
  await page.evaluate(async () => {
    const { beginEnhanced } = await import('/src/lib/test/stubs/app-forms.ts');
    const forbidden = await beginEnhanced(document.querySelector('[data-testid=question-option][data-key=B] form'));
    await forbidden({ type: 'failure', status: 403, data: window.failurePayload('QUESTION_FORBIDDEN') });
  });
  navCalls = await page.evaluate(async () => (await import('/src/lib/test/stubs/app-navigation.ts')).navigationCalls.map((c) => c.fn));
  assert.deepEqual(navCalls, ['invalidateAll'], 'a failure without the flag (QUESTION_FORBIDDEN) adds no invalidateAll — the cleared array is unchanged');

  // Ask 3: the keyboard and screen-reader pass. Focus the sentinel BEFORE the card first (a
  // programmatic .focus() target; document.body.focus() is a no-op — body is not focusable
  // without a tabindex — and would not reset Chromium's sequential-focus starting point),
  // then walk the card's Tab stops — one identifier kind: the option's key, or the control's
  // id, or the nearest testid — to the card's end, the Withdraw summary.
  await page.evaluate(() => window.scenario('pending'));
  await page.locator('#before-card').focus();
  const focusStop = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return '';
    const option = el.closest('[data-testid=question-option]');
    if (option) return option.dataset.key ?? '';
    if (el.id) return el.id;
    return el.closest('[data-testid]')?.dataset.testid ?? el.tagName.toLowerCase();
  });
  const order = [];
  for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); order.push(await focusStop()); }
  assert.deepEqual(order, ['A', 'B', 'C', 'question-text', 'question-text-option', 'question-text-form', 'question-withdraw'], `Tab order across the card to the Withdraw summary: ${JSON.stringify(order)}`);
  // The ANSWER path ends at the Withdraw summary; the card's tail (the Urn copy controls in
  // the refs section) follows. The walk's end condition is focus LEAVING the card — landing
  // on the after-card sentinel, the first tabbable after it — which proves the 7 stops above
  // were the card's whole answer path, not a walk that simply stopped asserting.
  let left = false;
  for (let i = 0; i < 6 && !left; i++) {
    await page.keyboard.press('Tab');
    left = await page.evaluate(() => !(document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-testid=question-card]')));
  }
  assert.ok(left, 'Tabbing past the Withdraw summary leaves the card within a few stops (refs tail included)');
  assert.equal(await focusStop(), 'after-card', 'the first tabbable outside the card is the after-card sentinel');
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

  assert.deepEqual(errors, [], 'page and console errors');
  console.log('PASS: question card in real Chromium: the eight shots (pending/answered × 390/1280 × light/dark), impersonation hides every decider act, the authorizes badge, both typed refusal texts announced in place by the same live regions, the reload flag driving invalidateAll through guarded() in both directions, another decider\'s answer never says Your answer, the stranger viewer, and the keyboard/screen-reader pass to the Withdraw summary.');
} finally { await browser?.close(); await server.close(); }
