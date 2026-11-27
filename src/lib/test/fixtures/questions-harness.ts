// portal#2235: mounts the real Questions page for scripts/test-questions-layout.mjs. Loaded through Vite, so `$lib` aliases and
// each component's own Svelte compile apply. The data is long on purpose (a long title, a long worker URN, many people), since
// that is what pushes a phone wide.
import { mount } from 'svelte';
import QuestionsPage from '../../../routes/app/apps/[appId]/questions/+page.svelte';

const app = { id: 'app-1', name: 'Product Team with a fairly long App name', urn: 'hrn:app:hadronmemory.com:hadron-dev-team', organizationId: null };
const person = (id: string, name: string) => ({ id, name, handle: name.toLowerCase() });
const worker = { id: 'w1', name: 'Beryl', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:beryl' };
const longWorker = { id: 'w2', name: 'A worker with a very long display name', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:a-worker-with-an-unbroken-and-very-long-slug-that-keeps-going-and-going' };
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `q${n}`, urn: `hrn:node:hadronmemory.com:hadron-dev-team:questions:q-${n}`, portalUrl: `https://hadronmemory.com/app/u/q-${n}`,
  code: `Q-${n}`, title: 'Should the release wait for the migration to finish on every region before we announce it?', state: 'OPEN', answered: false,
  priority: 'HIGH', tier: 'DEFAULT', askedAt: '2026-11-20T10:00:00Z', answeredAt: null, revSeq: 1, answer: null,
  effectiveAssignee: person('u2', 'Bob'), askedBy: { user: null, worker, app: null }, ...over,
});
const ok = (items: unknown[], total = items.length) => ({ kind: 'ok', value: { total, items } });
const nav = (count: number, total: number) => ({ offset: 0, count, total, previousHref: null, nextHref: count < total ? '/app/apps/app-1/questions?offset=50' : null });
const people = { people: [person('u1', 'Ada'), person('u2', 'Bob')], withheld: false, failed: false };
const LOG = {
  id: 'l1', urn: 'hrn:node:hadronmemory.com:hadron-dev-team:questions', name: 'Questions', memoryId: 'm1', prefix: 'Q', portalUrl: 'https://hadronmemory.com/app/u/q',
  defaultDeciders: [person('u1', 'Ada'), person('u2', 'A person with a very long display name that keeps going'), person('u3', 'Cleo')], eligibleDeciders: [], revSeq: 1,
};
const memories = [
  { id: 'm1', name: 'Team notes and runbooks with a rather long memory name', urn: 'hrn:mem:hadronmemory.com:team-notes-and-runbooks-with-a-rather-long-memory-name' },
  { id: 'm2', name: 'Runbooks', urn: 'hrn:mem:hadronmemory.com:runbooks' },
];
const setup = { memories, deciders: { people: [person('u1', 'Ada'), person('u2', 'A person with a very long display name that keeps going'), person('u3', 'Cleo')], fixed: false }, viewer: person('u1', 'Ada') };
const filter = { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 };

const rows = [
  row(1),
  row(2, { effectiveAssignee: null, priority: 'URGENT', askedBy: { user: null, worker: longWorker, app: null } }),
  row(3, { state: 'DECIDED', answered: true, answeredAt: '2026-11-21T09:00:00Z', answer: { key: 'wait-for-all-regions', text: null, at: '2026-11-21T09:00:00Z' } }),
  row(4, { state: 'WITHDRAWN', priority: 'LOW', askedBy: { user: person('u3', 'Cleo'), worker: null, app: null } }),
  row(5, { state: 'ANSWERED_UNCONFIRMED', answered: true, answer: { key: null, text: 'a free-text answer', at: '2026-11-21T09:00:00Z' }, askedAt: null }),
];
const views: Record<string, unknown> = {
  list: { app, filter, viewerId: 'u1', impersonating: null, questions: ok(rows, 120), logs: { kind: 'ok', value: [LOG] }, setup: null, people, navigation: nav(5, 120) },
  'empty-no-log': { app, filter, viewerId: 'u1', impersonating: null, questions: ok([]), logs: { kind: 'ok', value: [] }, setup, people, navigation: nav(0, 0) },
  'setup-single': { app, filter, viewerId: 'u1', impersonating: null, questions: ok([]), logs: { kind: 'ok', value: [] }, setup: { ...setup, memories: [memories[0]] }, people, navigation: nav(0, 0) },
  'setup-withheld': { app, filter, viewerId: 'u1', impersonating: null, questions: ok([]), logs: { kind: 'ok', value: [] }, setup: { ...setup, deciders: { people: [person('u1', 'Ada')], fixed: true } }, people: { people: [], withheld: true, failed: false }, navigation: nav(0, 0) },
  'empty-no-match': { app, filter: { ...filter, status: 'answered' }, viewerId: 'u1', impersonating: null, questions: ok([]), logs: { kind: 'ok', value: [LOG] }, setup: null, people, navigation: nav(0, 0) },
  failed: { app, filter, viewerId: 'u1', impersonating: null, questions: { kind: 'failed' }, logs: null, setup: null, people, navigation: null },
};

export function mountQuestions(target: HTMLElement, view: string) {
  if (!views[view === 'setup-refused' ? 'empty-no-log' : view]) throw new Error(`unknown view ${view}`);
  // The refusal view carries an action result, as the page does after a refused POST.
  const form = view === 'setup-refused' ? { createLog: { error: 'One of the people you chose cannot write that memory, so they cannot decide there. Give them write access first, or leave them out.' } } : null;
  mount(QuestionsPage as never, { target, props: { data: views[view === 'setup-refused' ? 'empty-no-log' : view], form } as never });
}
