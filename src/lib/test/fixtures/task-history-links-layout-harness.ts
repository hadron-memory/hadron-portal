// portal#1711: mounts the real TaskHistory for scripts/test-task-history-links-layout.mjs.
// Loaded through Vite so the compiled Tailwind applies: jsdom computes no `pointer-coarse:`
// heights and measures no overflow. Every link kind is on the page — run link, external
// https anchor (long enough to wrap), node-URN chip, sibling seat task anchor, and a long
// text value — so the probe measures each anchor the change owns.
import { mount } from 'svelte';
import TaskHistory from '../../components/agent-tasks/TaskHistory.svelte';

const LONG_URL = `https://github.com/hadron-memory/hadron-server-private/pull/36#issuecomment-${'6781474000'.repeat(6)}`;
const LONG_TEXT = `not-a-url-${'x'.repeat(96)}`;
const NODE_URN = 'hrn:node:acme.com:reviews:aurora-verdict-2026-11-05-final';
// portal#1922 BLIND P3-4: a node URN long enough that the shared chip must wrap
// it at 390px — the wrap itself is measured here, not asserted in jsdom. Built
// from many short atoms: the grammar caps one atom at 64 chars, so one long
// atom would not parse and would render as text, not a chip.
const LONG_NODE_URN = `hrn:node:acme.com:reviews:${Array.from({ length: 8 }, () => 'aurora-verdict-2026-11-05').join(':')}:final`;
const SEAT_TASK = '0123456789abcdef0123456789abcdef';

const base = {
  severity: null,
  actor: null,
  actorRunId: null,
  subjectWorker: null,
  wakes: [],
  acknowledgedAt: null,
  acknowledgedBy: null,
};

export function mountTaskHistory(target: HTMLElement) {
  return mount(TaskHistory, { target, props: {
    basePath: '/app/apps/a',
    events: [
      // A run actor names the run (in-app anchor) and freezes a very long PR url.
      { ...base, id: 'e1', createdAt: '2026-11-05T10:00:00.000Z', actorRunId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: LONG_URL } },
      // A verdict links the review node (shared Urn chip) and its receipt url.
      { ...base, id: 'e2', createdAt: '2026-11-05T10:05:00.000Z', type: 'review.verdict', payload: { verdict: 'APPROVE', slot: 'BLIND', head: '92bc8add2930cc83', node: NODE_URN, receipt: 'https://github.com/o/r/pull/1#issuecomment-6781092761' } },
      // The same with a node URN long enough to wrap the shared chip at 390px.
      { ...base, id: 'e5', createdAt: '2026-11-05T10:06:00.000Z', type: 'review.verdict', payload: { verdict: 'REJECT', slot: 'QA', head: '92bc8add2930cc83', node: LONG_NODE_URN, receipt: null } },
      // A superseded sibling seat task, by its exact 32-hex id.
      { ...base, id: 'e3', createdAt: '2026-11-05T10:10:00.000Z', type: 'review.seat.assigned', payload: { slot: 'LOCAL', head: '92bc8add2930cc83', supersedes: SEAT_TASK } },
      // A value that is neither url nor URN: long text that must wrap, never overflow.
      { ...base, id: 'e4', createdAt: '2026-11-05T10:15:00.000Z', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: LONG_TEXT } },
    ],
  } });
}
