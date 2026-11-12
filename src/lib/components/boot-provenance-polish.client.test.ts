// portal#1757: UI, accessibility and i18n polish for the boot prompt provenance table
// and the compile panel (slice of #1683). Written red against main b229b7763.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import BootInstallCompile from './BootInstallCompile.svelte';
import BootProvenance from './BootProvenance.svelte';
import DataTable from './table/DataTable.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { mounted.splice(0).forEach(m => m.unmount()); vi.unstubAllGlobals(); });
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); } }
const URN = 'hrn:node:example.com:install:boot:part';
const row = (over: Record<string, unknown> = {}) => ({
  name: 'Style', urn: URN, omitted: false, depth: 1, revNo: 2,
  selection: { rev: null, approved: false, signed: false }, pruned: false, ...over,
});
async function mountProvenance(items: unknown[], props: { headingLevel?: 3 | 4 } = {}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ page: { items, total: items.length, hasMore: false, pruned: false, offset: 0 } })));
  const m = mountComponent(BootProvenance, { nodeId: 'c', revision: 3, ...props }); mounted.push(m); await settle();
  return m;
}
const read = (name: string) => readFileSync(resolve(process.cwd(), 'src/lib/components', name), 'utf8');
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ');

describe('portal#1757 settings are user wording, not raw fields', () => {
  it.each([
    [{ rev: null, approved: true, signed: false }, ['Latest revision', 'Approved only']],
    [{ rev: 4, approved: false, signed: true }, ['Revision 4', 'Signed only']],
    [{ rev: null, approved: true, signed: true }, ['Latest revision', 'Approved and signed only']],
    [{ rev: null, approved: false, signed: false }, ['Latest revision']],
  ])('renders %j', async (selection, expected) => {
    const m = await mountProvenance([row({ selection })]);
    const cell = text(m.target.querySelector('tbody tr')!);
    for (const piece of expected) expect(cell).toContain(piece);
    expect(cell).not.toMatch(/rev:|approved:|signed:|true|false/);
  });
});

describe('portal#1757 retention is visible and honest', () => {
  it('says Kept, No longer kept, or nothing for a concealed (null) row', async () => {
    const m = await mountProvenance([row({ pruned: false }), row({ pruned: true }), row({ pruned: null, name: null, urn: null })]);
    const rows = [...m.target.querySelectorAll('tbody tr')].map(text);
    expect(rows[0]).toContain('Kept');
    expect(rows[0]).not.toContain('No longer kept');
    expect(rows[1]).toContain('No longer kept');
    expect(rows[2]).not.toMatch(/kept/i);
  });
});

describe('portal#1757 phone columns', () => {
  it('folds revision and depth into the source cell, leaving three columns', async () => {
    const m = await mountProvenance([row({ revNo: 7, depth: 2 })]);
    const headers = [...m.target.querySelectorAll('thead th')].map(h => text(h).trim());
    expect(headers).toHaveLength(3);
    expect(headers.join('|')).not.toMatch(/Depth|^Revision|\|Revision/);
    const source = text(m.target.querySelector('tbody tr td')!);
    expect(source).toContain('Style');
    expect(source).toContain('Revision 7');
    expect(source).toContain('Depth 2');
  });
});

// portal#1862 (Uma's call, UX 2026-11-11): the Source detail reads like the Include settings
// row ("Revision 3 · Signed only"), so the two scan as one pattern, with no comma and no
// lower-case "depth". A pruned revision keeps its " · No longer kept" suffix.
describe('portal#1862 the Source detail line is `Revision {n} · Depth {d}`', () => {
  const detail = (el: Element) => text(el.querySelector('tbody tr td div')!);
  it('renders the mid-dot form, not the comma form', async () => {
    const m = await mountProvenance([row({ revNo: 3, depth: 0 })]);
    expect(detail(m.target)).toMatch(/^Revision 3 · Depth 0 · /);
    expect(detail(m.target)).not.toMatch(/depth 0|Revision 3,/);
  });
  it('adds " · No longer kept" for a pruned revision, directly after the depth', async () => {
    const m = await mountProvenance([row({ revNo: 3, depth: 0, pruned: true })]);
    expect(detail(m.target)).toMatch(/^Revision 3 · Depth 0 · No longer kept · /);
  });
  it('has no pruned suffix for a kept revision', async () => {
    const m = await mountProvenance([row({ revNo: 3, depth: 0, pruned: false })]);
    expect(detail(m.target)).not.toMatch(/No longer kept/);
  });
  it('keeps BOTH "No longer kept" copies for a pruned item: the detail line and the Text kept cell', async () => {
    const m = await mountProvenance([row({ pruned: true })]);
    const cells = [...m.target.querySelectorAll('tbody tr td')].map(text);
    expect(cells[0]).toContain('No longer kept');
    expect(cells[2]).toContain('No longer kept');
  });
  it('leaves the Include settings text unchanged', async () => {
    const m = await mountProvenance([row({ selection: { rev: 3, approved: false, signed: true } })]);
    expect(text(m.target.querySelectorAll('tbody tr td')[1])).toContain('Revision 3 · Signed only');
  });
});

describe('portal#1757 a pruned source says so where a phone always shows it', () => {
  it('repeats No longer kept in the source cell, and only for a pruned row', async () => {
    const m = await mountProvenance([row({ pruned: true }), row({ pruned: false })]);
    const [pruned, kept] = [...m.target.querySelectorAll('tbody tr')].map(r => text(r.querySelector('td')!));
    expect(pruned).toContain('No longer kept');
    expect(kept).not.toMatch(/kept/i);
  });
});

describe('portal#1757 heading hierarchy', () => {
  it('defaults to h3 and honours the level its host panel asks for', async () => {
    const def = await mountProvenance([row()]);
    expect(def.target.querySelector('h3')?.textContent).toBe('Built from');
    def.unmount();
    const nested = await mountProvenance([row()], { headingLevel: 4 });
    expect(nested.target.querySelector('h4')?.textContent).toBe('Built from');
    expect(nested.target.querySelector('h3')).toBeNull();
  });
  it('the compile panel nests it under its own h3', async () => {
    const compiled = { id: 'c', urn: URN, revision: 3, content: 'x', pending: false };
    const owner = { level: 'worker' as const, worker: 'w', app: 'a', agent: 'g' };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => String(url).includes('revision=')
      ? response({ page: { items: [row()], total: 1, hasMore: false, pruned: false, offset: 0 } })
      : response({ key: 'workerCompile:w:a:g', source: null, canStart: false, compiled, pointerMatches: null })));
    const m = mountComponent(BootInstallCompile, { owner, canManage: true }); mounted.push(m); await settle();
    expect([...m.target.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Boot prompt']);
    expect(m.target.querySelector('h4')?.textContent).toBe('Built from');
  });
});

describe('portal#1757 every button states its type', () => {
  it('compile panel buttons are all explicit, including the confirmations', async () => {
    const compiled = { id: 'c', urn: URN, revision: 3, content: 'x', pending: true };
    const owner = { level: 'worker' as const, worker: 'w', app: 'a', agent: 'g' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ key: 'workerCompile:w:a:g', source: null, canStart: true, compiled, pointerMatches: null })));
    const m = mountComponent(BootInstallCompile, { owner, canManage: true }); mounted.push(m); await settle();
    [...m.target.querySelectorAll('button')].find(b => b.textContent === 'Start an empty source for this worker')!.click(); await settle();
    const buttons = [...m.target.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const b of buttons) expect(b.getAttribute('type'), text(b)).toBe('button');
  });
});

describe('portal#1757 closing the App panel', () => {
  const owner = { level: 'app' as const, app: 'a', agent: 'g' };
  const loaded = () => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ key: 'appCompile:a:g', source: null, canStart: false, compiled: null, pointerMatches: null })));
  it('offers Close when the host passes onClose, and calls it', async () => {
    loaded(); const onClose = vi.fn();
    const m = mountComponent(BootInstallCompile, { owner, canManage: true, onClose }); mounted.push(m); await settle();
    const close = [...m.target.querySelectorAll('button')].find(b => b.textContent === 'Close');
    expect(close).toBeTruthy();
    close!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('has no Close without onClose (the worker page panel is not dismissible)', async () => {
    loaded();
    const m = mountComponent(BootInstallCompile, { owner, canManage: true }); mounted.push(m); await settle();
    expect([...m.target.querySelectorAll('button')].some(b => b.textContent === 'Close')).toBe(false);
  });
  it('reveal respects reduced motion', async () => {
    loaded();
    const m = mountComponent(BootInstallCompile, { owner, canManage: true }); mounted.push(m); await settle();
    const heading = m.target.querySelector('h3')!;
    const scroll = vi.fn(); heading.scrollIntoView = scroll;
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    (m.instance as { reveal: () => void }).reveal();
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
  });
});

describe('portal#1757 shared table resize handle keeps a visible keyboard focus', () => {
  it('shows an outline on focus-visible instead of removing it', () => {
    const src = read('table/DataTable.svelte');
    const at = src.indexOf('cursor-col-resize');
    expect(at, 'resize handle class not found').toBeGreaterThan(0);
    const handle = src.slice(src.lastIndexOf('class="', at), src.indexOf('role="separator"', at));
    expect(handle).not.toContain('focus:outline-none');
    expect(handle).toMatch(/focus-visible:outline-2/);
    expect(handle).toMatch(/focus-visible:outline-indigo-/);
    void DataTable;
  });
});

describe('portal#1757 table search literals go through t()', () => {
  it('BootProvenance passes translated search strings', () => {
    const src = read('BootProvenance.svelte');
    expect(src).not.toMatch(/searchPlaceholder="/);
    expect(src).not.toMatch(/searchAriaLabel="/);
    expect(src).toMatch(/searchPlaceholder=\{t\(/);
    expect(src).toMatch(/searchAriaLabel=\{t\(/);
  });
});

// portal#1991: below `sm` only the Source column renders, so it carries Include
// settings as a labelled line (hidden from `sm` up, where the column says it).
// Retention needs no second copy: the detail line already says "No longer kept"
// for a pruned row, and only for one (#1757, pinned above). The breakpoint itself is CSS, so its executed proof is
// scripts/test-boot-provenance-phone-layout.mjs; this pins the markup it needs.
describe('portal#1991 the Source cell carries Include settings for a phone', () => {
  const phoneDetail = (row: Element) => row.querySelector('[data-testid="provenance-phone-detail"]');
  const pairs = (dl: Element) => [...dl.querySelectorAll('dt')].map(dt => [text(dt).trim(), text(dt.nextElementSibling!).trim()]);
  it('labels the folded value with its column header, hidden from sm up', async () => {
    const m = await mountProvenance([
      row({ selection: { rev: 4, approved: true, signed: true }, pruned: true }),
      row({ pruned: false }),
      row({ pruned: null, name: null, urn: null }),
    ]);
    const rows = [...m.target.querySelectorAll('tbody tr')];
    const details = rows.map(phoneDetail);
    for (const dl of details) {
      expect(dl).not.toBeNull();
      expect(dl!.closest('td')).toBe(dl!.closest('tr')!.querySelector('td'));
      expect(dl!.classList.contains('sm:hidden')).toBe(true);
    }
    expect(pairs(details[0]!)).toEqual([['Include settings', 'Revision 4 · Approved and signed only']]);
    expect(pairs(details[1]!)).toEqual([['Include settings', 'Latest revision']]);
    expect(pairs(details[2]!)).toEqual([['Include settings', 'Latest revision']]);
    // One "No longer kept" per pruned row in the Source cell: the detail line's, not a second copy.
    expect(text(rows[0].querySelector('td')!).match(/No longer kept/g)).toHaveLength(1);
  });
  it('drops the two narrow columns below sm and keeps Source', async () => {
    const m = await mountProvenance([row()]);
    const headers = [...m.target.querySelectorAll('thead th')];
    expect(headers.map(h => h.classList.contains('max-sm:hidden'))).toEqual([false, true, true]);
    expect(headers[0].classList.contains('max-sm:w-full')).toBe(true);
    const cells = [...m.target.querySelectorAll('tbody td')];
    expect(cells.map(c => c.classList.contains('max-sm:hidden'))).toEqual([false, true, true]);
  });
});
