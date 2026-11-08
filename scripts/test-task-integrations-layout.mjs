// portal#1676/#1686: the Task integrations section and its shared Urn controls in real
// Chromium with the compiled app.css and the real components. jsdom computes no
// `pointer-coarse:` height and measures no overflow.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:task-integrations-layout
// TI_SHOTS=<dir> also saves each state, captioned with its measured heights, for the PR.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Each control's fine-pointer height, measured on main at 060d8fb9 (V3), except
// Label / Remove team: #1689 intentionally replaces their wrapped 42px row with 38px.
const FINE_HEIGHTS = {
  Edit: 26, 'Add integration': 26, Reload: 20, Name: 38, Provider: 36, 'Repository 1': 38, Remove: 38, 'Add repository': 26,
  'Ready label': 38, 'Excluded label 1': 38, 'Add excluded label': 26, Lead: 36, Label: 38, 'Remove team': 38, 'Add team': 26,
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
    // Only controls inside Urn's own subtree are shared. Accessible names may be
    // localized or customized; an arbitrary section control is never exempt.
    const urnRoot = el.closest('span.inline-flex.min-w-0.max-w-full.items-center.gap-1');
    const shared = urnRoot !== null;
    const name = label || words || aria || el.tagName.toLowerCase();
    return { name: /^Reload/.test(name) ? 'Reload' : name, shared, reveal: el.hasAttribute('aria-expanded'), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width };
  });
});
const overflow = (page) => page.evaluate(() => {
  const s = document.querySelector('[data-task-integrations]');
  return { section: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('[data-task-integrations] span[title]')].map((c) => {
  const root = c.closest('code,button');
  const copy = [...(root?.parentElement?.querySelectorAll('button') ?? [])].find((button) => /^Copy(?: .+)? URN$/.test(button.getAttribute('aria-label') ?? ''));
  const copyStyle = copy ? getComputedStyle(copy) : null;
  return {
    title: c.title,
    copyName: copy?.getAttribute('aria-label'),
    copyTab: copy?.tabIndex,
    copyEnabled: copy ? !copy.disabled && copy.getAttribute('aria-disabled') !== 'true' : false,
    copyVisible: copy ? copyStyle.display !== 'none' && copyStyle.visibility !== 'hidden' && copy.getBoundingClientRect().width > 0 && copy.getBoundingClientRect().height > 0 : false,
    reveal: root?.hasAttribute('aria-expanded'),
    truncated: c.scrollWidth > c.clientWidth + 1,
  };
}));
async function assertChipUrns(page, label, measured) {
  const expected = await page.evaluate(async () => Object.values((await import('/src/lib/test/fixtures/task-integrations-layout-harness.ts')).URNS).sort());
  const actual = [...new Set(measured.map((c) => c.title))].sort();
  assert.deepEqual(actual, expected, `${label}: chips do not carry the exact distinct fixture URNs ${JSON.stringify(measured)}`);
  assert.equal(measured.length, expected.length, `${label}: expected a chip for each lead with a URN, got ${JSON.stringify(measured)}`);
  for (const c of measured) {
    assert.ok(c.copyName && /^Copy(?: .+)? URN$/.test(c.copyName) && c.copyTab === 0 && c.copyEnabled && c.copyVisible, `${label}: chip has no visible, enabled Copy URN in tab order ${JSON.stringify(c)}`);
  }
}
const fineHeightTable = (measured) => JSON.stringify(Object.fromEntries(measured.map((c) => [c.name, c.height])), null, 2);
const MIN_LABEL_INPUT_WIDTH = 128;
async function waitForExpanded(page, handle, expected) {
  assert.ok(handle, 'the activated URN reveal toggle is no longer in the document');
  await page.waitForFunction(({ el, value }) => el.isConnected && el.getAttribute('aria-expanded') === value, { el: handle, value: String(expected) });
}
async function teamLabelShape(page, team = 3) {
  const removeTeam = page.locator(`[data-team="${team}"] button:has-text("Remove team")`);
  return removeTeam.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const row = el.parentElement;
    const input = row.querySelector('input');
    if (!input) throw new Error('Remove team row has no Label input');
    const inputRect = input.getBoundingClientRect();
    const buttonRect = el.getBoundingClientRect();
    return {
      lines: [...range.getClientRects()].length,
      inputWidth: inputRect.width,
      wrapped: buttonRect.top >= inputRect.bottom - 0.5,
      rowOver: row.scrollWidth - row.clientWidth,
    };
  });
}

async function shot(page, label, heights) {
  if (!process.env.TI_SHOTS) return;
  await page.evaluate((text) => {
    let p = document.getElementById('heights');
    if (!p) { p = document.createElement('pre'); p.id = 'heights'; p.style.cssText = 'font: 11px monospace; white-space: pre-wrap; margin: 8px 16px;'; document.body.prepend(p); }
    p.textContent = text;
  }, `${label}\n${heights}`);
  const path = `${process.env.TI_SHOTS}/${label.replaceAll(' ', '-')}.png`;
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
}

// `$app/forms` needs a running Kit client to read an action's answer, so the save goes through the
// same stub the client lane uses: the section still handles the refusal itself.
const stubForms = {
  name: 'task-integrations-stub-forms',
  enforce: 'pre',
  transform: (code, id) => {
    if (!id.endsWith('/TaskIntegrations.svelte')) return null;
    const rewritten = code.replace(/from\s+(['"])\$app\/forms\1/g, (_match, quote) => `from ${quote}$lib/test/stubs/app-forms${quote}`);
    if (rewritten === code) throw new Error(`TaskIntegrations.svelte matched, but its $app/forms import was not replaced`);
    return rewritten;
  },
};

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [stubForms] });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const cssResponse = await fetch(new URL('src/app.css?direct', origin));
  assert.ok(cssResponse.ok, `app.css fetch failed: ${cssResponse.status} ${cssResponse.statusText}`);
  const css = await cssResponse.text();
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
        assert.ok(o.section <= 0.5 && o.page <= 0.5, `${label} ${state}: overflows ${JSON.stringify(o)}`);
      };
      await noOverflow('list');
      const list = await controls(page);

      // #1686 V1: below sm a keyboard user can reveal and read the whole URN.
      // URN and named Copy URN checks run at both widths; only 390 starts truncated.
      if (!coarse) {
        const measuredChips = await chips(page);
        await assertChipUrns(page, label, measuredChips);
        if (width === 390) {
          for (const c of measuredChips) {
            assert.equal(c.reveal, true, `${label}: narrow fine-pointer chip is not a reveal toggle ${JSON.stringify(c)}`);
            assert.equal(c.truncated, true, `${label}: fixture must start truncated ${JSON.stringify(c)}`);
          }
          const first = page.locator('[data-task-integrations] span.inline-flex.min-w-0.max-w-full.items-center.gap-1 > button[aria-expanded]').first();
          const firstHandle = await first.elementHandle();
          assert.ok(firstHandle, `${label}: no reveal handle before keyboard activation`);
          await first.focus();
          assert.equal(await first.evaluate((el) => document.activeElement === el), true, `${label}: reveal did not receive keyboard focus`);
          await page.keyboard.press('Enter');
          await waitForExpanded(page, firstHandle, true);
          const open = await first.locator('span[title]').evaluate((el) => ({ text: el.textContent, title: el.title, truncated: el.scrollWidth > el.clientWidth + 1 }));
          assert.equal(open.text, open.title, `${label}: keyboard reveal does not show the full URN ${JSON.stringify(open)}`);
          assert.equal(open.truncated, false, `${label}: keyboard reveal is still truncated`);
          await noOverflow('keyboard reveal');
          await page.keyboard.press('Space');
          await waitForExpanded(page, firstHandle, false);
        }
      }
      if (coarse) {
        const shared = list.filter((c) => c.shared);
        assert.ok(shared.length > 0, `${label}: no shared Urn controls measured`);
        for (const c of shared) {
          assert.ok(c.height >= TARGET && c.width >= TARGET, `${label}: shared ${c.name} is ${c.height}x${c.width}px, under ${TARGET}px`);
        }
        const first = page.locator('[data-task-integrations] span.inline-flex.min-w-0.max-w-full.items-center.gap-1 > button[aria-expanded]').first();
        const firstHandle = await first.elementHandle();
        assert.ok(firstHandle, `${label}: no reveal handle before pointer activation`);
        await first.click();
        await waitForExpanded(page, firstHandle, true);
        await noOverflow('coarse reveal');
        await first.click();
        await waitForExpanded(page, firstHandle, false);
      }
      await page.click('button:has-text("Edit")');
      await page.waitForSelector('button[type="submit"]');
      await noOverflow('form');
      if (width === 390 && coarse) {
        const shape = await teamLabelShape(page);
        assert.equal(shape.lines, 1, `${label}: Remove team wraps to ${shape.lines} lines`);
        assert.equal(shape.wrapped, false, `${label}: Label and Remove team are not beside each other ${JSON.stringify(shape)}`);
        assert.ok(shape.inputWidth >= MIN_LABEL_INPUT_WIDTH - 0.5, `${label}: Label input is too narrow beside Remove team ${JSON.stringify(shape)}`);
      }
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
        for (const c of all) {
          assert.ok(c.height >= TARGET, `${label}: ${c.name} is ${c.height}px, under ${TARGET}px`);
          if (c.shared) assert.ok(c.width >= TARGET, `${label}: shared ${c.name} is ${c.width}px wide, under ${TARGET}px`);
        }
      } else {
        // V3: section controls stay exactly as dense as main at BOTH fine-pointer widths.
        const measured = all.filter((c) => !c.shared);
        for (const c of measured) {
          assert.ok(Object.hasOwn(FINE_HEIGHTS, c.name), `${label}: no FINE_HEIGHTS key for ${c.name}`);
          assert.ok(Math.abs(c.height - FINE_HEIGHTS[c.name]) < 0.5, `${label}: ${c.name} is ${c.height}px, was ${FINE_HEIGHTS[c.name]}px\nMeasured FINE_HEIGHTS:\n${fineHeightTable(measured)}`);
        }
        for (const c of all.filter((c) => c.shared && !c.reveal)) {
          assert.ok(Math.abs(c.height - 10) < 0.5 && Math.abs(c.width - 10) < 0.5, `${label}: fine shared copy ${c.name} moved to ${c.height}x${c.width}px`);
        }
        for (const c of all.filter((c) => c.shared && c.reveal)) {
          assert.ok(c.height >= 10 && c.width >= TARGET, `${label}: fine shared reveal collapsed to ${c.height}x${c.width}px`);
        }
      }

      // V4: flexible rows wrap instead of crushing their inputs. A column this narrow is what
      // long labels or 200% text do; at 390 with these English labels both rows happen to fit.
      if (width === 390) {
        await page.addStyleTag({ content: '#col { max-width: 200px; }' });
        await noOverflow('200px form');
        const row = await page.evaluate(() => {
          const r = document.querySelector('button[type="submit"]').parentElement;
          return { over: r.scrollWidth - r.clientWidth, save: document.querySelector('button[type="submit"]').getBoundingClientRect().right, right: r.getBoundingClientRect().right };
        });
        assert.ok(row.over <= 0.5 && row.save <= row.right + 0.5, `${label}: the Cancel/Save row overflows when narrow ${JSON.stringify(row)}`);
        const team = await teamLabelShape(page, 2);
        assert.equal(team.lines, 1, `${label}: Remove team wraps its own text when the row is narrow ${JSON.stringify(team)}`);
        assert.equal(team.wrapped, true, `${label}: the narrow Label row did not exercise wrapping ${JSON.stringify(team)}`);
        assert.ok(team.inputWidth >= MIN_LABEL_INPUT_WIDTH - 0.5 && team.rowOver <= 0.5, `${label}: narrow Label input is crushed or overflows ${JSON.stringify(team)}`);
      }
      await page.close();

      // The failed-roster list: chips and no overflow for every state.
      const failed = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
      await failed.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await mountSection(failed, origin, css, scheme === 'dark', true);
      const o = await overflow(failed);
      assert.ok(o.section <= 0.5 && o.page <= 0.5, `${label} failed roster: overflows ${JSON.stringify(o)}`);
      await assertChipUrns(failed, `${label} failed roster`, await chips(failed));
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
          const first = revealed.locator('[data-task-integrations] span.inline-flex.min-w-0.max-w-full.items-center.gap-1 > button[aria-expanded]').first();
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
