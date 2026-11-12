/**
 * portal#2068: the member-roles form's Superforms id is scoped to the Agent
 * whose roles it holds. Superforms hands a page action result to the form whose
 * id matches it, so a fixed id let a late result for Agent A seed Agent B's
 * freshly mounted editor and enable Save with A's values.
 *
 * The key is the Agent id the LOADER read from the server, never the route
 * string: `/app/agents/<id>` and `/app/agents/<urn>` are one Agent
 * (hrn:node:hadronmemory.com:specs:cor:urn:010:01, normalising a URN is the
 * server's job). Superforms stamps an action's result with the id the form posted, so a
 * result carries the identity of the form that asked.
 */
const PREFIX = 'updateMemberRoles';

export const memberRolesFormId = (agentId: string): string => `${PREFIX}:${agentId}`;
