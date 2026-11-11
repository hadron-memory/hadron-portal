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
export async function withSyntheticConfig(request, portal, expected, probe) {
  const before = (await configs(request, portal, expected.ownerId)).filter(row => row.name === expected.name);
  let owned;
  try {
    const response = await request.post(`${portal}/api/ai-configs`, { data: { action: 'create', ...expected, apiKey: 'synthetic-unused-key' } });
    if (response.status() === 409) {
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
  } finally {
    if (owned) {
      const current = (await configs(request, portal, expected.ownerId)).find(row => row.id === owned.id);
      assert(sameFixture(current, expected), 'Refusing cleanup of a changed fixture');
      const response = await request.post(`${portal}/api/ai-configs`, { data: { action: 'delete', id: owned.id } });
      assert(response.ok() && (await response.json()).ok, 'Owned fixture cleanup failed');
      assert(!(await configs(request, portal, expected.ownerId)).some(row => row.id === owned.id), 'Owned fixture remains after cleanup');
      console.log('Owned synthetic fixture cleanup PASS');
    }
  }
}

// Used before EACH menu action. Both scroll extremes matter: a reordered sticky
// middle column can be visible at one edge and clipped at the other.
export async function assertActionAtScrollEdges(page, trigger, where) {
  assert.match((await page.locator('th').allTextContents())[1], /Actions/, `${where}: saved order applied`);
  const scroller = page.getByTestId('data-table-scroller');
  for (const edge of ['left', 'right']) {
    await scroller.evaluate((el, edge) => { el.scrollLeft = edge === 'left' ? 0 : el.scrollWidth; }, edge);
    const [viewport, action] = await Promise.all([scroller.boundingBox(), trigger.boundingBox()]);
    assert(viewport && action && action.x >= viewport.x - 1 && action.x + action.width <= viewport.x + viewport.width + 1, `${where}: Actions inside scroller at ${edge} edge`);
  }
}
