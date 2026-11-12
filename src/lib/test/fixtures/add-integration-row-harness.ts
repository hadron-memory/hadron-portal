// #1826: mounts the real Org Integrations add-row for scripts/test-org-integrations-row-layout.mjs.
import { flushSync, mount, unmount } from 'svelte';
import AddIntegrationRow from '../../components/AddIntegrationRow.svelte';

export function mountAddRow(target: HTMLElement): () => void {
  const row = mount(AddIntegrationRow, { target, props: { hasGithubConfigured: false, onconfigure: () => {} } as never });
  flushSync();
  return () => unmount(row);
}
