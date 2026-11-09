/** Synthetic transport, real components: author layout evidence only, never an authorization or provider claim. */
import { mount, unmount } from 'svelte';
import BootInstallCompile from '$lib/components/BootInstallCompile.svelte';
export function mountBootInstall(target: HTMLElement, variant: 'app' | 'worker' | 'source' | 'failed') {
  const owner = variant === 'app' ? { level: 'app' as const, app: 'app', agent: 'agent' } : { level: 'worker' as const, worker: 'worker', app: 'app', agent: 'agent' };
  const key = owner.level === 'app' ? 'appCompile:app:agent' : 'workerCompile:worker:app:agent';
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname !== '/app/boot-prompt') return original(input, init);
    if (url.searchParams.has('node')) {
      if (variant === 'failed') return new Response('{}', { status: 502 });
      const selection = { rev: null, approved: true, signed: false };
      return Response.json({ page: { offset: 0, total: 3, hasMore: false, pruned: false, items: [
        { name: 'Engineering safety and collaboration', urn: 'hrn:node:example.com:policies:engineering:safety', omitted: false, depth: 0, revNo: 3, selection, pruned: false },
        { name: null, urn: null, omitted: false, depth: 1, revNo: 2, selection, pruned: null },
        { name: 'Previous operating guide', urn: 'hrn:node:example.com:policies:guide', omitted: false, depth: 1, revNo: 1, selection, pruned: true },
      ] } });
    }
    if (init?.method === 'POST') return Response.json({ key, ok: false, text: 'Couldn’t confirm whether the prompt was built. Reload to check before trying again.' });
    return Response.json({ key, canStart: variant === 'source', source: null, pointerMatches: false, compiled: variant === 'source' ? null : { id: 'compiled', urn: 'hrn:node:example.com:install:boot:compiled', revision: 4, content: 'You are the engineering helper.\n\nFollow the approved safety guidance.', pending: true, lint: null } });
  };
  const instance = mount(BootInstallCompile, { target, props: { owner, canManage: true, title: owner.level === 'app' ? 'Boot prompt for Engineering helper in this App' : 'Worker boot prompt' } });
  return () => { void unmount(instance); window.fetch = original; };
}
