// portal#1315 (#1058, #1307): the NodeList search filter, against the real
// table in Chromium. jsdom passed these queries while the shipped filter did
// not, so each of the fourteen displayed-text cases runs here with a positive
// control (the query finds only the comment row) and negative controls
// (`absent-tourmaline` finds nothing; the control row is found by its own name
// and does not contain the query; an empty search restores both rows).
// No hadron-server: synthetic fixtures through Vite, like test-tickers-layout.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:node-list-search
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  const probe = await browser.newPage();
  await probe.goto(new URL('/@vite/client', origin).href);
  const cases = await probe.evaluate(async () => {
    const { NODE_LIST_CASES } = await import('/src/lib/test/fixtures/node-list-harness.ts');
    return NODE_LIST_CASES.map(({ name, query }) => ({ name, query }));
  });
  await probe.close();
  assert.equal(cases.length, 14, 'the case list must stay the fourteen rows of NodeList.comment-search.client.test.ts');

  for (const [index, { name, query }] of cases.entries()) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(new URL('/@vite/client', origin).href);
    await page.evaluate((css) => {
      document.head.innerHTML = '';
      document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
    }, css);
    await page.evaluate(async (index) => {
      const { mountNodeList } = await import('/src/lib/test/fixtures/node-list-harness.ts');
      mountNodeList(document.getElementById('col'), index);
    }, index);
    await page.waitForSelector('tbody tr');

    await page.click('[data-testid="table-header-toggle"]');
    const input = page.locator('input[placeholder="Search nodes..."]');
    await input.waitFor();
    const rows = () => page.$$eval('tbody tr', (trs) => trs.map((r) => r.textContent ?? ''));
    // Waits for the table to reach the expected row count (bounded), then reads
    // the settled rows. Every search below changes the count from the previous
    // state, so a filter that never applies times out as a failed assertion
    // instead of racing a fixed sleep.
    const search = async (text, expected) => {
      await input.fill(text);
      await page
        .waitForFunction((n) => document.querySelectorAll('tbody tr').length === n, expected, { timeout: 5000 })
        .catch(() => {});
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    };
    const label = `${name}`;

    assert.equal((await rows()).length, 2, `${label}: both rows show before searching`);
    if (query.startsWith('hrn:')) assert.ok(await page.$(`tbody [title="${query}"]`), `${label}: the URN is displayed`);
    else assert.ok((await rows())[0].includes(query), `${label}: the row displays "${query}"`);

    await search(query, 1);
    let got = await rows();
    assert.equal(got.length, 1, `${label}: the query finds exactly the comment row (got ${got.length})`);
    assert.ok(got[0].includes('row-saffron') && !got[0].includes('control-obsidian'), `${label}: the match is the comment row`);

    await search('absent-tourmaline', 0);
    assert.equal((await rows()).length, 0, `${label}: an absent query finds nothing`);

    await search('control-obsidian', 1);
    got = await rows();
    assert.equal(got.length, 1, `${label}: the control row is found by its own name`);
    assert.ok(!got[0].includes(query), `${label}: the control row does not contain the query`);

    await search('', 2);
    assert.equal((await rows()).length, 2, `${label}: an empty search restores both rows`);
    console.log(JSON.stringify({ case: name, query, rows: 'pass' }));
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
