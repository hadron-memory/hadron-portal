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
      // A superseded sibling seat task, by its exact 32-hex id.
      { ...base, id: 'e3', createdAt: '2026-11-05T10:10:00.000Z', type: 'review.seat.assigned', payload: { slot: 'LOCAL', head: '92bc8add2930cc83', supersedes: SEAT_TASK } },
      // A value that is neither url nor URN: long text that must wrap, never overflow.
      { ...base, id: 'e4', createdAt: '2026-11-05T10:15:00.000Z', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: LONG_TEXT } },
    ],
  } });
}
