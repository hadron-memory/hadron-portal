<script lang="ts">
  import TabRow from '$lib/components/TabRow.svelte';
  import RefreshNodeLoc from './RefreshNodeLoc.svelte';
  import { locOfSameMemoryTarget } from '$lib/urn/move-destination';
  import { Expand } from 'lucide-svelte';
  import MoveLocationInput from '$lib/components/MoveLocationInput.svelte';
  import CappedNotice from '$lib/components/CappedNotice.svelte';
  import { formatPortalDate, formatPortalDateTime } from '$lib/format-portal-date';
  import { deleteNodeStrings } from '$lib/i18n/delete-node-strings';
  import { invalidateAll, goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { canonicalJson, parseDataSource, parsePropertiesSource, sameProperties, PROPERTIES_MAX, PROPERTIES_MAX_DEPTH } from '$lib/properties-source';
  import { displayJson, JsonDraft, SIGNED_OUT, submitJsonDraft, syncDraftWith } from '$lib/json-draft.svelte';
  import { deserialize, enhance } from '$app/forms';
  import { signinRedirectLocation } from '$lib/forms/signin-redirect';
  import { submitTextDraft, syncTextDraftWith, TextDraft } from '$lib/text-draft.svelte';
  import { abstractPlaceholder, abstractSearchHint } from '$lib/abstract-search-hint';
  import { onMount, tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import ListPageNav from '$lib/components/ListPageNav.svelte';
  import type { ListPageNavigation } from '$lib/list-page';
  import Urn from '$lib/components/Urn.svelte';
  import NodeEmbeddingBadges from '$lib/components/NodeEmbeddingBadges.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import NodeList from '$lib/components/NodeList.svelte';
  import ChatThread from '$lib/components/ChatThread.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import { scheduleTypeahead, targetUrnOptions, type TypeaheadNode } from '$lib/memory/node-typeahead';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { isOwnershipChainUrn, moveHintGrammar } from '$lib/urn/move-hint-grammar';
  import { cleanLocInput } from '$lib/urn/clean-loc-input';
  import RevisionLabelDialog from '$lib/components/RevisionLabelDialog.svelte';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import NodeSkillExport from '$lib/components/NodeSkillExport.svelte';
  import NodeRoleValue from '$lib/components/NodeRoleValue.svelte';
  import NodeProvenanceRows from '$lib/components/NodeProvenanceRows.svelte';
  import NodeAuthorshipText from '$lib/components/NodeAuthorshipText.svelte';
  import RevisionEditedBy from '$lib/components/RevisionEditedBy.svelte';
  import { revisionEditorView } from '$lib/revision-editor';
  import NodeValidationBadge from '$lib/components/NodeValidationBadge.svelte';
  import NodeApprovalBadge from '$lib/components/NodeApprovalBadge.svelte';
  import ApproveRevisionButton from '$lib/components/ApproveRevisionButton.svelte';
  import NodeMintLabel from '$lib/components/NodeMintLabel.svelte';
  import NodeDiscussion from '$lib/components/NodeDiscussion.svelte';
  import { COMMENT_NODE_TYPE, discussionCount, isCommentableClass, openFeedbackCue, type CommentSummary, type Discussion } from '$lib/comments';
  import { mintView, type NodeMintStatus } from '$lib/node-mint';
  import { approvalView, type NodeApprovalStatus, type NodeIntegrityCheck } from '$lib/node-approval';
  import { signaturesView, type NodeSignatureStatus } from '$lib/node-signatures';
  import NodeSignatures from '$lib/components/NodeSignatures.svelte';
  import {
    authorshipSearchText,
    authorshipView,
    provenanceById,
    validationText,
    validationView,
    type NodeProvenance,
    type ProvenanceResult,
  } from '$lib/node-provenance';
  import NodeRoleInput from '$lib/components/NodeRoleInput.svelte';
  import { metaSavedDespiteFailure, nodeMetaBaseline, nodeMetaReseed, nodeMetaSeed, nodeMetaSeedKey, savedButNotMoved } from '$lib/node-meta-seed';
  import { bestEffortInvalidateAll } from '$lib/best-effort-invalidate-all';
  import { skillExportMenuHosts } from '$lib/skill-export';
  import NodeAssetCard from '$lib/components/assets/NodeAssetCard.svelte';
  import { canUploadToMemory } from '$lib/assets/can-upload';
  import AttachAssetDialog from '$lib/components/assets/AttachAssetDialog.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import { createNodeMarkdownRenderer, renderNodeMarkdown } from '$lib/markdown/node-renderer';
  import { viewDocumentMenuAction } from '$lib/spec-document/spec-document';
  import { t } from '$lib/i18n/t';
  import { NODE_TYPES, isCanonicalNodeType } from '$lib/node-types';
  import { declaredObjectType, readMemorySchema } from '$lib/schema/memory-schema';
  import {
    EXTRACTION_SHAPES,
    extractionFieldError,
    extractionRowsError,
    outputFromNodeData,
    rowsFromNodeData,
    rowsToSpec,
    type ExtractionRow,
  } from '$lib/flow/extraction';
  import { fillViewport } from '$lib/fill-viewport';
  import type { MemoryNode, NodeEdge, NodeEdgeRemoval, NodeRevision } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  import NodeStorageForm from './NodeStorageForm.svelte';
  import CompiledPromptSources from '$lib/components/CompiledPromptSources.svelte';
  import { compiledPromptOwner } from '$lib/compiled-prompt-owner';
  import { readMoreChildren } from './children-page';
  import {
    isFullyQualifiedNodeUrnInput,
    nodeApproveSchema,
    nodeConvertToTaskSchema,
    nodeCreateParentSchema,
    nodeDeleteSchema,
    nodeDuplicateSchema,
    nodeMoveSchema,
    nodeTestFlowSchema,
    nodeUpdateEdgesSchema,
    nodeUpdateFlowSchema,
    nodeUpdateMetaSchema,
    nodeVerifySchema,
  } from './schema';

  type NodeMoveForm = Infer<typeof nodeMoveSchema, 'zod4'>;
  type NodeTestFlowForm = Infer<typeof nodeTestFlowSchema, 'zod4'>;
  type NodeDeleteForm = Infer<typeof nodeDeleteSchema, 'zod4'>;
  type NodeCreateParentForm = Infer<typeof nodeCreateParentSchema, 'zod4'>;
  type NodeUpdateMetaForm = Infer<typeof nodeUpdateMetaSchema, 'zod4'>;
  type NodeDuplicateForm = Infer<typeof nodeDuplicateSchema, 'zod4'>;
  type NodeConvertToTaskForm = Infer<typeof nodeConvertToTaskSchema, 'zod4'>;
  type NodeUpdateFlowForm = Infer<typeof nodeUpdateFlowSchema, 'zod4'>;
  type NodeUpdateEdgesForm = Infer<typeof nodeUpdateEdgesSchema, 'zod4'>;
  type NodeMoveSuperform = SuperValidated<NodeMoveForm, App.Superforms.Message, NodeMoveForm>;
  type NodeTestFlowSuperform = SuperValidated<NodeTestFlowForm, App.Superforms.Message, NodeTestFlowForm>;
  type NodeDeleteSuperform = SuperValidated<NodeDeleteForm, App.Superforms.Message, NodeDeleteForm>;
  type NodeCreateParentSuperform = SuperValidated<NodeCreateParentForm, App.Superforms.Message, NodeCreateParentForm>;
  type NodeUpdateMetaSuperform = SuperValidated<NodeUpdateMetaForm, App.Superforms.Message, NodeUpdateMetaForm>;
  type NodeDuplicateSuperform = SuperValidated<NodeDuplicateForm, App.Superforms.Message, NodeDuplicateForm>;
  type NodeConvertToTaskSuperform = SuperValidated<NodeConvertToTaskForm, App.Superforms.Message, NodeConvertToTaskForm>;
  type NodeUpdateFlowSuperform = SuperValidated<NodeUpdateFlowForm, App.Superforms.Message, NodeUpdateFlowForm>;
  type NodeApproveForm = Infer<typeof nodeApproveSchema, 'zod4'>;
  type NodeVerifyForm = Infer<typeof nodeVerifySchema, 'zod4'>;
  type NodeApproveSuperform = SuperValidated<NodeApproveForm, App.Superforms.Message, NodeApproveForm>;
  type NodeVerifySuperform = SuperValidated<NodeVerifyForm, App.Superforms.Message, NodeVerifyForm>;
  type NodeUpdateEdgesSuperform = SuperValidated<NodeUpdateEdgesForm, App.Superforms.Message, NodeUpdateEdgesForm>;

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
  // portal#1899: a compiled boot prompt is written only by a compile (hrn:node:hadronmemory.com:specs:cor:agt:040:11, :12);
  // a save is always refused, so its text and abstract are shown read-only with a pointer to the source.
  const isCompiledPrompt = $derived(node.nodeType === 'compiled-boot-prompt');
  const readOnly = $derived(data.canWriteMemory === false);
  // portal#1901: a compiled node has no write door at all on this page (content, abstract, name/meta, data,
  // properties, storage, flow, edges, move, restore, node delete). Approve, verify, signatures, duplicate and the
  // reads stay, and so do delete-revision and clear-history: deleting history is not writing compiled text
  // (hrn:node:hadronmemory.com:specs:cor:dmo:150:07), so those keep `readOnly`. The predicate is the node type, never the shared `boot-prompt` role.
  const writeLocked = $derived(readOnly || isCompiledPrompt);
  let isEditing = $state(false);
  // #1989: a Save whose edits committed but whose move was refused. The page
  // holds the refusal and the loc the user typed, because the reload after it
  // drops the action result and reseeds the form from the node (old loc, no
  // error); left to superForm, the refusal vanished and the draft reverted.
  // #1989: Save's move refusal, held by the page because the reload after a committed Save drops the
  // action `form` the alert would otherwise read.
  /** portal#2020: the last updateMeta result was a confirmed, complete success. */
  let savedCompletely = false;
  let moveRefusal = $state<{ text: string; loc: string } | null>(null);
  // portal#2014: a Save whose request died (an `error` result) was not confirmed.
  // The page holds its own text: a custom superforms onError sets no message.
  let metaUnconfirmed = $state(false);
  // #2048: custom onError already owns this request's feedback. Superforms
  // also applies the error to page.form; retain its identity after Cancel so
  // that duplicate raw banner cannot outlive the form's helpful notice.
  // Compare the error instance, never its text: other actions still own theirs.
  let handledMetaError = $state.raw<unknown>(null);
  const pageActionError = $derived(form?.error === handledMetaError ? null : form?.error);

  // Inline editing. #927: each text editor is a draft based on the revision it
  // opened on, and its save is refused when the node changed since. The drafts
  // outlive a reload (another tab's save calls invalidateAll()), so an unsaved
  // edit is never silently replaced — see text-draft.svelte.ts.
  const contentDraft = new TextDraft();
  // portal#1175: a comment is saved through editComment, whose precondition is
  // the comment's own write counter (`asComment.revSeq`), not Node.revision, so
  // that is the revision its draft opens on and posts back.
  const contentRevision = () => (node.nodeType === COMMENT_NODE_TYPE ? (node.asComment?.revSeq ?? null) : node.revision);
  syncTextDraftWith(contentDraft, () => ({ id: node.id, value: node.content, revision: contentRevision() }));
  $effect(() => {
    if (showSource) untrack(() => contentDraft.ensureSeeded());
  });
  let saving = $state(false);
  let contentSaveError = $state<string | null>(null);
  // A save refused as a conflict: the draft stays, with ways out (#927).
  let contentConflict = $state(false);
  let contentSaveSeq = 0;

  /**
   * The words for a refused Content or Abstract save. `changed` is the #927
   * conflict, split by whether THIS field is what changed: a conflict over
   * another field (tags, data, the other text) reloads to a draft that can
   * simply be saved again.
   */
  // #974: the session expired while editing. Say so, and say the draft is kept:
  // following the sign-in redirect would have navigated away and lost it.
  function signedOutSaveText(): string {
    return t(
      'node.save.signed-out',
      'Your session has expired, so this was not saved. Your edit is still here: copy it or keep this tab open, sign in again in a new tab, then save again.',
    );
  }

  function textSaveErrorText(code: string, detail: string | null, fieldChanged: boolean): string {
    switch (code) {
      case SIGNED_OUT:
        return signedOutSaveText();
      case 'changed':
        // Only the reload can say THIS text moved; the conflict itself is not
        // necessarily a revision mismatch (a concurrent move answers the same).
        return fieldChanged
          ? t(
              'node.text.save.changed',
              'This text changed since you opened the editor, so your edit was not saved. It is still here: copy it, then load the newer version and apply your edit again.',
            )
          : t(
              'node.text.save.conflict',
              'Your edit was not saved: the server reported a conflicting change{detail}. This text is unchanged and your edit is still here, so you can save again.',
              { detail: detail ? ` (${detail})` : '' },
            );
      case 'compiled-prompt':
        return t('node.text.save.compiled-prompt', 'A compiled boot prompt is never edited directly. Edit the boot source and compile again. Nothing was saved.');
      case 'boot-prompt-governed':
        return t('node.text.save.boot-prompt-governed', 'A worker session cannot edit a boot prompt; its manager does that. Nothing was saved.');
      case 'no-baseline':
        return t('node.text.save.no-baseline', 'This editor lost track of the version it opened. Copy your edit and reload the page.');
      case 'not-found':
        // Missing and unreadable answer the same (hrn:node:hadronmemory.com:specs:cor:api:140:03).
        return t('node.text.save.not-found', 'This node isn’t available to you any more. It may have been deleted, or your access changed.');
      default:
        return detail ?? t('node.text.save.failed', 'Your edit could not be saved.');
    }
  }

  /**
   * Reload after a COMMITTED save. Kept apart from the save itself: a failed
   * reload must not be reported as a failed save (@codex on #931).
   */
  async function refreshAfterSave(): Promise<boolean> {
    try {
      await invalidateAll();
      return true;
    } catch {
      return false;
    }
  }

  function savedNotRefreshedText(): string {
    return t(
      'node.text.save.saved-not-refreshed',
      'Your edit was saved, but the page could not reload. Reload the page before editing again.',
    );
  }

  async function saveContent() {
    if (saving || !contentDraft.dirty) return;
    // Captured before the first await, as saveProperties does: the node, its
    // ABSOLUTE action URL, the text and the revision it is based on.
    const originId = node.id;
    const seq = ++contentSaveSeq;
    const url = `${basePath}/nodes/${originId}?/updateContent`;
    const text = contentDraft.text;
    const expectedRevision = contentDraft.baseRevision;
    const stillOurs = () => seq === contentSaveSeq && node.id === originId;

    saving = true;
    contentSaveError = null;
    contentConflict = false;
    try {
      const result = await submitTextDraft({ url, field: 'content', text, expectedRevision });
      if (!stillOurs()) return;
      if (result.ok) {
        if (!(await refreshAfterSave())) {
          // Committed, but the reload failed (@codex on #931): say so, and
          // keep the saved text with NO base revision, so a further save is
          // refused as "reload first" rather than conflicting with itself.
          if (!stillOurs()) return;
          contentDraft.reseed({ id: node.id, value: text, revision: null });
          contentDraft.ensureSeeded();
          contentSaveError = savedNotRefreshedText();
          return;
        }
        if (!stillOurs()) return;
        contentDraft.reseed({ id: node.id, value: node.content, revision: contentRevision() });
        showSource = false;
        if (stillOurs()) void restoreSaveFocus(() => contentSourceToggle, stillOurs);
      } else if (result.code === 'changed') {
        // Load the newer version under the kept draft: Rendered now shows it,
        // and the draft learns whether it was THIS field that moved.
        await invalidateAll();
        if (!stillOurs()) return;
        const fieldChanged = contentDraft.isBehind(node.content);
        contentConflict = fieldChanged;
        contentSaveError = textSaveErrorText('changed', result.detail, fieldChanged);
      } else {
        contentSaveError = textSaveErrorText(result.code, result.detail, true);
      }
    } catch {
      if (stillOurs()) contentSaveError = textSaveErrorText('failed', null, true);
    } finally {
      if (seq === contentSaveSeq) {
        saving = false;
        if (showSource && stillOurs()) void restoreSaveFocus(() => contentSaveButton, stillOurs);
      }
    }
  }

  let copiedDraft = $state<'content' | 'abstract' | null>(null);
  // A failed copy is SAID, unlike the other copy buttons' silent no-op: the
  // next click here is likely "Discard", and it must not follow a copy that
  // never happened (@copilot on #931).
  let copyDraftFailed = $state<'content' | 'abstract' | null>(null);
  async function copyDraft(which: 'content' | 'abstract') {
    copyDraftFailed = null;
    try {
      await navigator.clipboard.writeText(which === 'content' ? contentDraft.text : abstractDraft.text);
    } catch {
      copyDraftFailed = which;
      return;
    }
    copiedDraft = which;
    setTimeout(() => {
      if (copiedDraft === which) copiedDraft = null;
    }, 2000);
  }

  /** The one way a conflicted draft is thrown away: the user asks for it. */
  function discardContentDraft() {
    contentDraft.reseed({ id: node.id, value: node.content, revision: contentRevision() });
    contentDraft.ensureSeeded();
    contentConflict = false;
    contentSaveError = null;
    copyDraftFailed = null;
  }

  // Abstract — paragraph-length summary; a vector-index source only where the
  // memory's embeddingSource says so (spec 031/033, #936). Edited inline here
  // exactly like content. The Abstract tab is ALWAYS shown: an empty abstract
  // still needs an authoring surface, or an abstract-sourced index has no
  // portal path to its input. (The Content tab is now always shown for the
  // same reason — issue #256.)
  const ABSTRACT_MAX = 2000;
  let showAbstractSource = $state(false);
  // #878: the rows under the Source editors, measured so each editor can fill
  // the viewport without pushing its Save button off-screen.
  let contentSaveRow = $state<HTMLElement | null>(null);
  let abstractSaveRow = $state<HTMLElement | null>(null);
  // #1446: a successful save closes its editor, which unmounts the focused Save
  // button and would drop focus to <body>. The Source toggle stays mounted and
  // is the control that reopens the editor, so focus moves there.
  let contentSourceToggle = $state<HTMLButtonElement | null>(null);
  let abstractSourceToggle = $state<HTMLButtonElement | null>(null);
  let contentSaveButton = $state<HTMLButtonElement | null>(null);
  let abstractSaveButton = $state<HTMLButtonElement | null>(null);
  // Where focus goes once a save settles, on success (the Source toggle) and on
  // refusal (Save). Save is disabled while a save is in flight, and a browser
  // blurs a focused control the moment it is disabled, so focus is on <body>
  // when the save settles unless the user has moved it (QA on #1563). Take it
  // only from <body>; never from a control the user chose.
  async function restoreSaveFocus(button: () => HTMLButtonElement | null, stillOurs: () => boolean) {
    await tick();
    // The render this awaits can be a navigation to another node; the save that
    // started here must not move focus in that node's editor.
    if (!stillOurs()) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    button()?.focus();
  }
  // #936: what the abstract does for THIS memory's search, if anything.
  const abstractHint = $derived(abstractSearchHint(data.graph));
  let copiedAbstract = $state(false);
  const abstractDraft = new TextDraft();
  syncTextDraftWith(abstractDraft, () => ({ id: node.id, value: node.abstract, revision: node.revision }));
  $effect(() => {
    if (showAbstractSource) untrack(() => abstractDraft.ensureSeeded());
  });
  let savingAbstract = $state(false);
  let abstractSaveError = $state<string | null>(null);
  let abstractConflict = $state(false);
  let abstractSaveSeq = 0;

  // The same save as saveContent, for the abstract (#927).
  async function saveAbstract() {
    if (savingAbstract || !abstractDraft.dirty) return;
    const originId = node.id;
    const seq = ++abstractSaveSeq;
    const url = `${basePath}/nodes/${originId}?/updateAbstract`;
    const text = abstractDraft.text;
    const expectedRevision = abstractDraft.baseRevision;
    const stillOurs = () => seq === abstractSaveSeq && node.id === originId;

    savingAbstract = true;
    abstractSaveError = null;
    abstractConflict = false;
    try {
      const result = await submitTextDraft({ url, field: 'abstract', text, expectedRevision });
      if (!stillOurs()) return;
      if (result.ok) {
        if (!(await refreshAfterSave())) {
          // Committed, but the reload failed (@codex on #931): say so, and
          // keep the saved text with NO base revision, so a further save is
          // refused as "reload first" rather than conflicting with itself.
          if (!stillOurs()) return;
          abstractDraft.reseed({ id: node.id, value: text, revision: null });
          abstractDraft.ensureSeeded();
          abstractSaveError = savedNotRefreshedText();
          return;
        }
        if (!stillOurs()) return;
        abstractDraft.reseed({ id: node.id, value: node.abstract, revision: node.revision });
        showAbstractSource = false;
        if (stillOurs()) void restoreSaveFocus(() => abstractSourceToggle, stillOurs);
      } else if (result.code === 'changed') {
        await invalidateAll();
        if (!stillOurs()) return;
        const fieldChanged = abstractDraft.isBehind(node.abstract);
        abstractConflict = fieldChanged;
        abstractSaveError = textSaveErrorText('changed', result.detail, fieldChanged);
      } else {
        abstractSaveError = textSaveErrorText(result.code, result.detail, true);
      }
    } catch {
      if (stillOurs()) abstractSaveError = textSaveErrorText('failed', null, true);
    } finally {
      if (seq === abstractSaveSeq) {
        savingAbstract = false;
        if (showAbstractSource && stillOurs()) void restoreSaveFocus(() => abstractSaveButton, stillOurs);
      }
    }
  }

  function discardAbstractDraft() {
    abstractDraft.reseed({ id: node.id, value: node.abstract, revision: node.revision });
    abstractDraft.ensureSeeded();
    abstractConflict = false;
    abstractSaveError = null;
    copyDraftFailed = null;
  }

  // Markdown rendering
  let renderedHtml = $state('');
  let markedReady = $state(false);
  let MarkedClass: typeof import('marked').Marked | null = null;

  onMount(async () => {
    MarkedClass = (await import('marked')).Marked;
    markedReady = true;
  });

  // #374 — `[[loc]]` wikilink resolutions, keyed by the authored target. The
  // loader resolves them (bare locs against this memory, per spec
  // hrn:node:hadronmemory.com:specs:cor:urn:020:01); a target that is absent or null renders as a visibly
  // broken reference rather than inert prose.
  const wikilinks = $derived(data.wikilinks ?? {});
  const wikilinkStrings = {
    unresolvedTitle: t(
      'node-detail.wikilink.unresolved',
      'Unresolved reference: no node at {target}',
    ),
  };

  // Shared renderer for both content and abstract. The Marked instance is
  // rebuilt whenever the resolution map changes (a save can add or fix a
  // wikilink) — the extension closes over that map. Portal Invariant P4:
  // markdown → HTML → DOMPurify before insertion, including authored HTML.
  const markedInstance = $derived.by(() => {
    // `markedReady` is the reactive half of the dynamic import — MarkedClass
    // is a plain binding, so reading it alone would memoize this at null.
    if (!markedReady || !MarkedClass) return null;
    return createNodeMarkdownRenderer(MarkedClass, wikilinks, wikilinkStrings);
  });

  function renderMarkdown(src: string): string {
    if (!markedInstance) return '';
    return renderNodeMarkdown(markedInstance, src);
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
    renderedHtml = markedInstance && contentBody ? renderMarkdown(contentBody) : '';
  });

  $effect(() => {
    renderedAbstractHtml = markedInstance && node.abstract ? renderMarkdown(node.abstract) : '';
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
  // Source view that edits the raw JSON with a live syntax check. The 256 KB
  // soft cap (PROPERTIES_MAX, in UTF-8 bytes) is shared with the Properties
  // editor and mirrored server-side in updateData.
  //
  // #894: the Data Source view now uses the same draft, validator and
  // node-bound save as the Properties Source view (#886) — the size cap in
  // UTF-8 bytes, exact numbers, duplicate keys, a draft that survives
  // unrelated reloads, a stale-page guard, and every refusal SHOWN, where the
  // old save sent each one to console.error and looked like nothing happened.
  let showDataSource = $state(false);
  let copiedData = $state(false);
  let savingData = $state(false);
  let dataSaveError = $state<string | null>(null);
  let dataSaveSeq = 0;

  // An absent value opens on nothing: `Node.data` may be any JSON value, so
  // there is no neutral default to offer the way `{}` is for properties.
  // Absent data and `{}` are DIFFERENT states (@codex on #896).
  const dataDraft = new JsonDraft('', { nullIsEmpty: false });
  syncDraftWith(dataDraft, () => ({ id: node.id, value: node.data }));
  $effect(() => {
    if (showDataSource) untrack(() => dataDraft.ensureSeeded());
  });

  const dataParse = $derived(parseDataSource(dataDraft.text));
  const dataEmpty = $derived(dataDraft.text.trim() === '');
  // Compared by VALUE (key order aside), not by text — and without the
  // null ≡ {} leniency of the stale check: saving `{}` over no data is a real
  // change, not a no-op.
  const dataDirty = $derived(
    dataParse.ok ? canonicalJson(dataParse.value) !== canonicalJson(node.data ?? null) : !dataEmpty,
  );
  // The saved value as text — what Rendered shows and Copy copies there. Via
  // the safe serializer: null when a pathologically nested stored value cannot
  // be serialized at all, which must not throw while RENDERING the tab
  // (@copilot on #896).
  const dataString = $derived(node.data != null ? displayJson(node.data) : '');
  const dataUnavailable = $derived(node.data != null && dataString === null);

  function dataSourceErrorText(code: string, detail?: string | null): string {
    switch (code) {
      case SIGNED_OUT:
        return signedOutSaveText();
      case 'empty':
        return t('node.data.source.empty', 'Enter a JSON value to save.');
      case 'top-level-null':
        return t('node.data.source.top-level-null', 'Top-level null is not allowed — enter an object, array, or value.');
      case 'failed':
      case 'rejected':
      case 'no-door':
      case 'no-baseline':
        // The save itself failed: the server's words when it gave some, and a
        // fallback that names the RIGHT field — delegating these reported "the
        // properties could not be saved" on the Data tab (@codex, @copilot on
        // #896).
        return detail ?? t('node.data.source.failed', 'The data could not be saved.');
      case 'changed':
        return t(
          'node.data.source.changed',
          'This data was changed since you opened the editor. Copy your edit, reload, and apply it again — saving now would undo that change.',
        );
      default:
        // The validation checks are shared with the Properties editor, and so
        // are their words — none of them names the field.
        return propertiesSourceErrorText(code, detail);
    }
  }

  // The JSON the Rendered view shows: the saved data, or — when the node has
  // no saved data yet — a live preview of a valid, dirty edit, so toggling to
  // Rendered mid-add doesn't make the typed JSON look lost. Returns null when
  // there's nothing to show (→ the empty-state CTA).
  const renderedJson = $derived.by(() => {
    if (node.data != null) return dataString; // null when unavailable
    if (!dataParse.ok) return null;
    try {
      return JSON.stringify(dataParse.value, null, 2);
    } catch {
      return null;
    }
  });

  async function saveData() {
    if (!dataParse.ok || !dataDirty || savingData) return;
    // Everything the save depends on is captured HERE, before the first await
    // (#894, as #893): the node, its ABSOLUTE action URL, the text and the
    // baseline. A relative URL resolved after navigation would write node A's
    // data to node B.
    const originId = node.id;
    const seq = ++dataSaveSeq;
    const url = `${basePath}/nodes/${originId}?/updateData`;
    const text = dataDraft.text;
    const baseline = dataDraft.baseline;
    const stillOurs = () => seq === dataSaveSeq && node.id === originId;

    savingData = true;
    dataSaveError = null;
    try {
      const result = await submitJsonDraft({ url, field: 'data', text, baseline });
      if (!stillOurs()) return;
      if (result.ok) {
        await invalidateAll();
        if (!stillOurs()) return;
        dataDraft.reseed({ id: node.id, value: node.data });
        showDataSource = false;
      } else {
        dataSaveError = dataSourceErrorText(result.code, result.detail);
      }
    } catch {
      if (stillOurs()) dataSaveError = dataSourceErrorText('failed');
    } finally {
      if (seq === dataSaveSeq) savingData = false;
    }
  }

  // Copies WHAT IS SHOWN: the draft in Source, the saved value in Rendered.
  async function copyData() {
    const text = showDataSource ? dataDraft.text : dataString;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
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
    outputWriteTo.trim() === '' || isFullyQualifiedNodeUrnInput(outputWriteTo),
  );
  const hasFlowConfig = $derived(
    rowsFromNodeData(node.data).length > 0 || outputFromNodeData(node.data) !== null,
  );
  // Same-memory nodes for the output-target datalist (any URN can still be
  // typed — flows may write to another memory in the org).
  // Fetched on demand as the user types (portal#1433): the layout carries no
  // node list (portal#1524). No hits is "no suggestions", never "no nodes".
  let outputTargetHits = $state<TypeaheadNode[]>([]);
  $effect(() =>
    scheduleTypeahead({
      query: outputWriteTo,
      memoryId: data.graph.id,
      selfId: node.id,
      skip: isFullyQualifiedNodeUrnInput,
      onHits: (hits) => (outputTargetHits = hits),
    }),
  );
  const outputTargetOptions = $derived(targetUrnOptions(outputTargetHits, data.graph.urn, composeNodeUrn));

  const initialFlowForm = untrack(() => submittedForm<NodeUpdateFlowForm>(form, 'updateFlow') as NodeUpdateFlowSuperform | null ?? data.flowForm);
  const {
    form: flowFormData,
    errors: flowErrors,
    message: flowMessage,
    submitting: flowSubmitting,
    enhance: flowEnhance,
  } = superForm<NodeUpdateFlowForm, App.Superforms.Message, NodeUpdateFlowForm>(initialFlowForm, {
    validators: zod4Client(nodeUpdateFlowSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  $effect(() => {
    const rowsJson = flowRowsJson;
    const writeToTrim = outputWriteTo.trim();
    const mode = outputMode;
    flowFormData.update((current) => ({
      ...current,
      extractionRows: rowsJson,
      outputWriteTo: writeToTrim,
      outputMode: mode,
    }), { taint: false });
  });

  // ── Test flow (#478 phase 3) ─────────────────────────────────────────
  // Runnable node + org member ⇒ offer minting a MANUAL headless run via
  // the testFlow action (runTask(urn, appRef:)), with an optional JSON
  // trigger payload the flow sees at message.data.<field>. On success the
  // action redirects to the run detail page.
  let testFlowOpen = $state(false);
  const testFlowApps = $derived(data.testFlowApps ?? []);
  const canTestFlow = $derived(!!node.isRunnable && testFlowApps.length > 0);

  const initialTestFlowForm = untrack(() => submittedForm<NodeTestFlowForm>(form, 'testFlow') as NodeTestFlowSuperform | null ?? data.testFlowForm);
  const {
    form: testFlowFormData,
    errors: testFlowErrors,
    message: testFlowMessage,
    submitting: testFlowSubmitting,
    enhance: testFlowEnhance,
  } = superForm<NodeTestFlowForm, App.Superforms.Message, NodeTestFlowForm>(initialTestFlowForm, {
    validators: zod4Client(nodeTestFlowSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialMoveForm = untrack(() => submittedForm<NodeMoveForm>(form, 'moveNode') as NodeMoveSuperform | null ?? data.moveForm);
  const {
    form: moveFormData,
    errors: moveErrors,
    message: moveMessage,
    submitting: moveSubmitting,
    enhance: moveEnhance,
  } = superForm<NodeMoveForm, App.Superforms.Message, NodeMoveForm>(initialMoveForm, {
    validators: zod4Client(nodeMoveSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onResult: ({ result }) => {
      if (result.type !== 'failure') moveOpen = false;
    },
  });

  const initialDeleteForm = untrack(() => submittedForm<NodeDeleteForm>(form, 'deleteNode') as NodeDeleteSuperform | null ?? data.deleteForm);
  const {
    form: deleteFormData,
    errors: deleteErrors,
    message: deleteMessage,
    submitting: deleteSubmitting,
    enhance: deleteEnhance,
  } = superForm<NodeDeleteForm, App.Superforms.Message, NodeDeleteForm>(initialDeleteForm, {
    validators: zod4Client(nodeDeleteSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialCreateParentForm = untrack(() => submittedForm<NodeCreateParentForm>(form, 'createParent') as NodeCreateParentSuperform | null ?? data.createParentForm);
  const {
    errors: createParentErrors,
    message: createParentMessage,
    enhance: createParentEnhance,
  } = superForm<NodeCreateParentForm, App.Superforms.Message, NodeCreateParentForm>(initialCreateParentForm, {
    validators: zod4Client(nodeCreateParentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialUpdateMetaForm = untrack(() => submittedForm<NodeUpdateMetaForm>(form, 'updateMeta') as NodeUpdateMetaSuperform | null ?? data.updateMetaForm);
  const {
    form: updateMetaFormData,
    errors: updateMetaErrors,
    message: updateMetaMessage,
    submitting: updateMetaSubmitting,
    enhance: updateMetaEnhance,
  } = superForm<NodeUpdateMetaForm, App.Superforms.Message, NodeUpdateMetaForm>(initialUpdateMetaForm, {
    validators: zod4Client(nodeUpdateMetaSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // portal#2023: opt this form out of Superforms' unconditional page-data
    // rebind, which reset an unsaved draft whenever an unrelated loader
    // refresh carried a changed node. 'never', NOT false: own ActionResults
    // still apply ('never' is truthy), and false leaves the data-path rebind
    // live. The reseeds are explicit: reseedFromSavedNode, the node-change
    // effect, Cancel. See
    // hrn:node:hadronmemory.com:hadron-portal:findings:stable-form-id-opts-into-invalidate-rebind
    applyAction: 'never',
    onSubmit: () => { moveRefusal = null; savedCompletely = false; metaUnconfirmed = false; },
    // portal#2014: superforms' default onError RETHROWS before it clears
    // `submitting`, which left Save disabled on "Saving..." for good, so the
    // retry the open editor exists for was impossible. Not rethrowing lets
    // superforms finish the submit and re-enable Save (the portal#1528
    // submitFailure pattern); the page shows its own text instead. See
    // hrn:node:hadronmemory.com:hadron-portal:findings:superforms-default-onerror-leaves-submitting-stuck.
    onError: ({ result }) => { metaUnconfirmed = true; handledMetaError = result.error; },
    // portal#2020: superforms awaits the reload, THEN resets the form to its
    // initial (pre-save) values, so the reseed must come after that reset: here.
    onUpdated: () => {
      if (!savedCompletely) return;
      savedCompletely = false;
      reseedFromSavedNode();
    },
    onResult: async ({ result }) => {
      // Only a CONFIRMED success closes the editor (portal#2014). A failure keeps
      // it open to fix the location; an `error` result (no action response
      // arrived, so the save wasn't confirmed) keeps it open too, or a dropped
      // request hides the typed edits on exactly the retry that matters. A
      // redirect navigates away and unmounts the page, so it needs no close.
      if (result.type === 'success') {
        isEditing = false;
        // portal#2020: only a confirmed complete success arms the reseed in onUpdated.
        savedCompletely = true;
        return;
      }
      savedCompletely = false;
      // Saved, but the move failed: keep the editor open to fix the location,
      // and reload the node so the page shows what was actually saved. The
      // reload depends only on the save having committed, not on finding a
      // refusal to keep (Glen's BLIND P2 on #2002).
      if (!metaSavedDespiteFailure(result)) return;
      // #1989: the refusal outlives that reload. The reload drops the action
      // `form` the alert reads, so the page holds the refusal text itself.
      moveRefusal = savedButNotMoved(result);
      // portal#1882: AWAIT the reload. Superforms awaits onResult before it
      // applies the result, so the failure (its message, the typed location)
      // lands after the reload. Unawaited, the reload finished later and
      // superforms rebound to the loader's fresh form, which erased both.
      // That is also what keeps the typed loc in the draft (#1989).
      // portal#1980: the reload is BEST-EFFORT — a rejecting invalidateAll()
      // must not trade this known partial-save failure for a generic error
      // (see bestEffortInvalidateAll for the rejection class and the
      // error-boundary limit). The page keeps the action failure.
      await bestEffortInvalidateAll('node-detail');
      // portal#2023: the edits ARE saved (only the move failed), so the next attempt is typed
      // against the node as it now is. Taken from the reloaded node, not from what was posted: the
      // server normalizes what it stores. Only a committed save reaches here (the return above).
      metaBaseline = nodeMetaBaseline(node);
    },
  });

  /** Drop every trace of a failed Save: the page-held refusal and the failure superforms applied after the
   *  awaited reload (portal#1882). Clearing only the first let Cancel then Edit show the old refusal again
   *  (Clark's browser QA F1 on #2002). */
  function clearMetaRefusal() {
    moveRefusal = null;
    metaUnconfirmed = false;
    updateMetaMessage.set(undefined);
    updateMetaErrors.set({});
  }

  // Reseed on a different node (everything) or a changed stored role on the
  // same node (role and its seed only): `nodeMetaReseed` decides, and the
  // field list is the loader's own (@codex on #929).
  // portal#2023: the node state the editor was typed against (every field Save writes). Sent with
  // every Save so the server can refuse a draft that is older than the node (see `updateMeta`).
  // A full-page refusal restores the kept draft from the action's form (initialUpdateMetaForm), so it
  // restores the baseline the draft was typed against too, which the action echoes as `metaBaseline`.
  let metaBaseline = $state(untrack(() => {
    const echoed = form && submittedForm<NodeUpdateMetaForm>(form, 'updateMeta')
      ? (form as { metaBaseline?: unknown }).metaBaseline : undefined;
    return typeof echoed === 'string' ? echoed : nodeMetaBaseline(node);
  }));
  let updateMetaSeededFrom = $state(untrack(() => ({ id: node.id, role: node.role ?? null })));
  $effect(() => {
    if (nodeMetaSeedKey(updateMetaSeededFrom) === nodeMetaSeedKey(node)) return;
    const patch = nodeMetaReseed(updateMetaSeededFrom, node);
    updateMetaSeededFrom = { id: node.id, role: node.role ?? null };
    if (patch) updateMetaFormData.update((current) => ({ ...current, ...patch }), { taint: false });
    if (patch && 'name' in patch) metaBaseline = nodeMetaBaseline(node);
  });

  // portal#2020: after a CONFIRMED, COMPLETE save the editor reopens from the
  // node the server returned (`hrn:node:hadronmemory.com:specs:cor:dmo:060:02`: the server normalizes what it
  // stores, so never the typed values). The effect above keys on id + role
  // alone, so a same-node name/loc/description save left the pre-save seed and
  // the next Save wrote the old values back. This one fires only while the
  // editor is CLOSED: a partial success (#929), a refusal (#1989) and an unsaved
  // draft all keep the editor open, so none of them is reseeded. The role pair
  // stays with `nodeMetaReseed` (#921).
  let updateMetaSavedSeed = $state(untrack(() => JSON.stringify(nodeMetaSeed(node))));
  function reseedFromSavedNode() {
    const seed = nodeMetaSeed(node);
    updateMetaSavedSeed = JSON.stringify(seed);
    metaBaseline = nodeMetaBaseline(node);
    updateMetaFormData.set({ ...get(updateMetaFormData), ...seed }, { taint: false });
  }
  $effect(() => {
    if (JSON.stringify(nodeMetaSeed(node)) === untrack(() => updateMetaSavedSeed)) return;
    if (untrack(() => isEditing)) return;
    untrack(reseedFromSavedNode);
  });

  const initialDuplicateForm = untrack(() => submittedForm<NodeDuplicateForm>(form, 'duplicateNode') as NodeDuplicateSuperform | null ?? data.duplicateForm);
  const {
    errors: duplicateErrors,
    message: duplicateMessage,
    enhance: duplicateEnhance,
  } = superForm<NodeDuplicateForm, App.Superforms.Message, NodeDuplicateForm>(initialDuplicateForm, {
    validators: zod4Client(nodeDuplicateSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialConvertToTaskForm = untrack(() => submittedForm<NodeConvertToTaskForm>(form, 'convertToTask') as NodeConvertToTaskSuperform | null ?? data.convertToTaskForm);
  const {
    errors: convertToTaskErrors,
    message: convertToTaskMessage,
    enhance: convertToTaskEnhance,
  } = superForm<NodeConvertToTaskForm, App.Superforms.Message, NodeConvertToTaskForm>(initialConvertToTaskForm, {
    validators: zod4Client(nodeConvertToTaskSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // #992: Approve and Verify. Both forms are `novalidate` and post the DOM's
  // FormData, so Approve sends the revision on screen from its hidden input;
  // the store is kept in step too, so client state never disagrees with it.
  const initialApproveForm = untrack(() => submittedForm<NodeApproveForm>(form, 'approveNode') as NodeApproveSuperform | null ?? data.approveForm);
  const {
    form: approveFormData,
    errors: approveErrors,
    message: approveMessage,
    submitting: approveSubmitting,
    enhance: approveEnhance,
  } = superForm<NodeApproveForm, App.Superforms.Message, NodeApproveForm>(initialApproveForm, {
    validators: zod4Client(nodeApproveSchema),
    clearOnSubmit: 'none',
  });
  $effect(() => {
    const revision = node.revision;
    if (revision != null && untrack(() => $approveFormData.revision) !== revision) {
      approveFormData.update((current) => ({ ...current, revision }), { taint: false });
    }
  });
  const initialVerifyForm = untrack(() => submittedForm<NodeVerifyForm>(form, 'verifyNode') as NodeVerifySuperform | null ?? data.verifyForm);
  const {
    errors: verifyErrors,
    message: verifyMessage,
    submitting: verifySubmitting,
    enhance: verifyEnhance,
  } = superForm<NodeVerifyForm, App.Superforms.Message, NodeVerifyForm>(initialVerifyForm, {
    validators: zod4Client(nodeVerifySchema),
    clearOnSubmit: 'none',
  });

  const testFlowPayloadValid = $derived.by(() => {
    const raw = $testFlowFormData.payload.trim();
    if (raw === '') return true;
    try {
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  });
  const testFlowActionError = $derived(scopedActionError<NodeTestFlowForm>(
    form,
    'testFlow',
    $testFlowMessage,
    $testFlowErrors,
    ['_kind', 'appId', 'orgId', 'agentRef', 'payload'],
  ));
  // The Agent picker shows only for an App with several installed Agents (#1444).
  const testFlowAgents = $derived(testFlowApps.find((a) => a.id === $testFlowFormData.appId)?.agents ?? null);
  const flowActionError = $derived(scopedActionError<NodeUpdateFlowForm>(
    form,
    'updateFlow',
    $flowMessage,
    $flowErrors,
    ['_kind', 'extractionRows', 'outputWriteTo', 'outputMode'],
  ));
  const flowActionSuccess = $derived(scopedActionSuccess<NodeUpdateFlowForm>(
    form,
    'updateFlow',
    $flowMessage,
  ));
  // The hint's one job is to agree with what is IN THE FIELD. #779 and three
  // rounds of review on PR #803 were all the same invariant broken in different
  // places, so it is stated once here rather than per-case.
  //
  // Derived from `$moveFormData.target`, NOT from `fullUrn`: the memory picker
  // (#512) rewrites the target into a different memory, which may use a
  // different grammar from the one this node came from. A node-derived hint
  // therefore describes the source while the input holds the destination, and
  // moving into or out of a chain-owned memory inverts the mismatch. Reading
  // the live value leaves no second piece of state to keep in step — the hint
  // follows the prefill, the picker and typing alike.
  //
  // The decision itself lives in $lib/urn/move-hint-grammar so it is testable —
  // a `$derived` in a .svelte file is unreachable from this repo's SSR-only
  // harness (#795), and this is not a cosmetic choice: recommending the wrong
  // grammar either earns a refusal (v1 shown for a v2 value, which `parseUrnV2`
  // rejects) or, in the dangerous direction, invites flattening an ownership
  // chain — which does not fail, it addresses a different node.
  const moveUrnIsOwnershipChain = $derived(isOwnershipChainUrn($moveFormData.target));
  const moveHintGrammarText = $derived(moveHintGrammar($moveFormData.target));

  // #780: `target` is deliberately NOT in the fallback list, and it is the only
  // form on this page for which that is true.
  //
  // The fallbacks exist to promote a field error into the form-level alert for
  // forms that render no per-field error — every other dialog here. The move
  // dialog is the exception: it renders `$moveErrors.target` inline under the
  // input (the only inline field-error render in the file), so listing `target`
  // here printed the same sentence twice, once under the input and once above
  // the buttons.
  //
  // The server already decides which surface a failure belongs to — `setError`
  // on `target` for the user-fixable codes (NODE_ALREADY_EXISTS, CONFLICT,
  // BAD_USER_INPUT) and a form-level `message` for everything else — so the two
  // surfaces are already mutually exclusive at the source. The duplication was
  // purely this list re-merging them.
  const moveActionError = $derived(scopedActionError<NodeMoveForm>(
    form,
    'moveNode',
    $moveMessage,
    $moveErrors,
    ['_kind'],
  ));
  const deleteActionError = $derived(scopedActionError<NodeDeleteForm>(
    form,
    'deleteNode',
    $deleteMessage,
    $deleteErrors,
  ));
  // #621: a NODE_HAS_DESCENDANTS refusal carries the server's descendant
  // count on the action result. It gates the "also delete descendants"
  // checkbox in both delete surfaces — server-authoritative, so a stale or
  // undercounted graph payload can never hide the subtree choice.
  const deleteRefusedDescendants = $derived(
    typeof form?.deleteRefusedDescendants === 'number' ? form.deleteRefusedDescendants : 0,
  );
  const createParentActionError = $derived(scopedActionError<NodeCreateParentForm>(
    form,
    'createParent',
    $createParentMessage,
    $createParentErrors,
    ['_kind', 'loc', 'name'],
  ));
  const updateMetaActionError = $derived(scopedActionError<NodeUpdateMetaForm>(
    form,
    'updateMeta',
    $updateMetaMessage,
    $updateMetaErrors,
    ['_kind', 'name', 'loc', 'nodeType', 'description', 'alias', 'seq', 'tags', 'isRunnable'],
  ));
  const updateMetaActionSuccess = $derived(scopedActionSuccess<NodeUpdateMetaForm>(
    form,
    'updateMeta',
    $updateMetaMessage,
  ));
  const duplicateActionError = $derived(scopedActionError<NodeDuplicateForm>(
    form,
    'duplicateNode',
    $duplicateMessage,
    $duplicateErrors,
  ));
  const convertToTaskActionError = $derived(scopedActionError<NodeConvertToTaskForm>(
    form,
    'convertToTask',
    $convertToTaskMessage,
    $convertToTaskErrors,
  ));
  const approveActionError = $derived(scopedActionError<NodeApproveForm>(form, 'approveNode', $approveMessage, $approveErrors, ['_kind', 'revision']));
  const approveActionSuccess = $derived(scopedActionSuccess<NodeApproveForm>(form, 'approveNode', $approveMessage));
  const verifyActionError = $derived(scopedActionError<NodeVerifyForm>(form, 'verifyNode', $verifyMessage, $verifyErrors));
  const verifyActionSuccess = $derived(scopedActionSuccess<NodeVerifyForm>(form, 'verifyNode', $verifyMessage));
  // The verdict's hashes, only for the verify submit this page is showing.
  const verifyHashes = $derived.by(() => {
    if (!submittedForm<NodeVerifyForm>(form, 'verifyNode')) return null;
    const result = form as { verifyIntegrity?: Pick<NodeIntegrityCheck, 'expectedHash' | 'actualHash'> } | null;
    return result?.verifyIntegrity ?? null;
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
  // #512: the "Select target memory" picker inside the Move dialog. Picking a
  // memory rewrites the memory segment of the destination URN, keeping the loc.
  // Uses cleanLoc (not the raw node.loc) so a legacy prefixed loc doesn't
  // double-compose into hrn:node:<new>::hrn:node:<old>::… (PR #513 review, codex).
  let memoryPickerOpen = $state(false);
  function onPickTargetMemory(memory: { urn: string }) {
    if (cleanLoc) $moveFormData.target = composeNodeUrn(memory.urn, cleanLoc);
    // A pick can land in another memory, where the Location field no longer
    // describes the destination — show the full URN so nothing stale submits.
    moveFullUrn = locOfSameMemoryTarget(data.graph.urn ?? '', $moveFormData.target) === null;
  }
  // #1164: Location (loc in this node's own memory) is the default way to move;
  // the full-URN field is the cross-memory path. `target` stays the one value
  // that is submitted in both modes.
  let moveFullUrn = $state(false);
  let deleteOpen = $state(false);
  // #621: closing the delete confirmation drops the subtree consent — a
  // cancelled/reopened dialog (or a new target, or a jump to the Settings
  // surface) must not inherit a prior "also delete descendants" check.
  // Consent is per-dialog and explicit, never carried.
  function closeDeleteConfirm() {
    deleteOpen = false;
    $deleteFormData.recursive = false;
  }

  // ── portal#696: attach a file ────────────────────────────────────────────
  // Creates a `reference` child node pointing at an asset. Offered whenever the
  // memory is known: uploads may be refused (`acceptsUploads: false`), but
  // attaching a file ALREADY in the memory still works, so the action itself is
  // not gated on the upload flag — the dialog handles the split.
  //
  // This used to also name "a user-owned memory whose org-scoped storage key the
  // server can't build" as a second reason. hadron-server#895 removed it — the
  // storage key comes from the memory URN alone now, so a personal memory uploads
  // like any other. `acceptsUploads` is the ONLY gate; see $lib/assets/can-upload,
  // whose docblock explains why re-adding an org check would hide a working control.
  let attachOpen = $state(false);
  const memoryUrn = $derived(node.memory?.urn ?? data.graph?.urn ?? '');
  const canAttachAsset = $derived(!!memoryUrn && !!cleanLoc);

  // #725/#726. The server's predicates, read rather than re-derived, for the
  // same reason `isChat` is (see below): the mark and the action must not be
  // able to disagree with the load that resolved them. `openChat` is non-null
  // ONLY when the chat root resolved and is really a chat node, so one value is
  // both the gate for the menu item and its destination — the offer and the
  // link cannot drift apart. Declared here rather than beside `isChat` because
  // `menuActions` below is its first reader.
  const isChatMessage = $derived(!!data.isChatMessage);
  const openChat = $derived(data.openChat ?? null);
  // #489 part 4. Read from the load rather than derived from `node.memory.app`
  // for the same reason `isChat` and `openChat` are: the loader decides whether
  // this node is a chat, so the App reference and the chat mark cannot disagree.
  // Null both when the chat has no App and when the node is not a chat.
  const chatApp = $derived(data.chatApp ?? null);

  // #793: scroll-up pagination for the Chat tab. Same endpoint and the same
  // null-vs-empty contract as the full-screen view — the two must not drift,
  // since they are two windows onto one thread and a reader moves between them
  // with the full-screen entry (the "Full-screen chat" button on agent/other
  // chats, the icon-only expand control on a team Channel — portal#1525).
  let olderCursor = $state<number>(0);
  $effect(() => {
    const o = data.chatOffset ?? 0;
    untrack(() => { olderCursor = o; });
  });
  async function loadOlderChat() {
    const res = await fetch(`${basePath}/nodes/${node.id}/chat-older?before=${olderCursor}`);
    if (!res.ok) return null;
    const body = await res.json();
    if (body.loadFailed) return null;
    olderCursor = body.offset;
    return { messages: body.messages, hasOlder: body.hasOlder ?? false };
  }

  // #911: the hosts a single-skill download can be asked for; empty means the
  // menu has no "Export as skill" entry at all.
  const skillExportHosts = $derived(skillExportMenuHosts(node));

  const allMenuActions = $derived<NodeMenuAction[]>([
    // #726: first, because on a message it is the action a reader actually
    // came for — a single bubble is the one node whose surrounding thread is
    // the point. Offered only when `openChat` resolved, so it never appears
    // pointing nowhere.
    ...(openChat ? [{ id: 'open-chat', label: t('node-actions.open-chat', 'Open chat') }] : []),
    { id: 'edit', label: t('node-actions.edit', 'Edit') },
    // #1720: only a spec node (hrn:node:hadronmemory.com:specs:cor:acl:130:01: the role's base kind is `spec`).
    ...viewDocumentMenuAction(node.role),
    { id: 'download', label: t('node-actions.download', 'Download') },
    // #1073: opens the node's PDF render in a new tab for printing — the
    // browser's PDF viewer owns print, so this is the Download path with no
    // save-to-disk step.
    { id: 'print', label: t('node-actions.print', 'Print') },
    ...(skillExportHosts.length > 0 ? [{ id: 'export-skill', label: t('node-actions.export-skill', 'Export as skill') }] : []),
    { id: 'add-child', label: t('node-actions.add-child', 'Add child') },
    ...(canAttachAsset ? [{ id: 'attach-asset', label: t('node-actions.attach-asset', 'Attach file') }] : []),
    { id: 'move', label: t('node-actions.move', 'Move') },
    { id: 'duplicate', label: t('node-actions.duplicate', 'Duplicate') },
    // Only offered for plain nodes — a task node is already runnable.
    ...(!node.isRunnable ? [{ id: 'convert-to-task', label: t('node-actions.convert-to-task', 'Convert to task') }] : []),
    ...(canTestFlow ? [{ id: 'run', label: t('node-actions.run', 'Run') }] : []),
    { id: 'delete', label: t('node-actions.delete', 'Delete'), danger: true },
  ].filter((action) => !readOnly || ['open-chat', 'view-document', 'download', 'print', 'export-skill'].includes(action.id))
    .filter((action) => !isCompiledPrompt || !COMPILED_HIDDEN_ACTIONS.has(action.id)));
  const COMPILED_HIDDEN_ACTIONS = new Set(['edit', 'move', 'delete', 'convert-to-task']);

  // portal#1175: a comment is feedback, so the actions that treat it as a node to
  // grow, relocate, copy or promote are not offered; Edit only to its author.
  const COMMENT_HIDDEN_ACTIONS = new Set(['add-child', 'move', 'duplicate', 'convert-to-task']);
  const menuActions = $derived<NodeMenuAction[]>(allMenuActions.filter((a) =>
    !isComment || (!COMMENT_HIDDEN_ACTIONS.has(a.id) && (a.id !== 'edit' || canEditContent))));

  let duplicateForm = $state<HTMLFormElement | null>(null);
  let convertForm = $state<HTMLFormElement | null>(null);

  function onMenuSelect(id: string) {
    // Close any sibling panel so only one opens at a time.
    testFlowOpen = false; downloadOpen = false; moveOpen = false; closeDeleteConfirm();
    attachOpen = false; skillExportOpen = false;
    switch (id) {
      case 'attach-asset': attachOpen = true; break;
      case 'edit':
        if (isComment) {
          // portal#1175: a comment has no Settings tab; its text is what is edited.
          activeTab = 'content';
          showSource = true;
          break;
        }
        // Jump to the Settings tab and open its metadata form (#503).
        activeTab = 'settings';
        isEditing = true;
        break;
      case 'run':
        $testFlowFormData.orgId = data.org?.id ?? '';
        testFlowOpen = true;
        break;
      case 'duplicate': duplicateForm?.requestSubmit(); break;
      case 'convert-to-task': convertForm?.requestSubmit(); break;
      case 'move':
        $moveFormData.target = fullUrn;
        moveFullUrn = false;
        moveOpen = true;
        break;
      // #726: the chat root's node page, which opens on its Chat tab — the
      // thread in context, with this message in it. `openChat.nodeId` is a
      // resolved PK, so it needs no ?tab= to land right (a chat node's default
      // tab IS Chat).
      case 'open-chat': if (openChat) goto(`${basePath}/nodes/${openChat.nodeId}`); break;
      case 'add-child': goto(addChildHref); break;
      case 'download': downloadOpen = true; break;
      case 'view-document': goto(`${basePath}/nodes/${node.id}/document`); break;
      case 'print': void printNode(); break;
      case 'export-skill': skillExportOpen = true; break;
      case 'delete': $deleteFormData.hard = false; $deleteFormData.recursive = false; deleteOpen = true; break;
    }
  }

  // ── Download / export ───────────────────────────────────────────────
  // Server-rendered single-node export (#421 / hadron-server #386). The server's
  // `nodeExport` field owns the format — `full: true` is the canonical,
  // round-trippable file (byte-identical to `hadron node export`); `full: false`
  // renders a chosen set of presentation sections. We never re-implement the
  // codec here: POST to /api/nodes/export and serve the returned bytes as a file.
  let downloadOpen = $state(false);
  let skillExportOpen = $state(false);
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

  // POST to /api/nodes/export and return the served bytes as a Blob. The
  // Download dialog and Print (#1073) share this path, so the response guards
  // live in one place. Only Print passes a signal — its request is
  // cancellable, so an abandoned export doesn't hang (#1193).
  async function fetchNodeExport(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; filename?: string }> {
    const res = await fetch('/api/nodes/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
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
    return { blob: new Blob([part], { type: r.mimeType || 'application/octet-stream' }), filename: r.filename };
  }

  async function runDownload() {
    if (!dlCanDownload || dlBusy) return;
    dlBusy = true;
    dlError = null;
    try {
      const { blob, filename } = await fetchNodeExport({
        id: node.id,
        format: dlFormat,
        // PDF is a presentation render; scope/sections don't apply.
        full: dlFormat === 'PDF' ? true : dlFull,
        ...(dlFormat === 'PDF' || dlFull ? {} : { sections: dlSelectedSections }),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `export.${dlFormat.toLowerCase()}`;
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

  // Print (#1073): fetch the node's PDF render and open it in a new tab —
  // the browser's PDF viewer owns the print dialog, so this is the export
  // path with no save-to-disk step. Repeated prints hold at most one object
  // URL: the previous one is revoked when a new PDF opens, and unmount and
  // node changes revoke the live one. The blank print window opens
  // synchronously, inside the click's user gesture — after the export await,
  // Safari/Firefox treat window.open as a popup — and its location is
  // assigned only once the PDF arrives. A popup the browser blocks says so
  // instead of failing silently.
  let printBusy = $state(false);
  let printError = $state<string | null>(null);
  let printUrl: string | null = null;
  // The in-flight print's request and blank window, owned until the PDF
  // lands (the window is then the user's tab) or the print is invalidated,
  // whichever comes first. Invalidation cancels the request and closes the
  // window immediately rather than when the request settles: a hanging
  // export must not hold its blank window open past a navigation or
  // unmount (#1193 READ P2 residual).
  let printAbort: AbortController | null = null;
  let printWindow: Window | null = null;
  // A print's generation: bumped by anything that invalidates it — teardown,
  // and a node change (SvelteKit reuses this component between nodes, so an
  // export for A must not open over B, and A's catch/finally must not write
  // B's state; #1193 READ P2s). A stale run closes its window, opens
  // nothing and writes nothing. The liveness check sits at the side effect,
  // per hrn:node:hadronmemory.com:hadron-portal:review:async-onmount-runs-after-teardown.
  let printGeneration = 0;
  function invalidatePrint() {
    printGeneration++;
    // Release the abandoned print's resources NOW: abort its request and
    // close its blank window. The stale run still lands in its catch /
    // finally when the abort rejects, but the generation guards there skip
    // every state write. Nothing waits for a hanging fetch to settle.
    printAbort?.abort();
    printAbort = null;
    printWindow?.close();
    printWindow = null;
    if (printUrl) URL.revokeObjectURL(printUrl);
    printUrl = null;
    // The stale run's finally no longer clears the flag, so release the
    // slot here — at most one live (uncancelled) export at a time.
    printBusy = false;
  }
  $effect(() => () => invalidatePrint());
  async function printNode() {
    if (printBusy) return;
    printBusy = true;
    printError = null;
    const run = printGeneration;
    const win = window.open('', '_blank');
    if (!win) {
      printError = t('node-actions.print.blocked', 'The print window was blocked. Allow popups for this site, then try again.');
      printBusy = false;
      return;
    }
    printWindow = win;
    const request = (printAbort = new AbortController());
    try {
      const { blob } = await fetchNodeExport({ id: node.id, format: 'PDF', full: true }, request.signal);
      if (run !== printGeneration) {
        // Already closed by the invalidation; a stale run mints no URL,
        // opens nothing and writes nothing.
        win.close();
        return;
      }
      if (blob.type !== 'application/pdf') {
        // Loud refusal, never a navigation to something that isn't the PDF.
        win.close();
        printWindow = null;
        printError = t('node-actions.print.not-pdf', 'The export did not return a PDF. Please try again.');
        return;
      }
      if (printUrl) URL.revokeObjectURL(printUrl);
      printUrl = URL.createObjectURL(blob);
      // The window stops being ours here: a later navigation revokes this
      // URL but never closes the tab the user is reading.
      printWindow = null;
      win.location.href = printUrl;
    } catch {
      // A cancelled run rejects into this arm: its window is already
      // closed, and the generation guard skips the state write.
      win.close();
      if (run === printGeneration) {
        printWindow = null;
        printError = t('node-actions.print.failed', 'Could not open the PDF. Please try again.');
      }
    } finally {
      if (run === printGeneration) printBusy = false;
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

  // ── Properties (#518, typed table #588) ─────────────────────────────────
  // Node.properties is structured key-value metadata — server-set provenance
  // (properties.url / .title from the write seam) or, with a memory schema
  // (#725), the node's typed record. The Source view below (#886) edits the
  // whole bag as JSON; the edit page's Structured storage section keeps the
  // typed-field editor, the object type and the skill-export checkbox.
  const hasProperties = $derived(node.properties != null);
  // Via the safe serializer (@copilot on #896): null when a pathologically
  // nested stored bag cannot be serialized, instead of a render-time throw.
  const propertiesString = $derived(hasProperties ? displayJson(node.properties) : '');
  const propertiesUnavailable = $derived(hasProperties && propertiesString === null);
  const highlightedProperties = $derived(propertiesString ? highlightJson(propertiesString) : []);
  // #588: when the node's objectType names a declared collection, render a
  // typed field table (declared fields first, then any extra keys).
  const nodeDeclaredCollection = $derived(
    declaredObjectType(readMemorySchema(data.graph.schema), node.objectType || null),
  );
  interface TypedPropertyRow {
    name: string;
    type: string;
    required: boolean;
    declared: boolean;
    value: unknown;
    present: boolean;
  }
  const typedPropertyRows = $derived.by((): TypedPropertyRow[] => {
    if (!nodeDeclaredCollection) return [];
    const props = (node.properties ?? {}) as Record<string, unknown>;
    const declared = Object.entries(nodeDeclaredCollection.fields).map(([name, field]) => ({
      name,
      type: field.type as string,
      required: field.required ?? false,
      declared: true,
      value: props[name],
      present: name in props,
    }));
    const extras = Object.keys(props)
      .filter((k) => !(k in nodeDeclaredCollection.fields))
      .map((name) => ({ name, type: '', required: false, declared: false, value: props[name], present: true }));
    return [...declared, ...extras];
  });
  // ── #886: Properties — Rendered | Source, like Content / Abstract / Data ──
  // Source edits the WHOLE bag as JSON on any node. On a typed node that is
  // the only way to edit a key the collection does not declare (`exports`
  // among them): the edit page's typed editor can only delete one.
  let showPropertiesSource = $state(false);
  let savingProperties = $state(false);
  let propertiesSaveError = $state<string | null>(null);

  // The draft and WHEN it re-seeds (see json-draft.svelte.ts): a new
  // node always, an unrelated reload never — saving Content/Abstract/Data
  // calls invalidateAll(), and that must not discard an unsaved Source edit
  // (@codex on #893).
  const propertiesDraft = new JsonDraft('{}');
  syncDraftWith(propertiesDraft, () => ({ id: node.id, value: node.properties }));
  // Seed (pretty-print + canonicalize) only when Source is actually opened —
  // never on page load (@codex on #893).
  $effect(() => {
    if (showPropertiesSource) untrack(() => propertiesDraft.ensureSeeded());
  });

  const propertiesParse = $derived(parsePropertiesSource(propertiesDraft.text));
  const propertiesDirty = $derived(
    propertiesParse.ok ? !sameProperties(propertiesParse.value, node.properties) : true,
  );

  function propertiesSourceErrorText(code: string, detail?: string | null): string {
    switch (code) {
      case SIGNED_OUT:
        return signedOutSaveText();
      case 'empty':
        return t('node.properties.source.empty', 'Enter a JSON object — {} removes every property.');
      case 'too-large':
        return t('node.properties.source.too-large', 'Too large to save here ({kb} KB max).', { kb: PROPERTIES_MAX / 1024 });
      case 'unsafe-number':
        return t(
          'node.properties.source.unsafe-number',
          'The number {number} cannot be stored exactly — JSON numbers are 64-bit floats, so it would be saved rounded. Quote it as a string to keep it as written.',
          { number: detail ?? '' },
        );
      case 'duplicate-key':
        return t(
          'node.properties.source.duplicate-key',
          'The key "{key}" appears twice in one object — only the last would be kept.',
          { key: detail ?? '' },
        );
      case 'too-deep':
        return t('node.properties.source.too-deep', 'Nested more than {max} levels deep — too deep to store here.', { max: PROPERTIES_MAX_DEPTH });
      case 'not-object':
        return t('node.properties.source.not-object', 'Properties must be a JSON object: {"key": "value"}.');
      case 'invalid-json':
        return detail ?? t('node.properties.source.invalid', 'Invalid JSON.');
      case 'changed':
        return t(
          'node.properties.source.changed',
          'These properties were changed since you opened the editor. Copy your edit, reload, and apply it again — saving now would undo that change.',
        );
      case 'not-found':
        // A node that's gone and one you can no longer read answer the same
        // (hrn:node:hadronmemory.com:specs:cor:api:140:03), so don't claim which.
        return t('node.properties.source.not-found', 'This node isn’t available to you any more. It may have been deleted, or your access changed.');
      case 'unauthenticated':
        return t('node.properties.source.unauthenticated', 'Your session has ended — sign in again.');
      default:
        // `rejected` (a memory-schema verdict), `no-door`, `failed`: the
        // server's own words say more than a paraphrase.
        return detail ?? t('node.properties.source.failed', 'The properties could not be saved.');
    }
  }

  // Each save is tagged; the per-node reset (#251 block) bumps the counter, so
  // a save still in flight when the page moves to another node — or when a
  // newer save starts — cannot touch the editor it no longer belongs to.
  let propertiesSaveSeq = 0;

  async function saveProperties() {
    if (!propertiesParse.ok || !propertiesDirty || savingProperties) return;
    // Everything the save depends on is captured HERE, before the first await
    // (@codex on #893): the node, its ABSOLUTE action URL, the text and the
    // baseline. A relative URL resolved after navigation would write node A's
    // draft to node B.
    const originId = node.id;
    const seq = ++propertiesSaveSeq;
    const url = `${basePath}/nodes/${originId}?/updateProperties`;
    const text = propertiesDraft.text;
    const baseline = propertiesDraft.baseline;
    const stillOurs = () => seq === propertiesSaveSeq && node.id === originId;

    savingProperties = true;
    propertiesSaveError = null;
    try {
      const result = await submitJsonDraft({ url, field: 'properties', text, baseline });
      if (!stillOurs()) return;
      if (result.ok) {
        await invalidateAll();
        if (!stillOurs()) return;
        // Our own save: start over from what is stored now. The draft's sync
        // would KEEP a dirty buffer over a changed bag — right for someone
        // else's change, wrong for this one.
        propertiesDraft.reseed({ id: node.id, value: node.properties });
        showPropertiesSource = false;
      } else {
        propertiesSaveError = propertiesSourceErrorText(result.code, result.detail);
      }
    } catch {
      if (stillOurs()) propertiesSaveError = propertiesSourceErrorText('failed');
    } finally {
      if (seq === propertiesSaveSeq) savingProperties = false;
    }
  }

  let copiedProperties = $state(false);
  // Copies WHAT IS SHOWN (@codex on #893): the persisted bag in Rendered, the
  // draft in Source — the stale-save refusal tells the user to copy their
  // edit, and copying the stored value instead would lose it on reload.
  async function copyProperties() {
    const text = showPropertiesSource ? propertiesDraft.text : propertiesString;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
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
  // `data.isChat` is the server's own predicate (nodeType `chat`, or the legacy
  // `team-chat` tag) — read it rather than re-deriving, so the tab can't
  // disagree with the load that fetched (or skipped) the thread.
  const isChat = $derived(!!data.isChat);
  // portal#1525: also the server's own predicate — the App's canonical team
  // channel (chatPostTarget platform kind), so the entry button below can
  // never disagree with where a post would land. Every other chat keeps the
  // text entry.
  const isTeamChannel = $derived(!!data.isTeamChannel);
  // Also the server's own predicate (chatPostTarget) — the composer shows
  // exactly when the send action would accept a post.
  const canPostChat = $derived(!!data.canPostChat);

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
  // portal#1433: suggestions for the edge target as the user types, from the
  // bounded node search. Choosing one fills the loc; the target is still
  // resolved exactly at submit (`addEditableEdge`).
  let edgeTargetHits = $state<TypeaheadNode[]>([]);
  $effect(() =>
    scheduleTypeahead({
      query: newEdgeTargetQuery,
      memoryId: data.graph.id,
      selfId: node.id,
      onHits: (hits) => (edgeTargetHits = hits),
    }),
  );
  let newEdgeName = $state('');

  // #656: an outgoing edge whose target sits in a memory the caller can't read
  // comes back with target === null (server #783), so it carries NO targetId.
  // updateEdges REPLACES the whole outgoing set, and an edge we can't round-trip
  // would be silently deleted by any save — so edge editing is blocked while one
  // is present rather than risking that data loss.
  const hasUnreadableOutgoing = $derived(node.outgoingEdges.some((e) => !e.target));

  function startEditEdges() {
    if (hasUnreadableOutgoing) return;
    editableEdges = node.outgoingEdges
      .filter((e) => e.target != null)
      .map((e) => ({
        targetId: e.target!.id,
        targetName: e.target!.name ?? e.target!.loc,
        targetLoc: e.target!.loc,
        name: e.name ?? '',
      }));
    newEdgeTargetQuery = '';
    newEdgeName = '';
    addEdgeError = null;
    edgeEditorSession += 1;
    resolvingEdgeTarget = false;
    editingEdges = true;
  }

  function cancelEditEdges() {
    // A lookup still in flight belongs to the editor that sent it: a later
    // answer must not land in this (or the next) editing session. Opening an
    // editor bumps the same counter, so a node change is fenced by the next
    // node's own "Edit edges" (the editor closes on a node change).
    edgeEditorSession += 1;
    resolvingEdgeTarget = false;
    editingEdges = false;
    editableEdges = [];
  }

  function removeEditableEdge(idx: number) {
    editableEdges = editableEdges.filter((_, i) => i !== idx);
  }

  let resolvingEdgeTarget = $state(false);
  let edgeEditorSession = 0;
  async function addEditableEdge() {
    // portal#1524: resolve the typed loc by ONE per-node read at submit (no
    // node list to match against). "No node found" is said only when the read
    // says so; a failed read says it failed.
    const q = newEdgeTargetQuery.trim();
    if (!q || resolvingEdgeTarget) return;
    resolvingEdgeTarget = true;
    addEdgeError = null;
    const session = edgeEditorSession;
    // The request owns the name typed when it was sent, not the live field.
    const edgeName = newEdgeName.trim();
    let target: { id: string; loc: string; name: string | null } | null = null;
    try {
      const res = await fetch(`/api/nodes/resolve?memoryId=${encodeURIComponent(data.graph.id)}&ref=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('lookup failed');
      const body = (await res.json()) as { found: boolean; node?: { id: string; loc: string; name: string | null } };
      if (session !== edgeEditorSession) return;
      target = body.found && body.node ? body.node : null;
      if (!target) {
        addEdgeError = `No node found matching "${q}"`;
        return;
      }
    } catch {
      if (session === edgeEditorSession) addEdgeError = t('node-detail.edge-target-lookup-failed', 'Could not look that node up. Try again.');
      return;
    } finally {
      if (session === edgeEditorSession) resolvingEdgeTarget = false;
    }
    if (!target) return;
    if (editableEdges.some((e) => e.targetId === target.id && e.name === edgeName)) {
      addEdgeError = 'That edge already exists';
      return;
    }
    editableEdges = [
      ...editableEdges,
      {
        targetId: target.id,
        targetName: target.name ?? target.loc,
        targetLoc: target.loc,
        name: edgeName,
      },
    ];
    // Leave anything the reader typed while the lookup was out.
    if (newEdgeTargetQuery.trim() === q) newEdgeTargetQuery = '';
    if (newEdgeName.trim() === edgeName) newEdgeName = '';
    addEdgeError = null;
  }

  let addEdgeError = $state<string | null>(null);
  const editableEdgesJson = $derived(JSON.stringify(
    editableEdges.map((e) => ({ targetId: e.targetId, name: e.name || null })),
  ));
  const initialEdgesForm = untrack(() => submittedForm<NodeUpdateEdgesForm>(form, 'updateEdges') as NodeUpdateEdgesSuperform | null ?? data.edgesForm);
  const {
    form: edgesFormData,
    errors: edgesErrors,
    message: edgesMessage,
    submitting: edgesSubmitting,
    enhance: edgesEnhance,
  } = superForm<NodeUpdateEdgesForm, App.Superforms.Message, NodeUpdateEdgesForm>(initialEdgesForm, {
    validators: zod4Client(nodeUpdateEdgesSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onResult: ({ result }) => {
      if (result.type !== 'failure') editingEdges = false;
    },
  });

  $effect(() => {
    const edgesJson = editableEdgesJson;
    edgesFormData.update((current) => ({
      ...current,
      edges: edgesJson,
    }), { taint: false });
  });

  const edgesActionError = $derived(scopedActionError<NodeUpdateEdgesForm>(
    form,
    'updateEdges',
    $edgesMessage,
    $edgesErrors,
    ['_kind', 'edges'],
  ));
  const edgesActionSuccess = $derived(scopedActionSuccess<NodeUpdateEdgesForm>(
    form,
    'updateEdges',
    $edgesMessage,
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
    /** #656: null when the far endpoint lives in a memory the caller can't read
     *  (server #783 made Edge.source/target nullable) — the row renders an
     *  opaque placeholder and drops its links. */
    endpointId: string | null;
    endpointName: string;
    endpointUrn: string;
    /** Memory id that owns the edge (= source node's memory) — for the detail href. */
    sourceMemoryId: string;
    sourceId: string | null;
    /** #1161: the far endpoint is DELETED per the server (recoveryEdges), not merely unreadable. */
    endpointDeleted?: boolean;
  }

  // #656: label for an endpoint the caller isn't allowed to resolve.
  const PRIVATE_ENDPOINT = t('node-edges.endpoint.private', 'In a memory you can’t access');

  // Callers guard the null case (#656) and render a placeholder instead, so this
  // only ever sees a readable endpoint.
  function endpointUrnOf(n: NonNullable<NodeEdge['source']>): string {
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
      // #656: target may be null (cross-memory edge into an unreadable memory).
      endpointId: e.target?.id ?? data.deletedEdges?.[e.id]?.target?.id ?? null,
      endpointName: e.target ? (e.target.name || e.target.loc) : (data.deletedEdges?.[e.id]?.target?.name ?? PRIVATE_ENDPOINT),
      endpointUrn: e.target ? endpointUrnOf(e.target) : (data.deletedEdges?.[e.id]?.target?.urn ?? ''),
      endpointDeleted: !e.target && !!data.deletedEdges?.[e.id]?.target,
      // Outgoing: this node is the source.
      sourceMemoryId: node.memoryId,
      sourceId: node.id,
    })),
    ...node.incomingEdges.map((e) => ({
      edgeId: e.id,
      direction: 'Incoming' as const,
      name: e.name || '—',
      // #656: source may be null — the common case, since incomingEdges is how
      // a foreign memory's edge reaches this node.
      endpointId: e.source?.id ?? data.deletedEdges?.[e.id]?.source?.id ?? null,
      endpointName: e.source ? (e.source.name || e.source.loc) : (data.deletedEdges?.[e.id]?.source?.name ?? PRIVATE_ENDPOINT),
      endpointUrn: e.source ? endpointUrnOf(e.source) : (data.deletedEdges?.[e.id]?.source?.urn ?? ''),
      endpointDeleted: !e.source && !!data.deletedEdges?.[e.id]?.source,
      // Incoming: the OTHER node is the source that owns the edge.
      sourceMemoryId: e.source?.memory?.id ?? node.memoryId,
      sourceId: e.source?.id ?? null,
    })),
  ]);

  let edgeFilter = $state('');

  const edgeColumns: PortalColumnDef<EdgeRow>[] = [
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
    // #820 — the edge grid's accessors are strings; swapped with the revision
    // grid below it so this page does not sit half-converted.
    globalFilterFn: makeGlobalFilterFn<EdgeRow>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  // ── History (#529) — NodeRevision snapshots in the shared DataTable ───────
  // data.revisions is a streamed promise; resolve it into a rune so the table
  // (which needs a synchronous array) can consume it. This keeps the list
  // client-rendered — the History tab isn't SSR'd (not the default tab) and the
  // promise resolves on the client.
  let revisionRows = $state<NodeRevision[]>([]);
  let revisionsLoaded = $state(false);
  let revisionsFailed = $state(false);
  // Server pagination is pinned to the node whose read produced it, just like
  // the rows: a navigation or late answer must not lend another node's pages.
  let revisionsPageState = $state<ListPageNavigation | null>(null);
  let revisionsPageFor = $state<string | null>(null);
  const revisionsPage = $derived(revisionsPageFor !== null && revisionsPageFor === node.id ? revisionsPageState : null);
  $effect(() => {
    const p = data.revisions; // track the current navigation's promise
    revisionRows = [];
    revisionsFailed = false;
    revisionsLoaded = false;
    revisionsPageState = null;
    revisionsPageFor = null;
    p.then((res) => {
      // A late answer for the node the reader navigated away from must not land
      // on this one (rows, page state or loaded state).
      if (data.revisions !== p) return;
      revisionRows = res.items;
      revisionsPageState = res.page ?? null;
      revisionsPageFor = res.nodeId ?? null;
      revisionsFailed = !res.ok; // distinguish "no revisions" from "couldn't load"
      revisionsLoaded = true;
    });
  });

  // portal#1355: edge-removal audit entries (server#2562, hrn:node:hadronmemory.com:specs:cor:dmo:010:04) —
  // the same streamed-promise pattern as the revisions above, for the same
  // reasons: client-rendered (the History tab isn't SSR'd), and every
  // resolution is checked against the promise now current so a late answer
  // for the node the reader navigated away from can't land on this one.
  let removalRows = $state<NodeEdgeRemoval[]>([]);
  let removalsLoaded = $state(false);
  let removalsFailed = $state(false);
  let removalsCapped = $state(false);
  $effect(() => {
    const p = data.edgeRemovals; // track the current navigation's promise
    // Node A's rows or failure must not read as node B's history while B's
    // promise is pending (portal#1356 BLIND review, P2) — reset the display
    // synchronously, the way the provenance effect does.
    removalRows = [];
    removalsFailed = false;
    removalsLoaded = false;
    removalsCapped = false;
    p.then((res) => {
      if (data.edgeRemovals !== p) return;
      removalRows = res.items;
      removalsCapped = res.capped === true;
      removalsFailed = !res.ok; // distinguish "none recorded" from "couldn't load"
      removalsLoaded = true;
    });
  });

  // #914: authorship + advisory validation. Both are streamed and resolve to a
  // result that may be { ok: false }. Each resolution is checked against the
  // promise now current, so a late answer for the node the reader navigated
  // away from can't land on this one.
  let provenance = $state<ProvenanceResult<NodeProvenance> | null>(null);
  $effect(() => {
    const p = data.provenance;
    provenance = null;
    p.then((res) => {
      if (data.provenance === p) provenance = res;
    });
  });
  // #992: approval status, streamed and checked the same way.
  let approval = $state<ProvenanceResult<NodeApprovalStatus> | null>(null);
  $effect(() => {
    const p = data.approval;
    approval = null;
    p.then((res) => {
      if (data.approval === p) approval = res;
    });
  });
  const approvalState = $derived(approval ? approvalView(approval) : null);
  // #992 slice C: mint status, from the same read as the approval.
  let mintResult = $state<ProvenanceResult<NodeMintStatus> | null>(null);
  $effect(() => {
    const p = data.mint;
    mintResult = null;
    p.then((res) => {
      if (data.mint === p) mintResult = res;
    });
  });
  const mintState = $derived(mintResult ? mintView(mintResult, node.revision) : null);
  // portal#1022: passkey signatures, streamed and checked the same way.
  let signatureResult = $state<ProvenanceResult<NodeSignatureStatus> | null>(null);
  $effect(() => {
    const p = data.signatures;
    signatureResult = null;
    p.then((res) => {
      if (data.signatures === p) signatureResult = res;
    });
  });
  const signatureState = $derived(signaturesView(signatureResult));
  // portal#1022 links half: whether to offer the Sign affordance at all. Same
  // streamed-and-guarded shape, fed by the loader's capability answer — the
  // very promise that gates the signature query, so the button and the
  // status read can never disagree about whether signing is offered.
  let signingOn = $state<boolean | null>(null);
  $effect(() => {
    const p = data.signingOffered;
    signingOn = null;
    p.then((on) => {
      if (data.signingOffered === p) signingOn = on;
    });
  });
  // One click, one request: the default enhance leaves the button live for
  // the round trip, and a second click would mint a second signing request.
  // update() in try/finally — the delete-form pattern — so a redirecting or
  // throwing result still re-enables (or navigates away entirely).
  let requestingSignature = $state(false);
  function requestSignatureEnhance() {
    requestingSignature = true;
    return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
      try {
        await update({ reset: false });
      } finally {
        requestingSignature = false;
      }
    };
  }
  // portal#1014: the node's discussion and its open-feedback summary, streamed
  // and checked the same way. The tab's own writes update the summary too.
  let discussion = $state<Discussion | null | undefined>(undefined);
  // Only a new NODE starts the tab empty. A fresh read of the same node (an
  // invalidation) keeps showing the last discussion until it lands, then the
  // mounted tab adopts it; blanking it in between would unmount the tab and
  // lose the reader's drafts (local review on #1024, P2-1). The tab's own
  // confirmed writes come back through `ondiscussion` (Gene on #1024).
  let discussionNodeId: string | undefined;
  $effect(() => {
    const p = data.discussion;
    const id = node.id;
    if (id !== discussionNodeId) {
      discussionNodeId = id;
      discussion = undefined;
    }
    p.then((res) => {
      if (data.discussion === p) discussion = res;
    });
  });
  // The tab mounts on first open and then stays mounted (hidden) for this node,
  // so switching tabs keeps drafts, open editors and loaded pages.
  let discussionOpened = $state(false);
  $effect(() => {
    if (activeTab === 'discussion') discussionOpened = true;
  });
  let commentSummary = $state<CommentSummary | null>(null);
  $effect(() => {
    const p = data.commentSummary;
    commentSummary = null;
    p.then((res) => {
      if (data.commentSummary === p) commentSummary = res;
    });
  });
  const isComment = $derived(node.nodeType === COMMENT_NODE_TYPE);
  // portal#1175: what the server says about this comment (`Node.asComment`).
  // Null when it was not returned; then the viewer is not treated as the author
  // and there is no target to link, never a guess. The server stays the
  // authority on who may edit; this only stops offering what would be refused.
  const commentInfo = $derived(isComment ? (node.asComment ?? null) : null);
  const commentTargetHref = $derived(commentInfo?.target ? `${basePath}/nodes/${commentInfo.target.id}` : null);
  const canEditContent = $derived(!isComment || (commentInfo?.viewerIsAuthor === true && commentInfo.deleted !== true));
  // A comment is never a target, and private/system memories take none (hrn:node:hadronmemory.com:specs:cor:dmo:110:00, :02).
  const commentable = $derived(!isComment && isCommentableClass(data.graph?.class));
  // The trust cue (hrn:node:hadronmemory.com:specs:cor:dmo:110:07): shown, never a gate.
  const feedbackCue = $derived(commentable ? openFeedbackCue(commentSummary) : null);
  const commentsEndpoint = $derived(`/app/memories/${encodeURIComponent(node.memoryId)}/nodes/${encodeURIComponent(node.id)}/comments`);
  let revisionProvenance = $state<ProvenanceResult<Map<string, NodeProvenance>> | null>(null);
  $effect(() => {
    const p = data.revisionProvenance;
    revisionProvenance = null;
    p.then((res) => {
      if (data.revisionProvenance !== p) return;
      revisionProvenance = res.ok ? { ok: true, value: provenanceById(res.value) } : { ok: false };
    });
  });

  // A History row with its provenance: null while loading, { ok: false } when
  // the read failed or didn't cover the row.
  type HistoryRow = NodeRevision & { provenance: ProvenanceResult<NodeProvenance> | null };
  const historyRows = $derived<HistoryRow[]>(
    revisionRows.map((r) => {
      if (!revisionProvenance) return { ...r, provenance: null };
      const p = revisionProvenance.ok ? revisionProvenance.value.get(r.id) : undefined;
      return { ...r, provenance: p ? { ok: true, value: p } : { ok: false } };
    }),
  );
  function historyAuthorship(r: HistoryRow) {
    return r.provenance?.ok ? authorshipView(r.provenance.value.authorship) : null;
  }
  function historyValidation(r: HistoryRow) {
    if (!r.provenance) return null;
    return validationView(r.provenance.ok ? { ok: true, value: r.provenance.value.contentValidation } : { ok: false });
  }
  // What the Authorship and Validation cells show, as text (URN chips included),
  // so search matches it.
  function historyAuthorshipText(r: HistoryRow): string {
    if (!r.provenance) return '';
    const v = historyAuthorship(r);
    return v ? authorshipSearchText(v) : t('node.provenance.unavailable', "Couldn't load");
  }
  function historyValidationText(r: HistoryRow): string {
    const v = historyValidation(r);
    return v ? validationText(v) : '';
  }

  // Editor display (#620 contract): resolved handle, else identity string.
  function editorLabel(r: NodeRevision): string {
    const text = revisionEditorView(r).searchText;
    return text || '—';
  }

  // Epoch milliseconds (or null when absent/unparseable) so the When column sorts
  // by instant rather than by the raw wire string. The `DateTime` scalar only
  // guarantees a `Date.parse`-able value — NOT byte-for-byte ISO UTC — so a
  // pass-through value carrying a non-UTC offset makes lexicographic string order
  // differ from chronological order. See hadron-server
  // hrn:node:hadronmemory.com:hadron-server:conventions:datetime-scalar-for-date-fields.
  function revisionDateMs(val: string | null): number | null {
    if (!val) return null;
    const ms = new Date(val).getTime();
    return isNaN(ms) ? null : ms;
  }

  const revisionColumns: PortalColumnDef<HistoryRow>[] = [
    { accessorFn: (r) => revisionDateMs(r.createdAt), id: 'when', header: t('node.history.col.when', 'When'), size: 200 },
    // #914: the revision number this row snapshots (null on legacy rows).
    { accessorFn: (r) => r.revNo ?? null, id: 'rev', header: t('node.history.col.rev', 'Rev'), size: 96 },
    { accessorFn: (r) => r.revLabel ?? '', id: 'label', header: t('node.history.col.label', 'Label'), size: 280 },
    // #620: changed fields (empty on legacy rows). Filterable by field name.
    { accessorFn: (r) => (r.changes ?? []).join(' '), id: 'changes', header: t('node.history.col.changes', 'Changes'), enableSorting: false, size: 220 },
    // Filterable by handle / identity string.
    { accessorFn: (r) => editorLabel(r), id: 'editedBy', header: t('node.history.col.edited-by', 'Edited by'), size: 220 },
    // #914: the snapshot's own recorded authorship and validation, never today's.
    { accessorFn: (r) => historyAuthorshipText(r), id: 'authorship', header: t('node.history.col.authorship', 'Authorship'), enableSorting: false, size: 240 },
    { accessorFn: (r) => historyValidationText(r), id: 'validation', header: t('node.history.col.validation', 'Validation'), enableSorting: false, size: 140 },
    { id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 56 },
  ];
  const revisionTable = createSvelteTable<HistoryRow>({
    get data() {
      return historyRows;
    },
    columns: revisionColumns,
    manualPagination: true,
    // nodeRevisionsPage owns newest-first order. Its API has no history-wide
    // search/sort arguments, so do not offer page-local substitutes for them.
    manualSorting: true,
    manualFiltering: true,
    enableSorting: false,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    // #2170 F10: no global filter. History is searched by nothing the server
    // offers, and showSearch is off, so a filter here would be dead state.
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
    },
  });

  // ── portal#1355 — edge-removal audit entries in their own DataTable ────────
  // hrn:node:hadronmemory.com:specs:cor:dmo:010:04: an entry is an audit record, never a revision, so it gets
  // its own list (and its own listKey) under the revisions table rather than
  // masquerading as a History row. No row actions — there is nothing to do
  // with an entry; it is a trace.
  let removalFilter = $state('');
  // hrn:node:hadronmemory.com:specs:cor:dmo:010:04: today only TARGET_HARD_DELETED exists. An unknown code
  // renders verbatim rather than being guessed at — a loud unknown beats a
  // silent wrong label.
  function removalReasonText(r: NodeEdgeRemoval): string {
    if (r.reason === 'TARGET_HARD_DELETED') return t('node.history.removals.reason.target-hard-deleted', 'Target was hard-deleted');
    return r.reason;
  }
  const removalColumns: PortalColumnDef<NodeEdgeRemoval>[] = [
    { accessorFn: (r) => revisionDateMs(r.createdAt), id: 'when', header: t('node.history.removals.col.when', 'When'), size: 200 },
    { accessorFn: (r) => `${r.edgeName ?? ''} ${r.edgeLoc ?? ''}`, id: 'edge', header: t('node.history.removals.col.edge', 'Edge'), size: 240 },
    // The loc is the addressable part; the stable id is the only handle that
    // survives the delete, so both ride along (the id also carries the search).
    { accessorFn: (r) => `${r.targetLoc ?? ''} ${r.targetId}`, id: 'target', header: t('node.history.removals.col.target', 'Removed target'), size: 240 },
    { accessorFn: (r) => removalReasonText(r), id: 'reason', header: t('node.history.removals.col.reason', 'Reason'), enableSorting: false, size: 200 },
    { accessorFn: (r) => r.removedBy ?? '', id: 'removedBy', header: t('node.history.removals.col.removed-by', 'Deleted by'), size: 180 },
  ];
  const removalTable = createSvelteTable<NodeEdgeRemoval>({
    get data() {
      return removalRows;
    },
    columns: removalColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return removalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      removalFilter = typeof u === 'function' ? u(removalFilter) : u;
    },
    // #820, same as the revisions table: sort by epoch, match the rendered text.
    globalFilterFn: makeGlobalFilterFn<NodeEdgeRemoval>({}, {
      when: (row) => `${formatPortalDateTime(row.createdAt)} ${row.createdAt}`,
    }),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'when', desc: true }], // most recent first
    },
  });

  // #529 row actions (Display / Restore / Delete) + Clear-all. The per-row menu
  // is a SINGLE fixed-positioned popover (anchored to the clicked ⋯ button), so
  // it isn't clipped by the DataTable's overflow-auto scroll container.
  let historyMenuFor = $state<NodeRevision | null>(null);
  let historyMenuTrigger: HTMLElement | null = null;
  let historyMenuX = $state(0);
  let historyMenuY = $state(0);
  let restoreTarget = $state<NodeRevision | null>(null);
  // #534: the revision whose label the "Edit label" popup is changing.
  let labelTarget = $state<NodeRevision | null>(null);
  // Which opening of the popup a save belongs to: a save that outlives its popup
  // (cancelled, or the page moved to another node) must not close or clear a
  // later one, nor lose its draft.
  let labelDialogGeneration = 0;
  // The label popup's own busy and refusal: a restore or delete in flight keeps
  // reporting through historyBusy/historyError, and closing this popup never
  // touches theirs.
  let labelBusy = $state(false);
  let labelError = $state<string | null>(null);
  // Revisions with a label write still in flight. A second save for the same
  // revision waits for the first to settle, so an earlier request cannot commit
  // after a later one and put the old label back.
  let labelWritesPending = $state<string[]>([]);
  // The History row button that opened the popup; focus returns there on close.
  let labelTrigger: HTMLElement | null = null;
  function closeLabel() {
    labelDialogGeneration++;
    labelTarget = null;
    labelBusy = false;
    labelError = null;
    const trigger = labelTrigger;
    labelTrigger = null;
    if (trigger) void tick().then(() => { if (trigger.isConnected) trigger.focus(); });
  }
  let clearConfirm = $state(false);
  let historyBusy = $state(false);
  let historyError = $state<string | null>(null);

  function revisionHref(r: NodeRevision): string {
    return `${basePath}/nodes/${node.id}/revisions/${r.id}`;
  }
  function openHistoryMenu(e: MouseEvent, r: NodeRevision) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    historyMenuX = rect.right;
    historyMenuY = rect.bottom + 4;
    historyMenuTrigger = e.currentTarget as HTMLElement;
    historyMenuFor = r;
  }

  // `current` lets a caller whose result can be outlived (the label popup)
  // fence its own busy/error reporting: a stale request still returns false/true
  // but touches no page state.
  async function postRevisionAction(payload: Record<string, unknown>, current: () => boolean = () => true): Promise<boolean> {
    historyBusy = true;
    historyError = null;
    try {
      const res = await fetch(`${basePath}/nodes/${node.id}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (current()) historyError = d.error ?? 'Revision action failed';
        return false;
      }
      await invalidateAll(); // refresh the node + the streamed revision list
      return true;
    } catch (e) {
      if (current()) historyError = e instanceof Error ? e.message : 'Revision action failed';
      return false;
    } finally {
      if (current()) historyBusy = false;
    }
  }

  function onHistoryMenuSelect(id: string) {
    const r = historyMenuFor;
    historyMenuFor = null;
    if (!r) return;
    if (id === 'display') window.open(revisionHref(r), '_blank', 'noopener');
    else if (id === 'label') {
      labelDialogGeneration++;
      labelBusy = false;
      labelError = null;
      labelTrigger = historyMenuTrigger;
      labelTarget = r; // opens the Edit label popup
    } else if (id === 'restore') restoreTarget = r; // opens the warning dialog
    else if (id === 'delete') void postRevisionAction({ action: 'delete', revisionId: r.id });
  }
  async function confirmRestore() {
    if (!restoreTarget) return;
    if (await postRevisionAction({ action: 'restore', revisionId: restoreTarget.id })) restoreTarget = null;
  }
  async function confirmLabel(text: string) {
    const target = labelTarget;
    if (!target || labelWritesPending.includes(target.id)) return;
    const generation = labelDialogGeneration;
    const current = () => generation === labelDialogGeneration;
    labelWritesPending = [...labelWritesPending, target.id];
    labelBusy = true;
    labelError = null;
    let written = false;
    try {
      const res = await fetch(`${basePath}/nodes/${node.id}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'label', revisionId: target.id, revLabel: text }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (current()) labelError = d.error ?? 'Revision action failed';
        return;
      }
      written = true;
    } catch (e) {
      if (current()) labelError = e instanceof Error ? e.message : 'Revision action failed';
      return;
    } finally {
      labelWritesPending = labelWritesPending.filter((id) => id !== target.id);
      if (current()) labelBusy = false;
    }
    // The label is stored: a failed refresh is a stale list, never a failed write
    // (retrying it would only repeat a write that already happened).
    if (written) {
      try {
        await invalidateAll();
      } catch {
        if (current()) historyError = 'Label saved, but the list could not refresh. Reload to see it.';
      }
      if (current()) closeLabel();
    }
  }
  async function confirmClear() {
    if (await postRevisionAction({ action: 'clear' })) clearConfirm = false;
  }

  function edgeDetailHref(r: EdgeRow): string {
    return `/app/memories/${r.sourceMemoryId}/nodes/${r.sourceId}/edges/${r.edgeId}`;
  }

  // Children: direct children of this node's loc
  // portal#1656: the loader's first page of 20 (`data.children`, read with
  // `childrenOf`), plus the pages "Show more" read since, in the server's
  // sibling order: never re-sorted here. Null is a FAILED read
  // (`data.childrenUnavailable`), NOT "no children": the section says so.
  // Pages read by "Show more" belong to the loader page they extend: new page
  // data (any reload) replaces them, and a page that lands after it is dropped.
  let morePages = $state.raw<{ against: unknown; rows: MemoryNode[]; hasMore: boolean } | null>(null);
  let morePendingFor = $state.raw<unknown>(null);
  let moreFailedFor = $state.raw<unknown>(null);
  const extraChildren = $derived(morePages && morePages.against === data.children ? morePages : null);
  const children = $derived([...((data.children ?? []) as unknown as MemoryNode[]),
        ...(extraChildren?.rows ?? [])]);
  // A full page never passes for the whole list: the count says "20+".
  const childrenHasMore = $derived(extraChildren ? extraChildren.hasMore : !!data.childrenHasMore);
  const moreChildrenLoading = $derived(morePendingFor !== null && morePendingFor === data.children);
  const moreChildrenFailed = $derived(moreFailedFor !== null && moreFailedFor === data.children);
  async function showMoreChildren() {
    const against = data.children;
    if (!against || moreChildrenLoading || !childrenHasMore) return;
    const offset = children.length;
    morePendingFor = against;
    moreFailedFor = null;
    const page = await readMoreChildren(basePath, node.id, offset);
    if (morePendingFor === against) morePendingFor = null;
    // A page read against older page data writes nothing: keying the render
    // would hide it, but the one shared slot holds the NEWER page's own rows
    // or failure, and overwriting it loses them
    // (hrn:node:hadronmemory.com:hadron-portal:findings:keyed-render-slot-does-not-reject-stale-writes).
    if (against !== data.children) return;
    if (!page) {
      moreFailedFor = against;
      return;
    }
    morePages = { against, rows: [...(extraChildren?.rows ?? []), ...page.children], hasMore: page.hasMore };
  }
  const hasChildren = $derived(children.length > 0);
  // Reorder rewrites the position of every row it is given, so it is offered
  // only on the whole list: on a partial one it would renumber the rows shown
  // and leave the rest where they were.
  const childrenReorderable = $derived(!childrenHasMore && children.some((c) => c.seq !== null));
  let childDragError = $state<string | null>(null);
  // #309: the children list defaults to the full grid; reordering is a separate
  // mode because drag order is incompatible with sort/filter/pagination.
  let reorderMode = $state(false);
  // Guard overlapping reorder POSTs from rapid successive drags — each sends a
  // full seq rewrite, so a race could land a stale order.
  let reordering = $state(false);

  type NodeTab = 'chat' | 'info' | 'content' | 'discussion' | 'abstract' | 'data' | 'properties' | 'flow' | 'children' | 'references' | 'history' | 'settings';

  // A `team-chat` node is readable two ways: as a chat (bubbles, composer) and
  // as an ordinary node. The Chat tab is the same thread the standalone
  // /chat view renders, and it leads because that is what such a node IS —
  // its "content" is the messages hanging under it, not its body.
  const chatMessages = $derived(data.chatMessages ?? []);

  // Content / Abstract / Data / Properties / Flow / Edges / Settings are always
  // present; Children only when the node has children. (#256: Content is no
  // longer gated on hasContent — an empty node still needs an authoring
  // surface; Data follows the same always-on rationale so there's a portal
  // path to add structured data to a node that has none. Flow (#478) is
  // always-on for the same reason: turning a plain node into a flow node
  // needs a surface. Properties (#518) is always-on for discoverability, same
  // as Data, and since #1031 it is where the object type, typed properties and
  // skill export are edited.)
  const availableTabs = $derived<NodeTab[]>(
    isComment
      // portal#1175: a comment is feedback, not a node to author. It keeps its
      // text (and any children), and its facts move to a read-only Info tab.
      ? ['info', 'content',
        ...(hasChildren ? (['children'] as NodeTab[]) : [])]
      : [
          ...(isChat ? (['chat'] as NodeTab[]) : []),
          'content',
          // portal#1014: beside Content, where a reader decides whether to trust it.
          ...(commentable ? (['discussion'] as NodeTab[]) : []),
          'abstract', 'data', 'properties', 'flow',
          ...(hasChildren ? (['children'] as NodeTab[]) : []),
          'references',
          'history',
          'settings',
        ],
  );

  function defaultTab(): NodeTab {
    // An explicit `?tab=` wins (deep link), when that tab exists on this node.
    const requested = data.initialTab as NodeTab | null;
    if (requested && availableTabs.includes(requested)) return requested;
    // Chat first for a chat node — the thread is the node. Otherwise Content
    // when present, else the Children list for a pure container node, else
    // Content (its empty-state authoring surface).
    return isChat ? 'chat' : hasContent ? 'content' : hasChildren ? 'children' : 'content';
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
      // #927: a Content/Abstract save in flight for the previous node no
      // longer owns these editors. The drafts re-seed themselves on a new node.
      contentSaveSeq++;
      saving = false;
      contentSaveError = null;
      contentConflict = false;
      abstractSaveSeq++;
      savingAbstract = false;
      abstractSaveError = null;
      abstractConflict = false;
      copyDraftFailed = null;
      showDataSource = false;
      dataSaveError = null;
      // #894: a Data save in flight for the previous node no longer owns this
      // editor.
      dataSaveSeq++;
      savingData = false;
      // #886 (@copilot on #893): the Properties Source view is one of these
      // and was missed — left open, node B opened straight into its editor.
      showPropertiesSource = false;
      propertiesSaveError = null;
      // A save still in flight for the previous node no longer owns this
      // editor: invalidate it, and do not leave the new node's editor locked.
      propertiesSaveSeq++;
      savingProperties = false;
      confirmDelete = false;
      // portal#1014: the Discussion tab belongs to the node it was opened on.
      // Derived from the tab just picked, not reset to false: on first mount
      // this runs after the opened-effect, and a `?tab=discussion` deep link
      // leaves activeTab unchanged, so a plain reset left the panel unrendered
      // (Cloe's QA on #1024).
      discussionOpened = activeTab === 'discussion';
      editingEdges = false;
      isEditing = false;
      clearMetaRefusal();
      reorderMode = false;
      downloadOpen = false;
      dlError = null;
      // An export in flight for the previous node no longer owns this page
      // (#1193 READ P2s): invalidatePrint aborts its request, closes its
      // blank window and releases the busy flag, so a print for the new
      // node starts from clean ground.
      invalidatePrint();
      printError = null;
      skillExportOpen = false;
      testFlowOpen = false;
      $testFlowFormData.appId = '';
      $testFlowFormData.agentRef = '';
      $testFlowFormData.orgId = data.org?.id ?? '';
      $testFlowFormData.payload = '';
      moveOpen = false;
      moveFullUrn = false;
      $moveFormData.target = '';
      closeDeleteConfirm();
      $deleteFormData.hard = false;
      // portal#696: the attach-file dialog is transient too — SvelteKit reuses
      // this component across nodes, so leaving it open would carry it (and its
      // parentLoc, now stale) onto the next node.
      attachOpen = false;
      // #534: the Edit label popup belongs to the node it was opened on; left
      // open, Save would post A's revisionId through B's endpoint. A save still
      // in flight for A no longer owns it either.
      closeLabel();
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
  downloadOpen = false; testFlowOpen = false; moveOpen = false; closeDeleteConfirm();
  attachOpen = false; skillExportOpen = false;
  historyMenuFor = null; // #529: close the History row menu on Escape too
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
        ? { label: seg.label, href: `${basePath}/nodes/${seg.nodeId}`, title: seg.title }
        : { label: seg.label, title: seg.title }
    ),
    ...(commentTargetHref && commentInfo?.target
      ? [{ label: t('comments.crumb.on', 'On {name}', { name: commentInfo.target.name }), href: commentTargetHref, title: commentInfo.target.urn }]
      : []),
    { label: node.name },
  ]} />
  <!-- Create missing parent nodes -->
  {#if createParentActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{createParentActionError}</div>
  {/if}
  {#each data.breadcrumb.slice(0, -1) as seg}
    {#if !seg.nodeId && data.ancestorsKnown}
      <form method="POST" action="?/createParent" use:createParentEnhance novalidate class="inline">
        <input type="hidden" name="_kind" value="createParent" />
        <input type="hidden" name="loc" value={seg.path} />
        <input type="hidden" name="name" value={seg.label} />
        <button type="submit" disabled={readOnly} class="text-xs text-indigo-500 hover:text-indigo-400">
          + Create parent node "{seg.label}"
        </button>
      </form>
    {/if}
  {/each}

  <!-- Header -->
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="flex flex-wrap items-center gap-2 text-xl font-bold text-zinc-900 dark:text-white">
        {#if node.isRunnable}
          <svg class="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        {:else if isChat}
          <!-- #722: a chat node reads as a thread, not a body — mark it in the
               header the way a runnable node is marked. -->
          <svg class="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
        {:else if isChatMessage}
          <!-- #725: one bubble OF a thread, not the thread. Squared with two
               text lines so it reads as related to the chat glyph above but is
               not mistaken for it at a glance — the two appear one click apart,
               and a message page looking identical to its chat page is the
               confusion this mark exists to remove. -->
          <svg class="h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.5 8.5 0 0 1-.6 3.1 1 1 0 0 0-.1.5V19a1 1 0 0 1-1 1h-3.9a1 1 0 0 0-.5.1 8.5 8.5 0 1 1 6.1-8.6z"></path>
            <path d="M8.5 10h7"></path>
            <path d="M8.5 14h4"></path>
          </svg>
        {/if}
        <span class="min-w-0 break-words"><span class="text-zinc-400 font-normal">{node.isRunnable ? createNodeStrings.taskNodeCaption() : isChat ? createNodeStrings.chatNodeCaption() : isChatMessage ? createNodeStrings.chatMessageNodeCaption() : createNodeStrings.nodeCaption()}</span> {node.name}</span>
        <!-- #921: the node's role, verbatim (dotted sub-roles included), so a
             spec reviewer sees it without opening Settings. -->
        {#if node.role}
          <span data-testid="node-role-badge" class="min-w-0 break-words rounded-full bg-amber-100 px-2 py-0.5 font-mono text-xs font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300" title={t('node.role.badge-title', 'Role')}>{node.role}</span>
        {/if}
        <!-- #588 (server #725): collection discriminator badge. -->
        {#if node.objectType}
          <span class="min-w-0 break-words rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-xs font-normal text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" title={t('node.object-type.badge-title', 'Object type (collection)')}>{node.objectType}</span>
        {/if}
      </h1>
      <Urn value={fullUrn} type="node" />
      <NodeEmbeddingBadges enabled={data.graph.vectorIndexEnabled === true}
        pendingAt={node.embeddingPendingAt} failedAt={node.embeddingFailedAt} error={node.embeddingError} />
      {#if isComment}
        <!-- portal#1014: a comment is feedback, never approved or minted (hrn:node:hadronmemory.com:specs:cor:dmo:110:06),
             so its page offers no approval row at all. portal#1175: and needs no note saying so. -->
      {:else}
      <!-- #1129: content approval, bound to the revision on screen, with Approve / Verify. -->
      <div data-testid="node-approval" class="mt-1 flex flex-wrap items-center gap-2">
        {#if approvalState}
          {#if mintState}<NodeMintLabel view={mintState} />{/if}
          <NodeApprovalBadge view={approvalState} currentRevision={node.revision} />
          {#if !readOnly && approvalState.canApprove}
            <form method="POST" action="?/approveNode" use:approveEnhance novalidate class="flex items-center">
              <input type="hidden" name="_kind" value="approveNode" />
              <input type="hidden" name="revision" value={node.revision} />
              <ApproveRevisionButton revision={node.revision} submitting={$approveSubmitting} />
            </form>
          {/if}
          {#if approvalState.approval}
            <form method="POST" action="?/verifyNode" use:verifyEnhance novalidate>
              <input type="hidden" name="_kind" value="verifyNode" />
              <button type="submit" disabled={$verifySubmitting} class="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                {t('node.approval.verify', 'Verify')}
              </button>
            </form>
          {/if}
        {:else}
          <span class="text-xs text-zinc-400" aria-busy="true">{t('node.approval.loading', 'Loading approval status…')}</span>
        {/if}
        {#if feedbackCue}
          <button
            type="button"
            data-testid="open-feedback-cue"
            class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300"
            onclick={() => (activeTab = 'discussion')}
          >{feedbackCue}</button>
        {/if}
      </div>
      <!-- portal#1022: passkey signatures (hadron-server#1864); renders nothing with nothing to report. -->
      <NodeSignatures view={signatureState} />
      {#if signingOn}
        <!-- portal#1022 links half (hrn:node:hadronmemory.com:specs:cor:dmo:130:08):
             the portal's whole leg is to create the signing request and hand
             over the server-hosted ceremony page's link — the ceremony itself
             never runs here. The hidden revision input, like the approval
             forms above, pins the request to the text on screen.

             No readOnly gate, deliberately:
             hrn:node:hadronmemory.com:specs:cor:dmo:130:03 gives ANY reader
             the right to request ("anyone who may read the node"), and the
             requester need not be the signer — so the affordance is not
             hidden from view-only readers the way writer actions are. The
             copy says what the click does (a request, then the server's
             page), never "Sign", which a reader the ceremony would refuse
             could not finish. -->
        <form method="POST" action="?/requestSignature" use:enhance={requestSignatureEnhance} class="mt-1" data-testid="request-signature-form">
          <input type="hidden" name="revision" value={node.revision} />
          <button
            type="submit"
            data-testid="request-signature"
            disabled={requestingSignature}
            title={t('node.signatures.request.hint', 'Creates a signing request and opens the server-hosted signing page for this revision.')}
            class="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('node.signatures.request.action', 'Request a signature…')}
          </button>
        </form>
      {/if}
      <!-- Live region stays mounted; only its content changes — a region that
           mounts populated announces nothing
           (hrn:node:hadronmemory.com:hadron-portal:review:live-region-persistent-not-conditionally-mounted).
           empty:hidden keeps the always-present region from taking a line. -->
      <p role="alert" data-testid="signature-request-error" class="mt-1 empty:hidden text-xs text-red-700 dark:text-red-300">
        {#if typeof form?.requestSignatureError === 'string'}{form.requestSignatureError}{/if}
      </p>
      {/if}
      {#if approveActionError || verifyActionError}
        <p role="alert" data-testid="approval-error" class="mt-1 text-xs text-red-700 dark:text-red-300">{approveActionError ?? verifyActionError}</p>
      {:else if approveActionSuccess || verifyActionSuccess}
        <p role="status" data-testid="approval-success" class="mt-1 text-xs text-emerald-700 dark:text-emerald-300">{approveActionSuccess ?? verifyActionSuccess}</p>
      {/if}
      {#if verifyHashes && (verifyHashes.expectedHash || verifyHashes.actualHash)}
        <dl data-testid="verify-hashes" class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
          {#if verifyHashes.expectedHash}
            <dt>{t('node.approval.verify.expected-hash', 'Approved hash')}</dt>
            <dd class="select-all break-all font-mono">{verifyHashes.expectedHash}</dd>
          {/if}
          {#if verifyHashes.actualHash}
            <dt>{t('node.approval.verify.actual-hash', 'Current hash')}</dt>
            <dd class="select-all break-all font-mono">{verifyHashes.actualHash}</dd>
          {/if}
        </dl>
      {/if}
      {#if node.description}
        <p class="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{node.description}</p>
      {/if}
      <!--
        #489 part 4: the App a chat belongs to. A reader arriving from a shared
        chat URN can read and post here, but had no way to reach the App — the
        worklog, staff and epics. The App name LOOKED present because the server
        writes "Team chat — <App>" into `description` above, which is prose that
        would vanish if anyone edited it, not a reference.

        Rendered as name + URN per CLAUDE.md's `review:render-urn`: the URN is
        what a reader copies into a CLI or an MCP call, and a name alone is not
        addressable. Absent when the chat has no App (`chatApp` is null) rather
        than rendering an empty chip.
      -->
      {#if chatApp}
        <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span class="text-zinc-500 dark:text-zinc-400">{t('node.chat.app-label', 'App')}</span>
          <a
            href="/app/apps/{chatApp.id}"
            class="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >{chatApp.name}</a>
          <Urn value={chatApp.urn} type="app" size={10} />
        </div>
      {/if}
    </div>
    <div class="shrink-0 flex items-start gap-2">
      {#if isChat}
        <!-- The Chat tab below is the inline view; this is the full-screen one.
             portal#1525: a team CHANNEL takes an icon-only entry (an icon is
             sufficient; no label — #1525), so the accessible name IS the
             label. Every other chat keeps the text button unchanged. -->
        {#if isTeamChannel}
          <a
            href="{basePath}/nodes/{node.id}/chat"
            aria-label={t('node.chat.open-fullscreen-channel', 'Open full-screen channel')}
            title={t('node.chat.open-fullscreen-channel', 'Open full-screen channel')}
            class="rounded-md bg-green-600 p-2 text-white hover:bg-green-500"
          >
            <Expand class="h-4 w-4" aria-hidden="true" />
          </a>
        {:else}
          <a
            href="{basePath}/nodes/{node.id}/chat"
            class="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
          >
            {t('node.chat.open-fullscreen', 'Full-screen chat')}
          </a>
        {/if}
      {/if}
      <!-- #503: the "⋯" menu is the single entry point for node actions;
           each item opens one of the panels/dialogs below. -->
      <NodeActionsMenu actions={menuActions} onselect={onMenuSelect} label={`Actions for ${node.name}`} />
      {#if printError}
        <p role="alert" class="text-xs text-red-500">{printError}</p>
      {/if}
      <!-- Hidden form the menu's Duplicate item submits (requestSubmit fires
           the submit event use:enhance intercepts, unlike .submit()). -->
      <form bind:this={duplicateForm} method="POST" action="?/duplicate" use:duplicateEnhance novalidate class="hidden">
        <input type="hidden" name="_kind" value="duplicateNode" />
      </form>
      <!-- Convert-to-task: flips isRunnable on; enhance re-runs load so the
           menu item disappears once the node is a task (#503). -->
      <form bind:this={convertForm} method="POST" action="?/convertToTask" use:convertToTaskEnhance novalidate class="hidden">
        <input type="hidden" name="_kind" value="convertToTask" />
      </form>
      <!-- Panels/dialogs opened from the actions menu, anchored to the header. -->
      <div class="relative">
          {#if duplicateActionError || convertToTaskActionError}
            <div role="alert" class="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
              {duplicateActionError ?? convertToTaskActionError}
            </div>
          {/if}
          {#if testFlowOpen}
            <button
              type="button"
              class="fixed inset-0 z-10 cursor-default"
              aria-label="Close test flow panel"
              onclick={() => (testFlowOpen = false)}
            ></button>
            <div class="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <form method="POST" action="?/testFlow" use:testFlowEnhance class="space-y-3" novalidate>
                <input type="hidden" name="_kind" value={$testFlowFormData._kind} />
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  Runs this node as a one-off headless flow: it executes, extracts its fields, and follows routing edges. You'll land on the live run page.
                </p>
                <div>
                  <label for="testFlowApp" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Run as App</label>
                  <select
                    id="testFlowApp"
                    name="appId"
                    bind:value={$testFlowFormData.appId}
                    onchange={() => ($testFlowFormData.agentRef = '')}
                    class={inputClass}
                    aria-invalid={$testFlowErrors.appId?.[0] ? 'true' : undefined}
                  >
                    <option value="" disabled>Pick an App…</option>
                    {#each testFlowApps as app (app.id)}
                      <option value={app.id}>{app.name}</option>
                    {/each}
                  </select>
                  <p class="mt-1 text-xs text-zinc-400">The run uses this App's budgets and permissions.</p>
                </div>
                {#if testFlowAgents}
                  <div>
                    <label for="testFlowAgent" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('node-actions.test-flow.agent', 'Run as Agent')}</label>
                    <select
                      id="testFlowAgent"
                      name="agentRef"
                      bind:value={$testFlowFormData.agentRef}
                      class={inputClass}
                    >
                      <option value="" disabled>{t('node-actions.test-flow.agent-pick', 'Choose an Agent…')}</option>
                      {#each testFlowAgents as agent (agent.id)}
                        <option value={agent.id}>{agent.name}</option>
                      {/each}
                    </select>
                  </div>
                {/if}
                <div>
                  <label for="testFlowPayload" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Test payload (optional JSON)</label>
                  <textarea
                    id="testFlowPayload"
                    name="payload"
                    rows="4"
                    bind:value={$testFlowFormData.payload}
                    placeholder={'{ "confidence": 0.9 }'}
                    spellcheck="false"
                    aria-invalid={$testFlowErrors.payload?.[0] ? 'true' : undefined}
                    class="w-full rounded-lg border bg-zinc-50 p-2 font-mono text-xs text-zinc-800 focus:outline-none dark:bg-zinc-950 dark:text-zinc-300 {testFlowPayloadValid ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 dark:border-red-700'}"
                  ></textarea>
                  <p class="mt-1 text-xs {testFlowPayloadValid ? 'text-zinc-400' : 'text-red-500'}">
                    {testFlowPayloadValid
                      ? 'Fields conditions can branch on — like a trigger would send.'
                      : 'Must be a JSON object of named fields.'}
                  </p>
                </div>
                {#if testFlowActionError}
                  <p role="alert" class="text-xs text-red-500">{testFlowActionError}</p>
                {/if}
                <input type="hidden" name="orgId" value={$testFlowFormData.orgId} />
                <button
                  type="submit"
                  disabled={!$testFlowFormData.appId || !testFlowPayloadValid || $testFlowSubmitting}
                  class="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >{$testFlowSubmitting
                  ? t('node-actions.test-flow.starting', 'Starting...')
                  : 'Start test run'}</button>
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

        <!-- #911: one task as one skill. Menu-triggered, offered only for a
             task whose export is on (skillExportHosts). -->
        {#if skillExportOpen}
          <button
            type="button"
            class="fixed inset-0 z-30 cursor-default"
            aria-label={t('node.skill-export.close', 'Close export as skill')}
            onclick={() => (skillExportOpen = false)}
          ></button>
          <div class="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <NodeSkillExport endpoint={`${basePath}/nodes/${node.id}/skill`} hosts={skillExportHosts} />
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
                 reset moveOpen — do it here. Keep open on failure so form errors
                 show (PR-504 review, Gemini). -->
            <form
              method="POST"
              action="?/move"
              use:moveEnhance
              class="space-y-3"
              novalidate
            >
              <input type="hidden" name="_kind" value={$moveFormData._kind} />
              <div>
                {#if !moveFullUrn}
                  <!-- #1164: Location — the loc in THIS memory. The hidden input
                       carries the one submitted `target`, so Location and the
                       full-URN field can never disagree. -->
                  <label for="moveTarget" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('node-actions.move-location', 'Location')}</label>
                  <MoveLocationInput
                    memoryUrn={data.graph.urn ?? ''}
                    bind:target={$moveFormData.target}
                    {inputClass}
                    invalid={!!$moveErrors.target?.[0]}
                    error={$moveErrors.target?.[0]}
                    describedby={$moveErrors.target?.[0] ? 'moveTargetHint moveTargetError' : 'moveTargetHint'}
                  />
                  <p id="moveTargetHint" class="mt-1 text-xs text-zinc-400">
                    {t('node-actions.move-location-hint', 'The node’s path in this memory — change it to rename or reparent. Fails if a node already lives there.')}
                    <button type="button" onclick={() => (moveFullUrn = true)} class="ml-1 underline hover:text-zinc-600 dark:hover:text-zinc-200">{t('node-actions.move-use-full-urn', 'Use full URN')}</button>
                  </p>
                {:else}
                <label for="moveTarget" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Destination node URN</label>
                <input
                  id="moveTarget"
                  name="target"
                  type="text"
                  bind:value={$moveFormData.target}
                  spellcheck="false"
                  aria-invalid={$moveErrors.target?.[0] ? 'true' : undefined}
                  aria-describedby={$moveErrors.target?.[0] ? 'moveTargetHint moveTargetError' : 'moveTargetHint'}
                  class="{inputClass} font-mono text-xs {$moveErrors.target?.[0] ? 'border-red-500 focus:border-red-500' : ''}"
                />
                <!-- #779: the hint is the ONLY place the dialog tells a user what
                     shape to type, so the v1 `org::memory::loc` it used to show
                     taught a grammar the platform has moved off (hrn:node:hadronmemory.com:specs:cor:urn:010:01)
                     — and `parseUrnV2` rejects `::`, so a user who copied the
                     example got a refusal from the field that recommended it.
                     The grammar comes from `moveHintGrammar` rather than being
                     hard-coded, so a chain-owned node is not told to flatten
                     itself (@codex P1). It stays outside t(): a code token, not
                     translatable prose. `id` is load-bearing — the input's
                     aria-describedby points at it. -->
                <!-- Spacing is explicit (@copilot on PR #803): each part is its
                     own element with a margin rather than relying on the
                     newlines between them, which whitespace trimming can eat and
                     render as `…<loc>— change…`. The chain warning is a `block`
                     INSIDE this <p> rather than a sibling paragraph, so it stays
                     inside the id the input's aria-describedby points at — a
                     screen reader that misses "do not flatten" is missing the
                     part that prevents a silent mis-address. -->
                <p id="moveTargetHint" class="mt-1 text-xs text-zinc-400">
                  <span class="font-mono">{moveHintGrammarText}</span>
                  <span class="ml-1">
                    {t(
                      'node-actions.move-hint',
                      '— change the loc to rename/reparent, or the memory to move it to another memory. Fails if a node already lives there.',
                    )}
                  </span>
                  {#if moveUrnIsOwnershipChain}
                    <span class="mt-1 block text-amber-600 dark:text-amber-400">
                      {t(
                        'node-actions.move-hint-ownership-chain',
                        'This memory is addressed by a legacy ownership chain: keep the :: separators exactly as they are. Flattening them does not fail — it addresses a different node.',
                      )}
                    </span>
                  {/if}
                </p>
                {#if $moveErrors.target?.[0]}
                  <p id="moveTargetError" class="mt-1 text-xs text-red-500">{$moveErrors.target[0]}</p>
                {/if}
                <!-- #512: pick the target memory from a searchable list instead
                     of hand-typing its URN; keeps the current loc. The list is
                     streamed (#513 review), so gate on the resolved value. -->
                {#await data.memories then memories}
                  {#if memories.length > 0}
                    <button
                      type="button"
                      onclick={() => (memoryPickerOpen = true)}
                      aria-haspopup="dialog"
                      aria-expanded={memoryPickerOpen}
                      class="mt-2 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >{t('node-actions.move-select-memory', 'Select target memory…')}</button>
                  {/if}
                {/await}
                {/if}
              </div>
              {#if moveActionError}
                <p role="alert" class="text-xs text-red-500">{moveActionError}</p>
              {/if}
              <div class="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={writeLocked || !$moveFormData.target.trim() || $moveFormData.target.trim() === fullUrn || $moveSubmitting}
                  class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >{$moveSubmitting ? t('node-actions.move.moving', 'Moving...') : 'Move node'}</button>
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
          <button type="button" class="fixed inset-0 z-30 cursor-default" aria-label="Close delete confirmation" onclick={() => closeDeleteConfirm()}></button>
          <div class="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-red-200 bg-white p-4 shadow-xl dark:border-red-900 dark:bg-zinc-900">
            <form method="POST" action="?/delete" use:deleteEnhance class="space-y-3" novalidate>
              <input type="hidden" name="_kind" value={$deleteFormData._kind} />
              <p class="text-sm text-zinc-700 dark:text-zinc-200">Delete <span class="font-medium">{node.name}</span>?</p>
              <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" name="hard" value="true" bind:checked={$deleteFormData.hard}
                  class="mt-0.5 rounded border-zinc-300 text-red-600 focus:ring-red-500 dark:border-zinc-600 dark:bg-zinc-800" />
                <span>
                  Hard delete
                  <span class="block text-xs {$deleteFormData.hard ? 'text-red-500' : 'text-zinc-400'}">
                    {$deleteFormData.hard
                      ? 'Permanently removes the node — it cannot be recovered.'
                      : 'Off: soft-deletes (hidden, but recoverable server-side).'}
                  </span>
                </span>
              </label>
              {#if deleteRefusedDescendants > 0}
                <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" name="recursive" value="true" bind:checked={$deleteFormData.recursive}
                    class="mt-0.5 rounded border-zinc-300 text-red-600 focus:ring-red-500 dark:border-zinc-600 dark:bg-zinc-800" />
                  <span>
                    {t('node-actions.delete.also-descendants', 'Also delete its descendants')}
                    <span class="block text-xs text-amber-600 dark:text-amber-400">
                      {t('node-actions.delete.also-descendants.hint',
                        'Deleting this node deletes all {count} descendant node(s) with it.',
                        { count: deleteRefusedDescendants })}
                    </span>
                  </span>
                </label>
              {/if}
              {#if deleteActionError}
                <p role="alert" class="text-xs text-red-500">{deleteActionError}</p>
              {/if}
              <div class="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={writeLocked || $deleteSubmitting}
                  class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {$deleteSubmitting
                    ? t('node-actions.delete.deleting', 'Deleting...')
                    : $deleteFormData.hard ? 'Delete permanently' : 'Delete'}
                </button>
                <button type="button" onclick={() => closeDeleteConfirm()} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
              </div>
            </form>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if pageActionError}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{pageActionError}</div>
  {/if}

  <!-- portal#696: a reference node's file, downloadable from the node itself.
       Sits ABOVE the tab strip rather than inside a tab because it is the whole
       point of such a node — a reference node typically carries no content, so
       burying it in the Content tab would hide it behind an empty state.
       `node.asset` is null for every ordinary node AND when the pointer dangles
       (the asset was deleted), so this one check covers both. -->
  {#if node.asset}
    {#key node.asset.id}
      <NodeAssetCard asset={node.asset} />
    {/key}
  {/if}

  <!-- Shared sections retain node-kind membership and read-availability cues. -->
  <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
    <div class="mb-3">
      <TabRow items={[
        ...(isChat ? [{ id: 'chat', label: t('node.tabs.chat', 'Chat') }] : []),
        ...(isComment ? [{ id: 'info', label: t('node.tabs.info', 'Info') }] : []),
        { id: 'content', label: t('node.tabs.content', 'Content') },
        ...(commentable ? [{ id: 'discussion', label: t('node.tabs.discussion', 'Discussion') }] : []),
        ...(!isComment ? [{ id: 'abstract', label: t('node.tabs.abstract', 'Abstract') }] : []),
        ...(!isComment ? [{ id: 'data', label: t('node.tabs.data', 'Data') }] : []),
        ...(!isComment ? [{ id: 'properties', label: t('node.tabs.properties', 'Properties') }] : []),
        ...(!isComment ? [{ id: 'flow', label: t('node.tabs.flow', 'Flow') }] : []),
        ...(hasChildren ? [{ id: 'children', label: t('node.tabs.children', 'Children') }] : []),
        ...(!isComment ? [{ id: 'references', label: t('node.tabs.references', 'Edges') }] : []),
        ...(!isComment ? [{ id: 'history', label: t('node.tabs.history', 'Revisions') }] : []),
        ...(!isComment ? [{ id: 'settings', label: t('node.tabs.settings', 'Settings') }] : [])
      ]} active={activeTab} label={t('node.tabs-label', 'Node sections')} onselect={(id) => activeTab = id as typeof activeTab}>
        {#snippet itemLabel(tab)}
          {#if tab.id === 'chat'}{t('node.tabs.chat', 'Chat')}
          {#if chatMessages.length}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{chatMessages.length}</span>{/if}
        {:else if tab.id === 'info'}{t('node.info.tab', 'Info')}
          {:else if tab.id === 'content'}{t('node.tabs.content', 'Content')}
        {#if !hasContent}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      {:else if tab.id === 'discussion'}{t('comments.tab', 'Discussion')}
          <!-- Uma (#6998): the badge counts every discussion; amber while any is open. -->
          {#if discussionCount(commentSummary) > 0}
            <span class="ml-1 rounded-full px-1.5 text-xs {(commentSummary?.openThreads ?? 0) > 0
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              : 'bg-zinc-200 dark:bg-zinc-800'}">{discussionCount(commentSummary)}</span>
          {/if}
        {:else if tab.id === 'abstract'}{t('node.tabs.abstract', 'Abstract')}
        {#if !hasAbstract}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      {:else if tab.id === 'data'}{t('node.tabs.data', 'Data')}
        {#if !hasData}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      {:else if tab.id === 'properties'}{t('node.properties.tab', 'Properties')}
        {#if !hasProperties}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      {:else if tab.id === 'flow'}{t('node.tabs.flow', 'Flow')}
        {#if !hasFlowConfig}<span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{createNodeStrings.emptyBadge()}</span>{/if}
      {:else if tab.id === 'children'}{t('node.tabs.children', 'Children')} <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{children.length}{childrenHasMore ? '+' : ''}</span>{:else if tab.id === 'references'}{t('node.tabs.references', 'Edges')}
        {#if hasReferences}
          <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{node.outgoingEdges.length + node.incomingEdges.length}</span>
        {/if}
      {:else if tab.id === 'history'}{t('node.history.tab', 'Revisions')}
          {:else if tab.id === 'settings'}{t('node.tabs.settings', 'Settings')}{/if}
        {/snippet}
      </TabRow>
      {#if !hasChildren && data.childrenUnavailable}<span data-testid="children-unavailable" title={t('node-detail.children-unavailable-reason', 'The children could not be read')} class="text-sm italic text-zinc-500">{t('node-detail.children-unavailable', 'Children unavailable')}</span>{/if}
    </div>

    <div role="tabpanel" id="panel-{activeTab}" aria-labelledby="tab-{activeTab}" tabindex="0">
    <!-- ═══ CHAT TAB ═══ -->
    {#if activeTab === 'chat'}
      <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <!-- #1522: keyed by the send form's node-scoped id. A same-route hop to
             another node keeps this component mounted, which would leave a
             live superForm holding node A's id against node B's results (and
             B's drafts in A's composer). The key remounts the thread when the
             identity changes — the boot-prompt editor's pattern — so the form
             instance, its id and the node always agree. -->
        {#key data.sendChatMessageForm.id}
          <ChatThread
            messages={chatMessages}
            {basePath}
            {form}
            {memoryUrn}
            sendForm={data.sendChatMessageForm}
            action="?/sendChatMessage"
            canPost={canPostChat}
            hasOlder={data.chatHasOlder ?? false}
            onLoadOlder={loadOlderChat}
            loadFailed={data.chatLoadFailed ?? false}
            onRetry={() => invalidateAll()}
            heightClass="h-[calc(100vh-24rem)] min-h-[24rem]"
          />
        {/key}
      </div>
    {/if}

    <!-- ═══ DISCUSSION TAB (portal#1014) ═══ -->
    {#if commentable && discussionOpened}
      <div hidden={activeTab !== 'discussion'} data-testid="discussion-panel">
      {#if discussion === undefined}
        <p class="text-sm text-zinc-400" aria-busy="true">{t('comments.loading', 'Loading the discussion…')}</p>
      {:else if discussion}
        {#key node.id}
          <NodeDiscussion
            endpoint={commentsEndpoint}
            shownRevision={node.revision ?? null}
            initial={discussion}
            summary={commentSummary}
            onsummary={(s) => (commentSummary = s)}
            ondiscussion={(d) => (discussion = d)}
          />
        {/key}
      {/if}
      </div>
    {/if}

    <!-- ═══ CONTENT TAB ═══ -->
    {#if activeTab === 'content'}
      {#if isCompiledPrompt}
        <CompiledPromptSources nodeId={node.id} revision={node.revision} owner={compiledPromptOwner(data.graph)} />
      {/if}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showSource = false}
          >Rendered</button>
          {#if canEditContent}
          <button
            bind:this={contentSourceToggle}
            class="px-2 py-1 text-xs {showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showSource = true}
          >Source</button>
          {/if}
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
      {#if showSource && canEditContent}
        <div class="mt-3">
          <!-- #247 / #878: fill the viewport height left below the editor,
               keeping the Save row visible. MEASURED by `fillViewport`, not a
               calc() guess: the chrome above varies per node, so #247's
               `100vh - 18rem` pushed Save below the fold. The textarea scrolls
               internally; `resize-none` because a manual drag would be undone
               by the next measurement. -->
          <textarea
            use:fillViewport={contentSaveRow}
            class="block w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
            placeholder={createNodeStrings.contentSourcePlaceholder()}
            readonly={writeLocked}
            bind:value={contentDraft.text}
          ></textarea>
          <div bind:this={contentSaveRow} class="mt-2 flex flex-wrap items-center justify-end gap-2">
            {#if contentConflict}
              <!-- #927: a refused save keeps the draft; these are the ways out. -->
              <button
                type="button"
                onclick={() => copyDraft('content')}
                class="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >{copiedDraft === 'content' ? t('node.text.conflict.copied', 'Copied') : t('node.text.conflict.copy', 'Copy my edit')}</button>
              <button
                type="button"
                onclick={discardContentDraft}
                class="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >{t('node.text.conflict.load-newer', 'Discard my edit and load the newer version')}</button>
            {/if}
            <button
              bind:this={contentSaveButton}
              onclick={saveContent}
              disabled={writeLocked || saving || !contentDraft.dirty}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{saving ? t('node.text.saving', 'Saving…') : contentSaveError ? t('node.save.retry', 'Retry') : t('node.text.save', 'Save')}</button>
          </div>
          {#if contentSaveError}
            <p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{contentSaveError}</p>
          {/if}
          {#if copyDraftFailed === 'content'}
            <p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{t('node.text.conflict.copy-failed', "Couldn't copy to the clipboard. Select the text in the editor and copy it yourself before discarding.")}</p>
          {/if}
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
          {#if canEditContent}
          <button
            onclick={() => showSource = true}
            class="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >{createNodeStrings.contentEmptyCta()}</button>
          {/if}
        </div>
      {/if}
    {/if}

    <!-- ═══ ABSTRACT TAB ═══ -->
    {#if activeTab === 'abstract'}
      {#if isCompiledPrompt}
        <p class="mb-2 text-sm text-zinc-500 dark:text-zinc-400" data-testid="compiled-prompt-hint">{t('node.compiled-prompt.hint', 'This compiled boot prompt is read-only. Edit the boot source and compile again.')}</p>
      {/if}
      <div class="flex items-center justify-between">
        <div class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            class="px-2 py-1 text-xs {!showAbstractSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => showAbstractSource = false}
          >Rendered</button>
          <button
            bind:this={abstractSourceToggle}
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
          <!-- #878: same measured fill as the Content editor above; it was a
               bare 120px minimum. -->
          <textarea
            use:fillViewport={abstractSaveRow}
            class="block w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
            maxlength={ABSTRACT_MAX}
            placeholder={abstractPlaceholder()}
            aria-describedby={abstractHint ? 'node-abstract-search-hint' : undefined}
            readonly={writeLocked}
            bind:value={abstractDraft.text}
          ></textarea>
          <div bind:this={abstractSaveRow} class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs {abstractDraft.text.length > ABSTRACT_MAX ? 'text-red-500' : 'text-zinc-400'}">{abstractDraft.text.length} / {ABSTRACT_MAX}</span>
            <div class="flex flex-wrap items-center gap-2">
              {#if abstractConflict}
                <button
                  type="button"
                  onclick={() => copyDraft('abstract')}
                  class="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >{copiedDraft === 'abstract' ? t('node.text.conflict.copied', 'Copied') : t('node.text.conflict.copy', 'Copy my edit')}</button>
                <button
                  type="button"
                  onclick={discardAbstractDraft}
                  class="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >{t('node.text.conflict.load-newer', 'Discard my edit and load the newer version')}</button>
              {/if}
              <button
                bind:this={abstractSaveButton}
                onclick={saveAbstract}
                disabled={writeLocked || savingAbstract || !abstractDraft.dirty}
                class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >{savingAbstract ? t('node.text.saving', 'Saving…') : abstractSaveError ? t('node.save.retry', 'Retry') : t('node.text.save', 'Save')}</button>
            </div>
          </div>
          <!-- #936: derived from THIS memory's vector config; no claim when
               search doesn't use the abstract, or when there is no index. -->
          {#if abstractHint}
            <p id="node-abstract-search-hint" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{abstractHint}</p>
          {/if}
          {#if abstractSaveError}
            <p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{abstractSaveError}</p>
          {/if}
          {#if copyDraftFailed === 'abstract'}
            <p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{t('node.text.conflict.copy-failed', "Couldn't copy to the clipboard. Select the text in the editor and copy it yourself before discarding.")}</p>
          {/if}
        </div>
      {:else if hasAbstract}
        <div class="prose prose-sm prose-zinc mt-3 max-w-none dark:prose-invert">{@html renderedAbstractHtml}</div>
      {:else}
        <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {t('node.abstract.empty', 'No abstract yet. The abstract is a paragraph-length summary of this node.')}
            {#if abstractHint}{abstractHint}{/if}
          </p>
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
        <div
          role="group"
          aria-label={t('node.data.view-toggle', 'Data view')}
          class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
        >
          <button
            type="button"
            aria-pressed={!showDataSource}
            class="px-2 py-1 text-xs {!showDataSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => (showDataSource = false)}
          >{t('node.data.rendered', 'Rendered')}</button>
          <button
            type="button"
            aria-pressed={showDataSource}
            class="px-2 py-1 text-xs {showDataSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => (showDataSource = true)}
          >{t('node.data.source', 'Source')}</button>
        </div>
        {#if hasData || showDataSource}
          <button
            onclick={copyData}
            class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            title={showDataSource ? t('node.data.copy-draft', 'Copy this JSON') : t('node.data.copy', 'Copy data')}
            aria-label={showDataSource ? t('node.data.copy-draft', 'Copy this JSON') : t('node.data.copy', 'Copy data')}
          >
            {#if copiedData}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showDataSource}
        {#if dataDraft.unavailable}
          <p role="status" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
            {t('node.data.source.unavailable', 'This node’s data is nested too deeply to show or edit as text here.')}
          </p>
        {:else}
        <div class="mt-3">
          <!-- Source editor: monospace, auto-growing to fit its content
               (min-h floor, max-h cap then scrolls). The border turns red
               while the JSON is not saveable; the status row below says why.
               Read-only while a save is in flight: the save re-seeds from what
               was stored, so text typed after the click would be discarded. -->
          <textarea
            use:autosize={dataDraft.text}
            aria-label={t('node.data.source.aria', 'Data as JSON')}
            aria-invalid={!dataParse.ok && !dataEmpty}
            aria-describedby="data-source-status"
            class="w-full min-h-[160px] max-h-[calc(100vh-16rem)] resize-none overflow-y-auto rounded-lg border bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none {dataParse.ok || dataEmpty ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 focus:border-red-500 dark:border-red-700'}"
            placeholder={'{\n  "key": "value"\n}'}
            spellcheck="false"
            readonly={writeLocked || savingData}
            aria-busy={savingData}
            bind:value={dataDraft.text}
          ></textarea>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div id="data-source-status" class="text-xs">
              {#if dataParse.ok}
                <span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  {t('node.data.source.valid', 'Valid JSON')}
                </span>
              {:else}
                <span class={dataEmpty ? 'text-zinc-400' : 'text-red-500'}>{dataSourceErrorText(dataParse.code, dataParse.detail)}</span>
              {/if}
            </div>
            <button
              type="button"
              onclick={saveData}
              disabled={writeLocked || savingData || !dataParse.ok || !dataDirty}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{savingData ? t('node.data.source.saving', 'Saving…') : dataSaveError ? t('node.save.retry', 'Retry') : t('node.data.source.save', 'Save')}</button>
          </div>
          {#if dataSaveError}
            <p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{dataSaveError}</p>
          {/if}
        </div>
        {/if}
      {:else if dataUnavailable}
        <p role="status" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
          {t('node.data.unavailable', 'This node’s data is nested too deeply to show here.')}
        </p>
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

    <!-- ═══ PROPERTIES TAB (#518, typed table #588, storage form #1031) ═══ -->
    {#if activeTab === 'properties'}
      <div class="flex items-center justify-between">
        <div
          role="group"
          aria-label={t('node.properties.view-toggle', 'Properties view')}
          class="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
        >
          <button
            type="button"
            aria-pressed={!showPropertiesSource}
            class="px-2 py-1 text-xs {!showPropertiesSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => (showPropertiesSource = false)}
          >{t('node.properties.rendered', 'Rendered')}</button>
          <button
            type="button"
            aria-pressed={showPropertiesSource}
            class="px-2 py-1 text-xs {showPropertiesSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => (showPropertiesSource = true)}
          >{t('node.properties.source', 'Source')}</button>
        </div>
        {#if hasProperties || showPropertiesSource}
          <button
            onclick={copyProperties}
            class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            title={showPropertiesSource ? t('node.properties.copy-draft', 'Copy this JSON') : t('node.properties.copy', 'Copy properties')}
            aria-label={showPropertiesSource ? t('node.properties.copy-draft', 'Copy this JSON') : t('node.properties.copy', 'Copy properties')}
          >
            {#if copiedProperties}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
        {/if}
      </div>
      {#if showPropertiesSource}
        <!-- #886: the whole bag as JSON — typed fields, undeclared keys and the
             skill export alike. Saving replaces the bag with exactly this. -->
        {#if propertiesDraft.unavailable}
          <p role="status" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
            {t(
              'node.properties.source.unavailable',
              'This node’s properties are nested too deeply to show or edit as text here.',
            )}
          </p>
        {:else}
        <div class="mt-3">
          <p class="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t(
              'node.properties.source.hint',
              'Saving replaces all of this node’s properties with exactly this JSON — typed fields and the skill export included.',
            )}
          </p>
          <!-- Read-only while a save is in flight (@codex on #893): the save
               re-seeds from what was stored, so text typed after the click
               would be discarded without a word. -->
          <textarea
            use:autosize={propertiesDraft.text}
            aria-label={t('node.properties.source.aria', 'Properties as JSON')}
            aria-invalid={!propertiesParse.ok}
            aria-describedby="properties-source-status"
            class="w-full min-h-[160px] max-h-[calc(100vh-16rem)] resize-none overflow-y-auto rounded-lg border bg-zinc-50 p-4 font-mono text-sm text-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 focus:outline-none {propertiesParse.ok ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 focus:border-red-500 dark:border-red-700'}"
            spellcheck="false"
            readonly={writeLocked || savingProperties}
            aria-busy={savingProperties}
            bind:value={propertiesDraft.text}
          ></textarea>
          <div class="mt-2 flex items-center justify-between gap-3">
            <div id="properties-source-status" class="text-xs">
              {#if !propertiesParse.ok}
                <span class="text-red-500">{propertiesSourceErrorText(propertiesParse.code, propertiesParse.detail)}</span>
              {:else}
                <span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  {t('node.properties.source.valid', 'Valid JSON object')}
                </span>
              {/if}
            </div>
            <button
              type="button"
              onclick={saveProperties}
              disabled={writeLocked || savingProperties || !propertiesParse.ok || !propertiesDirty}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >{savingProperties ? t('node.properties.source.saving', 'Saving…') : propertiesSaveError ? t('node.save.retry', 'Retry') : t('node.properties.source.save', 'Save')}</button>
          </div>
          {#if propertiesSaveError}
            <p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{propertiesSaveError}</p>
          {/if}
        </div>
        {/if}
      {:else}
        <!-- #588: typed view when the node's objectType names a declared
             collection — declared fields (with type + required markers) first,
             then any extra keys. The raw JSON view below stays authoritative. -->
        {#if typedPropertyRows.length > 0}
          <div class="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th class="px-3 py-2 font-medium">{t('node.properties.col-field', 'Field')}</th>
                  <th class="px-3 py-2 font-medium">{t('node.properties.col-type', 'Type')}</th>
                  <th class="px-3 py-2 font-medium">{t('node.properties.col-value', 'Value')}</th>
                </tr>
              </thead>
              <tbody>
                {#each typedPropertyRows as row (row.name)}
                  <tr class="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td class="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {row.name}{#if row.required}<span class="text-red-500" title={t('node.properties.required', 'Required')}>*</span>{/if}
                    </td>
                    <td class="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {#if row.declared}{row.type}{:else}<span class="italic">{t('node.properties.undeclared', 'not declared')}</span>{/if}
                    </td>
                    <td class="px-3 py-2 font-mono text-xs text-zinc-900 dark:text-white">
                      {#if !row.present}
                        <span class="italic text-zinc-400 dark:text-zinc-500 {row.required ? 'text-amber-600 dark:text-amber-400' : ''}">{row.required ? t('node.properties.missing-required', 'missing (required)') : t('node.properties.unset', '—')}</span>
                      {:else if typeof row.value === 'object'}
                        {displayJson(row.value, { compact: true }) ?? t('node.properties.value-unavailable', '(too deeply nested to show)')}
                      {:else}
                        {String(row.value)}
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        {#if propertiesUnavailable}
          <p role="status" class="mt-3 text-sm text-amber-700 dark:text-amber-400">
            {t('node.properties.unavailable', 'This node’s properties are nested too deeply to show here.')}
          </p>
        {:else if hasProperties}
          <pre class="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 overflow-x-auto">{#each highlightedProperties as tok}<span class={jsonTokenClass[tok.type]}>{tok.text}</span>{/each}</pre>
        {:else if typedPropertyRows.length === 0}
          <!-- #1031: the "Add properties" button that sat here is gone. The way
               in is the storage form directly below, and the Source view. An
               empty TYPED node renders the schema's rows above instead, so the
               note is only for a node with neither (@copilot on #893). -->
          <div class="mt-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
            <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('node.properties.empty', 'No properties. Node.properties holds structured key-value metadata (often server-set, e.g. source URL or title).')}</p>
          </div>
        {/if}
      {/if}
    {/if}
    <!-- #1031: the storage form (object type, typed properties, skill export),
         which was the separate `/edit` page behind an "Edit" button here.
         Shown under the Rendered view; the Source view is the other editor of
         the same bag, so the two are never on screen together.

         Mounted for as long as the page is, and HIDDEN rather than unmounted
         when another tab or the Source view is showing, so an unsaved edit
         survives a look at another tab. Unmounting would discard it without a
         word, the defect #1024 had to fix for comment drafts.

         The action carries `tab=properties` so a submit that navigates fully
         (no JS yet) reopens this tab rather than the node's default one. -->
    <div class="mt-6" hidden={activeTab !== 'properties' || showPropertiesSource}>
      <fieldset disabled={writeLocked}>
      <NodeStorageForm
        {node}
        memorySchema={data.graph.schema}
        seed={data.storageForm}
        actionData={form}
        action="?tab=properties&/updateStorage"
        skillCheck={data.skillCheck}
        runnableBlockedBy={data.runnableBlockedBy}
        noWriteDoor={readOnly ? t('memory-detail.read-only', 'Read only — editing is unavailable for this memory.') : isCompiledPrompt ? t('node.compiled-prompt.read-only', 'A compiled boot prompt is generated from its sources and can’t be edited here.') : data.noWriteDoor}
      />
      </fieldset>
    </div>

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

        {#if flowActionError}
          <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{flowActionError}</div>
        {/if}
        {#if flowActionSuccess}
          <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
            {flowActionSuccess}
          </div>
        {/if}

        <fieldset disabled={writeLocked}>
        <form method="POST" action="?/updateFlow" use:flowEnhance novalidate class="space-y-6">
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
                  placeholder={t('node.flow.output.write-to.placeholder', moveHintGrammar(outputWriteTo))}
                  class="w-full rounded border px-2 py-1 font-mono text-xs dark:bg-zinc-900 dark:text-white {outputWriteToValid ? 'border-zinc-300 dark:border-zinc-700' : 'border-red-400 dark:border-red-700'}"
                />
                <datalist id="flow-writeto-options">
                  {#each outputTargetOptions as opt (opt.urn)}
                    <option value={opt.urn}>{opt.name}</option>
                  {/each}
                </datalist>
                {#if !outputWriteToValid}
                  <p class="mt-1 text-xs text-red-500">
                    {t('node.flow.output.write-to.invalid', 'Must be a fully-qualified node URN, or empty.')}
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

          <input type="hidden" name="_kind" bind:value={$flowFormData._kind} />
          <input type="hidden" name="extractionRows" bind:value={$flowFormData.extractionRows} />
          <input type="hidden" name="outputWriteTo" bind:value={$flowFormData.outputWriteTo} />
          <input type="hidden" name="outputMode" bind:value={$flowFormData.outputMode} />

          <div class="flex items-center gap-3">
            <button
              type="submit"
              disabled={$flowSubmitting || !flowDirty || flowRowsError !== null || !outputWriteToValid}
              class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            >{$flowSubmitting ? t('node.flow.saving', 'Saving...') : t('node.flow.save', 'Save flow settings')}</button>
            {#if flowRowsError !== null && flowRows.some((r) => r.field.trim() !== '')}
              <span class="text-xs text-red-500">{flowRowsError.message}</span>
            {/if}
          </div>
        </form>
        </fieldset>
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
            disabled={readOnly} onclick={() => reorderMode = !reorderMode}
            class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >{reorderMode ? 'Done' : 'Reorder'}</button>
        </div>
      {/if}
      <!-- #309: remount on mode switch — NodeList reads enableSorting/
           enableColumnResizing (= !orderable) once at table construction. -->
      {#key reorderMode && childrenReorderable}
        <NodeList
          nodes={children}
          {basePath}
          memoryUrn={data.graph.urn ?? ''}
          orderable={reorderMode && childrenReorderable}
          listKey={reorderMode && childrenReorderable ? undefined : 'node-children'}
          onreorder={reorderMode && childrenReorderable
            ? async (orderedLocs) => {
                if (reordering) return;
                reordering = true;
                const updates = orderedLocs.map((loc, i) => ({ loc, seq: i + 1 }));
                try {
                  const fd = new FormData();
                  fd.set('updates', JSON.stringify(updates));
                  // The action header makes the reply an ActionResult for sure,
                  // not whatever content negotiation picks (#975 Codex P2), as
                  // the other hand-rolled action clients do.
                  const res = await fetch('?/reorder', {
                    method: 'POST',
                    body: fd,
                    headers: { 'x-sveltekit-action': 'true' },
                  });
                  if (!res.ok) throw new Error('Reorder failed');
                  // #974: an expired session answers with a sign-in redirect.
                  // Nothing typed is lost by following it: the order is a drag.
                  const signin = signinRedirectLocation(deserialize(await res.text()));
                  if (signin) {
                    await goto(signin);
                    return;
                  }
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
      {#if childrenHasMore}
        <!-- portal#1656: the next 20, only when the user asks (hrn:node:hadronmemory.com:specs:cor:api:120:04). -->
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="children-show-more"
            disabled={moreChildrenLoading}
            aria-busy={moreChildrenLoading || undefined}
            onclick={showMoreChildren}
            class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >{moreChildrenLoading ? t('node-detail.children-loading-more', 'Loading…') : t('node-detail.children-show-more', 'Show more')}</button>
          <span role="status" class="text-xs text-zinc-500 dark:text-zinc-400">
            {#if moreChildrenFailed}
              <span data-testid="children-more-failed" class="text-amber-700 dark:text-amber-400">{t('node-detail.children-more-failed', "Couldn't load more children. Try again.")}</span>
            {:else}
              {t('node-detail.children-showing-first', 'Showing the first {count}', { count: children.length })}
            {/if}
          </span>
        </div>
      {/if}
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
          <button type="button" onclick={startEditEdges} disabled={writeLocked || hasUnreadableOutgoing}
            title={hasUnreadableOutgoing ? t('node-edges.edit-blocked', 'This node has an edge into a memory you can’t access. Editing would remove it, so edge editing is disabled here.') : undefined}
            class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
            Edit edges
          </button>
        {/if}
      </div>
      {#if hasUnreadableOutgoing && !editingEdges}
        <p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          {t('node-edges.edit-blocked', 'This node has an edge into a memory you can’t access. Editing would remove it, so edge editing is disabled here.')}
        </p>
      {/if}
      {#if edgesActionError}
        <div role="alert" class="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{edgesActionError}</div>
      {/if}
      {#if edgesActionSuccess && !editingEdges}
        <div role="status" class="mb-3 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{edgesActionSuccess}</div>
      {/if}

      {#if !editingEdges}
        {#if edgeRows.length > 0}
          <DataTable
            table={edgeTable}
            listKey="node:references"
            searchPlaceholder="Search edges..."
            searchAriaLabel="Search edges"
            bind:globalFilter={edgeFilter}
          >
            {#snippet cell(cell, r)}
              {#if cell.column.id === 'direction'}
                <span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {r.direction === 'Outgoing' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{r.direction}</span>
              {:else if cell.column.id === 'relationship'}
                <span class="text-zinc-600 dark:text-zinc-400">{r.name}</span>
              {:else if cell.column.id === 'node'}
                <div class="truncate">
                  {#if r.endpointId}
                    <a href="{basePath}/nodes/{r.endpointId}" class="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{r.endpointName}</a>
                    {#if r.endpointDeleted}
                      <!-- #1161: the SERVER reported this endpoint deleted. -->
                      <span data-testid="edge-endpoint-deleted" class="ml-1 shrink-0 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{t('node.deleted.badge', 'Deleted')}</span>
                    {/if}
                  {:else}
                    <!-- #656: unreadable cross-memory endpoint — opaque, not a link. -->
                    <span class="min-w-0 truncate italic text-zinc-400 dark:text-zinc-500" title={PRIVATE_ENDPOINT}>{r.endpointName}</span>
                  {/if}
                </div>
              {:else if cell.column.id === 'urn'}
                {#if r.endpointUrn}
                  <Urn value={r.endpointUrn} type="node" size={10} />
                {:else}
                  <span class="text-zinc-400 dark:text-zinc-500">—</span>
                {/if}
              {:else if cell.column.id === 'actions'}
                <!-- The edge detail page loads via its SOURCE node, so an edge
                     whose source we can't read has no reachable detail page. -->
                {#if r.sourceId}
                  <a href={edgeDetailHref(r)} class="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">Open →</a>
                {/if}
              {/if}
            {/snippet}
          </DataTable>
        {:else}
          <p class="text-sm text-zinc-400">No edges.</p>
        {/if}
      {:else}
        <!-- Edit mode: list with remove buttons, add form, save/cancel -->
        <form method="POST" action="?/updateEdges" use:edgesEnhance novalidate>
          <input type="hidden" name="_kind" bind:value={$edgesFormData._kind} />
          <input type="hidden" name="edges" bind:value={$edgesFormData.edges} />

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
                  list="newEdgeTarget-options"
                  placeholder="e.g. specs:auth:jwt"
                  class="{inputClass} font-mono text-xs" />
                <datalist id="newEdgeTarget-options">
                  {#each edgeTargetHits as hit (hit.id)}
                    <option value={hit.loc}>{hit.name ?? hit.loc}</option>
                  {/each}
                </datalist>
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
            <button type="submit" disabled={writeLocked || $edgesSubmitting} class="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" style="background: #fb8500;">
              {$edgesSubmitting ? t('node.edges.saving', 'Saving...') : t('node.edges.save', 'Save edges')}
            </button>
            <button type="button" onclick={cancelEditEdges}
              class="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        </form>
      {/if}
    {/if}

    <!-- ═══ HISTORY TAB (#529) — NodeRevision snapshots (#617 actions) ═══
         Shared DataTable (filter header, savable views, pagination),
         most-recent-first, with a per-row menu (Display/Restore/Delete) and a
         Clear-all button. -->
    {#if activeTab === 'history' && !isComment}
      {#if !revisionsLoaded}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('node.history.loading', 'Loading history…')}</p>
      {:else if revisionsFailed}
        <div class="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950">
          <p class="text-sm text-amber-800 dark:text-amber-300">{t('node.history.load-failed', "Couldn't load revision history — the node service returned an error. This is not the same as an empty history; try refreshing.")}</p>
        </div>
      {:else if revisionRows.length === 0}
        <div class="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">{revisionsPage && revisionsPage.total > 0 ? t('node.history.empty-page', 'No revisions on this page.') : t('node.history.empty', 'No prior revisions. A snapshot is saved each time the node is edited.')}</p>
        </div>
      {:else}
        <div class="mb-3 flex items-center justify-between gap-3">
          <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('node.history.intro', 'Revisions saved on each edit, most recent first.')}</p>
          <button type="button" onclick={() => (clearConfirm = true)} disabled={readOnly || historyBusy}
            class="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950">
            {t('node.history.clear', 'Clear')}
          </button>
        </div>
        {#if historyError}
          <p class="mb-2 text-xs text-red-500">{historyError}</p>
        {/if}
        <!-- space-y-3 spaces DataTable's search-row / table / pagination-footer
             (the footer would otherwise sit flush against the table). The table
             sizes itself to the space under it, wherever it sits on the page. -->
        <div class="space-y-3">
          <DataTable
            table={revisionTable}
            listKey="node:history"
            showFooter={false}
            showSearch={false}
            searchPlaceholder={t('node.history.search', 'Search history…')}
            searchAriaLabel={t('node.history.search', 'Search history…')}
          >
          {#snippet cell(cell, r)}
            {#if cell.column.id === 'when'}
              <span class="whitespace-nowrap text-zinc-600 dark:text-zinc-400" title={r.createdAt}>{formatPortalDateTime(r.createdAt)}</span>
            {:else if cell.column.id === 'label'}
              <span class="text-zinc-600 dark:text-zinc-400">{r.revLabel ?? '—'}</span>
            {:else if cell.column.id === 'changes'}
              {#if r.changes && r.changes.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each r.changes as field}
                    <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{field}</span>
                  {/each}
                </div>
              {:else}
                <span class="text-zinc-400">—</span>
              {/if}
            {:else if cell.column.id === 'editedBy'}
              <RevisionEditedBy view={revisionEditorView(r)} />
            {:else if cell.column.id === 'rev'}
              <span class="tabular-nums text-zinc-600 dark:text-zinc-400">{r.revNo ?? '—'}</span>
            {:else if cell.column.id === 'authorship'}
              {@const a = historyAuthorship(r)}
              {#if a}
                <NodeAuthorshipText view={a} compact />
              {:else if r.provenance}
                <span class="text-sm italic text-zinc-500 dark:text-zinc-400">{historyAuthorshipText(r)}</span>
              {/if}
            {:else if cell.column.id === 'validation'}
              {@const v = historyValidation(r)}
              {#if v}<NodeValidationBadge view={v} compact />{/if}
            {:else if cell.column.id === 'actions'}
              <button type="button" onclick={(e) => openHistoryMenu(e, r)} aria-haspopup="menu"
                aria-label={t('node.history.row-actions', 'Revision actions')}
                class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
              </button>
            {/if}
          {/snippet}
        </DataTable>
        </div>
      {/if}
      {#if revisionsLoaded && !revisionsFailed && revisionsPage && (revisionsPage.total > 0 || revisionsPage.firstHref || revisionsPage.previousHref)}
        <ListPageNav page={revisionsPage} label={t('node.history.pages', 'Revision pages')} disabled={historyBusy} />
      {/if}

      <!-- ═══ portal#1355 — edge-removal audit entries (server#2562,
           hrn:node:hadronmemory.com:specs:cor:dmo:010:04) ═══ Edges a hard delete of their target removed from
           THIS node: an audit record, never a revision (revisions stay
           snapshots of the node's own fields), so it renders as its own list
           under the revisions table. Hidden while empty and while streaming —
           an absence of entries is not news — but a FAILED read says so: the
           streamed result is discriminated precisely so a silent [] can't mask
           an error as an absent audit trail. -->
      {#if removalsFailed || removalRows.length > 0}
        <section class="mt-8" aria-labelledby="edge-removals-heading">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h3 id="edge-removals-heading" class="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t('node.history.removals.heading', 'Removed edges')}</h3>
            {#if removalsCapped}<CappedNotice shown={removalRows.length} what={t('capped.edge-removals', 'removed-edge entries (the newest)')} />{/if}
          </div>
          {#if removalsFailed}
            <div class="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950">
              <p class="text-sm text-amber-800 dark:text-amber-300">{t('node.history.removals.load-failed', "Couldn't load the removed-edges audit — the node service returned an error. This is not the same as none recorded; try refreshing.")}</p>
            </div>
          {:else}
          <p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('node.history.removals.intro', 'Edges removed from this node when their target was hard-deleted, most recent first. Each entry is an audit record, not a revision.')}</p>
          <div class="space-y-3">
            <DataTable
              table={removalTable}
              listKey="node:edge-removals"
              searchPlaceholder={t('node.history.removals.search', 'Search removed edges…')}
              searchAriaLabel={t('node.history.removals.search', 'Search removed edges…')}
              bind:globalFilter={removalFilter}
            >
            {#snippet cell(cell, r)}
              {#if cell.column.id === 'when'}
                <span class="whitespace-nowrap text-zinc-600 dark:text-zinc-400" title={r.createdAt}>{formatPortalDateTime(r.createdAt)}</span>
              {:else if cell.column.id === 'edge'}
                <div class="flex flex-col gap-0.5">
                  <span class="text-zinc-700 dark:text-zinc-300">{r.edgeName ?? '—'}</span>
                  {#if r.edgeLoc}
                    <code class="text-xs text-zinc-500 dark:text-zinc-400">{r.edgeLoc}</code>
                  {:else}
                    <span class="text-xs italic text-zinc-500 dark:text-zinc-400">{t('node.history.removals.withheld-edge', 'Not shown')}</span>
                  {/if}
                </div>
              {:else if cell.column.id === 'target'}
                <div class="flex flex-col gap-0.5">
                  {#if r.targetLoc}
                    <code class="text-xs text-zinc-600 dark:text-zinc-400">{r.targetLoc}</code>
                  {:else}
                    <span class="text-xs italic text-zinc-500 dark:text-zinc-400">{t('node.history.removals.withheld', "Not shown: it was in a memory you can't read.")}</span>
                  {/if}
                  <!-- The stable id is the one handle that outlives the delete. -->
                  <code class="text-xs text-zinc-500 dark:text-zinc-400">{r.targetId}</code>
                </div>
              {:else if cell.column.id === 'reason'}
                <span class="text-zinc-600 dark:text-zinc-400" title={r.reason}>{removalReasonText(r)}</span>
              {:else if cell.column.id === 'removedBy'}
                {#if r.removedBy}
                  <!-- removedBy is a bare actor id (no resolution field in the
                       SDL) — shown verbatim rather than guessed at. -->
                  <code class="text-xs text-zinc-500 dark:text-zinc-400" title={t('node.history.removals.removed-by-title', 'The actor id a soft delete would record (a user, app or client)')}>{r.removedBy}</code>
                {:else}
                  <span class="text-zinc-400">—</span>
                {/if}
              {/if}
            {/snippet}
          </DataTable>
          </div>
          {/if}
        </section>
      {/if}
    {/if}

    <!-- #529: History row menu (single, fixed — anchored to the clicked ⋯ so
         it escapes the DataTable's overflow) + Restore/Clear dialogs. -->
    {#if historyMenuFor}
      <button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={t('node.history.close-menu', 'Close menu')} onclick={() => (historyMenuFor = null)}></button>
      <div role="menu" class="fixed z-50 w-44 -translate-x-full rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" style="left: {historyMenuX}px; top: {historyMenuY}px;">
        <button type="button" role="menuitem" onclick={() => onHistoryMenuSelect('display')} class="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">{t('node.history.action.display', 'Display')}</button>
        <button type="button" role="menuitem" disabled={writeLocked} onclick={() => onHistoryMenuSelect('label')} class="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">{t('node.history.action.label', 'Edit label')}</button>
        <button type="button" role="menuitem" disabled={writeLocked} onclick={() => onHistoryMenuSelect('restore')} class="block w-full px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">{t('node.history.action.restore', 'Restore')}</button>
        <div class="my-1 border-t border-zinc-200 dark:border-zinc-800"></div>
        <button type="button" role="menuitem" disabled={readOnly} onclick={() => onHistoryMenuSelect('delete')} class="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800">{t('node.history.action.delete', 'Delete')}</button>
      </div>
    {/if}

    {#if labelTarget}
      <RevisionLabelDialog
        label={labelTarget.revLabel ?? null}
        busy={labelBusy || labelWritesPending.includes(labelTarget.id)}
        error={labelError}
        onsave={confirmLabel}
        oncancel={closeLabel}
      />
    {/if}

    {#if restoreTarget}
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button type="button" class="absolute inset-0 cursor-default bg-black/30" aria-label={t('node.history.restore.cancel', 'Cancel')} onclick={() => (restoreTarget = null)}></button>
        <div class="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('node.history.restore.heading', 'Restore this revision?')}</h3>
          <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('node.history.restore.warning', 'This restores the node to the selected revision and deletes the history newer than it. This cannot be undone.')}</p>
          <p class="mt-2 text-xs text-zinc-500">{formatPortalDateTime(restoreTarget.createdAt)}{restoreTarget.editedByUser?.handle ? ` · @${restoreTarget.editedByUser.handle}` : ''}</p>
          {#if historyError}<p role="alert" class="mt-2 text-xs text-red-500" data-testid="restore-error">{historyError}</p>{/if}
          <div class="mt-4 flex items-center justify-end gap-2">
            <button type="button" onclick={() => (restoreTarget = null)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('node.history.restore.cancel', 'Cancel')}</button>
            <button type="button" onclick={confirmRestore} disabled={writeLocked || historyBusy} class="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{historyBusy ? t('node.history.restore.working', 'Restoring…') : t('node.history.restore.confirm', 'Restore')}</button>
          </div>
        </div>
      </div>
    {/if}

    {#if clearConfirm}
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button type="button" class="absolute inset-0 cursor-default bg-black/30" aria-label={t('node.history.clear-dialog.cancel', 'Cancel')} onclick={() => (clearConfirm = false)}></button>
        <div class="relative w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-xl dark:border-red-900 dark:bg-zinc-900">
          <h3 class="text-sm font-semibold text-red-600 dark:text-red-400">{t('node.history.clear-dialog.heading', 'Clear all history?')}</h3>
          <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('node.history.clear-dialog.warning', 'This permanently deletes every saved revision of this node. The node itself is unchanged. This cannot be undone.')}</p>
          {#if historyError}<p class="mt-2 text-xs text-red-500">{historyError}</p>{/if}
          <div class="mt-4 flex items-center justify-end gap-2">
            <button type="button" onclick={() => (clearConfirm = false)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('node.history.clear-dialog.cancel', 'Cancel')}</button>
            <button type="button" onclick={confirmClear} disabled={readOnly || historyBusy} class="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">{historyBusy ? t('node.history.clear-dialog.working', 'Clearing…') : t('node.history.clear-dialog.confirm', 'Clear all')}</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ═══ SETTINGS TAB ═══ -->
    {#if activeTab === 'settings' || activeTab === 'info'}
      {@const readOnly = activeTab === 'info' || data.canWriteMemory === false || isCompiledPrompt}
      <div class="max-w-3xl space-y-8">
        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="font-semibold text-zinc-900 dark:text-white">Node</h2>
            {#if !isEditing && !readOnly}
              <div class="flex items-center gap-2">
                <button disabled={readOnly} onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
                <a href="{basePath}/graph?focus={node.id}" class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Graph</a>
              </div>
            {/if}
          </div>
          {#if updateMetaActionSuccess && !isEditing}
            <div role="status" class="mb-4 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{updateMetaActionSuccess}</div>
          {/if}

          {#if isEditing && !readOnly}
            <form method="POST" action="?/updateMeta" use:updateMetaEnhance novalidate
              class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
              <input type="hidden" name="_kind" bind:value={$updateMetaFormData._kind} />
              <input type="hidden" name="baseline" value={metaBaseline} />
              {#if moveRefusal || metaUnconfirmed || updateMetaActionError}
                <div role="alert" data-testid="node-meta-error" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{moveRefusal?.text ?? (metaUnconfirmed ? t('node.meta.unconfirmed', "The save wasn't confirmed. Check your connection, then Save again.") : updateMetaActionError)}</div>
              {/if}
              <div>
                <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                <input id="editName" name="name" type="text" required bind:value={$updateMetaFormData.name} class={inputClass} />
              </div>
              <div>
                <label for="editNodeType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="editNodeType" name="nodeType" bind:value={$updateMetaFormData.nodeType} class={inputClass}>
                  {#if !isCanonicalNodeType(node.nodeType)}
                    <option value={node.nodeType}>{node.nodeType}</option>
                  {/if}
                  {#each NODE_TYPES as nt}
                    <option value={nt}>{nt}</option>
                  {/each}
                </select>
              </div>
              <!-- #921: Node.role, an open string, distinct from the Type above. -->
              <NodeRoleInput bind:value={$updateMetaFormData.role} seed={$updateMetaFormData.roleSeed} {inputClass} />
              <div>
                <div class="mb-1 flex flex-wrap items-start justify-between gap-2">
                  <label for="editLoc" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN <span class="text-zinc-500">(changing this moves the node)</span></label>
                  <RefreshNodeLoc memoryId={node.memoryId} nodeId={node.id} savedName={node.name} savedLoc={node.loc}
                    name={$updateMetaFormData.name ?? ''} loc={$updateMetaFormData.loc ?? ''} disabled={$updateMetaSubmitting}
                    onrefresh={(loc) => { $updateMetaFormData.loc = loc; }} />
                </div>
                <div class="flex items-stretch">
                  <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.graph.urn}:</span>
                  <input id="editLoc" name="loc" type="text" bind:value={$updateMetaFormData.loc}
                    class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
                </div>
                {#if ($updateMetaFormData.loc ?? '') !== node.loc}
                  <p data-testid="node-loc-move-warning" class="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{t('node.meta.loc-move-warning', 'Saving moves this node and its children to the new URN. Links written as the old URN are not updated. Old URNs of minted nodes keep working; others may stop working.')}</p>
                {/if}
              </div>
              <div>
                <label for="editDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
                <textarea id="editDescription" name="description" rows="3" bind:value={$updateMetaFormData.description} placeholder="Short caption" class={inputClass}></textarea>
              </div>
              <div>
                <label for="editAlias" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Alias</label>
                <input id="editAlias" name="alias" type="text" bind:value={$updateMetaFormData.alias} placeholder="Optional" class={inputClass} />
              </div>
              <div>
                <label for="editSeq" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Seq <span class="text-zinc-500">(sort order)</span></label>
                <input id="editSeq" name="seq" type="number" bind:value={$updateMetaFormData.seq} placeholder="Optional" class={inputClass} />
              </div>
              <div>
                <label for="editTags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
                <input id="editTags" name="tags" type="text" bind:value={$updateMetaFormData.tags} class={inputClass} />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <input id="editIsRunnable" name="isRunnable" type="checkbox" value="true" bind:checked={$updateMetaFormData.isRunnable}
                    class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900" />
                  Is Runnable <span class="font-normal text-zinc-500">(can be run as a task by hadron_run_task)</span>
                </label>
              </div>
              <div class="flex gap-3">
                <button type="submit" disabled={readOnly || $updateMetaSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40">
                  {$updateMetaSubmitting ? t('node.meta.saving', 'Saving...') : $updateMetaMessage?.type === 'error' ? t('node.save.retry', 'Retry') : t('node.meta.save', 'Save')}
                </button>
                <button type="button" onclick={() => { isEditing = false; clearMetaRefusal(); reseedFromSavedNode(); }} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
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
              <!-- #921: Role and Object type are separate facts from Type, and
                   each is labelled as itself. Role always shows, "Not set"
                   included, so its absence is visible rather than assumed. -->
              <div class="flex items-center justify-between gap-4 px-5 py-3">
                <span class="shrink-0 text-sm text-zinc-500">{t('node.role.label', 'Role')}</span>
                <NodeRoleValue role={node.role} />
              </div>
              <NodeProvenanceRows result={provenance} revision={node.revision} />
              {#if node.objectType}
                <div class="flex items-center justify-between gap-4 px-5 py-3">
                  <span class="shrink-0 text-sm text-zinc-500">{t('node.object-type.label', 'Object type')}</span>
                  <span class="break-all font-mono text-sm text-zinc-900 dark:text-white">{node.objectType}</span>
                </div>
              {/if}
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
                <span class="text-sm text-zinc-900 dark:text-white">{formatPortalDate(node.createdAt)}</span>
              </div>
              {#if node.updatedAt}
                <div class="flex items-center justify-between px-5 py-3">
                  <span class="text-sm text-zinc-500">Updated</span>
                  <span class="text-sm text-zinc-900 dark:text-white">{formatPortalDate(node.updatedAt)}</span>
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <!-- Data now has its own top-level tab (Rendered/Source + editing);
             the former read-only block here would just duplicate it. -->

        <!-- Delete. #1834: no "Danger zone" caption for a single node; the confirm
             reads top to bottom, with the warning, the subtree choice, then the buttons. -->
        {#if !readOnly}
        <section class="border-t border-zinc-200 pt-6 dark:border-zinc-800">
          {#if !confirmDelete}
            <button disabled={readOnly} onclick={() => { $deleteFormData.hard = false; $deleteFormData.recursive = false; confirmDelete = true; }} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
              Delete node
            </button>
          {:else}
            <form method="POST" action="?/delete" use:deleteEnhance class="space-y-3" novalidate>
              <input type="hidden" name="_kind" value={$deleteFormData._kind} />
              <p class="text-sm text-red-500">{deleteNodeStrings.confirmPrompt(node.name)}</p>
              {#if deleteRefusedDescendants > 0}
                <label class="flex flex-wrap items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input type="checkbox" name="recursive" value="true" bind:checked={$deleteFormData.recursive}
                    class="rounded border-zinc-300 text-red-600 focus:ring-red-500 dark:border-zinc-600 dark:bg-zinc-800" />
                  {t('node-actions.delete.also-descendants', 'Also delete its descendants')}
                  <span class="text-xs text-amber-600 dark:text-amber-400">
                    {t('node-actions.delete.also-descendants.hint',
                      'Deleting this node deletes all {count} descendant node(s) with it.',
                      { count: deleteRefusedDescendants })}
                  </span>
                </label>
              {/if}
              <div class="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={readOnly || $deleteSubmitting}
                  class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >{$deleteSubmitting ? t('node-actions.delete.deleting', 'Deleting...') : 'Yes, delete'}</button>
                <button type="button" onclick={() => confirmDelete = false} class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
              </div>
            </form>
            {#if deleteActionError}
              <p role="alert" class="mt-2 text-xs text-red-500">{deleteActionError}</p>
            {/if}
          {/if}
        </section>
        {/if}
      </div>
    {/if}
      </div>
</div>
</div>

<!-- portal#696: attach a file to this node. Outside the page wrapper because it
     renders a fixed-position overlay, matching the Move/Clone dialogs.
     `invalidateAll()` on success rather than a local list update: the new
     reference node has to appear in the memory layout's node tree and in this
     node's Children tab, both of which come from loaders. -->
{#if !readOnly && canAttachAsset}
  <AttachAssetDialog
    bind:open={attachOpen}
    memoryId={node.memory?.id ?? data.graph.id}
    {memoryUrn}
    parentLoc={cleanLoc}
    acceptsUploads={canUploadToMemory(data.graph)}
    onattached={() => invalidateAll()}
  />
{/if}
