/**
 * #911 — the node page's "Export as skill" panel, mounted.
 *
 * CLIENT lane: the report is built after a `fetch` resolves, which a server
 * render never reaches. `fetch` is stubbed with the endpoint's response shape,
 * and the save goes through a spied `saveBase64Download`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';

const saved = vi.fn();
vi.mock('$lib/save-download', () => ({ saveBase64Download: (...a: unknown[]) => saved(...a) }));

import NodeSkillExport from './NodeSkillExport.svelte';
import { announcedStatusText } from '$lib/test/announcedStatusText';

type Props = { endpoint: string; hosts: string[] };
const mounted: Array<Mounted<Props>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  saved.mockReset();
});

function panel(props: Props) {
  const m = mountComponent(NodeSkillExport, props);
  mounted.push(m);
  return m;
}

function stubEndpoint(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const buttons = (t: HTMLElement) => [...t.querySelectorAll<HTMLButtonElement>('button')];

/** Wait for the REPORT, not a tick count (see SkillBundleDownload.client.test.ts). */
async function reportRendered(target: HTMLElement) {
  await vi.waitFor(() => {
    if (!announcedStatusText(target)) throw new Error('report not rendered yet');
  });
}

describe('NodeSkillExport — the buttons', () => {
  it('offers one download per ACTIVE host, and nothing else', () => {
    const { target } = panel({ endpoint: '/e', hosts: ['codexSkill'] });
    expect(buttons(target).map((b) => b.textContent?.trim())).toEqual(['Download for Codex']);
  });

  it('ignores a host it cannot download for', () => {
    const { target } = panel({ endpoint: '/e', hosts: ['claudeSkill', 'codex'] });
    expect(buttons(target).map((b) => b.textContent?.trim())).toEqual(['Download for Claude']);
  });
});

describe('NodeSkillExport — the report', () => {
  it('posts the host, saves the zip, and says how to install it', async () => {
    const fetchMock = stubEndpoint({ host: 'claudeSkill', filename: 'drive-pr-home.zip', zipBase64: 'UEs=', reasons: [] });
    const { target } = panel({ endpoint: '/app/memories/m/nodes/n/skill', hosts: ['claudeSkill', 'codexSkill'] });
    buttons(target)[0].click();
    await reportRendered(target);

    expect(fetchMock).toHaveBeenCalledWith('/app/memories/m/nodes/n/skill', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ host: 'claudeSkill' }),
    }));
    expect(saved).toHaveBeenCalledWith('drive-pr-home.zip', 'UEs=');
    expect(target.textContent).toContain('Downloaded drive-pr-home.zip.');
    expect(target.textContent).toContain('Customize → Skills');
  });

  it('gives the Codex install path for a Codex download', async () => {
    stubEndpoint({ host: 'codexSkill', filename: 'drive-pr-home.zip', zipBase64: 'UEs=', reasons: [] });
    const { target } = panel({ endpoint: '/e', hosts: ['codexSkill'] });
    buttons(target)[0].click();
    await reportRendered(target);
    expect(target.textContent).toContain('~/.agents/skills');
  });

  it('saves nothing when the server refused, and shows its reasons', async () => {
    stubEndpoint({ host: 'claudeSkill', filename: null, zipBase64: null, reasons: ['needs a description', 'name too long'] });
    const { target } = panel({ endpoint: '/e', hosts: ['claudeSkill'] });
    buttons(target)[0].click();
    await reportRendered(target);
    expect(saved).not.toHaveBeenCalled();
    expect(target.textContent).toContain('Nothing was downloaded. The Claude export was refused:');
    expect([...target.querySelectorAll('[role="status"] li')].map((li) => li.textContent)).toEqual([
      'needs a description',
      'name too long',
    ]);
  });

  it('says to sign in when the session expired, instead of "try again" (@codex on #912)', async () => {
    stubEndpoint({ code: 'UNAUTHENTICATED', message: 'sign in required' }, 401);
    const { target } = panel({ endpoint: '/e', hosts: ['claudeSkill'] });
    buttons(target)[0].click();
    await reportRendered(target);
    expect(saved).not.toHaveBeenCalled();
    expect(announcedStatusText(target)).toContain('sign in required');
    expect(target.textContent).not.toContain('Try again shortly');
  });

  it.each([
    ['wrong-memory', 'may have been moved. Reload the page'],
    ['not-found', 'may have been deleted. Reload the page'],
    ['not-a-task', 'Only a task node can be exported'],
  ])('turns the %s refusal into a reload instruction, not "try again" (@codex on #912)', async (code, text) => {
    stubEndpoint({ code }, code === 'not-a-task' ? 409 : 404);
    const { target } = panel({ endpoint: '/e', hosts: ['claudeSkill'] });
    buttons(target)[0].click();
    await reportRendered(target);
    expect(saved).not.toHaveBeenCalled();
    expect(announcedStatusText(target)).toContain(text);
    expect(target.textContent).not.toContain('Try again shortly');
  });

  it('shows the server\'s words on a failure, and saves nothing', async () => {
    stubEndpoint({ code: 'plan-failed', detail: 'memory is locked' }, 502);
    const { target } = panel({ endpoint: '/e', hosts: ['claudeSkill'] });
    buttons(target)[0].click();
    await reportRendered(target);
    expect(saved).not.toHaveBeenCalled();
    expect(target.textContent).toContain('memory is locked');
  });
});

describe('NodeSkillExport — teardown (@codex on #912)', () => {
  it('closing the panel while the request is pending aborts it, and saves NOTHING when the answer arrives', async () => {
    let answer!: (r: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        // Ignores the signal on purpose: the guard must hold even when the
        // answer lands anyway, as a real response already in flight can.
        return new Promise<Response>((resolve) => (answer = resolve));
      }),
    );
    const m = panel({ endpoint: '/e', hosts: ['claudeSkill'] });
    buttons(m.target)[0].click();
    await vi.waitFor(() => expect(signal).toBeDefined());

    mounted.splice(mounted.indexOf(m), 1);
    m.unmount();
    expect(signal!.aborted).toBe(true);

    answer(new Response(JSON.stringify({ host: 'claudeSkill', filename: 'old-node.zip', zipBase64: 'UEs=', reasons: [] })));
    await new Promise((r) => setTimeout(r, 20));
    expect(saved).not.toHaveBeenCalled();
  });

  it('the same answer while still mounted DOES save — the guard is teardown, not a blanket block', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    const { target } = panel({ endpoint: '/e', hosts: ['claudeSkill'] });
    buttons(target)[0].click();
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer(new Response(JSON.stringify({ host: 'claudeSkill', filename: 'this-node.zip', zipBase64: 'UEs=', reasons: [] })));
    await reportRendered(target);
    expect(saved).toHaveBeenCalledWith('this-node.zip', 'UEs=');
  });
});
