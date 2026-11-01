import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Panel from './InstallCustomisation.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
const mounted: ReturnType<typeof mountComponent>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const agent = {
  id: 'ag-a',
  name: 'Sample Agent',
  urn: 'hrn:agent:acme.com:sample',
};
const node = {
  id: 'n1',
  loc: 'note',
  name: 'Note',
  content: 'original draft',
  revision: 7,
};
const payload = (state = 'ok', content: string | null = 'original draft') => ({
  list:
    state === 'ok'
      ? {
          state: 'ok',
          value: {
            memoryId: 'mem',
            urn: 'hrn:mem:acme.com:install',
            nodes: [node],
            total: 25,
            offset: 0,
          },
        }
      : { state },
  replacement: { state: 'ok', value: { ...node, content } },
  original: { state: 'not-shown' },
});
const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  )!;
async function panel(canManage: boolean | null = true) {
  const m = mountComponent(Panel, { appRef: 'app-a', agent, canManage });
  mounted.push(m);
  await tick(4);
  await new Promise((r) => setTimeout(r, 0));
  await tick(4);
  return m.target;
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload()), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});
describe('install customisation panel', () => {
  // portal#1399: customisations reach started agents through an approved
  // compiled prompt (hrn:node:hadronmemory.com:specs:cor:agt:040:16, :10).
  it('says when customisations reach agents, never that they are not used yet', async () => {
    const root = await panel();
    expect(root.textContent).toContain(
      'Customisations reach a started agent when its boot pointer names a prompt compiled for this App or one of its workers, and that prompt’s newest approved revision was compiled with them.',
    );
    expect(root.textContent).not.toMatch(/not used to start agents yet/i);
  });
  it.each(['not-shown', 'failed'])(
    'distinguishes %s from an empty table',
    async (state) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload(state)))),
      );
      const root = await panel();
      expect(root.textContent).toContain(
        state === 'failed' ? 'Couldn’t load customisations.' : 'Not shown',
      );
      expect(root.querySelector('table')).toBeNull();
    },
  );
  it('portal#1524: an EMPTY page is a note, never an empty table, a count of 0 or "no customisations"', async () => {
    // hadron-server#2990 answers this list with an empty page while its
    // node-list flag is on; the portal must not depend on the flag, so an empty
    // page reads as a note true in both cases (empty, or withheld), never as
    // "unavailable" (an error to retry) nor as "none exist".
    const empty = {
      ...payload(),
      list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [], total: 0, offset: 0 } },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(empty))));
    const root = await panel();
    expect(root.querySelector('[data-testid="customisation-list-unavailable"]')?.textContent).toContain('may not be the full set');
    expect(root.querySelector('[data-testid="customisation-list-unavailable"]')?.textContent).not.toMatch(/unavailable/i);
    expect(root.querySelector('table')).toBeNull();
    expect(root.textContent).not.toMatch(/0 customisations|No results|No customisations|no nodes/i);
    // A replacement can still be started.
    expect(button(root, 'Start customising')).toBeDefined();
  });
  it('hides writes only for an explicit nonmanager', async () => {
    const root = await panel(false);
    expect(button(root, 'Start customising')).toBeUndefined();
    const other = await panel(null);
    expect(button(other, 'Start customising')).toBeDefined();
  });
  it('reads a selected loc only on demand and preserves genuine empty replacement content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload('ok', '')))),
    );
    const root = await panel();
    expect(root.querySelector('textarea')).toBeNull();
    button(root, 'Open').click();
    await new Promise((r) => setTimeout(r, 0));
    await tick(4);
    expect(root.querySelector('textarea')?.value).toBe('');
    expect(root.textContent).toContain('Original not shown');
    expect(root.textContent).not.toContain('adds a new node');
  });
  it('gets the next twenty rows using the server total', async () => {
    const root = await panel();
    button(root, 'Next').click();
    await new Promise((r) => setTimeout(r, 0));
    await tick(4);
    expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain(
      'offset=20',
    );
  });
  it('does not create nodes merely to compare an unreadable original', async () => {
    const root = await panel();
    button(root, 'Open').click();
    await new Promise((r) => setTimeout(r, 0));
    await tick(4);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every((c) => !c[1]?.method || c[1].method === 'GET'),
    ).toBe(true);
    expect(root.textContent).toContain('Original not shown');
  });
  it('ignores a delayed read after the panel is unmounted', async () => {
    let finish!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (finish = r))),
    );
    const root = await panel();
    mounted.pop()!.unmount();
    finish(new Response(JSON.stringify(payload())));
    await tick(4);
    expect(root.textContent).toBe('');
  });
});

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick(4);
}
async function edit(root: HTMLElement, text: string) {
  const area = root.querySelector('textarea')!;
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}
function submit(root: HTMLElement) {
  root
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
describe('customisation write boundaries', () => {
  it('keeps a conflicting draft and its displayed revision until explicit Reload', async () => {
    const calls: FormData[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        if (options?.method === 'POST') {
          calls.push(options.body as FormData);
          return new Response(
            JSON.stringify({
              type: 'failure',
              status: 409,
              data: {
                customisationFailed: {
                  code: 'NODE_WRITE_CONFLICT',
                  detail: 'Changed elsewhere <img src=x onerror=alert(1)>',
                },
              },
            }),
          );
        }
        return new Response(JSON.stringify(payload()));
      }),
    );
    const root = await panel();
    button(root, 'Open').click();
    await settle();
    await edit(root, 'my draft');
    submit(root);
    await settle();
    expect(root.querySelector('textarea')?.value).toBe('my draft');
    expect(calls[0].get('expectedRevision')).toBe('7');
    expect(calls[0].get('baseContent')).toBe('original draft');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('<img');
    expect(root.querySelector('img')).toBeNull();
    submit(root);
    await settle();
    expect(calls[1].get('expectedRevision')).toBe('7');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button(root, 'Reload and discard draft').click();
    await settle();
    expect(root.querySelector('textarea')?.value).toBe('original draft');
  });
  it('keeps a create collision a create, preserving the draft on retry', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        if (options?.method === 'POST') {
          urls.push(String(url));
          return new Response(
            JSON.stringify({
              type: 'failure',
              status: 400,
              data: {
                customisationFailed: {
                  code: 'NodeLocConflictError',
                  detail: 'Loc exists',
                },
              },
            }),
          );
        }
        return new Response(JSON.stringify(payload()));
      }),
    );
    const root = await panel();
    button(root, 'Start customising').click();
    await tick();
    const inputs = root.querySelectorAll('form input');
    for (const [i, value] of ['note', 'Note'].entries()) {
      (inputs[i] as HTMLInputElement).value = value;
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    }
    await edit(root, 'new customisation');
    submit(root);
    await settle();
    submit(root);
    await settle();
    expect(urls).toEqual([
      '/app/apps/app-a?/createCustomisation',
      '/app/apps/app-a?/createCustomisation',
    ]);
    expect(root.querySelector('textarea')?.value).toBe('new customisation');
  });
  it('ignores an older response for the same selected loc', async () => {
    const root = await panel();
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
    );
    button(root, 'Open').click();
    await tick();
    button(root, 'Reload and discard draft').click();
    await tick();
    pending[1](new Response(JSON.stringify(payload('ok', 'newest'))));
    await settle();
    pending[0](new Response(JSON.stringify(payload('ok', 'stale'))));
    await settle();
    expect(root.querySelector('textarea')?.value).toBe('newest');
  });
  it('ignores an in-flight selected-node read when starting a new draft', async () => {
    const root = await panel();
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (resolve = r))),
    );
    button(root, 'Open').click();
    await tick();
    button(root, 'Start customising').click();
    await tick();
    await edit(root, 'new draft');
    resolve(new Response(JSON.stringify(payload('ok', 'stale selection'))));
    await settle();
    expect(root.querySelector('textarea')?.value).toBe('new draft');
  });
});

describe('special loc guidance', () => {
  it('does not suggest an inherited base for a missing boot original', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const p = payload();
        p.list = {
          ...p.list,
          value: {
            ...(p.list as any).value,
            nodes: [{ ...node, loc: 'boot' }],
          },
        } as any;
        p.replacement = { state: 'ok', value: { ...node, loc: 'boot' } };
        return new Response(JSON.stringify(p));
      }),
    );
    const root = await panel();
    button(root, 'Open').click();
    await settle();
    expect(root.textContent).toContain('Original not shown');
    expect(root.textContent).not.toContain('An inherited base');
  });
});

describe('UX draft and panel navigation boundaries', () => {
  it.each(['Open', 'Next', 'Previous', 'Start customising'])(
    'keeps a dirty draft when %s discard is declined',
    async (action) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const root = await panel();
      if (action === 'Previous') {
        button(root, 'Next').click();
        await settle();
      }
      button(root, 'Open').click();
      await settle();
      await edit(root, 'unsaved draft');
      const count = vi.mocked(fetch).mock.calls.length;
      button(root, action).click();
      await settle();
      expect(confirm).toHaveBeenCalledOnce();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(count);
      expect(root.querySelector('textarea')?.value).toBe('unsaved draft');
    },
  );
  it.each(['loading', 'not-shown', 'failed', 'masked'])(
    'does not prompt again for an accepted discard when the next replacement is %s',
    async (state) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const m = mountComponent(Panel, { appRef: 'app-a', agent, canManage: true, onClose: vi.fn() });
      mounted.push(m);
      await settle();
      const root = m.target;
      button(root, 'Open').click();
      await settle();
      await edit(root, 'already discarded draft');
      let resolve!: (response: Response) => void;
      vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }));
      button(root, 'Open').click();
      await tick(4);
      if (state !== 'loading') {
        resolve(new Response(JSON.stringify({ ...payload(), replacement: state === 'masked' ? { state: 'ok', value: { ...node, content: null } } : { state } })));
        await settle();
      }
      expect(root.querySelector('textarea')).toBeNull();
      expect(confirm).toHaveBeenCalledOnce();
      button(root, 'Close').click();
      await tick(4);
      expect(confirm).toHaveBeenCalledOnce();
      if (state === 'loading') {
        resolve(new Response(JSON.stringify({ ...payload(), replacement: { state: 'not-shown' } })));
        await settle();
      }
    },
  );
  it('allows navigation after an explicit discard confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const response = payload();
        return new Response(
          JSON.stringify(
            String(url).includes('&loc=')
              ? response
              : { ...response, replacement: { state: 'not-shown' } },
          ),
        );
      }),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const root = await panel();
    button(root, 'Open').click();
    await settle();
    await edit(root, 'unsaved draft');
    button(root, 'Next').click();
    await settle();
    expect(confirm).toHaveBeenCalledOnce();
    expect(root.querySelector('textarea')).toBeNull();
    button(root, 'Open').click();
    await settle();
    expect(confirm).toHaveBeenCalledOnce();
  });
  it('focuses and reveals the panel heading when opened', async () => {
    const scroll = vi.fn();
    const prior = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    try {
      const root = await panel();
      expect(document.activeElement).toBe(root.querySelector('h3'));
      expect(scroll).toHaveBeenCalled();
    } finally {
      if (prior)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', prior);
      else delete (HTMLElement.prototype as any).scrollIntoView;
    }
  });
  it('confirms a dirty Close and closes only after acceptance', async () => {
    const close = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const m = mountComponent(Panel, {
      appRef: 'app-a',
      agent,
      canManage: true,
      onClose: close,
    });
    mounted.push(m);
    await settle();
    button(m.target, 'Open').click();
    await settle();
    await edit(m.target, 'unsaved draft');
    button(m.target, 'Close').click();
    await settle();
    expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    button(m.target, 'Close').click();
    await settle();
    expect(close).toHaveBeenCalledOnce();
  });
});

// #1368: production disables navigation while a save is in flight and the page
// remounts the panel per target, so a late save reply is only reachable here by
// changing the target under a live panel. The reply must then change nothing.
describe('late save reply fence (#1368)', () => {
  async function savingThenRetarget() {
    let reply!: (r: Response) => void;
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === 'POST') {
          posts.push(String(url));
          return new Promise<Response>((r) => (reply = r));
        }
        return Promise.resolve(new Response(JSON.stringify(payload())));
      }),
    );
    const props = reactiveProps({ appRef: 'app-a', agent, canManage: true as boolean | null });
    const m = mountComponent(Panel, props);
    mounted.push(m);
    await settle();
    button(m.target, 'Open').click();
    await settle();
    await edit(m.target, 'saved for A');
    submit(m.target);
    await tick(4);
    expect(posts).toEqual(['/app/apps/app-a?/saveCustomisation']);
    // Navigation really is disabled while the save is pending.
    expect(button(m.target, 'Reload and discard draft').disabled).toBe(true);
    const reads = vi.mocked(fetch).mock.calls.length;
    props.agent = { id: 'ag-b', name: 'Other Agent', urn: 'hrn:agent:acme.com:other' };
    await tick(4);
    return { m, reply, reads };
  }
  it('drops a successful reply that lands after the target changed', async () => {
    const { m, reply, reads } = await savingThenRetarget();
    reply(new Response(JSON.stringify({ type: 'success', status: 200 })));
    await settle();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(reads);
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.querySelector('[role="status"]')).toBeNull();
    expect(m.target.querySelector('textarea')?.value).toBe('saved for A');
  });
  it('drops a refusal that lands after the target changed', async () => {
    const { m, reply, reads } = await savingThenRetarget();
    reply(
      new Response(
        JSON.stringify({
          type: 'failure',
          status: 409,
          data: { customisationFailed: { code: 'NODE_WRITE_CONFLICT', detail: 'Changed for A' } },
        }),
      ),
    );
    await settle();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(reads);
    expect(m.target.textContent).not.toContain('Changed for A');
    expect(m.target.querySelector('[role="alert"]')).toBeNull();
  });
  it('control: the same reply on an unchanged target is shown and reloads', async () => {
    let reply!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options?: RequestInit) =>
        options?.method === 'POST'
          ? new Promise<Response>((r) => (reply = r))
          : Promise.resolve(new Response(JSON.stringify(payload()))),
      ),
    );
    const root = await panel();
    button(root, 'Open').click();
    await settle();
    await edit(root, 'saved for A');
    submit(root);
    await tick(4);
    const reads = vi.mocked(fetch).mock.calls.length;
    reply(new Response(JSON.stringify({ type: 'success', status: 200 })));
    await settle();
    expect(root.textContent).toContain('Saved.');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(reads + 1);
  });
});

describe('stale save target (#1370)', () => {
  it('keeps the draft and the opened base on an unavailable target, and reloads only on request', async () => {
    const posts: FormData[] = [];
    let reads = 0;
    const detail =
      'This customisation is no longer available. Your draft is kept.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        if (options?.method === 'POST') {
          posts.push(options.body as FormData);
          return new Response(
            JSON.stringify({
              type: 'failure',
              status: 409,
              data: { customisationFailed: { code: 'unavailable', detail } },
            }),
          );
        }
        reads++;
        return new Response(JSON.stringify(payload()));
      }),
    );
    const root = await panel();
    button(root, 'Open').click();
    await settle();
    await edit(root, 'my draft');
    const readsBeforeSave = reads;
    submit(root);
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(detail);
    expect(root.querySelector('textarea')?.value).toBe('my draft');
    expect(reads).toBe(readsBeforeSave);
    submit(root);
    await settle();
    expect(posts).toHaveLength(2);
    for (const fd of posts) {
      expect(fd.get('expectedRevision')).toBe('7');
      expect(fd.get('baseContent')).toBe('original draft');
      expect(fd.get('content')).toBe('my draft');
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button(root, 'Reload and discard draft').click();
    await settle();
    expect(reads).toBe(readsBeforeSave + 1);
    expect(root.querySelector('textarea')?.value).toBe('original draft');
  });
});
