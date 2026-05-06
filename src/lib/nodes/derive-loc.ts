// 010-create-node-on-portal — derive a child node's `loc` from its parent.
// Loc is colon-separated (URN-style); the canonical site is MemoryBrowser's
// move handler at src/lib/components/MemoryBrowser.svelte (newLoc =
// `${newParentLoc}:${name}`). Server-side only — the create-node action
// recomputes loc before calling upsertNode so a crafted client cannot escape
// the chosen parent path.

import { toSlug } from '$lib/slug';

export function deriveChildLoc(parentLoc: string, title: string): string {
  const slug = toSlug(title);
  if (slug.length === 0) {
    throw new Error('Cannot derive child loc: title produces an empty slug');
  }
  const trimmedParent = parentLoc.replace(/:+$/, '');
  return trimmedParent === '' ? slug : `${trimmedParent}:${slug}`;
}
