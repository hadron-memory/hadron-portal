// Test tooling only. All remote mutation is fenced to the operator's recorded,
// seeded disposable stack; loopback alone is not proof of a test environment.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);

export async function assertDisposableStack(env, io = {}) {
  const { AI_CONFIG_TEST_PORTAL: portal, AI_CONFIG_TEST_API: api, AI_CONFIG_TEST_STACK: name, AI_CONFIG_TEST_SERVER: server } = env;
  assert(name && /^[a-z][a-z0-9-]{0,31}$/.test(name) && server, 'Name the owned stack and its server checkout');
  const urls = [portal, api].map(value => {
    const url = new URL(value);
    assert(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Explicit loopback HTTP origins only');
    return url;
  });
  const state = join(env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'hadron-e2e', `hadron-e2e-${name}`);
  const read = io.readFile || readFile;
  const ports = await Promise.all(['portal-port', 'api-port'].map(file => read(join(state, file), 'utf8')));
  assert(urls.every((url, i) => url.port === ports[i].trim()) && urls[0].port !== urls[1].port, 'Origins must match the recorded disposable stack ports');
  // stack.sh check checks its recorded backend and exact deterministic seed.
  // Suppress output (which may include operational detail), never log credentials.
  await (io.checkStack || (async () => { try { await exec(resolve(server, 'scripts/e2e/stack.sh'), ['check', name], { timeout: 120_000 }); } catch { throw new Error('Disposable stack seed check failed'); } }))();
  return { portal: urls[0].origin, api: urls[1].origin };
}

async function configs(request, portal, ownerId) {
  const response = await request.get(`${portal}/api/ai-configs?ownerType=ORGANIZATION&ownerId=${encodeURIComponent(ownerId)}`);
  assert(response.ok(), 'Synthetic owner read refused');
  const body = await response.json();
  assert(Array.isArray(body.configs) && !body.failed, 'Synthetic owner read incomplete');
  return body.configs;
}
function sameFixture(row, expected) {
  return row && typeof row.id === 'string' && row.id && ['name', 'ownerId', 'ownerType', 'provider', 'model'].every(key => row[key] === expected[key]);
}
// A create whose outcome the harness cannot see (lost response, a non-200 after
// commit, a body that fails the identity check) may still have committed a row.
// Config names are lower-case canonical and unique per owner (hrn:node:hadronmemory.com:specs:cor:dmo:050:10), so
// when nothing carried the name before, exactly one identity-verified row with it
// afterwards is this run's own. Anything else is left alone and reported.
async function reconcileUncertainCreate(request, portal, expected) {
  const after = (await configs(request, portal, expected.ownerId)).filter(row => row.name === expected.name);
  if (after.length === 0) return undefined;
  assert(after.length === 1 && sameFixture(after[0], expected), 'An uncertain create left a fixture this run cannot prove its own; not deleting it');
  return after[0];
}
async function cleanupOwned(request, portal, expected, owned) {
  const current = (await configs(request, portal, expected.ownerId)).find(row => row.id === owned.id);
  assert(sameFixture(current, expected), 'Refusing cleanup of a changed fixture');
  const response = await request.post(`${portal}/api/ai-configs`, { data: { action: 'delete', id: owned.id } });
  assert(response.ok() && (await response.json()).ok, 'Owned fixture cleanup failed');
  assert(!(await configs(request, portal, expected.ownerId)).some(row => row.id === owned.id), 'Owned fixture remains after cleanup');
  console.log('Owned synthetic fixture cleanup PASS');
}
export async function withSyntheticConfig(request, portal, expected, probe) {
  // sameFixture compares names exactly; the server stores them lower-case, so a
  // mixed-case fixture name would read as an identity mismatch.
  assert(expected.name === expected.name.toLowerCase(), 'Synthetic fixture names must be lower-case (the server stores them canonical)');
  const before = (await configs(request, portal, expected.ownerId)).filter(row => row.name === expected.name);
  let owned, conflicted = false, attempted = false, primary, failed = false;
  try {
    attempted = true;
    const response = await request.post(`${portal}/api/ai-configs`, { data: { action: 'create', ...expected, apiKey: 'synthetic-unused-key' } });
    if (response.status() === 409) {
      conflicted = true;
      const after = (await configs(request, portal, expected.ownerId)).filter(row => row.name === expected.name);
      assert(before.length === 1 && after.length === 1 && sameFixture(before[0], expected) && sameFixture(after[0], expected) && before[0].id === after[0].id, 'Conflict does not prove the intended pre-existing fixture');
      // Borrowed identity verified, but never owned or deleted by this run.
    } else {
      assert.equal(response.status(), 200, 'Synthetic config creation refused');
      const body = await response.json();
      assert(body.ok && sameFixture(body.config, expected), 'Created fixture identity mismatch');
      owned = body.config;
    }
    await probe();
  } catch (error) { failed = true; primary = error; }
  let cleanup, cleanupFailed = false;
  try {
    if (!owned && attempted && !conflicted && before.length === 0) owned = await reconcileUncertainCreate(request, portal, expected);
    if (owned) await cleanupOwned(request, portal, expected, owned);
  } catch (error) { cleanupFailed = true; cleanup = error; }
  // The probe failure is the reason the run failed; a cleanup diagnostic rides
  // beside it rather than replacing it.
  if (failed && cleanupFailed) throw new AggregateError([primary, cleanup], `${primary?.message ?? primary}; cleanup also failed: ${cleanup?.message ?? cleanup}`);
  if (failed) throw primary;
  if (cleanupFailed) throw cleanup;
}

// Used before EACH menu action. Both scroll extremes matter: a reordered sticky
// middle column can be visible at one edge and clipped at the other.
export async function assertActionAtScrollEdges(page, trigger, where, actionsAt = 1) {
  assert.match((await page.locator('th').allTextContents()).at(actionsAt), /Actions/, `${where}: expected column order applied`);
  const scroller = page.getByTestId('data-table-scroller');
  for (const edge of ['left', 'right']) {
    await scroller.evaluate((el, edge) => { el.scrollLeft = edge === 'left' ? 0 : el.scrollWidth; }, edge);
    const [viewport, action] = await Promise.all([scroller.boundingBox(), trigger.boundingBox()]);
    assert(viewport && action && action.x >= viewport.x - 1 && action.x + action.width <= viewport.x + viewport.width + 1, `${where}: Actions inside scroller at ${edge} edge`);
    // #1996: inside the scroller is not the same as reachable. A neighbouring
    // cell's content (a dimmed key preview made a stacking context by
    // `opacity`) can paint over the sticky cell, so ask the browser what is at
    // the trigger's centre. Native hit-testing, no force or dispatched click.
    const hit = await trigger.evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { ok: !!top && (el === top || el.contains(top)), top: top ? `${top.tagName}.${String(top.className).slice(0, 60)}` : null };
    });
    assert(hit.ok, `${where}: Actions trigger receives the pointer at the ${edge} edge (hit ${hit.top})`);
  }
}
