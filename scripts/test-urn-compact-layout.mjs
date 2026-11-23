// portal#1686: render every compact Urn call-site configuration with the real
// component and compiled app.css. This is a caller-prop matrix, not 33 full routes:
// the route/component suites own their data and interaction fixtures. Here we prove
// the shared chip's keyboard reveal, 44px coarse targets, and overflow behaviour.
// Setup: pnpm exec playwright install chromium
// Run: pnpm test:urn-compact-layout  (URN_SHOTS=<dir> saves light/dark screenshots)
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { parse } from 'svelte/compiler';

const repo = fileURLToPath(new URL('..', import.meta.url));
const src = join(repo, 'src');
const svelteFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.svelte')) svelteFiles.push(path);
  }
}
walk(src);

const DYNAMIC = Symbol('dynamic');
function collectUrns(node, found) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'InlineComponent' && node.name === 'Urn') found.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) collectUrns(child, found);
    else collectUrns(value, found);
  }
}
function literalValue(attribute) {
  if (!attribute) return undefined;
  if (attribute.value === true) return true;
  if (attribute.value.length === 1 && attribute.value[0].type === 'MustacheTag' && attribute.value[0].expression.type === 'Literal') {
    return attribute.value[0].expression.value;
  }
  return DYNAMIC;
}
function textValue(attribute) {
  return attribute?.value?.length === 1 && attribute.value[0].type === 'Text' ? attribute.value[0].data : undefined;
}

const sites = [];
let callSiteCount = 0;
for (const file of svelteFiles.sort()) {
  const ast = parse(readFileSync(file, 'utf8'));
  const components = [];
  collectUrns(ast, components);
  for (const component of components) {
    const attributes = new Map(component.attributes.filter((a) => a.type === 'Attribute').map((a) => [a.name, a]));
    if (!attributes.has('compact')) continue;
    callSiteCount++;
    const type = textValue(attributes.get('type'));
    const size = literalValue(attributes.get('size'));
    assert.equal(typeof size === 'number' || size === undefined, true, `${file}: compact Urn size must be a literal number`);
    const linked = literalValue(attributes.get('linked'));
    const copyUrl = literalValue(attributes.get('copyUrl'));
    for (const linkedValue of linked === DYNAMIC ? [false, true] : [!!linked]) {
      sites.push({
        source: relative(repo, file),
        type,
        size: size ?? 12,
        linked: linkedValue,
        copyUrl: copyUrl === DYNAMIC ? linkedValue : copyUrl ?? true,
        labelled: attributes.has('label'),
      });
    }
  }
}
assert.ok(callSiteCount >= 33 && sites.length >= 34, `compact-call-site census failed: ${callSiteCount} call sites, ${sites.length} configurations found`);
const cases = sites.map((site, index) => ({
  ...site,
  index,
  expectTruncated: true,
  value: `hrn:${site.type === 'memory' ? 'mem' : site.type ?? 'node'}:example.com:hadron-portal:compact-site-${index}:averylongsegmentthatcannotwrapatspacesorhyphens`,
}));
// A short unlinked value is a boundary the call-site census cannot supply: its
// reveal must still reach 44px wide on a coarse pointer (#1686 review).
cases.push({ index: cases.length, source: 'synthetic short URN', value: 'hrn:mem:x:y', type: 'mem', size: 10, linked: false, copyUrl: true, labelled: false, expectTruncated: false });
console.log(`compact Urn census: ${sites.length} configurations from ${callSiteCount} call sites in ${new Set(sites.map((s) => s.source)).size} files; plus one short-URN boundary`);

const RELOADED = /Execution context was destroyed|navigation/i;
async function mountCases(page, origin, css, dark) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(new URL('/__blank', origin).href);
      await page.evaluate(({ css, dark }) => {
        document.head.innerHTML = '';
        document.body.innerHTML = `<style>${css}</style><main id="matrix"></main>`;
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.style.background = document.body.style.background = dark ? '#09090b' : '#fafafa';
        document.body.style.color = dark ? '#fafafa' : '#18181b';
        document.getElementById('matrix').style.cssText = 'padding: 16px;';
      }, { css, dark });
      await page.evaluate(async (testCases) => {
        const { mountCompactUrns } = await import('/src/lib/test/fixtures/urn-compact-layout-harness.ts');
        mountCompactUrns(document.getElementById('matrix'), testCases);
      }, cases);
      await page.waitForSelector(`[data-site-index="${cases.length - 1}"] [data-urn-host] > span`);
      return;
    } catch (error) {
      if (attempt >= 5 || !RELOADED.test(String(error))) throw error;
    }
  }
}

const measure = (page, index) => page.evaluate((i) => {
  const row = document.querySelector(`[data-site-index="${i}"]`);
  const root = row.querySelector('[data-urn-host] > span');
  const value = root.querySelector('span[title]');
  const toggle = root.querySelector('button[aria-expanded]');
  const copies = [...root.querySelectorAll('button:not([aria-expanded])')];
  return {
    linked: !!root.querySelector('a'),
    toggle: !!toggle,
    toggleInsideLink: toggle ? !!toggle.closest('a') : false,
    expanded: toggle?.getAttribute('aria-expanded') ?? null,
    copyNames: copies.map((b) => b.getAttribute('aria-label')),
    copies: copies.map((b) => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })),
    copies: copies.map((b) => ({ width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })),
    rootHeight: root.getBoundingClientRect().height,
    // portal#2506: the collapsed value clips on EITHER axis — horizontally as
    // a nowrap `truncate`, or vertically as a one-line clamp whose
    // [overflow-wrap:anywhere] breaks the text and hides the lines below.
    truncated: value.scrollWidth > value.clientWidth + 1 || value.scrollHeight > value.clientHeight + 1,
    text: value.textContent,
    title: value.title,
    rowOverflow: row.scrollWidth - row.clientWidth,
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, index);

function assertContained(got, label, state) {
  assert.ok(got.rowOverflow <= 0 && got.documentOverflow <= 0, `${label} ${state}: overflow ${JSON.stringify(got)}`);
}

if (process.env.URN_SHOTS) mkdirSync(process.env.URN_SHOTS, { recursive: true });
async function shot(page, label, state) {
  if (process.env.URN_SHOTS) await page.locator('#matrix').screenshot({ path: join(process.env.URN_SHOTS, `${label.replaceAll(' ', '-')}-${state}.png`) });
}

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
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
      await page.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>URN matrix</title>' }));
      await mountCases(page, origin, css, scheme === 'dark');
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), coarse, `${label}: pointer emulation`);

      for (const testCase of cases) {
        const before = await measure(page, testCase.index);
        assert.equal(before.linked, testCase.linked, `${label} site ${testCase.index}: linked variant`);
        assert.equal(before.truncated, testCase.expectTruncated, `${label} site ${testCase.index}: truncation precondition`);
        const prefix = testCase.labelled ? 'Copy compact reference' : 'Copy';
        const expectedNames = testCase.copyUrl ? [`${prefix} URN`, `${prefix} URL`] : [`${prefix} URN`];
        assert.deepEqual(before.copyNames, expectedNames, `${label} site ${testCase.index}: labelled copy controls`);
        assertContained(before, label, `site ${testCase.index} collapsed`);
        if (!coarse) assert.ok(Math.abs(before.rootHeight - 16) < 0.5, `${label} site ${testCase.index}: dense fine row is ${before.rootHeight}px, not unchanged 16px`);

        if (width === 1280 && !coarse) {
          assert.equal(before.toggle, false, `${label} site ${testCase.index}: wide fine pointer gained a tab stop`);
          for (const copy of before.copies) {
            assert.ok(Math.abs(copy.width - testCase.size) < 0.5 && Math.abs(copy.height - testCase.size) < 0.5,
              `${label} site ${testCase.index}: fine copy target moved from ${testCase.size}px to ${copy.height}x${copy.width}`);
          }
          continue;
        }

        if (!coarse) {
          for (const copy of before.copies) {
            assert.ok(Math.abs(copy.width - testCase.size) < 0.5 && Math.abs(copy.height - testCase.size) < 0.5,
              `${label} site ${testCase.index}: narrow fine copy target moved from ${testCase.size}px`);
          }
        } else {
          for (const copy of before.copies) {
            assert.ok(copy.width >= 44 && copy.height >= 44, `${label} site ${testCase.index}: copy target ${copy.height}x${copy.width}`);
          }
        }

        assert.equal(before.toggle, true, `${label} site ${testCase.index}: compact chip has no keyboard/touch reveal`);
        assert.equal(before.toggleInsideLink, false, `${label} site ${testCase.index}: reveal must not turn the anchor into a toggle`);
        if (coarse) {
          const toggle = page.locator(`[data-site-index="${testCase.index}"] button[aria-expanded]`);
          const box = await toggle.boundingBox();
          assert.ok(box && box.width >= 44 && box.height >= 44, `${label} site ${testCase.index}: reveal target ${box?.height}x${box?.width}`);
        }

        const toggle = page.locator(`[data-site-index="${testCase.index}"] button[aria-expanded]`);
        await toggle.focus();
        if (coarse) await toggle.click();
        else await page.keyboard.press('Enter');
        await page.waitForSelector(`[data-site-index="${testCase.index}"] button[aria-expanded="true"]`);
        const open = await measure(page, testCase.index);
        assert.equal(open.text, open.title, `${label} site ${testCase.index}: reveal is not the full URN`);
        assert.equal(open.truncated, false, `${label} site ${testCase.index}: reveal remains truncated`);
        assertContained(open, label, `site ${testCase.index} revealed`);
        if (coarse) await toggle.click();
        else await page.keyboard.press('Space');
        await page.waitForSelector(`[data-site-index="${testCase.index}"] button[aria-expanded="false"]`);
      }
      // Full-page screenshots can change Chromium's layout metrics while they are
      // captured. Take them only after every assertion in this leg, not midway
      // through the matrix (a mid-loop capture once made the next coarse box 12px).
      await shot(page, label, 'collapsed');
      await page.close();
      if (coarse || width === 390) {
        const revealed = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: coarse });
        await revealed.route('**/__blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>URN matrix</title>' }));
        await mountCases(revealed, origin, css, scheme === 'dark');
        for (const testCase of cases) {
          const toggle = revealed.locator(`[data-site-index="${testCase.index}"] button[aria-expanded]`);
          await toggle.focus();
          if (coarse) await toggle.click();
          else await revealed.keyboard.press('Enter');
          await revealed.waitForSelector(`[data-site-index="${testCase.index}"] button[aria-expanded="true"]`);
        }
        // No interaction follows a screenshot on the same page.
        await shot(revealed, label, 'revealed');
        await revealed.close();
      }
      console.log(`ok ${label}: ${cases.length - 1} call-site configurations plus the short-URN boundary`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
