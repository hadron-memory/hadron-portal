/**
 * portal#1665: the served-record view model, shared by `/api/served-prompts` and the
 * component that renders it. A served record (hrn:node:hadronmemory.com:specs:cor:agt:040:03) names WHAT a bind, run or
 * chat was given: ids, revisions, hashes and the recorded variables. Never text.
 */

export type ServedPromptSource = 'worker' | 'session' | 'run' | 'chat';

/** Records per page, provenance entries per page, lint warnings per page (issue Ask 6). */
export const SERVED_RECORD_PAGE = 5;
export const SERVED_PROVENANCE_PAGE = 20;
export const SERVED_LINT_PAGE = 20;

export interface ServedProvenanceEntry { revSeq: number; hash: string; pruned: boolean }
export interface ServedLintWarning {
  kind: string;
  position: number;
  pinnedRevision: number | null;
  newerRevision: number | null;
  workerField: string | null;
  targetUrn: string | null;
}

export interface ServedPromptView {
  id: string;
  kind: 'BIND' | 'CHAT' | 'RUN';
  ordinal: number;
  pointerLevel: 'AGENT' | 'APP_AGENT' | 'WORKER';
  servedAt: string;
  servedRevSeq: number;
  provenanceRevSeq: number;
  pruned: boolean;
  compiledContentHash: string;
  variables: unknown;
  /** Only from an independent read of the compiled node as the viewer; null when unavailable. */
  node: { urn: string; name: string } | null;
  provenance: { items: ServedProvenanceEntry[]; total: number; offset: number };
  /** null = the server reports lint unavailable; never "no warnings". */
  lint: { items: ServedLintWarning[]; total: number; nextCursor: string | null } | null;
}

export interface ServedPromptsResponse {
  items: ServedPromptView[];
  total: number;
  offset: number;
}

/** What a section shows for a pointer level; the copy never names which level DECIDES for a refusal. */
export const POINTER_LEVEL_LABEL: Record<ServedPromptView['pointerLevel'], string> = {
  WORKER: 'Worker',
  APP_AGENT: 'App',
  AGENT: 'Agent',
};

/** The "x–y of total" line; null when the page is empty. */
export function pageRange(offset: number, count: number, total: number): string | null {
  return count > 0 ? `${offset + 1}–${offset + count} of ${total}` : null;
}

/** A page is complete only when it reaches the total (the provider has no hasMore). */
export function hasMore(offset: number, count: number, total: number): boolean {
  return offset + count < total;
}

/** The session pick counts only while it is a row of THIS worker's list (the page is reused A to B). */
export function pickedSessionFor(sessions: ReadonlyArray<{ id: string }> | null | undefined, picked: string | null): string | null {
  return picked !== null && sessions?.some((s) => s.id === picked) ? picked : null;
}
