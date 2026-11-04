// portal#1676: the Task integrations section in real Chromium with the compiled app.css and the
// real component. jsdom computes no `pointer-coarse:` height and measures no overflow.
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
// `Urn`'s Copy URN, Copy URL and reveal toggle are shared across 34 sites, so they get their own
// issue. Nothing else may be left out (V2).
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
    return { name: /^Reload/.test(name) ? 'Reload' : name, shared, height: el.getBoundingClientRect().height };
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

  for (const [width, coarse] of [[390, false], [390, true], [1280, false]]) {
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

      // V1: a chip truncates at 390, and the whole URN stays reachable: title plus a named Copy URN.
      if (width === 390 && !coarse) {
        const chips = await page.evaluate(() => [...document.querySelectorAll('[data-task-integrations] span[title]')].map((c) => {
          const copy = c.closest('code')?.parentElement?.querySelector('button[aria-label]');
          return { title: c.title, copyName: copy?.getAttribute('aria-label'), copyTab: copy?.tabIndex };
        }));
        assert.equal(chips.length, 3, `${label}: expected a chip for each lead with a URN, got ${JSON.stringify(chips)}`);
        for (const c of chips) {
          assert.match(c.title, /^hrn:worker:hadronmemory\.com:hadron-dev-team:/, `${label}: chip title is the full URN`);
          assert.ok(c.copyName && c.copyTab === 0, `${label}: chip has no named Copy URN in tab order ${JSON.stringify(c)}`);
        }
      }
      await shot(page, `${label} list`, list.map((c) => `${c.name} ${c.height}`).join(', '));

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
      await shot(page, `${label} form`, form.map((c) => `${c.name} ${c.height}`).join(', '));
      const all = [...list, ...form];

      for (const name of REQUIRED) assert.ok(all.some((c) => c.name === name), `${label}: no ${name} control on the page`);
      const measured = all.filter((c) => !c.shared);
      if (coarse) {
        // V2.
        for (const c of measured) assert.ok(c.height >= TARGET, `${label}: ${c.name} is ${c.height}px, under ${TARGET}px`);
      } else if (width === 1280) {
        // V3.
        for (const c of measured) assert.ok(Math.abs(c.height - FINE_HEIGHTS[c.name]) < 0.5, `${label}: ${c.name} is ${c.height}px, was ${FINE_HEIGHTS[c.name]}px`);
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
      await shot(failed, `${label} roster-failed`, (await controls(failed)).map((c) => `${c.name} ${c.height}`).join(', '));
      await failed.close();
      console.log(`ok ${label}`);
    }
  }
  } finally {
  await browser?.close();
  await server.close();
}
