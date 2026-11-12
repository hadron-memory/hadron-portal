import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { mountComponent, captureUnhandledRejections } from '$lib/test/mountComponent';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import BootInstallCompile from './BootInstallCompile.svelte';
import BootProvenance from './BootProvenance.svelte';
const mounted: { unmount: () => void }[] = [];
afterEach(() => { mounted.splice(0).forEach(m => m.unmount()); vi.unstubAllGlobals(); resetNavigationCalls(); });
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
    expect(navigationCalls.filter(call => call.fn === 'invalidateAll')).toEqual([]);
  });
  it('drops a write response keyed to another owner and does not refresh', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(view))
      .mockResolvedValueOnce(response({ ok: true, key: 'workerCompile:other:a:g', text: 'Wrong owner success' }));
    vi.stubGlobal('fetch', fetcher);
    const m = mount({ owner, canManage: true }); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(m.target.textContent).not.toContain('Wrong owner success');
    expect(m.target.querySelector('[role=status]')?.textContent).toBe('');
    expect(navigationCalls.filter(call => call.fn === 'invalidateAll')).toEqual([]);
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
  it('distinguishes truncation omissions from concealed sources', async () => {
    const row = { name: null, urn: null, depth: 1, revNo: 2, selection: { rev: null, approved: true, signed: false }, pruned: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ page: { items: [{ ...row, omitted: false }, { ...row, omitted: true }], total: 2, hasMore: false, pruned: false, offset: 0 } })));
    const m = mountComponent(BootProvenance, { nodeId: 'c', revision: 3 }); mounted.push(m); await settle();
    expect(m.target.textContent?.match(/Not available to you/g)).toHaveLength(1);
    expect(m.target.textContent?.match(/name not loaded/g)).toHaveLength(1);
  });
  it('renders page-level and readable-row retention flags', async () => {
    const row = { name: 'Readable source', urn: 'hrn:node:example.com:policies:readable', omitted: false, depth: 1, revNo: 2, selection: { rev: null, approved: true, signed: false }, pruned: true };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ page: { items: [row], total: 1, hasMore: false, pruned: true, offset: 0 } })));
    const m = mountComponent(BootProvenance, { nodeId: 'c', revision: 3 }); mounted.push(m); await settle();
    expect(m.target.textContent?.match(/This revision’s text is no longer kept\./g)).toHaveLength(1);
    expect(m.target.textContent?.match(/No longer kept/g)).toHaveLength(2);
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
  it.each(['success', 'failure'])('keeps a late provenance %s after teardown isolated from a replacement instance', async outcome => {
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (reason: unknown) => void;
    const pending = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(pending).mockResolvedValue(response({ page: null })));
    const old = mountComponent(BootProvenance, { nodeId: 'old', revision: 1 }); mounted.push(old); await settle();
    const rejections = await captureUnhandledRejections(async () => {
      old.unmount();
      const current = mountComponent(BootProvenance, { nodeId: 'new', revision: 2 }); mounted.push(current); await settle();
      if (outcome === 'success') resolveOld(response({ page: { items: [], total: 999, hasMore: true, pruned: true } }));
      else rejectOld(new Error('late private failure'));
      await settle();
      expect(current.target.textContent).not.toContain('999');
      expect(current.target.textContent).not.toContain('no longer kept');
      expect(current.target.textContent).not.toContain('Couldn’t load what this revision was built from');
    });
    // Separate instances prove isolation and rejection handling, not the old
    // instance's internal epoch arm; detached DOM cannot observe that assignment.
    expect(rejections).toEqual([]);
  });
  it('drops a late unkeyed write after A→B→A while the current write is pending', async () => {
    let resolveOld!: (value: unknown) => void;
    let resolveCurrent!: (value: unknown) => void;
    let posts = 0;
    const otherView = { ...view, key: 'workerCompile:other:a:g' };
    const fetcher = vi.fn().mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        if (posts === 1) return new Promise(resolve => { resolveOld = resolve; });
        return new Promise(resolve => { resolveCurrent = resolve; });
      }
      return response(String(input).includes('worker=other') ? otherView : view);
    });
    vi.stubGlobal('fetch', fetcher);
    const props = reactiveProps({ owner, canManage: true });
    const m = mountComponent(BootInstallCompile, props); mounted.push(m); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    props.owner = { ...owner, worker: 'other' }; flushSync(); await settle();
    props.owner = owner; flushSync(); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    expect(button(m.target, 'Working…').disabled).toBe(true);
    resolveOld(response({ ok: true, text: 'Stale A success' })); await settle();
    expect(m.target.textContent).not.toContain('Stale A success');
    expect(button(m.target, 'Working…')?.disabled).toBe(true);
    button(m.target, 'Working…').click(); await settle();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
    expect(navigationCalls.filter(call => call.fn === 'invalidateAll')).toEqual([]);
    resolveCurrent(response({ ok: true, key: view.key, text: 'Current A built' }));
    await vi.waitFor(() => expect(navigationCalls.filter(call => call.fn === 'invalidateAll')).toHaveLength(1));
    await settle();
    expect(m.target.textContent).toContain('Current A built');
    expect(m.target.textContent).not.toContain('Stale A success');
    expect(button(m.target, 'Update the prompt').disabled).toBe(false);
    expect(navigationCalls.filter(call => call.fn === 'invalidateAll')).toHaveLength(1);
  });
  it('drops a late unkeyed write for A after the same mounted panel changes to B, without clearing B busy', async () => {
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    const otherView = { ...view, key: 'workerCompile:other:a:g' };
    const fetcher = vi.fn().mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.owner.worker === 'w') return new Promise(resolve => { resolveA = resolve; });
        return new Promise(resolve => { resolveB = resolve; });
      }
      return response(String(input).includes('worker=other') ? otherView : view);
    });
    vi.stubGlobal('fetch', fetcher);
    const props = reactiveProps({ owner, canManage: true });
    const m = mountComponent(BootInstallCompile, props); mounted.push(m); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    props.owner = { ...owner, worker: 'other' }; flushSync(); await settle();
    button(m.target, 'Update the prompt').click(); await settle();
    resolveA(response({ ok: true, text: 'Wrong worker success' })); await settle();
    const working = button(m.target, 'Working…');
    expect(working.disabled).toBe(true);
    working.click(); await settle();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST' && JSON.parse(String(init.body)).owner.worker === 'other')).toHaveLength(1);
    expect(m.target.textContent).not.toContain('Wrong worker success');
    resolveB(response({ ok: true, key: otherView.key, text: 'Worker B built' })); await settle();
    expect(m.target.textContent).toContain('Worker B built');
    expect(m.target.textContent).not.toContain('Wrong worker success');
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

// portal#2016 — the component's post-write invalidation is PINNED to the
// guarded helper. Nothing else in this suite rejects the reload, so until this
// case a bare `await invalidateAll()` in write()'s try left every test green.
// The gate's binding rule: the rejection must come through the REAL
// invalidateAll path (the stub's onInvalidateAll hook, which the navigation
// stub awaits inside its invalidateAll), never a stubbed
// bestEffortInvalidateAll — a stubbed helper stays green under exactly the
// mutant this case exists to kill.
describe('#2016: a rejecting post-write reload is the guard\'s to hold', () => {
  it('keeps the committed compile success, releases busy, and warns once', async () => {
    const fetcher = vi.fn().mockImplementation(async (_input: unknown, init?: { method?: string }) =>
      init?.method === 'POST' ? response({ ok: true, key: view.key, text: 'Built revision 3.' }) : response(view));
    vi.stubGlobal('fetch', fetcher);
    navigationHooks.onInvalidateAll = async () => { throw new Error('reload rejected (fixture)'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mount({ owner, canManage: true });
    const rejections = await captureUnhandledRejections(async () => {
      await settle();
      button(m.target, 'Update the prompt').click();
      await settle();
    });
    // Half one: nothing escapes — the rejection is the guard's to hold, and no
    // teardown continuation crashes after it either.
    expect(rejections, rejections.map(String).join(' | ')).toEqual([]);
    // Half two: the page state the compile wrote stays visible. Under the
    // mutant (a bare `await invalidateAll()` inside write()'s try) the
    // rejection reaches write()'s own catch and flips the committed success to
    // the unknown-failure text — both assertions below go red there.
    expect(m.target.querySelector('[role=status]')?.textContent).toContain('Built revision 3.');
    expect(m.target.textContent).not.toContain('Couldn’t confirm whether the prompt was built');
    expect(button(m.target, 'Update the prompt').disabled).toBe(false);
    // The guard leaves exactly ONE record, scoped, carrying the rejection.
    const scoped = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('[boot-install-compile] saved, but the reload after it failed'));
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toContain('reload rejected (fixture)');
    expect(navigationCalls.filter((call) => call.fn === 'invalidateAll')).toHaveLength(1);
    warn.mockRestore();
  });
});
