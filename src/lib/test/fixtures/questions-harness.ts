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
  priority: 'HIGH', tier: 'DEFAULT', askedAt: '2026-11-20T10:00:00Z', answeredAt: null, revSeq: 1, viewerMayAnswer: true, answer: null,
  effectiveAssignee: person('u2', 'Bob'), askedBy: { user: null, worker, app: null }, ...over,
});
const ok = (items: unknown[], total = items.length) => ({ kind: 'ok', value: { total, items } });
const nav = (count: number, total: number) => ({ offset: 0, count, total, previousHref: null, nextHref: count < total ? '/app/apps/app-1/questions?offset=50' : null });
const people = { people: [person('u1', 'Ada'), person('u2', 'Bob')], withheld: false, failed: false };
const filter = { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 };

const rows = [
  row(1),
  row(2, { effectiveAssignee: null, priority: 'URGENT', askedBy: { user: null, worker: longWorker, app: null } }),
  row(3, { state: 'DECIDED', answered: true, answeredAt: '2026-11-21T09:00:00Z', answer: { key: 'wait-for-all-regions', text: null, at: '2026-11-21T09:00:00Z' } }),
  row(4, { state: 'WITHDRAWN', priority: 'LOW', askedBy: { user: person('u3', 'Cleo'), worker: null, app: null } }),
  row(5, { state: 'ANSWERED_UNCONFIRMED', answered: true, answer: { key: null, text: 'a free-text answer', at: '2026-11-21T09:00:00Z' }, askedAt: null }),
];
const views: Record<string, unknown> = {
  list: { app, filter, viewerId: 'u1', impersonating: null, questions: ok(rows, 120), logs: null, people, navigation: nav(5, 120) },
  'empty-no-log': { app, filter, viewerId: 'u1', impersonating: null, questions: ok([]), logs: { kind: 'ok', value: [] }, people, navigation: nav(0, 0) },
  'empty-no-match': { app, filter: { ...filter, status: 'answered' }, viewerId: 'u1', impersonating: null, questions: ok([]), logs: { kind: 'ok', value: [{ id: 'l1' }] }, people, navigation: nav(0, 0) },
  failed: { app, filter, viewerId: 'u1', impersonating: null, questions: { kind: 'failed' }, logs: null, people, navigation: null },
};

export function mountQuestions(target: HTMLElement, view: string) {
  if (!views[view]) throw new Error(`unknown view ${view}`);
  mount(QuestionsPage as never, { target, props: { data: views[view] } as never });
}
export const QUESTION_VIEWS = Object.keys(views);
