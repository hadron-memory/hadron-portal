/**
 * #1914 (hadron-server#3878): the task detail view renders the address the server serves.
 * The selection is pinned on the real detail query (structure, not the word), and the `Urn`
 * chip is rendered for a served task URN to show it displays, links to the resolver and
 * copies the same string.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Urn from '$lib/components/Urn.svelte';
import { selectsFieldPath } from '$lib/test/graphql-selection';
import { AGENT_TASK_DETAIL_QUERY, AGENT_TASKS_BOARD_QUERY } from '$lib/server/queries';

const TASK_URN = 'hrn:agenttask:hadronmemory.com:hadron-dev-team:at3.405';

describe('task URN (#1914)', () => {
  it('is selected by the detail query', () => {
    expect(selectsFieldPath(AGENT_TASK_DETAIL_QUERY, 'AgentTaskDetail', ['agentTask', 'urn'])).toBe(true);
  });

  it('is not asked for by the board, whose rows do not render it', () => {
    expect(selectsFieldPath(AGENT_TASKS_BOARD_QUERY, 'AgentTasksBoard', ['agentTasks', 'urn'])).toBe(false);
  });

  it('renders as a chip that links to the resolver with the served spelling', () => {
    const out = render(Urn, { props: { value: TASK_URN, type: 'agenttask', linked: true } }).body;
    expect(out).toContain('at3.405');
    expect(out).toContain(`href="/app/u/${TASK_URN}"`);
  });
});
