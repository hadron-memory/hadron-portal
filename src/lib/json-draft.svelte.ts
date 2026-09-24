/**
 * The node page's raw-JSON Source drafts — Properties (#886) and Data (#894) —
 * and WHEN each is re-seeded from the node.
 *
 * The naive rule — re-seed whenever the page's `node` changes — loses work:
 * saving Content, Abstract or another tab calls `invalidateAll()`, which hands
 * the page a NEW node object with the SAME value, and an unsaved Source edit
 * was silently replaced (@codex on #893). So:
 *
 * - a different NODE always re-seeds (the page is reused across nodes, #251);
 * - the same value again (an unrelated reload) keeps the draft untouched;
 * - a CHANGED value re-seeds only a clean draft. A dirty one keeps both its
 *   text and its baseline, so the save's stale check refuses it with an
 *   explanation instead of the reload discarding the user's edit without one;
 * - this editor's own successful save re-seeds explicitly (`reseed`);
 * - and nothing is serialized until the Source view is opened (`ensureSeeded`).
 *
 * The state lives in the page, not in a component inside the tab, because a
 * draft must survive switching tabs — that is the scenario that loses it.
 *
 * One class for both fields: they differ only in what an empty value opens on.
 */
import { untrack } from 'svelte';
import { deserialize } from '$app/forms';
import { canonicalJson, jsonFingerprint, PROPERTIES_MAX, utf8Length } from './properties-source';

/** Which node, and the stored value of the field this draft edits. */
export interface DraftSource {
  id: string;
  value?: unknown;
}

/**
 * The editor text for a value, or null when it cannot be shown. Pretty-printed
 * when that is affordable; compact when indentation would blow it past the
 * size cap (indentation grows with depth — a compact 3,000-level bag is ~18 MB
 * indented, @codex on #893); null when even compact serialization overflows
 * (V8's JSON.stringify is recursive). An absent value opens on `emptyText`.
 */
function seedText(value: unknown, emptyText: string): string | null {
  if (value == null) return emptyText;
  return displayJson(value);
}

/**
 * A STORED value as display text, or null when it cannot be serialized at all
 * — the one serializer for every place the node page shows a value it did not
 * validate (the Rendered views, the typed-properties table, and the Source
 * seed). Pretty when affordable, compact when indentation would pass the cap,
 * null when even compact JSON overflows the stack. A bare
 * `JSON.stringify(value, null, 2)` on a pathologically nested stored value
 * threw while RENDERING the tab, before the user could reach the Source
 * view's "unavailable" state (@copilot on #896).
 */
export function displayJson(value: unknown, opts: { compact?: boolean } = {}): string | null {
  try {
    if (opts.compact) return JSON.stringify(value) ?? null;
    // Measured in UTF-8 BYTES, as the validators measure (@codex on #893):
    // counted in characters, multibyte text let a pretty draft fit the cap
    // here and fail it there — the editor opened on text its own validator
    // called too large, with Save disabled.
    const compact = JSON.stringify(value);
    // Indenting a value this size or smaller is cheap; one whose compact form
    // is already near the cap is left compact rather than multiplied.
    if (utf8Length(compact) > PROPERTIES_MAX / 2) return compact;
    const pretty = JSON.stringify(value, null, 2);
    return utf8Length(pretty) > PROPERTIES_MAX ? compact : pretty;
  } catch {
    return null;
  }
}

export class JsonDraft {
  /** The editor's text. Empty until `ensureSeeded` — see `#pending`. */
  text = $state('');
  /** The value the draft was seeded from — what the save's fingerprint is of. */
  baseline = $state<unknown>(null);
  /** The stored value cannot be shown as text at all (pathologically nested). */
  unavailable = $state(false);
  /** The text as seeded; the draft is dirty when `text` differs from it. */
  #seededText = $state('');
  #nodeId: string | null = null;
  #baselineCanon = '';
  /**
   * LAZY seeding (@codex on #893): until Source is opened, the draft only
   * remembers WHICH value it would seed from. Pretty-printing and
   * canonicalizing on every node page load put a cost — for a pathological
   * value, a crash — on pages whose tab is never opened.
   */
  #pending = true;

  /**
   * @param emptyText what an absent value opens on — `{}` for properties, '' for data.
   * @param nullIsEmpty whether an absent value and `{}` are the SAME state —
   *   true for properties (the server stores either for an empty bag), false
   *   for data, where `{}` over no data is a real change (@codex on #896).
   */
  constructor(
    private readonly emptyText: string,
    private readonly opts: { nullIsEmpty: boolean } = { nullIsEmpty: true },
  ) {}

  /** The comparable form of a stored value, under this field's null rule. */
  #canon(value: unknown): string {
    return canonicalJson(this.opts.nullIsEmpty ? (value ?? {}) : (value ?? null));
  }

  get dirty(): boolean {
    return !this.#pending && this.text !== this.#seededText;
  }

  /** Apply the rule above to the node as it is NOW. */
  sync(src: DraftSource): void {
    if (src.id !== this.#nodeId || this.#pending) {
      // A new node, or nothing opened yet: just remember the latest value.
      this.reseed(src);
      return;
    }
    const canon = this.#canon(src.value);
    if (canon === this.#baselineCanon) return; // an unrelated reload
    if (!this.dirty) {
      // Changed underneath, nothing typed yet: show the new value.
      this.reseed(src);
      this.ensureSeeded();
    }
    // Dirty and changed underneath: keep the draft AND its baseline.
  }

  /** Start over from `src` — a new node, or after this editor saved. Lazy. */
  reseed(src: DraftSource): void {
    this.#nodeId = src.id;
    this.baseline = src.value ?? null;
    this.#pending = true;
    this.unavailable = false;
    this.text = '';
    this.#seededText = '';
  }

  /** Build the text — called when the Source view opens. Idempotent. */
  ensureSeeded(): void {
    if (!this.#pending) return;
    this.#pending = false;
    this.#baselineCanon = this.#canon(this.baseline);
    const text = seedText(this.baseline, this.emptyText);
    this.unavailable = text === null;
    this.text = text ?? '';
    this.#seededText = this.text;
  }
}

/**
 * Wire a draft to a node source: the ONE effect the page runs per draft,
 * exported so the client-lane test mounts exactly this rather than a copy of
 * it. Must be called during component initialisation.
 *
 * The draft is read under `untrack`: `sync` reads `text`, and without it every
 * keystroke would re-run the effect (harmless, but a read-modify-write of
 * state inside an effect is the shape
 * `hrn:node:hadronmemory.com:hadron-portal:review:no-read-modify-write-state-in-effect`
 * warns about).
 */
export function syncDraftWith(draft: JsonDraft, getSource: () => DraftSource): void {
  $effect(() => {
    const src = getSource();
    const snapshot = { id: src.id, value: src.value };
    untrack(() => draft.sync(snapshot));
  });
}

export type SubmitResult = { ok: true } | { ok: false; code: string; detail: string | null };

/**
 * POST one Source save to `url` — the ORIGINATING node's absolute action URL,
 * fixed by the caller before anything is awaited (@codex on #893). A relative
 * `?/action` resolves against wherever the page is when the request finally
 * goes out: navigate to another node mid-save and node A's draft is written to
 * node B, which passes the stale check whenever the two share a baseline.
 *
 * `field` names both the posted form field and the action's failure key
 * (`<field>Failed`). `text` and `baseline` are values captured by the caller at
 * the click. Uses the action-result protocol so a refusal comes back as data
 * the page can show — a bare `res.ok` check reports every refusal as nothing
 * (#894).
 */
export async function submitJsonDraft(opts: {
  url: string;
  field: 'properties' | 'data';
  text: string;
  baseline: unknown;
  fetchImpl?: typeof fetch;
}): Promise<SubmitResult> {
  const fd = new FormData();
  fd.set(opts.field, opts.text);
  // The field's null rule, matching the action's: properties treat absent and
  // `{}` as one state, data does not (@codex on #896).
  fd.set('baseline', await jsonFingerprint(opts.baseline, { nullIsEmpty: opts.field === 'properties' }));
  const res = await (opts.fetchImpl ?? fetch)(opts.url, {
    method: 'POST',
    body: fd,
    headers: { 'x-sveltekit-action': 'true' },
  });
  const result = deserialize(await res.text());
  if (result.type === 'success') return { ok: true };
  if (result.type === 'failure') {
    const f = (result.data as Record<string, { code: string; detail: string | null } | undefined> | undefined)?.[
      `${opts.field}Failed`
    ];
    return { ok: false, code: f?.code ?? 'failed', detail: f?.detail ?? null };
  }
  return { ok: false, code: 'failed', detail: null };
}
