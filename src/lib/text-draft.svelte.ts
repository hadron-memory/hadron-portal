/**
 * The node page's Content and Abstract Source drafts (#927), and the revision
 * each one is based on.
 *
 * A save sends that revision as `expectedRevision` (hadron-server#937), so the
 * server refuses it atomically when anything else wrote the node since the
 * editor opened. Before #927 the page sent the whole editor buffer with no
 * precondition, and a stale buffer silently replaced newer content.
 *
 * The rules mirror `JsonDraft` (json-draft.svelte.ts), plus one for the
 * revision:
 *
 * - a different NODE always re-seeds (the page is reused across nodes, #251);
 * - nothing is seeded until the Source view opens (`ensureSeeded`). That is
 *   when the revision is captured, together with the text it belongs to;
 * - a CHANGED value re-seeds only a clean draft. A dirty one keeps both its
 *   text and its revision, so its save is refused as a conflict rather than a
 *   reload discarding the user's edit;
 * - the SAME value at a newer revision (an unrelated reload, such as a
 *   Properties save on another tab) moves the revision forward and keeps
 *   the draft. The loader reads value and revision in one query, so that
 *   pair proves this field did not change. Refusing it would only produce a
 *   false conflict for the user's own edit on another tab;
 * - this editor's own successful save re-seeds explicitly (`reseed`).
 *
 * The revision is never refreshed just before a save: that would turn the
 * precondition into "whatever is there now", which is no precondition at all.
 */
import { untrack } from 'svelte';
import { postSourceSave, type SubmitResult } from './json-draft.svelte';

/** Which node, the stored value of the edited field, and the node's live revision. */
export interface TextDraftSource {
  id: string;
  value: string | null | undefined;
  revision: number | null | undefined;
}

export class TextDraft {
  /** The editor's text. Empty until `ensureSeeded`. */
  text = $state('');
  /**
   * The `Node.revision` the draft is based on, sent as `expectedRevision`.
   * Null before the Source view has opened, or when the node carried none.
   */
  baseRevision = $state<number | null>(null);
  /** The text as seeded; the draft is dirty when `text` differs from it. */
  #seededText = $state('');
  /** The stored value `baseRevision` belongs to. */
  #baseValue = '';
  #nodeId: string | null = null;
  #latest: TextDraftSource | null = null;
  #pending = true;

  get dirty(): boolean {
    return !this.#pending && this.text !== this.#seededText;
  }

  /**
   * Whether the stored value no longer matches the one this draft was based on.
   * Distinguishes a conflict over this field from one over some other field.
   */
  isBehind(value: string | null | undefined): boolean {
    return !this.#pending && (value ?? '') !== this.#baseValue;
  }

  /** Apply the rules above to the node as it is NOW. */
  sync(src: TextDraftSource): void {
    if (src.id !== this.#nodeId || this.#pending) {
      this.reseed(src);
      return;
    }
    if ((src.value ?? '') === this.#baseValue) {
      // This field is unchanged, so the draft's base is still true at the
      // newer revision.
      if (src.revision != null) this.baseRevision = src.revision;
      return;
    }
    if (!this.dirty) {
      this.reseed(src);
      this.ensureSeeded();
    }
    // Dirty and changed underneath: keep the draft AND its revision.
  }

  /** Start over from `src`: a new node, after this editor saved, or a discarded draft. Lazy. */
  reseed(src: TextDraftSource): void {
    this.#nodeId = src.id;
    this.#latest = { ...src };
    this.#pending = true;
    this.text = '';
    this.#seededText = '';
    this.#baseValue = '';
    this.baseRevision = null;
  }

  /** Build the text and capture the revision. Called when the Source view opens; idempotent. */
  ensureSeeded(): void {
    if (!this.#pending) return;
    this.#pending = false;
    this.#baseValue = this.#latest?.value ?? '';
    this.baseRevision = this.#latest?.revision ?? null;
    this.text = this.#baseValue;
    this.#seededText = this.text;
  }
}

/**
 * Wire a draft to a node source: the ONE effect the page runs per draft,
 * exported so the client-lane test mounts exactly this. Must be called during
 * component initialisation. The draft is read under `untrack`, as in
 * `syncDraftWith`, so a keystroke does not re-run the effect.
 */
export function syncTextDraftWith(draft: TextDraft, getSource: () => TextDraftSource): void {
  $effect(() => {
    const src = getSource();
    const snapshot = { id: src.id, value: src.value, revision: src.revision };
    untrack(() => draft.sync(snapshot));
  });
}

/**
 * POST one Content or Abstract save to `url`, the ORIGINATING node's absolute
 * action URL, fixed by the caller before anything is awaited. A relative
 * `?/action` resolves against wherever the page is when the request goes out,
 * and two nodes can easily share a revision number, so the precondition alone
 * would not catch node A's draft landing on node B (@codex on #893).
 */
export async function submitTextDraft(opts: {
  url: string;
  field: 'content' | 'abstract';
  text: string;
  expectedRevision: number | null;
  fetchImpl?: typeof fetch;
}): Promise<SubmitResult> {
  const fd = new FormData();
  fd.set(opts.field, opts.text);
  if (opts.expectedRevision != null) fd.set('expectedRevision', String(opts.expectedRevision));
  return postSourceSave({ url: opts.url, body: fd, field: opts.field, fetchImpl: opts.fetchImpl });
}
