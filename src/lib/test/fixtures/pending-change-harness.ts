// portal#2586: mounts the real PendingChange notice for scripts/test-pending-change-unlinked-layout.mjs.
import { flushSync, mount, unmount } from 'svelte';
import PendingChange from '../../components/secrets/PendingChange.svelte';

/** An open request whose signing link could not be offered (`ceremonyUrl` null): the unlinked hint beside Withdraw. */
export function mountUnlinkedPendingChange(target: HTMLElement): () => void {
  const notice = mount(PendingChange, {
    target,
    props: { requestId: 'r1', secretId: 's1', ceremonyUrl: null, state: 'open', operation: 'CREATE', expiresAt: '2026-11-21T01:00:00Z' },
  });
  flushSync();
  return () => unmount(notice);
}
