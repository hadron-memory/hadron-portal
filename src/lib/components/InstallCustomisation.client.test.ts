import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Panel from './InstallCustomisation.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { emptyRegions, regionHolding } from '$lib/test/liveRegionPin';
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
  it('portal#1761: filters customisation rows by the search box and restores them when cleared', async () => {
    const twoRows = payload();
    twoRows.list.value!.nodes = [node, { ...node, id: 'n2', loc: 'other', name: 'Other' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(twoRows))));
    const root = await panel();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Search the customisations on this page"]')!;
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    input.value = 'note'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.querySelector('tbody')?.textContent).toContain('Note');
    expect(root.querySelector('tbody')?.textContent).not.toContain('Other');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
  });
  const offsetOf = (call: unknown[]) => new URL(String(call[0]), 'http://x').searchParams.get('offset');
  // portal#1509 item 1: an empty page past the end (rows deleted since the
  // list was read) must never read "Loaded 21–20 of 20", must not claim the
  // node list is limited (the total is known), and must leave a way back.
  it('portal#1509: an empty page past the end shows no impossible range and offers the last valid page', async () => {
    const root = await panel();
    const before = emptyRegions(root);
    const past = { ...payload(), list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [], total: 20, offset: 20 } } };
    // The first answer is the empty past-end page; after the way back, a real page.
    const answers: unknown[] = [past, payload()];
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(answers.shift() ?? payload())));
    vi.stubGlobal('fetch', fetcher);
    button(root, 'Next').click();
    await settle();
    expect(offsetOf(fetcher.mock.calls[0])).toBe('20');
    expect(root.textContent).not.toMatch(/21\s*[–-]\s*20/);
    expect(root.querySelector('[data-testid="customisation-list-unavailable"]'), 'the known total is not a limited list').toBeNull();
    expect(root.textContent).toMatch(/past the last one\. There are 20 customisations/);
    // The note lands in the status region that existed before (portal#2344, #2379), so it is announced.
    const region = regionHolding(root, 'past the last one');
    expect(before).toContain(region);
    expect(region.getAttribute('role')).toBe('status');
    const back = button(root, 'Last page');
    expect(back, 'a way to the last page that exists').toBeTruthy();
    expect(back.disabled).toBe(false);
    back.click();
    await settle();
    // total 20 -> the last valid page starts at offset 0.
    expect(offsetOf(fetcher.mock.calls[1])).toBe('0');
    // ...and it lands somewhere usable: rows render, the note and the button are gone.
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.querySelector('[data-testid="customisation-past-end"]')).toBeNull();
    expect([...root.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Last page')).toBe(false);
  });
  // Bernice on #2428: the boundary the new condition depends on. An empty page INSIDE
  // the total (offset 20, total 100) is the server's limited list (portal#1524), and an
  // empty first page (offset 0) is never a way-back case either: both keep the limited
  // note and offer no Last page. The echoed offset decides, not the request offset: the
  // panel asked for 20, the response says it served offset 0.
  it.each([
    ['inside the total (offset 20, total 100)', 100, 20, 1],
    ['an empty first page (offset 0, total 0)', 0, 0, 1],
    ['the request offset 20 but the response echoing offset 0', 0, 0, 1],
  ])('portal#1509: an empty page %s keeps the limited note and offers no Last page', async (_label, total, echoed, steps) => {
    const full = { ...payload(), list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [node], total: 1000, offset: 0 } } };
    const empty = { ...payload(), list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [], total, offset: echoed } } };
    const answers: unknown[] = Array.from({ length: steps }, () => full);
    vi.stubGlobal('fetch', vi.fn(async (_url: string) => new Response(JSON.stringify(answers.shift() ?? empty))));
    const root = await panel();
    for (let i = 0; i < steps; i++) { button(root, 'Next').click(); await settle(); }
    expect(root.querySelector('[data-testid="customisation-list-unavailable"]'), 'the limited-list note').not.toBeNull();
    expect(root.querySelector('[data-testid="customisation-past-end"]')).toBeNull();
    expect([...root.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Last page')).toBe(false);
  });
  // Georgia/Cedric on #2428: the way back must land where rows exist, not always on 0,
  // the singular copy is pinned, and a total of 0 at a later page (every row deleted)
  // still offers the way back instead of the 'node list is limited' note.
  it.each([
    ['total 41 at offset 60 lands on the last page that exists', 41, 60, '40', /There are 41 customisations/],
    ['total 1 at offset 20 reads in the singular', 1, 20, '0', /There is 1 customisation\./],
    ['total 0 at offset 20 (every row deleted) goes back to the first page', 0, 20, '0', /There are 0 customisations/],
  ])('portal#1509: past-end %s', async (_label, total, at, expected, copy) => {
    // Page forward with real Next clicks so the panel's own offset is `at`, then the
    // server answers the last request with an empty page (rows deleted meanwhile).
    const full = { ...payload(), list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [node], total: 1000, offset: 0 } } };
    const past = { ...payload(), list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [], total, offset: at } } };
    const steps = at / 20;
    const answers: unknown[] = Array.from({ length: steps }, () => full);
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify(answers.shift() ?? past)));
    vi.stubGlobal('fetch', fetcher);
    const root = await panel();
    for (let i = 0; i < steps; i++) { button(root, 'Next').click(); await settle(); }
    expect(offsetOf(fetcher.mock.calls.at(-1)!)).toBe(String(at));
    expect(root.querySelector('[data-testid="customisation-list-unavailable"]'), 'a known total is not a limited list').toBeNull();
    expect(root.textContent).toMatch(copy);
    const calls = fetcher.mock.calls.length;
    button(root, 'Last page').click();
    await settle();
    expect(offsetOf(fetcher.mock.calls[calls])).toBe(expected);
  });
  // portal#1509 item 4: the reload button throws away a draft a read-only
  // viewer cannot have, so it belongs inside the same gate as the form.
  it.each([[false, false], [true, true], [null, true]])('portal#1509: canManage=%s shows "Reload and discard draft": %s', async (canManage, shown) => {
    const root = await panel(canManage as boolean | null);
    root.querySelector<HTMLButtonElement>('button[aria-label^="Open Note"]')!.click();
    await settle();
    expect(root.querySelector('h4')?.textContent).toBe('Original');
    const reload = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reload and discard draft');
    expect(Boolean(reload)).toBe(shown);
    // portal#2444: the refusal sentences that say "use Reload and discard draft"
    // are only produced by the save form, so the form and the button share one
    // gate: whoever can be told to use the button has the form that gets the
    // sentence, and a viewer without the form never receives it.
    expect(Boolean(root.querySelector('form[action$="saveCustomisation"]')), 'the save form shares the button gate').toBe(shown);
  });
  // portal#1509 item 5: a search that matches nothing says so, in a region that
  // is already mounted before the filter runs (portal#2379).
  it('portal#1509: a search with no match says so and clears when the filter does', async () => {
    const root = await panel();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Search the customisations on this page"]')!;
    const note = () => root.querySelector('[data-testid="customisation-no-match"]');
    const before = emptyRegions(root);
    expect(note()).toBeNull();
    input.value = 'zzz-nothing'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick(4);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0);
    // A fixed sentence: the query is not echoed, so it does not re-announce on every keystroke.
    expect(note()?.textContent).toBe('No customisations on this page match your search.');
    const region = regionHolding(root, 'match your search');
    expect(before).toContain(region);
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); await tick(4);
    expect(note()).toBeNull();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
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
    expect(m.target.querySelector('[role="status"][data-feedback]')?.textContent).toBe('');
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
    expect(m.target.querySelector('[role="alert"][data-feedback]')?.textContent).toBe('');
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

describe('install customisation polish (#1369)', () => {
  const listOf = (total: number, nodes = [node]) => ({
    list: {
      state: 'ok',
      value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes, total, offset: 0 },
    },
    replacement: { state: 'not-shown' },
    original: { state: 'not-shown' },
  });
  const serve = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));

  it('counts one customisation in the singular', async () => {
    serve(listOf(1));
    const root = await panel();
    expect(root.textContent).toContain('1 customisation');
    expect(root.textContent).not.toContain('1 customisations');
  });

  // portal#1369: a one-row result keeps the shared table and the count line, but not the
  // controls that have nothing to act on (a search box over one row, a pager with both
  // buttons disabled).
  it('lightens a one-row result: no search and no pager, but still the table, the count and the row action', async () => {
    serve(listOf(1));
    const root = await panel();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.querySelector('input[aria-label="Search the customisations on this page"]')).toBeNull();
    expect(button(root, 'Previous')).toBeUndefined();
    expect(button(root, 'Next')).toBeUndefined();
    expect(root.textContent).toContain('Loaded 1–1 of 1 customisation');
    expect(root.querySelector('button[aria-label="Open Note (note)"]')).not.toBeNull();
  });

  // Blind P2-1: hiding the box must never strand an active filter with no way to clear it.
  it('keeps the search box while a filter is active, then hides it once the filter is cleared', async () => {
    serve(listOf(25, [node, { ...node, id: 'n2', loc: 'other', name: 'Other' }]));
    const root = await panel();
    const input = () => root.querySelector<HTMLInputElement>('input[aria-label="Search the customisations on this page"]');
    input()!.value = 'zzz'; input()!.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    serve(listOf(1)); // the list shrinks to one row while the filter is still set
    button(root, 'Next').click();
    await new Promise((r) => setTimeout(r, 0)); await tick(4);
    expect(root.textContent).toContain('Loaded 1–1 of 1 customisation');
    expect(input()).not.toBeNull();
    input()!.value = ''; input()!.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(input()).toBeNull();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('control: one loaded row out of a larger server total keeps search and paging', async () => {
    serve(listOf(25));
    const root = await panel();
    expect(root.querySelector('input[aria-label="Search the customisations on this page"]')).not.toBeNull();
    expect(button(root, 'Next')).toBeDefined();
    expect(root.textContent).toContain('Loaded 1–1 of 25 customisations');
  });

  it('control: several rows keep search and paging', async () => {
    serve(listOf(2, [node, { ...node, id: 'n2', loc: 'other', name: 'Other' }]));
    const root = await panel();
    expect(root.querySelector('input[aria-label="Search the customisations on this page"]')).not.toBeNull();
    expect(button(root, 'Next')).toBeDefined();
  });

  it('names the loaded range out of the server total, so disabled paging is explained in text', async () => {
    serve(listOf(25));
    const root = await panel();
    expect(root.textContent).toContain('Loaded 1–1 of 25 customisations');
  });

  it.each([0, 20, 40])('uses one pager for the entire loaded batch at offset %s (UX F1)', async (targetOffset) => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const offset = Number(new URL(String(input), 'https://example.test').searchParams.get('offset') ?? 0);
      const nodes = Array.from({ length: Math.min(20, 45 - offset) }, (_, i) => ({
        ...node, id: `n-${offset + i + 1}`, name: `Customisation ${offset + i + 1}`,
        loc: `custom:${offset + i + 1}`, urn: `hrn:node:acme.com:install:custom:${offset + i + 1}`,
      }));
      const response = listOf(45, nodes);
      response.list.value.offset = offset;
      return new Response(JSON.stringify(response));
    }));
    const root = await panel();
    for (let offset = 0; offset < targetOffset; offset += 20) {
      button(root, 'Next').click();
      await settle();
    }
    const loaded = Math.min(20, 45 - targetOffset);
    // A loaded batch is already paged: a second client pager hid half its rows.
    expect(root.querySelectorAll('tbody tr')).toHaveLength(loaded);
    expect(root.querySelector('[data-testid="table-footer"]')).toBeNull();
    for (const label of ['Previous', 'Next']) {
      expect([...root.querySelectorAll('button')].filter(b => b.textContent?.trim() === label)).toHaveLength(1);
    }
    expect(root.textContent).toContain(`Loaded ${targetOffset + 1}–${targetOffset + loaded} of 45 customisations`);
    expect(button(root, 'Previous').disabled).toBe(targetOffset === 0);
    expect(button(root, 'Next').disabled).toBe(targetOffset + loaded >= 45);
    const search = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    search.value = 'no-such-customisation';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(4);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0);
    // Loaded describes the fetched batch, rather than claiming these are visible matches.
    expect(root.textContent).toContain(`Loaded ${targetOffset + 1}–${targetOffset + loaded} of 45 customisations`);
  });

  it('scopes search to the loaded page in its accessible name', async () => {
    const root = await panel();
    const search = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(search.getAttribute('aria-label')).toBe('Search the customisations on this page');
  });

  it('filters the loaded rows by the search text (QA #1508 F1)', async () => {
    const other = { ...node, id: 'n2', loc: 'boot', name: 'Boot prompt' };
    serve(listOf(2, [node, other]));
    const root = await panel();
    const search = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    const rowNames = () =>
      [...root.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    expect(rowNames()).toHaveLength(2);
    search.value = 'boot';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(4);
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain('Boot prompt');
    search.value = 'no-such-customisation';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(4);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('names each row action with the row it opens', async () => {
    const root = await panel();
    expect(button(root, 'Open').getAttribute('aria-label')).toBe('Open Note (note)');
  });

  it('shows read-only guidance only for an explicit non-manager', async () => {
    const sentence = 'You can view these customisations. Only someone who manages this App can change them.';
    expect((await panel(false)).textContent).toContain(sentence);
    expect((await panel(null)).textContent).not.toContain(sentence);
    expect((await panel(true)).textContent).not.toContain(sentence);
  });

  it('keeps both feedback regions mounted and empty before a save, and fills the same nodes', async () => {
    let reject = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) =>
        options?.method === 'POST'
          ? new Response(JSON.stringify(reject ? {
              type: 'failure',
              status: 409,
              data: { customisationFailed: { code: 'unavailable', detail: 'Gone.' } },
            } : { type: 'success', status: 200 }))
          : new Response(JSON.stringify(payload())),
      ),
    );
    const root = await panel();
    button(root, 'Open').click();
    await settle();
    const status = root.querySelector<HTMLElement>('section [role="status"][data-feedback]');
    const alert = root.querySelector<HTMLElement>('section [role="alert"][data-feedback]');
    expect(status?.textContent).toBe('');
    expect(alert?.textContent).toBe('');
    await edit(root, 'my draft');
    submit(root);
    await settle();
    expect(root.querySelector('section [role="alert"][data-feedback]')).toBe(alert);
    expect(alert?.textContent).toBe('Gone.');
    expect(status?.textContent).toBe('');
    reject = false;
    submit(root);
    await settle();
    expect(root.querySelector('section [role="status"][data-feedback]')).toBe(status);
    expect(root.querySelector('section [role="alert"][data-feedback]')).toBe(alert);
    expect(status?.textContent).toBe('Saved.');
    expect(alert?.textContent).toBe('');
  });

  it.each([['loc', 0], ['name', 1]] as const)('treats a typed %s with unchanged empty content as unsaved', async (_field, index) => {
    const root = await panel();
    button(root, 'Start customising').click();
    await settle();
    const locInput = root.querySelectorAll<HTMLInputElement>('form input')[index]!;
    locInput.value = 'boot:extra';
    locInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    button(root, 'Next').click();
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll<HTMLInputElement>('form input')[index]?.value).toBe('boot:extra');
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

// portal#2379 (slice of portal#2344): the empty-page note arrives after a page change, so it lands in a
// status region that was already mounted and empty, not inserted populated with its branch.
describe('empty-list note live region', () => {
  it('a Next that returns an empty page puts the note in the region that existed before', async () => {
    const empty = { ...payload(), list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [], total: 25, offset: 1 } } };
    const answers = [payload(), empty];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answers.shift() ?? empty), { headers: { 'Content-Type': 'application/json' } })));
    const root = await panel();
    const before = emptyRegions(root);
    expect(before.length).toBeGreaterThan(0);
    expect(root.querySelector('[data-testid="customisation-list-unavailable"]')).toBeNull();
    button(root, 'Next').click();
    await settle();
    const note = root.querySelector('[data-testid="customisation-list-unavailable"]');
    expect(note?.textContent).toContain('may not be the full set');
    const region = regionHolding(root, 'may not be the full set');
    expect(before).toContain(region);
    expect(region.getAttribute('role')).toBe('status');
  });
});

describe('focus survives the list controls unmounting (#2549)', () => {
  const listOf = (total: number, nodes = [node]) => ({
    list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes, total, offset: 0 } },
    replacement: { state: 'not-shown' },
    original: { state: 'not-shown' },
  });
  const serve = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))));
  const two = [node, { ...node, id: 'n2', loc: 'other', name: 'Other' }];
  const settle = async () => { await new Promise((r) => setTimeout(r, 0)); await tick(4); };
  const search = (root: HTMLElement) =>
    root.querySelector<HTMLInputElement>('input[aria-label="Search the customisations on this page"]');

  it('pager: Next that lands on a one-row page leaves focus on the heading, not body', async () => {
    serve(listOf(25, two));
    const root = await panel();
    const next = button(root, 'Next');
    next.focus();
    expect(document.activeElement).toBe(next);
    serve(listOf(1));
    next.click();
    await settle();
    expect(button(root, 'Next')).toBeUndefined();
    expect(document.activeElement).toBe(root.querySelector('h3'));
  });

  it('search: backspacing a stranded filter to empty on a one-row list leaves focus on the heading', async () => {
    serve(listOf(25, two));
    const root = await panel();
    search(root)!.value = 'zzz';
    search(root)!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    serve(listOf(1));
    button(root, 'Next').click();
    await settle();
    const box = search(root)!;
    box.focus();
    box.value = '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(search(root)).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('h3'));
  });

  it('control: focus the reader did not have in the list is not stolen by a load', async () => {
    serve(listOf(25, two));
    const root = await panel();
    const start = button(root, 'Start customising');
    start.focus();
    serve(listOf(1));
    button(root, 'Next').click();
    await settle();
    expect(document.activeElement).toBe(start);
  });

  it('control: a search box that stays mounted keeps its focus', async () => {
    serve(listOf(25, two));
    const root = await panel();
    const box = search(root)!;
    box.focus();
    box.value = 'o';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(search(root));
  });
});
