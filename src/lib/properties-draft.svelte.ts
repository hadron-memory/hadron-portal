/**
 * #886 — the Properties tab's Source draft, and WHEN it is re-seeded from the
 * node.
 *
 * The naive rule — re-seed whenever the page's `node` changes — loses work:
 * saving Content, Abstract or Data calls `invalidateAll()`, which hands the page
 * a NEW node object with the SAME properties, and an unsaved Source edit was
 * silently replaced (@codex on #893). So:
 *
 * - a different NODE always re-seeds (the page is reused across nodes, #251);
 * - the same bag again (an unrelated reload) keeps the draft untouched;
 * - a CHANGED bag re-seeds only a clean draft. A dirty one keeps both its text
 *   and its baseline, so the save's stale check refuses it with an explanation
 *   instead of the reload discarding the user's edit without one;
 * - this editor's own successful save re-seeds explicitly (`reseed`).
 *
 * The state lives in the page, not in a component inside the tab, because a
 * draft must survive switching tabs — that is the scenario that loses it.
 */
import { untrack } from 'svelte';
import { deserialize } from '$app/forms';
import { canonicalJson, propertiesFingerprint } from './properties-source';

export interface DraftNode {
  id: string;
  properties?: unknown;
}

function seedText(properties: unknown): string {
  // An empty bag opens on `{}`: something valid to add to.
  return properties != null ? JSON.stringify(properties, null, 2) : '{}';
}

export class PropertiesDraft {
  /** The editor's text. */
  text = $state('');
  /** The bag the draft was seeded from — what the save's fingerprint is of. */
  baseline = $state<unknown>(null);
  /** The text as seeded; the draft is dirty when `text` differs from it. */
  #seededText = $state('');
  #nodeId: string | null = null;
  #baselineCanon = '';

  get dirty(): boolean {
    return this.text !== this.#seededText;
  }

  /** Apply the rule above to the node as it is NOW. */
  sync(node: DraftNode): void {
    const canon = canonicalJson(node.properties ?? {});
    if (node.id !== this.#nodeId) {
      this.reseed(node);
      return;
    }
    if (canon === this.#baselineCanon) return; // an unrelated reload
    if (!this.dirty) this.reseed(node); // changed underneath, nothing typed yet
    // Dirty and changed underneath: keep the draft AND its baseline.
  }

  /** Start over from `node` — a new node, or after this editor saved. */
  reseed(node: DraftNode): void {
    const text = seedText(node.properties);
    this.#nodeId = node.id;
    this.#baselineCanon = canonicalJson(node.properties ?? {});
    this.baseline = node.properties ?? null;
    this.text = text;
    this.#seededText = text;
  }
}

/**
 * Wire a draft to a node source: the ONE effect the page runs, exported so the
 * client-lane test mounts exactly this rather than a copy of it. Must be
 * called during component initialisation.
 *
 * The draft is read under `untrack`: `sync` reads `text`, and without it every
 * keystroke would re-run the effect (harmless, but a read-modify-write of
 * state inside an effect is the shape
 * `hrn:node:hadronmemory.com:hadron-portal:review:no-read-modify-write-state-in-effect`
 * warns about).
 */
export function syncDraftWith(draft: PropertiesDraft, getNode: () => DraftNode): void {
  $effect(() => {
    const node = getNode();
    const snapshot = { id: node.id, properties: node.properties };
    untrack(() => draft.sync(snapshot));
  });
}

export type SubmitResult = { ok: true } | { ok: false; code: string; detail: string | null };

/**
 * POST one Source save to `url` — the ORIGINATING node's absolute action URL,
 * fixed by the caller before anything is awaited (@codex on #893). A relative
 * `?/updateProperties` resolves against wherever the page is when the request
 * finally goes out: navigate to another node mid-save and node A's draft is
 * written to node B, which passes the stale check whenever the two share a
 * baseline (`{}` commonly does).
 *
 * `text` and `baseline` are values, captured by the caller at the click, for
 * the same reason. Uses the action-result protocol so a refusal comes back as
 * data the page can show — a bare `res.ok` check reports every refusal as
 * nothing.
 */
export async function submitPropertiesDraft(opts: {
  url: string;
  text: string;
  baseline: unknown;
  fetchImpl?: typeof fetch;
}): Promise<SubmitResult> {
  const fd = new FormData();
  fd.set('properties', opts.text);
  fd.set('baseline', await propertiesFingerprint(opts.baseline));
  const res = await (opts.fetchImpl ?? fetch)(opts.url, {
    method: 'POST',
    body: fd,
    headers: { 'x-sveltekit-action': 'true' },
  });
  const result = deserialize(await res.text());
  if (result.type === 'success') return { ok: true };
  if (result.type === 'failure') {
    const f = (result.data as { propertiesFailed?: { code: string; detail: string | null } } | undefined)
      ?.propertiesFailed;
    return { ok: false, code: f?.code ?? 'failed', detail: f?.detail ?? null };
  }
  return { ok: false, code: 'failed', detail: null };
}
