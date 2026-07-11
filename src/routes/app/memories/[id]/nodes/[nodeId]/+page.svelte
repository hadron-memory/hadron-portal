<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll, goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import DOMPurify from 'dompurify';
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import NodeList from '$lib/components/NodeList.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { cleanLocInput } from '$lib/urn/clean-loc-input';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import { t } from '$lib/i18n/t';
  import { NODE_TYPES, isCanonicalNodeType } from '$lib/node-types';
  import {
    EXTRACTION_SHAPES,
    extractionFieldError,
    extractionRowsError,
    outputFromNodeData,
    rowsFromNodeData,
    rowsToSpec,
    type ExtractionRow,
  } from '$lib/flow/extraction';
  import type { NodeEdge } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data.node);
  const basePath = $derived(`/app/memories/${data.graph.id}`);
  // #260: link the section crumb to the owning org's memories list only when
  // the user is a member (org present); otherwise render it as plain text.
  const memoriesHref = $derived(data.org ? `/app/orgs/${data.org.id}/memories` : undefined);

  // Full URN composed via the canonical composer. The startsWith() check
  // defends against legacy data where a node's stored loc already had its
  // memory URN baked in — strip it before composing so we don't duplicate.
  // Falls back to bare loc if the memory URN is missing — composeNodeUrn
  // would throw, and a node-detail page shouldn't crash because of an
  // upstream data-shape change.
  // R-2 (2026-05-06): also guard empty loc, which the prefix-strip
  // above can produce when a stored loc equals the memory URN exactly.
  // The node's loc, normalized against the legacy shape where a stored loc had
  // its memory URN baked in — strip that prefix so we never double-compose.
  // Shared by fullUrn and the #512 move-target picker.
  const cleanLoc = $derived.by(() => {
    let loc = node.loc;
    if (data.graph.urn && loc.startsWith(data.graph.urn + ':')) {
      loc = loc.slice(data.graph.urn.length + 1);
    }
    return loc;
  });
  const fullUrn = $derived(
    data.graph.urn && cleanLoc ? composeNodeUrn(data.graph.urn, cleanLoc) : cleanLoc,
  );

  let showSource = $state(false);
  let confirmDelete = $state(false);
  let copied = $state(false);
  let isEditing = $state(false);

  // Inline editing
  let editContent = $state('');
  let saving = $state(false);

  $effect(() => {
    editContent = node.content ?? '';
  });

  async function saveContent() {
    saving = true;
    try {
      const fd = new FormData();
      fd.set('content', editContent);
      const res = await fetch('?/updateContent', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Save failed');
      await invalidateAll();
      showSource = false;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      saving = false;
    }
  }

  // Abstract — paragraph-length summary, the default vector-index source
  // (spec 031/033). Edited inline here exactly like content. The Abstract
  // tab is ALWAYS shown: an empty abstract still needs an authoring surface,
  // or there is no portal path to populate the index's default source. (The
  // Content tab is now always shown for the same reason — issue #256.)
  const ABSTRACT_MAX = 2000;
  let showAbstractSource = $state(false);
  let copiedAbstract = $state(false);
  let editAbstract = $state('');
  let savingAbstract = $state(false);

  $effect(() => {
    editAbstract = node.abstract ?? '';
  });

  async function saveAbstract() {
    savingAbstract = true;
    try {
      const fd = new FormData();
      fd.set('abstract', editAbstract);
      const res = await fetch('?/updateAbstract', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Save failed');
      await invalidateAll();
      showAbstractSource = false;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      savingAbstract = false;
    }
  }

  // Markdown rendering
  let renderedHtml = $state('');
  let markedReady = $state(false);
  let MarkedClass: typeof import('marked').Marked | null = null;

  onMount(async () => {
    MarkedClass = (await import('marked')).Marked;
    markedReady = true;
  });

  // Shared renderer for both content and abstract. The Marked instance is
  // cached once MarkedClass loads (its renderer config is static) so we
  // don't reinstantiate per render. Portal Invariant P4: markdown → HTML →
  // DOMPurify before insertion — escaping raw-HTML tokens alone leaves
  // anchor-based vectors (e.g. javascript: URLs) through.
  let markedInstance: import('marked').Marked | null = null;
  function renderMarkdown(src: string): string {
    if (!MarkedClass) return '';
    if (!markedInstance) {
      markedInstance = new MarkedClass({
        renderer: {
          html(token: { text: string }) {
            return token.text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
        },
      });
    }
    return DOMPurify.sanitize(markedInstance.parse(src, { async: false }) as string);
  }

  let renderedAbstractHtml = $state('');

  // #505: a leading YAML frontmatter block (---\n...\n---) is otherwise
  // parsed as a thematic break + setext heading by marked and reads as
  // garbled/invisible metadata. Split it out so it can be rendered as its
  // own panel (verbatim, delimiters included) and stripped from the body
  // handed to the markdown renderer.
  const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  // Guard against splitting plain Markdown that merely starts with a
  // thematic break (e.g. `---\nIntro\n\n---\n# Body`): only treat the
  // block as frontmatter if every non-blank line looks like YAML — a
  // `key: value` pair, a list item, or an indented continuation.
  function looksLikeYaml(block: string): boolean {
    const lines = block.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return false;
    return lines.every(
      (line) => /^[\w.-]+:(\s|$)/.test(line) || /^\s*-\s/.test(line) || /^\s+\S/.test(line),
    );
  }
  const parsedContent = $derived.by(() => {
    if (!node.content) return { frontmatter: null as string | null, body: '' };
    const match = FRONTMATTER_RE.exec(node.content);
    if (match && looksLikeYaml(match[1])) {
      return { frontmatter: match[0].trimEnd(), body: node.content.slice(match[0].length) };
    }
    return { frontmatter: null, body: node.content };
  });
  const contentFrontmatter = $derived(parsedContent.frontmatter);
  const contentBody = $derived(parsedContent.body);

  $effect(() => {
    renderedHtml = markedReady && contentBody ? renderMarkdown(contentBody) : '';
  });

  $effect(() => {
    renderedAbstractHtml = markedReady && node.abstract ? renderMarkdown(node.abstract) : '';
  });

  async function copyContent() {
    if (!node.content) return;
    try {
      await navigator.clipboard.writeText(node.content);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch { /* no-op */ }
  }

  async function copyAbstract() {
    if (!node.abstract) return;
    try {
      await navigator.clipboard.writeText(node.abstract);
      copiedAbstract = true;
      setTimeout(() => (copiedAbstract = false), 2000);
    } catch { /* no-op */ }
  }

  // ── Data (structured JSON) ──────────────────────────────────────────
  // Node.data is a free-form JSON object/value. The Data tab mirrors the
  // Content / Abstract tabs: a Rendered view (pretty-printed JSON) and a
  // Source view that edits the raw JSON with a live syntax check.
  //
  // Soft size cap so a pathological paste fails with a clear message rather
  // than the adapter-node default 512KB body limit's opaque error. 256KB is
  // ~290x the largest realistic data blob, so it only ever catches abuse,
  // never legitimate (system-written) data. Mirrored server-side in
  // updateData. (ABSTRACT_MAX is the same idea at a much smaller scale.)
  const DATA_MAX = 262144; // 256 KB
  let showDataSource = $state(false);
  let copiedData = $state(false);
  let editData = $state('');
  let savingData = $state(false);

  // Re-seed the editor from the node whenever node.data changes (initial
  // load, navigation between nodes, and after a save's invalidateAll).
  // Pretty-printed so the Source view is readable and diffable.
  $effect(() => {
    editData = node.data != null ? JSON.stringify(node.data, null, 2) : '';
  });

  // Live JSON syntax check. Returns an error string (shown in red) or null
  // (well-formed). A top-level `null` is rejected because Node.data maps to
  // a Prisma `Json?` column that can't be written a bare null through this
  // surface — see the updateData action. Empty is handled separately.
  const dataError = $derived.by(() => {
    const trimmed = editData.trim();
    if (trimmed === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
    if (parsed === null) return 'Top-level null is not allowed — enter an object, array, or value.';
    return null;
  });
  const dataEmpty = $derived(editData.trim() === '');
  const dataValid = $derived(dataError === null);
  const dataTooLarge = $derived(editData.length > DATA_MAX);
  // Pretty-printed saved value — the dirty-check baseline (so the initial
  // seeded text doesn't count as a change).
  const dataString = $derived(node.data != null ? JSON.stringify(node.data, null, 2) : '');
  const dataDirty = $derived(editData !== dataString);

  // The JSON the Rendered view shows: the saved data, or — when the node has
  // no saved data yet — a live preview of a valid, dirty edit, so toggling to
  // Rendered mid-add doesn't make the typed JSON look lost. Returns null when
  // there's nothing to show (→ the empty-state CTA).
  const renderedJson = $derived.by(() => {
    if (node.data != null) return dataString;
    const trimmed = editData.trim();
    if (trimmed === '' || dataError || dataTooLarge) return null;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return null;
    }
  });

  async function saveData() {
    if (!dataValid || dataEmpty || !dataDirty || dataTooLarge) return;
    savingData = true;
    try {
      const fd = new FormData();
      fd.set('data', editData);
      const res = await fetch('?/updateData', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Save failed');
      await invalidateAll();
      showDataSource = false;
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      savingData = false;
    }
  }

  async function copyData() {
    if (node.data == null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(node.data, null, 2));
      copiedData = true;
      setTimeout(() => (copiedData = false), 2000);
    } catch { /* no-op */ }
  }

  // ── Flow (#478 phase 2) ─────────────────────────────────────────────
  // Structured editors for the two flow-node data keys: extractionSpec
  // (what a headless run pulls out of this node's LLM answer into the run
  // envelope) and output (where a mid-flow node writes). Saved via the
  // updateFlow action, which merges into node.data server-side so other
  // data keys survive untouched.
  let flowRows = $state<ExtractionRow[]>([]);
  let outputWriteTo = $state('');
  let outputMode = $state<'replace' | 'append'>('replace');

  // Re-seed from the node whenever its data changes (navigation and post-
  // save invalidateAll) — same pattern as the Content/Abstract/Data editors.
  $effect(() => {
    flowRows = rowsFromNodeData(node.data);
    const output = outputFromNodeData(node.data);
    outputWriteTo = output?.writeTo ?? '';
    outputMode = output?.mode ?? 'replace';
  });

  function addFlowRow() {
    flowRows = [...flowRows, { field: '', shape: 'string', description: '' }];
  }
  function removeFlowRow(i: number) {
    flowRows = flowRows.filter((_, idx) => idx !== i);
  }

  const flowRowsError = $derived(extractionRowsError(flowRows));
  const flowRowsJson = $derived(
    JSON.stringify(flowRows.map((r) => ({ field: r.field, shape: r.shape, description: r.description }))),
  );
  // Dirty check against the stored spec (normalized through the same
  // serializers, so seeded state never counts as a change).
  const flowDirty = $derived.by(() => {
    const stored = rowsFromNodeData(node.data);
    const storedOutput = outputFromNodeData(node.data);
    return (
      JSON.stringify(rowsToSpec(flowRows)) !== JSON.stringify(rowsToSpec(stored)) ||
      outputWriteTo.trim() !== (storedOutput?.writeTo ?? '') ||
      (outputWriteTo.trim() !== '' && outputMode !== (storedOutput?.mode ?? 'replace'))
    );
  });
  const outputWriteToValid = $derived(
    outputWriteTo.trim() === '' || outputWriteTo.includes('::'),
  );
  const hasFlowConfig = $derived(
    rowsFromNodeData(node.data).length > 0 || outputFromNodeData(node.data) !== null,
  );
  // Same-memory nodes for the output-target datalist (any URN can still be
  // typed — flows may write to another memory in the org).
  const outputTargetOptions = $derived(
    (data.graphNodes ?? [])
      .filter((n) => n.memoryId === data.graph.id && n.id !== node.id)
      .map((n) => ({ urn: data.graph.urn ? composeNodeUrn(data.graph.urn, n.loc) : n.loc, name: n.name ?? n.loc })),
  );

  // ── Test flow (#478 phase 3) ─────────────────────────────────────────
  // Runnable node + org member ⇒ offer minting a MANUAL headless run via
  // the testFlow action (runTask(urn, appRef:)), with an optional JSON
  // trigger payload the flow sees at message.data.<field>. On success the
  // action redirects to the run detail page.
  let testFlowOpen = $state(false);
  let testFlowAppId = $state('');
  let testFlowPayload = $state('');
  const testFlowApps = $derived(data.testFlowApps ?? []);
  const canTestFlow = $derived(!!node.isRunnable && testFlowApps.length > 0);
  const testFlowPayloadValid = $derived.by(() => {
    const raw = testFlowPayload.trim();
    if (raw === '') return true;
    try {
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  });

  // ── Actions menu (#503) ─────────────────────────────────────────────
  // The header "⋯" menu consolidates node actions; each item flips a panel/
  // dialog open or fires its form. Merge is deferred to hadron-server#568.
  const addChildHref = $derived(
    `${basePath}/nodes/new?parent=${encodeURIComponent(cleanLocInput(node.loc))}`,
  );
  let moveOpen = $state(false);
  // Full destination node URN (#489): editing the loc segment moves within
  // the memory; editing the memory segment moves to another memory. Passed
  // straight to moveNode's targetUrn.
  let moveTarget = $state('');
  // #512: the "Select target memory" picker inside the Move dialog. Picking a
  // memory rewrites the memory segment of the destination URN, keeping the loc.
  // Uses cleanLoc (not the raw node.loc) so a legacy prefixed loc doesn't
  // double-compose into hrn:node:<new>::hrn:node:<old>::… (PR #513 review, codex).
  let memoryPickerOpen = $state(false);
  function onPickTargetMemory(memory: { urn: string }) {
    if (cleanLoc) moveTarget = composeNodeUrn(memory.urn, cleanLoc);
  }
  let deleteOpen = $state(false);
  // #503: opt into a permanent (hard) delete; default is the safe soft delete.
  let hardDelete = $state(false);

  const menuActions = $derived<NodeMenuAction[]>([
    { id: 'edit', label: t('node-actions.edit', 'Edit') },
    { id: 'download', label: t('node-actions.download', 'Download') },
    { id: 'add-child', label: t('node-actions.add-child', 'Add child') },
    { id: 'move', label: t('node-actions.move', 'Move') },
    { id: 'duplicate', label: t('node-actions.duplicate', 'Duplicate') },
    // Only offered for plain nodes — a task node is already runnable.
    ...(!node.isRunnable ? [{ id: 'convert-to-task', label: t('node-actions.convert-to-task', 'Convert to task') }] : []),
    ...(canTestFlow ? [{ id: 'run', label: t('node-actions.run', 'Run') }] : []),
    { id: 'delete', label: t('node-actions.delete', 'Delete'), danger: true },
  ]);

  let duplicateForm = $state<HTMLFormElement | null>(null);
  let convertForm = $state<HTMLFormElement | null>(null);

  function onMenuSelect(id: string) {
    // Close any sibling panel so only one opens at a time.
    testFlowOpen = false; downloadOpen = false; moveOpen = false; deleteOpen = false;
    switch (id) {
      case 'edit':
        // Jump to the Settings tab and open its metadata form (#503).
        activeTab = 'settings';
        isEditing = true;
        break;
      case 'run': testFlowOpen = true; break;
      case 'duplicate': duplicateForm?.requestSubmit(); break;
      case 'convert-to-task': convertForm?.requestSubmit(); break;
      case 'move':
        moveTarget = fullUrn;
        moveOpen = true;
        break;
      case 'add-child': goto(addChildHref); break;
      case 'download': downloadOpen = true; break;
      case 'delete': hardDelete = false; deleteOpen = true; break;
    }
  }

  // ── Download / export ───────────────────────────────────────────────
  // Server-rendered single-node export (#421 / hadron-server #386). The server's
  // `nodeExport` field owns the format — `full: true` is the canonical,
  // round-trippable file (byte-identical to `hadron node export`); `full: false`
  // renders a chosen set of presentation sections. We never re-implement the
  // codec here: POST to /api/nodes/export and serve the returned bytes as a file.
  let downloadOpen = $state(false);
  let dlFormat = $state<'MD' | 'JSON' | 'PDF'>('MD');
  let dlFull = $state(true); // canonical full file vs. custom section pick
  // Format/scope/section choices are export *preferences* (not per-node state),
  // so they persist across node navigation; only `downloadOpen` + `dlError`
  // reset in the per-node effect.
  let dlSections = $state({ METADATA: true, CONTENT: true, ABSTRACT: true, DATA: true, PROPERTIES: true, EDGES: true });
  let dlBusy = $state(false);
  let dlError = $state<string | null>(null);
  const dlSelectedSections = $derived(
    (Object.keys(dlSections) as (keyof typeof dlSections)[]).filter((k) => dlSections[k]),
  );
  // A full export is always valid; a custom one needs at least one section.
  // PDF is a presentation render (no scope/sections), so it's always valid.
  const dlCanDownload = $derived(dlFormat === 'PDF' || dlFull || dlSelectedSections.length > 0);

  // Decode a base64 string to raw bytes for a binary (encoding: BASE64)
  // export, so the downloaded file is the bytes — not the base64 text.
  function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64);
    // Back the view with a concrete ArrayBuffer so the result is a valid
    // BlobPart (a SharedArrayBuffer-backed view is not).
    const buf = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function runDownload() {
    if (!dlCanDownload || dlBusy) return;
    dlBusy = true;
    dlError = null;
    try {
      const res = await fetch('/api/nodes/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: node.id,
          format: dlFormat,
          // PDF is a presentation render; scope/sections don't apply.
          full: dlFormat === 'PDF' ? true : dlFull,
          ...(dlFormat === 'PDF' || dlFull ? {} : { sections: dlSelectedSections }),
        }),
      });
      if (!res.ok) throw new Error('Export failed');
      const r = (await res.json()) as {
        filename?: string;
        mimeType?: string;
        data?: string;
        encoding?: string;
      };
      // Guard against a null/!=string `data` (e.g. nodeExport resolving to
      // null) so we never blob the literal string "undefined".
      if (!r || typeof r.data !== 'string') throw new Error('Invalid export data');
      // Honor `encoding`: the API is already forward-compatible with BASE64
      // (binary) payloads, so decode those to bytes rather than blobbing the
      // base64 text. TEXT (the current default) passes through unchanged.
      const part: BlobPart = r.encoding === 'BASE64' ? base64ToBytes(r.data) : r.data;
      const blob = new Blob([part], { type: r.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename || `export.${dlFormat.toLowerCase()}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      downloadOpen = false;
    } catch {
      dlError = 'Export failed. Please try again.';
    } finally {
      dlBusy = false;
    }
  }

  // Grow the Source editor to fit its content (floored/capped by min-h/max-h
  // CSS; it scrolls past the cap), so a small JSON blob doesn't sit in a
  // viewport-tall box. Resizes on the bound value changing (seed on load /
  // node navigation / post-save) via `update`, AND on width changes (window
  // resize, responsive layout) via a ResizeObserver — the textarea is w-full,
  // so a width change re-wraps the text and alters scrollHeight. The observer
  // is guarded on clientWidth so our own height writes don't re-trigger it
  // (avoids a resize loop), and is disconnected on destroy.
  function autosize(node: HTMLTextAreaElement, _value: string) {
    let lastWidth = node.clientWidth;
    const resize = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== lastWidth) {
        lastWidth = node.clientWidth;
        resize();
      }
    });
    observer.observe(node);
    resize();
    return {
      update: (_v: string) => resize(),
      destroy: () => observer.disconnect(),
    };
  }

  // ── JSON syntax highlighting (Rendered view only) ───────────────────
  // No highlighter dependency in the portal, and one isn't warranted for
  // JSON: a small tokenizer + classed <span>s does it. Tokens render via
  // Svelte's {#each} (auto-escaped text), NOT {@html}, so there's no
  // sanitization surface (Invariant P4 doesn't apply). The Source editor
  // stays a plain textarea — coloring an *editable* field needs a real code
  // editor (CodeMirror/Monaco), which this intentionally doesn't pull in.
  type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain';
  const jsonTokenClass: Record<JsonTokenType, string> = {
    key: 'text-indigo-600 dark:text-indigo-400',
    string: 'text-emerald-600 dark:text-emerald-400',
    number: 'text-amber-600 dark:text-amber-400',
    // true / false / null are the three JSON literals — color them together,
    // distinct from the de-emphasized structural punctuation.
    boolean: 'text-purple-600 dark:text-purple-400',
    null: 'text-purple-600 dark:text-purple-400',
    punct: 'text-zinc-400 dark:text-zinc-500',
    plain: '',
  };
  // Tokenize pretty-printed JSON. Gaps between matches (the indentation /
  // newlines) are preserved verbatim as 'plain' so the layout round-trips.
  // A string is a key when the next non-space char is ':'.
  function highlightJson(src: string): Array<{ text: string; type: JsonTokenType }> {
    const tokens: Array<{ text: string; type: JsonTokenType }> = [];
    const re = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) tokens.push({ text: src.slice(last, m.index), type: 'plain' });
      const t = m[0];
      let type: JsonTokenType;
      if (t[0] === '"') type = /^\s*:/.test(src.slice(re.lastIndex)) ? 'key' : 'string';
      else if (t === 'true' || t === 'false') type = 'boolean';
      else if (t === 'null') type = 'null';
      else if (t.length === 1 && '{}[],:'.includes(t)) type = 'punct';
      else type = 'number';
      tokens.push({ text: t, type });
      last = re.lastIndex;
    }
    if (src.length > last) tokens.push({ text: src.slice(last), type: 'plain' });
    return tokens;
  }
  const highlightedData = $derived(renderedJson != null ? highlightJson(renderedJson) : []);

  // ── Properties (#518) ───────────────────────────────────────────────────
  // Node.properties is structured key-value metadata, often server-set
  // provenance (properties.url / .title from the write seam). Read-only here —
  // it's not user-authored free-form like Node.data, so the tab only shows it.
  const hasProperties = $derived(node.properties != null);
  const propertiesString = $derived(hasProperties ? JSON.stringify(node.properties, null, 2) : '');
  const highlightedProperties = $derived(hasProperties ? highlightJson(propertiesString) : []);
  let copiedProperties = $state(false);
  async function copyProperties() {
    if (!hasProperties) return;
    try {
      await navigator.clipboard.writeText(propertiesString);
      copiedProperties = true;
      setTimeout(() => (copiedProperties = false), 2000);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  const hasReferences = $derived(node.outgoingEdges.length > 0 || node.incomingEdges.length > 0);
  const hasContent = $derived(!!node.content);
  const hasAbstract = $derived(!!node.abstract);
  const hasData = $derived(node.data != null);
  const isTeamChat = $derived(node.tags.includes('team-chat'));

  // ── Edge editing ────────────────────────────────────────────────────
  // Edge editing replaces the full outgoing set via updateNode(edges: [...]).
  // We keep a local editable copy and commit via the updateEdges action.

  interface EditableEdge {
    targetId: string;
    targetName: string;
    targetLoc: string;
    name: string;
  }

  let editingEdges = $state(false);
  let editableEdges = $state<EditableEdge[]>([]);
  let newEdgeTargetQuery = $state('');
  let newEdgeName = $state('');

  function startEditEdges() {
    editableEdges = node.outgoingEdges.map((e) => ({
      targetId: e.target.id,
      targetName: e.target.name ?? e.target.loc,
      targetLoc: e.target.loc,
      name: e.name ?? '',
    }));
    newEdgeTargetQuery = '';
    newEdgeName = '';
    editingEdges = true;
  }

  function cancelEditEdges() {
    editingEdges = false;
    editableEdges = [];
  }

  function removeEditableEdge(idx: number) {
    editableEdges = editableEdges.filter((_, i) => i !== idx);
  }

  function addEditableEdge() {
    // Match the target by loc against graphNodes (loaded on the page already).
    const candidates = data.graphNodes ?? [];
    const q = newEdgeTargetQuery.trim().toLowerCase();
    if (!q) return;
    const target = candidates.find(
      (n) => n.loc.toLowerCase() === q || n.name?.toLowerCase() === q,
    ) ?? candidates.find(
      (n) => n.loc.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q),
    );
    if (!target) {
      addEdgeError = `No node found matching "${newEdgeTargetQuery}"`;
      return;
    }
    if (editableEdges.some((e) => e.targetId === target.id && e.name === newEdgeName.trim())) {
      addEdgeError = 'That edge already exists';
      return;
    }
    editableEdges = [
      ...editableEdges,
      {
        targetId: target.id,
        targetName: target.name ?? target.loc,
        targetLoc: target.loc,
        name: newEdgeName.trim(),
      },
    ];
    newEdgeTargetQuery = '';
    newEdgeName = '';
    addEdgeError = null;
  }

  let addEdgeError = $state<string | null>(null);
  const editableEdgesJson = $derived(JSON.stringify(
    editableEdges.map((e) => ({ targetId: e.targetId, name: e.name || null })),
  ));

  // ── Edges tab grid (#350; “References” renamed #490) ────────────────────────────────────────
  // One TanStack table for both directions. Each edge is owned by its source
  // node; the "endpoint" column shows the OTHER node (target for outgoing,
  // source for incoming). "Open" links to the edge detail page, which lives
  // under the edge's source node: /nodes/<source.id>/edges/<edge.id>.
  interface EdgeRow {
    edgeId: string;
    direction: 'Outgoing' | 'Incoming';
    name: string; // relationship name ('—' when unnamed) — also the sort/search key
    endpointId: string;
    endpointName: string;
    endpointUrn: string;
    /** Memory id that owns the edge (= source node's memory) — for the detail href. */
    sourceMemoryId: string;
    sourceId: string;
  }

  function endpointUrnOf(n: NodeEdge['source']): string {
    // Endpoints carry their memory urn (#350); compose the full node URN the
    // same way the Nodes list does, falling back to bare loc if absent.
    const memUrn = n.memory?.urn;
    return memUrn && n.loc ? composeNodeUrn(memUrn, n.loc) : n.loc;
  }

  const edgeRows = $derived<EdgeRow[]>([
    ...node.outgoingEdges.map((e) => ({
      edgeId: e.id,
      direction: 'Outgoing' as const,
      name: e.name || '—',
      endpointId: e.target.id,
      endpointName: e.target.name || e.target.loc,
      endpointUrn: endpointUrnOf(e.target),
      // Outgoing: this node is the source.
      sourceMemoryId: node.memoryId,
      sourceId: node.id,
    })),
    ...node.incomingEdges.map((e) => ({
      edgeId: e.id,
      direction: 'Incoming' as const,
      name: e.name || '—',
      endpointId: e.source.id,
      endpointName: e.source.name || e.source.loc,
      endpointUrn: endpointUrnOf(e.source),
      // Incoming: the OTHER node is the source that owns the edge.
      sourceMemoryId: e.source.memory?.id ?? node.memoryId,
      sourceId: e.source.id,
    })),
  ]);

  let edgeFilter = $state('');

  const edgeColumns: ColumnDef<EdgeRow>[] = [
    { accessorKey: 'direction', header: 'Direction', size: 110 },
    { accessorKey: 'name', id: 'relationship', header: 'Relationship', size: 150 },
    { accessorKey: 'endpointName', id: 'node', header: 'Node', enableHiding: false, size: 200 },
    { accessorKey: 'endpointUrn', id: 'urn', header: 'URN', size: 320 },
    { id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 90 },
  ];

  const edgeTable = createSvelteTable<EdgeRow>({
    get data() {
      return edgeRows;
    },
    columns: edgeColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return edgeFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      edgeFilter = typeof u === 'function' ? u(edgeFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  function edgeDetailHref(r: EdgeRow): string {
    return `/app/memories/${r.sourceMemoryId}/nodes/${r.sourceId}/edges/${r.edgeId}`;
  }

  // Children: direct children of this node's loc
  const children = $derived(
    (data.graphNodes ?? [])
      .filter((n) => {
        if (n.loc === node.loc) return false;
        if (!n.loc.startsWith(node.loc + ':')) return false;
        const rest = n.loc.slice(node.loc.length + 1);
        return !rest.includes(':');
      })
      .sort((a, b) => {
        if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
        if (a.seq !== null) return -1;
        if (b.seq !== null) return 1;
        return a.loc.localeCompare(b.loc);
      })
  );
  const hasChildren = $derived(children.length > 0);
  const childrenReorderable = $derived(children.some((c) => c.seq !== null));
  let childDragError = $state<string | null>(null);
  // #309: the children list defaults to the full grid; reordering is a separate
  // mode because drag order is incompatible with sort/filter/pagination.
  let reorderMode = $state(false);
  // Guard overlapping reorder POSTs from rapid successive drags — each sends a
  // full seq rewrite, so a race could land a stale order.
  let reordering = $state(false);

  // URN slug for edit form
  const urnSlug = $derived(node.loc);

  type NodeTab = 'content' | 'abstract' | 'data' | 'properties' | 'flow' | 'children' | 'references' | 'settings';

  // Content / Abstract / Data / Properties / Flow / Edges / Settings are always
  // present; Children only when the node has children. (#256: Content is no
  // longer gated on hasContent — an empty node still needs an authoring
  // surface; Data follows the same always-on rationale so there's a portal
  // path to add structured data to a node that has none. Flow (#478) is
  // always-on for the same reason: turning a plain node into a flow node
  // needs a surface. Properties (#518) is read-only but always-on for
  // discoverability, same as Data.)
  const availableTabs = $derived<NodeTab[]>(
    hasChildren
      ? ['content', 'abstract', 'data', 'properties', 'flow', 'children', 'references', 'settings']
      : ['content', 'abstract', 'data', 'properties', 'flow', 'references', 'settings'],
  );

  function defaultTab(): NodeTab {
    // Content when present, else the Children list for a pure container
    // node, else Content (its empty-state authoring surface).
    return hasContent ? 'content' : hasChildren ? 'children' : 'content';
  }

  let activeTab = $state<NodeTab>(defaultTab());

  // SvelteKit reuses this component instance when navigating between nodes
  // (the route param changes but the component doesn't remount), so all the
  // transient `$state` below would otherwise leak across nodes — a stale
  // Source editor, an armed delete confirmation, or an active tab the new
  // node doesn't have (#251). Reset everything when the node id changes, and
  // re-pick the new node's default tab.
  let lastNodeId: string | undefined;
  $effect(() => {
    if (lastNodeId !== node.id) {
      lastNodeId = node.id;
      activeTab = defaultTab();
      showSource = false;
      showAbstractSource = false;
      showDataSource = false;
      confirmDelete = false;
      editingEdges = false;
      isEditing = false;
      reorderMode = false;
      downloadOpen = false;
      dlError = null;
      testFlowOpen = false;
      testFlowAppId = '';
      testFlowPayload = '';
      moveOpen = false;
      moveTarget = '';
      deleteOpen = false;
      hardDelete = false;
      return;
    }
    // Same node: keep the active tab valid if its availability changes (e.g.
    // children removed). Reading `availableTabs` tracks hasChildren so the
    // fallback fires reliably. Content is always present (#256).
    if (!availableTabs.includes(activeTab)) activeTab = 'content';
  });

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:window onkeydown={(e) => {
  // Escape closes whichever header popover is open (only one is at a time —
  // onMenuSelect closes siblings). PR-504 review (Copilot: Move/Delete a11y).
  if (e.key !== 'Escape') return;
  downloadOpen = false; testFlowOpen = false; moveOpen = false; deleteOpen = false;
}} />

<svelte:head><title>{node.name} &middot; Hadron</title></svelte:head>

<div class="space-y-4">
  <!-- Breadcrumb -->
  <Breadcrumb items={[
    { label: 'Memories', href: memoriesHref },
    { label: data.graph.name, href: basePath },
    { label: 'Nodes', href: `${basePath}/nodes` },
    ...data.breadcrumb.slice(0, -1).map((seg) =>
      seg.nodeId
        ? { label: seg.label, href: `${basePath}/nodes/${seg.nodeId}` }
        : { label: seg.label }
    ),
    { label: node.name },
  ]} />
  <!-- Create missing parent nodes -->
  {#each data.breadcrumb.slice(0, -1) as seg}
    {#if !seg.nodeId}
      <form method="POST" action="?/createParent" use:enhance class="inline">
        <input type="hidden" name="loc" value={seg.path} />
        <input type="hidden" name="name" value={seg.label} />
        <button type="submit" class="text-xs text-indigo-500 hover:text-indigo-400">
          + Create parent node "{seg.label}"
        </button>
      </form>
    {/if}
  {/each}

  <!-- Header -->
  <div class="flex items-start justify-between gap-3">
    <div>
      <h1 class="flex items-center gap-2 text-xl font-bold text-zinc-900 dark:text-white">
        {#if node.isRunnable}
          <svg class="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        {/if}
        <span><span class="text-zinc-400 font-normal">{node.isRunnable ? createNodeStrings.taskNodeCaption() : createNodeStrings.nodeCaption()}</span> {node.name}</span>
      </h1>
      <Urn value={fullUrn} type="node" />
      {#if node.description}
        <p class="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{node.description}</p>
      {/if}
    </div>
    <div class="shrink-0 flex items-start gap-2">
      {#if isTeamChat}
        <a
          href="{basePath}/nodes/{node.id}/chat"
          class="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
        >
          Open chat
        </a>
      {/if}
      <!-- #503: the "⋯" menu is the single entry point for node actions;
           each item opens one of the panels/dialogs below. -->
      <NodeActionsMenu actions={menuActions} onselect={onMenuSelect} label={`Actions for ${node.name}`} />
      <!-- Hidden form the menu's Duplicate item submits (requestSubmit fires
           the submit event use:enhance intercepts, unlike .submit()). -->
      <form bind:this={duplicateForm} method="POST" action="?/duplicate" use:enhance class="hidden"></form>
      <!-- Convert-to-task: flips isRunnable on; enhance re-runs load so the
           menu item disappears once the node is a task (#503). -->
      <form bind:this={convertForm} method="POST" action="?/convertToTask" use:enhance class="hidden"></form>
      <!-- Panels/dialogs opened from the actions menu, anchored to the header. -->
      <div class="relative">
          {#if testFlowOpen}
            <button
              type="button"
              class="fixed inset-0 z-10 cursor-default"
              aria-label="Close test flow panel"
              onclick={() => (testFlowOpen = false)}
            ></button>
            <div class="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <form method="POST" action="?/testFlow" use:enhance class="space-y-3">
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  Runs this node as a one-off headless flow: it executes, extracts its fields, and follows routing edges. You'll land on the live run page.
                </p>
                <div>
                  <label for="testFlowApp" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Run as App</label>
                  <select id="testFlowApp" name="appId" bind:value={testFlowAppId} required class={inputClass}>
                    <option value="" disabled>Pick an App…</option>
                    {#each testFlowApps as app (app.id)}
                      <option value={app.id}>{app.name}</option>
                    {/each}
                  </select>
                  <p class="mt-1 text-xs text-zinc-400">The run uses this App's budgets and permissions.</p>
                </div>
                <div>
                  <label for="testFlowPayload" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Test payload (optional JSON)</label>
                  <textarea
                    id="testFlowPayload"
                    name="payload"
                    rows="4"
                    bind:value={testFlowPayload}
                    placeholder={'{ "confidence": 0.9 }'}
                    spellcheck="false"
                    class="w-full rounded-lg border bg-zinc-50 p-2 font-mono text-xs text-zinc-800 focus:outline-none dark:bg-zinc-950 dark:text-zinc-300 {testFlowPayloadValid ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 dark:border-red-700'}"
                  ></textarea>
                  <p class="mt-1 text-xs {testFlowPayloadValid ? 'text-zinc-400' : 'text-red-500'}">
                    {testFlowPayloadValid
                      ? 'Fields conditions can branch on — like a trigger would send.'
                      : 'Must be a JSON object of named fields.'}
                  </p>
                </div>
                {#if form && 'testFlowError' in form && form.testFlowError}
                  <p class="text-xs text-red-500">{form.testFlowError}</p>
                {/if}
                <input type="hidden" name="orgId" value={data.org?.id ?? ''} />
                <button
                  type="submit"
                  disabled={!testFlowAppId || !testFlowPayloadValid}
                  class="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >Start test run</button>
              </form>
            </div>
          {/if}
          <!-- Download / export — server-rendered file (#421 / hadron-server
               #386); the portal never re-implements the codec. Menu-triggered. -->
          {#if downloadOpen}
          <!-- Outside-click backdrop. A real <button> (not a click-only div) so
               it's focusable and dismissible via keyboard/screen reader without
               a11y-ignore comments. Escape also closes — see svelte:window. -->
          <button
            type="button"
            class="fixed inset-0 z-30 cursor-default"
            aria-label="Close download menu"
            onclick={() => (downloadOpen = false)}
          ></button>
          <div class="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <fieldset class="mb-3">
              <legend class="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Format</legend>
              <div class="flex gap-4">
                <label class="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" name="dlFormat" value="MD" bind:group={dlFormat} class="text-indigo-600 focus:ring-indigo-500" />
                  Markdown
                </label>
                <label class="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" name="dlFormat" value="JSON" bind:group={dlFormat} class="text-indigo-600 focus:ring-indigo-500" />
                  JSON
                </label>
                <label class="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" name="dlFormat" value="PDF" bind:group={dlFormat} class="text-indigo-600 focus:ring-indigo-500" />
                  PDF
                </label>
              </div>
            </fieldset>
            <!-- Scope/sections apply to the canonical MD/JSON file only. PDF is a
                 presentation render of the node content, so hide them for PDF. -->
            {#if dlFormat !== 'PDF'}
            <fieldset class="mb-3">
              <legend class="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Scope</legend>
              <div class="space-y-1.5">
                <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" name="dlScope" value={true} bind:group={dlFull} class="mt-0.5 text-indigo-600 focus:ring-indigo-500" />
                  <span>Full node file <span class="block text-xs text-zinc-500">Canonical, re-importable</span></span>
                </label>
                <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="radio" name="dlScope" value={false} bind:group={dlFull} class="mt-0.5 text-indigo-600 focus:ring-indigo-500" />
                  <span>Custom sections</span>
                </label>
              </div>
            </fieldset>
            {#if !dlFull}
              <fieldset class="mb-3">
                <legend class="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Sections</legend>
                <div class="space-y-1.5">
                  <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" bind:checked={dlSections.METADATA} class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" /> Metadata
                  </label>
                  <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" bind:checked={dlSections.CONTENT} class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" /> Content
                  </label>
                  <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" bind:checked={dlSections.ABSTRACT} class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" /> Abstract
                  </label>
                  <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" bind:checked={dlSections.DATA} class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" /> Data
                  </label>
                  <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" bind:checked={dlSections.PROPERTIES} class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" /> Properties
                  </label>
                  <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" bind:checked={dlSections.EDGES} class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" /> Edges
                  </label>
                </div>
              </fieldset>
            {/if}
            {/if}
            {#if dlError}
              <p class="mb-2 text-xs text-red-500">{dlError}</p>
            {/if}
            <button
              type="button"
              onclick={runDownload}
              disabled={!dlCanDownload || dlBusy}
              class="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dlBusy ? 'Exporting…' : `Download .${dlFormat.toLowerCase()}`}
            </button>
          </div>
        {/if}

        <!-- Move (#503/#489): edit the destination node URN. Change the loc
             segment to relocate within this memory; change the memory segment
             to move to another memory in the org — moveNode's targetUrn
             resolves the destination memory by URN. -->
        {#if moveOpen}
          <button type="button" class="fixed inset-0 z-30 cursor-default" aria-label="Close move dialog" onclick={() => (moveOpen = false)}></button>
          <div class="absolute right-0 z-40 mt-2 w-96 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <!-- Close on success only: a same-node move redirects back to
                 THIS page (PK stable), so the per-node effect never fires to
                 reset moveOpen — do it here. Keep open on failure so moveError
                 shows (PR-504 review, Gemini). -->
            <form
              method="POST"
              action="?/move"
              use:enhance={() => async ({ result, update }) => { await update(); if (result.type !== 'failure') moveOpen = false; }}
              class="space-y-3"
            >
              <div>
                <label for="moveTarget" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Destination node URN</label>
                <input id="moveTarget" name="target" type="text" bind:value={moveTarget} spellcheck="false" class="{inputClass} font-mono text-xs" />
                <p class="mt-1 text-xs text-zinc-400">
                  <span class="font-mono">org::memory::loc</span> — change the loc to rename/reparent, or the memory to move it to another memory. Fails if a node already lives there.
                </p>
                <!-- #512: pick the target memory from a searchable list instead
                     of hand-typing its URN; keeps the current loc. The list is
                     streamed (#513 review), so gate on the resolved value. -->
                {#await data.memories then memories}
                  {#if memories.length > 0}
                    <button
                      type="button"
                      onclick={() => (memoryPickerOpen = true)}
                      class="mt-2 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >{t('node-actions.move-select-memory', 'Select target memory…')}</button>
                  {/if}
                {/await}
              </div>
              {#if form && 'moveError' in form && form.moveError}
                <p class="text-xs text-red-500">{form.moveError}</p>
              {/if}
              <div class="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!moveTarget.trim() || moveTarget.trim() === fullUrn}
                  class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >Move node</button>
                <button type="button" onclick={() => (moveOpen = false)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
              </div>
            </form>
          </div>
          <!-- #512: memory picker for the Move dialog. Renders its own full-screen
               modal (z-50), so it layers above the move panel. The list is
               streamed (#513 review), so resolve it before passing it in. -->
          {#await data.memories then memories}
            <SelectMemory
              {memories}
              bind:open={memoryPickerOpen}
              onselect={onPickTargetMemory}
              placeholder={t('node-actions.move-search-memories', 'Search memories to move into…')}
            />
          {/await}
        {/if}

        <!-- Delete (#503): the same ?/delete action the Settings danger zone
             uses. The hard-delete checkbox sends hard=true (permanent purge);
             unchecked = the default soft delete. -->
        {#if deleteOpen}
          <button type="button" class="fixed inset-0 z-30 cursor-default" aria-label="Close delete confirmation" onclick={() => (deleteOpen = false)}></button>
          <div class="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-red-200 bg-white p-4 shadow-xl dark:border-red-900 dark:bg-zinc-900">
            <form method="POST" action="?/delete" use:enhance class="space-y-3">
              <p class="text-sm text-zinc-700 dark:text-zinc-200">Delete <span class="font-medium">{node.name}</span>?</p>
              <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" name="hard" value="true" bind:checked={hardDelete}
                  class="mt-0.5 rounded border-zinc-300 text-red-600 focus:ring-red-500 dark:border-zinc-600 dark:bg-zinc-800" />
                <span>
                  Hard delete
                  <span class="block text-xs {hardDelete ? 'text-red-500' : 'text-zinc-400'}">
                    {hardDelete
                      ? 'Permanently removes the node — it cannot be recovered.'
                      : 'Off: soft-deletes (hidden, but recoverable server-side).'}
                  </span>
                </span>
              </label>
              <div class="flex items-center gap-2">
                <button type="submit" class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500">
                  {hardDelete ? 'Delete permanently' : 'Delete'}
                </button>
                <button type="button" onclick={() => (deleteOpen = false)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
              </div>
            </form>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Tabs: Content | Abstract | Children (when present) | Edges | Settings -->
  <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
    <div class="mb-3 flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
      <!-- Always shown (#256) — an empty node still needs an authoring
           surface, or there's no portal path to add content. Mirrors the
           Abstract tab's always-on treatment below. -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'content' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'content'}
      >Content
        {#if !hasContent}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      <!-- Always shown — an empty abstract still needs an authoring surface
           (the default vector-index source), same rationale as Content (#256). -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'abstract' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'abstract'}
      >Abstract
        {#if !hasAbstract}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      <!-- Always shown — Node.data is free-form JSON; an empty node still
           needs an authoring surface, same rationale as Content/Abstract. -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'data' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'data'}
      >Data
        {#if !hasData}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      <!-- #518: Node.properties (read-only) — structured key-value metadata,
           often server-set provenance. Always shown for discoverability. -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'properties' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'properties'}
      >Properties
        {#if !hasProperties}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      <!-- Always shown (#478) — turning a plain node into a flow node (extract
           fields, write output) needs an authoring surface. -->
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'flow' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'flow'}
      >Flow
        {#if !hasFlowConfig}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      </button>
      {#if hasChildren}
        <button
          class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'children' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
          onclick={() => activeTab = 'children'}
        >Children <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{children.length}</span></button>
      {/if}
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'references' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'references'}
      >Edges
        {#if hasReferences}
          <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{node.outgoingEdges.length + node.incomingEdges.length}</span>
        {/if}
      </button>
      <button
        class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'settings' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
        onclick={() => activeTab = 'settings'}
      >Settings</button>
    </div>

    <!-- ═══ CONTENT TAB ═══ -->
    {#if activeTab === 'content'}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showSource = false}
          >Rendered</button>
          <button
            class="px-2 py-1 text-xs {showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showSource = true}
          >Source</button>
        </div>
        {#if hasContent}
          <button onclick={copyContent} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy content">
            {#if copied}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showSource}
        <div class="mt-3">
          <!-- #247: fill the available viewport height rather than a fixed
               300px, so the source editor is comfortable for long content.
               h- is viewport-relative (minus the nav/breadcrumb/header/tabs
               chrome above and the Save row below); min-h-[300px] floors it
               so it stays usable on short/landscape-mobile viewports where
               100vh is small. The textarea scrolls internally. -->
          <textarea
            class="w-full h-[calc(100vh-18rem)] min-h-[300px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
            placeholder={createNodeStrings.contentSourcePlaceholder()}
            bind:value={editContent}
          ></textarea>
          <div class="mt-2 flex justify-end">
            <button
              onclick={saveContent}
              disabled={saving || editContent === (node.content ?? '')}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      {:else if hasContent}
        {#if contentFrontmatter}
          <div class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <div class="border-b border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{createNodeStrings.contentFrontmatterLabel()}</div>
            <pre class="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{contentFrontmatter}</pre>
          </div>
        {/if}
        <div class="prose prose-sm prose-zinc mt-3 max-w-none dark:prose-invert">{@html renderedHtml}</div>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">{createNodeStrings.contentEmptyTitle()}</p>
          <button
            onclick={() => showSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >{createNodeStrings.contentEmptyCta()}</button>
        </div>
      {/if}
    {/if}

    <!-- ═══ ABSTRACT TAB ═══ -->
    {#if activeTab === 'abstract'}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showAbstractSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showAbstractSource = false}
          >Rendered</button>
          <button
            class="px-2 py-1 text-xs {showAbstractSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showAbstractSource = true}
          >Source</button>
        </div>
        {#if hasAbstract}
          <button onclick={copyAbstract} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy abstract">
            {#if copiedAbstract}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showAbstractSource}
        <div class="mt-3">
          <textarea
            class="w-full min-h-[120px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
            maxlength={ABSTRACT_MAX}
            placeholder="A paragraph-length summary of this node. This is the default source for vector search."
            bind:value={editAbstract}
          ></textarea>
          <div class="mt-2 flex items-center justify-between">
            <span class="text-xs {editAbstract.length > ABSTRACT_MAX ? 'text-red-500' : 'text-zinc-400'}">{editAbstract.length} / {ABSTRACT_MAX}</span>
            <button
              onclick={saveAbstract}
              disabled={savingAbstract || editAbstract === (node.abstract ?? '')}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{savingAbstract ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      {:else if hasAbstract}
        <div class="prose prose-sm prose-zinc mt-3 max-w-none dark:prose-invert">{@html renderedAbstractHtml}</div>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">No abstract yet. The abstract is a paragraph-length summary and the default source for vector search.</p>
          <button
            onclick={() => showAbstractSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >Write an abstract</button>
        </div>
      {/if}
    {/if}

    <!-- ═══ DATA TAB ═══ -->
    {#if activeTab === 'data'}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showDataSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showDataSource = false}
          >Rendered</button>
          <button
            class="px-2 py-1 text-xs {showDataSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showDataSource = true}
          >Source</button>
        </div>
        {#if hasData}
          <button onclick={copyData} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy data">
            {#if copiedData}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showDataSource}
        <div class="mt-3">
          <!-- Source editor: monospace, auto-growing to fit its content
               (min-h floor, max-h cap then scrolls). The border turns red
               while the JSON is malformed; the status row below shows a green
               check when it parses. -->
          <textarea
            use:autosize={editData}
            class="w-full min-h-[160px] max-h-[calc(100vh-16rem)] resize-none overflow-y-auto rounded-lg border bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none {dataValid ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 focus:border-red-500 dark:border-red-700'}"
            placeholder={'{\n  "key": "value"\n}'}
            spellcheck="false"
            bind:value={editData}
          ></textarea>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div class="text-xs">
              {#if dataTooLarge}
                <span class="text-red-500">Too large to save here ({Math.round(editData.length / 1024)} KB / {DATA_MAX / 1024} KB max).</span>
              {:else if dataEmpty}
                <span class="text-zinc-400">Enter a JSON value to save.</span>
              {:else if dataValid}
                <span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Valid JSON
                </span>
              {:else}
                <span class="text-red-500">{dataError}</span>
              {/if}
            </div>
            <button
              onclick={saveData}
              disabled={savingData || !dataValid || dataEmpty || !dataDirty || dataTooLarge}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{savingData ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      {:else if renderedJson != null}
        <pre class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 overflow-x-auto">{#each highlightedData as tok}<span class={jsonTokenClass[tok.type]}>{tok.text}</span>{/each}</pre>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">No structured data. Node.data holds a free-form JSON object.</p>
          <button
            onclick={() => showDataSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >Add data</button>
        </div>
      {/if}
    {/if}

    <!-- ═══ PROPERTIES TAB (#518) — read-only structured metadata ═══ -->
    {#if activeTab === 'properties'}
      {#if hasProperties}
        <div class="flex items-center justify-end">
          <button onclick={copyProperties} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy properties">
            {#if copiedProperties}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        </div>
        <pre class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 overflow-x-auto">{#each highlightedProperties as tok}<span class={jsonTokenClass[tok.type]}>{tok.text}</span>{/each}</pre>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">No properties. Node.properties holds structured key-value metadata (often server-set, e.g. source URL or title).</p>
        </div>
      {/if}
    {/if}

    <!-- ═══ FLOW TAB (#478) ═══ -->
    {#if activeTab === 'flow'}
      <div class="max-w-3xl space-y-6">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {t(
            'node.flow.intro',
            'In a headless run, this node is one step of a flow: the platform runs it, extracts the fields below from the answer, then follows the first matching routing edge. Extracted fields are available to edge conditions and as {{field}} placeholders in downstream node content.',
          )}
        </p>

        <a
          href="/app/memories/{node.memoryId}/nodes/{node.id}/flow"
          class="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
        >
          {t('node.flow.openCanvas', 'Open flow canvas')} →
        </a>

        {#if form && 'flowError' in form && form.flowError}
          <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.flowError}</div>
        {/if}
        {#if form && 'flowSaved' in form && form.flowSaved}
          <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
            {t('node.flow.saved', 'Flow settings saved.')}
          </div>
        {/if}

        <form method="POST" action="?/updateFlow" use:enhance class="space-y-6">
          <!-- Extraction -->
          <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">
              {t('node.flow.extraction.title', 'Extracted fields')}
            </h3>
            <p class="mt-1 text-xs text-zinc-400">
              {t(
                'node.flow.extraction.explainer',
                'After this node runs, these fields are pulled from its answer into the run. Routing conditions can then branch on them.',
              )}
            </p>

            {#if flowRows.length === 0}
              <p class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('node.flow.extraction.empty', 'No fields yet — this node runs without extracting anything.')}
              </p>
            {:else}
              <div class="mt-3 space-y-2">
                {#each flowRows as row, i (i)}
                  {@const fieldError = extractionFieldError(row.field)}
                  <div class="flex flex-wrap items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <div class="w-44">
                      <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500" for="flow-field-{i}">
                        {t('node.flow.extraction.field', 'Field name')}
                      </label>
                      <input
                        id="flow-field-{i}"
                        type="text"
                        bind:value={row.field}
                        placeholder="confidence"
                        class="w-full rounded border px-2 py-1 text-xs dark:bg-zinc-900 dark:text-white {fieldError ? 'border-red-400 dark:border-red-700' : 'border-zinc-300 dark:border-zinc-700'}"
                      />
                    </div>
                    <div>
                      <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500" for="flow-shape-{i}">
                        {t('node.flow.extraction.shape', 'Type')}
                      </label>
                      <select
                        id="flow-shape-{i}"
                        bind:value={row.shape}
                        class="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                      >
                        {#each EXTRACTION_SHAPES as shape (shape)}
                          <option value={shape}>{shape === 'string[]' ? t('node.flow.extraction.shape.list', 'list of text') : shape}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="min-w-[12rem] flex-1">
                      <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500" for="flow-desc-{i}">
                        {t('node.flow.extraction.description', 'Description (helps the model)')}
                      </label>
                      <input
                        id="flow-desc-{i}"
                        type="text"
                        bind:value={row.description}
                        placeholder={t('node.flow.extraction.description.placeholder', 'How confident the answer is, 0 to 1')}
                        class="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      onclick={() => removeFlowRow(i)}
                      class="self-end px-2 py-1 text-xs text-zinc-400 hover:text-red-500"
                      aria-label={t('node.flow.extraction.remove', 'Remove field')}
                    >×</button>
                    {#if fieldError && row.field.trim() !== ''}
                      <p class="basis-full text-xs text-red-500">{fieldError}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <button
              type="button"
              onclick={addFlowRow}
              class="mt-3 rounded bg-zinc-200 px-2 py-1 text-xs hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            >+ {t('node.flow.extraction.add', 'Add field')}</button>
          </section>

          <!-- Output -->
          <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">
              {t('node.flow.output.title', 'Output')}
            </h3>
            <p class="mt-1 text-xs text-zinc-400">
              {t(
                'node.flow.output.explainer',
                'Optionally write this node’s answer to a specific node mid-flow. Without this, only the flow’s last node writes — a run record placed beside it automatically.',
              )}
            </p>
            <div class="mt-3 flex flex-wrap items-start gap-3">
              <div class="min-w-[16rem] flex-1">
                <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500" for="flow-writeto">
                  {t('node.flow.output.write-to', 'Write to node (URN)')}
                </label>
                <input
                  id="flow-writeto"
                  type="text"
                  bind:value={outputWriteTo}
                  list="flow-writeto-options"
                  placeholder={t('node.flow.output.write-to.placeholder', 'org::memory::reports:daily')}
                  class="w-full rounded border px-2 py-1 font-mono text-xs dark:bg-zinc-900 dark:text-white {outputWriteToValid ? 'border-zinc-300 dark:border-zinc-700' : 'border-red-400 dark:border-red-700'}"
                />
                <datalist id="flow-writeto-options">
                  {#each outputTargetOptions as opt (opt.urn)}
                    <option value={opt.urn}>{opt.name}</option>
                  {/each}
                </datalist>
                {#if !outputWriteToValid}
                  <p class="mt-1 text-xs text-red-500">
                    {t('node.flow.output.write-to.invalid', 'Must be a fully-qualified node URN (org::memory::loc), or empty.')}
                  </p>
                {/if}
              </div>
              <div>
                <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500" for="flow-mode">
                  {t('node.flow.output.mode', 'Mode')}
                </label>
                <select
                  id="flow-mode"
                  bind:value={outputMode}
                  disabled={outputWriteTo.trim() === ''}
                  class="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="replace">{t('node.flow.output.mode.replace', 'replace content')}</option>
                  <option value="append">{t('node.flow.output.mode.append', 'append to content')}</option>
                </select>
              </div>
            </div>
          </section>

          <input type="hidden" name="extractionRows" value={flowRowsJson} />
          <input type="hidden" name="outputWriteTo" value={outputWriteTo.trim()} />
          <input type="hidden" name="outputMode" value={outputMode} />

          <div class="flex items-center gap-3">
            <button
              type="submit"
              disabled={!flowDirty || flowRowsError !== null || !outputWriteToValid}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            >{t('node.flow.save', 'Save flow settings')}</button>
            {#if flowRowsError !== null && flowRows.some((r) => r.field.trim() !== '')}
              <span class="text-xs text-red-500">{flowRowsError.message}</span>
            {/if}
          </div>
        </form>
      </div>
    {/if}

    <!-- ═══ CHILDREN TAB ═══ -->
    {#if activeTab === 'children' && hasChildren}
      {#if childDragError}
        <p class="mb-2 rounded-md border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{childDragError}</p>
      {/if}
      {#if childrenReorderable}
        <!-- #309: default to the grid (saved views, search, sort, columns,
             pagination); a separate Reorder mode swaps in the drag list, whose
             stable full-row order can't coexist with sort/filter/pagination. -->
        <div class="mb-3 flex items-center justify-end gap-3">
          {#if reorderMode}<span class="text-xs text-zinc-500">Drag rows to reorder</span>{/if}
          <button
            type="button"
            onclick={() => reorderMode = !reorderMode}
            class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >{reorderMode ? 'Done' : 'Reorder'}</button>
        </div>
      {/if}
      <!-- #309: remount on mode switch — NodeList reads enableSorting/
           enableColumnResizing (= !orderable) once at table construction. -->
      {#key reorderMode}
        <NodeList
          nodes={children}
          {basePath}
          memoryUrn={data.graph.urn ?? ''}
          orderable={reorderMode}
          listKey={reorderMode ? undefined : 'node-children'}
          onreorder={reorderMode
            ? async (orderedLocs) => {
                if (reordering) return;
                reordering = true;
                const updates = orderedLocs.map((loc, i) => ({ loc, seq: i + 1 }));
                try {
                  const fd = new FormData();
                  fd.set('updates', JSON.stringify(updates));
                  const res = await fetch('?/reorder', { method: 'POST', body: fd });
                  if (!res.ok) throw new Error('Reorder failed');
                  await invalidateAll();
                } catch (err) {
                  childDragError = err instanceof Error ? err.message : 'Reorder failed';
                  setTimeout(() => { childDragError = null; }, 3000);
                } finally {
                  reordering = false;
                }
              }
            : undefined}
        />
      {/key}
    {/if}

    <!-- ═══ EDGES TAB ═══
         #490 renamed the visible copy only. The tab key stays 'references'
         (it is not URL-bound, so renaming is safe but pure churn); the
         DataTable listKey below MUST stay — it persists users' saved
         table views. -->
    {#if activeTab === 'references'}
      <!-- #350: both directions in one TanStack table (Direction · Relationship ·
           Node · URN · Open). "Edit edges" still opens the inline add/remove
           editor for this node's OUTGOING edges; per-edge property editing
           (name, condition, priority, etc.) lives on the edge detail page,
           reached via the row's "Open" link. -->
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Edges</h3>
        {#if !editingEdges}
          <button type="button" onclick={startEditEdges}
            class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
            Edit edges
          </button>
        {/if}
      </div>

      {#if !editingEdges}
        {#if edgeRows.length > 0}
          <DataTable
            table={edgeTable}
            listKey="node:references"
            searchPlaceholder="Search edges..."
            searchAriaLabel="Search edges"
            bind:globalFilter={edgeFilter}
            maxHeight="max(200px, calc(100vh - 22rem))"
          >
            {#snippet cell(cell, r)}
              {#if cell.column.id === 'direction'}
                <span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {r.direction === 'Outgoing' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{r.direction}</span>
              {:else if cell.column.id === 'relationship'}
                <span class="text-zinc-600 dark:text-zinc-400">{r.name}</span>
              {:else if cell.column.id === 'node'}
                <div class="truncate">
                  <a href="{basePath}/nodes/{r.endpointId}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{r.endpointName}</a>
                </div>
              {:else if cell.column.id === 'urn'}
                <Urn value={r.endpointUrn} type="node" size={10} />
              {:else if cell.column.id === 'actions'}
                <a href={edgeDetailHref(r)} class="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">Open →</a>
              {/if}
            {/snippet}
          </DataTable>
        {:else}
          <p class="text-sm text-zinc-400">No edges.</p>
        {/if}
      {:else}
        <!-- Edit mode: list with remove buttons, add form, save/cancel -->
        <form method="POST" action="?/updateEdges" use:enhance={() => {
          return async ({ update }) => { editingEdges = false; await update(); };
        }}>
          <input type="hidden" name="edges" value={editableEdgesJson} />

          {#if editableEdges.length > 0}
            <div class="space-y-1">
              {#each editableEdges as edge, idx}
                <div class="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <span class="font-mono text-indigo-600 dark:text-indigo-300">{edge.targetName}</span>
                  <span class="text-xs text-zinc-400">{edge.targetLoc}</span>
                  {#if edge.name}<span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{edge.name}</span>{/if}
                  <div class="flex-1"></div>
                  <button type="button" onclick={() => removeEditableEdge(idx)}
                    class="rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
                    Remove
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-zinc-400">No outgoing edges.</p>
          {/if}

          <!-- Add a new edge -->
          <div class="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
            <p class="mb-2 text-xs font-medium text-zinc-500">Add edge</p>
            <div class="flex flex-wrap items-end gap-2">
              <div class="flex-1 min-w-[200px]">
                <label for="newEdgeTarget" class="mb-1 block text-xs text-zinc-500">Target (loc or name)</label>
                <input id="newEdgeTarget" type="text" bind:value={newEdgeTargetQuery}
                  placeholder="e.g. specs:auth:jwt"
                  class="{inputClass} font-mono text-xs" />
              </div>
              <div class="w-40">
                <label for="newEdgeName" class="mb-1 block text-xs text-zinc-500">Name (optional)</label>
                <input id="newEdgeName" type="text" bind:value={newEdgeName}
                  placeholder="e.g. cites"
                  class="{inputClass} text-xs" />
              </div>
              <button type="button" onclick={addEditableEdge}
                class="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-zinc-900 dark:text-indigo-300 dark:hover:bg-indigo-950">
                + Add
              </button>
            </div>
            {#if addEdgeError}
              <p class="mt-2 text-xs text-red-500">{addEdgeError}</p>
            {/if}
          </div>

          <div class="mt-4 flex items-center gap-2">
            <button type="submit" class="rounded-lg px-4 py-2 text-xs font-semibold text-white" style="background: #fb8500;">
              Save edges
            </button>
            <button type="button" onclick={cancelEditEdges}
              class="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </form>
      {/if}
    {/if}

    <!-- ═══ SETTINGS TAB ═══ -->
    {#if activeTab === 'settings'}
      <div class="max-w-3xl space-y-8">
        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="font-semibold text-zinc-900 dark:text-white">Node</h2>
            {#if !isEditing}
              <div class="flex items-center gap-2">
                <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
                <a href="{basePath}/graph?focus={node.id}" class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Graph</a>
              </div>
            {/if}
          </div>

          {#if isEditing}
            <form method="POST" action="?/updateMeta" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }}
              class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
              <div>
                <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                <input id="editName" name="name" type="text" required value={node.name} class={inputClass} />
              </div>
              <div>
                <label for="editNodeType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="editNodeType" name="nodeType" value={node.nodeType} class={inputClass}>
                  {#if !isCanonicalNodeType(node.nodeType)}
                    <option value={node.nodeType}>{node.nodeType}</option>
                  {/if}
                  {#each NODE_TYPES as nt}
                    <option value={nt}>{nt}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label for="editLoc" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN <span class="text-zinc-500">(changing this moves the node)</span></label>
                <div class="flex items-stretch">
                  <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.graph.urn}:</span>
                  <input id="editLoc" name="loc" type="text" value={urnSlug}
                    class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
                </div>
              </div>
              <div>
                <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
                <textarea id="editDescription" name="description" rows="3" value={node.description ?? ''} placeholder="Short caption" class={inputClass}></textarea>
              </div>
              <div>
                <label for="editAlias" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Alias</label>
                <input id="editAlias" name="alias" type="text" value={node.alias ?? ''} placeholder="Optional" class={inputClass} />
              </div>
              <div>
                <label for="editSeq" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Seq <span class="text-zinc-500">(sort order)</span></label>
                <input id="editSeq" name="seq" type="number" value={node.seq ?? ''} placeholder="Optional" class={inputClass} />
              </div>
              <div>
                <label for="editTags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
                <input id="editTags" name="tags" type="text" value={node.tags.join(', ')} class={inputClass} />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <input id="editIsRunnable" name="isRunnable" type="checkbox" value="true" checked={node.isRunnable ?? false}
                    class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900" />
                  Is Runnable <span class="font-normal text-zinc-500">(can be run as a task by hadron_run_task)</span>
                </label>
              </div>
              <div class="flex gap-3">
                <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Save</button>
                <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
              </div>
            </form>
          {:else}
            <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Name</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{node.name}</span>
              </div>
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Type</span>
                <span class="text-sm font-medium text-zinc-900 dark:text-white">{node.nodeType}</span>
              </div>
              {#if node.description}
                <div class="px-5 py-3">
                  <span class="text-sm text-zinc-500">Description</span>
                  <p class="mt-1 text-sm text-zinc-900 dark:text-white">{node.description}</p>
                </div>
              {/if}
              {#if node.alias}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Alias</span>
                  <span class="text-sm font-mono text-zinc-900 dark:text-white">{node.alias}</span>
                </div>
              {/if}
              {#if node.seq !== null && node.seq !== undefined}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Seq</span>
                  <span class="text-sm tabular-nums text-zinc-900 dark:text-white">{node.seq}</span>
                </div>
              {/if}
              {#if node.tags.length > 0}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Tags</span>
                  <div class="flex flex-wrap gap-1">
                    {#each node.tags as tag}
                      <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
                    {/each}
                  </div>
                </div>
              {/if}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Runnable</span>
                {#if node.isRunnable}
                  <span class="text-sm text-green-600 dark:text-green-400">Yes</span>
                {:else}
                  <span class="text-sm text-zinc-900 dark:text-white">No</span>
                {/if}
              </div>
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Created</span>
                <span class="text-sm text-zinc-900 dark:text-white">{new Date(node.createdAt).toLocaleDateString()}</span>
              </div>
              {#if node.updatedAt}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Updated</span>
                  <span class="text-sm text-zinc-900 dark:text-white">{new Date(node.updatedAt).toLocaleDateString()}</span>
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <!-- Data now has its own top-level tab (Rendered/Source + editing);
             the former read-only block here would just duplicate it. -->

        <!-- Danger zone -->
        <section class="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
          {#if !confirmDelete}
            <button onclick={() => confirmDelete = true} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
              Delete node
            </button>
          {:else}
            <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
              <span class="text-sm text-red-500">Delete "{node.name}"? This cannot be undone.</span>
              <button type="submit" class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500">Yes, delete</button>
              <button type="button" onclick={() => confirmDelete = false} class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
            </form>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>
