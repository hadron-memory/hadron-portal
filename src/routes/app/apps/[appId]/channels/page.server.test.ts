/**
 * #942 slice 2 — the App Channels page: its loader and its three actions.
 *
 * Error fixtures are real `ClientError`s shaped like hadron-server's output:
 * the typed codes resolvers.channel.ts / lib/channels.ts emit, and the untyped
 * `Error('Forbidden')` that reaches the wire as INTERNAL_SERVER_ERROR prose.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import {
  APP_CHANNELS_APP_QUERY,
  APP_CHANNELS_QUERY,
  APP_SHARED_MEMORY_QUERY,
  CREATE_CHANNEL_MUTATION,
  DELETE_CHANNEL_MUTATION,
  SELF_CAN_WRITE_QUERY,
  UPDATE_CHANNEL_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

function refusal(message: string, code: string) {
  return new ClientError(
    { data: null, errors: [{ message, extensions: { code } }], status: 200, headers: new Headers() } as unknown as ConstructorParameters<typeof ClientError>[0],
    { query: '', variables: {} },
  );
}

const SHARED = { id: 'mem-shared', urn: 'hrn:mem:acme.com:team-shared', name: 'Team — shared chats' };
const OTHER = { id: 'mem-other', urn: 'hrn:mem:acme.com:other', name: 'Other' };
function channel(over: Record<string, unknown> = {}) {
  return {
    id: 'ch-team', name: 'Team chat', description: null, kind: 'CHAT', loc: 'chats:team',
    chatRootUrn: 'hrn:node:acme.com:team-shared:chats:team', chatRootNodeId: 'root-1',
    lastSeq: 12, lastMessageAt: '2026-09-26T10:00:00Z', createdAt: '2026-09-01T00:00:00Z',
    memory: SHARED, ...over,
  };
}

function route(opts: {
  app?: Record<string, unknown> | null;
  channels?: unknown[];
  canWrite?: Record<string, boolean | Error>;
  create?: unknown;
  update?: unknown;
  del?: unknown;
}) {
  const app = opts.app === undefined
    ? { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1', defaultChannel: { id: 'ch-team' }, sharedMemory: SHARED }
    : opts.app;
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    if (doc === APP_CHANNELS_APP_QUERY) return { app };
    if (doc === APP_CHANNELS_QUERY) {
      // The server's page: capped at 200, whatever limit is asked for.
      const all = opts.channels ?? [];
      const offset = (vars.offset as number | undefined) ?? 0;
      const limit = Math.min((vars.limit as number | undefined) ?? 50, 200);
      return { channels: { total: all.length, items: all.slice(offset, offset + limit) } };
    }
    if (doc === APP_SHARED_MEMORY_QUERY) return { app: app && { id: app.id, sharedMemory: app.sharedMemory } };
    if (doc === SELF_CAN_WRITE_QUERY) {
      // As the server dispatches it: a bare id is an AiServiceConfig id, so a
      // memory audited by id is NOT_FOUND.
      const resource = vars.resource as string;
      if (!resource.startsWith('hrn:mem:')) throw refusal(`No AiServiceConfig ${resource}`, 'NOT_FOUND');
      const v = opts.canWrite?.[resource] ?? true;
      if (v instanceof Error) throw v;
      return { effectiveAccess: { canWrite: v } };
    }
    const reply = doc === CREATE_CHANNEL_MUTATION ? opts.create : doc === UPDATE_CHANNEL_MUTATION ? opts.update : doc === DELETE_CHANNEL_MUTATION ? opts.del : undefined;
    if (reply instanceof Error) throw reply;
    return reply ?? {};
  });
}

async function load() {
  const { load } = await import('./+page.server');
  return (await load({ params: { appId: 'app-1' }, locals: { token: 'tok', user: { id: 'u-1' } } } as never)) as unknown as {
    channels: Array<{ id: string }>;
    defaultChannelId: string | null;
    canWrite: Record<string, boolean | null>;
  };
}

async function act(name: 'createChannel' | 'renameChannel' | 'deleteChannel', fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (actions as Record<string, (e: never) => Promise<unknown>>)[name]({
    request: { formData: async () => fd },
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u-1' } },
  } as never) as Promise<{ status?: number; data?: { form?: { message?: unknown } }; form?: { message?: unknown } }>;
}
const msg = (r: Awaited<ReturnType<typeof act>>) => (r.data?.form ?? r.form)?.message;
const sent = (doc: string) => mockRequest.mock.calls.filter(([d]) => d === doc).map(([, v]) => v);

describe('load', () => {
  it('lists the App’s Channels, marks the default, and audits write access per host memory', async () => {
    route({ channels: [channel(), channel({ id: 'ch-x', loc: 'chats:x', memory: OTHER })], canWrite: { [OTHER.urn]: false } });
    const data = await load();
    expect(data.channels.map((c) => c.id)).toEqual(['ch-team', 'ch-x']);
    expect(data.defaultChannelId).toBe('ch-team');
    // Keyed by memory id, as the page looks it up...
    expect(data.canWrite).toEqual({ 'mem-shared': true, 'mem-other': false });
    // ...but audited by URN: a SELF-audit, the caller's own id, one per distinct host.
    expect(sent(SELF_CAN_WRITE_QUERY)).toEqual([
      { user: 'u-1', resource: SHARED.urn },
      { user: 'u-1', resource: OTHER.urn },
    ]);
  });

  it('pages past the 200-per-page cap, so a Channel after the first page is still listed', async () => {
    const many = Array.from({ length: 201 }, (_, i) => channel({ id: `ch-${i}`, loc: `chats:c${i}` }));
    route({ channels: many });
    const data = await load();
    expect(data.channels).toHaveLength(201);
    expect(data.channels.at(-1)?.id).toBe('ch-200');
    expect(sent(APP_CHANNELS_QUERY).map((v) => v.offset)).toEqual([0, 200]);
  });

  it('a failed audit is UNKNOWN (null), not "no": the server decides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    route({ channels: [channel()], canWrite: { [SHARED.urn]: new Error('boom') } });
    expect((await load()).canWrite['mem-shared']).toBeNull();
    warn.mockRestore();
  });

  it('an App the caller cannot see is a 404', async () => {
    route({ app: null });
    await expect(load()).rejects.toMatchObject({ status: 404 });
  });

  it('never calls anything that marks messages read', async () => {
    route({ channels: [channel()] });
    await load();
    for (const [doc] of mockRequest.mock.calls) expect(doc as string).not.toMatch(/advanceChannelReadState|markOwnTeamChatRead/);
  });
});

describe('createChannel', () => {
  it('creates chats:<short name> in the App’s shared memory', async () => {
    route({ create: { createChannel: { id: 'ch-new' } } });
    const r = await act('createChannel', { _kind: 'createChannel', name: ' Release ', slug: 'release', description: '' });
    expect(msg(r)).toEqual({ type: 'success', text: 'Channel created.' });
    expect(sent(CREATE_CHANNEL_MUTATION)).toEqual([
      { input: { memoryRef: 'mem-shared', loc: 'chats:release', name: 'Release', description: null } },
    ]);
  });

  it.each(['', 'Release', 'has space', '-lead', 'a:b', 'x'.repeat(64)])('refuses the short name %j before any request', async (slug) => {
    route({});
    const r = await act('createChannel', { _kind: 'createChannel', name: 'N', slug, description: '' });
    expect(r.status).toBe(400);
    expect(sent(CREATE_CHANNEL_MUTATION)).toHaveLength(0);
  });

  it('an overlong name is refused in words, before any request', async () => {
    route({});
    const r = await act('createChannel', { _kind: 'createChannel', name: 'x'.repeat(121), slug: 'ok', description: '' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r)).toContain('Keep the name to 120 characters.');
    expect(sent(CREATE_CHANNEL_MUTATION)).toHaveLength(0);
  });

  it('an overlapping address is explained in words', async () => {
    route({ create: refusal('Channel address overlaps chats:team', 'LOC_OVERLAPS_CHANNEL') });
    const r = await act('createChannel', { _kind: 'createChannel', name: 'N', slug: 'team', description: '' });
    expect(msg(r)).toMatchObject({ type: 'error', text: expect.stringContaining('overlaps an existing channel') });
  });

  it('an untyped Forbidden is the server’s own words, not a guess', async () => {
    route({ create: refusal('Forbidden', 'INTERNAL_SERVER_ERROR') });
    const r = await act('createChannel', { _kind: 'createChannel', name: 'N', slug: 'ok', description: '' });
    expect(msg(r)).toEqual({ type: 'error', text: 'Forbidden' });
  });

  it('an App with no readable shared memory gets an explanation that doesn’t claim it’s missing, and no create', async () => {
    route({ app: { id: 'app-1', name: 'T', urn: 'u', defaultChannel: null, sharedMemory: null } });
    const r = await act('createChannel', { _kind: 'createChannel', name: 'N', slug: 'ok', description: '' });
    expect(r.status).toBe(400);
    expect(sent(CREATE_CHANNEL_MUTATION)).toHaveLength(0);
    const text = (msg(r) as { text: string }).text;
    expect(text).toContain('isn’t available to you');
    expect(text).not.toMatch(/has no shared memory/);
  });
});

describe('renameChannel and deleteChannel', () => {
  it('rename sends the ref, name and description (an emptied description clears)', async () => {
    route({ update: { updateChannel: { id: 'ch-x' } } });
    const r = await act('renameChannel', { _kind: 'renameChannel', ref: 'ch-x', name: 'New', description: '' });
    expect(msg(r)).toEqual({ type: 'success', text: 'Channel updated.' });
    expect(sent(UPDATE_CHANNEL_MUTATION)).toEqual([{ ref: 'ch-x', input: { name: 'New', description: '' } }]);
  });

  it('rename refuses an empty name before any request', async () => {
    route({});
    const r = await act('renameChannel', { _kind: 'renameChannel', ref: 'ch-x', name: '  ', description: '' });
    expect(r.status).toBe(400);
    expect(sent(UPDATE_CHANNEL_MUTATION)).toHaveLength(0);
  });

  it('delete sends the ref', async () => {
    route({ del: { deleteChannel: true } });
    const r = await act('deleteChannel', { _kind: 'deleteChannel', ref: 'ch-x' });
    expect(msg(r)).toEqual({ type: 'success', text: 'Channel deleted.' });
    expect(sent(DELETE_CHANNEL_MUTATION)).toEqual([{ ref: 'ch-x' }]);
  });

  it('a missing-or-unreadable Channel is worded as unavailable, never as "does not exist"', async () => {
    route({ del: refusal('No match for channelRef "ch-x".', 'NOT_FOUND') });
    const r = await act('deleteChannel', { _kind: 'deleteChannel', ref: 'ch-x' });
    const text = (msg(r) as { text: string }).text;
    expect(text).toContain('not available to you');
    expect(text).not.toMatch(/does not exist/i);
  });
});
