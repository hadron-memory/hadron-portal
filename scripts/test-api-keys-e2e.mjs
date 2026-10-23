// #226 (spec 025 T049): browser end-to-end for /app/account/api-keys.
//
// One bounded, local, synthetic chain through the REAL portal (Vite dev server,
// SvelteKit server code, real Chromium): fixture user -> account API keys ->
// mint -> raw-key reveal and copy -> authenticated request to the mounted /mcp
// -> revoke through the confirm dialog -> the same request now answers 401.
//
// What is synthetic: the hadron-server behind the portal. `startStandInServer`
// below speaks only the GraphQL operations this page needs plus a Bearer-gated
// /mcp, in memory. So this proves the portal's browser layer and transport
// (form submit, reveal, copy, confirm modal, DOM after revoke, the revoke
// mutation actually being sent). It does NOT prove the server's revocation
// semantics; hadron-server's 025-credential-parity.test.ts owns those.
//
// No OAuth provider login, tunnel, real server/account/key, or provider spend.
// The raw key stays in memory: no screenshots, traces, videos, or logging of it.
//
// Setup: pnpm exec playwright install chromium
// Run:   pnpm test:api-keys-e2e
//        pnpm test:api-keys-e2e --red-controls   (each mutant must make the chain fail)
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const FIXTURE_USER = { id: 'fixture-user-1', handle: 'e2e-fixture', name: 'E2E Fixture' };
const STEP_TIMEOUT_MS = 15_000;

function fixtureJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  // The portal only decodes the payload to route (hooks.server.ts); the stand-in
  // server below is the one that accepts or refuses this exact token.
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: FIXTURE_USER.id, name: FIXTURE_USER.name, roles: [], exp })}.fixture`;
}

/**
 * In-memory hadron-server stand-in. `ignoreRevoke` is a red-control mutant: the key
 * is marked revoked (so the UI is right) but /mcp keeps honoring it.
 */
function startStandInServer({ jwt, ignoreRevoke = false }) {
  const keys = []; // { row, raw }
  const unknownOps = [];
  const graphqlAuthFailures = [];
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;

    if (req.url === '/mcp') {
      const match = keys.find((k) => k.raw === bearer && (ignoreRevoke || !k.row.revokedAt));
      if (!match) return send(res, 401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
      match.row.lastUsedAt = new Date().toISOString();
      return send(res, 200, { jsonrpc: '2.0', id: 1, result: { tools: [] } });
    }

    if (req.url !== '/graphql') return send(res, 404, { error: 'not found' });
    if (bearer !== jwt) {
      graphqlAuthFailures.push(req.url);
      return send(res, 200, { errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] });
    }
    const { query, variables } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    const ok = (data) => send(res, 200, { data });
    switch (op) {
      case 'Me':
        return ok({ me: { ...FIXTURE_USER, urn: `hrn:user:${FIXTURE_USER.handle}`, githubUsername: null, avatarUrl: null, email: null, roles: [] } });
      case 'OrganizationsNav':
        return ok({ organizations: { items: [], total: 0 } });
      case 'MyUserApiKeys':
        return ok({ myUserApiKeys: keys.map((k) => k.row) });
      case 'CreateUserApiKey': {
        const raw = `hdn_e2e_${randomBytes(18).toString('hex')}`;
        const row = {
          id: `key-${keys.length + 1}`,
          keyPreview: raw.slice(-4),
          label: variables?.label ?? null,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          issuedVia: 'portal',
        };
        keys.push({ row, raw });
        return ok({ createUserApiKey: { userApiKey: row, rawKey: raw } });
      }
      case 'RevokeUserApiKey': {
        const k = keys.find((x) => x.row.id === variables?.id);
        if (!k) return send(res, 200, { errors: [{ message: 'Not found', extensions: { code: 'NOT_FOUND' } }] });
        k.row.revokedAt = new Date().toISOString();
        return ok({ revokeUserApiKey: k.row });
      }
      default:
        unknownOps.push(op ?? '(unparsed)');
        return send(res, 200, { errors: [{ message: `stand-in has no operation ${op}`, extensions: { code: 'STAND_IN_UNKNOWN_OP' } }] });
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        keys,
        unknownOps,
        graphqlAuthFailures,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  );
}

const mcp = (origin, key) =>
  fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

/**
 * One full chain. `mutant` breaks exactly one thing so the red controls can show
 * the chain is sensitive to it: 'ui-create' blocks the mint form's request, 'ui-revoke' blocks the
 * revoke form's (a broken UI), 'server-ignores-revoke' makes the server keep honoring a revoked
 * key even though the list says revoked (a broken revocation).
 */
async function runChain({ mutant = null } = {}) {
  let step = 'start';
  const jwt = fixtureJwt();
  const standIn = await startStandInServer({ jwt, ignoreRevoke: mutant === 'server-ignores-revoke' });
  process.env.LOCAL_SERVER_URL = standIn.origin;
  const vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let browser;
  try {
    await vite.listen();
    const portal = vite.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addCookies([{ name: 'hadron_token', value: jwt, url: portal }]);
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    if (mutant === 'ui-create') {
      await page.route('**/account/api-keys?/create', (route) => route.abort());
    }
    if (mutant === 'ui-revoke') {
      await page.route('**/account/api-keys?/revoke', (route) => route.abort());
    }

    step = 'load';
    await page.goto(`${portal}/app/account/api-keys`);
    await page.getByRole('heading', { name: 'Create a new API key' }).waitFor();
    assert.equal(await page.getByTestId('api-key-row').count(), 0, 'fixture user starts with no keys');

    // The broken-UI mutant fails fast once the (cold, slow) first load is done.
    if (mutant === 'ui-create') page.setDefaultTimeout(3_000);

    // Mint -> one-shot reveal.
    step = 'mint-reveal';
    await page.getByLabel('Name', { exact: true }).fill('e2e-chain');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const reveal = page.getByTestId('raw-key-reveal');
    await reveal.waitFor();
    const rawKey = (await reveal.locator('code').first().textContent())?.trim() ?? '';
    assert.match(rawKey, /^hdn_e2e_[0-9a-f]{36}$/, 'the reveal shows the key the server minted');
    assert.equal(standIn.keys.length, 1, 'exactly one key was minted');
    assert.equal(rawKey, standIn.keys[0].raw, 'revealed value is the minted value');

    step = 'copy';
    // Copy puts that same value on the clipboard.
    await page.getByTestId('raw-key-copy').click();
    await page.waitForFunction(async (expected) => (await navigator.clipboard.readText()) === expected, rawKey);

    // The row is active, and the key authenticates against the mounted /mcp.
    const row = page.getByTestId('api-key-row');
    await row.getByTestId('status-active').waitFor();
    assert.equal((await mcp(standIn.origin, rawKey)).status, 200, 'minted key is accepted by /mcp');

    step = 'revoke-ui';
    if (mutant === 'ui-revoke') page.setDefaultTimeout(3_000);
    // Revoke through the row menu and the confirm dialog.
    // The row is server-rendered, so its menu button exists before hydration; a
    // click that lands first opens nothing. Retry the open instead of sleeping.
    const revokeItem = page.getByRole('menuitem', { name: 'Revoke' });
    for (let attempt = 0; ; attempt++) {
      await row.getByRole('button', { name: /^Actions for key/ }).click();
      if (await revokeItem.waitFor({ timeout: 2_000 }).then(() => true, () => false)) break;
      assert.ok(attempt < 4, 'the row actions menu never opened');
    }
    await revokeItem.click();
    const dialog = page.getByTestId('revoke-confirm');
    await dialog.waitFor();
    await dialog.getByTestId('revoke-confirm-yes').click();
    await page.getByTestId('revoke-confirm').waitFor({ state: 'detached' });
    await row.getByTestId('status-revoked').waitFor();
    assert.equal(await row.getByTestId('status-active').count(), 0, 'row no longer shows active');

    step = 'revoked-401';
    // The same credential now fails, on the same transport.
    const after = await mcp(standIn.origin, rawKey);
    assert.equal(after.status, 401, 'revoked key is refused by /mcp');
    assert.match(after.headers.get('www-authenticate') ?? '', /Bearer/, '401 carries the Bearer challenge');

    assert.deepEqual(standIn.unknownOps, [], 'the portal made only operations the stand-in models');
    assert.deepEqual(standIn.graphqlAuthFailures, [], 'every portal GraphQL call carried the fixture token');
  } catch (e) {
    // Name the step, never the message: assertion text can quote a key.
    throw Object.assign(new Error(`chain failed at step ${step}`), { step });
  } finally {
    // Teardown on success and failure: nothing here outlives the process.
    await browser?.close().catch(() => {});
    await vite.close().catch(() => {});
    await standIn.close();
    delete process.env.LOCAL_SERVER_URL;
  }
}

if (process.argv.includes('--red-controls')) {
  // Each mutant must fail at ITS step: a harness fault that fails earlier or
  // elsewhere must not count as the control being red.
  const controls = [
    ['ui-create', 'mint-reveal'],
    ['ui-revoke', 'revoke-ui'],
    ['server-ignores-revoke', 'revoked-401'],
  ];
  await runChain(); // the unmutated chain must be green first
  for (const [mutant, expectedStep] of controls) {
    const err = await runChain({ mutant }).then(() => null, (e) => e);
    assert.ok(err, `red control "${mutant}" must make the chain fail, and it passed`);
    assert.equal(err.step, expectedStep, `red control "${mutant}" failed at ${err.step}, expected ${expectedStep}`);
    console.log(`red control ${mutant}: failed at ${err.step} as required`);
  }
} else {
  await runChain();
  console.log('api-keys e2e: mint -> reveal -> copy -> /mcp 200 -> revoke -> /mcp 401: ok');
}
process.exit(0);
