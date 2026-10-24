import { flushSync, mount } from 'svelte';
import NodeEmbeddingBadges from '$lib/components/NodeEmbeddingBadges.svelte';

/** Author component preview only; independent QA checks the actual node page. */
export function mountEmbeddingPreview() {
  mount(NodeEmbeddingBadges, { target: document.getElementById('pending')!, props: { enabled: true, pendingAt: '2099-01-01T00:00:00Z' } });
  mount(NodeEmbeddingBadges, { target: document.getElementById('failed')!, props: { enabled: true, failedAt: '2026-10-24T00:00:00Z', error: 'encrypted-no-plaintext (#206) <img src=x onerror="alert(1)"> ' + 'x'.repeat(130) } });
  flushSync();
}
