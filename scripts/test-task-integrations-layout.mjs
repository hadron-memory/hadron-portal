// portal#1676/#1686: the Task integrations section and its shared Urn controls in real
// Chromium with the compiled app.css and the real components. jsdom computes no
// `pointer-coarse:` height and measures no overflow.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:task-integrations-layout
// TI_SHOTS=<dir> also saves each state, captioned with its measured heights, for the PR.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Each control's height at 1280 on a fine pointer, measured on main at 060d8fb9 (V3).
const FINE_HEIGHTS = {
  Edit: 26, 'Add integration': 26, Reload: 20, Name: 38, Provider: 36, 'Repository 1': 38, Remove: 38, 'Add repository': 26,
  'Ready label': 38, 'Excluded label 1': 38, 'Add excluded label': 26, Lead: 36, Label: 42, 'Remove team': 42, 'Add team': 26,
  'Remove integration': 26, Cancel: 26, Save: 24,
};
const TARGET = 44;
// `Urn`'s Copy URN, Copy URL and reveal toggle are shared across the compact sites;
// #1686 puts their 44px coarse targets and narrow keyboard reveal in this browser gate.
const REQUIRED = ['Edit', 'Add integration', 'Add team', 'Remove team', 'Remove integration', 'Cancel', 'Save', 'Reload', 'Lead', 'Label'];

// portal#1151: Vite may re-optimise dependencies on first import and reload the page; start again.
const RELOADED = /Execution context was destroyed|navigation/i;

async function mountSection(page, origin, css, dark, rosterFailed = false) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        document.body.style.color = dark ? '#fafafa' : '#18181b';
      }, { css, dark });
      await page.addStyleTag({ content: '#col { max-width: 640px; margin: 24px 16px; }' });
      await page.evaluate(async (rosterFailed) => {
        const { mountTaskIntegrations } = await import('/src/lib/test/fixtures/task-integrations-layout-harness.ts');
        mountTaskIntegrations(document.getElementById('col'), rosterFailed);
      }, rosterFailed);
      await page.waitForSelector('[data-task-integrations]');
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

/** Every control in the section: its name, its height, and whether it belongs to `Urn`. */
const controls = (page) => page.evaluate(() => {
  const section = document.querySelector('[data-task-integrations]');
  return [...section.querySelectorAll('button, select, input:not([type="hidden"])')].map((el) => {
    const label = el.id ? section.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent.trim() : null;
    const aria = el.getAttribute('aria-label');
    const words = el.tagName === 'BUTTON' ? el.textContent.trim() : '';
    const shared = el.hasAttribute('aria-expanded') || /^Copy UR[NL]/.test(aria ?? '');
    const name = label || words || aria || el.tagName.toLowerCase();
    return { name: /^Reload/.test(name) ? 'Reload' : name, shared, height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width };
  });
});
const overflow = (page) => page.evaluate(() => {
  const s = document.querySelector('[data-task-integrations]');
  return { section: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

async function shot(page, label, heights) {
  if (!process.env.TI_SHOTS) return;
  await page.evaluate((text) => {
    let p = document.getElementById('heights');
    if (!p) { p = document.createElement('pre'); p.id = 'heights'; p.style.cssText = 'font: 11px monospace; white-space: pre-wrap; margin: 8px 16px;'; document.body.prepend(p); }
    p.textContent = text;
  }, `${label}\n${heights}`);
  await page.screenshot({ path: `${process.env.TI_SHOTS}/${label.replaceAll(' ', '-')}.png`, fullPage: true });
}

// `$app/forms` needs a running Kit client to read an action's answer, so the save goes through the
// same stub the client lane uses: the section still handles the refusal itself.
const stubForms = {
  name: 'task-integrations-stub-forms',
  enforce: 'pre',
  transform: (code, id) => (id.endsWith('/TaskIntegrations.svelte') ? code.replace(`from '$app/forms'`, `from '$lib/test/stubs/app-forms'`) : null),
};

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [stubForms] });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  for (const [width, coarse] of [[390, false], [390, true], [1280, false], [1280, true]]) {
    for (const scheme of ['light', 'dark']) {
      const label = `${width} ${coarse ? 'coarse' : 'fine'} ${scheme}`;
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await mountSection(page, origin, css, scheme === 'dark');
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), coarse, `${label}: pointer emulation`);

      const noOverflow = async (state) => {
        const o = await overflow(page);
        assert.ok(o.section <= 0 && o.page <= 0, `${label} ${state}: overflows ${JSON.stringify(o)}`);
      };
      await noOverflow('list');
      const list = await controls(page);

      // #1686 V1: below sm a keyboard user can reveal and read the whole URN.
      // The fixture must really truncate first, and Copy URN stays in tab order.
      if (width === 390 && !coarse) {
        const chips = await page.evaluate(() => [...document.querySelectorAll('[data-task-integrations] span[title]')].map((c) => {
          const root = c.closest('code,button');
          const copy = root?.parentElement?.querySelector('button[aria-label="Copy URN"]');
          return {
            title: c.title,
            copyName: copy?.getAttribute('aria-label'),
            copyTab: copy?.tabIndex,
            reveal: root?.hasAttribute('aria-expanded'),
            truncated: c.scrollWidth > c.clientWidth + 1,
          };
        }));
        assert.equal(chips.length, 3, `${label}: expected a chip for each lead with a URN, got ${JSON.stringify(chips)}`);
        for (const c of chips) {
          assert.match(c.title, /^hrn:worker:hadronmemory\.com:hadron-dev-team:/, `${label}: chip title is the full URN`);
          assert.ok(c.copyName && c.copyTab === 0, `${label}: chip has no named Copy URN in tab order ${JSON.stringify(c)}`);
          assert.equal(c.reveal, true, `${label}: narrow fine-pointer chip is not a reveal toggle ${JSON.stringify(c)}`);
          assert.equal(c.truncated, true, `${label}: fixture must start truncated ${JSON.stringify(c)}`);
        }
        const first = page.locator('[data-task-integrations] button[aria-expanded]').first();
        await first.focus();
        assert.equal(await first.evaluate((el) => document.activeElement === el), true, `${label}: reveal did not receive keyboard focus`);
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-task-integrations] button[aria-expanded="true"]');
        const open = await first.locator('span[title]').evaluate((el) => ({ text: el.textContent, title: el.title, truncated: el.scrollWidth > el.clientWidth + 1 }));
        assert.equal(open.text, open.title, `${label}: keyboard reveal does not show the full URN ${JSON.stringify(open)}`);
        assert.equal(open.truncated, false, `${label}: keyboard reveal is still truncated`);
        await noOverflow('keyboard reveal');
        await page.keyboard.press('Space');
        await page.waitForSelector('[data-task-integrations] button[aria-expanded="false"]');
      }
      if (coarse) {
        const shared = list.filter((c) => c.shared);
        assert.ok(shared.length > 0, `${label}: no shared Urn controls measured`);
        for (const c of shared) {
          assert.ok(c.height >= TARGET && c.width >= TARGET, `${label}: shared ${c.name} is ${c.height}x${c.width}px, under ${TARGET}px`);
        }
        const first = page.locator('[data-task-integrations] button[aria-expanded]').first();
        await first.click();
        await page.waitForSelector('[data-task-integrations] button[aria-expanded="true"]');
        await noOverflow('coarse reveal');
        await first.click();
        await page.waitForSelector('[data-task-integrations] button[aria-expanded="false"]');
      }
      await page.click('button:has-text("Edit")');
      await page.waitForSelector('button[type="submit"]');
      await noOverflow('form');
      // A null lead refuses locally, so it never reaches the save that answers with Reload.
      await page.click('[data-team="3"] button:has-text("Remove team")');
      await page.evaluate(async () => {
        const { refuseWithConflict } = await import('/src/lib/test/fixtures/task-integrations-layout-harness.ts');
        await refuseWithConflict(document.querySelector('[data-task-integrations] form'));
      });
      await page.waitForSelector('button:has-text("Reload")');
      await noOverflow('conflict');
      const form = await controls(page);
      const all = [...list, ...form];

      for (const name of REQUIRED) assert.ok(all.some((c) => c.name === name), `${label}: no ${name} control on the page`);
      if (coarse) {
        // #1676 V2 plus #1686: the shared Urn controls are in scope too.
        for (const c of all) assert.ok(c.height >= TARGET, `${label}: ${c.name} is ${c.height}px, under ${TARGET}px`);
      } else if (width === 1280) {
        // V3: section controls and the shared 10px copy icons stay exactly as dense as main.
        const measured = all.filter((c) => !c.shared);
        for (const c of measured) assert.ok(Math.abs(c.height - FINE_HEIGHTS[c.name]) < 0.5, `${label}: ${c.name} is ${c.height}px, was ${FINE_HEIGHTS[c.name]}px`);
        for (const c of all.filter((c) => c.shared)) {
          assert.ok(Math.abs(c.height - 10) < 0.5 && Math.abs(c.width - 10) < 0.5, `${label}: fine shared ${c.name} moved to ${c.height}x${c.width}px`);
        }
      }

      // V4: the Cancel/Save row wraps. A column this narrow is what long labels or 200% text do to
      // it; at 390 with these English labels the row happens to fit either way.
      if (width === 390) {
        await page.addStyleTag({ content: '#col { max-width: 200px; }' });
        const row = await page.evaluate(() => {
          const r = document.querySelector('button[type="submit"]').parentElement;
          return { over: r.scrollWidth - r.clientWidth, save: document.querySelector('button[type="submit"]').getBoundingClientRect().right, right: r.getBoundingClientRect().right };
        });
        assert.ok(row.over <= 0 && row.save <= row.right + 0.5, `${label}: the Cancel/Save row overflows when narrow ${JSON.stringify(row)}`);
      }
      await page.close();

      // The failed-roster list: chips and no overflow for every state.
      const failed = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
      await failed.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await mountSection(failed, origin, css, scheme === 'dark', true);
      const o = await overflow(failed);
      assert.ok(o.section <= 0 && o.page <= 0, `${label} failed roster: overflows ${JSON.stringify(o)}`);
      await failed.close();
      console.log(`ok ${label}`);
    }
  }

  // Screenshots are evidence, not test input. Capture them on fresh pages after
  // every assertion: a full-page capture can change Chromium's layout metrics,
  // and a mid-assertion capture once turned a later 44px coarse Reload into 20px.
  if (process.env.TI_SHOTS) {
    for (const [width, coarse] of [[390, false], [390, true], [1280, false], [1280, true]]) {
      for (const scheme of ['light', 'dark']) {
        const label = `${width} ${coarse ? 'coarse' : 'fine'} ${scheme}`;
        const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
        await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
        await mountSection(page, origin, css, scheme === 'dark');
        const caption = async () => (await controls(page)).map((c) => `${c.name} ${c.height}x${c.width}`).join(', ');
        await shot(page, `${label} list`, await caption());
        await page.close();
        if (coarse || width === 390) {
          const revealed = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
          await revealed.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
          await mountSection(revealed, origin, css, scheme === 'dark');
          const first = revealed.locator('[data-task-integrations] button[aria-expanded]').first();
          await first.focus();
          if (coarse) await first.click();
          else await revealed.keyboard.press('Enter');
          await revealed.waitForSelector('[data-task-integrations] button[aria-expanded="true"]');
          await shot(revealed, `${label} ${coarse ? 'touch' : 'keyboard'}-reveal`, (await controls(revealed)).map((c) => `${c.name} ${c.height}x${c.width}`).join(', '));
          await revealed.close();
        }

        // A capture may change pointer/layout metrics. Every subsequent state
        // gets a fresh page; nothing interactive follows a screenshot on its page.
        const form = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
        await form.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
        await mountSection(form, origin, css, scheme === 'dark');
        await form.click('button:has-text("Edit")');
        await form.waitForSelector('button[type="submit"]');
        await form.click('[data-team="3"] button:has-text("Remove team")');
        await form.evaluate(async () => {
          const { refuseWithConflict } = await import('/src/lib/test/fixtures/task-integrations-layout-harness.ts');
          await refuseWithConflict(document.querySelector('[data-task-integrations] form'));
        });
        await form.waitForSelector('button:has-text("Reload")');
        await shot(form, `${label} form`, (await controls(form)).map((c) => `${c.name} ${c.height}x${c.width}`).join(', '));
        await form.close();

        const failed = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
        await failed.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
        await mountSection(failed, origin, css, scheme === 'dark', true);
        await shot(failed, `${label} roster-failed`, (await controls(failed)).map((c) => `${c.name} ${c.height}x${c.width}`).join(', '));
        await failed.close();
      }
    }
  }
  } finally {
  await browser?.close();
  await server.close();
}
