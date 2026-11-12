import { createServer } from 'vite';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = '/home/orca/scratch/cedar/qa2028-successor';
fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
const startedAt = new Date().toISOString();
const results = { preparationChanges: ['Created the evidence shots directory before browser execution; the prepared script otherwise had no screenshot-directory setup.'], campaign: 'portal PR2028 synthetic signed-in browser', head: 'a5b15bbc23980c193a4328dd48a2e55aec88d6ce', startedAt, identity: { route: '/app/workers/<synthetic-id>?tab=briefing', user: 'synthetic-user', workers: ['qa-worker-a', 'qa-worker-b'] }, runtime: {}, assertions: [], lintGetCounts: {}, screenshots: [], limits: ['Fixtures only: loopback GraphQL responses and synthetic JWT-shaped cookie; no real server/database or credentials.', 'Signature-lint browser GETs were intercepted; all GraphQL loader reads used the loopback fixture.', 'No template mutation/save action was submitted.', 'Screen-reader speech was not tested.', 'Post-save reset was not exercised; parent is running the focused client+SSR suite.'], cleanup: 'pending' };
let server, browser, context, page;
const counts = {};
const lint = { mode: 'failure', pending: null };
const fail = (name, detail) => { results.assertions.push({ name, result: 'FAIL', detail }); throw new Error(`${name}: ${detail}`); };
function check(name, condition, detail = '') { results.assertions.push({ name, result: condition ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) }); if (!condition) throw new Error(`${name}: ${detail || 'assertion false'}`); }
const worker = id => ({ id, appId: null, agentId: null, name: `Synthetic ${id}`, slug: id, urn: `hrn:worker:example.invalid:qa:${id}`, role: 'Synthetic QA worker', memoryId: null, retiredAt: null, heldByUserId: null, heldAt: null, createdAt: '2026-01-01T00:00:00.000Z', agent: null, portalUrl: 'https://portal.example.invalid', appUrn: null, appName: null, ownerName: null, hasLiveSession: false, terminal: null, signature: 'Synthetic signature ', trailer: 'Synthetic trailer ', app: null, reportsToWorkerId: null, reportsToRetired: null, reportsTo: null, teamPlacement: 'NO_TEAM', prompt: '# Synthetic briefing\n\nFixture-only briefing.' });
const fixture = http.createServer(async (req, res) => {
  let body=''; for await (const chunk of req) body += chunk;
  try {
    const payload = JSON.parse(body || '{}');
    const op = String(payload.query || '').match(/\bquery\s+(\w+)/)?.[1] || 'unknown';
    counts[op] = (counts[op] || 0) + 1;
    let data;
    switch (op) {
      case 'Me': data = { me: { id: 'synthetic-user', handle: 'qa-fixture', urn: 'hrn:user:example.invalid:qa-fixture', githubUsername: null, name: 'QA Fixture', avatarUrl: null, email: 'qa@example.invalid', roles: [] } }; break;
      case 'OrganizationsNav': data = { organizations: { items: [], total: 0 } }; break;
      case 'Worker': { const ref = payload.variables?.ref; const id = String(ref).includes('qa-worker-b') ? 'qa-worker-b' : 'qa-worker-a'; data = { worker: worker(id) }; break; }
      case 'WorkerSessions': data = { sessions: [] }; break;
      case 'WorkerWakeSettings': data = { workerWakeSettings: { mentions: false, pausedUntil: null, dormant: false, effectiveCadenceSeconds: null, subscriptions: [] } }; break;
      case 'WorkerBootPointer': data = { worker: { bootPromptRef: null, bootPromptTargetDeleted: false } }; break;
      case 'WorkerServedPrompt': data={worker:{servedPrompt:null}};break;
      case 'AuthenticationStatus': data = { authenticationStatus: 'AUTHENTICATED' }; break;
      default: res.writeHead(501, { 'content-type': 'application/json' }); res.end(JSON.stringify({ errors: [{ message: 'Unknown synthetic fixture operation', extensions: { code: 'FIXTURE_UNKNOWN' } }] })); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data }));
  } catch { res.writeHead(400); res.end(); }
});
const assertionSnapshot = async (label, expectedText) => {
  const region = await page.locator('[data-signature-lint]').elementHandle();
  const paragraph = await region.$('p');
  const initialText = (await paragraph.textContent())?.trim();
  check(`${label}: exact outcome`, initialText === expectedText, `actual=${JSON.stringify(initialText)}`);
  check(`${label}: one persistent live region`, await page.locator('[data-signature-lint]').count() === 1 && await region.getAttribute('aria-live') === 'polite' && await region.getAttribute('aria-atomic') === 'true');
  return { region, paragraph };
};
const retryClick = async () => { await page.getByRole('button', { name: 'Retry', exact: true }).click(); };
async function waitUnavailable(text) { await page.locator('[data-signature-lint] p').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 10000 }); }
async function resetLintController(mode='failure') { lint.mode = mode; lint.pending = null; }

try {
  await new Promise(resolve => { fixture.listen(0, '127.0.0.1', resolve); });
  const fixturePort = fixture.address().port;
  process.env.LOCAL_SERVER_URL = `http://127.0.0.1:${fixturePort}`;
  server = await createServer({ configFile: path.join(root, 'vite.config.ts'), root, server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [root, '/home/orca/orca/workspaces/hadron-portal/gizelle/node_modules'] } } });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  results.runtime = { fixture: 'loopback-only GraphQL fixture', portalOrigin: base, browser: 'Playwright Chromium', viewportCampaign: [1280, 390], head: 'a5b15bbc23980c193a4328dd48a2e55aec88d6ce' };
  browser = await chromium.launch({ headless: true });
  results.runtime.browserVersion=browser.version();
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light', hasTouch: true });
  page = await context.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort('blockedbyclient');
    if (/\/app\/workers\/[^/]+\/signature-lint$/.test(url.pathname) && route.request().method() === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').at(-2));
      counts[`signature-lint:${id}`] = (counts[`signature-lint:${id}`] || 0) + 1;
      const respond = async () => {
        if (lint.mode === 'pending') await new Promise(resolve => lint.pending = resolve);
        const mode = lint.mode;
        if (mode === 'transport') return route.abort('failed');
        if (mode === 'http') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        if (mode === 'null') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workerId: id, page: null }) });
        if (mode === 'zero') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workerId: id, page: { items: [], total: 0, nextCursor: null } }) });
        if (mode === 'warning') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workerId: id, page: { items: [{ kind: 'WORKER_LINK_MISSING', workerField: 'signature' }], total: 1, nextCursor: null } }) });
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      };
      return respond();
    }
    return route.continue();
  });
  const payload = Buffer.from(JSON.stringify({ sub: 'synthetic-user', email: 'qa@example.invalid', name: 'QA Fixture', roles: [], exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  await context.addCookies([{ name: 'hadron_token', value: `synthetic.${payload}.fixture-only`, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${base}/app/workers/qa-worker-a?tab=briefing`, { waitUntil: 'networkidle' });
  check('signed-in actual route rendered', await page.getByRole('heading',{name:'Synthetic qa-worker-a',exact:true}).isVisible(), 'worker heading absent');
  check('actual briefing tab selected', await page.getByRole('tab', { name: 'Boot briefing' }).getAttribute('aria-selected') === 'true');
  check('hydrated signature section mounted', await page.locator('[data-testid="worker-signature"]').count() === 1);
  const initial = await assertionSnapshot('automatic failure', 'Couldn’t check the worker link.');
  check('one-case smoke: actual signed-in Briefing and unavailable lint ready',true);
  console.log('SMOKE PASS; continuing gate cases in this single campaign');
  check('no all-clear on failure', !(await page.locator('[data-signature-lint]').innerText()).includes('No worker-link warnings'));

  for (let n=1; n<=3; n++) {
    await resetLintController(n===1 ? 'transport' : 'http');
    await retryClick();
    const expected = `Couldn’t check the worker link. Retry ${n} failed.`;
    await waitUnavailable(expected);
    const afterRegion = await page.locator('[data-signature-lint]').elementHandle();
    const afterP = await afterRegion.$('p');
    check(`retry ${n}: stable region and paragraph nodes`, await initial.region.evaluate((a,b) => a===b, afterRegion) && await initial.paragraph.evaluate((a,b) => a===b, afterP));
    check(`retry ${n}: retry focus retained`, await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Retry'));
    check(`retry ${n}: exact same live region outcome`, (await afterP.textContent())?.trim() === expected);
    check(`retry ${n}: no all-clear`, !(await page.locator('[data-signature-lint]').innerText()).includes('No worker-link warnings'));
  }
  results.lintGetCounts.afterRepeated = { ...counts };

  await resetLintController('failure'); await retryClick(); await waitUnavailable('Retry 4 failed.');
  await resetLintController('pending');
  const beforePending = counts['signature-lint:qa-worker-a'] || 0;
  await page.getByRole('button', { name: 'Retry', exact: true }).focus();
  await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await page.waitForTimeout(250);
  check('pending retries issue exactly one GET', (counts['signature-lint:qa-worker-a'] || 0) - beforePending === 1);
  check('pending Retry is aria-disabled, not native disabled', await page.getByRole('button', { name: 'Retry', exact: true }).getAttribute('aria-disabled') === 'true' && await page.getByRole('button', { name: 'Retry', exact: true }).evaluate(el=>el.disabled) === false);
  check('pending focus stays on Retry', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Retry'));
  lint.mode = 'failure'; lint.pending?.(); await waitUnavailable('Retry 5 failed.');
  check('released pending failure retains Retry focus', await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Retry'));

  await resetLintController('zero'); await retryClick();
  await page.getByText('No worker-link warnings on the saved values.', { exact: true }).waitFor();
  check('successful zero result replaces unavailable copy', !(await page.locator('[data-signature-lint]').innerText()).includes('Couldn’t check'));
  await expect(page.locator('[data-signature-lint]')).toBeFocused();
  check('successful zero result focuses lint region', await page.locator('[data-signature-lint]').evaluate(el => el === document.activeElement));

  await resetLintController('failure');
  await page.getByRole('tab', {name:'Profile',exact:true}).click();
  await page.getByRole('tab', {name:'Boot briefing',exact:true}).click();
  await waitUnavailable('Couldn’t check the worker link.');
  await resetLintController('warning'); await retryClick();
  await page.locator('[data-signature-lint-field="signature"]').waitFor();
  check('warning appears beside signature field', await page.locator('#workerSignature').evaluate(el => el.parentElement?.contains(document.querySelector('[data-signature-lint-field="signature"]'))));
  check('warning has no zero success copy', !(await page.locator('[data-signature-lint]').innerText()).includes('No worker-link warnings'));
  await expect(page.locator('[data-signature-lint]')).toBeFocused();
  check('warning Retry focuses lint region', await page.locator('[data-signature-lint]').evaluate(el => el === document.activeElement));

  // Leave/remount via actual page tabs; then verify a fresh automatic read resets count.
  await resetLintController('failure');
  await page.getByRole('tab', { name: 'Profile',exact:true }).click();
  await page.getByRole('tab', { name: 'Boot briefing',exact:true }).click();
  await waitUnavailable('Couldn’t check the worker link.');
  check('fresh mount starts unnumbered', (await page.locator('[data-signature-lint] p').innerText()).trim() === 'Couldn’t check the worker link.');
  await retryClick(); await waitUnavailable('Retry 1 failed.');
  check('fresh mount retry sequence resets to one', (await page.locator('[data-signature-lint] p').innerText()).trim() === 'Couldn’t check the worker link. Retry 1 failed.');

  // Actual worker-route navigation A -> B; same SvelteKit page instance can be reused.
  await resetLintController('failure');
  await page.goto(`${base}/app/workers/qa-worker-b?tab=briefing`, { waitUntil: 'networkidle' });
  await waitUnavailable('Couldn’t check the worker link.');
  check('worker B route loaded', await page.getByRole('heading',{name:'Synthetic qa-worker-b',exact:true}).isVisible());
  check('worker change clears retry sequence', (await page.locator('[data-signature-lint] p').innerText()).trim() === 'Couldn’t check the worker link.');
  await retryClick(); await waitUnavailable('Retry 1 failed.');
  check('worker B first retry is numbered one', (await page.locator('[data-signature-lint] p').innerText()).trim() === 'Couldn’t check the worker link. Retry 1 failed.');

  for (const theme of ['light','dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1280,390]) {
      await resetLintController('failure');
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/app/workers/qa-worker-b?tab=briefing`,{waitUntil:'networkidle'});
      await waitUnavailable('Couldn’t check the worker link.');
      await retryClick();await waitUnavailable('Retry 1 failed.');
      await page.evaluate(() => { document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches); });
      await page.locator('[data-signature-lint]').waitFor();
      const metrics = await page.evaluate(() => ({ innerWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, region: document.querySelector('[data-signature-lint]')?.getBoundingClientRect().toJSON(), retry: document.querySelector('[data-signature-lint] button')?.getBoundingClientRect().toJSON() }));
      check(`${theme} ${width}px viewport has no horizontal document overflow`, metrics.scrollWidth <= metrics.innerWidth, JSON.stringify({ innerWidth: metrics.innerWidth, scrollWidth: metrics.scrollWidth }));
      check(`${theme} ${width}px lint region and Retry are reachable`, !!metrics.region && !!metrics.retry && metrics.retry.left >= 0 && metrics.retry.right <= width);
      const file = path.join(out,'shots',`pr2028-${theme}-${width}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
      results.screenshots.push(file);
    }
  }
  results.lintGetCounts.final = { ...counts };
  check('no unexpected GraphQL operations', Object.keys(counts).every(k => k.startsWith('signature-lint:') || ['Me','OrganizationsNav','Worker','WorkerSessions','WorkerWakeSettings','WorkerBootPointer','WorkerServedPrompt'].includes(k)), JSON.stringify(Object.keys(counts)));
  check('zero browser page errors',pageErrors.length===0);
  results.status = 'PASS';
} catch (e) {
  results.status = 'FAIL';
  results.failure = { stage: results.assertions.length ? 'browser assertion/runtime after campaign start' : 'runtime startup', message: String(e?.message || e) };
  console.error('CAMPAIGN_FAILURE', results.failure.stage, results.failure.message);
} finally {
  results.lintGetCounts.final = { ...counts };
  if (context) { try { await context.close(); } catch {} }
  if (browser) { try { await browser.close(); } catch {} }
  if (server) { try { await server.close(); } catch {} }
  if (fixture.listening) { await new Promise(resolve => fixture.close(resolve)); }
  results.cleanup = 'Playwright context/browser, Vite server, and loopback fixture listener closed in finally.';
  results.endedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out,'results.json'), JSON.stringify(results,null,2)+'\n');
}
if (results.status !== 'PASS') process.exitCode = 1;
