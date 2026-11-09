import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { mountComponent } from '$lib/test/mountComponent';
import BootInstallCompile from './BootInstallCompile.svelte';
import BootProvenance from './BootProvenance.svelte';
const mounted: { unmount: () => void }[] = [];
afterEach(() => { mounted.splice(0).forEach(m => m.unmount()); vi.unstubAllGlobals(); });
const owner = { level: 'worker' as const, worker: 'w', app: 'a', agent: 'g' };
const view = { key: 'workerCompile:w:a:g', source: null, canStart: true, compiled: null, pointerMatches: null };
const response = (value: unknown, ok = true) => ({ ok, json: async () => value });
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); } }
function mount(props: { owner: typeof owner; canManage: boolean | null; impersonating?: boolean }) {
  const m = mountComponent(BootInstallCompile, props); mounted.push(m); return m;
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent === text)!;
describe('portal#1666 mounted writes', () => {
  it('keeps signing out of pre-button compile and approval copy', async () => {
    const compiled = { id: 'c', urn: 'hrn:node:example.com:install:boot:compiled', revision: 3, content: 'Synthetic prompt', pending: true, approvalStatus: { state: 'NOT_APPROVED' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...view, compiled })));
    const m = mount({ owner, canManage: true }); await settle();
    expect(button(m.target, 'Update the prompt')).toBeTruthy();
    expect(button(m.target, 'Approve revision 3')).toBeTruthy();
    // Provenance selection settings are separate from the action copy.
    const controls = m.target.querySelector('button')!.closest('section') ?? m.target;
    for (const el of controls.querySelectorAll('button, p')) {
      if (!el.closest('[aria-label="Compiled prompt provenance"]')) expect(el.textContent).not.toMatch(/sign(?!ed in| in)/i);
    }
  });

  it.each([false, null])('hides every write for unknown or non-manager %s', async canManage => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(view)));
    const m = mount({ owner, canManage }); await settle();
    expect(m.target.querySelector('button')).toBeNull();
  });
  it('hides writes during impersonation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(view)));
    const m = mount({ owner, canManage: true, impersonating: true }); await settle();
    expect(m.target.querySelector('button')).toBeNull();
  });
  it('requires an explicit empty-source confirmation and sends this worker identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(view)); vi.stubGlobal('fetch', fetcher);
    const m = mount({ owner, canManage: true }); await settle();
    button(m.target, 'Start an empty source for this worker').click(); flushSync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(m.target.textContent).toContain('Nothing served changes');
    button(m.target, 'Start empty source').click(); await settle();
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.owner).toEqual(owner); expect(body.intent).toBe('start');
  });
  it('does not display a compile response after teardown', async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(view)).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    vi.stubGlobal('fetch', fetcher);
    const m = mount({ owner, canManage: true }); await settle();
    button(m.target, 'Update the prompt').click(); await settle(); m.unmount();
    resolve(response({ ok: true, key: view.key, text: 'Late success' })); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('Late success');
  });
  it('a rejected write is an unknown outcome, never a refusal or success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(view)).mockRejectedValueOnce(new Error('transport secret')));
    const m = mount({ owner, canManage: true }); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    expect(m.target.textContent).toContain('Couldn’t confirm whether the prompt was built');
    expect(m.target.textContent).not.toContain('Nothing changed');
    expect(m.target.textContent).not.toContain('transport secret');
  });
});
describe('portal#1666 mounted provenance', () => {
  it('concealed sources render uniformly, null retention says nothing, paging uses server offset', async () => {
    const row = { name: null, urn: null, omitted: false, depth: 1, revNo: 2, selection: { rev: null, approved: true, signed: false }, pruned: null };
    const fetcher = vi.fn().mockResolvedValue(response({ page: { items: [row, row], total: 23, hasMore: true, pruned: false, offset: 0 } })); vi.stubGlobal('fetch', fetcher);
    const m = mountComponent(BootProvenance, { nodeId: 'c', revision: 3 }); mounted.push(m); await settle();
    expect(m.target.textContent?.match(/Not available to you/g)).toHaveLength(2);
    expect(m.target.textContent).not.toMatch(/not pruned|no longer kept/);
    button(m.target, 'Next').click(); await settle();
    expect(fetcher.mock.calls[1][0]).toContain('offset=20');
  });
  it('null provenance has no section and a failed read is not empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ page: null })).mockRejectedValueOnce(new Error('private')));
    const first = mountComponent(BootProvenance, { nodeId: 'c', revision: 3 }); mounted.push(first); await settle();
    expect(first.target.querySelector('section')).toBeNull(); first.unmount();
    const second = mountComponent(BootProvenance, { nodeId: 'd', revision: 3 }); mounted.push(second); await settle();
    expect(second.target.textContent).toContain('Couldn’t load what this revision was built from');
  });
});

describe('stale revision responses', () => {
  it('drops a provenance read after the revision is unmounted, including its failure', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ page: null })));
    const old = mountComponent(BootProvenance, { nodeId: 'old', revision: 1 }); mounted.push(old); await settle(); old.unmount();
    const current = mountComponent(BootProvenance, { nodeId: 'new', revision: 2 }); mounted.push(current); await settle();
    resolve(response({ page: { items: [], total: 999, hasMore: true, pruned: true } })); await settle();
    expect(current.target.textContent).not.toContain('999');
    expect(current.target.textContent).not.toContain('no longer kept');
  });
  it('a late result for worker A cannot appear when worker B is mounted', async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(response(view)).mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ ...view, key: 'workerCompile:other:a:g' })); vi.stubGlobal('fetch', fetcher);
    const old = mount({ owner, canManage: true }); await settle(); button(old.target, 'Update the prompt').click(); await settle(); old.unmount();
    const current = mount({ owner: { ...owner, worker: 'other' }, canManage: true }); await settle();
    resolve(response({ ok: true, key: view.key, text: 'Wrong worker success' })); await settle();
    expect(current.target.textContent).not.toContain('Wrong worker success');
  });
});


describe('same-instance scope changes', () => {
  it('drops a late read for A after the mounted panel changes to B', async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ ...view, key: 'workerCompile:other:a:g', canStart: false }));
    vi.stubGlobal('fetch', fetcher);
    const props = reactiveProps({ owner, canManage: true });
    const m = mountComponent(BootInstallCompile, props); mounted.push(m); await settle();
    props.owner = { ...owner, worker: 'other' }; flushSync(); await settle();
    resolve(response(view)); await settle();
    expect(m.target.querySelector('[data-install-compile]')?.getAttribute('data-install-compile')).toBe('workerCompile:other:a:g');
    expect(m.target.textContent).not.toContain('Start an empty source');
    expect(m.target.textContent).toContain('Update the prompt');
  });
  it('drops provenance arriving for an older displayed revision in the same instance', async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue(response({ page: { items: [], total: 2, hasMore: false, pruned: false, offset: 0 } }));
    vi.stubGlobal('fetch', fetcher);
    const props = reactiveProps({ nodeId: 'c', revision: 1 });
    const m = mountComponent(BootProvenance, props); mounted.push(m); await settle();
    props.revision = 2; flushSync(); await settle();
    props.revision = 1; flushSync(); await settle(); // 1→2→1 must still reject the first window.
    resolve(response({ page: { items: [], total: 999, hasMore: false, pruned: true, offset: 0 } })); await settle();
    expect(m.target.textContent).not.toContain('999');
    expect(m.target.textContent).not.toContain('no longer kept');
    expect(m.target.textContent).toContain('of 2');
  });
  it('keeps the confirmed outcome when a same-identity parent refresh supplies a new owner object', async () => {
    const fetcher = vi.fn().mockImplementation(async (_input, init) => response(init?.method === 'POST' ? { ok: true, key: view.key, text: 'Built revision 3. It isn’t approved yet.' } : view));
    vi.stubGlobal('fetch', fetcher);
    const props = reactiveProps({ owner, canManage: true });
    const m = mountComponent(BootInstallCompile, props); mounted.push(m); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    expect(m.target.textContent).toContain('Built revision 3');
    props.owner = { ...owner }; flushSync(); await settle();
    expect(m.target.textContent).toContain('Built revision 3');
  });
});
