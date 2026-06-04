/**
 * Spec 011-create-node-on-portal — i18n strings + typed-error mapping for
 * the node-creation form.
 *
 * Pattern matches `app-member-errors.ts` (spec 008) and `install-strings.ts`
 * (spec 009): user-visible strings route through `t(id, defaultText)` per
 * Constitution Principle III; typed server errors are mapped via
 * `extensions.code` to friendly copy.
 */

import { t } from './t';

interface GqlErrorLike {
  message?: string;
  response?: {
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  };
}

export const createNodeStrings = {
  /** Affordance label on memory-detail and node-detail pages. */
  newNodeButton: (): string => t('create-node.button.new-node', '+ New node'),
  addChildButton: (): string => t('create-node.button.add-child', '+ Add child'),

  /** Form labels. */
  fieldName: (): string => t('create-node.field.name', 'Name'),
  fieldLoc: (): string => t('create-node.field.loc', 'Loc (address)'),
  fieldNodeType: (): string => t('create-node.field.node-type', 'Type'),
  fieldDescription: (): string => t('create-node.field.description', 'Description'),
  fieldAbstract: (): string => t('create-node.field.abstract', 'Abstract'),
  fieldContent: (): string => t('create-node.field.content', 'Content'),
  fieldParent: (): string => t('create-node.field.parent', 'Parent'),

  /** Hint text shown under the loc field. */
  locHint: (): string =>
    t(
      'create-node.hint.loc',
      'Each segment may contain only letters, digits, hyphens, and underscores. Segments are separated by colons.',
    ),

  /** Advanced-types toggle label. */
  advancedToggle: (): string =>
    t('create-node.toggle.advanced-types', 'Show advanced types'),

  /** Submit button. */
  submit: (): string => t('create-node.button.submit', 'Create node'),
  submitting: (): string => t('create-node.button.submitting', 'Creating…'),

  /** Empty-state copy when the user lacks write access. */
  noWriteAccess: (): string =>
    t(
      'create-node.error.no-write-access',
      "You don't have write access to this memory. Ask the memory's owner to add you as a writer.",
    ),

  /** Generic fallback when the server returns an error we don't recognize. */
  genericError: (): string =>
    t(
      'create-node.error.generic',
      "Couldn't create the node. Please try again — if the problem persists, contact support.",
    ),

  /** Validation: empty name. */
  errorNameRequired: (): string =>
    t('create-node.error.name-required', 'Name is required.'),

  /** Validation: empty loc. */
  errorLocRequired: (): string =>
    t('create-node.error.loc-required', 'Loc is required.'),

  /** Node-detail tab strip — empty-state authoring surfaces (#256). */
  emptyBadge: (): string => t('node-detail.badge.empty', 'empty'),
  contentSourcePlaceholder: (): string =>
    t('node-detail.content.source-placeholder', "The node's primary body, written in Markdown."),
  contentEmptyTitle: (): string =>
    t(
      'node-detail.content.empty-title',
      "No content yet. Content is the node's primary body, rendered as Markdown.",
    ),
  contentEmptyCta: (): string => t('node-detail.content.empty-cta', 'Write content'),
};

/**
 * Pull the typed error code (set by the server's
 * `extensions.code = ErrorName`) out of a thrown GraphQL error.
 */
export function createNodeErrorCode(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const errs = (e as GqlErrorLike).response?.errors;
  return errs?.[0]?.extensions?.code ?? null;
}

/**
 * Translate a thrown create-node error to a friendly user-facing string.
 * Falls back to the GraphQL error message when the code is unrecognised,
 * and finally to a generic message when the input doesn't look like a
 * GraphQL error at all.
 *
 * Recognized codes:
 *  - `NodeLocConflictError` — a node with this loc already exists.
 *  - `InvalidLocError` — the loc fails server-side validation.
 *  - `MemoryNotFoundError` — the memory was removed between page load and
 *    submit.
 *  - `Forbidden` / no-write access — the user doesn't have write
 *    permission. (The route's `load` should surface this earlier; this is
 *    a defense-in-depth mapping.)
 */
export function translateCreateNodeError(e: unknown): string {
  const code = createNodeErrorCode(e);
  switch (code) {
    case 'NodeLocConflictError':
      return t(
        'create-node.error.loc-conflict',
        'A node with this loc already exists. Try a different name or loc.',
      );
    case 'InvalidLocError':
      return t(
        'create-node.error.invalid-loc',
        'Loc segments may only contain letters, digits, hyphens, and underscores.',
      );
    case 'MemoryNotFoundError':
      return t(
        'create-node.error.memory-not-found',
        'This memory no longer exists. Try refreshing the page.',
      );
    case 'Forbidden':
      return createNodeStrings.noWriteAccess();
    default: {
      const errs = (e as GqlErrorLike)?.response?.errors;
      if (errs?.[0]?.message) return errs[0].message;
      if (e instanceof Error) return e.message;
      return createNodeStrings.genericError();
    }
  }
}

/**
 * HTTP status for a SvelteKit `fail(...)` based on the typed error.
 */
export function createNodeErrorStatus(e: unknown): number {
  switch (createNodeErrorCode(e)) {
    case 'NodeLocConflictError':
      return 409;
    case 'InvalidLocError':
      return 400;
    case 'MemoryNotFoundError':
      return 404;
    case 'Forbidden':
      return 403;
    default:
      return 500;
  }
}
