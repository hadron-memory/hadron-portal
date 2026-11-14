// portal#2098: the App agent chat list's per-row Rename and Delete, by
// keyboard, fine pointer and coarse (touch) pointer, in real Chromium with the
// compiled app CSS and the real AgentChat inside the App page's shell. The
// chat API is answered by src/lib/test/fixtures/agent-chat-phone-harness.ts
// (`rowActions`); no server, provider or signed-in route.
//
// jsdom has no layout, pointer media or focus painting, so reachability,
// geometry and contrast are measured here, never read off class names.
// Touch is Chromium's emulation (hasTouch + isMobile, `pointer: coarse`), not
// a physical device.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'agent-chat-navigation-stub',
      enforce: 'pre',
      transform(code, id) {
        return /AgentChat\.svelte$/.test(id)
          ? code.replace("from '$app/navigation'", "from '$lib/test/stubs/app-navigation'")
          : null;
      },
    },
  ],
});
const A = 'Planning the spring onboarding for the regional volunteer teams';
const B = 'Second chat';
const WIDE = 672; // AgentChat's `@2xl` container breakpoint (42rem)
const shots = process.env.AGENT_CHAT_SHOTS;
// Explicit adversarial self-checks only; a normal run keeps all ten legs.
const control = process.env.CHAT_ROW_CONTROL;
assert(!control || ['missing-meta-free', 'hidden-meta-text', 'delayed-resume', 'rename-overlay'].includes(control), 'unknown CHAT_ROW_CONTROL');
if (control) console.log(`CONTROL ACTIVE: ${control}`);
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  assert(css.length > 1000, 'compiled app.css was not served');
  browser = await chromium.launch({ headless: true });
  if (shots) await mkdir(shots, { recursive: true });

  /** The App page's shell (nav from `sm`) around the Agent chat panel, the real component in it. */
  async function open(width, dark, touch, shortTitle = false) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    // Everything that goes wrong in the page fails the leg (portal#2104): an
    // uncaught error, a console error (the fixture logs any call it doesn't
    // model) and a request that failed on the network. The delete failures
    // the failure legs inject are answered inside the page's fetch stub, so
    // they reach none of these and no allowance is needed.
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));
    await page.route('**/__chat_fixture*', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent chat fixture</title>' }),
    );
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(new URL('/__chat_fixture', origin).href);
        await page.evaluate(
          ({ css, dark }) => {
            document.head.innerHTML += `<style>${css}</style>`;
            document.documentElement.classList.toggle('dark', dark);
            document.body.className = 'bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
            document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">
              <aside class="w-48 shrink-0 flex-col hidden sm:flex"><nav>Nav</nav></aside>
              <div class="min-w-0 flex-1">
                <div class="flex flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
                  <div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"></div>
                </div></div></div>`;
          },
          { css, dark },
        );
        await page.evaluate(async (shortTitle) => {
          const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
          window.__chat = mountAgentChat(document.getElementById('panel'), { rowActions: true, shortTitle });
        }, shortTitle);
        break;
      } catch (e) {
        if (attempt >= 5 || !/Execution context was destroyed|navigation/i.test(String(e))) throw e;
      }
    }
    await page.locator('[data-chat-row]').first().waitFor();
    return { page, errors, context };
  }

  /**
   * Geometry, visibility, colour and contrast of one row's parts. Colours are
   * read through a canvas, so oklch and alpha come back as sRGB bytes; a
   * background is composited from the element up to the page.
   */
  const row = (page, title) =>
    page.evaluate((title) => {
      const rows = [...document.querySelectorAll('#panel li')];
      const li = rows.find((r) => r.querySelector('[data-chat-row]')?.textContent.includes(title));
      if (!li) throw new Error(`no row for ${title}`);
      const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
      const rgba = (c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
      const background = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) layers.push(rgba(getComputedStyle(n).backgroundColor));
        return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255]);
      };
      const lum = (c) =>
        0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
      const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const ratio = (fg, bg) => {
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      // Effective colour of `c` drawn on `el`: its own alpha and every
      // ancestor's opacity, composited over the background under it.
      const shown = (el, c) => {
        let alpha = rgba(c)[3];
        for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
        const bg = background(el);
        return [over([...rgba(c).slice(0, 3), alpha], bg), bg];
      };
      const contrast = (el) => ratio(...shown(el, getComputedStyle(el).color));
      // The focus ring is drawn inside the button (negative offset), so it
      // sits on the button's own composited background (portal#2104).
      const ringContrast = (el) => ratio(...shown(el, getComputedStyle(el).outlineColor));
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const button = li.querySelector('[data-chat-row]');
      const titleEl = button.querySelector('span');
      const badge = titleEl.nextElementSibling;
      const action = (word) => li.querySelector(`button[aria-label^="${word} chat"]`);
      const part = (el) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        let opacity = 1;
        for (let n = el; n && n !== li.parentElement; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
        return {
          name: el.getAttribute('aria-label'),
          box: box(el),
          display: s.display,
          visibility: s.visibility,
          opacity,
          color: rgba(s.color).slice(0, 3),
          contrast: contrast(el),
          label: (() => { const range = document.createRange(); range.selectNodeContents(el); return box(range); })(),
          focusRing: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
          ringContrast: ringContrast(el),
        };
      };
      return {
        li: box(li),
        row: box(button),
        title: box(titleEl),
        titleLine: box(titleEl.parentElement),
        badge: box(badge),
        // The explicit meta hook is independent of sibling order.
        meta: box(li.querySelector('[data-chat-meta] span')),
        metaText: li.querySelector('[data-chat-meta]').textContent.replace(/\s+/g, ' ').trim(),
        rename: part(action('Rename')),
        del: part(action('Delete')),
        coarse: matchMedia('(pointer: coarse)').matches,
      };
    }, title);

  const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const isRed = ([r, g, b]) => r > g + 60 && r > b + 60;
  const focused = (page) => page.evaluate(() => document.activeElement === document.body ? '<body>' : document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');

  // 390 touch: phone, one pane. 640/768 fine: the App nav leaves the panel
  // below @2xl. 1024 fine: wide panel, quiet actions. 1024 touch: a touch
  // tablet with the 256px list (actions on the meta line).
  const LEGS = [
    { width: 640, touch: false },
    { width: 390, touch: true },
    { width: 768, touch: false },
    { width: 1024, touch: false },
    { width: 1024, touch: true },
  ];
  for (const { width, touch } of (control ? LEGS.slice(0, 1) : LEGS)) {
    for (const dark of (control ? [false] : [false, true])) {
      const leg = `${width}${touch ? ' touch' : ''}/${dark ? 'dark' : 'light'}`;
      // portal#2105: use a fresh mount per activation so a selected-chat
      // fast path cannot make a missing resume request look successful.
      for (const shortTitle of [false, true]) {
        for (const freeSpace of [false, true]) {
          const metaRun = await open(width, dark, touch, shortTitle);
          const p = metaRun.page;
          const id = shortTitle ? 'chats:b' : 'chats:a';
          const rowButton = p.locator(`[data-chat-row="${id}"]`);
          // Text activation is independent of the geometry hook; the red
          // commit fails on a missing resume, not a missing hook.
          const li = rowButton.locator('..');
          const measured = await row(p, shortTitle ? 'Hi' : A);
          assert(measured.titleLine.width >= measured.li.width - 25, `${leg}: title line lost available width (${shortTitle ? 'short' : 'long'})`);
          assert(measured.title.right <= measured.badge.left + 0.5, `${leg}: title overlaps scope badge`);
          assert.equal(await li.locator('button:not([tabindex="-1"])').count(), 3, `${leg}: unexpected row tab stops`);
          const text = li.getByText(shortTitle ? '1 msg' : '3 msgs', { exact: true });
          if (control === 'missing-meta-free' && freeSpace) await li.locator('[data-chat-meta]').evaluate(el => el.remove());
          if (control === 'hidden-meta-text' && !freeSpace) await text.evaluate(el => { el.style.display = 'none'; });
          if (freeSpace) {
            const bounds = await li.locator('[data-chat-meta]').boundingBox();
            const x = bounds.x + bounds.width - 4;
            const y = bounds.y + bounds.height / 2;
            const hit = await p.evaluate(({ x, y }) => {
              const el = document.elementFromPoint(x, y);
              return { tag: el?.tagName, row: el?.closest('[data-chat-row]')?.getAttribute('data-chat-row'), text: el?.textContent };
            }, { x, y });
            assert.equal(hit.row, id, `${leg}: free-space point hits ${JSON.stringify(hit)} at ${x},${y}`);
            if (touch) await p.touchscreen.tap(x, y);
            else await p.mouse.click(x, y);
          } else {
            const bounds = await text.boundingBox();
            const x = bounds.x + bounds.width / 2;
            const y = bounds.y + bounds.height / 2;
            if (touch) await p.touchscreen.tap(x, y);
            else await p.mouse.click(x, y);
          }
          await p.waitForFunction(() => window.__chat.calls.resume === 1, null, { timeout: 2000 })
            .catch(async () => assert.fail(`${leg}: ${shortTitle ? 'short' : 'long'} meta ${freeSpace ? 'free space' : 'text'} did not resume exactly once: ${JSON.stringify(await p.evaluate(() => window.__chat.calls))}`));
          if (control === 'delayed-resume') await p.evaluate(() => {
            setTimeout(() => { window.__chat.calls.resume++; }, 50);
          });
          assert.equal(await p.evaluate(() => window.__chat.calls.title + window.__chat.calls.delete), 0, `${leg}: meta activation ran an action`);
          assert.deepEqual(metaRun.errors, [], `${leg}: meta activation page errors`);
          await metaRun.context.close();
        }
      }
      const { page, errors, context } = await open(width, dark, touch);
      const panelWidth = await page.evaluate(() => document.getElementById('panel').firstElementChild.clientWidth);
      const narrow = panelWidth < WIDE;
      const alwaysShown = narrow || touch;

      // ── Names: each action names its chat ─────────────────────────────
      for (const t of [A, B]) {
        for (const verb of ['Rename', 'Delete']) {
          assert.equal(await page.getByRole('button', { name: `${verb} chat ${t}`, exact: true }).count(), 1, `${leg}: no "${verb} chat ${t}" button`);
        }
      }

      // ── At rest ───────────────────────────────────────────────────────
      await page.mouse.move(1, 1);
      let r = await row(page, A);
      assert.equal(r.coarse, touch, `${leg}: pointer media is not ${touch ? 'coarse' : 'fine'}`);
      for (const a of [r.rename, r.del]) {
        assert.notEqual(a.display, 'none', `${leg}: ${a.name} is display:none at rest (out of the tab order)`);
        assert(a.box.width >= 44 && a.box.height >= 44, `${leg}: ${a.name} target is ${a.box.width}x${a.box.height}, below 44px`);
        for (const [what, b] of [['title', r.title], ['scope badge', r.badge], ['row button', r.row]]) {
          assert(!overlaps(a.box, b), `${leg}: ${a.name} overlaps the ${what}`);
        }
        assert(a.box.right <= r.li.right + 0.5 && a.box.left >= r.li.left - 0.5, `${leg}: ${a.name} leaves its row`);
        if (alwaysShown) assert.equal(a.opacity, 1, `${leg}: ${a.name} must be visible at rest (narrow panel or touch)`);
        else assert.equal(a.opacity, 0, `${leg}: ${a.name} should be quiet at rest on a wide panel with a mouse`);
      }
      if (alwaysShown) {
        for (const a of [r.rename, r.del]) assert(a.contrast >= 4.5, `${leg}: ${a.name} contrast ${a.contrast.toFixed(2)} at rest`);
      }
      if (alwaysShown) assert(!isRed(r.del.color), `${leg}: Delete is red at rest ${JSON.stringify(r.del.color)}`);
      // One layout at every width and pointer (UX on #2102): the actions sit
      // on the meta line at the row's right edge, below the title, so the
      // title keeps the row's width.
      assert(r.rename.box.top >= r.title.bottom - 0.5, `${leg}: actions must sit below the title line`);
      assert(r.del.box.right >= r.li.right - 8, `${leg}: actions should sit at the row's right edge`);
      assert(r.title.right <= r.badge.left + 0.5 && r.titleLine.width >= r.li.width - 25, `${leg}: the title line lost its width to the actions`);
      // With a mouse the count and time hug the title rather than floating in
      // the 44px line. On touch the row button itself is a 44px target, so
      // the gap below the title is that target's (acceptance 3: the actions
      // never overlap the row's tap target).
      // The action labels read as part of the meta line, not below it.
      assert(Math.abs(r.rename.label.top - r.meta.top) <= 3, `${leg}: Rename's label is ${(r.rename.label.top - r.meta.top).toFixed(1)}px off the meta line`);
      if (!touch) assert(r.meta.top - r.title.bottom <= 8, `${leg}: meta line is ${(r.meta.top - r.title.bottom).toFixed(1)}px below the title`);
      // The count's plural, and the separator only when there is a time to
      // separate (portal#2104): A has 3 messages and a time, B 1 and none.
      assert.match(r.metaText, /^3 msgs · \S/, `${leg}: A's meta line reads "${r.metaText}"`);
      const rb = await row(page, B);
      assert.equal(rb.metaText, '1 msg', `${leg}: B's meta line reads "${rb.metaText}"`);

      // A real pointer at Rename's centre must activate Rename itself,
      // not the stretched opener behind it (including touch hit adjustment).
      r = await row(page, A);
      const renamePoint = { x: r.rename.box.left + r.rename.box.width / 2, y: r.rename.box.top + r.rename.box.height / 2 };
      if (touch) await page.touchscreen.tap(renamePoint.x, renamePoint.y);
      else await page.mouse.click(renamePoint.x, renamePoint.y);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      assert.equal(await page.evaluate(() => window.__chat.calls.resume), 0, `${leg}: pointer Rename opened the chat`);
      assert.equal(await page.locator('#panel li input[type="text"]').count(), 1, `${leg}: pointer Rename did not open its input`);
      if (control === 'rename-overlay') await page.locator('#panel li input[type="text"]').evaluate(input => {
        // A simultaneous opener over the input, modelling a future DOM regression.
        const opener = document.createElement('button');
        opener.style.cssText = 'position:absolute;inset:0;z-index:50';
        opener.onclick = () => { window.__chat.calls.resume++; };
        input.parentElement.append(opener);
      });
      await page.keyboard.press('Escape');
      await page.locator('#panel li input[type="text"]').waitFor({ state: 'detached' });

      // ── Hover reveals (wide, mouse) ───────────────────────────────────
      if (!touch) {
        await page.locator('[data-chat-row]').first().hover();
        r = await row(page, A);
        for (const a of [r.rename, r.del]) {
          assert.equal(a.opacity, 1, `${leg}: ${a.name} hidden on hover`);
          assert(a.contrast >= 4.5, `${leg}: ${a.name} contrast ${a.contrast.toFixed(2)} on hover`);
        }
        // Hovering Delete itself turns it red; Rename stays neutral.
        await page.getByRole('button', { name: `Delete chat ${A}`, exact: true }).hover();
        r = await row(page, A);
        assert(isRed(r.del.color), `${leg}: Delete is not red on hover ${JSON.stringify(r.del.color)}`);
        assert(r.del.contrast >= 4.5, `${leg}: Delete contrast ${r.del.contrast.toFixed(2)} on hover`);
        await page.getByRole('button', { name: `Rename chat ${A}`, exact: true }).hover();
        r = await row(page, A);
        assert(!isRed(r.rename.color), `${leg}: Rename is red on hover ${JSON.stringify(r.rename.color)}`);
        await page.mouse.move(1, 1);
      }

      // ── Keyboard: row, Rename, Delete; visible when focused ───────────
      await page.locator('[data-chat-row]').first().focus();
      for (const verb of ['Rename', 'Delete']) {
        await page.keyboard.press('Tab');
        assert.equal(await focused(page), `${verb} chat ${A}`, `${leg}: Tab should reach ${verb} next`);
        r = await row(page, A);
        const a = verb === 'Rename' ? r.rename : r.del;
        assert.equal(a.opacity, 1, `${leg}: ${verb} is focused while invisible`);
        assert(a.focusRing, `${leg}: ${verb} has no visible focus ring`);
        assert(a.ringContrast >= 3, `${leg}: ${verb} focus ring contrast ${a.ringContrast.toFixed(2)} against the row`);
        assert(a.contrast >= 4.5, `${leg}: ${verb} contrast ${a.contrast.toFixed(2)} when focused`);
      }
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate((b) => !!document.activeElement?.matches('[data-chat-row]') && document.activeElement.textContent.includes(b), B),
        true,
        `${leg}: after Delete, Tab should reach the next row`,
      );

      // ── Rename: Space opens, Escape cancels, Enter commits ───────────
      await page.getByRole('button', { name: `Rename chat ${A}`, exact: true }).focus();
      await page.keyboard.press('Space');
      const input = page.locator('#panel li input[type="text"]');
      await input.waitFor();
      assert.equal(await input.evaluate((el) => el === document.activeElement), true, `${leg}: rename input not focused`);
      await page.keyboard.press('Escape');
      await input.waitFor({ state: 'detached' });
      assert.equal(await focused(page), `Rename chat ${A}`, `${leg}: Escape should return focus to Rename`);
      assert.equal(await page.evaluate(() => window.__chat.calls.title), 0, `${leg}: Escape must not save`);
      await page.keyboard.press('Enter');
      await input.waitFor();
      await input.fill('Renamed chat');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Rename chat Renamed chat', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__chat.calls.title), 1, `${leg}: Enter should save once`);
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Rename chat Renamed chat');
      assert.equal(await page.evaluate(() => window.__chat.calls.resume), 0, `${leg}: an action must not open the chat`);

      // ── Delete: Cancel returns focus; confirm moves it on ─────────────
      const deleteA = page.getByRole('button', { name: 'Delete chat Renamed chat', exact: true });
      if (touch) await deleteA.tap();
      else await deleteA.click();
      const dialog = page.getByRole('heading', { name: 'Delete this chat?' });
      await dialog.waitFor();
      assert.equal(await page.evaluate(() => window.__chat.calls.resume), 0, `${leg}: tapping Delete must not open the chat`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Delete chat Renamed chat');
      await page.keyboard.press('Enter');
      await dialog.waitFor();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('button', { name: 'Rename chat Renamed chat', exact: true }).waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.__chat.calls.delete), 1, `${leg}: confirm should delete once`);
      await page.waitForFunction((b) => document.activeElement?.matches('[data-chat-row]') && document.activeElement.textContent.includes(b), B);
      // The last chat: focus falls back to "+ New chat".
      await page.getByRole('button', { name: `Delete chat ${B}`, exact: true }).click();
      await dialog.waitFor();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '+ New chat');

      // ── Selected row (two panes): revealed, readable ──────────────────
      assert.deepEqual(errors, [], `${leg}: page errors`);
      await context.close();

      if (!narrow) {
        const sel = await open(width, dark, touch);
        await sel.page.getByRole('button', { name: new RegExp(A.slice(0, 20)) }).first().click();
        await sel.page.getByText('Which weeks work best').waitFor();
        await sel.page.mouse.move(1, 1);
        const s = await row(sel.page, A);
        for (const a of [s.rename, s.del]) {
          assert.equal(a.opacity, 1, `${leg}: ${a.name} hidden on the selected row`);
          assert(a.contrast >= 4.5, `${leg}: ${a.name} contrast ${a.contrast.toFixed(2)} on the selected row`);
        }
        // The focus ring on the selected row's background (portal#2104).
        await sel.page.locator('[data-chat-row]').first().focus();
        for (const verb of ['Rename', 'Delete']) {
          await sel.page.keyboard.press('Tab');
          assert.equal(await focused(sel.page), `${verb} chat ${A}`, `${leg}: Tab should reach ${verb} on the selected row`);
          const a = (await row(sel.page, A))[verb === 'Rename' ? 'rename' : 'del'];
          assert(a.focusRing, `${leg}: ${verb} has no visible focus ring on the selected row`);
          assert(a.ringContrast >= 3, `${leg}: ${verb} focus ring contrast ${a.ringContrast.toFixed(2)} on the selected row`);
        }
        if (shots) await sel.page.screenshot({ path: `${shots}/${leg.replace(/[ /]/g, '-')}-selected.png` });
        assert.deepEqual(sel.errors, [], `${leg}: page errors (selected)`);
        await sel.context.close();
      }
      // ── A slow delete must not take focus the person has since moved ──
      // (LOCAL on #2102): with B open, confirm deleting A while its answer is
      // held, click into B's composer and type, then release the answer.
      // Focus stays in the composer and no keystroke is lost.
      if (!narrow && !touch) {
        const slow = await open(width, dark, touch);
        const p = slow.page;
        await p.getByRole('button', { name: /^Second chat/ }).first().click();
        const composer = p.getByPlaceholder(/Type your message/);
        await composer.waitFor();
        await p.evaluate(() => { window.__release = window.__chat.holdDelete(); });
        await p.getByRole('button', { name: `Delete chat ${A}`, exact: true }).click();
        await p.getByRole('heading', { name: 'Delete this chat?' }).waitFor();
        await p.getByRole('button', { name: 'Delete', exact: true }).click();
        await composer.click();
        await p.keyboard.type('keep typing');
        await p.evaluate(() => window.__release());
        await p.getByRole('button', { name: `Rename chat ${A}`, exact: true }).waitFor({ state: 'detached' });
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await p.keyboard.type(' after response');
        assert.equal(await p.evaluate(() => document.activeElement?.tagName), 'TEXTAREA', `${leg}: a slow delete moved focus out of the composer`);
        assert.equal(await composer.inputValue(), 'keep typing after response', `${leg}: keystrokes lost after a slow delete`);
        assert.equal(await p.evaluate(() => window.__chat.calls.delete), 1, `${leg}: slow delete should call once`);
        assert.deepEqual(slow.errors, [], `${leg}: page errors (slow delete)`);
        await slow.context.close();
      }
      // ── A failed delete hands focus back to that row's Delete ─────────
      // (portal#2104). The dialog closes, the chat stays, the error shows in
      // the existing turn-error copy. A network failure at every leg; the
      // three failure shapes at 1024 light.
      const kinds = width === 1024 && !touch && !dark ? ['network', 'json', 'text'] : ['network'];
      const MESSAGE = { network: 'Failed to fetch', json: 'Delete refused', text: 'Failed' };
      for (const kind of kinds) {
        const f = await open(width, dark, touch);
        const p = f.page;
        const before = await p.evaluate(() => location.href);
        await p.evaluate((k) => window.__chat.failDelete(k), kind);
        const del = p.getByRole('button', { name: `Delete chat ${A}`, exact: true });
        if (touch) await del.tap();
        else await del.click();
        await p.getByRole('heading', { name: 'Delete this chat?' }).waitFor();
        await p.getByRole('button', { name: 'Delete', exact: true }).click();
        await p.getByRole('heading', { name: 'Delete this chat?' }).waitFor({ state: 'detached' });
        await p.getByRole('alert').filter({ hasText: MESSAGE[kind] }).waitFor();
        await p.waitForFunction((name) => document.activeElement?.getAttribute('aria-label') === name, `Delete chat ${A}`, { timeout: 2000 })
          .catch(async () => assert.fail(`${leg} ${kind}: focus is on ${JSON.stringify(await focused(p))} after a failed delete, not Delete chat ${A}`));
        assert.equal(await p.getByRole('alert').count(), 1, `${leg} ${kind}: one error copy should show`);
        assert.equal((await p.getByRole('alert').textContent()).trim(), MESSAGE[kind], `${leg} ${kind}: error text`);
        assert.equal(await p.evaluate(() => window.__chat.calls.delete), 1, `${leg} ${kind}: one delete call`);
        assert.equal(await p.getByRole('button', { name: `Rename chat ${A}`, exact: true }).count(), 1, `${leg} ${kind}: the chat should still be listed`);
        assert.equal(await p.evaluate(() => location.href), before, `${leg} ${kind}: the URL changed`);
        assert.equal(await p.evaluate(() => window.__chat.calls.resume), 0, `${leg} ${kind}: no chat should open`);
        assert.deepEqual(f.errors, [], `${leg} ${kind}: page errors (failed delete)`);
        await f.context.close();
      }
      // With a chat open, the error shows in the conversation pane and the
      // open chat stays as it was.
      if (!narrow) {
        const f = await open(width, dark, touch);
        const p = f.page;
        await p.getByRole('button', { name: /^Second chat/ }).first().click();
        await p.getByPlaceholder(/Type your message/).waitFor();
        const before = await p.evaluate(() => location.href);
        await p.evaluate(() => window.__chat.failDelete('json'));
        await p.getByRole('button', { name: `Delete chat ${A}`, exact: true }).click();
        await p.getByRole('heading', { name: 'Delete this chat?' }).waitFor();
        await p.getByRole('button', { name: 'Delete', exact: true }).click();
        await p.locator('main').getByText(MESSAGE.json, { exact: true }).waitFor();
        await p.waitForFunction((name) => document.activeElement?.getAttribute('aria-label') === name, `Delete chat ${A}`, { timeout: 2000 })
          .catch(async () => assert.fail(`${leg} open chat: focus is on ${JSON.stringify(await focused(p))} after a failed delete, not Delete chat ${A}`));
        assert.equal(await p.evaluate(() => location.href), before, `${leg} open chat: the URL changed`);
        assert.equal(await p.getByRole('heading', { name: B }).count(), 1, `${leg} open chat: the open chat changed`);
        assert.equal(await p.getByRole('button', { name: `Rename chat ${A}`, exact: true }).count(), 1, `${leg} open chat: the chat should still be listed`);
        assert.deepEqual(f.errors, [], `${leg}: page errors (failed delete, chat open)`);
        await f.context.close();
      }
      // One pane: open a chat, go Back to the list, then a delete fails.
      // The chat stays selected behind the list, and the error must show in
      // the list, the pane on screen (Chip's QA on #2110).
      if (narrow) {
        const f = await open(width, dark, touch);
        const p = f.page;
        await p.locator('[data-chat-row="chats:b"]').click();
        await p.getByRole('button', { name: 'Back to chats' }).click();
        const del = p.getByRole('button', { name: `Delete chat ${A}`, exact: true });
        await del.waitFor();
        await p.evaluate(() => window.__chat.failDelete('network'));
        if (touch) await del.tap();
        else await del.click();
        await p.getByRole('heading', { name: 'Delete this chat?' }).waitFor();
        await p.getByRole('button', { name: 'Delete', exact: true }).click();
        await p.waitForFunction((name) => document.activeElement?.getAttribute('aria-label') === name, `Delete chat ${A}`, { timeout: 2000 })
          .catch(async () => assert.fail(`${leg} after Back: focus is on ${JSON.stringify(await focused(p))} after a failed delete`));
        await p.getByRole('alert').filter({ hasText: MESSAGE.network }).waitFor({ timeout: 2000 })
          .catch(() => assert.fail(`${leg} after Back: the failed delete's error is not shown in the list`));
        assert.equal(await p.getByRole('alert').count(), 1, `${leg} after Back: one error copy should show`);
        assert(await p.getByRole('alert').evaluate((el) => !!el.closest('aside')), `${leg} after Back: the error should show in the list`);
        // A chat's own error keeps to its pane, even with the same text as the
        // list's earlier one (Gene's and Gloria's deltas on #2110): open B, a
        // send fails with "Failed to fetch", Back shows the list with no alert.
        await p.locator('[data-chat-row="chats:b"]').click();
        const composer = p.getByPlaceholder(/Type your message/);
        await composer.waitFor();
        await p.evaluate(() => window.__chat.failTurn());
        await composer.fill('hello');
        await composer.press('Enter');
        await p.locator('main').getByText(MESSAGE.network, { exact: true }).waitFor();
        await p.getByRole('button', { name: 'Back to chats' }).click();
        await p.getByRole('button', { name: `Delete chat ${A}`, exact: true }).waitFor();
        assert.equal(await p.getByRole('alert').count(), 0, `${leg} after Back: a chat's own error showed in the list`);
        assert.deepEqual(f.errors, [], `${leg}: page errors (failed delete after Back)`);
        await f.context.close();
      }
      // A slow failure must not take focus the person has since moved, the
      // same as a slow success (#2102's ownership rule).
      if (!narrow && !touch) {
        const slow = await open(width, dark, touch);
        const p = slow.page;
        await p.getByRole('button', { name: /^Second chat/ }).first().click();
        const composer = p.getByPlaceholder(/Type your message/);
        await composer.waitFor();
        await p.evaluate(() => { window.__chat.failDelete('network'); window.__release = window.__chat.holdDelete(); });
        await p.getByRole('button', { name: `Delete chat ${A}`, exact: true }).click();
        await p.getByRole('heading', { name: 'Delete this chat?' }).waitFor();
        await p.getByRole('button', { name: 'Delete', exact: true }).click();
        await composer.click();
        await p.keyboard.type('keep typing');
        await p.evaluate(() => window.__release());
        await p.locator('main').getByText(MESSAGE.network, { exact: true }).waitFor();
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await p.keyboard.type(' after failure');
        assert.equal(await p.evaluate(() => document.activeElement?.tagName), 'TEXTAREA', `${leg}: a slow failed delete moved focus out of the composer`);
        assert.equal(await composer.inputValue(), 'keep typing after failure', `${leg}: keystrokes lost after a slow failed delete`);
        assert.equal(await p.evaluate(() => window.__chat.calls.delete), 1, `${leg}: slow failed delete should call once`);
        assert.deepEqual(slow.errors, [], `${leg}: page errors (slow failed delete)`);
        await slow.context.close();
      }
      if (shots) {
        const shot = await open(width, dark, touch);
        await shot.page.mouse.move(1, 1);
        await shot.page.screenshot({ path: `${shots}/${leg.replace(/[ /]/g, '-')}-list.png` });
        assert.deepEqual(shot.errors, [], `${leg}: page errors (screenshot)`);
        await shot.context.close();
      }
      console.log(`${leg}: ok (chat ${panelWidth}px, ${alwaysShown ? 'actions shown' : 'actions quiet'}, meta line)`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
