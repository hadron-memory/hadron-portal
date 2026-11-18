// #226: real portal actions + mounted local MCP, isolated synthetic credentials.
// No traces, screenshots, HTTP payload dumps, raw-token diagnostics or retries.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { chromium } from 'playwright';

const portal = fileURLToPath(new URL('../', import.meta.url));
const serverRoot = process.env.HADRON_E2E_SERVER_DIR;
assert.ok(serverRoot, 'Set HADRON_E2E_SERVER_DIR to the pinned server checkout');
assert.equal(await access(resolve(serverRoot, '.env')).then(() => true, () => false), false, 'Use a fixture checkout without .env');
const source = (await readFile(new URL('../tests/e2e/server-revision.txt', import.meta.url), 'utf8')).trim();
const database = new URL(process.env.HADRON_E2E_DATABASE_URL ?? 'postgresql://holger@127.0.0.1:5432/postgres');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname), 'Only loopback fixture Postgres is allowed');
const requireServer = createRequire(resolve(serverRoot, 'package.json'));
const { Client } = requireServer('pg');
const admin = new Client({ connectionString: database.href });
const name = `portal_keys_${randomBytes(10).toString('hex')}`;
const privateUrl = new URL(database); privateUrl.pathname = `/${name}`;
const scratch = await mkdtemp(resolve(tmpdir(), 'portal-keys-'));
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test',
  DATABASE_URL: privateUrl.href, DB_PROVIDER: 'postgresql',
  JWT_SECRET: randomBytes(48).toString('hex'), HADRON_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  GRAPHS_PATH: resolve(scratch, 'graphs'), HADRON_E2E_SERVER_DIR: serverRoot,
  EMBEDDING_API_URL: '', NATS_URL: '', RESEND_API_KEY: '', FRONTEND_URL: '',
  // The server refuses readiness without a rate-limit keyring (hadron-server src/lib/rateLimit/config.ts); a random one per run.
  RATE_LIMIT_KEYRING: JSON.stringify({ current: 'e2e', keys: { e2e: randomBytes(32).toString('hex') } }),
};
let fixture, portalServer, browser, context, page, created = false, stage = 'setup';
const savedConsole = Object.fromEntries(['log','info','warn','error','debug'].map(k=>[k,console[k]]));

const commandChildren = new Set();
function command(args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: serverRoot, env, stdio: 'ignore' });
    commandChildren.add(child);
    child.once('exit', () => commandChildren.delete(child));
    child.on('error', () => reject(new Error('Fixture command failed')));
    child.on('exit', (code) => code === 0 ? done() : reject(new Error('Fixture command failed')));
  });
}
let cleaning;
async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    await page?.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (portalServer) await new Promise((done) => portalServer.close(done));
    if (fixture?.connected) {
      fixture.send('cleanup');
      await Promise.race([once(fixture, 'exit'), new Promise((r) => setTimeout(r, 3000))]);
    }
    fixture?.kill('SIGKILL');
    // Do not leave a schema-push subprocess reconnecting after a timeout.
    for (const child of commandChildren) child.kill('SIGKILL');
    if (created) {
      try { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
      catch { process.stderr.write('Owned fixture database cleanup failed\n'); process.exitCode = 1; }
    }
    await admin.end().catch(() => {});
    await rm(scratch, { recursive: true, force: true });
    Object.assign(console, savedConsole);
  })();
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await cleanup(); process.exit(1);
});
const deadline = setTimeout(async () => {
  process.stderr.write('API-key synthetic chain deadline exceeded\n');
  await cleanup(); process.exit(1);
}, 180_000);
deadline.unref();
async function rpc(origin, token, method, params, session) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.text();
  let message;
  try { message = JSON.parse(body); } catch {
    const event = body.split('\n').find((line) => line.startsWith('data: '));
    if (event) message = JSON.parse(event.slice(6));
  }
  return { status: response.status, message, session: response.headers.get('mcp-session-id') };
}
const init = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'portal-synthetic-key-chain', version: '1' } };
try {
  // Enforce source provenance, never silently use an unrelated server build.
  const revision = spawn('git', ['rev-parse', 'HEAD'], { cwd: serverRoot, stdio: ['ignore', 'pipe', 'ignore'] });
  let actual = ''; revision.stdout.on('data', (chunk) => { actual += chunk; });
  await once(revision, 'exit'); assert.equal(actual.trim(), source, 'Wrong server source revision');
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  await command(['node_modules/prisma/build/index.js', 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate']);
  fixture = fork(resolve(portal, 'tests/e2e/server-fixture.mjs'), [], {
    cwd: serverRoot, env, execArgv: ['--import', resolve(serverRoot, 'node_modules/tsx/dist/loader.mjs')],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const ready = await Promise.race([
    once(fixture, 'message').then(([message]) => message),
    new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Fixture timeout')), 120_000); t.unref(); }),
    once(fixture, 'exit').then(() => { throw new Error('Fixture exited'); }),
  ]);
  assert.ok(ready.origin && ready.token && !ready.error, 'Fixture did not start');
  process.env.LOCAL_SERVER_URL = ready.origin;
  // Product error logs may contain GraphQL request headers. Do not emit them.
  for (const key of Object.keys(savedConsole)) console[key] = () => {};
  // Bind first so ORIGIN is exact before adapter-node snapshots its config.
  // Without it adapter-node defaults to https and rejects our HTTP form Origin.
  let portalHandler;
  portalServer = createHttpServer((req, res) => portalHandler(req, res));
  await new Promise((done) => portalServer.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${portalServer.address().port}/`;
  process.env.ORIGIN = origin.slice(0, -1);
  ({ handler: portalHandler } = await import(pathToFileURL(resolve(portal, 'build/handler.js')).href));
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addCookies([{ name: 'hadron_token', value: ready.token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  page = await context.newPage();
  page.setDefaultTimeout(60_000);
  stage = 'authenticated page navigation';
  await page.goto(`${origin}app/account/api-keys`);
  assert.equal(new URL(page.url()).pathname, '/app/account/api-keys', 'Fixture session did not reach account page');
  stage = 'authenticated page hydration';
  await page.waitForLoadState('networkidle');
  stage = 'mint form readiness';
  await page.locator('form[action="?/create"] input[name="label"]').fill('synthetic-key-chain');
  stage = 'mint and reveal';
  await page.locator('form[action="?/create"] button[type="submit"]').click();
  stage = 'raw reveal visibility';
  const reveal = page.getByTestId('raw-key-reveal'); await reveal.waitFor();
  stage = 'raw reveal format';
  // Secret values stay only in memory. Assertions never compare/dump the values.
  const raw = await reveal.locator('code').textContent();
  assert.ok(raw?.startsWith('hdr_user_'), 'Raw reveal missing');
  stage = 'copy raw reveal';
  await page.waitForLoadState('networkidle');
  await page.getByTestId('raw-key-copy').click();
  await page.getByTestId('raw-key-copy').filter({hasText:'Copied'}).waitFor({ timeout: 10_000 });
  assert.ok(await page.evaluate((value) => navigator.clipboard.readText().then((v) => v === value), raw), 'Copy did not use raw reveal');
  stage = 'authenticated MCP operation';
  const initialized = await rpc(ready.origin, raw, 'initialize', init);
  assert.equal(initialized.status, 200, 'Minted credential initialize failed');
  assert.ok(initialized.message?.result && !initialized.message.error, 'MCP initialize did not succeed');
  const operation = await rpc(ready.origin, raw, 'tools/call', { name: 'hadron_whoami', arguments: {} }, initialized.session);
  assert.equal(operation.status, 200, 'Authenticated MCP operation failed');
  assert.ok(operation.message?.result?.content?.length && !operation.message.result.isError, 'MCP tool result missing');
  stage = 'revoke modal';
  const row = page.locator('tbody tr').filter({ hasText: 'synthetic-key-chain' });
  await row.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Revoke', exact: true }).click();
  await page.getByTestId('revoke-confirm').waitFor();
  await page.getByTestId('revoke-confirm-yes').click();
  await page.getByTestId('revoke-confirm').waitFor({ state: 'hidden' });
  stage = 'fresh revoked request';
  const revoked = await rpc(ready.origin, raw, 'initialize', init);
  assert.equal(revoked.status, 401, 'Revoked credential was accepted');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((r) => r.textContent.includes('synthetic-key-chain') && r.textContent.includes('Revoked')));

  await page.reload();
  assert.equal(await page.getByTestId('raw-key-reveal').count(), 0, 'Raw reveal persisted across navigation');
  process.stdout.write(`API-key synthetic UI/MCP chain PASS; Chromium ${browser.version()}; server ${source}\n`);
} catch {
  // Do not print framework exceptions: they can contain request headers or DOM secrets.
  process.stderr.write(`API-key synthetic chain FAILED at ${stage}; secret-bearing diagnostics suppressed\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await cleanup();
}
