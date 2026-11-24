// portal#2621 QA phase 2: origin-less portal, same persistent profile — the staged rows
// render the UNLINKED hint (:else of ceremonyUrl) beside Withdraw. Matrix 320/360/414/768
// × light/dark: no horizontal page scroll, hint and Withdraw inside the card, no overlap,
// Withdraw below the hint; screenshot every cell. No reloads (a client abort kills them):
// viewport resize reflows flex-wrap live; the theme is the `dark` class on <html>, the same
// switch the app itself and the author's pin use.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const PORTAL = 'http://localhost:18516';
const SECRETS = `${PORTAL}/app/apps/0fcf657da155d267b1dccb17a2b92b2e/secrets`;
mkdirSync('qa-2621/shots', { recursive: true });

const ctx = await chromium.launchPersistentContext('/home/orca/scratch/caspian/qa2621-profile', {
  headless: true, viewport: { width: 1280, height: 900 },
});
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on('dialog', (d) => d.accept().catch(() => {}));
await page.goto(SECRETS, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('[data-testid="pending-change-actions"]', { timeout: 30000 });
await page.waitForTimeout(1200);
const body = await page.textContent('body');
console.log('unlinked hint rendered:', body.includes('staged on the server'));
console.log('signing link gone:', !body.includes('Open the signing page'));
console.log('withdraw present:', body.includes('Withdraw'));

const results = [];
for (const width of [320, 360, 414, 768]) {
  for (const dark of [false, true]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((d) => {
      localStorage.setItem('theme', d ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', d);
    }, dark);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForSelector('[data-testid="pending-change-actions"]', { timeout: 30000 });
    await page.waitForTimeout(800);
    const cell = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="pending-change"]')];
      const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
      return rows.map((card) => {
        const row = card.querySelector('[data-testid="pending-change-actions"]');
        const hint = row.querySelector('p');
        const withdraw = [...row.querySelectorAll('button')].find(b => /withdraw/i.test(b.textContent));
        return {
          name: (card.textContent.match(/^[^\\n]{0,40}/) || [''])[0].trim(),
          viewport: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          card: box(card), hint: box(hint), withdraw: box(withdraw),
          darkClass: document.documentElement.classList.contains('dark'),
        };
      });
    });
    const tag = `${width}-${dark ? 'dark' : 'light'}`;
    await page.screenshot({ path: `qa-2621/shots/matrix-${tag}.png`, fullPage: false });
    for (const m of cell) {
      const noHScroll = m.scrollWidth <= m.viewport;
      const insideCard = m.hint.left >= m.card.left - 0.5 && m.hint.right <= m.card.right + 0.5
        && m.withdraw.left >= m.card.left - 0.5 && m.withdraw.right <= m.card.right + 0.5;
      const overlap = m.hint.left < m.withdraw.right && m.withdraw.left < m.hint.right
        && m.hint.top < m.withdraw.bottom && m.withdraw.top < m.hint.bottom;
      const below = m.withdraw.top >= m.hint.bottom - 0.5;
      const hintWrapsOwnWidth = m.hint.width < m.viewport;
      results.push({ cell: tag, dark: m.darkClass, viewport: m.viewport, scrollWidth: m.scrollWidth,
        noHScroll, insideCard, overlap, withdrawBelowHint: below, hintWrapsOwnWidth,
        gap: +(m.withdraw.top - m.hint.bottom).toFixed(1) });
    }
  }
}
writeFileSync('qa-2621/matrix-results.json', JSON.stringify(results, null, 1));
for (const r of results) console.log(JSON.stringify(r));
await ctx.close();
process.exit(0);
