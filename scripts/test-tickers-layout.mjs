// portal#1099: the Tickers list, a ticker page and the Wake-ups panel must
// stay inside a phone screen. jsdom has no layout engine, so this is real
// Chromium, like test-usage-toolbar-layout: the real components are mounted
// through Vite with the compiled app.css, in the 308px content column a 390px
// viewport leaves. At 390px the grid keeps Ticker, State and Every on screen,
// and the Wake-ups status sentence comes first.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:tickers-layout
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';


// portal#1151: the first import of the harness makes Vite discover and re-optimize dependencies,
// and it then reloads every page it is serving. A page that was mid-`evaluate` died with
// "Execution context was destroyed, most likely because of a navigation": CI's slower runner hit
// it on the 1280px legs once the Tickers pages grew. Each view is therefore set up from a
// document that has no script of its own (the old /@vite/client address was a SvelteKit 404 page
// that hydrates), and a setup that a reload interrupts starts again from the top. A setup that
// fails any other way still fails.
const RELOADED = /Execution context was destroyed|navigation/i;

async function mountView(page, origin, css, width, view) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>layout</title>' }));
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate((css) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="col"></main>`;
      }, css);
      await page.addStyleTag({ content: `#col { width: ${width === 390 ? 308 : 1000}px; margin: 40px; }` });
      await page.evaluate(async (view) => {
        const { mountTickers } = await import('/src/lib/test/fixtures/tickers-harness.ts');
        mountTickers(document.getElementById('col'), view);
      }, view);
      return;
    } catch (e) {
      if (attempt >= 5 || !RELOADED.test(String(e))) throw e;
    }
  }
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  browser = await chromium.launch({ headless: true });

  // portal#1497: the ticker page now carries the on/off control and the
  // subscriber controls, each with its own bad states — the roster's three,
  // the stale row, an uncertain result and the failed-refresh line — and the
  // whole set is checked in light AND in dark (.dark on the root). The Wake-ups
  // panel keeps its four CLI commands (portal#1496; portal#1497 D3 leaves that
  // tab read-only), so its long-ref variant stays; the ticker page's commands
  // are gone (D4) and must stay gone. detail-long-urn (review) restores the
  // page's own width stress: a 200-character worker URN in the subscribers
  // row, in the row's open Remove confirmation, and in the chooser's
  // selected-worker chip.
  const views = [
    'list', 'detail', 'detail-unmapped', 'detail-task-failed', 'detail-stale-row',
    'detail-roster-hidden', 'detail-roster-failed', 'detail-roster-empty',
    'detail-uncertain', 'detail-refresh-failed', 'detail-long-urn', 'detail-impersonating', 'detail-outcome', 'wake', 'wake-long-urn',
  ];
  for (const width of [390, 1280]) {
    for (const view of views) {
      // portal#1496: light and dark (`.dark` on the root), for every view.
      for (const scheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: 844 } });
        await mountView(page, origin, css, width, view);
        // The root layout paints the page (src/routes/+layout.svelte): zinc-950 dark, zinc-50 light.
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        }, scheme === 'dark');
        await page.waitForSelector(view.startsWith('wake') ? '[data-testid="wake-status"]' : view.startsWith('detail') ? '[data-testid="ticker-task"]' : 'table');

        const measure = () => page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const onScreen = (el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.left >= 0 && b.right <= vw;
          };
          const heads = [...document.querySelectorAll('th')].map((th) => ({ text: th.textContent?.trim() ?? '', on: onScreen(th) }));
          const status = document.querySelector('[data-testid="wake-status"]');
          const settings = document.querySelector('[data-testid="wake-settings"]');
          // portal#1496: every CLI command stays inside the column, however long its ref.
          const commands = [...document.querySelectorAll('[data-testid="cli-command"]')].map((c) => ({ text: c.textContent ?? '', on: onScreen(c) }));
          return {
            width: vw,
            scrollWidth: document.documentElement.scrollWidth,
            heads,
            commands,
            taskEntries: document.querySelectorAll('[data-testid="ticker-task"]').length,
            statusFirst: status && settings ? status.getBoundingClientRect().top < settings.getBoundingClientRect().top : null,
          };
        });
        const got = await measure();
        const label = `${view} (${scheme}) at ${width}px`;
        assert.equal(got.scrollWidth, width, `${label}: page overflows (${got.scrollWidth} > ${width})`);
        if (view === 'list') {
          for (const col of ['Ticker', 'State', 'Every']) {
            const h = got.heads.find((x) => x.text.startsWith(col));
            assert.ok(h, `${label}: no ${col} column`);
            assert.ok(h.on, `${label}: the ${col} column is off-screen`);
          }
        }
        if (view.startsWith('detail')) assert.equal(got.taskEntries, 1, `${label}: the Task entry must render exactly once`);
        if (view.startsWith('wake')) assert.equal(got.statusFirst, true, `${label}: the status sentence must come first`);
        // portal#1497 D4: the ticker page carries no CLI commands — the portal
        // controls replaced them. The Wake-ups panel keeps exactly four.
        if (view.startsWith('detail')) {
          assert.equal(got.commands.length, 0, `${label}: the ticker page must carry no CLI commands, got ${got.commands.length}`);
        }
        if (view.startsWith('wake')) {
          assert.equal(got.commands.length, 4, `${label}: expected 4 CLI commands, got ${got.commands.length}`);
          for (const c of got.commands) assert.ok(c.on, `${label}: a CLI command runs off-screen: ${c.text.slice(0, 60)}`);
          if (view === 'wake-long-urn') assert.ok(got.commands.every((c) => c.text.length > 200), `${label}: the long ref must be in every command`);
        }
        // portal#1502 (review, Uma P2 + Gemma P3-2): the Remove confirmation is
        // a page-level panel beside Add, not a form inside the 120px Actions
        // column (Cancel was 7px cut at 1280 and 35px at 390 there). Its Cancel
        // must sit fully inside the viewport at BOTH widths, focus must start
        // on the panel's own action, and Cancel must return focus to the row's
        // trigger. detail-long-urn is the widest panel (200-char worker URN).
        if (view === 'detail-long-urn') {
          const panelSel = '[data-testid="ticker-remove-confirm-s1"]';
          // The panel's Cancel, by text: the Urn chip's copy-icon buttons are
          // also button[type=button] with empty text, and come first in order.
          const cancel = await page.evaluate((sel) => {
            const cancel = [...document.querySelectorAll(`${sel} button`)].find((b) => /^Cancel$/.test(b.textContent ?? ''));
            if (!cancel) return null;
            const b = cancel.getBoundingClientRect();
            return { left: b.left, right: b.right, vw: document.documentElement.clientWidth };
          }, panelSel);
          assert.ok(cancel, `${label}: the Remove panel must be open with a Cancel`);
          assert.ok(cancel.left >= 0 && cancel.right <= cancel.vw, `${label}: the panel's Cancel is cut (left ${cancel.left.toFixed(0)}, right ${cancel.right.toFixed(0)}, viewport ${cancel.vw})`);
          await page.evaluate((sel) => {
            [...document.querySelectorAll(`${sel} button`)].find((b) => /^Cancel$/.test(b.textContent ?? ''))?.click();
          }, panelSel);
          assert.ok(
            await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'ticker-remove-s1'),
            `${label}: Cancel must return focus to the row's trigger`,
          );
          await page.click('[data-testid="ticker-remove-s1"]');
          await page.waitForFunction(
            (sel) => document.activeElement === document.querySelector(`${sel} button[type="submit"]`),
            panelSel,
            { timeout: 2000 },
          ).catch(() => {
            assert.fail(`${label}: opening the panel must focus its own Remove action`);
          });
        }
        // portal#1502 (review): an impersonation session shows ONE page-level
        // note and no Remove trigger at all (the server refuses the POST).
        // Buttons only: the removal OUTCOME region (ticker-remove-outcome) is
        // an inert status line, always present for a participant, and shares
        // the ticker-remove- prefix — counting the prefix alone mistook it for
        // a control at d0673ce6 (portal#1502 delta, CI).
        if (view === 'detail-impersonating') {
          const imp = await page.evaluate(() => ({
            note: document.body.textContent?.includes('changes are switched off') ?? false,
            removeControls: document.querySelectorAll('button[data-testid^="ticker-remove-"]').length,
          }));
          assert.ok(imp.note, `${label}: the one impersonation line must render`);
          assert.equal(imp.removeControls, 0, `${label}: no Remove trigger in an impersonation session, got ${imp.removeControls}`);
        }
        // portal#1502 (UX delta, Uma P2): the page-level OUTCOME composite —
        // sentence + Urn chip + both caveats — must not run into itself; each
        // caveat is its own line, so a reader can tell the sentence from the
        // notes (inline after the chip they joined into "stands.Saved;"). The
        // harness mounts the populated region beside the page: a populated
        // outcome needs a delivered action result, which a page mounted
        // outside a booted kit app can never receive, per
        // hrn:node:hadronmemory.com:hadron-portal:findings:enhance-deserialize-needs-a-booted-app
        // — the intercepted-POST route this probe once tried can only ever
        // answer kit's error path.
        if (view === 'detail-outcome') {
          const stacked = () => page.evaluate(() => {
            const host = document.querySelector('[data-testid="ticker-remove-outcome-mounted"]');
            const region = host?.querySelector('[data-testid="ticker-remove-outcome"]');
            const chip = region?.querySelector('[title^="hrn:worker:"]');
            const ann = region?.querySelector('[data-testid="ticker-remove-outcome-announcement"]');
            const ref = region?.querySelector('[data-testid="ticker-remove-outcome-refresh-failed"]');
            const r = (el) => el ? el.getBoundingClientRect() : null;
            return { chip: r(chip), ann: r(ann), ref: r(ref), text: region?.textContent ?? '' };
          });
          const geo = await stacked();
          assert.ok(geo.chip && geo.ann && geo.ref, `${label}: the outcome must carry the chip and both caveats (got ${geo.text.slice(0, 80)})`);
          assert.ok(geo.ann.top >= geo.chip.bottom - 1, `${label}: the caveat runs into the Urn chip (caveat top ${geo.ann.top.toFixed(1)}, chip bottom ${geo.chip.bottom.toFixed(1)})`);
          assert.ok(geo.ref.top >= geo.ann.bottom - 1, `${label}: the two caveats join into one line (refresh top ${geo.ref.top.toFixed(1)}, announcement bottom ${geo.ann.bottom.toFixed(1)})`);
          if (width === 390) {
            // Prove the pin can see the defect: force the caveats back inline
            // (the markup this head replaced) and the lines MUST join again.
            const mutant = await page.addStyleTag({ content: '[data-testid="ticker-remove-outcome-mounted"] [data-testid="ticker-remove-outcome-announcement"], [data-testid="ticker-remove-outcome-mounted"] [data-testid="ticker-remove-outcome-refresh-failed"] { display: inline !important; }' });
            const runIn = await stacked();
            assert.ok(runIn.ann.top < runIn.chip.bottom - 1, `${label}: the inline mutant must run the caveat into the chip, or this pin proves nothing`);
            await mutant.evaluate((el) => el.remove());
            const again = await stacked();
            assert.ok(again.ann.top >= again.chip.bottom - 1, `${label}: the caveat must return to its own line after the mutant`);
          }
          // portal#1502 BLIND delta (Gizelle P2-2), the REFUSED composite: the
          // stale-row refusal whose reload also failed. No write happened, so
          // its caveat may not claim a save — "Saved" must appear nowhere in
          // it — and its caveat still owes its own line below the sentence.
          const refused = await page.evaluate(() => {
            const host = document.querySelector('[data-testid="ticker-remove-outcome-refused-mounted"]');
            const region = host?.querySelector('[data-testid="ticker-remove-outcome"]');
            const ref = region?.querySelector('[data-testid="ticker-remove-outcome-refresh-failed"]');
            const r = (el) => el ? el.getBoundingClientRect() : null;
            return { region: r(region), ref: r(ref), text: region?.textContent ?? '', refText: ref?.textContent ?? '' };
          });
          assert.ok(refused.region && refused.ref, `${label}: the refused outcome must carry its caveat (got ${refused.text.slice(0, 80)})`);
          assert.ok(!refused.text.includes('Saved'), `${label}: a refused removal's failed reload may not claim a save (got ${refused.refText})`);
          assert.ok(!refused.text.includes('first page'), `${label}: a failed reload may not claim the first-page navigation either (got ${refused.text})`);
          assert.ok(refused.refText.includes("couldn’t reload"), `${label}: the refused caveat must name the reload (got ${refused.refText})`);
          assert.ok(refused.ref.top >= refused.region.top, `${label}: the refused caveat must sit below its sentence`);
        }

        if (width === 390) {
          // Prove the browser sees overflow at all: force the facts/settings
          // grids and the grid wrapper wide, and the page must overflow, or this
          // check could not tell fixed from broken.
          const mutant = await page.addStyleTag({ content: '#col dl, #col section > div, #col table { min-width: 700px !important; width: 700px !important; overflow: visible !important; }' });
          assert.ok((await measure()).scrollWidth > width, `${label}: the wide mutant must overflow`);
          await mutant.evaluate((el) => el.remove());
          assert.equal((await measure()).scrollWidth, width);
          if (view.startsWith('wake') && view.endsWith('long-urn')) {
            // portal#1496: and a command that may not break its long ref runs off the column.
            const unbroken = await page.addStyleTag({ content: '[data-testid="cli-command"] { word-break: normal !important; overflow-wrap: normal !important; }' });
            const wide = await measure();
            assert.ok(wide.scrollWidth > width || wide.commands.some((c) => !c.on), `${label}: the unbroken-command mutant must overflow`);
            await unbroken.evaluate((el) => el.remove());
          }
          if (view === 'detail-long-urn') {
            // portal#1497 (review): and a Urn chip that may not truncate its
            // 200-character value runs off the column. max-content beats the
            // chip's (and its value span's) min-w-0 shrinking, so the BOX
            // itself — not just painted text — goes wide.
            const untruncated = await page.addStyleTag({ content: '[data-testid^="ticker-remove-confirm-"] .font-mono, [data-testid="ticker-add-form"] .font-mono, [data-testid^="ticker-remove-confirm-"] .font-mono span, [data-testid="ticker-add-form"] .font-mono span { width: max-content !important; min-width: max-content !important; overflow: visible !important; }' });
            const wide = await measure();
            assert.ok(wide.scrollWidth > width, `${label}: the untruncated-chip mutant must overflow`);
            await untruncated.evaluate((el) => el.remove());
          }
        }
        if (process.env.TICKERS_SHOTS) await page.screenshot({ path: `${process.env.TICKERS_SHOTS}/${view}-${width}-${scheme}.png`, fullPage: true });
        console.log(JSON.stringify({ view, scheme, width: got.width, scrollWidth: got.scrollWidth, statusFirst: got.statusFirst, commands: got.commands.length }));
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
