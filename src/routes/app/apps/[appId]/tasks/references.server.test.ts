/**
 * portal#1575 — what the create and edit actions send for a task's references
 * (hadron-server#3112; hrn:node:hadronmemory.com:specs:cor:agt:050:09).
 *
 * Edit is a strict patch: after any change the WHOLE ordered list goes, `[]`
 * when the last one was removed, and nothing at all when references weren't
 * touched. Create sends the list when there is one. A server BAD_USER_INPUT
 * comes back verbatim with the reader's values, the list included, and a
 * target is never rewritten on the way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASKS_APP_QUERY,
  AGENT_TASK_REF_QUERY,
  CREATE_AGENT_TASK_MUTATION,
  UPDATE_AGENT_TASK_MUTATION,
} from '$lib/server/queries';

const request = vi.fn();
const rawRequest = vi.fn();
const delegate = async (q: string, v: unknown) => ({ data: await request(q, v), extensions: undefined, status: 200 });
const gated = async (q: string, v?: unknown) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AGENT_TASK_REF_QUERY) return { agentTask: { id: (v as { ref: string }).ref, appId: 'app-1' } };
  return request(q, v);
};
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: gated, rawRequest }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const REFUSAL = 'references[1].target: a NODE target must be a node URN';
const badInput = () => ({ response: { errors: [{ message: REFUSAL, extensions: { code: 'BAD_USER_INPUT' } }] } });

beforeEach(() => {
  request.mockReset();
  rawRequest.mockReset();
  rawRequest.mockImplementation(delegate);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function event(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return {
    request: { formData: async () => fd },
    params: { appId: 'app-1', taskId: 't1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
  } as never;
}

const issue = { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'The bug' };
const node = { kind: 'NODE', target: 'hrn:node:acme.com:team:x', label: null };
const task = { kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT0.3898', label: 'follows' };
const bidi = { kind: 'URL', target: 'https://evil.com@github.com/‮x', label: null };
const J = (x: unknown) => JSON.stringify(x);

describe('edit action: references (acceptance 6)', () => {
  async function edit(fields: Record<string, string | string[]>) {
    const { actions } = await import('./[taskId]/+page.server');
    return actions.edit(event({ title: 'Ship it', titleBase: 'Ship it', ...fields })) as Promise<unknown>;
  }
  const sent = () => (request.mock.calls.find((c) => c[0] === UPDATE_AGENT_TASK_MUTATION)?.[1] as { input: Record<string, unknown> } | undefined)?.input;
  const wire = (r: { kind: string; target: string; label: string | null }) => (r.label ? r : { kind: r.kind, target: r.target });

  it.each([
    ['an add', [issue], [issue, node]],
    ['a remove', [issue, node, task], [issue, task]],
    ['a reorder', [issue, node], [node, issue]],
    ['a relabel', [issue], [{ ...issue, label: 'Renamed' }]],
  ])('after %s, the whole ordered list is sent', async (_name, base, now) => {
    request.mockResolvedValue({ updateAgentTask: { id: 't1' } });
    await edit({ referencesBase: J(base), references: J(now) });
    expect(sent()).toEqual({ references: now.map(wire) });
  });

  it('removing the last one sends []', async () => {
    request.mockResolvedValue({ updateAgentTask: { id: 't1' } });
    await edit({ referencesBase: J([issue]), references: J([]) });
    expect(sent()).toEqual({ references: [] });
  });

  it('saving without touching references sends no references field', async () => {
    request.mockResolvedValue({ updateAgentTask: { id: 't1' } });
    expect(await edit({ referencesBase: J([issue, node]), references: J([issue, node]), description: 'new', descriptionBase: '' })).toMatchObject({ ok: true });
    expect(sent()).toEqual({ description: 'new' });
  });

  it('nothing else changed and references untouched: nothing is asked of the server', async () => {
    expect(await edit({ referencesBase: J([issue]), references: J([issue]) })).toEqual({ action: 'edit', ok: true, unchanged: true });
    expect(request).not.toHaveBeenCalledWith(UPDATE_AGENT_TASK_MUTATION, expect.anything());
  });

  it('a list posted without its base is never sent (a crafted post can’t replace what the form never showed)', async () => {
    expect(await edit({ references: J([issue]) })).toEqual({ action: 'edit', ok: true, unchanged: true });
  });

  it('a target goes exactly as stored: format characters and userinfo are not rewritten', async () => {
    request.mockResolvedValue({ updateAgentTask: { id: 't1' } });
    await edit({ referencesBase: J([]), references: J([bidi]) });
    expect(sent()).toEqual({ references: [{ kind: 'URL', target: 'https://evil.com@github.com/‮x' }] });
  });

  it('an unreadable list is refused on its field, before the server is asked', async () => {
    expect(await edit({ referencesBase: J([]), references: '{' })).toMatchObject({ status: 400, data: { refusal: { kind: 'invalid', field: 'references' } } });
    expect(request).not.toHaveBeenCalledWith(UPDATE_AGENT_TASK_MUTATION, expect.anything());
  });

  it('a server BAD_USER_INPUT shows its message and keeps the reader’s values (acceptance 7)', async () => {
    request.mockImplementation(async (q: string) => { if (q === UPDATE_AGENT_TASK_MUTATION) throw badInput(); return {}; });
    const out = await edit({ referencesBase: J([]), references: J([node]) });
    expect(out).toMatchObject({ status: 400, data: { refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message: REFUSAL }, values: { references: J([node]) } } });
  });
});

describe('create action: references', () => {
  async function create(fields: Record<string, string | string[]>) {
    const { actions } = await import('./new/+page.server');
    return actions.default(event({ title: 'T', start: 'now', owner: 'me', assignee: 'nobody', ...fields })) as Promise<unknown>;
  }
  const input = () => (request.mock.calls.find((c) => c[0] === CREATE_AGENT_TASK_MUTATION)?.[1] as { input: Record<string, unknown> }).input;

  it('sends the list in order', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { createAgentTask: { id: 't9' } }));
    await expect(create({ references: J([task, issue, bidi]) })).rejects.toMatchObject({ status: 303 });
    expect(input().references).toEqual([task, issue, { kind: 'URL', target: bidi.target }]);
  });

  it('an empty list sends no references field', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { createAgentTask: { id: 't9' } }));
    await expect(create({ references: '[]' })).rejects.toMatchObject({ status: 303 });
    expect(input()).not.toHaveProperty('references');
  });

  it('an unreadable list is refused on its field, before the server is asked', async () => {
    expect(await create({ references: '[{"kind":"FILE"}]' })).toMatchObject({ status: 400, data: { refusal: { kind: 'invalid', field: 'references' } } });
    expect(request).not.toHaveBeenCalledWith(CREATE_AGENT_TASK_MUTATION, expect.anything());
  });

  it('a server BAD_USER_INPUT shows its message and keeps the reader’s values (acceptance 7)', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw badInput(); });
    rawRequest.mockImplementation(async (q: string, v: unknown) => { if (q === CREATE_AGENT_TASK_MUTATION) throw badInput(); return delegate(q, v); });
    const out = await create({ references: J([node]) });
    expect(out).toMatchObject({ status: 400, data: { refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message: REFUSAL }, values: { references: J([node]) } } });
  });
});
