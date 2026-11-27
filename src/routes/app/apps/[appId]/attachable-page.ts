// Client-safe on purpose: the Add memory picker pages with this, and app-memories.ts pulls in server-only modules.
/** Rows per page of the attachable-memory picker; the server caps a page at 200. */
export const ATTACHABLE_PAGE_SIZE = 10;
/** The refusals the picker names; any other failure is the generic one. */
export type AttachableFailure = 'FORBIDDEN' | 'APP_UNINSTALLED' | 'UNAUTHENTICATED' | 'FAILED';
