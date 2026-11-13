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
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  assert(css.length > 1000, 'compiled app.css was not served');
  browser = await chromium.launch({ headless: true });
  if (shots) await mkdir(shots, { recursive: true });

  /** The App page's shell (nav from `sm`) around the Agent chat panel, the real component in it. */
  async function open(width, dark, touch) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, isMobile: touch });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
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
        await page.evaluate(async () => {
          const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
          window.__chat = mountAgentChat(document.getElementById('panel'), { rowActions: true });
        });
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
      const contrast = (el) => {
        const s = getComputedStyle(el);
        // Effective text colour: its own alpha and every ancestor's opacity.
        let alpha = rgba(s.color)[3];
        for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
        const bg = background(el);
        const fg = over([...rgba(s.color).slice(0, 3), alpha], bg);
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
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
        };
      };
      return {
        li: box(li),
        row: box(button),
        title: box(titleEl),
        badge: box(badge),
        // The count and time: the first text of the line after the row button.
        meta: box(button.nextElementSibling.querySelector('span')),
        rename: part(action('Rename')),
        del: part(action('Delete')),
        coarse: matchMedia('(pointer: coarse)').matches,
      };
    }, title);

  const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const isRed = ([r, g, b]) => r > g + 60 && r > b + 60;
  const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');

  // 390 touch: phone, one pane. 640/768 fine: the App nav leaves the panel
  // below @2xl. 1024 fine: wide panel, quiet actions. 1024 touch: a touch
  // tablet with the 256px list (actions on the meta line).
  const LEGS = [
    { width: 390, touch: true },
    { width: 640, touch: false },
    { width: 768, touch: false },
    { width: 1024, touch: false },
    { width: 1024, touch: true },
  ];
  for (const { width, touch } of LEGS) {
    for (const dark of [false, true]) {
      const leg = `${width}${touch ? ' touch' : ''}/${dark ? 'dark' : 'light'}`;
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
      assert(r.title.right <= r.badge.left + 0.5 && r.badge.right >= r.li.right - 120, `${leg}: the title line lost its width to the actions`);
      // With a mouse the count and time hug the title rather than floating in
      // the 44px line. On touch the row button itself is a 44px target, so
      // the gap below the title is that target's (acceptance 3: the actions
      // never overlap the row's tap target).
      // The action labels read as part of the meta line, not below it.
      assert(Math.abs(r.rename.label.top - r.meta.top) <= 3, `${leg}: Rename's label is ${(r.rename.label.top - r.meta.top).toFixed(1)}px off the meta line`);
      if (!touch) assert(r.meta.top - r.title.bottom <= 8, `${leg}: meta line is ${(r.meta.top - r.title.bottom).toFixed(1)}px below the title`);

      // ── Hover reveals (wide, mouse) ───────────────────────────────────
      if (!touch) {
        await page.locator('[data-chat-row]').first().hover();
        r = await row(page, A);
        for (const a of [r.rename, r.del]) {
          assert.equal(a.opacity, 1, `${leg}: ${a.name} hidden on hover`);
          assert(a.contrast >= 4.5, `${leg}: ${a.name} contrast ${a.contrast.toFixed(2)} on hover`);
        }
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
        if (shots) await sel.page.screenshot({ path: `${shots}/${leg.replace(/[ /]/g, '-')}-selected.png` });
        assert.deepEqual(sel.errors, [], `${leg}: page errors (selected)`);
        await sel.context.close();
      }
      if (shots) {
        const shot = await open(width, dark, touch);
        await shot.page.mouse.move(1, 1);
        await shot.page.screenshot({ path: `${shots}/${leg.replace(/[ /]/g, '-')}-list.png` });
        await shot.context.close();
      }
      console.log(`${leg}: ok (chat ${panelWidth}px, ${alwaysShown ? 'actions shown' : 'actions quiet'}, meta line)`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
