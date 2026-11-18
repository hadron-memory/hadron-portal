/**
 * #1335 — `clonedFromAgentRef` is selected by the Agent DETAIL query only.
 *
 * AGENT_FIELDS is spread into list and mutation documents, so selecting the
 * scalar there would widen queries outside the detail page (and fail them on a
 * server that predates hadron-server#2281). `gql:validate` cannot see a field
 * that is in the wrong document, so this pins where it is and where it is not.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_FIELDS, AGENT_QUERY, CLONE_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from './queries';

const operation = (doc: string) => doc.slice(doc.indexOf('query Agent') >= 0 ? doc.indexOf('query Agent') : 0);

describe('#1335 clonedFromAgentRef selection', () => {
  it('is selected by the detail query, beside the shared fragment', () => {
    expect(operation(AGENT_QUERY)).toMatch(/agent\(ref: \$ref\) \{[^}]*\.\.\.AgentFields[^}]*clonedFromAgentRef[^}]*\}/);
  });

  it('is NOT in the shared fragment, the update mutation or the clone mutation', () => {
    expect(AGENT_FIELDS).not.toContain('clonedFromAgentRef');
    expect(UPDATE_AGENT_MUTATION).not.toContain('clonedFromAgentRef');
    expect(CLONE_AGENT_MUTATION).not.toContain('clonedFromAgentRef');
  });
});
