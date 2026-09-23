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
 * - this editor's own successful save re-seeds explicitly (`reseed`);
 * - and nothing is serialized until the Source view is opened (`ensureSeeded`).
 *
 * The state lives in the page, not in a component inside the tab, because a
 * draft must survive switching tabs — that is the scenario that loses it.
 */
import { untrack } from 'svelte';
import { deserialize } from '$app/forms';
import { canonicalJson, PROPERTIES_MAX, propertiesFingerprint } from './properties-source';

export interface DraftNode {
  id: string;
  properties?: unknown;
}

/**
 * The editor text for a bag, or null when it cannot be shown. Pretty-printed
 * when that is affordable; compact when indentation would blow it past the
 * size cap (indentation grows with depth — a compact 3,000-level bag is ~18 MB
 * indented, @codex on #893); null when even compact serialization overflows
 * (V8's JSON.stringify is recursive). An empty bag opens on `{}`.
 */
function seedText(properties: unknown): string | null {
  if (properties == null) return '{}';
  try {
    const compact = JSON.stringify(properties);
    // Indenting a bag this size or smaller is cheap; a bag whose compact form is
    // already near the cap is left compact rather than multiplied.
    if (compact.length > PROPERTIES_MAX / 2) return compact;
    const pretty = JSON.stringify(properties, null, 2);
    return pretty.length > PROPERTIES_MAX ? compact : pretty;
  } catch {
    return null;
  }
}

export class PropertiesDraft {
  /** The editor's text. Empty until `ensureSeeded` — see `#pending`. */
  text = $state('');
  /** The bag the draft was seeded from — what the save's fingerprint is of. */
  baseline = $state<unknown>(null);
  /** The stored bag cannot be shown as text at all (pathologically nested). */
  unavailable = $state(false);
  /** The text as seeded; the draft is dirty when `text` differs from it. */
  #seededText = $state('');
  #nodeId: string | null = null;
  #baselineCanon = '';
  /**
   * LAZY seeding (@codex on #893): until Source is opened, the draft only
   * remembers WHICH bag it would seed from. Pretty-printing and canonicalizing
   * on every node page load put a cost — for a pathological bag, a crash — on
   * pages whose Properties tab is never opened; the Rendered view has always
   * been lazy, and the draft now is too.
   */
  #pending = true;

  get dirty(): boolean {
    return !this.#pending && this.text !== this.#seededText;
  }

  /** Apply the rule above to the node as it is NOW. */
  sync(node: DraftNode): void {
    if (node.id !== this.#nodeId || this.#pending) {
      // A new node, or nothing opened yet: just remember the latest bag.
      this.reseed(node);
      return;
    }
    const canon = canonicalJson(node.properties ?? {});
    if (canon === this.#baselineCanon) return; // an unrelated reload
    if (!this.dirty) {
      // Changed underneath, nothing typed yet: show the new bag.
      this.reseed(node);
      this.ensureSeeded();
    }
    // Dirty and changed underneath: keep the draft AND its baseline.
  }

  /** Start over from `node` — a new node, or after this editor saved. Lazy. */
  reseed(node: DraftNode): void {
    this.#nodeId = node.id;
    this.baseline = node.properties ?? null;
    this.#pending = true;
    this.unavailable = false;
    this.text = '';
    this.#seededText = '';
  }

  /** Build the text — called when the Source view opens. Idempotent. */
  ensureSeeded(): void {
    if (!this.#pending) return;
    this.#pending = false;
    this.#baselineCanon = canonicalJson(this.baseline ?? {});
    const text = seedText(this.baseline);
    this.unavailable = text === null;
    this.text = text ?? '';
    this.#seededText = this.text;
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
