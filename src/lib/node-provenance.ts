/**
 * #914 — authorship and advisory content validation, as the server reports
 * them (server #1326, merged through PR #1397), turned into what the portal
 * renders. Pure: no fetching, no DOM.
 *
 * What the contract does and does not say, and so what this may and may not
 * claim:
 *
 * - `authorship` null means "legacy or unknown". It is not "written by nobody",
 *   and it is not an error.
 * - A TASK stamp says which task (and which revision of it) a write was made
 *   with. It does NOT say the content follows that task, so nothing here reads
 *   it as compliance. An older task revision is still valid historical
 *   authorship, so there is no "outdated" state.
 * - The server redacts `taskRef` and `taskRevision` TOGETHER when the task is
 *   deleted or its memory isn't readable to the viewer, and it does not say
 *   which. So a redacted task is "not available to you", never "deleted".
 * - A task is linked only through `/app/u/<urn>`, which re-resolves with
 *   access control and 404s anything the viewer can't read. Only the URN is
 *   shown; the task's content is never fetched here.
 * - Content validation is ADVISORY. A failed or stale report neither blocks
 *   editing nor reads as an error. It is also not schema/platform validation.
 */

import { t } from '$lib/i18n/t';

export type NodeAuthorshipKind = 'TASK' | 'HUMAN';

export interface NodeAuthorship {
  kind: NodeAuthorshipKind;
  taskRef: string | null;
  taskRevision: number | null;
  human: { handle: string | null; urn: string | null } | null;
  authoredAt: string;
}

export type NodeContentValidationOutcome = 'PASS' | 'FAIL' | 'ERROR';
export type NodeContentValidationState = 'UNVALIDATED' | 'STALE' | NodeContentValidationOutcome;

export interface NodeContentValidationReport {
  nodeRevision: number;
  validationTaskRef: string | null;
  validationTaskRevision: number | null;
  outcome: NodeContentValidationOutcome;
  reportedAt: string;
}

export interface NodeContentValidationStatus {
  state: NodeContentValidationState;
  latestReport: NodeContentValidationReport | null;
}

/** What one provenance read returns, for a node or for one of its revisions. */
export interface NodeProvenance {
  id: string;
  /**
   * Set on the NODE's provenance: the live revision the stamps belong to. The
   * loader accepts them only when it equals the revision the page rendered
   * (Codex on #956), since this read runs after the node read and a concurrent
   * edit in between would otherwise pair one revision's content with the
   * next revision's authorship and validation.
   */
  revision?: number;
  /** Set on a revision's provenance: the revision number the row snapshots. */
  revNo?: number | null;
  authorship: NodeAuthorship | null;
  contentValidation: NodeContentValidationStatus;
}

/**
 * A streamed read that may have failed. A plain failure renders as "couldn't
 * load"; `changed` means the read succeeded but described a newer revision than
 * the page shows, so it is withheld rather than shown beside older content.
 */
export type ProvenanceResult<T> = { ok: true; value: T } | { ok: false; changed?: true };

export interface TaskLink {
  urn: string;
  href: string;
  revision: number | null;
}

/**
 * A task reference the portal may link. The server emits a node URN; anything
 * else is refused rather than turned into a link to somewhere unintended.
 */
export function taskLink(ref: string | null | undefined, revision: number | null | undefined): TaskLink | null {
  if (typeof ref !== 'string' || !/^hrn:node:\S+$/.test(ref)) return null;
  return { urn: ref, href: `/app/u/${ref}`, revision: revision ?? null };
}

export type AuthorshipView =
  | { kind: 'task'; task: TaskLink; authoredAt: string }
  | { kind: 'task-unavailable'; authoredAt: string }
  | { kind: 'human'; handle: string | null; urn: string | null; authoredAt: string }
  | { kind: 'none' };

export function authorshipView(a: NodeAuthorship | null | undefined): AuthorshipView {
  if (!a) return { kind: 'none' };
  if (a.kind === 'TASK') {
    const task = taskLink(a.taskRef, a.taskRevision);
    return task ? { kind: 'task', task, authoredAt: a.authoredAt } : { kind: 'task-unavailable', authoredAt: a.authoredAt };
  }
  if (a.kind === 'HUMAN') {
    const handle = a.human?.handle?.trim() || null;
    const urn = a.human?.urn?.trim() || null;
    return { kind: 'human', handle, urn, authoredAt: a.authoredAt };
  }
  // A kind this build doesn't know: say nothing rather than guess.
  return { kind: 'none' };
}

export type ValidationTone = 'neutral' | 'pass' | 'attention';

export interface ValidationView {
  state: NodeContentValidationState | 'UNAVAILABLE' | 'CHANGED';
  tone: ValidationTone;
  /** The report behind the state, when there is one. */
  report: NodeContentValidationReport | null;
  /** The revision the report checked, when it isn't the revision on screen. */
  checkedRevision: number | null;
  task: TaskLink | null;
}

const KNOWN_STATES: readonly NodeContentValidationState[] = ['UNVALIDATED', 'STALE', 'PASS', 'FAIL', 'ERROR'];

export function validationView(
  result: ProvenanceResult<NodeContentValidationStatus | null | undefined>,
): ValidationView {
  if (!result.ok) {
    return { state: result.changed ? 'CHANGED' : 'UNAVAILABLE', tone: 'neutral', report: null, checkedRevision: null, task: null };
  }
  if (!result.value || !KNOWN_STATES.includes(result.value.state)) {
    return { state: 'UNAVAILABLE', tone: 'neutral', report: null, checkedRevision: null, task: null };
  }
  const { state, latestReport } = result.value;
  const report = state === 'UNVALIDATED' ? null : latestReport;
  const tone: ValidationTone = state === 'PASS' ? 'pass' : state === 'FAIL' || state === 'ERROR' ? 'attention' : 'neutral';
  return {
    state,
    tone,
    report,
    checkedRevision: state === 'STALE' && report ? report.nodeRevision : null,
    task: report ? taskLink(report.validationTaskRef, report.validationTaskRevision) : null,
  };
}

/**
 * Bind the node's provenance to the revision the page rendered. A read for a
 * different revision is withheld as `changed`, never shown beside content it
 * doesn't describe. A missing revision can't be checked, so it's withheld too.
 */
export function bindToRevision(
  result: ProvenanceResult<NodeProvenance>,
  shownRevision: number | null | undefined,
): ProvenanceResult<NodeProvenance> {
  if (!result.ok) return result;
  if (shownRevision == null || result.value.revision == null || result.value.revision !== shownRevision) {
    return { ok: false, changed: true };
  }
  return result;
}

/** Index a provenance list by row id, for the History grid. */
export function provenanceById(items: NodeProvenance[]): Map<string, NodeProvenance> {
  return new Map(items.map((p) => [p.id, p]));
}

// ── Text ─────────────────────────────────────────────────────────────────────
// One definition of the words, shared by the component and the History grid's
// accessors, so what a row shows is what its search matches.

export function authorshipText(v: AuthorshipView): string {
  switch (v.kind) {
    case 'task':
      return v.task.revision != null
        ? t('node.authorship.task-rev', 'Written with {task} (revision {rev})', { task: v.task.urn, rev: v.task.revision })
        : t('node.authorship.task', 'Written with {task}', { task: v.task.urn });
    case 'task-unavailable':
      return t('node.authorship.task-unavailable', "Written with a task that isn't available to you");
    case 'human':
      return v.handle
        ? t('node.authorship.human', 'Edited by @{handle}', { handle: v.handle })
        : t('node.authorship.human-unknown', 'Edited by a person');
    case 'none':
      return t('node.authorship.none', 'No authorship recorded');
  }
}

/** What an authorship cell shows, INCLUDING the URN chip, for grid search. */
export function authorshipSearchText(v: AuthorshipView): string {
  const urn = v.kind === 'task' ? v.task.urn : v.kind === 'human' ? v.urn : null;
  return urn ? `${authorshipText(v)} ${urn}` : authorshipText(v);
}

export function validationText(v: ValidationView): string {
  switch (v.state) {
    case 'UNAVAILABLE':
      return t('node.validation.unavailable', "Couldn't load");
    case 'CHANGED':
      return t('node.provenance.changed', 'Changed since this page loaded. Reload to see it.');
    case 'UNVALIDATED':
      return t('node.validation.unvalidated', 'Not validated');
    case 'PASS':
      return t('node.validation.pass', 'Passed');
    case 'FAIL':
      return t('node.validation.fail', "Didn't pass");
    case 'ERROR':
      return t('node.validation.error', "Couldn't complete");
    case 'STALE':
      return v.checkedRevision != null
        ? t('node.validation.stale-rev', 'Out of date (last checked at revision {rev})', { rev: v.checkedRevision })
        : t('node.validation.stale', 'Out of date');
  }
}
