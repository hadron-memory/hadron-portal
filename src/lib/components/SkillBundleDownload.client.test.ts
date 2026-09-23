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

type Props = {
  orgId: string;
  checked: Array<{ name: string; urn: string; hosts: string[] }>;
  truncated?: boolean;
  shown?: number;
};

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

const both = { name: 'Both hosts', urn: 'hrn:node:acme.com:ops:tasks:both', hosts: ['claudeSkill', 'codexSkill'] };
const claudeOnly = { name: 'Solo task', urn: 'hrn:node:acme.com:ops:tasks:solo', hosts: ['claudeSkill'] };

function stubEndpoint(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const buttons = (t: HTMLElement) => [...t.querySelectorAll<HTMLButtonElement>('button')];

/**
 * Wait for the REPORT, not for a number of ticks. The stubbed fetch → json()
 * chain takes a different number of microtasks on a slower runner, and a fixed
 * count passed locally while CI still read "Preparing…" (#890). Waiting on the
 * report also keeps the NEGATIVE assertion below honest: without it, "not
 * listed" passes on a report that never rendered.
 */
async function reportRendered(target: HTMLElement) {
  await vi.waitFor(() => {
    if (!target.querySelector('[role="status"]')) throw new Error('report not rendered yet');
  });
}

describe('SkillBundleDownload — a checked task the host never judges (@codex on #890)', () => {
  it('names a Claude-only task in the Codex report instead of dropping it', async () => {
    stubEndpoint({
      host: 'codexSkill',
      filename: 'acme-skills-codex.zip',
      zipBase64: btoa('PK'),
      included: [{ name: 'both', urn: both.urn }],
      skipped: [],
    });
    const { target } = panel({ orgId: 'org-1', checked: [both, claudeOnly] });
    buttons(target).find((b) => b.textContent?.includes('Codex'))!.click();
    await reportRendered(target);
    const text = target.textContent ?? '';
    expect(text).toContain('Checked, but not exported for Codex (1)');
    expect(text).toContain('Solo task');
    expect(text).toContain('Exported for Claude only.');
    // The Urn chip renders the full URN as its title (the text is the bare part).
    expect(target.querySelector(`[title="${claudeOnly.urn}"]`)).not.toBeNull();
  });

  it('does not list it for the host it IS declared for', async () => {
    stubEndpoint({
      host: 'claudeSkill',
      filename: 'acme-skills.zip',
      zipBase64: btoa('PK'),
      included: [{ name: 'both', urn: both.urn }, { name: 'solo', urn: claudeOnly.urn }],
      skipped: [],
    });
    const { target } = panel({ orgId: 'org-1', checked: [both, claudeOnly] });
    buttons(target).find((b) => b.textContent?.includes('Claude'))!.click();
    await reportRendered(target);
    // Reached the matcher: the report IS there, and it names the included skills.
    expect(target.textContent).toContain('Skills in it: 2');
    expect(target.textContent).not.toContain('not exported for');
  });
});

describe('SkillBundleDownload — when the buttons are offered', () => {
  it('nothing checked and the list complete: disabled, and says why', async () => {
    const { target } = panel({ orgId: 'org-1', checked: [] });
    await tick();
    expect(buttons(target).every((b) => b.disabled)).toBe(true);
    expect(target.textContent).toContain('Nothing is checked yet');
  });

  it('nothing checked among a TRUNCATED list: still enabled — the org may hold more (@codex on #890)', async () => {
    const { target } = panel({ orgId: 'org-1', checked: [], truncated: true, shown: 500 });
    await tick();
    expect(buttons(target).every((b) => !b.disabled)).toBe(true);
    expect(target.textContent).toContain('Checked among the 500 tasks shown: 0');
  });

  it('waits while a row is still saving, then offers them again (@copilot on #890)', async () => {
    const { target } = panel({ orgId: 'org-1', checked: [both] });
    await tick();
    expect(buttons(target).every((b) => !b.disabled)).toBe(true);
    exportSaves.pending = 1;
    await tick();
    expect(buttons(target).every((b) => b.disabled)).toBe(true);
    expect(target.textContent).toContain('Saving a change');
    exportSaves.pending = 0;
    await tick();
    expect(buttons(target).every((b) => !b.disabled)).toBe(true);
  });
});
