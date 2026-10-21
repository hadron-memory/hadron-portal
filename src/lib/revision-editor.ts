/**
 * #1171 — who is behind a revision, for the History tab. The snapshot's
 * recorded editor is three independent facts: the user (`editedByUser`, or the
 * `editedByInfo` identity string when no user resolves), the Worker
 * (`editedByWorker`) and the Agent (`editedByAgent`, hadron-server #1610). The
 * last two are null on revisions captured before #1610 and on edits with no
 * agent behind them, so null is "no actor to show", never an empty chip.
 * Pure: no fetching, no DOM.
 */

export interface RevisionActor {
  id: string;
  name: string;
  urn: string | null;
}

export interface RevisionEditorInput {
  editedByUser?: { handle: string | null; urn: string | null } | null;
  editedByInfo?: string | null;
  editedByWorker?: RevisionActor | null;
  editedByAgent?: RevisionActor | null;
}

export interface RevisionEditorView {
  user: { handle: string | null; urn: string | null } | null;
  /** Identity string, shown only when no user resolves. */
  info: string | null;
  worker: RevisionActor | null;
  agent: RevisionActor | null;
  /** Everything the cell renders, so the table filter finds it. */
  searchText: string;
}

export function revisionEditorView(r: RevisionEditorInput): RevisionEditorView {
  const user = r.editedByUser?.handle || r.editedByUser?.urn ? r.editedByUser! : null;
  const info = user ? null : (r.editedByInfo ?? null);
  const worker = r.editedByWorker ?? null;
  const agent = r.editedByAgent ?? null;
  const searchText = [
    user?.handle ? `@${user.handle}` : '', user?.handle ?? '', user?.urn ?? '', info ?? '',
    worker?.name ?? '', worker?.urn ?? '', agent?.name ?? '', agent?.urn ?? '',
  ].filter(Boolean).join(' ');
  return { user, info, worker, agent, searchText };
}
