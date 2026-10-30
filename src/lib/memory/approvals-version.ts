/**
 * Context key for the memory layout's `approvalsVersion` (a getter). The memory
 * layout bumps it after an approve-all or a mint; the `(browser)` group's layout
 * hosts the MemoryBrowser and passes it as `refreshKey` (portal#1433).
 */
export const MEMORY_APPROVALS_VERSION = Symbol('memory-approvals-version');
