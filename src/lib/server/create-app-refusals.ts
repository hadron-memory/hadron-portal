/**
 * Existing createApp refusals from the landed server, not a catch-all 4xx
 * rule (#1397: the two install surfaces — /app/apps/new and the org agent
 * install page — carried byte-identical copies of this list; one drifts the
 * moment someone extends the other). A code here means extractGqlError may
 * show the server's intentional refusal text instead of the generic envelope.
 */
export const CREATE_APP_REFUSALS = [
  'BAD_USER_INPUT',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'AGENT_NOT_FOUND',
  'ORGANIZATION_NOT_FOUND',
  'ORGANIZATION_MISMATCH',
  'INSTALL_MEMORIES_REMAIN',
  'URN_NOT_QUALIFIED',
] as const;
