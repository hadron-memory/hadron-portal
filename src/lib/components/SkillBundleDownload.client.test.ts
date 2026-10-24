/**
 * #879 / review of #890 — the Task Nodes download panel, mounted.
 *
 * CLIENT lane: the report is built after a `fetch` resolves and the buttons
 * gate on a store the row checkboxes write — neither happens in a server
 * render. `fetch` is stubbed with a response shaped like the endpoint's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { exportSaves } from '$lib/skill-export-saves.svelte';
import SkillBundleDownload from './SkillBundleDownload.svelte';

type Props = { orgId: string; checkedCount: number; truncated?: boolean; shown?: number };

const mounted: Array<Mounted<Props>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  exportSaves.pending = 0;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // jsdom has no object URLs; the save path needs both.
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

function panel(props: Props) {
  const m = mountComponent(SkillBundleDownload, props);
  mounted.push(m);
  return m;
}

const SOLO = 'hrn:node:acme.com:ops:tasks:solo';
const BROKEN = 'hrn:node:acme.com:ops:tasks:broken';

function stubEndpoint(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const codexResponse = (over: Record<string, unknown> = {}) => ({
  host: 'codexSkill',
  filename: 'acme-skills-codex.zip',
  zipBase64: btoa('PK'),
  included: [{ name: 'both', urn: 'hrn:node:acme.com:ops:tasks:both' }],
  skipped: [{ name: 'broken', urn: BROKEN, reasons: ['needs a description'] }],
  otherHost: 'claudeSkill',
  notForHost: [{ name: 'solo-task', urn: SOLO }],
  notForHostUnknown: null,
  scopeIncomplete: false,
  unrecognized: [],
  ...over,
});

const downloadButtons = (t: HTMLElement) =>
  [...t.querySelectorAll<HTMLButtonElement>('button')].filter((b) => /Download/.test(b.textContent ?? ''));

/**
 * Wait for the REPORT, not for a number of ticks. The stubbed fetch → json()
 * chain takes a different number of microtasks on a slower runner, and a fixed
 * count passed locally while CI still read "Preparing…" (#890). Waiting on the
 * report also keeps a NEGATIVE assertion honest: without it, "not listed"
 * passes on a report that never rendered.
 */
async function reportRendered(target: HTMLElement) {
  await vi.waitFor(() => {
    if (!target.querySelector('[role="status"]')) throw new Error('report not rendered yet');
  });
}

async function search(target: HTMLElement, text: string) {
  const box = target.querySelector<HTMLInputElement>('input[aria-label="Search the tasks left out of the download"]')!;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
}

const tableRows = (t: HTMLElement) => [...t.querySelectorAll('[role="status"] tbody tr')];

describe('SkillBundleDownload — the left-out report (@codex on #890)', () => {
  it('lists the server-refused task AND the other-host-only task, each with its reason, in one grid', async () => {
    stubEndpoint(codexResponse());
    const { target } = panel({ orgId: 'org-1', checkedCount: 3 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);

    expect(target.textContent).toContain('Left out of the download (2)');
    const rows = tableRows(target).map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.includes('broken'))).toContain('needs a description');
    expect(rows.find((r) => r.includes('solo-task'))).toContain('Exported for Claude only.');
    // It is a grid, not a bespoke list.
    expect(target.querySelector('[role="status"] ul')).toBeNull();
  });

  it('finds a row by its URN — rendered as a chip, not the accessor — and nothing by text no row renders', async () => {
    stubEndpoint(codexResponse());
    const { target } = panel({ orgId: 'org-1', checkedCount: 3 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);

    await search(target, 'tasks:solo');
    expect(tableRows(target).map((r) => r.textContent)).toEqual([expect.stringContaining('solo-task')]);
    await search(target, 'not rendered anywhere');
    expect(tableRows(target).some((r) => r.textContent?.includes('solo-task'))).toBe(false);
  });

  it('with nothing left out, renders no grid — and it did reach the report', async () => {
    stubEndpoint(codexResponse({ skipped: [], notForHost: [] }));
    const { target } = panel({ orgId: 'org-1', checkedCount: 1 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    expect(target.textContent).toContain('Skills in it: 1');
    expect(target.textContent).not.toContain('Left out of the download');
    expect(target.querySelector('[role="status"] table')).toBeNull();
  });

  it('says so when the other host could not be checked, instead of implying the list is complete', async () => {
    stubEndpoint(codexResponse({ notForHost: [], notForHostUnknown: 'host "claudeSkill" unavailable' }));
    const { target } = panel({ orgId: 'org-1', checkedCount: 2 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    expect(target.textContent).toContain('could not be checked');
    expect(target.textContent).toContain('host "claudeSkill" unavailable');
    // The download itself still happened — an export runs to the end.
    expect(target.textContent).toContain('Prepared acme-skills-codex.zip');
  });
});

describe('SkillBundleDownload — incomplete scope (#1689)', () => {
  it('warns that system-memory skills may be missing, and still reports the download', async () => {
    stubEndpoint(codexResponse({ scopeIncomplete: true }));
    const { target } = panel({ orgId: 'org-1', checkedCount: 2 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    expect(target.querySelector('[data-testid="bundle-scope-incomplete"]')).not.toBeNull();
    expect(target.textContent).toContain('Prepared acme-skills-codex.zip');
  });

  it('shows no such warning when the scope was complete', async () => {
    stubEndpoint(codexResponse());
    const { target } = panel({ orgId: 'org-1', checkedCount: 2 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    expect(target.querySelector('[data-testid="bundle-scope-incomplete"]')).toBeNull();
  });
});

describe('SkillBundleDownload — export keys no host reads (server#1296)', () => {
  const TYPO = 'hrn:node:acme.com:ops:tasks:typo';
  const BOTH = 'hrn:node:acme.com:ops:tasks:both';
  const withUnrecognized = () =>
    codexResponse({
      unrecognized: [
        { name: 'both', urn: BOTH, inDownload: true, keyCount: 1, messages: ['key "codex" names no skill host'] },
        { name: 'Typo task', urn: TYPO, inDownload: false, keyCount: 14, messages: ['key "k0" names no skill host', '4 more unrecognised key(s)'] },
      ],
    });

  const unrecognizedGrid = (t: HTMLElement) =>
    t.querySelector<HTMLInputElement>('input[aria-label="Search the tasks whose export keys no host reads"]');

  it('lists them in their own grid, saying which are in the download, with the TRUE key count and the server\'s words', async () => {
    stubEndpoint(withUnrecognized());
    const { target } = panel({ orgId: 'org-1', checkedCount: 3 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);

    expect(target.textContent).toContain('Export keys no host reads (2)');
    expect(unrecognizedGrid(target)).not.toBeNull();
    expect(target.textContent).toContain('What happened');
    const rows = tableRows(target).map((r) => r.textContent ?? '');
    const typo = rows.find((r) => r.includes('Typo task'))!;
    expect(typo).toContain('Not in this download. It has 14 export keys that no host reads.');
    expect(typo).toContain('4 more unrecognised key(s)');
    // keyCount 1 takes the singular string, not "1 export keys".
    expect(rows.find((r) => r.includes(BOTH.split(':').pop()!))).toContain(
      'In this download. It also has an export key that no host reads, which is ignored.',
    );
    // The left-out grid is untouched: still its own two rows and heading.
    expect(target.textContent).toContain('Left out of the download (2)');
    expect(rows).toHaveLength(4);
  });

  it('renders no such grid when nothing is unrecognised — and it did reach the report', async () => {
    stubEndpoint(codexResponse());
    const { target } = panel({ orgId: 'org-1', checkedCount: 3 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    expect(target.textContent).toContain('Left out of the download (2)');
    expect(target.textContent).not.toContain('Export keys no host reads');
    expect(unrecognizedGrid(target)).toBeNull();
  });
});

describe('SkillBundleDownload — the Claude plugin version (#909, @copilot on #910)', () => {
  const versionLine = (t: HTMLElement) => t.querySelector('[data-testid="skill-bundle-version"]');

  it('shows the version the endpoint returned for a Claude download', async () => {
    stubEndpoint(codexResponse({ host: 'claudeSkill', filename: 'acme-skills.zip', otherHost: 'codexSkill', version: '0.0.0-h28fcaec74a1d' }));
    const { target } = panel({ orgId: 'org-1', checkedCount: 1 });
    downloadButtons(target).find((b) => b.textContent?.includes('Claude'))!.click();
    await reportRendered(target);
    expect(versionLine(target)?.textContent).toContain('Plugin version 0.0.0-h28fcaec74a1d.');
  });

  it('shows no version line when the endpoint returns none, as for Codex — and it did reach the report', async () => {
    stubEndpoint(codexResponse({ version: null }));
    const { target } = panel({ orgId: 'org-1', checkedCount: 1 });
    downloadButtons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    expect(target.textContent).toContain('Prepared acme-skills-codex.zip');
    expect(versionLine(target)).toBeNull();
  });
});

describe('SkillBundleDownload — when the buttons are offered', () => {
  it('nothing checked and the list complete: disabled, and says why', async () => {
    const { target } = panel({ orgId: 'org-1', checkedCount: 0 });
    await tick();
    expect(downloadButtons(target).every((b) => b.disabled)).toBe(true);
    expect(target.textContent).toContain('Nothing is checked yet');
  });

  it('nothing checked among a TRUNCATED list: still enabled — the org may hold more (@codex on #890)', async () => {
    const { target } = panel({ orgId: 'org-1', checkedCount: 0, truncated: true, shown: 500 });
    await tick();
    expect(downloadButtons(target).every((b) => !b.disabled)).toBe(true);
    expect(target.textContent).toContain('Checked among the 500 tasks shown: 0');
  });

  it('waits while a row is still saving, then offers them again (@copilot on #890)', async () => {
    const { target } = panel({ orgId: 'org-1', checkedCount: 1 });
    await tick();
    expect(downloadButtons(target).every((b) => !b.disabled)).toBe(true);
    exportSaves.pending = 1;
    await tick();
    expect(downloadButtons(target).every((b) => b.disabled)).toBe(true);
    expect(target.textContent).toContain('Saving a change');
    exportSaves.pending = 0;
    await tick();
    expect(downloadButtons(target).every((b) => !b.disabled)).toBe(true);
  });
});


describe('#1077 distinct download refusal', () => {
  it.each(['claudeSkill', 'codexSkill'])('shows the scope role refusal for %s without downloading', async (host) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'scope-forbidden', detail: 'private provider detail' }), { status: 403 })));
    const { target } = panel({ orgId: 'org-1', checkedCount: 1 });
    downloadButtons(target).find((b) => b.textContent?.includes(host === 'codexSkill' ? 'Codex' : 'Claude'))!.click();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toContain('Downloading tasks requires Contributor access or higher in this organization.'));
    expect(target.textContent).not.toContain('private provider detail');
    expect(target.querySelector('[role="status"]')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(downloadButtons(target).every((b) => !b.disabled)).toBe(true);
  });

  it('keeps an unrelated failure distinct from the role refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'plan-failed', detail: 'The export plan failed' }), { status: 502 })));
    const { target } = panel({ orgId: 'org-1', checkedCount: 1 });
    downloadButtons(target)[0].click();
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')?.textContent).toBe('The export plan failed'));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
