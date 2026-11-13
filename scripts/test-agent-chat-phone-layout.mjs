// portal#2088: App agent chat at phone and desktop widths, real Chromium with
// the compiled app CSS and the real AgentChat. Synthetic chat API answers come
// from src/lib/test/fixtures/agent-chat-phone-harness.ts; no server, provider
// or signed-in route. Independent QA owns the signed-in route matrix.
//
// jsdom has no layout, so these are the only checks that prove the panes
// actually collapse below `sm` (640px): measured widths, computed visibility
// and the element that holds focus, never class names.
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
const WARM = 'rgb(251, 133, 0)';
const ROW = 'Planning the spring onboarding';
const shots = process.env.AGENT_CHAT_SHOTS;
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const css = await (await fetch(new URL('src/app.css?direct', origin))).text();
  assert(css.length > 1000, 'compiled app.css was not served');
  browser = await chromium.launch({ headless: true });
  if (shots) await mkdir(shots, { recursive: true });

  /** A fresh page with the App page's chat wrapper, the real component mounted in it. */
  async function open(width, dark, { query = '', refuseStart = false } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/__chat_fixture*', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Agent chat fixture</title>' }),
    );
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(new URL(`/__chat_fixture${query}`, origin).href);
        await page.evaluate(
          ({ css, dark }) => {
            document.head.innerHTML += `<style>${css}</style>`;
            document.documentElement.classList.toggle('dark', dark);
            document.body.className = 'bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100';
            // The app shell of src/routes/app/+layout.svelte (gutters, gap and
            // the w-48 nav that shows from `sm`), around the same wrapper as
            // src/routes/app/apps/[appId]/+page.svelte's Agent chat panel.
            // Without the nav the panel is ~200px wider than on the real page
            // at 640-900, which hid a 26px composer
            // (https://github.com/hadron-memory/hadron-portal/pull/2090#issuecomment-6843123916).
            document.body.innerHTML = `<div class="flex gap-4 px-4 py-8 sm:gap-8 sm:px-6">
              <aside class="w-48 shrink-0 flex-col hidden sm:flex"><nav>Nav</nav></aside>
              <div class="min-w-0 flex-1">
                <div class="flex flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
                  <div id="panel" class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"></div>
                </div></div></div>`;
          },
          { css, dark },
        );
        await page.evaluate(async (refuseStart) => {
          const { mountAgentChat } = await import('/src/lib/test/fixtures/agent-chat-phone-harness.ts');
          window.__chat = mountAgentChat(document.getElementById('panel'), { refuseStart });
        }, refuseStart);
        break;
      } catch (e) {
        if (attempt >= 5 || !/Execution context was destroyed|navigation/i.test(String(e))) throw e;
      }
    }
    // Attached, not visible: a deep link opens on the conversation, and below
    // `sm` the list is then display:none.
    await page.locator('[data-chat-row]').first().waitFor({ state: 'attached' });
    return { page, errors };
  }

  const panes = (page) =>
    page.evaluate(() => {
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      const panel = document.getElementById('panel');
      const aside = panel.querySelector('aside');
      const main = panel.querySelector('main');
      return {
        panel: panel.clientWidth,
        // The size container: AgentChat's root, inside the panel's border.
        container: panel.firstElementChild.clientWidth,
        aside: aside.checkVisibility() ? box(aside).width : 0,
        main: main.checkVisibility() ? box(main).width : 0,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

  /**
   * Elements inside AgentChat's size container that compute to
   * position:fixed. Throws if the container itself is missing, so a drifted
   * id or class can't turn the check into a vacuous pass.
   */
  const fixedInContainer = (page) =>
    page.evaluate(() => {
      // getAttribute, not className: an SVG's className is an object.
      const label = (el) => el.tagName + '.' + (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.');
      const root = document.getElementById('panel')?.firstElementChild;
      if (!root || getComputedStyle(root).containerType !== 'inline-size') {
        throw new Error(`size container not found (got ${root ? label(root) : 'nothing'})`);
      }
      return [...root.querySelectorAll('*')].filter((el) => getComputedStyle(el).position === 'fixed').map(label);
    });

  // One pane while the chat's own width is below 42rem (672px), whatever
  // the viewport: on the App page the nav takes ~220px from `sm` up, so a
  // 640-900px window still has a phone-sized panel. 947/948 sit either side
  // of the switch (container 671/672px): the two-pane side's textarea there
  // is the narrowest any width gets, and must still clear 200px.
  const ONE_PANE_BELOW = 672;
  for (const width of [320, 390, 640, 700, 768, 900, 947, 948, 1024, 1440]) {
    for (const dark of [false, true]) {
      const leg = `${width}/${dark ? 'dark' : 'light'}`;
      const probe = await open(width, dark);
      const panelWidth = (await panes(probe.page)).container;
      const phone = panelWidth < ONE_PANE_BELOW;
      await probe.page.close();

      // ── No link: the list ───────────────────────────────────────────
      const { page, errors } = await open(width, dark);
      let p = await panes(page);
      assert.equal(p.pageOverflow, false, `${leg}: page scrolls sideways (list)`);
      if (phone) {
        assert(near(p.aside, p.panel), `${leg}: list should fill the panel, got ${p.aside} of ${p.panel}`);
        assert.equal(p.main, 0, `${leg}: conversation pane must be hidden while the list shows`);
      } else {
        assert(near(p.aside, 256, 1), `${leg}: desktop list should stay 256px, got ${p.aside}`);
        assert(p.main > 0, `${leg}: desktop conversation pane must stay visible`);
      }

      // ── An overlay: the delete dialog covers the window, not the panel ──
      // Overlays only exist after an interaction, so drive one: a fixed
      // dialog inside the size container would be sized to the panel.
      await page.locator('[data-chat-row]').first().hover();
      await page.getByTitle('Delete').first().click();
      const dialog = await page.getByText('Delete this chat?').evaluate((h) => {
        const el = h.closest('.fixed');
        const r = el?.getBoundingClientRect();
        return el && {
          position: getComputedStyle(el).position,
          inContainer: document.getElementById('panel').firstElementChild.contains(el),
          box: [r.left, r.top, r.width, r.height].map(Math.round),
          window: [0, 0, innerWidth, innerHeight],
        };
      });
      assert(dialog, `${leg}: the delete dialog's overlay is missing`);
      assert.equal(dialog.position, 'fixed', `${leg}: the delete dialog is not position:fixed`);
      assert.equal(dialog.inContainer, false, `${leg}: the delete dialog renders inside the size container`);
      assert.deepEqual(dialog.box, dialog.window, `${leg}: the delete dialog should cover the window`);
      assert.deepEqual(await fixedInContainer(page), [], `${leg}: position:fixed inside the size container (dialog open)`);
      await page.getByRole('button', { name: 'Cancel' }).click();
      assert.equal(await page.getByText('Delete this chat?').count(), 0, `${leg}: Cancel should close the delete dialog`);

      // ── Open a chat: the conversation ──────────────────────────────
      await page.getByRole('button', { name: new RegExp(ROW) }).click();
      await page.getByText('Which weeks work best').waitFor();
      p = await panes(page);
      const textarea = await page.locator('textarea').evaluate((el) => el.getBoundingClientRect().width);
      // Every leg, one pane or two. On two panes `@2xl:min-w-0` drops the
      // phone's CSS floor, so the narrowest two-pane chat (948) has to clear
      // 200px on its own: a wider Send at @2xl fails here with 184px.
      assert(textarea >= 200, `${leg}: textarea is ${textarea}px wide, below 200px`);
      assert.equal(p.pageOverflow, false, `${leg}: page scrolls sideways (conversation)`);
      if (phone) {
        assert.equal(p.aside, 0, `${leg}: list must be hidden while a chat is open`);
        assert(near(p.main, p.panel), `${leg}: conversation should fill the panel, got ${p.main} of ${p.panel}`);
      } else {
        assert(near(p.aside, 256, 1) && p.main > 0, `${leg}: desktop keeps both panes, got ${JSON.stringify(p)}`);
      }
      // The root is a size container, which makes it the containing block
      // for position:fixed descendants
      // (https://github.com/hadron-memory/hadron-portal/pull/2090#issuecomment-6844862382):
      // a fixed overlay inside it would anchor to and clip at the panel. None
      // may exist; the delete dialog renders as the root's sibling (and is
      // opened on the list, above).
      const fixedInside = await fixedInContainer(page);
      assert.deepEqual(fixedInside, [], `${leg}: position:fixed inside the size container`);
      const contained = await page.evaluate(() => {
        const main = document.querySelector('#panel main');
        const m = main.getBoundingClientRect();
        const outside = [...main.querySelectorAll('header, [role="alert"], .rounded-2xl, textarea, button, select')]
          .filter((el) => el.checkVisibility())
          .map((el) => ({ el: el.tagName + '.' + (el.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.'), r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.left < m.left - 0.5 || r.right > m.right + 0.5)
          .map(({ el, r }) => `${el} [${Math.round(r.left)}..${Math.round(r.right)}]`);
        const header = main.querySelector('header');
        return { outside, headerOverflow: header.scrollWidth > header.clientWidth + 1 };
      });
      assert.deepEqual(contained.outside, [], `${leg}: content escapes the conversation pane`);
      assert.equal(contained.headerOverflow, false, `${leg}: stage header overflows`);
      assert(await page.getByRole('button', { name: 'Send' }).isVisible(), `${leg}: Send hidden`);
      assert(await page.getByLabel('AI config').isVisible(), `${leg}: AI config row hidden`);

      const back = page.getByRole('button', { name: 'Back to chats' });
      if (phone) {
        assert(await back.isVisible(), `${leg}: Back control missing`);
        const b = await back.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return { w: r.width, h: r.height, tag: el.tagName, text: el.textContent.trim(), colors: [s.color, s.backgroundColor, s.borderColor] };
        });
        assert.equal(b.tag, 'BUTTON', `${leg}: Back must be a native button`);
        assert.match(b.text, /Chats/, `${leg}: Back needs the visible label "Chats"`);
        assert(b.w >= 44 && b.h >= 44, `${leg}: Back target is ${b.w}x${b.h}, below 44px`);
        assert(!b.colors.includes(WARM), `${leg}: Back uses the warm accent ${JSON.stringify(b.colors)}`);
        assert.equal(
          await page.evaluate(() => document.activeElement?.tagName === 'H3' && document.activeElement.closest('main') !== null),
          true,
          `${leg}: opening a chat should focus the conversation heading`,
        );
        // The hidden list cannot take focus: walk Tab through the whole page.
        const reached = await page.evaluate(() => {
          const all = [...document.querySelectorAll('#panel button, #panel textarea, #panel select, #panel input, #panel [tabindex]')];
          return all.filter((el) => el.closest('aside') && el.checkVisibility()).length;
        });
        assert.equal(reached, 0, `${leg}: a control in the hidden list is still rendered`);
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press('Tab');
          const inAside = await page.evaluate(() => !!document.activeElement?.closest('aside'));
          assert.equal(inAside, false, `${leg}: Tab reached the hidden list`);
        }

        // ── Back: the list again, chat kept, ?chat cleared ───────────
        const resumes = await page.evaluate(() => window.__chat.calls.resume);
        await back.click();
        p = await panes(page);
        assert(near(p.aside, p.panel) && p.main === 0, `${leg}: Back should show only the list, got ${JSON.stringify(p)}`);
        const afterBack = await page.evaluate(() => ({
          focus: document.activeElement?.textContent ?? '',
          url: String(window.__chat.navigationCalls.at(-1)?.args[0] ?? ''),
        }));
        assert.match(afterBack.focus, new RegExp(ROW), `${leg}: Back should focus the selected row`);
        assert(afterBack.url && !afterBack.url.includes('chat='), `${leg}: Back must clear ?chat, last sync ${afterBack.url}`);
        assert.equal(await page.getByText('Which weeks work best').count(), 1, `${leg}: Back should keep exactly one copy of the transcript`);

        // ── Reselect the same retained chat ──────────────────────────
        await page.getByRole('button', { name: new RegExp(ROW) }).click();
        p = await panes(page);
        assert(p.aside === 0 && near(p.main, p.panel), `${leg}: reselecting the same chat must reopen it, got ${JSON.stringify(p)}`);
        assert(await page.getByText('Which weeks work best').isVisible(), `${leg}: reopened chat lost its messages`);
        const reopened = await page.evaluate(() => ({
          url: String(window.__chat.navigationCalls.at(-1)?.args[0] ?? ''),
          resumes: window.__chat.calls.resume,
          heading: document.activeElement?.tagName === 'H3',
        }));
        assert.match(reopened.url, /chat=chats%3Aa/, `${leg}: reopening must restore ?chat`);
        assert.equal(reopened.resumes, resumes, `${leg}: reopening the retained chat should not refetch it`);
        assert(reopened.heading, `${leg}: reopening should focus the conversation heading`);
        assert.deepEqual(
          await page.evaluate(() => ({ start: window.__chat.calls.start, writes: window.__chat.calls.writes })),
          { start: 0, writes: 0 },
          `${leg}: Back and reopen must send no chat write`,
        );
        await back.click();
        if (shots) await page.screenshot({ path: `${shots}/${leg.replace('/', '-')}-list.png` });
      } else {
        assert.equal(await back.isVisible(), false, `${leg}: Back must not show beside both panes`);
        if (shots) await page.screenshot({ path: `${shots}/${leg.replace('/', '-')}-conversation.png` });
      }
      assert.deepEqual(errors, [], `${leg}: page errors`);
      await page.close();

      // ── Deep link: ?chat=<id> lands on the conversation ────────────
      const deep = await open(width, dark, { query: '?chat=chats%3Aa' });
      await deep.page.getByText('Which weeks work best').waitFor();
      p = await panes(deep.page);
      if (phone) assert(p.aside === 0 && near(p.main, p.panel), `${leg}: deep link should open the conversation, got ${JSON.stringify(p)}`);
      else assert(p.aside > 0 && p.main > 0, `${leg}: desktop deep link keeps both panes`);
      // Captured last on its page: no interaction may follow a screenshot
      // (hrn:node:hadronmemory.com:hadron-portal:findings:playwright-screenshots-after-layout-assertions).
      if (shots && phone) await deep.page.screenshot({ path: `${shots}/${leg.replace('/', '-')}-conversation.png` });
      await deep.page.close();

      // ── Refused start: the alert is readable where the user is ────
      const refused = await open(width, dark, { refuseStart: true });
      await refused.page.getByRole('button', { name: '+ New chat' }).click();
      const alert = refused.page.getByRole('alert').filter({ visible: true });
      await alert.waitFor();
      assert.equal(await alert.count(), 1, `${leg}: exactly one visible refusal`);
      const a = await alert.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const panel = document.getElementById('panel').getBoundingClientRect();
        return { text: el.textContent.trim(), inside: r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5, clipped: el.scrollWidth > el.clientWidth + 1, inList: !!el.closest('aside') };
      });
      const { START_REFUSAL } = await refused.page.evaluate(() => import('/src/lib/test/fixtures/agent-chat-phone-harness.ts').then((m) => ({ START_REFUSAL: m.START_REFUSAL })));
      assert.equal(a.text, START_REFUSAL, `${leg}: refusal wording changed`);
      assert(a.inside, `${leg}: refusal escapes the panel ${JSON.stringify(a)}`);
      assert(!a.clipped, `${leg}: refusal is clipped ${JSON.stringify(a)}`);
      if (phone) {
        assert(a.inList, `${leg}: on a phone the refusal must show in the list view`);
        p = await panes(refused.page);
        assert(near(p.aside, p.panel) && p.main === 0, `${leg}: a refused start stays on the list, got ${JSON.stringify(p)}`);
      }
      if (shots) await refused.page.screenshot({ path: `${shots}/${leg.replace('/', '-')}-refusal.png` });
      await refused.page.close();

      // ── Refused start after Back ────────────────────────────────────
      // https://github.com/hadron-memory/hadron-portal/pull/2090#issuecomment-6843290025
      // Back keeps the selected chat; a refused "+ New chat" from there must
      // still show its alert where the user is, not in the hidden pane.
      if (phone) {
        const again = await open(width, dark, { refuseStart: true });
        await again.page.getByRole('button', { name: new RegExp(ROW) }).click();
        await again.page.getByText('Which weeks work best').waitFor();
        await again.page.getByRole('button', { name: 'Back to chats' }).click();
        await again.page.getByRole('button', { name: '+ New chat' }).click();
        const shown = again.page.getByRole('alert').filter({ visible: true });
        await shown.waitFor();
        assert.equal(await shown.count(), 1, `${leg}: a refused start after Back needs exactly one visible alert`);
        assert(await shown.evaluate((el) => !!el.closest('aside')), `${leg}: after Back the refusal belongs in the list view`);
        assert.deepEqual(again.errors, [], `${leg}: page errors (refusal after Back)`);
        await again.page.close();
      }
      console.log(`${leg}: ok (chat ${panelWidth}px, ${phone ? "one pane" : "two panes"}, textarea ${Math.round(textarea)}px)`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
