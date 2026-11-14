/** #2159: real GraphQLClient parsing and error policy, with a synthetic fetch transport. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { load } from './+page.server';

vi.mock('$env/dynamic/private', () => ({ env: { LOCAL_SERVER_URL: 'http://search-tests.invalid' } }));
afterEach(() => vi.unstubAllGlobals());

function event(search: string) {
  return {
    url: new URL(`/app/search${search}`, 'https://portal.example.test'),
    locals: { token: 'synthetic-test-token' },
  } as unknown as Parameters<typeof load>[0];
}

function reply(body: unknown, status = 200) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function rejection(search: string): Promise<unknown> {
  try {
    await load(event(search));
  } catch (error) {
    return error;
  }
  throw new Error('Expected the task lookup to reject');
}

describe('task lookup response classification', () => {
  it('missing, unreadable and malformed-unresolved references share the same status and text', async () => {
    reply({ data: { agentTask: null } });
    const outcomes = [];
    for (const id of ['missing-task', 'unreadable-task', 'not-a-task-reference']) {
      const failure = await rejection(`?task=${id}`);
      expect(isHttpError(failure, 404)).toBe(true);
      if (!isHttpError(failure)) throw failure;
      outcomes.push({ status: failure.status, body: failure.body });
    }
    expect(outcomes).toEqual([
      { status: 404, body: { message: 'Task not found or unavailable.' } },
      { status: 404, body: { message: 'Task not found or unavailable.' } },
      { status: 404, body: { message: 'Task not found or unavailable.' } },
    ]);
  });

  it('propagates a transport outage as failure, never absence', async () => {
    const outage = new Error('Synthetic transport outage');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(outage));
    const failure = await rejection('?task=task-id');
    expect(failure).toBe(outage);
    expect(isHttpError(failure, 404)).toBe(false);
    expect(isRedirect(failure)).toBe(false);
  });

  it.each(['INTERNAL_SERVER_ERROR', 'TASK_HANDLE_QUALIFY'])('a GraphQL %s response remains an error, not null data', async code => {
    reply({ errors: [{ message: 'Synthetic refusal or failure', extensions: { code } }] });
    const failure = await rejection('?task=task-id');
    expect(failure).toBeInstanceOf(ClientError);
    expect(isHttpError(failure, 404)).toBe(false);
    expect(isRedirect(failure)).toBe(false);
    expect((failure as ClientError).response.errors?.[0].extensions?.code).toBe(code);
  });

  it.each([null, { id: 'canonical-task', appId: 'canonical-app' }])('partial data carrying errors never becomes absence or a redirect: %j', async agentTask => {
    reply({ data: { agentTask }, errors: [{ message: 'Synthetic partial-response failure' }] });
    const failure = await rejection('?task=task-id');
    expect(failure).toBeInstanceOf(ClientError);
    expect(isHttpError(failure, 404)).toBe(false);
    expect(isRedirect(failure)).toBe(false);
  });

  it('invalid JSON remains a parsing failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{bad json', {
      headers: { 'content-type': 'application/json' },
    })));
    const failure = await rejection('?task=task-id');
    expect(failure).toBeInstanceOf(SyntaxError);
    expect(isHttpError(failure, 404)).toBe(false);
    expect(isRedirect(failure)).toBe(false);
  });
});

describe('task click redirect precedence', () => {
  it('task wins over q/type and targets only the returned App and task ids', async () => {
    const fetch = reply({ data: { agentTask: { id: 'canonical-task', appId: 'canonical-app', title: 'Canonical title', handle: 'AT0.42' } } });
    const outcome = await rejection('?task=input-reference&q=unrelated&type=node');
    expect(isRedirect(outcome)).toBe(true);
    expect(outcome).toMatchObject({ status: 307, location: '/app/apps/canonical-app/tasks/canonical-task' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).variables).toEqual({ id: 'input-reference' });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-test-token');
  });
});

it('encodes each returned redirect segment without using the input reference', async () => {
  reply({ data: { agentTask: {
    id: 'task/with?query',
    appId: 'app/with#fragment',
    title: 'Synthetic encoding probe',
    handle: 'AT0.42',
  } } });
  const outcome = await rejection('?task=input-reference');
  expect(outcome).toMatchObject({
    status: 307,
    location: '/app/apps/app%2Fwith%23fragment/tasks/task%2Fwith%3Fquery',
  });
});
