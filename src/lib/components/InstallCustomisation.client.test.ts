import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Panel from './InstallCustomisation.svelte';
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
    button(root, 'Reload').click();
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
    button(root, 'Reload').click();
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

describe('UX draft and panel navigation boundaries',()=>{
  it.each(['Open','Next','Previous','Start customising'])('keeps a dirty draft when %s discard is declined',async(action)=>{
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    const root=await panel();
    if(action==='Previous'){button(root,'Next').click();await settle();}
    button(root,'Open').click();await settle();await edit(root,'unsaved draft');
    const count=vi.mocked(fetch).mock.calls.length;
    button(root,action).click();await settle();
    expect(confirm).toHaveBeenCalledOnce();expect(vi.mocked(fetch)).toHaveBeenCalledTimes(count);
    expect(root.querySelector('textarea')?.value).toBe('unsaved draft');
  });
  it('allows navigation after an explicit discard confirmation',async()=>{
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
    const root=await panel();button(root,'Open').click();await settle();await edit(root,'unsaved draft');
    button(root,'Next').click();await settle();expect(confirm).toHaveBeenCalledOnce();expect(root.querySelector('textarea')).toBeNull();
  });
  it('focuses and reveals the panel heading when opened',async()=>{
    const scroll=vi.fn();const prior=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:scroll});
    try{const root=await panel();expect(document.activeElement).toBe(root.querySelector('h3'));expect(scroll).toHaveBeenCalled();}
    finally{if(prior)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',prior);else delete (HTMLElement.prototype as any).scrollIntoView;}
  });
  it('confirms a dirty Close and closes only after acceptance',async()=>{
    const close=vi.fn();const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    const m=mountComponent(Panel,{appRef:'app-a',agent,canManage:true,onClose:close});mounted.push(m);await settle();
    button(m.target,'Open').click();await settle();await edit(m.target,'unsaved draft');
    button(m.target,'Close').click();await settle();expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);button(m.target,'Close').click();await settle();expect(close).toHaveBeenCalledOnce();
  });
});
