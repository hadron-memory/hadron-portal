import { ORGANIZATIONS_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';

export interface TesterManagerOptions {
  /**
   * The server's answer to "may the caller manage this Agent?".
   * `true` (default): a manager. `false`: a non-manager. `null`: a null
   * `effectiveAccess`. `'fail'`: the read throws `upstream 503`.
   */
  canManage?: boolean | null | 'fail';
  /** Agents the caller can see through one organisation, for suites that drive the Tester without mocking the lookup. */
  visibleAgentIds?: string[];
}

/**
 * portal#2083: every Tester surface now asks the server whether the caller can
 * MANAGE the Agent before admitting them. A suite that is about something else
 * (fixtures, replay, the AI config) wraps its mocked GraphQL `request` in this
 * so the caller is a manager, and the manage question never reaches the suite's
 * own routing. The denial and failure cases are pinned in
 * `src/lib/server/agent-tester/manager-only-2083.test.ts`, which does not use it.
 *
 * It intercepts exactly two queries and nothing else: SELF_CAN_MANAGE_QUERY
 * (always), and ORGANIZATIONS_QUERY only when `visibleAgentIds` is non-empty.
 * Every other query falls through to `request`.
 */
export function asTesterManager(
  request: (query: string, vars?: unknown) => Promise<unknown>,
  { canManage = true, visibleAgentIds = [] }: TesterManagerOptions = {},
) {
  return async (query: string, vars?: unknown): Promise<unknown> => {
    if (query === SELF_CAN_MANAGE_QUERY) {
      if (canManage === 'fail') throw new Error('upstream 503');
      return { effectiveAccess: canManage === null ? null : { canManage } };
    }
    if (query === ORGANIZATIONS_QUERY && visibleAgentIds.length > 0) {
      const agents = visibleAgentIds.map((id) => ({ id, urn: `hrn:agent:test:${id}`, organizationId: 'org-test', systemMemoryId: `sys-${id}` }));
      return { organizations: { items: [{ id: 'org-test', name: 'Org', urn: 'hrn:org:test', agents }], total: 1 } };
    }
    return request(query, vars);
  };
}
