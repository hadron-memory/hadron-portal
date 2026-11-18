// #1826: mounts the real Org Integrations add-row for scripts/test-org-integrations-row-layout.mjs.
import { flushSync, mount, unmount } from 'svelte';
import AddIntegrationRow from '../../components/AddIntegrationRow.svelte';

/** Counts Configure clicks, so the script can pin that the button reaches `onconfigure` (portal#1829). */
export type AddRowOptions = { hasGithubConfigured?: boolean; onconfigure?: () => void };

export function mountAddRow(target: HTMLElement, options: AddRowOptions = {}): () => void {
  const row = mount(AddIntegrationRow, {
    target,
    props: { hasGithubConfigured: options.hasGithubConfigured ?? false, onconfigure: options.onconfigure ?? (() => {}) },
  });
  flushSync();
  return () => unmount(row);
}
