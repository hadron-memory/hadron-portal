// #854: real Chromium layout, using the route's header classes, the actual Urn
// component and Vite's compiled stylesheet. This is a focused layout fixture;
// independent QA still exercises the authenticated route and its tab contents.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:node-phone-layout
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = readFileSync('src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte', 'utf8');
const elements = [];
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'RegularElement') elements.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(walk);
    else walk(child);
  }
}
walk(parse(source, { modern: true }).fragment);
const heading = elements.find((el) => el.name === 'h1');
// The h1 sits in a flex row with the status icons (`titleRow`), inside the `min-w-0` header column (`wrapper`).
const titleRow = elements.find((el) => el.fragment.nodes.includes(heading));
const wrapper = elements.find((el) => el.fragment.nodes.includes(titleRow));
const row = elements.find((el) => el.fragment.nodes.includes(wrapper));
// The icons are a component: read its classes from the source (the cluster, an icon, a panel) rather than copying them.
const iconElements = [];
(function walkIcons(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type === 'RegularElement') iconElements.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(walkIcons);
    else walkIcons(child);
  }
})(parse(readFileSync('src/lib/components/NodeStatusIcons.svelte', 'utf8'), { modern: true }).fragment);
const attr = (el, name) => el.attributes.find((a) => a.name === name);
const iconCluster = iconElements.find((el) => attr(el, 'data-testid')?.value?.[0]?.data === 'node-status-icons');
const iconButton = iconElements.find((el) => el.name === 'button' && attr(el, 'aria-controls'));
const iconPanel = iconElements.find((el) => attr(el, 'role')?.value?.[0]?.data === 'group');
const statusIcons = (panelOpen) => Array.from({ length: 3 }, (_, i) =>
  `<button class="${iconClasses(iconButton)}" aria-label="Status">•</button>${panelOpen && i === 2 ? `<div data-status-panel class="${iconClasses(iconPanel)}">panel</div>` : ''}`).join('');
// Class attribute values here may carry `{...}` expressions; keep their static text.
function iconClasses(el) { return classes(el); }
const name = heading.fragment.nodes.find((el) => el.type === 'RegularElement' && el.name === 'span');
const badges = elements.filter((el) => el.start > heading.start && el.end < heading.end &&
  classes(el).split(/\s+/).includes('rounded-full'));
const prose = elements.find((el) => classes(el).split(/\s+/).includes('prose'));
function classes(el) {
  const value = el.attributes.find((attr) => attr.name === 'class')?.value;
  return Array.isArray(value) ? value.filter((part) => part.type === 'Text')
    .map((part) => part.data).join(' ') : '';
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const response = await fetch(new URL('src/app.css?direct', origin));
  assert.equal(response.status, 200);
  const css = await response.text();
  const { default: Urn } = await server.ssrLoadModule('/src/lib/components/Urn.svelte');
  const { render } = await server.ssrLoadModule('svelte/server');
  const urn = render(Urn, { props: {
    value: 'hrn:node:synthetic:layout:tasks:phone-layout-regression-node-with-a-long-loc', type: 'node',
  } }).body;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const measure = () => page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerWidth: document.querySelector('h1').getBoundingClientRect().width,
    inlineWrap: getComputedStyle(document.querySelector('p code')).overflowWrap,
    blockWrap: getComputedStyle(document.querySelector('pre code')).overflowWrap,
  }));

  for (const width of [390, 1280]) {
    for (const { longName, longBadges } of [false, true].flatMap((longName) =>
      [false, true].map((longBadges) => ({ longName, longBadges })))) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(`<style>${css}</style>
        <main style="width:${width === 390 ? 308 : 1000}px;margin:40px">
          <div class="${classes(row)}"><div class="${classes(wrapper)}"><div class="${classes(titleRow)}">
            <h1 class="${classes(heading)}"><span class="${classes(name)}">Node: ${longName ? 'x'.repeat(80) : 'Phone layout'}</span>${badges.map((el) => `<span data-layout-badge class="${classes(el)}">${longBadges ? `platform.governance.${'auditoversight'.repeat(8)}` : 'rule'}</span>`).join('')}</h1><div class="mt-0.5"><div class="${classes(iconCluster)}">${statusIcons(false)}</div></div></div>
            ${urn}
          </div><button class="shrink-0" aria-label="Actions">⋮</button></div>
          <div class="${classes(prose)}">
            <p>Inline <code>${'opt_fields:'.repeat(30)}</code> text.</p>
            <pre><code>${'block-token:'.repeat(30)}</code></pre>
          </div>
        </main>`);
      const fixed = await measure();
      assert.equal(fixed.scrollWidth, width, `overflow at ${width}px, longName=${longName}, longBadges=${longBadges}`);
      assert.equal(fixed.inlineWrap, 'anywhere');
      assert.equal(fixed.blockWrap, 'normal');
      assert.equal(await page.evaluate(() => {
        const pre = document.querySelector('pre');
        const controls = [...document.querySelectorAll('button')];
        return pre.scrollWidth > pre.clientWidth && getComputedStyle(pre).overflowX === 'auto' &&
          controls.length === 6 && controls.every((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.left >= 0 && box.right <= document.documentElement.clientWidth;
          });
      }), true, 'block code scrolls and both copy controls, the three status icons and Actions stay visible');

      // Prove the browser actually sees each defect: either constraint removed
      // independently must restore phone overflow.
      await page.evaluate(() => { document.querySelector('h1').parentElement.parentElement.style.minWidth = 'auto'; });
      const noShrink = await measure();
      if (width === 390) assert.ok(noShrink.scrollWidth > width, 'header mutant must overflow');
      // (The desktop "ordinary title keeps its width" pin is gone with the old header shape: the h1 now shares a flex
      // row with the status icons, so removing the column's shrink permission widens the row at 1280px too. The
      // `scrollWidth === width` assertion above catches overflow only, not a title that moves or widens without
      // overflowing; that part of the old pin is not replaced.)
      await page.evaluate(() => { document.querySelector('h1').parentElement.parentElement.style.minWidth = ''; });
      const override = await page.addStyleTag({ content: '.prose :not(pre) > code { overflow-wrap: normal; }' });
      assert.ok((await measure()).scrollWidth > width, 'inline-code mutant must overflow');
      await override.evaluate((el) => el.remove());
      assert.equal((await measure()).scrollWidth, width);
      if (width === 390 && longBadges) {
        const renderedBadges = await page.locator('[data-layout-badge]').all();
        assert.equal(renderedBadges.length, 2, 'exercise role and object-type badges');
        for (const badge of renderedBadges) {
          // Each half matters independently: a shrinking badge still paints
          // outside its box without wrapping, and wrapping alone cannot shrink.
          for (const mutant of ['min-width: auto', 'overflow-wrap: normal']) {
            await badge.evaluate((el, style) => el.setAttribute('style', style), mutant);
            assert.ok((await measure()).scrollWidth > width, `badge mutant must overflow: ${mutant}`);
            await badge.evaluate((el) => el.removeAttribute('style'));
            assert.equal((await measure()).scrollWidth, width);
          }
        }
      }
      // An open status panel: it is as wide as the title row and starts at the row's left edge, so it stays in the
      // viewport whatever the name's length puts the icons; the old viewport-based width runs off the right edge.
      if (width === 390) {
        await page.evaluate((html) => { document.querySelector('.mt-0\\.5 > div').innerHTML = html; }, statusIcons(true));
        const box = () => page.evaluate(() => {
          const panel = document.querySelector('[data-status-panel]').getBoundingClientRect();
          const rowBox = document.querySelector('h1').parentElement.getBoundingClientRect();
          return { left: panel.left, right: panel.right, rowLeft: rowBox.left, rowRight: rowBox.right, vw: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
        });
        const open = await box();
        assert.ok(open.right <= open.vw && open.scrollWidth === open.vw, `open status panel stays on screen at ${width}px (right ${open.right})`);
        assert.equal(open.left, open.rowLeft, 'the panel starts at the title row, not at the icons');
        await page.evaluate(() => { document.querySelector('[data-status-panel]').style.width = 'min(30rem, calc(100vw - 2rem))'; });
        assert.ok((await box()).right > open.vw, 'status panel mutant (viewport-based width) must run off the edge');
        await page.evaluate(() => { document.querySelector('[data-status-panel]').remove(); });
      }
      console.log(JSON.stringify({ ...fixed, longName, longBadges, mutantsDetected: true }));
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
