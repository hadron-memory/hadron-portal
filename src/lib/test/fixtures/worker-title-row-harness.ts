// portal#2564: mounts the real worker-detail title row for scripts/test-worker-title-row-layout.mjs.
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import WorkerTitleRow from '../../../routes/app/workers/[id]/WorkerTitleRow.svelte';

/** Mounts the row with a badge and an actions button beside the name, as the page does. */
export function mountTitleRow(target: HTMLElement, name: string): () => void {
  const children = createRawSnippet(() => ({
    render: () => '<span><span data-testid="badge">Active</span> <button type="button" data-testid="actions">Actions</button></span>',
  }));
  const row = mount(WorkerTitleRow, { target, props: { name, children } });
  flushSync();
  return () => unmount(row);
}
